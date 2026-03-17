# backend/routers/fornecedores.py
from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend import models

router = APIRouter(prefix="/api/fornecedores", tags=["Fornecedores"])

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

try:
    from pydantic import ConfigDict  # type: ignore
    class _Cfg:
        model_config = ConfigDict(from_attributes=True)
except Exception:
    class _Cfg:
        class Config:
            orm_mode = True

def norm_str(s: Optional[str]) -> Optional[str]:
    v = (s or "").strip()
    return v or None

# =========================================================
# AUTH VIA COOKIE (COM BYPASS DE TESTE)
# =========================================================
def get_empresa_id_from_cookie(request: Request) -> int:
    empresa_id = request.cookies.get("empresa_id")
    if not empresa_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    try:
        return int(empresa_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="empresa_id inválido.")

def get_user_id_from_cookie(request: Request) -> int:
    user_id = request.cookies.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=401, detail="user_id inválido.")

def validar_usuario_empresa(
    request: Request,
    db: Session,
) -> int:
    # ========================================================
    # 🚧 BYPASS TEMPORÁRIO PARA TESTES DO FRONTEND 🚧
    # Retorna Empresa 1 para evitar o erro 401 Unauthorized
    # ========================================================
    return 1

    # --- CÓDIGO REAL (Para quando o login existir) ---
    # empresa_id = get_empresa_id_from_cookie(request)
    # user_id = get_user_id_from_cookie(request)
    # user = db.query(models.Usuario).filter(models.Usuario.id == user_id).filter(models.Usuario.empresa_id == empresa_id).first()
    # if not user:
    #     raise HTTPException(status_code=401, detail="Usuário inválido para esta empresa.")
    # if hasattr(user, "ativo") and user.ativo is False:
    #     raise HTTPException(status_code=403, detail="Usuário inativo.")
    # return empresa_id

def gerar_codigo_fornecedor(db: Session, empresa_id: int) -> str:
    ultimo = (
        db.query(models.Fornecedor)
        .filter(models.Fornecedor.empresa_id == empresa_id)
        .order_by(models.Fornecedor.id.desc())
        .first()
    )
    proximo = (int(ultimo.id) if ultimo else 0) + 1
    return f"FOR-{proximo:04d}"

# =========================
# SCHEMAS FORNECEDOR
# =========================
class FornecedorBase(BaseModel):
    codigo: Optional[str] = None
    nome: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    custom_fields: Optional[Dict[str, str]] = None

class FornecedorCreate(FornecedorBase):
    nome: str

class FornecedorUpdate(FornecedorBase):
    pass

class FornecedorOut(FornecedorBase, _Cfg):
    id: int
    empresa_id: int

# =========================
# SCHEMAS CAMPOS
# =========================
class CampoFornecedorBase(BaseModel):
    nome: Optional[str] = None
    slug: Optional[str] = None
    tipo: Optional[str] = None
    obrigatorio: Optional[bool] = False
    ativo: Optional[bool] = True
    opcoes_json: Optional[str] = None
    ordem: Optional[int] = 0

class CampoFornecedorCreate(CampoFornecedorBase):
    nome: str
    slug: str
    tipo: str

class CampoFornecedorUpdate(CampoFornecedorBase):
    pass

class CampoFornecedorOut(CampoFornecedorBase, _Cfg):
    id: int
    empresa_id: int

# =========================
# HELPERS CAMPOS
# =========================
def campo_to_out(c: models.CampoFornecedor) -> CampoFornecedorOut:
    return CampoFornecedorOut(
        id=int(c.id),
        empresa_id=int(c.empresa_id),
        nome=c.nome,
        slug=c.slug,
        tipo=c.tipo,
        obrigatorio=bool(c.obrigatorio),
        ativo=bool(c.ativo),
        opcoes_json=c.opcoes_json,
        ordem=int(c.ordem or 0),
    )

def buscar_campo_empresa(
    db: Session,
    campo_id: int,
    empresa_id: int,
) -> Optional[models.CampoFornecedor]:
    return (
        db.query(models.CampoFornecedor)
        .filter(models.CampoFornecedor.id == campo_id)
        .filter(models.CampoFornecedor.empresa_id == empresa_id)
        .first()
    )

