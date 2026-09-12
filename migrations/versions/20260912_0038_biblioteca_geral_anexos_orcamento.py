"""Biblioteca geral de arquivos técnicos e anexos de orçamento.

Revision ID: 20260912_0038
Revises: 20260910_0037
"""
from __future__ import annotations

from alembic import op

revision = "20260912_0038"
down_revision = "20260910_0037"
branch_labels = None
depends_on = None

PASTAS_CHECK = "ck_arqtec_pastas_um_vinculo"
ARQUIVOS_CHECK = "ck_arqtec_arquivos_um_vinculo"


def upgrade() -> None:
    # Antes era obrigatório existir exatamente um vínculo (cliente OU fornecedor).
    # A biblioteca geral usa ambos nulos. Continua proibido vincular os dois ao mesmo tempo.
    op.execute(
        f'ALTER TABLE public.arquivos_tecnicos_pastas DROP CONSTRAINT IF EXISTS "{PASTAS_CHECK}"'
    )
    op.execute(
        f'ALTER TABLE public.arquivos_tecnicos_arquivos DROP CONSTRAINT IF EXISTS "{ARQUIVOS_CHECK}"'
    )
    op.execute(
        f'''ALTER TABLE public.arquivos_tecnicos_pastas
            ADD CONSTRAINT "{PASTAS_CHECK}"
            CHECK (NOT (cliente_id IS NOT NULL AND fornecedor_id IS NOT NULL))'''
    )
    op.execute(
        f'''ALTER TABLE public.arquivos_tecnicos_arquivos
            ADD CONSTRAINT "{ARQUIVOS_CHECK}"
            CHECK (NOT (cliente_id IS NOT NULL AND fornecedor_id IS NOT NULL))'''
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.orcamento_documentos_anexos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
            orcamento_id BIGINT NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
            arquivo_id BIGINT NOT NULL REFERENCES public.arquivos_tecnicos_arquivos(id) ON DELETE CASCADE,
            ordem INTEGER NOT NULL DEFAULT 0,
            criado_por_id BIGINT REFERENCES public.usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_orcamento_documentos_anexos UNIQUE (orcamento_id, arquivo_id)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orcamento_documentos_anexos_empresa_orcamento
        ON public.orcamento_documentos_anexos (empresa_id, orcamento_id, ordem, id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_orcamento_documentos_anexos_arquivo
        ON public.orcamento_documentos_anexos (arquivo_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_arqtec_pastas_empresa_geral
        ON public.arquivos_tecnicos_pastas (empresa_id, ordem, id)
        WHERE cliente_id IS NULL AND fornecedor_id IS NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_arqtec_arquivos_empresa_geral
        ON public.arquivos_tecnicos_arquivos (empresa_id, pasta_id, criado_em DESC, id DESC)
        WHERE cliente_id IS NULL AND fornecedor_id IS NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.orcamento_documentos_anexos")
    op.execute("DROP INDEX IF EXISTS public.ix_arqtec_arquivos_empresa_geral")
    op.execute("DROP INDEX IF EXISTS public.ix_arqtec_pastas_empresa_geral")

    # O formato antigo não aceita registros gerais. Remove somente os registros
    # sem vínculo antes de restaurar a regra histórica de exatamente um vínculo.
    op.execute(
        "DELETE FROM public.arquivos_tecnicos_arquivos WHERE cliente_id IS NULL AND fornecedor_id IS NULL"
    )
    op.execute(
        "DELETE FROM public.arquivos_tecnicos_pastas WHERE cliente_id IS NULL AND fornecedor_id IS NULL"
    )
    op.execute(
        f'ALTER TABLE public.arquivos_tecnicos_arquivos DROP CONSTRAINT IF EXISTS "{ARQUIVOS_CHECK}"'
    )
    op.execute(
        f'ALTER TABLE public.arquivos_tecnicos_pastas DROP CONSTRAINT IF EXISTS "{PASTAS_CHECK}"'
    )
    op.execute(
        f'''ALTER TABLE public.arquivos_tecnicos_pastas
            ADD CONSTRAINT "{PASTAS_CHECK}"
            CHECK ((cliente_id IS NOT NULL AND fornecedor_id IS NULL)
                OR (cliente_id IS NULL AND fornecedor_id IS NOT NULL))'''
    )
    op.execute(
        f'''ALTER TABLE public.arquivos_tecnicos_arquivos
            ADD CONSTRAINT "{ARQUIVOS_CHECK}"
            CHECK ((cliente_id IS NOT NULL AND fornecedor_id IS NULL)
                OR (cliente_id IS NULL AND fornecedor_id IS NOT NULL))'''
    )
