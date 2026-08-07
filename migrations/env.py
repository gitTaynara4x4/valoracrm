from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".ENV")

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

url = os.getenv("DATABASE_URL")
if not url:
    raise RuntimeError("DATABASE_URL não definido para executar as migrations.")
config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))

# Importa todos os modelos para permitir `alembic revision --autogenerate` no futuro.
from backend.database import Base  # noqa: E402
from backend import models  # noqa: F401,E402
from backend import models_area_cliente  # noqa: F401,E402
from backend import models_area_cliente_acesso  # noqa: F401,E402
from backend import models_contratos  # noqa: F401,E402

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # Tabelas administradas por SQL explícito nas migrations 0002/0003 não fazem
    # parte do metadata ORM e não devem ser removidas por autogenerate.
    return name != "alembic_version"


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
        transaction_per_migration=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        pool_pre_ping=True,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
            transaction_per_migration=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