def buscar_campos_empresa_map(db: Session, empresa_id: int) -> Dict[str, models.CampoFornecedor]:
    campos = (
        db.query(models.CampoFornecedor)
        .filter(models.CampoFornecedor.empresa_id == empresa_id)
        .all()
    )
    return {str(c.slug): c for c in campos}

# =========================
# HELPERS FORNECEDOR
# =========================
def buscar_fornecedor_empresa(
    db: Session,
    fornecedor_id: int,
    empresa_id: int,
) -> Optional[models.Fornecedor]:
    return (
        db.query(models.Fornecedor)
        .filter(models.Fornecedor.id == fornecedor_id)
        .filter(models.Fornecedor.empresa_id == empresa_id)
        .first()
    )

def buscar_custom_fields_fornecedor(
    db: Session,
    empresa_id: int,
    fornecedor_id: int,
) -> Dict[str, str]:
    rows = (
        db.query(models.FornecedorCampoValor, models.CampoFornecedor)
        .join(
            models.CampoFornecedor,
            models.CampoFornecedor.id == models.FornecedorCampoValor.campo_id,
        )
        .filter(models.FornecedorCampoValor.fornecedor_id == fornecedor_id)
        .filter(models.CampoFornecedor.empresa_id == empresa_id)
        .all()
    )
    out: Dict[str, str] = {}
    for valor_row, campo_row in rows:
        out[str(campo_row.slug)] = valor_row.valor or ""
    return out

def salvar_custom_fields_fornecedor(
    db: Session,
    empresa_id: int,
    fornecedor_id: int,
    custom_fields: Optional[Dict[str, str]],
) -> None:
    payload = custom_fields or {}
    campos_map = buscar_campos_empresa_map(db, empresa_id)
    slugs_payload = set(payload.keys())
    slugs_validos = set(campos_map.keys())
    slugs_invalidos = sorted(slugs_payload - slugs_validos)
    if slugs_invalidos:
        raise HTTPException(
            status_code=400,
            detail=f"Campos personalizados inválidos: {', '.join(slugs_invalidos)}",
        )
    valores_existentes = (
        db.query(models.FornecedorCampoValor)
        .join(
            models.CampoFornecedor,
            models.CampoFornecedor.id == models.FornecedorCampoValor.campo_id,
        )
        .filter(models.FornecedorCampoValor.fornecedor_id == fornecedor_id)
        .filter(models.CampoFornecedor.empresa_id == empresa_id)
        .all()
    )
    existentes_por_campo_id = {int(v.campo_id): v for v in valores_existentes}
    for slug, raw_value in payload.items():
        campo = campos_map[slug]
        campo_id = int(campo.id)
        value_str = None if raw_value is None else str(raw_value).strip()
        if not value_str:
            existente = existentes_por_campo_id.get(campo_id)
            if existente:
                db.delete(existente)
            continue
        existente = existentes_por_campo_id.get(campo_id)
        if existente:
            existente.valor = value_str
        else:
            novo = models.FornecedorCampoValor(
                fornecedor_id=fornecedor_id,
                campo_id=campo_id,
                valor=value_str,
            )
            db.add(novo)

def fornecedor_to_out(db: Session, f: models.Fornecedor) -> FornecedorOut:
    empresa_id = int(f.empresa_id)
    return FornecedorOut(
        id=int(f.id),
        empresa_id=empresa_id,
        codigo=f.codigo or "",
        nome=f.nome or "",
        whatsapp=f.whatsapp,
        email=f.email,
        custom_fields=buscar_custom_fields_fornecedor(db, empresa_id, int(f.id)),
    )

