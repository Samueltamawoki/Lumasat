const express = require("express");
const db = require("./db");
const path = require("path");
const fs = require("fs");

const app = express();

// Middlewares
app.use(express.json());
app.use(express.static("public", { extensions: ["html"] }));
app.use(express.urlencoded({ extended: true }));

// Função auxiliar para ler o ficheiro JSON
function lerMaquinas() {
    try {
        const data = fs.readFileSync("./public/maquinas.json", "utf8");
        return JSON.parse(data);
    } catch (err) {
        console.error("Erro ao ler maquinas.json:", err);
        return [];
    }
}

// =============================================================
// 📡 SIMULADOR DE DADOS DO FINDER OPTA (TODAS AS MÁQUISAS)
// =============================================================
function simularDadosContinuos() {
    let maquinas = lerMaquinas();

    if (maquinas.length === 0) return;

    // Percorre TODAS as máquinas da lista
    maquinas.forEach((m, indice) => {
        // Avalia se a máquina atual está LIGADA
        const estaLigada = m.operacao === true && m.status && m.status.toLowerCase() === "ativa";

        if (estaLigada) {
            // Se está LIGADA: gera variações de leitura
            m.temperatura = Math.floor(20 + Math.random() * 65); // 20°C a 85°C
            m.eficiencia = Math.floor(70 + Math.random() * 30);  // 70% a 100%
            m.alerta = m.temperatura >= 80;                      // Alerta se temp >= 80°C

            // Grava histórico no MySQL individualmente para cada máquina ativa
            const sql = `
                INSERT INTO telemetria (maquina_id, temperatura, status, criado_em)
                VALUES (?, ?, ?, NOW())
            `;
            db.query(sql, [m.id || (indice + 1), m.temperatura, m.alerta ? 'Alerta' : 'Operacional'], (err) => {
                if (err && err.code !== 'ER_NO_SUCH_TABLE') {
                    console.error("Erro no MySQL (telemetria):", err.message);
                }
            });
        } else {
            // Se está DESLIGADA: força e garante estado inativo em repouso
            m.operacao = false;
            m.status = "inativa";
            m.temperatura = 20;
            m.eficiencia = 0;
            m.alerta = false;
        }
    });

    // Guarda no ficheiro JSON uma única vez por ciclo (fora do forEach)
    fs.writeFile("./public/maquinas.json", JSON.stringify(maquinas, null, 4), (err) => {
        if (err) {
            console.error("Erro ao atualizar maquinas.json pelo simulador:", err);
            return;
        }
        console.log(`📡 [SIMULADOR] Ciclo concluído para todas as ${maquinas.length} máquinas.`);
    });
}

// Inicia a simulação a cada 5 segundos (5000 ms)
setInterval(simularDadosContinuos, 5000);

// =============================================================
// MIDDLEWARE DE CONTROLO DE ACESSO (RBAC)
// =============================================================
function permitirNiveis(...niveisPermitidos) {
    return (req, res, next) => {
        const emailReq = req.query.email || req.body.email;

        if (!emailReq) {
            return res.status(401).json({ erro: "Utilizador não identificado." });
        }

        const sql = "SELECT nivel FROM login WHERE email = ?";
        db.query(sql, [emailReq], (err, result) => {
            if (err || result.length === 0) {
                return res.status(403).json({ erro: "Acesso negado. Utilizador não encontrado." });
            }

            const nivelUsuario = result[0].nivel;

            if (niveisPermitidos.includes(nivelUsuario)) {
                req.usuarioNivel = nivelUsuario;
                next();
            } else {
                res.status(403).json({
                    erro: `Acesso negado. A sua conta (${nivelUsuario}) não tem permissão para esta ação.`
                });
            }
        });
    };
}

// =============================================================
// ROTAS DA APLICAÇÃO
// =============================================================

// ROTA: Registar Utilizador
app.post('/cadastrar', (req, res) => {
    const { nome, empresa, email, senha, nivel } = req.body;

    const sql = "INSERT INTO login (nome, empresa, email, senha, nivel) VALUES (?, ?, ?, ?, ?)";
    db.query(sql, [nome, empresa, email, senha, nivel || 'operador'], (err, result) => {
        if (err) {
            console.error("Erro ao cadastrar:", err);
            return res.status(500).send("Erro no servidor");
        }
        res.redirect('/login.html');
    });
});

// ROTA: Autenticação / Login
app.post("/login", (req, res) => {
    const { email, senha } = req.body;

    const sql = `
        SELECT * FROM login
        WHERE email = ? AND senha = ?
    `;

    db.query(sql, [email, senha], (erro, resultado) => {
        if (erro) {
            console.error("Erro no MySQL:", erro);
            return res.send("Erro no login");
        }

        if (resultado.length > 0) {
            const usuarioLogado = resultado[0];
            res.redirect(`/dashboard?email=${encodeURIComponent(usuarioLogado.email)}`);
        } else {
            res.redirect("/login.html?erro=true");
        }
    });
});

