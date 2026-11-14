// Testes de integração dos 15 cenários. Exigem MySQL 8 de TESTE e `npm install`.
//   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=lumasat_test DB_SSL=false node tests/integracao.js
// ATENÇÃO: apaga e recria as tabelas novas no banco informado. Só roda se DB_NAME terminar com "_test".
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

require("../lib/env");
if (!/_test$/.test(process.env.DB_NAME || "")) {
  console.error('Recusado: DB_NAME deve terminar com "_test" (este teste apaga tabelas).'); process.exit(2);
}
process.env.NODE_ENV = "test";
process.env.EMAIL_MODO = "capturar";
process.env.APP_URL = "http://teste.local";
const tmpMaq = path.join(os.tmpdir(), `maquinas_${Date.now()}.json`);
fs.copyFileSync(path.join(__dirname, "..", "data", "maquinas.json"), tmpMaq);
process.env.MAQUINAS_ARQUIVO = tmpMaq;

const mysql = require("mysql2/promise");
const mail = require("../lib/email");
const limite = require("../lib/limite");
const { app } = require("../server");

let base, server, pool;
let ok = 0, falhas = 0;
const resultados = [];
async function t(nome, fn) {
  try { await fn(); ok++; resultados.push(["PASSOU", nome]); console.log("  PASSOU ", nome); }
  catch (e) { falhas++; resultados.push(["FALHOU", nome]); console.log("  FALHOU ", nome, "\n         ", e.message); }
}

async function http(metodo, rota, { corpo, cookie, form } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let body;
  if (form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  else if (corpo !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(corpo); }
  const r = await fetch(base + rota, { method: metodo, headers, body, redirect: "manual" });
  let dados = null; try { dados = await r.clone().json(); } catch {}
  return { status: r.status, dados, loc: r.headers.get("location"), setCookie: r.headers.get("set-cookie") };
}
async function login(email, senha) {
  const r = await http("POST", "/login", { form: { email, senha } });
  const m = /lumasat_sid=([^;]+)/.exec(r.setCookie || "");
  return { ...r, cookie: m ? `lumasat_sid=${m[1]}` : null };
}
const ultimoEmail = (para, assuntoParte) =>
  [...mail.caixa].reverse().find((e) => e.para === para && (!assuntoParte || e.assunto.includes(assuntoParte)));
const codigoDoEmail = (para) => /convite=([A-Za-z0-9_-]{43})/.exec(ultimoEmail(para, "Convite").html)[1];
const SENHA = "Tr0ca-Isso-Ja";
const cpfs = ["52998224725", "11144477735", "39053344705", "86288366757", "71428793860", "45317828791"];
const dados = (email, cpf, extra = {}) => ({ nome: "Pessoa Teste Silva", cpf, nascimento: "1990-05-10", email,
  telefone: "11987654321", senha: SENHA, confirmarSenha: SENHA, ...extra });

async function prepararBanco() {
  const cfg = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true,
    ssl: process.env.DB_SSL === "false" ? undefined : { rejectUnauthorized: false } };
  pool = await mysql.createConnection(cfg);
  await pool.query("SET FOREIGN_KEY_CHECKS=0; DROP TABLE IF EXISTS emails_log, auditoria, sessoes, solicitacoes_cadastro, convites, usuarios, empresas; SET FOREIGN_KEY_CHECKS=1;");
  await pool.query(fs.readFileSync(path.join(__dirname, "..", "migracao_001_multiempresa.sql"), "utf8"));
  const { hashSenha } = require("../lib/seguranca");
  await pool.query("INSERT INTO usuarios (empresa_id,nome,email,senha_hash,nivel,status) VALUES (NULL,'Admin Plataforma','admin@plataforma.test',?, 'administrador','ativo')", [await hashSenha(SENHA)]);
}

