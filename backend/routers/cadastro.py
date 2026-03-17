# backend/routers/cadastro.py
from __future__ import annotations

import os
import smtplib
import secrets
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from backend.database import SessionLocal
from backend.models import Empresa, Usuario, CadastroToken


router = APIRouter(tags=["Cadastro"])

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
BASE_DIR = Path(__file__).resolve().parents[2]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def only_digits(v: str | None) -> str:
    return "".join(ch for ch in (v or "") if ch.isdigit())


def generate_6digit_token() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def normalize_plano(plano: str | None) -> str:
    value = (plano or "essencial").strip().lower()
    if value not in {"essencial", "profissional", "empresarial"}:
        return "essencial"
    return value


def send_email_token(to_email: str, token: str):
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_pass = os.getenv("SMTP_PASS", "").strip()
    smtp_from = os.getenv("SMTP_FROM", smtp_user).strip()
    smtp_tls = os.getenv("SMTP_TLS", "true").lower() == "true"

    subject = "Código de confirmação - Valora CRM"
    body = f"""
Olá!

Seu código de confirmação é: {token}

Esse código expira em 10 minutos.

Valora CRM
""".strip()

    if not smtp_host or not smtp_user or not smtp_pass:
        print(f"[CADASTRO TOKEN] email={to_email} token={token}")
        return

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = smtp_from
    msg["To"] = to_email

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.ehlo()
        if smtp_tls:
            server.starttls()
            server.ehlo()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_from, [to_email], msg.as_string())


class CadastroIniciarIn(BaseModel):
    empresa_nome: str
    responsavel_nome: str
    email: EmailStr
    telefone: str
    senha: str
    confirmar_senha: str
    cargo: str | None = "admin"
    exigir_token_login: bool = False
    plano: str = "essencial"


class CadastroConfirmarIn(BaseModel):
    email: EmailStr
    token: str


@router.get("/cadastro")
def cadastro_page():
    return FileResponse(BASE_DIR / "frontend" / "cadastro.html")


@router.post("/api/auth/cadastro/iniciar")
def cadastro_iniciar(data: CadastroIniciarIn, db: Session = Depends(get_db)):
    empresa_nome = (data.empresa_nome or "").strip()
    responsavel_nome = (data.responsavel_nome or "").strip()
    email = (data.email or "").strip().lower()
    telefone = (data.telefone or "").strip()
    senha = (data.senha or "").strip()
    confirmar = (data.confirmar_senha or "").strip()
    cargo = (data.cargo or "").strip() or "admin"
    plano = normalize_plano(data.plano)

    if not empresa_nome:
        raise HTTPException(status_code=400, detail="Nome da empresa é obrigatório.")

    if not responsavel_nome:
        raise HTTPException(status_code=400, detail="Nome do responsável é obrigatório.")

    if not email:
        raise HTTPException(status_code=400, detail="E-mail é obrigatório.")

    if not telefone:
        raise HTTPException(status_code=400, detail="Telefone é obrigatório.")

    telefone_limpo = only_digits(telefone)
    if len(telefone_limpo) < 10:
        raise HTTPException(status_code=400, detail="Telefone inválido.")

    if not senha:
        raise HTTPException(status_code=400, detail="Senha é obrigatória.")

    if len(senha) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 6 caracteres.")

    if senha != confirmar:
        raise HTTPException(status_code=400, detail="As senhas não conferem.")

    existe_usuario = db.query(Usuario).filter(Usuario.email == email).first()
    if existe_usuario:
        raise HTTPException(status_code=409, detail="Já existe um usuário com esse e-mail.")

    token = generate_6digit_token()
    expires_at = datetime.utcnow() + timedelta(minutes=10)
    senha_hash = pwd_context.hash(senha)

    db.query(CadastroToken).filter(CadastroToken.email == email).delete()

    pending = CadastroToken(
        empresa_nome=empresa_nome,
        responsavel_nome=responsavel_nome,
        email=email,
        telefone=telefone,
        senha_hash=senha_hash,
        cargo=cargo,
        plano=plano,
        exigir_token_login=bool(data.exigir_token_login),
        token=token,
        expires_at=expires_at,
    )

    db.add(pending)
    db.commit()

    try:
        send_email_token(email, token)
    except Exception as e:
        print(f"[ERRO EMAIL CADASTRO] {e}")
        raise HTTPException(status_code=500, detail="Não foi possível enviar o e-mail de confirmação.")

    return {
        "ok": True,
        "message": "Código enviado com sucesso.",
        "email": email,
        "plano": plano,
    }


@router.post("/api/auth/cadastro/confirmar")
def cadastro_confirmar(data: CadastroConfirmarIn, db: Session = Depends(get_db)):
    email = (data.email or "").strip().lower()
    token = (data.token or "").strip()

    row = (
        db.query(CadastroToken)
        .filter(CadastroToken.email == email, CadastroToken.token == token)
        .order_by(CadastroToken.id.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=401, detail="Código inválido.")

    if row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=401, detail="Código expirado.")

    existe_usuario = db.query(Usuario).filter(Usuario.email == email).first()
    if existe_usuario:
        db.delete(row)
        db.commit()
        raise HTTPException(status_code=409, detail="Esse e-mail já foi cadastrado.")

    nova_empresa = Empresa(
        nome=row.empresa_nome,
        email=row.email,
        telefone=row.telefone,
        plano=row.plano or "essencial",
        ativo=True,
    )
    db.add(nova_empresa)
    db.flush()

    novo_usuario = Usuario(
        empresa_id=nova_empresa.id,
        nome=row.responsavel_nome,
        email=row.email,
        telefone=row.telefone,
        senha_hash=row.senha_hash,
        cargo=row.cargo or "admin",
        exigir_token_login=bool(row.exigir_token_login),
        ativo=True,
    )
    db.add(novo_usuario)
    db.flush()

    db.delete(row)
    db.commit()

    return {
        "ok": True,
        "empresa_id": nova_empresa.id,
        "empresa_nome": nova_empresa.nome,
        "usuario_id": novo_usuario.id,
        "nome": novo_usuario.nome,
        "email": novo_usuario.email,
        "plano": nova_empresa.plano,
    }