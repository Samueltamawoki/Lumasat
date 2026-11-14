const express = require("express");
const { auditar } = require("../lib/auth");
const V = require("../lib/validacoes");
const { criarEEnviarConvite } = require("./convites");

// Administrador da plataforma: cadastra empresas e envia o convite do primeiro gerente.
module.exports = function rotasAdmin(db, { exigirLogin, exigirNivel }) {
  const r = express.Router();
  const guarda = [exigirLogin, exigirNivel("administrador")];

  r.get("/api/admin/empresas", ...guarda, async (req, res) => {
    try {
      const [rows] = await db.query("SELECT id, nome, ativa, criado_em FROM empresas ORDER BY nome");
      res.json(rows);
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }
  });

  r.post("/api/admin/empresas", ...guarda, async (req, res) => {
    const nome = String(req.body?.nome ?? "").trim().replace(/\s+/g, " ");
    const email = V.normalizarEmail(req.body?.emailGerente);
    if (nome.length < 2 || nome.length > 100) return res.status(400).json({ erro: "Nome da empresa inválido." });
    if (!V.emailValido(email)) return res.status(400).json({ erro: "E-mail do gerente inválido." });
    try {
      const [ex] = await db.query("SELECT id FROM usuarios WHERE email = ?", [email]);
      if (ex[0]) return res.status(409).json({ erro: "Este e-mail já possui cadastro." });
      let empresaId;
      try {
        const [ins] = await db.query("INSERT INTO empresas (nome) VALUES (?)", [nome]);
        empresaId = ins.insertId;
      } catch (e) {
        if (e.code === "ER_DUP_ENTRY") return res.status(409).json({ erro: "Já existe uma empresa com este nome." });
        throw e;
      }
      await auditar(db, { req, usuario: req.user, empresaId, acao: "empresa_criada", entidade: "empresa", entidadeId: empresaId, detalhes: { nome } });
      const out = await criarEEnviarConvite(db, { req, criador: req.user, empresaId, empresaNome: nome, email, cargoInicial: "gerente" });
      if (out.erro) return res.status(out.status).json({ erro: out.erro, empresaId });
      res.status(201).json({ ok: true, empresaId });
    } catch (e) { console.error(e); res.status(500).json({ erro: "Erro no servidor" }); }
  });

  return r;
};