// ROTA: Consultar Perfil do Utilizador
app.get("/api/usuario", (req, res) => {
    const emailReq = req.query.email;

    if (!emailReq) {
        return res.status(400).json({ erro: "E-mail do utilizador não fornecido" });
    }

    const sql = "SELECT nome, email, empresa, nivel FROM login WHERE email = ?";

    db.query(sql, [emailReq], (erro, resultado) => {
        if (erro) return res.status(500).json({ erro: "Erro no servidor" });
        if (resultado.length > 0) {
            res.json(resultado[0]);
        } else {
            res.status(404).json({ erro: "Utilizador não encontrado" });
        }
    });
});

// ROTA: Buscar Máquinas (Filtro Estrito por E-mail via MySQL)
app.get("/api/maquinas", (req, res) => {
    const emailReq = req.query.email;

    // Se a requisição não enviar e-mail válido, retorna 0 máquinas (impede exibição global)
    if (!emailReq || emailReq === "null" || emailReq === "undefined") {
        return res.json({
            maquinas: [], total: 0, ativas: 0, operacao: 0, alertas: 0, mediaEficiencia: 0
        });
    }

    // Consulta no MySQL qual é a empresa cadastrada para ESTE e-mail
    const sql = "SELECT empresa FROM login WHERE email = ?";
    db.query(sql, [emailReq], (err, result) => {
        if (err || result.length === 0 || !result[0].empresa) {
            return res.json({
                maquinas: [], total: 0, ativas: 0, operacao: 0, alertas: 0, mediaEficiencia: 0
            });
        }

        const empresaUsuario = result[0].empresa.trim().toLowerCase();
        const todasMaquinas = lerMaquinas();

        // Filtra no JSON estritamente as máquinas pertencentes à empresa do utilizador
        const maquinas = todasMaquinas.filter(m =>
            m.empresa && m.empresa.trim().toLowerCase() === empresaUsuario
        );

        const total = maquinas.length;
        let ativas = 0, operacao = 0, alertas = 0, eficienciaTotal = 0;

        maquinas.forEach(m => {
            if (m.status === "ativa") ativas++;
            if (m.operacao) operacao++;
            if (m.status === "ativa" && (m.alerta || m.temperatura >= 80)) alertas++;
            eficienciaTotal += m.eficiencia || 0;
        });

        const mediaEficiencia = total > 0 ? Math.round(eficienciaTotal / total) : 0;

        res.json({
            maquinas,
            total,
            ativas,
            operacao,
            alertas,
            mediaEficiencia
        });
    });
});

// ROTA: Cadastrar / Atualizar Máquina manualmente
app.post("/api/maquinas", (req, res) => {
    const novaLeitura = req.body;

    if (!novaLeitura || !novaLeitura.nome) {
        return res.status(400).json({ erro: "Dados inválidos recebidos" });
    }

    let maquinas = lerMaquinas();
    const indice = maquinas.findIndex(m => m.nome === novaLeitura.nome);

    if (indice !== -1) {
        maquinas[indice] = { ...maquinas[indice], ...novaLeitura };
    } else {
        maquinas.push(novaLeitura);
    }

    fs.writeFile("./public/maquinas.json", JSON.stringify(maquinas, null, 4), (err) => {
        if (err) {
            console.error("Erro ao salvar no maquinas.json:", err);
            return res.status(500).json({ erro: "Erro ao salvar no arquivo" });
        }

        console.log(`✅ [POST] Dados da '${novaLeitura.nome}' atualizados com sucesso!`);
        res.json({
            sucesso: true,
            mensagem: "Dados da máquina salvos com sucesso!",
            dados: novaLeitura
        });
    });
});

function permitirNiveis(...niveisPermitidos) {
    return (req, res, next) => {
        const emailReq = req.query.email || req.body.email;

        if (!emailReq) {
            return res.status(401).json({ erro: "Utilizador não identificado." });
        }

        const sql = "SELECT nivel FROM login WHERE email = ?";
        db.query(sql, [emailReq], (err, result) => {
            if (err || result.length === 0) {
                return res.status(403).json({ erro: "Acesso negado. Utilizador não encontrado." });
            }

            // Converte ambos para minúsculas antes de comparar
            const nivelUsuario = (result[0].nivel || "").toLowerCase();
            const niveisPermitidosMin = niveisPermitidos.map(n => n.toLowerCase());

            if (niveisPermitidosMin.includes(nivelUsuario)) {
                req.usuarioNivel = nivelUsuario;
                next();
            } else {
                res.status(403).json({
                    erro: `Acesso negado. A sua conta (${nivelUsuario}) não tem permissão para esta ação.`
                });
            }
        });
    };
}

// Inicialização do Servidor
app.listen(3000, () => {
    console.log("Servidor rodando! http://localhost:3000/");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor a correr na porta ${PORT}`);
});