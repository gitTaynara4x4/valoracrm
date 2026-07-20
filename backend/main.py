from __future__ import annotations

from pathlib import Path
import os
import re

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.routers.area_cliente_acessos_admin import router as area_cliente_acessos_admin_router
from backend.routers.area_cliente_admin import router as area_cliente_admin_router
from backend.routers.area_cliente_publica import router as area_cliente_publica_router
from backend.routers.contratos_admin import router as contratos_admin_router
from backend.routers.monitoramento import router as monitoramento_router
from backend.routers import cadastro
from backend.routers.clientes import router as clientes_router
from backend.routers.fornecedores import router as fornecedores_router
from backend.routers.auth import router as auth_router
from backend.routers.perfil import router as perfil_router
from backend.routers.produtos import router as produtos_router
from backend.routers.patrimonio import router as patrimonio_router
from backend.routers.cotacoes import router as cotacoes_router
from backend.routers.propostas import router as propostas_router
from backend.routers.orcamentos import router as orcamentos_router
from backend.routers.dashboard import router as dashboard_router, compat_router as dashboard_compat_router
from backend.routers.usuarios import router as usuarios_router
from backend.routers.permissoes import router as permissoes_router
from backend.routers.formularios import router as formularios_router
from backend.routers.financeiro import router as financeiro_router
from backend.routers import empresa
from backend.routers import campos_propostas
from backend.routers.integracoes_zapschat import router as integracoes_zapschat_router
from backend.routers.exportacoes import router as exportacoes_router
from backend.routers.agenda import router as agenda_router
from backend.agenda_push import start_push_dispatcher, stop_push_dispatcher
from backend.database import SessionLocal
from backend import models
from backend.security.permissions import user_has_permission
from backend.security.session import SESSION_COOKIE_NAME, decode_session_token


# ============================================
# Paths básicos
# ============================================
BASE_DIR = Path(__file__).resolve().parent.parent
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


def ensure_each_company_has_owner() -> None:
    """Corrige contas antigas criadas antes do papel owner existir no cadastro."""
    db = SessionLocal()
    repaired = 0
    try:
        company_ids = [int(row[0]) for row in db.query(models.Empresa.id).all()]
        for company_id in company_ids:
            has_owner = (
                db.query(models.Usuario.id)
                .filter(
                    models.Usuario.empresa_id == company_id,
                    models.Usuario.papel == "owner",
                    models.Usuario.ativo == True,
                )
                .first()
            )
            if has_owner:
                continue

            candidate = (
                db.query(models.Usuario)
                .filter(
                    models.Usuario.empresa_id == company_id,
                    models.Usuario.ativo == True,
                )
                .order_by(
                    (models.Usuario.cargo == "admin").desc(),
                    models.Usuario.id.asc(),
                )
                .first()
            )
            if candidate:
                candidate.papel = "owner"
                repaired += 1

        if repaired:
            db.commit()
            print(f"[USUÁRIOS] {repaired} empresa(s) antiga(s) receberam um owner automaticamente.")
    except Exception as exc:
        db.rollback()
        print(f"[USUÁRIOS] Não foi possível verificar owners antigos: {exc}")
    finally:
        db.close()


@app.on_event("startup")
async def start_agenda_push_background() -> None:
    ensure_each_company_has_owner()
    await start_push_dispatcher()


@app.on_event("shutdown")
async def stop_agenda_push_background() -> None:
    await stop_push_dispatcher()


# ============================================
# Config global de favicon
# ============================================
FAVICON_TAG = '<link rel="icon" type="image/jpeg" href="/frontend/img/logo-favicon.jpg">'
FAVICON_TAG_ALT = '<link rel="shortcut icon" type="image/jpeg" href="/frontend/img/logo-favicon.jpg">'


# ============================================
# Autenticação e autorização global
# ============================================
PUBLIC_EXACT_PATHS = {
    "/",
    "/login",
    "/login/",
    "/cadastro",
    "/cadastro/",
    "/frontend/login.html",
    "/frontend/login.html/",
    "/frontend/cadastro.html",
    "/frontend/cadastro.html/",
    "/ping",
    "/favicon.ico",
    "/valora-sw.js",
    "/manifest.webmanifest",

    # scripts públicos de autenticação/cadastro
    "/frontend/js/pages/login.js",
    "/frontend/js/pages/cadastro.js",
    "/frontend/js/shared/validacao.js",
    "/frontend/img/logo-favicon.jpg",
}

