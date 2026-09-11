"""Garante unicidade dos valores personalizados de produto.

Revision ID: 20260910_0037
Revises: 20260901_0036
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260910_0037"
down_revision: Union[str, Sequence[str], None] = "20260901_0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Instalações antigas podem ter sido criadas antes de a constraint passar
    # a existir no banco. Mantemos o valor mais recentemente atualizado para
    # cada par (produto_id, campo_id) e só então garantimos a unicidade.
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'uq_produtos_campos_valores_produto_campo'
                  AND conrelid = 'public.produtos_campos_valores'::regclass
            ) THEN
                DELETE FROM public.produtos_campos_valores antigo
                USING public.produtos_campos_valores novo
                WHERE antigo.produto_id = novo.produto_id
                  AND antigo.campo_id = novo.campo_id
                  AND (
                      COALESCE(antigo.atualizado_em, antigo.criado_em)
                          < COALESCE(novo.atualizado_em, novo.criado_em)
                      OR (
                          COALESCE(antigo.atualizado_em, antigo.criado_em)
                              = COALESCE(novo.atualizado_em, novo.criado_em)
                          AND antigo.id < novo.id
                      )
                  );

                ALTER TABLE public.produtos_campos_valores
                ADD CONSTRAINT uq_produtos_campos_valores_produto_campo
                UNIQUE (produto_id, campo_id);
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE public.produtos_campos_valores
        DROP CONSTRAINT IF EXISTS uq_produtos_campos_valores_produto_campo
    """)
