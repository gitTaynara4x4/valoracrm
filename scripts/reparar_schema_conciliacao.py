from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import text
from backend.database import engine

TABLE = "public.financeiro_cobrancas_externas"
REQUIRED_COLUMNS = {
    "conciliacao_status",
    "conciliado_em",
    "conciliado_movimentacao_id",
    "conciliado_automaticamente",
    "data_recebimento_gateway",
    "valor_recebido_gateway",
}


def get_columns(conn) -> set[str]:
    rows = conn.execute(text("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'financeiro_cobrancas_externas'
    """)).scalars().all()
    return set(rows)


def main() -> int:
    print("[Valora] Reparando schema de conciliação financeira...")

    with engine.begin() as conn:
        exists = conn.execute(text("SELECT to_regclass(:table_name)"), {"table_name": TABLE}).scalar()
        if not exists:
            print(f"ERRO: tabela {TABLE} não existe. Rode primeiro: python -m alembic upgrade head")
            return 2

        before = get_columns(conn)
        missing_before = sorted(REQUIRED_COLUMNS - before)
        print("Colunas ausentes antes:", ", ".join(missing_before) if missing_before else "nenhuma")

        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS conciliacao_status VARCHAR(40)"))
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS conciliado_em TIMESTAMPTZ"))
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS conciliado_movimentacao_id BIGINT"))
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS conciliado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS data_recebimento_gateway DATE"))
        conn.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS valor_recebido_gateway NUMERIC(18,2)"))

        conn.execute(text("""
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
        """))

        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_conciliacao
            ON public.financeiro_cobrancas_externas
               (empresa_id, conciliacao_status, ultima_sincronizacao_em DESC)
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_fin_cobranca_externa_provider_status
            ON public.financeiro_cobrancas_externas
               (provider, provider_status, atualizado_em DESC)
        """))

        conn.execute(text("""
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
        """))

        after = get_columns(conn)
        missing_after = sorted(REQUIRED_COLUMNS - after)
        if missing_after:
            print("ERRO: ainda faltam colunas:", ", ".join(missing_after))
            return 3

        sample = conn.execute(text("""
            SELECT COUNT(*)
            FROM public.financeiro_cobrancas_externas
        """)).scalar_one()

    print("OK: schema de conciliação reparado.")
    print("Colunas obrigatórias presentes:", ", ".join(sorted(REQUIRED_COLUMNS)))
    print(f"Cobranças externas existentes: {sample}")
    print("Agora execute: python -m alembic upgrade head")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
