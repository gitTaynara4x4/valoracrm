"""Garante unicidade dos valores personalizados de produto.

Revision ID: 20260910_0037
Revises: 20260901_0036

Esta migration precisa ser idempotente porque algumas bases antigas já receberam
um índice único equivalente fora do Alembic. Nesses casos não devemos tentar
criar outra constraint com o mesmo nome/relação.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

revision: str = "20260910_0037"
down_revision: Union[str, Sequence[str], None] = "20260901_0036"
branch_labels = None
depends_on = None

TABLE_NAME = "produtos_campos_valores"
SCHEMA_NAME = "public"
CONSTRAINT_NAME = "uq_produtos_campos_valores_produto_campo"
FALLBACK_INDEX_NAME = "uq_produtos_campos_valores_produto_campo_idx"


def _tem_unicidade_produto_campo() -> bool:
    """Retorna True se já existe UNIQUE válido para (produto_id, campo_id).

    Considera tanto constraints UNIQUE quanto índices UNIQUE independentes.
    Isso evita o DuplicateTable quando uma instalação já possui o índice com
    o mesmo nome que a constraint planejada.
    """
    bind = op.get_bind()
    return bool(
        bind.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_index i
                    JOIN pg_class tbl ON tbl.oid = i.indrelid
                    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    WHERE ns.nspname = :schema_name
                      AND tbl.relname = :table_name
                      AND i.indisunique
                      AND i.indisvalid
                      AND i.indisready
                      AND i.indpred IS NULL
                      AND i.indexprs IS NULL
                      AND replace(pg_get_indexdef(i.indexrelid), ' ', '')
                          LIKE '%(produto_id,campo_id)%'
                )
                """
            ),
            {"schema_name": SCHEMA_NAME, "table_name": TABLE_NAME},
        ).scalar()
    )


def _nome_relacao_ocupado(nome: str) -> bool:
    bind = op.get_bind()
    return bool(
        bind.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM pg_class c
                    JOIN pg_namespace ns ON ns.oid = c.relnamespace
                    WHERE ns.nspname = :schema_name
                      AND c.relname = :relation_name
                )
                """
            ),
            {"schema_name": SCHEMA_NAME, "relation_name": nome},
        ).scalar()
    )


def upgrade() -> None:
    # Se a base já tem a proteção correta, não recria. Esse é exatamente o
    # cenário que causava DuplicateTable em produção.
    if _tem_unicidade_produto_campo():
        return

    # Bases antigas podem conter mais de uma linha para o mesmo produto/campo.
    # Mantemos a versão mais recentemente atualizada antes de criar o UNIQUE.
    op.execute(
        """
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
          )
        """
    )

    # Reconfere depois da limpeza. Em ambientes concorrentes outra instância
    # pode ter criado a proteção enquanto a migration estava executando.
    if _tem_unicidade_produto_campo():
        return

    # Quando o nome principal já está ocupado por um índice/relação legado,
    # criar uma constraint com o mesmo nome gera DuplicateTable. Nesse caso
    # criamos um índice UNIQUE equivalente com nome alternativo. O PostgreSQL
    # usa esse índice normalmente para ON CONFLICT (produto_id, campo_id).
    if _nome_relacao_ocupado(CONSTRAINT_NAME):
        op.execute(
            f"""
            CREATE UNIQUE INDEX IF NOT EXISTS {FALLBACK_INDEX_NAME}
            ON public.produtos_campos_valores (produto_id, campo_id)
            """
        )
    else:
        op.execute(
            f"""
            ALTER TABLE public.produtos_campos_valores
            ADD CONSTRAINT {CONSTRAINT_NAME}
            UNIQUE (produto_id, campo_id)
            """
        )


def downgrade() -> None:
    # Remove qualquer uma das formas que esta migration pode ter criado.
    op.execute(
        f"""
        ALTER TABLE public.produtos_campos_valores
        DROP CONSTRAINT IF EXISTS {CONSTRAINT_NAME}
        """
    )
    op.execute(
        f"""
        DROP INDEX IF EXISTS public.{FALLBACK_INDEX_NAME}
        """
    )
