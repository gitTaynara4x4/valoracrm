from __future__ import annotations

"""Fotografia imutável do schema legado anterior ao Alembic.

Este módulo pertence às migrations e nunca é importado pela aplicação.
"""

from threading import Lock
from typing import Any

from sqlalchemy import text

Session = Any
_AGENDA_SCHEMA_READY = False
_AGENDA_SCHEMA_LOCK = Lock()
_PUSH_SCHEMA_READY = False
_SCHEMA_READY = False

def ensure_agenda_table(db: Session) -> None:
    """Cria/atualiza a estrutura uma única vez por processo.

    O módulo ainda não possui migrations Alembic próprias. Esta rotina é idempotente e
    mantém bancos já existentes compatíveis com os novos tipos e estados da agenda.
    """

    global _AGENDA_SCHEMA_READY
    if _AGENDA_SCHEMA_READY:
        return

    with _AGENDA_SCHEMA_LOCK:
        if _AGENDA_SCHEMA_READY:
            return
        try:
            # Evita corrida entre múltiplos workers tentando atualizar a mesma tabela.
            db.execute(text("SELECT pg_advisory_xact_lock(hashtext('valora_agenda_schema_v9'))"))
            db.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS agenda_itens (
                        id BIGSERIAL PRIMARY KEY,
                        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                        entidade_tipo VARCHAR(30) NOT NULL,
                        entidade_id BIGINT NOT NULL,
                        entidade_nome VARCHAR(180) NOT NULL,
                        tipo VARCHAR(40) NOT NULL,
                        assunto VARCHAR(180) NOT NULL,
                        descricao TEXT NULL,
                        agendado_para TIMESTAMPTZ NULL,
                        status VARCHAR(30) NOT NULL DEFAULT 'registrado',
                        motivo_status VARCHAR(180) NULL,
                        informacoes_livres TEXT NULL,
                        departamento_destino VARCHAR(180) NULL,
                        responsavel_usuario_id BIGINT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
                        criado_por_usuario_id BIGINT NULL REFERENCES usuarios(id) ON DELETE SET NULL,
                        criado_por_nome VARCHAR(120) NULL,
                        notificado_em TIMESTAMPTZ NULL,
                        concluido_em TIMESTAMPTZ NULL,
                        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        CONSTRAINT ck_agenda_entidade_tipo
                            CHECK (entidade_tipo IN ('cliente', 'fornecedor', 'produto')),
                        CONSTRAINT ck_agenda_tipo
                            CHECK (tipo IN (
                                'registro', 'lembrete', 'enviar_proposta',
                                'abrir_ordem_servico', 'transferir_departamento'
                            )),
                        CONSTRAINT ck_agenda_status
                            CHECK (status IN (
                                'registrado', 'em_aberto', 'em_andamento',
                                'em_analise', 'parado', 'finalizado', 'cancelado'
                            ))
                    )
                    """
                )
            )

            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS motivo_status VARCHAR(180) NULL"))
            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS informacoes_livres TEXT NULL"))
            db.execute(text("ALTER TABLE agenda_itens ADD COLUMN IF NOT EXISTS departamento_destino VARCHAR(180) NULL"))
            db.execute(text("ALTER TABLE agenda_itens ALTER COLUMN tipo TYPE VARCHAR(40)"))
            db.execute(text("ALTER TABLE agenda_itens ALTER COLUMN status TYPE VARCHAR(30)"))

            # Remove as validações antigas antes de converter os valores legados.
            db.execute(text("ALTER TABLE agenda_itens DROP CONSTRAINT IF EXISTS ck_agenda_tipo"))
            db.execute(text("ALTER TABLE agenda_itens DROP CONSTRAINT IF EXISTS ck_agenda_status"))
            db.execute(text("UPDATE agenda_itens SET status = 'em_aberto' WHERE status = 'pendente'"))
            db.execute(text("UPDATE agenda_itens SET status = 'finalizado' WHERE status = 'concluido'"))

            db.execute(
                text(
                    """
                    ALTER TABLE agenda_itens
                    ADD CONSTRAINT ck_agenda_tipo
                    CHECK (tipo IN (
                        'registro', 'lembrete', 'enviar_proposta',
                        'abrir_ordem_servico', 'transferir_departamento'
                    ))
                    """
                )
            )
            db.execute(
                text(
                    """
                    ALTER TABLE agenda_itens
                    ADD CONSTRAINT ck_agenda_status
                    CHECK (status IN (
                        'registrado', 'em_aberto', 'em_andamento',
                        'em_analise', 'parado', 'finalizado', 'cancelado'
                    ))
                    """
                )
            )

            db.execute(
                text(
                    """
                    CREATE INDEX IF NOT EXISTS ix_agenda_itens_entidade
                    ON agenda_itens (empresa_id, entidade_tipo, entidade_id, criado_em DESC)
                    """
                )
            )
            db.execute(text("DROP INDEX IF EXISTS ix_agenda_itens_responsavel_pendentes"))
            db.execute(
                text(
                    """
                    CREATE INDEX ix_agenda_itens_responsavel_pendentes
                    ON agenda_itens (empresa_id, responsavel_usuario_id, status, agendado_para)
                    WHERE tipo <> 'registro'
                      AND status IN ('em_aberto', 'em_andamento', 'em_analise', 'parado')
                    """
                )
            )
            db.commit()
            _AGENDA_SCHEMA_READY = True
        except Exception:
            db.rollback()
            raise

def ensure_push_schema(db: Session) -> None:
    """Cria as estruturas de Web Push uma única vez por processo.

    A rotina é idempotente e usa advisory lock para funcionar com mais de um worker.
    """

    global _PUSH_SCHEMA_READY
    if _PUSH_SCHEMA_READY:
        return

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('valora_agenda_push_schema_v1'))"))
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_config (
                id SMALLINT PRIMARY KEY,
                vapid_private_key TEXT NOT NULL,
                vapid_public_key VARCHAR(180) NOT NULL,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT ck_agenda_push_config_id CHECK (id = 1)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_assinaturas (
                id BIGSERIAL PRIMARY KEY,
                empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                plataforma VARCHAR(80) NULL,
                user_agent VARCHAR(700) NULL,
                ativo BOOLEAN NOT NULL DEFAULT TRUE,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ultimo_sucesso_em TIMESTAMPTZ NULL,
                ultimo_erro TEXT NULL,
                CONSTRAINT uq_agenda_push_endpoint UNIQUE (endpoint)
            )
            """
        )
    )
    db.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_agenda_push_assinaturas_usuario
            ON agenda_push_assinaturas (empresa_id, usuario_id, ativo)
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS agenda_push_entregas (
                agenda_item_id BIGINT NOT NULL REFERENCES agenda_itens(id) ON DELETE CASCADE,
                assinatura_id BIGINT NOT NULL REFERENCES agenda_push_assinaturas(id) ON DELETE CASCADE,
                agendado_para TIMESTAMPTZ NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'processando',
                tentativas INTEGER NOT NULL DEFAULT 1,
                ultimo_erro TEXT NULL,
                enviado_em TIMESTAMPTZ NULL,
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (agenda_item_id, assinatura_id, agendado_para),
                CONSTRAINT ck_agenda_push_entrega_status
                    CHECK (status IN ('processando', 'enviado', 'erro'))
            )
            """
        )
    )
    db.commit()
    _PUSH_SCHEMA_READY = True

def ensure_audit_schema(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS auditoria_alteracoes (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(60) NOT NULL,
            entidade_tipo VARCHAR(80) NOT NULL,
            entidade_id BIGINT NOT NULL,
            secao VARCHAR(160),
            campo VARCHAR(160),
            campo_nome VARCHAR(200),
            acao VARCHAR(40) NOT NULL,
            valor_anterior_json TEXT,
            valor_novo_json TEXT,
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            usuario_nome VARCHAR(160),
            origem VARCHAR(60) NOT NULL DEFAULT 'sistema',
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_auditoria_entidade
        ON auditoria_alteracoes (empresa_id, modulo, entidade_tipo, entidade_id, criado_em DESC, id DESC)
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS ix_auditoria_usuario
        ON auditoria_alteracoes (empresa_id, usuario_id, criado_em DESC)
    """))
    db.flush()

