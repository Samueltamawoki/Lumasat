// Testes de unidade (não precisam de banco nem de rede):  node tests/unidade.js
const assert = require("assert");
const V = require("../lib/validacoes");
const S = require("../lib/seguranca");
const L = require("../lib/limite");
const mail = require("../lib/email");

let ok = 0, falhas = 0;
async function t(nome, fn) {
  try { await fn(); ok++; console.log("  PASSOU  ", nome); }
  catch (e) { falhas++; console.log("  FALHOU  ", nome, "\n          ", e.message); }
}

(async () => {
  console.log("Validações");
  await t("CPF válido aceito (com e sem máscara)", () => { assert(V.cpfValido("529.982.247-25")); assert(V.cpfValido("52998224725")); });
  await t("CPF com dígito verificador errado recusado", () => assert(!V.cpfValido("529.982.247-26")));
  await t("CPF com sequência repetida recusado", () => { assert(!V.cpfValido("111.111.111-11")); assert(!V.cpfValido("00000000000")); });
  await t("CPF com tamanho errado recusado", () => { assert(!V.cpfValido("123")); assert(!V.cpfValido("")); });
  await t("nome precisa de nome e sobrenome e só letras", () => {
    assert(V.nomeValido("Maria da Silva")); assert(V.nomeValido("João D'Ávila-Souza"));
    assert(!V.nomeValido("Maria")); assert(!V.nomeValido("Maria 123 Silva")); assert(!V.nomeValido("<b>Ana</b> Souza"));
  });
  const hoje = new Date(Date.UTC(2026, 10, 13));
  await t("nascimento: data real, não futura, idade mínima 18", () => {
    assert(V.nascimentoValido("1990-05-10", { hoje }));
    assert(!V.nascimentoValido("2030-01-01", { hoje }));
    assert(!V.nascimentoValido("2010-01-01", { hoje }));          // 16 anos
    assert(V.nascimentoValido("2008-11-13", { hoje }));           // exatamente 18 hoje
    assert(!V.nascimentoValido("2008-11-14", { hoje }));          // faltam 1 dia
    assert(!V.nascimentoValido("1990-02-30", { hoje }));          // data inexistente
    assert(!V.nascimentoValido("10/05/1990", { hoje }));
  });
  await t("telefone brasileiro: DDD válido, 9º dígito no celular", () => {
    assert(V.telefoneValido("(11) 98765-4321")); assert(V.telefoneValido("1134567890"));
    assert(!V.telefoneValido("(00) 98765-4321")); assert(!V.telefoneValido("11887654321")); assert(!V.telefoneValido("123"));
  });
  await t("senha fraca recusada e forte aceita", () => {
    assert(V.validarSenha("abc").length > 0);
    assert(V.validarSenha("senhasemmaiuscula1").length > 0);
    assert(V.validarSenha("SENHASEMMINUSCULA1").length > 0);
    assert(V.validarSenha("SemNumeroNenhum").length > 0);
    assert(V.validarSenha("Password1").length > 0);
    assert(V.validarSenha("x".repeat(129) + "Aa1").length > 0);
    assert.deepStrictEqual(V.validarSenha("Tr0ca-Isso-Ja"), []);
  });
  await t("senha não pode conter nome nem e-mail", () => {
    assert(V.validarSenha("Mariana2026X", { nome: "Mariana Souza" }).length > 0);
    assert(V.validarSenha("Joaozinho99A", { email: "joaozinho@x.com" }).length > 0);
  });
  await t("e-mail normalizado e validado", () => {
    assert.strictEqual(V.normalizarEmail("  Ana@Empresa.COM "), "ana@empresa.com");
    assert(V.emailValido("a@b.co")); assert(!V.emailValido("a@b")); assert(!V.emailValido("sem arroba"));
  });
  await t("CPF mascarado não revela os 11 dígitos", () => {
    const m = V.mascararCpf("52998224725");
    assert.strictEqual(m, "***.982.247-**"); assert(!m.includes("52998224725"));
  });

  console.log("Segurança");
  await t("hash scrypt verifica a senha certa e recusa a errada", async () => {
    const h = await S.hashSenha("Tr0ca-Isso-Ja");
    assert(h.startsWith("scrypt$")); assert(!h.includes("Tr0ca-Isso-Ja"));
    assert(await S.verificarSenha("Tr0ca-Isso-Ja", h)); assert(!(await S.verificarSenha("outra", h)));
  });
  await t("hashes da mesma senha são diferentes (salt)", async () => {
    assert.notStrictEqual(await S.hashSenha("Abc12345x"), await S.hashSenha("Abc12345x"));
  });
  await t("verificarSenha com hash inválido/texto puro retorna false", async () => {
    assert.strictEqual(await S.verificarSenha("123", "123"), false);
    assert.strictEqual(await S.verificarSenha("123", null), false);
  });
  await t("token: 256 bits, formato válido, hash SHA-256 determinístico", () => {
    const a = S.gerarToken(), b = S.gerarToken();
    assert(S.tokenComFormatoValido(a)); assert.notStrictEqual(a, b);
    assert.strictEqual(S.hashToken(a).length, 64); assert.strictEqual(S.hashToken(a), S.hashToken(a));
    assert(!S.hashToken(a).includes(a));
    assert(!S.tokenComFormatoValido("curto")); assert(!S.tokenComFormatoValido("' OR 1=1 --"));
  });
  await t("escapeHtml neutraliza HTML", () => assert.strictEqual(S.escapeHtml('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;"));
  await t("data exibida em horário de Brasília", () => {
    assert(S.formatarBrasilia("2026-11-13T02:30:00Z").includes("12/11/2026")); // 23:30 do dia anterior em Brasília
  });

  console.log("Limite de tentativas");
  await t("bloqueia após o máximo na janela e libera ao zerar", () => {
    const o = { max: 3, janelaMs: 60000 };
    assert(L.consumir("k1", o).permitido); assert(L.consumir("k1", o).permitido); assert(L.consumir("k1", o).permitido);
    assert(!L.consumir("k1", o).permitido);
    assert(L.consumir("k2", o).permitido); // outra chave não é afetada
    L.zerar("k1"); assert(L.consumir("k1", o).permitido);
  });

  console.log("E-mails");
  await t("modelo de convite traz empresa, link, código e validade; escapa HTML", () => {
    const m = mail.modeloConvite({ empresa: "<b>X</b>", convidadoPor: "Ana", link: "http://l/#convite=ABC", codigo: "ABC", validadeDias: 7 });
    assert(m.html.includes("&lt;b&gt;X")); assert(m.html.includes("#convite=ABC")); assert(m.texto.includes("7 dias"));
  });
  await t("e-mail de aguardando aprovação não contém senha nem CPF", () => {
    const m = mail.modeloAguardando({ nome: "Ana Souza", empresa: "Alfa", dataHora: "13/11/26 10:00" });
    assert(!/senha|cpf/i.test(m.texto.replace(/aprovação/gi, "")));
  });
  await t("e-mail de rejeição inclui o motivo", () => {
    assert(mail.modeloRejeitado({ nome: "A B", empresa: "Alfa", motivo: "Documento ilegível" }).texto.includes("Documento ilegível"));
  });

  console.log(`\n${ok} passaram, ${falhas} falharam`);
  process.exit(falhas ? 1 : 0);
})();
