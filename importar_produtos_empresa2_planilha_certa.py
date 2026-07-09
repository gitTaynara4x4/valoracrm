# importar_produtos_empresa2_planilha_certa.py
# Importador de PRODUTOS para ValoraCRM - empresa_id=2
# Planilha correta: Produtos - IMPORTAR(1).xlsx
#
# O que ele grava:
# - public.produtos
# - public.produtos_campos_valores
#
# Regra combinada:
# - Excel "NOME GENERICO" -> public.produtos.nome
# - Excel "NOME GENERICO" -> campo personalizado "Nome Genérico do Produto" / slug nome_generico_do_produto
# - campo personalizado obrigatório "Nome Fornecedor" -> NÃO INFORMADO, pois não veio na planilha
# - FABRICANTE vazio -> NÃO INFORMADO, pois o campo é obrigatório no cliente
#
# Segurança:
# - DRY_RUN=true por padrão: testa e executa ROLLBACK, não grava nada.
# - Para gravar de verdade: setar DRY_RUN=false.
# - Por padrão aborta se a empresa já tiver produtos, para evitar duplicar importação.

from __future__ import annotations

import os
import re
import zipfile
import xml.etree.ElementTree as ET
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg2
from dotenv import load_dotenv

# Carrega tanto .env quanto .ENV, porque o projeto do ZIP tem .ENV maiúsculo.
for _env_name in (".env", ".ENV"):
    if os.path.exists(_env_name):
        load_dotenv(_env_name, override=False)

EMPRESA_ID = int(os.getenv("EMPRESA_ID", "2"))
XLSX_PATH = os.getenv("XLSX_PATH", "Produtos - IMPORTAR(1).xlsx")
SHEET_NAME = os.getenv("SHEET_NAME", "Produtos")
DRY_RUN = os.getenv("DRY_RUN", "true").strip().lower() in {"1", "true", "sim", "yes", "s"}

# Como a planilha não tem fornecedor, preenche o obrigatório com este valor.
FORNECEDOR_PADRAO = os.getenv("FORNECEDOR_PADRAO", "NÃO INFORMADO")
FABRICANTE_PADRAO = os.getenv("FABRICANTE_PADRAO", "NÃO INFORMADO")

# Mantém as linhas repetidas da planilha como produtos separados.
# Se quiser pular repetidos por NOME GENERICO, rode com MANTER_DUPLICADOS_PLANILHA=false.
MANTER_DUPLICADOS_PLANILHA = os.getenv("MANTER_DUPLICADOS_PLANILHA", "true").strip().lower() in {"1", "true", "sim", "yes", "s"}

# Por padrão, insere novos produtos. Se ativar, atualiza produto existente com mesmo nome exato.
# Cuidado: se houver linhas repetidas na planilha, esse modo junta elas no mesmo produto.
UPSERT_POR_NOME = os.getenv("UPSERT_POR_NOME", "false").strip().lower() in {"1", "true", "sim", "yes", "s"}

# Proteção contra rodar duas vezes sem querer.
ABORTAR_SE_JA_TIVER_PRODUTOS = os.getenv("ABORTAR_SE_JA_TIVER_PRODUTOS", "true").strip().lower() in {"1", "true", "sim", "yes", "s"}

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL não encontrado. Rode dentro da pasta do projeto com .env/.ENV correto.")

# psycopg2 direto precisa de postgresql://
DATABASE_URL = (
    DATABASE_URL
    .replace("postgresql+psycopg2://", "postgresql://")
    .replace("postgres+psycopg2://", "postgresql://")
)

