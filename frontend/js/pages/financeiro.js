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
    baixaIdempotencyKey: null,
    estornoAtual: null,
    receberSelecionadoId: null,
    receberTab: "registros",
    pagarSelecionadoId: null,
    pagarTab: "registros",
    receberConciliacao: [],
    boletoAtual: null,
    boletoAtualId: null,
    caixa: { tab: "registros", registros: [], saldos: [], resumo: [] },
    cobranca: {
      reguas: [], etapas: [], fila: [], reguaSelecionadaId: null,
      emissaoTitulos: [], emissaoSelecionados: new Set(), emissoesLotes: [], automacao: null,
      zapschat: { config: null, instancias: [], busy: false },
    },
    sacadoLookup: {
      items: [],
      selecionado: null,
      timer: null,
      controller: null,
      requestId: 0,
    },
    envolvidoLookups: {
      cliente: { items: [], timer: null, controller: null, requestId: 0 },
      fornecedor: { items: [], timer: null, controller: null, requestId: 0 },
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

  const novaChaveBaixa = () => {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `baixa-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
  };

  const monthStartISO = () => {
    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, "0");
    return `${ano}-${mes}-01`;
  };

  const addMonthsISO = (isoDate, months = 1) => {
    const base = /^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || "")) ? String(isoDate) : todayISO();
    const [ano, mes, dia] = base.split("-").map(Number);
    const primeiro = new Date(ano, (mes - 1) + Number(months || 0), 1);
    const ultimoDia = new Date(primeiro.getFullYear(), primeiro.getMonth() + 1, 0).getDate();
    const data = new Date(primeiro.getFullYear(), primeiro.getMonth(), Math.min(dia, ultimoDia));
    const a = data.getFullYear();
    const m = String(data.getMonth() + 1).padStart(2, "0");
    const d = String(data.getDate()).padStart(2, "0");
    return `${a}-${m}-${d}`;
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

  const formatPhoneBRDisplay = (value) => {
    let digits = String(value || "").replace(/\D+/g, "");
    if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
    if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return String(value || "").trim() || "Número não informado";
  };

  const escapeHtml = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  const statusClass = (status) => {
    const s = String(status || "").toLowerCase();
    if (["recebido", "pago", "quitado", "ativo", "receita", "enviado"].includes(s)) return "ok";
    if (["vencido", "cancelado", "inativo", "despesa", "erro"].includes(s)) return "danger";
    if (["parcial", "aberto", "ambos", "ignorado"].includes(s)) return "warn";
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

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
    } catch (_) { return "#"; }
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
    const tbody = tbodyId ? $(`#${tbodyId}`) : $(".financeiro-table tbody");
    if (!tbody) return;
    tbody.innerHTML = html || `<tr><td class="financeiro-empty" colspan="${cols}">${emptyText || "Nenhum registro encontrado."}</td></tr>`;
  }

  function parceiroNome(item) {
    return item.cliente_nome || item.fornecedor_nome || "-";
  }

  function acoesLancamento(item) {
    const status = String(item.status_calculado || item.status || "").toLowerCase();
    const finalizado = ["recebido", "pago", "cancelado"].includes(status);
    const reparcelamentoAtivo = Boolean(item.reparcelamento_ativo);
    const boleto = item.tipo === "receber"
      ? `<button class="financeiro-mini-btn" type="button" data-action="boleto-titulo" data-id="${item.id}" ${(!item.cobranca_provider_payment_id && finalizado) ? "disabled" : ""}><i class="fa-solid fa-barcode"></i> Boleto</button>`
      : "";
    return `<div class="actions-cell">
      <button class="financeiro-mini-btn" type="button" data-action="${item.tipo === "pagar" ? "detalhes-pagar" : "detalhes-receber"}" data-id="${item.id}"><i class="fa-regular fa-file-lines"></i> Detalhes</button>
      ${boleto}
      <button class="financeiro-mini-btn" type="button" data-action="editar-lancamento" data-id="${item.id}" ${reparcelamentoAtivo ? 'disabled title="Conta original de um reparcelamento ativo"' : ""}><i class="fa-regular fa-pen-to-square"></i> Editar</button>
      <button class="financeiro-mini-btn ok" type="button" data-action="baixar-lancamento" data-id="${item.id}" ${finalizado ? "disabled" : ""}><i class="fa-solid fa-check"></i> Baixar</button>
      <button class="financeiro-mini-btn" type="button" data-action="historico-lancamento" data-id="${item.id}"><i class="fa-solid fa-clock-rotate-left"></i> Histórico</button>
      <button class="financeiro-mini-btn warn" type="button" data-action="cancelar-lancamento" data-id="${item.id}" ${status === "cancelado" ? "disabled" : ""} title="Cancelar"><i class="fa-solid fa-ban"></i></button>
      <button class="financeiro-mini-btn danger" type="button" data-action="excluir-lancamento" data-id="${item.id}" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
    </div>`;
  }

  function acoesPagarCompactas(item) {
    const status = String(item.status_calculado || item.status || "").toLowerCase();
    const finalizado = ["pago", "cancelado"].includes(status);
    const reparcelamentoAtivo = Boolean(item.reparcelamento_ativo);
    return `<div class="actions-cell financeiro-pagar-actions">
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn ok" type="button" data-action="baixar-lancamento" data-id="${item.id}" ${finalizado ? "disabled" : ""} title="Baixar pagamento" aria-label="Baixar pagamento"><i class="fa-solid fa-check"></i></button>
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn" type="button" data-action="editar-lancamento" data-id="${item.id}" ${reparcelamentoAtivo ? 'disabled title="Conta original de um reparcelamento ativo"' : 'title="Editar"'} aria-label="Editar"><i class="fa-regular fa-pen-to-square"></i></button>
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn" type="button" data-action="detalhes-pagar" data-id="${item.id}" title="Detalhes" aria-label="Detalhes"><i class="fa-regular fa-file-lines"></i></button>
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn" type="button" data-action="historico-lancamento" data-id="${item.id}" title="Histórico" aria-label="Histórico"><i class="fa-solid fa-clock-rotate-left"></i></button>
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn warn" type="button" data-action="cancelar-lancamento" data-id="${item.id}" ${status === "cancelado" ? "disabled" : ""} title="Cancelar" aria-label="Cancelar"><i class="fa-solid fa-ban"></i></button>
      <button class="financeiro-mini-btn financeiro-pagar-icon-btn danger" type="button" data-action="excluir-lancamento" data-id="${item.id}" title="Excluir" aria-label="Excluir"><i class="fa-regular fa-trash-can"></i></button>
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
      const statusEfetivo = String(item.status_calculado || item.status || "aberto").toLowerCase();
      const plano = item.conta_contabil_codigo && item.conta_contabil_nome
        ? `${item.conta_contabil_codigo} - ${item.conta_contabil_nome}`
        : (item.conta_contabil_nome || "-");
      const centro = [item.centro_custo_principal_nome, item.centro_custo_secundario_nome].filter(Boolean).join(" / ") || "-";
      const parcelaTexto = item.parcelado && item.parcela_total ? `${Number(item.parcela_numero || 1)}/${Number(item.parcela_total)}` : "-";
      const selecionado = Number(state.pagarSelecionadoId) === Number(item.id);
      return `<tr class="financeiro-pagar-row ${selecionado ? "is-selected" : ""}" data-pagar-row-id="${item.id}">
        <td><strong>${item.id}</strong></td>
        <td>${pill(statusEfetivo === "pago" ? "quitado" : statusEfetivo)}</td>
        <td>${dateBR(item.data_vencimento)}</td>
        <td><span class="financeiro-pagar-fornecedor" title="${escapeHtml(parceiro || "-")}"><strong>${escapeHtml(parceiro || "-")}</strong></span></td>
        <td><span class="financeiro-cell-wrap financeiro-cell-ellipsis" title="${escapeHtml(plano)}">${escapeHtml(plano)}</span></td>
        <td><span class="financeiro-cell-wrap financeiro-cell-ellipsis" title="${escapeHtml(centro)}">${escapeHtml(centro)}</span></td>
        <td><span class="financeiro-pagar-documento" title="${escapeHtml(item.documento || "-")}">${escapeHtml(item.documento || "-")}</span></td>
        <td class="financeiro-amount"><strong>${money(item.valor_total, item.moeda)}</strong></td>
        <td class="financeiro-amount">${money(item.valor_pago, item.moeda)}</td>
        <td>${dateBR(item.data_pagamento)}</td>
        <td>${escapeHtml(parcelaTexto)}</td>
        <td>${acoesPagarCompactas(item)}</td>
      </tr>`;
    }
    const statusEfetivo = String(item.status_calculado || item.status || "aberto").toLowerCase();
    const cobranca = item.forma_cobranca_nome || item.modalidade_pagamento || item.forma_pagamento_nome || "-";
    const quitado = statusEfetivo === "recebido";
    const selecionado = Number(state.receberSelecionadoId) === Number(item.id);
    return `<tr class="financeiro-receber-row ${selecionado ? "is-selected" : ""}" data-receber-row-id="${item.id}">
      <td><strong>${item.id}</strong></td>
      <td>${pill(statusEfetivo === "recebido" ? "quitado" : statusEfetivo)}</td>
      <td>${dateBR(item.data_emissao)}</td>
      <td>${dateBR(item.data_vencimento)}</td>
      <td>${escapeHtml(item.documento || "-")}</td>
      <td><strong>${escapeHtml(parceiro || "-")}</strong>${item.parceiro_comercial ? `<small>Comercial: ${escapeHtml(item.parceiro_comercial)}</small>` : ""}</td>
      <td>${escapeHtml(cobranca)}</td>
      <td class="financeiro-amount"><strong>${money(item.valor_total, item.moeda)}</strong></td>
      <td>${quitado ? '<span class="financeiro-quitado yes"><i class="fa-solid fa-check"></i> Sim</span>' : '<span class="financeiro-quitado">Não</span>'}</td>
      <td>${escapeHtml(item.nosso_numero || item.conciliacao_identificador || "-")}</td>
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
      periodo_por: $("#filtro-periodo-por")?.value || "",
      documento: $("#filtro-documento")?.value || "",
      conta_contabil_id: $("#filtro-conta-contabil")?.value || "",
      centro_custo_principal_id: $("#filtro-centro-custo")?.value || "",
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
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.contas_bancos || []).map(i => option([i.nome, i.banco, i.agencia ? `Ag. ${i.agencia}` : '', i.conta ? `Cc. ${i.conta}` : ''].filter(Boolean).join(' • '), i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="clientes"]').forEach(sel => {
      const current = sel.value;
      const vazio = ["filtro-cliente", "emissao-cliente"].includes(sel.id) ? "Todos os clientes" : "Selecione...";
      sel.innerHTML = `<option value="">${vazio}</option>` + (ops.clientes || []).map(i => option(`${i.codigo || ""} - ${i.nome}`, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="fornecedores"]').forEach(sel => {
      const current = sel.value;
      const vazio = sel.id === "filtro-fornecedor"
        ? "Todos os fornecedores"
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
    popular('[data-select="centros-custo"]', ops.centros_custo, i => `${Number(i.nivel || 0) > 0 ? "↳ " : ""}${i.caminho_nome || ((i.codigo ? `${i.codigo} - ` : "") + i.nome)}`);
    popular('[data-select="unidades-consumo"]', ops.unidades_consumo, i => `${i.unidade_pai_id ? "↳ " : ""}${i.codigo ? `${i.codigo} - ` : ""}${i.nome_exibicao || i.nome}`);
    popular('[data-select="contas-contabeis"]', (ops.contas_contabeis || []).filter(i => i.aceita_lancamento !== false), i => `${'  '.repeat(Math.max(0, Number(i.nivel || 0)))}${i.codigo} - ${i.nome}`);
    const filtroPlanoContas = $("#filtro-conta-contabil");
    if (filtroPlanoContas && !filtroPlanoContas.value && filtroPlanoContas.options.length) filtroPlanoContas.options[0].textContent = "Todos os planos";
    const filtroCentroCusto = $("#filtro-centro-custo");
    if (filtroCentroCusto && !filtroCentroCusto.value && filtroCentroCusto.options.length) filtroCentroCusto.options[0].textContent = "Todos os centros";
    popular('[data-select="formas-cobranca"]', ops.formas_cobranca, i => i.nome);
    [$("#filtro-forma-cobranca"), $("#emissao-forma-cobranca")].filter(Boolean).forEach(filtroFormaCobranca => {
      if (!filtroFormaCobranca.value && filtroFormaCobranca.options.length) filtroFormaCobranca.options[0].textContent = "Todas as formas";
    });
    const filtroFormaPagamento = $("#filtro-forma-pagamento");
    if (filtroFormaPagamento && !filtroFormaPagamento.value) filtroFormaPagamento.options[0].textContent = "Todas as formas";
    popular('[data-select="regras-encargos"]', ops.regras_encargos, i => `${i.nome}${i.padrao ? " (padrão)" : ""}`);
    popular('[data-select="reguas-cobranca"]', ops.reguas_cobranca, i => `${i.nome}${i.padrao ? " (padrão)" : ""}`);
    popular('[data-select="entidades-emissoras"]', ops.contas_bancos, i => i.nome);
    prepararLookupsEnvolvidos();
    sincronizarLookupsEnvolvidos();
  }

  function estadoLookupEnvolvido(tipo) {
    return state.envolvidoLookups?.[tipo] || null;
  }

  function itensLookupEnvolvido(tipo) {
    return tipo === "cliente" ? (state.opcoes.clientes || []) : (state.opcoes.fornecedores || []);
  }

  function nomeLookupEnvolvido(item) {
    return String(item?.nome || item?.razao_social || item?.nome_fantasia || "").trim();
  }

  function labelLookupEnvolvido(item, tipo) {
    const nome = nomeLookupEnvolvido(item) || `${tipo === "cliente" ? "Cliente" : "Fornecedor"} #${item?.id || "-"}`;
    const codigo = String(item?.codigo || "").trim();
    return codigo ? `${codigo} - ${nome}` : nome;
  }

  function metaLookupEnvolvido(item) {
    return [item?.cpf_cnpj, item?.whatsapp || item?.telefone, item?.email_cobranca || item?.email]
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join(" • ");
  }

  function montarLookupEnvolvido(form, tipo) {
    if (!form || !["cliente", "fornecedor"].includes(tipo)) return null;
    const select = form.querySelector(`select[name="${tipo}_id"]`);
    if (!select) return null;
    const field = select.closest(".financeiro-field");
    if (!field) return null;
    const existente = field.querySelector(`[data-envolvido-lookup="${tipo}"]`);
    if (existente) return existente;

    const plural = tipo === "cliente" ? "clientes" : "fornecedores";
    const singular = tipo === "cliente" ? "cliente" : "fornecedor";
    const resultId = `financeiro-resultados-${plural}`;
    const lookup = document.createElement("div");
    lookup.className = "financeiro-lookup financeiro-envolvido-lookup";
    lookup.dataset.envolvidoLookup = tipo;
    lookup.innerHTML = `
      <i class="fa-solid fa-magnifying-glass financeiro-lookup-icon" aria-hidden="true"></i>
      <input
        type="search"
        data-envolvido-search="${tipo}"
        placeholder="Pesquisar ${singular}..."
        autocomplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="false"
        aria-controls="${resultId}"
      >
      <button class="financeiro-lookup-clear" type="button" data-envolvido-clear="${tipo}" title="Limpar ${singular}" aria-label="Limpar ${singular}" hidden>
        <i class="fa-solid fa-xmark"></i>
      </button>
      <div class="financeiro-lookup-results" id="${resultId}" data-envolvido-results="${tipo}" role="listbox" hidden></div>
    `;
    select.classList.add("financeiro-native-select-proxy");
    select.dataset.lookupEnhanced = tipo;
    select.required = false;
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
    select.insertAdjacentElement("afterend", lookup);

    const help = document.createElement("small");
    help.className = "financeiro-lookup-help";
    help.textContent = `Pesquise por nome, código, CPF/CNPJ, telefone ou e-mail.`;
    lookup.insertAdjacentElement("afterend", help);
    return lookup;
  }

  function prepararLookupsEnvolvidos(form = $("#form-lancamento")) {
    if (!form) return;
    montarLookupEnvolvido(form, "cliente");
    montarLookupEnvolvido(form, "fornecedor");
  }

  function elementosLookupEnvolvido(form, tipo) {
    if (!form) return null;
    const select = form.querySelector(`select[name="${tipo}_id"]`);
    const root = form.querySelector(`[data-envolvido-lookup="${tipo}"]`);
    if (!select || !root) return null;
    return {
      form,
      tipo,
      select,
      root,
      search: root.querySelector(`[data-envolvido-search="${tipo}"]`),
      results: root.querySelector(`[data-envolvido-results="${tipo}"]`),
      clear: root.querySelector(`[data-envolvido-clear="${tipo}"]`),
    };
  }

  function fecharResultadosLookupEnvolvido(form, tipo) {
    const els = elementosLookupEnvolvido(form, tipo);
    if (!els) return;
    els.results.hidden = true;
    els.results.innerHTML = "";
    els.search.setAttribute("aria-expanded", "false");
  }

  function fecharTodosLookupsEnvolvidos(form = $("#form-lancamento")) {
    fecharResultadosLookupEnvolvido(form, "cliente");
    fecharResultadosLookupEnvolvido(form, "fornecedor");
  }

  function renderResultadosLookupEnvolvido(form, tipo, items = [], mensagem = "") {
    const els = elementosLookupEnvolvido(form, tipo);
    const lookupState = estadoLookupEnvolvido(tipo);
    if (!els || !lookupState) return;
    lookupState.items = Array.isArray(items) ? items : [];
    if (mensagem) {
      els.results.innerHTML = `<div class="financeiro-lookup-message">${escapeHtml(mensagem)}</div>`;
    } else if (!lookupState.items.length) {
      els.results.innerHTML = `<div class="financeiro-lookup-message">Nenhum ${tipo === "cliente" ? "cliente" : "fornecedor"} encontrado.</div>`;
    } else {
      els.results.innerHTML = lookupState.items.map((item, index) => {
        const meta = metaLookupEnvolvido(item);
        return `<button class="financeiro-lookup-option" type="button" role="option" data-envolvido-option="${tipo}" data-envolvido-index="${index}">
          <strong>${escapeHtml(labelLookupEnvolvido(item, tipo))}</strong>
          ${meta ? `<span>${escapeHtml(meta)}</span>` : `<span>Cadastro de ${tipo === "cliente" ? "cliente" : "fornecedor"}</span>`}
        </button>`;
      }).join("");
    }
    els.results.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
  }

  function garantirOpcaoLookupEnvolvido(select, item, tipo) {
    if (!select || !item?.id) return;
    const value = String(item.id);
    if (Array.from(select.options || []).some(opt => String(opt.value) === value)) return;
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = labelLookupEnvolvido(item, tipo);
    select.appendChild(opt);
  }

  function selecionarLookupEnvolvido(form, tipo, item = null, emitir = true) {
    const els = elementosLookupEnvolvido(form, tipo);
    const lookupState = estadoLookupEnvolvido(tipo);
    if (!els || !lookupState) return;
    clearTimeout(lookupState.timer);
    if (lookupState.controller) lookupState.controller.abort();
    lookupState.controller = null;
    lookupState.requestId += 1;

    if (item) garantirOpcaoLookupEnvolvido(els.select, item, tipo);
    els.select.value = item?.id ? String(item.id) : "";
    els.search.value = item ? labelLookupEnvolvido(item, tipo) : "";
    els.search.dataset.selectedLabel = item ? labelLookupEnvolvido(item, tipo) : "";
    els.search.dataset.selectedId = item?.id ? String(item.id) : "";
    els.clear.hidden = !item;
    els.search.setCustomValidity("");
    fecharResultadosLookupEnvolvido(form, tipo);

    if (item) {
      const chave = tipo === "cliente" ? "clientes" : "fornecedores";
      if (!(state.opcoes[chave] || []).some(i => String(i.id) === String(item.id))) {
        state.opcoes[chave] = [...(state.opcoes[chave] || []), item];
      }
    }
    if (emitir) els.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function sincronizarLookupEnvolvido(form, tipo, item = null) {
    const els = elementosLookupEnvolvido(form, tipo);
    if (!els) return;
    const id = String(els.select.value || "");
    if (!id) return selecionarLookupEnvolvido(form, tipo, null, false);
    const atual = itensLookupEnvolvido(tipo).find(i => String(i.id) === id);
    const sintetico = atual || (tipo === "cliente" ? {
      id,
      codigo: item?.cliente_codigo || "",
      nome: item?.cliente_nome || `Cliente #${id}`,
      cpf_cnpj: item?.cliente_cpf_cnpj || "",
      email: item?.email_cobranca || "",
      telefone: item?.whatsapp_cobranca || "",
    } : {
      id,
      codigo: item?.fornecedor_codigo || "",
      nome: item?.fornecedor_nome || `Fornecedor #${id}`,
      cpf_cnpj: item?.fornecedor_cpf_cnpj || "",
      tipo_fornecedor: item?.fornecedor_tipo || "",
    });
    selecionarLookupEnvolvido(form, tipo, sintetico, false);
  }

  function sincronizarLookupsEnvolvidos(form = $("#form-lancamento"), item = null) {
    sincronizarLookupEnvolvido(form, "cliente", item);
    sincronizarLookupEnvolvido(form, "fornecedor", item);
  }

  function resultadosLocaisLookupEnvolvido(tipo, termo = "") {
    const busca = String(termo || "").trim().toLocaleLowerCase("pt-BR");
    const items = itensLookupEnvolvido(tipo);
    const filtrados = !busca ? items : items.filter(item => {
      const texto = [item?.codigo, item?.nome, item?.nome_fantasia, item?.cpf_cnpj, item?.email, item?.email_cobranca, item?.telefone, item?.whatsapp]
        .map(v => String(v || "").toLocaleLowerCase("pt-BR"))
        .join(" ");
      return texto.includes(busca);
    });
    return filtrados.slice(0, 30);
  }

  async function buscarLookupEnvolvido(form, tipo, termo) {
    const els = elementosLookupEnvolvido(form, tipo);
    const lookupState = estadoLookupEnvolvido(tipo);
    if (!els || !lookupState) return;
    const busca = String(termo || "").trim();

    if (busca.length < 2) {
      const locais = resultadosLocaisLookupEnvolvido(tipo, busca);
      renderResultadosLookupEnvolvido(form, tipo, locais, locais.length ? "" : (busca ? "Digite mais um caractere para ampliar a busca." : "Nenhum cadastro disponível."));
      return;
    }

    if (lookupState.controller) lookupState.controller.abort();
    const controller = new AbortController();
    lookupState.controller = controller;
    const requestId = ++lookupState.requestId;
    renderResultadosLookupEnvolvido(form, tipo, [], `Procurando ${tipo === "cliente" ? "clientes" : "fornecedores"}...`);

    try {
      const endpoint = tipo === "cliente" ? "/api/financeiro/clientes-busca" : "/api/financeiro/sacados";
      const data = await request(`${endpoint}${qs({ busca, limit: 30 })}`, { signal: controller.signal });
      if (requestId !== lookupState.requestId) return;
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      renderResultadosLookupEnvolvido(form, tipo, items);
    } catch (err) {
      if (err?.name === "AbortError") return;
      if (requestId !== lookupState.requestId) return;
      renderResultadosLookupEnvolvido(form, tipo, [], `Não foi possível pesquisar: ${err.message}`);
    }
  }

  function agendarBuscaLookupEnvolvido(form, tipo, termo) {
    const lookupState = estadoLookupEnvolvido(tipo);
    if (!lookupState) return;
    clearTimeout(lookupState.timer);
    lookupState.timer = setTimeout(() => buscarLookupEnvolvido(form, tipo, termo), 220);
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
    const parceiro = form.querySelector('[data-parceiro-comercial]');
    if (parceiro) parceiro.value = cliente?.parceiro_comercial || "";
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
    // O fornecedor continua disponível também em Contas a Receber.
    // O usuário pode relacionar um fornecedor ao título sem perder o cliente/sacado principal.
    if (fornecedorField) fornecedorField.hidden = false;
    if (fornecedorTipoField) fornecedorTipoField.hidden = false;
    const clienteSelect = form.querySelector('[name="cliente_id"]');
    const fornecedorSelect = form.querySelector('[name="fornecedor_id"]');
    const clienteSearch = form.querySelector('[data-envolvido-search="cliente"]');
    const fornecedorSearch = form.querySelector('[data-envolvido-search="fornecedor"]');
    const sacadoSearch = form.querySelector("[data-sacado-search]");
    if (clienteSelect) clienteSelect.required = false;
    if (fornecedorSelect) fornecedorSelect.required = false;
    if (clienteSearch) {
      clienteSearch.required = receber;
      clienteSearch.setAttribute("aria-required", String(receber));
      if (!receber) clienteSearch.setCustomValidity("");
    }
    if (fornecedorSearch) {
      fornecedorSearch.required = !receber && !sacadoSearch;
      fornecedorSearch.setAttribute("aria-required", String(!receber && !sacadoSearch));
      if (receber || sacadoSearch) fornecedorSearch.setCustomValidity("");
    }
    if (sacadoSearch) {
      sacadoSearch.required = !receber;
      sacadoSearch.setAttribute("aria-required", String(!receber));
      if (receber) sacadoSearch.setCustomValidity("");
      if (!receber) sacadoSearch.placeholder = "Digite fornecedor, código, CPF/CNPJ, telefone ou e-mail";
    }
    if (fornecedorField && !receber) {
      const label = fornecedorField.querySelector("label");
      if (label) label.textContent = "Fornecedor";
      const small = fornecedorField.querySelector("small");
      if (small) small.textContent = "Localize o fornecedor que receberá este pagamento.";
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
    const acrescimo = Number(moneyToBackend(form.querySelector('[name="valor_acrescimo"]')?.value || 0));
    const multa = Number(moneyToBackend(form.querySelector('[name="valor_multa"]')?.value || 0));
    const mora = Number(moneyToBackend(form.querySelector('[name="valor_mora"]')?.value || 0));
    const total = Math.max(0, principal - desconto + acrescimo + multa + mora);
    const out = form.querySelector('[name="valor_total_baixa"]');
    if (out) out.value = formatMoneyForInput(total, state.baixaAtual?.moeda || "BRL");
    atualizarReparcelamentoBaixa();
  }

  function atualizarModalidadeBaixa() {
    const form = $("#form-baixa");
    const item = state.baixaAtual;
    if (!form || !item) return;
    const modalidade = form.querySelector('[name="modalidade_baixa"]:checked')?.value || "total";
    const principal = form.querySelector('[name="valor_principal"]');
    const saldo = Math.max(0, Number(item.valor_total || 0) - Number(item.valor_pago || 0));
    if (!principal) return;
    if (modalidade === "total") {
      principal.value = formatMoneyForInput(saldo, item.moeda || "BRL");
      principal.readOnly = true;
      principal.setAttribute("aria-readonly", "true");
    } else {
      principal.readOnly = false;
      principal.removeAttribute("aria-readonly");
      const atual = Number(moneyToBackend(principal.value || 0));
      if (!(atual > 0 && atual < saldo)) {
        principal.value = formatMoneyForInput(Math.max(0.01, saldo / 2), item.moeda || "BRL");
      }
    }
    atualizarCalculoBaixa();
  }

  function atualizarReparcelamentoBaixa() {
    const form = $("#form-baixa");
    const item = state.baixaAtual;
    if (!form || !item) return;
    const box = form.querySelector("[data-reparcelamento-box]");
    const select = form.querySelector('[name="reparcelar_saldo"]');
    const ehPagamento = String(item.tipo || "") === "pagar";
    if (box) box.hidden = !ehPagamento;
    if (!select) return;
    select.disabled = !ehPagamento;
    if (!ehPagamento) select.value = "false";

    const principal = Number(moneyToBackend(form.querySelector('[name="valor_principal"]')?.value || 0));
    const saldoAtual = Math.max(0, Number(item.valor_total || 0) - Number(item.valor_pago || 0));
    const saldoRestante = Math.max(0, saldoAtual - principal);
    const saldoInput = form.querySelector('[name="reparcelamento_saldo"]');
    if (saldoInput) saldoInput.value = formatMoneyForInput(saldoRestante, item.moeda || "BRL");

    const ativo = ehPagamento && select.value === "true";
    const qtd = form.querySelector('[name="reparcelamento_parcelas"]');
    const primeiro = form.querySelector('[name="reparcelamento_primeiro_vencimento"]');
    const intervalo = form.querySelector('[name="reparcelamento_intervalo_meses"]');
    [qtd, primeiro, intervalo].forEach(el => { if (el) el.disabled = !ativo; });
    if (qtd) qtd.required = ativo;
    if (primeiro) primeiro.required = ativo;

    const info = form.querySelector("[data-reparcelamento-info]");
    if (!info) return;
    if (!ativo) {
      info.textContent = "Não. O saldo que não for pago continuará aberto nesta mesma conta.";
      info.classList.remove("is-danger");
      return;
    }
    if (saldoRestante <= 0) {
      info.textContent = "Para reparcelar, o principal desta baixa precisa ser menor que o saldo aberto.";
      info.classList.add("is-danger");
      return;
    }
    info.classList.remove("is-danger");
    const quantidade = Math.max(2, Number(qtd?.value || 2));
    info.textContent = `${money(saldoRestante, item.moeda)} serão retirados desta conta e divididos em ${quantidade} novas parcelas. O valor não será duplicado.`;
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
      const encargos = form.querySelector('[name="encargos_automaticos"]');
      if (encargos) encargos.value = formatMoneyForInput(Number(previa.valor_multa || 0) + Number(previa.valor_mora || 0), item.moeda);
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

  function receberItemSelecionado() {
    return state.items.find(i => Number(i.id) === Number(state.receberSelecionadoId)) || null;
  }

  function ativarAbaReceber(tab = "registros") {
    if (state.page !== "receber") return;
    const alvo = ["registros", "detalhes", "conciliacao"].includes(tab) ? tab : "registros";
    state.receberTab = alvo;
    $$('[data-receber-tab]').forEach(btn => {
      const ativo = btn.dataset.receberTab === alvo;
      btn.classList.toggle("is-active", ativo);
      btn.setAttribute("aria-selected", String(ativo));
    });
    $$('[data-receber-panel]').forEach(panel => { panel.hidden = panel.dataset.receberPanel !== alvo; });
    if (alvo === "detalhes") renderDetalhesReceber(receberItemSelecionado());
    if (alvo === "conciliacao") carregarConciliacaoReceber().catch(err => alertBox(`Erro na conciliação: ${err.message}`, "danger"));
  }

  function selecionarReceber(id, abrirDetalhes = false) {
    state.receberSelecionadoId = Number(id) || null;
    $$("[data-receber-row-id]").forEach(row => row.classList.toggle("is-selected", Number(row.dataset.receberRowId) === Number(state.receberSelecionadoId)));
    renderDetalhesReceber(receberItemSelecionado());
    const resumo = $("#receber-registro-resumo");
    const item = receberItemSelecionado();
    if (resumo) resumo.innerHTML = item
      ? `<strong>#${item.id} • ${escapeHtml(item.cliente_nome || "Cliente")}</strong><span>${escapeHtml(item.documento || "Sem documento")} • ${money(item.valor_total, item.moeda)} • ${dateBR(item.data_vencimento)}</span>`
      : "Selecione um título para consultar os detalhes.";
    if (abrirDetalhes) ativarAbaReceber("detalhes");
  }

  function labelConciliacao(status) {
    const chave = String(status || "").trim().toLowerCase();
    const labels = {
      conciliado: "Conciliado",
      aguardando_retorno: "Aguardando retorno",
      aguardando_conta: "Aguardando conta corrente",
      estorno_pendente_gateway: "Reembolso em processamento",
      estornado_no_gateway: "Reembolsado / estornado",
      divergencia_titulo_cancelado: "Revisar: título cancelado",
      divergencia_baixa_estornada: "Revisar: baixa estornada",
      divergencia_movimentacao_ausente: "Revisar: baixa não encontrada",
    };
    return labels[chave] || (status ? String(status).replaceAll("_", " ") : "Pendente");
  }

  function podeConciliarCobranca(status) {
    return ![
      "conciliado",
      "estorno_pendente_gateway",
      "estornado_no_gateway",
      "divergencia_titulo_cancelado",
      "divergencia_baixa_estornada",
      "divergencia_movimentacao_ausente",
    ].includes(String(status || "").trim().toLowerCase());
  }

  function renderDetalhesReceber(item) {
    const host = $("#receber-detalhes");
    if (!host) return;
    if (!item) {
      host.innerHTML = '<div class="financeiro-empty-soft">Selecione um registro na aba Registros.</div>';
      return;
    }
    const status = String(item.status_calculado || item.status || "aberto").toLowerCase();
    const classificacao = [
      item.conta_contabil_codigo && item.conta_contabil_nome ? `${item.conta_contabil_codigo} - ${item.conta_contabil_nome}` : item.conta_contabil_nome,
      item.centro_custo_principal_nome,
      item.centro_custo_secundario_nome,
    ].filter(Boolean).join(" • ") || "Não classificado";
    const temBoleto = Boolean(item.cobranca_provider_payment_id);
    const conciliado = String(item.cobranca_conciliacao_status || "").toLowerCase() === "conciliado";
    host.innerHTML = `
      <div class="financeiro-receber-detail-head">
        <div><span>Título #${item.id}</span><h4>${escapeHtml(item.cliente_nome || "Cliente não informado")}</h4><p>${escapeHtml(item.descricao || "Sem descrição")}</p></div>
        <div>${pill(status === "recebido" ? "quitado" : status)}</div>
      </div>
      <div class="financeiro-receber-detail-grid">
        <div><span>Documento</span><strong>${escapeHtml(item.documento || "-")}</strong></div>
        <div><span>Nosso número</span><strong>${escapeHtml(item.nosso_numero || item.conciliacao_identificador || "-")}</strong></div>
        <div><span>Emissão</span><strong>${dateBR(item.data_emissao)}</strong></div>
        <div><span>Vencimento</span><strong>${dateBR(item.data_vencimento)}</strong></div>
        <div><span>Valor</span><strong>${money(item.valor_total, item.moeda)}</strong></div>
        <div><span>Recebido</span><strong>${money(item.valor_pago, item.moeda)}</strong></div>
        <div><span>Saldo</span><strong>${money(item.saldo_aberto, item.moeda)}</strong></div>
        <div><span>Modalidade</span><strong>${escapeHtml(item.forma_cobranca_nome || item.modalidade_pagamento || item.forma_pagamento_nome || "-")}</strong></div>
      </div>
      <div class="financeiro-receber-detail-notes">
        <div><span>Parceiro / Comercial</span><strong>${escapeHtml(item.parceiro_comercial || "Não informado")}</strong></div>
        <div><span>Classificação</span><strong>${escapeHtml(classificacao)}</strong></div>
        <div class="full"><span>Observação</span><p>${escapeHtml(item.observacoes || "Sem observações.")}</p></div>
      </div>
      <div class="financeiro-boleto-inline ${temBoleto ? "has-charge" : ""}">
        <div><span>Boleto / retorno bancário</span><strong>${temBoleto ? escapeHtml(String(item.cobranca_provider || "banco").toUpperCase()) + " • " + escapeHtml(item.cobranca_provider_status || "Aguardando") : "Ainda não emitido"}</strong></div>
        <div><span>Conciliação</span><strong>${temBoleto ? (conciliado ? "Conciliado" : escapeHtml(labelConciliacao(item.cobranca_conciliacao_status))) : "-"}</strong></div>
        <button class="btn btn-secondary" type="button" data-action="boleto-titulo" data-id="${item.id}"><i class="fa-solid fa-barcode"></i> ${temBoleto ? "Abrir boleto" : "Emitir boleto"}</button>
      </div>
      <div class="financeiro-receber-detail-actions">
        <button class="btn btn-secondary" type="button" data-action="editar-lancamento" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button>
        <button class="btn btn-primary" type="button" data-action="baixar-lancamento" data-id="${item.id}" ${["recebido","cancelado"].includes(status) ? "disabled" : ""}><i class="fa-solid fa-check"></i> Baixar recebimento</button>
        <button class="btn btn-secondary" type="button" data-action="historico-lancamento" data-id="${item.id}"><i class="fa-solid fa-clock-rotate-left"></i> Histórico / Estornar</button>
        <button class="btn btn-secondary financeiro-cancel-title" type="button" data-action="cancelar-lancamento" data-id="${item.id}" ${status === "cancelado" || Number(item.valor_pago || 0) > 0 ? "disabled" : ""}><i class="fa-solid fa-ban"></i> Cancelar título</button>
      </div>`;
  }

  function renderBoletoModal(data) {
    state.boletoAtual = data || null;
    const host = $("#boleto-conteudo");
    const conta = $("#boleto-conta-banco");
    if (!host) return;
    const titulo = data?.titulo || {};
    const cobranca = data?.cobranca || null;
    if (conta) conta.value = titulo.conta_banco_id ? String(titulo.conta_banco_id) : "";
    const status = String(cobranca?.provider_status || "").toUpperCase();
    const conciliacao = String(cobranca?.conciliacao_status || "");
    const boletoUrl = safeExternalUrl(cobranca?.bank_slip_url || cobranca?.invoice_url);
    host.innerHTML = `
      <div class="financeiro-boleto-summary">
        <div><span>Título</span><strong>#${Number(titulo.id || 0)} • ${escapeHtml(titulo.documento || "Sem documento")}</strong></div>
        <div><span>Vencimento</span><strong>${dateBR(titulo.data_vencimento)}</strong></div>
        <div><span>Saldo</span><strong>${money(titulo.saldo || 0)}</strong></div>
        <div><span>Ambiente</span><strong>${escapeHtml(data?.ambiente || "-")}</strong></div>
      </div>
      ${!data?.configurado ? '<div class="financeiro-alert-inline danger">Asaas ainda não está configurado no servidor.</div>' : ""}
      ${cobranca ? `
        <div class="financeiro-boleto-status-row">
          <span class="financeiro-provider-pill">${escapeHtml(String(data.provider || cobranca.provider || "asaas").toUpperCase())}</span>
          <span>${escapeHtml(status || "Aguardando retorno")}</span>
          <span>${escapeHtml(labelConciliacao(conciliacao || "aguardando_retorno"))}</span>
        </div>
        <div class="financeiro-boleto-data">
          <div><span>Nosso número</span><strong>${escapeHtml(titulo.nosso_numero || "-")}</strong></div>
          <div class="full"><span>Linha digitável</span><code>${escapeHtml(cobranca.identification_field || "Ainda não disponível")}</code>${cobranca.identification_field ? '<button class="financeiro-link-action" type="button" data-action="boleto-copiar-linha">Copiar linha</button>' : ""}</div>
          <div class="full"><span>Pix copia e cola</span><code>${escapeHtml(cobranca.pix_payload || "Ainda não disponível")}</code>${cobranca.pix_payload ? '<button class="financeiro-link-action" type="button" data-action="boleto-copiar-pix">Copiar Pix</button>' : ""}</div>
        </div>
        <div class="financeiro-boleto-actions">
          ${boletoUrl !== "#" ? `<a class="btn btn-secondary" href="${escapeHtml(boletoUrl)}" target="_blank" rel="noopener noreferrer"><i class="fa-regular fa-file-pdf"></i> Ver boleto</a>` : ""}
          <button class="btn btn-secondary" type="button" data-action="boleto-atualizar"><i class="fa-solid fa-arrows-rotate"></i> Atualizar retorno</button>
          ${podeConciliarCobranca(conciliacao) ? '<button class="btn btn-primary" type="button" data-action="boleto-conciliar"><i class="fa-solid fa-building-columns"></i> Conciliar</button>' : (conciliacao === "conciliado" ? '<span class="financeiro-quitado yes"><i class="fa-solid fa-check"></i> Conciliado</span>' : `<span class="financeiro-status-pending">${escapeHtml(labelConciliacao(conciliacao))}</span>`)}
        </div>` : `
        <div class="financeiro-boleto-empty"><i class="fa-solid fa-barcode"></i><strong>Boleto ainda não emitido</strong><span>Selecione a Conta Corrente onde o recebimento deve ser creditado e emita a cobrança.</span></div>
        <div class="financeiro-boleto-actions"><button class="btn btn-primary" type="button" data-action="boleto-emitir" ${!data?.configurado ? "disabled" : ""}><i class="fa-solid fa-barcode"></i> Emitir boleto</button></div>`}
    `;
  }

  async function abrirBoleto(lancamentoId) {
    state.boletoAtualId = Number(lancamentoId);
    state.boletoAtual = null;
    const host = $("#boleto-conteudo");
    if (host) host.innerHTML = '<div class="financeiro-empty-soft">Carregando boleto e retorno bancário...</div>';
    abrirModal("#modal-boleto");
    try {
      const data = await request(`/api/financeiro/contas-receber/${lancamentoId}/boleto`);
      renderBoletoModal(data);
    } catch (err) {
      if (host) host.innerHTML = `<div class="financeiro-alert-inline danger">${escapeHtml(err.message)}</div>`;
    }
  }

  async function operarBoleto(acao) {
    const id = Number(state.boletoAtualId || 0);
    if (!id) return;
    const contaId = nullNumber($("#boleto-conta-banco")?.value);
    if (["emitir", "conciliar"].includes(acao) && !contaId) {
      return alertBox("Selecione a Conta Corrente/Banco que receberá o valor.", "danger");
    }
    const path = acao === "emitir" ? "boleto/emitir" : acao === "atualizar" ? "boleto/atualizar" : "conciliar";
    const resultado = await request(`/api/financeiro/contas-receber/${id}/${path}`, { method: "POST", body: { conta_banco_id: contaId } });
    const estado = resultado?.estado || await request(`/api/financeiro/contas-receber/${id}/boleto`);
    renderBoletoModal(estado);
    if (acao === "emitir") alertBox("Boleto emitido e vinculado ao título.", "ok");
    else if (resultado?.conciliado || resultado?.conciliacao?.conciliado) alertBox("Retorno conciliado. A baixa entrou automaticamente no Caixa/Conta Corrente.", "ok");
    else alertBox("Retorno bancário atualizado.", "ok");
    await carregarReceber();
    if (state.receberTab === "conciliacao") await carregarConciliacaoReceber();
  }

  async function copiarTextoBoleto(value, label) {
    const texto = String(value || "").trim();
    if (!texto) return alertBox(`${label} ainda não está disponível.`, "warn");
    await navigator.clipboard.writeText(texto);
    alertBox(`${label} copiado.`, "ok");
  }

  async function carregarConciliacaoReceber() {
    if (state.page !== "receber") return;
    const tbody = $("#tbody-receber-conciliacao");
    if (tbody) tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="11">Carregando conciliação...</td></tr>';
    const f = filtros();
    const data = await request(`/api/financeiro/contas-receber/conciliacao${qs({ data_inicio: f.data_inicio, data_fim: f.data_fim, cliente_id: f.cliente_id, limit: 300 })}`);
    state.receberConciliacao = data.items || [];
    const resumo = $("#receber-conciliacao-resumo");
    if (resumo) resumo.innerHTML = `<span><strong>${Number(data.total || 0)}</strong> retorno(s)</span><span><strong>${Number(data.conciliados || 0)}</strong> conciliado(s)</span><span><strong>${Number(data.pendentes || 0)}</strong> pendente(s)</span>`;
    if (!tbody) return;
    if (!state.receberConciliacao.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="11">Nenhuma cobrança bancária vinculada aos títulos deste período.</td></tr>';
      return;
    }
    tbody.innerHTML = state.receberConciliacao.map(i => `<tr>
      <td>#${i.lancamento_id}</td>
      <td><strong>${escapeHtml(i.cliente_nome || "-")}</strong></td>
      <td>${escapeHtml(i.documento || "-")}</td>
      <td>${escapeHtml(i.nosso_numero || "-")}</td>
      <td>${escapeHtml(String(i.provider || "-").toUpperCase())}</td>
      <td>${escapeHtml(i.provider_status || i.ultimo_evento || "-")}</td>
      <td>${dateBR(i.data_vencimento)}</td>
      <td class="financeiro-amount">${money(i.valor_total)}</td>
      <td><div class="financeiro-bank-links">${i.identification_field ? `<button type="button" class="financeiro-link-action" data-action="copiar-conciliacao-linha" data-id="${i.lancamento_id}">Linha</button>` : ""}${i.pix_payload ? `<button type="button" class="financeiro-link-action" data-action="copiar-conciliacao-pix" data-id="${i.lancamento_id}">Pix</button>` : ""}</div></td>
      <td>${i.conciliado ? '<span class="financeiro-quitado yes"><i class="fa-solid fa-check"></i> Conciliado</span>' : `<span class="financeiro-status-pending">${escapeHtml(labelConciliacao(i.conciliacao_status))}</span>`}</td>
      <td><div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="boleto-titulo" data-id="${i.lancamento_id}"><i class="fa-solid fa-barcode"></i> Abrir</button>${!i.conciliado && podeConciliarCobranca(i.conciliacao_status) ? `<button class="financeiro-mini-btn ok" type="button" data-action="conciliar-boleto" data-id="${i.lancamento_id}"><i class="fa-solid fa-arrows-rotate"></i> Conciliar</button>` : ""}</div></td>
    </tr>`).join("");
  }

  async function carregarReceber() {
    const data = await request(`/api/financeiro/contas-receber${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    if (!items.some(i => Number(i.id) === Number(state.receberSelecionadoId))) state.receberSelecionadoId = items[0]?.id || null;
    const resumo = data.resumo || {};
    setKPI("receber-aberto", money(resumo.total_em_aberto || 0));
    setKPI("receber-recebido", money(resumo.total_baixado || 0));
    setKPI("receber-vencido", money(resumo.total_vencido || 0));
    setKPI("receber-hoje", money(resumo.total_vence_hoje || 0));
    setTable("tbody-receber", 11, items.map(i => rowLancamento(i, "receber")).join(""), "Nenhuma conta a receber encontrada.");
    selecionarReceber(state.receberSelecionadoId, false);
    ativarAbaReceber(state.receberTab);
    const inadimplentes = Number(resumo.clientes_inadimplentes || 0);
    setStatusText(`${data.total || 0} título(s) • ${inadimplentes} cliente(s) inadimplente(s).`);
  }

  function pagarItemSelecionado() {
    return state.items.find(i => Number(i.id) === Number(state.pagarSelecionadoId)) || null;
  }

  function ativarAbaPagar(tab = "registros") {
    if (state.page !== "pagar") return;
    const alvo = ["registros", "detalhes"].includes(tab) ? tab : "registros";
    state.pagarTab = alvo;
    $$('[data-pagar-tab]').forEach(btn => {
      const ativo = btn.dataset.pagarTab === alvo;
      btn.classList.toggle("is-active", ativo);
      btn.setAttribute("aria-selected", String(ativo));
    });
    $$('[data-pagar-panel]').forEach(panel => { panel.hidden = panel.dataset.pagarPanel !== alvo; });
    if (alvo === "detalhes") renderDetalhesPagar(pagarItemSelecionado());
  }

  function selecionarPagar(id, abrirDetalhes = false) {
    state.pagarSelecionadoId = Number(id) || null;
    $$('[data-pagar-row-id]').forEach(row => row.classList.toggle("is-selected", Number(row.dataset.pagarRowId) === Number(state.pagarSelecionadoId)));
    const item = pagarItemSelecionado();
    renderDetalhesPagar(item);
    const resumo = $("#pagar-registro-resumo");
    if (resumo) resumo.innerHTML = item
      ? `<strong>#${item.id} • ${escapeHtml(item.fornecedor_nome || "Fornecedor")}</strong><span>${escapeHtml(item.documento || "Sem documento")} • ${money(item.valor_total, item.moeda)} • vence ${dateBR(item.data_vencimento)}</span>`
      : "Selecione um título para consultar os detalhes.";
    if (abrirDetalhes) ativarAbaPagar("detalhes");
  }

  function renderDetalhesPagar(item) {
    const host = $("#pagar-detalhes");
    if (!host) return;
    if (!item) {
      host.innerHTML = '<div class="financeiro-empty-soft">Selecione um registro na aba Registros.</div>';
      return;
    }
    const status = String(item.status_calculado || item.status || "aberto").toLowerCase();
    const plano = item.conta_contabil_codigo && item.conta_contabil_nome
      ? `${item.conta_contabil_codigo} - ${item.conta_contabil_nome}`
      : (item.conta_contabil_nome || "Não informado");
    const centro = [item.centro_custo_principal_nome, item.centro_custo_secundario_nome].filter(Boolean).join(" / ") || "Não informado";
    const parcela = item.parcelado && item.parcela_total ? `${Number(item.parcela_numero || 1)}/${Number(item.parcela_total)}` : "Não parcelado";
    host.innerHTML = `
      <div class="financeiro-receber-detail-head">
        <div><span>Conta a pagar #${item.id}</span><h4>${escapeHtml(item.fornecedor_nome || "Fornecedor não informado")}</h4><p>${escapeHtml(item.descricao || "Sem descrição")}</p></div>
        <div>${pill(status === "pago" ? "quitado" : status)}</div>
      </div>
      <div class="financeiro-receber-detail-grid">
        <div><span>Documento</span><strong>${escapeHtml(item.documento || "-")}</strong></div>
        <div><span>Emissão</span><strong>${dateBR(item.data_emissao)}</strong></div>
        <div><span>Vencimento</span><strong>${dateBR(item.data_vencimento)}</strong></div>
        <div><span>Pagamento</span><strong>${dateBR(item.data_pagamento)}</strong></div>
        <div><span>Valor</span><strong>${money(item.valor_total, item.moeda)}</strong></div>
        <div><span>Pago</span><strong>${money(item.valor_pago, item.moeda)}</strong></div>
        <div><span>Saldo</span><strong>${money(item.saldo_aberto, item.moeda)}</strong></div>
        <div><span>Parcela</span><strong>${escapeHtml(parcela)}</strong></div>
        <div><span>Forma de pagamento</span><strong>${escapeHtml(item.forma_pagamento_nome || "-")}</strong></div>
        <div><span>Conta Corrente</span><strong>${escapeHtml(item.conta_banco_nome || "-")}</strong></div>
      </div>
      <div class="financeiro-receber-detail-notes">
        <div><span>Plano de Contas</span><strong>${escapeHtml(plano)}</strong></div>
        <div><span>Centro de Custo</span><strong>${escapeHtml(centro)}</strong></div>
        <div class="full"><span>Observação</span><p>${escapeHtml(item.observacoes || "Sem observações.")}</p></div>
      </div>
      <div class="financeiro-receber-detail-actions">
        <button class="btn btn-secondary" type="button" data-action="editar-lancamento" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button>
        <button class="btn btn-primary" type="button" data-action="baixar-lancamento" data-id="${item.id}" ${["pago","cancelado"].includes(status) ? "disabled" : ""}><i class="fa-solid fa-check"></i> Baixar pagamento</button>
        <button class="btn btn-secondary" type="button" data-action="historico-lancamento" data-id="${item.id}"><i class="fa-solid fa-clock-rotate-left"></i> Histórico / Estornar</button>
        <button class="btn btn-secondary financeiro-cancel-title" type="button" data-action="cancelar-lancamento" data-id="${item.id}" ${status === "cancelado" || Number(item.valor_pago || 0) > 0 ? "disabled" : ""}><i class="fa-solid fa-ban"></i> Cancelar título</button>
      </div>`;
  }

  async function carregarPagar() {
    const data = await request(`/api/financeiro/contas-pagar${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    if (!items.some(i => Number(i.id) === Number(state.pagarSelecionadoId))) state.pagarSelecionadoId = items[0]?.id || null;
    const resumo = data.resumo || {};
    setKPI("pagar-aberto", money(resumo.total_em_aberto || 0));
    setKPI("pagar-pago", money(resumo.total_baixado || 0));
    setKPI("pagar-vencido", money(resumo.total_vencido || 0));
    setKPI("pagar-hoje", money(resumo.total_vence_hoje || 0));
    setTable("tbody-pagar", 12, items.map(i => rowLancamento(i, "pagar")).join(""), "Nenhuma conta a pagar encontrada.");
    selecionarPagar(state.pagarSelecionadoId, false);
    ativarAbaPagar(state.pagarTab);
    setStatusText(`${data.total || 0} título(s) a pagar.`);
  }

  function filtrosCaixa() {
    return {
      data_inicio: $("#filtro-data-inicio")?.value || monthStartISO(),
      data_fim: $("#filtro-data-fim")?.value || todayISO(),
      conta_banco_id: $("#filtro-caixa-conta")?.value || "",
    };
  }

  function preencherSelectsCaixa() {
    const contas = Array.isArray(state.opcoes.contas_bancos) ? state.opcoes.contas_bancos : [];
    const planos = (Array.isArray(state.opcoes.contas_contabeis) ? state.opcoes.contas_contabeis : []).filter(i => i.ativo !== false && i.aceita_lancamento !== false);
    const centros = Array.isArray(state.opcoes.centros_custo) ? state.opcoes.centros_custo : [];
    const principais = centros.filter(i => i.centro_pai_id == null && i.ativo !== false);

    const contaFiltro = $("#filtro-caixa-conta");
    if (contaFiltro) {
      const atual = contaFiltro.value;
      contaFiltro.innerHTML = `<option value="">Todas as contas</option>${contas.map(i => option([i.nome, i.banco, i.agencia && `Ag. ${i.agencia}`, i.conta && `Cc. ${i.conta}`].filter(Boolean).join(" • "), i.id)).join("")}`;
      contaFiltro.value = atual;
    }
    $$('[data-caixa-select="contas"]').forEach(sel => {
      const atual = sel.value;
      sel.innerHTML = `<option value="">Selecione...</option>${contas.map(i => option([i.nome, i.banco, i.agencia && `Ag. ${i.agencia}`, i.conta && `Cc. ${i.conta}`].filter(Boolean).join(" • "), i.id)).join("")}`;
      sel.value = atual;
    });
    $$('[data-caixa-select="plano"]').forEach(sel => {
      const atual = sel.value;
      sel.innerHTML = `<option value="">Selecione...</option>${planos.map(i => option(`${i.codigo || ""} - ${i.caminho_nome || i.nome}`.replace(/^ - /, ""), i.id)).join("")}`;
      sel.value = atual;
    });
    $$('[data-caixa-select="centro-principal"]').forEach(sel => {
      const atual = sel.value;
      sel.innerHTML = `<option value="">Sem centro...</option>${principais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("")}`;
      sel.value = atual;
    });
    atualizarCentrosSecundariosCaixa();
  }

  function atualizarCentrosSecundariosCaixa(valorAtual = null) {
    const form = $("#form-caixa-movimento");
    if (!form) return;
    const principalId = Number(form.elements.centro_custo_principal_id?.value || 0);
    const sel = form.elements.centro_custo_secundario_id;
    if (!sel) return;
    const atual = valorAtual ?? sel.value;
    const centros = (state.opcoes.centros_custo || []).filter(i => Number(i.centro_pai_id || 0) === principalId && i.ativo !== false);
    sel.innerHTML = `<option value="">Sem secundário...</option>${centros.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("")}`;
    sel.value = atual == null ? "" : String(atual);
    if (sel.value !== String(atual ?? "")) sel.value = "";
  }

  function ativarAbaCaixa(tab) {
    const alvo = ["registros", "edicao", "saldos", "resumo"].includes(tab) ? tab : "registros";
    state.caixa.tab = alvo;
    $$('[data-caixa-tab]').forEach(btn => btn.classList.toggle("is-active", btn.dataset.caixaTab === alvo));
    $$('[data-caixa-pane]').forEach(pane => {
      const ativo = pane.dataset.caixaPane === alvo;
      pane.classList.toggle("is-active", ativo);
      pane.hidden = !ativo;
    });
  }

  function resetarEdicaoCaixa() {
    const form = $("#form-caixa-movimento");
    if (!form) return;
    form.reset();
    form.elements.id.value = "";
    form.elements.data_movimentacao.value = todayISO();
    form.elements.tipo.value = "credito";
    $("#caixa-edicao-titulo").textContent = "Novo movimento";
    atualizarCentrosSecundariosCaixa();
  }

  function abrirEdicaoCaixa(item = null) {
    const form = $("#form-caixa-movimento");
    if (!form) return;
    resetarEdicaoCaixa();
    if (item) {
      form.elements.id.value = item.id || "";
      form.elements.data_movimentacao.value = String(item.data || "").slice(0, 10);
      form.elements.tipo.value = item.tipo || "credito";
      form.elements.documento.value = item.documento || "";
      form.elements.historico.value = item.historico || "";
      form.elements.valor.value = Number(item.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      form.elements.conta_banco_id.value = item.conta_banco_id || "";
      form.elements.conta_contabil_id.value = item.conta_contabil_id || "";
      form.elements.centro_custo_principal_id.value = item.centro_custo_principal_id || "";
      atualizarCentrosSecundariosCaixa(item.centro_custo_secundario_id || "");
      $("#caixa-edicao-titulo").textContent = `Editar movimento #${item.id}`;
    }
    ativarAbaCaixa("edicao");
  }

  async function salvarMovimentoCaixa(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const id = Number(form.elements.id.value || 0);
    const data = getForm(form);
    delete data.id;
    data.valor = moneyToBackend(data.valor || 0);
    data.conta_banco_id = nullNumber(data.conta_banco_id);
    data.conta_contabil_id = nullNumber(data.conta_contabil_id);
    data.centro_custo_principal_id = nullNumber(data.centro_custo_principal_id);
    data.centro_custo_secundario_id = nullNumber(data.centro_custo_secundario_id);
    try {
      await request(id ? `/api/financeiro/caixa/movimentos/${id}` : "/api/financeiro/caixa/movimentos", { method: id ? "PUT" : "POST", body: data });
      alertBox(id ? "Movimento atualizado." : "Movimento registrado.", "ok");
      resetarEdicaoCaixa();
      state.caixa.tab = "registros";
      await carregarFluxo();
      ativarAbaCaixa("registros");
    } catch (err) {
      alertBox(`Erro ao salvar movimento: ${err.message}`, "danger");
    }
  }

  function linhaRegistroCaixa(i) {
    const manual = i.origem === "manual";
    const operacao = i.tipo === "credito" ? '<span class="financeiro-caixa-op credito"><i class="fa-solid fa-arrow-down"></i> Crédito</span>' : '<span class="financeiro-caixa-op debito"><i class="fa-solid fa-arrow-up"></i> Débito</span>';
    const plano = i.conta_contabil_nome ? `${i.conta_contabil_codigo ? `${i.conta_contabil_codigo} - ` : ""}${i.conta_contabil_nome}` : "-";
    const acoes = manual
      ? `<div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="editar-caixa" data-id="${i.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button><button class="financeiro-mini-btn danger" type="button" data-action="cancelar-caixa" data-id="${i.id}" title="Cancelar movimento"><i class="fa-solid fa-ban"></i></button></div>`
      : `<span class="financeiro-caixa-origin"><i class="fa-solid fa-lock"></i> ${i.origem === "saldo_inicial" ? "Saldo inicial" : "Automático"}</span>`;
    return `<tr>
      <td>${dateBR(i.data)}</td><td>${escapeHtml(i.documento || "-")}</td><td>${operacao}</td>
      <td><strong>${escapeHtml(i.historico || "-")}</strong><small>${escapeHtml(i.parceiro || "")}</small></td>
      <td>${escapeHtml(i.conta_banco_nome || "-")}</td><td><span class="financeiro-cell-wrap">${escapeHtml(plano)}</span></td>
      <td class="financeiro-amount financeiro-caixa-credit">${Number(i.credito || 0) ? money(i.credito) : "-"}</td>
      <td class="financeiro-amount financeiro-caixa-debit">${Number(i.debito || 0) ? money(i.debito) : "-"}</td><td>${acoes}</td>
    </tr>`;
  }

  async function carregarFluxo() {
    preencherSelectsCaixa();
    const data = await request(`/api/financeiro/fluxo-caixa${qs(filtrosCaixa())}`);
    const registros = Array.isArray(data.registros) ? data.registros : [];
    const saldos = Array.isArray(data.saldos_diarios) ? data.saldos_diarios : [];
    const resumo = Array.isArray(data.resumo_periodo) ? data.resumo_periodo : [];
    state.caixa.registros = registros;
    state.caixa.saldos = saldos;
    state.caixa.resumo = resumo;
    state.items = registros;

    setKPI("caixa-saldo-anterior", money(data.saldo_anterior || 0));
    setKPI("caixa-creditos", money(data.totais?.credito || 0));
    setKPI("caixa-debitos", money(data.totais?.debito || 0));
    setKPI("caixa-saldo-final", money(data.saldo_final || 0));
    const saldoAnteriorResumo = $("#caixa-resumo-saldo-anterior");
    if (saldoAnteriorResumo) saldoAnteriorResumo.textContent = money(data.saldo_anterior || 0);

    setTable("tbody-caixa-registros", 9, registros.map(linhaRegistroCaixa).join(""), "Nenhum movimento de caixa encontrado no período.");
    setTable("tbody-caixa-saldos", 4, saldos.map(i => `<tr><td>${dateBR(i.data)}</td><td class="financeiro-amount financeiro-caixa-credit">${money(i.credito)}</td><td class="financeiro-amount financeiro-caixa-debit">${money(i.debito)}</td><td class="financeiro-amount"><strong>${money(i.saldo)}</strong></td></tr>`).join(""), "Nenhum saldo diário encontrado no período.");
    setTable("tbody-caixa-resumo", 7, resumo.map(i => `<tr><td>${dateBR(i.data)}</td><td>${escapeHtml(i.documento || "-")}</td><td>${escapeHtml(i.parceiro || "-")}</td><td>${escapeHtml(i.historico || "-")}</td><td class="financeiro-amount financeiro-caixa-credit">${Number(i.credito || 0) ? money(i.credito) : "-"}</td><td class="financeiro-amount financeiro-caixa-debit">${Number(i.debito || 0) ? money(i.debito) : "-"}</td><td class="financeiro-amount"><strong>${money(i.saldo)}</strong></td></tr>`).join(""), "Nenhum movimento no período.");
    ativarAbaCaixa(state.caixa.tab);
    setStatusText(`${registros.length} movimento(s) no caixa • saldo ${money(data.saldo_final || 0)}.`);
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
    setTable("tbody-contas", 10, items.map(i => `<tr><td>${dateBR(i.data_cadastro)}</td><td><strong>${escapeHtml(i.nome)}</strong></td><td>${escapeHtml(i.banco || "-")}</td><td>${escapeHtml(i.agencia || "-")}</td><td>${escapeHtml(i.conta || "-")}</td><td>${escapeHtml(i.nome_agencia || "-")}</td><td>${escapeHtml(i.telefone || "-")}</td><td class="financeiro-amount" title="Saldo inicial: ${money(i.saldo_inicial)} em ${dateBR(i.data_saldo_inicial)}">${money(i.saldo_atual ?? i.saldo_inicial)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "conta")}</td></tr>`).join(""), "Nenhuma conta cadastrada.");
    setStatusText(`${items.length} conta(s).`);
  }

  async function carregarCadastrosFinanceiros() {
    const defs = [
      { tipo: "tipo-documento", endpoint: ENDPOINTS["tipo-documento"], tbody: "tbody-tipos-documento", cols: 6, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.aplicacao)}</td><td>${i.exige_entidade_emissora ? "Sim" : "Não"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "tipo-documento")}</td></tr>` },
      { tipo: "natureza", endpoint: ENDPOINTS.natureza, tbody: "tbody-naturezas", cols: 5, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.aplicacao)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "natureza")}</td></tr>` },
      { tipo: "tipo-gasto", endpoint: ENDPOINTS["tipo-gasto"], tbody: "tbody-tipos-gasto", cols: 4, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td>${escapeHtml(i.nome)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "tipo-gasto")}</td></tr>` },
      { tipo: "centro-custo", endpoint: ENDPOINTS["centro-custo"], tbody: "tbody-centros-custo", cols: 5, row: i => `<tr class="financeiro-tree-row nivel-${Number(i.nivel || 0)}"><td>${escapeHtml(i.codigo || "-")}</td><td><span class="financeiro-tree-name" style="--tree-level:${Number(i.nivel || 0)}">${Number(i.nivel || 0) ? '<i class="fa-solid fa-turn-up fa-rotate-90"></i>' : '<i class="fa-regular fa-folder"></i>'}${escapeHtml(i.nome)}</span></td><td>${escapeHtml(i.centro_pai_nome || "Principal")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "centro-custo")}</td></tr>` },
      { tipo: "unidade-consumo", endpoint: ENDPOINTS["unidade-consumo"], tbody: "tbody-unidades-consumo", cols: 7, row: i => `<tr><td>${escapeHtml(i.codigo || "-")}</td><td><strong>${escapeHtml(i.identificacao_uc || i.nome)}</strong>${i.referencia_detalhe ? `<small class="financeiro-table-subtext">${escapeHtml(i.referencia_detalhe)}</small>` : ""}</td><td>${escapeHtml(String(i.tipo_referencia || "outro").replaceAll("_", " "))}</td><td>${escapeHtml(i.referencia_origem || "Cadastro manual")}${i.referencia_ativa === false ? `<small class="financeiro-reference-warning"><i class="fa-solid fa-triangle-exclamation"></i> Vínculo pendente</small>` : ""}</td><td>${escapeHtml(i.unidade_pai_nome || "Principal")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "unidade-consumo")}</td></tr>` },
      { tipo: "conta-contabil", endpoint: ENDPOINTS["conta-contabil"], tbody: "tbody-contas-contabeis", cols: 7, row: i => `<tr class="financeiro-tree-row nivel-${Number(i.nivel || 0)}"><td>${escapeHtml(i.codigo)}</td><td><span class="financeiro-tree-name" style="--tree-level:${Number(i.nivel || 0)}">${i.aceita_lancamento ? '<i class="fa-regular fa-file-lines"></i>' : '<i class="fa-regular fa-folder"></i>'}${escapeHtml(i.nome)}</span></td><td>${pill(i.tipo)}</td><td>${escapeHtml(i.conta_pai_nome || "Raiz")}</td><td>${i.aceita_lancamento ? "Analítica" : "Agrupadora"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "conta-contabil")}</td></tr>` },
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

  function filtrosEmissaoLote() {
    return {
      data_inicio: $("#emissao-data-inicio")?.value || monthStartISO(),
      data_fim: $("#emissao-data-fim")?.value || todayISO(),
      cliente_id: $("#emissao-cliente")?.value || "",
      forma_cobranca_id: $("#emissao-forma-cobranca")?.value || "",
      limit: 1000,
    };
  }

  function atualizarResumoSelecaoEmissao() {
    const selecionados = state.cobranca.emissaoSelecionados || new Set();
    const itens = (state.cobranca.emissaoTitulos || []).filter(i => selecionados.has(Number(i.id)));
    const totalSaldo = soma(itens, i => i.saldo_aberto);
    const qtd = $("#emissao-selecionados-qtd");
    const total = $("#emissao-selecionados-total");
    const botao = $("#btn-emitir-titulos-lote");
    const todos = $("#emissao-selecionar-todos");
    if (qtd) qtd.textContent = String(itens.length);
    if (total) total.textContent = money(totalSaldo);
    if (botao) botao.disabled = itens.length === 0;
    if (todos) {
      const totalItens = state.cobranca.emissaoTitulos.length;
      todos.checked = totalItens > 0 && itens.length === totalItens;
      todos.indeterminate = itens.length > 0 && itens.length < totalItens;
      todos.disabled = totalItens === 0;
    }
  }

  function renderTitulosEmissaoLote(items = []) {
    state.cobranca.emissaoTitulos = items;
    setTable("tbody-emissao-lote", 7, items.map(i => `<tr>
      <td class="financeiro-check-col"><input type="checkbox" data-emissao-check value="${i.id}" ${state.cobranca.emissaoSelecionados.has(Number(i.id)) ? "checked" : ""} aria-label="Selecionar título ${i.id}"></td>
      <td>${escapeHtml(i.cliente_nome || "Cliente não identificado")}</td>
      <td>${escapeHtml(i.descricao || `Título #${i.id}`)}${i.documento ? `<small>${escapeHtml(i.documento)}</small>` : ""}</td>
      <td>${dateBR(i.data_vencimento)}</td>
      <td>${escapeHtml(i.forma_cobranca_nome || "Não informada")}</td>
      <td class="financeiro-amount">${money(i.valor_total)}</td>
      <td class="financeiro-amount">${money(i.saldo_aberto)}</td>
    </tr>`).join(""), "Nenhum título aberto e ainda não emitido atende a estes filtros.");
    atualizarResumoSelecaoEmissao();
  }

  async function buscarTitulosEmissaoLote({ selecionarTodos = true } = {}) {
    const filtros = filtrosEmissaoLote();
    if (!filtros.data_inicio || !filtros.data_fim) return alertBox("Informe o período de vencimento para buscar os títulos.", "warn");
    if (filtros.data_fim < filtros.data_inicio) return alertBox("A data final deve ser igual ou posterior à data inicial.", "warn");

    const resumoEl = $("#emissao-resultado-resumo");
    if (resumoEl) resumoEl.textContent = "Consultando títulos...";
    const data = await request(`/api/financeiro/cobrancas/emissao-lote/titulos${qs(filtros)}`);
    const items = data.items || [];
    state.cobranca.emissaoSelecionados = selecionarTodos
      ? new Set(items.map(i => Number(i.id)))
      : new Set(Array.from(state.cobranca.emissaoSelecionados || []).filter(id => items.some(i => Number(i.id) === id)));
    renderTitulosEmissaoLote(items);
    if (resumoEl) resumoEl.textContent = `${Number(data.resumo?.quantidade || 0)} título(s) • ${money(data.resumo?.valor_total || 0)} em valor • ${money(data.resumo?.saldo_total || 0)} de saldo aberto`;
    return data;
  }

  function renderHistoricoEmissoesLotes(items = []) {
    state.cobranca.emissoesLotes = items;
    setTable("tbody-emissoes-lotes", 8, items.map(i => {
      const filtros = [i.cliente_filtro_nome || "Todos os clientes", i.forma_cobranca_filtro_nome || "Todas as formas"].join(" • ");
      return `<tr>
        <td>${dateBR(i.data_emissao)}<small>Lote #${i.id}</small></td>
        <td>${dateBR(i.periodo_inicio)} a ${dateBR(i.periodo_fim)}</td>
        <td>${escapeHtml(filtros)}</td>
        <td>${Number(i.total_titulos || 0)}</td>
        <td class="financeiro-amount">${money(i.valor_total_titulos || 0)}</td>
        <td class="financeiro-amount">${money(i.saldo_total_emitido || 0)}</td>
        <td>${escapeHtml(i.usuario_nome || "Usuário não identificado")}</td>
        <td><button class="financeiro-mini-btn" type="button" data-action="ver-emissao-lote" data-id="${i.id}"><i class="fa-regular fa-eye"></i> Ver títulos</button></td>
      </tr>`;
    }).join(""), "Nenhuma emissão em lote registrada ainda.");
  }

  async function carregarHistoricoEmissoesLotes() {
    const items = await request("/api/financeiro/cobrancas/emissoes-lotes?limit=20");
    renderHistoricoEmissoesLotes(items || []);
  }

  async function emitirTitulosSelecionados() {
    const ids = Array.from(state.cobranca.emissaoSelecionados || []);
    if (!ids.length) return alertBox("Selecione pelo menos um título para emitir.", "warn");
    const selecionados = state.cobranca.emissaoTitulos.filter(i => state.cobranca.emissaoSelecionados.has(Number(i.id)));
    const saldo = soma(selecionados, i => i.saldo_aberto);
    if (!confirm(`Emitir ${ids.length} título(s) com saldo total de ${money(saldo)}?\n\nA emissão ficará registrada e estes títulos não serão emitidos novamente por engano.`)) return;

    const filtros = filtrosEmissaoLote();
    const botao = $("#btn-emitir-titulos-lote");
    if (botao) botao.disabled = true;
    try {
      const resultado = await request("/api/financeiro/cobrancas/emissao-lote", {
        method: "POST",
        body: {
          data_inicio: filtros.data_inicio,
          data_fim: filtros.data_fim,
          cliente_id: filtros.cliente_id ? Number(filtros.cliente_id) : null,
          forma_cobranca_id: filtros.forma_cobranca_id ? Number(filtros.forma_cobranca_id) : null,
          lancamento_ids: ids,
        },
      });
      alertBox(`${resultado.total_titulos} título(s) emitido(s) no lote #${resultado.emissao_id}.`, "ok");
      state.cobranca.emissaoSelecionados = new Set();
      await Promise.all([buscarTitulosEmissaoLote({ selecionarTodos: true }), carregarHistoricoEmissoesLotes()]);
    } catch (err) {
      alertBox(`Erro ao emitir títulos: ${err.message}`, "danger");
      atualizarResumoSelecaoEmissao();
    }
  }

  async function abrirDetalhesEmissaoLote(emissaoId) {
    const modal = $("#modal-emissao-lote-detalhes");
    if (!modal) return;
    setTable("tbody-emissao-lote-detalhes", 6, "", "Carregando títulos...");
    abrirModal("#modal-emissao-lote-detalhes");
    try {
      const data = await request(`/api/financeiro/cobrancas/emissoes-lotes/${emissaoId}/itens`);
      const emissao = data.emissao || {};
      const titulo = $("#modal-emissao-lote-titulo");
      const subtitulo = $("#modal-emissao-lote-subtitulo");
      if (titulo) titulo.textContent = `Emissão #${emissao.id || emissaoId}`;
      if (subtitulo) subtitulo.textContent = `${dateBR(emissao.data_emissao)} • vencimentos de ${dateBR(emissao.periodo_inicio)} a ${dateBR(emissao.periodo_fim)} • ${Number(emissao.total_titulos || 0)} título(s)`;
      const items = data.items || [];
      setTable("tbody-emissao-lote-detalhes", 6, items.map(i => `<tr>
        <td>${escapeHtml(i.cliente_nome || "Cliente não identificado")}</td>
        <td>${escapeHtml(i.descricao || `Título #${i.lancamento_id}`)}${i.documento ? `<small>${escapeHtml(i.documento)}</small>` : ""}</td>
        <td>${dateBR(i.data_vencimento)}</td>
        <td>${escapeHtml(i.forma_cobranca_nome || "Não informada")}</td>
        <td class="financeiro-amount">${money(i.valor_titulo || 0)}</td>
        <td class="financeiro-amount">${money(i.saldo_emitido || 0)}</td>
      </tr>`).join(""), "Este lote não possui títulos registrados.");
    } catch (err) {
      setTable("tbody-emissao-lote-detalhes", 6, "", `Erro ao carregar o lote: ${err.message}`);
    }
  }

  function renderStatusAutomacaoCobranca(data) {
    state.cobranca.automacao = data || null;
    const statusEl = $("#cobranca-automacao-status");
    if (statusEl) {
      const ativo = Boolean(data?.automacao_ativa);
      statusEl.textContent = ativo ? `Ativa • a cada ${Math.max(1, Math.round(Number(data?.intervalo_segundos || 300) / 60))} min` : "Desativada";
      statusEl.classList.toggle("is-active", ativo);
      statusEl.classList.toggle("is-disabled", !ativo);
    }

    [["email", data?.email], ["sms", data?.sms]].forEach(([name, provider]) => {
      const el = $(`#cobranca-provider-${name}`);
      if (!el) return;
      const ok = Boolean(provider?.configurado);
      el.textContent = ok ? "Configurado" : "Não configurado";
      el.classList.toggle("is-ok", ok);
      el.classList.toggle("is-missing", !ok);
    });

    const whatsapp = data?.whatsapp || {};
    const whatsappEl = $("#cobranca-provider-whatsapp");
    const whatsappDetail = $("#cobranca-provider-whatsapp-detail");
    if (whatsappEl) {
      const configurado = Boolean(whatsapp.configurado);
      const pareado = Boolean(whatsapp.pareado);
      const temInstancia = Boolean(whatsapp.instancia_id);
      const conectada = Boolean(whatsapp.instancia_connected);
      if (configurado) whatsappEl.textContent = "Pronto para enviar";
      else if (!pareado) whatsappEl.textContent = "ZapsChat não conectado";
      else if (!temInstancia) whatsappEl.textContent = "Escolha o WhatsApp";
      else if (!conectada) whatsappEl.textContent = "WhatsApp desconectado";
      else whatsappEl.textContent = "Requer atenção";
      whatsappEl.classList.toggle("is-ok", configurado);
      whatsappEl.classList.toggle("is-missing", !configurado);
    }
    if (whatsappDetail) {
      const label = whatsapp.instancia_apelido || "WhatsApp de cobrança";
      const numero = whatsapp.instancia_numero ? formatPhoneBRDisplay(whatsapp.instancia_numero) : "";
      if (whatsapp.configurado) whatsappDetail.textContent = `${label}${numero ? ` • ${numero}` : ""}`;
      else if (whatsapp.pareado && whatsapp.instancia_id && !whatsapp.instancia_connected) whatsappDetail.textContent = `${label}${numero ? ` • ${numero}` : ""} • reconecte no ZapsChat`;
      else if (whatsapp.pareado) whatsappDetail.textContent = "Conectado ao ZapsChat; falta selecionar uma instância";
      else whatsappDetail.textContent = "Configure o WhatsApp em Configurações do Financeiro";
    }

    const emailDetail = $("#cobranca-provider-email-detail");
    if (emailDetail) emailDetail.textContent = data?.email?.configurado ? `${data.email.host || "SMTP"} • ${data.email.remetente || "remetente configurado"}` : "Configure o e-mail de saída no servidor";
    const ultima = $("#cobranca-ultima-tentativa");
    if (ultima) ultima.textContent = dateTimeBR(data?.fila?.ultima_tentativa);
    const ultimoEnvio = $("#cobranca-ultimo-envio");
    if (ultimoEnvio) ultimoEnvio.textContent = data?.fila?.ultimo_envio_automatico ? `Último envio: ${dateTimeBR(data.fila.ultimo_envio_automatico)}` : "Nenhum envio automático registrado";
  }

  function setZapsChatModalStatus(message, tone = "") {
    const el = $("#zapschat-modal-status");
    if (!el) return;
    el.textContent = message || "";
    el.classList.toggle("is-ok", tone === "ok");
    el.classList.toggle("is-error", tone === "error");
  }

  function setZapsChatBusy(busy) {
    state.cobranca.zapschat.busy = Boolean(busy);
    [
      "#btn-parear-zapschat", "#btn-atualizar-instancias-zapschat", "#btn-testar-zapschat",
      "#btn-salvar-instancia-zapschat", "#btn-desconectar-zapschat", "#zapschat-instancia-select",
    ].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      if (busy) el.disabled = true;
      else if (!el.dataset.forceDisabled) el.disabled = false;
    });
  }

  function instanciaLabelZapsChat(item) {
    const nome = item?.apelido || item?.instance_name || "WhatsApp";
    const numero = item?.numero_instancia ? formatPhoneBRDisplay(item.numero_instancia) : "número não informado";
    return `${nome} — ${numero}`;
  }

  function atualizarPreviewInstanciaZapsChat() {
    const select = $("#zapschat-instancia-select");
    const preview = $("#zapschat-instancia-preview");
    const save = $("#btn-salvar-instancia-zapschat");
    if (!select || !preview) return;
    const id = Number(select.value || 0);
    const item = state.cobranca.zapschat.instancias.find(i => Number(i.id) === id);
    const pode = Boolean(state.cobranca.zapschat.config?.pode_configurar);
    if (!item) {
      preview.innerHTML = `<i class="fa-brands fa-whatsapp"></i><div><span>Selecione um WhatsApp acima</span><strong>Nenhuma instância escolhida</strong><small>O Valora não fará disparos até uma instância conectada ser salva.</small></div>`;
      if (save) save.disabled = true;
      return;
    }
    const connected = Boolean(item.connected);
    preview.innerHTML = `<i class="fa-brands fa-whatsapp"></i><div><span>${connected ? "Instância conectada" : "Instância desconectada"}</span><strong>${escapeHtml(item.apelido || item.instance_name || "WhatsApp")}</strong><small>${escapeHtml(formatPhoneBRDisplay(item.numero_instancia))}${connected ? " • pronta para uso" : " • conecte este número no ZapsChat antes de salvar"}</small></div><span class="zapschat-status-pill ${connected ? "is-ok" : "is-error"}">${connected ? "Conectada" : "Desconectada"}</span>`;
    if (save) save.disabled = !pode || !connected || state.cobranca.zapschat.busy;
  }

  function renderConfiguracaoZapsChat(config = {}, instancias = null) {
    state.cobranca.zapschat.config = config || {};
    if (Array.isArray(instancias)) state.cobranca.zapschat.instancias = instancias;

    const loading = $("#zapschat-config-loading");
    const disconnected = $("#zapschat-pane-desconectado");
    const connected = $("#zapschat-pane-conectado");
    const readonly = $("#zapschat-config-readonly");
    const warning = $("#zapschat-servidor-warning");
    if (loading) loading.hidden = true;
    if (readonly) readonly.hidden = Boolean(config?.pode_configurar);
    if (warning) warning.hidden = Boolean(config?.configurado_servidor);

    const pareado = Boolean(config?.pareado);
    if (disconnected) disconnected.hidden = pareado;
    if (connected) connected.hidden = !pareado;

    const pairInput = $("#zapschat-pairing-code");
    const pairBtn = $("#btn-parear-zapschat");
    const manager = Boolean(config?.pode_configurar);
    const pairAllowed = manager && Boolean(config?.configurado_servidor);
    if (pairInput) pairInput.disabled = !pairAllowed;
    if (pairBtn) pairBtn.disabled = !pairAllowed;

    const configureBtn = $("#btn-configurar-zapschat-cobranca");
    if (configureBtn) configureBtn.innerHTML = `<i class="fa-brands fa-whatsapp"></i> ${manager ? "Configurar WhatsApp" : "Ver WhatsApp"}`;

    if (!pareado) {
      setZapsChatModalStatus(config?.configurado_servidor ? "Aguardando o código de conexão do ZapsChat." : "Integração com ZapsChat ainda não habilitada neste servidor.", config?.configurado_servidor ? "" : "error");
      return;
    }

    const company = $("#zapschat-empresa-conectada");
    const detail = $("#zapschat-conexao-detalhe");
    if (company) company.textContent = config?.zapschat_empresa_nome || "Empresa conectada";
    if (detail) detail.textContent = config?.pareado_em ? `Conectado em ${dateTimeBR(config.pareado_em)}` : "Conexão protegida ativa";

    const select = $("#zapschat-instancia-select");
    if (select) {
      const items = state.cobranca.zapschat.instancias || [];
      if (!manager && items.length === 0 && config?.instancia_id) {
        select.innerHTML = `<option value="${Number(config.instancia_id)}" selected>${escapeHtml(`${config.instancia_apelido || config.instancia_nome || "WhatsApp"} — ${formatPhoneBRDisplay(config.instancia_numero)}`)}</option>`;
      } else if (items.length === 0) {
        select.innerHTML = `<option value="">Nenhuma instância encontrada</option>`;
      } else {
        select.innerHTML = `<option value="">Selecione o WhatsApp de cobrança</option>` + items.map(item => {
          const selected = Number(item.id) === Number(config?.instancia_id) ? " selected" : "";
          const disabled = item.connected ? "" : " disabled";
          const suffix = item.connected ? "Conectada" : "Desconectada";
          return `<option value="${Number(item.id)}"${selected}${disabled}>${escapeHtml(instanciaLabelZapsChat(item))} — ${suffix}</option>`;
        }).join("");
        if (!config?.instancia_id) {
          const connectedItems = items.filter(i => i.connected);
          if (connectedItems.length === 1) select.value = String(connectedItems[0].id);
        }
      }
      select.disabled = !manager || state.cobranca.zapschat.busy;
    }

    ["#btn-atualizar-instancias-zapschat", "#btn-testar-zapschat", "#btn-desconectar-zapschat"].forEach(sel => {
      const el = $(sel);
      if (el) el.disabled = !manager || state.cobranca.zapschat.busy;
    });
    const danger = $("#zapschat-danger-zone");
    if (danger) danger.hidden = !manager;
    atualizarPreviewInstanciaZapsChat();

    if (config?.ultimo_erro) setZapsChatModalStatus(`Atenção: ${config.ultimo_erro}`, "error");
    else if (config?.instancia_id && config?.instancia_connected) setZapsChatModalStatus("Integração pronta. As cobranças usarão somente o WhatsApp selecionado.", "ok");
    else if (config?.instancia_id) setZapsChatModalStatus("A instância salva está desconectada. Reconecte-a no ZapsChat e teste novamente.", "error");
    else setZapsChatModalStatus("Conexão concluída. Escolha agora qual WhatsApp será usado nas cobranças.");
  }

  async function carregarConfiguracaoZapsChat({ carregarInstancias = false } = {}) {
    const config = await request("/api/integracoes/zapschat/configuracao");
    state.cobranca.zapschat.config = config;
    let items = state.cobranca.zapschat.instancias;
    if (config?.pareado && config?.pode_configurar && carregarInstancias) {
      const data = await request("/api/integracoes/zapschat/instancias");
      items = data?.instancias || [];
      state.cobranca.zapschat.instancias = items;
      const refreshed = await request("/api/integracoes/zapschat/configuracao");
      state.cobranca.zapschat.config = refreshed;
      renderConfiguracaoZapsChat(refreshed, items);
      return refreshed;
    }
    renderConfiguracaoZapsChat(config, items);
    return config;
  }

  async function abrirConfiguracaoZapsChat() {
    abrirModal("#modal-zapschat-cobranca");
    const loading = $("#zapschat-config-loading");
    if (loading) loading.hidden = false;
    setZapsChatModalStatus("Verificando conexão...");
    try {
      await carregarConfiguracaoZapsChat({ carregarInstancias: true });
    } catch (err) {
      if (loading) loading.hidden = true;
      setZapsChatModalStatus(`Não foi possível carregar a integração: ${err.message}`, "error");
    }
  }

  async function parearZapsChat() {
    const input = $("#zapschat-pairing-code");
    const codigo = String(input?.value || "").replace(/\D+/g, "");
    if (codigo.length !== 8) {
      setZapsChatModalStatus("Digite os 8 números mostrados em Configurações → Valora CRM no ZapsChat.", "error");
      input?.focus();
      return;
    }
    setZapsChatBusy(true);
    setZapsChatModalStatus("Conectando com segurança ao ZapsChat...");
    try {
      const config = await request("/api/integracoes/zapschat/parear", { method: "POST", body: { codigo } });
      state.cobranca.zapschat.config = config;
      if (input) input.value = "";
      const data = await request("/api/integracoes/zapschat/instancias");
      state.cobranca.zapschat.instancias = data?.instancias || [];
      const refreshed = await request("/api/integracoes/zapschat/configuracao");
      renderConfiguracaoZapsChat(refreshed, state.cobranca.zapschat.instancias);
      setZapsChatModalStatus("ZapsChat conectado. Agora escolha o WhatsApp que será usado para cobranças e clique em Salvar.", "ok");
      await recarregar();
    } catch (err) {
      setZapsChatModalStatus(`Não foi possível conectar: ${err.message}`, "error");
    } finally {
      setZapsChatBusy(false);
      atualizarPreviewInstanciaZapsChat();
    }
  }

  async function atualizarInstanciasZapsChat() {
    setZapsChatBusy(true);
    setZapsChatModalStatus("Atualizando números do ZapsChat...");
    try {
      const data = await request("/api/integracoes/zapschat/instancias");
      state.cobranca.zapschat.instancias = data?.instancias || [];
      const config = await request("/api/integracoes/zapschat/configuracao");
      renderConfiguracaoZapsChat(config, state.cobranca.zapschat.instancias);
      setZapsChatModalStatus("Lista atualizada.", "ok");
    } catch (err) {
      setZapsChatModalStatus(`Erro ao atualizar instâncias: ${err.message}`, "error");
    } finally {
      setZapsChatBusy(false);
      atualizarPreviewInstanciaZapsChat();
    }
  }

  async function salvarInstanciaZapsChat() {
    const id = Number($("#zapschat-instancia-select")?.value || 0);
    const item = state.cobranca.zapschat.instancias.find(i => Number(i.id) === id);
    if (!item) {
      setZapsChatModalStatus("Selecione o WhatsApp que será usado para cobranças.", "error");
      return;
    }
    if (!item.connected) {
      setZapsChatModalStatus("Este WhatsApp está desconectado. Conecte-o no ZapsChat antes de salvar.", "error");
      return;
    }
    setZapsChatBusy(true);
    setZapsChatModalStatus("Salvando WhatsApp de cobrança...");
    try {
      const config = await request("/api/integracoes/zapschat/instancia", { method: "PUT", body: { instancia_id: id } });
      state.cobranca.zapschat.config = config;
      renderConfiguracaoZapsChat(config, state.cobranca.zapschat.instancias);
      setZapsChatModalStatus(`${instanciaLabelZapsChat(item)} definido como WhatsApp de cobrança.`, "ok");
      alertBox("WhatsApp de cobrança configurado com segurança.", "ok");
      await recarregar();
    } catch (err) {
      setZapsChatModalStatus(`Não foi possível salvar: ${err.message}`, "error");
    } finally {
      setZapsChatBusy(false);
      atualizarPreviewInstanciaZapsChat();
    }
  }

  async function testarZapsChat() {
    setZapsChatBusy(true);
    setZapsChatModalStatus("Testando a conexão sem enviar mensagem...");
    try {
      const data = await request("/api/integracoes/zapschat/testar", { method: "POST" });
      state.cobranca.zapschat.instancias = data?.instancias || state.cobranca.zapschat.instancias;
      const config = await request("/api/integracoes/zapschat/configuracao");
      renderConfiguracaoZapsChat(config, state.cobranca.zapschat.instancias);
      if (config?.instancia_id && config?.instancia_connected) setZapsChatModalStatus("Conexão testada. O WhatsApp selecionado está conectado e pronto para cobrança.", "ok");
      else if (config?.instancia_id) setZapsChatModalStatus("O ZapsChat respondeu, mas o WhatsApp selecionado está desconectado.", "error");
      else setZapsChatModalStatus("ZapsChat conectado. Falta escolher o WhatsApp de cobrança.");
      await recarregar();
    } catch (err) {
      setZapsChatModalStatus(`Falha no teste: ${err.message}`, "error");
    } finally {
      setZapsChatBusy(false);
      atualizarPreviewInstanciaZapsChat();
    }
  }

  async function desconectarZapsChat() {
    const ok = window.confirm("Desconectar o ZapsChat desta empresa?\n\nAs cobranças automáticas por WhatsApp serão interrompidas. O Valora não escolherá outro número automaticamente.");
    if (!ok) return;
    setZapsChatBusy(true);
    setZapsChatModalStatus("Revogando a conexão também no ZapsChat...");
    try {
      const config = await request("/api/integracoes/zapschat/configuracao", { method: "DELETE" });
      state.cobranca.zapschat.instancias = [];
      renderConfiguracaoZapsChat(config, []);
      setZapsChatModalStatus("ZapsChat desconectado. Nenhuma cobrança será enviada por WhatsApp até uma nova conexão.", "ok");
      alertBox("ZapsChat desconectado do Financeiro.", "ok");
      await recarregar();
    } catch (err) {
      setZapsChatModalStatus(`Não foi possível desconectar com segurança: ${err.message}`, "error");
    } finally {
      setZapsChatBusy(false);
    }
  }

  async function carregarCobrancas() {
    const [resumo, fila] = await Promise.all([
      request("/api/financeiro/cobrancas/resumo"),
      request(`/api/financeiro/cobrancas/fila${qs({ status: $("#filtro-cobranca-status") ? $("#filtro-cobranca-status").value : "pendente", acao: $("#filtro-cobranca-acao")?.value || "" })}`),
    ]);
    state.cobranca.fila = fila;
    state.items = fila;

    setKPI("cobranca-fila", String(Number(resumo.fila_pendente || 0)));
    setKPI("cobranca-vencidos", String(Number(resumo.titulos_vencidos || 0)));
    setKPI("cobranca-bloqueio", String(Number(resumo.a_bloquear || 0)));
    setKPI("cobranca-protesto", String(Number(resumo.a_protestar || 0)));

    setTable("tbody-cobranca-fila", 6, fila.map(i => {
      const status = String(i.status || "pendente").toLowerCase();
      const diasAtraso = Number(i.dias_atraso || 0);
      const canal = String(i.canal || "").toLowerCase();
      const contato = String(i.contato_destino || "").trim();
      const titulo = i.lancamento_descricao || `Título #${i.lancamento_id}`;
      const erro = String(i.erro || "").trim();
      const tentativas = Number(i.tentativas || 0);

      const statusMeta = status === "enviado"
        ? { cls: "is-ok", icon: "fa-circle-check", label: "Enviado" }
        : status === "erro"
          ? { cls: "is-error", icon: "fa-circle-exclamation", label: "Precisa corrigir" }
          : status === "ignorado"
            ? { cls: "is-muted", icon: "fa-circle-minus", label: "Ignorado" }
            : { cls: "is-wait", icon: "fa-clock", label: "Aguardando envio" };

      const canalIcon = canal === "whatsapp"
        ? "fa-brands fa-whatsapp"
        : canal === "email"
          ? "fa-regular fa-envelope"
          : "fa-regular fa-message";

      const canalNome = canal === "whatsapp"
        ? "WhatsApp"
        : canal === "email"
          ? "E-mail"
          : canal === "sms"
            ? "SMS"
            : (canal ? canal.replaceAll("_", " ") : "Não definido");

      const atrasoHtml = diasAtraso > 0
        ? `<small class="financeiro-cobranca-atraso">${diasAtraso} dia${diasAtraso === 1 ? "" : "s"} em atraso</small>`
        : `<small class="financeiro-cobranca-em-dia">Dentro do prazo</small>`;

      const erroHtml = erro
        ? `<div class="financeiro-cobranca-error-detail"><i class="fa-solid fa-circle-info"></i><span>${escapeHtml(erro)}</span></div>`
        : "";

      const contatoHtml = contato
        ? `<small>${escapeHtml(contato)}</small>`
        : `<small class="is-missing">Contato não cadastrado</small>`;

      return `<tr class="financeiro-cobranca-row ${statusMeta.cls}">
        <td>
          <div class="financeiro-cobranca-cliente">
            <strong>${escapeHtml(i.cliente_nome || "Cliente não identificado")}</strong>
            <span>${escapeHtml(titulo)}</span>
            ${i.documento ? `<small>Documento: ${escapeHtml(i.documento)}</small>` : ""}
          </div>
        </td>
        <td>
          <div class="financeiro-cobranca-vencimento">
            <strong>${dateBR(i.data_vencimento)}</strong>
            ${atrasoHtml}
          </div>
        </td>
        <td class="financeiro-amount"><strong>${money(i.saldo_aberto)}</strong></td>
        <td>
          <div class="financeiro-cobranca-etapa">
            <strong>${escapeHtml(i.etapa_nome || "Etapa não identificada")}</strong>
            <span>${escapeHtml(String(i.acao || "outro").replaceAll("_", " "))}</span>
          </div>
        </td>
        <td>
          <div class="financeiro-cobranca-canal">
            <span class="financeiro-cobranca-canal-icon"><i class="${canalIcon}"></i></span>
            <div><strong>${escapeHtml(canalNome)}</strong>${contatoHtml}</div>
          </div>
        </td>
        <td>
          <div class="financeiro-cobranca-status-box">
            <span class="financeiro-cobranca-status ${statusMeta.cls}"><i class="fa-solid ${statusMeta.icon}"></i>${statusMeta.label}</span>
            ${tentativas ? `<small>${tentativas} tentativa${tentativas === 1 ? "" : "s"}${i.provider ? ` • ${escapeHtml(i.provider)}` : ""}</small>` : ""}
            ${erroHtml}
            <div class="financeiro-cobranca-actions">
              ${status === "pendente" || status === "erro" ? `<button class="btn btn-secondary btn-sm" type="button" data-action="enviar-cobranca-agora" data-id="${i.id}"><i class="fa-solid fa-paper-plane"></i> ${status === "erro" ? "Tentar novamente" : "Enviar agora"}</button>` : ""}
              ${canal === "whatsapp" && i.cliente_id ? `<button class="financeiro-icon-action" type="button" data-action="abrir-cobranca-zapschat" data-id="${i.id}" title="Abrir conversa no ZapsChat" aria-label="Abrir conversa no ZapsChat"><i class="fa-brands fa-whatsapp"></i></button>` : ""}
              ${i.mensagem ? `<button class="financeiro-icon-action" type="button" data-action="copiar-cobranca-mensagem" data-id="${i.id}" title="Copiar mensagem" aria-label="Copiar mensagem"><i class="fa-regular fa-copy"></i></button>` : ""}
              ${status === "pendente" || status === "erro" ? `<button class="financeiro-link-action" type="button" data-action="ignorar-cobranca" data-id="${i.id}">Ignorar</button>` : ""}
            </div>
          </div>
        </td>
      </tr>`;
    }).join(""), "Nenhuma cobrança encontrada com estes filtros.");
    await Promise.all([
      carregarHistoricoEmissoesLotes(),
      buscarTitulosEmissaoLote({ selecionarTodos: state.cobranca.emissaoTitulos.length === 0 }),
    ]);
    setStatusText(`${fila.length} item(ns) na fila de cobrança • ${state.cobranca.emissaoTitulos.length} título(s) disponível(is) para emissão.`);
  }

  async function carregarAutomacaoCobranca() {
    const [reguas, automacao, zapschatConfig] = await Promise.all([
      request("/api/financeiro/reguas-cobranca"),
      request("/api/financeiro/cobrancas/automacao/status"),
      request("/api/integracoes/zapschat/configuracao"),
    ]);
    state.cobranca.reguas = reguas || [];
    state.cobranca.zapschat.config = zapschatConfig || {};
    renderStatusAutomacaoCobranca(automacao);

    setTable("tbody-cobranca-reguas", 6, (reguas || []).map(i => `<tr>
      <td>${escapeHtml(i.nome)}</td><td>${Number(i.etapas_ativas || 0)}</td><td>${i.padrao ? pill("Padrão") : "-"}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${escapeHtml(i.descricao || "-")}</td>
      <td><div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="selecionar-regua-cobranca" data-id="${i.id}"><i class="fa-solid fa-list-check"></i> Etapas</button><button class="financeiro-mini-btn" type="button" data-action="editar-regua-cobranca" data-id="${i.id}"><i class="fa-regular fa-pen-to-square"></i></button><button class="financeiro-mini-btn danger" type="button" data-action="excluir-regua-cobranca" data-id="${i.id}"><i class="fa-regular fa-trash-can"></i></button></div></td>
    </tr>`).join(""), "Nenhuma régua cadastrada.");

    const select = $("#cobranca-regua-etapas");
    if (select) {
      const atual = String(state.cobranca.reguaSelecionadaId || select.value || (reguas || []).find(i => i.padrao)?.id || (reguas || [])[0]?.id || "");
      select.innerHTML = '<option value="">Selecione uma régua...</option>' + (reguas || []).map(i => option(`${i.nome}${i.padrao ? " (padrão)" : ""}`, i.id)).join("");
      select.value = atual;
      await carregarEtapasCobranca(select.value);
    }
    setStatusText(`${(reguas || []).length} régua(s) configurada(s).`);
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

  function atualizarResumoRelatorioDocumento(chave, bloco = {}) {
    const resumo = bloco.resumo || {};
    const count = document.querySelector(`[data-report-count="${chave}"]`);
    const total = document.querySelector(`[data-report-total="${chave}"]`);
    if (count) count.textContent = `${Number(resumo.quantidade || 0)} título(s)`;
    if (total) total.textContent = money(resumo.valor_total || 0);
  }

  function linhaRelatorioDocumento(item, comAtraso = false) {
    return `<tr>
      <td>${escapeHtml(item.nome || "Cliente não identificado")}</td>
      <td>${dateBR(item.data_vencimento)}</td>
      <td class="financeiro-amount">${money(item.valor)}</td>
      <td>${escapeHtml(item.forma_recebimento || "Não informada")}</td>
      ${comAtraso ? `<td>${Number(item.dias_atraso || 0)} dia(s)</td>` : ""}
    </tr>`;
  }

  async function carregarConfiguracoesFinanceiras() {
    const data = await request("/api/financeiro/estrutura-base");
    const get = (path, fallback = 0) => path.split(".").reduce((acc, key) => acc?.[key], data) ?? fallback;
    const setBase = (key, principal, detalhe, alertas = 0) => {
      const card = document.querySelector(`[data-base-financeira="${key}"]`);
      if (!card) return;
      const main = card.querySelector("[data-base-principal]");
      const detail = card.querySelector("[data-base-detalhe]");
      const badge = card.querySelector("[data-base-alerta]");
      if (main) main.textContent = principal;
      if (detail) detail.textContent = detalhe;
      if (badge) {
        badge.hidden = !Number(alertas || 0);
        badge.textContent = Number(alertas || 0) ? `${Number(alertas)} pendência(s)` : "";
      }
    };

    setBase("contas-bancos", `${get("contas_bancos.ativas")} ativa(s)`, `${get("contas_bancos.total")} conta(s) cadastrada(s)`);
    setBase("centros-custo", `${get("centros_custo.ativos")} ativo(s)`, `${get("centros_custo.principais")} principal(is) • ${get("centros_custo.secundarios")} secundário(s)`);
    setBase("plano-contas", `${get("plano_contas.lancaveis")} lançável(is)`, `${get("plano_contas.total")} conta(s) • ${get("plano_contas.raizes")} raiz(es)`);
    setBase("classificacoes", `${get("classificacoes.categorias")} categoria(s)`, `${get("classificacoes.tipos_gasto")} tipo(s) de gasto • ${get("classificacoes.naturezas")} natureza(s)`);

    const pendRec = Number(get("contas_receber.sem_plano_contas")) + Number(get("contas_receber.sem_centro_custo")) + Number(get("contas_receber.sem_categoria"));
    setBase("contas-receber", `${get("contas_receber.em_aberto")} em aberto`, `${get("contas_receber.total")} título(s) • ${get("contas_receber.vencidos")} vencido(s)`, pendRec);

    const pendPag = Number(get("contas_pagar.sem_plano_contas")) + Number(get("contas_pagar.sem_centro_custo")) + Number(get("contas_pagar.sem_categoria"));
    setBase("contas-pagar", `${get("contas_pagar.em_aberto")} em aberto`, `${get("contas_pagar.total")} título(s) • ${get("contas_pagar.vencidos")} vencido(s)`, pendPag);

    const ultimo = get("fluxo_caixa.ultimo_movimento", null);
    setBase("fluxo-caixa", `${get("fluxo_caixa.movimentacoes")} movimento(s)`, ultimo ? `Último movimento em ${dateBR(ultimo)} • ${get("fluxo_caixa.contas_movimentadas")} conta(s)` : "Ainda sem movimentações financeiras");
    setStatusText("Base financeira mapeada.");
  }

  async function carregarRelatorios() {
    const query = qs(filtros());
    const [data, documento] = await Promise.all([
      request(`/api/financeiro/relatorios/resumo${query}`),
      request(`/api/financeiro/relatorios/cobranca${query}`),
    ]);

    const periodoLabel = $("#relatorios-periodo-label");
    if (periodoLabel && documento?.periodo) {
      periodoLabel.textContent = `Período: ${dateBR(documento.periodo.data_inicio)} a ${dateBR(documento.periodo.data_fim)}.`;
    }

    const relDefs = [
      ["titulos_emitidos", "tbody-rel-titulos-emitidos", false, "Nenhum título emitido no período."],
      ["titulos_pagos", "tbody-rel-titulos-pagos", false, "Nenhum título pago no período."],
      ["titulos_pagos_atraso", "tbody-rel-titulos-pagos-atraso", true, "Nenhum título pago com atraso no período."],
      ["titulos_em_atraso", "tbody-rel-titulos-em-atraso", true, "Nenhum título em atraso no período."],
      ["titulos_a_bloquear", "tbody-rel-titulos-a-bloquear", true, "Nenhum título aguardando bloqueio no período."],
      ["titulos_a_cartorio", "tbody-rel-titulos-a-cartorio", true, "Nenhum título aguardando envio a cartório no período."],
    ];
    let totalLinhasDocumento = 0;
    relDefs.forEach(([chave, tbody, comAtraso, vazio]) => {
      const bloco = documento?.[chave] || {};
      const lista = bloco.items || [];
      totalLinhasDocumento += lista.length;
      setTable(tbody, comAtraso ? 5 : 4, lista.map(i => linhaRelatorioDocumento(i, comAtraso)).join(""), vazio);
      atualizarResumoRelatorioDocumento(chave, bloco);
    });

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
    setStatusText(`${totalLinhasDocumento} linha(s) nos relatórios de cobrança do documento.`);
  }

  function acoesAuxiliar(item, tipo) {
    return `<div class="actions-cell"><button class="financeiro-mini-btn" type="button" data-action="editar-aux" data-tipo="${tipo}" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Editar</button><button class="financeiro-mini-btn danger" type="button" data-action="excluir-aux" data-tipo="${tipo}" data-id="${item.id}"><i class="fa-regular fa-trash-can"></i></button></div>`;
  }

  async function recarregar() {
    setStatusText("Carregando...");
    try {
      if (!new Set(["configuracoes", "automacao"]).has(state.page)) await carregarOpcoes();
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
      else if (state.page === "automacao") await carregarAutomacaoCobranca();
      else if (state.page === "configuracoes") await carregarConfiguracoesFinanceiras();
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
      else if (el.type === "radio") el.checked = String(el.value) === String(val);
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
      else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
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
    prepararLookupsEnvolvidos(form);
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
    sincronizarLookupsEnvolvidos(form, item);
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

  function sincronizarCentrosBaixa(form, preservar = true) {
    if (!form) return;
    const principal = form.querySelector('[data-centro-baixa="principal"]');
    const secundario = form.querySelector('[data-centro-baixa="secundario"]');
    if (!principal || !secundario) return;
    const atualPrincipal = preservar ? principal.value : "";
    const atualSecundario = preservar ? secundario.value : "";
    const centros = state.opcoes.centros_custo || [];
    const principais = centros.filter(i => !i.centro_pai_id);
    principal.innerHTML = '<option value="">Selecione...</option>' + principais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("");
    principal.value = principais.some(i => String(i.id) === String(atualPrincipal)) ? String(atualPrincipal) : "";
    const filhos = principal.value ? centros.filter(i => String(i.centro_pai_id || "") === String(principal.value)) : [];
    secundario.innerHTML = '<option value="">Opcional</option>' + filhos.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("");
    secundario.value = filhos.some(i => String(i.id) === String(atualSecundario)) ? String(atualSecundario) : "";
    secundario.disabled = !principal.value || filhos.length === 0;
  }

  function abrirBaixa(item) {
    const form = $("#form-baixa");
    if (!form) return;
    state.baixaAtual = item;
    state.baixaIdempotencyKey = novaChaveBaixa();
    form.reset();
    preencherSelects();
    const restante = Math.max(0, Number(item.valor_total || 0) - Number(item.valor_pago || 0));
    setForm(form, {
      id: item.id,
      valor_principal: formatMoneyForInput(restante, item.moeda || "BRL"),
      modalidade_baixa: "total",
      valor_desconto: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_acrescimo: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_multa: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_mora: formatMoneyForInput(0, item.moeda || "BRL"),
      encargos_automaticos: formatMoneyForInput(0, item.moeda || "BRL"),
      valor_total_baixa: formatMoneyForInput(restante, item.moeda || "BRL"),
      data_pagamento: todayISO(),
      forma_pagamento_id: item.forma_pagamento_id || "",
      conta_banco_id: item.conta_banco_id || "",
      conta_contabil_id: item.conta_contabil_id || "",
      centro_custo_principal_id: item.centro_custo_principal_id || "",
      centro_custo_secundario_id: item.centro_custo_secundario_id || "",
      reparcelar_saldo: "false",
      reparcelamento_saldo: formatMoneyForInput(0, item.moeda || "BRL"),
      reparcelamento_parcelas: "2",
      reparcelamento_primeiro_vencimento: addMonthsISO(todayISO(), 1),
      reparcelamento_intervalo_meses: "1",
      observacoes: "",
    });
    sincronizarCentrosBaixa(form, true);
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
    atualizarModalidadeBaixa();
    atualizarReparcelamentoBaixa();
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
      nosso_numero: data.nosso_numero || null,
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

  const UC_TIPOS_INTEGRADOS = new Set(["cargo", "colaborador", "patrimonio", "veiculo"]);

  function metaReferenciaUnidadeConsumo(tipo) {
    const t = String(tipo || "outro").toLowerCase();
    if (t === "cargo") return { label: "Identificação da U.C. (Subgrupo) — RH/Funções", placeholder: "Selecione uma função cadastrada no RH...", help: "A lista vem dos cargos/funções dos colaboradores cadastrados no RH." };
    if (t === "colaborador") return { label: "Identificação da U.C. (Subgrupo) — RH/Colaborador", placeholder: "Selecione um colaborador do RH...", help: "A lista vem diretamente dos colaboradores ativos da empresa." };
    if (t === "patrimonio") return { label: "Identificação da U.C. (Subgrupo) — Patrimônio", placeholder: "Selecione um patrimônio cadastrado...", help: "A lista vem diretamente do cadastro de Patrimônio." };
    if (t === "veiculo") return { label: "Identificação da U.C. (Subgrupo) — Patrimônio/Veículo", placeholder: "Selecione o veículo/patrimônio cadastrado...", help: "Veículos são vinculados ao cadastro real de Patrimônio." };
    return null;
  }

  function valorReferenciaUnidadeConsumo(item, tipo) {
    if (!item) return "";
    if (tipo === "cargo") return item.referencia_cargo || "";
    if (tipo === "colaborador") return item.referencia_usuario_id || "";
    if (tipo === "patrimonio" || tipo === "veiculo") return item.referencia_patrimonio_id || "";
    return "";
  }

  function aplicarReferenciaSelecionadaUnidadeConsumo(form) {
    if (!form) return;
    const tipo = form.querySelector('[name="tipo_referencia"]')?.value || "outro";
    const select = form.querySelector('[name="referencia_source"]');
    const nome = form.querySelector('[name="nome"]');
    const codigo = form.querySelector('[name="codigo"]');
    if (!UC_TIPOS_INTEGRADOS.has(tipo) || !select) return;
    const opt = select.selectedOptions?.[0];
    if (!opt || !select.value) {
      if (nome) nome.value = "";
      return;
    }
    if (nome) nome.value = opt.dataset.nome || opt.textContent || "";
    if (codigo && opt.dataset.codigo) codigo.value = opt.dataset.codigo;
  }

  async function configurarReferenciaUnidadeConsumo(form, item = null) {
    if (!form) return;
    const tipo = form.querySelector('[name="tipo_referencia"]')?.value || "outro";
    const wrapper = form.querySelector('[data-uc-reference-wrap]');
    const select = form.querySelector('[name="referencia_source"]');
    const label = form.querySelector('[data-uc-reference-label]');
    const help = form.querySelector('[data-uc-reference-help]');
    const nome = form.querySelector('[name="nome"]');
    const meta = metaReferenciaUnidadeConsumo(tipo);

    if (!wrapper || !select || !nome) return;
    if (!meta) {
      wrapper.hidden = true;
      select.required = false;
      select.innerHTML = '<option value="">Não se aplica</option>';
      nome.readOnly = false;
      nome.required = true;
      nome.closest('.financeiro-field')?.classList.remove('is-source-linked');
      return;
    }

    wrapper.hidden = false;
    select.required = true;
    nome.readOnly = true;
    nome.required = true;
    nome.closest('.financeiro-field')?.classList.add('is-source-linked');
    if (label) label.textContent = meta.label;
    if (help) help.textContent = meta.help;
    select.innerHTML = `<option value="">${escapeHtml(meta.placeholder)}</option><option value="" disabled>Carregando base...</option>`;

    try {
      const refs = await request(`/api/financeiro/unidades-consumo/referencias?tipo_referencia=${encodeURIComponent(tipo)}&limit=500`);
      const atual = String(valorReferenciaUnidadeConsumo(item, tipo) || "");
      const options = (refs || []).map(ref => {
        const value = tipo === "cargo" ? String(ref.chave || ref.nome || "") : String(ref.id || "");
        const desc = ref.descricao ? ` — ${ref.descricao}` : "";
        return `<option value="${escapeHtml(value)}" data-nome="${escapeHtml(ref.nome || "")}" data-codigo="${escapeHtml(ref.codigo || "")}">${escapeHtml(`${ref.codigo ? `${ref.codigo} - ` : ""}${ref.nome || ""}${desc}`)}</option>`;
      }).join("");
      select.innerHTML = `<option value="">${escapeHtml(meta.placeholder)}</option>${options}`;

      if (atual) {
        select.value = atual;
        if (select.value !== atual) {
          const fallbackNome = item?.identificacao_uc || item?.nome || atual;
          const fallbackCodigo = item?.referencia_codigo || item?.codigo || "";
          select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(atual)}" data-nome="${escapeHtml(fallbackNome)}" data-codigo="${escapeHtml(fallbackCodigo)}">${escapeHtml(fallbackNome)} — vínculo atual</option>`);
          select.value = atual;
        }
      }
      aplicarReferenciaSelecionadaUnidadeConsumo(form);
    } catch (err) {
      select.innerHTML = '<option value="">Não foi possível carregar a base de origem</option>';
      if (help) help.textContent = `Erro ao consultar a base integrada: ${err.message}`;
    }
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
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Data do cadastro</label><input name="data_cadastro" type="date" value="${todayISO()}" required></div><div class="financeiro-field"><label>Nome / identificação</label><input name="nome" required placeholder="Ex.: Banco Cora - Conta principal"></div><div class="financeiro-field"><label>Banco</label><input name="banco"></div><div class="financeiro-field"><label>Agência</label><input name="agencia"></div><div class="financeiro-field"><label>Conta corrente</label><input name="conta"></div><div class="financeiro-field"><label>Nome da agência</label><input name="nome_agencia"></div><div class="financeiro-field"><label>Fone</label><input name="telefone" inputmode="tel"></div><div class="financeiro-field"><label>Saldo inicial</label><input name="saldo_inicial" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off" placeholder="R$ 0,00"></div><div class="financeiro-field"><label>Data do saldo inicial</label><input name="data_saldo_inicial" type="date" value="${todayISO()}" required></div>${status}</div>`;
    } else if (tipo === "tipo-documento") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div>${aplicacao}<div class="financeiro-field"><label>Exige banco/entidade emissora?</label><select name="exige_entidade_emissora"><option value="false">Não</option><option value="true">Sim</option></select></div>${status}</div>`;
    } else if (tipo === "natureza") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div>${aplicacao}${status}</div>`;
    } else if (tipo === "tipo-gasto") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40" placeholder="Ex.: CUSTO"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required placeholder="Ex.: Custo, Despesa, Investimento"></div>${status}</div>`;
    } else if (tipo === "centro-custo") {
      const centrosCarregados = state.auxItems.filter(i => i._auxType === "centro-custo");
      const pais = (centrosCarregados.length ? centrosCarregados : (state.opcoes.centros_custo || [])).filter(i => Number(i.id) !== Number(item?.id) && !i.centro_pai_id);
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Centro principal/pai</label><select name="centro_pai_id"><option value="">Nenhum — centro principal</option>${pais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`, i.id)).join("")}</select></div>${status}</div>`;
    } else if (tipo === "unidade-consumo") {
      const unidadesCarregadas = state.auxItems.filter(i => i._auxType === "unidade-consumo");
      const pais = (unidadesCarregadas.length ? unidadesCarregadas : (state.opcoes.unidades_consumo || [])).filter(i => Number(i.id) !== Number(item?.id));
      body.innerHTML = `<div class="financeiro-form-grid cols-2">
        <div class="financeiro-field"><label>Código</label><input name="codigo" maxlength="40" placeholder="Pode vir automaticamente da origem"></div>
        <div class="financeiro-field"><label>Nome / identificação</label><input name="nome" required placeholder="Selecione a origem ou informe manualmente"></div>
        <div class="financeiro-field"><label>Tipo da Unidade de Consumo (Grupo)</label><select name="tipo_referencia"><option value="cargo">Cargo / Função (RH)</option><option value="patrimonio">Patrimônio</option><option value="colaborador">Colaborador (RH)</option><option value="veiculo">Veículo (Patrimônio)</option><option value="departamento">Departamento/área</option><option value="projeto">Projeto</option><option value="contrato">Contrato</option><option value="outro">Outro</option></select></div>
        <div class="financeiro-field"><label>Unidade principal/pai</label><select name="unidade_pai_id"><option value="">Nenhuma — unidade principal</option>${pais.map(i => option(`${i.codigo ? `${i.codigo} - ` : ""}${i.identificacao_uc || i.nome}`, i.id)).join("")}</select></div>
        <div class="financeiro-field full financeiro-reference-source" data-uc-reference-wrap hidden><label data-uc-reference-label>Identificação da U.C.</label><select name="referencia_source"><option value="">Selecione...</option></select><small data-uc-reference-help>Busca na base integrada.</small></div>
        <div class="financeiro-field full"><label>Observação complementar</label><input name="departamento_referencia" placeholder="Opcional. A identificação principal vem da base selecionada quando houver integração."></div>
        ${status}
      </div>`;
    } else if (tipo === "conta-contabil") {
      const contasCarregadas = state.auxItems.filter(i => i._auxType === "conta-contabil");
      const pais = (contasCarregadas.length ? contasCarregadas : (state.opcoes.contas_contabeis || [])).filter(i => Number(i.id) !== Number(item?.id));
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Código</label><input name="codigo" required maxlength="60" placeholder="Ex.: 3.1.01"></div><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><select name="tipo"><option value="ativo">Ativo</option><option value="passivo">Passivo</option><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="patrimonio">Patrimônio</option><option value="outros">Outros</option></select></div><div class="financeiro-field"><label>Conta pai</label><select name="conta_pai_id"><option value="">Nenhuma — conta raiz</option>${pais.map(i => option(`${'  '.repeat(Math.max(0, Number(i.nivel || 0)))}${i.codigo} - ${i.nome}`, i.id)).join("")}</select></div><div class="financeiro-field"><label>Aceita lançamentos?</label><select name="aceita_lancamento"><option value="true">Sim</option><option value="false">Não, apenas agrupadora</option></select></div>${status}</div>`;
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
    if (tipo === "unidade-consumo") configurarReferenciaUnidadeConsumo(form, item);
  }

  function prepararInterfaceFinanceiro() {
    const tabs = $(".financeiro-tabs");
    if (tabs) {
      const configuracaoPages = new Set(["categorias", "formas", "contas", "cadastros", "configuracoes", "automacao"]);
      const activeKey = configuracaoPages.has(state.page) ? "configuracoes" : state.page;
      const items = [
        ["dashboard", "/financeiro", "fa-regular fa-clipboard", "Visão geral"],
        ["acompanhamento", "/acompanhamento-financeiro", "fa-solid fa-chart-line", "Acompanhamento"],
        ["receber", "/contas-receber", "fa-regular fa-calendar-check", "Contas a receber"],
        ["pagar", "/contas-pagar", "fa-regular fa-file-lines", "Contas a pagar"],
        ["cobrancas", "/cobrancas-financeiro", "fa-regular fa-bell", "Cobranças"],
        ["fluxo", "/fluxo-caixa", "fa-solid fa-wave-square", "Fluxo de caixa"],
        ["movimento-bancario", "/movimento-bancario", "fa-solid fa-building-columns", "Movimento bancário"],
        ["relatorios", "/relatorios-financeiros", "fa-regular fa-chart-bar", "Relatórios"],
        ["configuracoes", "/configuracoes-financeiras", "fa-solid fa-gear", "Configurações"],
      ];
      tabs.classList.add("financeiro-tabs--primary");
      tabs.innerHTML = items.map(([key, href, icon, label]) =>
        `<a href="${href}" class="${activeKey === key ? "active" : ""}"${activeKey === key ? ' aria-current="page"' : ""}><i class="${icon}"></i><span>${label}</span></a>`
      ).join("");
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
          <div class="financeiro-editor-card-head"><div><h4>Classificação financeira</h4><p>Cadastros padronizados do financeiro. A multa e a mora são calculadas automaticamente no momento da baixa.</p></div><a class="financeiro-inline-link" href="/configuracoes-financeiras">Gerenciar cadastros</a></div>
          <div class="financeiro-form-grid cols-3">
            <div class="financeiro-field"><label>Tipo de documento</label><select name="tipo_documento_id" data-select="tipos-documento"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Natureza da operação</label><select name="natureza_operacao_id" data-select="naturezas-operacao"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Tipo de gasto</label><select name="tipo_gasto_id" data-select="tipos-gasto"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Entidade emissora</label><select name="entidade_emissora_id" data-select="entidades-emissoras"><option value="">Selecione banco/conta...</option></select></div>
            <div class="financeiro-field"><label>Centro de custo principal</label><select name="centro_custo_principal_id" data-select="centros-custo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Centro de custo secundário</label><select name="centro_custo_secundario_id" data-select="centros-custo"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Plano de Contas</label><select name="conta_contabil_id" data-select="contas-contabeis"><option value="">Selecione...</option></select></div>
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
            <div class="financeiro-field"><label>Nosso número</label><input name="nosso_numero" maxlength="100" placeholder="Número bancário do título"></div>
            <div class="financeiro-field"><label>Parceiro / Comercial</label><input data-parceiro-comercial readonly placeholder="Vem do cadastro do cliente"></div>
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
          <input type="hidden" name="valor_multa" value="0">
          <input type="hidden" name="valor_mora" value="0">
          <div class="financeiro-baixa-resumo" id="financeiro-baixa-resumo"></div>
          <div class="financeiro-baixa-mode" role="group" aria-label="Tipo de baixa">
            <label><input type="radio" name="modalidade_baixa" value="total" checked><span><strong>Baixa total</strong><small>Quita todo o saldo do título.</small></span></label>
            <label><input type="radio" name="modalidade_baixa" value="parcial"><span><strong>Baixa parcial</strong><small>Recebe somente parte e mantém saldo aberto.</small></span></label>
          </div>
          <div class="financeiro-form-grid cols-2 financeiro-baixa-grid">
            <div class="financeiro-field"><label>Data do pagamento</label><input name="data_pagamento" type="date" required></div>
            <div class="financeiro-field"><label>Valor principal da baixa</label><input name="valor_principal" class="financeiro-money-input" data-money-input required inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Desconto</label><input name="valor_desconto" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Acréscimo</label><input name="valor_acrescimo" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off"></div>
            <div class="financeiro-field"><label>Encargos automáticos</label><input name="encargos_automaticos" class="financeiro-money-input" readonly aria-readonly="true"><small>Multa e mora, quando configuradas no título.</small></div>
            <div class="financeiro-field financeiro-total-baixa"><label>Valor pago</label><input name="valor_total_baixa" class="financeiro-money-input" readonly aria-readonly="true"></div>
            <div class="financeiro-field"><label>Forma de recebimento</label><select name="forma_pagamento_id" data-select="formas"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label data-baixa-conta-label>Conta Corrente / Banco</label><select name="conta_banco_id" data-select="contas"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field full financeiro-baixa-classificacao-title"><strong>Classificação do movimento</strong><span>Esses dados ficam registrados junto da baixa.</span></div>
            <div class="financeiro-field"><label>Plano de Contas</label><select name="conta_contabil_id" data-select="contas-contabeis"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Centro de Custo principal</label><select name="centro_custo_principal_id" data-select="centros-custo" data-centro-baixa="principal"><option value="">Selecione...</option></select></div>
            <div class="financeiro-field"><label>Centro de Custo secundário</label><select name="centro_custo_secundario_id" data-select="centros-custo" data-centro-baixa="secundario"><option value="">Opcional</option></select></div>
            <section class="financeiro-reparcelamento-box full" data-reparcelamento-box hidden>
              <div class="financeiro-reparcelamento-head">
                <div><strong>Parcelar o saldo restante?</strong><span>Use quando parte da conta for paga agora e o saldo precisar virar novas parcelas.</span></div>
                <select name="reparcelar_saldo"><option value="false">Não</option><option value="true">Sim</option></select>
              </div>
              <div class="financeiro-form-grid cols-2 financeiro-reparcelamento-grid">
                <div class="financeiro-field"><label>Valor saldo em aberto</label><input name="reparcelamento_saldo" class="financeiro-money-input" readonly aria-readonly="true"></div>
                <div class="financeiro-field"><label>Quantidade de novas parcelas</label><input name="reparcelamento_parcelas" type="number" min="2" max="120" value="2" disabled></div>
                <div class="financeiro-field"><label>Primeiro vencimento</label><input name="reparcelamento_primeiro_vencimento" type="date" disabled></div>
                <div class="financeiro-field"><label>Intervalo</label><select name="reparcelamento_intervalo_meses" disabled><option value="1">Mensal</option><option value="2">A cada 2 meses</option><option value="3">A cada 3 meses</option><option value="6">Semestral</option><option value="12">Anual</option></select></div>
              </div>
              <div class="financeiro-reparcelamento-info" data-reparcelamento-info>Não. O saldo que não for pago continuará aberto nesta mesma conta.</div>
            </section>
            <div class="financeiro-field full"><label>Histórico</label><textarea name="observacoes" rows="3" maxlength="1000" placeholder="Ex.: Recebido via PIX, referente à parcela 02/06"></textarea></div>
            <div class="financeiro-field full"><label>Comprovante (PDF, até 10 MB)</label><input name="comprovante" type="file" accept="application/pdf,.pdf"><small>Opcional. O arquivo fica vinculado à baixa.</small></div>
          </div>
          <div class="financeiro-baixa-regra" data-baixa-regra>Encargos serão calculados conforme a data do recebimento e as regras do título.</div>`;
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

    if (!$("#modal-estorno-baixa")) {
      document.body.insertAdjacentHTML("beforeend", `
        <div class="financeiro-modal-backdrop" id="modal-estorno-baixa" aria-hidden="true">
          <div class="financeiro-modal sm financeiro-modal-estorno">
            <form id="form-estorno-baixa">
              <input type="hidden" name="movimentacao_id">
              <input type="hidden" name="lancamento_id">
              <div class="financeiro-modal-head">
                <div class="financeiro-modal-title"><h3>Estornar recebimento</h3><p>O movimento original será preservado e o saldo será reaberto.</p></div>
                <button class="financeiro-close" type="button" data-close-modal><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div class="financeiro-modal-body">
                <div class="financeiro-alert warn"><i class="fa-solid fa-triangle-exclamation"></i><span>O estorno não apaga a baixa. Ele cria um movimento inverso para manter a auditoria financeira.</span></div>
                <div class="financeiro-form-grid cols-1">
                  <div class="financeiro-field"><label>Data do estorno</label><input name="data_estorno" type="date" required></div>
                  <div class="financeiro-field"><label>Motivo do estorno</label><textarea name="motivo" rows="4" maxlength="1000" required placeholder="Explique por que este recebimento está sendo estornado"></textarea></div>
                </div>
              </div>
              <div class="financeiro-modal-foot"><button class="btn btn-secondary" type="button" data-close-modal>Voltar</button><button class="btn btn-danger" type="submit"><i class="fa-solid fa-rotate-left"></i> Confirmar estorno</button></div>
            </form>
          </div>
        </div>`);
      $("#modal-estorno-baixa")?.addEventListener("click", ev => { if (ev.target.id === "modal-estorno-baixa") fecharModais(); });
      $$("[data-close-modal]", $("#modal-estorno-baixa")).forEach(btn => btn.addEventListener("click", fecharModais));
      $("#form-estorno-baixa")?.addEventListener("submit", salvarEstornoBaixa);
    }
  }

  function abrirEstornoMovimentacao(movimentacaoId, lancamentoId) {
    prepararInterfaceFinanceiro();
    state.estornoAtual = { movimentacaoId: Number(movimentacaoId), lancamentoId: Number(lancamentoId) };
    const form = $("#form-estorno-baixa");
    if (!form) return;
    form.reset();
    const idInput = form.querySelector('[name="movimentacao_id"]');
    const lancInput = form.querySelector('[name="lancamento_id"]');
    const dataInput = form.querySelector('[name="data_estorno"]');
    if (idInput) idInput.value = String(movimentacaoId);
    if (lancInput) lancInput.value = String(lancamentoId);
    if (dataInput) dataInput.value = todayISO();
    abrirModal("#modal-estorno-baixa");
  }

  async function salvarEstornoBaixa(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = getForm(form);
    const motivo = String(data.motivo || "").trim();
    if (!motivo) return alertBox("Informe o motivo do estorno.", "danger");
    try {
      await request(`/api/financeiro/movimentacoes/${data.movimentacao_id}/estornar`, {
        method: "PATCH",
        body: { motivo, data_estorno: data.data_estorno || null },
      });
      const lancamentoId = Number(data.lancamento_id || state.estornoAtual?.lancamentoId || 0);
      fecharModais();
      state.estornoAtual = null;
      alertBox("Estorno registrado. O saldo do título foi reaberto conforme a baixa estornada.", "ok");
      await recarregar();
      if (lancamentoId) await abrirHistorico(lancamentoId);
    } catch (err) {
      alertBox(`Erro ao estornar: ${err.message}`, "danger");
    }
  }

  function renderHistorico(data) {
    const host = $("#historico-financeiro-conteudo");
    if (!host) return;
    const lancamento = data.lancamento || {};
    const movimentos = Array.isArray(data.movimentacoes) ? data.movimentacoes : [];
    const auditoria = Array.isArray(data.auditoria) ? data.auditoria : [];
    const reparcelamentos = Array.isArray(data.reparcelamentos) ? data.reparcelamentos : [];
    const reparcelamentoOrigem = data.reparcelamento_origem || null;
    const saldo = Number(lancamento.valor_total || 0) - Number(lancamento.valor_pago || 0);
    $("#historico-financeiro-titulo").textContent = `Histórico do lançamento #${lancamento.id || "-"}`;

    const movHtml = movimentos.length ? movimentos.map(m => {
      const estorno = String(m.tipo_movimentacao).toLowerCase() === "estorno";
      const podeEstornar = !estorno && !m.estornada && !m.reparcelamento_ativo;
      const principal = Number(m.valor_principal || m.valor || 0);
      const desconto = Number(m.valor_desconto || 0);
      const acrescimo = Number(m.valor_acrescimo || 0);
      const multa = Number(m.valor_multa || 0);
      const mora = Number(m.valor_mora || 0);
      const comprovante = m.comprovante_url
        ? `<a class="financeiro-comprovante-link" href="${escapeHtml(m.comprovante_url)}" target="_blank" rel="noopener"><i class="fa-regular fa-file-pdf"></i> ${escapeHtml(m.comprovante_nome || "Abrir comprovante")}</a>`
        : "";
      return `<div class="financeiro-history-item ${estorno ? "is-estorno" : ""}">
        <div class="financeiro-history-icon"><i class="fa-solid ${estorno ? "fa-rotate-left" : "fa-check"}"></i></div>
        <div class="financeiro-history-main">
          <div class="financeiro-history-title"><strong>${estorno ? "Estorno" : (lancamento.tipo === "pagar" ? "Pagamento" : "Recebimento")}${!estorno && m.modalidade_baixa ? ` • ${escapeHtml(m.modalidade_baixa === "parcial" ? "Parcial" : "Total")}` : ""}</strong><span>${money(m.valor, lancamento.moeda)}</span></div>
          <div class="financeiro-history-meta">${dateBR(m.data_movimentacao)} • ${escapeHtml(m.usuario_nome || "Usuário não identificado")} • ${escapeHtml(m.conta_banco_nome || "Sem conta/banco")} • ${Number(m.dias_atraso || 0)} dia(s) de atraso</div>
          <div class="financeiro-history-classificacao"><span><b>Plano:</b> ${escapeHtml([m.conta_contabil_codigo, m.conta_contabil_nome].filter(Boolean).join(" - ") || "Não informado")}</span><span><b>Centro:</b> ${escapeHtml([m.centro_custo_principal_nome, m.centro_custo_secundario_nome].filter(Boolean).join(" › ") || "Não informado")}</span></div>
          <div class="financeiro-history-breakdown">
            <span>Principal <strong>${money(principal, lancamento.moeda)}</strong></span>
            <span>Desconto <strong>${money(desconto, lancamento.moeda)}</strong></span>
            <span>Acréscimo <strong>${money(acrescimo, lancamento.moeda)}</strong></span>
            <span>Multa <strong>${money(multa, lancamento.moeda)}</strong></span>
            <span>Mora <strong>${money(mora, lancamento.moeda)}</strong></span>
          </div>
          ${m.observacoes ? `<div class="financeiro-history-note">${escapeHtml(m.observacoes)}</div>` : ""}
          ${comprovante}
          ${m.efeito_caixa ? `<span class="financeiro-history-status">${m.efeito_caixa === "credito" ? "Crédito no caixa/conta" : "Débito no caixa/conta"}</span>` : ""}
          ${m.estornada ? '<span class="financeiro-history-status">Estornada</span>' : ""}
          ${m.reparcelamento_ativo ? '<span class="financeiro-history-status">Baixa vinculada a reparcelamento</span>' : ""}
        </div>
        ${podeEstornar ? `<button class="financeiro-mini-btn warn" type="button" data-action="estornar-movimentacao" data-id="${m.id}" data-lancamento-id="${lancamento.id}"><i class="fa-solid fa-rotate-left"></i> Estornar</button>` : ""}
      </div>`;
    }).join("") : '<div class="financeiro-empty-soft">Nenhuma baixa registrada.</div>';

    const auditHtml = auditoria.length ? auditoria.map(a => `<div class="financeiro-audit-item">
      <strong>${escapeHtml(String(a.acao || "ação").replaceAll("_", " "))}</strong>
      <span>${escapeHtml(a.usuario_nome || "Usuário não identificado")} • ${dateTimeBR(a.criado_em)}</span>
      ${a.motivo ? `<small>${escapeHtml(a.motivo)}</small>` : ""}
    </div>`).join("") : '<div class="financeiro-empty-soft">Nenhuma alteração registrada.</div>';

    const repCards = reparcelamentos.map(r => {
      let ids = r.lancamentos_gerados_ids;
      if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch (_) { ids = []; } }
      if (!Array.isArray(ids)) ids = [];
      return `<div class="financeiro-reparcelamento-history">
        <div><strong>Reparcelamento #${Number(r.id || 0)}</strong><span>${dateTimeBR(r.criado_em)} • ${escapeHtml(r.usuario_nome || "Usuário não identificado")}</span></div>
        <div class="financeiro-history-breakdown">
          <span>Valor original <strong>${money(r.valor_original, lancamento.moeda)}</strong></span>
          <span>Saldo transferido <strong>${money(r.saldo_reparcelado, lancamento.moeda)}</strong></span>
          <span>Novas parcelas <strong>${Number(r.quantidade_parcelas || 0)}</strong></span>
          <span>1º vencimento <strong>${dateBR(r.data_primeiro_vencimento)}</strong></span>
        </div>
        ${ids.length ? `<small>Títulos gerados: ${ids.map(id => `#${Number(id)}`).join(", ")}</small>` : ""}
      </div>`;
    });
    if (reparcelamentoOrigem) {
      repCards.unshift(`<div class="financeiro-reparcelamento-history is-origin">
        <div><strong>Parcela originada do reparcelamento #${Number(reparcelamentoOrigem.id || 0)}</strong><span>Conta original #${Number(reparcelamentoOrigem.lancamento_origem_id || 0)}</span></div>
        <small>Saldo original reparcelado: ${money(reparcelamentoOrigem.saldo_reparcelado, lancamento.moeda)} em ${Number(reparcelamentoOrigem.quantidade_parcelas || 0)} parcelas.</small>
      </div>`);
    }
    const repHtml = repCards.length ? `<section class="financeiro-history-section"><h4>Reparcelamento</h4>${repCards.join("")}</section>` : "";

    host.innerHTML = `
      <div class="financeiro-history-summary">
        <div><span>Total</span><strong>${money(lancamento.valor_total, lancamento.moeda)}</strong></div>
        <div><span>Baixado</span><strong>${money(lancamento.valor_pago, lancamento.moeda)}</strong></div>
        <div><span>Saldo aberto</span><strong>${money(Math.max(0, saldo), lancamento.moeda)}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(lancamento.status || "-")}</strong></div>
      </div>
      ${repHtml}
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
    const receber = String(tipo).toLowerCase() === "receber";
    const clienteLookup = elementosLookupEnvolvido(form, "cliente");
    if (receber && clienteLookup && !String(clienteLookup.select.value || "").trim()) {
      clienteLookup.search.setCustomValidity("Selecione o cliente na lista de resultados.");
      ativarNavegacaoModalLancamento("fin-sec-envolvidos");
      clienteLookup.search.reportValidity();
      clienteLookup.search.focus();
      return;
    }
    const fornecedorLookup = elementosLookupEnvolvido(form, "fornecedor");
    const sacado = elementosSacado(form);
    if (!receber && fornecedorLookup && !sacado && !String(fornecedorLookup.select.value || "").trim()) {
      fornecedorLookup.search.setCustomValidity("Selecione o fornecedor na lista de resultados.");
      ativarNavegacaoModalLancamento("fin-sec-envolvidos");
      fornecedorLookup.search.reportValidity();
      fornecedorLookup.search.focus();
      return;
    }
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
    const submitBtn = form.querySelector('button[type="submit"]');
    if (!state.baixaIdempotencyKey) state.baixaIdempotencyKey = novaChaveBaixa();
    if (submitBtn) submitBtn.disabled = true;
    try {
      const resultado = await request(`/api/financeiro/lancamentos/${data.id}/baixar`, { method: "PATCH", body: {
        idempotency_key: state.baixaIdempotencyKey,
        valor_principal: moneyToBackend(data.valor_principal),
        valor_desconto: moneyToBackend(data.valor_desconto || 0),
        valor_acrescimo: moneyToBackend(data.valor_acrescimo || 0),
        modalidade_baixa: data.modalidade_baixa || "total",
        usar_calculo_automatico: true,
        data_pagamento: data.data_pagamento,
        forma_pagamento_id: nullNumber(data.forma_pagamento_id),
        conta_banco_id: nullNumber(data.conta_banco_id),
        conta_contabil_id: nullNumber(data.conta_contabil_id),
        centro_custo_principal_id: nullNumber(data.centro_custo_principal_id),
        centro_custo_secundario_id: nullNumber(data.centro_custo_secundario_id),
        observacoes: data.observacoes || null,
        reparcelar_saldo: data.reparcelar_saldo === "true",
        reparcelamento_parcelas: data.reparcelar_saldo === "true" ? nullNumber(data.reparcelamento_parcelas) : null,
        reparcelamento_primeiro_vencimento: data.reparcelar_saldo === "true" ? (data.reparcelamento_primeiro_vencimento || null) : null,
        reparcelamento_intervalo_meses: data.reparcelar_saldo === "true" ? nullNumber(data.reparcelamento_intervalo_meses) : null,
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

      const recebimento = state.baixaAtual?.tipo === "receber";
      const moedaBaixa = state.baixaAtual?.moeda || "BRL";
      const nomeAcao = recebimento ? "Recebimento" : "Pagamento";
      const rep = resultado?.reparcelamento;
      fecharModais();
      state.baixaAtual = null;
      state.baixaIdempotencyKey = null;
      if (comprovanteErro) {
        const base = rep
          ? `${nomeAcao} registrado e saldo de ${money(rep.saldo_reparcelado, moedaBaixa)} reparcelado em ${rep.quantidade_parcelas} parcelas, mas o comprovante não foi anexado`
          : `${nomeAcao} registrado, mas o comprovante não foi anexado`;
        alertBox(`${base}: ${comprovanteErro.message}`, "warn");
      } else if (rep) {
        alertBox(`${nomeAcao} registrado. Saldo de ${money(rep.saldo_reparcelado, moedaBaixa)} reparcelado em ${rep.quantidade_parcelas} novas parcelas.`, "ok");
      } else {
        alertBox(arquivo ? `${nomeAcao} e comprovante registrados com sucesso.` : `${nomeAcao} registrado com sucesso.`, "ok");
      }
      await recarregar();
    } catch (err) {
      // Em erro de rede mantemos a mesma chave. Se o servidor já tiver gravado
      // a baixa, a retentativa retorna a movimentação original em vez de duplicar.
      alertBox(`Erro ao baixar: ${err.message}`, "danger");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
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
    if (tipo === "unidade-consumo") {
      const tipoRef = String(data.tipo_referencia || "outro").toLowerCase();
      const source = data.referencia_source || "";
      data.referencia_usuario_id = null;
      data.referencia_patrimonio_id = null;
      data.referencia_cargo = null;
      if (tipoRef === "cargo") data.referencia_cargo = source || null;
      if (tipoRef === "colaborador") data.referencia_usuario_id = nullNumber(source);
      if (tipoRef === "patrimonio" || tipoRef === "veiculo") data.referencia_patrimonio_id = nullNumber(source);
      delete data.referencia_source;
    }
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
      if (action === "editar-caixa") {
        const movimento = state.caixa.registros.find(i => i.origem === "manual" && Number(i.id) === id);
        if (movimento) abrirEdicaoCaixa(movimento);
        return;
      }
      if (action === "cancelar-caixa") {
        const movimento = state.caixa.registros.find(i => i.origem === "manual" && Number(i.id) === id);
        if (!movimento) return;
        const motivo = prompt("Informe o motivo do cancelamento do movimento:");
        if (!motivo?.trim()) return;
        await request(`/api/financeiro/caixa/movimentos/${id}/cancelar`, { method: "PATCH", body: { motivo: motivo.trim() } });
        alertBox("Movimento de caixa cancelado.", "ok");
        await carregarFluxo();
        return;
      }
      if (action === "detalhes-receber" && item) { selecionarReceber(item.id, true); return; }
      if (action === "detalhes-pagar" && item) { selecionarPagar(item.id, true); return; }
      if (action === "boleto-titulo") { await abrirBoleto(id); return; }
      if (action === "boleto-emitir") { await operarBoleto("emitir"); return; }
      if (action === "boleto-atualizar") { await operarBoleto("atualizar"); return; }
      if (action === "boleto-conciliar") { await operarBoleto("conciliar"); return; }
      if (action === "conciliar-boleto") { await abrirBoleto(id); return; }
      if (action === "boleto-copiar-linha") { await copiarTextoBoleto(state.boletoAtual?.cobranca?.identification_field, "Linha digitável"); return; }
      if (action === "boleto-copiar-pix") { await copiarTextoBoleto(state.boletoAtual?.cobranca?.pix_payload, "Pix"); return; }
      if (action === "copiar-conciliacao-linha" || action === "copiar-conciliacao-pix") {
        const linha = state.receberConciliacao.find(i => Number(i.lancamento_id) === id);
        await copiarTextoBoleto(action.endsWith("pix") ? linha?.pix_payload : linha?.identification_field, action.endsWith("pix") ? "Pix" : "Linha digitável");
        return;
      }
      if (action === "editar-lancamento" && item) abrirLancamento(item.tipo, item);
      if (action === "baixar-lancamento" && item) abrirBaixa(item);
      if (action === "historico-lancamento") await abrirHistorico(id);
      if (action === "estornar-movimentacao") {
        abrirEstornoMovimentacao(id, Number(btn.dataset.lancamentoId));
        return;
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
      if (action === "ver-emissao-lote") {
        await abrirDetalhesEmissaoLote(id);
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
      if (action === "enviar-cobranca-agora") {
        const resultado = await request(`/api/financeiro/cobrancas/envios/${id}/enviar-agora`, { method: "POST" });
        if (resultado?.status === "enviado") alertBox(`Cobrança enviada por ${resultado.canal || "canal configurado"}.`, "ok");
        else if (resultado?.status === "ignorado") alertBox("Título já foi quitado/cancelado e a cobrança foi ignorada.", "warn");
        else alertBox(resultado?.erro ? `Falha no envio: ${resultado.erro}` : "Envio não concluído.", "danger");
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
    let rows = [];
    if (state.page === "relatorios") {
      const periodo = `${dateBR($("#filtro-data-inicio")?.value || monthStartISO())} a ${dateBR($("#filtro-data-fim")?.value || todayISO())}`;
      rows.push('"Relatórios Financeiros - Cobrança"', `"Período: ${periodo}"`, "");
      $$('[data-relatorio-pdf]').forEach(panel => {
        const titulo = panel.querySelector("h3")?.innerText?.trim() || "Relatório";
        const table = panel.querySelector("table");
        rows.push(`"${titulo.replace(/"/g, '""')}"`);
        if (table) rows.push(...$$("tr", table).map(tr => $$("th,td", tr).map(td => `"${td.innerText.replace(/"/g, '""').trim()}"`).join(";")));
        rows.push("");
      });
    } else {
      const table = $("#financeiro-table");
      if (!table) return;
      rows = $$("tr", table).map(tr => $$("th,td", tr).map(td => `"${td.innerText.replace(/"/g, '""').trim()}"`).join(";"));
    }
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
    prepararLookupsEnvolvidos();
    if (state.page === "receber") {
      // Contas a Receber deve abrir mostrando toda a carteira.
      // O filtro antigo (Aberto + mês atual) escondia títulos históricos,
      // inclusive os importados do JCC de 2020.
      const status = $("#filtro-status");
      if (status) status.value = "todos";
      const inicio = $("#filtro-data-inicio");
      const fim = $("#filtro-data-fim");
      if (inicio) inicio.value = "";
      if (fim) fim.value = "";
      $$('[data-receber-status]').forEach(btn =>
        btn.classList.toggle("is-active", btn.dataset.receberStatus === "todos")
      );
    }
    if (state.page === "pagar") {
      const status = $("#filtro-status");
      if (status && !status.value) status.value = "aberto";
      const periodo = $("#filtro-periodo-por");
      if (periodo && !periodo.value) periodo.value = "vencimento";
      const inicio = $("#filtro-data-inicio");
      const fim = $("#filtro-data-fim");
      if (inicio && !inicio.value) inicio.value = monthStartISO();
      if (fim && !fim.value) fim.value = todayISO();
      $$('[data-pagar-status]').forEach(btn => btn.classList.toggle("is-active", btn.dataset.pagarStatus === (status?.value || "aberto")));
    }
    if (state.page === "fluxo") {
      const inicio = $("#filtro-data-inicio");
      const fim = $("#filtro-data-fim");
      if (inicio && !inicio.value) inicio.value = monthStartISO();
      if (fim && !fim.value) fim.value = todayISO();
      resetarEdicaoCaixa();
    }
    if (state.page === "relatorios") {
      const inicio = $("#filtro-data-inicio");
      const fim = $("#filtro-data-fim");
      if (inicio && !inicio.value) inicio.value = monthStartISO();
      if (fim && !fim.value) fim.value = todayISO();
    }
    if (state.page === "cobrancas") {
      const inicio = $("#emissao-data-inicio");
      const fim = $("#emissao-data-fim");
      if (inicio && !inicio.value) inicio.value = monthStartISO();
      if (fim && !fim.value) fim.value = todayISO();
    }
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
      ["#filtro-busca", "#filtro-status", "#filtro-data-inicio", "#filtro-data-fim", "#filtro-cliente", "#filtro-fornecedor", "#filtro-forma-cobranca", "#filtro-forma-pagamento", "#filtro-categoria", "#filtro-documento", "#filtro-periodo-por", "#filtro-conta-contabil", "#filtro-centro-custo", "#filtro-caixa-conta"].forEach(sel => { const el = $(sel); if (el) el.value = ""; });
      if (state.page === "receber") {
        if ($("#filtro-status")) $("#filtro-status").value = "todos";
        if ($("#filtro-periodo-por")) $("#filtro-periodo-por").value = "vencimento";
        if ($("#filtro-data-inicio")) $("#filtro-data-inicio").value = "";
        if ($("#filtro-data-fim")) $("#filtro-data-fim").value = "";
        $$('[data-receber-status]').forEach(btn => btn.classList.toggle("is-active", btn.dataset.receberStatus === "todos"));
      }
      if (state.page === "pagar") {
        if ($("#filtro-status")) $("#filtro-status").value = "aberto";
        if ($("#filtro-periodo-por")) $("#filtro-periodo-por").value = "vencimento";
        if ($("#filtro-data-inicio")) $("#filtro-data-inicio").value = monthStartISO();
        if ($("#filtro-data-fim")) $("#filtro-data-fim").value = todayISO();
        $$('[data-pagar-status]').forEach(btn => btn.classList.toggle("is-active", btn.dataset.pagarStatus === "aberto"));
      }
      if (state.page === "fluxo") {
        if ($("#filtro-data-inicio")) $("#filtro-data-inicio").value = monthStartISO();
        if ($("#filtro-data-fim")) $("#filtro-data-fim").value = todayISO();
        if ($("#filtro-caixa-conta")) $("#filtro-caixa-conta").value = "";
      }
      if (state.page === "relatorios") {
        const inicio = $("#filtro-data-inicio");
        const fim = $("#filtro-data-fim");
        if (inicio) inicio.value = monthStartISO();
        if (fim) fim.value = todayISO();
      }
      recarregar();
    });
    $("#btn-exportar-financeiro")?.addEventListener("click", exportarTabela);
    $$('[data-receber-tab]').forEach(btn => btn.addEventListener("click", () => ativarAbaReceber(btn.dataset.receberTab)));
    $$('[data-pagar-tab]').forEach(btn => btn.addEventListener("click", () => ativarAbaPagar(btn.dataset.pagarTab)));
    $$('[data-pagar-status]').forEach(btn => btn.addEventListener("click", async () => {
      $$('[data-pagar-status]').forEach(other => other.classList.toggle("is-active", other === btn));
      const status = $("#filtro-status");
      if (status) status.value = btn.dataset.pagarStatus || "aberto";
      state.pagarTab = "registros";
      await carregarPagar().catch(err => alertBox(`Erro ao carregar contas a pagar: ${err.message}`, "danger"));
    }));
    $$('[data-receber-status]').forEach(btn => btn.addEventListener("click", async () => {
      const value = btn.dataset.receberStatus || "aberto";
      const select = $("#filtro-status");
      if (select) select.value = value;
      $$('[data-receber-status]').forEach(item => item.classList.toggle("is-active", item === btn));
      state.receberSelecionadoId = null;
      await recarregar();
    }));
    $("#btn-atualizar-conciliacao")?.addEventListener("click", () => carregarConciliacaoReceber().catch(err => alertBox(`Erro na conciliação: ${err.message}`, "danger")));
    $("#tbody-receber")?.addEventListener("click", ev => {
      if (ev.target.closest("button,a,input,select")) return;
      const row = ev.target.closest("[data-receber-row-id]");
      if (row) selecionarReceber(row.dataset.receberRowId, false);
    });
    $("#tbody-pagar")?.addEventListener("click", ev => {
      if (ev.target.closest("button,a,input,select")) return;
      const row = ev.target.closest("[data-pagar-row-id]");
      if (row) selecionarPagar(row.dataset.pagarRowId, false);
    });
    $$('[data-caixa-tab]').forEach(btn => btn.addEventListener("click", () => ativarAbaCaixa(btn.dataset.caixaTab)));
    $("#btn-novo-movimento-caixa")?.addEventListener("click", () => { resetarEdicaoCaixa(); ativarAbaCaixa("edicao"); });
    $("#btn-cancelar-edicao-caixa")?.addEventListener("click", () => { resetarEdicaoCaixa(); ativarAbaCaixa("registros"); });
    $("#form-caixa-movimento")?.addEventListener("submit", salvarMovimentoCaixa);
    $("#form-caixa-movimento [name=centro_custo_principal_id]")?.addEventListener("change", () => atualizarCentrosSecundariosCaixa(""));
    $("#btn-imprimir-relatorios")?.addEventListener("click", () => window.print());
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
        if (r?.ocupado) alertBox("A automação já está sendo executada por outro processo.", "warn");
        else if (Number(r?.erros || 0) > 0) alertBox(`Automação executada: ${Number(r?.enviados || 0)} enviado(s) e ${Number(r?.erros || 0)} com erro. Confira a fila.`, "warn");
        else alertBox(`Automação executada: ${Number(r?.enviados || 0)} enviado(s), ${Number(r?.novos || 0)} nova(s) etapa(s).`, "ok");
        await recarregar();
      } catch (err) { alertBox(`Erro ao executar automação: ${err.message}`, "danger"); }
    });
    $("#cobranca-regua-etapas")?.addEventListener("change", ev => carregarEtapasCobranca(ev.currentTarget.value));
    $("#btn-aplicar-cobranca-filtros")?.addEventListener("click", recarregar);
    $("#btn-configurar-zapschat-cobranca")?.addEventListener("click", abrirConfiguracaoZapsChat);
    $("#btn-parear-zapschat")?.addEventListener("click", parearZapsChat);
    $("#btn-atualizar-instancias-zapschat")?.addEventListener("click", atualizarInstanciasZapsChat);
    $("#btn-salvar-instancia-zapschat")?.addEventListener("click", salvarInstanciaZapsChat);
    $("#btn-testar-zapschat")?.addEventListener("click", testarZapsChat);
    $("#btn-desconectar-zapschat")?.addEventListener("click", desconectarZapsChat);
    $("#zapschat-instancia-select")?.addEventListener("change", atualizarPreviewInstanciaZapsChat);
    $("#zapschat-pairing-code")?.addEventListener("input", ev => {
      const clean = String(ev.currentTarget.value || "").replace(/\D+/g, "").slice(0, 8);
      if (ev.currentTarget.value !== clean) ev.currentTarget.value = clean;
    });
    $("#zapschat-pairing-code")?.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); parearZapsChat(); }
    });
    $("#btn-buscar-titulos-emissao")?.addEventListener("click", () => buscarTitulosEmissaoLote({ selecionarTodos: true }).catch(err => alertBox(`Erro ao buscar títulos: ${err.message}`, "danger")));
    $("#btn-emitir-titulos-lote")?.addEventListener("click", emitirTitulosSelecionados);
    $("#emissao-selecionar-todos")?.addEventListener("change", (ev) => {
      state.cobranca.emissaoSelecionados = ev.currentTarget.checked
        ? new Set(state.cobranca.emissaoTitulos.map(i => Number(i.id)))
        : new Set();
      $$("[data-emissao-check]").forEach(check => { check.checked = ev.currentTarget.checked; });
      atualizarResumoSelecaoEmissao();
    });

    document.addEventListener("input", (ev) => {
      const envolvidoSearch = ev.target.closest("[data-envolvido-search]");
      if (envolvidoSearch) {
        const form = envolvidoSearch.closest("#form-lancamento");
        const tipoLookup = envolvidoSearch.dataset.envolvidoSearch;
        const els = elementosLookupEnvolvido(form, tipoLookup);
        if (!els) return;
        const valorAtual = String(envolvidoSearch.value || "");
        if (envolvidoSearch.dataset.selectedId && valorAtual !== String(envolvidoSearch.dataset.selectedLabel || "")) {
          els.select.value = "";
          envolvidoSearch.dataset.selectedId = "";
          envolvidoSearch.dataset.selectedLabel = "";
          els.clear.hidden = true;
          els.select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (valorAtual.trim() && !envolvidoSearch.dataset.selectedId) {
          envolvidoSearch.setCustomValidity(`Selecione ${tipoLookup === "cliente" ? "um cliente" : "um fornecedor"} na lista de resultados.`);
        } else {
          envolvidoSearch.setCustomValidity("");
        }
        agendarBuscaLookupEnvolvido(form, tipoLookup, valorAtual);
        return;
      }

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
      if (input.closest("#form-baixa") && ["valor_principal", "valor_desconto", "valor_acrescimo", "valor_multa", "valor_mora"].includes(input.name)) {
        recalcularTotalBaixaLocal();
      }
    });

    document.addEventListener("focusin", (ev) => {
      const envolvidoSearch = ev.target.closest("[data-envolvido-search]");
      if (envolvidoSearch) {
        const form = envolvidoSearch.closest("#form-lancamento");
        const tipoLookup = envolvidoSearch.dataset.envolvidoSearch;
        if (envolvidoSearch.dataset.selectedId) return;
        const termo = String(envolvidoSearch.value || "").trim();
        if (termo.length >= 2) agendarBuscaLookupEnvolvido(form, tipoLookup, termo);
        else renderResultadosLookupEnvolvido(form, tipoLookup, resultadosLocaisLookupEnvolvido(tipoLookup, termo));
        return;
      }

      const sacadoSearch = ev.target.closest("[data-sacado-search]");
      if (!sacadoSearch) return;
      const form = sacadoSearch.closest("#form-lancamento");
      if (sacadoSearch.dataset.selectedId) return;
      const termo = String(sacadoSearch.value || "").trim();
      if (termo.length >= 2) agendarBuscaSacado(form, termo);
      else renderResultadosSacado(form, [], "Digite pelo menos 2 caracteres para procurar o sacado.");
    });

    document.addEventListener("keydown", (ev) => {
      const envolvidoSearch = ev.target.closest("[data-envolvido-search]");
      if (envolvidoSearch) {
        const form = envolvidoSearch.closest("#form-lancamento");
        const tipoLookup = envolvidoSearch.dataset.envolvidoSearch;
        if (ev.key === "Escape") {
          fecharResultadosLookupEnvolvido(form, tipoLookup);
          return;
        }
        if (ev.key === "Enter") {
          const els = elementosLookupEnvolvido(form, tipoLookup);
          const primeiro = els?.results?.querySelector(`[data-envolvido-option="${tipoLookup}"]`);
          if (!primeiro || els.results.hidden) return;
          ev.preventDefault();
          const lookupState = estadoLookupEnvolvido(tipoLookup);
          const item = lookupState?.items?.[Number(primeiro.dataset.envolvidoIndex)];
          if (item) selecionarLookupEnvolvido(form, tipoLookup, item, true);
        }
        return;
      }

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
      const envolvidoOption = ev.target.closest("[data-envolvido-option]");
      if (envolvidoOption) {
        const form = envolvidoOption.closest("#form-lancamento");
        const tipoLookup = envolvidoOption.dataset.envolvidoOption;
        const lookupState = estadoLookupEnvolvido(tipoLookup);
        const item = lookupState?.items?.[Number(envolvidoOption.dataset.envolvidoIndex)];
        if (item) selecionarLookupEnvolvido(form, tipoLookup, item, true);
        return;
      }

      const envolvidoClear = ev.target.closest("[data-envolvido-clear]");
      if (envolvidoClear) {
        const form = envolvidoClear.closest("#form-lancamento");
        const tipoLookup = envolvidoClear.dataset.envolvidoClear;
        selecionarLookupEnvolvido(form, tipoLookup, null, true);
        const els = elementosLookupEnvolvido(form, tipoLookup);
        els?.search?.focus();
        renderResultadosLookupEnvolvido(form, tipoLookup, resultadosLocaisLookupEnvolvido(tipoLookup));
        return;
      }

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

      if (!ev.target.closest("[data-envolvido-lookup]")) fecharTodosLookupsEnvolvidos();
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
      const emissaoCheck = ev.target.closest("[data-emissao-check]");
      if (emissaoCheck) {
        const id = Number(emissaoCheck.value || 0);
        if (id) {
          if (emissaoCheck.checked) state.cobranca.emissaoSelecionados.add(id);
          else state.cobranca.emissaoSelecionados.delete(id);
          atualizarResumoSelecaoEmissao();
        }
        return;
      }
      const formAuxiliar = ev.target.closest("#form-auxiliar");
      if (formAuxiliar?.dataset.tipo === "unidade-consumo" && ev.target.matches('[name="tipo_referencia"]')) {
        configurarReferenciaUnidadeConsumo(formAuxiliar, null);
        return;
      }
      if (formAuxiliar?.dataset.tipo === "unidade-consumo" && ev.target.matches('[name="referencia_source"]')) {
        aplicarReferenciaSelecionadaUnidadeConsumo(formAuxiliar);
        return;
      }
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
      if (ev.target.closest("#form-baixa") && ev.target.matches('[name="modalidade_baixa"]')) {
        atualizarModalidadeBaixa();
      }
      if (ev.target.closest("#form-baixa") && ev.target.matches('[name="centro_custo_principal_id"]')) {
        sincronizarCentrosBaixa(ev.target.closest("#form-baixa"), false);
      }
      if (ev.target.closest("#form-baixa") && ev.target.matches('[name="data_pagamento"]')) {
        atualizarCalculoBaixa();
        atualizarReparcelamentoBaixa();
        return;
      }
      if (ev.target.closest("#form-baixa") && ev.target.matches('[name="reparcelar_saldo"], [name="reparcelamento_parcelas"], [name="reparcelamento_primeiro_vencimento"], [name="reparcelamento_intervalo_meses"]')) {
        atualizarReparcelamentoBaixa();
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