(async () => {
  await prepararBanco();
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  console.log("Preparação: admin cria empresas e primeiros gerentes\n");

  const adm = await login("admin@plataforma.test", SENHA);
  assert(adm.cookie, "admin deveria logar");
  const gerentes = {};
  for (const [emp, email, cpf] of [["Empresa Alfa", "gerente.alfa@test.com", cpfs[0]], ["Empresa Beta", "gerente.beta@test.com", cpfs[1]]]) {
    const r = await http("POST", "/api/admin/empresas", { cookie: adm.cookie, corpo: { nome: emp, emailGerente: email } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    const c = await http("POST", "/cadastrar", { corpo: { codigo: codigoDoEmail(email), ...dados(email, cpf, { nome: "Gerente " + emp.split(" ")[1] + " Souza" }) } });
    assert.strictEqual(c.status, 201, JSON.stringify(c.dados));
    gerentes[emp] = await login(email, SENHA);
    assert(gerentes[emp].cookie, "gerente deveria logar");
  }
  const gA = gerentes["Empresa Alfa"].cookie, gB = gerentes["Empresa Beta"].cookie;
  const [[empA]] = await pool.query("SELECT id FROM empresas WHERE nome='Empresa Alfa'");

  async function convidar(cookie, email) {
    const r = await http("POST", "/api/convites", { cookie, corpo: { email } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    return codigoDoEmail(email);
  }

  console.log("\nCenários");
  limite._baldes.clear();
  const codigo1 = await convidar(gA, "ana@alfa.test");
  await t("1. Convite válido permite iniciar cadastro", async () => {
    const r = await http("POST", "/api/convites/validar", { corpo: { codigo: codigo1 } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.dados.empresa, "Empresa Alfa"); assert.strictEqual(r.dados.email, "ana@alfa.test");
  });

  await t("2. Convite expirado é recusado (validação e cadastro)", async () => {
    const c = await convidar(gA, "expirado@alfa.test");
    await pool.query("UPDATE convites SET expira_em = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR) WHERE email='expirado@alfa.test'");
    assert.strictEqual((await http("POST", "/api/convites/validar", { corpo: { codigo: c } })).status, 400);
    assert.strictEqual((await http("POST", "/cadastrar", { corpo: { codigo: c, ...dados("expirado@alfa.test", cpfs[2]) } })).status, 400);
    const [[u]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE email='expirado@alfa.test'"); assert.strictEqual(u.n, 0);
  });

  await t("4. E-mail diferente do convite é recusado e convite continua pendente", async () => {
    const r = await http("POST", "/cadastrar", { corpo: { codigo: codigo1, ...dados("outra@pessoa.test", cpfs[2]) } });
    assert.strictEqual(r.status, 422); assert(r.dados.campos.email);
    const [[c]] = await pool.query("SELECT status FROM convites WHERE email='ana@alfa.test'"); assert.strictEqual(c.status, "PENDENTE");
  });

  await t("Campos inválidos (CPF, senha, confirmação) são recusados no servidor", async () => {
    const r = await http("POST", "/cadastrar", { corpo: { codigo: codigo1, ...dados("ana@alfa.test", "11111111111", { senha: "fraca", confirmarSenha: "outra" }) } });
    assert.strictEqual(r.status, 422); assert(r.dados.campos.cpf); assert(r.dados.campos.senha); assert(r.dados.campos.confirmarSenha);
  });

  await t("6. Cadastro concluído fica PENDENTE (empresa do convite; nivel/empresa do navegador ignorados)", async () => {
    const r = await http("POST", "/cadastrar", { corpo: { codigo: codigo1, ...dados("ana@alfa.test", cpfs[2]), empresa: "Empresa Beta", nivel: "gerente", status: "ativo", empresa_id: 999 } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    const [[u]] = await pool.query("SELECT status, nivel, empresa_id, senha_hash FROM usuarios WHERE email='ana@alfa.test'");
    assert.strictEqual(u.status, "pendente"); assert.strictEqual(u.nivel, null); assert.strictEqual(u.empresa_id, empA.id);
    assert(u.senha_hash.startsWith("scrypt$"));
    const [[s]] = await pool.query("SELECT status FROM solicitacoes_cadastro s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email='ana@alfa.test'");
    assert.strictEqual(s.status, "PENDENTE");
  });

  await t("3. Convite utilizado não pode ser reutilizado", async () => {
    assert.strictEqual((await http("POST", "/api/convites/validar", { corpo: { codigo: codigo1 } })).status, 400);
    assert.strictEqual((await http("POST", "/cadastrar", { corpo: { codigo: codigo1, ...dados("ana@alfa.test", cpfs[3]) } })).status, 400);
  });

  await t("Dois cadastros simultâneos com o mesmo convite: só um passa", async () => {
    const c = await convidar(gA, "corrida@alfa.test");
    const rs = await Promise.all([1, 2, 3].map((i) => http("POST", "/cadastrar", { corpo: { codigo: c, ...dados("corrida@alfa.test", cpfs[3]) } })));
    assert.strictEqual(rs.filter((r) => r.status === 201).length, 1, JSON.stringify(rs.map((r) => r.status)));
    const [[n]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE email='corrida@alfa.test'"); assert.strictEqual(n.n, 1);
  });

  await t("5. CPF duplicado: recusado com mensagem genérica, nada gravado, convite continua pendente", async () => {
    const c = await convidar(gA, "dupcpf@alfa.test");
    const r = await http("POST", "/cadastrar", { corpo: { codigo: c, ...dados("dupcpf@alfa.test", cpfs[2]) } }); // CPF da Ana
    assert.strictEqual(r.status, 409); assert(!/cpf/i.test(r.dados.erro));
    const [[u]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE email='dupcpf@alfa.test'"); assert.strictEqual(u.n, 0);
    const [[cv]] = await pool.query("SELECT status FROM convites WHERE email='dupcpf@alfa.test'"); assert.strictEqual(cv.status, "PENDENTE");
    const ok2 = await http("POST", "/cadastrar", { corpo: { codigo: c, ...dados("dupcpf@alfa.test", cpfs[4]) } });
    assert.strictEqual(ok2.status, 201); // com CPF correto, o mesmo convite ainda funciona
  });

  await t("7. Usuário pendente não consegue acessar áreas protegidas", async () => {
    const l = await login("ana@alfa.test", SENHA);
    assert.strictEqual(l.cookie, null); assert(/erro=pendente/.test(l.loc));
    assert.strictEqual((await http("GET", "/api/me")).status, 401);
    assert.strictEqual((await http("GET", "/api/maquinas")).status, 401);
    assert.strictEqual((await http("GET", "/api/me", { cookie: "lumasat_sid=" + "A".repeat(43) })).status, 401);
    const d = await http("GET", "/dashboard"); assert.strictEqual(d.status, 302); assert(/login/.test(d.loc));
  });

  const [[solAna]] = await pool.query("SELECT s.id FROM solicitacoes_cadastro s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email='ana@alfa.test'");
  await t("8/11. Gerente aprova funcionário da própria empresa; usuário recebe o cargo escolhido", async () => {
    const r = await http("POST", `/api/solicitacoes/${solAna.id}/aprovar`, { cookie: gA, corpo: { cargo: "tecnico" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const [[u]] = await pool.query("SELECT status, nivel, aprovado_por, aprovado_em FROM usuarios WHERE email='ana@alfa.test'");
    assert.strictEqual(u.status, "ativo"); assert.strictEqual(u.nivel, "tecnico"); assert(u.aprovado_por && u.aprovado_em);
    const [[s]] = await pool.query("SELECT status, cargo_atribuido, decidido_por FROM solicitacoes_cadastro WHERE id=?", [solAna.id]);
    assert.strictEqual(s.status, "APROVADA"); assert.strictEqual(s.cargo_atribuido, "tecnico"); assert(s.decidido_por);
    const l = await login("ana@alfa.test", SENHA); assert(l.cookie);
    const me = await http("GET", "/api/me", { cookie: l.cookie }); assert.strictEqual(me.dados.nivel, "tecnico");
    assert(!("cpf" in me.dados));
  });

  await t("Aprovar de novo a mesma solicitação retorna 409", async () => {
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solAna.id}/aprovar`, { cookie: gA, corpo: { cargo: "operador" } })).status, 409);
  });

  const cRej = await convidar(gA, "rejeitado@alfa.test");
  await http("POST", "/cadastrar", { corpo: { codigo: cRej, ...dados("rejeitado@alfa.test", cpfs[5]) } });
  const [[solRej]] = await pool.query("SELECT s.id FROM solicitacoes_cadastro s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email='rejeitado@alfa.test'");

  await t("9. Gerente de OUTRA empresa não consegue ver, aprovar ou rejeitar (404)", async () => {
    assert.strictEqual((await http("GET", `/api/solicitacoes/${solRej.id}`, { cookie: gB })).status, 404);
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solRej.id}/aprovar`, { cookie: gB, corpo: { cargo: "operador" } })).status, 404);
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solRej.id}/rejeitar`, { cookie: gB, corpo: { motivo: "teste de isolamento" } })).status, 404);
    const [[u]] = await pool.query("SELECT status FROM usuarios WHERE email='rejeitado@alfa.test'"); assert.strictEqual(u.status, "pendente");
    const lista = await http("GET", "/api/solicitacoes?status=PENDENTE", { cookie: gB }); assert.strictEqual(lista.dados.length, 0);
  });

  await t("Rejeitar exige motivo; cargo inválido (gerente/admin) é recusado na aprovação", async () => {
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solRej.id}/rejeitar`, { cookie: gA, corpo: { motivo: "x" } })).status, 400);
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solRej.id}/aprovar`, { cookie: gA, corpo: { cargo: "gerente" } })).status, 400);
    assert.strictEqual((await http("POST", `/api/solicitacoes/${solRej.id}/aprovar`, { cookie: gA, corpo: { cargo: "administrador" } })).status, 400);
  });

  await t("10/12. Gerente rejeita; usuário rejeitado não acessa o sistema", async () => {
    const r = await http("POST", `/api/solicitacoes/${solRej.id}/rejeitar`, { cookie: gA, corpo: { motivo: "Documentação incompleta" } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    const [[u]] = await pool.query("SELECT status, nivel FROM usuarios WHERE email='rejeitado@alfa.test'");
    assert.strictEqual(u.status, "rejeitado"); assert.strictEqual(u.nivel, null);
    const [[s]] = await pool.query("SELECT status, motivo, decidido_por FROM solicitacoes_cadastro WHERE id=?", [solRej.id]);
    assert.strictEqual(s.status, "REJEITADA"); assert.strictEqual(s.motivo, "Documentação incompleta"); assert(s.decidido_por);
    const l = await login("rejeitado@alfa.test", SENHA); assert.strictEqual(l.cookie, null); assert(/erro=rejeitado/.test(l.loc));
  });

  await t("Histórico lista só decisões da própria empresa", async () => {
    const h = await http("GET", "/api/solicitacoes/historico", { cookie: gA });
    assert.strictEqual(h.status, 200); assert(h.dados.itens.some((i) => i.status === "APROVADA")); assert(h.dados.itens.some((i) => i.status === "REJEITADA"));
    assert.strictEqual((await http("GET", "/api/solicitacoes/historico", { cookie: gB })).dados.itens.filter((i) => /alfa/.test(i.email)).length, 0);
  });

  await t("Candidato rejeitado pode receber novo convite e reaproveita o mesmo usuário", async () => {
    const c = await convidar(gA, "rejeitado@alfa.test");
    const r = await http("POST", "/cadastrar", { corpo: { codigo: c, ...dados("rejeitado@alfa.test", cpfs[5]) } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    const [[n]] = await pool.query("SELECT COUNT(*) n FROM usuarios WHERE email='rejeitado@alfa.test'"); assert.strictEqual(n.n, 1);
    const [[s]] = await pool.query("SELECT COUNT(*) n FROM solicitacoes_cadastro s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email='rejeitado@alfa.test'");
    assert.strictEqual(s.n, 2); // histórico anterior preservado
  });

  await t("Gerente não decide o próprio cadastro (403)", async () => {
    const [[sg]] = await pool.query("SELECT s.id FROM solicitacoes_cadastro s JOIN usuarios u ON u.id=s.usuario_id WHERE u.email='gerente.alfa@test.com'");
    assert.strictEqual((await http("POST", `/api/solicitacoes/${sg.id}/aprovar`, { cookie: gA, corpo: { cargo: "operador" } })).status, 403);
  });

  await t("Convites: gerente só vê e cancela convites da própria empresa", async () => {
    const c = await convidar(gA, "cancelar@alfa.test");
    const [[cv]] = await pool.query("SELECT id FROM convites WHERE email='cancelar@alfa.test'");
    assert.strictEqual((await http("POST", `/api/convites/${cv.id}/cancelar`, { cookie: gB })).status, 404);
    assert((await http("GET", "/api/convites", { cookie: gB })).dados.every((x) => !/alfa/.test(x.email)));
    assert.strictEqual((await http("POST", `/api/convites/${cv.id}/cancelar`, { cookie: gA })).status, 200);
    assert.strictEqual((await http("POST", "/api/convites/validar", { corpo: { codigo: c } })).status, 400); // cancelado
  });

  await t("Convite: um único pendente por e-mail e empresa; quem já tem conta não é convidado", async () => {
    await convidar(gA, "unico@alfa.test");
    assert.strictEqual((await http("POST", "/api/convites", { cookie: gA, corpo: { email: "unico@alfa.test" } })).status, 409);
    assert.strictEqual((await http("POST", "/api/convites", { cookie: gA, corpo: { email: "ana@alfa.test" } })).status, 409);
  });

  await t("Código do convite só existe como hash no banco", async () => {
    const [rows] = await pool.query("SELECT codigo_hash FROM convites");
    for (const r of rows) assert(/^[0-9a-f]{64}$/.test(r.codigo_hash));
    assert(!JSON.stringify(rows).includes(codigoDoEmail("unico@alfa.test")));
  });

  await t("Permissões: técnico/operador/supervisor não criam convites nem aprovam", async () => {
    const tec = await login("ana@alfa.test", SENHA);
    assert.strictEqual((await http("POST", "/api/convites", { cookie: tec.cookie, corpo: { email: "x@y.test" } })).status, 403);
    assert.strictEqual((await http("GET", "/api/solicitacoes", { cookie: tec.cookie })).status, 403);
    assert.strictEqual((await http("POST", "/api/admin/empresas", { cookie: gA, corpo: { nome: "X", emailGerente: "x@y.test" } })).status, 403);
  });

  await t("13. E-mails: convite, aguardando, novo pedido ao gerente, aprovação e rejeição", async () => {
    assert(ultimoEmail("ana@alfa.test", "Convite").html.includes("#convite="));
    assert(ultimoEmail("ana@alfa.test", "aguardando"));
    assert(ultimoEmail("gerente.alfa@test.com", "Novo pedido"));
    assert(ultimoEmail("ana@alfa.test", "aprovado").texto.includes("Técnico"));
    assert(ultimoEmail("rejeitado@alfa.test", "não foi aprovado").texto.includes("Documentação incompleta"));
    const [rows] = await pool.query("SELECT status FROM emails_log"); assert(rows.length > 5 && rows.every((r) => r.status === "ENVIADO"));
    // (envio real pelo Brevo NÃO é coberto aqui: depende da chave do provedor)
  });

  await t("14. Isolamento de dados das máquinas entre empresas", async () => {
    const a = await http("GET", "/api/maquinas", { cookie: gA }), b = await http("GET", "/api/maquinas", { cookie: gB });
    assert(a.dados.maquinas.length > 0 && a.dados.maquinas.every((m) => m.empresa === "Empresa Alfa"));
    assert(b.dados.maquinas.every((m) => m.empresa === "Empresa Beta"));
    // Beta tenta alterar máquina da Alfa pelo nome: não pode mexer na da Alfa
    const antes = JSON.stringify(JSON.parse(fs.readFileSync(tmpMaq, "utf8")).filter((m) => m.empresa === "Empresa Alfa"));
    await http("POST", "/api/maquinas", { cookie: gB, corpo: { nome: "Máquina CNC 01", status: "ativa", operacao: true, empresa: "Empresa Alfa" } });
    const depois = JSON.stringify(JSON.parse(fs.readFileSync(tmpMaq, "utf8")).filter((m) => m.empresa === "Empresa Alfa"));
    assert.strictEqual(antes, depois);
    assert.strictEqual(adm.cookie && (await http("GET", "/api/maquinas", { cookie: adm.cookie })).dados.total, 0);
  });

  await t("15. Funcionalidades antigas: listar, ligar/desligar e cadastrar máquina conforme o cargo", async () => {
    const tec = await login("ana@alfa.test", SENHA);
    const lig = await http("POST", "/api/maquinas", { cookie: tec.cookie, corpo: { nome: "Máquina CNC 01", status: "ativa", operacao: true } });
    assert.strictEqual(lig.status, 200);
    assert.strictEqual((await http("GET", "/api/maquinas", { cookie: tec.cookie })).dados.maquinas.find((m) => m.nome === "Máquina CNC 01").status, "ativa");
    assert.strictEqual((await http("POST", "/api/maquinas", { cookie: tec.cookie, corpo: { nome: "Nova do Técnico" } })).status, 403);
    const nova = await http("POST", "/api/maquinas", { cookie: gA, corpo: { nome: "Nova Máquina 99", modelo: "M1", numSerie: "S1", empresa: "Empresa Beta" } });
    assert.strictEqual(nova.status, 200);
    const salva = JSON.parse(fs.readFileSync(tmpMaq, "utf8")).find((m) => m.nome === "Nova Máquina 99");
    assert.strictEqual(salva.empresa, "Empresa Alfa"); // empresa vem da sessão
    assert.strictEqual((await http("GET", "/maquinas.json")).status, 404); // não é mais público
    assert.strictEqual((await http("GET", "/api/usuario?email=ana@alfa.test")).status, 404);
    for (const p of ["/", "/login.html", "/cadastrar.html", "/index.html"]) assert.strictEqual((await http("GET", p)).status, 200, p);
    const dash = await fetch(base + "/dashboard", { headers: { cookie: tec.cookie } }); assert.strictEqual(dash.status, 200);
    const out = await http("POST", "/api/logout", { cookie: tec.cookie }); assert.strictEqual(out.status, 200);
    assert.strictEqual((await http("GET", "/api/me", { cookie: tec.cookie })).status, 401);
  });

  await t("Usuário suspenso perde a sessão já autorizada na hora", async () => {
    const l = await login("ana@alfa.test", SENHA);
    assert.strictEqual((await http("GET", "/api/me", { cookie: l.cookie })).status, 200);
    await pool.query("UPDATE usuarios SET status='inativo' WHERE email='ana@alfa.test'");
    assert.strictEqual((await http("GET", "/api/me", { cookie: l.cookie })).status, 401);
    assert.strictEqual((await http("GET", "/api/maquinas", { cookie: l.cookie })).status, 401);
    await pool.query("UPDATE usuarios SET status='ativo' WHERE email='ana@alfa.test'");
    assert.strictEqual((await http("GET", "/api/me", { cookie: l.cookie })).status, 401); // sessões foram revogadas
  });

  await t("Rebaixar o cargo vale na hora (cargo é lido do banco a cada requisição)", async () => {
    const l = await login("ana@alfa.test", SENHA);
    await pool.query("UPDATE usuarios SET nivel='operador' WHERE email='ana@alfa.test'");
    assert.strictEqual((await http("POST", "/api/maquinas", { cookie: l.cookie, corpo: { nome: "Máquina CNC 01", status: "inativa", operacao: false } })).status, 403);
  });

  await t("Senha errada e e-mail inexistente dão o mesmo resultado; bloqueio após tentativas", async () => {
    limite._baldes.clear();
    const a = await login("ana@alfa.test", "errada"), b = await login("naoexiste@x.test", "errada");
    assert.strictEqual(a.loc, b.loc);
    for (let i = 0; i < 6; i++) await login("ana@alfa.test", "errada");
    const bloq = await login("ana@alfa.test", SENHA);
    assert(/bloqueado/.test(bloq.loc) && !bloq.cookie);
  });

  await t("Limite de tentativas na validação de códigos (429 após 10)", async () => {
    limite._baldes.clear();
    let ultimo;
    for (let i = 0; i < 11; i++) ultimo = await http("POST", "/api/convites/validar", { corpo: { codigo: "A".repeat(43) } });
    assert.strictEqual(ultimo.status, 429);
  });

  await t("Auditoria registra ações importantes sem dados sensíveis", async () => {
    const [rows] = await pool.query("SELECT DISTINCT acao FROM auditoria"); const acoes = rows.map((r) => r.acao);
    for (const a of ["login_ok", "login_falha", "convite_criado", "cadastro_concluido", "solicitacao_aprovada", "solicitacao_rejeitada", "acesso_negado", "convite_cancelado"]) assert(acoes.includes(a), "falta " + a);
    const [todos] = await pool.query("SELECT detalhes FROM auditoria");
    const txt = JSON.stringify(todos);
    assert(!txt.includes(SENHA)); for (const c of cpfs) assert(!txt.includes(c));
  });

  console.log(`\n${ok} passaram, ${falhas} falharam`);
  server.close(); await pool.end(); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("Erro na preparação:", e); process.exit(1); });
