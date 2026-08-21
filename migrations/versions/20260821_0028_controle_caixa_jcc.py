"""Controle de Caixa com registros, edição, saldos diários e resumo no padrão JCC.

Revision ID: 20260821_0028
Revises: 20260821_0027
"""
from __future__ import annotations

from typing import Sequence, Union
from alembic import op

revision: str = "20260821_0028"
down_revision: Union[str, Sequence[str], None] = "20260821_0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS financeiro_caixa_movimentos (
            id BIGSERIAL PRIMARY KEY,
            empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
            tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('credito', 'debito')),
            data_movimentacao DATE NOT NULL,
            documento VARCHAR(120),
            historico TEXT NOT NULL,
            valor NUMERIC(18,2) NOT NULL CHECK (valor > 0),
            conta_banco_id BIGINT NOT NULL REFERENCES financeiro_contas_bancos(id) ON DELETE RESTRICT,
            conta_contabil_id BIGINT NOT NULL REFERENCES financeiro_contas_contabeis(id) ON DELETE RESTRICT,
            centro_custo_principal_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL,
            centro_custo_secundario_id BIGINT REFERENCES financeiro_centros_custo(id) ON DELETE SET NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
            motivo_cancelamento TEXT,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_caixa_mov_empresa_data ON financeiro_caixa_movimentos (empresa_id, data_movimentacao, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_caixa_mov_conta_data ON financeiro_caixa_movimentos (empresa_id, conta_banco_id, data_movimentacao)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_fin_caixa_mov_plano_data ON financeiro_caixa_movimentos (empresa_id, conta_contabil_id, data_movimentacao)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS financeiro_caixa_movimentos")
