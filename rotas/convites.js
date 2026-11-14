const express = require("express");
const { auditar } = require("../lib/auth");
const { gerarToken, hashToken, tokenComFormatoValido, hashSenha, formatarBrasilia } = require("../lib/seguranca");
const V = require("../lib/validacoes");
const mail = require("../lib/email");
const { limitar } = require("../lib/limite");

const validadeDias = () => Number(process.env.CONVITE_VALIDADE_DIAS) || 7;
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const MSG_DUPLICADO = "Já existe um cadastro com estes dados. Fale com o gerente da sua empresa.";

// Marca como EXPIRADO no banco os convites pendentes vencidos (a leitura já os trata como expirados).
async function expirarConvites(db) {
  const [r] = await db.query("UPDATE convites SET status='EXPIRADO' WHERE status='PENDENTE' AND expira_em <= UTC_TIMESTAMP()");
  return r.affectedRows;
}

// Estado efetivo de um convite (considera a validade mesmo se a limpeza ainda não rodou).
function estadoEfetivo(c) {
  if (c.status === "PENDENTE" && new Date(c.expira_em) <= new Date()) return "EXPIRADO";
  return c.status;
}

// Cria convite + envia e-mail. Se o envio falhar, o convite é cancelado (sem convite "fantasma").
async function criarEEnviarConvite(db, { req, criador, empresaId, empresaNome, email, cargoInicial = null }) {
  const codigo = gerarToken();
  let id;
  try {
    const [r] = await db.query(
      `INSERT INTO convites (empresa_id, email, codigo_hash, cargo_inicial, criado_por, expira_em)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))`,
      [empresaId, email, hashToken(codigo), cargoInicial, criador.id, validadeDias()]
    );
    id = r.insertId;
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return { status: 409, erro: "Já existe um convite pendente para este e-mail." };
    throw e;
  }
  const modelo = mail.modeloConvite({
    empresa: empresaNome, convidadoPor: criador.nome, codigo, validadeDias: validadeDias(),
    link: `${appUrl()}/cadastrar.html#convite=${codigo}`
  });
  const enviado = await mail.enviar(db, "convite", { para: email, ...modelo });
  if (!enviado) {
    await db.query("UPDATE convites SET status='CANCELADO' WHERE id=? AND status='PENDENTE'", [id]);
    await auditar(db, { req, usuario: criador, empresaId, acao: "convite_falha_envio", entidade: "convite", entidadeId: id });
    return { status: 502, erro: "Não foi possível enviar o e-mail. O convite foi cancelado; tente novamente." };
  }
  await auditar(db, { req, usuario: criador, empresaId, acao: "convite_criado", entidade: "convite", entidadeId: id,
    detalhes: { email, cargo_inicial: cargoInicial } });
  return { status: 201, id };
}

