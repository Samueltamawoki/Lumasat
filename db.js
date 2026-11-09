const mysql = require("mysql2");

const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "lumasat",
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_HOST ? { rejectUnauthorized: false } : false
});

db.connect((err) => {
    if (err) {
        console.error("❌ Erro ao ligar ao MySQL:", err.message);
    } else {
        console.log("✅ Ligado à base de dados MySQL com sucesso!");
    }
});

module.exports = db;
