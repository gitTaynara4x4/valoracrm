"""Adiciona acompanhamento do cadastro para contrato após aprovação pública.

Revision ID: 20260820_0019
Revises: 20260820_0018
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260820_0019"
down_revision: Union[str, Sequence[str], None] = "20260820_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_status VARCHAR(40) NOT NULL DEFAULT 'nao_iniciado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_iniciado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_concluido_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_ip VARCHAR(64)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_tipo_pessoa VARCHAR(2)",
    )
    for statement in statements:
        op.execute(statement)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_cadastro_contrato_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_cadastro_status, id DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orcamentos_cadastro_contrato_cliente")
    for column in (
        "proposta_cliente_cadastro_tipo_pessoa",
        "proposta_cliente_cadastro_ip",
        "proposta_cliente_cadastro_concluido_em",
        "proposta_cliente_cadastro_iniciado_em",
        "proposta_cliente_cadastro_status",
    ):
        op.execute(f"ALTER TABLE orcamentos DROP COLUMN IF EXISTS {column}")
