-- =====================================================================
-- LumaSat - Migração 001: multiempresa, convites, aprovação e auditoria
-- FAÇA BACKUP DO BANCO ANTES DE EXECUTAR. Execute UMA vez (MySQL 8+).
-- A tabela antiga `login` NÃO é alterada nem apagada.
-- Depois deste SQL rode:  node scripts/migrar-usuarios.js
-- =====================================================================
SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS empresas (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  nome       VARCHAR(100) NOT NULL,
  ativa      TINYINT(1)   NOT NULL DEFAULT 1,
  criado_em  DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  UNIQUE KEY uq_empresas_nome (nome)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id       INT UNSIGNED NULL,                 -- NULL somente para o administrador
  nome             VARCHAR(120) NOT NULL,
  email            VARCHAR(120) NOT NULL,
  senha_hash       VARCHAR(255) NOT NULL,
  cpf              CHAR(11)     NULL,                 -- só números
  data_nascimento  DATE         NULL,
  telefone         VARCHAR(11)  NULL,                 -- só números
  nivel            ENUM('administrador','gerente','supervisor','tecnico','operador') NULL, -- NULL enquanto pendente
  status           ENUM('pendente','ativo','rejeitado','inativo') NOT NULL DEFAULT 'pendente',
  aprovado_por     INT UNSIGNED NULL,
  aprovado_em      DATETIME     NULL,
  criado_em        DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  UNIQUE KEY uq_usuarios_email (email),
  UNIQUE KEY uq_usuarios_cpf (cpf),
  KEY ix_usuarios_empresa (empresa_id),
  CONSTRAINT fk_usuarios_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  -- só o administrador pode ficar sem empresa
  CONSTRAINT ck_usuarios_empresa CHECK (nivel = 'administrador' OR empresa_id IS NOT NULL),
  -- usuário ativo sempre tem cargo
  CONSTRAINT ck_usuarios_ativo_cargo CHECK (status <> 'ativo' OR nivel IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS convites (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id    INT UNSIGNED NOT NULL,
  email         VARCHAR(120) NOT NULL,                -- normalizado em minúsculas
  codigo_hash   CHAR(64)     NOT NULL,                -- SHA-256 do código (o código nunca é guardado)
  cargo_inicial ENUM('gerente') NULL,                 -- só convites criados pelo administrador
  status        ENUM('PENDENTE','UTILIZADO','EXPIRADO','CANCELADO') NOT NULL DEFAULT 'PENDENTE',
  criado_por    INT UNSIGNED NOT NULL,
  criado_em     DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  expira_em     DATETIME     NOT NULL,
  utilizado_em  DATETIME     NULL,
  utilizado_por INT UNSIGNED NULL,
  -- impede dois convites PENDENTES para o mesmo e-mail na mesma empresa
  pendente_chave VARCHAR(160) GENERATED ALWAYS AS (IF(status = 'PENDENTE', CONCAT(empresa_id, ':', email), NULL)) STORED,
  UNIQUE KEY uq_convites_codigo (codigo_hash),
  UNIQUE KEY uq_convites_pendente (pendente_chave),
  KEY ix_convites_empresa (empresa_id, status),
  CONSTRAINT fk_convites_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_convites_criador FOREIGN KEY (criado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_convites_usuario FOREIGN KEY (utilizado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS solicitacoes_cadastro (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id      INT UNSIGNED NOT NULL,
  convite_id      INT UNSIGNED NOT NULL,
  empresa_id      INT UNSIGNED NOT NULL,
  status          ENUM('PENDENTE','APROVADA','REJEITADA') NOT NULL DEFAULT 'PENDENTE',
  cargo_atribuido ENUM('gerente','supervisor','tecnico','operador') NULL,
  criado_em       DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  decidido_por    INT UNSIGNED NULL,
  decidido_em     DATETIME NULL,
  motivo          VARCHAR(500) NULL,
  KEY ix_solic_empresa (empresa_id, status, criado_em),
  CONSTRAINT fk_solic_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
  CONSTRAINT fk_solic_convite FOREIGN KEY (convite_id) REFERENCES convites(id),
  CONSTRAINT fk_solic_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id),
  CONSTRAINT fk_solic_decisor FOREIGN KEY (decidido_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessoes (
  id_hash     CHAR(64)     NOT NULL PRIMARY KEY,      -- SHA-256 do identificador do cookie
  usuario_id  INT UNSIGNED NOT NULL,
  criado_em   DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  expira_em   DATETIME     NOT NULL,
  KEY ix_sessoes_usuario (usuario_id),
  CONSTRAINT fk_sessoes_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NULL,
  empresa_id  INT UNSIGNED NULL,
  acao        VARCHAR(60)  NOT NULL,
  entidade    VARCHAR(40)  NULL,
  entidade_id VARCHAR(40)  NULL,
  ip          VARCHAR(64)  NULL,
  detalhes    JSON         NULL,                      -- nunca contém senha, CPF ou código de convite
  criado_em   DATETIME     NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_auditoria_empresa (empresa_id, criado_em),
  KEY ix_auditoria_acao (acao, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS emails_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tipo         VARCHAR(40)  NOT NULL,
  destinatario VARCHAR(120) NOT NULL,
  assunto      VARCHAR(200) NOT NULL,
  status       ENUM('ENVIADO','FALHOU') NOT NULL,
  erro         VARCHAR(300) NULL,
  criado_em    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  KEY ix_emails_status (status, criado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
