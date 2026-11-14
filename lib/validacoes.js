// Regras de validação (rodam no servidor; o navegador só repete para dar resposta rápida).

const SENHAS_COMUNS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "senha123", "senha1234",
  "qwerty123", "abc12345", "abcd1234", "admin123", "admin1234", "senha@123", "mudar123",
  "iloveyou1", "brasil123", "brasil2024", "brasil2025", "brasil2026", "lumasat123"
]);

const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99
]);

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

function normalizarEmail(v) {
  return String(v ?? "").trim().toLowerCase();
}

function emailValido(v) {
  const e = normalizarEmail(v);
  return e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

function cpfValido(v) {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9)) === Number(c[9]) && dv(c.slice(0, 10)) === Number(c[10]);
}

// Pelo menos nome e sobrenome; só letras, acentos, espaço, hífen e apóstrofo.
function nomeValido(v) {
  const n = String(v ?? "").trim().replace(/\s+/g, " ");
  if (n.length < 5 || n.length > 120) return false;
  if (!/^[\p{L}][\p{L} '\-]*$/u.test(n)) return false;
  return n.split(" ").filter((p) => p.length >= 1).length >= 2;
}

function normalizarNome(v) {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

// Data AAAA-MM-DD real, não futura, idade mínima (padrão 18) e máxima 120.
function nascimentoValido(v, { idadeMinima = 18, hoje = new Date() } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""));
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(a, me - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== d) return false;
  const hojeUTC = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  if (dt > hojeUTC) return false;
  let idade = hojeUTC.getUTCFullYear() - a;
  if (hojeUTC.getUTCMonth() < me - 1 || (hojeUTC.getUTCMonth() === me - 1 && hojeUTC.getUTCDate() < d)) idade--;
  return idade >= idadeMinima && idade <= 120;
}

// Telefone brasileiro: DDD válido; 11 dígitos (celular com 9) ou 10 (fixo, começa com 2-5).
function telefoneValido(v) {
  const t = soDigitos(v);
  if (![10, 11].includes(t.length)) return false;
  if (!DDDS_VALIDOS.has(Number(t.slice(0, 2)))) return false;
  if (t.length === 11) return t[2] === "9";
  return /[2-5]/.test(t[2]);
}

// Retorna lista de problemas (vazia = senha aceita).
function validarSenha(senha, { nome = "", email = "" } = {}) {
  const s = String(senha ?? "");
  const erros = [];
  if (s.length < 8) erros.push("Mínimo de 8 caracteres");
  if (s.length > 128) erros.push("Máximo de 128 caracteres");
  if (!/[a-z]/.test(s)) erros.push("Pelo menos uma letra minúscula");
  if (!/[A-Z]/.test(s)) erros.push("Pelo menos uma letra maiúscula");
  if (!/\d/.test(s)) erros.push("Pelo menos um número");
  const baixa = s.toLowerCase();
  if (SENHAS_COMUNS.has(baixa) || /^(.)\1+$/.test(s)) erros.push("Senha muito comum");
  const partes = String(nome).toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
  const local = normalizarEmail(email).split("@")[0];
  if (partes.some((p) => baixa.includes(p)) || (local.length >= 3 && baixa.includes(local))) {
    erros.push("A senha não pode conter seu nome ou e-mail");
  }
  return erros;
}

function mascararCpf(cpf) {
  const c = soDigitos(cpf);
  return c.length === 11 ? `***.${c.slice(3, 6)}.${c.slice(6, 9)}-**` : "";
}

module.exports = {
  soDigitos, normalizarEmail, emailValido, cpfValido, nomeValido, normalizarNome,
  nascimentoValido, telefoneValido, validarSenha, mascararCpf
};
