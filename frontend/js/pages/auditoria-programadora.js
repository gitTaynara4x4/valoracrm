(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const lockView = $('lockView');
  const dashboardView = $('dashboardView');
  const unlockForm = $('unlockForm');
  const devPassword = $('devPassword');
  const unlockButton = $('unlockButton');
  const unlockError = $('unlockError');
  const togglePassword = $('togglePassword');
  const lockButton = $('lockButton');
  const refreshButton = $('refreshButton');
  const typeFilter = $('typeFilter');
  const periodFilter = $('periodFilter');
  const searchInput = $('searchInput');
  const timeline = $('timeline');
  const emptyState = $('emptyState');
  const eventModal = $('eventModal');

  let pollTimer = null;
  let loading = false;
  let latestPayload = null;

  function createPageSessionId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  let pageSessionId = createPageSessionId();

  const PAGE_NAMES = {
    dashboard: 'Dashboard', clientes: 'Clientes', fornecedores: 'Fornecedores', produtos: 'Produtos', patrimonio: 'Patrimônio',
    cotacoes: 'Cotações', orcamentos: 'Orçamentos', propostas: 'Propostas', financeiro: 'Financeiro', 'vendas-financeiro': 'Vendas / Financeiro',
    'contas-receber': 'Contas a receber', 'contas-pagar': 'Contas a pagar', 'fluxo-caixa': 'Fluxo de caixa', usuarios: 'Colaboradores',
    empresa: 'Empresa', configuracoes: 'Configurações', formularios: 'Formulários', agenda: 'Agenda', 'arquivos-tecnicos': 'Arquivos técnicos',
    monitoramento: 'Monitoramento', ajuda: 'Ajuda', perfil: 'Perfil', 'formas-pagamento': 'Formas de pagamento',
    'contas-bancos': 'Contas e bancos', 'categorias-financeiras': 'Categorias financeiras', inicio: 'Início'
  };

  function pageName(value) {
    const raw = String(value || '').replace(/^\/+|\/+$/g, '').split('?')[0];
    return PAGE_NAMES[raw] || raw.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()) || 'Valora';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function prettyValue(value) {
    if (value === undefined || value === null || value === '') return '—';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
  }

  function localDate(value, withDate = true) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const options = withDate
      ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }
      : { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    return new Intl.DateTimeFormat('pt-BR', options).format(date);
  }

  function dateOnly(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(date);
  }

  function relativeTime(value) {
    if (!value) return '—';
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '—';
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 10) return 'agora';
    if (seconds < 60) return `há ${seconds}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `há ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `há ${hours}h`;
    return localDate(value);
  }

  function durationText(seconds) {
    let total = Math.max(0, Number(seconds || 0));
    if (total < 60) return `${Math.round(total)}s`;
    const hours = Math.floor(total / 3600);
    total -= hours * 3600;
    const minutes = Math.round(total / 60);
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes} min`;
  }

  function deviceText(device) {
    if (!device) return '—';
    return [device.dispositivo, device.sistema, device.navegador].filter(Boolean).join(' · ') || '—';
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

  function showLocked(message = '') {
    clearInterval(pollTimer);
    pollTimer = null;
    closeEventModal();
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
      await loadEvents(true);
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
    latestPayload = null;
    showLocked();
  }

  function eventCategory(event) {
    if (event.severidade === 'erro' || Number(event.status_code || 0) >= 400 || event.tipo === 'login_falhou') return 'errors';
    if (event.fonte === 'alteracao_dados' || event.tipo === 'alteracao_api') return 'changes';
    if (event.tipo === 'click') return 'clicks';
    if (event.tipo === 'pesquisa' || event.tipo === 'filtro') return 'searches';
    if (event.tipo === 'download' || event.tipo === 'download_exportacao') return 'downloads';
    if (event.tipo === 'navegacao') return 'navigation';
    if (event.tipo === 'login' || event.tipo === 'logout') return 'session';
    return 'other';
  }

  function actionContext(event) {
    const details = event.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
    const module = event.modulo || details.modulo;
    const entityId = event.entidade_id ?? details.entidade_id;
    const entityType = event.entidade_tipo || details.entidade_tipo;
    if (module && entityId) return `${pageName(module)} #${entityId}`;
    if (entityType && entityId) return `${pageName(entityType)} #${entityId}`;
    if (module) return pageName(module);
    return event.pagina ? pageName(event.pagina) : '';
  }

  function eventTitle(event) {
    const details = event.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
    if (event.fonte === 'alteracao_dados') {
      const field = event.campo_nome || event.campo || event.secao || 'registro';
      const action = String(event.acao || 'alterou');
      const context = actionContext(event);
      return `${action.charAt(0).toUpperCase() + action.slice(1)} ${field}${context ? ` em ${context}` : ''}`;
    }
    if (event.tipo === 'login') return 'Entrou no Valora';
    if (event.tipo === 'logout') return 'Saiu do Valora';
    if (event.tipo === 'login_falhou') return 'Tentativa de login falhou';
    if (event.tipo === 'navegacao') return `Abriu ${pageName(event.pagina)}`;
    if (event.tipo === 'click') {
      const label = details.rotulo || details.elemento || 'um botão';
      return `Clicou em “${label}”`;
    }
    if (event.tipo === 'pesquisa') {
      const value = details.valor || '—';
      return `Pesquisou “${value}”`;
    }
    if (event.tipo === 'filtro') {
      const label = details.rotulo || 'Filtro';
      return `Aplicou ${label}: ${details.valor || '—'}`;
    }
    if (event.tipo === 'download' || event.tipo === 'download_exportacao') {
      const label = details.rotulo || actionContext(event) || 'arquivo / relatório';
      return `Baixou ou exportou ${label}`;
    }
    if (event.tipo === 'alteracao_api') {
      const context = actionContext(event);
      return context ? `Executou uma alteração em ${context}` : 'Executou uma ação de alteração';
    }
    if (event.tipo === 'erro_api') {
      const context = actionContext(event);
      return context ? `Erro ao executar ação em ${context}` : 'Uma ação da API retornou erro';
    }
    if (event.tipo === 'erro_pagina') return `Erro ao abrir ${pageName(event.pagina)}`;
    return event.tipo || 'Atividade';
  }

  function markerClass(event) {
    if (event.severidade === 'erro' || Number(event.status_code || 0) >= 400) return 'error';
    if (event.severidade === 'importante') return 'important';
    if (event.fonte === 'alteracao_dados' || event.tipo === 'alteracao_api') return 'change';
    if (event.tipo === 'login') return 'login';
    if (event.tipo === 'logout') return 'logout';
    if (event.tipo === 'pesquisa' || event.tipo === 'filtro') return 'search';
    if (event.tipo === 'download' || event.tipo === 'download_exportacao') return 'download';
    if (event.tipo === 'click') return 'click';
    return '';
  }

  function severityLabel(event) {
    if (event.severidade === 'erro') return 'erro';
    if (event.severidade === 'importante') return 'importante';
    if (event.severidade === 'alteracao') return 'alteração';
    return event.fonte === 'alteracao_dados' ? 'dados' : 'atividade';
  }

  function eventSearchText(event) {
    return [
      eventTitle(event), event.pagina, event.rota, event.modulo, event.entidade_tipo, event.entidade_id,
      event.secao, event.campo, event.campo_nome, event.acao, event.ip,
      prettyValue(event.valor_anterior), prettyValue(event.valor_novo), prettyValue(event.detalhes)
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function periodPass(event) {
    const value = periodFilter.value;
    if (value === 'all') return true;
    const time = new Date(event.criado_em).getTime();
    if (!Number.isFinite(time)) return false;
    const now = Date.now();
    if (value === '24h') return now - time <= 24 * 60 * 60 * 1000;
    if (value === '7d') return now - time <= 7 * 24 * 60 * 60 * 1000;
    if (value === 'today') {
      const date = new Date(time);
      const today = new Date();
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    }
    return true;
  }

  function metaHtml(event) {
    const details = event.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
    const meta = [];
    if (event.pagina) meta.push(`<span><i class="fa-regular fa-window-maximize"></i>${escapeHtml(pageName(event.pagina))}</span>`);
    const context = actionContext(event);
    if (context && (!event.pagina || context !== pageName(event.pagina))) meta.push(`<span><i class="fa-solid fa-cube"></i>${escapeHtml(context)}</span>`);
    if (event.metodo && event.metodo !== 'CLIENT') meta.push(`<span class="method-pill">${escapeHtml(event.metodo)}</span>`);
    if (event.status_code) meta.push(`<span class="status-code ${Number(event.status_code) >= 400 ? 'bad' : ''}">${escapeHtml(event.status_code)}</span>`);
    if (event.ip) meta.push(`<span><i class="fa-solid fa-network-wired"></i>${escapeHtml(event.ip)}</span>`);
    if (details.request_id) meta.push(`<span title="ID da requisição"><i class="fa-solid fa-fingerprint"></i>${escapeHtml(details.request_id)}</span>`);
    return meta.join('');
  }

  function inlineDetail(event) {
    const details = event.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
    if (event.fonte === 'alteracao_dados') {
      return `
        <div class="change-box">
          <div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div>
          <div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div>
          <div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div>
        </div>`;
    }
    if (event.tipo === 'pesquisa' || event.tipo === 'filtro') {
      return `<div class="activity-detail"><span>${escapeHtml(details.rotulo || 'Valor')}</span><strong>${escapeHtml(details.valor || '—')}</strong></div>`;
    }
    if (event.tipo === 'click' && details.categoria) {
      return `<div class="activity-detail"><span>Categoria</span><strong>${escapeHtml(details.categoria)}</strong>${details.href ? `<code>${escapeHtml(details.href)}</code>` : ''}</div>`;
    }
    if (event.severidade === 'erro') {
      const reason = details.motivo || details.observacao || `Retorno HTTP ${event.status_code || 'com erro'}`;
      return `<div class="detail-box error-detail">${escapeHtml(reason)}</div>`;
    }
    return '';
  }

  function renderTimeline() {
    if (!latestPayload) return;
    const type = typeFilter.value;
    const search = searchInput.value.trim().toLowerCase();
    const events = (latestPayload.eventos || []).filter((event) => {
      const category = eventCategory(event);
      if (type !== 'all' && category !== type) return false;
      if (!periodPass(event)) return false;
      if (search && !eventSearchText(event).includes(search)) return false;
      return true;
    });

    emptyState.hidden = events.length > 0;
    timeline.hidden = events.length === 0;
    timeline.innerHTML = events.map((event) => `
      <article class="timeline-item" data-key="${escapeHtml(event.key)}">
        <div class="timeline-time">${escapeHtml(localDate(event.criado_em, false))}<br>${escapeHtml(dateOnly(event.criado_em))}</div>
        <div class="timeline-marker"><span class="marker-dot ${markerClass(event)}"></span></div>
        <div class="event-card" data-event-key="${escapeHtml(event.key)}" tabindex="0" role="button" aria-label="Abrir detalhes: ${escapeHtml(eventTitle(event))}">
          <div class="event-top">
            <div class="event-copy">
              <p class="event-title">${escapeHtml(eventTitle(event))}</p>
              <div class="event-meta">${metaHtml(event)}</div>
            </div>
            <div class="event-side">
              <span class="source-pill severity-${escapeHtml(event.severidade || 'normal')}">${escapeHtml(severityLabel(event))}</span>
              <i class="fa-solid fa-chevron-right event-chevron"></i>
            </div>
          </div>
          ${event.rota && event.metodo !== 'CLIENT' ? `<div class="event-route">${escapeHtml(event.rota)}</div>` : ''}
          ${inlineDetail(event)}
        </div>
      </article>`).join('');
  }

  function renderModuleTimes(items) {
    const container = $('moduleTimeList');
    const empty = $('moduleTimeEmpty');
    const list = Array.isArray(items) ? items : [];
    empty.hidden = list.length > 0;
    container.hidden = list.length === 0;
    if (!list.length) {
      container.innerHTML = '';
      return;
    }
    const max = Math.max(...list.map((item) => Number(item.segundos || 0)), 1);
    container.innerHTML = list.map((item) => {
      const width = Math.max(4, Math.round((Number(item.segundos || 0) / max) * 100));
      return `
        <div class="module-time-row">
          <div class="module-time-head"><span>${escapeHtml(pageName(item.pagina))}</span><strong>${escapeHtml(durationText(item.segundos))}</strong></div>
          <div class="module-time-track"><span style="width:${width}%"></span></div>
        </div>`;
    }).join('');
  }

  function sessionTitle(item) {
    if (item.tipo === 'login') return 'Entrou';
    if (item.tipo === 'logout') return 'Saiu';
    if (item.tipo === 'login_falhou') return 'Falha no login';
    return item.tipo || 'Sessão';
  }

  function renderSessions(items) {
    const container = $('sessionList');
    const empty = $('sessionEmpty');
    const list = Array.isArray(items) ? items.slice(0, 8) : [];
    empty.hidden = list.length > 0;
    container.hidden = list.length === 0;
    if (!list.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = list.map((item) => `
      <div class="session-row ${item.tipo === 'login_falhou' ? 'session-error' : ''}">
        <span class="session-icon"><i class="fa-solid ${item.tipo === 'logout' ? 'fa-right-from-bracket' : item.tipo === 'login_falhou' ? 'fa-triangle-exclamation' : 'fa-right-to-bracket'}"></i></span>
        <div class="session-copy">
          <strong>${escapeHtml(sessionTitle(item))}</strong>
          <span>${escapeHtml(deviceText(item))}</span>
          <small>${escapeHtml(item.ip || 'IP não informado')}</small>
        </div>
        <time>${escapeHtml(localDate(item.criado_em))}</time>
      </div>`).join('');
  }

  function renderCritical(items) {
    const section = $('criticalSection');
    const container = $('criticalList');
    const list = Array.isArray(items) ? items : [];
    section.hidden = list.length === 0;
    $('criticalCount').textContent = String(list.length);
    if (!list.length) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = list.map((event) => `
      <button type="button" class="critical-item ${event.severidade === 'erro' ? 'is-error' : ''}" data-event-key="${escapeHtml(event.key)}">
        <span class="critical-icon"><i class="fa-solid ${event.severidade === 'erro' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}"></i></span>
        <span class="critical-copy"><strong>${escapeHtml(eventTitle(event))}</strong><small>${escapeHtml(localDate(event.criado_em))} · ${escapeHtml(pageName(event.pagina || event.modulo || 'Valora'))}</small></span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`).join('');
  }

  function setOnlineState(state, lastAction) {
    const online = !!state?.online;
    $('statusOrb').className = `status-orb ${online ? 'online' : 'offline'}`;
    $('liveBadge').className = `status-badge ${online ? 'online' : 'offline'}`;
    $('liveBadge').textContent = online ? 'Online' : 'Offline';
    $('liveStatus').textContent = online ? `Em ${pageName(state.pagina_atual)}` : 'Sem atividade recente';
    $('liveDescription').textContent = state?.rota_atual
      ? `${state.metodo && state.metodo !== 'CLIENT' ? `${state.metodo} ` : ''}${state.rota_atual}`
      : 'Aguardando atividade do usuário.';
    $('liveAction').textContent = lastAction ? `Última ação: ${eventTitle(lastAction)} · ${relativeTime(lastAction.criado_em)}` : 'Última ação: —';
    $('lastActivity').textContent = state?.ultima_atividade ? `${relativeTime(state.ultima_atividade)} · ${localDate(state.ultima_atividade)}` : '—';
    $('lastIp').textContent = state?.ultimo_ip || '—';
    $('currentDevice').textContent = deviceText(state?.dispositivo);
    $('lastLogin').textContent = state?.ultimo_login ? localDate(state.ultimo_login) : '—';
    $('currentPage').textContent = state?.pagina_atual ? pageName(state.pagina_atual) : '—';
  }

  function renderHeader(payload) {
    $('targetEmail').textContent = payload.target_email || '—';
    $('activitiesToday').textContent = String(payload.resumo?.atividades_hoje ?? 0);
    $('changesToday').textContent = String(payload.resumo?.alteracoes_hoje ?? 0);
    $('errorsToday').textContent = String(payload.resumo?.erros_hoje ?? 0);
    setOnlineState(payload.estado, payload.ultima_acao);

    const user = payload.usuario;
    const summary = $('userSummary');
    if (user) {
      const bits = [user.nome, user.cargo, user.papel ? `papel: ${user.papel}` : '', `ID ${user.id}`, `empresa ${user.empresa_id}`].filter(Boolean);
      summary.innerHTML = `<i class="fa-regular fa-user"></i>&nbsp;&nbsp;${bits.map(escapeHtml).join(' &nbsp;•&nbsp; ')}`;
      summary.hidden = false;
    } else {
      summary.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;&nbsp;Usuário ${escapeHtml(payload.target_email || '')} não encontrado na tabela de usuários.`;
      summary.hidden = false;
    }

    renderModuleTimes(payload.tempo_modulos);
    renderSessions(payload.sessoes);
    renderCritical(payload.criticos);
  }

  function eventByKey(key) {
    return (latestPayload?.eventos || []).find((item) => item.key === key) || null;
  }

  function detailRow(label, value, mono = false) {
    if (value === undefined || value === null || value === '') return '';
    return `<div class="modal-detail-row"><span>${escapeHtml(label)}</span><div class="${mono ? 'mono' : ''}">${escapeHtml(prettyValue(value))}</div></div>`;
  }

  function openEventModal(key) {
    const event = eventByKey(key);
    if (!event) return;
    const details = event.detalhes && typeof event.detalhes === 'object' ? event.detalhes : {};
    $('eventModalTitle').textContent = eventTitle(event);
    $('eventModalSubtitle').textContent = `${localDate(event.criado_em)} · ${severityLabel(event)}`;

    let body = '';
    if (event.fonte === 'alteracao_dados') {
      body += `
        <section class="modal-change-section">
          <h3>Alteração de dados</h3>
          <div class="change-box modal-change-box">
            <div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div>
            <div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div>
            <div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div>
          </div>
        </section>`;
    }

    body += '<section class="modal-detail-grid">';
    body += detailRow('Página', event.pagina ? pageName(event.pagina) : '');
    body += detailRow('Módulo / registro', actionContext(event));
    body += detailRow('Rota', event.rota, true);
    body += detailRow('Método', event.metodo);
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
    body += detailRow('Destino', details.href, true);
    body += detailRow('Motivo', details.motivo || details.observacao);
    body += '</section>';

    if (event.detalhes && Object.keys(details).length) {
      body += `<details class="raw-details"><summary>Ver dados técnicos do evento</summary><pre>${escapeHtml(prettyValue(details))}</pre></details>`;
    }

    $('eventModalBody').innerHTML = body || '<div class="mini-empty">Sem detalhes adicionais para este evento.</div>';
    eventModal.hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeEventModal() {
    if (!eventModal) return;
    eventModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  async function loadEvents(force = false) {
    if (loading && !force) return;
    if (document.hidden && !force) return;
    loading = true;
    refreshButton?.classList.add('is-loading');
    try {
      const payload = await api('/api/auditoria-programadora/eventos?limit=400');
      latestPayload = payload;
      renderHeader(payload);
      renderTimeline();
    } catch (error) {
      if (error.status === 403) {
        showLocked('A proteção expirou. Digite a senha novamente.');
      } else if (error.status === 401) {
        window.location.href = '/login';
      }
    } finally {
      loading = false;
      refreshButton?.classList.remove('is-loading');
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => loadEvents(false), 3000);
  }

  async function bootstrap() {
    try {
      await api('/api/auditoria-programadora/status');
      showDashboard();
      await loadEvents(true);
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
  refreshButton.addEventListener('click', () => loadEvents(true));
  typeFilter.addEventListener('change', renderTimeline);
  periodFilter.addEventListener('change', renderTimeline);
  searchInput.addEventListener('input', renderTimeline);

  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-event-key]');
    if (opener) openEventModal(opener.getAttribute('data-event-key'));
    if (event.target.closest('[data-close-event]')) closeEventModal();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !eventModal.hidden) closeEventModal();
    const focused = document.activeElement?.closest?.('[data-event-key]');
    if (focused && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openEventModal(focused.getAttribute('data-event-key'));
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !dashboardView.hidden) loadEvents(true); });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    pageSessionId = createPageSessionId();
    latestPayload = null;
    showLocked();
    bootstrap();
  });

  bootstrap();
})();
