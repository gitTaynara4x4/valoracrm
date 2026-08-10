from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path
from typing import List, Optional
from uuid import uuid4
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from backend import models
from backend.database import get_db
from backend.security.permissions import get_current_user


router = APIRouter(prefix="/api/arquivos-tecnicos", tags=["Arquivos Técnicos"])

BASE_DIR = Path(__file__).resolve().parents[2]
STORAGE_DIR = Path(os.getenv("ARQUIVOS_TECNICOS_DIR") or (BASE_DIR / "uploads" / "arquivos_tecnicos")).resolve()
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = max(1, int(os.getenv("ARQUIVOS_TECNICOS_MAX_MB", "30"))) * 1024 * 1024
CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt",
}

Pasta = models.ArquivoTecnicoPasta
Arquivo = models.ArquivoTecnicoArquivo
Cliente = models.Cliente
Fornecedor = models.Fornecedor


def _text(value) -> str:
    return str(value or "").strip()


def _safe_icon(value: str | None) -> str:
    icon = re.sub(r"[^a-zA-Z0-9_-]", "", _text(value))[:80]
    return icon or "fa-folder"


def _client_for_company(db: Session, cliente_id: int, empresa_id: int) -> Cliente:
    row = (
        db.query(Cliente)
        .filter(Cliente.id == int(cliente_id), Cliente.empresa_id == int(empresa_id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    return row


def _supplier_for_company(db: Session, fornecedor_id: int, empresa_id: int) -> Fornecedor:
    row = (
        db.query(Fornecedor)
        .filter(Fornecedor.id == int(fornecedor_id), Fornecedor.empresa_id == int(empresa_id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return row


def _folder_owner(folder: Pasta) -> tuple[str, int]:
    if getattr(folder, "fornecedor_id", None) is not None:
        return "fornecedor", int(folder.fornecedor_id)
    if getattr(folder, "cliente_id", None) is not None:
        return "cliente", int(folder.cliente_id)
    raise HTTPException(status_code=409, detail="Pasta técnica sem vínculo com cliente ou fornecedor.")


def _folder_for_company(db: Session, pasta_id: int, empresa_id: int) -> Pasta:
    row = (
        db.query(Pasta)
        .filter(Pasta.id == int(pasta_id), Pasta.empresa_id == int(empresa_id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Pasta técnica não encontrada.")
    return row


def _file_for_company(db: Session, arquivo_id: int, empresa_id: int) -> Arquivo:
    row = (
        db.query(Arquivo)
        .filter(Arquivo.id == int(arquivo_id), Arquivo.empresa_id == int(empresa_id))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Arquivo técnico não encontrado.")
    return row


def _format_client(cliente: Cliente) -> dict:
    endereco_parts = [
        _text(getattr(cliente, "endereco", None)),
        _text(getattr(cliente, "numero", None)),
        _text(getattr(cliente, "bairro", None)),
    ]
    endereco = ", ".join(item for item in endereco_parts if item)
    cidade_uf = " / ".join(item for item in [_text(getattr(cliente, "cidade", None)), _text(getattr(cliente, "estado", None))] if item)
    return {
        "id": int(cliente.id),
        "codigo": cliente.codigo,
        "nome": cliente.nome,
        "nome_fantasia": cliente.nome_fantasia,
        "situacao": cliente.situacao,
        "endereco": endereco or None,
        "cidade_uf": cidade_uf or None,
        "cep": cliente.cep,
        "entidade_tipo": "cliente",
    }


def _format_supplier(fornecedor: Fornecedor) -> dict:
    endereco_parts = [
        _text(getattr(fornecedor, "endereco", None)),
        _text(getattr(fornecedor, "numero", None)),
        _text(getattr(fornecedor, "bairro", None)),
    ]
    endereco = ", ".join(item for item in endereco_parts if item)
    cidade_uf = " / ".join(item for item in [_text(getattr(fornecedor, "cidade", None)), _text(getattr(fornecedor, "estado", None))] if item)
    return {
        "id": int(fornecedor.id),
        "codigo": fornecedor.codigo,
        "nome": fornecedor.nome,
        "nome_fantasia": fornecedor.nome_fantasia,
        "situacao": fornecedor.situacao,
        "endereco": endereco or None,
        "cidade_uf": cidade_uf or None,
        "cep": fornecedor.cep,
        "entidade_tipo": "fornecedor",
    }


def _format_folder(folder: Pasta, arquivo_count: int = 0, total_bytes: int = 0, ultima_atualizacao=None) -> dict:
    owner_type, owner_id = _folder_owner(folder)
    return {
        "id": int(folder.id),
        "cliente_id": int(folder.cliente_id) if folder.cliente_id is not None else None,
        "fornecedor_id": int(folder.fornecedor_id) if folder.fornecedor_id is not None else None,
        "entidade_tipo": owner_type,
        "entidade_id": owner_id,
        "nome": folder.nome,
        "icone": folder.icone or "fa-folder",
        "ordem": int(folder.ordem or 0),
        "personalizada": True,
        "arquivo_count": int(arquivo_count or 0),
        "total_bytes": int(total_bytes or 0),
        "ultima_atualizacao": ultima_atualizacao,
    }


def _format_file(row: Arquivo) -> dict:
    mime = _text(row.mime_type).lower()
    ext = _text(row.extensao).lower()
    is_image = mime.startswith("image/") or ext in {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    owner_type = "fornecedor" if getattr(row, "fornecedor_id", None) is not None else "cliente"
    owner_id = int(row.fornecedor_id) if owner_type == "fornecedor" else int(row.cliente_id)
    return {
        "id": int(row.id),
        "cliente_id": int(row.cliente_id) if row.cliente_id is not None else None,
        "fornecedor_id": int(row.fornecedor_id) if row.fornecedor_id is not None else None,
        "entidade_tipo": owner_type,
        "entidade_id": owner_id,
        "pasta_id": int(row.pasta_id),
        "titulo": row.titulo,
        "descricao": row.descricao,
        "arquivo_nome": row.arquivo_nome,
        "mime_type": row.mime_type,
        "extensao": row.extensao,
        "tamanho_bytes": int(row.tamanho_bytes or 0),
        "usuario_nome": row.usuario_nome,
        "criado_em": row.criado_em,
        "atualizado_em": row.atualizado_em,
        "is_image": is_image,
        "url": f"/api/arquivos-tecnicos/arquivos/{int(row.id)}/conteudo",
        "download_url": f"/api/arquivos-tecnicos/arquivos/{int(row.id)}/conteudo?download=1",
    }


def _physical_path(row: Arquivo) -> Path:
    relative = Path(_text(row.arquivo_path))
    candidate = (STORAGE_DIR / relative).resolve()
    try:
        candidate.relative_to(STORAGE_DIR)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Caminho de arquivo inválido.") from exc
    return candidate


class FolderIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    icone: Optional[str] = Field(default="fa-folder", max_length=80)


class FolderUpdateIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    icone: Optional[str] = Field(default=None, max_length=80)


class FileUpdateIn(BaseModel):
    titulo: Optional[str] = Field(default=None, max_length=180)
    descricao: Optional[str] = Field(default=None, max_length=2000)


@router.get("/resumo")
def resumo(
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    arquivos_q = db.query(
        func.count(Arquivo.id),
        func.coalesce(func.sum(Arquivo.tamanho_bytes), 0),
        func.count(func.distinct(Arquivo.cliente_id)),
        func.count(func.distinct(Arquivo.fornecedor_id)),
    ).filter(Arquivo.empresa_id == empresa_id).one()
    pastas = db.query(func.count(Pasta.id)).filter(Pasta.empresa_id == empresa_id).scalar() or 0
    return {
        "clientes_com_arquivos": int(arquivos_q[2] or 0),
        "fornecedores_com_arquivos": int(arquivos_q[3] or 0),
        "cadastros_com_arquivos": int(arquivos_q[2] or 0) + int(arquivos_q[3] or 0),
        "arquivos": int(arquivos_q[0] or 0),
        "pastas": int(pastas),
        "total_bytes": int(arquivos_q[1] or 0),
    }


@router.get("/clientes")
def listar_clientes(
    busca: str = Query(default="", max_length=180),
    pagina: int = Query(default=1, ge=1),
    por_pagina: int = Query(default=40, ge=10, le=100),
    somente_com_arquivos: bool = Query(default=False),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    files_sub = (
        db.query(
            Arquivo.cliente_id.label("cliente_id"),
            func.count(Arquivo.id).label("arquivo_count"),
            func.coalesce(func.sum(Arquivo.tamanho_bytes), 0).label("total_bytes"),
            func.max(Arquivo.criado_em).label("ultima_atualizacao"),
        )
        .filter(Arquivo.empresa_id == empresa_id, Arquivo.cliente_id.isnot(None))
        .group_by(Arquivo.cliente_id)
        .subquery()
    )
    folders_sub = (
        db.query(Pasta.cliente_id.label("cliente_id"), func.count(Pasta.id).label("pasta_count"))
        .filter(Pasta.empresa_id == empresa_id, Pasta.cliente_id.isnot(None))
        .group_by(Pasta.cliente_id)
        .subquery()
    )

    q = (
        db.query(
            Cliente,
            func.coalesce(files_sub.c.arquivo_count, 0),
            func.coalesce(files_sub.c.total_bytes, 0),
            files_sub.c.ultima_atualizacao,
            func.coalesce(folders_sub.c.pasta_count, 0),
        )
        .outerjoin(files_sub, files_sub.c.cliente_id == Cliente.id)
        .outerjoin(folders_sub, folders_sub.c.cliente_id == Cliente.id)
        .filter(Cliente.empresa_id == empresa_id)
    )

    term = _text(busca)
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            Cliente.nome.ilike(like),
            Cliente.nome_fantasia.ilike(like),
            Cliente.codigo.ilike(like),
            Cliente.cpf_cnpj.ilike(like),
            Cliente.endereco.ilike(like),
            Cliente.bairro.ilike(like),
            Cliente.cidade.ilike(like),
            Cliente.cep.ilike(like),
        ))
    if somente_com_arquivos:
        q = q.filter(func.coalesce(files_sub.c.arquivo_count, 0) > 0)

    total = q.count()
    rows = (
        q.order_by(Cliente.nome.asc(), Cliente.id.asc())
        .offset((pagina - 1) * por_pagina)
        .limit(por_pagina)
        .all()
    )
    items = []
    for cliente, file_count, total_bytes, updated, folder_count in rows:
        item = _format_client(cliente)
        item.update({
            "arquivo_count": int(file_count or 0),
            "pasta_count": int(folder_count or 0),
            "total_bytes": int(total_bytes or 0),
            "ultima_atualizacao": updated,
        })
        items.append(item)
    return {
        "items": items,
        "total": int(total),
        "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": max(1, (int(total) + por_pagina - 1) // por_pagina),
    }


@router.get("/fornecedores")
def listar_fornecedores(
    busca: str = Query(default="", max_length=180),
    pagina: int = Query(default=1, ge=1),
    por_pagina: int = Query(default=40, ge=10, le=100),
    somente_com_arquivos: bool = Query(default=False),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    files_sub = (
        db.query(
            Arquivo.fornecedor_id.label("fornecedor_id"),
            func.count(Arquivo.id).label("arquivo_count"),
            func.coalesce(func.sum(Arquivo.tamanho_bytes), 0).label("total_bytes"),
            func.max(Arquivo.criado_em).label("ultima_atualizacao"),
        )
        .filter(Arquivo.empresa_id == empresa_id, Arquivo.fornecedor_id.isnot(None))
        .group_by(Arquivo.fornecedor_id)
        .subquery()
    )
    folders_sub = (
        db.query(Pasta.fornecedor_id.label("fornecedor_id"), func.count(Pasta.id).label("pasta_count"))
        .filter(Pasta.empresa_id == empresa_id, Pasta.fornecedor_id.isnot(None))
        .group_by(Pasta.fornecedor_id)
        .subquery()
    )

    q = (
        db.query(
            Fornecedor,
            func.coalesce(files_sub.c.arquivo_count, 0),
            func.coalesce(files_sub.c.total_bytes, 0),
            files_sub.c.ultima_atualizacao,
            func.coalesce(folders_sub.c.pasta_count, 0),
        )
        .outerjoin(files_sub, files_sub.c.fornecedor_id == Fornecedor.id)
        .outerjoin(folders_sub, folders_sub.c.fornecedor_id == Fornecedor.id)
        .filter(Fornecedor.empresa_id == empresa_id)
    )

    term = _text(busca)
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            Fornecedor.nome.ilike(like),
            Fornecedor.nome_fantasia.ilike(like),
            Fornecedor.codigo.ilike(like),
            Fornecedor.cpf_cnpj.ilike(like),
            Fornecedor.endereco.ilike(like),
            Fornecedor.bairro.ilike(like),
            Fornecedor.cidade.ilike(like),
            Fornecedor.cep.ilike(like),
        ))
    if somente_com_arquivos:
        q = q.filter(func.coalesce(files_sub.c.arquivo_count, 0) > 0)

    total = q.count()
    rows = (
        q.order_by(Fornecedor.nome.asc(), Fornecedor.id.asc())
        .offset((pagina - 1) * por_pagina)
        .limit(por_pagina)
        .all()
    )
    items = []
    for fornecedor, file_count, total_bytes, updated, folder_count in rows:
        item = _format_supplier(fornecedor)
        item.update({
            "arquivo_count": int(file_count or 0),
            "pasta_count": int(folder_count or 0),
            "total_bytes": int(total_bytes or 0),
            "ultima_atualizacao": updated,
        })
        items.append(item)
    return {
        "items": items,
        "total": int(total),
        "pagina": pagina,
        "por_pagina": por_pagina,
        "paginas": max(1, (int(total) + por_pagina - 1) // por_pagina),
    }


@router.get("/fornecedores/{fornecedor_id}")
def detalhe_fornecedor(
    fornecedor_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    fornecedor = _supplier_for_company(db, fornecedor_id, empresa_id)
    counts = (
        db.query(
            Arquivo.pasta_id,
            func.count(Arquivo.id),
            func.coalesce(func.sum(Arquivo.tamanho_bytes), 0),
            func.max(Arquivo.criado_em),
        )
        .filter(Arquivo.empresa_id == empresa_id, Arquivo.fornecedor_id == int(fornecedor.id))
        .group_by(Arquivo.pasta_id)
        .all()
    )
    count_map = {int(row[0]): row[1:] for row in counts}
    folders = (
        db.query(Pasta)
        .filter(Pasta.empresa_id == empresa_id, Pasta.fornecedor_id == int(fornecedor.id))
        .order_by(Pasta.ordem.asc(), Pasta.nome.asc(), Pasta.id.asc())
        .all()
    )
    return {
        "fornecedor": _format_supplier(fornecedor),
        "pastas": [
            _format_folder(folder, *count_map.get(int(folder.id), (0, 0, None)))
            for folder in folders
        ],
    }


@router.post("/fornecedores/{fornecedor_id}/pastas", status_code=status.HTTP_201_CREATED)
def criar_pasta_fornecedor(
    fornecedor_id: int,
    payload: FolderIn,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    fornecedor = _supplier_for_company(db, fornecedor_id, empresa_id)
    nome = _text(payload.nome)
    duplicate = (
        db.query(Pasta.id)
        .filter(
            Pasta.empresa_id == empresa_id,
            Pasta.fornecedor_id == int(fornecedor.id),
            func.lower(Pasta.nome) == nome.lower(),
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Já existe uma pasta com este nome para o fornecedor.")
    max_order = (
        db.query(func.max(Pasta.ordem))
        .filter(Pasta.empresa_id == empresa_id, Pasta.fornecedor_id == int(fornecedor.id))
        .scalar()
        or 0
    )
    folder = Pasta(
        empresa_id=empresa_id,
        cliente_id=None,
        fornecedor_id=int(fornecedor.id),
        nome=nome,
        icone=_safe_icon(payload.icone),
        ordem=int(max_order) + 10,
        criado_por_id=int(current_user.id),
        criado_por_nome=_text(current_user.nome) or None,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _format_folder(folder)


@router.get("/clientes/{cliente_id}")
def detalhe_cliente(
    cliente_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    cliente = _client_for_company(db, cliente_id, empresa_id)
    counts = (
        db.query(
            Arquivo.pasta_id,
            func.count(Arquivo.id),
            func.coalesce(func.sum(Arquivo.tamanho_bytes), 0),
            func.max(Arquivo.criado_em),
        )
        .filter(Arquivo.empresa_id == empresa_id, Arquivo.cliente_id == int(cliente.id))
        .group_by(Arquivo.pasta_id)
        .all()
    )
    count_map = {int(row[0]): row[1:] for row in counts}
    folders = (
        db.query(Pasta)
        .filter(Pasta.empresa_id == empresa_id, Pasta.cliente_id == int(cliente.id))
        .order_by(Pasta.ordem.asc(), Pasta.nome.asc(), Pasta.id.asc())
        .all()
    )
    return {
        "cliente": _format_client(cliente),
        "pastas": [
            _format_folder(folder, *count_map.get(int(folder.id), (0, 0, None)))
            for folder in folders
        ],
    }


@router.post("/clientes/{cliente_id}/pastas", status_code=status.HTTP_201_CREATED)
def criar_pasta_cliente(
    cliente_id: int,
    payload: FolderIn,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    cliente = _client_for_company(db, cliente_id, empresa_id)
    nome = _text(payload.nome)
    duplicate = (
        db.query(Pasta.id)
        .filter(
            Pasta.empresa_id == empresa_id,
            Pasta.cliente_id == int(cliente.id),
            func.lower(Pasta.nome) == nome.lower(),
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Já existe uma pasta com este nome para o cliente.")
    max_order = (
        db.query(func.max(Pasta.ordem))
        .filter(Pasta.empresa_id == empresa_id, Pasta.cliente_id == int(cliente.id))
        .scalar()
        or 0
    )
    folder = Pasta(
        empresa_id=empresa_id,
        cliente_id=int(cliente.id),
        fornecedor_id=None,
        nome=nome,
        icone=_safe_icon(payload.icone),
        ordem=int(max_order) + 10,
        criado_por_id=int(current_user.id),
        criado_por_nome=_text(current_user.nome) or None,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return _format_folder(folder)


@router.patch("/pastas/{pasta_id}")
def editar_pasta_cliente(
    pasta_id: int,
    payload: FolderUpdateIn,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = _folder_for_company(db, pasta_id, int(current_user.empresa_id))
    nome = _text(payload.nome)
    owner_type, owner_id = _folder_owner(folder)
    owner_filter = (Pasta.fornecedor_id == owner_id) if owner_type == "fornecedor" else (Pasta.cliente_id == owner_id)
    duplicate = (
        db.query(Pasta.id)
        .filter(
            Pasta.empresa_id == int(current_user.empresa_id),
            owner_filter,
            Pasta.id != int(folder.id),
            func.lower(Pasta.nome) == nome.lower(),
        )
        .first()
    )
    if duplicate:
        label = "fornecedor" if owner_type == "fornecedor" else "cliente"
        raise HTTPException(status_code=409, detail=f"Já existe uma pasta com este nome para o {label}.")
    folder.nome = nome
    if payload.icone is not None:
        folder.icone = _safe_icon(payload.icone)
    db.commit()
    db.refresh(folder)
    return _format_folder(folder)


@router.delete("/pastas/{pasta_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_pasta_cliente(
    pasta_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = _folder_for_company(db, pasta_id, int(current_user.empresa_id))
    count = db.query(func.count(Arquivo.id)).filter(Arquivo.pasta_id == int(folder.id)).scalar() or 0
    if count:
        raise HTTPException(status_code=409, detail="A pasta possui arquivos. Exclua ou mova os arquivos antes de remover a pasta.")
    db.delete(folder)
    db.commit()
    return None


@router.get("/pastas/{pasta_id}/arquivos")
def listar_arquivos_pasta(
    pasta_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = _folder_for_company(db, pasta_id, int(current_user.empresa_id))
    rows = (
        db.query(Arquivo)
        .filter(Arquivo.empresa_id == int(current_user.empresa_id), Arquivo.pasta_id == int(folder.id))
        .order_by(Arquivo.criado_em.desc(), Arquivo.id.desc())
        .all()
    )
    return {"pasta": _format_folder(folder, len(rows), sum(int(x.tamanho_bytes or 0) for x in rows)), "items": [_format_file(row) for row in rows]}


@router.post("/pastas/{pasta_id}/arquivos", status_code=status.HTTP_201_CREATED)
def enviar_arquivos(
    pasta_id: int,
    arquivos: List[UploadFile] = File(...),
    descricao: Optional[str] = Form(default=None),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    folder = _folder_for_company(db, pasta_id, empresa_id)
    owner_type, owner_id = _folder_owner(folder)
    if owner_type == "fornecedor":
        _supplier_for_company(db, owner_id, empresa_id)
    else:
        _client_for_company(db, owner_id, empresa_id)
    if not arquivos:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um arquivo.")
    if len(arquivos) > 30:
        raise HTTPException(status_code=400, detail="Envie no máximo 30 arquivos por vez.")

    # Mantém o caminho histórico dos clientes e separa fornecedores em um
    # namespace próprio para evitar qualquer colisão de IDs.
    if owner_type == "fornecedor":
        relative_dir = Path(str(empresa_id)) / "fornecedores" / str(owner_id) / str(int(folder.id))
    else:
        relative_dir = Path(str(empresa_id)) / str(owner_id) / str(int(folder.id))
    target_dir = (STORAGE_DIR / relative_dir).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: list[Path] = []
    rows: list[Arquivo] = []
    try:
        for upload in arquivos:
            original_name = Path(_text(upload.filename)).name
            if not original_name:
                raise HTTPException(status_code=400, detail="Um dos arquivos enviados é inválido.")
            ext = Path(original_name).suffix.lower()
            content_type = _text(upload.content_type).lower() or (mimetypes.guess_type(original_name)[0] or "application/octet-stream")
            if ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(status_code=415, detail=f"Tipo de arquivo não permitido: {original_name}")

            stored_name = f"{uuid4().hex}{ext[:20]}"
            relative_path = relative_dir / stored_name
            target = (STORAGE_DIR / relative_path).resolve()
            saved_paths.append(target)
            total = 0
            with target.open("wb") as buffer:
                while True:
                    chunk = upload.file.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_FILE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail=f"'{original_name}' excede o limite de {MAX_FILE_BYTES // (1024 * 1024)} MB.",
                        )
                    buffer.write(chunk)
            row = Arquivo(
                empresa_id=empresa_id,
                cliente_id=owner_id if owner_type == "cliente" else None,
                fornecedor_id=owner_id if owner_type == "fornecedor" else None,
                pasta_id=int(folder.id),
                titulo=Path(original_name).stem[:180] or None,
                descricao=_text(descricao)[:2000] or None,
                arquivo_nome=original_name[:255],
                arquivo_path=relative_path.as_posix(),
                mime_type=content_type[:120],
                extensao=ext[:20] or None,
                tamanho_bytes=total,
                usuario_id=int(current_user.id),
                usuario_nome=_text(current_user.nome)[:120] or None,
            )
            db.add(row)
            rows.append(row)
        db.commit()
        for row in rows:
            db.refresh(row)
        return {"items": [_format_file(row) for row in rows], "total": len(rows)}
    except Exception:
        db.rollback()
        for path in saved_paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    finally:
        for upload in arquivos:
            try:
                upload.file.close()
            except Exception:
                pass


@router.patch("/arquivos/{arquivo_id}")
def editar_arquivo(
    arquivo_id: int,
    payload: FileUpdateIn,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    row.titulo = _text(payload.titulo)[:180] or None
    row.descricao = _text(payload.descricao)[:2000] or None
    db.commit()
    db.refresh(row)
    return _format_file(row)


@router.get("/arquivos/{arquivo_id}/conteudo")
def conteudo_arquivo(
    arquivo_id: int,
    download: bool = Query(default=False),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    path = _physical_path(row)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Arquivo físico não encontrado.")
    headers = {
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    if download:
        safe_name = _text(row.arquivo_nome) or path.name
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(safe_name)}"
    return FileResponse(path, media_type=row.mime_type or "application/octet-stream", headers=headers)


@router.delete("/arquivos/{arquivo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_arquivo(
    arquivo_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    path = _physical_path(row)
    db.delete(row)
    db.commit()
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass
    return None