COL_TO_SLUG: Dict[str, str] = {
    "SITUAÇÃO COMERCIAL": "situacao_comercial",
    "NOME GENERICO": "nome_generico_do_produto",
    "NOME OFICIAL": "nome_oficial_do_produto",
    "MODELO": "modelo",
    "FABRICANTE": "fabricante",
    "DESCRIÇÃO GERAL": "descricao_geral_do_produto",
    "ORIGEM PRODUTO": "origem_do_produto",
    "TIPO": "tipo_de_produto",
    "SITUAÇÃO UTILIZAÇÃO": "situacao_de_utilizacao",
    "TIPO UTILIZAÇÃO": "tipo_de_utilizacao",
    "TENDENCIA TEMPORAL DE CONSUMO": "tendencia_temporal_de_consumo",
    "PERIODO": "periodo_temporal",
    "SEGMENTOS APLICAÇÃO": "segmentos_de_aplicacao_opcao_de_escolha_de_varios_segmentos",
    "PRODUTO CONTROLADO": "produto_controlado",
    "CLASSIFICAÇÃO ABCD": "classificacao_abcd",
    "CLASSE": "classe",
    "CATEGORIA": "categoria",
    "SUB CATEGORIA": "subcategoria",
    "GRAU UTILIZAÇÃO": "grau_de_utilizacao",
    "APLICAÇÃO PORTE": "aplicacao_de_porte",
    "APLICAÇÃO PESO": "aplicacao_por_peso_referencia",
}

OBRIGATORIOS_ESPERADOS = {
    "nome_generico_do_produto",
    "fabricante",
    "nome_fornecedor_opcao_de_selecionar_varios_fornecedores_cadastrados",
}


