(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const pageEl = $("[data-financeiro-page]");
  if (!pageEl) return;

  const state = {
    page: pageEl.dataset.financeiroPage,
    items: [],
    auxItems: [],
    opcoes: { categorias: [], formas_pagamento: [], contas_bancos: [], clientes: [], fornecedores: [] },
    filtros: {},
    historicoLancamentoId: null,
  };

  const ENDPOINTS = {
    categorias: "/api/financeiro/categorias",
    formas: "/api/financeiro/formas-pagamento",
    contas: "/api/financeiro/contas-bancos",
  };

  const todayISO = () => new Date().toISOString().slice(0, 10);

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
      const tipoLabel = item.tipo === "pagar" ? "Pagar" : "Receber";
      const tipoClass = item.tipo === "pagar" ? "danger" : "ok";
      return `<tr>
        <td>
          <div class="financeiro-lancamento-cell">
            <span class="financeiro-lancamento-icon ${tipoClass}"><i class="fa-solid ${item.tipo === "pagar" ? "fa-arrow-up" : "fa-arrow-down"}"></i></span>
            <div><strong>${escapeHtml(item.descricao || "Sem descrição")}</strong><small>${dateBR(item.data_vencimento)} • ${escapeHtml(parceiroNome(item))}</small></div>
          </div>
        </td>
        <td>${pill(tipoLabel)}</td>
        <td class="financeiro-amount">${money(item.valor_total, item.moeda)}</td>
        <td>${pill(item.status)}</td>
        <td>${acoesLancamento(item)}</td>
      </tr>`;
    }
    const parceiro = item.tipo === "pagar" ? item.fornecedor_nome : item.cliente_nome;
    return `<tr>
      <td>${item.id}</td>
      <td>${escapeHtml(parceiro || "-")}</td>
      <td>${escapeHtml(item.descricao)}</td>
      <td>${dateBR(item.data_emissao)}</td>
      <td>${dateBR(item.data_vencimento)}</td>
      <td>${pill(item.status)}</td>
      <td>${escapeHtml(item.tipo === "pagar" ? (item.categoria_nome || "-") : (item.forma_pagamento_nome || "-"))}</td>
      <td class="financeiro-amount">${money(item.valor_total, item.moeda)}</td>
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
      .slice(-18);

    if (!valid.length) {
      host.innerHTML = `<div class="financeiro-empty-chart">Sem dados suficientes para montar o gráfico.</div>`;
      return;
    }

    const valores = valid.map(i => Number(i.saldo_previsto_acumulado || 0));
    const min = Math.min(0, ...valores);
    const max = Math.max(1, ...valores);
    const range = max - min || 1;
    const width = 760;
    const height = 260;
    const padX = 42;
    const padY = 30;
    const chartW = width - padX * 2;
    const chartH = height - padY * 2;

    const points = valid.map((item, idx) => {
      const x = padX + (idx * chartW) / Math.max(valid.length - 1, 1);
      const y = padY + chartH - ((Number(item.saldo_previsto_acumulado || 0) - min) / range) * chartH;
      return { x, y, item };
    });

    const polyline = points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const area = `${padX},${height - padY} ${polyline} ${width - padX},${height - padY}`;
    const last = points[points.length - 1];
    const grid = [0, 1, 2, 3].map(i => {
      const y = padY + (chartH / 3) * i;
      return `<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" />`;
    }).join("");

    host.innerHTML = `
      <svg class="financeiro-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fluxo financeiro">
        <defs>
          <linearGradient id="finChartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#65ACDE" stop-opacity="0.24" />
            <stop offset="100%" stop-color="#65ACDE" stop-opacity="0" />
          </linearGradient>
        </defs>
        <g class="grid">${grid}</g>
        <polygon class="area" points="${area}" />
        <polyline class="line" points="${polyline}" />
        <circle class="point" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="5" />
        <g class="tooltip" transform="translate(${Math.min(last.x + 14, width - 210)}, ${Math.max(last.y - 44, 22)})">
          <rect width="174" height="54" rx="10"></rect>
          <text x="14" y="22">${money(last.item.saldo_previsto_acumulado)}</text>
          <text x="14" y="40" class="muted">${dateBR(last.item.data)}</text>
        </g>
      </svg>`;
  }

  function renderTopClientes(items = []) {
    const host = $("#financeiro-top-clientes");
    if (!host) return;

    const map = new Map();
    items.forEach(item => {
      const nome = item.cliente_nome || item.fornecedor_nome || "Sem cliente";
      const total = Number(item.valor_total || 0);
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
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.clientes || []).map(i => option(`${i.codigo || ""} - ${i.nome}`, i.id)).join("");
      sel.value = current;
    });
    $$('[data-select="fornecedores"]').forEach(sel => {
      const current = sel.value;
      sel.innerHTML = '<option value="">Selecione...</option>' + (ops.fornecedores || []).map(i => option(`${i.codigo || ""} - ${i.nome}`, i.id)).join("");
      sel.value = current;
    });
  }

  async function carregarDashboard() {
    const filtroAtual = filtros();
    const [data, fluxo, relatorio, lancamentosData, receberData] = await Promise.all([
      request("/api/financeiro/dashboard"),
      request(`/api/financeiro/fluxo-caixa${qs(filtroAtual)}`).catch(() => ({ items: [] })),
      request(`/api/financeiro/relatorios/resumo${qs(filtroAtual)}`).catch(() => ({ por_categoria: [] })),
      request(`/api/financeiro/lancamentos${qs({ ...filtroAtual, limit: 50 })}`).catch(() => ({ items: [] })),
      request(`/api/financeiro/contas-receber${qs({ ...filtroAtual, limit: 300 })}`).catch(() => ({ items: [] })),
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
    state.items = lancamentos.length ? lancamentos.slice(0, 5) : (data.proximos_vencimentos || []).slice(0, 5);
    setTable("tbody-dashboard", 5, state.items.map(i => rowLancamento(i, "dashboard")).join(""), "Nenhum lançamento financeiro cadastrado ainda.");

    renderFluxoChart(safeItems(fluxo));
    renderTopClientes(safeItems(receberData));
    renderCategoriasDashboard(relatorio.por_categoria || []);
    renderStatusDashboard(lancamentos.length ? lancamentos : (data.proximos_vencimentos || []));

    const subtitle = $("#financeiro-chart-subtitle");
    if (subtitle) subtitle.textContent = `${safeItems(fluxo).length} ponto(s) de fluxo carregados.`;

    setStatusText("Dados atualizados agora.");
  }

  async function carregarReceber() {
    const data = await request(`/api/financeiro/contas-receber${qs(filtros())}`);
    const items = data.items || [];
    state.items = items;
    const aberto = items.filter(i => !["recebido", "cancelado"].includes(String(i.status).toLowerCase()));
    const recebidos = items.filter(i => String(i.status).toLowerCase() === "recebido");
    const vencidos = items.filter(i => String(i.status).toLowerCase() === "vencido");
    const hoje = todayISO();
    const hojeItems = items.filter(i => String(i.data_vencimento).slice(0, 10) === hoje);
    setKPI("receber-aberto", money(soma(aberto, i => Number(i.valor_total || 0) - Number(i.valor_pago || 0))));
    setKPI("receber-recebido", money(soma(recebidos, i => i.valor_pago || i.valor_total)));
    setKPI("receber-vencido", money(soma(vencidos, i => Number(i.valor_total || 0) - Number(i.valor_pago || 0))));
    setKPI("receber-hoje", money(soma(hojeItems, i => i.valor_total)));
    setTable("tbody-receber", 9, items.map(i => rowLancamento(i, "receber")).join(""), "Nenhuma conta a receber cadastrada ainda.");
    setStatusText(`${data.total || 0} conta(s) a receber.`);
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
    setKPI("pagar-hoje", money(soma(hojeItems, i => i.valor_total)));
    setTable("tbody-pagar", 9, items.map(i => rowLancamento(i, "pagar")).join(""), "Nenhuma conta a pagar cadastrada ainda.");
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
    state.auxItems = items;
    setKPI("cat-receita", `${items.filter(i => i.tipo === "receita").length} categorias`);
    setKPI("cat-despesa", `${items.filter(i => i.tipo === "despesa").length} categorias`);
    setKPI("cat-ativas", `${items.filter(i => i.ativo).length} ativas`);
    setTable("tbody-categorias", 5, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${pill(i.tipo)}</td><td>${escapeHtml(i.cor || "-")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "categoria")}</td></tr>`).join(""), "Nenhuma categoria cadastrada.");
    setStatusText(`${items.length} categoria(s).`);
  }

  async function carregarFormas() {
    const items = await request("/api/financeiro/formas-pagamento");
    state.auxItems = items;
    setKPI("formas-ativas", `${items.filter(i => i.ativo).length}`);
    setKPI("formas-primeira", items[0]?.nome || "-");
    setKPI("formas-inativas", `${items.filter(i => !i.ativo).length}`);
    setTable("tbody-formas", 4, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.tipo || "-")}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "forma")}</td></tr>`).join(""), "Nenhuma forma cadastrada.");
    setStatusText(`${items.length} forma(s).`);
  }

  async function carregarContas() {
    const items = await request("/api/financeiro/contas-bancos");
    state.auxItems = items;
    setKPI("contas-saldo", money(soma(items, i => i.saldo_atual ?? i.saldo_inicial)));
    setKPI("contas-ativas", `${items.filter(i => i.ativo).length}`);
    setKPI("contas-inativas", `${items.filter(i => !i.ativo).length}`);
    setTable("tbody-contas", 7, items.map(i => `<tr><td>${escapeHtml(i.nome)}</td><td>${escapeHtml(i.banco || "-")}</td><td>${escapeHtml(i.agencia || "-")}</td><td>${escapeHtml(i.conta || "-")}</td><td class="financeiro-amount" title="Saldo inicial: ${money(i.saldo_inicial)} em ${dateBR(i.data_saldo_inicial)}">${money(i.saldo_atual ?? i.saldo_inicial)}</td><td>${pill(i.ativo ? "Ativo" : "Inativo")}</td><td>${acoesAuxiliar(i, "conta")}</td></tr>`).join(""), "Nenhuma conta cadastrada.");
    setStatusText(`${items.length} conta(s).`);
  }

  async function carregarRelatorios() {
    const data = await request(`/api/financeiro/relatorios/resumo${qs(filtros())}`);
    const items = data.por_categoria || [];
    state.items = items;
    const receitas = soma(items.filter(i => i.tipo === "receber"), i => i.valor_total);
    const despesas = soma(items.filter(i => i.tipo === "pagar"), i => i.valor_total);
    setKPI("rel-receitas", money(receitas));
    setKPI("rel-despesas", money(despesas));
    setKPI("rel-resultado", money(receitas - despesas));
    setTable("tbody-relatorios", 5, items.map(i => `<tr><td>${i.tipo === "pagar" ? "Despesa" : "Receita"}</td><td>${escapeHtml(i.categoria)}</td><td>${i.quantidade}</td><td class="financeiro-amount">${money(i.valor_total)}</td><td class="financeiro-amount">${money(i.valor_pago)}</td></tr>`).join(""), "Nenhum dado no período.");
    setStatusText(`${items.length} linha(s) de relatório.`);
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
    preencherSelects();
    const base = item || {
      tipo: tipo || (state.page === "pagar" ? "pagar" : "receber"),
      status: "aberto",
      data_emissao: todayISO(),
      data_vencimento: todayISO(),
      moeda: "BRL",
      valor_total: "",
      valor_pago: "0",
    };
    if (item) {
      base.moeda = moedaValida(item.moeda || "BRL");
      base.valor_total = formatMoneyForInput(item.valor_total ?? "", base.moeda);
      base.valor_pago = formatMoneyForInput(item.valor_pago ?? "", base.moeda);
    }
    setForm(form, base);
    const valorPagoInput = form.querySelector('[name="valor_pago"]');
    if (valorPagoInput) {
      valorPagoInput.readOnly = true;
      valorPagoInput.setAttribute("aria-readonly", "true");
      valorPagoInput.title = "Valor calculado automaticamente pelas baixas e estornos.";
    }
    const dataPagamentoInput = form.querySelector('[name="data_pagamento"]');
    if (dataPagamentoInput) {
      dataPagamentoInput.readOnly = true;
      dataPagamentoInput.setAttribute("aria-readonly", "true");
      dataPagamentoInput.title = "Data calculada automaticamente pelas movimentações.";
    }
    $("#modal-lancamento-titulo").textContent = item ? `Editar lançamento #${item.id}` : "Novo lançamento";
    const chip = $("#modal-lancamento-chip");
    if (chip) chip.textContent = item ? "Edição" : (base.status ? base.status.charAt(0).toUpperCase() + base.status.slice(1) : "Aberto");
    const subtitulo = $("#modal-lancamento-subtitulo");
    if (subtitulo) subtitulo.textContent = item ? "Atualize os dados financeiros do lançamento selecionado." : "Preencha os dados financeiros do lançamento.";
    abrirModal("#modal-lancamento");
    setTimeout(() => ativarNavegacaoModalLancamento("fin-sec-lancamento"), 30);
  }

  function abrirBaixa(item) {
    const form = $("#form-baixa");
    if (!form) return;
    form.reset();
    preencherSelects();
    const restante = Math.max(0, Number(item.valor_total || 0) - Number(item.valor_pago || 0));
    setForm(form, {
      id: item.id,
      valor_baixa: formatMoneyForInput(restante, item.moeda || "BRL"),
      data_pagamento: todayISO(),
      forma_pagamento_id: item.forma_pagamento_id || "",
      conta_banco_id: item.conta_banco_id || "",
      observacoes: "",
    });
    const resumo = $("#financeiro-baixa-resumo", form);
    if (resumo) resumo.innerHTML = `
      <div><span>Valor total</span><strong>${money(item.valor_total, item.moeda)}</strong></div>
      <div><span>Já baixado</span><strong>${money(item.valor_pago, item.moeda)}</strong></div>
      <div><span>Saldo aberto</span><strong>${money(restante, item.moeda)}</strong></div>`;
    abrirModal("#modal-baixa");
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
      documento: data.documento || null,
      observacoes: data.observacoes || null,
      parcelado: data.parcelado === "true",
      parcela_numero: nullNumber(data.parcela_numero),
      parcela_total: nullNumber(data.parcela_total),
    };
  }

  function abrirAux(tipo, item = null) {
    const form = $("#form-auxiliar");
    const body = $("#modal-auxiliar-body");
    if (!form || !body) return;
    form.reset();
    form.dataset.tipo = tipo;
    form.dataset.id = item?.id || "";
    const titulo = tipo === "categoria" ? "Categoria financeira" : tipo === "forma" ? "Forma de pagamento" : "Conta/Banco";
    $("#modal-auxiliar-titulo").textContent = item ? `Editar ${titulo}` : `Nova ${titulo}`;

    if (tipo === "categoria") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><select name="tipo"><option value="receita">Receita</option><option value="despesa">Despesa</option><option value="ambos">Ambos</option></select></div><div class="financeiro-field"><label>Cor</label><input name="cor" placeholder="#65ACDE"></div><div class="financeiro-field"><label>Status</label><select name="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div></div>`;
    } else if (tipo === "forma") {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Tipo</label><input name="tipo" placeholder="pix, boleto, cartão..."></div><div class="financeiro-field"><label>Status</label><select name="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div></div>`;
    } else {
      body.innerHTML = `<div class="financeiro-form-grid cols-2"><div class="financeiro-field"><label>Nome</label><input name="nome" required></div><div class="financeiro-field"><label>Banco</label><input name="banco"></div><div class="financeiro-field"><label>Agência</label><input name="agencia"></div><div class="financeiro-field"><label>Conta</label><input name="conta"></div><div class="financeiro-field"><label>Saldo inicial</label><input name="saldo_inicial" class="financeiro-money-input" data-money-input inputmode="decimal" autocomplete="off" placeholder="R$ 0,00"></div><div class="financeiro-field"><label>Data do saldo inicial</label><input name="data_saldo_inicial" type="date" value="${todayISO()}" required></div><div class="financeiro-field"><label>Status</label><select name="ativo"><option value="true">Ativo</option><option value="false">Inativo</option></select></div></div>`;
    }
    if (item) setForm(form, { ...item, ativo: String(Boolean(item.ativo)) });
    abrirModal("#modal-auxiliar");
  }

  function prepararInterfaceFinanceiro() {
    const formLancamento = $("#form-lancamento");
    if (formLancamento) {
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
    if (formBaixa) {
      const inputValor = formBaixa.querySelector('[name="valor_pago"], [name="valor_baixa"]');
      if (inputValor) {
        inputValor.name = "valor_baixa";
        const label = inputValor.closest(".financeiro-field")?.querySelector("label");
        if (label) label.textContent = "Valor desta baixa";
      }
      const modalBody = $(".financeiro-modal-body", formBaixa);
      if (modalBody && !$("#financeiro-baixa-resumo", formBaixa)) {
        const resumo = document.createElement("div");
        resumo.id = "financeiro-baixa-resumo";
        resumo.className = "financeiro-baixa-resumo";
        modalBody.prepend(resumo);
      }
      const grid = $(".financeiro-form-grid", formBaixa);
      if (grid && !grid.querySelector('[name="observacoes"]')) {
        const campo = document.createElement("div");
        campo.className = "financeiro-field financeiro-field-full";
        campo.innerHTML = '<label>Observação da baixa</label><textarea name="observacoes" rows="2" placeholder="Opcional"></textarea>';
        grid.appendChild(campo);
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
      return `<div class="financeiro-history-item ${estorno ? "is-estorno" : ""}">
        <div class="financeiro-history-icon"><i class="fa-solid ${estorno ? "fa-rotate-left" : "fa-check"}"></i></div>
        <div class="financeiro-history-main">
          <div class="financeiro-history-title"><strong>${estorno ? "Estorno" : (lancamento.tipo === "pagar" ? "Pagamento" : "Recebimento")}</strong><span>${money(m.valor, lancamento.moeda)}</span></div>
          <div class="financeiro-history-meta">${dateBR(m.data_movimentacao)} • ${escapeHtml(m.usuario_nome || "Usuário não identificado")} • ${escapeHtml(m.conta_banco_nome || "Sem conta/banco")}</div>
          ${m.observacoes ? `<div class="financeiro-history-note">${escapeHtml(m.observacoes)}</div>` : ""}
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
    const payload = limparPayloadLancamento(getForm(form));
    const id = payload.id;
    delete payload.id;
    try {
      if (id) await request(`/api/financeiro/lancamentos/${id}`, { method: "PUT", body: payload });
      else await request("/api/financeiro/lancamentos", { method: "POST", body: payload });
      fecharModais();
      alertBox("Lançamento salvo com sucesso.", "ok");
      await recarregar();
    } catch (err) {
      alertBox(`Erro ao salvar: ${err.message}`, "danger");
    }
  }

  async function salvarBaixa(ev) {
    ev.preventDefault();
    const data = getForm(ev.currentTarget);
    try {
      await request(`/api/financeiro/lancamentos/${data.id}/baixar`, { method: "PATCH", body: {
        valor_baixa: moneyToBackend(data.valor_baixa),
        data_pagamento: data.data_pagamento,
        forma_pagamento_id: nullNumber(data.forma_pagamento_id),
        conta_banco_id: nullNumber(data.conta_banco_id),
        observacoes: data.observacoes || null,
      }});
      fecharModais();
      alertBox("Baixa registrada com sucesso.", "ok");
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
    data.ativo = data.ativo !== "false";
    if (tipo === "conta") {
      data.saldo_inicial = moneyToBackend(data.saldo_inicial || 0);
      data.data_saldo_inicial = data.data_saldo_inicial || todayISO();
    }
    const endpoint = ENDPOINTS[tipo === "categoria" ? "categorias" : tipo === "forma" ? "formas" : "contas"];
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
    const item = state.items.find(i => Number(i.id) === id) || state.auxItems.find(i => Number(i.id) === id);

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
      if (action === "editar-aux" && item) abrirAux(btn.dataset.tipo, item);
      if (action === "excluir-aux") {
        if (!confirm("Excluir este cadastro?")) return;
        const endpoint = ENDPOINTS[btn.dataset.tipo === "categoria" ? "categorias" : btn.dataset.tipo === "forma" ? "formas" : "contas"];
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
      if (type === "categoria") return abrirAux("categoria");
      if (type === "forma") return abrirAux("forma");
      if (type === "conta") return abrirAux("conta");
      return abrirLancamento(type || "");
    }));
    $("#btn-toggle-filtros")?.addEventListener("click", () => $("#financeiro-filtros")?.classList.toggle("is-open"));
    $("#btn-aplicar-filtros")?.addEventListener("click", recarregar);
    $("#btn-limpar-filtros")?.addEventListener("click", () => {
      ["#filtro-busca", "#filtro-status", "#filtro-data-inicio", "#filtro-data-fim"].forEach(sel => { const el = $(sel); if (el) el.value = ""; });
      recarregar();
    });
    $("#btn-exportar-financeiro")?.addEventListener("click", exportarTabela);
    $("#form-lancamento")?.addEventListener("submit", salvarLancamento);
    $("#form-baixa")?.addEventListener("submit", salvarBaixa);
    $("#form-auxiliar")?.addEventListener("submit", salvarAuxiliar);

    document.addEventListener("input", (ev) => {
      const input = ev.target.closest("[data-money-input]");
      if (!input) return;
      const cursor = input.selectionStart;
      const clean = sanitizeMoneyInput(input.value);
      if (input.value !== clean) {
        input.value = clean;
        try { input.setSelectionRange(Math.min(cursor, clean.length), Math.min(cursor, clean.length)); } catch (_) {}
      }
    });

    document.addEventListener("blur", (ev) => {
      const input = ev.target.closest("[data-money-input]");
      if (!input) return;
      const form = input.closest("form");
      const moeda = form?.querySelector('[name="moeda"]')?.value || "BRL";
      input.value = formatMoneyForInput(input.value, moeda);
    }, true);

    document.addEventListener("change", (ev) => {
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
