"""Arquivos técnicos também vinculados a fornecedores.

Revision ID: 20260810_0008
Revises: 20260807_0007
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260810_0008"
down_revision = "20260807_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "arquivos_tecnicos_pastas",
        sa.Column(
            "fornecedor_id",
            sa.BigInteger(),
            sa.ForeignKey("fornecedores.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.add_column(
        "arquivos_tecnicos_arquivos",
        sa.Column(
            "fornecedor_id",
            sa.BigInteger(),
            sa.ForeignKey("fornecedores.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )

    # Os registros históricos continuam ligados a clientes. A partir daqui,
    # cada pasta/arquivo pode pertencer a cliente OU fornecedor.
    op.alter_column("arquivos_tecnicos_pastas", "cliente_id", existing_type=sa.BigInteger(), nullable=True)
    op.alter_column("arquivos_tecnicos_arquivos", "cliente_id", existing_type=sa.BigInteger(), nullable=True)

    op.create_check_constraint(
        "ck_arqtec_pastas_um_vinculo",
        "arquivos_tecnicos_pastas",
        "(cliente_id IS NOT NULL AND fornecedor_id IS NULL) OR (cliente_id IS NULL AND fornecedor_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_arqtec_arquivos_um_vinculo",
        "arquivos_tecnicos_arquivos",
        "(cliente_id IS NOT NULL AND fornecedor_id IS NULL) OR (cliente_id IS NULL AND fornecedor_id IS NOT NULL)",
    )

    op.create_index(
        "ix_arqtec_pastas_empresa_fornecedor",
        "arquivos_tecnicos_pastas",
        ["empresa_id", "fornecedor_id", "ordem", "id"],
    )
    op.create_index(
        "ix_arqtec_arquivos_empresa_fornecedor",
        "arquivos_tecnicos_arquivos",
        ["empresa_id", "fornecedor_id", "criado_em"],
    )


def downgrade() -> None:
    # Downgrade para o formato antigo não consegue representar fornecedores.
    # Remove primeiro apenas os registros desse novo tipo para restaurar a
    # restrição histórica cliente_id NOT NULL sem quebrar a migration.
    op.execute("DELETE FROM arquivos_tecnicos_arquivos WHERE fornecedor_id IS NOT NULL")
    op.execute("DELETE FROM arquivos_tecnicos_pastas WHERE fornecedor_id IS NOT NULL")

    op.drop_index("ix_arqtec_arquivos_empresa_fornecedor", table_name="arquivos_tecnicos_arquivos")
    op.drop_index("ix_arqtec_pastas_empresa_fornecedor", table_name="arquivos_tecnicos_pastas")
    op.drop_constraint("ck_arqtec_arquivos_um_vinculo", "arquivos_tecnicos_arquivos", type_="check")
    op.drop_constraint("ck_arqtec_pastas_um_vinculo", "arquivos_tecnicos_pastas", type_="check")

    op.alter_column("arquivos_tecnicos_arquivos", "cliente_id", existing_type=sa.BigInteger(), nullable=False)
    op.alter_column("arquivos_tecnicos_pastas", "cliente_id", existing_type=sa.BigInteger(), nullable=False)

    op.drop_column("arquivos_tecnicos_arquivos", "fornecedor_id")
    op.drop_column("arquivos_tecnicos_pastas", "fornecedor_id")
