"""Adiciona link público e aprovação da proposta pelo cliente.

Revision ID: 20260820_0018
Revises: 20260820_0017
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260820_0018"
down_revision: Union[str, Sequence[str], None] = "20260820_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_versao INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_ativo BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_gerado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_gerado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_expira_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_desativado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_link_desativado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_public_status VARCHAR(40) NOT NULL DEFAULT 'nao_gerado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_snapshot_json TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_snapshot_orcamento_atualizado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_primeira_visualizacao_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_ultima_visualizacao_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_visualizacoes INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_aprovado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_aprovado_ip VARCHAR(64)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_alteracao_solicitada_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_alteracao_mensagem TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_alteracao_ip VARCHAR(64)",
    )
    for statement in statements:
        op.execute(statement)

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_proposta_cliente_link "
        "ON orcamentos (empresa_id, proposta_cliente_link_ativo, proposta_cliente_public_status, id DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orcamentos_proposta_cliente_link")
    for column in (
        "proposta_cliente_alteracao_ip",
        "proposta_cliente_alteracao_mensagem",
        "proposta_cliente_alteracao_solicitada_em",
        "proposta_cliente_aprovado_ip",
        "proposta_cliente_aprovado_em",
        "proposta_cliente_visualizacoes",
        "proposta_cliente_ultima_visualizacao_em",
        "proposta_cliente_primeira_visualizacao_em",
        "proposta_cliente_snapshot_orcamento_atualizado_em",
        "proposta_cliente_snapshot_json",
        "proposta_cliente_public_status",
        "proposta_cliente_link_desativado_por_id",
        "proposta_cliente_link_desativado_em",
        "proposta_cliente_link_expira_em",
        "proposta_cliente_link_gerado_por_id",
        "proposta_cliente_link_gerado_em",
        "proposta_cliente_link_ativo",
        "proposta_cliente_link_versao",
    ):
        op.execute(f"ALTER TABLE orcamentos DROP COLUMN IF EXISTS {column}")
