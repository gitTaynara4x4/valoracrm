from __future__ import annotations

import asyncio
import calendar
import json
import logging
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.database import SessionLocal

logger = logging.getLogger(__name__)

_RECORRENCIA_TASK: Optional[asyncio.Task] = None
_INTERVAL_SECONDS = max(300, int(os.getenv("FINANCEIRO_RECORRENCIA_INTERVAL_SECONDS", "21600")))
_START_DELAY_SECONDS = max(5, int(os.getenv("FINANCEIRO_RECORRENCIA_START_DELAY_SECONDS", "20")))
_APP_TZ = ZoneInfo(os.getenv("APP_TZ", "America/Sao_Paulo"))

FREQUENCIAS_INTERVALO = {
    "mensal": 1,
    "bimestral": 2,
    "trimestral": 3,
    "semestral": 6,
    "anual": 12,
}


def adicionar_meses(data_base: date, meses: int, dia_preferido: Optional[int] = None) -> date:
    total = data_base.year * 12 + (data_base.month - 1) + int(meses)
    ano, indice_mes = divmod(total, 12)
    mes = indice_mes + 1
    dia = int(dia_preferido or data_base.day)
    return date(ano, mes, min(max(1, dia), calendar.monthrange(ano, mes)[1]))


def primeiro_dia_mes(valor: date) -> date:
    return date(valor.year, valor.month, 1)


def _row_dict(row: Any) -> Dict[str, Any]:
    return dict(row._mapping if hasattr(row, "_mapping") else row)


