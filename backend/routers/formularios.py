from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models
from backend.database import SessionLocal

router = APIRouter(prefix="/api/formularios", tags=["Formulários"])


# =========================================================
# BANCO / AUTH SIMPLES PELO COOKIE DO VALORA
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _int_cookie(request: Request, name: str) -> int:
    value = request.cookies.get(name)
    if not value:
        raise HTTPException(status_code=401, detail="Não autenticado.")
    try:
        return int(value)
    except ValueError:
        raise HTTPException(status_code=401, detail=f"Cookie {name} inválido.")


def validar_usuario_empresa(request: Request, db: Session) -> int:
    empresa_id = _int_cookie(request, "empresa_id")
    user_id = _int_cookie(request, "user_id")

    usuario = (
        db.query(models.Usuario)
        .filter(models.Usuario.id == user_id)
        .filter(models.Usuario.empresa_id == empresa_id)
        .first()
    )

    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário inválido para esta empresa.")

    if hasattr(usuario, "ativo") and usuario.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return empresa_id


# =========================================================
# CONSTANTES
# =========================================================
MODULOS_PERMITIDOS = {
    "clientes",
    "fornecedores",
    "produtos",
    "propostas",
    "contratos",
    "dados_contrato",
    "area_cliente",
}

ORIGENS_PERMITIDAS = {"sistema", "personalizado", "visual"}
TIPOS_VISUAIS_PERMITIDOS = {"titulo", "subtitulo", "separador", "texto", "aviso"}

TIPOS_CAMPOS_PERMITIDOS = {
    "texto",
    "textarea",
    "numero",
    "data",
    "select",
    "checkbox",
    "email",
    "telefone",
    "moeda",
    "percentual",
}

VISIBILIDADES_PERMITIDAS = {"todos", "pf", "pj", "interno", "publico"}

LARGURAS_PERMITIDAS = {
    "1",
    "2",
    "3",
    "4",
    "25",
    "33",
    "50",
    "66",
    "75",
    "100",
    "pequeno",
    "medio",
    "grande",
    "metade",
    "inteiro",
}

