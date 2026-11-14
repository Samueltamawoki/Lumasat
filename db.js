require("./lib/env");
const mysql = require("mysql2");

// Nenhuma credencial fica no código: tudo vem de variáveis de ambiente (.env / Render).
const obrigatorias = ["DB_HOST", "DB_USER", "DB_NAME"];
const faltando = obrigatorias.filter((v) => !process.env[v]);
if (faltando.length) {
    console.error("Variáveis de ambiente do banco ausentes:", faltando.join(", "));
}

// SSL: se DB_SSL_CA (conteúdo do certificado CA do Aiven) existir, valida o certificado.
// Sem CA, mantém o comportamento anterior (sem verificação) e avisa.
let ssl;
if (process.env.DB_SSL === "false") {
    ssl = undefined;
} else if (process.env.DB_SSL_CA) {
    ssl = { ca: process.env.DB_SSL_CA.replace(/\\n/g, "\n"), rejectUnauthorized: true };
} else {
    ssl = { rejectUnauthorized: false };
    console.warn("AVISO: DB_SSL_CA não definido; certificado do banco NÃO está sendo verificado.");
}

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
    timezone: "Z",              // datas em UTC; exibição em Brasília é feita na apresentação
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

if (require.main !== module && process.env.NODE_ENV !== "test") {
    pool.getConnection((err, connection) => {
        if (err) {
            console.error("Erro ao ligar ao MySQL:", err.message);
        } else {
            console.log("Pool de conexões MySQL ligado com sucesso!");
            connection.release();
        }
    });
}

module.exports = pool;
