"""Completa a baixa do Contas a Receber na lógica do JCC.

Revision ID: 20260821_0027
Revises: 20260821_0026
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0027"
down_revision: Union[str, Sequence[str], None] = "20260821_0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS valor_acrescimo NUMERIC(14,2) NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS modalidade_baixa VARCHAR(20)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_mov_modalidade_baixa ON financeiro_movimentacoes (empresa_id, modalidade_baixa, data_movimentacao) WHERE tipo_movimentacao = 'baixa'")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fin_mov_modalidade_baixa")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS modalidade_baixa")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS valor_acrescimo")
