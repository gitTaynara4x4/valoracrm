# backend/main.py
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ============================================
# Paths básicos
# ============================================
BASE_DIR = Path(__file__).resolve().parent.parent  # pasta OrcaPro/
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(
    title="4X OrçaPro API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)


# ============================================
# Static: /frontend -> pasta frontend/
# ============================================
# /frontend/inicio.html ficará acessível via:
# http://localhost:8000/frontend/inicio.html
app.mount(
    "/frontend",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="frontend",
)


# ============================================
# Rotas básicas
# ============================================

@app.get("/ping")
def ping():
    return {"status": "ok", "app": "4X OrçaPro"}


@app.get("/orca", tags=["OrçaPro – UI"])
def orcapro_inicio():
    """
    Tela inicial do 4X OrçaPro (frontend/inicio.html)
    Acessível em: http://localhost:8000/orca
    """
    inicio_path = FRONTEND_DIR / "inicio.html"
    return FileResponse(inicio_path)
