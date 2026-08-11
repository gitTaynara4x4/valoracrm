"""Generaliza classificações financeiras e cria régua de cobrança configurável.

Revision ID: 20260811_0010
Revises: 20260810_0009
"""
from __future__ import annotations

from alembic import op

revision = "20260811_0010"
down_revision = "20260810_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tipo de gasto: valores iniciais seguem a especificação recebida, mas ficam
    # totalmente editáveis por empresa e não são hardcoded na regra de negócio.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_tipos_gasto (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            codigo VARCHAR(40),
            nome VARCHAR(120) NOT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_tipos_gasto_empresa "
        "ON financeiro_tipos_gasto (empresa_id, ativo, nome)"
    )
    op.execute(
        """
        INSERT INTO financeiro_tipos_gasto (empresa_id, codigo, nome, ativo)
        SELECT e.id, v.codigo, v.nome, TRUE
        FROM empresas e
        CROSS JOIN (VALUES
            ('CUSTO', 'Custo'),
            ('DESP', 'Despesa'),
            ('INV', 'Investimento'),
            ('PERDA', 'Perda')
        ) AS v(codigo, nome)
        WHERE NOT EXISTS (
            SELECT 1 FROM financeiro_tipos_gasto tg
            WHERE tg.empresa_id = e.id AND LOWER(tg.nome) = LOWER(v.nome)
        )
        """
    )
    op.execute(
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS "
        "tipo_gasto_id BIGINT REFERENCES financeiro_tipos_gasto(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_tipo_gasto "
        "ON financeiro_lancamentos (empresa_id, tipo_gasto_id, data_vencimento)"
    )

    # Unidade de consumo agora também pode ser estruturada como grupo/subgrupo e
    # classificada por tipo (veículo, patrimônio, colaborador, projeto etc.).
    op.execute(
        "ALTER TABLE financeiro_unidades_consumo ADD COLUMN IF NOT EXISTS "
        "tipo_referencia VARCHAR(50) NOT NULL DEFAULT 'outro'"
    )
    op.execute(
        "ALTER TABLE financeiro_unidades_consumo ADD COLUMN IF NOT EXISTS "
        "unidade_pai_id BIGINT REFERENCES financeiro_unidades_consumo(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_unidades_consumo_pai "
        "ON financeiro_unidades_consumo (empresa_id, unidade_pai_id, ativo, nome)"
    )

    # Régua de cobrança configurável por empresa. O Valora controla etapas e a
    # fila; o envio efetivo depende do canal/integrador configurado pela empresa.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_reguas_cobranca (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nome VARCHAR(160) NOT NULL,
            descricao TEXT,
            padrao BOOLEAN NOT NULL DEFAULT FALSE,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_reguas_cobranca_empresa "
        "ON financeiro_reguas_cobranca (empresa_id, ativo, padrao, nome)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_regua_padrao_empresa "
        "ON financeiro_reguas_cobranca (empresa_id) WHERE padrao = TRUE"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_reguas_cobranca_etapas (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            regua_id BIGINT NOT NULL REFERENCES financeiro_reguas_cobranca(id) ON DELETE CASCADE,
            nome VARCHAR(180) NOT NULL,
            deslocamento_dias INTEGER NOT NULL,
            canal VARCHAR(30) NOT NULL DEFAULT 'whatsapp',
            acao VARCHAR(30) NOT NULL DEFAULT 'lembrete',
            mensagem TEXT,
            ordem INTEGER NOT NULL DEFAULT 0,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_regua_etapas_regua "
        "ON financeiro_reguas_cobranca_etapas (empresa_id, regua_id, ativo, deslocamento_dias, ordem)"
    )

    op.execute(
        "ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS "
        "regua_cobranca_id BIGINT REFERENCES financeiro_reguas_cobranca(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_regua_cobranca "
        "ON financeiro_lancamentos (empresa_id, regua_cobranca_id, data_vencimento)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_cobrancas_envios (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            lancamento_id BIGINT NOT NULL REFERENCES financeiro_lancamentos(id) ON DELETE RESTRICT,
            etapa_id BIGINT NOT NULL REFERENCES financeiro_reguas_cobranca_etapas(id) ON DELETE RESTRICT,
            canal VARCHAR(30) NOT NULL,
            contato_destino VARCHAR(255),
            mensagem TEXT,
            data_prevista DATE NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pendente',
            enviado_em TIMESTAMPTZ,
            ignorado_em TIMESTAMPTZ,
            erro TEXT,
            criado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            atualizado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_financeiro_cobranca_envio_etapa UNIQUE (empresa_id, lancamento_id, etapa_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_cobrancas_envios_fila "
        "ON financeiro_cobrancas_envios (empresa_id, status, data_prevista, id)"
    )

    # Cria uma régua inicial editável que reproduz os marcos solicitados. O texto
    # das mensagens fica vazio porque o documento não define conteúdo/template.
    op.execute(
        """
        INSERT INTO financeiro_reguas_cobranca (empresa_id, nome, descricao, padrao, ativo)
        SELECT e.id, 'Régua padrão',
               'Modelo inicial editável: lembrete pré-vencimento, atrasos, bloqueio e protesto.',
               TRUE, TRUE
        FROM empresas e
        WHERE NOT EXISTS (
            SELECT 1 FROM financeiro_reguas_cobranca r WHERE r.empresa_id = e.id
        )
        """
    )
    op.execute(
        """
        INSERT INTO financeiro_reguas_cobranca_etapas
            (empresa_id, regua_id, nome, deslocamento_dias, canal, acao, mensagem, ordem, ativo)
        SELECT r.empresa_id, r.id, v.nome, v.dias, 'whatsapp', v.acao, NULL, v.ordem, TRUE
        FROM financeiro_reguas_cobranca r
        CROSS JOIN (VALUES
            ('Lembrete antes do vencimento', -2, 'lembrete', 10),
            ('1ª notificação de atraso', 5, 'lembrete', 20),
            ('2ª notificação de atraso', 15, 'alerta', 30),
            ('3ª notificação de atraso', 20, 'alerta', 40),
            ('Alerta de bloqueio', 30, 'bloqueio', 50),
            ('Alerta de protesto', 35, 'protesto', 60)
        ) AS v(nome, dias, acao, ordem)
        WHERE r.padrao = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM financeiro_reguas_cobranca_etapas e
              WHERE e.empresa_id = r.empresa_id
                AND e.regua_id = r.id
                AND e.deslocamento_dias = v.dias
                AND e.acao = v.acao
          )
        """
    )


def downgrade() -> None:
    # Preserva histórico financeiro. As novas tabelas podem conter decisões de
    # cobrança e por isso não são removidas automaticamente.
    raise RuntimeError(
        "A migration de generalização financeira é irreversível automaticamente para proteger históricos."
    )
