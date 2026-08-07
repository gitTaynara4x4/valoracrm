# backend/database.py
from __future__ import annotations

import os
from typing import Generator

from dotenv import load_dotenv
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session, declarative_base

# Carrega .env e também .ENV para manter compatibilidade em Linux.
_PROJECT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_DIR / ".env")
load_dotenv(_PROJECT_DIR / ".ENV")

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL não definido nas variáveis de ambiente.")

def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default)).strip()))
    except (TypeError, ValueError):
        return default


# Pool explícito: evita tempestade de novas conexões e limita quanto cada
# worker pode pressionar o PostgreSQL. Todos os valores podem ser ajustados
# por variável de ambiente sem alterar código.
DB_POOL_SIZE = _env_int("DB_POOL_SIZE", 5)
DB_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 5, minimum=0)
DB_POOL_TIMEOUT = _env_int("DB_POOL_TIMEOUT", 15)
DB_POOL_RECYCLE = _env_int("DB_POOL_RECYCLE", 1800)
DB_CONNECT_TIMEOUT = _env_int("DB_CONNECT_TIMEOUT", 10)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=DB_POOL_SIZE,
    max_overflow=DB_MAX_OVERFLOW,
    pool_timeout=DB_POOL_TIMEOUT,
    pool_recycle=DB_POOL_RECYCLE,
    connect_args={
        "connect_timeout": DB_CONNECT_TIMEOUT,
        "application_name": "valora-crm",
    },
)

# Fábrica de sessões
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# Base para os models
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    Dependência do FastAPI para abrir/fechar sessão do banco.
    Usa SessionLocal e garante fechamento no final da request.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
