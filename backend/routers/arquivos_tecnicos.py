from __future__ import annotations

import hashlib
import mimetypes
import os
import re
from pathlib import Path
from typing import List, Optional
from uuid import uuid4
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal, get_db
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


def _folder_owner(folder: Pasta) -> tuple[str, Optional[int]]:
    if getattr(folder, "fornecedor_id", None) is not None:
        return "fornecedor", int(folder.fornecedor_id)
    if getattr(folder, "cliente_id", None) is not None:
        return "cliente", int(folder.cliente_id)
    # Sem cliente e sem fornecedor = biblioteca geral da empresa.
    return "geral", None


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
    browser_image_exts = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    browser_image_mimes = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    is_image = mime.startswith("image/") or ext in browser_image_exts
    if getattr(row, "fornecedor_id", None) is not None:
        owner_type, owner_id = "fornecedor", int(row.fornecedor_id)
    elif getattr(row, "cliente_id", None) is not None:
        owner_type, owner_id = "cliente", int(row.cliente_id)
    else:
        owner_type, owner_id = "geral", None
    printable = bool(ext in browser_image_exts or mime in browser_image_mimes or ext == ".pdf" or mime == "application/pdf")
    available = _file_available(row)
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
        "imprimivel": printable,
        "disponivel": available,
        "precisa_reparo": not available,
        "url": f"/api/arquivos-tecnicos/arquivos/{int(row.id)}/conteudo",
        "download_url": f"/api/arquivos-tecnicos/arquivos/{int(row.id)}/conteudo?download=1",
    }


def _storage_roots() -> list[Path]:
    """Raízes conhecidas para recuperar instalações antigas do Valora."""
    roots: list[Path] = []
    configured_legacy = [
        Path(value).expanduser().resolve()
        for value in _text(os.getenv("ARQUIVOS_TECNICOS_LEGACY_DIRS")).split(os.pathsep)
        if _text(value)
    ]
    candidates = [
        STORAGE_DIR,
        *configured_legacy,
        (BASE_DIR / "uploads" / "arquivos_tecnicos").resolve(),
        (BASE_DIR / "backend" / "uploads" / "arquivos_tecnicos").resolve(),
        (Path.cwd() / "uploads" / "arquivos_tecnicos").resolve(),
        Path("/app/uploads/arquivos_tecnicos"),
        Path("/app/backend/uploads/arquivos_tecnicos"),
        Path("/data/uploads/arquivos_tecnicos"),
        Path("/data/arquivos_tecnicos"),
        Path("/storage/arquivos_tecnicos"),
        Path("/uploads/arquivos_tecnicos"),
    ]
    for candidate in candidates:
        try:
            candidate = candidate.resolve()
        except OSError:
            continue
        if candidate not in roots:
            roots.append(candidate)
    return roots


def _legacy_candidate_matches(row: Arquivo, candidate: Path) -> bool:
    if not candidate.exists() or not candidate.is_file():
        return False
    expected_size = int(getattr(row, "tamanho_bytes", 0) or 0)
    if expected_size > 0:
        try:
            if int(candidate.stat().st_size) != expected_size:
                return False
        except OSError:
            return False
    return True


def _physical_path(row: Arquivo) -> Path:
    relative_text = _text(row.arquivo_path)
    if not relative_text:
        return (STORAGE_DIR / "__arquivo_inexistente__").resolve()
    relative = Path(relative_text)
    if relative.is_absolute() or ".." in relative.parts:
        raise HTTPException(status_code=400, detail="Caminho de arquivo inválido.")

    roots = _storage_roots()
    primary = (roots[0] / relative).resolve()

    # 1) Caminho exato gravado pelas versões anteriores.
    for root in roots:
        candidate = (root / relative).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if candidate.exists() and candidate.is_file():
            return candidate

    # 2) Algumas instalações antigas mantiveram o arquivo na mesma pasta,
    # porém com o nome original em vez do UUID físico.
    original_name = Path(_text(getattr(row, "arquivo_nome", None))).name
    if original_name:
        for root in roots:
            candidate = (root / relative.parent / original_name).resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                continue
            if _legacy_candidate_matches(row, candidate):
                return candidate

    # 3) Última tentativa limitada às raízes conhecidas: procura pelo UUID físico
    # e depois pelo nome original. Isso cobre mudanças de pasta/volume no deploy.
    search_names = []
    if relative.name:
        search_names.append(relative.name)
    if original_name and original_name not in search_names:
        search_names.append(original_name)
    for search_name in search_names:
        for root in roots:
            if not root.exists():
                continue
            try:
                for candidate in root.rglob(search_name):
                    resolved = candidate.resolve()
                    try:
                        resolved.relative_to(root)
                    except ValueError:
                        continue
                    if search_name == original_name:
                        if _legacy_candidate_matches(row, resolved):
                            return resolved
                    elif resolved.is_file():
                        return resolved
            except OSError:
                continue
    return primary


