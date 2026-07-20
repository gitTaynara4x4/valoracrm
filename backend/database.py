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

# Engine síncrono do SQLAlchemy (Postgres)
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,   # evita conexões zumbis
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
