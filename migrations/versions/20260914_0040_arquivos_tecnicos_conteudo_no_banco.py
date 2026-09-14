"""Persistir conteúdo dos arquivos técnicos no PostgreSQL.

Revision ID: 20260914_0040
Revises: 20260912_0039
"""
from __future__ import annotations

from alembic import op

revision = "20260914_0040"
down_revision = "20260912_0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        ADD COLUMN IF NOT EXISTS arquivo_conteudo BYTEA NULL
        """
    )
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        ADD COLUMN IF NOT EXISTS conteudo_no_banco BOOLEAN NOT NULL DEFAULT FALSE
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        DROP COLUMN IF EXISTS conteudo_no_banco
        """
    )
    op.execute(
        """
        ALTER TABLE public.arquivos_tecnicos_arquivos
        DROP COLUMN IF EXISTS arquivo_conteudo
        """
    )
