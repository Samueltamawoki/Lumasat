const { escapeHtml } = require("./seguranca");

// Modos: "console" (imprime), "capturar" (guarda em memória, usado nos testes) e "brevo" (API HTTP real).
const caixa = []; // e-mails capturados no modo "capturar"

function modo() { return process.env.EMAIL_MODO || "console"; }

async function enviarBruto({ para, assunto, html, texto }) {
  const m = modo();
  if (m === "capturar") { caixa.push({ para, assunto, html, texto }); return; }
  if (m === "console") {
    console.log(`\n📧 [E-MAIL - modo console] Para: ${para}\nAssunto: ${assunto}\n${texto}\n`);
    return;
  }
  if (m === "brevo") {
    if (!process.env.BREVO_API_KEY || !process.env.EMAIL_REMETENTE) {
      throw new Error("BREVO_API_KEY ou EMAIL_REMETENTE não configurados");
    }
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: process.env.EMAIL_REMETENTE_NOME || "LumaSat", email: process.env.EMAIL_REMETENTE },
        to: [{ email: para }],
        subject: assunto,
        htmlContent: html,
        textContent: texto
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) throw new Error(`Provedor de e-mail respondeu ${resp.status}`);
    return;
  }
  throw new Error(`EMAIL_MODO inválido: ${m}`);
}

// Envia e registra o resultado em emails_log. Retorna true/false (nunca lança).
async function enviar(db, tipo, mensagem) {
  let ok = true, erro = null;
  try { await enviarBruto(mensagem); } catch (e) { ok = false; erro = String(e.message).slice(0, 300); }
  try {
    await db.query("INSERT INTO emails_log (tipo, destinatario, assunto, status, erro) VALUES (?,?,?,?,?)",
      [tipo, mensagem.para, mensagem.assunto.slice(0, 200), ok ? "ENVIADO" : "FALHOU", erro]);
  } catch { /* log de e-mail não pode derrubar o fluxo */ }
  if (!ok) console.error(`Falha ao enviar e-mail (${tipo}):`, erro);
  return ok;
}

// ---------- Modelos ----------
function moldura(titulo, corpoHtml, botao) {
  const btn = botao ? `<p style="margin:24px 0"><a href="${escapeHtml(botao.url)}" style="background:#1a237e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700">${escapeHtml(botao.texto)}</a></p>` : "";
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
<h2 style="color:#1a237e">LumaSat</h2><h3>${escapeHtml(titulo)}</h3>${corpoHtml}${btn}
<p style="font-size:12px;color:#64748b">Se você não esperava este e-mail, ignore-o.</p></div>`;
}

function modeloConvite({ empresa, convidadoPor, link, codigo, validadeDias }) {
  return {
    assunto: `Convite para ${empresa} no LumaSat`,
    html: moldura(`Você foi convidado(a) para ${empresa}`,
      `<p><b>${escapeHtml(convidadoPor)}</b> convidou você para entrar na equipe de <b>${escapeHtml(empresa)}</b> no LumaSat.</p>
<p>Clique no botão, confira os dados e preencha o cadastro. Depois, o gerente precisará aprovar seu acesso.</p>
<p>Este convite vale por <b>${validadeDias} dias</b> e só pode ser usado uma vez, com este e-mail.</p>
<p style="font-size:13px">Se o botão não funcionar, abra a página de cadastro e informe o código:<br><code style="font-size:14px">${escapeHtml(codigo)}</code></p>`,
      { url: link, texto: "Começar cadastro" }),
    texto: `${convidadoPor} convidou você para ${empresa} no LumaSat.\nAbra: ${link}\nOu informe o código: ${codigo}\nValidade: ${validadeDias} dias. Uso único. Depois do cadastro, o gerente precisa aprovar seu acesso.`
  };
}

function modeloAguardando({ nome, empresa, dataHora }) {
  return {
    assunto: "Cadastro recebido - aguardando aprovação",
    html: moldura("Cadastro recebido",
      `<p>Olá, ${escapeHtml(nome)}!</p><p>Recebemos seu pedido de cadastro em <b>${escapeHtml(empresa)}</b> em ${escapeHtml(dataHora)} (horário de Brasília).</p>
<p>O gerente da empresa vai analisar o pedido. Você receberá outro e-mail com a decisão. Até lá, o acesso à plataforma continua bloqueado.</p>`),
    texto: `Olá, ${nome}! Recebemos seu cadastro em ${empresa} em ${dataHora}. Aguarde a aprovação do gerente; você receberá outro e-mail com a decisão.`
  };
}

function modeloNovoPedido({ gerente, candidato, empresa, dataHora, link }) {
  return {
    assunto: "Novo pedido de cadastro para analisar",
    html: moldura("Novo pedido de cadastro",
      `<p>Olá, ${escapeHtml(gerente)}!</p><p><b>${escapeHtml(candidato)}</b> concluiu o cadastro em <b>${escapeHtml(empresa)}</b> em ${escapeHtml(dataHora)} e aguarda sua decisão.</p>`,
      { url: link, texto: "Abrir o LumaSat" }),
    texto: `${candidato} concluiu o cadastro em ${empresa} em ${dataHora} e aguarda sua decisão. Entre em ${link}`
  };
}

const NOMES_CARGO = { supervisor: "Supervisor", tecnico: "Técnico", operador: "Operador", gerente: "Gerente" };

function modeloAprovado({ nome, empresa, cargo, link }) {
  return {
    assunto: "Seu cadastro foi aprovado",
    html: moldura("Cadastro aprovado",
      `<p>Olá, ${escapeHtml(nome)}!</p><p>Seu acesso a <b>${escapeHtml(empresa)}</b> foi aprovado com o cargo de <b>${NOMES_CARGO[cargo] || escapeHtml(cargo)}</b>.</p>`,
      { url: link, texto: "Entrar no LumaSat" }),
    texto: `Olá, ${nome}! Seu acesso a ${empresa} foi aprovado como ${NOMES_CARGO[cargo] || cargo}. Entre em ${link}`
  };
}

function modeloRejeitado({ nome, empresa, motivo }) {
  return {
    assunto: "Seu cadastro não foi aprovado",
    html: moldura("Cadastro não aprovado",
      `<p>Olá, ${escapeHtml(nome)}.</p><p>Seu pedido de cadastro em <b>${escapeHtml(empresa)}</b> não foi aprovado.</p>
<p><b>Motivo informado pelo gerente:</b><br>${escapeHtml(motivo)}</p><p>Em caso de dúvida, fale com o gerente da sua empresa.</p>`),
    texto: `Olá, ${nome}. Seu cadastro em ${empresa} não foi aprovado.\nMotivo: ${motivo}\nEm caso de dúvida, fale com o gerente da sua empresa.`
  };
}

module.exports = {
  enviar, caixa, modeloConvite, modeloAguardando, modeloNovoPedido, modeloAprovado, modeloRejeitado
};
