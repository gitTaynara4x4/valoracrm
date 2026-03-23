from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.database import SessionLocal
from backend.models import Usuario, LoginToken


router = APIRouter(prefix="/api/auth", tags=["Auth"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


# =========================================================
# CONFIG COOKIES
# =========================================================
COOKIE_PATH = "/"
COOKIE_DOMAIN = None
COOKIE_SAMESITE = "lax"
COOKIE_SECURE = False   # em produção com HTTPS, troque para True
COOKIE_HTTPONLY_USER_ID = False  # deixe False se você quiser manter compatibilidade atual


# =========================================================
# DB
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================================================
# SCHEMAS
# =========================================================
class LoginIn(BaseModel):
    email: EmailStr
    senha: str
    remember: bool = False


class TokenIn(BaseModel):
    email: EmailStr
    token: str
    remember: bool = False


# =========================================================
# HELPERS
# =========================================================
def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False

    try:
        if hashed_password.startswith("$2") or hashed_password.startswith("$pbkdf2-sha256$"):
            return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

    return plain_password == hashed_password


def make_access_token() -> str:
    return secrets.token_urlsafe(32)


def generate_6digit_token() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def send_token_email(email: str, token: str):
    print(f"[LOGIN TOKEN] email={email} token={token}")


def set_cookie_safe(
    response: Response,
    key: str,
    value: str,
    max_age: int,
    httponly: bool = False,
):
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        httponly=httponly,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
    )


def delete_cookie_safe(
    response: Response,
    key: str,
    httponly: bool = False,
):
    response.delete_cookie(
        key=key,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
        secure=COOKIE_SECURE,
        httponly=httponly,
        samesite=COOKIE_SAMESITE,
    )


def issue_login_cookies(response: Response, user: Usuario, remember: bool):
    max_age = 60 * 60 * 24 * 30 if remember else 60 * 60 * 8

    set_cookie_safe(
        response=response,
        key="empresa_id",
        value=str(user.empresa_id or 1),
        max_age=max_age,
        httponly=False,
    )

    set_cookie_safe(
        response=response,
        key="user_id",
        value=str(user.id),
        max_age=max_age,
        httponly=COOKIE_HTTPONLY_USER_ID,
    )

    set_cookie_safe(
        response=response,
        key="user_nome",
        value=user.nome or "",
        max_age=max_age,
        httponly=False,
    )


def clear_login_cookies(response: Response):
    delete_cookie_safe(response, "empresa_id", httponly=False)
    delete_cookie_safe(response, "user_id", httponly=COOKIE_HTTPONLY_USER_ID)
    delete_cookie_safe(response, "user_nome", httponly=False)


def build_login_response(user: Usuario, remember: bool):
    access_token = make_access_token()

    response = JSONResponse(
        content={
            "ok": True,
            "access_token": access_token,
            "token": access_token,
            "nome": user.nome,
            "cargo": user.cargo,
            "empresa_id": user.empresa_id or 1,
            "empresaId": user.empresa_id or 1,
            "user_id": user.id,
        }
    )

    issue_login_cookies(response, user, remember)
    return response


# =========================================================
# LOGIN PASSO 1
# =========================================================
@router.post("/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    email = (data.email or "").strip().lower()
    senha = (data.senha or "").strip()

    print("[LOGIN] email recebido =", repr(email))

    todos = db.query(Usuario).order_by(Usuario.id.desc()).all()
    print("[LOGIN] usuarios encontrados no banco =", [
        (u.id, u.email, u.empresa_id, u.ativo) for u in todos
    ])

    user = db.query(Usuario).filter(Usuario.email == email).first()
    print("[LOGIN] usuario encontrado =", user)

    if not user:
        raise HTTPException(status_code=404, detail="E-mail não cadastrado.")

    if hasattr(user, "ativo") and user.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    if not verify_password(senha, user.senha_hash):
        raise HTTPException(status_code=401, detail="E-mail e/ou senha incorretos.")

    exigir_token = bool(getattr(user, "exigir_token_login", False))

    if exigir_token:
        token = generate_6digit_token()
        expires_at = datetime.utcnow() + timedelta(minutes=10)

        db.query(LoginToken).filter(LoginToken.email == user.email).delete()

        row = LoginToken(
            email=user.email,
            token=token,
            expires_at=expires_at,
        )
        db.add(row)
        db.commit()

        send_token_email(user.email, token)

        return {
            "require_token": True,
            "mensagem": "Enviamos um código de segurança para o seu e-mail.",
            "email": user.email,
        }

    return build_login_response(user, data.remember)


# =========================================================
# LOGIN PASSO 2
# =========================================================
@router.post("/login/token")
def login_token(data: TokenIn, db: Session = Depends(get_db)):
    user = (
        db.query(Usuario)
        .filter(Usuario.email == data.email.lower().strip())
        .first()
    )

    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")

    now = datetime.utcnow()

    row = (
        db.query(LoginToken)
        .filter(LoginToken.email == user.email, LoginToken.token == data.token.strip())
        .order_by(LoginToken.id.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=401, detail="Código inválido.")

    if row.expires_at < now:
        raise HTTPException(status_code=401, detail="Código expirado.")

    db.delete(row)
    db.commit()

    return build_login_response(user, data.remember)


# =========================================================
# LOGOUT
# =========================================================
@router.post("/logout")
def logout():
    response = JSONResponse(
        content={
            "ok": True,
            "message": "Logout realizado com sucesso."
        }
    )
    clear_login_cookies(response)
    return response


# =========================================================
# ME
# =========================================================
@router.get("/me")
def me(
    user_id: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
):
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")

    try:
        user_id_int = int(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="user_id inválido.")

    user = db.query(Usuario).filter(Usuario.id == user_id_int).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    return {
        "ok": True,
        "user_id": user.id,
        "empresa_id": user.empresa_id,
        "nome": user.nome,
        "email": user.email,
    }