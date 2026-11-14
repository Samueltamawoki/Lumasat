const { hashToken, gerarToken, tokenComFormatoValido, lerCookies } = require("./seguranca");

const COOKIE = "lumasat_sid";
const horasSessao = () => Number(process.env.SESSAO_HORAS) || 8;

// ---------- Auditoria (nunca recebe senha, CPF ou código de convite) ----------
async function auditar(exec, { req, usuario, empresaId, acao, entidade, entidadeId, detalhes }) {
  try {
    await exec.query(
      "INSERT INTO auditoria (usuario_id, empresa_id, acao, entidade, entidade_id, ip, detalhes) VALUES (?,?,?,?,?,?,?)",
      [usuario?.id ?? null, empresaId ?? usuario?.empresa_id ?? null, acao, entidade ?? null,
        entidadeId != null ? String(entidadeId) : null, req?.ip ?? null, detalhes ? JSON.stringify(detalhes) : null]
    );
  } catch (e) {
    console.error("Falha ao gravar auditoria:", e.message);
  }
}

// ---------- Sessão ----------
async function criarSessao(db, res, usuarioId) {
  const token = gerarToken();
  await db.query(
    "INSERT INTO sessoes (id_hash, usuario_id, expira_em) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))",
    [hashToken(token), usuarioId, horasSessao()]
  );
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: horasSessao() * 3600 * 1000
  });
}

async function encerrarSessao(db, req, res) {
  const token = lerCookies(req)[COOKIE];
  if (tokenComFormatoValido(token)) await db.query("DELETE FROM sessoes WHERE id_hash = ?", [hashToken(token)]);
  res.clearCookie(COOKIE, { path: "/" });
}

// Lê a sessão e confere o usuário NO BANCO a cada requisição:
// status diferente de "ativo" ou empresa desativada derruba a sessão na hora.
function criarMiddlewares(db) {
  async function autenticar(req, res, next) {
    req.user = null;
    try {
      const token = lerCookies(req)[COOKIE];
      if (!tokenComFormatoValido(token)) return next();
      const [rows] = await db.query(
        `SELECT u.id, u.nome, u.email, u.empresa_id, u.nivel, u.status, e.nome AS empresa_nome, e.ativa AS empresa_ativa
           FROM sessoes s
           JOIN usuarios u ON u.id = s.usuario_id
           LEFT JOIN empresas e ON e.id = u.empresa_id
          WHERE s.id_hash = ? AND s.expira_em > UTC_TIMESTAMP()`,
        [hashToken(token)]
      );
      const u = rows[0];
      if (!u) return next();
      if (u.status !== "ativo" || (u.empresa_id != null && !u.empresa_ativa)) {
        await db.query("DELETE FROM sessoes WHERE usuario_id = ?", [u.id]); // revoga sessões antigas
        return next();
      }
      req.user = u;
      next();
    } catch (e) {
      console.error("Erro ao validar sessão:", e.message);
      res.status(500).json({ erro: "Erro no servidor" });
    }
  }

  const exigirLogin = (req, res, next) =>
    req.user ? next() : res.status(401).json({ erro: "Sessão inválida ou expirada. Faça login novamente." });

  const exigirLoginPagina = (req, res, next) =>
    req.user ? next() : res.redirect("/login.html");

  // Autoriza por cargo, lido do banco a cada requisição (nunca do navegador).
  const exigirNivel = (...niveis) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ erro: "Sessão inválida ou expirada. Faça login novamente." });
    if (!niveis.includes(req.user.nivel)) {
      auditar(db, { req, usuario: req.user, acao: "acesso_negado", entidade: "rota",
        detalhes: { metodo: req.method, rota: req.path, nivel: req.user.nivel } });
      return res.status(403).json({ erro: "Você não tem permissão para esta ação." });
    }
    next();
  };

  // Todo dado de empresa exige usuário vinculado a uma empresa (o administrador não tem).
  const exigirEmpresa = (req, res, next) =>
    req.user?.empresa_id ? next() : res.status(403).json({ erro: "Usuário sem empresa vinculada." });

  return { autenticar, exigirLogin, exigirLoginPagina, exigirNivel, exigirEmpresa };
}

// Defesa contra CSRF: requisições que alteram dados só valem se a origem for o próprio site.
function verificarOrigem(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origem = req.headers.origin;
  if (origem && origem !== "null") {
    try {
      const originHost = new URL(origem).host;
      const reqHost = req.headers.host;
      const locais = ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"];
      const ambosLocais = locais.includes(originHost) && locais.includes(reqHost);
      if (!ambosLocais && originHost !== reqHost) {
        return res.status(403).json({ erro: "Origem não permitida." });
      }
    } catch {
      return res.status(403).json({ erro: "Origem não permitida." });
    }
  }
  next();
}

module.exports = { COOKIE, auditar, criarSessao, encerrarSessao, criarMiddlewares, verificarOrigem };