def ensure_cotacoes_schema(db: Session) -> None:
    """Cria/atualiza as tabelas do módulo de Cotações sem depender de Alembic.

    O Valora atual já usa esse estilo mais direto em alguns módulos. Mantive aqui
    para o usuário conseguir aplicar o patch e abrir a tela sem rodar migração manual.
    """
    ddl = """
    CREATE TABLE IF NOT EXISTS cotacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(50) NOT NULL,
        item_nome VARCHAR(180) NOT NULL,
        descricao TEXT NULL,
        quantidade VARCHAR(40) NULL,
        unidade VARCHAR(30) NULL,
        categoria VARCHAR(120) NULL,
        status VARCHAR(40) NOT NULL DEFAULT 'rascunho',
        urgencia VARCHAR(30) NULL,
        observacoes TEXT NULL,
        fornecedor_vencedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL,
        fornecedor_vencedor_item_id BIGINT NULL,
        valor_aprovado VARCHAR(40) NULL,
        data_aprovacao TIMESTAMPTZ NULL,
        produto_id BIGINT NULL REFERENCES produtos(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS codigo VARCHAR(50) NOT NULL DEFAULT '';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS item_nome VARCHAR(180) NOT NULL DEFAULT '';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS descricao TEXT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS quantidade VARCHAR(40) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS unidade VARCHAR(30) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS categoria VARCHAR(120) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'rascunho';
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS urgencia VARCHAR(30) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS observacoes TEXT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS fornecedor_vencedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS fornecedor_vencedor_item_id BIGINT NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS valor_aprovado VARCHAR(40) NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS data_aprovacao TIMESTAMPTZ NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS produto_id BIGINT NULL REFERENCES produtos(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE cotacoes ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS uq_cotacoes_empresa_codigo ON cotacoes(empresa_id, codigo);

    CREATE TABLE IF NOT EXISTS codigos_sequenciais (
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        modulo VARCHAR(80) NOT NULL,
        ultimo_codigo BIGINT NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (empresa_id, modulo)
    );

    CREATE INDEX IF NOT EXISTS ix_cotacoes_empresa ON cotacoes(empresa_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_item_nome ON cotacoes(item_nome);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_status ON cotacoes(status);

    CREATE TABLE IF NOT EXISTS cotacoes_fornecedores (
        id BIGSERIAL PRIMARY KEY,
        cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        fornecedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL,
        fornecedor_nome VARCHAR(180) NULL,
        valor_unitario VARCHAR(40) NULL,
        frete VARCHAR(40) NULL,
        valor_total VARCHAR(40) NULL,
        prazo_entrega VARCHAR(80) NULL,
        condicao_pagamento VARCHAR(160) NULL,
        observacoes TEXT NULL,
        vencedor BOOLEAN NOT NULL DEFAULT FALSE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS fornecedor_id BIGINT NULL REFERENCES fornecedores(id) ON DELETE SET NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS fornecedor_nome VARCHAR(180) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS valor_unitario VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS frete VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS valor_total VARCHAR(40) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS prazo_entrega VARCHAR(80) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS condicao_pagamento VARCHAR(160) NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS observacoes TEXT NULL;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS vencedor BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE cotacoes_fornecedores ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_cotacao ON cotacoes_fornecedores(cotacao_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_fornecedor ON cotacoes_fornecedores(fornecedor_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_fornecedores_vencedor ON cotacoes_fornecedores(vencedor);

    CREATE TABLE IF NOT EXISTS campos_cotacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(120) NOT NULL,
        slug VARCHAR(120) NOT NULL,
        tipo VARCHAR(30) NOT NULL,
        obrigatorio BOOLEAN NOT NULL DEFAULT FALSE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        opcoes_json TEXT NULL,
        ordem BIGINT NOT NULL DEFAULT 0,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_campos_cotacoes_empresa_slug ON campos_cotacoes(empresa_id, slug);
    CREATE INDEX IF NOT EXISTS ix_campos_cotacoes_empresa ON campos_cotacoes(empresa_id);

    CREATE TABLE IF NOT EXISTS cotacoes_campos_valores (
        id BIGSERIAL PRIMARY KEY,
        cotacao_id BIGINT NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
        campo_id BIGINT NOT NULL REFERENCES campos_cotacoes(id) ON DELETE CASCADE,
        valor TEXT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ix_cotacoes_campos_valores_cotacao ON cotacoes_campos_valores(cotacao_id);
    CREATE INDEX IF NOT EXISTS ix_cotacoes_campos_valores_campo ON cotacoes_campos_valores(campo_id);
    """
    db.execute(text(ddl))
    db.commit()

