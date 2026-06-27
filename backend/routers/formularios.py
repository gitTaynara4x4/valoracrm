from __future__ import annotations

import hashlib
import json
import unicodedata
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend import models

try:
    from backend import models_contratos
except Exception:  # pragma: no cover
    models_contratos = None
from backend.database import SessionLocal

router = APIRouter(prefix="/api/formularios", tags=["Formulários"])


# =========================================================
# BANCO / AUTH
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
    # O user_id é a fonte segura da sessão.
    # Não confie no cookie empresa_id para validar a empresa, porque ele pode ficar
    # antigo no navegador e causar o erro: "Usuário inválido para esta empresa".
    user_id = _int_cookie(request, "user_id")

    usuario = (
        db.query(models.Usuario)
        .filter(models.Usuario.id == user_id)
        .first()
    )

    if not usuario:
        raise HTTPException(status_code=401, detail="Usuário não encontrado.")

    if getattr(usuario, "empresa_id", None) is None:
        raise HTTPException(status_code=401, detail="Usuário sem empresa vinculada.")

    if hasattr(usuario, "ativo") and usuario.ativo is False:
        raise HTTPException(status_code=403, detail="Usuário inativo.")

    return int(usuario.empresa_id)


# =========================================================
# CONSTANTES
# =========================================================
MODULOS_PERMITIDOS = {
    "clientes",
    "fornecedores",
    "produtos",
    "patrimonio",
    "cotacoes",
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
    "multiselect",
    "checkbox",
    "email",
    "telefone",
    "moeda",
    "percentual",
    "relacao_cliente",
    "relacao_fornecedor",
    "relacao_produto",
    "relacao_patrimonio",
    "relacao_cotacao",
    "relacao_proposta",
    "relacao_contrato",
    "relacao_cliente_multi",
    "relacao_fornecedor_multi",
    "relacao_produto_multi",
    "relacao_patrimonio_multi",
    "relacao_cotacao_multi",
    "relacao_proposta_multi",
    "relacao_contrato_multi",
}

