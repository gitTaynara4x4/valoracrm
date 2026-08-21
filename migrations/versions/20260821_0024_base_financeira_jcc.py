"""Organiza a base financeira para o fluxo operacional inspirado no JCC.

Revision ID: 20260821_0024
Revises: 20260820_0023
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260821_0024"
down_revision: Union[str, Sequence[str], None] = "20260820_0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # O cadastro de Conta Corrente do JCC possui estes dados e eles também são
    # úteis para identificar corretamente as contas nas futuras baixas/caixa.
    op.execute("ALTER TABLE financeiro_contas_bancos ADD COLUMN IF NOT EXISTS data_cadastro DATE")
    op.execute("ALTER TABLE financeiro_contas_bancos ADD COLUMN IF NOT EXISTS nome_agencia VARCHAR(180)")
    op.execute("ALTER TABLE financeiro_contas_bancos ADD COLUMN IF NOT EXISTS telefone VARCHAR(40)")
    op.execute(
        "UPDATE financeiro_contas_bancos "
        "SET data_cadastro = COALESCE(data_cadastro, data_saldo_inicial, criado_em::date, CURRENT_DATE) "
        "WHERE data_cadastro IS NULL"
    )
    op.execute("ALTER TABLE financeiro_contas_bancos ALTER COLUMN data_cadastro SET DEFAULT CURRENT_DATE")
    op.execute("ALTER TABLE financeiro_contas_bancos ALTER COLUMN data_cadastro SET NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE financeiro_contas_bancos DROP COLUMN IF EXISTS telefone")
    op.execute("ALTER TABLE financeiro_contas_bancos DROP COLUMN IF EXISTS nome_agencia")
    op.execute("ALTER TABLE financeiro_contas_bancos DROP COLUMN IF EXISTS data_cadastro")
