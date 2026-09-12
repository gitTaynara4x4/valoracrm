"""Layout em mosaico para imagens anexas ao orçamento.

Revision ID: 20260912_0039
Revises: 20260912_0038
"""
from __future__ import annotations

from alembic import op

revision = "20260912_0039"
down_revision = "20260912_0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.orcamentos
        ADD COLUMN IF NOT EXISTS anexos_imagens_por_pagina SMALLINT NOT NULL DEFAULT 1
        """
    )
    op.execute(
        """
        ALTER TABLE public.orcamentos
        DROP CONSTRAINT IF EXISTS ck_orcamentos_anexos_imagens_por_pagina
        """
    )
    op.execute(
        """
        ALTER TABLE public.orcamentos
        ADD CONSTRAINT ck_orcamentos_anexos_imagens_por_pagina
        CHECK (anexos_imagens_por_pagina IN (1, 2, 4, 6))
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.orcamentos
        DROP CONSTRAINT IF EXISTS ck_orcamentos_anexos_imagens_por_pagina
        """
    )
    op.execute(
        """
        ALTER TABLE public.orcamentos
        DROP COLUMN IF EXISTS anexos_imagens_por_pagina
        """
    )
