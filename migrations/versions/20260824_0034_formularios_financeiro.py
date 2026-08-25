"""Campos personalizados para formulários de Contas a Receber/Pagar.

Revision ID: 20260824_0034
Revises: 20260821_0033
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260824_0034"
down_revision: Union[str, Sequence[str], None] = "20260821_0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS public.financeiro_formulario_valores (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
            lancamento_id BIGINT NOT NULL REFERENCES public.financeiro_lancamentos(id) ON DELETE CASCADE,
            formulario_campo_id BIGINT NOT NULL REFERENCES public.formularios_campos(id) ON DELETE CASCADE,
            valor_json JSONB NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_fin_form_valor_lanc_campo UNIQUE (lancamento_id, formulario_campo_id)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_form_valor_empresa_lancamento
        ON public.financeiro_formulario_valores (empresa_id, lancamento_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_form_valor_campo
        ON public.financeiro_formulario_valores (formulario_campo_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.financeiro_formulario_valores")