CAMPOS_SISTEMA_POR_MODULO: Dict[str, List[Dict[str, str]]] = {
    "clientes": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "nome", "label": "Nome / Razão social", "tipo": "texto"},
        {"campo": "nome_fantasia", "label": "Nome fantasia", "tipo": "texto"},
        {"campo": "tipo_pessoa", "label": "Tipo de pessoa", "tipo": "select"},
        {"campo": "situacao", "label": "Situação", "tipo": "select"},
        {"campo": "cpf_cnpj", "label": "CPF / CNPJ", "tipo": "texto"},
        {"campo": "rg_ie", "label": "RG / Inscrição estadual", "tipo": "texto"},
        {"campo": "data_nascimento", "label": "Data de nascimento", "tipo": "data"},
        {"campo": "telefone", "label": "Telefone", "tipo": "telefone"},
        {"campo": "whatsapp", "label": "WhatsApp", "tipo": "telefone"},
        {"campo": "email", "label": "E-mail", "tipo": "email"},
        {"campo": "email_cobranca", "label": "E-mail de cobrança", "tipo": "email"},
        {"campo": "cep", "label": "CEP", "tipo": "texto"},
        {"campo": "endereco", "label": "Endereço", "tipo": "texto"},
        {"campo": "numero", "label": "Número", "tipo": "texto"},
        {"campo": "complemento", "label": "Complemento", "tipo": "texto"},
        {"campo": "bairro", "label": "Bairro", "tipo": "texto"},
        {"campo": "cidade", "label": "Cidade", "tipo": "texto"},
        {"campo": "estado", "label": "Estado", "tipo": "texto"},
        {"campo": "regiao", "label": "Região", "tipo": "texto"},
        {"campo": "segmento", "label": "Segmento", "tipo": "texto"},
        {"campo": "classificacao", "label": "Classificação", "tipo": "texto"},
        {"campo": "observacoes", "label": "Observações", "tipo": "textarea"},
    ],
    "fornecedores": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "nome", "label": "Nome", "tipo": "texto"},
        {"campo": "whatsapp", "label": "WhatsApp", "tipo": "telefone"},
        {"campo": "email", "label": "E-mail", "tipo": "email"},
    ],
    "produtos": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "nome", "label": "Nome", "tipo": "texto"},
        {"campo": "descricao", "label": "Descrição", "tipo": "textarea"},
        {"campo": "categoria", "label": "Categoria", "tipo": "texto"},
        {"campo": "unidade", "label": "Unidade", "tipo": "texto"},
        {"campo": "preco_venda", "label": "Preço de venda", "tipo": "moeda"},
        {"campo": "custo", "label": "Custo", "tipo": "moeda"},
        {"campo": "estoque_atual", "label": "Estoque atual", "tipo": "numero"},
        {"campo": "ativo", "label": "Ativo", "tipo": "checkbox"},
    ],
    "propostas": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "titulo", "label": "Título", "tipo": "texto"},
        {"campo": "cliente_id", "label": "Cliente", "tipo": "texto"},
        {"campo": "status", "label": "Status", "tipo": "select"},
        {"campo": "observacoes", "label": "Observações", "tipo": "textarea"},
        {"campo": "validade_dias", "label": "Validade em dias", "tipo": "numero"},
        {"campo": "subtotal", "label": "Subtotal", "tipo": "moeda"},
        {"campo": "desconto", "label": "Desconto", "tipo": "moeda"},
        {"campo": "total", "label": "Total", "tipo": "moeda"},
    ],
    "contratos": [
        {"campo": "numero", "label": "Número do contrato", "tipo": "texto"},
        {"campo": "cliente_id", "label": "Cliente", "tipo": "texto"},
        {"campo": "tipo", "label": "Tipo de contrato", "tipo": "select"},
        {"campo": "status", "label": "Status", "tipo": "select"},
        {"campo": "valor_mensal", "label": "Valor mensal", "tipo": "moeda"},
        {"campo": "data_inicio", "label": "Data de início", "tipo": "data"},
        {"campo": "data_pagamento", "label": "Data de pagamento", "tipo": "data"},
        {"campo": "observacoes", "label": "Observações", "tipo": "textarea"},
    ],
    "dados_contrato": [
        {"campo": "cliente_id", "label": "Cliente", "tipo": "texto"},
        {"campo": "status", "label": "Status", "tipo": "select"},
        {"campo": "tipo_pessoa", "label": "Tipo de pessoa", "tipo": "select"},
        {"campo": "cpf_cnpj", "label": "CPF / CNPJ", "tipo": "texto"},
        {"campo": "imovel_cep", "label": "CEP do imóvel", "tipo": "texto"},
        {"campo": "imovel_endereco", "label": "Endereço do imóvel", "tipo": "texto"},
        {"campo": "imovel_numero", "label": "Número do imóvel", "tipo": "texto"},
        {"campo": "imovel_bairro", "label": "Bairro do imóvel", "tipo": "texto"},
        {"campo": "imovel_cidade", "label": "Cidade do imóvel", "tipo": "texto"},
        {"campo": "imovel_estado", "label": "Estado do imóvel", "tipo": "texto"},
    ],
    "area_cliente": [
        {"campo": "cliente_nome", "label": "Nome do cliente", "tipo": "texto"},
        {"campo": "cpf_cnpj", "label": "CPF / CNPJ", "tipo": "texto"},
        {"campo": "telefone", "label": "Telefone", "tipo": "telefone"},
        {"campo": "whatsapp", "label": "WhatsApp", "tipo": "telefone"},
        {"campo": "email", "label": "E-mail", "tipo": "email"},
        {"campo": "imovel_cep", "label": "CEP do imóvel", "tipo": "texto"},
        {"campo": "imovel_endereco", "label": "Endereço do imóvel", "tipo": "texto"},
        {"campo": "imovel_numero", "label": "Número do imóvel", "tipo": "texto"},
        {"campo": "imovel_bairro", "label": "Bairro do imóvel", "tipo": "texto"},
        {"campo": "imovel_cidade", "label": "Cidade do imóvel", "tipo": "texto"},
        {"campo": "imovel_estado", "label": "Estado do imóvel", "tipo": "texto"},
    ],
}


# =========================================================
# HELPERS
# =========================================================
def dump_model(model: BaseModel, *, exclude_unset: bool = False) -> Dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude_unset=exclude_unset)
    return model.dict(exclude_unset=exclude_unset)


def norm_str(value: Any) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def norm_lower(value: Any) -> str:
    return str(value or "").strip().lower()


def to_int(value: Any, default: int = 0) -> int:
    if value in (None, "", "null"):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def validar_modulo(modulo: Any) -> str:
    value = norm_lower(modulo)
    if value not in MODULOS_PERMITIDOS:
        raise HTTPException(
            status_code=422,
            detail="Módulo inválido. Use: " + ", ".join(sorted(MODULOS_PERMITIDOS)),
        )
    return value


def validar_valor(value: Any, permitidos: set[str], campo: str, padrao: str) -> str:
    value_norm = norm_lower(value) or padrao
    if value_norm not in permitidos:
        raise HTTPException(status_code=422, detail=f"{campo} inválido.")
    return value_norm


