const express = require("express");
const { auditar } = require("../lib/auth");
const { mascararCpf } = require("../lib/validacoes");
const { formatarBrasilia } = require("../lib/seguranca");
const mail = require("../lib/email");

const CARGOS_APROVAVEIS = ["supervisor", "tecnico", "operador"]; // gerente/administrador nunca por esta rota
const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

module.exports = function rotasSolicitacoes(db, { exigirLogin, exigirNivel, exigirEmpresa }) {
  const r = express.Router();
  // A empresa vem SEMPRE da sessão (req.user.empresa_id); nada que o navegador envia é usado para isso.
  const guarda = [exigirLogin, exigirNivel("gerente"), exigirEmpresa];

  const idValido = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // Lista (PENDENTE por padrão) com paginação
  r.get("/api/solicitacoes", ...guarda, async (req, res) => {
    try {
      const status = ["PENDENTE", "APROVADA", "REJEITADA"].includes(req.query.status) ? req.query.status : "PENDENTE";
      const [rows] = await db.query(
        `SELECT s.id, s.status, s.criado_em, u.nome, u.email, u.cpf
           FROM solicitacoes_cadastro s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.empresa_id = ? AND s.status = ? ORDER BY s.criado_em ASC LIMIT 200`,
        [req.user.empresa_id, status]);
      res.json(rows.map(({ cpf, ...s }) => ({ ...s, cpf_mascarado: mascararCpf(cpf) })));
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }
  });

  // Histórico de decisões (rota declarada ANTES de /:id)
  r.get("/api/solicitacoes/historico", ...guarda, async (req, res) => {
    try {
      const pagina = Math.max(1, Number(req.query.pagina) || 1);
      const porPagina = 20;
      const [rows] = await db.query(
        `SELECT s.id, s.status, s.cargo_atribuido, s.motivo, s.criado_em, s.decidido_em,
                u.nome, u.email, g.nome AS decidido_por_nome
           FROM solicitacoes_cadastro s
           JOIN usuarios u ON u.id = s.usuario_id
           LEFT JOIN usuarios g ON g.id = s.decidido_por
          WHERE s.empresa_id = ? AND s.status <> 'PENDENTE'
          ORDER BY s.decidido_em DESC, s.id DESC LIMIT ? OFFSET ?`,
        [req.user.empresa_id, porPagina + 1, (pagina - 1) * porPagina]);
      res.json({ pagina, temMais: rows.length > porPagina, itens: rows.slice(0, porPagina) });
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }
  });

  // Dados completos do candidato (CPF completo só aqui, só para o gerente da mesma empresa)
  r.get("/api/solicitacoes/:id", ...guarda, async (req, res) => {
    try {
      const id = idValido(req.params.id);
      if (!id) return res.status(404).json({ erro: "Solicitação não encontrada." });
      const [rows] = await db.query(
        `SELECT s.id, s.status, s.criado_em, s.motivo, u.nome, u.email, u.cpf, u.data_nascimento, u.telefone
           FROM solicitacoes_cadastro s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.id = ? AND s.empresa_id = ? AND u.empresa_id = ?`,
        [id, req.user.empresa_id, req.user.empresa_id]);
      if (!rows[0]) return res.status(404).json({ erro: "Solicitação não encontrada." }); // outra empresa = "não existe"
      await auditar(db, { req, usuario: req.user, acao: "solicitacao_consultada", entidade: "solicitacao", entidadeId: id });
      res.json(rows[0]);
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }
  });

  // Núcleo transacional de aprovar/rejeitar
  async function decidir(req, res, aprovar) {
    const id = idValido(req.params.id);
    if (!id) return res.status(404).json({ erro: "Solicitação não encontrada." });

    const cargo = String(req.body?.cargo ?? "").toLowerCase();
    const motivo = String(req.body?.motivo ?? "").trim();
    if (aprovar && !CARGOS_APROVAVEIS.includes(cargo)) {
      return res.status(400).json({ erro: "Selecione um cargo válido: Supervisor, Técnico ou Operador." });
    }
    if (!aprovar && (motivo.length < 5 || motivo.length > 500)) {
      return res.status(400).json({ erro: "Informe o motivo da rejeição (5 a 500 caracteres)." });
    }

    const conn = await db.getConnection();
    let info;
    try {
      await conn.beginTransaction();
      const [rows] = await conn.query(
        `SELECT s.*, u.nome, u.email, u.status AS usuario_status, e.nome AS empresa_nome,
                g.nome AS decisor_nome
           FROM solicitacoes_cadastro s
           JOIN usuarios u ON u.id = s.usuario_id
           JOIN empresas e ON e.id = s.empresa_id
           LEFT JOIN usuarios g ON g.id = s.decidido_por
          WHERE s.id = ? AND s.empresa_id = ? AND u.empresa_id = ? FOR UPDATE`,
        [id, req.user.empresa_id, req.user.empresa_id]);
      const s = rows[0];
      if (!s) { await conn.rollback(); return res.status(404).json({ erro: "Solicitação não encontrada." }); }
      if (s.usuario_id === req.user.id) {
        await conn.rollback();
        await auditar(db, { req, usuario: req.user, acao: "auto_aprovacao_bloqueada", entidade: "solicitacao", entidadeId: id });
        return res.status(403).json({ erro: "Você não pode decidir o seu próprio cadastro." });
      }
      if (s.status !== "PENDENTE") {
        await conn.rollback();
        return res.status(409).json({ erro: `Solicitação já decidida${s.decisor_nome ? " por " + s.decisor_nome : ""} em ${formatarBrasilia(s.decidido_em)}.` });
      }

      const [u] = await conn.query(
        aprovar
          ? `UPDATE usuarios SET nivel=?, status='ativo', aprovado_por=?, aprovado_em=UTC_TIMESTAMP()
              WHERE id=? AND empresa_id=? AND status='pendente'`
          : `UPDATE usuarios SET nivel=NULL, status='rejeitado'
              WHERE id=? AND empresa_id=? AND status='pendente'`,
        aprovar ? [cargo, req.user.id, s.usuario_id, req.user.empresa_id] : [s.usuario_id, req.user.empresa_id]);
      if (u.affectedRows !== 1) throw new Error("Usuário não está pendente");

      const [sv] = await conn.query(
        `UPDATE solicitacoes_cadastro SET status=?, cargo_atribuido=?, decidido_por=?, decidido_em=UTC_TIMESTAMP(), motivo=?
          WHERE id=? AND empresa_id=? AND status='PENDENTE'`,
        [aprovar ? "APROVADA" : "REJEITADA", aprovar ? cargo : null, req.user.id, aprovar ? null : motivo, id, req.user.empresa_id]);
      if (sv.affectedRows !== 1) throw new Error("Solicitação não está pendente");

      await auditar(conn, { req, usuario: req.user, acao: aprovar ? "solicitacao_aprovada" : "solicitacao_rejeitada",
        entidade: "solicitacao", entidadeId: id, detalhes: aprovar ? { cargo, usuario_id: s.usuario_id } : { usuario_id: s.usuario_id } });
      await conn.commit();
      info = { nome: s.nome, email: s.email, empresa: s.empresa_nome };
    } catch (e) {
      try { await conn.rollback(); } catch {}
      console.error("Erro ao decidir solicitação:", e);
      return res.status(500).json({ erro: "Erro no servidor" });
    } finally { conn.release(); }

    // E-mail depois do commit; se falhar, a decisão permanece e a falha fica em emails_log.
    const enviado = await mail.enviar(db, aprovar ? "aprovado" : "rejeitado", {
      para: info.email,
      ...(aprovar
        ? mail.modeloAprovado({ nome: info.nome, empresa: info.empresa, cargo, link: `${appUrl()}/login.html` })
        : mail.modeloRejeitado({ nome: info.nome, empresa: info.empresa, motivo }))
    });
    res.json({ ok: true, emailEnviado: enviado });
  }

  r.post("/api/solicitacoes/:id/aprovar", ...guarda, (req, res) => decidir(req, res, true).catch((e) => { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }));
  r.post("/api/solicitacoes/:id/rejeitar", ...guarda, (req, res) => decidir(req, res, false).catch((e) => { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }));

  return r;
};
