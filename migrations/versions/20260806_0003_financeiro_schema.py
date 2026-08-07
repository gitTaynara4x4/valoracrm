"""Versiona o schema Financeiro e a recorrência de contratos.

Revision ID: 20260806_0003
Revises: 20260806_0002
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "20260806_0003"
down_revision: Union[str, Sequence[str], None] = "20260806_0002"
branch_labels = None
depends_on = None


def _run(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_categorias (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(180) NOT NULL,
        tipo VARCHAR(20) NOT NULL DEFAULT 'ambos',
        cor VARCHAR(30),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_categorias_empresa ON financeiro_categorias (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_formas_pagamento (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(180) NOT NULL,
        tipo VARCHAR(50),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_formas_pagamento_empresa ON financeiro_formas_pagamento (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_contas_bancos (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(180) NOT NULL,
        banco VARCHAR(120),
        agencia VARCHAR(40),
        conta VARCHAR(60),
        saldo_inicial NUMERIC(18,2) NOT NULL DEFAULT 0,
        data_saldo_inicial DATE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_contas_bancos_empresa ON financeiro_contas_bancos (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_tipos_documento (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(40),
        nome VARCHAR(180) NOT NULL,
        aplicacao VARCHAR(20) NOT NULL DEFAULT 'ambos',
        exige_entidade_emissora BOOLEAN NOT NULL DEFAULT FALSE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_tipos_documento_empresa ON financeiro_tipos_documento (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_naturezas_operacao (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(40),
        nome VARCHAR(180) NOT NULL,
        aplicacao VARCHAR(20) NOT NULL DEFAULT 'ambos',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_naturezas_operacao_empresa ON financeiro_naturezas_operacao (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_centros_custo (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(60),
        nome VARCHAR(180) NOT NULL,
        centro_pai_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_centros_custo_empresa ON financeiro_centros_custo (empresa_id, ativo, codigo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_unidades_consumo (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(60),
        nome VARCHAR(180) NOT NULL,
        departamento_referencia VARCHAR(180),
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_unidades_consumo_empresa ON financeiro_unidades_consumo (empresa_id, ativo, codigo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_contas_contabeis (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        codigo VARCHAR(80) NOT NULL,
        nome VARCHAR(180) NOT NULL,
        tipo VARCHAR(30) NOT NULL DEFAULT 'outros',
        conta_pai_id BIGINT REFERENCES financeiro_contas_contabeis(id) ON DELETE SET NULL,
        aceita_lancamento BOOLEAN NOT NULL DEFAULT TRUE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_contas_contabeis_empresa ON financeiro_contas_contabeis (empresa_id, ativo, codigo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_formas_cobranca (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(180) NOT NULL,
        tipo VARCHAR(50) NOT NULL DEFAULT 'outro',
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_formas_cobranca_empresa ON financeiro_formas_cobranca (empresa_id, ativo, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_regras_encargos (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        nome VARCHAR(180) NOT NULL,
        aplicacao VARCHAR(20) NOT NULL DEFAULT 'ambos',
        possui_multa BOOLEAN NOT NULL DEFAULT FALSE,
        indice_multa_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
        possui_mora_diaria BOOLEAN NOT NULL DEFAULT FALSE,
        indice_mora_diaria_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
        padrao BOOLEAN NOT NULL DEFAULT FALSE,
        ativo BOOLEAN NOT NULL DEFAULT TRUE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_regras_encargos_empresa ON financeiro_regras_encargos (empresa_id, ativo, aplicacao, nome)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_vendas_pendentes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        orcamento_id BIGINT NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
        cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
        consultor_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'pendente',
        tipo_venda VARCHAR(40) NOT NULL DEFAULT 'venda',
        orcamento_codigo VARCHAR(80),
        orcamento_titulo VARCHAR(180),
        cliente_nome VARCHAR(180),
        cliente_documento VARCHAR(40),
        consultor_nome VARCHAR(180),
        data_venda DATE,
        valor_total NUMERIC(18,2) NOT NULL DEFAULT 0,
        pagamentos_json JSONB,
        itens_json JSONB,
        condicoes TEXT,
        observacoes_comerciais TEXT,
        observacoes_envio TEXT,
        enviado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        enviado_em TIMESTAMPTZ,
        devolvido_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        devolvido_em TIMESTAMPTZ,
        motivo_devolucao TEXT,
        autenticado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        autenticado_em TIMESTAMPTZ,
        cancelado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        cancelado_em TIMESTAMPTZ,
        motivo_cancelamento TEXT,
        lancamentos_gerados INTEGER NOT NULL DEFAULT 0,
        grupo_parcelamento VARCHAR(80),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_financeiro_vendas_pendentes_orcamento UNIQUE (empresa_id, orcamento_id)
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_vendas_pendentes_empresa_status ON financeiro_vendas_pendentes (empresa_id, status, criado_em DESC)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        tipo VARCHAR(20) NOT NULL,
        descricao VARCHAR(240) NOT NULL,
        moeda VARCHAR(10) NOT NULL DEFAULT 'BRL',
        valor_total NUMERIC(18,2) NOT NULL DEFAULT 0,
        valor_pago NUMERIC(18,2) NOT NULL DEFAULT 0,
        data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
        data_vencimento DATE NOT NULL,
        data_pagamento DATE,
        status VARCHAR(30) NOT NULL DEFAULT 'aberto',
        cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
        fornecedor_id BIGINT REFERENCES fornecedores(id) ON DELETE SET NULL,
        categoria_id BIGINT REFERENCES financeiro_categorias(id) ON DELETE SET NULL,
        forma_pagamento_id BIGINT REFERENCES financeiro_formas_pagamento(id) ON DELETE SET NULL,
        conta_banco_id BIGINT REFERENCES financeiro_contas_bancos(id) ON DELETE SET NULL,
        tipo_documento_id BIGINT REFERENCES financeiro_tipos_documento(id) ON DELETE SET NULL,
        natureza_operacao_id BIGINT REFERENCES financeiro_naturezas_operacao(id) ON DELETE SET NULL,
        centro_custo_principal_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL,
        centro_custo_secundario_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL,
        unidade_consumo_principal_id BIGINT REFERENCES financeiro_unidades_consumo(id) ON DELETE SET NULL,
        unidade_consumo_secundaria_id BIGINT REFERENCES financeiro_unidades_consumo(id) ON DELETE SET NULL,
        conta_contabil_id BIGINT REFERENCES financeiro_contas_contabeis(id) ON DELETE SET NULL,
        forma_cobranca_id BIGINT REFERENCES financeiro_formas_cobranca(id) ON DELETE SET NULL,
        regra_encargos_id BIGINT REFERENCES financeiro_regras_encargos(id) ON DELETE SET NULL,
        entidade_emissora_id BIGINT,
        possui_multa BOOLEAN NOT NULL DEFAULT FALSE,
        indice_multa_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
        possui_mora_diaria BOOLEAN NOT NULL DEFAULT FALSE,
        indice_mora_diaria_percent NUMERIC(10,4) NOT NULL DEFAULT 0,
        documento VARCHAR(180),
        observacoes TEXT,
        anexo_url TEXT,
        contato_cobranca VARCHAR(180),
        email_cobranca VARCHAR(255),
        whatsapp_cobranca VARCHAR(40),
        modalidade_pagamento VARCHAR(100),
        nota_fiscal_numero VARCHAR(80),
        nota_fiscal_data_emissao DATE,
        recorrente BOOLEAN NOT NULL DEFAULT FALSE,
        parcelado BOOLEAN NOT NULL DEFAULT FALSE,
        parcela_numero INTEGER,
        parcela_total INTEGER,
        grupo_recorrencia VARCHAR(80),
        grupo_parcelamento VARCHAR(80),
        venda_pendente_id BIGINT REFERENCES financeiro_vendas_pendentes(id) ON DELETE SET NULL,
        origem_tipo VARCHAR(50),
        origem_id BIGINT,
        origem_codigo VARCHAR(100),
        contrato_id BIGINT REFERENCES contratos(id) ON DELETE SET NULL,
        competencia DATE,
        cancelado_em TIMESTAMPTZ,
        cancelado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        motivo_cancelamento TEXT,
        criado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        atualizado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_empresa_tipo_status ON financeiro_lancamentos (empresa_id, tipo, status, data_vencimento)")
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_cliente ON financeiro_lancamentos (empresa_id, cliente_id, data_vencimento)")
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_fornecedor ON financeiro_lancamentos (empresa_id, fornecedor_id, data_vencimento)")
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_contrato_competencia ON financeiro_lancamentos (empresa_id, contrato_id, competencia)")
    _run("CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_lancamentos_contrato_competencia ON financeiro_lancamentos (empresa_id, contrato_id, competencia) WHERE contrato_id IS NOT NULL AND competencia IS NOT NULL")
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_grupo_parcelamento ON financeiro_lancamentos (empresa_id, grupo_parcelamento)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_movimentacoes (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        lancamento_id BIGINT NOT NULL REFERENCES financeiro_lancamentos(id) ON DELETE CASCADE,
        usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        tipo_movimentacao VARCHAR(30) NOT NULL,
        valor NUMERIC(18,2) NOT NULL DEFAULT 0,
        valor_principal NUMERIC(18,2) NOT NULL DEFAULT 0,
        valor_desconto NUMERIC(18,2) NOT NULL DEFAULT 0,
        valor_multa NUMERIC(18,2) NOT NULL DEFAULT 0,
        valor_mora NUMERIC(18,2) NOT NULL DEFAULT 0,
        dias_atraso INTEGER NOT NULL DEFAULT 0,
        data_movimentacao DATE NOT NULL DEFAULT CURRENT_DATE,
        forma_pagamento_id BIGINT REFERENCES financeiro_formas_pagamento(id) ON DELETE SET NULL,
        conta_banco_id BIGINT REFERENCES financeiro_contas_bancos(id) ON DELETE SET NULL,
        observacoes TEXT,
        movimentacao_origem_id BIGINT REFERENCES financeiro_movimentacoes(id) ON DELETE SET NULL,
        comprovante_url TEXT,
        comprovante_nome VARCHAR(255),
        comprovante_mime VARCHAR(120),
        comprovante_tamanho BIGINT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_movimentacoes_lancamento ON financeiro_movimentacoes (empresa_id, lancamento_id, criado_em)")

    _run("""
    CREATE TABLE IF NOT EXISTS financeiro_auditoria (
        id BIGSERIAL PRIMARY KEY,
        empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
        acao VARCHAR(80) NOT NULL,
        entidade VARCHAR(100) NOT NULL,
        entidade_id BIGINT NOT NULL,
        dados_anteriores JSONB,
        dados_novos JSONB,
        motivo TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """)
    _run("CREATE INDEX IF NOT EXISTS ix_financeiro_auditoria_entidade ON financeiro_auditoria (empresa_id, entidade, entidade_id, criado_em DESC)")

    # Sincroniza bancos que já possuíam versões parciais das tabelas financeiras.
    for sql in (
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS grupo_parcelamento VARCHAR(80)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS contato_cobranca VARCHAR(180)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS email_cobranca VARCHAR(255)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS whatsapp_cobranca VARCHAR(40)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS modalidade_pagamento VARCHAR(100)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS nota_fiscal_numero VARCHAR(80)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS nota_fiscal_data_emissao DATE",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS venda_pendente_id BIGINT REFERENCES financeiro_vendas_pendentes(id) ON DELETE SET NULL",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS origem_tipo VARCHAR(50)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS origem_id BIGINT",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS origem_codigo VARCHAR(100)",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS contrato_id BIGINT REFERENCES contratos(id) ON DELETE SET NULL",
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS competencia DATE",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS valor_principal NUMERIC(18,2) NOT NULL DEFAULT 0",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS valor_desconto NUMERIC(18,2) NOT NULL DEFAULT 0",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS valor_multa NUMERIC(18,2) NOT NULL DEFAULT 0",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS valor_mora NUMERIC(18,2) NOT NULL DEFAULT 0",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS dias_atraso INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS comprovante_url TEXT",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS comprovante_nome VARCHAR(255)",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS comprovante_mime VARCHAR(120)",
        "ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS comprovante_tamanho BIGINT",
    ):
        _run(sql)

    # Recorrência financeira dos contratos.
    contract_columns = (
        "financeiro_status VARCHAR(30) NOT NULL DEFAULT 'nao_configurado'",
        "financeiro_frequencia VARCHAR(30)",
        "financeiro_intervalo_meses INTEGER NOT NULL DEFAULT 1",
        "financeiro_primeiro_vencimento DATE",
        "financeiro_dia_vencimento INTEGER",
        "financeiro_meses_antecipacao INTEGER NOT NULL DEFAULT 1",
        "financeiro_forma_cobranca_id BIGINT REFERENCES financeiro_formas_cobranca(id) ON DELETE SET NULL",
        "financeiro_forma_pagamento_id BIGINT REFERENCES financeiro_formas_pagamento(id) ON DELETE SET NULL",
        "financeiro_conta_banco_id BIGINT REFERENCES financeiro_contas_bancos(id) ON DELETE SET NULL",
        "financeiro_categoria_id BIGINT REFERENCES financeiro_categorias(id) ON DELETE SET NULL",
        "financeiro_conta_contabil_id BIGINT REFERENCES financeiro_contas_contabeis(id) ON DELETE SET NULL",
        "financeiro_tipo_documento_id BIGINT REFERENCES financeiro_tipos_documento(id) ON DELETE SET NULL",
        "financeiro_natureza_operacao_id BIGINT REFERENCES financeiro_naturezas_operacao(id) ON DELETE SET NULL",
        "financeiro_centro_custo_principal_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL",
        "financeiro_centro_custo_secundario_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL",
        "financeiro_unidade_consumo_principal_id BIGINT REFERENCES financeiro_unidades_consumo(id) ON DELETE SET NULL",
        "financeiro_unidade_consumo_secundaria_id BIGINT REFERENCES financeiro_unidades_consumo(id) ON DELETE SET NULL",
        "financeiro_regra_encargos_id BIGINT REFERENCES financeiro_regras_encargos(id) ON DELETE SET NULL",
        "financeiro_entidade_emissora_id BIGINT",
        "financeiro_observacoes TEXT",
        "financeiro_proxima_competencia DATE",
        "financeiro_ultima_competencia_gerada DATE",
        "financeiro_ultima_geracao_em TIMESTAMPTZ",
        "financeiro_ativado_em TIMESTAMPTZ",
        "financeiro_ativado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "financeiro_suspenso_em TIMESTAMPTZ",
        "financeiro_cancelado_em TIMESTAMPTZ",
        "financeiro_ultimo_erro TEXT",
        "financeiro_ultimo_erro_em TIMESTAMPTZ",
    )
    for definition in contract_columns:
        _run(f"ALTER TABLE contratos ADD COLUMN IF NOT EXISTS {definition}")

    _run("CREATE INDEX IF NOT EXISTS ix_contratos_financeiro_recorrencia ON contratos (empresa_id, financeiro_status, financeiro_proxima_competencia)")


def downgrade() -> None:
    raise RuntimeError(
        "A migration financeira é irreversível automaticamente para proteger lançamentos e históricos."
    )
