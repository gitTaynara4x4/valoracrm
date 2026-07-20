from __future__ import annotations

import os
import re
import smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.models import Empresa, LoginToken, Usuario
from backend.security.session import (
    SESSION_COOKIE_NAME,
    create_session_token,
    create_temporary_token,
    decode_session_token,
    unsign_payload,
)


router = APIRouter(prefix="/api/auth", tags=["Auth"])
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

COOKIE_PATH = "/"
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN") or None
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax").strip().lower()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class LoginIn(BaseModel):
    email: str
    senha: str
    remember: bool = False
    empresa_id: Optional[int] = None


class TokenIn(BaseModel):
    email: str
    token: str
    remember: bool = False
    empresa_id: Optional[int] = None
    challenge: Optional[str] = None


def normalizar_email_login(value: str) -> str:
    email = (value or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="E-mail é obrigatório.")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
        raise HTTPException(
            status_code=400,
            detail="Informe um e-mail válido. Exemplo: nome@empresa.com.br",
        )
    return email


def normalizar_senha_login(value: str) -> str:
    senha = (value or "").strip()
    if not senha:
        raise HTTPException(status_code=400, detail="Senha é obrigatória.")
    return senha


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if not hashed_password:
        return False
    try:
        if hashed_password.startswith("$pbkdf2-sha256$"):
            return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False
    return plain_password == hashed_password


def _upgrade_legacy_password(db: Session, user: Usuario, plain_password: str) -> None:
    current = str(user.senha_hash or "")
    if current and not current.startswith("$pbkdf2-sha256$"):
        user.senha_hash = pwd_context.hash(plain_password)
        db.commit()
        db.refresh(user)


def generate_6digit_token() -> str:
    import secrets

    return f"{secrets.randbelow(1000000):06d}"


def send_token_email(email: str, token: str) -> None:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = (os.getenv("SMTP_USER") or os.getenv("EMAIL_REMETENTE") or "").strip()
    smtp_pass = (os.getenv("SMTP_PASS") or os.getenv("EMAIL_SENHA") or "").strip()
    smtp_from = (os.getenv("SMTP_FROM") or smtp_user).strip()
    smtp_tls = os.getenv("SMTP_TLS", "true").strip().lower() in {"1", "true", "yes", "on"}
    smtp_ssl = os.getenv("SMTP_SSL", "false").strip().lower() in {"1", "true", "yes", "on"}

    if not smtp_user or not smtp_pass or not smtp_from:
        raise RuntimeError("Configuração de e-mail não definida no servidor.")

    subject = "Código de segurança - Valora CRM"
    body = (
        "Olá!\n\n"
        f"Seu código de segurança para entrar no Valora CRM é: {token}\n\n"
        "O código expira em 10 minutos. Se não foi você, ignore esta mensagem.\n\n"
        "Valora CRM"
    )

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = email

    if smtp_ssl:
        with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=20) as server:
            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [email], msg.as_string())
        return

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.ehlo()
        if smtp_tls:
            server.starttls()
            server.ehlo()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [email], msg.as_string())


def request_uses_https(request: Request) -> bool:
    configured = os.getenv("COOKIE_SECURE")
    if configured is not None and configured.strip():
        return configured.strip().lower() in {"1", "true", "yes", "on"}

    forwarded = str(request.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip().lower()
    if forwarded:
        return forwarded == "https"
    return str(request.url.scheme or "").lower() == "https"


def set_cookie_safe(
    response: Response,
    key: str,
    value: str,
    max_age: int,
    *,
    httponly: bool,
    secure: bool,
) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        expires=max_age,
        httponly=httponly,
        samesite=COOKIE_SAMESITE,
        secure=secure,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
    )


def delete_cookie_safe(response: Response, key: str, *, httponly: bool, secure: bool) -> None:
    response.delete_cookie(
        key=key,
        path=COOKIE_PATH,
        domain=COOKIE_DOMAIN,
        secure=secure,
        httponly=httponly,
        samesite=COOKIE_SAMESITE,
    )


def issue_login_cookies(response: Response, user: Usuario, remember: bool, request: Request) -> None:
    max_age = 60 * 60 * 24 * 30 if remember else 60 * 60 * 8
    empresa_id = int(user.empresa_id)
    session_token = create_session_token(int(user.id), empresa_id, max_age)
    secure = request_uses_https(request)

    set_cookie_safe(
        response,
        SESSION_COOKIE_NAME,
        session_token,
        max_age,
        httponly=True,
        secure=secure,
    )
    # Mantidos para compatibilidade com rotas antigas. A autenticação real é
    # feita pelo cookie assinado valora_session.
    set_cookie_safe(response, "empresa_id", str(empresa_id), max_age, httponly=True, secure=secure)
    set_cookie_safe(response, "user_id", str(user.id), max_age, httponly=True, secure=secure)
    set_cookie_safe(response, "user_nome", user.nome or "", max_age, httponly=False, secure=secure)


def clear_login_cookies(response: Response, request: Request) -> None:
    secure = request_uses_https(request)
    delete_cookie_safe(response, SESSION_COOKIE_NAME, httponly=True, secure=secure)
    delete_cookie_safe(response, "empresa_id", httponly=True, secure=secure)
    delete_cookie_safe(response, "user_id", httponly=True, secure=secure)
    delete_cookie_safe(response, "user_nome", httponly=False, secure=secure)


def build_login_response(user: Usuario, remember: bool, request: Request) -> JSONResponse:
    response = JSONResponse(
        content={
            "ok": True,
            "nome": user.nome,
            "email": user.email,
            "cargo": user.cargo,
            "papel": user.papel,
            "empresa_id": int(user.empresa_id),
            "empresaId": int(user.empresa_id),
            "user_id": int(user.id),
        }
    )
    issue_login_cookies(response, user, remember, request)
    return response