def _file_available(row: Arquivo) -> bool:
    # Arquivos novos vivem no PostgreSQL; não carregamos o BYTEA aqui para não
    # pesar listagens. A flag leve informa se o conteúdo já está persistido.
    if bool(getattr(row, "conteudo_no_banco", False)):
        return True
    try:
        path = _physical_path(row)
        return path.exists() and path.is_file()
    except HTTPException:
        return False


def _database_bytes(row: Arquivo) -> bytes | None:
    raw = getattr(row, "arquivo_conteudo", None)
    if raw is None:
        return None
    if isinstance(raw, memoryview):
        return raw.tobytes()
    return bytes(raw)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _persist_content(
    row: Arquivo,
    content: bytes,
    *,
    original_name: str | None = None,
    mime_type: str | None = None,
    update_path: bool = False,
) -> None:
    """Persiste o binário no próprio registro sem depender do filesystem."""
    payload = bytes(content)
    row.arquivo_conteudo = payload
    row.conteudo_no_banco = True
    row.arquivo_sha256 = _sha256(payload)
    row.tamanho_bytes = len(payload)
    if original_name:
        clean_name = Path(_text(original_name)).name
        if clean_name:
            row.arquivo_nome = clean_name[:255]
            if not _text(row.titulo):
                row.titulo = Path(clean_name).stem[:180] or None
    if mime_type:
        row.mime_type = _text(mime_type)[:120] or row.mime_type
    if update_path:
        ext = Path(_text(row.arquivo_nome)).suffix.lower()[:20]
        row.extensao = ext or row.extensao
        row.arquivo_path = f"db/{uuid4().hex}{ext}"


def _recover_from_database_peer(row: Arquivo, db: Session) -> bytes | None:
    """Recupera um legado a partir de outra cópia íntegra existente na empresa.

    Isso é importante porque o mesmo catálogo pode ter sido enviado em mais de uma
    pasta. Se uma cópia já está no BYTEA, ela consegue reparar as demais sem novo upload.
    """
    empresa_id = int(row.empresa_id)
    expected_size = int(getattr(row, "tamanho_bytes", 0) or 0)
    known_hash = _text(getattr(row, "arquivo_sha256", None)).lower()

    query = db.query(Arquivo).filter(
        Arquivo.empresa_id == empresa_id,
        Arquivo.id != int(row.id),
        Arquivo.conteudo_no_banco.is_(True),
        Arquivo.arquivo_conteudo.isnot(None),
    )
    if known_hash:
        query = query.filter(Arquivo.arquivo_sha256 == known_hash)
    else:
        original_name = Path(_text(getattr(row, "arquivo_nome", None))).name
        if not original_name:
            return None
        query = query.filter(func.lower(Arquivo.arquivo_nome) == original_name.lower())
        if expected_size > 0:
            query = query.filter(Arquivo.tamanho_bytes == expected_size)

    for peer in query.order_by(Arquivo.id.asc()).limit(12).all():
        content = _database_bytes(peer)
        if content is None:
            continue
        if expected_size > 0 and len(content) != expected_size:
            continue
        digest = _sha256(content)
        if known_hash and digest != known_hash:
            continue
        row.arquivo_conteudo = content
        row.conteudo_no_banco = True
        row.arquivo_sha256 = digest
        if not int(row.tamanho_bytes or 0):
            row.tamanho_bytes = len(content)
        return content
    return None


