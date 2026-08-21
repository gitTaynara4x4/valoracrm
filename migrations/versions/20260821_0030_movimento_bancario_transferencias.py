"""Movimento bancário e transferências entre contas sem receita/despesa.

Revision ID: 20260821_0030
Revises: 20260821_0029
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0030"
down_revision: Union[str, Sequence[str], None] = "20260821_0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_transferencias (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            data_transferencia DATE NOT NULL,
            conta_origem_id BIGINT NOT NULL REFERENCES financeiro_contas_bancos(id) ON DELETE RESTRICT,
            conta_destino_id BIGINT NOT NULL REFERENCES financeiro_contas_bancos(id) ON DELETE RESTRICT,
            documento VARCHAR(120),
            historico TEXT NOT NULL,
            valor NUMERIC(18,2) NOT NULL CHECK (valor > 0),
            chave_idempotencia VARCHAR(100),
            status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','cancelado')),
            motivo_cancelamento TEXT,
            cancelado_por_usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            cancelado_em TIMESTAMPTZ,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT ck_fin_transfer_contas_distintas CHECK (conta_origem_id <> conta_destino_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_transfer_empresa_data ON financeiro_transferencias (empresa_id, data_transferencia, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_transfer_origem_data ON financeiro_transferencias (empresa_id, conta_origem_id, data_transferencia)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_transfer_destino_data ON financeiro_transferencias (empresa_id, conta_destino_id, data_transferencia)")
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_transfer_idempotencia
        ON financeiro_transferencias (empresa_id, chave_idempotencia)
        WHERE chave_idempotencia IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS financeiro_transferencias")