# Aceita nomes amigáveis e variações que podem vir do front.
# O banco continua gravando o tipo canônico abaixo.
TIPOS_CAMPOS_ALIASES = {
    "texto curto": "texto",
    "campo texto": "texto",
    "texto longo": "textarea",
    "area de texto": "textarea",
    "textarea": "textarea",
    "numero": "numero",
    "número": "numero",
    "data": "data",
    "lista": "select",
    "select": "select",
    "checkbox": "checkbox",
    "flag": "checkbox",
    "fleg": "checkbox",
    "email": "email",
    "e-mail": "email",
    "telefone": "telefone",
    "moeda": "moeda",
    "percentual": "percentual",

    "multiselect": "multiselect",
    "multi_select": "multiselect",
    "multi-select": "multiselect",
    "lista multipla": "multiselect",
    "lista múltipla": "multiselect",
    "lista com multipla selecao": "multiselect",
    "lista com múltipla seleção": "multiselect",
    "multipla selecao": "multiselect",
    "múltipla seleção": "multiselect",
    "multivaloravel": "multiselect",
    "multivalorável": "multiselect",
    "multvaloravel": "multiselect",

    "cliente": "relacao_cliente",
    "clientes": "relacao_cliente",
    "puxar cliente": "relacao_cliente",
    "puxar clientes": "relacao_cliente",
    "puxa cliente": "relacao_cliente",
    "puxa clientes": "relacao_cliente",
    "relacao_cliente": "relacao_cliente",
    "relacao_clientes": "relacao_cliente",
    "lookup_cliente": "relacao_cliente",
    "lookup_clientes": "relacao_cliente",

    "fornecedor": "relacao_fornecedor",
    "fornecedores": "relacao_fornecedor",
    "puxar fornecedor": "relacao_fornecedor",
    "puxar fornecedores": "relacao_fornecedor",
    "puxa fornecedor": "relacao_fornecedor",
    "puxa fornecedores": "relacao_fornecedor",
    "relacao_fornecedor": "relacao_fornecedor",
    "relacao_fornecedores": "relacao_fornecedor",
    "lookup_fornecedor": "relacao_fornecedor",
    "lookup_fornecedores": "relacao_fornecedor",

    "produto": "relacao_produto",
    "produtos": "relacao_produto",
    "puxar produto": "relacao_produto",
    "puxar produtos": "relacao_produto",
    "puxa produto": "relacao_produto",
    "puxa produtos": "relacao_produto",
    "relacao_produto": "relacao_produto",
    "relacao_produtos": "relacao_produto",
    "lookup_produto": "relacao_produto",
    "lookup_produtos": "relacao_produto",

    "patrimonio": "relacao_patrimonio",
    "patrimônio": "relacao_patrimonio",
    "puxar patrimonio": "relacao_patrimonio",
    "puxar patrimônio": "relacao_patrimonio",
    "puxa patrimonio": "relacao_patrimonio",
    "puxa patrimônio": "relacao_patrimonio",
    "relacao_patrimonio": "relacao_patrimonio",
    "lookup_patrimonio": "relacao_patrimonio",

    "cotacao": "relacao_cotacao",
    "cotação": "relacao_cotacao",
    "cotacoes": "relacao_cotacao",
    "cotações": "relacao_cotacao",
    "puxar cotacao": "relacao_cotacao",
    "puxar cotação": "relacao_cotacao",
    "puxa cotacao": "relacao_cotacao",
    "puxa cotação": "relacao_cotacao",
    "puxar cotacoes": "relacao_cotacao",
    "puxar cotações": "relacao_cotacao",
    "relacao_cotacao": "relacao_cotacao",
    "relacao_cotacoes": "relacao_cotacao",
    "lookup_cotacao": "relacao_cotacao",
    "lookup_cotacoes": "relacao_cotacao",

    "proposta": "relacao_proposta",
    "propostas": "relacao_proposta",
    "puxar proposta": "relacao_proposta",
    "puxar propostas": "relacao_proposta",
    "puxa proposta": "relacao_proposta",
    "puxa propostas": "relacao_proposta",
    "relacao_proposta": "relacao_proposta",
    "relacao_propostas": "relacao_proposta",
    "lookup_proposta": "relacao_proposta",
    "lookup_propostas": "relacao_proposta",

    "contrato": "relacao_contrato",
    "contratos": "relacao_contrato",
    "puxar contrato": "relacao_contrato",
    "puxar contratos": "relacao_contrato",
    "puxa contrato": "relacao_contrato",
    "puxa contratos": "relacao_contrato",
    "relacao_contrato": "relacao_contrato",
    "relacao_contratos": "relacao_contrato",
    "lookup_contrato": "relacao_contrato",
    "lookup_contratos": "relacao_contrato",
}


