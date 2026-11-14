require("./lib/env");
const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("./db");
const pdb = db.promise();
const { auditar, criarSessao, encerrarSessao, criarMiddlewares, verificarOrigem } = require("./lib/auth");
const { verificarSenha, gastarTempo } = require("./lib/seguranca");
const { normalizarEmail } = require("./lib/validacoes");
const limite = require("./lib/limite");
const rotasConvites = require("./rotas/convites");
const rotasSolicitacoes = require("./rotas/solicitacoes");
const rotasAdmin = require("./rotas/admin");

const app = express();
app.set("trust proxy", 1);           // Render fica atrás de um proxy: necessário para req.ip e cookies seguros
app.disable("x-powered-by");

// Cabeçalhos básicos de segurança
app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "DENY");
    res.set("Referrer-Policy", "no-referrer");
    next();
});

const { autenticar, exigirLogin, exigirLoginPagina, exigirNivel, exigirEmpresa } = criarMiddlewares(pdb);
const guardas = { exigirLogin, exigirNivel, exigirEmpresa };

app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: true, limit: "20kb" }));
app.use(verificarOrigem);
app.use(autenticar);

// O dashboard exige sessão; sem ela vai para o login. (Declarado antes do express.static.)
app.get(["/dashboard", "/dashboard.html"], exigirLoginPagina, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// =============================================================
// MÁQUINAS (arquivo JSON em data/, fora de public/)
// =============================================================
const ARQUIVO_MAQUINAS = process.env.MAQUINAS_ARQUIVO || path.join(__dirname, "data", "maquinas.json");

// Fila: leituras+gravações do JSON nunca se misturam (evita corrupção por escrita simultânea).
let fila = Promise.resolve();
function comExclusao(fn) {
    const p = fila.then(fn, fn);
    fila = p.catch(() => {});
    return p;
}

function lerMaquinas() {
    try {
        return JSON.parse(fs.readFileSync(ARQUIVO_MAQUINAS, "utf8"));
    } catch (err) {
        console.error("Erro ao ler maquinas.json:", err.message);
        return [];
    }
}

function gravarMaquinas(maquinas) {
    const tmp = ARQUIVO_MAQUINAS + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(maquinas, null, 4));
    fs.renameSync(tmp, ARQUIVO_MAQUINAS); // troca atômica
}

// 📡 SIMULADOR DE DADOS DO FINDER OPTA (mantido como estava)
function simularDadosContinuos() {
    return comExclusao(() => {
        const maquinas = lerMaquinas();
        if (maquinas.length === 0) return;

        maquinas.forEach((m, indice) => {
            const estaLigada = m.operacao === true && m.status && m.status.toLowerCase() === "ativa";
            if (estaLigada) {
                m.temperatura = Math.floor(20 + Math.random() * 65);
                m.eficiencia = Math.floor(70 + Math.random() * 30);
                m.alerta = m.temperatura >= 80;
                db.query(
                    "INSERT INTO telemetria (maquina_id, temperatura, status, criado_em) VALUES (?, ?, ?, NOW())",
                    [m.id || (indice + 1), m.temperatura, m.alerta ? "Alerta" : "Operacional"],
                    (err) => {
                        if (err && err.code !== "ER_NO_SUCH_TABLE") console.error("Erro no MySQL (telemetria):", err.message);
                    });
            } else {
                m.operacao = false;
                m.status = "inativa";
                m.temperatura = 20;
                m.eficiencia = 0;
                m.alerta = false;
            }
        });
        gravarMaquinas(maquinas);
    }).catch((e) => console.error("Erro no simulador:", e.message));
}

const mesmaEmpresa = (m, nomeEmpresa) =>
    m.empresa && String(m.empresa).trim().toLowerCase() === String(nomeEmpresa).trim().toLowerCase();

// Buscar máquinas: somente as da empresa da SESSÃO
app.get("/api/maquinas", exigirLogin, (req, res) => {
    const vazio = { maquinas: [], total: 0, ativas: 0, operacao: 0, alertas: 0, mediaEficiencia: 0 };
    if (!req.user.empresa_id || !req.user.empresa_nome) return res.json(vazio);

    const maquinas = lerMaquinas().filter((m) => mesmaEmpresa(m, req.user.empresa_nome));
    const total = maquinas.length;
    let ativas = 0, operacao = 0, alertas = 0, eficienciaTotal = 0;
    maquinas.forEach((m) => {
        if (m.status === "ativa") ativas++;
        if (m.operacao) operacao++;
        if (m.status === "ativa" && (m.alerta || m.temperatura >= 80)) alertas++;
        eficienciaTotal += m.eficiencia || 0;
    });
    res.json({ maquinas, total, ativas, operacao, alertas,
        mediaEficiencia: total > 0 ? Math.round(eficienciaTotal / total) : 0 });
});