def _read_content(row: Arquivo, db: Session, *, persist_legacy: bool = True) -> bytes:
    """Lê do banco e tenta autorreparar qualquer registro legado antes de falhar."""
    content = _database_bytes(row)
    if content is not None:
        changed = False
        if not bool(getattr(row, "conteudo_no_banco", False)):
            row.conteudo_no_banco = True
            changed = True
        if not _text(getattr(row, "arquivo_sha256", None)):
            row.arquivo_sha256 = _sha256(content)
            changed = True
        if not int(row.tamanho_bytes or 0):
            row.tamanho_bytes = len(content)
            changed = True
        if changed:
            db.commit()
        return content

    # Antes de procurar no disco, tenta outra cópia íntegra já salva no banco.
    peer_content = _recover_from_database_peer(row, db)
    if peer_content is not None:
        db.commit()
        return peer_content

    path = _physical_path(row)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Conteúdo do arquivo técnico não está disponível.")

    try:
        content = path.read_bytes()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="Conteúdo do arquivo técnico não está disponível.") from exc

    # Ao primeiro acesso de um arquivo físico antigo, ele é migrado para o BYTEA.
    if persist_legacy:
        _persist_content(row, content)
        db.commit()
    return content


def _missing_content_query(db: Session, empresa_id: int | None = None):
    query = db.query(Arquivo).filter(
        or_(
            Arquivo.conteudo_no_banco.is_(False),
            Arquivo.conteudo_no_banco.is_(None),
            Arquivo.arquivo_conteudo.is_(None),
        )
    )
    if empresa_id is not None:
        query = query.filter(Arquivo.empresa_id == int(empresa_id))
    return query


def _repair_matching_legacy_rows(
    db: Session,
    *,
    empresa_id: int,
    original_name: str,
    content: bytes,
    mime_type: str | None = None,
) -> list[Arquivo]:
    """Repara TODAS as cópias legadas equivalentes da empresa com um único upload."""
    clean_name = Path(_text(original_name)).name
    if not clean_name:
        return []
    payload = bytes(content)
    total = len(payload)
    repaired: list[Arquivo] = []
    candidates = (
        _missing_content_query(db, empresa_id)
        .filter(func.lower(Arquivo.arquivo_nome) == clean_name.lower())
        .order_by(Arquivo.id.asc())
        .all()
    )
    for candidate in candidates:
        expected_size = int(candidate.tamanho_bytes or 0)
        # Nome + tamanho evita preencher por engano duas revisões diferentes com o mesmo nome.
        if expected_size > 0 and expected_size != total:
            continue
        _persist_content(candidate, payload, original_name=clean_name, mime_type=mime_type)
        repaired.append(candidate)

    if repaired:
        return repaired

    # Se o usuário possui o mesmo arquivo com o nome local alterado, usamos
    # tamanho + extensão somente quando existe UM ÚNICO candidato possível.
    ext = Path(clean_name).suffix.lower()
    fallback = (
        _missing_content_query(db, empresa_id)
        .filter(Arquivo.tamanho_bytes == total)
        .order_by(Arquivo.id.asc())
        .all()
    )
    if ext:
        fallback = [item for item in fallback if _text(item.extensao).lower() == ext]
    if len(fallback) == 1:
        candidate = fallback[0]
        _persist_content(candidate, payload, mime_type=mime_type)
        repaired.append(candidate)
    return repaired


def migrate_legacy_files_to_database(*, empresa_id: int | None = None, limit: int = 5000) -> dict:
    """Backfill global: filesystem/duplicatas -> PostgreSQL.

    É seguro chamar em cada deploy. Registros já migrados são ignorados e os que
    realmente perderam o binário permanecem pendentes para o reparo por upload.
    """
    db = SessionLocal()
    migrated = 0
    missing: list[dict] = []
    try:
        rows = _missing_content_query(db, empresa_id).order_by(Arquivo.id.asc()).limit(max(1, int(limit))).all()
        for row in rows:
            try:
                _read_content(row, db, persist_legacy=True)
                migrated += 1
            except HTTPException as exc:
                if exc.status_code != 404:
                    raise
                missing.append({
                    "id": int(row.id),
                    "empresa_id": int(row.empresa_id),
                    "arquivo_nome": row.arquivo_nome,
                    "tamanho_bytes": int(row.tamanho_bytes or 0),
                    "pasta_id": int(row.pasta_id),
                })
        return {"migrados": migrated, "pendentes": len(missing), "itens_pendentes": missing}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


class FolderIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    icone: Optional[str] = Field(default="fa-folder", max_length=80)


