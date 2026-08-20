"""Reparo idempotente do schema do fluxo de proposta do cliente.

Revision ID: 20260820_0023
Revises: 20260820_0022
Create Date: 2026-08-20

Esta migration não cria uma nova funcionalidade. Ela garante que bancos que
receberam os arquivos das etapas de proposta/contrato, mas ficaram com alguma
coluna pendente, tenham o mesmo schema esperado pelo código atual.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260820_0023"
down_revision: Union[str, Sequence[str], None] = "20260820_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    statements = [
        # Etapa 1 — preparação da proposta.
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
        # Etapa 2 — link público e aprovação.
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
        # Etapa 3 — cadastro para contrato.
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_status VARCHAR(40) NOT NULL DEFAULT 'nao_iniciado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_iniciado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_concluido_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_ip VARCHAR(64)",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_cadastro_tipo_pessoa VARCHAR(2)",
        # Etapa 4 — contrato.
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_status VARCHAR(30) NOT NULL DEFAULT 'nao_gerado'",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_versao INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_gerado_em TIMESTAMPTZ",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_gerado_por_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_snapshot_json TEXT",
        "ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS proposta_cliente_contrato_cliente_atualizado_em TIMESTAMPTZ",
        # Etapa 5 — assinatura eletrônica.
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
    ]
    for statement in statements:
        op.execute(statement)

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_empresa_proposta_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_preparada, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_proposta_cliente_link "
        "ON orcamentos (empresa_id, proposta_cliente_link_ativo, proposta_cliente_public_status, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_cadastro_contrato_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_cadastro_status, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_contrato_cliente "
        "ON orcamentos (empresa_id, proposta_cliente_contrato_status, id DESC)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_orcamentos_assinatura_seg "
        "ON orcamentos (empresa_id, cliente_id, proposta_cliente_assinatura_status, id DESC)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_orcamentos_assinatura_id "
        "ON orcamentos (proposta_cliente_assinatura_id) "
        "WHERE proposta_cliente_assinatura_id IS NOT NULL"
    )


def downgrade() -> None:
    # Migration de reparo: as colunas pertencem às migrations 0017–0021.
    # Removê-las aqui destruiria schema/dados de funcionalidades anteriores.
    pass