def json_text(value: Any) -> Optional[str]:
    if value in (None, "", "null"):
        return None

    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
        return value

    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        raise HTTPException(status_code=422, detail="JSON inválido.")


def modelo_ou_404(db: Session, modelo_id: int, empresa_id: int):
    item = (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.id == modelo_id)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Formulário não encontrado.")
    return item


def secao_ou_404(db: Session, secao_id: int, empresa_id: int):
    item = (
        db.query(models.FormularioSecao)
        .join(models.FormularioModelo, models.FormularioModelo.id == models.FormularioSecao.formulario_id)
        .filter(models.FormularioSecao.id == secao_id)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Seção não encontrada.")
    return item


def campo_ou_404(db: Session, campo_id: int, empresa_id: int):
    item = (
        db.query(models.FormularioCampo)
        .join(models.FormularioModelo, models.FormularioModelo.id == models.FormularioCampo.formulario_id)
        .filter(models.FormularioCampo.id == campo_id)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Campo não encontrado.")
    return item


def validar_secao_do_modelo(db: Session, modelo_id: int, secao_id: Optional[int]) -> Optional[int]:
    if not secao_id:
        return None

    secao = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.id == secao_id)
        .filter(models.FormularioSecao.formulario_id == modelo_id)
        .first()
    )

    if not secao:
        raise HTTPException(status_code=422, detail="A seção informada não pertence a este formulário.")

    return int(secao_id)


def limpar_padrao_anterior(db: Session, empresa_id: int, modulo: str, exceto_id: Optional[int] = None) -> None:
    q = (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == modulo)
        .filter(models.FormularioModelo.padrao == True)  # noqa: E712
    )

    if exceto_id:
        q = q.filter(models.FormularioModelo.id != exceto_id)

    for item in q.all():
        item.padrao = False


def limpar_ficha_principal_anterior(db: Session, empresa_id: int, modulo: str, exceto_id: Optional[int] = None) -> None:
    q = (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == modulo)
        .filter(models.FormularioModelo.usar_como_ficha_principal == True)  # noqa: E712
    )

    if exceto_id:
        q = q.filter(models.FormularioModelo.id != exceto_id)

    for item in q.all():
        item.usar_como_ficha_principal = False


def modelo_dict(row) -> Dict[str, Any]:
    return {
        "id": int(row.id),
        "empresa_id": int(row.empresa_id),
        "modulo": row.modulo,
        "nome": row.nome,
        "descricao": row.descricao,
        "ativo": bool(row.ativo),
        "padrao": bool(row.padrao),
        "usar_como_ficha_principal": bool(getattr(row, "usar_como_ficha_principal", False)),
        "criado_em": iso(row.criado_em),
        "atualizado_em": iso(row.atualizado_em),
    }


def secao_dict(row) -> Dict[str, Any]:
    return {
        "id": int(row.id),
        "formulario_id": int(row.formulario_id),
        "titulo": row.titulo,
        "descricao": row.descricao,
        "ordem": int(row.ordem or 0),
        "ativo": bool(row.ativo),
        "criado_em": iso(row.criado_em),
        "atualizado_em": iso(row.atualizado_em),
    }


def campo_dict(row) -> Dict[str, Any]:
    opcoes = None
    condicao = None

    if row.opcoes_json:
        try:
            opcoes = json.loads(row.opcoes_json)
        except Exception:
            opcoes = row.opcoes_json

    if row.condicao_json:
        try:
            condicao = json.loads(row.condicao_json)
        except Exception:
            condicao = row.condicao_json

    return {
        "id": int(row.id),
        "formulario_id": int(row.formulario_id),
        "secao_id": int(row.secao_id) if row.secao_id else None,
        "origem": row.origem,
        "campo_sistema": row.campo_sistema,
        "campo_personalizado_id": int(row.campo_personalizado_id) if row.campo_personalizado_id else None,
        "tipo_visual": row.tipo_visual,
        "tipo_campo": row.tipo_campo,
        "label": row.label,
        "placeholder": row.placeholder,
        "ajuda": row.ajuda,
        "opcoes_json": row.opcoes_json,
        "opcoes": opcoes,
        "obrigatorio": bool(row.obrigatorio),
        "somente_leitura": bool(row.somente_leitura),
        "ativo": bool(row.ativo),
        "largura": row.largura,
        "ordem": int(row.ordem or 0),
        "visibilidade": row.visibilidade or "todos",
        "condicao_json": row.condicao_json,
        "condicao": condicao,
        "criado_em": iso(row.criado_em),
        "atualizado_em": iso(row.atualizado_em),
    }