def garantir_tabela_sequencias_codigo(db: Session) -> None:
    """Cria a tabela de sequência se ela ainda não existir.

    Essa tabela evita usar o ID do banco como código do produto.
    O código passa a seguir uma sequência própria por empresa e por módulo.
    """
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS cadastro_sequencias (
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(40) NOT NULL,
            ultimo_codigo BIGINT NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (empresa_id, modulo)
        )
    """))

def garantir_tabela_produto_kit(db: Session) -> None:
    """Garante o subcadastro de composição dos produtos do tipo KIT."""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS produto_kit_itens (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            kit_produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
            componente_produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            perda_percentual NUMERIC(10,4) NOT NULL DEFAULT 0,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_produto_kit_item UNIQUE (kit_produto_id, componente_produto_id),
            CONSTRAINT ck_produto_kit_sem_autorreferencia CHECK (kit_produto_id <> componente_produto_id),
            CONSTRAINT ck_produto_kit_quantidade_positiva CHECK (quantidade > 0),
            CONSTRAINT ck_produto_kit_perda_nao_negativa CHECK (perda_percentual >= 0)
        )
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_produto_kit_itens_empresa_kit
        ON produto_kit_itens (empresa_id, kit_produto_id, ordem, id)
    """))
    db.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_produto_kit_itens_componente
        ON produto_kit_itens (empresa_id, componente_produto_id)
    """))

def garantir_tabela_codigos_sequenciais(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS codigos_sequenciais (
                empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                modulo VARCHAR(80) NOT NULL,
                ultimo_codigo BIGINT NOT NULL DEFAULT 0,
                criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (empresa_id, modulo)
            )
            """
        )
    )