const texto = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Cadastrar máquina (gerente/supervisor) ou alterar estado de uma existente (gerente/supervisor/técnico).
// A empresa vem da sessão; só campos permitidos são aceitos.
app.post("/api/maquinas", exigirLogin, exigirEmpresa, (req, res) => {
    const dados = req.body;
    const nome = texto(dados?.nome, 100);
    if (!nome) return res.status(400).json({ erro: "Dados inválidos recebidos" });

    comExclusao(() => {
        const maquinas = lerMaquinas();
        const indice = maquinas.findIndex((m) => m.nome === nome && mesmaEmpresa(m, req.user.empresa_nome));

        if (indice !== -1) {
            if (!["gerente", "supervisor", "tecnico"].includes(req.user.nivel)) return { status: 403, corpo: { erro: "Você não tem permissão para esta ação." } };
            const m = maquinas[indice];
            if (typeof dados.status === "string") m.status = texto(dados.status, 20);
            if (typeof dados.operacao === "boolean") m.operacao = dados.operacao;
            if (Number.isFinite(dados.temperatura)) m.temperatura = dados.temperatura;
            if (Number.isFinite(dados.eficiencia)) m.eficiencia = dados.eficiencia;
            if (typeof dados.alerta === "boolean") m.alerta = dados.alerta;
        } else {
            if (!["gerente", "supervisor"].includes(req.user.nivel)) return { status: 403, corpo: { erro: "Você não tem permissão para esta ação." } };
            maquinas.push({
                nome,
                empresa: req.user.empresa_nome,
                modelo: texto(dados.modelo, 100),
                numSerie: texto(dados.numSerie, 100),
                dataCompra: texto(dados.dataCompra, 20),
                tempoConsumo: texto(dados.tempoConsumo, 50),
                status: texto(dados.status, 20) || "inativa",
                operacao: dados.operacao === true,
                temperatura: Number.isFinite(dados.temperatura) ? dados.temperatura : 20,
                eficiencia: Number.isFinite(dados.eficiencia) ? dados.eficiencia : 0,
                alerta: dados.alerta === true
            });
        }
        gravarMaquinas(maquinas);
        return { status: 200, corpo: { sucesso: true, mensagem: "Dados da máquina salvos com sucesso!" } };
    }).then(({ status, corpo }) => {
        if (status === 403) auditar(pdb, { req, usuario: req.user, acao: "acesso_negado", entidade: "maquina", detalhes: { nivel: req.user.nivel } });
        res.status(status).json(corpo);
    }).catch((err) => {
        console.error("Erro ao salvar maquinas.json:", err.message);
        res.status(500).json({ erro: "Erro ao salvar no arquivo" });
    });
});

// =============================================================
// LOGIN / SESSÃO
// =============================================================
const MAX_FALHAS_LOGIN = 5, JANELA_LOGIN = 15 * 60 * 1000;

app.post("/login", limite.limitar("login-ip", { max: 30, janelaMs: JANELA_LOGIN }), async (req, res) => {
    const email = normalizarEmail(req.body?.email);
    const senha = String(req.body?.senha ?? "");
    const chave = `login-email:${email}`;
    const falha = (codigo = "true") => res.redirect(`/login.html?erro=${codigo}`);

    try {
        if (!email || !senha || senha.length > 128) return falha();
        if (!limite.consumir(chave, { max: MAX_FALHAS_LOGIN + 1, janelaMs: JANELA_LOGIN }).permitido) {
            await auditar(pdb, { req, acao: "login_bloqueado", entidade: "usuario" });
            return falha("bloqueado");
        }
        const [rows] = await pdb.query(
            `SELECT u.id, u.empresa_id, u.nivel, u.status, u.senha_hash, e.ativa AS empresa_ativa
               FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id WHERE u.email = ?`, [email]);
        const u = rows[0];
        if (!u) { await gastarTempo(senha); await auditar(pdb, { req, acao: "login_falha", entidade: "usuario" }); return falha(); }

        if (!(await verificarSenha(senha, u.senha_hash))) {
            await auditar(pdb, { req, usuario: u, acao: "login_falha", entidade: "usuario", entidadeId: u.id });
            return falha();
        }
        // Senha correta, mas o acesso depende do status.
        if (u.status === "pendente") return falha("pendente");
        if (u.status === "rejeitado") return falha("rejeitado");
        if (u.status !== "ativo" || (u.empresa_id != null && !u.empresa_ativa)) return falha("inativo");

        limite.zerar(chave);
        await criarSessao(pdb, res, u.id);
        await auditar(pdb, { req, usuario: u, acao: "login_ok", entidade: "usuario", entidadeId: u.id });
        res.redirect("/dashboard");
    } catch (e) {
        console.error("Erro no login:", e);
        res.redirect("/login.html?erro=servidor");
    }
});

app.post("/api/logout", async (req, res) => {
    try { await encerrarSessao(pdb, req, res); } catch (e) { console.error(e); }
    res.json({ ok: true });
});

// Perfil do usuário da sessão (sem CPF, sem nascimento)
app.get("/api/me", exigirLogin, (req, res) => {
    const { nome, email, empresa_nome, nivel } = req.user;
    res.json({ nome, email, empresa: empresa_nome || "", nivel });
});

app.use(rotasConvites(pdb, guardas));
app.use(rotasSolicitacoes(pdb, guardas));
app.use(rotasAdmin(pdb, guardas));

// =============================================================
// INICIALIZAÇÃO (só quando executado diretamente; os testes importam o `app`)
// =============================================================
function iniciar() {
    setInterval(simularDadosContinuos, 5000);
    setInterval(() => {
        rotasConvites.expirarConvites(pdb).catch((e) => console.error("Erro ao expirar convites:", e.message));
        pdb.query("DELETE FROM sessoes WHERE expira_em <= UTC_TIMESTAMP()").catch(() => {});
        limite.limparExpirados();
    }, 60 * 1000);
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => console.log(`Servidor a correr na porta ${PORT}`));
}

if (require.main === module) iniciar();

module.exports = { app, simularDadosContinuos };