# Relações com múltipla escolha. Ex.: um produto pode ter vários fornecedores.
for _rel_nome, _rel_tipo in {
    "cliente": "relacao_cliente_multi",
    "clientes": "relacao_cliente_multi",
    "fornecedor": "relacao_fornecedor_multi",
    "fornecedores": "relacao_fornecedor_multi",
    "produto": "relacao_produto_multi",
    "produtos": "relacao_produto_multi",
    "patrimonio": "relacao_patrimonio_multi",
    "patrimônio": "relacao_patrimonio_multi",
    "cotacao": "relacao_cotacao_multi",
    "cotação": "relacao_cotacao_multi",
    "cotacoes": "relacao_cotacao_multi",
    "cotações": "relacao_cotacao_multi",
    "proposta": "relacao_proposta_multi",
    "propostas": "relacao_proposta_multi",
    "contrato": "relacao_contrato_multi",
    "contratos": "relacao_contrato_multi",
}.items():
    TIPOS_CAMPOS_ALIASES[f"puxar varios {_rel_nome}"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxar vários {_rel_nome}"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxa varios {_rel_nome}"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxa vários {_rel_nome}"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxar {_rel_nome} multiplo"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxar {_rel_nome} múltiplo"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"puxar {_rel_nome} multi"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"{_rel_nome} multiplo"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"{_rel_nome} múltiplo"] = _rel_tipo
    TIPOS_CAMPOS_ALIASES[f"{_rel_nome} multi"] = _rel_tipo

TIPOS_CAMPOS_ALIASES.update({
    "relacao_cliente_multi": "relacao_cliente_multi",
    "relacao_clientes_multi": "relacao_cliente_multi",
    "lookup_cliente_multi": "relacao_cliente_multi",
    "lookup_clientes_multi": "relacao_cliente_multi",
    "relacao_fornecedor_multi": "relacao_fornecedor_multi",
    "relacao_fornecedores_multi": "relacao_fornecedor_multi",
    "lookup_fornecedor_multi": "relacao_fornecedor_multi",
    "lookup_fornecedores_multi": "relacao_fornecedor_multi",
    "relacao_produto_multi": "relacao_produto_multi",
    "relacao_produtos_multi": "relacao_produto_multi",
    "lookup_produto_multi": "relacao_produto_multi",
    "lookup_produtos_multi": "relacao_produto_multi",
    "relacao_patrimonio_multi": "relacao_patrimonio_multi",
    "lookup_patrimonio_multi": "relacao_patrimonio_multi",
    "relacao_cotacao_multi": "relacao_cotacao_multi",
    "relacao_cotacoes_multi": "relacao_cotacao_multi",
    "lookup_cotacao_multi": "relacao_cotacao_multi",
    "lookup_cotacoes_multi": "relacao_cotacao_multi",
    "relacao_proposta_multi": "relacao_proposta_multi",
    "relacao_propostas_multi": "relacao_proposta_multi",
    "lookup_proposta_multi": "relacao_proposta_multi",
    "lookup_propostas_multi": "relacao_proposta_multi",
    "relacao_contrato_multi": "relacao_contrato_multi",
    "relacao_contratos_multi": "relacao_contrato_multi",
    "lookup_contrato_multi": "relacao_contrato_multi",
    "lookup_contratos_multi": "relacao_contrato_multi",
})

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

ICONES_SECOES_PERMITIDOS = {
    "fa-id-card",
    "fa-address-book",
    "fa-house",
    "fa-location-dot",
    "fa-user-shield",
    "fa-building",
    "fa-user-gear",
    "fa-wallet",
    "fa-credit-card",
    "fa-share-nodes",
    "fa-file-signature",
    "fa-scale-balanced",
    "fa-tags",
    "fa-briefcase",
    "fa-folder-open",
    "fa-sliders",
    "fa-clipboard-list",
    "fa-paperclip",
    "fa-clock-rotate-left",
    "fa-layer-group",
    "fa-circle-info",
    "fa-triangle-exclamation",
    "fa-list-check",
    "fa-box",
    "fa-barcode",
    "fa-truck",
    "fa-file-contract",
}


CAMPOS_SISTEMA_POR_MODULO: Dict[str, List[Dict[str, Any]]] = {
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
    "patrimonio": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "nome", "label": "Nome do patrimônio", "tipo": "texto"},
        {"campo": "descricao", "label": "Descrição", "tipo": "textarea"},
        {"campo": "categoria", "label": "Categoria", "tipo": "texto"},
        {"campo": "marca", "label": "Marca", "tipo": "texto"},
        {"campo": "modelo", "label": "Modelo", "tipo": "texto"},
        {"campo": "numero_serie", "label": "Número de série", "tipo": "texto"},
        {"campo": "localizacao", "label": "Localização", "tipo": "texto"},
        {"campo": "responsavel", "label": "Responsável", "tipo": "texto"},
        {
            "campo": "status",
            "label": "Status",
            "tipo": "select",
            "opcoes": ["ativo", "manutencao", "baixado", "extraviado"],
        },
        {"campo": "valor_aquisicao", "label": "Valor de aquisição", "tipo": "moeda"},
        {"campo": "data_aquisicao", "label": "Data de aquisição", "tipo": "data"},
        {"campo": "observacoes", "label": "Observações", "tipo": "textarea"},
        {"campo": "ativo", "label": "Ativo", "tipo": "checkbox"},
    ],
    "cotacoes": [
        {"campo": "codigo", "label": "Código", "tipo": "numero"},
        {"campo": "item_nome", "label": "Item desejado", "tipo": "texto"},
        {"campo": "descricao", "label": "Descrição", "tipo": "textarea"},
        {"campo": "quantidade", "label": "Quantidade", "tipo": "numero"},
        {"campo": "unidade", "label": "Unidade", "tipo": "texto"},
        {"campo": "categoria", "label": "Categoria", "tipo": "texto"},
        {"campo": "status", "label": "Status", "tipo": "select"},
        {"campo": "urgencia", "label": "Urgência", "tipo": "select"},
        {"campo": "observacoes", "label": "Observações", "tipo": "textarea"},
        {"campo": "fornecedor_vencedor_id", "label": "Fornecedor vencedor", "tipo": "texto"},
        {"campo": "valor_aprovado", "label": "Valor aprovado", "tipo": "moeda"},
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
        {"campo": "numero_contrato", "label": "Número do contrato", "tipo": "texto"},
        {"campo": "cliente_id", "label": "Cliente", "tipo": "texto"},
        {"campo": "proposta_id", "label": "Proposta vinculada", "tipo": "texto"},
        {"campo": "tipo_contrato", "label": "Tipo de contrato", "tipo": "select"},
        {
            "campo": "status",
            "label": "Status",
            "tipo": "select",
            "opcoes": ["rascunho", "emitido", "enviado_assinatura", "assinado", "cancelado"],
        },
        {"campo": "valor_mensal", "label": "Valor mensal", "tipo": "moeda"},
        {"campo": "data_pagamento", "label": "Data de pagamento", "tipo": "data"},
        {"campo": "data_inicio", "label": "Data de início", "tipo": "data"},
        {"campo": "data_fim", "label": "Data de fim", "tipo": "data"},
        {"campo": "data_assinatura", "label": "Data de assinatura", "tipo": "data"},
        {"campo": "proposta_codigo", "label": "Código da proposta", "tipo": "texto"},
        {"campo": "proposta_titulo", "label": "Título da proposta", "tipo": "texto"},
        {"campo": "vendedor_nome", "label": "Vendedor", "tipo": "texto"},
        {"campo": "data_aprovacao", "label": "Data de aprovação", "tipo": "data"},
        {"campo": "indicacao", "label": "Indicação", "tipo": "texto"},
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


CAMPO_DATA_CADASTRO_SISTEMA = {
    "campo": "data_cadastro",
    "label": "Data de cadastro",
    "tipo": "data",
    "somente_leitura": True,
    "largura": "50",
    "ajuda": "Data em que o registro foi criado no sistema.",
}

for _modulo, _campos in CAMPOS_SISTEMA_POR_MODULO.items():
    if not any(str(c.get("campo") or "") == "data_cadastro" for c in _campos):
        _insert_at = 1 if _campos and str(_campos[0].get("campo") or "") in {"codigo", "numero_contrato"} else 0
        _campos.insert(_insert_at, dict(CAMPO_DATA_CADASTRO_SISTEMA))


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


def normalizar_texto_busca(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return " ".join(text.replace("/", " ").replace("-", " ").split())


def normalizar_tipo_campo(value: Any) -> str:
    raw = norm_lower(value)
    if not raw:
        return "texto"

    if raw in TIPOS_CAMPOS_PERMITIDOS:
        return raw

    chave_sem_acento = normalizar_texto_busca(raw)
    chave_underscore = chave_sem_acento.replace(" ", "_")

    for chave in (raw, chave_sem_acento, chave_underscore):
        if chave in TIPOS_CAMPOS_ALIASES:
            return TIPOS_CAMPOS_ALIASES[chave]

    return raw


def icone_fallback_por_titulo(titulo: Any) -> str:
    t = normalizar_texto_busca(titulo)

    if any(x in t for x in ("basico", "cadastro", "identificacao", "principal")):
        return "fa-id-card"

    if any(x in t for x in ("imovel", "endereco", "residencia", "casa", "local")):
        return "fa-house"

    if any(x in t for x in ("responsavel", "titular")):
        return "fa-user-shield"

    if any(x in t for x in ("pessoa juridica", "juridica", "cnpj", "empresa")):
        return "fa-building"

    if any(x in t for x in ("administrativo", "administracao", "gerencia", "gerente")):
        return "fa-user-gear"

    if any(x in t for x in ("financeiro", "cobranca", "pagamento", "boleto", "pix", "cartao")):
        return "fa-wallet"

    if any(x in t for x in ("rede", "social", "instagram", "facebook", "linkedin", "site")):
        return "fa-share-nodes"

    if any(x in t for x in ("contrato", "emissao", "assinatura")):
        return "fa-file-signature"

    if any(x in t for x in ("contato", "telefone", "whatsapp", "email")):
        return "fa-address-book"

    if any(x in t for x in ("ocorrencia", "historico", "registro")):
        return "fa-clipboard-list"

    if any(x in t for x in ("anexo", "arquivo", "documento")):
        return "fa-paperclip"

    if any(x in t for x in ("classificacao", "categoria", "segmento", "tipo")):
        return "fa-tags"

    if any(x in t for x in ("comercial", "venda", "negociacao")):
        return "fa-briefcase"

    return "fa-layer-group"


def normalizar_icone_secao(icone: Any, titulo: Any = None) -> Optional[str]:
    value = norm_str(icone)

    if value:
        value = (
            value.replace("fa-solid", "")
            .replace("fas", "")
            .replace("far", "")
            .strip()
        )

        if value in ICONES_SECOES_PERMITIDOS:
            return value

        # Aceita classes Font Awesome válidas sem travar o sistema
        # se você adicionar novos ícones no frontend depois.
        permitido = value.startswith("fa-") and len(value) <= 80 and all(
            ch.isalnum() or ch in {"-", "_"} for ch in value
        )

        if permitido:
            return value

        raise HTTPException(status_code=422, detail="Ícone da seção inválido.")

    if titulo is not None:
        return icone_fallback_por_titulo(titulo)

    return None


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
        "icone": getattr(row, "icone", None),
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



def garantir_data_cadastro_no_modelo(db: Session, modelo) -> None:
    """Garante o campo virtual Data de cadastro nos formulários antigos sem bagunçar a estrutura."""
    existente = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.origem == "sistema")
        .filter(models.FormularioCampo.campo_sistema == "data_cadastro")
        .first()
    )

    if existente:
        existente.label = existente.label or "Data de cadastro"
        existente.tipo_campo = "data"
        existente.somente_leitura = True
        existente.ativo = True if existente.ativo is None else existente.ativo
        return

    secao = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.formulario_id == modelo.id)
        .order_by(models.FormularioSecao.ordem.asc(), models.FormularioSecao.id.asc())
        .first()
    )

    if not secao:
        secao = models.FormularioSecao(
            formulario_id=modelo.id,
            titulo="Dados principais",
            descricao="Campos principais do cadastro.",
            icone="fa-id-card",
            ordem=1,
            ativo=True,
        )
        db.add(secao)
        db.flush()

    ultimo = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .order_by(models.FormularioCampo.ordem.desc(), models.FormularioCampo.id.desc())
        .first()
    )

    campo = models.FormularioCampo(
        formulario_id=modelo.id,
        secao_id=secao.id,
        origem="sistema",
        campo_sistema="data_cadastro",
        campo_personalizado_id=None,
        tipo_visual=None,
        tipo_campo="data",
        label="Data de cadastro",
        placeholder=None,
        ajuda="Data em que o registro foi criado no sistema.",
        opcoes_json=None,
        obrigatorio=False,
        somente_leitura=True,
        ativo=True,
        largura="50",
        ordem=int(getattr(ultimo, "ordem", 0) or 0) + 1,
        visibilidade="todos",
        condicao_json=None,
    )
    db.add(campo)
    db.flush()

