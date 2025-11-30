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

# ============================================
# App
# ============================================
app = FastAPI(
    title="4X OrçaPro API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# ============================================
# Static com NO-CACHE para HTML
# ============================================

class NoCacheHTMLStaticFiles(StaticFiles):
    """
    Igual StaticFiles, mas qualquer arquivo .html vai com Cache-Control
    desabilitando cache no navegador.
    """
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)

        # Só mexe se achou o arquivo e se for .html
        if response.status_code == 200 and path.lower().endswith(".html"):
            response.headers["Cache-Control"] = (
                "no-store, no-cache, must-revalidate, max-age=0"
            )
            # opcional: também pode limpar ETag / Last-Modified se quiser ficar hardcore
            # response.headers.pop("ETag", None)
            # response.headers.pop("Last-Modified", None)

        return response

# /frontend/inicio.html, /frontend/menu.html, etc.
app.mount(
    "/frontend",
    NoCacheHTMLStaticFiles(directory=str(FRONTEND_DIR)),
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
    Tela inicial: /orca -> frontend/inicio.html
    Também com no-cache, pra garantir que o HTML novo sempre venha.
    """
    file_path = FRONTEND_DIR / "inicio.html"
    return FileResponse(
        file_path,
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"
        },
    )