def formulario_completo(db: Session, modelo) -> Dict[str, Any]:
    secoes = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.formulario_id == modelo.id)
        .order_by(models.FormularioSecao.ordem.asc(), models.FormularioSecao.id.asc())
        .all()
    )

    campos = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .order_by(models.FormularioCampo.ordem.asc(), models.FormularioCampo.id.asc())
        .all()
    )

    campos_por_secao: Dict[Optional[int], List[Dict[str, Any]]] = {}

    for campo in campos:
        key = int(campo.secao_id) if campo.secao_id else None
        campos_por_secao.setdefault(key, []).append(campo_dict(campo))

    secoes_out = []

    for secao in secoes:
        sd = secao_dict(secao)
        sd["campos"] = campos_por_secao.get(int(secao.id), [])
        secoes_out.append(sd)

    return {
        "modelo": modelo_dict(modelo),
        "secoes": secoes_out,
        "campos_sem_secao": campos_por_secao.get(None, []),
        "campos": [campo_dict(c) for c in campos],
    }


def formulario_principal_ou_padrao(
    db: Session,
    empresa_id: int,
    modulo: str,
    *,
    ativo: bool = True,
):
    """Retorna o formulário que deve ser usado pela tela do módulo.

    Prioridade:
    1. formulário marcado como ficha principal
    2. formulário padrão
    3. primeiro formulário ativo do módulo
    """
    q = (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == modulo)
    )

    if ativo:
        q = q.filter(models.FormularioModelo.ativo == True)  # noqa: E712

    return (
        q.order_by(
            models.FormularioModelo.usar_como_ficha_principal.desc(),
            models.FormularioModelo.padrao.desc(),
            models.FormularioModelo.id.asc(),
        )
        .first()
    )


def formulario_cache_version(db: Session, modelo) -> Dict[str, Any]:
    """Gera uma versão leve para cache da estrutura da ficha.

    A versão considera o formulário, as seções e os campos. Assim, se criar,
    editar, remover ou reordenar um campo/seção, o navegador percebe que o
    cache ficou antigo e baixa a ficha completa novamente.
    """
    secoes = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.formulario_id == modelo.id)
        .order_by(models.FormularioSecao.id.asc())
        .all()
    )

    campos = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .order_by(models.FormularioCampo.id.asc())
        .all()
    )

    partes: List[str] = [
        "modelo",
        str(modelo.id),
        str(modelo.modulo),
        str(modelo.nome or ""),
        str(modelo.descricao or ""),
        str(bool(modelo.ativo)),
        str(bool(modelo.padrao)),
        str(bool(getattr(modelo, "usar_como_ficha_principal", False))),
        iso(modelo.atualizado_em) or "",
    ]

    for secao in secoes:
        partes.extend([
            "secao",
            str(secao.id),
            str(secao.titulo or ""),
            str(secao.descricao or ""),
            str(secao.ordem or 0),
            str(bool(secao.ativo)),
            iso(secao.atualizado_em) or "",
        ])

    for campo in campos:
        partes.extend([
            "campo",
            str(campo.id),
            str(campo.secao_id or ""),
            str(campo.origem or ""),
            str(campo.campo_sistema or ""),
            str(campo.campo_personalizado_id or ""),
            str(campo.tipo_visual or ""),
            str(campo.tipo_campo or ""),
            str(campo.label or ""),
            str(campo.placeholder or ""),
            str(campo.ajuda or ""),
            str(campo.opcoes_json or ""),
            str(bool(campo.obrigatorio)),
            str(bool(campo.somente_leitura)),
            str(bool(campo.ativo)),
            str(campo.largura or ""),
            str(campo.ordem or 0),
            str(campo.visibilidade or ""),
            str(campo.condicao_json or ""),
            iso(campo.atualizado_em) or "",
        ])

    raw = "|".join(partes)
    version = hashlib.sha1(raw.encode("utf-8")).hexdigest()

    return {
        "modelo_id": int(modelo.id),
        "modulo": modelo.modulo,
        "version": version,
        "modelo_atualizado_em": iso(modelo.atualizado_em),
        "secoes_total": len(secoes),
        "campos_total": len(campos),
        "usar_como_ficha_principal": bool(getattr(modelo, "usar_como_ficha_principal", False)),
        "padrao": bool(modelo.padrao),
        "empty": False,
    }


