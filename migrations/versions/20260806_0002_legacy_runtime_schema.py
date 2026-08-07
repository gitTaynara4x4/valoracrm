"""Move para Alembic as estruturas que eram criadas no startup/uso.

Revision ID: 20260806_0002
Revises: 20260806_0001
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "20260806_0002"
down_revision: Union[str, Sequence[str], None] = "20260806_0001"
branch_labels = None
depends_on = None


class _MigrationSession:
    """Adaptador transacional para reaproveitar a fotografia do schema legado.

    Commit/rollback ficam sob controle do Alembic. As funções chamadas abaixo
    não são executadas pela API; esta revisão é o único ponto que as aciona.
    """

    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, params=None):
        if params is None:
            return self.connection.execute(statement)
        return self.connection.execute(statement, params)

    def flush(self):
        return None

    def commit(self):
        return None

    def rollback(self):
        return None


def upgrade() -> None:
    from migrations.legacy_schema_snapshot_v1 import (
        _garantir_tabela_layout_localizar,
        ensure_agenda_table,
        ensure_audit_schema,
        ensure_cotacoes_schema,
        ensure_push_schema,
        ensure_schema as ensure_orcamentos_schema,
        garantir_tabela_codigos_sequenciais,
        garantir_tabela_produto_kit,
        garantir_tabela_sequencias_codigo,
    )

    db = _MigrationSession(op.get_bind())

    # A ordem respeita as chaves estrangeiras existentes.
    ensure_agenda_table(db)
    ensure_push_schema(db)
    ensure_audit_schema(db)
    ensure_cotacoes_schema(db)
    garantir_tabela_sequencias_codigo(db)
    garantir_tabela_produto_kit(db)
    garantir_tabela_codigos_sequenciais(db)
    _garantir_tabela_layout_localizar(db)
    ensure_orcamentos_schema(db)


def downgrade() -> None:
    raise RuntimeError(
        "A revisão de adoção do schema legado é irreversível para não apagar dados de produção."
    )
