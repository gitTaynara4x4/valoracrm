from __future__ import annotations

import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
load_dotenv(ROOT / ".ENV")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL não definido para executar as migrations.")

LOCK_NAME = "valora_alembic_migrations_v1"


def alembic_config() -> Config:
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "migrations"))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL.replace("%", "%%"))
    return cfg


def main() -> None:
    cfg = alembic_config()
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)

    # Lock de sessão: evita dois containers aplicando revisões simultaneamente.
    with engine.connect() as lock_connection:
        lock_connection.execute(
            text("SELECT pg_advisory_lock(hashtext(:name))"),
            {"name": LOCK_NAME},
        )
        try:
            print("[MIGRATIONS] Executando alembic upgrade head...")
            command.upgrade(cfg, "head")
            print("[MIGRATIONS] Banco atualizado com sucesso.")
        finally:
            lock_connection.execute(
                text("SELECT pg_advisory_unlock(hashtext(:name))"),
                {"name": LOCK_NAME},
            )

    engine.dispose()


if __name__ == "__main__":
    main()
