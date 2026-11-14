# Lumasat

https://lumasat.onrender.com/

---

## Cadastro por convite, aprovação e multiempresa

**Níveis:** administrador (plataforma), gerente, supervisor, técnico e operador. Cada usuário pertence a uma empresa
e só enxerga os dados dela; o isolamento é feito no servidor, a partir da sessão.

**Fluxo:** o administrador cria a empresa e o convite do primeiro gerente (`POST /api/admin/empresas`) →
o gerente convida funcionários por e-mail (Dashboard → Adicionar Integrantes) → o funcionário abre o link, preenche o
cadastro (`cadastrar.html`) e fica **pendente** → o gerente aprova (escolhendo o cargo) ou rejeita (com motivo) em
Dashboard → Solicitações de cadastro → o funcionário recebe e-mail com a decisão.

**Primeira instalação**
1. Faça backup do banco e rode `migracao_001_multiempresa.sql`.
2. Copie `.env.example` para `.env` e preencha (nenhuma credencial fica no código).
3. `npm install`
4. `node scripts/migrar-usuarios.js` (simulação) e depois `node scripts/migrar-usuarios.js --executar`.
5. Defina `ADMIN_EMAIL` e `ADMIN_SENHA` e rode `node scripts/criar-admin.js`; depois apague `ADMIN_SENHA`.
6. `npm start`

**Testes:** `npm test` (unidade, sem banco) e `npm run test:integracao` (exige MySQL de teste com `DB_NAME` terminando em `_test`).
