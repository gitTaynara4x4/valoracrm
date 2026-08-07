from __future__ import annotations

import json
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database import SessionLocal
from backend.security.permissions import get_request_user
from backend import models

router = APIRouter(prefix="/api/propostas", tags=["Propostas e Orçamentos"])


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
    value = (s or "").strip()
    return value or None


def iso_datetime(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    text = str(value).strip()
    return text or None


def normalizar_codigo_sistema(codigo: Optional[str]) -> str:
    """Mantém códigos internos do sistema apenas numéricos."""
    return re.sub(r"\D+", "", str(codigo or "")).strip()


def get_fields_set(payload) -> set:
    return set(
        getattr(payload, "model_fields_set", None)
        or getattr(payload, "__fields_set__", set())
    )


def decimal_from_br(value, default: Decimal = Decimal("0")) -> Decimal:
    if value in (None, "", "null"):
        return default

    if isinstance(value, Decimal):
        return value

    text = str(value).strip()
    if not text:
        return default

    text = re.sub(r"[^0-9,.-]", "", text)

    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    elif "," in text:
        text = text.replace(",", ".")

    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return default


def decimal_to_br(value: Decimal) -> str:
    number = value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{number:.2f}".replace(".", ",")


# =========================================================
# AUTENTICAÇÃO E EMPRESA
# =========================================================
def validar_usuario_empresa(request: Request, db: Session) -> int:
    return int(get_request_user(request, db).empresa_id)


def validar_cliente_empresa(db: Session, cliente_id: Optional[int], empresa_id: int) -> None:
    if not cliente_id:
        return

    cliente = (
        db.query(models.Cliente)
        .filter(models.Cliente.id == cliente_id)
        .filter(models.Cliente.empresa_id == empresa_id)
        .first()
    )
    if not cliente:
        raise HTTPException(status_code=422, detail="Cliente inválido para esta empresa.")


def gerar_codigo_proposta(db: Session, empresa_id: int) -> str:
    rows = (
        db.query(models.Proposta.codigo)
        .filter(models.Proposta.empresa_id == empresa_id)
        .all()
    )

    maior = 0
    for row in rows:
        raw = row[0] if isinstance(row, tuple) else getattr(row, "codigo", None)
        codigo = normalizar_codigo_sistema(raw)
        if not codigo:
            continue
        try:
            maior = max(maior, int(codigo))
        except (TypeError, ValueError):
            continue

    return f"{maior + 1:04d}"


class PropostaItemIn(BaseModel):
    id: Optional[int] = None
    produto_id: Optional[int] = None
    origem: Optional[str] = "manual"
    codigo: Optional[str] = None
    descricao: str
    unidade: Optional[str] = None
    quantidade: Optional[str] = None
    valor_unitario: Optional[str] = None
    valor_total: Optional[str] = None
    observacao: Optional[str] = None
    ordem: Optional[int] = 0


class PropostaItemOut(PropostaItemIn, _Cfg):
    id: int


class CampoExtraValorIn(BaseModel):
    campo_id: int
    valor: Optional[str] = None


class CampoExtraValorOut(_Cfg, BaseModel):
    campo_id: int
    nome: str
    slug: str
    tipo: str
    obrigatorio: bool = False
    opcoes: List[str] = Field(default_factory=list)
    ordem: int = 0
    valor: Optional[str] = None


class PropostaBase(BaseModel):
    codigo: Optional[str] = None
    cliente_id: Optional[int] = None
    titulo: Optional[str] = None
    status: Optional[str] = "rascunho"
    observacoes: Optional[str] = None
    validade_dias: Optional[str] = None
    subtotal: Optional[str] = None
    desconto: Optional[str] = None
    total: Optional[str] = None


class PropostaCreate(PropostaBase):
    titulo: str
    itens: List[PropostaItemIn] = Field(default_factory=list)
    campos_extras: List[CampoExtraValorIn] = Field(default_factory=list)


class PropostaUpdate(PropostaBase):
    itens: Optional[List[PropostaItemIn]] = None
    campos_extras: Optional[List[CampoExtraValorIn]] = None


class PropostaOut(PropostaBase, _Cfg):
    id: int
    empresa_id: int
    cliente_nome: Optional[str] = None
    cliente_whatsapp: Optional[str] = None
    criado_em: Optional[str] = None
    atualizado_em: Optional[str] = None
    itens: List[PropostaItemOut] = Field(default_factory=list)
    campos_extras: List[CampoExtraValorOut] = Field(default_factory=list)


def item_to_out(item: models.PropostaItem) -> PropostaItemOut:
    return PropostaItemOut(
        id=int(item.id),
        produto_id=item.produto_id,
        origem=item.origem or "manual",
        codigo=item.codigo,
        descricao=item.descricao,
        unidade=item.unidade,
        quantidade=item.quantidade,
        valor_unitario=item.valor_unitario,
        valor_total=item.valor_total,
        observacao=item.observacao,
        ordem=int(item.ordem or 0),
    )


def buscar_proposta_empresa(db: Session, proposta_id: int, empresa_id: int):
    return (
        db.query(models.Proposta)
        .filter(models.Proposta.id == proposta_id)
        .filter(models.Proposta.empresa_id == empresa_id)
        .first()
    )


def listar_itens_propostas_em_lote(
    db: Session,
    proposta_ids: List[int],
) -> Dict[int, List[PropostaItemOut]]:
    ids = sorted({int(proposta_id) for proposta_id in proposta_ids if int(proposta_id) > 0})
    out: Dict[int, List[PropostaItemOut]] = {proposta_id: [] for proposta_id in ids}
    if not ids:
        return out

    rows = (
        db.query(models.PropostaItem)
        .filter(models.PropostaItem.proposta_id.in_(ids))
        .order_by(
            models.PropostaItem.proposta_id.asc(),
            models.PropostaItem.ordem.asc(),
            models.PropostaItem.id.asc(),
        )
        .all()
    )
    for item in rows:
        out.setdefault(int(item.proposta_id), []).append(item_to_out(item))
    return out


def listar_itens_proposta(db: Session, proposta_id: int):
    return listar_itens_propostas_em_lote(db, [proposta_id]).get(int(proposta_id), [])


def parse_opcoes_json(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(value).strip() for value in data if str(value).strip()]
    except Exception:
        pass
    return []


def listar_campos_extras_propostas_em_lote(
    db: Session,
    proposta_ids: List[int],
    empresa_id: int,
) -> Dict[int, List[CampoExtraValorOut]]:
    """Carrega definições e valores dos campos extras em uma única consulta SQL."""
    ids = sorted({int(proposta_id) for proposta_id in proposta_ids if int(proposta_id) > 0})
    out: Dict[int, List[CampoExtraValorOut]] = {proposta_id: [] for proposta_id in ids}
    if not ids:
        return out

    rows = (
        db.query(models.CampoProposta, models.PropostaCampoValor)
        .outerjoin(
            models.PropostaCampoValor,
            and_(
                models.PropostaCampoValor.campo_id == models.CampoProposta.id,
                models.PropostaCampoValor.proposta_id.in_(ids),
            ),
        )
        .filter(models.CampoProposta.empresa_id == empresa_id)
        .filter(models.CampoProposta.ativo == True)  # noqa: E712
        .order_by(
            models.CampoProposta.ordem.asc(),
            models.CampoProposta.id.asc(),
            models.PropostaCampoValor.proposta_id.asc(),
        )
        .all()
    )

    campos_por_id: Dict[int, models.CampoProposta] = {}
    valores_por_proposta: Dict[int, Dict[int, Optional[str]]] = {proposta_id: {} for proposta_id in ids}

    for campo, valor_row in rows:
        campo_id = int(campo.id)
        campos_por_id.setdefault(campo_id, campo)
        if valor_row is not None and int(valor_row.proposta_id) in valores_por_proposta:
            valores_por_proposta[int(valor_row.proposta_id)][campo_id] = valor_row.valor

    campos = list(campos_por_id.values())
    for proposta_id in ids:
        valores_map = valores_por_proposta.get(proposta_id, {})
        out[proposta_id] = [
            CampoExtraValorOut(
                campo_id=int(campo.id),
                nome=campo.nome,
                slug=campo.slug,
                tipo=campo.tipo,
                obrigatorio=bool(campo.obrigatorio),
                opcoes=parse_opcoes_json(campo.opcoes_json),
                ordem=int(campo.ordem or 0),
                valor=valores_map.get(int(campo.id)),
            )
            for campo in campos
        ]
    return out


def listar_campos_extras_proposta(db: Session, proposta_id: int, empresa_id: int):
    return listar_campos_extras_propostas_em_lote(db, [proposta_id], empresa_id).get(int(proposta_id), [])


def buscar_clientes_propostas_em_lote(
    db: Session,
    empresa_id: int,
    cliente_ids: List[int],
) -> Dict[int, models.Cliente]:
    ids = sorted({int(cliente_id) for cliente_id in cliente_ids if int(cliente_id) > 0})
    if not ids:
        return {}

    rows = (
        db.query(models.Cliente)
        .filter(models.Cliente.empresa_id == empresa_id)
        .filter(models.Cliente.id.in_(ids))
        .all()
    )
    return {int(cliente.id): cliente for cliente in rows}


def normalizar_itens(itens: List[PropostaItemIn]) -> tuple[List[dict], Decimal]:
    normalizados: List[dict] = []
    subtotal = Decimal("0")

    for index, item in enumerate(itens):
        descricao = (item.descricao or "").strip()
        if not descricao:
            continue

        quantidade = decimal_from_br(item.quantidade, Decimal("1"))
        if quantidade <= 0:
            quantidade = Decimal("1")

        valor_unitario = decimal_from_br(item.valor_unitario)
        valor_informado = decimal_from_br(item.valor_total)

        if valor_unitario != 0:
            valor_total = quantidade * valor_unitario
        else:
            valor_total = valor_informado

        subtotal += valor_total

        normalizados.append(
            {
                "produto_id": item.produto_id,
                "origem": norm_str(item.origem) or ("produto" if item.produto_id else "manual"),
                "codigo": norm_str(item.codigo),
                "descricao": descricao,
                "unidade": norm_str(item.unidade) or "UN",
                "quantidade": decimal_to_br(quantidade),
                "valor_unitario": decimal_to_br(valor_unitario),
                "valor_total": decimal_to_br(valor_total),
                "observacao": norm_str(item.observacao),
                "ordem": int(item.ordem if item.ordem is not None else index),
            }
        )

    return normalizados, subtotal


def salvar_itens_proposta(db: Session, proposta_id: int, itens: List[PropostaItemIn]) -> Decimal:
    db.query(models.PropostaItem).filter(
        models.PropostaItem.proposta_id == proposta_id
    ).delete()

    normalizados, subtotal = normalizar_itens(itens)

    for item in normalizados:
        db.add(models.PropostaItem(proposta_id=proposta_id, **item))

    return subtotal


def salvar_campos_extras_proposta(
    db: Session,
    proposta_id: int,
    empresa_id: int,
    campos_extras: List[CampoExtraValorIn],
):
    campos_config = (
        db.query(models.CampoProposta)
        .filter(models.CampoProposta.empresa_id == empresa_id)
        .filter(models.CampoProposta.ativo == True)  # noqa: E712
        .all()
    )
    config_map = {int(campo.id): campo for campo in campos_config}

    incoming: dict[int, Optional[str]] = {}
    for item in campos_extras:
        campo_id = int(item.campo_id)
        if campo_id not in config_map:
            continue
        valor = None if item.valor is None else str(item.valor).strip()
        incoming[campo_id] = valor or None

    for campo in campos_config:
        if bool(campo.obrigatorio) and not incoming.get(int(campo.id)):
            raise HTTPException(
                status_code=422,
                detail=f"Campo obrigatório não preenchido: {campo.nome}",
            )

    db.query(models.PropostaCampoValor).filter(
        models.PropostaCampoValor.proposta_id == proposta_id
    ).delete()

    for campo_id, valor in incoming.items():
        db.add(
            models.PropostaCampoValor(
                proposta_id=proposta_id,
                campo_id=campo_id,
                valor=valor,
            )
        )


def aplicar_totais(
    proposta: models.Proposta,
    subtotal_calculado: Decimal,
    payload_subtotal: Optional[str],
    payload_desconto: Optional[str],
    payload_total: Optional[str],
    possui_itens: bool,
) -> None:
    subtotal = subtotal_calculado if possui_itens else decimal_from_br(payload_subtotal)
    desconto = max(decimal_from_br(payload_desconto), Decimal("0"))
    total_calculado = max(subtotal - desconto, Decimal("0"))

    if not possui_itens and subtotal == 0 and payload_total not in (None, ""):
        total_calculado = max(decimal_from_br(payload_total), Decimal("0"))

    proposta.subtotal = decimal_to_br(subtotal)
    proposta.desconto = decimal_to_br(desconto)
    proposta.total = decimal_to_br(total_calculado)


def proposta_to_out(
    db: Session,
    proposta: models.Proposta,
    *,
    clientes_por_id: Optional[Dict[int, models.Cliente]] = None,
    itens: Optional[List[PropostaItemOut]] = None,
    campos_extras: Optional[List[CampoExtraValorOut]] = None,
) -> PropostaOut:
    cliente_nome = None
    cliente_whatsapp = None

    if proposta.cliente_id:
        cliente_id = int(proposta.cliente_id)
        if clientes_por_id is None:
            cliente = (
                db.query(models.Cliente)
                .filter(models.Cliente.id == cliente_id)
                .filter(models.Cliente.empresa_id == proposta.empresa_id)
                .first()
            )
        else:
            cliente = clientes_por_id.get(cliente_id)
        if cliente:
            cliente_nome = getattr(cliente, "nome", None)
            cliente_whatsapp = getattr(cliente, "whatsapp", None) or getattr(cliente, "telefone", None)

    if itens is None:
        itens = listar_itens_proposta(db, int(proposta.id))
    if campos_extras is None:
        campos_extras = listar_campos_extras_proposta(db, int(proposta.id), int(proposta.empresa_id))

    return PropostaOut(
        id=int(proposta.id),
        empresa_id=int(proposta.empresa_id),
        codigo=proposta.codigo or "",
        cliente_id=proposta.cliente_id,
        titulo=proposta.titulo or "",
        status=proposta.status or "rascunho",
        observacoes=proposta.observacoes,
        validade_dias=proposta.validade_dias,
        subtotal=proposta.subtotal,
        desconto=proposta.desconto,
        total=proposta.total,
        cliente_nome=cliente_nome,
        cliente_whatsapp=cliente_whatsapp,
        criado_em=iso_datetime(getattr(proposta, "criado_em", None)),
        atualizado_em=iso_datetime(getattr(proposta, "atualizado_em", None)),
        itens=itens,
        campos_extras=campos_extras,
    )


@router.get("")
def listar_propostas(
    request: Request,
    busca: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    paginated: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    query = (
        db.query(models.Proposta)
        .outerjoin(
            models.Cliente,
            and_(
                models.Cliente.id == models.Proposta.cliente_id,
                models.Cliente.empresa_id == models.Proposta.empresa_id,
            ),
        )
        .filter(models.Proposta.empresa_id == empresa_id)
    )

    texto = norm_str(busca)
    if texto:
        like = f"%{texto}%"
        query = query.filter(
            or_(
                models.Proposta.codigo.ilike(like),
                models.Proposta.titulo.ilike(like),
                models.Proposta.status.ilike(like),
                models.Cliente.nome.ilike(like),
                models.Cliente.nome_fantasia.ilike(like),
            )
        )

    status_norm = norm_str(status_filter)
    if status_norm:
        query = query.filter(models.Proposta.status == status_norm.lower())

    query = query.order_by(models.Proposta.criado_em.desc(), models.Proposta.id.desc())

    total = query.count() if paginated else None
    rows = query.offset(offset).limit(limit).all() if paginated else query.all()
    proposta_ids = [int(proposta.id) for proposta in rows]
    clientes_por_id = buscar_clientes_propostas_em_lote(
        db,
        empresa_id,
        [int(proposta.cliente_id) for proposta in rows if proposta.cliente_id],
    )
    itens_por_proposta = listar_itens_propostas_em_lote(db, proposta_ids)
    campos_extras_por_proposta = listar_campos_extras_propostas_em_lote(db, proposta_ids, empresa_id)
    items = [
        proposta_to_out(
            db,
            proposta,
            clientes_por_id=clientes_por_id,
            itens=itens_por_proposta.get(int(proposta.id), []),
            campos_extras=campos_extras_por_proposta.get(int(proposta.id), []),
        )
        for proposta in rows
    ]

    if not paginated:
        return items

    total_value = int(total or 0)
    return {
        "items": [item.model_dump() if hasattr(item, "model_dump") else item.dict() for item in items],
        "total": total_value,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(items)) < total_value,
    }


@router.get("/proximo-codigo")
def obter_proximo_codigo(request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    return {"codigo": gerar_codigo_proposta(db, empresa_id)}


@router.get("/{proposta_id}", response_model=PropostaOut)
def obter_proposta(proposta_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    proposta = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not proposta:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")
    return proposta_to_out(db, proposta)


@router.post("", response_model=PropostaOut, status_code=status.HTTP_201_CREATED)
def criar_proposta(payload: PropostaCreate, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    validar_cliente_empresa(db, payload.cliente_id, empresa_id)

    titulo = (payload.titulo or "").strip()
    if not titulo:
        raise HTTPException(status_code=422, detail="Informe o título do orçamento.")

    codigo = normalizar_codigo_sistema(payload.codigo) or gerar_codigo_proposta(db, empresa_id)

    proposta = models.Proposta(
        empresa_id=empresa_id,
        cliente_id=payload.cliente_id,
        codigo=codigo,
        titulo=titulo,
        status=norm_str(payload.status) or "rascunho",
        observacoes=norm_str(payload.observacoes),
        validade_dias=norm_str(payload.validade_dias),
    )

    try:
        db.add(proposta)
        db.flush()

        subtotal = salvar_itens_proposta(db, int(proposta.id), payload.itens)
        aplicar_totais(
            proposta,
            subtotal,
            payload.subtotal,
            payload.desconto,
            payload.total,
            bool(payload.itens),
        )
        salvar_campos_extras_proposta(db, int(proposta.id), empresa_id, payload.campos_extras)

        db.commit()
        db.refresh(proposta)
        return proposta_to_out(db, proposta)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar proposta: {exc}")


@router.put("/{proposta_id}", response_model=PropostaOut)
def atualizar_proposta(
    proposta_id: int,
    payload: PropostaUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    proposta = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not proposta:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")

    fields_set = get_fields_set(payload)

    if "cliente_id" in fields_set:
        validar_cliente_empresa(db, payload.cliente_id, empresa_id)
        proposta.cliente_id = payload.cliente_id

    codigo_normalizado = normalizar_codigo_sistema(payload.codigo)
    if "codigo" in fields_set and codigo_normalizado:
        proposta.codigo = codigo_normalizado

    if "titulo" in fields_set:
        titulo = (payload.titulo or "").strip()
        if not titulo:
            raise HTTPException(status_code=422, detail="Informe o título do orçamento.")
        proposta.titulo = titulo

    if "status" in fields_set:
        proposta.status = norm_str(payload.status) or "rascunho"

    if "observacoes" in fields_set:
        proposta.observacoes = norm_str(payload.observacoes)

    if "validade_dias" in fields_set:
        proposta.validade_dias = norm_str(payload.validade_dias)

    try:
        possui_itens_no_payload = payload.itens is not None

        if possui_itens_no_payload:
            subtotal = salvar_itens_proposta(db, int(proposta.id), payload.itens or [])
            aplicar_totais(
                proposta,
                subtotal,
                payload.subtotal,
                payload.desconto,
                payload.total,
                bool(payload.itens),
            )
        else:
            if "subtotal" in fields_set:
                proposta.subtotal = decimal_to_br(decimal_from_br(payload.subtotal))
            if "desconto" in fields_set:
                proposta.desconto = decimal_to_br(decimal_from_br(payload.desconto))
            if "total" in fields_set:
                proposta.total = decimal_to_br(decimal_from_br(payload.total))

        if payload.campos_extras is not None:
            salvar_campos_extras_proposta(db, int(proposta.id), empresa_id, payload.campos_extras)

        db.commit()
        db.refresh(proposta)
        return proposta_to_out(db, proposta)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Código de proposta já existe.")
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar proposta: {exc}")


@router.delete("/{proposta_id}", status_code=status.HTTP_204_NO_CONTENT)
def excluir_proposta(proposta_id: int, request: Request, db: Session = Depends(get_db)):
    empresa_id = validar_usuario_empresa(request, db)
    proposta = buscar_proposta_empresa(db, proposta_id, empresa_id)
    if not proposta:
        raise HTTPException(status_code=404, detail="Proposta não encontrada")

    db.delete(proposta)
    db.commit()
    return None