def _garantir_tabela_layout_localizar(db: Session) -> None:
    # A tabela é pequena e independente. CREATE TABLE IF NOT EXISTS permite que
    # a atualização funcione também em instalações que ainda não rodaram o SQL.
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS formularios_layouts_localizar (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(60) NOT NULL,
            layout_json TEXT NOT NULL DEFAULT '{}',
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_formularios_layouts_localizar_empresa_modulo UNIQUE (empresa_id, modulo)
        )
    """))
    db.commit()

def ensure_schema(db: Session) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS cadastro_sequencias (
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(40) NOT NULL,
            ultimo_codigo BIGINT NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (empresa_id, modulo)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_configuracoes (
            empresa_id BIGINT PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
            nome_documento VARCHAR(80) NOT NULL DEFAULT 'Orçamento',
            prefixo VARCHAR(20) NOT NULL DEFAULT 'ORC',
            validade_padrao_dias INTEGER NOT NULL DEFAULT 7,
            prazo_execucao_padrao VARCHAR(160),
            condicoes_padrao TEXT,
            observacoes_padrao TEXT,
            rodape_padrao TEXT,
            cor_primaria VARCHAR(20) NOT NULL DEFAULT '#65ACDE',
            titulo_capa VARCHAR(180),
            subtitulo_capa VARCHAR(220),
            usar_capa BOOLEAN NOT NULL DEFAULT FALSE,
            escala_documento_padrao INTEGER NOT NULL DEFAULT 100,
            mostrar_codigo BOOLEAN NOT NULL DEFAULT TRUE,
            mostrar_desconto BOOLEAN NOT NULL DEFAULT TRUE,
            mostrar_imagens BOOLEAN NOT NULL DEFAULT FALSE,
            controlar_custos BOOLEAN NOT NULL DEFAULT TRUE,
            margem_minima NUMERIC(14,4) NOT NULL DEFAULT 0,
            exigir_aprovacao_margem BOOLEAN NOT NULL DEFAULT FALSE,
            formas_pagamento_json TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    for sql in (
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS modelo_documento VARCHAR(30) NOT NULL DEFAULT 'padrao'",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS dav_titulo VARCHAR(140) NOT NULL DEFAULT 'DAV - Documento Auxiliar de Venda'",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_razao_social VARCHAR(180)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_nome_fantasia VARCHAR(180)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_cnpj VARCHAR(30)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_email VARCHAR(255)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_site VARCHAR(255)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_telefone VARCHAR(60)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_endereco TEXT",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS cabecalho_rodape TEXT",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS preset_aplicado VARCHAR(80)",
        "ALTER TABLE orcamento_configuracoes ADD COLUMN IF NOT EXISTS escala_documento_padrao INTEGER NOT NULL DEFAULT 100",
    ):
        db.execute(text(sql))

    # Remove somente o cabeçalho gravado pelo preset antigo. Os dados corretos
    # passam a vir do perfil emitente escolhido, sem alterar o cadastro principal.
    db.execute(text("""
        UPDATE orcamento_configuracoes SET
            cabecalho_razao_social=NULL,
            cabecalho_nome_fantasia=NULL,
            cabecalho_cnpj=NULL,
            cabecalho_email=NULL,
            cabecalho_site=NULL,
            cabecalho_telefone=NULL,
            cabecalho_endereco=NULL,
            cabecalho_rodape=NULL,
            preset_aplicado=NULL,
            atualizado_em=NOW()
        WHERE preset_aplicado='segsis_dav_v1'
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_emitentes (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(160) NOT NULL,
            razao_social VARCHAR(180) NOT NULL,
            nome_fantasia VARCHAR(180),
            cnpj VARCHAR(30),
            inscricao_estadual VARCHAR(40),
            email VARCHAR(255),
            site VARCHAR(255),
            telefone VARCHAR(60),
            cep VARCHAR(20),
            endereco VARCHAR(240),
            numero VARCHAR(30),
            complemento VARCHAR(120),
            bairro VARCHAR(120),
            cidade VARCHAR(120),
            estado VARCHAR(20),
            logo_url TEXT,
            rodape TEXT,
            padrao BOOLEAN NOT NULL DEFAULT FALSE,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_emitente_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))
    db.execute(text("CREATE INDEX IF NOT EXISTS ix_orcamento_emitentes_empresa ON orcamento_emitentes (empresa_id, ativo, nome)"))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_categorias (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(140) NOT NULL,
            descricao TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_categoria_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_modelos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            categoria_id BIGINT REFERENCES orcamento_categorias(id) ON DELETE SET NULL,
            nome VARCHAR(160) NOT NULL,
            titulo VARCHAR(180),
            descricao TEXT,
            validade_dias INTEGER,
            prazo_execucao VARCHAR(160),
            condicoes TEXT,
            observacoes TEXT,
            pagamentos_json TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_modelo_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_modelo_itens (
            id BIGSERIAL PRIMARY KEY,
            modelo_id BIGINT NOT NULL REFERENCES orcamento_modelos(id) ON DELETE CASCADE,
            produto_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
            codigo VARCHAR(50),
            descricao TEXT NOT NULL,
            referencia VARCHAR(160),
            unidade VARCHAR(30),
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            valor_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            observacao TEXT,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_kits (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(160) NOT NULL,
            descricao TEXT,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_kit_empresa_nome UNIQUE (empresa_id, nome)
        )
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_kit_itens (
            id BIGSERIAL PRIMARY KEY,
            kit_id BIGINT NOT NULL REFERENCES orcamento_kits(id) ON DELETE CASCADE,
            produto_id BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_kit_produto UNIQUE (kit_id, produto_id)
        )
    """))

    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orcamento_kits_empresa_ativo ON orcamento_kits (empresa_id, ativo, nome)"))
    db.execute(text("CREATE INDEX IF NOT EXISTS idx_orcamento_kit_itens_kit_ordem ON orcamento_kit_itens (kit_id, ordem, id)"))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamentos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
            usuario_criador_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            consultor_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            categoria_id BIGINT REFERENCES orcamento_categorias(id) ON DELETE SET NULL,
            modelo_id BIGINT REFERENCES orcamento_modelos(id) ON DELETE SET NULL,
            codigo VARCHAR(50) NOT NULL,
            titulo VARCHAR(180) NOT NULL,
            nome_documento VARCHAR(80) NOT NULL DEFAULT 'Orçamento',
            status VARCHAR(40) NOT NULL DEFAULT 'rascunho',
            versao INTEGER NOT NULL DEFAULT 1,
            data_solicitacao DATE,
            data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
            data_validade DATE,
            data_aprovacao TIMESTAMPTZ,
            responsavel_cliente VARCHAR(160),
            contato_cliente VARCHAR(100),
            endereco_cep VARCHAR(20),
            endereco_logradouro VARCHAR(200),
            endereco_numero VARCHAR(30),
            endereco_complemento VARCHAR(120),
            endereco_bairro VARCHAR(120),
            endereco_cidade VARCHAR(120),
            endereco_estado VARCHAR(20),
            desconto_tipo VARCHAR(20) NOT NULL DEFAULT 'valor',
            desconto_valor NUMERIC(18,4) NOT NULL DEFAULT 0,
            desconto_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            frete NUMERIC(18,4) NOT NULL DEFAULT 0,
            acrescimo NUMERIC(18,4) NOT NULL DEFAULT 0,
            subtotal NUMERIC(18,4) NOT NULL DEFAULT 0,
            total NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            lucro_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            margem_percentual NUMERIC(18,4) NOT NULL DEFAULT 0,
            prazo_execucao VARCHAR(160),
            condicoes TEXT,
            observacoes TEXT,
            pagamentos_json TEXT,
            usar_capa BOOLEAN NOT NULL DEFAULT FALSE,
            titulo_capa VARCHAR(180),
            subtitulo_capa VARCHAR(220),
            escala_documento INTEGER NOT NULL DEFAULT 100,
            aprovacao_necessaria BOOLEAN NOT NULL DEFAULT FALSE,
            aprovacao_status VARCHAR(30),
            aprovado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            aprovado_em TIMESTAMPTZ,
            legacy_proposta_id BIGINT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamentos_empresa_codigo UNIQUE (empresa_id, codigo),
            CONSTRAINT uq_orcamentos_empresa_legacy UNIQUE (empresa_id, legacy_proposta_id)
        )
    """))

    for sql in (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_nome_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_nome_fantasia_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_cpf_cnpj VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_rg_ie VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_telefone VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_whatsapp_documento VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_fax VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_email_nfe VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS cliente_contato_nome VARCHAR(120)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_id BIGINT REFERENCES orcamento_emitentes(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_nome_documento VARCHAR(160)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_razao_social_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_nome_fantasia_documento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_cnpj_documento VARCHAR(30)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_ie_documento VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_email_documento VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_site_documento VARCHAR(255)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_telefone_documento VARCHAR(60)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_endereco_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_logo_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS emitente_rodape_documento TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS itens_sem_custo INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS escala_documento INTEGER NOT NULL DEFAULT 100",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_status VARCHAR(30) NOT NULL DEFAULT 'nao_enviado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_enviado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_enviado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_autenticado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_autenticado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS financeiro_motivo_retorno TEXT",
    ):
        db.execute(text(sql))

    db.execute(text("""
        UPDATE orcamento_configuracoes
        SET escala_documento_padrao=100
        WHERE escala_documento_padrao IS NULL OR escala_documento_padrao < 70 OR escala_documento_padrao > 125
    """))
    db.execute(text("""
        UPDATE orcamentos
        SET escala_documento=100
        WHERE escala_documento IS NULL OR escala_documento < 70 OR escala_documento > 125
    """))

    db.execute(text("""
        UPDATE orcamentos o SET
            cliente_nome_documento=COALESCE(o.cliente_nome_documento, c.nome),
            cliente_nome_fantasia_documento=COALESCE(o.cliente_nome_fantasia_documento, c.nome_fantasia),
            cliente_cpf_cnpj=COALESCE(o.cliente_cpf_cnpj, c.cpf_cnpj),
            cliente_rg_ie=COALESCE(o.cliente_rg_ie, c.rg_ie),
            cliente_telefone=COALESCE(o.cliente_telefone, c.telefone),
            cliente_whatsapp_documento=COALESCE(o.cliente_whatsapp_documento, c.whatsapp),
            cliente_fax=COALESCE(o.cliente_fax, c.fax),
            cliente_email_nfe=COALESCE(o.cliente_email_nfe, c.email_nfe),
            cliente_contato_nome=COALESCE(o.cliente_contato_nome, c.contato)
        FROM clientes c
        WHERE o.cliente_id=c.id AND o.empresa_id=c.empresa_id
          AND (o.cliente_nome_documento IS NULL OR o.cliente_cpf_cnpj IS NULL)
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_itens (
            id BIGSERIAL PRIMARY KEY,
            orcamento_id BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
            produto_id BIGINT REFERENCES produtos(id) ON DELETE SET NULL,
            origem VARCHAR(30) NOT NULL DEFAULT 'manual',
            codigo VARCHAR(50),
            descricao TEXT NOT NULL,
            referencia VARCHAR(160),
            unidade VARCHAR(30),
            quantidade NUMERIC(18,4) NOT NULL DEFAULT 1,
            valor_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            desconto NUMERIC(18,4) NOT NULL DEFAULT 0,
            valor_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_unitario NUMERIC(18,4) NOT NULL DEFAULT 0,
            custo_informado BOOLEAN NOT NULL DEFAULT FALSE,
            custo_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            lucro_total NUMERIC(18,4) NOT NULL DEFAULT 0,
            margem_percentual NUMERIC(18,4) NOT NULL DEFAULT 0,
            observacao TEXT,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    db.execute(text("ALTER TABLE orcamento_itens ADD COLUMN IF NOT EXISTS custo_informado BOOLEAN NOT NULL DEFAULT FALSE"))
    db.execute(text("""
        UPDATE orcamento_itens
        SET custo_informado=TRUE
        WHERE custo_informado=FALSE AND COALESCE(custo_unitario, 0) <> 0
    """))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS orcamento_historico (
            id BIGSERIAL PRIMARY KEY,
            orcamento_id BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            usuario_nome VARCHAR(160),
            acao VARCHAR(60) NOT NULL,
            status_anterior VARCHAR(40),
            status_novo VARCHAR(40),
            descricao TEXT,
            dados_json TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """))

    for sql in (
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_status ON orcamentos (empresa_id, status)",
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_cliente ON orcamentos (empresa_id, cliente_id)",
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_data_emissao ON orcamentos (data_emissao DESC)",
        "CREATE INDEX IF NOT EXISTS ix_orcamento_itens_orcamento ON orcamento_itens (orcamento_id, ordem)",
        "CREATE INDEX IF NOT EXISTS ix_orcamento_historico_orcamento ON orcamento_historico (orcamento_id, criado_em DESC)",
    ):
        db.execute(text(sql))

    # Mantém compatibilidade com as permissões que antes eram usadas pela tela de Propostas.
    # A cópia só ocorre quando ainda não existe uma permissão específica de Orçamentos.
    db.execute(text("""
        INSERT INTO usuarios_permissoes (
            empresa_id, usuario_id, modulo, pode_ver, pode_criar, pode_editar, pode_excluir
        )
        SELECT empresa_id, usuario_id, 'orcamentos', pode_ver, pode_criar, pode_editar, pode_excluir
        FROM usuarios_permissoes origem
        WHERE origem.modulo='propostas'
        ON CONFLICT (usuario_id, modulo) DO NOTHING
    """))

    db.commit()
    _SCHEMA_READY = True
