const mysql = require("mysql2");

// Criação de um Pool de conexões resiliente
const pool = mysql.createPool({
    host: process.env.DB_HOST || "mysql-27f0249b-samuelsenai1092-088b.d.aivencloud.com",
    port: process.env.DB_PORT || 16820,
    user: process.env.DB_USER || "avnadmin",
    password: process.env.DB_PASSWORD || "AVNS_F1UVG7prpJ5ui0IUBrh",
    database: process.env.DB_NAME || "lumasat",
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Validação inicial da ligação
pool.getConnection((err, connection) => {
    if (err) {
        console.error("Erro ao ligar ao MySQL no Aiven:", err.message);
    } else {
        console.log("Pool de conexões MySQL ligado ao Aiven com sucesso!");
        connection.release();
    }
});

module.exports = pool;