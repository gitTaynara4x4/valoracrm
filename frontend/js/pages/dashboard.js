(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const RANGE_LABELS = {
    day: 'hoje',
    week: 'na semana',
    month: 'no mês',
    custom: 'na data selecionada',
  };

  const state = {
    range: 'day',
    resumo: null,
  };

  function getLS(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function getFirstName(name) {
    return String(name || 'Usuário').trim().split(/\s+/)[0] || 'Usuário';
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function applyLocalUser() {
    const nome = getLS('nome') || getLS('user_nome') || getLS('usuario_nome') || 'Usuário';
    const email = getLS('email') || getLS('user_email') || getLS('usuario_email') || 'email@empresa.com';
    const empresaId = getLS('empresa_id') || getLS('empresaId') || '--';
    const plano = getLS('plano') || getLS('empresa_plano') || 'Essencial';

    setText('welcomeText', `Olá, ${getFirstName(nome)}. Acompanhe seus principais números ${RANGE_LABELS[state.range]} no Valora CRM.`);
    setText('summaryUserName', nome);
    setText('summaryUserEmail', email);
    setText('summaryPlan', plano);
    setText('summaryCompany', empresaId === '--' ? 'Empresa #--' : `Empresa #${empresaId}`);
  }

  function buildUpdatedAtLabel(updatedAt) {
    try {
      const date = new Date(updatedAt);
      if (Number.isNaN(date.getTime())) return 'Atualizado agora';
      return `Atualizado em ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (error) {
      return 'Atualizado agora';
    }
  }

  function getOrcamentosPeriodo(stats) {
    if (state.range === 'week') return Number(stats.orcamentos_semana ?? 0);
    if (state.range === 'month') return Number(stats.orcamentos_mes ?? 0);
    if (state.range === 'custom') return Number(stats.orcamentos_data_ref ?? 0);
    return Number(stats.orcamentos_hoje ?? 0);
  }

  function refreshPeriodUI() {
    applyLocalUser();
    const stats = state.resumo?.stats || {};
    setText('statPropostasMes', String(getOrcamentosPeriodo(stats)));
    setText('propostasTrend', `Criados ${RANGE_LABELS[state.range]}`);
  }

  function applyResumo(data) {
    state.resumo = data || {};
    const empresa = data?.empresa || {};
    const stats = data?.stats || {};

    setText('statClientes', String(stats.clientes_total ?? 0));
    setText('statTaxaAprovacao', `${Number(stats.taxa_aprovacao ?? 0)}%`);
    setText('statFaturamento', formatMoney(stats.faturamento_estimado ?? 0));
    setText('statProdutos', String(stats.produtos_total ?? 0));
    setText('statUsuarios', String(stats.usuarios_total ?? 0));
    refreshPeriodUI();

    setText('summaryPlan', empresa.plano || 'Essencial');
    setText('summaryCompany', empresa.id ? `Empresa #${empresa.id}` : 'Empresa #--');
    setText('lastUpdateInfo', buildUpdatedAtLabel(data?.updated_at));

    const online = data?.sistema_online !== false;
    const onlineText = online ? 'Sistema online e ativo' : 'Sistema indisponível';
    setText('dashboardStatusText', onlineText);
    const statusPill = $('dashboardStatusPill');
    if (statusPill) statusPill.innerHTML = `<i class="fa-solid fa-circle"></i>${onlineText}`;
  }

  function renderDistribution(payload) {
    const labels = payload?.labels || [];
    const data = payload?.data || [];
    const map = Object.fromEntries(labels.map((label, index) => [String(label).toLowerCase(), Number(data[index] || 0)]));

    const clientes = map.clientes || 0;
    const fornecedores = map.fornecedores || 0;
    const produtos = map.produtos || 0;
    const cotacoes = map['cotações'] || map.cotacoes || 0;
    const patrimonio = map['patrimônio'] || map.patrimonio || 0;
    const total = clientes + fornecedores + produtos + cotacoes + patrimonio;

    setText('distClientes', String(clientes));
    setText('distFornecedores', String(fornecedores));
    setText('distProdutos', String(produtos));
    setText('distCotacoes', String(cotacoes));
    setText('distPatrimonio', String(patrimonio));
    setText('distTotal', String(total));

    const donut = $('dashboardDonut');
    if (!donut) return;

    const pieces = [clientes, fornecedores, produtos, cotacoes, patrimonio];
    const colors = ['#1A7EEE', '#5bc0eb', '#7b61ff', '#ffb84d', '#46c98b'];

    if (total <= 0) {
      donut.style.setProperty('--donut', 'conic-gradient(#d6dbe3 0 100%)');
      return;
    }

    let acc = 0;
    const segments = pieces.map((value, index) => {
      const start = (acc / total) * 100;
      acc += value;
      const end = (acc / total) * 100;
      return `${colors[index]} ${start}% ${end}%`;
    });
    donut.style.setProperty('--donut', `conic-gradient(${segments.join(', ')})`);
  }

  function renderFunnel(payload) {
    const labels = payload?.labels || ['Clientes', 'Orçamentos', 'Aprovados'];
    const data = (payload?.data || []).map((value) => Number(value || 0));
    const max = Math.max(...data, 1);
    const container = $('funnelBars');
    const footer = $('funnelFooter');
    if (!container) return;

    container.innerHTML = labels.map((rawLabel, index) => {
      const label = rawLabel === 'Propostas' ? 'Orçamentos' : rawLabel;
      const value = data[index] || 0;
      const primaryHeight = Math.max(8, Math.round((value / max) * 145));
      const secondaryHeight = Math.max(7, Math.round(primaryHeight * 0.72));
      return `
        <div class="funnel-col">
          <div class="funnel-bar-stack">
            <span class="funnel-bar primary" style="height:${primaryHeight}px"></span>
            <span class="funnel-bar secondary" style="height:${secondaryHeight}px"></span>
          </div>
          <div class="funnel-meta">
            <strong>${value}</strong>
            <span>${label}</span>
          </div>
        </div>
      `;
    }).join('');

    if (footer) {
      footer.innerHTML = `
        <span><i class="legend-primary"></i> Atual</span>
        <span><i class="legend-secondary"></i> Referência visual</span>
      `;
    }
  }

  async function fetchJSON(url) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} @ ${url}`);
    return response.json();
  }

  async function loadResumo(dataRef = '') {
    const qs = dataRef ? `?data_ref=${encodeURIComponent(dataRef)}` : '';
    const resumo = await fetchJSON(`/api/dashboard/resumo${qs}`);
    applyResumo(resumo);
  }

  async function loadDashboard() {
    try {
      const [resumo, distribuicao, funil] = await Promise.all([
        fetchJSON('/api/dashboard/resumo'),
        fetchJSON('/api/dashboard/distribuicao'),
        fetchJSON('/api/dashboard/funil'),
      ]);
      applyResumo(resumo);
      renderDistribution(distribuicao);
      renderFunnel(funil);
    } catch (error) {
      console.warn('[Valora Dashboard] Falha ao carregar dados:', error);
      applyResumo({
        sistema_online: true,
        empresa: { plano: 'Essencial', id: null },
        stats: {
          clientes_total: 0,
          orcamentos_hoje: 0,
          orcamentos_semana: 0,
          orcamentos_mes: 0,
          orcamentos_data_ref: 0,
          taxa_aprovacao: 0,
          faturamento_estimado: 0,
          produtos_total: 0,
          usuarios_total: 0,
        },
      });
      renderDistribution({ labels: ['Clientes', 'Fornecedores', 'Produtos', 'Cotações', 'Patrimônio'], data: [0, 0, 0, 0, 0] });
      renderFunnel({ labels: ['Clientes', 'Orçamentos', 'Aprovados'], data: [0, 0, 0] });
    }
  }

  function setRange(range) {
    state.range = range;
    document.querySelectorAll('.dashboard-range-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.range === range);
    });
    refreshPeriodUI();
  }

  function setCustomDateLabel(value) {
    const label = $('dashboardDateLabel');
    if (!label) return;
    if (!value) {
      label.textContent = 'Data';
      return;
    }
    const [year, month, day] = String(value).split('-');
    label.textContent = day && month && year ? `${day}/${month}/${year}` : 'Data';
  }

  function bindRangeButtons() {
    document.querySelectorAll('.dashboard-range-btn').forEach((button) => {
      button.addEventListener('click', () => setRange(button.dataset.range || 'day'));
    });

    const customDate = $('dashboardCustomDate');
    const dateBtn = $('dashboardDateBtn');

    if (dateBtn && customDate) {
      dateBtn.addEventListener('click', () => {
        if (typeof customDate.showPicker === 'function') customDate.showPicker();
        else customDate.click();
      });
    }

    if (customDate) {
      customDate.addEventListener('change', async () => {
        if (!customDate.value) return;
        setCustomDateLabel(customDate.value);
        state.range = 'custom';
        document.querySelectorAll('.dashboard-range-btn').forEach((btn) => btn.classList.remove('is-active'));
        try {
          await loadResumo(customDate.value);
        } catch (error) {
          console.warn('[Valora Dashboard] Falha ao carregar data personalizada:', error);
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLocalUser();
    bindRangeButtons();
    loadDashboard();
  });
})();
