"""Arquivos técnicos centralizados por cliente.

Revision ID: 20260807_0006
Revises: 20260806_0005
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260807_0006"
down_revision = "20260806_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
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

    op.create_table(
        "arquivos_tecnicos_pastas",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("empresa_id", sa.BigInteger(), sa.ForeignKey("empresas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cliente_id", sa.BigInteger(), sa.ForeignKey("clientes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("modelo_id", sa.BigInteger(), sa.ForeignKey("arquivos_tecnicos_pastas_modelo.id", ondelete="SET NULL"), nullable=True),
        sa.Column("nome", sa.String(length=120), nullable=False),
        sa.Column("icone", sa.String(length=80), nullable=True),
        sa.Column("ordem", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("criado_por_id", sa.BigInteger(), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("criado_por_nome", sa.String(length=120), nullable=True),
        sa.Column("criado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("atualizado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("cliente_id", "modelo_id", name="uq_arqtec_pasta_cliente_modelo"),
    )
    op.create_index("ix_arqtec_pastas_empresa_cliente", "arquivos_tecnicos_pastas", ["empresa_id", "cliente_id", "ordem", "id"])
    op.create_index("ix_arqtec_pastas_modelo", "arquivos_tecnicos_pastas", ["modelo_id"])

    op.create_table(
        "arquivos_tecnicos_arquivos",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("empresa_id", sa.BigInteger(), sa.ForeignKey("empresas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("cliente_id", sa.BigInteger(), sa.ForeignKey("clientes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pasta_id", sa.BigInteger(), sa.ForeignKey("arquivos_tecnicos_pastas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("titulo", sa.String(length=180), nullable=True),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.Column("arquivo_nome", sa.String(length=255), nullable=False),
        sa.Column("arquivo_path", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.String(length=120), nullable=True),
        sa.Column("extensao", sa.String(length=20), nullable=True),
        sa.Column("tamanho_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("usuario_id", sa.BigInteger(), sa.ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True),
        sa.Column("usuario_nome", sa.String(length=120), nullable=True),
        sa.Column("criado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("atualizado_em", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_arqtec_arquivos_empresa_cliente", "arquivos_tecnicos_arquivos", ["empresa_id", "cliente_id", "criado_em"])
    op.create_index("ix_arqtec_arquivos_pasta", "arquivos_tecnicos_arquivos", ["pasta_id", "criado_em"])

    # Empresas existentes já recebem a estrutura inicial. Empresas novas também
    # são atendidas pelo backend na primeira abertura do módulo.
    op.execute("""
        INSERT INTO arquivos_tecnicos_pastas_modelo (empresa_id, nome, slug, icone, ordem, ativo)
        SELECT e.id, v.nome, v.slug, v.icone, v.ordem, true
        FROM empresas e
        CROSS JOIN (VALUES
          ('Dados do Imóvel', 'dados-do-imovel', 'fa-house', 10),
          ('Alarme', 'alarme', 'fa-shield-halved', 20),
          ('CFTV', 'cftv', 'fa-video', 30),
          ('Cerca Elétrica', 'cerca-eletrica', 'fa-bolt', 40),
          ('Controle de Acesso', 'controle-de-acesso', 'fa-id-card', 50),
          ('Interfonia', 'interfonia', 'fa-phone', 60),
          ('Portão / Automação', 'portao-automacao', 'fa-warehouse', 70),
          ('Documentos', 'documentos', 'fa-file-lines', 80),
          ('Outros', 'outros', 'fa-folder', 90)
        ) AS v(nome, slug, icone, ordem)
        ON CONFLICT (empresa_id, slug) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_index("ix_arqtec_arquivos_pasta", table_name="arquivos_tecnicos_arquivos")
    op.drop_index("ix_arqtec_arquivos_empresa_cliente", table_name="arquivos_tecnicos_arquivos")
    op.drop_table("arquivos_tecnicos_arquivos")
    op.drop_index("ix_arqtec_pastas_modelo", table_name="arquivos_tecnicos_pastas")
    op.drop_index("ix_arqtec_pastas_empresa_cliente", table_name="arquivos_tecnicos_pastas")
    op.drop_table("arquivos_tecnicos_pastas")
    op.drop_index("ix_arqtec_modelo_empresa", table_name="arquivos_tecnicos_pastas_modelo")
    op.drop_table("arquivos_tecnicos_pastas_modelo")
