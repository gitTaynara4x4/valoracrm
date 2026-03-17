from __future__ import annotations

from pathlib import Path
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from backend.routers import cadastro
from backend.routers.clientes import router as clientes_router
from backend.routers.fornecedores import router as fornecedores_router
from backend.routers.auth import router as auth_router
from backend.routers.perfil import router as perfil_router
from backend.routers.produtos import router as produtos_router
from backend.routers import clientes, empresa
from backend.routers.propostas import router as propostas_router


# ============================================
# Paths básicos
# ============================================
BASE_DIR = Path(__file__).resolve().parent.parent  # pasta ValoraPro/
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = BASE_DIR / "uploads"

# Garante que a pasta uploads principal exista
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# ============================================
# App
# ============================================
app = FastAPI(
    title="4X Valora API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)


# ============================================
# Config global de favicon
# ============================================
FAVICON_TAG = '<link rel="icon" type="image/jpeg" href="/frontend/img/logo-favicon.jpg">'
FAVICON_TAG_ALT = '<link rel="shortcut icon" type="image/jpeg" href="/frontend/img/logo-favicon.jpg">'


# ============================================
# Static com NO-CACHE para HTML
# ============================================
class NoCacheHTMLStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200 and path.lower().endswith(".html"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        return response


# ============================================
# Middleware para injetar favicon em TODO HTML
# ============================================
@app.middleware("http")
async def inject_global_favicon(request: Request, call_next):
    response = await call_next(request)

    content_type = (response.headers.get("content-type") or "").lower()
    if "text/html" not in content_type:
        return response

    body = b""
    async for chunk in response.body_iterator:
        body += chunk

    try:
        html = body.decode("utf-8")
    except UnicodeDecodeError:
        try:
            html = body.decode("latin-1")
        except Exception:
            return Response(
                content=body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

    # Evita duplicar favicon
    if 'rel="icon"' not in html and 'rel="shortcut icon"' not in html:
        inject_html = f"    {FAVICON_TAG}\n    {FAVICON_TAG_ALT}\n"

        if "</head>" in html:
            html = html.replace("</head>", f"{inject_html}</head>", 1)
        else:
            html = inject_html + html

    headers = dict(response.headers)
    headers.pop("content-length", None)

    return Response(
        content=html,
        status_code=response.status_code,
        headers=headers,
        media_type="text/html; charset=utf-8",
    )


# Monta o frontend
app.mount(
    "/frontend",
    NoCacheHTMLStaticFiles(directory=str(FRONTEND_DIR)),
    name="frontend",
)

# Monta uploads
app.mount(
    "/uploads",
    StaticFiles(directory=str(UPLOADS_DIR)),
    name="uploads",
)


# ============================================
# Routers da API
# ============================================
app.include_router(clientes_router)
app.include_router(fornecedores_router)
app.include_router(auth_router)
app.include_router(cadastro.router)
app.include_router(perfil_router)
app.include_router(produtos_router)
app.include_router(empresa.router)
app.include_router(propostas_router)


# ============================================
# Helpers
# ============================================
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

_SAFE_PAGE_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_RESERVED = {"api", "frontend", "docs", "redoc", "openapi.json", "uploads"}


def serve_html(page_name: str) -> FileResponse:
    if page_name in _RESERVED:
        raise HTTPException(status_code=404, detail="Rota reservada.")

    if not _SAFE_PAGE_RE.match(page_name):
        raise HTTPException(status_code=404, detail="Página inválida.")

    file_path = (FRONTEND_DIR / f"{page_name}.html").resolve()

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Página '{page_name}' não existe em /frontend."
        )

    return FileResponse(
        str(file_path),
        media_type="text/html; charset=utf-8",
        headers=dict(_NO_CACHE_HEADERS),
    )


# ============================================
# Rotas básicas
# ============================================
@app.get("/ping")
def ping():
    return {"status": "ok", "app": "4X Valora"}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/Valora", status_code=302)


@app.get("/Valora", include_in_schema=False, tags=["Valora – UI"])
def Valora():
    return serve_html("inicio")


@app.get("/inicio", include_in_schema=False, tags=["Valora – UI"])
def inicio():
    return serve_html("inicio")


# ============================================
# Rota genérica
# ============================================
@app.get("/{page_name}", include_in_schema=False)
def page(page_name: str):
    return serve_html(page_name)


@app.get("/{page_name}/", include_in_schema=False)
def page_slash(page_name: str):
    return serve_html(page_name)