class FolderUpdateIn(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    icone: Optional[str] = Field(default=None, max_length=80)


class FileUpdateIn(BaseModel):
    titulo: Optional[str] = Field(default=None, max_length=180)
    descricao: Optional[str] = Field(default=None, max_length=2000)


@router.post("/legados/migrar")
def migrar_arquivos_legados(
    current_user: models.Usuario = Depends(get_current_user),
):
    """Tenta recuperar em lote tudo que ainda existir no storage antigo ou em duplicatas."""
    result = migrate_legacy_files_to_database(empresa_id=int(current_user.empresa_id), limit=5000)
    return {
        "migrados": int(result.get("migrados") or 0),
        "pendentes": int(result.get("pendentes") or 0),
    }


@router.get("/legados/status")
def status_arquivos_legados(
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    rows = (
        _missing_content_query(db, empresa_id)
        .order_by(Arquivo.id.asc())
        .limit(200)
        .all()
    )
    return {
        "pendentes": len(rows),
        "items": [
            {
                "id": int(row.id),
                "arquivo_nome": row.arquivo_nome,
                "tamanho_bytes": int(row.tamanho_bytes or 0),
                "pasta_id": int(row.pasta_id),
            }
            for row in rows
        ],
    }


@router.post("/legados/reparar")
def reparar_arquivos_legados(
    arquivos: List[UploadFile] = File(...),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restaura registros antigos pelo nome+tamanho, sem alterar seus IDs/referências."""
    if not arquivos:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um arquivo.")
    if len(arquivos) > 60:
        raise HTTPException(status_code=400, detail="Selecione no máximo 60 arquivos por vez.")

    empresa_id = int(current_user.empresa_id)
    repaired_ids: set[int] = set()
    matched_files: list[str] = []
    unmatched_files: list[str] = []
    try:
        for upload in arquivos:
            original_name = Path(_text(upload.filename)).name
            if not original_name:
                continue
            ext = Path(original_name).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                unmatched_files.append(original_name)
                continue
            content_type = _text(upload.content_type).lower() or (mimetypes.guess_type(original_name)[0] or "application/octet-stream")
            total = 0
            content = bytearray()
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
                content.extend(chunk)
            payload = bytes(content)
            repaired = _repair_matching_legacy_rows(
                db,
                empresa_id=empresa_id,
                original_name=original_name,
                content=payload,
                mime_type=content_type,
            )
            if repaired:
                matched_files.append(original_name)
                for row in repaired:
                    row.arquivo_path = f"db/{uuid4().hex}{ext[:20]}"
                    row.extensao = ext[:20] or row.extensao
                    row.usuario_id = int(current_user.id)
                    row.usuario_nome = _text(current_user.nome)[:120] or None
                    repaired_ids.add(int(row.id))
            else:
                unmatched_files.append(original_name)

        db.commit()
        pending = _missing_content_query(db, empresa_id).count()
        return {
            "arquivos_recebidos": len(arquivos),
            "arquivos_reconhecidos": len(matched_files),
            "registros_reparados": len(repaired_ids),
            "pendentes": int(pending or 0),
            "nao_reconhecidos": unmatched_files,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        for upload in arquivos:
            try:
                upload.file.close()
            except Exception:
                pass


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
    arquivos_gerais = (
        db.query(func.count(Arquivo.id))
        .filter(
            Arquivo.empresa_id == empresa_id,
            Arquivo.cliente_id.is_(None),
            Arquivo.fornecedor_id.is_(None),
        )
        .scalar()
        or 0
    )
    return {
        "clientes_com_arquivos": int(arquivos_q[2] or 0),
        "fornecedores_com_arquivos": int(arquivos_q[3] or 0),
        "arquivos_gerais": int(arquivos_gerais),
        "cadastros_com_arquivos": int(arquivos_q[2] or 0) + int(arquivos_q[3] or 0),
        "arquivos": int(arquivos_q[0] or 0),
        "pastas": int(pastas),
        "total_bytes": int(arquivos_q[1] or 0),
    }


@router.get("/geral")
def biblioteca_geral(
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    counts = (
        db.query(
            Arquivo.pasta_id,
            func.count(Arquivo.id),
            func.coalesce(func.sum(Arquivo.tamanho_bytes), 0),
            func.max(Arquivo.criado_em),
        )
        .filter(
            Arquivo.empresa_id == empresa_id,
            Arquivo.cliente_id.is_(None),
            Arquivo.fornecedor_id.is_(None),
        )
        .group_by(Arquivo.pasta_id)
        .all()
    )
    count_map = {int(row[0]): row[1:] for row in counts}
    folders = (
        db.query(Pasta)
        .filter(
            Pasta.empresa_id == empresa_id,
            Pasta.cliente_id.is_(None),
            Pasta.fornecedor_id.is_(None),
        )
        .order_by(Pasta.ordem.asc(), Pasta.nome.asc(), Pasta.id.asc())
        .all()
    )
    return {
        "geral": {
            "entidade_tipo": "geral",
            "nome": "Biblioteca geral",
            "descricao": "Documentos reutilizáveis em orçamentos e propostas.",
        },
        "pastas": [
            _format_folder(folder, *count_map.get(int(folder.id), (0, 0, None)))
            for folder in folders
        ],
    }


@router.get("/geral/arquivos")
def listar_arquivos_gerais(
    somente_imprimiveis: bool = Query(default=False),
    busca: str = Query(default="", max_length=180),
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    q = (
        db.query(Arquivo, Pasta.nome.label("pasta_nome"), Pasta.ordem.label("pasta_ordem"))
        .join(Pasta, Pasta.id == Arquivo.pasta_id)
        .filter(
            Arquivo.empresa_id == empresa_id,
            Pasta.empresa_id == empresa_id,
            Arquivo.cliente_id.is_(None),
            Arquivo.fornecedor_id.is_(None),
            Pasta.cliente_id.is_(None),
            Pasta.fornecedor_id.is_(None),
        )
    )
    term = _text(busca)
    if term:
        like = f"%{term}%"
        q = q.filter(or_(
            Arquivo.titulo.ilike(like),
            Arquivo.arquivo_nome.ilike(like),
            Arquivo.descricao.ilike(like),
            Pasta.nome.ilike(like),
        ))
    rows = q.order_by(Pasta.ordem.asc(), Pasta.nome.asc(), Arquivo.criado_em.desc(), Arquivo.id.desc()).all()
    items = []
    for row, pasta_nome, _pasta_ordem in rows:
        item = _format_file(row)
        item["pasta_nome"] = pasta_nome
        if somente_imprimiveis and (not item["imprimivel"] or not item.get("disponivel", False)):
            continue
        items.append(item)
    return {"items": items, "total": len(items)}


@router.post("/geral/pastas", status_code=status.HTTP_201_CREATED)
def criar_pasta_geral(
    payload: FolderIn,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    empresa_id = int(current_user.empresa_id)
    nome = _text(payload.nome)
    duplicate = (
        db.query(Pasta.id)
        .filter(
            Pasta.empresa_id == empresa_id,
            Pasta.cliente_id.is_(None),
            Pasta.fornecedor_id.is_(None),
            func.lower(Pasta.nome) == nome.lower(),
        )
        .first()
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="Já existe uma pasta com este nome na biblioteca geral.")
    max_order = (
        db.query(func.max(Pasta.ordem))
        .filter(
            Pasta.empresa_id == empresa_id,
            Pasta.cliente_id.is_(None),
            Pasta.fornecedor_id.is_(None),
        )
        .scalar()
        or 0
    )
    folder = Pasta(
        empresa_id=empresa_id,
        cliente_id=None,
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
    filters = [
        Pasta.empresa_id == int(current_user.empresa_id),
        Pasta.id != int(folder.id),
        func.lower(Pasta.nome) == nome.lower(),
    ]
    if owner_type == "fornecedor":
        filters.extend([Pasta.fornecedor_id == int(owner_id), Pasta.cliente_id.is_(None)])
        duplicate_label = "fornecedor"
    elif owner_type == "cliente":
        filters.extend([Pasta.cliente_id == int(owner_id), Pasta.fornecedor_id.is_(None)])
        duplicate_label = "cliente"
    else:
        filters.extend([Pasta.cliente_id.is_(None), Pasta.fornecedor_id.is_(None)])
        duplicate_label = "biblioteca geral"
    duplicate = db.query(Pasta.id).filter(*filters).first()
    if duplicate:
        if owner_type == "geral":
            raise HTTPException(status_code=409, detail="Já existe uma pasta com este nome na biblioteca geral.")
        raise HTTPException(status_code=409, detail=f"Já existe uma pasta com este nome para o {duplicate_label}.")
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
        _supplier_for_company(db, int(owner_id), empresa_id)
    elif owner_type == "cliente":
        _client_for_company(db, int(owner_id), empresa_id)
    if not arquivos:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um arquivo.")
    if len(arquivos) > 30:
        raise HTTPException(status_code=400, detail="Envie no máximo 30 arquivos por vez.")

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

            total = 0
            content = bytearray()
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
                content.extend(chunk)

            stored_name = f"{uuid4().hex}{ext[:20]}"
            payload = bytes(content)

            # Um único reenvio recupera TODAS as cópias antigas equivalentes da
            # empresa (Biblioteca Geral, clientes, fornecedores e orçamentos).
            repaired_rows = _repair_matching_legacy_rows(
                db,
                empresa_id=empresa_id,
                original_name=original_name,
                content=payload,
                mime_type=content_type,
            )
            same_folder_repaired = next(
                (item for item in repaired_rows if int(item.pasta_id) == int(folder.id)),
                None,
            )
            if same_folder_repaired is not None:
                same_folder_repaired.arquivo_path = f"db/{stored_name}"
                same_folder_repaired.extensao = ext[:20] or None
                same_folder_repaired.usuario_id = int(current_user.id)
                same_folder_repaired.usuario_nome = _text(current_user.nome)[:120] or None
                if _text(descricao):
                    same_folder_repaired.descricao = _text(descricao)[:2000] or None
                rows.append(same_folder_repaired)
                continue

            row = Arquivo(
                empresa_id=empresa_id,
                cliente_id=int(owner_id) if owner_type == "cliente" else None,
                fornecedor_id=int(owner_id) if owner_type == "fornecedor" else None,
                pasta_id=int(folder.id),
                titulo=Path(original_name).stem[:180] or None,
                descricao=_text(descricao)[:2000] or None,
                arquivo_nome=original_name[:255],
                # Mantemos um identificador textual somente por compatibilidade
                # com o schema antigo. O conteúdo real fica no BYTEA abaixo.
                arquivo_path=f"db/{stored_name}",
                arquivo_conteudo=payload,
                conteudo_no_banco=True,
                arquivo_sha256=_sha256(payload),
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
    content = _read_content(row, db, persist_legacy=True)
    headers = {
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
    }
    if download:
        safe_name = _text(row.arquivo_nome) or f"arquivo-{int(row.id)}"
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(safe_name)}"
    return Response(content=content, media_type=row.mime_type or "application/octet-stream", headers=headers)


@router.get("/arquivos/{arquivo_id}/paginas")
def paginas_arquivo_pdf(
    arquivo_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    ext = _text(row.extensao).lower()
    mime = _text(row.mime_type).lower()
    if ext != ".pdf" and mime != "application/pdf":
        raise HTTPException(status_code=415, detail="O arquivo não é um PDF.")
    content = _read_content(row, db, persist_legacy=True)
    try:
        import fitz
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Renderização de PDF indisponível no servidor.") from exc
    try:
        with fitz.open(stream=content, filetype="pdf") as document:
            return {"arquivo_id": int(row.id), "paginas": int(document.page_count)}
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Não foi possível ler este PDF.") from exc


@router.get("/arquivos/{arquivo_id}/paginas/{pagina}.png")
def renderizar_pagina_pdf(
    arquivo_id: int,
    pagina: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    ext = _text(row.extensao).lower()
    mime = _text(row.mime_type).lower()
    if ext != ".pdf" and mime != "application/pdf":
        raise HTTPException(status_code=415, detail="O arquivo não é um PDF.")
    pdf_content = _read_content(row, db, persist_legacy=True)
    try:
        import fitz
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="Renderização de PDF indisponível no servidor.") from exc
    try:
        with fitz.open(stream=pdf_content, filetype="pdf") as document:
            if pagina < 1 or pagina > int(document.page_count):
                raise HTTPException(status_code=404, detail="Página do PDF não encontrada.")
            page = document.load_page(pagina - 1)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            content = pixmap.tobytes("png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Não foi possível renderizar esta página do PDF.") from exc
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/arquivos/{arquivo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_arquivo(
    arquivo_id: int,
    current_user: models.Usuario = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _file_for_company(db, arquivo_id, int(current_user.empresa_id))
    legacy_path = None
    if not bool(getattr(row, "conteudo_no_banco", False)):
        try:
            legacy_path = _physical_path(row)
        except HTTPException:
            legacy_path = None
    db.delete(row)
    db.commit()
    if legacy_path is not None:
        try:
            legacy_path.unlink(missing_ok=True)
        except OSError:
            pass
    return None