def formulario_completo(db: Session, modelo) -> Dict[str, Any]:
    garantir_data_cadastro_no_modelo(db, modelo)
    db.commit()
    db.refresh(modelo)

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
            str(getattr(secao, "icone", "") or ""),
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
    icone: Optional[str] = None
    ordem: int = 0
    ativo: bool = True


class FormularioSecaoUpdate(BaseModel):
    titulo: Optional[str] = None
    descricao: Optional[str] = None
    icone: Optional[str] = None
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
        tipo_campo = normalizar_tipo_campo(tipo_campo)

        if tipo_campo not in TIPOS_CAMPOS_PERMITIDOS:
            permitidos = ", ".join(sorted(TIPOS_CAMPOS_PERMITIDOS))
            raise HTTPException(
                status_code=422,
                detail=f"Tipo de campo inválido: {tipo_campo}. Permitidos: {permitidos}",
            )

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


# =========================================================
# OPÇÕES PARA CAMPOS DE RELAÇÃO
# =========================================================
def _texto_primeiro(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _normalizar_tipo_relacao(tipo: str) -> str:
    raw = normalizar_texto_busca(tipo or "")
    raw = raw.replace("relacao ", "").replace("lookup ", "")
    raw = raw.replace("relacao_", "").replace("lookup_", "")
    raw = raw.replace("puxar ", "").replace("puxa ", "")
    raw = raw.replace("varios ", "").replace("varias ", "")
    raw = raw.replace("multi ", "").replace("multiplo ", "").replace("multipla ", "")
    raw = raw.replace("_multi", "").replace("_multiplo", "").replace("_multipla", "")
    raw = raw.replace("clientes", "cliente")
    raw = raw.replace("fornecedores", "fornecedor")
    raw = raw.replace("produtos", "produto")
    raw = raw.replace("patrimonios", "patrimonio")
    raw = raw.replace("cotacoes", "cotacao")
    raw = raw.replace("propostas", "proposta")
    raw = raw.replace("contratos", "contrato")
    return raw.strip().replace(" ", "_")


def _relacao_to_out(item: Any, tipo: str) -> Dict[str, Any]:
    value = str(getattr(item, "id", "") or "").strip()

    if tipo == "cliente":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "nome", None), getattr(item, "razao_social", None), getattr(item, "nome_fantasia", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Cliente #{value}")
    elif tipo == "fornecedor":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "nome", None), getattr(item, "razao_social", None), getattr(item, "nome_fantasia", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Fornecedor #{value}")
    elif tipo == "produto":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "nome", None), getattr(item, "descricao", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Produto #{value}")
    elif tipo == "patrimonio":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "nome", None), getattr(item, "descricao", None), getattr(item, "numero_serie", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Patrimônio #{value}")
    elif tipo == "cotacao":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "item_nome", None), getattr(item, "titulo", None), getattr(item, "descricao", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Cotação #{value}")
    elif tipo == "proposta":
        codigo = _texto_primeiro(getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "titulo", None), getattr(item, "cliente_nome", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(nome, codigo, f"Proposta #{value}")
    elif tipo == "contrato":
        codigo = _texto_primeiro(getattr(item, "numero_contrato", None), getattr(item, "codigo", None))
        nome = _texto_primeiro(getattr(item, "cliente_nome", None), getattr(item, "tipo_contrato", None))
        label = f"{codigo} • {nome}" if codigo and nome else _texto_primeiro(codigo, nome, f"Contrato #{value}")
    else:
        label = _texto_primeiro(getattr(item, "nome", None), getattr(item, "codigo", None), value)

    return {
        "id": value,
        "value": value,
        "label": label,
        "codigo": _texto_primeiro(getattr(item, "codigo", None), getattr(item, "numero_contrato", None)),
        "nome": _texto_primeiro(getattr(item, "nome", None), getattr(item, "titulo", None), getattr(item, "item_nome", None), getattr(item, "cliente_nome", None)),
    }


@router.get("/opcoes-relacao")
def listar_opcoes_relacao(
    tipo: str = Query(..., min_length=1),
    q: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=500),
    request: Request = None,
    db: Session = Depends(get_db),
):
    empresa_id = validar_usuario_empresa(request, db)
    tipo_norm = _normalizar_tipo_relacao(tipo)

    mapa = {
        "cliente": models.Cliente,
        "fornecedor": models.Fornecedor,
        "produto": models.Produto,
        "patrimonio": models.Patrimonio,
        "cotacao": models.Cotacao,
        "proposta": models.Proposta,
    }

    if tipo_norm == "contrato":
        if models_contratos is None or not hasattr(models_contratos, "Contrato"):
            return []
        Model = models_contratos.Contrato
    else:
        Model = mapa.get(tipo_norm)

    if Model is None:
        raise HTTPException(status_code=422, detail="Tipo de relação inválido.")

    query = db.query(Model).filter(Model.empresa_id == empresa_id)

    if hasattr(Model, "ativo"):
        try:
            query = query.filter(Model.ativo == True)  # noqa: E712
        except Exception:
            pass

    if q:
        termo = f"%{q.strip()}%"
        filtros = []
        for attr in ("nome", "codigo", "nome_fantasia", "item_nome", "titulo", "numero_contrato"):
            if hasattr(Model, attr):
                filtros.append(getattr(Model, attr).ilike(termo))
        if filtros:
            from sqlalchemy import or_
            query = query.filter(or_(*filtros))

    ordem = None
    for attr in ("nome", "titulo", "item_nome", "numero_contrato", "codigo", "id"):
        if hasattr(Model, attr):
            ordem = getattr(Model, attr)
            break
    if ordem is not None:
        query = query.order_by(ordem.asc())

    itens = query.limit(limit).all()
    return [_relacao_to_out(item, tipo_norm) for item in itens]


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
        "icones_secoes": sorted(ICONES_SECOES_PERMITIDOS),
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
        icone=normalizar_icone_secao(payload.icone, titulo),
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

    if "icone" in dados:
        secao.icone = normalizar_icone_secao(dados.get("icone"), secao.titulo)
    elif not getattr(secao, "icone", None):
        secao.icone = normalizar_icone_secao(None, secao.titulo)

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
def garantir_estrutura_padrao(db: Session, modelo, modulo: str) -> None:
    """
    Garante que o formulário padrão tenha pelo menos:
    - uma seção padrão
    - campos do sistema do módulo

    Correção importante:
    antes, se já existisse um formulário padrão vazio, a API só devolvia ele.
    A tela ficava com formulário selecionado, mas sem seção/campos.
    Aí Nova seção, Campo do sistema e Novo campo pareciam não funcionar.
    """
    modulo = validar_modulo(modulo)

    secao = (
        db.query(models.FormularioSecao)
        .filter(models.FormularioSecao.formulario_id == modelo.id)
        .order_by(models.FormularioSecao.ordem.asc(), models.FormularioSecao.id.asc())
        .first()
    )

    if not secao:
        secao = models.FormularioSecao(
            formulario_id=modelo.id,
            titulo="Dados principais",
            descricao="Campos principais do cadastro.",
            icone="fa-id-card",
            ordem=1,
            ativo=True,
        )

        db.add(secao)
        db.flush()
    elif not getattr(secao, "icone", None):
        secao.icone = normalizar_icone_secao(None, secao.titulo)

    campos_existentes = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .filter(models.FormularioCampo.origem == "sistema")
        .all()
    )

    campos_sistema_existentes = {
        str(c.campo_sistema or "").strip()
        for c in campos_existentes
        if str(c.campo_sistema or "").strip()
    }

    ultimo_campo = (
        db.query(models.FormularioCampo)
        .filter(models.FormularioCampo.formulario_id == modelo.id)
        .order_by(models.FormularioCampo.ordem.desc(), models.FormularioCampo.id.desc())
        .first()
    )

    ordem_atual = int(getattr(ultimo_campo, "ordem", 0) or 0)

    for item in CAMPOS_SISTEMA_POR_MODULO.get(modulo, []):
        campo_sistema = str(item.get("campo") or "").strip()

        if not campo_sistema:
            continue

        if campo_sistema in campos_sistema_existentes:
            continue

        ordem_atual += 1

        campo = models.FormularioCampo(
            formulario_id=modelo.id,
            secao_id=secao.id,
            origem="sistema",
            campo_sistema=campo_sistema,
            campo_personalizado_id=None,
            tipo_visual=None,
            tipo_campo=item.get("tipo") or "texto",
            label=item.get("label") or campo_sistema,
            placeholder=None,
            ajuda=None,
            opcoes_json=json.dumps(item.get("opcoes"), ensure_ascii=False) if item.get("opcoes") else None,
            obrigatorio=bool(item.get("obrigatorio", False)),
            somente_leitura=bool(item.get("somente_leitura", False)),
            ativo=True,
            largura=str(item.get("largura") or "50"),
            ordem=ordem_atual,
            visibilidade="todos",
            condicao_json=None,
        )

        db.add(campo)

    modelo.ativo = True
    modelo.padrao = True

    if not getattr(modelo, "descricao", None):
        modelo.descricao = "Modelo padrão gerado automaticamente pelo ValoraCRM."


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
        garantir_estrutura_padrao(db, existente, modulo)
        db.commit()
        db.refresh(existente)
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

    try:
        db.add(modelo)
        db.flush()

        garantir_estrutura_padrao(db, modelo, modulo)

        db.commit()
        db.refresh(modelo)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe formulário padrão para este módulo.")

    return formulario_completo(db, modelo)