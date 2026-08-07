from __future__ import annotations

"""Compatibilidade temporária.

A estrutura do banco é administrada exclusivamente pelo Alembic. Este módulo
não executa DDL e não deve ser chamado pelo startup da aplicação.
"""


def bootstrap_database_schema() -> None:
    raise RuntimeError(
        "bootstrap_database_schema foi desativado. Execute `alembic upgrade head`."
    )
