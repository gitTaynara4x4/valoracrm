"""Automatiza disparos reais da régua de cobrança e registra tentativas/provedor.

Revision ID: 20260817_0015
Revises: 20260817_0014
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260817_0015"
down_revision: Union[str, Sequence[str], None] = "20260817_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS tentativas INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS ultima_tentativa_em TIMESTAMPTZ")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS proxima_tentativa_em TIMESTAMPTZ")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS ultimo_erro_codigo VARCHAR(80)")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS provider VARCHAR(80)")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255)")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS resposta_provider TEXT")
    op.execute("ALTER TABLE financeiro_cobrancas_envios ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_fin_cobranca_envios_automacao "
        "ON financeiro_cobrancas_envios (empresa_id, status, data_prevista, proxima_tentativa_em, id)"
    )

    # O histórico anterior à migration era operado manualmente. Ele não pode
    # inflar a métrica de envios automáticos. Pendentes/erros passam a ser
    # assumidos pelo novo dispatcher a partir daqui.
    op.execute(
        """
        UPDATE financeiro_cobrancas_envios
           SET automatico=CASE WHEN status IN ('pendente','erro') THEN TRUE ELSE FALSE END
        """
    )


def downgrade() -> None:
    # O histórico de entrega não deve ser destruído num downgrade automático.
    op.execute("DROP INDEX IF EXISTS ix_fin_cobranca_envios_automacao")
