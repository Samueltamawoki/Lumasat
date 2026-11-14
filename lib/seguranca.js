const crypto = require("crypto");

// ---------- Senhas: scrypt (nativo do Node) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(senha, salt, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(senha, salt, opts.keylen, { N: opts.N, r: opts.r, p: opts.p, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(senha), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verificarSenha(senha, armazenado) {
  try {
    const [alg, N, r, p, saltB64, keyB64] = String(armazenado || "").split("$");
    if (alg !== "scrypt") return false;
    const esperado = Buffer.from(keyB64, "base64");
    const obtido = await scryptAsync(String(senha), Buffer.from(saltB64, "base64"),
      { N: Number(N), r: Number(r), p: Number(p), keylen: esperado.length });
    return esperado.length === obtido.length && crypto.timingSafeEqual(esperado, obtido);
  } catch {
    return false;
  }
}

// Hash "falso" para gastar o mesmo tempo quando o e-mail não existe (evita enumeração por tempo).
let hashFalso;
async function gastarTempo(senha) {
  hashFalso = hashFalso || (await hashSenha("senha-falsa-para-igualar-tempo"));
  await verificarSenha(senha, hashFalso);
}

// ---------- Tokens (convites e sessões) ----------
function gerarToken() {
  return crypto.randomBytes(32).toString("base64url"); // 256 bits
}
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
function tokenComFormatoValido(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

// ---------- Cookies ----------
function lerCookies(req) {
  const out = {};
  for (const par of String(req.headers.cookie || "").split(";")) {
    const i = par.indexOf("=");
    if (i > 0) out[par.slice(0, i).trim()] = decodeURIComponent(par.slice(i + 1).trim());
  }
  return out;
}

// ---------- Datas ----------
function formatarBrasilia(data) {
  if (!data) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short"
  }).format(new Date(data));
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

module.exports = {
  hashSenha, verificarSenha, gastarTempo, gerarToken, hashToken, tokenComFormatoValido,
  lerCookies, formatarBrasilia, escapeHtml
};
