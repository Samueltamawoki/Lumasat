// Cria o PRIMEIRO administrador da plataforma (não existe cadastro público para este cargo).
// Uso: defina ADMIN_EMAIL, ADMIN_SENHA (e opcionalmente ADMIN_NOME) e rode: node scripts/criar-admin.js
require("../lib/env");
const db = require("../db").promise();
const V = require("../lib/validacoes");
const { hashSenha } = require("../lib/seguranca");

(async () => {
  const email = V.normalizarEmail(process.env.ADMIN_EMAIL);
  const senha = process.env.ADMIN_SENHA || "";
  const nome = V.normalizarNome(process.env.ADMIN_NOME || "Administrador da Plataforma");
  if (!V.emailValido(email)) throw new Error("ADMIN_EMAIL inválido ou ausente");
  const problemas = V.validarSenha(senha, { nome, email });
  if (problemas.length) throw new Error("ADMIN_SENHA fraca: " + problemas.join("; "));
  const [ex] = await db.query("SELECT id FROM usuarios WHERE email=?", [email]);
  if (ex[0]) throw new Error("Já existe um usuário com este e-mail.");
  await db.query(
    "INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel, status) VALUES (NULL, ?, ?, ?, 'administrador', 'ativo')",
    [nome, email, await hashSenha(senha)]);
  console.log("Administrador criado:", email, "\nAgora REMOVA ADMIN_SENHA do ambiente/.env.");
  process.exit(0);
})().catch((e) => { console.error("Erro:", e.message); process.exit(1); });
