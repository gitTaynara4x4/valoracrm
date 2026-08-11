(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pageEl = $("[data-financeiro-page]");
  if (!pageEl) return;

  const state = {
    page: pageEl.dataset.financeiroPage,
    items: [],
    auxItems: [],
    opcoes: {
      categorias: [], formas_pagamento: [], contas_bancos: [], clientes: [], fornecedores: [],
      tipos_documento: [], naturezas_operacao: [], tipos_gasto: [], centros_custo: [], unidades_consumo: [],
      contas_contabeis: [], formas_cobranca: [], regras_encargos: [], reguas_cobranca: [],
    },
    filtros: {},
    historicoLancamentoId: null,
    baixaAtual: null,
    cobranca: { reguas: [], etapas: [], fila: [], reguaSelecionadaId: null },
    sacadoLookup: {
      items: [],
      selecionado: null,
      timer: null,
      controller: null,
      requestId: 0,
    },
  };

  const ENDPOINTS = {
    categoria: "/api/financeiro/categorias",
    forma: "/api/financeiro/formas-pagamento",
    conta: "/api/financeiro/contas-bancos",
    "tipo-documento": "/api/financeiro/tipos-documento",
    natureza: "/api/financeiro/naturezas-operacao",
    "tipo-gasto": "/api/financeiro/tipos-gasto",
    "centro-custo": "/api/financeiro/centros-custo",
    "unidade-consumo": "/api/financeiro/unidades-consumo",
    "conta-contabil": "/api/financeiro/contas-contabeis",
    "forma-cobranca": "/api/financeiro/formas-cobranca",
    "regra-encargos": "/api/financeiro/regras-encargos",
  };

  const endpointAux = (tipo) => ENDPOINTS[tipo] || null;

  const todayISO = () => {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, "0");
    const dia = String(agora.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  };

  const CURRENCY_CONFIG = {
    BRL: { locale: "pt-BR", symbol: "R$" },
    USD: { locale: "pt-BR", symbol: "US$" },
    EUR: { locale: "pt-BR", symbol: "€" },
    GBP: { locale: "pt-BR", symbol: "£" },
  };

  const moedaValida = (currency) => CURRENCY_CONFIG[String(currency || "").toUpperCase()] ? String(currency || "").toUpperCase() : "BRL";

  const money = (value, currency = "BRL") => {
    const moeda = moedaValida(currency);
    const n = Number(value || 0);
    try {
      return n.toLocaleString("pt-BR", { style: "currency", currency: moeda });
    } catch (_) {
      return `${CURRENCY_CONFIG[moeda].symbol} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  };

  const currencySymbol = (currency = "BRL") => CURRENCY_CONFIG[moedaValida(currency)].symbol;

  function sanitizeMoneyInput(value) {
    let v = String(value || "");
    // Remove letras e mantém só número, separadores, sinal e símbolos de moeda conhecidos.
    v = v.replace(/[^0-9,.$€£RrSsUu\s-]/g, "");
    // Remove letras soltas que não formam símbolo de moeda.
    v = v.replace(/(?!R\$|r\$|US\$|us\$|U\$|u\$)[A-Za-z]+/g, "");
    return v.replace(/\s+/g, " ").trimStart();
  }

  function moneyToBackend(value) {
    let v = String(value || "").trim();
    if (!v) return "0";
    v = v.replace(/[^0-9,.-]/g, "");
    const lastComma = v.lastIndexOf(",");
    const lastDot = v.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
      else v = v.replace(/,/g, "");
    } else if (lastComma > -1) {
      v = v.replace(",", ".");
    }
    return v || "0";
  }

  function formatMoneyForInput(value, currency = "BRL") {
    const raw = moneyToBackend(value);
    const n = Number(raw || 0);
    if (!Number.isFinite(n)) return "";
    return `${currencySymbol(currency)} ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const dateBR = (value) => {
    if (!value) return "-";
    const [y, m, d] = String(value).slice(0, 10).split("-");
    if (!y || !m || !d) return String(value);
    return `${d}/${m}/${y}`;
  };

  const dateTimeBR = (value) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return dateBR(value);
    return parsed.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  };

  const escapeHtml = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  const statusClass = (status) => {
    const s = String(status || "").toLowerCase();
    if (["recebido", "pago", "ativo", "receita"].includes(s)) return "ok";
    if (["vencido", "cancelado", "inativo", "despesa"].includes(s)) return "danger";
    if (["parcial", "aberto", "ambos"].includes(s)) return "warn";
    return "blue";
  };

  const pill = (text) => `<span class="financeiro-pill ${statusClass(text)}">${escapeHtml(text || "-")}</span>`;

  const setStatusText = (text) => {
    const el = $("#financeiro-status-text");
    if (el) el.textContent = text;
  };

  const alertBox = (message, type = "warn") => {
    const old = $(".financeiro-alert");
    if (old) old.remove();
    const box = document.createElement("div");
    box.className = `financeiro-alert ${type}`;
    box.textContent = message;
    pageEl.prepend(box);
    setTimeout(() => box.remove(), type === "danger" ? 7000 : 3500);
  };

  async function request(path, options = {}) {
    const config = { credentials: "include", ...options };
    config.headers = { ...(options.headers || {}) };
    if (config.body && !(config.body instanceof FormData)) {
      config.headers["Content-Type"] = "application/json";
      config.body = JSON.stringify(config.body);
    }
    const res = await fetch(path, config);
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const detail = data?.detail || data?.message || `${res.status} ${res.statusText}`;
      throw new Error(Array.isArray(detail) ? detail.map(d => d.msg || JSON.stringify(d)).join(" | ") : detail);
    }
    return data;
  }

  const qs = (params) => {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).trim() !== "") sp.set(k, v);
    });
    return sp.toString() ? `?${sp.toString()}` : "";
  };

  function setKPI(key, value) {
    const el = $(`[data-kpi="${key}"]`);
    if (el) el.textContent = value;
  }

  function setTable(tbodyId, cols, html, emptyText) {
    const tbody = $(`#${tbodyId}`) || $(".financeiro-table tbody");
    if (!tbody) return;
    tbody.innerHTML = html || `<tr><td class="financeiro-empty" colspan="${cols}">${emptyText || "Nenhum registro encontrado."}</td></tr>`;
  }

  function parceiroNome(item) {
    return item.cliente_nome || item.fornecedor_nome || "-";
  }

  function acoesLancamento(item) {
    const status = String(item.status || "").toLowerCase();
    const finalizado = ["recebido", "pago", "cancelado"].includes(status);
    return `<div class="actions-cell">
      <button class="financeiro-mini-btn" type="button" data-action="editar-lancamento" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button>
      <button class="financeiro-mini-btn ok" type="button" data-action="baixar-lancamento" data-id="${item.id}" ${finalizado ? "disabled" : ""}><i class="fa-solid fa-check"></i> Baixar</button>
      <button class="financeiro-mini-btn" type="button" data-action="historico-lancamento" data-id="${item.id}"><i class="fa-solid fa-clock-rotate-left"></i> Histórico</button>
      <button class="financeiro-mini-btn warn" type="button" data-action="cancelar-lancamento" data-id="${item.id}" ${status === "cancelado" ? "disabled" : ""} title="Cancelar"><i class="fa-solid fa-ban"></i></button>
      <button class="financeiro-mini-btn danger" type="button" data-action="excluir-lancamento" data-id="${item.id}" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
    </div>`;
  }

  function rowLancamento(item, modo = "dashboard") {
    if (modo === "dashboard") {
      const tipoLabel = item.tipo === "pagar" ? "Pagamento" : "Recebimento";
      const tipoClass = item.tipo === "pagar" ? "danger" : "ok";
      const parceiro = item.tipo === "pagar"
        ? (item.fornecedor_nome || "Sem fornecedor")
        : (item.cliente_nome || "Sem cliente");
      return `<tr>
        <td>
          <div class="financeiro-lancamento-cell">
            <span class="financeiro-lancamento-icon ${tipoClass}"><i class="fa-solid ${item.tipo === "pagar" ? "fa-arrow-up" : "fa-arrow-down"}"></i></span>
            <div><strong>${escapeHtml(item.descricao || "Sem descrição")}</strong></div>
          </div>
        </td>
        <td>${pill(tipoLabel)}</td>
        <td>${escapeHtml(parceiro)}</td>
        <td>${dateBR(item.data_vencimento)}</td>
        <td class="financeiro-amount">${money(item.valor_total, item.moeda)}</td>
        <td>${pill(item.status)}</td>
        <td><button class="financeiro-dashboard-action" type="button" data-action="editar-lancamento" data-id="${item.id}" title="Abrir lançamento"><i class="fa-solid fa-ellipsis"></i></button></td>
      </tr>`;
    }
    const parceiro = item.tipo === "pagar" ? item.fornecedor_nome : item.cliente_nome;
    const parcela = item.parcelado && item.parcela_total
      ? `<small class="financeiro-parcela-label">Parcela ${Number(item.parcela_numero || 1)}/${Number(item.parcela_total)}</small>`
      : "";
    if (state.page === "pagar") {
      const dias = Number(item.dias_atraso || 0);
      return `<tr>
        <td>${item.id}</td>
        <td><strong>${escapeHtml(parceiro || "-")}</strong>${item.fornecedor_tipo ? `<small>${escapeHtml(item.fornecedor_tipo)}</small>` : ""}</td>
        <td>${escapeHtml(item.descricao)}${parcela}</td>
        <td>${dateBR(item.data_vencimento)}</td>
        <td>${dias > 0 ? `<span class="financeiro-atraso">${dias} dia${dias === 1 ? "" : "s"}</span>` : "-"}</td>
        <td class="financeiro-amount">${money(item.valor_total, item.moeda)}</td>
        <td class="financeiro-amount">${money(item.valor_pago, item.moeda)}</td>
        <td class="financeiro-amount"><strong>${money(item.saldo_aberto, item.moeda)}</strong></td>
        <td>${pill(item.status)}</td>
        <td>${acoesLancamento(item)}</td>
      </tr>`;
    }
    const dias = Number(item.dias_atraso || 0);
    const cobranca = item.forma_cobranca_nome || item.modalidade_pagamento || item.forma_pagamento_nome || "-";
    return `<tr>
      <td>${item.id}</td>
      <td><strong>${escapeHtml(parceiro || "-")}</strong>${item.email_cobranca ? `<small>${escapeHtml(item.email_cobranca)}</small>` : ""}</td>
      <td>${escapeHtml(item.descricao)}${parcela}${item.nota_fiscal_numero ? `<small>NF ${escapeHtml(item.nota_fiscal_numero)}</small>` : ""}</td>
      <td>${escapeHtml(cobranca)}</td>
      <td>${dateBR(item.data_vencimento)}</td>
      <td>${dias > 0 ? `<span class="financeiro-atraso">${dias} dia${dias === 1 ? "" : "s"}</span>` : "-"}</td>
      <td class="financeiro-amount">${money(item.valor_total, item.moeda)}</td>
      <td class="financeiro-amount">${money(item.valor_pago, item.moeda)}</td>
      <td class="financeiro-amount"><strong>${money(item.saldo_aberto, item.moeda)}</strong></td>
      <td>${pill(item.status)}</td>
      <td>${acoesLancamento(item)}</td>
    </tr>`;
  }

  const soma = (items, fn) => items.reduce((acc, item) => acc + Number(fn(item) || 0), 0);


  function percent(part, total) {
    const p = total ? (Number(part || 0) / Number(total || 0)) * 100 : 0;
    return `${p.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  }

  function safeItems(data) {
    return Array.isArray(data?.items) ? data.items : [];
  }

  function renderFluxoChart(items = []) {
    const host = $("#financeiro-chart");
    if (!host) return;

    const valid = items
      .filter(i => i && i.data)
      .slice(-24);

    if (!valid.length) {
      host.innerHTML = `<div class="financeiro-empty-chart"><i class="fa-solid fa-chart-column"></i><strong>Ainda não há movimentações neste período</strong><span>Os dados aparecerão conforme os lançamentos forem registrados.</span></div>`;
      return;
    }

    const series = {
      receber: valid.map(i => Number(i.entradas_previstas || 0)),
      pagar: valid.map(i => -Math.abs(Number(i.saidas_previstas || 0))),
      saldo: valid.map(i => Number(i.saldo_previsto_acumulado || 0)),
    };
    const valores = [...series.receber, ...series.pagar, ...series.saldo];
    const min = Math.min(0, ...valores);
    const max = Math.max(1, ...valores);
    const range = max - min || 1;
    const width = 860;
    const height = 244;
    const padLeft = 52;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 32;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const xFor = (idx) => padLeft + (idx * chartW) / Math.max(valid.length - 1, 1);
    const yFor = (value) => padTop + chartH - ((Number(value || 0) - min) / range) * chartH;
    const pointsFor = (values) => values.map((value, idx) => `${xFor(idx).toFixed(1)},${yFor(value).toFixed(1)}`).join(" ");
    const compact = (value) => {
      const n = Number(value || 0);
      const abs = Math.abs(n);
      const sign = n < 0 ? "-" : "";
      if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
      if (abs >= 1_000) return `${sign}${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
      return `${sign}${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
    };

    const gridCount = 4;
    const grid = Array.from({ length: gridCount + 1 }, (_, idx) => {
      const ratio = idx / gridCount;
      const y = padTop + chartH * ratio;
      const value = max - range * ratio;
      return `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" />
        <text class="axis-label" x="${padLeft - 10}" y="${(y + 3).toFixed(1)}" text-anchor="end">${compact(value)}</text>`;
    }).join("");

    const maxLabels = 6;
    const step = Math.max(1, Math.ceil(valid.length / maxLabels));
    const xLabels = valid.map((item, idx) => {
      if (idx !== valid.length - 1 && idx % step !== 0) return "";
      return `<text class="axis-label" x="${xFor(idx).toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(dateBR(item.data).slice(0, 5))}</text>`;
    }).join("");

    host.innerHTML = `
      <svg class="financeiro-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fluxo financeiro">
        <g class="grid">${grid}</g>
        <g class="x-labels">${xLabels}</g>
        <polyline class="series receber" points="${pointsFor(series.receber)}" />
        <polyline class="series pagar" points="${pointsFor(series.pagar)}" />
        <polyline class="series saldo" points="${pointsFor(series.saldo)}" />
      </svg>`;
  }

  function renderAtencaoFinanceira(lancamentos = [], cobrancaResumo = {}, contasPagar = []) {
    const hoje = todayISO();
    const limite = new Date(`${hoje}T12:00:00`);
    limite.setDate(limite.getDate() + 7);
    const limiteISO = limite.toISOString().slice(0, 10);
    const saldo = (item) => Math.max(0, Number(item?.saldo_aberto ?? (Number(item?.valor_total || 0) - Number(item?.valor_pago || 0))));
    const aberto = (item) => {
      const status = String(item?.status || "aberto").toLowerCase();
      return !["pago", "recebido", "cancelado"].includes(status) && saldo(item) > 0;
    };
    const vencidos = lancamentos.filter(item => aberto(item) && String(item.data_vencimento || "").slice(0, 10) < hoje);
    const vencemHoje = lancamentos.filter(item => aberto(item) && String(item.data_vencimento || "").slice(0, 10) === hoje);
    const pagamentos = contasPagar.filter(item => {
      const data = String(item.data_vencimento || "").slice(0, 10);
      return aberto(item) && data >= hoje && data <= limiteISO;
    });

    const setAttention = (key, count, value = null) => {
      const countEl = $(`[data-attention-count="${key}"]`);
      const valueEl = $(`[data-attention-value="${key}"]`);
      if (countEl) countEl.textContent = String(Number(count || 0));
      if (valueEl && value !== null) valueEl.textContent = money(value);
    };

    setAttention("vencidos", vencidos.length, soma(vencidos, saldo));
    setAttention("hoje", vencemHoje.length, soma(vencemHoje, saldo));
    setAttention("cobrancas", Number(cobrancaResumo?.fila_pendente || 0), null);
    setAttention("pagamentos", pagamentos.length, soma(pagamentos, saldo));
  }

  function renderTopClientes(items = []) {
    const host = $("#financeiro-top-clientes");
    if (!host) return;

    const map = new Map();
    items.forEach(item => {
      const nome = item.cliente_nome || item.fornecedor_nome || "Sem cliente";
      const total = Math.max(0, Number(item.saldo_aberto ?? (Number(item.valor_total || 0) - Number(item.valor_pago || 0))));
      if (total <= 0) return;
      map.set(nome, (map.get(nome) || 0) + total);
    });

    const lista = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (!lista.length) {
      host.innerHTML = `<div class="financeiro-empty-soft">Nenhum cliente encontrado no período.</div>`;
      return;
    }

    const totalGeral = soma(lista, i => i[1]);
    host.innerHTML = lista.map(([nome, total], idx) => {
      const initials = String(nome).split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join("").toUpperCase() || "CL";
      return `<div class="financeiro-top-item">
        <span class="rank">${idx + 1}</span>
        <span class="avatar">${escapeHtml(initials)}</span>
        <strong>${escapeHtml(nome)}</strong>
        <span>${money(total)}</span>
        <em>${percent(total, totalGeral)}</em>
      </div>`;
    }).join("");
  }

  function renderCategoriasDashboard(items = []) {
    const host = $("#financeiro-categorias-dashboard");
    if (!host) return;

    const lista = items
      .map(item => ({ nome: item.categoria || "Sem categoria", tipo: item.tipo, total: Number(item.valor_total || 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    if (!lista.length) {
      host.innerHTML = `<div class="financeiro-empty-soft">Nenhuma categoria com movimento.</div>`;
      return;
    }

    const totalGeral = soma(lista, i => i.total);
    host.innerHTML = lista.map(item => {
      const pct = Math.min(100, totalGeral ? (item.total / totalGeral) * 100 : 0);
      const cls = item.tipo === "pagar" ? "danger" : "ok";
      return `<div class="financeiro-category-item">
        <div>
          <span class="dot ${cls}"></span>
          <strong>${escapeHtml(item.nome)}</strong>
        </div>
        <div class="bar"><span style="width:${pct.toFixed(1)}%"></span></div>
        <span>${money(item.total)}</span>
        <em>${percent(item.total, totalGeral)}</em>
      </div>`;
    }).join("");
  }

  function renderStatusDashboard(items = []) {
    const host = $("#financeiro-status-dashboard");
    if (!host) return;

    const ordem = ["aberto", "pago", "recebido", "vencido", "parcial", "cancelado"];
    const labels = { aberto: "Aberto", pago: "Pago", recebido: "Recebido", vencido: "Vencido", parcial: "Parcial", cancelado: "Cancelado" };
    const counts = new Map();
    items.forEach(item => {
      const s = String(item.status || "aberto").toLowerCase();
      counts.set(s, (counts.get(s) || 0) + 1);
    });

    const total = items.length;
    if (!total) {
      host.innerHTML = `<div class="financeiro-empty-soft">Nenhum status para mostrar.</div>`;
      return;
    }

    let cursor = 0;
    const colors = { aberto: "#4BC3C7", pago: "#65ACDE", recebido: "#22C55E", vencido: "#FB7185", parcial: "#FACC15", cancelado: "#94A3B8" };
    const slices = ordem.map(status => {
      const qtd = counts.get(status) || 0;
      if (!qtd) return "";
      const start = cursor;
      const end = cursor + (qtd / total) * 100;
      cursor = end;
      return `${colors[status]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    }).filter(Boolean).join(", ");

    const rows = ordem
      .filter(status => counts.get(status))
      .map(status => `<div class="financeiro-status-row"><span><i style="background:${colors[status]}"></i>${labels[status] || status}</span><strong>${counts.get(status)}</strong><em>${percent(counts.get(status), total)}</em></div>`)
      .join("");

    host.innerHTML = `<div class="financeiro-donut" style="background: conic-gradient(${slices});"><span><strong>${total}</strong><small>Total</small></span></div><div class="financeiro-status-legend">${rows}</div>`;
  }

  function filtros() {
    return {
      busca: $("#filtro-busca")?.value || "",
      status: $("#filtro-status")?.value || "",
      data_inicio: $("#filtro-data-inicio")?.value || "",
      data_fim: $("#filtro-data-fim")?.value || "",
      cliente_id: $("#filtro-cliente")?.value || "",
      fornecedor_id: $("#filtro-fornecedor")?.value || "",
      forma_cobranca_id: $("#filtro-forma-cobranca")?.value || "",
      forma_pagamento_id: $("#filtro-forma-pagamento")?.value || "",
      categoria_id: $("#filtro-categoria")?.value || "",
      limit: 300,
    };
  }

  async function carregarOpcoes() {
    try {
      state.opcoes = await request("/api/financeiro/opcoes");
      preencherSelects();
    } catch (err) {
      console.warn("[Financeiro] opções não carregadas", err);
    }
  }

  function option(label, value) {
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }

  function adicionarOpcaoAtual(select, id, label) {
    if (!select || id === null || id === undefined || String(id).trim() === "") return;
    const value = String(id);
    if (Array.from(select.options || []).some(opt => String(opt.value) === value)) return;
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = `${label || `Registro #${value}`} (atual — fora da lista ativa)`;
    opt.dataset.currentLegacy = "true";
    select.appendChild(opt);
  }

  function garantirOpcoesAtuaisLancamento(form, item) {
    if (!form || !item) return;
    const contaContabilLabel = [item.conta_contabil_codigo, item.conta_contabil_nome].filter(Boolean).join(" - ");
    const defs = [
      ["cliente_id", item.cliente_id, item.cliente_nome],
      ["fornecedor_id", item.fornecedor_id, item.fornecedor_nome],
      ["categoria_id", item.categoria_id, item.categoria_nome],
      ["forma_pagamento_id", item.forma_pagamento_id, item.forma_pagamento_nome],
      ["conta_banco_id", item.conta_banco_id, item.conta_banco_nome],
      ["tipo_documento_id", item.tipo_documento_id, item.tipo_documento_nome],
      ["natureza_operacao_id", item.natureza_operacao_id, item.natureza_operacao_nome],
      ["tipo_gasto_id", item.tipo_gasto_id, item.tipo_gasto_nome],
      ["centro_custo_principal_id", item.centro_custo_principal_id, item.centro_custo_principal_nome],
      ["centro_custo_secundario_id", item.centro_custo_secundario_id, item.centro_custo_secundario_nome],
      ["unidade_consumo_principal_id", item.unidade_consumo_principal_id, item.unidade_consumo_principal_nome],
      ["unidade_consumo_secundaria_id", item.unidade_consumo_secundaria_id, item.unidade_consumo_secundaria_nome],
      ["conta_contabil_id", item.conta_contabil_id, contaContabilLabel],
      ["forma_cobranca_id", item.forma_cobranca_id, item.forma_cobranca_nome],
      ["regra_encargos_id", item.regra_encargos_id, item.regra_encargos_nome],
      ["regua_cobranca_id", item.regua_cobranca_id, item.regua_cobranca_nome],
      ["entidade_emissora_id", item.entidade_emissora_id, item.entidade_emissora_nome],
    ];
    defs.forEach(([name, id, label]) => adicionarOpcaoAtual(form.querySelector(`[name="${name}"]`), id, label));
  }

  function preencherSelects() {
    const ops = state.opcoes || {};
    $$('[data-select="categorias"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.categorias || []).map(i => option(`${i.nome} (${i.tipo})`, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="formas"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.formas_pagamento || []).map(i => option(i.nome, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="contas"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.contas_bancos || []).map(i => option(i.nome, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="clientes"]').forEach(sel => {
      const current = sel.value;
      const vazio = sel.id === "filtro-cliente" ? "Todos os clientes" : "Selecione...";
      sel.innerHTML = `<option value="">${vazio}</option>` + (ops.clientes || []).map(i => option(`${i.codigo || ""} - ${i.nome}`, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="fornecedores"]').forEach(sel => {
      const current = sel.value;
      const vazio = sel.id === "filtro-fornecedor"
        ? (state.page === "pagar" ? "Todos os sacados" : "Todos os fornecedores")
        : "Selecione...";
      sel.innerHTML = `<option value="">${vazio}</option>` + (ops.fornecedores || []).map(i => option(`${i.codigo || ""} - ${i.nome}`, i.id)).join("");
      sel.value = current;
    });

    const popular = (selector, items, labelFn, vazio = "Selecione...") => {
      $$(selector).forEach(sel => {
        const current = sel.value;
        sel.innerHTML = `<option value="">${escapeHtml(vazio)}</option>` + (items || []).map(i => option(labelFn(i), i.id)).join("");
        sel.value = current;
      });
    };
    popular('[data-select="tipos-documento"]', ops.tipos_documento, i => `${i.nome}${i.aplicacao && i.aplicacao !== "ambos" ? ` (${i.aplicacao})` : ""}`);
    popular('[data-select="naturezas-operacao"]', ops.naturezas_operacao, i => `${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`);
    popular('[data-select="tipos-gasto"]', ops.tipos_gasto, i => `${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`);
    popular('[data-select="centros-custo"]', ops.centros_custo, i => `${i.centro_pai_id ? "↳ " : ""}${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`);
    popular('[data-select="unidades-consumo"]', ops.unidades_consumo, i => `${i.unidade_pai_id ? "↳ " : ""}${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`);
    popular('[data-select="contas-contabeis"]', (ops.contas_contabeis || []).filter(i => i.aceita_lancamento !== false), i => `${i.codigo} - ${i.nome}`);
    popular('[data-select="formas-cobranca"]', ops.formas_cobranca, i => i.nome);
    const filtroFormaCobranca = $("#filtro-forma-cobranca");
    if (filtroFormaCobranca && !filtroFormaCobranca.value) filtroFormaCobranca.options[0].textContent = "Todas as formas";
    const filtroFormaPagamento = $("#filtro-forma-pagamento");
    if (filtroFormaPagamento && !filtroFormaPagamento.value) filtroFormaPagamento.options[0].textContent = "Todas as formas";
    popular('[data-select="regras-encargos"]', ops.regras_encargos, i => `${i.nome}${i.padrao ? " (padrão)" : ""}`);
    popular('[data-select="reguas-cobranca"]', ops.reguas_cobranca, i => `${i.nome}${i.padrao ? " (padrão)" : ""}`);
    popular('[data-select="entidades-emissoras"]', ops.contas_bancos, i => i.nome);
  }

  function elementosSacado(form = $("#form-lancamento")) {
    if (!form || state.page !== "pagar") return null;
    const root = form.querySelector("[data-sacado-lookup]");
    if (!root) return null;
    return {
      form,
      root,
      search: root.querySelector("[data-sacado-search]"),
      hidden: root.querySelector('[name="fornecedor_id"]'),
      results: root.querySelector("[data-sacado-results]"),
      clear: root.querySelector("[data-sacado-clear]"),
    };
  }

  function nomeSacado(item) {
    return String(item?.nome || item?.razao_social || item?.nome_fantasia || "").trim();
  }

  function labelSacado(item) {
    const nome = nomeSacado(item) || `Fornecedor #${item?.id || "-"}`;
    const codigo = String(item?.codigo || "").trim();
    return codigo ? `${codigo} - ${nome}` : nome;
  }

  function metaSacado(item) {
    return [item?.cpf_cnpj, item?.telefone || item?.whatsapp, item?.email]
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join(" • ");
  }

  function fecharResultadosSacado(form = $("#form-lancamento")) {
    const els = elementosSacado(form);
    if (!els) return;
    els.results.hidden = true;
    els.results.innerHTML = "";
    els.search.setAttribute("aria-expanded", "false");
  }

  function renderResultadosSacado(form, items = [], mensagem = "") {
    const els = elementosSacado(form);
    if (!els) return;
    state.sacadoLookup.items = Array.isArray(items) ? items : [];
    if (mensagem) {
      els.results.innerHTML = `<div class="financeiro-lookup-message">${escapeHtml(mensagem)}</div>`;
    } else if (!state.sacadoLookup.items.length) {
      els.results.innerHTML = '<div class="financeiro-lookup-message">Nenhum sacado encontrado.</div>';
    } else {
      els.results.innerHTML = state.sacadoLookup.items.map((item, index) => {
        const meta = metaSacado(item);
        return `<button class="financeiro-lookup-option" type="button" role="option" data-sacado-option="${index}">
          <strong>${escapeHtml(labelSacado(item))}</strong>
          ${meta ? `<span>${escapeHtml(meta)}</span>` : '<span>Cadastro de fornecedor</span>'}
        </button>`;
      }).join("");
    }
    els.results.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
  }

  function selecionarSacado(form, item = null, emitir = true) {
    const els = elementosSacado(form);
    if (!els) return;
    clearTimeout(state.sacadoLookup.timer);
    if (state.sacadoLookup.controller) state.sacadoLookup.controller.abort();
    state.sacadoLookup.controller = null;
    state.sacadoLookup.requestId += 1;
    state.sacadoLookup.selecionado = item || null;
    els.hidden.value = item?.id ? String(item.id) : "";
    els.search.value = item ? labelSacado(item) : "";
    els.search.dataset.selectedLabel = item ? labelSacado(item) : "";
    els.search.dataset.selectedId = item?.id ? String(item.id) : "";
    els.clear.hidden = !item;
    els.search.setCustomValidity("");
    fecharResultadosSacado(form);

    if (item && !(state.opcoes.fornecedores || []).some(f => String(f.id) === String(item.id))) {
      state.opcoes.fornecedores = [...(state.opcoes.fornecedores || []), item];
    }
    if (emitir) els.hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sincronizarCampoSacado(form, item = null) {
    const els = elementosSacado(form);
    if (!els) return;
    const id = String(els.hidden.value || item?.fornecedor_id || "");
    if (!id) return selecionarSacado(form, null, false);

    const encontrado = (state.opcoes.fornecedores || []).find(f => String(f.id) === id);
    const sintetico = encontrado || {
      id,
      codigo: item?.fornecedor_codigo || "",
      nome: item?.fornecedor_nome || `Fornecedor #${id}`,
      tipo_fornecedor: item?.fornecedor_tipo || "",
      cpf_cnpj: item?.fornecedor_cpf_cnpj || "",
    };
    selecionarSacado(form, sintetico, false);
  }

  async function buscarSacados(form, termo) {
    const els = elementosSacado(form);
    if (!els) return;
    const busca = String(termo || "").trim();
    if (busca.length < 2) {
      renderResultadosSacado(form, [], "Digite pelo menos 2 caracteres para procurar o sacado.");
      return;
    }

    if (state.sacadoLookup.controller) state.sacadoLookup.controller.abort();
    const controller = new AbortController();
    state.sacadoLookup.controller = controller;
    const requestId = ++state.sacadoLookup.requestId;
    renderResultadosSacado(form, [], "Procurando sacados...");

    try {
      const data = await request(`/api/financeiro/sacados${qs({ busca, limit: 30 })}`, { signal: controller.signal });
      if (requestId !== state.sacadoLookup.requestId) return;
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      renderResultadosSacado(form, items);
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (requestId !== state.sacadoLookup.requestId) return;
      renderResultadosSacado(form, [], `Não foi possível procurar: ${err.message}`);
    }
  }

  function agendarBuscaSacado(form, termo) {
    clearTimeout(state.sacadoLookup.timer);
    state.sacadoLookup.timer = setTimeout(() => buscarSacados(form, termo), 250);
  }

  function filtrarOpcoesPorTipoLancamento(form, tipo) {
    if (!form) return;
    const tipoAtual = String(tipo || "").toLowerCase();
    if (!["pagar", "receber"].includes(tipoAtual)) return;
    const defs = [
      { selector: '[data-select="tipos-documento"]', items: state.opcoes.tipos_documento || [], label: i => `${i.nome}${i.aplicacao && i.aplicacao !== "ambos" ? ` (${i.aplicacao})` : ""}` },
      { selector: '[data-select="naturezas-operacao"]', items: state.opcoes.naturezas_operacao || [], label: i => `${i.codigo ? `${i.codigo} - ` : ""}${i.nome}` },
      { selector: '[data-select="regras-encargos"]', items: state.opcoes.regras_encargos || [], label: i => `${i.nome}${i.padrao ? " (padrão)" : ""}` },
    ];
    defs.forEach(def => {
      const select = form.querySelector(def.selector);
      if (!select) return;
      const current = select.value;
      const items = def.items.filter(i => !i.aplicacao || i.aplicacao === "ambos" || i.aplicacao === tipoAtual);
      select.innerHTML = '<option value="">Selecione...</option>' + items.map(i => option(def.label(i), i.id)).join("");
      select.value = items.some(i => String(i.id) === String(current)) ? current : "";
    });

    const categoria = form.querySelector('[data-select="categorias"]');
    if (categoria) {
      const current = categoria.value;
      const esperado = tipoAtual === "pagar" ? "despesa" : "receita";
      const items = (state.opcoes.categorias || []).filter(i => i.tipo === "ambos" || i.tipo === esperado);
      categoria.innerHTML = '<option value="">Selecione...</option>' + items.map(i => option(`${i.nome} (${i.tipo})`, i.id)).join("");
      categoria.value = items.some(i => String(i.id) === String(current)) ? current : "";
    }
  }

  function atualizarExigenciaEntidadeEmissora(form) {
    if (!form) return;
    const tipoDocumentoId = form.querySelector('[name="tipo_documento_id"]')?.value;
    const tipoDocumento = (state.opcoes.tipos_documento || []).find(i => String(i.id) === String(tipoDocumentoId));
    const entidade = form.querySelector('[name="entidade_emissora_id"]');
    if (!entidade) return;
    const obrigatoria = Boolean(tipoDocumento?.exige_entidade_emissora);
    entidade.required = obrigatoria;
    entidade.setAttribute("aria-required", String(obrigatoria));
    const label = entidade.closest(".financeiro-field")?.querySelector("label");
    if (label) label.textContent = obrigatoria ? "Entidade emissora *" : "Entidade emissora";
  }

  function aplicarRegraEncargos(form, force = false) {
    if (!form) return;
    const select = form.querySelector('[name="regra_encargos_id"]');
    const regra = (state.opcoes.regras_encargos || []).find(i => Number(i.id) === Number(select?.value));
    if (!regra) return;
    const set = (name, value) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && (force || !String(el.value || "").trim())) el.value = String(value);
    };
    set("possui_multa", Boolean(regra.possui_multa));
    set("indice_multa_percent", Number(regra.indice_multa_percent || 0));
    set("possui_mora_diaria", Boolean(regra.possui_mora_diaria));
    set("indice_mora_diaria_percent", Number(regra.indice_mora_diaria_percent || 0));
    atualizarCamposEncargos(form);
  }

  function atualizarCamposEncargos(form) {
    if (!form) return;
    const multa = form.querySelector('[name="possui_multa"]')?.value === "true";
    const mora = form.querySelector('[name="possui_mora_diaria"]')?.value === "true";
    const multaInput = form.querySelector('[name="indice_multa_percent"]');
    const moraInput = form.querySelector('[name="indice_mora_diaria_percent"]');
    if (multaInput) { multaInput.disabled = !multa; if (!multa) multaInput.value = "0"; }
    if (moraInput) { moraInput.disabled = !mora; if (!mora) moraInput.value = "0"; }
  }

  function atualizarTipoFornecedor(form) {
    if (!form) return;
    const fornecedorId = form.querySelector('[name="fornecedor_id"]')?.value;
    const fornecedor = (state.opcoes.fornecedores || []).find(i => String(i.id) === String(fornecedorId));
    const campo = form.querySelector('[data-fornecedor-tipo]');
    if (campo) campo.value = fornecedor?.tipo_fornecedor || "Não informado no cadastro";
  }

  function atualizarDadosCobrancaCliente(form, sobrescrever = false) {
    if (!form) return;
    const clienteId = form.querySelector('[name="cliente_id"]')?.value;
    const cliente = (state.opcoes.clientes || []).find(i => String(i.id) === String(clienteId));
    const valores = {
      contato_cobranca: cliente?.contato || "",
      email_cobranca: cliente?.email_cobranca || cliente?.email || "",
      whatsapp_cobranca: cliente?.whatsapp || cliente?.telefone || "",
      modalidade_pagamento: cliente?.modalidade_pagamento || "",
    };
    Object.entries(valores).forEach(([name, value]) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && (sobrescrever || !String(el.value || "").trim())) el.value = value;
    });
    const resumo = form.querySelector('[data-cliente-cobranca-resumo]');
    if (resumo) {
      if (!cliente) resumo.textContent = "Selecione um cliente para carregar os dados de cobrança do cadastro.";
      else {
        const contatos = [valores.email_cobranca, valores.whatsapp_cobranca, valores.modalidade_pagamento].filter(Boolean);
        resumo.textContent = contatos.length ? `Dados carregados: ${contatos.join(" • ")}` : "O cliente não possui dados de cobrança preenchidos no cadastro.";
      }
    }
  }

  function configurarFormularioPorTipo(form, tipo) {
    if (!form) return;
    const receber = String(tipo || "").toLowerCase() === "receber";
    const clienteField = form.querySelector('[name="cliente_id"]')?.closest(".financeiro-field");
    const fornecedorField = form.querySelector('[name="fornecedor_id"]')?.closest(".financeiro-field");
    const fornecedorTipoField = form.querySelector('[data-fornecedor-tipo]')?.closest(".financeiro-field");
    if (clienteField) clienteField.hidden = !receber;
    if (fornecedorField) fornecedorField.hidden = receber;
    if (fornecedorTipoField) fornecedorTipoField.hidden = receber;
    const clienteSelect = form.querySelector('[name="cliente_id"]');
    const fornecedorSelect = form.querySelector('[name="fornecedor_id"]');
    const sacadoSearch = form.querySelector("[data-sacado-search]");
    if (clienteSelect) clienteSelect.required = receber;
    if (fornecedorSelect) fornecedorSelect.required = !receber && !sacadoSearch;
    if (sacadoSearch) {
      sacadoSearch.required = !receber;
      sacadoSearch.setAttribute("aria-required", String(!receber));
      if (receber) sacadoSearch.setCustomValidity("");
    }
    const secCobranca = form.querySelector("#fin-sec-cobranca-cliente");
    if (secCobranca) secCobranca.hidden = !receber;
    const formaCobranca = form.querySelector('[name="forma_cobranca_id"]');
    if (formaCobranca) {
      formaCobranca.required = receber;
      const label = formaCobranca.closest(".financeiro-field")?.querySelector("label");
      if (label) label.textContent = receber ? "Forma de cobrança *" : "Forma de cobrança";
    }
    const navCobranca = form.querySelector('[data-financeiro-section="fin-sec-cobranca-cliente"]');
    if (navCobranca) navCobranca.hidden = !receber;
    const tipoGastoField = form.querySelector('[name="tipo_gasto_id"]')?.closest(".financeiro-field");
    if (tipoGastoField) tipoGastoField.hidden = receber;
    const reguaField = form.querySelector('[name="regua_cobranca_id"]')?.closest(".financeiro-field");
    if (reguaField) reguaField.hidden = !receber;
    const pagamento = form.querySelector("#fin-sec-pagamento");
    if (pagamento) {
      const h4 = pagamento.querySelector("h4");
      const p = pagamento.querySelector("p");
      if (h4) h4.textContent = receber ? "Recebimento" : "Pagamento";
      if (p) p.textContent = receber ? "Defina a forma de recebimento e a conta bancária que será creditada." : "Escolha a forma de pagamento e a conta ou banco usado no lançamento.";
      const formaLabel = pagamento.querySelector('[name="forma_pagamento_id"]')?.closest(".financeiro-field")?.querySelector("label");
      const contaLabel = pagamento.querySelector('[name="conta_banco_id"]')?.closest(".financeiro-field")?.querySelector("label");
      if (formaLabel) formaLabel.textContent = receber ? "Forma de recebimento" : "Forma de pagamento";
      if (contaLabel) contaLabel.textContent = receber ? "Conta de destino" : "Conta/Banco";
    }
    const tipoSelect = form.querySelector('[name="tipo"]');
    if (tipoSelect) tipoSelect.disabled = ["receber", "pagar"].includes(state.page);
  }

  function statusAutomaticoFormulario(form) {
    if (!form) return "aberto";
    const tipo = String(form.querySelector('[name="tipo"]')?.value || "receber").toLowerCase();
    const statusAtual = String(form.querySelector('[name="status"]')?.value || "").toLowerCase();
    if (statusAtual === "cancelado") return "cancelado";
    const total = Number(moneyToBackend(form.querySelector('[name="valor_total"]')?.value || 0));
    const pago = Number(moneyToBackend(form.querySelector('[name="valor_pago"]')?.value || 0));
    if (total > 0 && pago >= total) return tipo === "pagar" ? "pago" : "recebido";
    if (pago > 0) return "parcial";
    const vencimento = form.querySelector('[name="data_vencimento"]')?.value;
    if (vencimento && vencimento < todayISO()) return "vencido";
    return "aberto";
  }

  function atualizarCampoStatusLancamento(form) {
    if (!form) return;
    const status = form.querySelector('[name="status"]');
    if (!status) return;
    status.value = statusAutomaticoFormulario(form);
    status.disabled = true;
    status.setAttribute("aria-disabled", "true");
    status.title = "Status calculado automaticamente por vencimento e baixas. Use as ações Baixar ou Cancelar para alterá-lo.";
    const label = status.closest(".financeiro-field")?.querySelector("label");
    if (label) label.textContent = "Status (automático)";
  }

  function atualizarCamposParcelamento(form) {
    if (!form) return;
    const parceladoSelect = form.querySelector('[name="parcelado"]');
    const parcelado = parceladoSelect?.value === "true";
    const quantidade = form.querySelector('[name="parcelas_gerar"]');
    const intervalo = form.querySelector('[name="intervalo_parcelas_meses"]');
    const modo = form.querySelector('[name="modo_parcelamento"]');
    const editando = Boolean(form.dataset.editando);
    if (parceladoSelect) {
      parceladoSelect.disabled = editando;
      parceladoSelect.title = editando ? "O parcelamento é definido na criação e não pode ser transformado durante a edição de uma parcela." : "";
    }
    [quantidade, intervalo, modo].forEach(el => { if (el) el.disabled = !parcelado || editando; });
    if (!parcelado && quantidade && !editando) quantidade.value = "1";
    const resumo = form.querySelector('[data-parcelamento-resumo]');
    if (!resumo) return;
    if (editando) {
      const numero = form.querySelector('[name="parcela_numero"]')?.value;
      const total = form.querySelector('[name="parcela_total"]')?.value;
      resumo.textContent = total ? `Este registro é a parcela ${numero || 1} de ${total}. O parcelamento original é preservado; a edição altera somente esta parcela.` : "Edição de lançamento único. Para gerar novas parcelas, crie um novo lançamento parcelado.";
    } else if (parcelado) {
      const qtd = Math.max(1, Number(quantidade?.value || 1));
      resumo.textContent = `${qtd} lançamento${qtd === 1 ? "" : "s"} serão criados a partir do primeiro vencimento.`;
    } else {
      resumo.textContent = "Será criado somente um lançamento.";
    }
  }

  function recalcularTotalBaixaLocal() {
    const form = $("#form-baixa");
    if (!form) return;
    const principal = Number(moneyToBackend(form.querySelector('[name="valor_principal"]')?.value || 0));
    const desconto = Number(moneyToBackend(form.querySelector('[name="valor_desconto"]')?.value || 0));
    const multa = Number(moneyToBackend(form.querySelector('[name="valor_multa"]')?.value || 0));
    const mora = Number(moneyToBackend(form.querySelector('[name="valor_mora"]')?.value || 0));
    const total = Math.max(0, principal - desconto + multa + mora);
    const out = form.querySelector('[name="valor_total_baixa"]');
    if (out) out.value = formatMoneyForInput(total, state.baixaAtual?.moeda || "BRL");
  }

  async function atualizarCalculoBaixa() {
    const form = $("#form-baixa");
    const item = state.baixaAtual;
    if (!form || !item) return;
    const principal = moneyToBackend(form.querySelector('[name="valor_principal"]')?.value || 0);
    const dataPagamento = form.querySelector('[name="data_pagamento"]')?.value || todayISO();
    if (!(Number(principal) > 0)) return recalcularTotalBaixaLocal();
    try {
      const previa = await request(`/api/financeiro/lancamentos/${item.id}/calculo-baixa${qs({ data_pagamento: dataPagamento, valor_principal: principal })}`);
      const multa = form.querySelector('[name="valor_multa"]');
      const mora = form.querySelector('[name="valor_mora"]');
      if (multa) multa.value = formatMoneyForInput(previa.valor_multa || 0, item.moeda);
      if (mora) mora.value = formatMoneyForInput(previa.valor_mora || 0, item.moeda);
      const dias = form.querySelector('[data-baixa-dias]');
      if (dias) dias.textContent = `${Number(previa.dias_atraso || 0)} dia${Number(previa.dias_atraso || 0) === 1 ? "" : "s"}`;
      const regra = form.querySelector('[data-baixa-regra]');
      if (regra) regra.textContent = previa.multa_ja_aplicada
        ? "A multa deste título já foi aplicada em outra baixa válida; somente a mora foi recalculada."
        : (previa.regra_calculo || "Encargos calculados automaticamente.");
      recalcularTotalBaixaLocal();
    } catch (err) {
      const regra = form.querySelector('[data-baixa-regra]');
      if (regra) regra.textContent = err.message;
      recalcularTotalBaixaLocal();
    }
  }

  async function carregarDashboard() {
    const filtroAtual = filtros();
    const [data, fluxo, lancamentosData, receberData, pagarData, cobrancaResumo] = await Promise.all([
      request("/api/financeiro/dashboard"),
      request(`/api/financeiro/fluxo-caixa${qs(filtroAtual)}`).catch(() => ({ items: [] })),
      request(`/api/financeiro/lancamentos${qs({ ...filtroAtual, limit: 50 })}`).catch(() => ({ items: [] })),
      request(`/api/financeiro/contas-receber${qs({ ...filtroAtual, limit: 300 })}`).catch(() => ({ items: [] })),
      request(`/api/financeiro/contas-pagar${qs({ ...filtroAtual, limit: 300 })}`).catch(() => ({ items: [] })),
      request("/api/financeiro/cobrancas/resumo").catch(() => ({ fila_pendente: 0 })),
    ]);

    const r = data.resumo || {};
    const totalFinanceiro = Number(r.total_receber || 0) + Number(r.total_pagar || 0) || 1;
    const recebido = Number(r.recebido || 0);
    const pago = Number(r.pago || 0);
    const saldoPrevisto = Number(r.saldo_previsto || 0);

    setKPI("total-receber", money(r.total_receber));
    setKPI("total-pagar", money(r.total_pagar));
    setKPI("total-recebido", money(recebido));
    setKPI("saldo-previsto", money(saldoPrevisto));
    setKPI("trend-receber", `↑ ${percent(r.total_receber, totalFinanceiro)}`);
    setKPI("trend-pagar", `↑ ${percent(r.total_pagar, totalFinanceiro)}`);
    setKPI("trend-recebido", `↑ ${percent(recebido, totalFinanceiro)}`);
    setKPI("trend-saldo", saldoPrevisto >= 0 ? `↑ ${money(saldoPrevisto)}` : `↓ ${money(Math.abs(saldoPrevisto))}`);

    const lancamentos = safeItems(lancamentosData);
    state.items = lancamentos.length ? lancamentos.slice(0, 4) : (data.proximos_vencimentos || []).slice(0, 4);
    setTable("tbody-dashboard", 7, state.items.map(i => rowLancamento(i, "dashboard")).join(""), "Nenhum lançamento financeiro cadastrado ainda.");

    renderFluxoChart(safeItems(fluxo));
    renderTopClientes(safeItems(receberData));
    renderAtencaoFinanceira([...safeItems(receberData), ...safeItems(pagarData)], cobrancaResumo, safeItems(pagarData));

    setStatusText("Atualizado agora há pouco.");
  }

  async function carregarReceber() {
    const data = await request(`/api/financeiro/contas-receber${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    const resumo = data.resumo || {};
    setKPI("receber-aberto", money(resumo.total_em_aberto || 0));
    setKPI("receber-recebido", money(resumo.total_baixado || 0));
    setKPI("receber-vencido", money(resumo.total_vencido || 0));
    setKPI("receber-hoje", money(resumo.total_vence_hoje || 0));
    setTable("tbody-receber", 11, items.map(i => rowLancamento(i, "receber")).join(""), "Nenhuma conta a receber cadastrada ainda.");
    const inadimplentes = Number(resumo.clientes_inadimplentes || 0);
    setStatusText(`${data.total || 0} título(s) a receber • ${inadimplentes} cliente(s) inadimplente(s).`);
  }

  async function carregarPagar() {
    const data = await request(`/api/financeiro/contas-pagar${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    const aberto = items.filter(i => !["pago", "cancelado"].includes(String(i.status).toLowerCase()));
    const pagos = items.filter(i => String(i.status).toLowerCase() === "pago");
    const vencidos = items.filter(i => String(i.status).toLowerCase() === "vencido");
    const hoje = todayISO();
    const hojeItems = items.filter(i => String(i.data_vencimento).slice(0, 10) === hoje);
    setKPI("pagar-aberto", money(soma(aberto, i => Number(i.valor_total || 0) - Number(i.valor_pago || 0))));
    setKPI("pagar-pago", money(soma(pagos, i => i.valor_pago || i.valor_total)));
    setKPI("pagar-vencido", money(soma(vencidos, i => Number(i.valor_total || 0) - Number(i.valor_pago || 0))));
    setKPI("pagar-hoje", money(soma(hojeItems, i => Math.max(0, Number(i.valor_total || 0) - Number(i.valor_pago || 0)))));
    setTable("tbody-pagar", 10, items.map(i => rowLancamento(i, "pagar")).join(""), "Nenhuma conta a pagar cadastrada ainda.");
    setStatusText(`${data.total || 0} conta(s) a pagar.`);
  }

  async function carregarFluxo() {
    const data = await request(`/api/financeiro/fluxo-caixa${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    const entradas = soma(items, i => i.entradas_previstas);
    const saidas = soma(items, i => i.saidas_previstas);
    const realizado = soma(items, i => Number(i.entradas_realizadas || 0) - Number(i.saidas_realizadas || 0));
    setKPI("fluxo-entradas", money(entradas));
    setKPI("fluxo-saidas", money(saidas));
    setKPI("fluxo-saldo", money(entradas - saidas));
    setKPI("fluxo-realizado", money(realizado));
    setTable("tbody-fluxo", 7, items.map(i => `<tr>
      <td>${dateBR(i.data)}</td>
      <td class="financeiro-amount">${money(i.entradas_previstas)}</td>
      <td class="financeiro-amount">${money(i.entradas_realizadas)}</td>
      <td class="financeiro-amount">${money(i.saidas_previstas)}</td>
      <td class="financeiro-amount">${money(i.saidas_realizadas)}</td>
      <td class="financeiro-amount">${money(Number(i.entradas_previstas || 0) - Number(i.saidas_previstas || 0))}</td>
      <td class="financeiro-amount">${money(i.saldo_previsto_acumulado)}</td>
    </tr>`).join(""), "Nenhum fluxo encontrado no período.");
    setStatusText(`${items.length} dia(s) no fluxo.`);
  }

  async function carregarCategorias() {
    const items = await request("/api/financeiro/categorias");
    state.auxItems = items.map(i => ({ ...i, _auxType: "categoria" }));
    setKPI("cat-receita", `${items.filter(i => i.tipo === "receita").length} categorias`);
    setKPI("cat-despesa", `${items.filter(i => i.tipo === "despesa").length} categorias`);
    setKPI("cat-ativas", `${items.filter(i => i.ativo).length} ativas`);
    setTable("tbody-categorias", 5, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${pill(i.tipo)}</td><td>${escapeHtml(i.cor || "-")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "categoria")}</td></tr>`).join(""), "Nenhuma categoria cadastrada.");
    setStatusText(`${items.length} categoria(s).`);
  }

  async function carregarFormas() {
    const items = await request("/api/financeiro/formas-pagamento");
    state.auxItems = items.map(i => ({ ...i, _auxType: "forma" }));
    setKPI("formas-ativas", `${items.filter(i => i.ativo).length}`);
    setKPI("formas-primeira", items[0]?.nome || "-");
    setKPI("formas-inativas", `${items.filter(i => !i.ativo).length}`);
    setTable("tbody-formas", 4, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.tipo || "-")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "forma")}</td></tr>`).join(""), "Nenhuma forma cadastrada.");
    setStatusText(`${items.length} forma(s).`);
  }

  async function carregarContas() {
    const items = await request("/api/financeiro/contas-bancos");
    state.auxItems = items.map(i => ({ ...i, _auxType: "conta" }));
    setKPI("contas-saldo", money(soma(items, i => i.saldo_atual ?? i.saldo_inicial)));
    setKPI("contas-ativas", `${items.filter(i => i.ativo).length}`);
    setKPI("contas-inativas", `${items.filter(i => !i.ativo).length}`);
    setTable("tbody-contas", 7, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.banco || "-")}</td><td>${escapeHtml(i.agencia || "-")}</td><td>${escapeHtml(i.conta || "-")}</td><td class="financeiro-amount" title="Saldo inicial: ${money(i.saldo_inicial)} em ${dateBR(i.data_saldo_inicial)}">${money(i.saldo_atual ?? i.saldo_inicial)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "conta")}</td></tr>`).join(""), "Nenhuma conta cadastrada.");
    setStatusText(`${items.length} conta(s).`);
  }

  async function carregarCadastrosFinanceiros() {
    const defs = [
      { tipo: "tipo-documento", endpoint: ENDPOINTS["tipo-documento"], tbody: "tbody-tipos-documento", cols: 6, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.aplicacao)}</td><td>${i.exige_entidade_emissora ? "Sim" : "Não"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "tipo-documento")}</td></tr>` },
      { tipo: "natureza", endpoint: ENDPOINTS.natureza, tbody: "tbody-naturezas", cols: 5, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.aplicacao)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "natureza")}</td></tr>` },
      { tipo: "tipo-gasto", endpoint: ENDPOINTS["tipo-gasto"], tbody: "tbody-tipos-gasto", cols: 4, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "tipo-gasto")}</td></tr>` },
      { tipo: "centro-custo", endpoint: ENDPOINTS["centro-custo"], tbody: "tbody-centros-custo", cols: 5, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.centro_pai_nome || "Principal")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "centro-custo")}</td></tr>` },
      { tipo: "unidade-consumo", endpoint: ENDPOINTS["unidade-consumo"], tbody: "tbody-unidades-consumo", cols: 6, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(String(i.tipo_referencia || "outro").replaceAll("_", " "))}</td><td>${escapeHtml(i.unidade_pai_nome || "Principal")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "unidade-consumo")}</td></tr>` },
      { tipo: "conta-contabil", endpoint: ENDPOINTS["conta-contabil"], tbody: "tbody-contas-contabeis", cols: 7, row: i => `<tr><td>${escapeHtml(i.codigo)}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.tipo)}</td><td>${escapeHtml(i.conta_pai_nome || "Raiz")}</td><td>${i.aceita_lancamento ? "Sim" : "Não"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "conta-contabil")}</td></tr>` },
      { tipo: "forma-cobranca", endpoint: ENDPOINTS["forma-cobranca"], tbody: "tbody-formas-cobranca", cols: 4, row: i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(String(i.tipo || "-").replaceAll("_", " "))}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "forma-cobranca")}</td></tr>` },
      { tipo: "regra-encargos", endpoint: ENDPOINTS["regra-encargos"], tbody: "tbody-regras-encargos", cols: 7, row: i => `<tr><td>${escapeHtml(i.nome)}</td><td>${pill(i.aplicacao)}</td><td>${i.possui_multa ? `${Number(i.indice_multa_percent || 0).toLocaleString("pt-BR")}%` : "Não"}</td><td>${i.possui_mora_diaria ? `${Number(i.indice_mora_diaria_percent || 0).toLocaleString("pt-BR")}% ao dia` : "Não"}</td><td>${i.padrao ? pill("Padrão") : "-"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "regra-encargos")}</td></tr>` },
    ];
    const resultados = await Promise.all(defs.map(async d => ({ ...d, items: await request(d.endpoint) })));
    state.auxItems = resultados.flatMap(d => d.items.map(i => ({ ...i, _auxType: d.tipo })));
    resultados.forEach(d => setTable(d.tbody, d.cols, d.items.map(d.row).join(""), "Nenhum cadastro encontrado."));
    const total = resultados.reduce((acc, d) => acc + d.items.length, 0);
    const ativos = resultados.reduce((acc, d) => acc + d.items.filter(i => i.ativo).length, 0);
    setKPI("cadastros-total", String(total));
    setKPI("cadastros-ativos", String(ativos));
    setKPI("cadastros-grupos", String(defs.length));
    setStatusText(`${total} cadastro(s) financeiro(s).`);
  }

  function descricaoMomentoEtapa(dias) {
    const n = Number(dias || 0);
    if (n < 0) return `${Math.abs(n)} dia${Math.abs(n) === 1 ? "" : "s"} antes`;
    if (n === 0) return "No vencimento";
    return `${n} dia${n === 1 ? "" : "s"} depois`;
  }

  function abrirReguaCobranca(item = null) {
    const form = $("#form-regua-cobranca");
    if (!form) return;
    form.reset();
    form.dataset.id = item?.id || "";
    setForm(form, {
      nome: item?.nome || "",
      descricao: item?.descricao || "",
      padrao: String(Boolean(item?.padrao)),
      ativo: String(item ? item.ativo !== false : true),
    });
    const titulo = $("#modal-regua-cobranca-titulo");
    if (titulo) titulo.textContent = item ? "Editar régua de cobrança" : "Nova régua de cobrança";
    abrirModal("#modal-regua-cobranca");
  }

  function abrirEtapaCobranca(item = null, reguaId = null) {
    const form = $("#form-etapa-cobranca");
    if (!form) return;
    const rid = Number(reguaId || item?.regua_id || state.cobranca.reguaSelecionadaId || 0);
    if (!rid) return alertBox("Selecione uma régua antes de criar uma etapa.", "warn");
    form.reset();
    form.dataset.id = item?.id || "";
    setForm(form, {
      regua_id: rid,
      nome: item?.nome || "",
      deslocamento_dias: item?.deslocamento_dias ?? 0,
      canal: item?.canal || "whatsapp",
      acao: item?.acao || "lembrete",
      mensagem: item?.mensagem || "",
      ordem: item?.ordem ?? 0,
      ativo: String(item ? item.ativo !== false : true),
    });
    const titulo = $("#modal-etapa-cobranca-titulo");
    if (titulo) titulo.textContent = item ? "Editar etapa da régua" : "Nova etapa da régua";
    abrirModal("#modal-etapa-cobranca");
  }

  async function carregarEtapasCobranca(reguaId) {
    const rid = Number(reguaId || 0);
    state.cobranca.reguaSelecionadaId = rid || null;
    if (!rid) {
      state.cobranca.etapas = [];
      setTable("tbody-cobranca-etapas", 7, "", "Selecione uma régua para visualizar as etapas.");
      return;
    }
    const etapas = await request(`/api/financeiro/reguas-cobranca/${rid}/etapas`);
    state.cobranca.etapas = etapas;
    setTable("tbody-cobranca-etapas", 7, etapas.map(i => `<tr>
      <td>${escapeHtml(i.nome)}</td>
      <td>${escapeHtml(descricaoMomentoEtapa(i.deslocamento_dias))}</td>
      <td>${escapeHtml(String(i.canal || "-").replaceAll("_", " "))}</td>
      <td>${pill(String(i.acao || "-").replaceAll("_", " "))}</td>
      <td>${i.mensagem ? escapeHtml(i.mensagem.length > 80 ? `${i.mensagem.slice(0, 80)}…` : i.mensagem) : '<span class="financeiro-muted">Sem mensagem</span>'}</td>
      <td>${pill(i.ativo ? "Ativo" : "Inativo")}</td>
      <td><div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="editar-etapa-cobranca" data-id="${i.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button><button class="financeiro-mini-btn danger" type="button" data-action="excluir-etapa-cobranca" data-id="${i.id}"><i class="fa-regular fa-trash-can"></i></button></div></td>
    </tr>`).join(""), "Nenhuma etapa cadastrada nesta régua.");
  }

  async function carregarCobrancas() {
    await request("/api/financeiro/cobrancas/processar", { method: "POST" }).catch(err => console.warn("[Financeiro] não foi possível processar régua", err));
    const [resumo, fila, reguas] = await Promise.all([
      request("/api/financeiro/cobrancas/resumo"),
      request(`/api/financeiro/cobrancas/fila${qs({ status: $("#filtro-cobranca-status") ? $("#filtro-cobranca-status").value : "pendente", acao: $("#filtro-cobranca-acao")?.value || "" })}`),
      request("/api/financeiro/reguas-cobranca"),
    ]);
    state.cobranca.fila = fila;
    state.cobranca.reguas = reguas;
    state.items = fila;

    setKPI("cobranca-fila", String(Number(resumo.fila_pendente || 0)));
    setKPI("cobranca-vencidos", String(Number(resumo.titulos_vencidos || 0)));
    setKPI("cobranca-bloqueio", String(Number(resumo.a_bloquear || 0)));
    setKPI("cobranca-protesto", String(Number(resumo.a_protestar || 0)));

    setTable("tbody-cobranca-fila", 10, fila.map(i => `<tr>
      <td>${escapeHtml(i.cliente_nome || "Cliente não identificado")}</td>
      <td>${escapeHtml(i.lancamento_descricao || `Título #${i.lancamento_id}`)}${i.documento ? `<small>${escapeHtml(i.documento)}</small>` : ""}</td>
      <td>${dateBR(i.data_vencimento)}</td>
      <td>${Number(i.dias_atraso || 0)} dia(s)</td>
      <td class="financeiro-amount">${money(i.saldo_aberto)}</td>
      <td>${escapeHtml(i.etapa_nome || "-")}</td>
      <td>${pill(String(i.acao || "-").replaceAll("_", " "))}</td>
      <td>${escapeHtml(String(i.canal || "-").replaceAll("_", " "))}<small>${escapeHtml(i.contato_destino || "Sem contato")}</small></td>
      <td>${pill(i.status || "pendente")}</td>
      <td><div class="actions-cell">
        ${i.canal === "whatsapp" && i.cliente_id ? `<button class="financeiro-mini-btn" type="button" data-action="abrir-cobranca-zapschat" data-id="${i.id}" title="Abrir conversa no ZapsChat"><i class="fa-brands fa-whatsapp"></i></button>` : ""}
        ${i.mensagem ? `<button class="financeiro-mini-btn" type="button" data-action="copiar-cobranca-mensagem" data-id="${i.id}" title="Copiar mensagem"><i class="fa-regular fa-copy"></i></button>` : ""}
        ${i.status === "pendente" || i.status === "erro" ? `<button class="financeiro-mini-btn" type="button" data-action="marcar-cobranca-enviada" data-id="${i.id}"><i class="fa-solid fa-check"></i> Enviado</button><button class="financeiro-mini-btn warn" type="button" data-action="ignorar-cobranca" data-id="${i.id}">Ignorar</button>` : ""}
      </div></td>
    </tr>`).join(""), "Nenhuma cobrança na fila com estes filtros.");

    setTable("tbody-cobranca-reguas", 6, reguas.map(i => `<tr>
      <td>${escapeHtml(i.nome)}</td><td>${Number(i.etapas_ativas || 0)}</td><td>${i.padrao ? pill("Padrão") : "-"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${escapeHtml(i.descricao || "-")}</td>
      <td><div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="selecionar-regua-cobranca" data-id="${i.id}"><i class="fa-solid fa-list-check"></i> Etapas</button><button class="financeiro-mini-btn" type="button" data-action="editar-regua-cobranca" data-id="${i.id}"><i class="fa-regular fa-pen-to-square"></i></button><button class="financeiro-mini-btn danger" type="button" data-action="excluir-regua-cobranca" data-id="${i.id}"><i class="fa-regular fa-trash-can"></i></button></div></td>
    </tr>`).join(""), "Nenhuma régua cadastrada.");

    const select = $("#cobranca-regua-etapas");
    if (select) {
      const atual = String(state.cobranca.reguaSelecionadaId || select.value || reguas.find(i => i.padrao)?.id || reguas[0]?.id || "");
      select.innerHTML = '<option value="">Selecione uma régua...</option>' + reguas.map(i => option(`${i.nome}${i.padrao ? " (padrão)" : ""}`, i.id)).join("");
      select.value = atual;
      await carregarEtapasCobranca(select.value);
    }
    setStatusText(`${fila.length} item(ns) na fila de cobrança exibida(s).`);
  }

  async function salvarReguaCobranca(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = getForm(form);
    const id = form.dataset.id;
    const body = { nome: data.nome, descricao: data.descricao || null, padrao: data.padrao === "true", ativo: data.ativo === "true" };
    try {
      await request(id ? `/api/financeiro/reguas-cobranca/${id}` : "/api/financeiro/reguas-cobranca", { method: id ? "PUT" : "POST", body });
      fecharModais();
      alertBox("Régua de cobrança salva.", "ok");
      await recarregar();
    } catch (err) { alertBox(`Erro ao salvar régua: ${err.message}`, "danger"); }
  }

  async function salvarEtapaCobranca(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = getForm(form);
    const id = form.dataset.id;
    const body = {
      regua_id: Number(data.regua_id), nome: data.nome,
      deslocamento_dias: Number(data.deslocamento_dias || 0), canal: data.canal,
      acao: data.acao, mensagem: data.mensagem || null, ordem: Number(data.ordem || 0),
      ativo: data.ativo === "true",
    };
    try {
      await request(id ? `/api/financeiro/reguas-cobranca/etapas/${id}` : `/api/financeiro/reguas-cobranca/${body.regua_id}/etapas`, { method: id ? "PUT" : "POST", body });
      fecharModais();
      alertBox("Etapa da régua salva.", "ok");
      await recarregar();
    } catch (err) { alertBox(`Erro ao salvar etapa: ${err.message}`, "danger"); }
  }

  async function carregarRelatorios() {
    const data = await request(`/api/financeiro/relatorios/resumo${qs(filtros())}`);
    const items = data.por_categoria || [];
    state.items = items;
    const receitas = soma(items.filter(i => i.tipo === "receber"), i => i.valor_total);
    const despesas = soma(items.filter(i => i.tipo === "pagar"), i => i.valor_total);
    const receber = data.contas_receber || {};
    setKPI("rel-receitas", money(receitas));
    setKPI("rel-despesas", money(despesas));
    setKPI("rel-resultado", money(receitas - despesas));
    setKPI("rel-receber-aberto", money(receber.em_aberto_periodo));
    setKPI("rel-recebido-periodo", money(receber.recebido_periodo));
    setKPI("rel-receber-vencido", money(receber.vencido_periodo));
    setKPI("rel-clientes-inadimplentes", String(Number(receber.clientes_inadimplentes || 0)));
    setTable("tbody-relatorios", 6, items.map(i => `<tr><td>${i.tipo === "pagar" ? "Despesa" : "Receita"}</td><td>${escapeHtml(i.categoria)}</td><td>${i.quantidade}</td><td class="financeiro-amount">${money(i.valor_total)}</td><td class="financeiro-amount">${money(i.valor_pago)}</td><td class="financeiro-amount">${money(i.saldo_aberto)}</td></tr>`).join(""), "Nenhum dado no período.");
    const gastos = data.por_tipo_gasto || [];
    setTable("tbody-relatorio-tipos-gasto", 5, gastos.map(i => `<tr><td>${escapeHtml(i.tipo_gasto)}</td><td>${i.quantidade}</td><td class="financeiro-amount">${money(i.valor_total)}</td><td class="financeiro-amount">${money(i.valor_pago)}</td><td class="financeiro-amount">${money(i.saldo_aberto)}</td></tr>`).join(""), "Nenhuma despesa classificada no período.");
    const centros = data.por_centro_custo || [];
    setTable("tbody-relatorio-centros-custo", 6, centros.map(i => `<tr><td>${escapeHtml(i.centro_custo)}</td><td>${escapeHtml(i.subcentro || "-")}</td><td>${i.quantidade}</td><td class="financeiro-amount">${money(i.valor_total)}</td><td class="financeiro-amount">${money(i.valor_pago)}</td><td class="financeiro-amount">${money(i.saldo_aberto)}</td></tr>`).join(""), "Nenhum centro de custo movimentado no período.");
    setStatusText(`${items.length} linha(s) por categoria, ${gastos.length} por tipo de gasto e ${centros.length} por centro de custo.`);
  }

  function acoesAuxiliar(item, tipo) {
    return `<div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="editar-aux" data-tipo="${tipo}" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button><button class="financeiro-mini-btn danger" type="button" data-action="excluir-aux" data-tipo="${tipo}" data-id="${item.id}"><i class="fa-regular fa-trash-can"></i></button></div>`;
  }

  async function recarregar() {
    setStatusText("Carregando...");
    try {
      await carregarOpcoes();
      if (state.page === "dashboard") await carregarDashboard();
      else if (state.page === "receber") await carregarReceber();
      else if (state.page === "pagar") await carregarPagar();
      else if (state.page === "fluxo") await carregarFluxo();
      else if (state.page === "categorias") await carregarCategorias();
      else if (state.page === "formas") await carregarFormas();
      else if (state.page === "contas") await carregarContas();
      else if (state.page === "cadastros") await carregarCadastrosFinanceiros();
      else if (state.page === "cobrancas") await carregarCobrancas();
      else if (state.page === "relatorios") await carregarRelatorios();
      setStatusText("Dados atualizados.");
    } catch (err) {
      console.error("[Financeiro] erro", err);
      alertBox(`Erro ao carregar financeiro: ${err.message}`, "danger");
      setStatusText("Erro ao carregar.");
    }
  }

  function abrirModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("financeiro-modal-open");
  }

  function fecharModais() {
    $$(".financeiro-modal-backdrop").forEach(m => {
      m.classList.remove("is-open");
      m.setAttribute("aria-hidden", "true");
    });
    document.body.classList.remove("financeiro-modal-open");
  }

  function ativarNavegacaoModalLancamento(sectionId = "fin-sec-lancamento") {
    const modal = $("#modal-lancamento");
    if (!modal) return;

    $$(".financeiro-ficha-nav button", modal).forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.financeiroSection === sectionId);
    });

    const alvo = document.getElementById(sectionId);
    const corpo = $(".financeiro-modal-body--ficha", modal);
    if (alvo && corpo) {
      corpo.scrollTo({
        top: alvo.offsetTop - corpo.offsetTop - 4,
        behavior: "smooth"
      });
    }
  }

  function setForm(form, data = {}) {
    $$('input, select, textarea', form).forEach(el => {
      const name = el.name;
      if (!name) return;
      const val = data[name];
      if (el.type === "checkbox") el.checked = Boolean(val);
      else if (val === null || val === undefined) el.value = "";
      else if (String(name).startsWith("data_")) el.value = String(val).slice(0, 10);
      else el.value = String(val);
    });
  }

  function getForm(form) {
    const data = {};
    $$('input, select, textarea', form).forEach(el => {
      if (!el.name) return;
      if (el.type === "checkbox") data[el.name] = el.checked;
      else data[el.name] = el.value;
    });
    return data;
  }

  function nullNumber(v) {
    return v === "" || v === null || v === undefined ? null : Number(v);
  }

  function abrirLancamento(tipo = "", item = null) {
    const form = $("#form-lancamento");
    if (!form) return;
    form.reset();
    form.dataset.editando = item ? "true" : "";
    preencherSelects();
    const base = item ? { ...item } : {
      tipo: tipo || (state.page === "pagar" ? "pagar" : "receber"),
      status: "aberto",
      data_emissao: todayISO(),
      data_vencimento: todayISO(),
      moeda: "BRL",
      valor_total: "",
      valor_pago: "0",
      parcelado: false,
      parcelas_gerar: 1,
      intervalo_parcelas_meses: 1,
      modo_parcelamento: "dividir_total",
    };
    if (item) {
      base.moeda = moedaValida(item.moeda || "BRL");
      base.valor_total = formatMoneyForInput(item.valor_total ?? "", base.moeda);
      base.valor_pago = formatMoneyForInput(item.valor_pago ?? "", base.moeda);
      base.parcelas_gerar = 1;
      base.intervalo_parcelas_meses = 1;
      base.modo_parcelamento = "dividir_total";
    }
    filtrarOpcoesPorTipoLancamento(form, base.tipo);
    if (item) garantirOpcoesAtuaisLancamento(form, item);
    setForm(form, base);
    atualizarCampoStatusLancamento(form);
    sincronizarCampoSacado(form, item);
    configurarFormularioPorTipo(form, base.tipo);
    atualizarExigenciaEntidadeEmissora(form);
    atualizarTipoFornecedor(form);
    atualizarDadosCobrancaCliente(form, false);
    atualizarCamposParcelamento(form);
    if (!item) {
      const regraPadrao = (state.opcoes.regras_encargos || []).find(r => r.padrao && ["ambos", base.tipo].includes(r.aplicacao));
      if (regraPadrao) {
        const regraSelect = form.querySelector('[name="regra_encargos_id"]');
        if (regraSelect) regraSelect.value = String(regraPadrao.id);
        aplicarRegraEncargos(form, true);
      }
    } else {
      atualizarCamposEncargos(form);
    }
    const valorPagoInput = form.querySelector('[name="valor_pago"]');
    if (valorPagoInput) {
      valorPagoInput.readOnly = true;
      valorPagoInput.setAttribute("aria-readonly", "true");
      valorPagoInput.title = "Valor principal baixado, calculado automaticamente pelas movimentações e estornos.";
    }
    const dataPagamentoInput = form.querySelector('[name="data_pagamento"]');
    if (dataPagamentoInput) {
      dataPagamentoInput.readOnly = true;
      dataPagamentoInput.setAttribute("aria-readonly", "true");
      dataPagamentoInput.title = "Data calculada automaticamente pelas movimentações.";
    }
    const verboTitulo = base.tipo === "receber" ? "conta a receber" : "conta a pagar";
    $("#modal-lancamento-titulo").textContent = item ? `Editar ${verboTitulo} #${item.id}` : `Nova ${verboTitulo}`;
    const chip = $("#modal-lancamento-chip");
    if (chip) chip.textContent = item ? "Edição" : (base.status ? base.status.charAt(0).toUpperCase() + base.status.slice(1) : "Aberto");
    const subtitulo = $("#modal-lancamento-subtitulo");
    if (subtitulo) subtitulo.textContent = item
      ? "Atualize os dados desta parcela ou lançamento."
      : "Preencha os dados financeiros; o sistema pode gerar as parcelas futuras automaticamente.";
    abrirModal("#modal-lancamento");
    setTimeout(() => ativarNavegacaoModalLancamento("fin-sec-lancamento"), 30);
  }

  function abrirBaixa(item) {
    const form = $("#form-baixa");
    if (!form) return;
    state.baixaAtual = item;
    form.reset();
    preencherSelects();
    const restante = Math.max(0, Number(item.valor_total || 0) - Number(item.valor_pago || 0));
    setForm(form, {
      id: item.id,
      valor_principal: formatMoneyForInput(restante, item.moeda || "BRL"),
      valor_desconto: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_multa: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_mora: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_total_baixa: formatMoneyForInput(restante, item.moeda || "BRL"),
      data_pagamento: todayISO(),
      forma_pagamento_id: item.forma_pagamento_id || "",
      conta_banco_id: item.conta_banco_id || "",
      observacoes: "",
    });
    const resumo = $("#financeiro-baixa-resumo", form);
    if (resumo) resumo.innerHTML = `
      <div><span>Valor principal</span><strong>${money(item.valor_total, item.moeda)}</strong></div>
      <div><span>Principal baixado</span><strong>${money(item.valor_pago, item.moeda)}</strong></div>
      <div><span>Saldo principal</span><strong>${money(restante, item.moeda)}</strong></div>
      <div><span>Dias em atraso</span><strong data-baixa-dias>${Number(item.dias_atraso || 0)} dia${Number(item.dias_atraso || 0) === 1 ? "" : "s"}</strong></div>`;
    const comprovante = form.querySelector('[name="comprovante"]');
    if (comprovante) comprovante.value = "";
    const ehPagamento = String(item.tipo || "") === "pagar";
    const formaSelect = form.querySelector('[name="forma_pagamento_id"]');
    const contaSelect = form.querySelector('[name="conta_banco_id"]');
    const contaLabel = form.querySelector('[data-baixa-conta-label]');
    if (formaSelect) formaSelect.required = true;
    if (contaSelect) contaSelect.required = true;
    if (contaLabel) contaLabel.textContent = ehPagamento ? "Conta a debitar" : "Conta a creditar";
    const modal = form.closest(".financeiro-modal");
    const titulo = modal?.querySelector(".financeiro-modal-title h3");
    const subtitulo = modal?.querySelector(".financeiro-modal-title p");
    if (titulo) titulo.textContent = ehPagamento ? "Registrar pagamento" : "Registrar recebimento";
    if (subtitulo) subtitulo.textContent = ehPagamento ? "Informe os valores efetivamente pagos." : "Informe os valores efetivamente recebidos do cliente.";
    const dataLabel = form.querySelector('[name="data_pagamento"]')?.closest(".financeiro-field")?.querySelector("label");
    const formaLabel = formaSelect?.closest(".financeiro-field")?.querySelector("label");
    const totalLabel = form.querySelector('[name="valor_total_baixa"]')?.closest(".financeiro-field")?.querySelector("label");
    const comprovanteLabel = form.querySelector('[name="comprovante"]')?.closest(".financeiro-field")?.querySelector("label");
    if (dataLabel) dataLabel.textContent = ehPagamento ? "Data do pagamento" : "Data do recebimento";
    if (formaLabel) formaLabel.textContent = ehPagamento ? "Forma de pagamento" : "Forma de recebimento";
    if (totalLabel) totalLabel.textContent = ehPagamento ? "Total a debitar" : "Total a creditar";
    if (comprovanteLabel) comprovanteLabel.textContent = ehPagamento ? "Comprovante de pagamento (PDF, até 10 MB)" : "Comprovante de recebimento (PDF, até 10 MB)";
    abrirModal("#modal-baixa");
    atualizarCalculoBaixa();
  }

  function limparPayloadLancamento(data) {
    return {
      id: data.id || undefined,
      tipo: data.tipo,
      moeda: moedaValida(data.moeda || "BRL"),
      descricao: data.descricao,
      valor_total: moneyToBackend(data.valor_total),
      valor_pago: moneyToBackend(data.valor_pago || 0),
      data_emissao: data.data_emissao || todayISO(),
      data_vencimento: data.data_vencimento,
      data_pagamento: data.data_pagamento || null,
      status: data.status || "aberto",
      cliente_id: nullNumber(data.cliente_id),
      fornecedor_id: nullNumber(data.fornecedor_id),
      categoria_id: nullNumber(data.categoria_id),
      forma_pagamento_id: nullNumber(data.forma_pagamento_id),
      conta_banco_id: nullNumber(data.conta_banco_id),
      tipo_documento_id: nullNumber(data.tipo_documento_id),
      natureza_operacao_id: nullNumber(data.natureza_operacao_id),
      tipo_gasto_id: nullNumber(data.tipo_gasto_id),
      centro_custo_principal_id: nullNumber(data.centro_custo_principal_id),
      centro_custo_secundario_id: nullNumber(data.centro_custo_secundario_id),
      unidade_consumo_principal_id: nullNumber(data.unidade_consumo_principal_id),
      unidade_consumo_secundaria_id: nullNumber(data.unidade_consumo_secundaria_id),
      conta_contabil_id: nullNumber(data.conta_contabil_id),
      forma_cobranca_id: nullNumber(data.forma_cobranca_id),
      regra_encargos_id: nullNumber(data.regra_encargos_id),
      regua_cobranca_id: nullNumber(data.regua_cobranca_id),
      entidade_emissora_id: nullNumber(data.entidade_emissora_id),
      possui_multa: data.possui_multa === "true",
      indice_multa_percent: moneyToBackend(data.indice_multa_percent || 0),
      possui_mora_diaria: data.possui_mora_diaria === "true",
      indice_mora_diaria_percent: moneyToBackend(data.indice_mora_diaria_percent || 0),
      documento: data.documento || null,
      observacoes: data.observacoes || null,
      contato_cobranca: data.contato_cobranca || null,
      email_cobranca: data.email_cobranca || null,
      whatsapp_cobranca: data.whatsapp_cobranca || null,
      modalidade_pagamento: data.modalidade_pagamento || null,
      nota_fiscal_numero: data.nota_fiscal_numero || null,
      nota_fiscal_data_emissao: data.nota_fiscal_data_emissao || null,
      parcelado: data.parcelado === "true",
      parcela_numero: nullNumber(data.parcela_numero),
      parcela_total: nullNumber(data.parcela_total),
      parcelas_gerar: Math.max(1, Number(data.parcelas_gerar || 1)),
      intervalo_parcelas_meses: Math.max(1, Number(data.intervalo_parcelas_meses || 1)),
      modo_parcelamento: data.modo_parcelamento || "dividir_total",
    };
  }

  function abrirAux(tipo, item = null) {
    const form = $("#form-auxiliar");
    const body = $("#modal-auxiliar-body");
    if (!form || !body) return;
    form.reset();
    form.dataset.tipo = tipo;
    form.dataset.id = item?.id || "";
    const titulos = {
      categoria: "Categoria financeira", forma: "Forma de pagamento", conta: "Conta/Banco",
      "tipo-documento": "Tipo de documento", natureza: "Natureza da operação", "tipo-gasto": "Tipo de gasto",
      "centro-custo": "Centro de custo", "unidade-consumo": "Unidade de consumo",
      "conta-contabil": "Conta contábil", "forma-cobranca": "Forma de cobrança",
      "regra-encargos": "Regra de multa e mora",
    };
    const titulo = titulos[tipo] || "Cadastro financeiro";
    $("#modal-auxiliar-titulo").textContent = item ? `Editar ${titulo}` : `Novo: ${titulo}`;

    const status = '<div class="financeiro-field"><label>Status</label><select name="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div>';
    const aplicacao = '<div class="financeiro-field"><label>Aplicação</label><select name="aplicacao"><option value="ambos">Pagar e receber</option><option value="pagar">Contas a pagar</option><option value="receber">Contas a receber</option></select></div>';
    if (tipo === "categoria") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><select name="tipo"><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="ambos">Ambos</option></select></div><div class="financeiro-field"><label>Cor</label><input name="cor" placeholder="#65ACDE"></div>${status}</div>`;
    } else if (tipo === "forma") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><input name="tipo" placeholder="pix, boleto, cartão..."></div>${status}</div>`;
    } else if (tipo === "conta") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Banco</label><input name="banco"></div><div class="financeiro-field"><label>Agência</label><input name="agencia"></div><div class="financeiro-field"><label>Conta</label><input name="conta"></div><div class="financeiro-field"><label>Saldo inicial</label><input name="saldo_inicial" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off" placeholder="R$ 0,00"></div><div class="financeiro-field"><label>Data do saldo inicial</label><input name="data_saldo_inicial" type="date" value="${todayISO()}" required></div>${status}</div>`;
    } else if (tipo === "tipo-documento") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div>${aplicacao}<div class="financeiro-field"><label>Exige banco/entidade emissora?</label><select name="exige_entidade_emissora"><option value="false">Não</option><option value="true">Sim</option></select></div>${status}</div>`;
    } else if (tipo === "natureza") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div>${aplicacao}${status}</div>`;
    } else if (tipo === "tipo-gasto") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40" placeholder="Ex.: CUSTO"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required placeholder="Ex.: Custo, Despesa, Investimento"></div>${status}</div>`;
    } else if (tipo === "centro-custo") {
      const centrosCarregados = state.auxItems.filter(i => i._auxType === "centro-custo");
      const pais = (centrosCarregados.length ? centrosCarregados : (state.opcoes.centros_custo || [])).filter(i => Number(i.id) !== Number(item?.id));
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Centro principal/pai</label><select name="centro_pai_id"><option value="">Nenhum — centro principal</option>${pais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("")}</select></div>${status}</div>`;
    } else if (tipo === "unidade-consumo") {
      const unidadesCarregadas = state.auxItems.filter(i => i._auxType === "unidade-consumo");
      const pais = (unidadesCarregadas.length ? unidadesCarregadas : (state.opcoes.unidades_consumo || [])).filter(i => Number(i.id) !== Number(item?.id));
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo da unidade</label><select name="tipo_referencia"><option value="departamento">Departamento/área</option><option value="colaborador">Colaborador</option><option value="veiculo">Veículo</option><option value="patrimonio">Patrimônio/ferramenta</option><option value="projeto">Projeto</option><option value="contrato">Contrato</option><option value="cargo">Cargo/função</option><option value="outro">Outro</option></select></div><div class="financeiro-field"><label>Unidade principal/pai</label><select name="unidade_pai_id"><option value="">Nenhuma — unidade principal</option>${pais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("")}</select></div><div class="financeiro-field full"><label>Referência/observação</label><input name="departamento_referencia" placeholder="Opcional: detalhe adicional para identificar o consumo"></div>${status}</div>`;
    } else if (tipo === "conta-contabil") {
      const contasCarregadas = state.auxItems.filter(i => i._auxType === "conta-contabil");
      const pais = (contasCarregadas.length ? contasCarregadas : (state.opcoes.contas_contabeis || [])).filter(i => Number(i.id) !== Number(item?.id));
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" required maxlength="60" placeholder="Ex.: 3.1.01"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><select name="tipo"><option value="ativo">Ativo</option><option value="passivo">Passivo</option><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="patrimonio">Patrimônio</option><option value="outros">Outros</option></select></div><div class="financeiro-field"><label>Conta pai</label><select name="conta_pai_id"><option value="">Nenhuma — conta raiz</option>${pais.map(i => option(`${i.codigo} - ${i.nome}`, i.id)).join("")}</select></div><div class="financeiro-field"><label>Aceita lançamentos?</label><select name="aceita_lancamento"><option value="true">Sim</option><option value="false">Não, apenas agrupadora</option></select></div>${status}</div>`;
    } else if (tipo === "forma-cobranca") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><select name="tipo"><option value="carteira">Em carteira/recibo</option><option value="pix">PIX</option><option value="promissoria">Promissória</option><option value="boleto">Boleto</option><option value="cartao_credito">Cartão de crédito</option><option value="debito_conta">Débito em conta</option><option value="deposito">Depósito</option><option value="outro">Outro</option></select></div>${status}</div>`;
    } else if (tipo === "regra-encargos") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field full"><label>Nome da regra</label><input name="nome" required placeholder="Ex.: Padrão contratos mensais"></div>${aplicacao}<div class="financeiro-field"><label>Regra padrão?</label><select name="padrao"><option value="false">Não</option><option value="true">Sim</option></select></div><div class="financeiro-field"><label>Possui multa?</label><select name="possui_multa"><option value="false">Não</option><option value="true">Sim</option></select></div><div class="financeiro-field"><label>Índice de multa (%)</label><input name="indice_multa_percent" type="number" min="0" max="100" step="0.0001" value="0"></div><div class="financeiro-field"><label>Possui mora diária?</label><select name="possui_mora_diaria"><option value="false">Não</option><option value="true">Sim</option></select></div><div class="financeiro-field"><label>Índice de mora ao dia (%)</label><input name="indice_mora_diaria_percent" type="number" min="0" max="100" step="0.0001" value="0"></div>${status}</div>`;
    } else {
      body.innerHTML = '<div class="financeiro-alert danger">Tipo de cadastro não reconhecido.</div>';
    }
    if (item) setForm(form, { ...item, ativo: String(Boolean(item.ativo)), exige_entidade_emissora: String(Boolean(item.exige_entidade_emissora)), aceita_lancamento: String(item.aceita_lancamento !== false), possui_multa: String(Boolean(item.possui_multa)), possui_mora_diaria: String(Boolean(item.possui_mora_diaria)), padrao: String(Boolean(item.padrao)) });
    atualizarCamposEncargos(form);
    abrirModal("#modal-auxiliar");
  }

  function prepararInterfaceFinanceiro() {
    const tabs = $(".financeiro-tabs");
    if (tabs && !tabs.querySelector('a[href="/cobrancas-financeiro"]')) {
      const receber = tabs.querySelector('a[href="/contas-receber"]');
      const linkCobranca = document.createElement("a");
      linkCobranca.href = "/cobrancas-financeiro";
      linkCobranca.className = state.page === "cobrancas" ? "active" : "";
      linkCobranca.innerHTML = '<i class="fa-regular fa-bell"></i><span>Cobrança</span>';
      if (receber?.nextSibling) tabs.insertBefore(linkCobranca, receber.nextSibling);
      else tabs.appendChild(linkCobranca);
    }
    if (tabs && !tabs.querySelector('a[href="/cadastros-financeiros"]')) {
      const rel = tabs.querySelector('a[href="/relatorios-financeiros"]');
      const link = document.createElement("a");
      link.href = "/cadastros-financeiros";
      link.className = state.page === "cadastros" ? "active" : "";
      link.innerHTML = '<i class="fa-solid fa-sliders"></i><span>Cadastros</span>';
      tabs.insertBefore(link, rel || null);
    }

    const formLancamento = $("#form-lancamento");
    if (formLancamento) {
      const nav = formLancamento.querySelector(".financeiro-ficha-nav");
      if (nav && !nav.querySelector('[data-financeiro-section="fin-sec-classificacao"]')) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.financeiroSection = "fin-sec-classificacao";
        btn.innerHTML = '<i class="fa-solid fa-sitemap"></i><span>Classificação</span>';
        const parcelamentoBtn = nav.querySelector('[data-financeiro-section="fin-sec-parcelamento"]');
        nav.insertBefore(btn, parcelamentoBtn || null);
        btn.addEventListener("click", () => ativarNavegacaoModalLancamento("fin-sec-classificacao"));
      }
      if (nav && !nav.querySelector('[data-financeiro-section="fin-sec-cobranca-cliente"]')) {
        const btnCobranca = document.createElement("button");
        btnCobranca.type = "button";
        btnCobranca.dataset.financeiroSection = "fin-sec-cobranca-cliente";
        btnCobranca.innerHTML = '<i class="fa-solid fa-receipt"></i><span>Cobrança</span>';
        const pagamentoBtn = nav.querySelector('[data-financeiro-section="fin-sec-pagamento"]');
        nav.insertBefore(btnCobranca, pagamentoBtn || null);
        btnCobranca.addEventListener("click", () => ativarNavegacaoModalLancamento("fin-sec-cobranca-cliente"));
      }
      const corpo = formLancamento.querySelector(".financeiro-modal-body--ficha");
      if (corpo && !corpo.querySelector("#fin-sec-classificacao")) {
        const section = document.createElement("section");
        section.className = "financeiro-editor-card";
        section.id = "fin-sec-classificacao";
        section.innerHTML = `
          <div class="financeiro-editor-card-head"><div><h4>Classificação financeira</h4><p>Cadastros padronizados do financeiro. A multa e a mora são calculadas automaticamente no momento da baixa.</p></div><a class="financeiro-inline-link" href="/cadastros-financeiros">Gerenciar cadastros</a></div>
          <div class="financeiro-form-grid cols-3">
            <div class="financeiro-field"><label>Tipo de documento</label><select name="tipo_documento_id" data-select="tipos-documento"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Natureza da operação</label><select name="natureza_operacao_id" data-select="naturezas-operacao"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Tipo de gasto</label><select name="tipo_gasto_id" data-select="tipos-gasto"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Entidade emissora</label><select name="entidade_emissora_id" data-select="entidades-emissoras"><option value="">Selecione banco/conta...</option></select></div>
            <div class="financeiro-field"><label>Centro de custo principal</label><select name="centro_custo_principal_id" data-select="centros-custo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Centro de custo secundário</label><select name="centro_custo_secundario_id" data-select="centros-custo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Conta contábil</label><select name="conta_contabil_id" data-select="contas-contabeis"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Unidade de consumo principal</label><select name="unidade_consumo_principal_id" data-select="unidades-consumo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Unidade de consumo secundária</label><select name="unidade_consumo_secundaria_id" data-select="unidades-consumo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Forma de cobrança</label><select name="forma_cobranca_id" data-select="formas-cobranca"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Régua de cobrança</label><select name="regua_cobranca_id" data-select="reguas-cobranca"><option value="">Padrão da empresa</option></select></div>
            <div class="financeiro-field"><label>Regra de multa e mora</label><select name="regra_encargos_id" data-select="regras-encargos"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Possui multa?</label><select name="possui_multa"><option value="false">Não</option><option value="true">Sim</option></select></div>
            <div class="financeiro-field"><label>Índice de multa (%)</label><input name="indice_multa_percent" type="number" min="0" max="100" step="0.0001" value="0"></div>
            <div class="financeiro-field"><label>Possui mora diária?</label><select name="possui_mora_diaria"><option value="false">Não</option><option value="true">Sim</option></select></div>
            <div class="financeiro-field"><label>Índice de mora diária (%)</label><input name="indice_mora_diaria_percent" type="number" min="0" max="100" step="0.0001" value="0"></div>
          </div>`;
        const parcela = corpo.querySelector("#fin-sec-parcelamento");
        corpo.insertBefore(section, parcela || corpo.querySelector("#fin-sec-observacoes"));
      }
      if (corpo && !corpo.querySelector("#fin-sec-cobranca-cliente")) {
        const sectionCobranca = document.createElement("section");
        sectionCobranca.className = "financeiro-editor-card";
        sectionCobranca.id = "fin-sec-cobranca-cliente";
        sectionCobranca.innerHTML = `
          <div class="financeiro-editor-card-head"><div><h4>Dados de cobrança do cliente</h4><p>O sistema copia os dados atuais do cadastro para este título. Depois disso, o lançamento mantém sua própria cópia.</p></div></div>
          <div class="financeiro-cliente-cobranca-resumo" data-cliente-cobranca-resumo>Selecione um cliente para carregar os dados de cobrança do cadastro.</div>
          <div class="financeiro-form-grid cols-3">
            <div class="financeiro-field"><label>Contato financeiro</label><input name="contato_cobranca" maxlength="160" placeholder="Responsável pela cobrança"></div>
            <div class="financeiro-field"><label>E-mail de cobrança</label><input name="email_cobranca" type="email" maxlength="255" placeholder="financeiro@cliente.com"></div>
            <div class="financeiro-field"><label>WhatsApp de cobrança</label><input name="whatsapp_cobranca" maxlength="40" placeholder="(00) 00000-0000"></div>
            <div class="financeiro-field"><label>Modalidade cadastrada</label><input name="modalidade_pagamento" maxlength="120" placeholder="PIX, boleto, carteira..."></div>
            <div class="financeiro-field"><label>Nota fiscal nº</label><input name="nota_fiscal_numero" maxlength="80" placeholder="Uso de registro"></div>
            <div class="financeiro-field"><label>Data de emissão da NF</label><input name="nota_fiscal_data_emissao" type="date"></div>
          </div>`;
        const pagamento = corpo.querySelector("#fin-sec-pagamento");
        corpo.insertBefore(sectionCobranca, pagamento || corpo.querySelector("#fin-sec-parcelamento"));
      }

      const campoFornecedor = formLancamento.querySelector('[name="fornecedor_id"]')?.closest(".financeiro-field");
      if (campoFornecedor && !formLancamento.querySelector('[data-fornecedor-tipo]')) {
        campoFornecedor.insertAdjacentHTML("afterend", `<div class="financeiro-field"><label>${state.page === "pagar" ? "Tipo do sacado" : "Tipo do fornecedor"}</label><input type="text" data-fornecedor-tipo readonly value="Não informado no cadastro"></div>`);
      }

      const secParcelamento = formLancamento.querySelector("#fin-sec-parcelamento");
      if (secParcelamento && !secParcelamento.dataset.phase4) {
        secParcelamento.dataset.phase4 = "true";
        secParcelamento.innerHTML = `
          <div class="financeiro-editor-card-head">
            <div><h4>Geração de parcelas</h4><p>Crie automaticamente os lançamentos dos meses futuros.</p></div>
          </div>
          <input type="hidden" name="parcela_numero">
          <input type="hidden" name="parcela_total">
          <div class="financeiro-form-grid cols-3">
            <div class="financeiro-field"><label>Gerar parcelas?</label><select name="parcelado"><option value="false">Não</option><option value="true">Sim</option></select></div>
            <div class="financeiro-field"><label>Quantidade de parcelas</label><input name="parcelas_gerar" type="number" min="1" max="120" value="1"></div>
            <div class="financeiro-field"><label>Intervalo</label><select name="intervalo_parcelas_meses"><option value="1">Mensal</option><option value="2">A cada 2 meses</option><option value="3">A cada 3 meses</option><option value="6">Semestral</option><option value="12">Anual</option></select></div>
            <div class="financeiro-field full"><label>Como aplicar o valor informado?</label><select name="modo_parcelamento"><option value="dividir_total">Dividir o valor total entre as parcelas</option><option value="repetir_valor">Repetir o mesmo valor em cada mês</option></select></div>
            <div class="financeiro-parcelamento-info full" data-parcelamento-resumo>Será criado somente um lançamento.</div>
          </div>`;
      }

      const pago = formLancamento.querySelector('[name="valor_pago"]');
      if (pago) {
        pago.readOnly = true;
        pago.setAttribute("aria-readonly", "true");
        const label = pago.closest(".financeiro-field")?.querySelector("label");
        if (label) label.textContent = "Pago/recebido (calculado)";
      }
      const dataPg = formLancamento.querySelector('[name="data_pagamento"]');
      if (dataPg) {
        dataPg.readOnly = true;
        dataPg.setAttribute("aria-readonly", "true");
      }
    }

    const formBaixa = $("#form-baixa");
    if (formBaixa && !formBaixa.dataset.phase4) {
      formBaixa.dataset.phase4 = "true";
      const modalBaixa = formBaixa.closest(".financeiro-modal");
      if (modalBaixa) { modalBaixa.classList.remove("sm"); modalBaixa.classList.add("financeiro-modal-baixa"); }
      const modalBody = $(".financeiro-modal-body", formBaixa);
      if (modalBody) {
        modalBody.innerHTML = `
          <input type="hidden" name="id">
          <div class="financeiro-baixa-resumo" id="financeiro-baixa-resumo"></div>
          <div class="financeiro-form-grid cols-2 financeiro-baixa-grid">
            <div class="financeiro-field"><label>Principal desta baixa</label><input name="valor_principal" class="financeiro-money-input" data-money-input required inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Data do pagamento</label><input name="data_pagamento" type="date" required></div>
            <div class="financeiro-field"><label>Desconto</label><input name="valor_desconto" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Multa</label><input name="valor_multa" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Mora diária acumulada</label><input name="valor_mora" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field financeiro-total-baixa"><label>Total a debitar</label><input name="valor_total_baixa" class="financeiro-money-input" readonly aria-readonly="true"></div>
            <div class="financeiro-field"><label>Forma de pagamento</label><select name="forma_pagamento_id" data-select="formas"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label data-baixa-conta-label>Conta a debitar</label><select name="conta_banco_id" data-select="contas"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field full"><label>Comprovante de pagamento (PDF, até 10 MB)</label><input name="comprovante" type="file" accept="application/pdf,.pdf"><small>O pagamento é salvo primeiro e o comprovante fica vinculado à movimentação.</small></div>
            <div class="financeiro-field full"><label>Observação da baixa</label><textarea name="observacoes" rows="2" placeholder="Opcional"></textarea></div>
          </div>
          <div class="financeiro-baixa-regra" data-baixa-regra>Multa e mora serão calculadas conforme a data e o principal desta baixa.</div>`;
      }
    }

    if (!$("#modal-historico-financeiro")) {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="financeiro-modal-backdrop" id="modal-historico-financeiro" aria-hidden="true">
          <div class="financeiro-modal financeiro-modal-historico">
            <div class="financeiro-modal-head">
              <div class="financeiro-modal-title"><h3 id="historico-financeiro-titulo">Histórico financeiro</h3><p>Baixas, estornos e alterações registradas.</p></div>
              <button class="financeiro-close" type="button" data-close-modal><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="financeiro-modal-body" id="historico-financeiro-conteudo"></div>
            <div class="financeiro-modal-foot"><button class="btn btn-secondary" type="button" data-close-modal>Fechar</button></div>
          </div>
        </div>`);
      $("#modal-historico-financeiro")?.addEventListener("click", ev => {
        if (ev.target.id === "modal-historico-financeiro") fecharModais();
      });
      $$("[data-close-modal]", $("#modal-historico-financeiro")).forEach(btn => btn.addEventListener("click", fecharModais));
    }
  }

  function renderHistorico(data) {
    const host = $("#historico-financeiro-conteudo");
    if (!host) return;
    const lancamento = data.lancamento || {};
    const movimentos = Array.isArray(data.movimentacoes) ? data.movimentacoes : [];
    const auditoria = Array.isArray(data.auditoria) ? data.auditoria : [];
    const saldo = Number(lancamento.valor_total || 0) - Number(lancamento.valor_pago || 0);
    $("#historico-financeiro-titulo").textContent = `Histórico do lançamento #${lancamento.id || "-"}`;

    const movHtml = movimentos.length ? movimentos.map(m => {
      const estorno = String(m.tipo_movimentacao).toLowerCase() === "estorno";
      const podeEstornar = !estorno && !m.estornada;
      const principal = Number(m.valor_principal || m.valor || 0);
      const desconto = Number(m.valor_desconto || 0);
      const multa = Number(m.valor_multa || 0);
      const mora = Number(m.valor_mora || 0);
      const comprovante = m.comprovante_url
        ? `<a class="financeiro-comprovante-link" href="${escapeHtml(m.comprovante_url)}" target="_blank" rel="noopener"><i class="fa-regular fa-file-pdf"></i> ${escapeHtml(m.comprovante_nome || "Abrir comprovante")}</a>`
        : "";
      return `<div class="financeiro-history-item ${estorno ? "is-estorno" : ""}">
        <div class="financeiro-history-icon"><i class="fa-solid ${estorno ? "fa-rotate-left" : "fa-check"}"></i></div>
        <div class="financeiro-history-main">
          <div class="financeiro-history-title"><strong>${estorno ? "Estorno" : (lancamento.tipo === "pagar" ? "Pagamento" : "Recebimento")}</strong><span>${money(m.valor, lancamento.moeda)}</span></div>
          <div class="financeiro-history-meta">${dateBR(m.data_movimentacao)} • ${escapeHtml(m.usuario_nome || "Usuário não identificado")} • ${escapeHtml(m.conta_banco_nome || "Sem conta/banco")} • ${Number(m.dias_atraso || 0)} dia(s) de atraso</div>
          <div class="financeiro-history-breakdown">
            <span>Principal <strong>${money(principal, lancamento.moeda)}</strong></span>
            <span>Desconto <strong>${money(desconto, lancamento.moeda)}</strong></span>
            <span>Multa <strong>${money(multa, lancamento.moeda)}</strong></span>
            <span>Mora <strong>${money(mora, lancamento.moeda)}</strong></span>
          </div>
          ${m.observacoes ? `<div class="financeiro-history-note">${escapeHtml(m.observacoes)}</div>` : ""}
          ${comprovante}
          ${m.estornada ? '<span class="financeiro-history-status">Estornada</span>' : ""}
        </div>
        ${podeEstornar ? `<button class="financeiro-mini-btn warn" type="button" data-action="estornar-movimentacao" data-id="${m.id}" data-lancamento-id="${lancamento.id}"><i class="fa-solid fa-rotate-left"></i> Estornar</button>` : ""}
      </div>`;
    }).join("") : '<div class="financeiro-empty-soft">Nenhuma baixa registrada.</div>';

    const auditHtml = auditoria.length ? auditoria.map(a => `<div class="financeiro-audit-item">
      <strong>${escapeHtml(String(a.acao || "ação").replaceAll("_", " "))}</strong>
      <span>${escapeHtml(a.usuario_nome || "Usuário não identificado")} • ${dateTimeBR(a.criado_em)}</span>
      ${a.motivo ? `<small>${escapeHtml(a.motivo)}</small>` : ""}
    </div>`).join("") : '<div class="financeiro-empty-soft">Nenhuma alteração registrada.</div>';

    host.innerHTML = `
      <div class="financeiro-history-summary">
        <div><span>Total</span><strong>${money(lancamento.valor_total, lancamento.moeda)}</strong></div>
        <div><span>Baixado</span><strong>${money(lancamento.valor_pago, lancamento.moeda)}</strong></div>
        <div><span>Saldo aberto</span><strong>${money(Math.max(0, saldo), lancamento.moeda)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(lancamento.status || "-")}</strong></div>
      </div>
      <section class="financeiro-history-section"><h4>Movimentações</h4>${movHtml}</section>
      <section class="financeiro-history-section"><h4>Auditoria</h4><div class="financeiro-audit-list">${auditHtml}</div></section>`;
  }

  async function abrirHistorico(lancamentoId) {
    state.historicoLancamentoId = Number(lancamentoId);
    prepararInterfaceFinanceiro();
    const host = $("#historico-financeiro-conteudo");
    if (host) host.innerHTML = '<div class="financeiro-empty-soft">Carregando histórico...</div>';
    abrirModal("#modal-historico-financeiro");
    try {
      const data = await request(`/api/financeiro/lancamentos/${lancamentoId}/historico`);
      renderHistorico(data);
    } catch (err) {
      if (host) host.innerHTML = `<div class="financeiro-alert danger">${escapeHtml(err.message)}</div>`;
    }
  }

  async function salvarLancamento(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const tipo = form.querySelector('[name="tipo"]')?.value || "";
    const sacado = elementosSacado(form);
    if (tipo === "pagar" && sacado && !String(sacado.hidden.value || "").trim()) {
      sacado.search.setCustomValidity("Selecione o sacado na lista de resultados.");
      ativarNavegacaoModalLancamento("fin-sec-envolvidos");
      sacado.search.reportValidity();
      sacado.search.focus();
      return;
    }
    const payload = limparPayloadLancamento(getForm(form));
    const id = payload.id;
    delete payload.id;
    if (id) {
      // Em edição, estes campos são metadados estruturais da criação.
      // O backend também os preserva para impedir perda de recorrência/parcelamento.
      delete payload.parcelas_gerar;
      delete payload.intervalo_parcelas_meses;
      delete payload.modo_parcelamento;
    }
    try {
      const resultado = id
        ? await request(`/api/financeiro/lancamentos/${id}`, { method: "PUT", body: payload })
        : await request("/api/financeiro/lancamentos", { method: "POST", body: payload });
      fecharModais();
      const quantidade = Number(resultado?.quantidade || 1);
      alertBox(quantidade > 1 ? `${quantidade} parcelas criadas com sucesso.` : "Lançamento salvo com sucesso.", "ok");
      await recarregar();
    } catch (err) {
      alertBox(`Erro ao salvar: ${err.message}`, "danger");
    }
  }

  async function salvarBaixa(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = getForm(form);
    const arquivo = form.querySelector('[name="comprovante"]')?.files?.[0] || null;
    if (arquivo) {
      const nome = String(arquivo.name || "").toLowerCase();
      if (arquivo.type !== "application/pdf" && !nome.endsWith(".pdf")) {
        return alertBox("O comprovante precisa ser um arquivo PDF.", "danger");
      }
      if (arquivo.size > 10 * 1024 * 1024) {
        return alertBox("O comprovante deve ter no máximo 10 MB.", "danger");
      }
    }
    try {
      const resultado = await request(`/api/financeiro/lancamentos/${data.id}/baixar`, { method: "PATCH", body: {
        valor_principal: moneyToBackend(data.valor_principal),
        valor_desconto: moneyToBackend(data.valor_desconto || 0),
        valor_multa: moneyToBackend(data.valor_multa || 0),
        valor_mora: moneyToBackend(data.valor_mora || 0),
        usar_calculo_automatico: false,
        data_pagamento: data.data_pagamento,
        forma_pagamento_id: nullNumber(data.forma_pagamento_id),
        conta_banco_id: nullNumber(data.conta_banco_id),
        observacoes: data.observacoes || null,
      }});

      let comprovanteErro = null;
      if (arquivo && resultado?.movimentacao_id) {
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        try {
          await request(`/api/financeiro/movimentacoes/${resultado.movimentacao_id}/comprovante`, { method: "POST", body: fd });
        } catch (err) {
          comprovanteErro = err;
        }
      }

      fecharModais();
      state.baixaAtual = null;
      const recebimento = state.baixaAtual?.tipo === "receber";
      const nomeAcao = recebimento ? "Recebimento" : "Pagamento";
      if (comprovanteErro) alertBox(`${nomeAcao} registrado, mas o comprovante não foi anexado: ${comprovanteErro.message}`, "warn");
      else alertBox(arquivo ? `${nomeAcao} e comprovante registrados com sucesso.` : `${nomeAcao} registrado com sucesso.`, "ok");
      await recarregar();
    } catch (err) {
      alertBox(`Erro ao baixar: ${err.message}`, "danger");
    }
  }

  async function salvarAuxiliar(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const tipo = form.dataset.tipo;
    const id = form.dataset.id;
    const data = getForm(form);
    ["ativo", "exige_entidade_emissora", "aceita_lancamento", "possui_multa", "possui_mora_diaria", "padrao"].forEach(k => {
      if (Object.prototype.hasOwnProperty.call(data, k)) data[k] = data[k] === "true";
    });
    ["centro_pai_id", "conta_pai_id", "unidade_pai_id"].forEach(k => {
      if (Object.prototype.hasOwnProperty.call(data, k)) data[k] = nullNumber(data[k]);
    });
    if (tipo === "conta") {
      data.saldo_inicial = moneyToBackend(data.saldo_inicial || 0);
      data.data_saldo_inicial = data.data_saldo_inicial || todayISO();
    }
    const endpoint = endpointAux(tipo);
    if (!endpoint) return alertBox("Cadastro financeiro inválido.", "danger");
    try {
      await request(id ? `${endpoint}/${id}` : endpoint, { method: id ? "PUT" : "POST", body: data });
      fecharModais();
      alertBox("Cadastro salvo com sucesso.", "ok");
      await recarregar();
    } catch (err) {
      alertBox(`Erro ao salvar cadastro: ${err.message}`, "danger");
    }
  }

  async function actionClick(ev) {
    const btn = ev.target.closest("[data-action]");
    if (!btn || btn.disabled) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;
    const tipoAux = btn.dataset.tipo || "";
    const item = state.items.find(i => Number(i.id) === id) || state.auxItems.find(i => Number(i.id) === id && (!tipoAux || i._auxType === tipoAux));

    try {
      if (action === "editar-lancamento" && item) abrirLancamento(item.tipo, item);
      if (action === "baixar-lancamento" && item) abrirBaixa(item);
      if (action === "historico-lancamento") await abrirHistorico(id);
      if (action === "estornar-movimentacao") {
        const motivo = prompt("Informe o motivo do estorno:");
        if (!motivo?.trim()) return;
        await request(`/api/financeiro/movimentacoes/${id}/estornar`, { method: "PATCH", body: { motivo: motivo.trim() } });
        alertBox("Estorno registrado com sucesso.", "ok");
        await recarregar();
        await abrirHistorico(Number(btn.dataset.lancamentoId));
      }
      if (action === "cancelar-lancamento") {
        const motivo = prompt("Informe o motivo do cancelamento:");
        if (!motivo?.trim()) return;
        await request(`/api/financeiro/lancamentos/${id}/cancelar`, { method: "PATCH", body: { motivo: motivo.trim() } });
        alertBox("Lançamento cancelado.", "ok");
        await recarregar();
      }
      if (action === "excluir-lancamento") {
        if (!confirm("Excluir definitivamente este lançamento sem movimentações?")) return;
        await request(`/api/financeiro/lancamentos/${id}`, { method: "DELETE" });
        alertBox("Lançamento excluído.", "ok");
        await recarregar();
      }
      if (action === "editar-regua-cobranca") {
        const regua = state.cobranca.reguas.find(i => Number(i.id) === id);
        if (regua) abrirReguaCobranca(regua);
      }
      if (action === "selecionar-regua-cobranca") {
        state.cobranca.reguaSelecionadaId = id;
        const select = $("#cobranca-regua-etapas");
        if (select) select.value = String(id);
        await carregarEtapasCobranca(id);
        $("#painel-cobranca-etapas")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "excluir-regua-cobranca") {
        if (!confirm("Excluir esta régua de cobrança? Os títulos vinculados passarão a usar a régua padrão.")) return;
        await request(`/api/financeiro/reguas-cobranca/${id}`, { method: "DELETE" });
        state.cobranca.reguaSelecionadaId = null;
        await recarregar();
      }
      if (action === "editar-etapa-cobranca") {
        const etapa = state.cobranca.etapas.find(i => Number(i.id) === id);
        if (etapa) abrirEtapaCobranca(etapa);
      }
      if (action === "excluir-etapa-cobranca") {
        if (!confirm("Excluir esta etapa da régua?")) return;
        await request(`/api/financeiro/reguas-cobranca/etapas/${id}`, { method: "DELETE" });
        await recarregar();
      }
      if (action === "marcar-cobranca-enviada") {
        const atualizado = await request(`/api/financeiro/cobrancas/envios/${id}`, { method: "PATCH", body: { status: "enviado" } });
        if (atualizado?.auto_ignorado) alertBox(atualizado.motivo || "Cobrança ignorada porque o título já foi quitado ou cancelado.", "warn");
        else alertBox("Cobrança marcada como enviada.", "ok");
        await recarregar();
      }
      if (action === "ignorar-cobranca") {
        await request(`/api/financeiro/cobrancas/envios/${id}`, { method: "PATCH", body: { status: "ignorado" } });
        await recarregar();
      }
      if (action === "copiar-cobranca-mensagem") {
        const envio = state.cobranca.fila.find(i => Number(i.id) === id);
        if (!envio?.mensagem) return alertBox("Esta etapa ainda não possui mensagem configurada.", "warn");
        await navigator.clipboard.writeText(envio.mensagem);
        alertBox("Mensagem copiada.", "ok");
      }
      if (action === "abrir-cobranca-zapschat") {
        const envio = state.cobranca.fila.find(i => Number(i.id) === id);
        if (!envio?.cliente_id) return;
        const destino = await request(`/api/integracoes/zapschat/abrir-cliente/${envio.cliente_id}`);
        if (destino?.url) window.open(destino.url, "_blank", "noopener");
      }
      if (action === "editar-aux" && item) abrirAux(btn.dataset.tipo, item);
      if (action === "excluir-aux") {
        if (!confirm("Excluir este cadastro?")) return;
        const endpoint = endpointAux(btn.dataset.tipo);
        if (!endpoint) throw new Error("Cadastro financeiro inválido.");
        await request(`${endpoint}/${id}`, { method: "DELETE" });
        await recarregar();
      }
    } catch (err) {
      alertBox(`Erro: ${err.message}`, "danger");
    }
  }

  function exportarTabela() {
    const table = $("#financeiro-table");
    if (!table) return;
    const rows = $$('tr', table).map(tr => $$('th,td', tr).map(td => `"${td.innerText.replace(/"/g, '""').trim()}"`).join(";"));
    const blob = new Blob(["\ufeff" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `valora-financeiro-${state.page}-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function bind() {
    prepararInterfaceFinanceiro();
    document.addEventListener("click", actionClick);
    $$('[data-close-modal]').forEach(btn => btn.addEventListener("click", fecharModais));
    $$(".financeiro-modal-backdrop").forEach(back => back.addEventListener("click", ev => { if (ev.target === back) fecharModais(); }));

    $$(".financeiro-ficha-nav button").forEach(btn => {
      btn.addEventListener("click", () => ativarNavegacaoModalLancamento(btn.dataset.financeiroSection));
    });
    $$(".btn-novo-registro").forEach(btn => btn.addEventListener("click", () => {
      const type = btn.dataset.new;
      if (endpointAux(type)) return abrirAux(type);
      return abrirLancamento(type || "");
    }));
    $("#btn-toggle-filtros")?.addEventListener("click", () => $("#financeiro-filtros")?.classList.toggle("is-open"));
    $("#btn-aplicar-filtros")?.addEventListener("click", recarregar);
    $("#btn-limpar-filtros")?.addEventListener("click", () => {
      ["#filtro-busca", "#filtro-status", "#filtro-data-inicio", "#filtro-data-fim", "#filtro-cliente", "#filtro-fornecedor", "#filtro-forma-cobranca", "#filtro-forma-pagamento", "#filtro-categoria"].forEach(sel => { const el = $(sel); if (el) el.value = ""; });
      recarregar();
    });
    $("#btn-exportar-financeiro")?.addEventListener("click", exportarTabela);
    $("#form-lancamento")?.addEventListener("submit", salvarLancamento);
    $("#form-baixa")?.addEventListener("submit", salvarBaixa);
    $("#form-auxiliar")?.addEventListener("submit", salvarAuxiliar);
    $("#form-regua-cobranca")?.addEventListener("submit", salvarReguaCobranca);
    $("#form-etapa-cobranca")?.addEventListener("submit", salvarEtapaCobranca);
    $("#btn-nova-regua-cobranca")?.addEventListener("click", () => abrirReguaCobranca());
    $("#btn-nova-etapa-cobranca")?.addEventListener("click", () => abrirEtapaCobranca(null, $("#cobranca-regua-etapas")?.value));
    $("#btn-processar-cobrancas")?.addEventListener("click", async () => {
      try {
        const r = await request("/api/financeiro/cobrancas/processar", { method: "POST" });
        alertBox(r?.novos ? `${r.novos} nova(s) cobrança(s) adicionada(s) à fila.` : "Fila já está atualizada.", "ok");
        await recarregar();
      } catch (err) { alertBox(`Erro ao processar cobrança: ${err.message}`, "danger"); }
    });
    $("#cobranca-regua-etapas")?.addEventListener("change", ev => carregarEtapasCobranca(ev.currentTarget.value));
    $("#btn-aplicar-cobranca-filtros")?.addEventListener("click", recarregar);

    document.addEventListener("input", (ev) => {
      const sacadoSearch = ev.target.closest("[data-sacado-search]");
      if (sacadoSearch) {
        const form = sacadoSearch.closest("#form-lancamento");
        const els = elementosSacado(form);
        if (!els) return;
        const valorAtual = String(sacadoSearch.value || "");
        if (sacadoSearch.dataset.selectedId && valorAtual !== String(sacadoSearch.dataset.selectedLabel || "")) {
          state.sacadoLookup.selecionado = null;
          els.hidden.value = "";
          sacadoSearch.dataset.selectedId = "";
          sacadoSearch.dataset.selectedLabel = "";
          els.clear.hidden = true;
          els.hidden.dispatchEvent(new Event("change", { bubbles: true }));
        }
        sacadoSearch.setCustomValidity("");
        agendarBuscaSacado(form, valorAtual);
        return;
      }

      const input = ev.target.closest("[data-money-input]");
      if (!input) return;
      const cursor = input.selectionStart;
      const clean = sanitizeMoneyInput(input.value);
      if (input.value !== clean) {
        input.value = clean;
        try { input.setSelectionRange(Math.min(cursor, clean.length), Math.min(cursor, clean.length)); } catch (_) {}
      }
      if (input.closest("#form-baixa") && ["valor_principal", "valor_desconto", "valor_multa", "valor_mora"].includes(input.name)) {
        recalcularTotalBaixaLocal();
      }
    });

    document.addEventListener("focusin", (ev) => {
      const sacadoSearch = ev.target.closest("[data-sacado-search]");
      if (!sacadoSearch) return;
      const form = sacadoSearch.closest("#form-lancamento");
      if (sacadoSearch.dataset.selectedId) return;
      const termo = String(sacadoSearch.value || "").trim();
      if (termo.length >= 2) agendarBuscaSacado(form, termo);
      else renderResultadosSacado(form, [], "Digite pelo menos 2 caracteres para procurar o sacado.");
    });

    document.addEventListener("keydown", (ev) => {
      const sacadoSearch = ev.target.closest("[data-sacado-search]");
      if (!sacadoSearch) return;
      const form = sacadoSearch.closest("#form-lancamento");
      if (ev.key === "Escape") {
        fecharResultadosSacado(form);
        return;
      }
      if (ev.key === "Enter") {
        const els = elementosSacado(form);
        const primeiro = els?.results?.querySelector("[data-sacado-option]");
        if (!primeiro || els.results.hidden) return;
        ev.preventDefault();
        const item = state.sacadoLookup.items[Number(primeiro.dataset.sacadoOption)];
        if (item) selecionarSacado(form, item, true);
      }
    });

    document.addEventListener("click", (ev) => {
      const optionBtn = ev.target.closest("[data-sacado-option]");
      if (optionBtn) {
        const form = optionBtn.closest("#form-lancamento");
        const item = state.sacadoLookup.items[Number(optionBtn.dataset.sacadoOption)];
        if (item) selecionarSacado(form, item, true);
        return;
      }

      const clearBtn = ev.target.closest("[data-sacado-clear]");
      if (clearBtn) {
        const form = clearBtn.closest("#form-lancamento");
        selecionarSacado(form, null, true);
        const els = elementosSacado(form);
        els?.search?.focus();
        renderResultadosSacado(form, [], "Digite pelo menos 2 caracteres para procurar o sacado.");
        return;
      }

      if (!ev.target.closest("[data-sacado-lookup]")) fecharResultadosSacado();
    });

    document.addEventListener("blur", (ev) => {
      const input = ev.target.closest("[data-money-input]");
      if (!input) return;
      const form = input.closest("form");
      const moeda = form?.id === "form-baixa" ? (state.baixaAtual?.moeda || "BRL") : (form?.querySelector('[name="moeda"]')?.value || "BRL");
      input.value = formatMoneyForInput(input.value, moeda);
      if (form?.id === "form-baixa" && input.name === "valor_principal") atualizarCalculoBaixa();
    }, true);

    document.addEventListener("change", (ev) => {
      const formLancamento = ev.target.closest("#form-lancamento");
      if (formLancamento && ev.target.matches('[name="tipo"]')) {
        filtrarOpcoesPorTipoLancamento(formLancamento, ev.target.value);
        configurarFormularioPorTipo(formLancamento, ev.target.value);
        atualizarExigenciaEntidadeEmissora(formLancamento);
        atualizarCampoStatusLancamento(formLancamento);
        return;
      }
      if (formLancamento && ev.target.matches('[name="data_vencimento"], [name="valor_total"]')) {
        atualizarCampoStatusLancamento(formLancamento);
        return;
      }
      if (formLancamento && ev.target.matches('[name="tipo_documento_id"]')) {
        atualizarExigenciaEntidadeEmissora(formLancamento);
        return;
      }
      if (formLancamento && ev.target.matches('[name="cliente_id"]')) {
        atualizarDadosCobrancaCliente(formLancamento, true);
        return;
      }
      if (formLancamento && ev.target.matches('[name="fornecedor_id"]')) {
        atualizarTipoFornecedor(formLancamento);
        return;
      }
      if (formLancamento && ev.target.matches('[name="parcelado"], [name="parcelas_gerar"], [name="intervalo_parcelas_meses"], [name="modo_parcelamento"]')) {
        atualizarCamposParcelamento(formLancamento);
        return;
      }
      if (ev.target.closest("#form-baixa") && ev.target.matches('[name="data_pagamento"]')) {
        atualizarCalculoBaixa();
        return;
      }
      const regra = ev.target.closest('[name="regra_encargos_id"]');
      if (regra) { aplicarRegraEncargos(regra.closest("form"), true); return; }
      if (ev.target.matches('[name="possui_multa"], [name="possui_mora_diaria"]')) {
        atualizarCamposEncargos(ev.target.closest("form"));
        return;
      }
      const select = ev.target.closest('[name="moeda"]');
      if (!select) return;
      const form = select.closest("form");
      form?.querySelectorAll('[data-money-input]').forEach(input => {
        if (input.value.trim()) input.value = formatMoneyForInput(input.value, select.value);
        input.placeholder = `${currencySymbol(select.value)} 0,00`;
      });
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bind();
    await recarregar();
  });
})();
