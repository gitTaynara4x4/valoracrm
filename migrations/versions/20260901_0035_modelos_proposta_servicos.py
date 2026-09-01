"""Modelos de proposta de serviços dentro de Orçamentos.

Revision ID: 20260901_0035
Revises: 20260824_0034
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260901_0035"
down_revision: Union[str, Sequence[str], None] = "20260824_0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS proposta_modelo VARCHAR(60) NOT NULL DEFAULT 'padrao'")
    op.execute("ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS proposta_comercial_json TEXT")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_proposta_modelo ON public.orcamentos (empresa_id, proposta_modelo, id DESC)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_orcamentos_empresa_proposta_modelo")
    op.execute("ALTER TABLE public.orcamentos DROP COLUMN IF EXISTS proposta_comercial_json")
    op.execute("ALTER TABLE public.orcamentos DROP COLUMN IF EXISTS proposta_modelo")
