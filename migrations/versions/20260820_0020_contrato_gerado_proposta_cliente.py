"""Adiciona geração e versionamento do contrato a partir da proposta aprovada.

Revision ID: 20260820_0020
Revises: 20260820_0019
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260820_0020"
down_revision: Union[str, Sequence[str], None] = "20260820_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_status VARCHAR(30) NOT NULL DEFAULT 'nao_gerado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_versao INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_gerado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_gerado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_snapshot_json TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_cliente_atualizado_em TIMESTAMPTZ",
    )
    for statement in statements:
        op.execute(statement)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_contrato_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_contrato_status, id DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orcamentos_contrato_cliente")
    for column in (
        "proposta_cliente_contrato_cliente_atualizado_em",
        "proposta_cliente_contrato_snapshot_json",
        "proposta_cliente_contrato_gerado_por_id",
        "proposta_cliente_contrato_gerado_em",
        "proposta_cliente_contrato_versao",
        "proposta_cliente_contrato_status",
    ):
        op.execute(f"ALTER TABLE orcamentos DROP COLUMN IF EXISTS {column}")
