from __future__ import annotations

from pathlib import Path
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.routers import cadastro
from backend.routers.clientes import router as clientes_router
from backend.routers.fornecedores import router as fornecedores_router
from backend.routers.auth import router as auth_router
from backend.routers.perfil import router as perfil_router
from backend.routers.produtos import router as produtos_router
from backend.routers.propostas import router as propostas_router
from backend.routers.dashboard import router as dashboard_router
from backend.routers.usuarios import router as usuarios_router
from backend.routers.permissoes import router as permissoes_router
from backend.routers import empresa
from backend.routers import propostas, campos_propostas

# ============================================
# Paths básicos
# ============================================
BASE_DIR = Path(__file__).resolve().parent.parent  # pasta ValoraPro/
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOADS_DIR = BASE_DIR / "uploads"

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
# Auth global
# Bloqueia tudo sem cookie "user_id",
# exceto login e assets necessários do login
# ============================================
PUBLIC_EXACT_PATHS = {
    "/",
    "/login",
    "/login/",
    "/frontend/login.html",
    "/frontend/login.html/",
    "/ping",
    "/favicon.ico",

    # assets básicos do login
    "/frontend/js/pages/login.js",
    "/frontend/css/login.css",
    "/frontend/img/logo-favicon.jpg",
}

PUBLIC_PREFIXES = (
    "/api/auth",          # login/logout/refresh/etc
    "/frontend/img/",     # logo/favicon usados no login
    "/frontend/fonts/",   # fontes locais, se houver
)


def normalize_path(path: str) -> str:
    path = (path or "/").strip()
    if not path:
        return "/"
    path = path.split("?")[0].split("#")[0]
    path = path.rstrip("/")
    return path or "/"


def is_public_path(path: str) -> bool:
    raw = path or "/"
    norm = normalize_path(raw)

    if raw in PUBLIC_EXACT_PATHS or norm in PUBLIC_EXACT_PATHS:
        return True

    return any(
        raw.startswith(prefix) or norm.startswith(prefix)
        for prefix in PUBLIC_PREFIXES
    )


def has_auth_cookie(request: Request) -> bool:
    user_id = request.cookies.get("user_id")
    return bool(user_id and str(user_id).strip())


@app.middleware("http")
async def require_auth_globally(request: Request, call_next):
    raw_path = request.url.path or "/"
    path = normalize_path(raw_path)
    authenticated = has_auth_cookie(request)

    # Se já estiver logado e tentar abrir login, manda pro dashboard
    if authenticated and path in {"/login", "/frontend/login.html"}:
        return RedirectResponse(url="/dashboard", status_code=302)

    # Caminhos públicos
    if is_public_path(raw_path):
        return await call_next(request)

    # Usuário autenticado segue normal
    if authenticated:
        return await call_next(request)

    # API sem autenticação => 401 json
    if path.startswith("/api/"):
        return JSONResponse(
            status_code=401,
            content={"detail": "Não autenticado."}
        )

    # Qualquer página/arquivo sem autenticação => login
    return RedirectResponse(url="/login", status_code=302)


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


# ============================================
# Static files
# ============================================
app.mount(
    "/frontend",
    NoCacheHTMLStaticFiles(directory=str(FRONTEND_DIR)),
    name="frontend",
)

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
app.include_router(dashboard_router)
app.include_router(usuarios_router)
app.include_router(permissoes_router)
app.include_router(propostas.router)
app.include_router(campos_propostas.router)

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
    return RedirectResponse(url="/login", status_code=302)


@app.get("/login", include_in_schema=False, tags=["Valora – Auth"])
def login_page():
    return serve_html("login")


@app.get("/Valora", include_in_schema=False, tags=["Valora – UI"])
def valora():
    return serve_html("inicio")


@app.get("/inicio", include_in_schema=False, tags=["Valora – UI"])
def inicio():
    return serve_html("inicio")


# ============================================
# Rota genérica para páginas HTML
# Ex.: /dashboard -> frontend/dashboard.html
#      /clientes  -> frontend/clientes.html
#      /usuarios  -> frontend/usuarios.html
# ============================================
@app.get("/{page_name}", include_in_schema=False)
def page(page_name: str):
    return serve_html(page_name)


@app.get("/{page_name}/", include_in_schema=False)
def page_slash(page_name: str):
    return serve_html(page_name)