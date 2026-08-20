from __future__ import annotations

import html
import io
import json
import re
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


def _clean(value: Any) -> Optional[str]:
    value = " ".join(str(value or "").split()).strip()
    return value or None


def _json_load(value: Any, default: Any):
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _money(value: Any) -> Decimal:
    try:
        if value in (None, ""):
            return Decimal("0")
        if isinstance(value, Decimal):
            return value
        raw = str(value).strip().replace("R$", "").replace(" ", "")
        if "," in raw:
            raw = raw.replace(".", "").replace(",", ".")
        return Decimal(raw)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0")


def format_money(value: Any) -> str:
    number = _money(value).quantize(Decimal("0.01"))
    base = f"{number:,.2f}"
    return "R$ " + base.replace(",", "X").replace(".", ",").replace("X", ".")


def format_date(value: Any) -> str:
    if not value:
        return "-"
    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    raw = str(value)
    try:
        return date.fromisoformat(raw[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return raw


def format_datetime(value: Any) -> str:
    if not value:
        return "-"
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return str(value)
    try:
        local_tz = ZoneInfo("America/Sao_Paulo")
    except Exception:
        local_tz = timezone.utc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(local_tz).strftime("%d/%m/%Y %H:%M")


def _as_utc_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _format_document(value: Any, person_type: str) -> Optional[str]:
    digits = _digits(value)
    if person_type == "PF" and len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    if person_type == "PJ" and len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"
    return _clean(value)


def _custom_fields(db: Session, *, company_id: int, client_id: int) -> Dict[str, str]:
    rows = db.execute(text("""
        SELECT cc.slug, ccv.valor
        FROM clientes_campos_valores ccv
        JOIN campos_clientes cc ON cc.id=ccv.campo_id
        WHERE ccv.cliente_id=:cliente_id AND cc.empresa_id=:empresa_id
    """), {"cliente_id": client_id, "empresa_id": company_id}).mappings().all()
    return {str(row["slug"]): str(row.get("valor") or "") for row in rows}


def _first(*values: Any) -> Optional[str]:
    for value in values:
        clean = _clean(value)
        if clean:
            return clean
    return None


def load_contract_source(db: Session, *, budget_id: int, company_id: int) -> Dict[str, Any]:
    row = db.execute(text("""
        SELECT id, empresa_id, cliente_id, codigo, titulo, status,
               proposta_cliente_public_status, proposta_cliente_aprovado_em,
               proposta_cliente_cadastro_status, proposta_cliente_cadastro_concluido_em,
               proposta_cliente_cadastro_tipo_pessoa, proposta_cliente_snapshot_json,
               proposta_cliente_contrato_status, proposta_cliente_contrato_versao,
               proposta_cliente_contrato_gerado_em, proposta_cliente_contrato_gerado_por_id,
               proposta_cliente_contrato_snapshot_json,
               proposta_cliente_contrato_cliente_atualizado_em,
               proposta_cliente_assinatura_status
        FROM orcamentos
        WHERE id=:id AND empresa_id=:empresa_id
    """), {"id": budget_id, "empresa_id": company_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado.")
    if str(row.get("proposta_cliente_public_status") or "") != "aprovado":
        raise HTTPException(status_code=409, detail="O contrato só pode ser gerado depois da aprovação do cliente.")
    if str(row.get("proposta_cliente_cadastro_status") or "") != "concluido":
        raise HTTPException(status_code=409, detail="O cliente ainda não concluiu o Cadastro para Contrato.")
    client_id = int(row.get("cliente_id") or 0)
    if client_id <= 0:
        raise HTTPException(status_code=409, detail="Este orçamento não possui um cliente vinculado.")

    proposal = _json_load(row.get("proposta_cliente_snapshot_json"), {})
    if not proposal:
        raise HTTPException(status_code=409, detail="A versão aprovada da proposta não foi encontrada.")

    client = db.execute(text("""
        SELECT id, codigo, tipo_pessoa, nome, nome_fantasia, cpf_cnpj, rg_ie,
               inscricao_municipal, data_nascimento, telefone, whatsapp, email,
               cep, endereco, numero, complemento, bairro, cidade, estado, atualizado_em
        FROM clientes
        WHERE id=:cliente_id AND empresa_id=:empresa_id
    """), {"cliente_id": client_id, "empresa_id": company_id}).mappings().first()
    if not client:
        raise HTTPException(status_code=404, detail="Cadastro do cliente não encontrado.")

    custom = _custom_fields(db, company_id=company_id, client_id=client_id)
    tipo = str(client.get("tipo_pessoa") or row.get("proposta_cliente_cadastro_tipo_pessoa") or "PF").upper()
    if tipo not in {"PF", "PJ"}:
        tipo = "PF"

    person = {
        "id": client_id,
        "codigo": client.get("codigo"),
        "tipo_pessoa": tipo,
        "nome": client.get("nome"),
        "nome_fantasia": client.get("nome_fantasia"),
        "cpf_cnpj": _format_document(client.get("cpf_cnpj"), tipo),
        "rg_ie": client.get("rg_ie"),
        "inscricao_municipal": client.get("inscricao_municipal"),
        "nacionalidade": custom.get("nacionalidade"),
        "profissao": custom.get("profissao"),
        "estado_civil": custom.get("estado_civil"),
        "data_nascimento": _iso(client.get("data_nascimento")) or custom.get("data_nascimento"),
        "telefone": _first(client.get("whatsapp"), client.get("telefone"), custom.get("telefone_principal_whatssap"), custom.get("telefone_whatssap")),
        "email": client.get("email"),
        "cep": _first(client.get("cep"), custom.get("cep")),
        "endereco": _first(client.get("endereco"), custom.get("logradouro")),
        "numero": _first(client.get("numero"), custom.get("nº")),
        "complemento": _first(client.get("complemento"), custom.get("complemento")),
        "bairro": _first(client.get("bairro"), custom.get("bairro")),
        "cidade": _first(client.get("cidade"), custom.get("cidade")),
        "estado": _first(client.get("estado"), custom.get("uf")),
        "ponto_referencia": custom.get("ponto_referencia"),
        "atualizado_em": _iso(client.get("atualizado_em")),
    }
    person["representante"] = {
        "nome": custom.get("responsavel_contratante"),
        "cpf": _format_document(custom.get("cpf_contratante"), "PF"),
        "rg": custom.get("rg_contratante"),
        "cargo": custom.get("funcao_cargo"),
        "nacionalidade": custom.get("nacionalidade_contratante"),
        "profissao": custom.get("profissao_contratante"),
        "estado_civil": custom.get("estado_civil_contratante"),
        "data_nascimento": custom.get("data_nascimento_contratante"),
        "telefone": custom.get("telefone_contato_whatssap"),
        "email": custom.get("email_contratante"),
    }
    return {"orcamento": dict(row), "proposta": proposal, "cliente": person}


def contract_title(nature: Optional[str]) -> str:
    return {
        "venda": "CONTRATO DE VENDA E INSTALAÇÃO DE SISTEMA DE SEGURANÇA ELETRÔNICA",
        "locacao": "CONTRATO DE LOCAÇÃO E PRESTAÇÃO DE SERVIÇOS DE SEGURANÇA ELETRÔNICA",
        "comodato": "CONTRATO DE COMODATO E PRESTAÇÃO DE SERVIÇOS DE SEGURANÇA ELETRÔNICA",
        "prestacao_servicos": "CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE SEGURANÇA ELETRÔNICA",
    }.get(str(nature or "").lower(), "CONTRATO DE FORNECIMENTO E SERVIÇOS DE SEGURANÇA ELETRÔNICA")


def build_contract_snapshot(
    db: Session,
    *,
    budget_id: int,
    company_id: int,
    version: int,
    generated_by_id: int,
    generated_by_name: str,
) -> Dict[str, Any]:
    source = load_contract_source(db, budget_id=budget_id, company_id=company_id)
    row = source["orcamento"]
    proposal = source["proposta"]
    client = source["cliente"]
    commercial = proposal.get("comercial") or {}
    nature = (commercial.get("natureza") or {}).get("codigo")
    code = str(row.get("codigo") or budget_id)
    safe_code = re.sub(r"[^A-Za-z0-9_-]+", "-", code).strip("-") or str(budget_id)
    now = datetime.now(timezone.utc)

    return {
        "schema": 1,
        "contrato": {
            "numero": f"CTR-{safe_code}-V{version}",
            "versao": version,
            "titulo": contract_title(nature),
            "gerado_em": now.isoformat(),
            "gerado_por": {"id": generated_by_id, "nome": generated_by_name},
        },
        "aprovacao": {
            "proposta_codigo": (proposal.get("orcamento") or {}).get("codigo") or code,
            "proposta_titulo": (proposal.get("orcamento") or {}).get("titulo") or row.get("titulo"),
            "aprovado_em": _iso(row.get("proposta_cliente_aprovado_em")),
            "cadastro_concluido_em": _iso(row.get("proposta_cliente_cadastro_concluido_em")),
        },
        "emitente": proposal.get("emitente") or {},
        "cliente": client,
        "orcamento": proposal.get("orcamento") or {},
        "comercial": commercial,
        "itens": proposal.get("itens") or [],
        "cliente_atualizado_em": client.get("atualizado_em"),
    }


def contract_details(row: Dict[str, Any], *, client_updated_at: Any = None) -> Dict[str, Any]:
    snapshot = _json_load(row.get("proposta_cliente_contrato_snapshot_json"), {})
    generated_client = _as_utc_datetime(row.get("proposta_cliente_contrato_cliente_atualizado_em"))
    current_client = _as_utc_datetime(client_updated_at)
    outdated = bool(generated_client and current_client and current_client > generated_client)
    contract = snapshot.get("contrato") or {}
    return {
        "status": str(row.get("proposta_cliente_contrato_status") or "nao_gerado"),
        "gerado": bool(snapshot and str(row.get("proposta_cliente_contrato_status") or "") == "gerado"),
        "versao": int(row.get("proposta_cliente_contrato_versao") or 0),
        "numero": contract.get("numero"),
        "titulo": contract.get("titulo"),
        "gerado_em": _iso(row.get("proposta_cliente_contrato_gerado_em")),
        "desatualizado": outdated,
    }


def _p(text_value: Any) -> str:
    return html.escape(str(text_value or "-"))


def _address(data: Dict[str, Any]) -> str:
    line1 = ", ".join(filter(None, [_clean(data.get("endereco")), _clean(data.get("numero")), _clean(data.get("complemento"))]))
    line2 = " - ".join(filter(None, [_clean(data.get("bairro")), _clean(data.get("cidade")), _clean(data.get("estado"))]))
    cep = _clean(data.get("cep"))
    parts = [part for part in (line1, line2, f"CEP {cep}" if cep else None) if part]
    return ", ".join(parts) or "não informado"


def _party_text(snapshot: Dict[str, Any]) -> tuple[str, str]:
    issuer = snapshot.get("emitente") or {}
    client = snapshot.get("cliente") or {}
    contracted = (
        f"<b>CONTRATADA:</b> {_p(issuer.get('razao_social') or issuer.get('nome') or 'SEG Sistemas')}, "
        f"inscrita no CNPJ sob nº {_p(issuer.get('cnpj'))}, com endereço em {_p(issuer.get('endereco') or 'não informado')}."
    )
    if str(client.get("tipo_pessoa") or "PF") == "PJ":
        rep = client.get("representante") or {}
        contractor = (
            f"<b>CONTRATANTE:</b> {_p(client.get('nome'))}, inscrita no CNPJ sob nº {_p(client.get('cpf_cnpj'))}, "
            f"IE/RG {_p(client.get('rg_ie'))}, com endereço em {_p(_address(client))}, "
            f"neste ato representada por {_p(rep.get('nome'))}, CPF nº {_p(rep.get('cpf'))}, "
            f"RG nº {_p(rep.get('rg'))}, na qualidade de {_p(rep.get('cargo'))}."
        )
    else:
        contractor = (
            f"<b>CONTRATANTE:</b> {_p(client.get('nome'))}, CPF nº {_p(client.get('cpf_cnpj'))}, "
            f"RG nº {_p(client.get('rg_ie'))}, {_p(client.get('nacionalidade'))}, "
            f"{_p(client.get('estado_civil'))}, {_p(client.get('profissao'))}, residente em {_p(_address(client))}."
        )
    return contracted, contractor


def _ownership_clause(nature: str) -> str:
    if nature == "venda":
        return "Os equipamentos vendidos passam à propriedade da CONTRATANTE após a quitação dos valores correspondentes, observadas as garantias aplicáveis."
    if nature == "locacao":
        return "Os equipamentos fornecidos em locação permanecem de propriedade da CONTRATADA e deverão ser utilizados exclusivamente no local indicado neste contrato."
    if nature == "comodato":
        return "Os equipamentos cedidos em comodato permanecem de propriedade da CONTRATADA, devendo ser conservados e restituídos quando encerrada a relação contratual, ressalvado o desgaste normal de uso."
    return "A titularidade dos equipamentos seguirá a natureza comercial indicada na proposta aprovada e os itens efetivamente fornecidos."


def render_contract_pdf(snapshot: Dict[str, Any], assinatura: Optional[Dict[str, Any]] = None) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfgen import canvas as pdf_canvas
        from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail="Biblioteca de PDF não disponível no servidor.") from exc

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=16 * mm,
        bottomMargin=18 * mm,
        title=str((snapshot.get("contrato") or {}).get("titulo") or "Contrato"),
        author=str((snapshot.get("emitente") or {}).get("nome") or "Valora CRM"),
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="ContractTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=13, leading=16, alignment=TA_CENTER, textColor=colors.HexColor("#1F3340"), spaceAfter=7 * mm))
    styles.add(ParagraphStyle(name="ContractMeta", parent=styles["Normal"], fontName="Helvetica", fontSize=8.2, leading=11, alignment=TA_CENTER, textColor=colors.HexColor("#65757F"), spaceAfter=5 * mm))
    styles.add(ParagraphStyle(name="ClauseTitle", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=9.4, leading=12, textColor=colors.HexColor("#243B49"), spaceBefore=4 * mm, spaceAfter=1.7 * mm))
    styles.add(ParagraphStyle(name="BodyJust", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.6, leading=12.2, alignment=TA_JUSTIFY, textColor=colors.HexColor("#2E363B"), spaceAfter=2.2 * mm))
    styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=7.6, leading=10, alignment=TA_LEFT, textColor=colors.HexColor("#68767E")))
    styles.add(ParagraphStyle(name="Signature", parent=styles["BodyText"], fontName="Helvetica", fontSize=8, leading=10, alignment=TA_CENTER, textColor=colors.HexColor("#2E363B")))

    story = []
    contract = snapshot.get("contrato") or {}
    approval = snapshot.get("aprovacao") or {}
    commercial = snapshot.get("comercial") or {}
    budget = snapshot.get("orcamento") or {}
    nature = str((commercial.get("natureza") or {}).get("codigo") or "")
    nature_label = (commercial.get("natureza") or {}).get("label") or "Contratação"
    services = ", ".join(str(x.get("label")) for x in (commercial.get("servicos") or []) if x.get("label")) or "conforme itens da proposta"
    plans = ", ".join(str(x.get("label")) for x in (commercial.get("planos") or []) if x.get("label")) or "não aplicável"
    contract_type = (commercial.get("tipo_contrato") or {}).get("label") or "não informado"

    story.append(Paragraph(_p(contract.get("titulo")), styles["ContractTitle"]))
    story.append(Paragraph(
        f"Contrato nº <b>{_p(contract.get('numero'))}</b> - Proposta nº <b>{_p(approval.get('proposta_codigo'))}</b><br/>"
        f"Proposta aprovada em {_p(format_datetime(approval.get('aprovado_em')))}",
        styles["ContractMeta"],
    ))

    contracted, contractor = _party_text(snapshot)
    story.append(Paragraph(contracted, styles["BodyJust"]))
    story.append(Paragraph(contractor, styles["BodyJust"]))
    story.append(Paragraph("As partes acima identificadas têm entre si justo e contratado o seguinte:", styles["BodyJust"]))

    clauses = [
        ("CLÁUSULA 1 - DO OBJETO", f"O presente contrato tem por objeto a {_p(str(nature_label).lower())} dos produtos e/ou serviços descritos na Proposta nº {_p(approval.get('proposta_codigo'))}, aprovada pela CONTRATANTE, abrangendo {_p(services)}. Os planos recorrentes vinculados são: {_p(plans)}. A proposta aprovada integra este instrumento para todos os fins."),
        ("CLÁUSULA 2 - DA IMPLANTAÇÃO E EXECUÇÃO", f"A execução observará o escopo, quantidades e condições da proposta aprovada. Prazo de execução informado: {_p(budget.get('prazo_execucao') or 'conforme programação acordada entre as partes')}. Valor de implantação, quando aplicável: <b>{_p(format_money(commercial.get('valor_implantacao')))}</b>."),
        ("CLÁUSULA 3 - DOS VALORES E PAGAMENTO", f"O valor total da proposta aprovada é de <b>{_p(format_money(budget.get('total')))}</b>. A forma de pagamento definida é {_p((commercial.get('forma_pagamento') or {}).get('label') or 'não informada')}, na condição: {_p(commercial.get('condicao_pagamento') or 'não informada')}."),
        ("CLÁUSULA 4 - DOS SERVIÇOS RECORRENTES", f"Quando houver serviço recorrente, a mensalidade contratada é de <b>{_p(format_money(commercial.get('valor_mensal')))}</b>, com periodicidade indicada como {_p(contract_type)} e vencimento no dia {_p(commercial.get('dia_vencimento') or 'não definido')} de cada período. Valores zerados ou não aplicáveis não geram cobrança por esta cláusula."),
        ("CLÁUSULA 5 - DAS OBRIGAÇÕES DA CONTRATADA", "Compete à CONTRATADA executar os serviços abrangidos pelo escopo aprovado com equipe habilitada, observar as especificações dos equipamentos, informar necessidades técnicas relevantes e preservar a confidencialidade das informações recebidas para execução do objeto."),
        ("CLÁUSULA 6 - DAS OBRIGAÇÕES DA CONTRATANTE", "Compete à CONTRATANTE permitir acesso aos locais necessários, fornecer condições de energia, conectividade e infraestrutura sob sua responsabilidade, manter atualizados os contatos autorizados, comunicar falhas percebidas e cumprir os pagamentos nas condições pactuadas."),
        ("CLÁUSULA 7 - DOS EQUIPAMENTOS", _ownership_clause(nature)),
        ("CLÁUSULA 8 - DA OPERAÇÃO E LIMITES DO SISTEMA", "Os sistemas de segurança e monitoramento têm finalidade preventiva e de apoio à detecção de eventos, reduzindo riscos sem representar garantia absoluta contra invasões, furtos, roubos, falhas de comunicação, energia, internet ou eventos de força maior. A CONTRATANTE deverá seguir as orientações de uso e manter seus dados de contato atualizados."),
        ("CLÁUSULA 9 - DA PROTEÇÃO DE DADOS", "As partes poderão tratar dados pessoais estritamente necessários à execução deste contrato, ao atendimento, faturamento, monitoramento e cumprimento de obrigações legais, adotando medidas razoáveis de segurança e confidencialidade."),
        ("CLÁUSULA 10 - DA VIGÊNCIA, ALTERAÇÕES E ENCERRAMENTO", "A vigência e a periodicidade comercial observarão a proposta aprovada e os serviços efetivamente contratados. Alterações de escopo, valores ou condições deverão ser formalizadas entre as partes. O encerramento observará as condições comerciais pactuadas e a legislação aplicável."),
        ("CLÁUSULA 11 - DISPOSIÇÕES GERAIS", "A tolerância de uma parte quanto ao descumprimento pontual de obrigação não implicará renúncia de direito. Permanecem válidas as demais condições da proposta aprovada que não contrariem este instrumento."),
        ("CLÁUSULA 12 - DO FORO", "Eventuais controvérsias serão submetidas ao foro competente conforme a legislação aplicável, respeitados os foros legalmente obrigatórios."),
    ]
    for title, body in clauses:
        story.append(Paragraph(title, styles["ClauseTitle"]))
        story.append(Paragraph(body, styles["BodyJust"]))

    story.append(Paragraph("ANEXO I - ITENS DA PROPOSTA APROVADA", styles["ClauseTitle"]))
    item_rows = [["Item", "Descrição", "Qtd.", "Unitário", "Total"]]
    for index, item in enumerate(snapshot.get("itens") or [], start=1):
        item_rows.append([
            str(index),
            Paragraph(_p(item.get("descricao") or "Item"), styles["Small"]),
            str(item.get("quantidade") or "0"),
            format_money(item.get("valor_unitario")),
            format_money(item.get("valor_total")),
        ])
    if len(item_rows) == 1:
        item_rows.append(["-", "Conforme proposta aprovada", "-", "-", format_money(budget.get("total"))])
    items_table = Table(item_rows, colWidths=[10 * mm, 84 * mm, 18 * mm, 30 * mm, 30 * mm], repeatRows=1, hAlign="LEFT")
    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF1F4")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#233D4A")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.3),
        ("LEADING", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#CAD5DB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFB")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(items_table)
    story.append(Spacer(1, 5 * mm))

    story.append(Paragraph(
        f"E, por estarem de acordo, as partes poderão assinar este instrumento fisicamente ou por meio eletrônico válido.<br/><br/>"
        f"Data de geração: {_p(format_datetime(contract.get('gerado_em')))}.",
        styles["BodyJust"],
    ))
    issuer_name = (snapshot.get("emitente") or {}).get("razao_social") or (snapshot.get("emitente") or {}).get("nome") or "CONTRATADA"
    client_name = (snapshot.get("cliente") or {}).get("nome") or "CONTRATANTE"
    signatures = Table([
        ["_______________________________", "_______________________________"],
        [Paragraph(_p(issuer_name), styles["Signature"]), Paragraph(_p(client_name), styles["Signature"])],
        [Paragraph("CONTRATADA", styles["Signature"]), Paragraph("CONTRATANTE", styles["Signature"])],
    ], colWidths=[86 * mm, 86 * mm], hAlign="CENTER")
    signatures.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(KeepTogether(signatures))
    story.append(Spacer(1, 4 * mm))

    if assinatura:
        story.append(PageBreak())
        styles.add(ParagraphStyle(name="SignatureCertTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=14, leading=18, alignment=TA_CENTER, textColor=colors.HexColor("#1F3340"), spaceAfter=5 * mm))
        styles.add(ParagraphStyle(name="SignatureCertBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.4, leading=12, alignment=TA_LEFT, textColor=colors.HexColor("#34434B"), spaceAfter=2.5 * mm))
        story.append(Paragraph("REGISTRO DE ACEITE ELETRÔNICO", styles["SignatureCertTitle"]))
        story.append(Paragraph(
            "Esta página registra as evidências técnicas do aceite realizado na Área do Cliente SEG Sistemas. "
            "Ela não representa certificado digital ICP-Brasil; preserva os dados de autenticação e integridade coletados no momento do aceite.",
            styles["SignatureCertBody"],
        ))
        cert_rows = [
            ["Documento", contract.get("numero") or "-"],
            ["Versão", f"V{contract.get('versao') or '-'}"],
            ["Identificador da assinatura", assinatura.get("assinatura_id") or "-"],
            ["Assinante", assinatura.get("assinante_nome") or "-"],
            ["Documento do assinante", assinatura.get("assinante_documento_mascarado") or "-"],
            ["Data e horário", format_datetime(assinatura.get("assinado_em"))],
            ["Endereço IP", assinatura.get("ip") or "-"],
            ["Método", assinatura.get("metodo") or "Área do Cliente SEG Sistemas"],
            ["Hash SHA-256 do conteúdo contratual", assinatura.get("documento_hash_sha256") or "-"],
            ["Sessão", assinatura.get("session_fingerprint") or "-"],
        ]
        cert_table = Table(cert_rows, colWidths=[54 * mm, 116 * mm], hAlign="LEFT")
        cert_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EEF3F6")),
            ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#30414A")),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.6),
            ("LEADING", (0, 0), (-1, -1), 10),
            ("GRID", (0, 0), (-1, -1), .35, colors.HexColor("#CAD5DB")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(cert_table)
        story.append(Spacer(1, 5 * mm))
        story.append(Paragraph(
            "Aceite registrado: o assinante declarou ter lido e concordado com o contrato exibido na Área do Cliente SEG, "
            "vinculado ao hash acima e à versão indicada. O arquivo final pode ser verificado pelo hash SHA-256 registrado no Valora e na SEG.",
            styles["SignatureCertBody"],
        ))
    story.append(Paragraph("Documento gerado automaticamente pelo Valora CRM com base na proposta aprovada e no cadastro concluído pelo cliente.", styles["Small"]))

    def footer(canvas, pdf_doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#7B878E"))
        canvas.drawString(16 * mm, 9 * mm, str(contract.get("numero") or "Contrato"))
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Página {pdf_doc.page}")
        canvas.restoreState()

    def invariant_canvas(*args, **kwargs):
        kwargs["invariant"] = 1
        return pdf_canvas.Canvas(*args, **kwargs)

    doc.build(story, onFirstPage=footer, onLaterPages=footer, canvasmaker=invariant_canvas)
    return buf.getvalue()


def contract_filename(snapshot: Dict[str, Any]) -> str:
    number = str((snapshot.get("contrato") or {}).get("numero") or "contrato")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", number).strip("-") or "contrato"
    return f"{safe}.pdf"
