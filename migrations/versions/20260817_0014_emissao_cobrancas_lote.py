"""Adiciona emissão de cobranças em lote com histórico por título.

Revision ID: 20260817_0014
Revises: 20260817_0013
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260817_0014"
down_revision: Union[str, Sequence[str], None] = "20260817_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_cobrancas_emissoes (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
            periodo_inicio DATE NOT NULL,
            periodo_fim DATE NOT NULL,
            cliente_filtro_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
            forma_cobranca_filtro_id BIGINT REFERENCES financeiro_formas_cobranca(id) ON DELETE SET NULL,
            total_titulos INTEGER NOT NULL DEFAULT 0,
            valor_total_titulos NUMERIC(18,2) NOT NULL DEFAULT 0,
            saldo_total_emitido NUMERIC(18,2) NOT NULL DEFAULT 0,
            criado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_fin_cobr_emissoes_periodo CHECK (periodo_fim >= periodo_inicio),
            CONSTRAINT ck_fin_cobr_emissoes_totais CHECK (
                total_titulos >= 0 AND valor_total_titulos >= 0 AND saldo_total_emitido >= 0
            )
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fin_cobr_emissoes_empresa_data "
        "ON financeiro_cobrancas_emissoes (empresa_id, data_emissao DESC, id DESC)"
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_cobrancas_emissao_itens (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            emissao_id BIGINT NOT NULL REFERENCES financeiro_cobrancas_emissoes(id) ON DELETE CASCADE,
            lancamento_id BIGINT NOT NULL REFERENCES financeiro_lancamentos(id) ON DELETE RESTRICT,
            cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
            forma_cobranca_id BIGINT REFERENCES financeiro_formas_cobranca(id) ON DELETE SET NULL,
            data_vencimento DATE NOT NULL,
            valor_titulo NUMERIC(18,2) NOT NULL DEFAULT 0,
            saldo_emitido NUMERIC(18,2) NOT NULL DEFAULT 0,
            cliente_nome VARCHAR(240),
            forma_cobranca_nome VARCHAR(180),
            documento VARCHAR(180),
            descricao VARCHAR(240),
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_fin_cobr_emissao_itens_valores CHECK (valor_titulo >= 0 AND saldo_emitido >= 0),
            CONSTRAINT uq_fin_cobr_emissao_item_lancamento UNIQUE (empresa_id, lancamento_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fin_cobr_emissao_itens_lote "
        "ON financeiro_cobrancas_emissao_itens (empresa_id, emissao_id, data_vencimento, lancamento_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fin_cobr_emissao_itens_cliente "
        "ON financeiro_cobrancas_emissao_itens (empresa_id, cliente_id, forma_cobranca_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fin_cobr_emissao_itens_cliente")
    op.execute("DROP INDEX IF EXISTS ix_fin_cobr_emissao_itens_lote")
    op.execute("DROP TABLE IF EXISTS financeiro_cobrancas_emissao_itens")
    op.execute("DROP INDEX IF EXISTS ix_fin_cobr_emissoes_empresa_data")
    op.execute("DROP TABLE IF EXISTS financeiro_cobrancas_emissoes")
