# backend/main.py
from __future__ import annotations

from pathlib import Path
import re

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from backend.routers.clientes import router as clientes_router
from backend.routers.fornecedores import router as fornecedores_router


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
# Static com NO-CACHE para HTML (quando acessado via /frontend/*.html)
# ============================================
class NoCacheHTMLStaticFiles(StaticFiles):
    """
    Igual StaticFiles, mas qualquer arquivo .html vai com Cache-Control
    desabilitando cache no navegador.
    """
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)

        if response.status_code == 200 and path.lower().endswith(".html"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"

        return response


# /frontend/inicio.html, /frontend/css/..., /frontend/js/...
app.mount(
    "/frontend",
    NoCacheHTMLStaticFiles(directory=str(FRONTEND_DIR)),
    name="frontend",
)


# ============================================
# Routers da API
# ============================================
app.include_router(clientes_router)
app.include_router(fornecedores_router)


# ============================================
# Helpers
# ============================================
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

# só aceita nomes simples: letras, números, _ e -
_SAFE_PAGE_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# coisas que NÃO devem virar página (evita conflito/estranheza)
_RESERVED = {"api", "frontend", "docs", "redoc", "openapi.json"}


def serve_html(page_name: str) -> FileResponse:
    """
    Serve /<page_name> -> frontend/<page_name>.html (sem precisar digitar .html)
    """
    if page_name in _RESERVED:
        raise HTTPException(status_code=404, detail="Rota reservada.")

    if not _SAFE_PAGE_RE.match(page_name):
        raise HTTPException(status_code=404, detail="Página inválida.")

    file_path = (FRONTEND_DIR / f"{page_name}.html").resolve()

    # segurança: garante que continua dentro da pasta frontend
    try:
        FRONTEND_DIR.resolve().relative_to(FRONTEND_DIR.resolve())
    except Exception:
        pass

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Página '{page_name}' não existe em /frontend.")

    return FileResponse(str(file_path), headers=dict(_NO_CACHE_HEADERS))


# ============================================
# Rotas básicas
# ============================================
@app.get("/ping")
def ping():
    return {"status": "ok", "app": "4X OrçaPro"}


@app.get("/", include_in_schema=False)
def root():
    # Você pode trocar pra RedirectResponse("/orca") se preferir.
    return RedirectResponse(url="/orca", status_code=302)


# Seus atalhos fixos (sem .html)
@app.get("/orca", include_in_schema=False, tags=["OrçaPro – UI"])
def orca():
    return serve_html("inicio")


@app.get("/inicio", include_in_schema=False, tags=["OrçaPro – UI"])
def inicio():
    return serve_html("inicio")


# ============================================
# Rota genérica: /qualquer_coisa -> /frontend/qualquer_coisa.html
# ============================================
@app.get("/{page_name}", include_in_schema=False)
def page(page_name: str):
    return serve_html(page_name)


@app.get("/{page_name}/", include_in_schema=False)
def page_slash(page_name: str):
    return serve_html(page_name)
