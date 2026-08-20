"""Adiciona reparcelamento do saldo durante a baixa de Contas a Pagar.

Revision ID: 20260817_0013
Revises: 20260817_0012
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260817_0013"
down_revision: Union[str, Sequence[str], None] = "20260817_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS financeiro_reparcelamentos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            lancamento_origem_id BIGINT NOT NULL REFERENCES financeiro_lancamentos(id) ON DELETE RESTRICT,
            movimentacao_baixa_id BIGINT NOT NULL REFERENCES financeiro_movimentacoes(id) ON DELETE RESTRICT,
            grupo_parcelamento VARCHAR(80) NOT NULL,
            valor_original NUMERIC(18,2) NOT NULL,
            valor_pago_acumulado_antes NUMERIC(18,2) NOT NULL DEFAULT 0,
            valor_principal_baixa NUMERIC(18,2) NOT NULL DEFAULT 0,
            saldo_reparcelado NUMERIC(18,2) NOT NULL,
            quantidade_parcelas INTEGER NOT NULL,
            data_primeiro_vencimento DATE NOT NULL,
            intervalo_meses INTEGER NOT NULL DEFAULT 1,
            lancamentos_gerados_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            status VARCHAR(20) NOT NULL DEFAULT 'ativo',
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_financeiro_reparcelamentos_valores CHECK (
                valor_original >= 0 AND valor_pago_acumulado_antes >= 0
                AND valor_principal_baixa >= 0 AND saldo_reparcelado > 0
            ),
            CONSTRAINT ck_financeiro_reparcelamentos_parcelas CHECK (quantidade_parcelas BETWEEN 2 AND 120),
            CONSTRAINT ck_financeiro_reparcelamentos_intervalo CHECK (intervalo_meses BETWEEN 1 AND 24),
            CONSTRAINT uq_financeiro_reparcelamento_baixa UNIQUE (empresa_id, movimentacao_baixa_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_reparcelamentos_origem "
        "ON financeiro_reparcelamentos (empresa_id, lancamento_origem_id, criado_em DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_reparcelamentos_grupo "
        "ON financeiro_reparcelamentos (empresa_id, grupo_parcelamento)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_financeiro_lancamentos_origem_reparcelamento "
        "ON financeiro_lancamentos (empresa_id, origem_tipo, origem_id) "
        "WHERE origem_tipo = 'reparcelamento'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_financeiro_lancamentos_origem_reparcelamento")
    op.execute("DROP INDEX IF EXISTS ix_financeiro_reparcelamentos_grupo")
    op.execute("DROP INDEX IF EXISTS ix_financeiro_reparcelamentos_origem")
    op.execute("DROP TABLE IF EXISTS financeiro_reparcelamentos")
