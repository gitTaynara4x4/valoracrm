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


PASTAS_TABLE = "arquivos_tecnicos_pastas"
ARQUIVOS_TABLE = "arquivos_tecnicos_arquivos"

PASTAS_FK = "fk_arqtec_pastas_fornecedor"
ARQUIVOS_FK = "fk_arqtec_arquivos_fornecedor"

PASTAS_CHECK = "ck_arqtec_pastas_um_vinculo"
ARQUIVOS_CHECK = "ck_arqtec_arquivos_um_vinculo"

PASTAS_INDEX = "ix_arqtec_pastas_empresa_fornecedor"
ARQUIVOS_INDEX = "ix_arqtec_arquivos_empresa_fornecedor"


def _inspector() -> sa.Inspector:
    # Cria um inspector novo a cada consulta para não reutilizar metadados em
    # cache durante a própria migration (por exemplo, depois de ADD COLUMN).
    return sa.inspect(op.get_bind())


def _column_exists(table_name: str, column_name: str) -> bool:
    return any(
        column["name"] == column_name
        for column in _inspector().get_columns(table_name)
    )


def _foreign_key_exists(
    table_name: str,
    local_column: str,
    referred_table: str,
    referred_column: str,
) -> bool:
    for foreign_key in _inspector().get_foreign_keys(table_name):
        if (
            foreign_key.get("constrained_columns") == [local_column]
            and foreign_key.get("referred_table") == referred_table
            and foreign_key.get("referred_columns") == [referred_column]
        ):
            return True
    return False


def _check_constraint_exists(table_name: str, constraint_name: str) -> bool:
    return any(
        constraint.get("name") == constraint_name
        for constraint in _inspector().get_check_constraints(table_name)
    )


def _index_exists(table_name: str, index_name: str) -> bool:
    return any(
        index.get("name") == index_name
        for index in _inspector().get_indexes(table_name)
    )


def _add_fornecedor_column_if_missing(table_name: str) -> None:
    if not _column_exists(table_name, "fornecedor_id"):
        # A FK é criada separadamente para também cobrir bancos em que a coluna
        # já foi adicionada por uma tentativa/deploy anterior, mas sem a FK.
        op.add_column(
            table_name,
            sa.Column("fornecedor_id", sa.BigInteger(), nullable=True),
        )


def _create_fornecedor_fk_if_missing(table_name: str, constraint_name: str) -> None:
    if not _foreign_key_exists(table_name, "fornecedor_id", "fornecedores", "id"):
        op.create_foreign_key(
            constraint_name,
            table_name,
            "fornecedores",
            ["fornecedor_id"],
            ["id"],
            ondelete="CASCADE",
        )


def upgrade() -> None:
    # Esta migration precisa tolerar bancos parcialmente atualizados. Em alguns
    # ambientes fornecedor_id já existe, enquanto alembic_version ainda aponta
    # para 20260807_0007. Repetir ADD COLUMN nesse cenário derruba o startup com
    # psycopg2.errors.DuplicateColumn.
    _add_fornecedor_column_if_missing(PASTAS_TABLE)
    _add_fornecedor_column_if_missing(ARQUIVOS_TABLE)

    _create_fornecedor_fk_if_missing(PASTAS_TABLE, PASTAS_FK)
    _create_fornecedor_fk_if_missing(ARQUIVOS_TABLE, ARQUIVOS_FK)

    # Os registros históricos continuam ligados a clientes. A partir daqui,
    # cada pasta/arquivo pode pertencer a cliente OU fornecedor.
    op.alter_column(
        PASTAS_TABLE,
        "cliente_id",
        existing_type=sa.BigInteger(),
        nullable=True,
    )
    op.alter_column(
        ARQUIVOS_TABLE,
        "cliente_id",
        existing_type=sa.BigInteger(),
        nullable=True,
    )

    if not _check_constraint_exists(PASTAS_TABLE, PASTAS_CHECK):
        op.create_check_constraint(
            PASTAS_CHECK,
            PASTAS_TABLE,
            "(cliente_id IS NOT NULL AND fornecedor_id IS NULL) OR "
            "(cliente_id IS NULL AND fornecedor_id IS NOT NULL)",
        )

    if not _check_constraint_exists(ARQUIVOS_TABLE, ARQUIVOS_CHECK):
        op.create_check_constraint(
            ARQUIVOS_CHECK,
            ARQUIVOS_TABLE,
            "(cliente_id IS NOT NULL AND fornecedor_id IS NULL) OR "
            "(cliente_id IS NULL AND fornecedor_id IS NOT NULL)",
        )

    if not _index_exists(PASTAS_TABLE, PASTAS_INDEX):
        op.create_index(
            PASTAS_INDEX,
            PASTAS_TABLE,
            ["empresa_id", "fornecedor_id", "ordem", "id"],
        )

    if not _index_exists(ARQUIVOS_TABLE, ARQUIVOS_INDEX):
        op.create_index(
            ARQUIVOS_INDEX,
            ARQUIVOS_TABLE,
            ["empresa_id", "fornecedor_id", "criado_em"],
        )


def downgrade() -> None:
    # Downgrade para o formato antigo não consegue representar fornecedores.
    # Remove primeiro apenas os registros desse novo tipo para restaurar a
    # restrição histórica cliente_id NOT NULL sem quebrar a migration.
    if _column_exists(ARQUIVOS_TABLE, "fornecedor_id"):
        op.execute(
            "DELETE FROM arquivos_tecnicos_arquivos "
            "WHERE fornecedor_id IS NOT NULL"
        )
    if _column_exists(PASTAS_TABLE, "fornecedor_id"):
        op.execute(
            "DELETE FROM arquivos_tecnicos_pastas "
            "WHERE fornecedor_id IS NOT NULL"
        )

    # IF EXISTS torna o downgrade seguro inclusive contra estados parciais.
    op.execute(f'DROP INDEX IF EXISTS "{ARQUIVOS_INDEX}"')
    op.execute(f'DROP INDEX IF EXISTS "{PASTAS_INDEX}"')
    op.execute(
        f'ALTER TABLE "{ARQUIVOS_TABLE}" '
        f'DROP CONSTRAINT IF EXISTS "{ARQUIVOS_CHECK}"'
    )
    op.execute(
        f'ALTER TABLE "{PASTAS_TABLE}" '
        f'DROP CONSTRAINT IF EXISTS "{PASTAS_CHECK}"'
    )

    op.alter_column(
        ARQUIVOS_TABLE,
        "cliente_id",
        existing_type=sa.BigInteger(),
        nullable=False,
    )
    op.alter_column(
        PASTAS_TABLE,
        "cliente_id",
        existing_type=sa.BigInteger(),
        nullable=False,
    )

    # DROP COLUMN remove junto qualquer FK/índice remanescente dependente da
    # coluna, inclusive uma FK pré-existente com nome diferente do desta versão.
    if _column_exists(ARQUIVOS_TABLE, "fornecedor_id"):
        op.drop_column(ARQUIVOS_TABLE, "fornecedor_id")
    if _column_exists(PASTAS_TABLE, "fornecedor_id"):
        op.drop_column(PASTAS_TABLE, "fornecedor_id")
