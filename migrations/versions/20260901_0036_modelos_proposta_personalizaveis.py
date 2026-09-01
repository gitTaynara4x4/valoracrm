"""Personalizacao persistente dos modelos especiais de proposta.

Revision ID: 20260901_0036
Revises: 20260901_0035
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260901_0036"
down_revision: Union[str, Sequence[str], None] = "20260901_0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS public.orcamento_modelos_proposta_personalizados (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
            modelo_key VARCHAR(60) NOT NULL,
            definicao_json TEXT NOT NULL,
            atualizado_por BIGINT NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_modelo_proposta_personalizado UNIQUE (empresa_id, modelo_key)
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_orcamento_modelos_proposta_personalizados_empresa
        ON public.orcamento_modelos_proposta_personalizados (empresa_id, modelo_key)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS public.ix_orcamento_modelos_proposta_personalizados_empresa")
    op.execute("DROP TABLE IF EXISTS public.orcamento_modelos_proposta_personalizados")
