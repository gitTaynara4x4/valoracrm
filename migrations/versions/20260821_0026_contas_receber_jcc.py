"""Aproxima Contas a Receber da operação do JCC.

Revision ID: 20260821_0026
Revises: 20260821_0025
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0026"
down_revision: Union[str, Sequence[str], None] = "20260821_0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_lancamentos ADD COLUMN IF NOT EXISTS nosso_numero VARCHAR(100)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_lanc_nosso_numero ON financeiro_lancamentos (empresa_id, nosso_numero) WHERE nosso_numero IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_fin_lanc_nosso_numero")
    op.execute("ALTER TABLE financeiro_lancamentos DROP COLUMN IF EXISTS nosso_numero")
