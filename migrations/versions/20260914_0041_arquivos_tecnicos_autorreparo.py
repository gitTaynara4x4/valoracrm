"""Adicionar hash para autorreparo de arquivos técnicos.

Revision ID: 20260914_0041
Revises: 20260914_0040
"""
from __future__ import annotations

from alembic import op

revision = "20260914_0041"
down_revision = "20260914_0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        ADD COLUMN IF NOT EXISTS arquivo_sha256 VARCHAR(64) NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_arquivos_tecnicos_arquivos_empresa_sha256
        ON public.arquivos_tecnicos_arquivos (empresa_id, arquivo_sha256)
        WHERE arquivo_sha256 IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_arquivos_tecnicos_arquivos_empresa_sha256")
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        DROP COLUMN IF EXISTS arquivo_sha256
        """
    )
