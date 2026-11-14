// Carrega o arquivo .env (se existir) sem depender de pacote externo. Variáveis já definidas no ambiente têm prioridade.
const fs = require("fs");
const path = require("path");
try {
  const txt = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
  for (const linha of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m || linha.trim().startsWith("#")) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* sem .env: usa o ambiente (Render) */ }