# =========================================================
# SCHEMAS
# =========================================================
class FormularioModeloCreate(BaseModel):
    modulo: str = Field(..., min_length=2, max_length=60)
    nome: str = Field(..., min_length=2, max_length=160)
    descricao: Optional[str] = None
    ativo: bool = True
    padrao: bool = False
    usar_como_ficha_principal: bool = False


class FormularioModeloUpdate(BaseModel):
    modulo: Optional[str] = None
    nome: Optional[str] = None
    descricao: Optional[str] = None
    ativo: Optional[bool] = None
    padrao: Optional[bool] = None
    usar_como_ficha_principal: Optional[bool] = None


class FormularioSecaoCreate(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=180)
    descricao: Optional[str] = None
    ordem: int = 0
    ativo: bool = True


class FormularioSecaoUpdate(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    ordem: Optional[int] = None
    ativo: Optional[bool] = None


class FormularioCampoCreate(BaseModel):
    secao_id: Optional[int] = None
    origem: str = "personalizado"
    campo_sistema: Optional[str] = None
    campo_personalizado_id: Optional[int] = None
    tipo_visual: Optional[str] = None
    tipo_campo: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=180)
    placeholder: Optional[str] = None
    ajuda: Optional[str] = None
    opcoes_json: Optional[Any] = None
    opcoes: Optional[Any] = None
    obrigatorio: bool = False
    somente_leitura: bool = False
    ativo: bool = True
    largura: Optional[str] = "100"
    ordem: int = 0
    visibilidade: str = "todos"
    condicao_json: Optional[Any] = None
    condicao: Optional[Any] = None


class FormularioCampoUpdate(BaseModel):
    secao_id: Optional[int] = None
    origem: Optional[str] = None
    campo_sistema: Optional[str] = None
    campo_personalizado_id: Optional[int] = None
    tipo_visual: Optional[str] = None
    tipo_campo: Optional[str] = None
    label: Optional[str] = None
    placeholder: Optional[str] = None
    ajuda: Optional[str] = None
    opcoes_json: Optional[Any] = None
    opcoes: Optional[Any] = None
    obrigatorio: Optional[bool] = None
    somente_leitura: Optional[bool] = None
    ativo: Optional[bool] = None
    largura: Optional[str] = None
    ordem: Optional[int] = None
    visibilidade: Optional[str] = None
    condicao_json: Optional[Any] = None
    condicao: Optional[Any] = None


def aplicar_campo(campo, dados: Dict[str, Any], db: Session, modelo, criando: bool = False) -> None:
    origem = validar_valor(
        dados.get("origem", campo.origem if not criando else "personalizado"),
        ORIGENS_PERMITIDAS,
        "Origem",
        "personalizado",
    )

    visibilidade = validar_valor(
        dados.get("visibilidade", campo.visibilidade if not criando else "todos"),
        VISIBILIDADES_PERMITIDAS,
        "Visibilidade",
        "todos",
    )

    largura = norm_lower(dados.get("largura", campo.largura if not criando else "100")) or "100"

    if largura not in LARGURAS_PERMITIDAS:
        raise HTTPException(status_code=422, detail="Largura inválida.")

    secao_id = dados.get("secao_id", campo.secao_id if not criando else None)
    secao_id = validar_secao_do_modelo(db, int(modelo.id), secao_id)

    label = norm_str(dados.get("label", campo.label if not criando else None))

    if not label:
        raise HTTPException(status_code=422, detail="Informe o nome exibido do campo.")

    campo_sistema = None
    campo_personalizado_id = None
    tipo_visual = None
    tipo_campo = None

    if origem == "sistema":
        campo_sistema = norm_str(dados.get("campo_sistema", campo.campo_sistema if not criando else None))

        if not campo_sistema:
            raise HTTPException(status_code=422, detail="Selecione o campo do sistema.")

        permitidos = {c["campo"] for c in CAMPOS_SISTEMA_POR_MODULO.get(modelo.modulo, [])}

        if permitidos and campo_sistema not in permitidos:
            raise HTTPException(status_code=422, detail="Campo do sistema inválido para este módulo.")

        tipo_campo = norm_lower(dados.get("tipo_campo", campo.tipo_campo if not criando else "texto")) or "texto"

    elif origem == "personalizado":
        campo_personalizado_id = dados.get(
            "campo_personalizado_id",
            campo.campo_personalizado_id if not criando else None,
        )

        if campo_personalizado_id in ("", "null"):
            campo_personalizado_id = None

        if campo_personalizado_id is not None:
            try:
                campo_personalizado_id = int(campo_personalizado_id)
            except Exception:
                raise HTTPException(status_code=422, detail="campo_personalizado_id inválido.")

        tipo_campo = norm_lower(dados.get("tipo_campo", campo.tipo_campo if not criando else "texto")) or "texto"

    else:
        tipo_visual = norm_lower(dados.get("tipo_visual", campo.tipo_visual if not criando else "titulo")) or "titulo"

        if tipo_visual not in TIPOS_VISUAIS_PERMITIDOS:
            raise HTTPException(status_code=422, detail="Tipo visual inválido.")

        tipo_campo = None
        campo_sistema = None
        campo_personalizado_id = None
        dados["obrigatorio"] = False
        dados["somente_leitura"] = True

    if tipo_campo:
        tipo_campo = norm_lower(tipo_campo)

        if tipo_campo not in TIPOS_CAMPOS_PERMITIDOS:
            raise HTTPException(status_code=422, detail="Tipo de campo inválido.")

    opcoes_raw = dados.get("opcoes_json", dados.get("opcoes", campo.opcoes_json if not criando else None))
    condicao_raw = dados.get("condicao_json", dados.get("condicao", campo.condicao_json if not criando else None))

    campo.secao_id = secao_id
    campo.origem = origem
    campo.campo_sistema = campo_sistema
    campo.campo_personalizado_id = campo_personalizado_id
    campo.tipo_visual = tipo_visual
    campo.tipo_campo = tipo_campo
    campo.label = label
    campo.placeholder = norm_str(dados.get("placeholder", campo.placeholder if not criando else None))
    campo.ajuda = norm_str(dados.get("ajuda", campo.ajuda if not criando else None))
    campo.opcoes_json = json_text(opcoes_raw)
    campo.obrigatorio = bool(dados.get("obrigatorio", campo.obrigatorio if not criando else False))
    campo.somente_leitura = bool(dados.get("somente_leitura", campo.somente_leitura if not criando else False))
    campo.ativo = bool(dados.get("ativo", campo.ativo if not criando else True))
    campo.largura = largura
    campo.ordem = to_int(dados.get("ordem", campo.ordem if not criando else 0), 0)
    campo.visibilidade = visibilidade
    campo.condicao_json = json_text(condicao_raw)


