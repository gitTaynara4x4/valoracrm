"""Adiciona fluxo de assinatura eletrônica do contrato pela Área do Cliente SEG.

Revision ID: 20260820_0021
Revises: 20260820_0020
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260820_0021"
down_revision: Union[str, Sequence[str], None] = "20260820_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_status VARCHAR(30) NOT NULL DEFAULT 'nao_enviado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_solicitada_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_enviado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_visualizado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_assinado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_cancelado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_id VARCHAR(96)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinante_nome VARCHAR(220)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinante_documento_mascarado VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_documento_hash_sha256 VARCHAR(64)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_pdf_final_hash_sha256 VARCHAR(64)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_assinatura_evidencias_json TEXT",
    )
    for statement in statements:
        op.execute(statement)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orcamentos_assinatura_seg ON orcamentos (empresa_id, cliente_id, proposta_cliente_assinatura_status, id DESC)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_orcamentos_assinatura_id ON orcamentos (proposta_cliente_assinatura_id) WHERE proposta_cliente_assinatura_id IS NOT NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_orcamentos_assinatura_id")
    op.execute("DROP INDEX IF EXISTS ix_orcamentos_assinatura_seg")
    for column in (
        "proposta_cliente_assinatura_evidencias_json",
        "proposta_cliente_assinatura_pdf_final_hash_sha256",
        "proposta_cliente_assinatura_documento_hash_sha256",
        "proposta_cliente_assinante_documento_mascarado",
        "proposta_cliente_assinante_nome",
        "proposta_cliente_assinatura_id",
        "proposta_cliente_assinatura_cancelado_em",
        "proposta_cliente_assinatura_assinado_em",
        "proposta_cliente_assinatura_visualizado_em",
        "proposta_cliente_assinatura_enviado_por_id",
        "proposta_cliente_assinatura_solicitada_em",
        "proposta_cliente_assinatura_status",
    ):
        op.execute(f"ALTER TABLE orcamentos DROP COLUMN IF EXISTS {column}")
