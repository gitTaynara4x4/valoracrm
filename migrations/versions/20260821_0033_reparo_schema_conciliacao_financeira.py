"""Repara schema de conciliação financeira em bancos desatualizados/incompletos.

Revision ID: 20260821_0033
Revises: 20260821_0032

Esta migration é deliberadamente idempotente. Ela não altera a lógica financeira;
apenas garante que as colunas consumidas pelo backend atual existam mesmo quando
uma base ficou com o schema parcialmente atualizado.
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260821_0033"
down_revision: Union[str, Sequence[str], None] = "20260821_0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS conciliacao_status VARCHAR(40)"
    )
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS conciliado_em TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS conciliado_movimentacao_id BIGINT"
    )
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS conciliado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS data_recebimento_gateway DATE"
    )
    op.execute(
        "ALTER TABLE public.financeiro_cobrancas_externas "
        "ADD COLUMN IF NOT EXISTS valor_recebido_gateway NUMERIC(18,2)"
    )

    # A FK pode ter se perdido em uma atualização parcial. O bloco abaixo só a
    # cria quando a coluna existe, a tabela de movimentos existe e ainda não há
    # uma FK equivalente na coluna.
    op.execute("""
        DO $$
        BEGIN
            IF to_regclass('public.financeiro_movimentacoes') IS NOT NULL
               AND NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE c.contype = 'f'
                      AND n.nspname = 'public'
                      AND t.relname = 'financeiro_cobrancas_externas'
                      AND pg_get_constraintdef(c.oid) LIKE '%(conciliado_movimentacao_id)%'
               ) THEN
                ALTER TABLE public.financeiro_cobrancas_externas
                    ADD CONSTRAINT fk_fin_cobranca_conciliado_movimentacao
                    FOREIGN KEY (conciliado_movimentacao_id)
                    REFERENCES public.financeiro_movimentacoes(id)
                    ON DELETE SET NULL;
            END IF;
        END $$;
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_conciliacao
        ON public.financeiro_cobrancas_externas
           (empresa_id, conciliacao_status, ultima_sincronizacao_em DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_provider_status
        ON public.financeiro_cobrancas_externas
           (provider, provider_status, atualizado_em DESC)
    """)

    # Preenche somente registros ainda sem estado de conciliação. Não mexe em
    # baixas, caixa, banco ou valores já consolidados.
    op.execute("""
        UPDATE public.financeiro_cobrancas_externas
        SET conciliacao_status = CASE
            WHEN UPPER(COALESCE(provider_status, '')) IN ('RECEIVED', 'RECEIVED_IN_CASH')
                THEN 'aguardando_conciliacao'
            WHEN UPPER(COALESCE(provider_status, '')) = 'REFUNDED'
                THEN 'estornado_no_gateway'
            WHEN UPPER(COALESCE(provider_status, '')) IN ('REFUND_REQUESTED', 'REFUND_IN_PROGRESS')
                THEN 'estorno_pendente_gateway'
            ELSE 'aguardando_retorno'
        END
        WHERE conciliacao_status IS NULL
    """)


def downgrade() -> None:
    # Migration de reparo: não removemos colunas no downgrade para não destruir
    # estrutura que pode ter sido criada legitimamente pelas revisions anteriores.
    return
