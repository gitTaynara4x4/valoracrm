"""Arquivos técnicos com pastas exclusivamente por cliente.

Revision ID: 20260807_0007
Revises: 20260807_0006
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260807_0007"
down_revision = "20260807_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove pastas padrão vazias criadas automaticamente. Se alguma pasta padrão
    # já recebeu arquivos, ela é preservada e passa a ser uma pasta comum do cliente.
    op.execute("""
        DELETE FROM arquivos_tecnicos_pastas p
        WHERE p.modelo_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM arquivos_tecnicos_arquivos a
              WHERE a.pasta_id = p.id
          )
    """)
    op.execute("UPDATE arquivos_tecnicos_pastas SET modelo_id = NULL WHERE modelo_id IS NOT NULL")
    op.execute("ALTER TABLE arquivos_tecnicos_pastas DROP CONSTRAINT IF EXISTS uq_arqtec_pasta_cliente_modelo")
    op.execute("DROP INDEX IF EXISTS ix_arqtec_pastas_modelo")
    op.execute("ALTER TABLE arquivos_tecnicos_pastas DROP COLUMN IF EXISTS modelo_id")
    op.execute("DROP TABLE IF EXISTS arquivos_tecnicos_pastas_modelo")


def downgrade() -> None:
    op.create_table(
        "arquivos_tecnicos_pastas_modelo",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("empresa_id", sa.BigInteger(), sa.ForeignKey("empresas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nome", sa.String(length=120), nullable=False),
        sa.Column("slug", sa.String(length=140), nullable=False),
        sa.Column("icone", sa.String(length=80), nullable=True),
        sa.Column("ordem", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ativo", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("criado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("atualizado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("empresa_id", "slug", name="uq_arqtec_modelo_empresa_slug"),
    )
    op.create_index("ix_arqtec_modelo_empresa", "arquivos_tecnicos_pastas_modelo", ["empresa_id", "ativo", "ordem", "id"])
    op.add_column(
        "arquivos_tecnicos_pastas",
        sa.Column("modelo_id", sa.BigInteger(), sa.ForeignKey("arquivos_tecnicos_pastas_modelo.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("ix_arqtec_pastas_modelo", "arquivos_tecnicos_pastas", ["modelo_id"])
    op.create_unique_constraint("uq_arqtec_pasta_cliente_modelo", "arquivos_tecnicos_pastas", ["cliente_id", "modelo_id"])
