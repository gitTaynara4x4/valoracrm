(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const lockView = $('lockView');
  const dashboardView = $('dashboardView');
  const unlockForm = $('unlockForm');
  const devPassword = $('devPassword');
  const unlockButton = $('unlockButton');
  const unlockError = $('unlockError');
  const togglePassword = $('togglePassword');
  const lockButton = $('lockButton');
  const refreshButton = $('refreshButton');
  const eventModal = $('eventModal');
  const sessionModal = $('sessionModal');

  let pageSessionId = createPageSessionId();
  let pollTimer = null;
  let analyticsTimer = null;
  let loadingEvents = false;
  let loadingAnalytics = false;
  let latestPayload = null;
  let analyticsPayload = null;
  let periodEvents = [];

  const PAGE_NAMES = {
    dashboard: 'Dashboard', clientes: 'Clientes', fornecedores: 'Fornecedores', produtos: 'Produtos', patrimonio: 'Patrimônio',
    cotacoes: 'Cotações', orcamentos: 'Orçamentos', propostas: 'Propostas', financeiro: 'Financeiro', faturamento: 'Faturamento',
    'vendas-financeiro': 'Vendas / Financeiro', 'contas-receber': 'Contas a receber', 'contas-pagar': 'Contas a pagar',
    'fluxo-caixa': 'Fluxo de caixa', 'movimento-bancario': 'Movimento bancário', 'acompanhamento-financeiro': 'Acompanhamento financeiro',
    'cobrancas-financeiro': 'Cobranças', 'automacao-cobranca': 'Automação de cobrança', 'relatorios-financeiros': 'Relatórios financeiros',
    'cadastros-financeiros': 'Cadastros financeiros', 'configuracoes-financeiras': 'Configurações financeiras',
    usuarios: 'Colaboradores', empresa: 'Empresa', configuracoes: 'Configurações', formularios: 'Formulários', agenda: 'Agenda',
    'arquivos-tecnicos': 'Arquivos técnicos', monitoramento: 'Monitoramento', ajuda: 'Ajuda', perfil: 'Perfil',
    'formas-pagamento': 'Formas de pagamento', 'contas-bancos': 'Contas e bancos', 'categorias-financeiras': 'Categorias financeiras',
    inicio: 'Início', app: 'Valora'
  };

  function createPageSessionId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function pageName(value) {
    const raw = String(value || '').replace(/^\/+|\/+$/g, '').split('?')[0];
    return PAGE_NAMES[raw] || raw.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) || 'Valora';
  }

  function prettyValue(value) {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  }

  function dateObj(value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function localDate(value, withDate = true) {
    const date = dateObj(value);
    if (!date) return '—';
    const options = withDate
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    return new Intl.DateTimeFormat('pt-BR', options).format(date);
  }

  function shortDate(value) {
    const date = dateObj(value);
    if (!date) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  }

  function dateLabel(value) {
    const date = dateObj(value);
    if (!date) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function relativeTime(value) {
    const date = dateObj(value);
    if (!date) return '—';
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 10) return 'agora';
    if (seconds < 60) return `há ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `há ${hours}h`;
    return dateLabel(value);
  }

  function durationText(seconds, compact = false) {
    let total = Math.max(0, Math.round(Number(seconds || 0)));
    const hours = Math.floor(total / 3600);
    total -= hours * 3600;
    const minutes = Math.floor(total / 60);
    const secs = total - minutes * 60;
    if (hours) return compact ? `${hours}h ${minutes}m` : `${hours}h ${minutes}min`;
    if (minutes) return compact ? `${minutes}m ${secs ? `${secs}s` : ''}`.trim() : `${minutes} min${secs ? ` ${secs}s` : ''}`;
    return `${secs}s`;
  }

  function deviceText(device) {
    if (!device) return '—';
    return [device.dispositivo, device.sistema, device.navegador].filter(Boolean).join(' · ') || '—';
  }

  function detailsOf(event) {
    return event?.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
  }

  function eventOperation(event) {
    return String(event?.operacao || detailsOf(event).operacao || '').toLowerCase();
  }

  function actionContext(event) {
    const details = detailsOf(event);
    const module = event.modulo || details.modulo;
    const entityId = event.entidade_id ?? details.entidade_id;
    const entityType = event.entidade_tipo || details.entidade_tipo;
    if (module && entityId) return `${pageName(module)} #${entityId}`;
    if (entityType && entityId) return `${pageName(entityType)} #${entityId}`;
    if (module) return pageName(module);
    return event.pagina ? pageName(event.pagina) : '';
  }

  function eventModule(event) {
    const details = detailsOf(event);
    return String(event.modulo || details.modulo || event.pagina || 'Valora').replace(/^\/+|\/+$/g, '') || 'Valora';
  }

  function eventPage(event) {
    return String(event.pagina || event.pagina_origem || eventModule(event) || 'Valora').replace(/^\/+|\/+$/g, '') || 'Valora';
  }

  function eventCategory(event) {
    const type = String(event.tipo || '');
    const operation = eventOperation(event);
    if (event.severidade === 'erro' || Number(event.status_code || 0) >= 400 || type === 'login_falhou') return 'errors';
    if (operation === 'excluir' || type === 'exclusao_api') return 'deletes';
    if (operation === 'criar' || type === 'cadastro_api') return 'creates';
    if (operation === 'editar' || type === 'edicao_api') return 'edits';
    if (event.fonte === 'alteracao_dados' || type === 'alteracao_api') return 'changes';
    if (type === 'click') return 'clicks';
    if (type === 'pesquisa') return 'searches';
    if (type === 'filtro') return 'filters';
    if (type === 'modal_aberto') return 'modals';
    if (type === 'download' || type === 'download_exportacao') return 'downloads';
    if (type === 'navegacao' || type === 'navegacao_cliente' || type === 'pagina_saida') return 'navigation';
    if (type === 'login' || type === 'logout') return 'session';
    if (type === 'inatividade' || type === 'retorno_atividade') return 'idle';
    return 'other';
  }

  function eventTitle(event) {
    const details = detailsOf(event);
    const operation = eventOperation(event);
    const context = actionContext(event);
    if (event.fonte === 'alteracao_dados') {
      const field = event.campo_nome || event.campo || event.secao || 'registro';
      const action = String(event.acao || 'alterado');
      return `${action.charAt(0).toUpperCase() + action.slice(1)} ${field}${context ? ` em ${context}` : ''}`;
    }
    if (operation === 'criar') return context ? `Criou ${context}` : 'Criou um registro';
    if (operation === 'editar') return context ? `Editou ${context}` : 'Editou um registro';
    if (operation === 'excluir') return context ? `Excluiu ${context}` : 'Excluiu um registro';
    if (event.tipo === 'login') return 'Entrou no Valora';
    if (event.tipo === 'logout') return 'Saiu do Valora';
    if (event.tipo === 'login_falhou') return 'Tentativa de login falhou';
    if (event.tipo === 'navegacao' || event.tipo === 'navegacao_cliente') return `Abriu ${pageName(event.pagina)}`;
    if (event.tipo === 'pagina_saida') return `Saiu de ${pageName(event.pagina)}`;
    if (event.tipo === 'click') return `Clicou em “${details.rotulo || details.elemento || 'ação'}”`;
    if (event.tipo === 'pesquisa') return `Pesquisou “${details.valor || '—'}”`;
    if (event.tipo === 'filtro') return `Aplicou ${details.rotulo || 'filtro'}: ${details.valor || '—'}`;
    if (event.tipo === 'modal_aberto') return `Abriu modal “${details.rotulo || 'Modal'}”`;
    if (event.tipo === 'inatividade') return 'Ficou inativo';
    if (event.tipo === 'retorno_atividade') return 'Retomou a atividade';
    if (event.tipo === 'download' || event.tipo === 'download_exportacao') return `Baixou ou exportou ${details.rotulo || context || 'arquivo / relatório'}`;
    if (event.tipo === 'alteracao_api') return context ? `Executou uma ação em ${context}` : 'Executou uma ação de alteração';
    if (event.tipo === 'erro_api') return context ? `Erro ao executar ação em ${context}` : 'Uma ação da API retornou erro';
    if (event.tipo === 'erro_pagina') return `Erro ao abrir ${pageName(event.pagina)}`;
    return String(event.tipo || 'Atividade').replace(/_/g, ' ');
  }

  function markerClass(event) {
    const category = eventCategory(event);
    if (category === 'errors') return 'error';
    if (category === 'deletes') return 'delete';
    if (category === 'creates') return 'create';
    if (category === 'edits' || category === 'changes') return 'change';
    if (category === 'session' && event.tipo === 'login') return 'login';
    if (category === 'searches' || category === 'filters') return 'search';
    if (event.severidade === 'importante') return 'important';
    return '';
  }

  function severityLabel(event) {
    const category = eventCategory(event);
    if (category === 'errors') return 'erro';
    if (category === 'deletes') return 'exclusão';
    if (category === 'creates') return 'cadastro';
    if (category === 'edits') return 'edição';
    if (event.severidade === 'importante') return 'importante';
    if (event.severidade === 'alteracao' || event.fonte === 'alteracao_dados') return 'alteração';
    return 'atividade';
  }

  function eventSearchText(event) {
    const details = detailsOf(event);
    const values = [
      eventTitle(event), event.tipo, event.fonte, event.pagina, event.pagina_origem, event.modulo, event.entidade_tipo,
      event.entidade_id, event.campo, event.campo_nome, event.secao, event.acao, event.origem, event.rota, event.rota_origem,
      details.rotulo, details.valor, details.categoria, details.href, details.modulo, details.entidade_tipo, details.entidade_id,
      prettyValue(event.valor_anterior), prettyValue(event.valor_novo), event.ip,
    ];
    return values.filter((v) => v !== undefined && v !== null).join(' ').toLowerCase();
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Valora-Audit-Session': pageSessionId,
        ...(options.headers || {}),
      },
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(typeof data.detail === 'string' ? data.detail : 'Não foi possível concluir a operação.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function clearTimers() {
    clearInterval(pollTimer);
    clearInterval(analyticsTimer);
    pollTimer = analyticsTimer = null;
  }

  function showLocked(message = '') {
    clearTimers();
    closeEventModal();
    closeSessionModal();
    dashboardView.hidden = true;
    lockView.hidden = false;
    unlockError.textContent = message;
    devPassword.value = '';
    setTimeout(() => devPassword.focus(), 40);
  }

  function showDashboard() {
    lockView.hidden = true;
    dashboardView.hidden = false;
    unlockError.textContent = '';
    startPolling();
  }

  async function unlock(event) {
    event.preventDefault();
    const senha = devPassword.value;
    if (!senha) return;
    unlockButton.disabled = true;
    unlockError.textContent = '';
    try {
      await api('/api/auditoria-programadora/desbloquear', {
        method: 'POST',
        body: JSON.stringify({ senha, pagina_sessao: pageSessionId }),
      });
      showDashboard();
      await Promise.all([loadEvents(true), loadAnalytics(true)]);
    } catch (error) {
      unlockError.textContent = error.message || 'Senha incorreta.';
      devPassword.select();
    } finally {
      unlockButton.disabled = false;
    }
  }

  async function lock() {
    try { await api('/api/auditoria-programadora/bloquear', { method: 'POST', body: '{}' }); } catch (_) {}
    pageSessionId = createPageSessionId();
    latestPayload = analyticsPayload = null;
    periodEvents = [];
    showLocked();
  }

  function mergeEvents() {
    const map = new Map();
    for (const event of analyticsPayload?.eventos_periodo || []) map.set(event.key, event);
    for (const event of latestPayload?.eventos || []) map.set(event.key, event);
    periodEvents = Array.from(map.values()).sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
  }

  function renderUserHeader() {
    const payload = latestPayload;
    if (!payload) return;
    $('targetEmail').textContent = payload.target_email || '—';
    const user = payload.usuario;
    const summary = $('userSummary');
    if (user) {
      const bits = [user.nome, user.cargo, user.papel ? `papel: ${user.papel}` : '', `ID ${user.id}`, `empresa ${user.empresa_id}`].filter(Boolean);
      summary.innerHTML = `<i class="fa-regular fa-user"></i>&nbsp;&nbsp;${bits.map(escapeHtml).join(' &nbsp;•&nbsp; ')}`;
      summary.hidden = false;
    } else {
      summary.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;&nbsp;Usuário ${escapeHtml(payload.target_email || '')} não encontrado.`;
      summary.hidden = false;
    }
  }

  function renderLive() {
    if (!latestPayload) return;
    const state = latestPayload.estado || {};
    const online = !!state.online;
    const activityState = state.estado_atividade || (online ? 'ativo' : 'offline');
    $('statusOrb').className = `status-orb ${online ? 'online' : 'offline'}`;
    $('liveBadge').className = `status-badge ${online ? 'online' : 'offline'}`;
    $('liveBadge').textContent = online ? 'Online' : 'Offline';
    const activityBadge = $('activityBadge');
    if (online) {
      activityBadge.hidden = false;
      activityBadge.className = `activity-badge ${activityState === 'ocioso' ? 'idle' : ''}`;
      activityBadge.textContent = activityState === 'ocioso' ? 'Ocioso' : 'Ativo';
    } else {
      activityBadge.hidden = true;
    }
    $('liveStatus').textContent = online ? `Em ${pageName(state.pagina_atual)}` : 'Sem atividade recente';
    $('liveDescription').textContent = state.rota_atual
      ? `${state.metodo && state.metodo !== 'CLIENT' ? `${state.metodo} ` : ''}${state.rota_atual}`
      : 'Aguardando atividade do usuário.';
    $('liveAction').textContent = latestPayload.ultima_acao
      ? `Última ação: ${eventTitle(latestPayload.ultima_acao)} · ${relativeTime(latestPayload.ultima_acao.criado_em)}`
      : 'Última ação: —';
    $('currentPageTime').textContent = online ? durationText(state.segundos_pagina_atual || 0) : '—';
    $('lastActivity').textContent = state.ultima_atividade ? `${relativeTime(state.ultima_atividade)} · ${localDate(state.ultima_atividade)}` : '—';
    $('lastIp').textContent = state.ultimo_ip || '—';
    $('currentDevice').textContent = deviceText(state.dispositivo);
    $('lastLogin').textContent = state.ultimo_login ? localDate(state.ultimo_login) : '—';
    $('currentPage').textContent = state.pagina_atual ? pageName(state.pagina_atual) : '—';
  }

  function setCounter(id, value) {
    const el = $(id);
    if (el) el.textContent = String(Number(value || 0));
  }

  function renderTodaySummary() {
    const live = latestPayload?.resumo || {};
    const today = analyticsPayload?.hoje || {};
    $('firstActivityToday').textContent = today.primeiro_acesso ? localDate(today.primeiro_acesso) : '—';
    $('lastActivityToday').textContent = today.ultima_atividade ? localDate(today.ultima_atividade) : '—';
    $('activeTimeToday').textContent = durationText(today.tempo_ativo_segundos || 0);
    $('idleTimeToday').textContent = durationText(today.tempo_ocioso_segundos || 0);
    setCounter('clicksToday', live.cliques_hoje);
    setCounter('searchesToday', live.pesquisas_hoje);
    setCounter('filtersToday', live.filtros_hoje);
    setCounter('changesToday', live.alteracoes_hoje);
    setCounter('createsToday', live.cadastros_hoje);
    setCounter('deletesToday', live.exclusoes_hoje);
    setCounter('downloadsToday', live.downloads_hoje);
    setCounter('modalsToday', live.modais_hoje);
    setCounter('changesTabToday', live.alteracoes_hoje);
    setCounter('createsTabToday', live.cadastros_hoje);
    setCounter('deletesTabToday', live.exclusoes_hoje);
  }

  function renderRanking(containerId, items, keyName, emptyId = null, limit = 10) {
    const container = $(containerId);
    if (!container) return;
    const list = Array.isArray(items) ? items.slice(0, limit) : [];
    if (emptyId) $(emptyId).hidden = list.length > 0;
    if (!list.length) {
      container.innerHTML = '';
      return;
    }
    const max = Math.max(...list.map((item) => Number(item.segundos || item.acoes || 0)), 1);
    container.innerHTML = list.map((item) => {
      const name = item[keyName] || 'Valora';
      const value = Number(item.segundos || 0);
      const width = Math.max(3, Math.round(((value || Number(item.acoes || 0)) / max) * 100));
      return `<div class="ranking-row"><div class="ranking-name"><strong>${escapeHtml(pageName(name))}</strong><span><i style="width:${width}%"></i></span></div><div class="ranking-value"><strong>${escapeHtml(durationText(value))}</strong><small>${Number(item.acoes || 0)} ações</small></div></div>`;
    }).join('');
  }

  function renderIdleList(containerId, emptyId, items, limit = 8) {
    const container = $(containerId);
    const empty = $(emptyId);
    const list = Array.isArray(items) ? items.slice(0, limit) : [];
    empty.hidden = list.length > 0;
    container.innerHTML = list.map((item) => `<div class="compact-item"><span class="compact-icon"><i class="fa-regular fa-moon"></i></span><div><strong>${escapeHtml(durationText(item.segundos))} sem atividade</strong><small>${escapeHtml(pageName(item.pagina || 'Valora'))} · ${escapeHtml(localDate(item.inicio))} → ${escapeHtml(localDate(item.fim, false))}</small></div><time>${escapeHtml(relativeTime(item.fim))}</time></div>`).join('');
  }

  function renderCritical() {
    const section = $('criticalSection');
    const container = $('criticalList');
    const list = latestPayload?.criticos || [];
    section.hidden = list.length === 0;
    $('criticalCount').textContent = String(list.length);
    container.innerHTML = list.map((event) => {
      const category = eventCategory(event);
      const classes = [category === 'errors' ? 'is-error' : '', category === 'deletes' ? 'is-delete' : ''].filter(Boolean).join(' ');
      const icon = category === 'deletes' ? 'fa-trash-can' : category === 'errors' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
      return `<button type="button" class="critical-item ${classes}" data-event-key="${escapeHtml(event.key)}"><span class="critical-icon"><i class="fa-solid ${icon}"></i></span><span class="critical-copy"><strong>${escapeHtml(eventTitle(event))}</strong><small>${escapeHtml(localDate(event.criado_em))} · ${escapeHtml(pageName(eventPage(event)))}</small></span><i class="fa-solid fa-chevron-right"></i></button>`;
    }).join('');
  }

  function renderAgora() {
    renderUserHeader();
    renderLive();
    renderTodaySummary();
    renderRanking('todayModuleTime', analyticsPayload?.tempo_modulos_hoje || [], 'modulo', 'todayModuleEmpty', 10);
    renderIdleList('recentIdleList', 'recentIdleEmpty', analyticsPayload?.inatividades || [], 7);
    renderCritical();
  }

  function fillSelect(select, values, labelAll) {
    if (!select) return;
    const current = select.value || 'all';
    const unique = Array.from(new Set((values || []).filter(Boolean))).sort((a, b) => pageName(a).localeCompare(pageName(b), 'pt-BR'));
    select.innerHTML = `<option value="all">${escapeHtml(labelAll)}</option>` + unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(pageName(value))}</option>`).join('');
    select.value = unique.includes(current) ? current : 'all';
  }

  function renderFilterOptions() {
    const filters = analyticsPayload?.filtros || {};
    fillSelect($('moduleFilter'), filters.modulos, 'Todos');
    fillSelect($('pageFilter'), filters.paginas, 'Todas');
    fillSelect($('changeModuleFilter'), filters.modulos, 'Todos');
  }

  function periodPass(event) {
    const filter = $('periodFilter').value;
    if (filter === 'all') return true;
    const dt = dateObj(event.criado_em);
    if (!dt) return false;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (filter === 'today') return dt >= startToday;
    if (filter === 'yesterday') {
      const start = new Date(startToday); start.setDate(start.getDate() - 1);
      return dt >= start && dt < startToday;
    }
    if (filter.endsWith('d')) {
      const days = Number(filter.replace('d', ''));
      return dt >= new Date(Date.now() - days * 86400000);
    }
    if (filter === 'custom') {
      const startValue = $('startDateFilter').value;
      const endValue = $('endDateFilter').value;
      const start = startValue ? new Date(`${startValue}T00:00:00`) : null;
      const end = endValue ? new Date(`${endValue}T23:59:59.999`) : null;
      if (start && dt < start) return false;
      if (end && dt > end) return false;
      return true;
    }
    return true;
  }

  function typePass(event) {
    const selected = $('typeFilter').value;
    if (selected === 'all') return true;
    const category = eventCategory(event);
    if (selected === 'changes') return category === 'changes' || category === 'edits';
    return category === selected;
  }

  function metaHtml(event) {
    const details = detailsOf(event);
    const meta = [];
    if (event.pagina || event.pagina_origem) meta.push(`<span><i class="fa-regular fa-window-maximize"></i>${escapeHtml(pageName(event.pagina || event.pagina_origem))}</span>`);
    const context = actionContext(event);
    if (context) meta.push(`<span><i class="fa-solid fa-cube"></i>${escapeHtml(context)}</span>`);
    if (event.metodo && event.metodo !== 'CLIENT') meta.push(`<span class="method-pill">${escapeHtml(event.metodo)}</span>`);
    if (event.status_code) meta.push(`<span class="status-code ${Number(event.status_code) >= 400 ? 'bad' : ''}">${escapeHtml(event.status_code)}</span>`);
    if (event.ip) meta.push(`<span><i class="fa-solid fa-network-wired"></i>${escapeHtml(event.ip)}</span>`);
    if (details.sessao_cliente) meta.push(`<span title="Sessão"><i class="fa-solid fa-link"></i>${escapeHtml(String(details.sessao_cliente).slice(0, 8))}</span>`);
    return meta.join('');
  }

  function inlineDetail(event) {
    const details = detailsOf(event);
    if (event.fonte === 'alteracao_dados') {
      return `<div class="change-box"><div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div><div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div><div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div></div>`;
    }
    if (event.tipo === 'pesquisa' || event.tipo === 'filtro') return `<div class="activity-detail"><span>${escapeHtml(details.rotulo || 'Valor')}</span><strong>${escapeHtml(details.valor || '—')}</strong></div>`;
    if (event.tipo === 'modal_aberto') return `<div class="activity-detail"><span>Modal</span><strong>${escapeHtml(details.rotulo || details.modal_id || 'Modal')}</strong></div>`;
    if (event.tipo === 'inatividade' || event.tipo === 'retorno_atividade') {
      const seconds = details.duracao_inatividade_segundos || details.duracao_ociosa_segundos;
      return seconds ? `<div class="activity-detail"><span>Duração</span><strong>${escapeHtml(durationText(seconds))}</strong></div>` : '';
    }
    if (event.severidade === 'erro') return `<div class="detail-box error-detail">${escapeHtml(details.motivo || details.observacao || `Retorno HTTP ${event.status_code || 'com erro'}`)}</div>`;
    return '';
  }

  function renderTimeline() {
    const container = $('timeline');
    const empty = $('emptyState');
    if (!container) return;
    const search = $('searchInput').value.trim().toLowerCase();
    const module = $('moduleFilter').value;
    const page = $('pageFilter').value;
    const events = periodEvents.filter((event) => {
      if (!periodPass(event) || !typePass(event)) return false;
      if (module !== 'all' && eventModule(event) !== module) return false;
      if (page !== 'all' && eventPage(event) !== page) return false;
      if (search && !eventSearchText(event).includes(search)) return false;
      return true;
    });
    $('timelineCount').textContent = String(events.length);
    empty.hidden = events.length > 0;
    container.hidden = events.length === 0;
    container.innerHTML = events.map((event) => {
      const category = eventCategory(event);
      const extraClass = category === 'deletes' ? 'is-delete' : event.severidade === 'importante' ? 'is-important' : '';
      return `<article class="timeline-item"><div class="timeline-time">${escapeHtml(localDate(event.criado_em, false))}<br>${escapeHtml(shortDate(event.criado_em))}</div><div class="timeline-marker"><span class="marker-dot ${markerClass(event)}"></span></div><div class="event-card ${extraClass}" data-event-key="${escapeHtml(event.key)}" tabindex="0" role="button"><div class="event-top"><div class="event-copy"><p class="event-title">${escapeHtml(eventTitle(event))}</p><div class="event-meta">${metaHtml(event)}</div></div><div class="event-side"><span class="source-pill severity-${escapeHtml(event.severidade || 'normal')}">${escapeHtml(severityLabel(event))}</span><i class="fa-solid fa-chevron-right event-chevron"></i></div></div>${event.rota && event.metodo !== 'CLIENT' ? `<div class="event-route">${escapeHtml(event.rota)}</div>` : ''}${inlineDetail(event)}</div></article>`;
    }).join('');
  }

  function renderChanges() {
    const allChanges = [
      ...(analyticsPayload?.alteracoes || []),
      ...periodEvents.filter((event) => ['creates', 'edits', 'deletes', 'changes'].includes(eventCategory(event))),
    ];
    const deduped = Array.from(new Map(allChanges.map((event) => [event.key, event])).values())
      .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')));
    setCounter('changesPeriodTotal', deduped.length);
    const search = $('changeSearch').value.trim().toLowerCase();
    const module = $('changeModuleFilter').value;
    const severity = $('changeSeverityFilter').value;
    const list = deduped.filter((event) => {
      if (module !== 'all' && eventModule(event) !== module) return false;
      if (severity === 'important' && event.severidade !== 'importante' && eventCategory(event) !== 'deletes') return false;
      if (severity === 'normal' && (event.severidade === 'importante' || eventCategory(event) === 'deletes')) return false;
      if (search && !eventSearchText(event).includes(search)) return false;
      return true;
    });
    $('changeEmpty').hidden = list.length > 0;
    $('changeList').innerHTML = list.map((event) => {
      const category = eventCategory(event);
      const classes = [event.severidade === 'importante' ? 'is-important' : '', category === 'deletes' ? 'is-delete' : ''].filter(Boolean).join(' ');
      const source = event.pagina_origem ? `Tela: ${pageName(event.pagina_origem)}` : event.origem ? `Origem: ${event.origem}` : '';
      const changeBox = event.fonte === 'alteracao_dados'
        ? `<div class="change-box"><div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div><div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div><div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div></div>`
        : `<div class="activity-detail"><span>Operação</span><strong>${escapeHtml(severityLabel(event))}</strong></div>`;
      return `<article class="change-record ${classes}" data-event-key="${escapeHtml(event.key)}" tabindex="0"><div class="change-record-head"><div class="change-record-title"><strong>${escapeHtml(eventTitle(event))}</strong><span>${escapeHtml([actionContext(event), source].filter(Boolean).join(' · '))}</span></div><time class="change-record-time">${escapeHtml(localDate(event.criado_em))}</time></div>${changeBox}</article>`;
    }).join('');
  }

  function renderLoginHistory() {
    const list = analyticsPayload?.historico_login || [];
    $('loginHistoryEmpty').hidden = list.length > 0;
    $('loginHistory').innerHTML = list.slice(0, 18).map((item) => {
      const title = item.tipo === 'login' ? 'Entrou' : item.tipo === 'logout' ? 'Saiu' : 'Falha no login';
      const icon = item.tipo === 'logout' ? 'fa-right-from-bracket' : item.tipo === 'login_falhou' ? 'fa-triangle-exclamation' : 'fa-right-to-bracket';
      return `<div class="compact-item"><span class="compact-icon"><i class="fa-solid ${icon}"></i></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(deviceText(item.dispositivo))} · ${escapeHtml(item.ip || 'IP não informado')}</small></div><time>${escapeHtml(localDate(item.criado_em))}</time></div>`;
    }).join('');
  }

  function renderSessions() {
    const list = analyticsPayload?.sessoes || [];
    $('sessionEmpty').hidden = list.length > 0;
    $('sessionList').innerHTML = list.map((session) => `<button class="session-card" type="button" data-session-id="${escapeHtml(session.id)}"><div class="session-card-head"><div><strong>${escapeHtml(localDate(session.inicio))}</strong><span> → ${escapeHtml(localDate(session.fim, false))}</span></div><span>${escapeHtml(deviceText(session.dispositivo))}</span></div><div class="session-metrics"><div><span>Duração</span><strong>${escapeHtml(durationText(session.duracao_segundos))}</strong></div><div><span>Ativo</span><strong>${escapeHtml(durationText(session.tempo_ativo_segundos))}</strong></div><div><span>Ocioso</span><strong>${escapeHtml(durationText(session.tempo_ocioso_segundos))}</strong></div><div><span>Ações</span><strong>${escapeHtml(session.quantidade_acoes)}</strong></div></div></button>`).join('');
    renderLoginHistory();
    renderIdleList('idleHistory', 'idleHistoryEmpty', analyticsPayload?.inatividades || [], 30);
  }

  function compareMetric(label, key, comparison, formatter = (v) => String(v)) {
    const current = Number(comparison?.atual?.[key] || 0);
    const previous = Number(comparison?.anterior?.[key] || 0);
    const delta = Number(comparison?.variacao?.[key] || 0);
    const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    const sign = delta > 0 ? '+' : '';
    return `<div class="compare-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatter(current))}</strong><small class="compare-delta ${cls}">${escapeHtml(`${sign}${delta}%`)} · anterior ${escapeHtml(formatter(previous))}</small></div>`;
  }

  function renderComparison(containerId, comparison) {
    $(containerId).innerHTML = [
      compareMetric('Ações', 'atividades', comparison),
      compareMetric('Tempo ativo', 'tempo_ativo_segundos', comparison, durationText),
      compareMetric('Cliques', 'cliques', comparison),
      compareMetric('Pesquisas', 'pesquisas', comparison),
      compareMetric('Alterações', 'alteracoes', comparison),
      compareMetric('Downloads', 'downloads', comparison),
    ].join('');
  }

  function renderCalendar() {
    const items = analyticsPayload?.calendario || [];
    $('activityCalendar').innerHTML = items.map((item) => `<span class="calendar-day" data-level="${Number(item.intensidade || 0)}" title="${escapeHtml(`${dateLabel(item.data)} · ${item.atividades || 0} ações · ${durationText(item.tempo_ativo_segundos || 0)} ativo`)}"></span>`).join('');
  }

  function renderDailySummary() {
    const items = analyticsPayload?.resumo_diario || [];
    $('dailySummaryBody').innerHTML = items.map((item) => `<tr><td>${escapeHtml(dateLabel(item.data))}</td><td>${escapeHtml(item.primeira_atividade ? localDate(item.primeira_atividade, false) : '—')}</td><td>${escapeHtml(item.ultima_atividade ? localDate(item.ultima_atividade, false) : '—')}</td><td>${escapeHtml(durationText(item.tempo_ativo_segundos))}</td><td>${escapeHtml(durationText(item.tempo_ocioso_segundos))}</td><td>${escapeHtml(item.atividades || 0)}</td><td>${escapeHtml(item.alteracoes || 0)}</td><td>${escapeHtml(item.cadastros || 0)}</td><td>${escapeHtml(item.exclusoes || 0)}</td><td>${escapeHtml(item.downloads || 0)}</td></tr>`).join('');
  }

  function renderStats() {
    renderComparison('compareToday', analyticsPayload?.comparacoes?.hoje_ontem || {});
    renderComparison('compareWeek', analyticsPayload?.comparacoes?.semana_atual_anterior || {});
    renderCalendar();
    renderRanking('pageRanking', analyticsPayload?.ranking_paginas || [], 'pagina', null, 12);
    renderRanking('moduleRanking', analyticsPayload?.ranking_modulos || [], 'modulo', null, 12);
    renderDailySummary();
  }

  function renderAll() {
    mergeEvents();
    renderAgora();
    renderFilterOptions();
    renderTimeline();
    renderChanges();
    renderSessions();
    renderStats();
  }

  function eventByKey(key) {
    return periodEvents.find((item) => item.key === key)
      || latestPayload?.eventos?.find((item) => item.key === key)
      || analyticsPayload?.alteracoes?.find((item) => item.key === key)
      || null;
  }

  function detailRow(label, value, mono = false) {
    if (value === undefined || value === null || value === '') return '';
    return `<div class="modal-detail-row"><span>${escapeHtml(label)}</span><div class="${mono ? 'mono' : ''}">${escapeHtml(prettyValue(value))}</div></div>`;
  }

  function openEventModal(key) {
    const event = eventByKey(key);
    if (!event) return;
    const details = detailsOf(event);
    $('eventModalTitle').textContent = eventTitle(event);
    $('eventModalSubtitle').textContent = `${localDate(event.criado_em)} · ${severityLabel(event)}`;
    let body = '';
    if (event.fonte === 'alteracao_dados') {
      body += `<section class="modal-change-section"><h3>Alteração de dados</h3><div class="change-box"><div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div><div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div><div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div></div></section>`;
    }
    body += '<section class="modal-detail-grid">';
    body += detailRow('Data e hora', localDate(event.criado_em));
    body += detailRow('Página', pageName(event.pagina || event.pagina_origem));
    body += detailRow('Módulo / registro', actionContext(event));
    body += detailRow('ID do registro', event.entidade_id ?? details.entidade_id);
    body += detailRow('Tipo de registro', event.entidade_tipo || details.entidade_tipo);
    body += detailRow('Tela de origem', event.pagina_origem ? pageName(event.pagina_origem) : '');
    body += detailRow('Rota de origem', event.rota_origem, true);
    body += detailRow('Rota', event.rota, true);
    body += detailRow('Método', event.metodo);
    body += detailRow('Operação', eventOperation(event));
    body += detailRow('Status HTTP', event.status_code);
    body += detailRow('IP', event.ip, true);
    body += detailRow('Dispositivo', deviceText(event.dispositivo));
    body += detailRow('Ação', event.acao);
    body += detailRow('Seção', event.secao);
    body += detailRow('Campo', event.campo_nome || event.campo);
    body += detailRow('Origem', event.origem);
    body += detailRow('ID da requisição', details.request_id, true);
    body += detailRow('Sessão do navegador', details.sessao_cliente, true);
    body += detailRow('Elemento', details.elemento, true);
    body += detailRow('Categoria', details.categoria);
    body += detailRow('Pesquisa / filtro', details.valor);
    body += detailRow('Modal', details.rotulo && event.tipo === 'modal_aberto' ? details.rotulo : '');
    body += detailRow('Destino', details.href, true);
    body += detailRow('Duração', details.duracao_segundos ? durationText(details.duracao_segundos) : '');
    body += detailRow('Inatividade', details.duracao_inatividade_segundos ? durationText(details.duracao_inatividade_segundos) : '');
    body += detailRow('Motivo', details.motivo || details.observacao);
    body += '</section>';
    if (Object.keys(details).length) body += `<details class="raw-details"><summary>Ver dados técnicos do evento</summary><pre>${escapeHtml(prettyValue(details))}</pre></details>`;
    $('eventModalBody').innerHTML = body || '<div class="mini-empty">Sem detalhes adicionais.</div>';
    eventModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeEventModal() {
    eventModal.hidden = true;
    if (sessionModal.hidden) document.body.classList.remove('modal-open');
  }

  function sessionById(id) {
    return analyticsPayload?.sessoes?.find((item) => item.id === id) || null;
  }

  function openSessionModal(id) {
    const session = sessionById(id);
    if (!session) return;
    $('sessionModalTitle').textContent = `Sessão de ${localDate(session.inicio)}`;
    $('sessionModalSubtitle').textContent = `${durationText(session.duracao_segundos)} · ${deviceText(session.dispositivo)} · ${session.ip || 'IP não informado'}`;
    const metrics = `<section class="modal-detail-grid">${detailRow('Início', localDate(session.inicio))}${detailRow('Fim', localDate(session.fim))}${detailRow('Duração', durationText(session.duracao_segundos))}${detailRow('Tempo ativo', durationText(session.tempo_ativo_segundos))}${detailRow('Tempo ocioso', durationText(session.tempo_ocioso_segundos))}${detailRow('Ações', session.quantidade_acoes)}${detailRow('IP(s)', (session.ips || []).join(', '), true)}${detailRow('Dispositivo', deviceText(session.dispositivo))}${detailRow('Página inicial', pageName(session.pagina_inicial))}${detailRow('Página final', pageName(session.pagina_final))}${detailRow('Login registrado', session.login_registrado ? 'Sim' : 'Não')}${detailRow('Logout registrado', session.logout_registrado ? 'Sim' : 'Não')}</section>`;
    const pageRank = `<section class="session-section"><h3>Tempo por página nesta sessão</h3><div class="ranking-list">${(session.tempo_paginas || []).slice(0, 12).map((item) => `<div class="ranking-row"><div class="ranking-name"><strong>${escapeHtml(pageName(item.pagina))}</strong></div><div class="ranking-value"><strong>${escapeHtml(durationText(item.segundos))}</strong></div></div>`).join('') || '<div class="mini-empty">Sem cálculo por página.</div>'}</div></section>`;
    const idle = `<section class="session-section"><h3>Inatividade nesta sessão</h3><div class="compact-list">${(session.inatividades || []).map((item) => `<div class="compact-item"><span class="compact-icon"><i class="fa-regular fa-moon"></i></span><div><strong>${escapeHtml(durationText(item.segundos))}</strong><small>${escapeHtml(pageName(item.pagina))}</small></div><time>${escapeHtml(localDate(item.inicio))}</time></div>`).join('') || '<div class="mini-empty">Nenhum período de inatividade.</div>'}</div></section>`;
    const sequence = `<section class="session-section"><h3>Sequência completa de ações</h3><div class="session-timeline">${(session.eventos || []).map((event) => `<div class="session-event"><time>${escapeHtml(localDate(event.criado_em, false))}</time><i class="${markerClass(event)}"></i><div><strong>${escapeHtml(eventTitle(event))}</strong><small>${escapeHtml([pageName(eventPage(event)), actionContext(event)].filter(Boolean).join(' · '))}</small></div></div>`).join('') || '<div class="mini-empty">Nenhum evento detalhado.</div>'}</div></section>`;
    $('sessionModalBody').innerHTML = metrics + pageRank + idle + sequence;
    sessionModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeSessionModal() {
    sessionModal.hidden = true;
    if (eventModal.hidden) document.body.classList.remove('modal-open');
  }

  function setActiveTab(name) {
    $$('.audit-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === name));
    $$('.tab-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === name));
  }

  async function loadEvents(force = false) {
    if (loadingEvents && !force) return;
    if (document.hidden && !force) return;
    loadingEvents = true;
    refreshButton?.classList.add('is-loading');
    try {
      latestPayload = await api('/api/auditoria-programadora/eventos?limit=900');
      mergeEvents();
      renderAgora();
      renderTimeline();
      renderChanges();
    } catch (error) {
      if (error.status === 403) showLocked('A proteção expirou. Digite a senha novamente.');
      else if (error.status === 401) window.location.href = '/login';
    } finally {
      loadingEvents = false;
      refreshButton?.classList.remove('is-loading');
    }
  }

  async function loadAnalytics(force = false) {
    if (loadingAnalytics && !force) return;
    if (document.hidden && !force) return;
    loadingAnalytics = true;
    try {
      analyticsPayload = await api('/api/auditoria-programadora/analise?dias=60');
      renderAll();
    } catch (error) {
      if (error.status === 403) showLocked('A proteção expirou. Digite a senha novamente.');
      else if (error.status === 401) window.location.href = '/login';
    } finally {
      loadingAnalytics = false;
    }
  }

  function startPolling() {
    clearTimers();
    pollTimer = setInterval(() => loadEvents(false), 3000);
    analyticsTimer = setInterval(() => loadAnalytics(false), 60000);
  }

  async function refreshAll() {
    await Promise.all([loadEvents(true), loadAnalytics(true)]);
  }

  async function bootstrap() {
    try {
      await api('/api/auditoria-programadora/status');
      showDashboard();
      await Promise.all([loadEvents(true), loadAnalytics(true)]);
    } catch (error) {
      if (error.status === 401) {
        window.location.href = '/login';
        return;
      }
      showLocked();
    }
  }

  unlockForm.addEventListener('submit', unlock);
  togglePassword.addEventListener('click', () => {
    const showing = devPassword.type === 'text';
    devPassword.type = showing ? 'password' : 'text';
    togglePassword.innerHTML = showing ? '<i class="fa-regular fa-eye"></i>' : '<i class="fa-regular fa-eye-slash"></i>';
    togglePassword.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  });
  lockButton.addEventListener('click', lock);
  refreshButton.addEventListener('click', refreshAll);

  $$('.audit-tab').forEach((button) => button.addEventListener('click', () => setActiveTab(button.dataset.tab)));
  ['searchInput', 'changeSearch', 'startDateFilter', 'endDateFilter'].forEach((id) => $(id)?.addEventListener('input', id.startsWith('change') ? renderChanges : renderTimeline));
  ['typeFilter', 'moduleFilter', 'pageFilter'].forEach((id) => $(id)?.addEventListener('change', renderTimeline));
  ['changeModuleFilter', 'changeSeverityFilter'].forEach((id) => $(id)?.addEventListener('change', renderChanges));
  $('periodFilter').addEventListener('change', () => {
    $('customPeriod').hidden = $('periodFilter').value !== 'custom';
    renderTimeline();
  });

  document.addEventListener('click', (event) => {
    const eventOpener = event.target.closest('[data-event-key]');
    if (eventOpener) openEventModal(eventOpener.getAttribute('data-event-key'));
    const sessionOpener = event.target.closest('[data-session-id]');
    if (sessionOpener) openSessionModal(sessionOpener.getAttribute('data-session-id'));
    if (event.target.closest('[data-close-event]')) closeEventModal();
    if (event.target.closest('[data-close-session]')) closeSessionModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!eventModal.hidden) closeEventModal();
      if (!sessionModal.hidden) closeSessionModal();
    }
    const focusedEvent = document.activeElement?.closest?.('[data-event-key]');
    if (focusedEvent && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openEventModal(focusedEvent.getAttribute('data-event-key'));
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !dashboardView.hidden) refreshAll();
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    pageSessionId = createPageSessionId();
    latestPayload = analyticsPayload = null;
    periodEvents = [];
    showLocked();
    bootstrap();
  });

  bootstrap();
})();