# =========================================================
# ROTAS AUXILIARES
# =========================================================
@router.get("/modulos")
def listar_modulos(request: Request, db: Session = Depends(get_db)):
    validar_usuario_empresa(request, db)

    return {
        "modulos": [
            {"value": m, "label": m.replace("_", " ").title()}
            for m in sorted(MODULOS_PERMITIDOS)
        ],
        "origens": sorted(ORIGENS_PERMITIDAS),
        "tipos_visuais": sorted(TIPOS_VISUAIS_PERMITIDOS),
        "tipos_campos": sorted(TIPOS_CAMPOS_PERMITIDOS),
        "visibilidades": sorted(VISIBILIDADES_PERMITIDAS),
        "larguras": sorted(LARGURAS_PERMITIDAS),
    }


@router.get("/campos-sistema")
def listar_campos_sistema(
    request: Request,
    modulo: str = Query(...),
    db: Session = Depends(get_db),
):
    validar_usuario_empresa(request, db)
    modulo = validar_modulo(modulo)

    return {
        "modulo": modulo,
        "campos": CAMPOS_SISTEMA_POR_MODULO.get(modulo, []),
    }


# =========================================================
# MODELOS
# =========================================================
@router.get("/modelos")
def listar_modelos(
    request: Request,
    modulo: Optional[str] = Query(default=None),
    ativo: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)

    q = db.query(models.FormularioModelo).filter(models.FormularioModelo.empresa_id == empresa_id)

    if modulo:
        q = q.filter(models.FormularioModelo.modulo == validar_modulo(modulo))

    if ativo is not None:
        q = q.filter(models.FormularioModelo.ativo == bool(ativo))

    rows = (
        q.order_by(
            models.FormularioModelo.modulo.asc(),
            models.FormularioModelo.padrao.desc(),
            models.FormularioModelo.nome.asc(),
        )
        .all()
    )

    return [modelo_dict(r) for r in rows]


