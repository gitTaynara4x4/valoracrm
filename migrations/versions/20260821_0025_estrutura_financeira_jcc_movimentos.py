"""Integra Plano de Contas, Centro de Custo e Conta Corrente às movimentações.

Revision ID: 20260821_0025
Revises: 20260821_0024
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0025"
down_revision: Union[str, Sequence[str], None] = "20260821_0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS conta_contabil_id BIGINT REFERENCES financeiro_contas_contabeis(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS centro_custo_principal_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL")
    op.execute("ALTER TABLE financeiro_movimentacoes ADD COLUMN IF NOT EXISTS centro_custo_secundario_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_mov_conta_contabil ON financeiro_movimentacoes (empresa_id, conta_contabil_id, data_movimentacao)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_mov_centro_principal ON financeiro_movimentacoes (empresa_id, centro_custo_principal_id, data_movimentacao)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_mov_conta_banco_data ON financeiro_movimentacoes (empresa_id, conta_banco_id, data_movimentacao)")
    op.execute("""
        UPDATE financeiro_movimentacoes m
           SET conta_contabil_id = COALESCE(m.conta_contabil_id, l.conta_contabil_id),
               centro_custo_principal_id = COALESCE(m.centro_custo_principal_id, l.centro_custo_principal_id),
               centro_custo_secundario_id = COALESCE(m.centro_custo_secundario_id, l.centro_custo_secundario_id)
          FROM financeiro_lancamentos l
         WHERE l.id=m.lancamento_id AND l.empresa_id=m.empresa_id
           AND (m.conta_contabil_id IS NULL OR m.centro_custo_principal_id IS NULL OR m.centro_custo_secundario_id IS NULL)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fin_mov_conta_banco_data")
    op.execute("DROP INDEX IF EXISTS ix_fin_mov_centro_principal")
    op.execute("DROP INDEX IF EXISTS ix_fin_mov_conta_contabil")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS centro_custo_secundario_id")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS centro_custo_principal_id")
    op.execute("ALTER TABLE financeiro_movimentacoes DROP COLUMN IF EXISTS conta_contabil_id")