module.exports = function rotasConvites(db, { exigirLogin, exigirNivel, exigirEmpresa }) {
  const r = express.Router();

  // ---- Gerente: criar convite ----
  r.post("/api/convites", exigirLogin, exigirNivel("gerente"), exigirEmpresa, async (req, res) => {
    try {
      const email = V.normalizarEmail(req.body?.email);
      if (!V.emailValido(email)) return res.status(400).json({ erro: "Informe um e-mail válido." });

      // Não convida quem já tem conta (exceto rejeitados, que podem tentar de novo).
      const [u] = await db.query("SELECT id, status FROM usuarios WHERE email = ?", [email]);
      if (u[0] && u[0].status !== "rejeitado") {
        return res.status(409).json({ erro: "Não foi possível criar convite para este e-mail." });
      }
      await expirarConvites(db);
      const out = await criarEEnviarConvite(db, {
        req, criador: req.user, empresaId: req.user.empresa_id, empresaNome: req.user.empresa_nome, email
      });
      if (out.erro) return res.status(out.status).json({ erro: out.erro });
      res.status(201).json({ ok: true, id: out.id });
    } catch (e) {
      console.error("Erro ao criar convite:", e);
      res.status(500).json({ erro: "Erro no servidor" });
    }
  });

  // ---- Gerente: listar convites da própria empresa ----
  r.get("/api/convites", exigirLogin, exigirNivel("gerente"), exigirEmpresa, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT c.id, c.email, c.status, c.criado_em, c.expira_em, c.utilizado_em, u.nome AS criado_por_nome
           FROM convites c JOIN usuarios u ON u.id = c.criado_por
          WHERE c.empresa_id = ? ORDER BY c.id DESC LIMIT 100`, [req.user.empresa_id]);
      res.json(rows.map((c) => ({ ...c, status: estadoEfetivo(c) })));
    } catch (e) {
      console.error(e); res.status(500).json({ erro: "Erro no servidor" });
    }
  });

  // ---- Gerente: cancelar convite (somente da própria empresa e pendente) ----
  r.post("/api/convites/:id/cancelar", exigirLogin, exigirNivel("gerente"), exigirEmpresa, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return res.status(404).json({ erro: "Convite não encontrado." });
      const [r1] = await db.query(
        "UPDATE convites SET status='CANCELADO' WHERE id=? AND empresa_id=? AND status='PENDENTE' AND expira_em > UTC_TIMESTAMP()",
        [id, req.user.empresa_id]);
      if (r1.affectedRows !== 1) return res.status(404).json({ erro: "Convite não encontrado ou não está pendente." });
      await auditar(db, { req, usuario: req.user, acao: "convite_cancelado", entidade: "convite", entidadeId: id });
      res.json({ ok: true });
    } catch (e) {
      console.error(e); res.status(500).json({ erro: "Erro no servidor" });
    }
  });

  // ---- Público: validar código (com limite de tentativas) ----
  const limiteValidacao = limitar("validar-convite", {
    max: 10, janelaMs: 15 * 60 * 1000,
    aoBloquear: (req) => auditar(db, { req, acao: "convite_validacao_bloqueada", entidade: "convite" })
  });

  async function buscarConvite(exec, codigo) {
    if (!tokenComFormatoValido(codigo)) return null;
    const [rows] = await exec.query(
      `SELECT c.*, e.nome AS empresa_nome FROM convites c JOIN empresas e ON e.id = c.empresa_id WHERE c.codigo_hash = ?`,
      [hashToken(codigo)]);
    return rows[0] || null;
  }

  r.post("/api/convites/validar", limiteValidacao, async (req, res) => {
    try {
      const c = await buscarConvite(db, req.body?.codigo);
      if (!c) {
        await auditar(db, { req, acao: "convite_validacao_falha", entidade: "convite" });
        return res.status(400).json({ erro: "Convite inválido." });
      }
      const estado = estadoEfetivo(c);
      if (estado !== "PENDENTE") {
        const msg = { UTILIZADO: "Este convite já foi utilizado.", EXPIRADO: "Este convite expirou. Peça um novo ao gerente.",
          CANCELADO: "Este convite foi cancelado." }[estado];
        return res.status(400).json({ erro: msg, estado });
      }
      res.json({ ok: true, empresa: c.empresa_nome, email: c.email });
    } catch (e) {
      console.error(e); res.status(500).json({ erro: "Erro no servidor" });
    }
  });

  // ---- Público: concluir cadastro ----
  const limiteCadastro = limitar("cadastrar", { max: 15, janelaMs: 15 * 60 * 1000 });

  r.post("/cadastrar", limiteCadastro, async (req, res) => {
    // Campos como empresa, nivel, status etc. enviados pelo navegador são IGNORADOS de propósito.
    const b = req.body || {};
    const campos = {};
    const erros = {};
    const exigir = (k, ok, msg) => { if (!ok) erros[k] = msg; };

    const nome = V.normalizarNome(b.nome);
    const email = V.normalizarEmail(b.email);
    const cpf = V.soDigitos(b.cpf);
    const telefone = V.soDigitos(b.telefone);
    const nascimento = String(b.nascimento ?? "").trim();
    const senha = String(b.senha ?? "");
    const confirmar = String(b.confirmarSenha ?? "");

    for (const k of ["nome", "cpf", "nascimento", "email", "telefone", "senha", "confirmarSenha"]) {
      if (!String(b[k] ?? "").trim()) erros[k] = "Campo obrigatório.";
    }
    if (!erros.nome) exigir("nome", V.nomeValido(nome), "Informe nome e sobrenome (apenas letras).");
    if (!erros.cpf) exigir("cpf", V.cpfValido(cpf), "CPF inválido.");
    if (!erros.nascimento) exigir("nascimento", V.nascimentoValido(nascimento), "Data inválida ou idade mínima de 18 anos não atendida.");
    if (!erros.telefone) exigir("telefone", V.telefoneValido(telefone), "Telefone inválido. Use DDD + número.");
    if (!erros.email) exigir("email", V.emailValido(email), "E-mail inválido.");
    if (!erros.senha) {
      const pend = V.validarSenha(senha, { nome, email });
      if (pend.length) erros.senha = pend.join(". ") + ".";
    }
    if (!erros.confirmarSenha) exigir("confirmarSenha", senha === confirmar, "A confirmação não confere com a senha.");
    if (!tokenComFormatoValido(b.codigo)) return res.status(400).json({ erro: "Convite inválido." });
    if (Object.keys(erros).length) return res.status(422).json({ erro: "Corrija os campos indicados.", campos: erros });

    // Hash fora da transação, para não segurar o bloqueio do convite durante o cálculo.
    const senhaHash = await hashSenha(senha);

    const conn = await db.getConnection();
    let resultado;
    try {
      await conn.beginTransaction();
      const [cv] = await conn.query(
        `SELECT c.*, e.nome AS empresa_nome, e.ativa AS empresa_ativa
           FROM convites c JOIN empresas e ON e.id = c.empresa_id
          WHERE c.codigo_hash = ? FOR UPDATE`, [hashToken(b.codigo)]);
      const c = cv[0];
      if (!c) { await conn.rollback(); return res.status(400).json({ erro: "Convite inválido." }); }
      const estado = estadoEfetivo(c);
      if (estado !== "PENDENTE" || !c.empresa_ativa) {
        await conn.rollback();
        return res.status(400).json({ erro: estado === "EXPIRADO" ? "Este convite expirou." : "Este convite não está mais disponível." });
      }
      if (c.email !== email) {
        await conn.rollback();
        return res.status(422).json({ erro: "Corrija os campos indicados.", campos: { email: "O e-mail deve ser o mesmo do convite." } });
      }

      // Convite criado pelo administrador para o primeiro gerente: acesso liberado direto.
      const primeiroGerente = c.cargo_inicial === "gerente";
      const [ex] = await conn.query("SELECT id, status FROM usuarios WHERE email = ? FOR UPDATE", [email]);
      let usuarioId;
      if (ex[0] && ex[0].status !== "rejeitado") {
        await conn.rollback();
        return res.status(409).json({ erro: MSG_DUPLICADO });
      }
      const statusUsuario = primeiroGerente ? "ativo" : "pendente";
      const nivel = primeiroGerente ? "gerente" : null;
      if (ex[0]) { // candidato rejeitado antes: reaproveita o mesmo usuário, histórico preservado
        usuarioId = ex[0].id;
        await conn.query(
          `UPDATE usuarios SET nome=?, cpf=?, data_nascimento=?, telefone=?, senha_hash=?, empresa_id=?, nivel=?, status=?,
                  aprovado_por=NULL, aprovado_em=NULL WHERE id=?`,
          [nome, cpf, nascimento, telefone, senhaHash, c.empresa_id, nivel, statusUsuario, usuarioId]);
      } else {
        const [ins] = await conn.query(
          `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, cpf, data_nascimento, telefone, nivel, status)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [c.empresa_id, nome, email, senhaHash, cpf, nascimento, telefone, nivel, statusUsuario]);
        usuarioId = ins.insertId;
      }
      const [sol] = await conn.query(
        `INSERT INTO solicitacoes_cadastro (usuario_id, convite_id, empresa_id, status, cargo_atribuido, decidido_por, decidido_em)
         VALUES (?,?,?,?,?,?,?)`,
        primeiroGerente
          ? [usuarioId, c.id, c.empresa_id, "APROVADA", "gerente", c.criado_por, new Date()]
          : [usuarioId, c.id, c.empresa_id, "PENDENTE", null, null, null]);
      const [upd] = await conn.query(
        "UPDATE convites SET status='UTILIZADO', utilizado_em=UTC_TIMESTAMP(), utilizado_por=? WHERE id=? AND status='PENDENTE'",
        [usuarioId, c.id]);
      if (upd.affectedRows !== 1) throw new Error("Convite já utilizado (concorrência)");
      await auditar(conn, { req, usuario: { id: usuarioId, empresa_id: c.empresa_id }, acao: "cadastro_concluido",
        entidade: "solicitacao", entidadeId: sol.insertId, detalhes: { convite_id: c.id, primeiro_gerente: primeiroGerente } });
      await conn.commit();
      resultado = { usuarioId, solicitacaoId: sol.insertId, empresaId: c.empresa_id, empresaNome: c.empresa_nome, primeiroGerente };
    } catch (e) {
      try { await conn.rollback(); } catch {}
      if (e.code === "ER_DUP_ENTRY") {
        // CPF ou e-mail já existem: mensagem genérica, sem dizer qual campo repetiu; convite continua pendente.
        await auditar(db, { req, acao: "cadastro_duplicado", entidade: "usuario" });
        return res.status(409).json({ erro: MSG_DUPLICADO });
      }
      console.error("Erro no cadastro:", e);
      return res.status(500).json({ erro: "Erro no servidor. Tente novamente." });
    } finally {
      conn.release();
    }

    // E-mails depois do COMMIT (falha de e-mail não desfaz o cadastro; fica registrada em emails_log).
    try {
      const dataHora = formatarBrasilia(new Date());
      if (!resultado.primeiroGerente) {
        await mail.enviar(db, "aguardando_aprovacao", { para: email, ...mail.modeloAguardando({ nome, empresa: resultado.empresaNome, dataHora }) });
        const [gs] = await db.query(
          "SELECT nome, email FROM usuarios WHERE empresa_id=? AND nivel='gerente' AND status='ativo'", [resultado.empresaId]);
        for (const g of gs) {
          await mail.enviar(db, "novo_pedido", { para: g.email,
            ...mail.modeloNovoPedido({ gerente: g.nome, candidato: nome, empresa: resultado.empresaNome, dataHora, link: `${appUrl()}/login.html` }) });
        }
      }
    } catch (e) { console.error("Erro nos e-mails pós-cadastro:", e.message); }

    res.status(201).json({ ok: true, aguardandoAprovacao: !resultado.primeiroGerente });
  });

  return r;
};

module.exports.expirarConvites = expirarConvites;
module.exports.criarEEnviarConvite = criarEEnviarConvite;