@router.post("/modelos", status_code=status.HTTP_201_CREATED)
def criar_modelo(
    payload: FormularioModeloCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modulo = validar_modulo(payload.modulo)
    nome = norm_str(payload.nome)

    if not nome:
        raise HTTPException(status_code=422, detail="Informe o nome do formulário.")

    if payload.padrao:
        limpar_padrao_anterior(db, empresa_id, modulo)

    if payload.usar_como_ficha_principal:
        limpar_ficha_principal_anterior(db, empresa_id, modulo)

    row = models.FormularioModelo(
        empresa_id=empresa_id,
        modulo=modulo,
        nome=nome,
        descricao=norm_str(payload.descricao),
        ativo=bool(payload.ativo),
        padrao=bool(payload.padrao),
        usar_como_ficha_principal=bool(payload.usar_como_ficha_principal),
    )

    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe formulário com esse nome neste módulo.")

    return modelo_dict(row)


@router.get("/modelos/principal/{modulo}/versao")
def obter_versao_formulario_principal(
    modulo: str,
    request: Request,
    ativo: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modulo = validar_modulo(modulo)
    modelo = formulario_principal_ou_padrao(db, empresa_id, modulo, ativo=ativo)

    if not modelo:
        return {
            "modelo_id": None,
            "modulo": modulo,
            "version": "empty",
            "modelo_atualizado_em": None,
            "secoes_total": 0,
            "campos_total": 0,
            "usar_como_ficha_principal": False,
            "padrao": False,
            "empty": True,
        }

    return formulario_cache_version(db, modelo)


@router.get("/modelos/principal/{modulo}")
def obter_formulario_principal(
    modulo: str,
    request: Request,
    ativo: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modulo = validar_modulo(modulo)
    modelo = formulario_principal_ou_padrao(db, empresa_id, modulo, ativo=ativo)

    if not modelo:
        raise HTTPException(status_code=404, detail="Nenhum formulário encontrado para este módulo.")

    out = formulario_completo(db, modelo)
    out["cache_version"] = formulario_cache_version(db, modelo)
    return out


@router.get("/modelos/{modelo_id}")
def obter_modelo(
    modelo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modelo = modelo_ou_404(db, modelo_id, empresa_id)
    return formulario_completo(db, modelo)


@router.put("/modelos/{modelo_id}")
def atualizar_modelo(
    modelo_id: int,
    payload: FormularioModeloUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modelo = modelo_ou_404(db, modelo_id, empresa_id)
    dados = dump_model(payload, exclude_unset=True)

    if "modulo" in dados and dados["modulo"] is not None:
        modelo.modulo = validar_modulo(dados["modulo"])

    if "nome" in dados and dados["nome"] is not None:
        nome = norm_str(dados["nome"])

        if not nome:
            raise HTTPException(status_code=422, detail="Informe o nome do formulário.")

        modelo.nome = nome

    if "descricao" in dados:
        modelo.descricao = norm_str(dados.get("descricao"))

    if "ativo" in dados and dados["ativo"] is not None:
        modelo.ativo = bool(dados["ativo"])

    if "padrao" in dados and dados["padrao"] is not None:
        modelo.padrao = bool(dados["padrao"])

        if modelo.padrao:
            limpar_padrao_anterior(db, empresa_id, modelo.modulo, exceto_id=modelo.id)

    if "usar_como_ficha_principal" in dados and dados["usar_como_ficha_principal"] is not None:
        modelo.usar_como_ficha_principal = bool(dados["usar_como_ficha_principal"])

        if modelo.usar_como_ficha_principal:
            limpar_ficha_principal_anterior(db, empresa_id, modelo.modulo, exceto_id=modelo.id)

    try:
        db.commit()
        db.refresh(modelo)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe formulário com esse nome neste módulo.")

    return modelo_dict(modelo)


@router.delete("/modelos/{modelo_id}")
def excluir_modelo(
    modelo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modelo = modelo_ou_404(db, modelo_id, empresa_id)

    db.delete(modelo)
    db.commit()

    return {"ok": True, "message": "Formulário excluído com sucesso."}


# =========================================================
# SEÇÕES
# =========================================================
@router.post("/modelos/{modelo_id}/secoes", status_code=status.HTTP_201_CREATED)
def criar_secao(
    modelo_id: int,
    payload: FormularioSecaoCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modelo = modelo_ou_404(db, modelo_id, empresa_id)

    titulo = norm_str(payload.titulo)

    if not titulo:
        raise HTTPException(status_code=422, detail="Informe o título da seção.")

    secao = models.FormularioSecao(
        formulario_id=modelo.id,
        titulo=titulo,
        descricao=norm_str(payload.descricao),
        ordem=int(payload.ordem or 0),
        ativo=bool(payload.ativo),
    )

    db.add(secao)
    db.commit()
    db.refresh(secao)

    return secao_dict(secao)


@router.put("/secoes/{secao_id}")
def atualizar_secao(
    secao_id: int,
    payload: FormularioSecaoUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    secao = secao_ou_404(db, secao_id, empresa_id)
    dados = dump_model(payload, exclude_unset=True)

    if "titulo" in dados and dados["titulo"] is not None:
        titulo = norm_str(dados["titulo"])

        if not titulo:
            raise HTTPException(status_code=422, detail="Informe o título da seção.")

        secao.titulo = titulo

    if "descricao" in dados:
        secao.descricao = norm_str(dados.get("descricao"))

    if "ordem" in dados and dados["ordem"] is not None:
        secao.ordem = int(dados["ordem"] or 0)

    if "ativo" in dados and dados["ativo"] is not None:
        secao.ativo = bool(dados["ativo"])

    db.commit()
    db.refresh(secao)

    return secao_dict(secao)


@router.delete("/secoes/{secao_id}")
def excluir_secao(
    secao_id: int,
    request: Request,
    mover_campos_para_sem_secao: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    secao = secao_ou_404(db, secao_id, empresa_id)

    if mover_campos_para_sem_secao:
        (
            db.query(models.FormularioCampo)
            .filter(models.FormularioCampo.secao_id == secao.id)
            .update({"secao_id": None}, synchronize_session=False)
        )

    db.delete(secao)
    db.commit()

    return {"ok": True, "message": "Seção excluída com sucesso."}


# =========================================================
# CAMPOS
# =========================================================
@router.post("/modelos/{modelo_id}/campos", status_code=status.HTTP_201_CREATED)
def criar_campo(
    modelo_id: int,
    payload: FormularioCampoCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modelo = modelo_ou_404(db, modelo_id, empresa_id)
    dados = dump_model(payload)

    campo = models.FormularioCampo(
        formulario_id=modelo.id,
        label=payload.label.strip(),
    )

    aplicar_campo(campo, dados, db, modelo, criando=True)

    db.add(campo)
    db.commit()
    db.refresh(campo)

    return campo_dict(campo)


@router.put("/campos/{campo_id}")
def atualizar_campo(
    campo_id: int,
    payload: FormularioCampoUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    campo = campo_ou_404(db, campo_id, empresa_id)
    modelo = modelo_ou_404(db, int(campo.formulario_id), empresa_id)
    dados = dump_model(payload, exclude_unset=True)

    aplicar_campo(campo, dados, db, modelo, criando=False)

    db.commit()
    db.refresh(campo)

    return campo_dict(campo)


@router.delete("/campos/{campo_id}")
def excluir_campo(
    campo_id: int,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    campo = campo_ou_404(db, campo_id, empresa_id)

    db.delete(campo)
    db.commit()

    return {"ok": True, "message": "Campo removido do formulário com sucesso."}


# =========================================================
# CRIAR PADRÃO DO MÓDULO
# =========================================================
@router.post("/modelos/padrao/{modulo}", status_code=status.HTTP_201_CREATED)
def criar_modelo_padrao(
    modulo: str,
    request: Request,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    modulo = validar_modulo(modulo)

    existente = (
        db.query(models.FormularioModelo)
        .filter(models.FormularioModelo.empresa_id == empresa_id)
        .filter(models.FormularioModelo.modulo == modulo)
        .filter(models.FormularioModelo.padrao == True)  # noqa: E712
        .first()
    )

    if existente:
        return formulario_completo(db, existente)

    limpar_padrao_anterior(db, empresa_id, modulo)

    modelo = models.FormularioModelo(
        empresa_id=empresa_id,
        modulo=modulo,
        nome=f"Cadastro padrão - {modulo.replace('_', ' ')}",
        descricao="Modelo padrão gerado automaticamente pelo ValoraCRM.",
        ativo=True,
        padrao=True,
        usar_como_ficha_principal=False,
    )

    db.add(modelo)
    db.flush()

    secao = models.FormularioSecao(
        formulario_id=modelo.id,
        titulo="Dados principais",
        descricao="Campos principais do cadastro.",
        ordem=1,
        ativo=True,
    )

    db.add(secao)
    db.flush()

    for idx, item in enumerate(CAMPOS_SISTEMA_POR_MODULO.get(modulo, []), start=1):
        campo = models.FormularioCampo(
            formulario_id=modelo.id,
            secao_id=secao.id,
            origem="sistema",
            campo_sistema=item["campo"],
            campo_personalizado_id=None,
            tipo_visual=None,
            tipo_campo=item.get("tipo") or "texto",
            label=item["label"],
            placeholder=None,
            ajuda=None,
            opcoes_json=None,
            obrigatorio=False,
            somente_leitura=False,
            ativo=True,
            largura="50",
            ordem=idx,
            visibilidade="todos",
            condicao_json=None,
        )

        db.add(campo)

    db.commit()
    db.refresh(modelo)

    return formulario_completo(db, modelo)