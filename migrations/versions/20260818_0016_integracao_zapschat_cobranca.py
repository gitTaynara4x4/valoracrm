"""Integra o Valora ao ZapsChat por empresa e instância de cobrança.

Revision ID: 20260818_0016
Revises: 20260817_0015
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260818_0016"
down_revision: Union[str, Sequence[str], None] = "20260817_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS integracoes_zapschat_empresas (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            base_url VARCHAR(500) NOT NULL,
            api_token TEXT NOT NULL,
            zapschat_empresa_id BIGINT NOT NULL,
            zapschat_empresa_nome VARCHAR(180),
            instancia_id BIGINT,
            instancia_apelido VARCHAR(180),
            instancia_nome VARCHAR(255),
            instancia_numero VARCHAR(40),
            instancia_connected BOOLEAN NOT NULL DEFAULT FALSE,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            pareado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ultima_verificacao_em TIMESTAMPTZ,
            ultimo_erro TEXT,
            criado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            atualizado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_integracoes_zapschat_empresa UNIQUE (empresa_id)
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_integracoes_zapschat_ativo "
        "ON integracoes_zapschat_empresas (empresa_id, ativo)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_integracoes_zapschat_ativo")
    op.execute("DROP TABLE IF EXISTS integracoes_zapschat_empresas")
