// Limite de tentativas em memória (por chave). Suficiente para 1 instância (Render).
// Para várias instâncias seria necessário um armazenamento compartilhado.
const baldes = new Map();

function consumir(chave, { max, janelaMs }) {
  const agora = Date.now();
  let b = baldes.get(chave);
  if (!b || b.reinicia <= agora) b = { n: 0, reinicia: agora + janelaMs };
  b.n++;
  baldes.set(chave, b);
  return { permitido: b.n <= max, restanteMs: Math.max(0, b.reinicia - agora) };
}

function zerar(chave) { baldes.delete(chave); }

// Middleware: a chave inclui o IP (req.ip respeita "trust proxy").
function limitar(nome, { max, janelaMs, aoBloquear }) {
  return (req, res, next) => {
    const r = consumir(`${nome}:${req.ip}`, { max, janelaMs });
    if (r.permitido) return next();
    if (aoBloquear) aoBloquear(req);
    res.set("Retry-After", String(Math.ceil(r.restanteMs / 1000)));
    return res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
  };
}

function limparExpirados() {
  const agora = Date.now();
  for (const [k, b] of baldes) if (b.reinicia <= agora) baldes.delete(k);
}

module.exports = { consumir, zerar, limitar, limparExpirados, _baldes: baldes };
