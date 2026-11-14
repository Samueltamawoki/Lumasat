// Migra os usuários da tabela antiga `login` para `usuarios` (senhas viram hash scrypt) e cria as empresas.
// A tabela `login` NÃO é alterada. Rode ANTES: migracao_001_multiempresa.sql (com backup do banco).
//   node scripts/migrar-usuarios.js            -> simulação (não grava nada)
//   node scripts/migrar-usuarios.js --executar -> grava
// Regras (revise a simulação antes!):
//   - 1º "Supervisor" de cada empresa vira Gerente; os demais continuam Supervisor
//   - "técnico" -> tecnico; "operador" -> operador
//   - e-mails repetidos: mantém só o mais recente (maior id)
//   - sem empresa, ou nível "master": NÃO migrados (listados para decisão sua)
require("../lib/env");
const db = require("../db").promise();
const { hashSenha } = require("../lib/seguranca");
const V = require("../lib/validacoes");

const executar = process.argv.includes("--executar");

(async () => {
  const [linhas] = await db.query("SELECT id, email, senha, nome, empresa, nivel FROM login ORDER BY id");
  const porEmail = new Map();
  for (const l of linhas) porEmail.set(V.normalizarEmail(l.email), l); // o último id vence
  const relatorio = { migrados: [], ignorados: [] };
  const gerentePorEmpresa = new Set();

  for (const l of [...porEmail.values()].sort((a, b) => a.id - b.id)) {
    const email = V.normalizarEmail(l.email);
    const empresa = String(l.empresa || "").trim().replace(/\s+/g, " ");
    const nivelOrig = String(l.nivel || "").trim().toLowerCase();
    if (!empresa) { relatorio.ignorados.push(`${email}: sem empresa (decida a que empresa pertence)`); continue; }
    if (nivelOrig === "master") { relatorio.ignorados.push(`${email}: nível master (use scripts/criar-admin.js)`); continue; }
    if (!l.senha) { relatorio.ignorados.push(`${email}: sem senha`); continue; }
    let nivel = { "supervisor": "supervisor", "técnico": "tecnico", "tecnico": "tecnico", "operador": "operador" }[nivelOrig] || "operador";
    if (nivel === "supervisor" && !gerentePorEmpresa.has(empresa.toLowerCase())) { nivel = "gerente"; gerentePorEmpresa.add(empresa.toLowerCase()); }
    relatorio.migrados.push({ email, nome: l.nome, empresa, nivel, senha: l.senha });
  }
  const dup = linhas.length - porEmail.size;
  if (dup) relatorio.ignorados.push(`${dup} linha(s) com e-mail repetido descartada(s) (mantido o registro mais recente)`);

  console.log(executar ? "== EXECUTANDO ==" : "== SIMULAÇÃO (nada foi gravado) ==");
  relatorio.migrados.forEach((m) => console.log(`  migrar: ${m.email} | ${m.empresa} | ${m.nivel}`));
  relatorio.ignorados.forEach((m) => console.log(`  IGNORADO: ${m}`));
  if (!executar) { console.log("\nRode com --executar para gravar."); process.exit(0); }

  for (const m of relatorio.migrados) {
    await db.query("INSERT IGNORE INTO empresas (nome) VALUES (?)", [m.empresa]);
    const [[e]] = await db.query("SELECT id FROM empresas WHERE nome=?", [m.empresa]);
    await db.query(
      "INSERT IGNORE INTO usuarios (empresa_id, nome, email, senha_hash, nivel, status) VALUES (?,?,?,?,?, 'ativo')",
      [e.id, String(m.nome || m.email).slice(0, 120), m.email, await hashSenha(m.senha), m.nivel]);
  }
  console.log("\nConcluído. Senhas antigas são fracas (ex.: 123): peça aos usuários para trocá-las.");
  process.exit(0);
})().catch((e) => { console.error("Erro:", e.message); process.exit(1); });
