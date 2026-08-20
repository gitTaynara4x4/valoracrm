"""Adiciona preparação da proposta para envio/aprovação do cliente.

Revision ID: 20260820_0017
Revises: 20260818_0016
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260820_0017"
down_revision: Union[str, Sequence[str], None] = "20260818_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = (
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_natureza VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_servicos_json TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_planos_json TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_tipo_contrato VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_valor_implantacao NUMERIC(18,4) NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_valor_mensal NUMERIC(18,4) NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_dia_vencimento SMALLINT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_forma_pagamento VARCHAR(40)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_condicao_pagamento VARCHAR(180)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_preparada BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_preparada_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_preparada_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
    )
    for statement in statements:
        op.execute(statement)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_proposta_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_preparada, id DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orcamentos_empresa_proposta_cliente")
    for column in (
        "proposta_cliente_preparada_por_id",
        "proposta_cliente_preparada_em",
        "proposta_cliente_preparada",
        "proposta_cliente_condicao_pagamento",
        "proposta_cliente_forma_pagamento",
        "proposta_cliente_dia_vencimento",
        "proposta_cliente_valor_mensal",
        "proposta_cliente_valor_implantacao",
        "proposta_cliente_tipo_contrato",
        "proposta_cliente_planos_json",
        "proposta_cliente_servicos_json",
        "proposta_cliente_natureza",
    ):
        op.execute(f"ALTER TABLE orcamentos DROP COLUMN IF EXISTS {column}")