def _company_options(db: Session, users: List[Usuario]) -> List[dict]:
    company_ids = sorted({int(user.empresa_id) for user in users})
    rows = db.query(Empresa).filter(Empresa.id.in_(company_ids)).all() if company_ids else []
    names = {int(row.id): str(row.nome or "").strip() for row in rows}
    return [
        {
            "empresa_id": company_id,
            "nome": names.get(company_id) or f"Empresa #{company_id}",
        }
        for company_id in company_ids
    ]


def _find_login_user(db: Session, email: str, senha: str, empresa_id: Optional[int]) -> Usuario:
    query = db.query(Usuario).filter(Usuario.email == email)
    if empresa_id is not None:
        query = query.filter(Usuario.empresa_id == int(empresa_id))

    candidates = query.order_by(Usuario.id.asc()).all()
    if not candidates:
        raise HTTPException(status_code=404, detail="E-mail não cadastrado.")

    password_matches = [u for u in candidates if verify_password(senha, u.senha_hash)]
    if not password_matches:
        raise HTTPException(status_code=401, detail="E-mail e/ou senha incorretos.")

    active_matches = [u for u in password_matches if bool(getattr(u, "ativo", True))]
    if not active_matches:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    if len(active_matches) > 1:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Escolha a empresa que deseja acessar.",
                "requires_company": True,
                "empresas": _company_options(db, active_matches),
            },
        )

    return active_matches[0]


def _login_token_key(user: Usuario) -> str:
    return f"login:{int(user.id)}:{str(user.email).strip().lower()}"


@router.post("/login")
def login(data: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = normalizar_email_login(data.email)
    senha = normalizar_senha_login(data.senha)
    user = _find_login_user(db, email, senha, data.empresa_id)
    _upgrade_legacy_password(db, user, senha)

    if bool(getattr(user, "exigir_token_login", False)):
        token = generate_6digit_token()
        expires_at = datetime.utcnow() + timedelta(minutes=10)
        token_key = _login_token_key(user)

        db.query(LoginToken).filter(LoginToken.email == token_key).delete()
        db.add(LoginToken(email=token_key, token=token, expires_at=expires_at))
        db.commit()

        try:
            send_token_email(user.email, token)
        except Exception as exc:
            db.query(LoginToken).filter(LoginToken.email == token_key).delete()
            db.commit()
            print(f"[ERRO EMAIL LOGIN] {exc}")
            raise HTTPException(
                status_code=503,
                detail="Não foi possível enviar o código de segurança. Verifique a configuração de e-mail.",
            )

        challenge = create_temporary_token(
            "login_2fa",
            user_id=int(user.id),
            empresa_id=int(user.empresa_id),
            max_age=10 * 60,
            extra={"email": user.email},
        )

        return {
            "require_token": True,
            "mensagem": "Enviamos um código de segurança para o seu e-mail.",
            "message": "Enviamos um código de segurança para o seu e-mail.",
            "email": user.email,
            "empresa_id": int(user.empresa_id),
            "challenge": challenge,
        }

    return build_login_response(user, data.remember, request)


@router.post("/login/token")
def login_token(data: TokenIn, request: Request, db: Session = Depends(get_db)):
    email = normalizar_email_login(data.email)
    token = (data.token or "").strip()
    if not re.fullmatch(r"\d{6}", token):
        raise HTTPException(status_code=400, detail="Informe o código de 6 dígitos.")

    user: Optional[Usuario] = None
    if data.challenge:
        payload = unsign_payload(data.challenge, expected_purpose="login_2fa")
        if not payload:
            raise HTTPException(status_code=401, detail="Solicitação de código inválida ou expirada.")

        if str(payload.get("email") or "").strip().lower() != email:
            raise HTTPException(status_code=401, detail="Solicitação de código inválida.")

        user = (
            db.query(Usuario)
            .filter(
                Usuario.id == int(payload["uid"]),
                Usuario.empresa_id == int(payload["eid"]),
                Usuario.email == email,
            )
            .first()
        )
    else:
        query = db.query(Usuario).filter(Usuario.email == email)
        if data.empresa_id is not None:
            query = query.filter(Usuario.empresa_id == int(data.empresa_id))
        users = query.all()
        if len(users) == 1:
            user = users[0]
        elif len(users) > 1:
            raise HTTPException(status_code=409, detail="Informe a empresa para validar o código.")

    if not user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    if not bool(getattr(user, "ativo", True)):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    now = datetime.utcnow()
    token_key = _login_token_key(user)
    row = (
        db.query(LoginToken)
        .filter(LoginToken.email == token_key, LoginToken.token == token)
        .order_by(LoginToken.id.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=401, detail="Código inválido.")
    if row.expires_at < now:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=401, detail="Código expirado.")

    db.delete(row)
    db.commit()
    return build_login_response(user, data.remember, request)


@router.post("/logout")
def logout(request: Request):
    response = JSONResponse(content={"ok": True, "message": "Logout realizado com sucesso."})
    clear_login_cookies(response, request)
    return response


@router.get("/me")
def me(
    valora_session: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
    db: Session = Depends(get_db),
):
    session = decode_session_token(valora_session or "")
    if not session:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")

    user = (
        db.query(Usuario)
        .filter(
            Usuario.id == int(session["uid"]),
            Usuario.empresa_id == int(session["eid"]),
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")
    if not bool(getattr(user, "ativo", True)):
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return {
        "ok": True,
        "user_id": int(user.id),
        "empresa_id": int(user.empresa_id),
        "nome": user.nome,
        "email": user.email,
        "cargo": user.cargo,
        "ativo": bool(user.ativo),
        "papel": user.papel,
    }