PUBLIC_PREFIXES = (
    "/api/auth",
    "/api/area-cliente-publica",
    "/frontend/img/",
    "/frontend/fonts/",
    "/frontend/css/",
)

# Prefixos que recebem a proteção das permissões configuradas em Usuários.
# A checagem é feita no backend; esconder botão no frontend não é segurança.
PERMISSION_PREFIXES = (
    ("/api/dashboard", "dashboard"),
    ("/api/campos-clientes", "clientes"),
    ("/api/clientes", "clientes"),
    ("/api/fornecedores", "fornecedores"),
    ("/api/produtos", "produtos"),
    ("/api/patrimonio", "patrimonio"),
    ("/api/cotacoes", "cotacoes"),
    ("/api/propostas", "propostas"),
    ("/api/contratos-admin", "contratos"),
    ("/api/area-cliente-admin", "contratos"),
    ("/api/area-cliente-acessos-admin", "contratos"),
    ("/api/monitoramento", "contratos"),
    ("/api/usuarios", "usuarios"),
    ("/api/permissoes/usuarios", "usuarios"),
    ("/api/empresa", "empresa"),
    ("/api/financeiro", "financeiro"),
    ("/api/formularios", "configuracoes"),
)

PAGE_PERMISSION_MODULES = {
    "/dashboard": "dashboard",
    "/clientes": "clientes",
    "/fornecedores": "fornecedores",
    "/produtos": "produtos",
    "/patrimonio": "patrimonio",
    "/cotacoes": "cotacoes",
    "/propostas": "propostas",
    "/orcamentos": "orcamentos",
    "/contratos-admin": "contratos",
    "/area-cliente-admin": "contratos",
    "/monitoramento": "contratos",
    "/usuarios": "usuarios",
    "/empresa": "empresa",
    "/configuracoes": "configuracoes",
    "/financeiro": "financeiro",
    "/fluxo-caixa": "financeiro",
    "/contas-pagar": "financeiro",
    "/contas-receber": "financeiro",
    "/contas-bancos": "financeiro",
    "/categorias-financeiras": "financeiro",
    "/formas-pagamento": "financeiro",
    "/relatorios-financeiros": "financeiro",
}



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
    for prefix in PUBLIC_PREFIXES:
        if prefix.endswith("/"):
            if raw.startswith(prefix) or norm.startswith(prefix):
                return True
        elif norm == prefix or norm.startswith(prefix + "/"):
            return True
    return False


def _permission_module(path: str) -> str | None:
    normalized = normalize_path(path)
    for prefix, module in PERMISSION_PREFIXES:
        if normalized == prefix or normalized.startswith(prefix + "/"):
            return module
    return None


def _permission_action(request: Request, path: str) -> str:
    method = request.method.upper()
    normalized = normalize_path(path)

    if method in {"GET", "HEAD", "OPTIONS"}:
        return "ver"
    if method == "DELETE":
        return "excluir"
    if method in {"PUT", "PATCH"}:
        return "editar"

    # POST nem sempre significa criação.
    if method == "POST" and "/verificar-duplicidade" in normalized:
        return "ver"

    # Ações em um registro existente são edição.
    edit_markers = (
        "/baixar",
        "/cancelar",
        "/aprovar",
        "/vencedor",
        "/status",
        "/logo",
        "/upload",
        "/revogar",
    )
    if method == "POST" and any(marker in normalized for marker in edit_markers):
        return "editar"
    return "criar"