def limpar(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "SIM" if v else "NÃO"
    v = str(v).replace("\u00a0", " ").strip()
    v = re.sub(r"[ \t\r\f\v]+", " ", v)
    v = re.sub(r"\n+", " ", v)
    if v.lower() in {"nan", "none", "null"}:
        return ""
    return v.strip()


def header_key(v: Any) -> str:
    s = limpar(v).upper()
    s = s.replace(":", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def col_letters_to_index(letters: str) -> int:
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx


def format_number(raw: str) -> str:
    raw = str(raw or "").strip()
    if raw == "":
        return ""
    try:
        d = Decimal(raw)
    except InvalidOperation:
        return raw
    if d == d.to_integral():
        return str(int(d))
    return format(d.normalize(), "f")


def read_xlsx_rows(path: str, sheet_name: Optional[str] = None) -> List[List[Any]]:
    """Leitor XLSX simples usando só biblioteca padrão.

    Evita depender de openpyxl, porque o requirements.txt do projeto não inclui openpyxl.
    Lê strings, números, booleanos e inline strings.
    """
    ns = {
        "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
    }

    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())

        shared_strings: List[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("main:si", ns):
                texts = []
                for tnode in si.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                    texts.append(tnode.text or "")
                shared_strings.append("".join(texts))

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = wb.find("main:sheets", ns)
        if sheets is None:
            raise RuntimeError("Workbook sem sheets.")

        chosen_rid = None
        available = []
        for sh in sheets.findall("main:sheet", ns):
            sh_name = sh.attrib.get("name", "")
            available.append(sh_name)
            if sheet_name and sh_name == sheet_name:
                chosen_rid = sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
                break
            if not sheet_name and chosen_rid is None:
                chosen_rid = sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")

        if not chosen_rid:
            raise RuntimeError(f"Aba {sheet_name!r} não encontrada. Abas disponíveis: {available}")

        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels.findall("pkgrel:Relationship", ns):
            if rel.attrib.get("Id") == chosen_rid:
                target = rel.attrib.get("Target")
                break
        if not target:
            raise RuntimeError("Não consegui localizar o arquivo XML da aba.")

        sheet_path = "xl/" + target.lstrip("/")
        root = ET.fromstring(z.read(sheet_path))

        rows: List[List[Any]] = []
        for row in root.findall(".//main:sheetData/main:row", ns):
            vals: Dict[int, Any] = {}
            for cell in row.findall("main:c", ns):
                ref = cell.attrib.get("r", "")
                m = re.match(r"([A-Z]+)(\d+)", ref)
                if not m:
                    continue
                col = col_letters_to_index(m.group(1))
                cell_type = cell.attrib.get("t")
                value_node = cell.find("main:v", ns)

                if value_node is None:
                    inline_node = cell.find("main:is", ns)
                    if inline_node is not None:
                        texts = []
                        for tnode in inline_node.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"):
                            texts.append(tnode.text or "")
                        val = "".join(texts)
                    else:
                        val = ""
                else:
                    raw = value_node.text or ""
                    if cell_type == "s":
                        val = shared_strings[int(raw)] if raw.isdigit() and int(raw) < len(shared_strings) else raw
                    elif cell_type == "b":
                        val = "SIM" if raw == "1" else "NÃO"
                    else:
                        val = format_number(raw)
                vals[col] = val

            if vals:
                max_col = max(vals.keys())
                rows.append([vals.get(i, "") for i in range(1, max_col + 1)])

        return rows


def carregar_produtos_xlsx(path: str) -> Tuple[List[Dict[str, str]], Dict[str, Any]]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Planilha não encontrada: {path}")

    rows = read_xlsx_rows(path, SHEET_NAME)
    if not rows:
        raise RuntimeError("Planilha vazia.")

    headers_raw = rows[0]
    headers = [limpar(h) for h in headers_raw]
    keys = [header_key(h) for h in headers]

    produtos: List[Dict[str, str]] = []
    ignoradas = 0
    nomes_vistos = set()
    duplicados_planilha = 0
    fabricante_vazio = 0

    # Linha 1 = cabeçalho. Linha 2 é só categoria "PRODUTO". Linha 3 vazia.
    # Dados reais começam na linha 4.
    for excel_row_number, row in enumerate(rows[3:], start=4):
        rec: Dict[str, str] = {}
        for idx, key in enumerate(keys):
            rec[key] = limpar(row[idx] if idx < len(row) else "")

        nome = limpar(rec.get("NOME GENERICO"))
        if not nome:
            ignoradas += 1
            continue

        if not MANTER_DUPLICADOS_PLANILHA:
            nome_norm = nome.upper()
            if nome_norm in nomes_vistos:
                duplicados_planilha += 1
                continue
            nomes_vistos.add(nome_norm)
        else:
            nome_norm = nome.upper()
            if nome_norm in nomes_vistos:
                duplicados_planilha += 1
            nomes_vistos.add(nome_norm)

        if not limpar(rec.get("FABRICANTE")):
            fabricante_vazio += 1

        rec["__linha_excel"] = str(excel_row_number)
        produtos.append(rec)

    stats = {
        "linhas_xml": len(rows),
        "headers": headers,
        "produtos_validos": len(produtos),
        "linhas_ignoradas_sem_nome": ignoradas,
        "linhas_duplicadas_por_nome": duplicados_planilha,
        "fabricante_vazio": fabricante_vazio,
    }
    return produtos, stats


def produto_ativo(situacao: str) -> bool:
    s = limpar(situacao).upper()
    if s in {"INATIVO", "INATIVA", "DESATIVADO", "DESATIVADA", "CANCELADO", "CANCELADA"}:
        return False
    return True


def custom_fields_da_linha(row: Dict[str, str]) -> Dict[str, str]:
    custom: Dict[str, str] = {}

    for col_key, slug in COL_TO_SLUG.items():
        valor = limpar(row.get(col_key))
        if valor:
            custom[slug] = valor

    nome_generico = limpar(row.get("NOME GENERICO"))
    fabricante = limpar(row.get("FABRICANTE")) or FABRICANTE_PADRAO

    # Garante os obrigatórios do formulário do cliente.
    custom["nome_generico_do_produto"] = nome_generico
    custom["fabricante"] = fabricante
    custom["nome_fornecedor_opcao_de_selecionar_varios_fornecedores_cadastrados"] = FORNECEDOR_PADRAO

    return custom


def garantir_tabela_sequencias_codigo(cur) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.cadastro_sequencias (
            empresa_id BIGINT NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
            modulo VARCHAR(40) NOT NULL,
            ultimo_codigo BIGINT NOT NULL DEFAULT 0,
            criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (empresa_id, modulo)
        )
        """
    )


def normalizar_codigo_sistema(raw: Any) -> str:
    s = limpar(raw)
    if not s:
        return ""
    # Aceita 0001, 1, 1.0 etc.
    s = s.replace(",", ".")
    try:
        d = Decimal(s)
        if d == d.to_integral():
            return str(int(d))
    except Exception:
        pass
    if re.fullmatch(r"\d+", s):
        return str(int(s))
    return ""


def preparar_sequencia_produto(cur, empresa_id: int) -> int:
    garantir_tabela_sequencias_codigo(cur)

    cur.execute(
        """
        SELECT codigo
        FROM public.produtos
        WHERE empresa_id = %s
        """,
        (empresa_id,),
    )
    maior = 0
    for (codigo,) in cur.fetchall():
        codigo_norm = normalizar_codigo_sistema(codigo)
        if codigo_norm:
            maior = max(maior, int(codigo_norm))

    cur.execute(
        """
        INSERT INTO public.cadastro_sequencias (empresa_id, modulo, ultimo_codigo)
        VALUES (%s, 'produtos', %s)
        ON CONFLICT (empresa_id, modulo)
        DO UPDATE SET
            ultimo_codigo = GREATEST(public.cadastro_sequencias.ultimo_codigo, EXCLUDED.ultimo_codigo),
            atualizado_em = NOW()
        """,
        (empresa_id, maior),
    )

    cur.execute(
        """
        SELECT ultimo_codigo
        FROM public.cadastro_sequencias
        WHERE empresa_id = %s AND modulo = 'produtos'
        FOR UPDATE
        """,
        (empresa_id,),
    )
    ultimo = cur.fetchone()[0]
    return int(ultimo or 0)


def buscar_campos_produtos(cur, empresa_id: int) -> Dict[str, int]:
    cur.execute(
        """
        SELECT slug, id
        FROM public.campos_produtos
        WHERE empresa_id = %s
          AND ativo = true
        """,
        (empresa_id,),
    )
    return {str(slug): int(campo_id) for slug, campo_id in cur.fetchall()}


def validar_campos_obrigatorios(campos: Dict[str, int]) -> None:
    faltando = sorted(OBRIGATORIOS_ESPERADOS - set(campos.keys()))
    if faltando:
        raise RuntimeError(
            "Faltam campos obrigatórios em public.campos_produtos para essa empresa: "
            + ", ".join(faltando)
            + ". Abra a tela de Produtos/Campos uma vez para sincronizar ou confira a empresa_id."
        )


def salvar_custom_fields(cur, produto_id: int, campos: Dict[str, int], custom: Dict[str, str]) -> int:
    gravados = 0
    for slug, valor in custom.items():
        campo_id = campos.get(slug)
        if not campo_id:
            continue

        # A tabela não tem unique constraint no model. Para não duplicar valor do mesmo campo,
        # apaga antes e insere de novo.
        cur.execute(
            """
            DELETE FROM public.produtos_campos_valores
            WHERE produto_id = %s AND campo_id = %s
            """,
            (produto_id, campo_id),
        )

        valor = limpar(valor)
        if valor:
            cur.execute(
                """
                INSERT INTO public.produtos_campos_valores (
                    produto_id,
                    campo_id,
                    valor,
                    criado_em,
                    atualizado_em
                )
                VALUES (%s, %s, %s, NOW(), NOW())
                """,
                (produto_id, campo_id, valor),
            )
            gravados += 1
    return gravados


def main() -> None:
    produtos, stats = carregar_produtos_xlsx(XLSX_PATH)

    print("============================================================", flush=True)
    print("IMPORTADOR PRODUTOS - VALORA CRM", flush=True)
    print("============================================================", flush=True)
    print(f"Arquivo: {XLSX_PATH}", flush=True)
    print(f"Aba: {SHEET_NAME}", flush=True)
    print(f"Empresa ID: {EMPRESA_ID}", flush=True)
    print(f"Produtos válidos na planilha: {stats['produtos_validos']}", flush=True)
    print(f"Linhas sem nome ignoradas: {stats['linhas_ignoradas_sem_nome']}", flush=True)
    print(f"Linhas repetidas por NOME GENERICO: {stats['linhas_duplicadas_por_nome']}", flush=True)
    print(f"Fabricante vazio na planilha: {stats['fabricante_vazio']} -> será {FABRICANTE_PADRAO!r}", flush=True)
    print(f"Nome fornecedor obrigatório: {FORNECEDOR_PADRAO!r}", flush=True)
    print(f"Manter duplicados da planilha: {MANTER_DUPLICADOS_PLANILHA}", flush=True)
    print(f"Upsert por nome: {UPSERT_POR_NOME}", flush=True)
    print(f"DRY_RUN: {DRY_RUN}", flush=True)

    if not produtos:
        print("Nada para importar.", flush=True)
        return

    print("\nConectando no banco...", flush=True)
    conn = psycopg2.connect(DATABASE_URL, connect_timeout=15)
    conn.autocommit = False
    print("Conectou no banco.", flush=True)

    inseridos = 0
    atualizados = 0
    valores_custom = 0
    campos_ausentes = set()
    erros_linha: List[str] = []
    codigo_atual = 0

    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '180s'")
            cur.execute("SET lock_timeout = '15s'")

            cur.execute("SELECT id, nome FROM public.empresas WHERE id = %s", (EMPRESA_ID,))
            empresa = cur.fetchone()
            if not empresa:
                raise RuntimeError(f"Empresa id={EMPRESA_ID} não encontrada.")
            print(f"Empresa encontrada: {empresa[1]} (id={empresa[0]})", flush=True)

            cur.execute("SELECT COUNT(*) FROM public.produtos WHERE empresa_id = %s", (EMPRESA_ID,))
            produtos_antes = int(cur.fetchone()[0] or 0)
            print(f"Produtos atuais dessa empresa antes da importação: {produtos_antes}", flush=True)

            if produtos_antes > 0 and ABORTAR_SE_JA_TIVER_PRODUTOS and not UPSERT_POR_NOME:
                raise RuntimeError(
                    "A empresa já tem produtos cadastrados. Para evitar duplicação, o script abortou. "
                    "Se for intencional, rode com ABORTAR_SE_JA_TIVER_PRODUTOS=false "
                    "ou use UPSERT_POR_NOME=true."
                )

            campos = buscar_campos_produtos(cur, EMPRESA_ID)
            print(f"Campos personalizados de produtos ativos encontrados: {len(campos)}", flush=True)
            validar_campos_obrigatorios(campos)

            slugs_usados = set(COL_TO_SLUG.values()) | OBRIGATORIOS_ESPERADOS
            campos_ausentes = slugs_usados - set(campos.keys())
            if campos_ausentes:
                print("\n[AVISO] Estes slugs da importação não existem em campos_produtos e serão ignorados:", flush=True)
                for slug in sorted(campos_ausentes):
                    print(f"- {slug}", flush=True)

            codigo_atual = preparar_sequencia_produto(cur, EMPRESA_ID)
            print(f"Último código de produto antes da importação: {codigo_atual:04d}", flush=True)

            for idx, row in enumerate(produtos, start=1):
                if idx == 1 or idx % 100 == 0 or idx == len(produtos):
                    print(f"Processando produto {idx}/{len(produtos)}...", flush=True)

                linha_excel = limpar(row.get("__linha_excel"))
                nome = limpar(row.get("NOME GENERICO"))
                if not nome:
                    continue

                nome_oficial = limpar(row.get("NOME OFICIAL"))
                descricao_geral = limpar(row.get("DESCRIÇÃO GERAL"))
                categoria = limpar(row.get("CATEGORIA"))
                custom = custom_fields_da_linha(row)
                ativo = produto_ativo(row.get("SITUAÇÃO COMERCIAL", ""))

                produto_id: Optional[int] = None
                if UPSERT_POR_NOME:
                    cur.execute(
                        """
                        SELECT id
                        FROM public.produtos
                        WHERE empresa_id = %s
                          AND nome = %s
                        ORDER BY id
                        LIMIT 1
                        """,
                        (EMPRESA_ID, nome),
                    )
                    existente = cur.fetchone()
                    if existente:
                        produto_id = int(existente[0])
                        cur.execute(
                            """
                            UPDATE public.produtos
                               SET nome = %s,
                                   descricao = %s,
                                   categoria = %s,
                                   ativo = %s,
                                   atualizado_em = NOW()
                             WHERE id = %s
                            """,
                            (nome, descricao_geral or nome_oficial or None, categoria or None, ativo, produto_id),
                        )
                        atualizados += 1

                if produto_id is None:
                    codigo_atual += 1
                    codigo = f"{codigo_atual:04d}"
                    try:
                        cur.execute(
                            """
                            INSERT INTO public.produtos (
                                empresa_id,
                                codigo,
                                nome,
                                descricao,
                                categoria,
                                unidade,
                                preco_venda,
                                custo,
                                estoque_atual,
                                ativo,
                                criado_em,
                                atualizado_em
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
                            RETURNING id
                            """,
                            (
                                EMPRESA_ID,
                                codigo,
                                nome,
                                descricao_geral or nome_oficial or None,
                                categoria or None,
                                None,
                                None,
                                None,
                                None,
                                ativo,
                            ),
                        )
                    except Exception as e:
                        erros_linha.append(f"Linha {linha_excel}: erro ao inserir produto {nome!r}: {e}")
                        raise
                    produto_id = int(cur.fetchone()[0])
                    inseridos += 1

                valores_custom += salvar_custom_fields(cur, produto_id, campos, custom)

            # Atualiza sequência somente até o último código realmente consumido.
            cur.execute(
                """
                UPDATE public.cadastro_sequencias
                   SET ultimo_codigo = %s,
                       atualizado_em = NOW()
                 WHERE empresa_id = %s
                   AND modulo = 'produtos'
                """,
                (codigo_atual, EMPRESA_ID),
            )

            cur.execute("SELECT COUNT(*) FROM public.produtos WHERE empresa_id = %s", (EMPRESA_ID,))
            produtos_depois = int(cur.fetchone()[0] or 0)

        if DRY_RUN:
            conn.rollback()
            print("\n[TESTE] ROLLBACK executado. Nada foi gravado.", flush=True)
            print("Para importar de verdade, rode novamente com DRY_RUN=false.", flush=True)
        else:
            conn.commit()
            print("\n[OK] COMMIT executado. Produtos importados.", flush=True)

        print("\nResumo:", flush=True)
        print(f"- Produtos antes: {produtos_antes}", flush=True)
        print(f"- Produtos depois simulado/calculado: {produtos_depois}", flush=True)
        print(f"- Produtos inseridos: {inseridos}", flush=True)
        print(f"- Produtos atualizados: {atualizados}", flush=True)
        print(f"- Valores personalizados gravados: {valores_custom}", flush=True)
        print(f"- Último código final: {codigo_atual:04d}", flush=True)

        if erros_linha:
            print("\nErros por linha:", flush=True)
            for err in erros_linha[:30]:
                print(f"- {err}", flush=True)

    except Exception:
        conn.rollback()
        print("\n[ERRO] Importação cancelada. ROLLBACK executado.", flush=True)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
