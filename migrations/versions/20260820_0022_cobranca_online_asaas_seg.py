"""Adiciona cobrança online real (Asaas) aos títulos do cliente SEG.

Revision ID: 20260820_0022
Revises: 20260820_0021
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260820_0022"
down_revision: Union[str, Sequence[str], None] = "20260820_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_cobrancas_externas (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            lancamento_id BIGINT NOT NULL REFERENCES financeiro_lancamentos(id) ON DELETE CASCADE,
            cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
            provider VARCHAR(30) NOT NULL,
            provider_customer_id VARCHAR(100),
            provider_payment_id VARCHAR(100) NOT NULL,
            billing_type VARCHAR(30),
            provider_status VARCHAR(50),
            invoice_url TEXT,
            bank_slip_url TEXT,
            identification_field TEXT,
            barcode TEXT,
            pix_payload TEXT,
            pix_expiration TIMESTAMPTZ,
            provider_payload_json TEXT,
            ultimo_evento VARCHAR(120),
            ultima_sincronizacao_em TIMESTAMPTZ,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_financeiro_cobranca_externa_lancamento UNIQUE (empresa_id, lancamento_id),
            CONSTRAINT uq_financeiro_cobranca_externa_provider_payment UNIQUE (provider, provider_payment_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_financeiro_cobrancas_externas_cliente ON financeiro_cobrancas_externas (empresa_id, cliente_id, atualizado_em DESC)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_gateway_eventos (
            id BIGSERIAL PRIMARY KEY,
            provider VARCHAR(30) NOT NULL,
            provider_event_id VARCHAR(180) NOT NULL,
            provider_payment_id VARCHAR(100),
            evento VARCHAR(100),
            payload_json TEXT,
            recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_financeiro_gateway_evento UNIQUE (provider, provider_event_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS financeiro_gateway_eventos")
    op.execute("DROP TABLE IF EXISTS financeiro_cobrancas_externas")
