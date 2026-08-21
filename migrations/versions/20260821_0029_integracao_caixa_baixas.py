"""Integra baixas/estornos ao Caixa e protege retentativas de baixa.

Revision ID: 20260821_0029
Revises: 20260821_0028
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0029"
down_revision: Union[str, Sequence[str], None] = "20260821_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS chave_idempotencia VARCHAR(100)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_mov_baixa_idempotencia
        ON financeiro_movimentacoes (empresa_id, lancamento_id, chave_idempotencia)
        WHERE tipo_movimentacao = 'baixa' AND chave_idempotencia IS NOT NULL
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_mov_conta_data_tipo
        ON financeiro_movimentacoes (empresa_id, conta_banco_id, data_movimentacao, tipo_movimentacao)
        WHERE conta_banco_id IS NOT NULL
    """)

    # O endpoint de estorno já usa FOR UPDATE; o índice abaixo acrescenta uma
    # segunda barreira no banco. Em bases antigas com duplicidade histórica,
    # preservamos os registros e apenas não criamos o índice único.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM financeiro_movimentacoes
                WHERE tipo_movimentacao = 'estorno'
                  AND movimentacao_origem_id IS NOT NULL
                GROUP BY empresa_id, movimentacao_origem_id
                HAVING COUNT(*) > 1
            ) THEN
                CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_mov_estorno_origem
                ON financeiro_movimentacoes (empresa_id, movimentacao_origem_id)
                WHERE tipo_movimentacao = 'estorno' AND movimentacao_origem_id IS NOT NULL;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_fin_mov_estorno_origem")
    op.execute("DROP INDEX IF EXISTS ix_fin_mov_conta_data_tipo")
    op.execute("DROP INDEX IF EXISTS uq_fin_mov_baixa_idempotencia")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS chave_idempotencia")