# =========================
# ROTAS FORNECEDORES
# =========================
@router.get("", response_model=List[FornecedorOut])
def listar_fornecedores(
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    rows = (
        db.query(models.Fornecedor)
        .filter(models.Fornecedor.empresa_id == empresa_id)
        .order_by(models.Fornecedor.nome.asc())
        .all()
    )
    return [fornecedor_to_out(db, f) for f in rows]

@router.get("/{fornecedor_id}", response_model=FornecedorOut)
def obter_fornecedor(
    fornecedor_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    return fornecedor_to_out(db, f)

@router.post("", response_model=FornecedorOut, status_code=status.HTTP_201_CREATED)
def criar_fornecedor(
    payload: FornecedorCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    codigo = (payload.codigo or "").strip() or gerar_codigo_fornecedor(db, empresa_id)
    f = models.Fornecedor(
        empresa_id=empresa_id,
        codigo=codigo,
        nome=payload.nome.strip(),
        whatsapp=norm_str(payload.whatsapp),
        email=norm_str(payload.email),
    )
    try:
        db.add(f)
        db.flush()
        salvar_custom_fields_fornecedor(
            db=db,
            empresa_id=empresa_id,
            fornecedor_id=int(f.id),
            custom_fields=payload.custom_fields,
        )
        db.commit()
        db.refresh(f)
        return fornecedor_to_out(db, f)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de fornecedor já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar fornecedor: {e}")

@router.put("/{fornecedor_id}", response_model=FornecedorOut)
def atualizar_fornecedor(
    fornecedor_id: int,
    payload: FornecedorUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    if payload.codigo is not None and payload.codigo.strip():
        f.codigo = payload.codigo.strip()
    if payload.nome is not None and payload.nome.strip():
        f.nome = payload.nome.strip()
    if payload.whatsapp is not None:
        f.whatsapp = norm_str(payload.whatsapp)
    if payload.email is not None:
        f.email = norm_str(payload.email)
    try:
        if payload.custom_fields is not None:
            salvar_custom_fields_fornecedor(
                db=db,
                empresa_id=empresa_id,
                fornecedor_id=int(f.id),
                custom_fields=payload.custom_fields,
            )
        db.commit()
        db.refresh(f)
        return fornecedor_to_out(db, f)
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de fornecedor já existe.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar fornecedor: {e}")

@router.delete("/{fornecedor_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_fornecedor(
    fornecedor_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    f = buscar_fornecedor_empresa(db, fornecedor_id, empresa_id)
    if not f:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    db.delete(f)
    db.commit()
    return None

# =========================
# ROTAS CAMPOS PERSONALIZADOS
# =========================
@router.get("/campos/lista", response_model=List[CampoFornecedorOut])
def listar_campos_fornecedores(
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    rows = (
        db.query(models.CampoFornecedor)
        .filter(models.CampoFornecedor.empresa_id == empresa_id)
        .order_by(models.CampoFornecedor.ordem.asc(), models.CampoFornecedor.nome.asc())
        .all()
    )
    return [campo_to_out(c) for c in rows]

@router.get("/campos/{campo_id}", response_model=CampoFornecedorOut)
def obter_campo_fornecedor(
    campo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    return campo_to_out(c)

@router.post("/campos", response_model=CampoFornecedorOut, status_code=status.HTTP_201_CREATED)
def criar_campo_fornecedor(
    payload: CampoFornecedorCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    c = models.CampoFornecedor(
        empresa_id=empresa_id,
        nome=payload.nome.strip(),
        slug=payload.slug.strip(),
        tipo=payload.tipo.strip(),
        obrigatorio=bool(payload.obrigatorio),
        ativo=bool(payload.ativo),
        opcoes_json=norm_str(payload.opcoes_json),
        ordem=int(payload.ordem or 0),
    )
    try:
        db.add(c)
        db.commit()
        db.refresh(c)
        return campo_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse identificador.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar campo: {e}")

@router.put("/campos/{campo_id}", response_model=CampoFornecedorOut)
def atualizar_campo_fornecedor(
    campo_id: int,
    payload: CampoFornecedorUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    if payload.nome is not None and payload.nome.strip():
        c.nome = payload.nome.strip()
    if payload.slug is not None and payload.slug.strip():
        c.slug = payload.slug.strip()
    if payload.tipo is not None and payload.tipo.strip():
        c.tipo = payload.tipo.strip()
    if payload.obrigatorio is not None:
        c.obrigatorio = bool(payload.obrigatorio)
    if payload.ativo is not None:
        c.ativo = bool(payload.ativo)
    if payload.opcoes_json is not None:
        c.opcoes_json = norm_str(payload.opcoes_json)
    if payload.ordem is not None:
        c.ordem = int(payload.ordem)
    try:
        db.commit()
        db.refresh(c)
        return campo_to_out(c)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um campo com esse identificador.")
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar campo: {e}")

@router.delete("/campos/{campo_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_campo_fornecedor(
    campo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    c = buscar_campo_empresa(db, campo_id, empresa_id)
    if not c:
        raise HTTPException(status_code=404, detail="Campo não encontrado")
    db.delete(c)
    db.commit()
    return None