def estrutura_recorrencia_disponivel(db: Session) -> bool:
    obrigatorias = {
        "contratos": {
            "financeiro_status",
            "financeiro_frequencia",
            "financeiro_intervalo_meses",
            "financeiro_primeiro_vencimento",
            "financeiro_dia_vencimento",
            "financeiro_meses_antecipacao",
            "financeiro_forma_cobranca_id",
            "financeiro_conta_banco_id",
            "financeiro_categoria_id",
            "financeiro_conta_contabil_id",
        },
        "financeiro_lancamentos": {"contrato_id", "competencia", "origem_tipo", "origem_id"},
    }
    for tabela, colunas in obrigatorias.items():
        existentes = {
            str(row[0])
            for row in db.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema='public' AND table_name=:tabela
                    """
                ),
                {"tabela": tabela},
            ).fetchall()
        }
        if not colunas.issubset(existentes):
            return False
    return True


def _usuario_nome(db: Session, usuario_id: Optional[int]) -> str:
    if not usuario_id:
        return "Automação financeira"
    row = db.execute(
        text("SELECT COALESCE(NULLIF(nome, ''), NULLIF(email, ''), 'Usuário') FROM public.usuarios WHERE id=:id"),
        {"id": usuario_id},
    ).first()
    return str(row[0]) if row else "Usuário"


def _registrar_historico_contrato(
    db: Session,
    contrato: Dict[str, Any],
    usuario_id: Optional[int],
    descricao: str,
    *,
    campo: Optional[str] = None,
    anterior: Optional[str] = None,
    novo: Optional[str] = None,
) -> None:
    db.execute(
        text(
            """
            INSERT INTO public.contratos_historico_alteracoes (
                empresa_id, contrato_id, cliente_id, usuario_id, usuario_nome,
                tipo, campo, valor_anterior, valor_novo, descricao, criado_em
            ) VALUES (
                :empresa_id, :contrato_id, :cliente_id, :usuario_id, :usuario_nome,
                'financeiro_recorrencia', :campo, :anterior, :novo, :descricao, NOW()
            )
            """
        ),
        {
            "empresa_id": int(contrato["empresa_id"]),
            "contrato_id": int(contrato["id"]),
            "cliente_id": int(contrato["cliente_id"]),
            "usuario_id": usuario_id,
            "usuario_nome": _usuario_nome(db, usuario_id),
            "campo": campo,
            "anterior": anterior,
            "novo": novo,
            "descricao": descricao,
        },
    )


def _registrar_auditoria_financeira(
    db: Session,
    contrato: Dict[str, Any],
    lancamento_id: int,
    usuario_id: Optional[int],
    dados: Dict[str, Any],
) -> None:
    db.execute(
        text(
            """
            INSERT INTO public.financeiro_auditoria (
                empresa_id, usuario_id, acao, entidade, entidade_id,
                dados_anteriores, dados_novos, motivo, criado_em
            ) VALUES (
                :empresa_id, :usuario_id, 'gerar_recorrencia_contrato', 'lancamento', :entidade_id,
                NULL, CAST(:dados AS JSONB), :motivo, NOW()
            )
            """
        ),
        {
            "empresa_id": int(contrato["empresa_id"]),
            "usuario_id": usuario_id,
            "entidade_id": lancamento_id,
            "dados": json.dumps(dados, ensure_ascii=False, default=str),
            "motivo": f"Cobrança recorrente do contrato {contrato['numero_contrato']}.",
        },
    )


def _buscar_contrato(db: Session, empresa_id: int, contrato_id: int, *, lock: bool = True) -> Dict[str, Any]:
    sufixo = " FOR UPDATE OF c" if lock else ""
    row = db.execute(
        text(
            """
            SELECT
                c.*,
                cl.nome AS cliente_nome,
                cl.contato AS cliente_contato,
                cl.email AS cliente_email,
                cl.email_cobranca AS cliente_email_cobranca,
                cl.telefone AS cliente_telefone,
                cl.whatsapp AS cliente_whatsapp,
                cl.modalidade_pagamento AS cliente_modalidade_pagamento,
                re.possui_multa AS regra_possui_multa,
                re.indice_multa_percent AS regra_indice_multa_percent,
                re.possui_mora_diaria AS regra_possui_mora_diaria,
                re.indice_mora_diaria_percent AS regra_indice_mora_diaria_percent
            FROM public.contratos c
            JOIN public.clientes cl
              ON cl.id = c.cliente_id AND cl.empresa_id = c.empresa_id
            LEFT JOIN public.financeiro_regras_encargos re
              ON re.id = c.financeiro_regra_encargos_id AND re.empresa_id = c.empresa_id
            WHERE c.empresa_id=:empresa_id AND c.id=:contrato_id
            """
            + sufixo
        ),
        {"empresa_id": empresa_id, "contrato_id": contrato_id},
    ).mappings().first()
    if not row:
        raise ValueError("Contrato não encontrado na empresa atual.")
    return dict(row)


def _validar_contrato_para_geracao(contrato: Dict[str, Any]) -> None:
    if str(contrato.get("financeiro_status") or "") != "ativo":
        raise ValueError("A recorrência financeira do contrato não está ativa.")
    if str(contrato.get("status") or "") != "assinado":
        raise ValueError("Somente contratos assinados podem gerar cobranças recorrentes.")
    if Decimal(str(contrato.get("valor_mensal") or 0)) <= 0:
        raise ValueError("Informe um valor mensal maior que zero no contrato.")
    obrigatorios = {
        "financeiro_primeiro_vencimento": "primeiro vencimento",
        "financeiro_dia_vencimento": "dia de vencimento",
        "financeiro_intervalo_meses": "frequência",
        "financeiro_forma_cobranca_id": "forma de cobrança",
        "financeiro_conta_banco_id": "conta bancária",
        "financeiro_categoria_id": "categoria financeira",
        "financeiro_conta_contabil_id": "conta contábil",
    }
    faltantes = [rotulo for campo, rotulo in obrigatorios.items() if contrato.get(campo) in (None, "")]
    if faltantes:
        raise ValueError("Configuração financeira incompleta: " + ", ".join(faltantes) + ".")


def _vencimento_indice(contrato: Dict[str, Any], indice: int) -> date:
    primeiro = contrato["financeiro_primeiro_vencimento"]
    if isinstance(primeiro, datetime):
        primeiro = primeiro.date()
    if indice == 0:
        return primeiro
    return adicionar_meses(
        primeiro,
        indice * int(contrato["financeiro_intervalo_meses"]),
        int(contrato["financeiro_dia_vencimento"]),
    )


def _proximo_vencimento_nao_gerado(
    contrato: Dict[str, Any],
    competencias_existentes: set[date],
) -> Optional[date]:
    data_fim = contrato.get("data_fim")
    if isinstance(data_fim, datetime):
        data_fim = data_fim.date()
    for indice in range(0, 600):
        vencimento = _vencimento_indice(contrato, indice)
        if data_fim and vencimento > data_fim:
            return None
        if primeiro_dia_mes(vencimento) not in competencias_existentes:
            return vencimento
    return None


def gerar_cobrancas_contrato(
    db: Session,
    *,
    empresa_id: int,
    contrato_id: int,
    usuario_id: Optional[int] = None,
    garantir_primeira: bool = False,
    origem_execucao: str = "manual",
) -> Dict[str, Any]:
    if not estrutura_recorrencia_disponivel(db):
        raise ValueError("Execute sql/financeiro/006_contratos_recorrentes.sql antes de gerar cobranças.")

    contrato = _buscar_contrato(db, empresa_id, contrato_id, lock=True)
    _validar_contrato_para_geracao(contrato)

    hoje = datetime.now(_APP_TZ).date()
    meses_antecipacao = max(0, min(12, int(contrato.get("financeiro_meses_antecipacao") or 0)))
    horizonte = adicionar_meses(hoje, meses_antecipacao)
    primeiro = contrato["financeiro_primeiro_vencimento"]
    if isinstance(primeiro, datetime):
        primeiro = primeiro.date()
    if garantir_primeira and primeiro > horizonte:
        horizonte = primeiro

    data_inicio = contrato.get("data_inicio")
    data_fim = contrato.get("data_fim")
    if isinstance(data_inicio, datetime):
        data_inicio = data_inicio.date()
    if isinstance(data_fim, datetime):
        data_fim = data_fim.date()

    existentes = {
        row[0]
        for row in db.execute(
            text(
                """
                SELECT competencia
                FROM public.financeiro_lancamentos
                WHERE empresa_id=:empresa_id AND contrato_id=:contrato_id AND competencia IS NOT NULL
                """
            ),
            {"empresa_id": empresa_id, "contrato_id": contrato_id},
        ).fetchall()
    }

    valor = Decimal(str(contrato.get("valor_mensal") or 0)).quantize(Decimal("0.01"))
    possui_multa = bool(contrato.get("regra_possui_multa"))
    possui_mora = bool(contrato.get("regra_possui_mora_diaria"))
    indice_multa = Decimal(str(contrato.get("regra_indice_multa_percent") or 0)) if possui_multa else Decimal("0")
    indice_mora = Decimal(str(contrato.get("regra_indice_mora_diaria_percent") or 0)) if possui_mora else Decimal("0")

    contato = contrato.get("cliente_contato")
    email = contrato.get("cliente_email_cobranca") or contrato.get("cliente_email")
    whatsapp = contrato.get("cliente_whatsapp") or contrato.get("cliente_telefone")
    modalidade = contrato.get("cliente_modalidade_pagamento")

    gerados: list[Dict[str, Any]] = []
    for indice in range(0, 600):
        vencimento = _vencimento_indice(contrato, indice)
        if vencimento > horizonte:
            break
        if data_inicio and vencimento < data_inicio:
            continue
        if data_fim and vencimento > data_fim:
            break

        competencia = primeiro_dia_mes(vencimento)
        if competencia in existentes:
            continue

        competencia_label = competencia.strftime("%m/%Y")
        descricao = f"Cobrança do contrato {contrato['numero_contrato']} - competência {competencia_label}"
        documento = f"CONTRATO {contrato['numero_contrato']} - {competencia_label}"
        status_lancamento = "vencido" if vencimento < hoje else "aberto"

        row = db.execute(
            text(
                """
                INSERT INTO public.financeiro_lancamentos (
                    empresa_id, tipo, descricao, moeda, valor_total, valor_pago,
                    data_emissao, data_vencimento, data_pagamento, status,
                    cliente_id, fornecedor_id, categoria_id, forma_pagamento_id, conta_banco_id,
                    tipo_documento_id, natureza_operacao_id,
                    centro_custo_principal_id, centro_custo_secundario_id,
                    unidade_consumo_principal_id, unidade_consumo_secundaria_id,
                    conta_contabil_id, forma_cobranca_id, regra_encargos_id, entidade_emissora_id,
                    possui_multa, indice_multa_percent, possui_mora_diaria, indice_mora_diaria_percent,
                    documento, observacoes, anexo_url,
                    contato_cobranca, email_cobranca, whatsapp_cobranca, modalidade_pagamento,
                    nota_fiscal_numero, nota_fiscal_data_emissao,
                    recorrente, parcelado, parcela_numero, parcela_total, grupo_recorrencia, grupo_parcelamento,
                    venda_pendente_id, origem_tipo, origem_id, origem_codigo,
                    contrato_id, competencia,
                    criado_por_usuario_id, atualizado_por_usuario_id, criado_em, atualizado_em
                ) VALUES (
                    :empresa_id, 'receber', :descricao, 'BRL', :valor_total, 0,
                    :data_emissao, :vencimento, NULL, :status,
                    :cliente_id, NULL, :categoria_id, :forma_pagamento_id, :conta_banco_id,
                    :tipo_documento_id, :natureza_operacao_id,
                    :centro_custo_principal_id, :centro_custo_secundario_id,
                    :unidade_consumo_principal_id, :unidade_consumo_secundaria_id,
                    :conta_contabil_id, :forma_cobranca_id, :regra_encargos_id, :entidade_emissora_id,
                    :possui_multa, :indice_multa, :possui_mora, :indice_mora,
                    :documento, :observacoes, NULL,
                    :contato, :email, :whatsapp, :modalidade,
                    NULL, NULL,
                    TRUE, FALSE, NULL, NULL, :grupo_recorrencia, NULL,
                    NULL, 'contrato', :contrato_id, :origem_codigo,
                    :contrato_id, :competencia,
                    :usuario_id, :usuario_id, NOW(), NOW()
                )
                ON CONFLICT (empresa_id, contrato_id, competencia)
                    WHERE contrato_id IS NOT NULL AND competencia IS NOT NULL
                DO NOTHING
                RETURNING id
                """
            ),
            {
                "empresa_id": empresa_id,
                "descricao": descricao,
                "valor_total": valor,
                "data_emissao": hoje,
                "vencimento": vencimento,
                "status": status_lancamento,
                "cliente_id": int(contrato["cliente_id"]),
                "categoria_id": contrato.get("financeiro_categoria_id"),
                "forma_pagamento_id": contrato.get("financeiro_forma_pagamento_id"),
                "conta_banco_id": contrato.get("financeiro_conta_banco_id"),
                "tipo_documento_id": contrato.get("financeiro_tipo_documento_id"),
                "natureza_operacao_id": contrato.get("financeiro_natureza_operacao_id"),
                "centro_custo_principal_id": contrato.get("financeiro_centro_custo_principal_id"),
                "centro_custo_secundario_id": contrato.get("financeiro_centro_custo_secundario_id"),
                "unidade_consumo_principal_id": contrato.get("financeiro_unidade_consumo_principal_id"),
                "unidade_consumo_secundaria_id": contrato.get("financeiro_unidade_consumo_secundaria_id"),
                "conta_contabil_id": contrato.get("financeiro_conta_contabil_id"),
                "forma_cobranca_id": contrato.get("financeiro_forma_cobranca_id"),
                "regra_encargos_id": contrato.get("financeiro_regra_encargos_id"),
                "entidade_emissora_id": contrato.get("financeiro_entidade_emissora_id"),
                "possui_multa": possui_multa,
                "indice_multa": indice_multa,
                "possui_mora": possui_mora,
                "indice_mora": indice_mora,
                "documento": documento,
                "observacoes": contrato.get("financeiro_observacoes"),
                "contato": contato,
                "email": email,
                "whatsapp": whatsapp,
                "modalidade": modalidade,
                "grupo_recorrencia": f"contrato:{contrato_id}",
                "contrato_id": contrato_id,
                "origem_codigo": contrato["numero_contrato"],
                "competencia": competencia,
                "usuario_id": usuario_id or contrato.get("financeiro_ativado_por_usuario_id"),
            },
        ).first()
        if not row:
            existentes.add(competencia)
            continue

        lancamento_id = int(row[0])
        existentes.add(competencia)
        item = {
            "id": lancamento_id,
            "competencia": competencia.isoformat(),
            "vencimento": vencimento.isoformat(),
            "valor": float(valor),
        }
        gerados.append(item)
        _registrar_auditoria_financeira(db, contrato, lancamento_id, usuario_id, item)

    ultima_competencia = max(existentes) if existentes else None
    proximo_vencimento = _proximo_vencimento_nao_gerado(contrato, existentes)
    proxima_competencia = primeiro_dia_mes(proximo_vencimento) if proximo_vencimento else None

    db.execute(
        text(
            """
            UPDATE public.contratos
            SET financeiro_ultima_competencia_gerada=:ultima_competencia,
                financeiro_proxima_competencia=:proxima_competencia,
                financeiro_ultima_geracao_em=NOW(),
                financeiro_ultimo_erro=NULL,
                financeiro_ultimo_erro_em=NULL,
                atualizado_em=NOW()
            WHERE empresa_id=:empresa_id AND id=:contrato_id
            """
        ),
        {
            "ultima_competencia": ultima_competencia,
            "proxima_competencia": proxima_competencia,
            "empresa_id": empresa_id,
            "contrato_id": contrato_id,
        },
    )

    if gerados:
        _registrar_historico_contrato(
            db,
            contrato,
            usuario_id,
            f"{len(gerados)} cobrança(s) recorrente(s) gerada(s) pelo processo {origem_execucao}.",
            campo="cobrancas_recorrentes",
            novo=", ".join(item["competencia"][:7] for item in gerados),
        )

    return {
        "contrato_id": contrato_id,
        "gerados": gerados,
        "quantidade": len(gerados),
        "ultima_competencia": ultima_competencia.isoformat() if ultima_competencia else None,
        "proxima_competencia": proxima_competencia.isoformat() if proxima_competencia else None,
        "proximo_vencimento": proximo_vencimento.isoformat() if proximo_vencimento else None,
    }


def processar_recorrencias_pendentes(
    *,
    empresa_id: Optional[int] = None,
    usuario_id: Optional[int] = None,
) -> Dict[str, Any]:
    db = SessionLocal()
    locked = False
    total_gerados = 0
    processados = 0
    erros: list[Dict[str, Any]] = []
    try:
        if not estrutura_recorrencia_disponivel(db):
            return {"processados": 0, "gerados": 0, "erros": [], "estrutura_disponivel": False}

        locked = bool(
            db.execute(text("SELECT pg_try_advisory_lock(hashtext('valora_financeiro_recorrencia_v1'))")).scalar()
        )
        if not locked:
            return {"processados": 0, "gerados": 0, "erros": [], "bloqueado": True}

        params: Dict[str, Any] = {}
        where = "financeiro_status='ativo' AND status='assinado'"
        if empresa_id is not None:
            where += " AND empresa_id=:empresa_id"
            params["empresa_id"] = int(empresa_id)
        contratos = db.execute(
            text(f"SELECT id, empresa_id FROM public.contratos WHERE {where} ORDER BY empresa_id, id"),
            params,
        ).fetchall()

        for row in contratos:
            contrato_id = int(row[0])
            empresa_atual = int(row[1])
            try:
                resultado = gerar_cobrancas_contrato(
                    db,
                    empresa_id=empresa_atual,
                    contrato_id=contrato_id,
                    usuario_id=usuario_id,
                    origem_execucao="automático",
                )
                total_gerados += int(resultado["quantidade"])
                processados += 1
                db.commit()
            except Exception as exc:  # um contrato com erro não interrompe os demais
                db.rollback()
                mensagem = str(exc)[:1000]
                erros.append({"contrato_id": contrato_id, "erro": mensagem})
                try:
                    db.execute(
                        text(
                            """
                            UPDATE public.contratos
                            SET financeiro_ultimo_erro=:erro,
                                financeiro_ultimo_erro_em=NOW(),
                                atualizado_em=NOW()
                            WHERE empresa_id=:empresa_id AND id=:contrato_id
                            """
                        ),
                        {"erro": mensagem, "empresa_id": empresa_atual, "contrato_id": contrato_id},
                    )
                    db.commit()
                except Exception:
                    db.rollback()
                logger.warning("Falha ao gerar recorrência do contrato %s: %s", contrato_id, mensagem)

        return {
            "processados": processados,
            "gerados": total_gerados,
            "erros": erros,
            "estrutura_disponivel": True,
        }
    finally:
        if locked:
            try:
                db.execute(text("SELECT pg_advisory_unlock(hashtext('valora_financeiro_recorrencia_v1'))"))
                db.commit()
            except Exception:
                db.rollback()
        db.close()


async def _recorrencia_loop() -> None:
    await asyncio.sleep(_START_DELAY_SECONDS)
    while True:
        try:
            await asyncio.to_thread(processar_recorrencias_pendentes)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Erro inesperado no gerador de cobranças recorrentes.")
        await asyncio.sleep(_INTERVAL_SECONDS)


async def start_financeiro_recorrencia_dispatcher() -> None:
    global _RECORRENCIA_TASK
    if os.getenv("FINANCEIRO_RECORRENCIA_DISABLED", "").strip().lower() in {"1", "true", "yes", "sim"}:
        return
    if _RECORRENCIA_TASK and not _RECORRENCIA_TASK.done():
        return
    _RECORRENCIA_TASK = asyncio.create_task(_recorrencia_loop(), name="valora-financeiro-recorrencia")


async def stop_financeiro_recorrencia_dispatcher() -> None:
    global _RECORRENCIA_TASK
    task = _RECORRENCIA_TASK
    _RECORRENCIA_TASK = None
    if not task:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