def _request_uses_https(request: Request) -> bool:
    configured = os.getenv("COOKIE_SECURE")
    if configured is not None and configured.strip():
        return configured.strip().lower() in {"1", "true", "yes", "on"}
    forwarded = str(request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip().lower()
    if forwarded:
        return forwarded == "https"
    return str(request.url.scheme or "").lower() == "https"


def _clear_auth_response(request: Request, status_code: int, detail: str, *, api: bool):
    if api:
        response = JSONResponse(status_code=status_code, content={"detail": detail})
    else:
        response = RedirectResponse(url="/login", status_code=302)

    for key, httponly in (
        (SESSION_COOKIE_NAME, True),
        ("user_id", True),
        ("empresa_id", True),
        ("user_nome", False),
    ):
        response.delete_cookie(
            key,
            path="/",
            domain=os.getenv("COOKIE_DOMAIN") or None,
            secure=_request_uses_https(request),
            httponly=httponly,
            samesite=os.getenv("COOKIE_SAMESITE", "lax").strip().lower(),
        )
    return response


@app.middleware("http")
async def require_auth_globally(request: Request, call_next):
    raw_path = request.url.path or "/"
    path = normalize_path(raw_path)

    if path in {"/login", "/frontend/login.html"}:
        existing_session = decode_session_token(request.cookies.get(SESSION_COOKIE_NAME, ""))
        if existing_session:
            try:
                same_user = int(request.cookies.get("user_id", "")) == int(existing_session["uid"])
                same_company = int(request.cookies.get("empresa_id", "")) == int(existing_session["eid"])
            except (TypeError, ValueError):
                same_user = same_company = False
            if same_user and same_company:
                return RedirectResponse(url="/dashboard", status_code=302)

    if is_public_path(raw_path):
        # Login/cadastro são públicos. /api/auth/me faz sua própria validação.
        return await call_next(request)

    session = decode_session_token(request.cookies.get(SESSION_COOKIE_NAME, ""))
    is_api = path.startswith("/api/")
    if not session:
        return _clear_auth_response(request, 401, "Sessão inválida ou expirada.", api=is_api)

    # Cookies antigos são aceitos apenas quando correspondem à sessão assinada.
    try:
        cookie_user_id = int(request.cookies.get("user_id", ""))
        cookie_empresa_id = int(request.cookies.get("empresa_id", ""))
    except (TypeError, ValueError):
        return _clear_auth_response(request, 401, "Sessão inválida.", api=is_api)

    if cookie_user_id != int(session["uid"]) or cookie_empresa_id != int(session["eid"]):
        return _clear_auth_response(request, 401, "Sessão inconsistente.", api=is_api)

    db = SessionLocal()
    try:
        user = (
            db.query(models.Usuario)
            .filter(
                models.Usuario.id == int(session["uid"]),
                models.Usuario.empresa_id == int(session["eid"]),
            )
            .first()
        )
        if not user:
            return _clear_auth_response(request, 401, "Usuário não encontrado.", api=is_api)
        if not bool(getattr(user, "ativo", True)):
            return _clear_auth_response(request, 403, "Usuário inativo.", api=is_api)

        request.state.current_user_id = int(user.id)
        request.state.current_empresa_id = int(user.empresa_id)

        # Orçamentos já possui dependências detalhadas por rota.
        module = _permission_module(path)
        action = _permission_action(request, path)

        if not module and request.method.upper() in {"GET", "HEAD"}:
            module = PAGE_PERMISSION_MODULES.get(path)
            action = "ver"

        if module and not user_has_permission(db, user, module, action):
            if is_api:
                return JSONResponse(
                    status_code=403,
                    content={"detail": f"Sem permissão para {action} em {module}."},
                )
            return RedirectResponse(url="/inicio?erro=sem-permissao", status_code=302)
    finally:
        db.close()

    if path in {"/login", "/frontend/login.html"}:
        return RedirectResponse(url="/dashboard", status_code=302)

    return await call_next(request)


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
app.include_router(patrimonio_router)
app.include_router(cotacoes_router)
app.include_router(empresa.router)
app.include_router(propostas_router)
app.include_router(orcamentos_router)
app.include_router(dashboard_router)
app.include_router(dashboard_compat_router)
app.include_router(usuarios_router)
app.include_router(permissoes_router)
app.include_router(campos_propostas.router)
app.include_router(formularios_router)
app.include_router(financeiro_router)
app.include_router(integracoes_zapschat_router)
app.include_router(exportacoes_router)
app.include_router(agenda_router)

# Área do Cliente / Contratos
app.include_router(area_cliente_admin_router)
app.include_router(contratos_admin_router)
app.include_router(area_cliente_acessos_admin_router)
app.include_router(area_cliente_publica_router)
app.include_router(monitoramento_router)
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
            detail=f"Página '{page_name}' não existe em /frontend.",
        )

    return FileResponse(
        str(file_path),
        media_type="text/html; charset=utf-8",
        headers=dict(_NO_CACHE_HEADERS),
    )


# ============================================
# Rotas básicas
# ============================================
@app.get("/valora-sw.js", include_in_schema=False)
def service_worker() -> FileResponse:
    return FileResponse(
        str(FRONTEND_DIR / "valora-sw.js"),
        media_type="application/javascript; charset=utf-8",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Service-Worker-Allowed": "/",
        },
    )


@app.get("/manifest.webmanifest", include_in_schema=False)
def web_manifest() -> FileResponse:
    return FileResponse(
        str(FRONTEND_DIR / "manifest.webmanifest"),
        media_type="application/manifest+json; charset=utf-8",
        headers={"Cache-Control": "no-cache, max-age=300"},
    )


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