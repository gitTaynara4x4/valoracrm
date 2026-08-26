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

  function auditTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function renderThemeControls() {
    const dark = auditTheme() === 'dark';
    $$('[data-audit-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', dark ? 'Ativar modo claro' : 'Ativar modo escuro');
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Usar modo claro' : 'Usar modo escuro';
      const icon = button.querySelector('i');
      if (icon) icon.className = dark ? 'fa-regular fa-sun' : 'fa-regular fa-moon';
      const label = button.querySelector('span');
      if (label) label.textContent = dark ? 'Claro' : 'Escuro';
    });
  }

  function toggleAuditTheme() {
    const next = auditTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('valora_auditoria_theme', next); } catch (_) {}
    renderThemeControls();
  }

  let pageSessionId = createPageSessionId();
  let pollTimer = null;
  let analyticsTimer = null;
  let loadingEvents = false;
  const loadingAnalytics = new Set();
  let latestPayload = null;
  let analyticsPayload = null;
  let dashboardPayload = null;
  let dashboardPeriodPreset = 'today';
  let loadingDashboard = false;
  let periodEvents = [];
  let activeTab = 'dashboard';
  const loadedSections = new Set();
  let timelineVisibleLimit = 250;
  let changesVisibleLimit = 200;
  let activeEventKey = '';
  let lastUpdatedAt = null;
  let freshnessTimer = null;
  let autoRefreshMs = readStoredNumber('valora_auditoria_refresh_ms', 10000);
  let criticalMode = readStoredBoolean('valora_auditoria_critical_mode', false);
  let groupRepeated = readStoredBoolean('valora_auditoria_group_repeated', true);
  const derivedEvents = new Map();
  let investigationStore = readStoredJson('valora_auditoria_investigacoes_v1', {});

  const LIVE_EVENT_LIMIT = 180;
  const SUMMARY_REFRESH_MS = 120000;
  const ALLOWED_REFRESH_MS = new Set([0, 5000, 10000, 30000]);

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

  function readStoredJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readStoredBoolean(key, fallback = false) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return raw === '1' || raw === 'true';
    } catch (_) {
      return fallback;
    }
  }

  function readStoredNumber(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null || raw === '') return fallback;
      const value = Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStored(key, value) {
    try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch (_) {}
  }

  function investigationFor(key) {
    const value = investigationStore?.[key];
    return value && typeof value === 'object' ? value : { status: 'pendente', note: '' };
  }

  function saveInvestigation(key, patch = {}) {
    if (!key) return;
    const current = investigationFor(key);
    investigationStore = {
      ...investigationStore,
      [key]: {
        status: String(patch.status ?? current.status ?? 'pendente'),
        note: String(patch.note ?? current.note ?? '').slice(0, 4000),
        updated_at: new Date().toISOString(),
      },
    };
    writeStored('valora_auditoria_investigacoes_v1', investigationStore);
  }

  function investigationStatusLabel(status) {
    const labels = {
      pendente: 'Pendente',
      analisando: 'Analisando',
      resolvido: 'Resolvido',
      bug: 'Bug',
      esperado: 'Ação esperada',
    };
    return labels[String(status || 'pendente')] || 'Pendente';
  }

  function investigationBadgeHtml(event) {
    const investigationKey = event?._primaryKey || event?.key;
    const item = investigationFor(investigationKey);
    const status = String(item.status || 'pendente');
    if (status === 'pendente' && !item.note) return '';
    return `<span class="investigation-badge status-${escapeHtml(status)}"><i class="fa-solid fa-magnifying-glass"></i>${escapeHtml(investigationStatusLabel(status))}${item.note ? ' · nota' : ''}</span>`;
  }

  function normalizeRefreshMs(value) {
    const ms = Number(value);
    return ALLOWED_REFRESH_MS.has(ms) ? ms : 10000;
  }

  function updateLastUpdatedLabel() {
    const el = $('lastUpdatedLabel');
    if (!el) return;
    if (!lastUpdatedAt) {
      el.textContent = autoRefreshMs ? 'Aguardando atualização' : 'Automático desligado';
      return;
    }
    const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000));
    if (seconds < 4) el.textContent = 'Atualizado agora';
    else if (seconds < 60) el.textContent = `Atualizado há ${seconds}s`;
    else el.textContent = `Atualizado há ${Math.floor(seconds / 60)}min`;
  }

  function markUpdated() {
    lastUpdatedAt = Date.now();
    updateLastUpdatedLabel();
  }

  function renderAuditControls() {
    autoRefreshMs = normalizeRefreshMs(autoRefreshMs);
    const select = $('autoRefreshSelect');
    if (select) select.value = String(autoRefreshMs);
    const criticalButton = $('criticalModeButton');
    if (criticalButton) {
      criticalButton.classList.toggle('is-active', criticalMode);
      criticalButton.setAttribute('aria-pressed', String(criticalMode));
      const label = criticalButton.querySelector('span');
      if (label) label.textContent = criticalMode ? 'Críticos ativos' : 'Só críticos';
    }
    const groupToggle = $('groupRepeatedToggle');
    if (groupToggle) groupToggle.checked = groupRepeated;
    document.body.classList.toggle('audit-critical-mode', criticalMode);
    updateLastUpdatedLabel();
  }

  function setAutoRefresh(value) {
    autoRefreshMs = normalizeRefreshMs(value);
    writeStored('valora_auditoria_refresh_ms', String(autoRefreshMs));
    renderAuditControls();
    if (!dashboardView.hidden) startPolling();
  }

  function setCriticalMode(value) {
    criticalMode = !!value;
    writeStored('valora_auditoria_critical_mode', criticalMode ? '1' : '0');
    timelineVisibleLimit = 250;
    changesVisibleLimit = 200;
    renderAuditControls();
    renderActiveTab();
  }

  function setGroupRepeated(value) {
    groupRepeated = !!value;
    writeStored('valora_auditoria_group_repeated', groupRepeated ? '1' : '0');
    timelineVisibleLimit = 250;
    renderTimeline();
  }

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

  function isoLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseIsoDate(value) {
    const parts = String(value || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
  }

  function dashboardDateLabel(value) {
    const date = parseIsoDate(value);
    return date ? date.toLocaleDateString('pt-BR') : String(value || '—');
  }

  function dashboardPeriodLabel(payload = dashboardPayload) {
    const period = payload?.periodo || {};
    if (!period.inicio || !period.fim) return 'Período selecionado';
    if (period.inicio === period.fim) return dashboardDateLabel(period.inicio);
    return `${dashboardDateLabel(period.inicio)} – ${dashboardDateLabel(period.fim)}`;
  }

  function setDashboardPreset(preset, apply = true) {
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const start = new Date(end);
    if (preset === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (preset === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 29);
    } else if (preset === 'month') {
      start.setDate(1);
    }
    dashboardPeriodPreset = preset;
    $('dashStartDate').value = isoLocalDate(start);
    $('dashEndDate').value = isoLocalDate(end);
    $$('.period-shortcut').forEach((button) => button.classList.toggle('is-active', button.dataset.dashboardPeriod === preset));
    if (apply) void loadDashboardAnalytics(true);
  }

  function initDashboardPeriod() {
    if (!$('dashStartDate') || !$('dashEndDate')) return;
    setDashboardPreset('today', false);
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
    if (type === 'formulario_abandonado') return 'abandoned';
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
    if (event.tipo === 'formulario_abandonado') return `Possível formulário abandonado: ${details.rotulo || 'formulário'}`;
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
    if (category === 'abandoned') return 'important';
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
    if (category === 'abandoned') return 'possível abandono';
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

  function isCriticalEvent(event) {
    const category = eventCategory(event);
    return category === 'errors'
      || category === 'deletes'
      || category === 'abandoned'
      || event?.severidade === 'importante';
  }

  function clientSessionOf(event) {
    return String(detailsOf(event).sessao_cliente || event?.ip || 'sem-sessao');
  }

  function likelyFormModal(event) {
    if (String(event?.tipo || '') !== 'modal_aberto') return false;
    const details = detailsOf(event);
    const text = `${details.rotulo || ''} ${details.modal_id || ''} ${details.elemento || ''}`.toLowerCase();
    return /(novo|nova|editar|edi[cç][aã]o|cadastro|cadastrar|adicionar|incluir|cliente|fornecedor|produto|patrim[oô]nio|or[cç]amento|cota[cç][aã]o|conta|pagamento|recebimento|agenda|contrato|proposta|usu[aá]rio|colaborador|formul[aá]rio|lan[cç]amento)/i.test(text);
  }

  function abandonmentBoundary(event) {
    const type = String(event?.tipo || '');
    if (type === 'pagina_saida' || type === 'navegacao' || type === 'navegacao_cliente' || type === 'logout') return true;
    return type === 'modal_aberto';
  }

  function completionEvent(event) {
    const category = eventCategory(event);
    const details = detailsOf(event);
    return category === 'creates'
      || category === 'edits'
      || (event?.tipo === 'click' && String(details.categoria || '').toLowerCase() === 'salvar');
  }

  function buildAbandonedForms(events) {
    const source = (events || [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || '')));
    const openByContext = new Map();
    const abandoned = [];

    const contextKey = (event) => `${clientSessionOf(event)}|${eventPage(event)}`;
    const closeAsAbandoned = (record, boundary) => {
      if (!record?.event || record.completed) return;
      const start = dateObj(record.event.criado_em);
      const end = dateObj(boundary?.criado_em);
      const elapsed = start && end ? Math.max(0, Math.round((end - start) / 1000)) : 0;
      if (elapsed < 3) return;
      const originalDetails = detailsOf(record.event);
      const synthetic = {
        key: `abandono:${record.event.key}`,
        fonte: 'heuristica_auditoria',
        tipo: 'formulario_abandonado',
        severidade: 'importante',
        usuario_nome: record.event.usuario_nome,
        usuario_email: record.event.usuario_email,
        pagina: record.event.pagina,
        rota: record.event.rota,
        ip: record.event.ip,
        dispositivo: record.event.dispositivo,
        criado_em: boundary?.criado_em || record.event.criado_em,
        detalhes: {
          categoria: 'formulario_abandonado',
          rotulo: originalDetails.rotulo || originalDetails.modal_id || 'Formulário',
          modal_id: originalDetails.modal_id || '',
          sessao_cliente: originalDetails.sessao_cliente || '',
          duracao_segundos: elapsed,
          motivo: `Saiu ou mudou de contexto sem uma ação de salvar/editar registrada${boundary ? ` · ${eventTitle(boundary)}` : ''}.`,
          evento_origem: record.event.key,
        },
      };
      abandoned.push(synthetic);
      derivedEvents.set(synthetic.key, synthetic);
    };

    for (const event of source) {
      const key = contextKey(event);
      const current = openByContext.get(key);

      if (completionEvent(event) && current) {
        current.completed = true;
        openByContext.delete(key);
        continue;
      }

      if (likelyFormModal(event)) {
        if (current && current.event.key !== event.key) closeAsAbandoned(current, event);
        openByContext.set(key, { event, completed: false });
        continue;
      }

      if (current && abandonmentBoundary(event)) {
        closeAsAbandoned(current, event);
        openByContext.delete(key);
      }
    }
    return abandoned;
  }

  function eventGroupSignature(event) {
    const details = detailsOf(event);
    return [
      eventCategory(event),
      eventPage(event),
      eventTitle(event),
      actionContext(event),
      details.elemento || '',
      details.href || '',
      details.valor || '',
      event.status_code || '',
    ].join('|').toLowerCase();
  }

  function groupRepeatedEvents(events) {
    if (!groupRepeated) return events;
    const out = [];
    for (const event of events) {
      if (isCriticalEvent(event)) {
        out.push(event);
        continue;
      }
      const signature = eventGroupSignature(event);
      const last = out[out.length - 1];
      const lastDate = last ? dateObj(last.criado_em) : null;
      const eventDate = dateObj(event.criado_em);
      const gap = lastDate && eventDate ? Math.abs(lastDate - eventDate) / 1000 : 9999;

      if (last && last._groupSignature === signature && gap <= 180) {
        if (Number(last._groupCount || 1) === 1) {
          const primaryKey = last._primaryKey || last.key;
          last._primaryKey = primaryKey;
          last.key = `grupo:${primaryKey}`;
          last._groupKeys = [primaryKey];
        }
        last._groupCount = Number(last._groupCount || 1) + 1;
        last._groupKeys = [...(last._groupKeys || []), event.key];
        last._groupOldest = event.criado_em;
        derivedEvents.set(last.key, last);
        continue;
      }

      out.push({
        ...event,
        _groupSignature: signature,
        _primaryKey: event.key,
        _groupKeys: [event.key],
        _groupCount: 1,
      });
    }
    return out;
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
    clearInterval(freshnessTimer);
    pollTimer = analyticsTimer = freshnessTimer = null;
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
    renderAuditControls();
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
      initDashboardPeriod();
      await Promise.all([loadEvents(true), loadAnalytics(true, 'resumo'), loadDashboardAnalytics(true)]);
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
    derivedEvents.clear();
    loadedSections.clear();
    activeTab = 'dashboard';
    timelineVisibleLimit = 250;
    changesVisibleLimit = 200;
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
    setCounter('clicksToday', today.cliques ?? live.cliques_hoje);
    setCounter('searchesToday', today.pesquisas ?? live.pesquisas_hoje);
    setCounter('filtersToday', today.filtros ?? live.filtros_hoje);
    setCounter('changesToday', today.alteracoes ?? live.alteracoes_hoje);
    setCounter('createsToday', today.cadastros ?? live.cadastros_hoje);
    setCounter('deletesToday', today.exclusoes ?? live.exclusoes_hoje);
    setCounter('downloadsToday', today.downloads ?? live.downloads_hoje);
    setCounter('modalsToday', today.modais ?? live.modais_hoje);
    setCounter('changesTabToday', today.alteracoes ?? live.alteracoes_hoje);
    setCounter('createsTabToday', today.cadastros ?? live.cadastros_hoje);
    setCounter('deletesTabToday', today.exclusoes ?? live.exclusoes_hoje);
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

  function comparisonDelta(metric, comparison, suffix = '') {
    const compareLabel = suffix || (dashboardPayload?.periodo_anterior?.personalizado ? 'vs. período comparado' : 'vs. período anterior');
    const percent = Number(comparison?.variacao?.[metric] || 0);
    if (!percent) return `igual ${compareLabel}`;
    const rounded = Math.round(percent);
    return `${rounded > 0 ? '+' : ''}${rounded}% ${compareLabel}`;
  }

  function dashboardDeltaClass(metric, comparison, inverse = false) {
    const percent = Number(comparison?.variacao?.[metric] || 0);
    if (!percent) return 'is-neutral';
    const positive = inverse ? percent < 0 : percent > 0;
    return positive ? 'is-up' : 'is-down';
  }

  function setDashboardKpi(id, value, deltaId, metric, comparison, formatter = (v) => String(v), inverse = false) {
    const valueEl = $(id);
    const deltaEl = $(deltaId);
    if (valueEl) valueEl.textContent = formatter(value);
    if (deltaEl) {
      deltaEl.textContent = comparisonDelta(metric, comparison);
      deltaEl.className = dashboardDeltaClass(metric, comparison, inverse);
    }
  }

  function renderDashboardWeek() {
    const container = $('dashWeekChart');
    if (!container) return;
    const allDays = dashboardPayload?.resumo_diario || [];
    const days = allDays.length > 31 ? allDays.slice(-31) : allDays;
    const max = Math.max(...days.map((item) => Number(item.atividades || 0)), 1);
    const total = allDays.reduce((sum, item) => sum + Number(item.atividades || 0), 0);
    $('dashWeekTotal').textContent = `${total} ações`;
    $('dashChartKicker').textContent = allDays.length > 31 ? 'Últimos 31 dias do período' : dashboardPeriodLabel();
    container.style.setProperty('--dashboard-days', String(Math.max(1, days.length)));
    container.classList.toggle('is-many-days', days.length > 14);
    container.innerHTML = days.map((item) => {
      const value = Number(item.atividades || 0);
      const height = value ? Math.max(8, Math.round((value / max) * 100)) : 2;
      const date = parseIsoDate(item.data);
      const day = date ? date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '') : item.data;
      const label = date ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : item.data;
      return `<div class="dashboard-day" title="${escapeHtml(label)} · ${value} ações"><div class="dashboard-day-value">${value}</div><div class="dashboard-day-track"><i style="height:${height}%"></i></div><strong>${escapeHtml(day)}</strong><small>${escapeHtml(label)}</small></div>`;
    }).join('');
  }

  function renderDashboardActionMix() {
    const container = $('dashActionMix');
    if (!container) return;
    const current = dashboardPayload?.atual || {};
    const items = [
      ['Cliques', Number(current.cliques || 0), 'fa-arrow-pointer'],
      ['Pesquisas', Number(current.pesquisas || 0), 'fa-magnifying-glass'],
      ['Filtros', Number(current.filtros || 0), 'fa-filter'],
      ['Alterações', Number(current.alteracoes || 0), 'fa-pen-to-square'],
      ['Cadastros', Number(current.cadastros || 0), 'fa-plus'],
      ['Downloads', Number(current.downloads || 0), 'fa-download'],
      ['Modais', Number(current.modais || 0), 'fa-window-restore'],
      ['Erros', Number(current.erros || 0), 'fa-triangle-exclamation'],
    ];
    const max = Math.max(...items.map((item) => item[1]), 1);
    container.innerHTML = items.map(([label, value, icon]) => `<div class="dashboard-mix-row"><span class="dashboard-mix-icon"><i class="fa-solid ${icon}"></i></span><div class="dashboard-mix-copy"><div><strong>${escapeHtml(label)}</strong><b>${value}</b></div><span><i style="width:${Math.max(value ? 4 : 0, Math.round((value / max) * 100))}%"></i></span></div></div>`).join('');
  }

  function renderDashboardComparison() {
    const container = $('dashComparison');
    if (!container) return;
    const comparison = dashboardPayload?.comparacao || {};
    const current = dashboardPayload?.atual || {};
    const previous = dashboardPayload?.periodo_anterior || {};
    $('dashComparisonTitle').textContent = previous.inicio && previous.fim
      ? `${dashboardPeriodLabel()} × ${dashboardDateLabel(previous.inicio)} – ${dashboardDateLabel(previous.fim)}`
      : 'Período × anterior';
    const rows = [
      ['Ações', 'atividades', current.atividades || 0, false],
      ['Tempo ativo', 'tempo_ativo_segundos', current.tempo_ativo_segundos || 0, false],
      ['Tempo ocioso', 'tempo_ocioso_segundos', current.tempo_ocioso_segundos || 0, true],
      ['Alterações', 'alteracoes', current.alteracoes || 0, false],
    ];
    container.innerHTML = rows.map(([label, metric, value, inverse]) => {
      const formatted = metric.includes('tempo_') ? durationText(value) : String(value);
      const cls = dashboardDeltaClass(metric, comparison, inverse);
      return `<div class="dashboard-comparison-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatted)}</strong><small class="${cls}">${escapeHtml(comparisonDelta(metric, comparison))}</small></div>`;
    }).join('');
  }

  function renderDashboardCritical() {
    const abandoned = buildAbandonedForms(latestPayload?.eventos || []);
    const combined = new Map();
    for (const event of [...abandoned, ...(dashboardPayload?.criticos || [])]) combined.set(event.key, event);
    const list = Array.from(combined.values())
      .filter((event) => !criticalMode || isCriticalEvent(event))
      .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
      .slice(0, 8);
    const container = $('dashCriticalList');
    const empty = $('dashCriticalEmpty');
    if (!container || !empty) return;
    $('dashCriticalCount').textContent = String(list.length);
    empty.hidden = list.length > 0;
    container.innerHTML = list.map((event) => {
      const category = eventCategory(event);
      const icon = category === 'abandoned' ? 'fa-file-circle-exclamation' : category === 'deletes' ? 'fa-trash-can' : category === 'errors' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
      return `<button type="button" class="dashboard-critical-row ${category === 'errors' ? 'is-error' : category === 'deletes' ? 'is-delete' : category === 'abandoned' ? 'is-abandoned' : ''}" data-event-key="${escapeHtml(event.key)}"><span><i class="fa-solid ${icon}"></i></span><div><strong>${escapeHtml(eventTitle(event))}</strong><small>${escapeHtml(pageName(eventPage(event)))} · ${escapeHtml(localDate(event.criado_em))}</small>${investigationBadgeHtml(event)}</div><i class="fa-solid fa-chevron-right"></i></button>`;
    }).join('');
  }

  function renderDashboardHeatmap() {
    const container = $('dashHourHeatmap');
    if (!container) return;
    const hours = dashboardPayload?.mapa_horario || [];
    const max = Math.max(...hours.map((item) => Number(item.total || 0)), 1);
    const total = hours.reduce((sum, item) => sum + Number(item.total || 0), 0);
    $('dashHeatmapTotal').textContent = `${total} registro${total === 1 ? '' : 's'}`;
    container.innerHTML = hours.map((item) => {
      const value = Number(item.total || 0);
      const intensity = value ? Math.max(10, Math.round((value / max) * 100)) : 0;
      const hour = String(Number(item.hora || 0)).padStart(2, '0');
      return `<div class="dashboard-heat-cell" style="--heat:${intensity}%" title="${hour}h · ${value} registros"><strong>${hour}h</strong><span>${value}</span></div>`;
    }).join('');
  }

  function renderDashboardHighlights() {
    const day = dashboardPayload?.dia_mais_ativo;
    const peak = dashboardPayload?.horario_pico;
    const session = dashboardPayload?.sessoes_destaque?.mais_longa;
    $('dashAutoSummary').textContent = dashboardPayload?.resumo_automatico || 'Sem dados suficientes para gerar o resumo deste período.';

    $('dashMostActiveDay').textContent = day?.data ? dashboardDateLabel(day.data) : '—';
    $('dashMostActiveDayDetail').textContent = day ? `${Number(day.total || 0)} registros · ${durationText(day.tempo_ativo_segundos || 0)} ativos` : 'Sem dados';
    $('dashPeakHour').textContent = peak ? `${String(Number(peak.hora || 0)).padStart(2, '0')}h–${String((Number(peak.hora || 0) + 1) % 24).padStart(2, '0')}h` : '—';
    $('dashPeakHourDetail').textContent = peak ? `${Number(peak.total || 0)} registros nesse horário` : 'Sem dados';
    $('dashLongestSession').textContent = session ? durationText(session.duracao_segundos || 0) : '—';
    $('dashLongestSessionDetail').textContent = session
      ? `${localDate(session.inicio)} · ${Number(session.quantidade_acoes || 0)} ações`
      : 'Sem sessões no período';
  }

  function reviewEventRow(event, kind = '') {
    const icon = kind === 'delete' ? 'fa-trash-can' : 'fa-pen-to-square';
    const title = eventTitle(event);
    const context = event.fonte === 'alteracao_dados'
      ? `${pageName(event.modulo || event.entidade_tipo || event.pagina_origem)}${event.entidade_id ? ` #${event.entidade_id}` : ''}`
      : pageName(eventPage(event));
    return `<button type="button" class="dashboard-review-row ${kind === 'delete' ? 'is-delete' : ''}" data-event-key="${escapeHtml(event.key)}"><span class="dashboard-review-icon"><i class="fa-solid ${icon}"></i></span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(context)} · ${escapeHtml(localDate(event.criado_em))}</small></div><i class="fa-solid fa-chevron-right"></i></button>`;
  }

  function renderDashboardReviews() {
    const anomalies = dashboardPayload?.anomalias || [];
    $('dashAnomalyCount').textContent = String(anomalies.length);
    $('dashAnomalyEmpty').hidden = anomalies.length > 0;
    $('dashAnomalyList').innerHTML = anomalies.map((item) => `<div class="dashboard-anomaly-row ${item.severidade === 'alta' ? 'is-high' : ''}"><span><i class="fa-solid ${item.severidade === 'alta' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}"></i></span><div><strong>${escapeHtml(item.titulo || 'Atenção')}</strong><small>${escapeHtml(item.detalhe || '')}</small></div></div>`).join('');

    const changes = (dashboardPayload?.alteracoes_criticas || []).slice(0, 10);
    $('dashCriticalChangesCount').textContent = String(changes.length);
    $('dashCriticalChangesEmpty').hidden = changes.length > 0;
    $('dashCriticalChanges').innerHTML = changes.map((event) => reviewEventRow(event)).join('');

    const deletes = (dashboardPayload?.exclusoes_recentes || []).slice(0, 10);
    $('dashRecentDeletesCount').textContent = String(deletes.length);
    $('dashRecentDeletesEmpty').hidden = deletes.length > 0;
    $('dashRecentDeletes').innerHTML = deletes.map((event) => reviewEventRow(event, 'delete')).join('');
  }

  function csvCell(value) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadDashboardCsv() {
    if (!dashboardPayload) return;
    const rows = [];
    const add = (...values) => rows.push(values.map(csvCell).join(';'));
    add('Auditoria Programadora', dashboardPeriodLabel());
    add('Comparativo', dashboardPayload?.periodo_anterior?.inicio || '', dashboardPayload?.periodo_anterior?.fim || '');
    add('Resumo automático', dashboardPayload?.resumo_automatico || '');
    rows.push('');
    add('Indicador', 'Valor');
    Object.entries(dashboardPayload?.atual || {}).forEach(([key, value]) => add(key, value));
    rows.push('');
    add('Data', 'Ações', 'Alterações', 'Cadastros', 'Exclusões', 'Tempo ativo (s)', 'Tempo ocioso (s)');
    (dashboardPayload?.resumo_diario || []).forEach((item) => add(item.data, item.atividades, item.alteracoes, item.cadastros, item.exclusoes, item.tempo_ativo_segundos, item.tempo_ocioso_segundos));
    rows.push('');
    add('Hora', 'Atividades', 'Alterações', 'Total');
    (dashboardPayload?.mapa_horario || []).forEach((item) => add(`${String(Number(item.hora || 0)).padStart(2, '0')}:00`, item.atividades, item.alteracoes, item.total));
    rows.push('');
    add('Módulo', 'Tempo (s)', 'Ações');
    (dashboardPayload?.ranking_modulos || []).forEach((item) => add(pageName(item.modulo), item.segundos, item.acoes));
    rows.push('');
    add('Anomalia', 'Detalhe', 'Severidade');
    (dashboardPayload?.anomalias || []).forEach((item) => add(item.titulo, item.detalhe, item.severidade));

    const blob = new Blob([`\ufeff${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const period = dashboardPayload?.periodo || {};
    link.download = `auditoria-programadora_${period.inicio || 'periodo'}_${period.fim || 'periodo'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function printDashboard() {
    document.body.classList.add('audit-print-dashboard');
    const cleanup = () => document.body.classList.remove('audit-print-dashboard');
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 1500);
  }

  function setDefaultCompareDates() {
    const start = parseIsoDate($('dashStartDate')?.value);
    const end = parseIsoDate($('dashEndDate')?.value);
    if (!start || !end) return;
    const span = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const compareEnd = new Date(start);
    compareEnd.setDate(compareEnd.getDate() - 1);
    const compareStart = new Date(compareEnd);
    compareStart.setDate(compareStart.getDate() - (span - 1));
    if (!$('dashCompareStart').value) $('dashCompareStart').value = isoLocalDate(compareStart);
    if (!$('dashCompareEnd').value) $('dashCompareEnd').value = isoLocalDate(compareEnd);
  }

  function renderDashboard() {
    renderUserHeader();
    const state = latestPayload?.estado || {};
    const current = dashboardPayload?.atual || {};
    const comparison = dashboardPayload?.comparacao || {};
    const period = dashboardPayload?.periodo || {};
    const online = !!state.online;
    const active = Number(current.tempo_ativo_segundos || 0);
    const idle = Number(current.tempo_ocioso_segundos || 0);
    const focus = active + idle > 0 ? Math.round((active / (active + idle)) * 100) : 0;

    $('dashPeriodTitle').textContent = dashboardPeriodLabel();
    $('dashPeriodSubtitle').textContent = period.limitado
      ? 'O período foi limitado aos 90 dias mais recentes para manter a auditoria rápida.'
      : `${Number(period.dias || 1)} dia${Number(period.dias || 1) === 1 ? '' : 's'} selecionado${Number(period.dias || 1) === 1 ? '' : 's'} · ${dashboardPayload?.periodo_anterior?.personalizado ? 'comparação com o período escolhido.' : 'comparação automática com o período anterior.'}`;

    $('dashStatusTitle').textContent = online ? `Online em ${pageName(state.pagina_atual)}` : 'Usuário offline';
    $('dashStatusBadge').className = `status-badge ${online ? 'online' : 'offline'}`;
    $('dashStatusBadge').textContent = online ? (state.estado_atividade === 'ocioso' ? 'Online · ocioso' : 'Online · ativo') : 'Offline';
    $('dashStatusText').textContent = online
      ? `Última atividade ${relativeTime(state.ultima_atividade)} · ${durationText(state.segundos_pagina_atual || 0)} nesta tela`
      : state.ultima_atividade ? `Última atividade ${relativeTime(state.ultima_atividade)} · ${localDate(state.ultima_atividade)}` : 'Sem atividade recente registrada.';
    $('dashCurrentPage').textContent = state.pagina_atual ? pageName(state.pagina_atual) : 'Nenhuma página ativa';
    $('dashLastAction').textContent = latestPayload?.ultima_acao ? eventTitle(latestPayload.ultima_acao) : 'Nenhuma ação recente';
    $('dashFocusRate').textContent = `${focus}%`;
    $('dashFocusRing').style.setProperty('--focus', String(focus));

    setDashboardKpi('dashActivities', current.atividades || 0, 'dashActivitiesDelta', 'atividades', comparison);
    setDashboardKpi('dashActiveTime', current.tempo_ativo_segundos || 0, 'dashActiveTimeDelta', 'tempo_ativo_segundos', comparison, durationText);
    setDashboardKpi('dashIdleTime', current.tempo_ocioso_segundos || 0, 'dashIdleTimeDelta', 'tempo_ocioso_segundos', comparison, durationText, true);
    setDashboardKpi('dashChanges', current.alteracoes || 0, 'dashChangesDelta', 'alteracoes', comparison);
    setDashboardKpi('dashCreates', current.cadastros || 0, 'dashCreatesDelta', 'cadastros', comparison);
    setDashboardKpi('dashDeletes', current.exclusoes || 0, 'dashDeletesDelta', 'exclusoes', comparison, (v) => String(v), true);

    renderDashboardWeek();
    renderDashboardActionMix();
    renderRanking('dashModuleRanking', dashboardPayload?.ranking_modulos || [], 'modulo', 'dashModuleEmpty', 7);
    renderRanking('dashPageRanking', dashboardPayload?.ranking_paginas || [], 'pagina', 'dashPageEmpty', 7);
    renderDashboardComparison();
    renderDashboardCritical();
    renderDashboardHighlights();
    renderDashboardHeatmap();
    renderDashboardReviews();
  }

  async function loadDashboardAnalytics(force = false) {
    if (loadingDashboard && !force) return;
    const start = $('dashStartDate')?.value;
    const end = $('dashEndDate')?.value;
    if (!start || !end) return;
    if (start > end) {
      $('dashStartDate').value = end;
      $('dashEndDate').value = start;
    }
    loadingDashboard = true;
    $('dashPeriodLoading').hidden = false;
    $('dashApplyPeriod')?.classList.add('is-loading');
    try {
      const params = new URLSearchParams({ secao: 'dashboard', inicio: $('dashStartDate').value, fim: $('dashEndDate').value });
      if ($('dashCompareMode')?.value === 'custom') {
        setDefaultCompareDates();
        const compareStart = $('dashCompareStart')?.value;
        const compareEnd = $('dashCompareEnd')?.value;
        if (compareStart && compareEnd) {
          params.set('comparar_inicio', compareStart <= compareEnd ? compareStart : compareEnd);
          params.set('comparar_fim', compareStart <= compareEnd ? compareEnd : compareStart);
        }
      }
      dashboardPayload = await api(`/api/auditoria-programadora/analise?${params.toString()}`);
      if (dashboardPayload?.periodo?.inicio) $('dashStartDate').value = dashboardPayload.periodo.inicio;
      if (dashboardPayload?.periodo?.fim) $('dashEndDate').value = dashboardPayload.periodo.fim;
      if (dashboardPayload?.periodo_anterior?.personalizado) {
        if ($('dashCompareStart')) $('dashCompareStart').value = dashboardPayload.periodo_anterior.inicio || '';
        if ($('dashCompareEnd')) $('dashCompareEnd').value = dashboardPayload.periodo_anterior.fim || '';
      }
      if (activeTab === 'dashboard') renderDashboard();
    } catch (error) {
      if (error.status === 403) showLocked('A proteção expirou. Digite a senha novamente.');
      else if (error.status === 401) window.location.href = '/login';
    } finally {
      loadingDashboard = false;
      $('dashPeriodLoading').hidden = true;
      $('dashApplyPeriod')?.classList.remove('is-loading');
    }
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

    const abandonment = buildAbandonedForms(periodEvents);
    let events = [...periodEvents, ...abandonment]
      .sort((a, b) => String(b.criado_em || '').localeCompare(String(a.criado_em || '')))
      .filter((event) => {
        if (!periodPass(event) || !typePass(event)) return false;
        if (criticalMode && !isCriticalEvent(event)) return false;
        if (module !== 'all' && eventModule(event) !== module) return false;
        if (page !== 'all' && eventPage(event) !== page) return false;
        if (search && !eventSearchText(event).includes(search)) return false;
        return true;
      });

    events = groupRepeatedEvents(events);
    const visibleEvents = events.slice(0, timelineVisibleLimit);
    $('timelineCount').textContent = events.length > visibleEvents.length ? `${visibleEvents.length} / ${events.length}` : String(events.length);
    empty.hidden = events.length > 0;
    container.hidden = events.length === 0;
    container.innerHTML = visibleEvents.map((event) => {
      const category = eventCategory(event);
      const extraClass = category === 'deletes' ? 'is-delete' : category === 'abandoned' ? 'is-abandoned' : event.severidade === 'importante' ? 'is-important' : '';
      const groupBadge = Number(event._groupCount || 0) > 1
        ? `<span class="group-count-badge" title="${event._groupCount} eventos semelhantes agrupados"><i class="fa-solid fa-layer-group"></i> ×${event._groupCount}</span>`
        : '';
      const groupDetail = Number(event._groupCount || 0) > 1
        ? `<div class="group-summary">Agrupado · ${event._groupCount} ocorrências em até 3 minutos</div>`
        : '';
      return `<article class="timeline-item"><div class="timeline-time">${escapeHtml(localDate(event.criado_em, false))}<br>${escapeHtml(shortDate(event.criado_em))}</div><div class="timeline-marker"><span class="marker-dot ${markerClass(event)}"></span></div><div class="event-card ${extraClass}" data-event-key="${escapeHtml(event.key)}" tabindex="0" role="button"><div class="event-top"><div class="event-copy"><p class="event-title">${escapeHtml(eventTitle(event))}</p><div class="event-meta">${metaHtml(event)}${groupBadge}${investigationBadgeHtml(event)}</div></div><div class="event-side"><span class="source-pill severity-${escapeHtml(event.severidade || 'normal')}">${escapeHtml(severityLabel(event))}</span><i class="fa-solid fa-chevron-right event-chevron"></i></div></div>${event.rota && event.metodo !== 'CLIENT' ? `<div class="event-route">${escapeHtml(event.rota)}</div>` : ''}${groupDetail}${inlineDetail(event)}</div></article>`;
    }).join('') + (events.length > visibleEvents.length ? `<div style="padding:14px 0;text-align:center"><button type="button" class="soft-button" data-timeline-more>Carregar mais (${events.length - visibleEvents.length})</button></div>` : '');
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
      if (criticalMode && !isCriticalEvent(event)) return false;
      if (module !== 'all' && eventModule(event) !== module) return false;
      if (severity === 'important' && event.severidade !== 'importante' && eventCategory(event) !== 'deletes') return false;
      if (severity === 'normal' && (event.severidade === 'importante' || eventCategory(event) === 'deletes')) return false;
      if (search && !eventSearchText(event).includes(search)) return false;
      return true;
    });
    const visibleChanges = list.slice(0, changesVisibleLimit);
    $('changeEmpty').hidden = list.length > 0;
    $('changeList').innerHTML = visibleChanges.map((event) => {
      const category = eventCategory(event);
      const classes = [event.severidade === 'importante' ? 'is-important' : '', category === 'deletes' ? 'is-delete' : ''].filter(Boolean).join(' ');
      const source = event.pagina_origem ? `Tela: ${pageName(event.pagina_origem)}` : event.origem ? `Origem: ${event.origem}` : '';
      const changeBox = event.fonte === 'alteracao_dados'
        ? `<div class="change-box"><div class="change-value"><span>Antes</span><pre>${escapeHtml(prettyValue(event.valor_anterior))}</pre></div><div class="change-arrow"><i class="fa-solid fa-arrow-right"></i></div><div class="change-value"><span>Depois</span><pre>${escapeHtml(prettyValue(event.valor_novo))}</pre></div></div>`
        : `<div class="activity-detail"><span>Operação</span><strong>${escapeHtml(severityLabel(event))}</strong></div>`;
      return `<article class="change-record ${classes}" data-event-key="${escapeHtml(event.key)}" tabindex="0"><div class="change-record-head"><div class="change-record-title"><strong>${escapeHtml(eventTitle(event))}</strong><span>${escapeHtml([actionContext(event), source].filter(Boolean).join(' · '))}</span>${investigationBadgeHtml(event)}</div><time class="change-record-time">${escapeHtml(localDate(event.criado_em))}</time></div>${changeBox}</article>`;
    }).join('') + (list.length > visibleChanges.length ? `<div style="padding:14px 0;text-align:center"><button type="button" class="soft-button" data-changes-more>Carregar mais (${list.length - visibleChanges.length})</button></div>` : '');
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

  function mergeFilterValues(current = {}, incoming = {}) {
    return {
      paginas: Array.from(new Set([...(current.paginas || []), ...(incoming.paginas || [])])),
      modulos: Array.from(new Set([...(current.modulos || []), ...(incoming.modulos || [])])),
    };
  }

  function mergeAnalyticsPayload(payload) {
    if (!payload) return;
    const previous = analyticsPayload || {};
    analyticsPayload = {
      ...previous,
      ...payload,
      filtros: mergeFilterValues(previous.filtros, payload.filtros),
    };
  }

  function renderActiveTab() {
    mergeEvents();
    renderFilterOptions();
    if (activeTab === 'dashboard') { if (dashboardPayload) renderDashboard(); else void loadDashboardAnalytics(true); }
    else if (activeTab === 'agora') renderAgora();
    else if (activeTab === 'timeline') renderTimeline();
    else if (activeTab === 'alteracoes') renderChanges();
    else if (activeTab === 'sessoes') renderSessions();
    else if (activeTab === 'estatisticas') renderStats();
  }

  function eventByKey(key) {
    return derivedEvents.get(key)
      || periodEvents.find((item) => item.key === key)
      || latestPayload?.eventos?.find((item) => item.key === key)
      || analyticsPayload?.alteracoes?.find((item) => item.key === key)
      || dashboardPayload?.criticos?.find((item) => item.key === key)
      || dashboardPayload?.alteracoes_criticas?.find((item) => item.key === key)
      || dashboardPayload?.exclusoes_recentes?.find((item) => item.key === key)
      || null;
  }

  function detailRow(label, value, mono = false) {
    if (value === undefined || value === null || value === '') return '';
    return `<div class="modal-detail-row"><span>${escapeHtml(label)}</span><div class="${mono ? 'mono' : ''}">${escapeHtml(prettyValue(value))}</div></div>`;
  }

  function openEventModal(key) {
    const event = eventByKey(key);
    if (!event) return;
    activeEventKey = event._primaryKey || key;
    const details = detailsOf(event);
    const investigation = investigationFor(activeEventKey);
    $('eventModalTitle').textContent = eventTitle(event);
    $('eventModalSubtitle').textContent = `${localDate(event.criado_em)} · ${severityLabel(event)}`;
    let body = '';

    body += `<section class="investigation-panel">
      <div class="investigation-panel-head">
        <div><p class="section-kicker">Investigação</p><h3>Acompanhamento deste evento</h3></div>
        <span class="investigation-local-hint"><i class="fa-regular fa-hard-drive"></i> salvo neste navegador</span>
      </div>
      <div class="investigation-fields">
        <label><span>Status</span><select id="eventInvestigationStatus">
          <option value="pendente"${investigation.status === 'pendente' ? ' selected' : ''}>Pendente</option>
          <option value="analisando"${investigation.status === 'analisando' ? ' selected' : ''}>Analisando</option>
          <option value="resolvido"${investigation.status === 'resolvido' ? ' selected' : ''}>Resolvido</option>
          <option value="bug"${investigation.status === 'bug' ? ' selected' : ''}>Bug</option>
          <option value="esperado"${investigation.status === 'esperado' ? ' selected' : ''}>Ação esperada</option>
        </select></label>
        <label class="investigation-note"><span>Observação</span><textarea id="eventInvestigationNote" rows="4" maxlength="4000" placeholder="Escreva o que precisa ser verificado, conclusão, motivo...">${escapeHtml(investigation.note || '')}</textarea></label>
      </div>
      <div id="investigationSavedHint" class="investigation-saved-hint">Salvamento automático</div>
    </section>`;

    if (Number(event._groupCount || 0) > 1) {
      body += `<section class="group-detail-panel"><h3><i class="fa-solid fa-layer-group"></i> Eventos agrupados</h3><p>${escapeHtml(event._groupCount)} ocorrências semelhantes. Mais recente: ${escapeHtml(localDate(event.criado_em))}${event._groupOldest ? ` · mais antiga: ${escapeHtml(localDate(event._groupOldest))}` : ''}.</p></section>`;
    }

    if (event.tipo === 'formulario_abandonado') {
      body += `<section class="abandonment-detail-panel"><h3><i class="fa-solid fa-file-circle-exclamation"></i> Detecção heurística</h3><p>Esta indicação é uma possibilidade, não uma confirmação: a Auditoria detectou abertura de um formulário/modal e depois mudança de contexto sem um salvar/editar registrado.</p></section>`;
    }

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
    body += detailRow('Modal', details.rotulo && (event.tipo === 'modal_aberto' || event.tipo === 'formulario_abandonado') ? details.rotulo : '');
    body += detailRow('Destino', details.href, true);
    body += detailRow('Duração', details.duracao_segundos ? durationText(details.duracao_segundos) : '');
    body += detailRow('Inatividade', details.duracao_inatividade_segundos ? durationText(details.duracao_inatividade_segundos) : '');
    body += detailRow('Motivo', details.motivo || details.observacao);
    body += '</section>';
    if (Object.keys(details).length) body += `<details class="raw-details"><summary>Ver dados técnicos do evento</summary><pre>${escapeHtml(prettyValue(details))}</pre></details>`;
    $('eventModalBody').innerHTML = body || '<div class="mini-empty">Sem detalhes adicionais.</div>';
    eventModal.hidden = false;
    document.body.classList.add('modal-open');
    setTimeout(() => $('eventInvestigationStatus')?.focus({ preventScroll: true }), 20);
  }

  function closeEventModal() {
    eventModal.hidden = true;
    activeEventKey = '';
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

  async function setActiveTab(name) {
    activeTab = name || 'dashboard';
    $$('.audit-tab').forEach((button) => button.classList.toggle('is-active', button.dataset.tab === activeTab));
    $$('.tab-panel').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === activeTab));
    renderActiveTab();
    const sectionMap = { timeline: 'timeline', alteracoes: 'alteracoes', sessoes: 'sessoes' };
    const section = sectionMap[activeTab];
    if (section && !loadedSections.has(section)) await loadAnalytics(false, section);
  }

  async function loadEvents(force = false) {
    if (loadingEvents && !force) return;
    if (document.hidden && !force) return;
    loadingEvents = true;
    refreshButton?.classList.add('is-loading');
    try {
      latestPayload = await api(`/api/auditoria-programadora/eventos?limit=${LIVE_EVENT_LIMIT}`);
      markUpdated();
      mergeEvents();
      renderAgora();
      if (activeTab === 'dashboard') { if (dashboardPayload) renderDashboard(); else void loadDashboardAnalytics(true); }
      if (activeTab === 'timeline') renderTimeline();
      if (activeTab === 'alteracoes') renderChanges();
    } catch (error) {
      if (error.status === 403) showLocked('A proteção expirou. Digite a senha novamente.');
      else if (error.status === 401) window.location.href = '/login';
    } finally {
      loadingEvents = false;
      refreshButton?.classList.remove('is-loading');
    }
  }

  async function loadAnalytics(force = false, section = 'resumo') {
    if (loadingAnalytics.has(section) && !force) return;
    if (document.hidden && !force) return;
    loadingAnalytics.add(section);
    try {
      const payload = await api(`/api/auditoria-programadora/analise?dias=60&secao=${encodeURIComponent(section)}`);
      mergeAnalyticsPayload(payload);
      loadedSections.add(section);
      mergeEvents();
      renderFilterOptions();
      if (section === 'resumo') {
        renderAgora();
        if (activeTab === 'dashboard' && dashboardPayload) renderDashboard();
        if (activeTab === 'estatisticas') renderStats();
      } else if (section === 'timeline' && activeTab === 'timeline') {
        timelineVisibleLimit = 250;
        renderTimeline();
      } else if (section === 'alteracoes' && activeTab === 'alteracoes') {
        changesVisibleLimit = 200;
        renderChanges();
      } else if (section === 'sessoes' && activeTab === 'sessoes') {
        renderSessions();
      }
    } catch (error) {
      if (error.status === 403) showLocked('A proteção expirou. Digite a senha novamente.');
      else if (error.status === 401) window.location.href = '/login';
    } finally {
      loadingAnalytics.delete(section);
    }
  }

  function startPolling() {
    clearTimers();
    autoRefreshMs = normalizeRefreshMs(autoRefreshMs);
    if (autoRefreshMs > 0) {
      pollTimer = setInterval(() => loadEvents(false), autoRefreshMs);
      analyticsTimer = setInterval(() => loadAnalytics(false, 'resumo'), SUMMARY_REFRESH_MS);
    }
    freshnessTimer = setInterval(updateLastUpdatedLabel, 1000);
    renderAuditControls();
  }

  async function refreshAll() {
    const sectionMap = { timeline: 'timeline', alteracoes: 'alteracoes', sessoes: 'sessoes' };
    const section = sectionMap[activeTab];
    const jobs = [loadEvents(true), loadAnalytics(true, 'resumo')];
    if (activeTab === 'dashboard') jobs.push(loadDashboardAnalytics(true));
    if (section) jobs.push(loadAnalytics(true, section));
    await Promise.all(jobs);
  }

  async function bootstrap() {
    try {
      await api('/api/auditoria-programadora/status');
      showDashboard();
      initDashboardPeriod();
      await Promise.all([loadEvents(true), loadAnalytics(true, 'resumo'), loadDashboardAnalytics(true)]);
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
  $('autoRefreshSelect')?.addEventListener('change', (event) => setAutoRefresh(event.target.value));
  $('criticalModeButton')?.addEventListener('click', () => setCriticalMode(!criticalMode));
  $('groupRepeatedToggle')?.addEventListener('change', (event) => setGroupRepeated(event.target.checked));
  $$('[data-audit-theme-toggle]').forEach((button) => button.addEventListener('click', toggleAuditTheme));
  renderThemeControls();
  renderAuditControls();

  $$('.audit-tab').forEach((button) => button.addEventListener('click', () => { void setActiveTab(button.dataset.tab); }));
  $$('.period-shortcut').forEach((button) => button.addEventListener('click', () => setDashboardPreset(button.dataset.dashboardPeriod || 'today')));
  $('dashApplyPeriod')?.addEventListener('click', () => {
    dashboardPeriodPreset = 'custom';
    $$('.period-shortcut').forEach((button) => button.classList.remove('is-active'));
    void loadDashboardAnalytics(true);
  });
  ['dashStartDate', 'dashEndDate'].forEach((id) => $(id)?.addEventListener('change', () => {
    dashboardPeriodPreset = 'custom';
    $$('.period-shortcut').forEach((button) => button.classList.remove('is-active'));
  }));
  $('dashCompareMode')?.addEventListener('change', () => {
    const custom = $('dashCompareMode').value === 'custom';
    $('dashCompareCustom').hidden = !custom;
    if (custom) setDefaultCompareDates();
  });
  ['dashCompareStart', 'dashCompareEnd'].forEach((id) => $(id)?.addEventListener('change', () => {
    if ($('dashCompareMode')) $('dashCompareMode').value = 'custom';
    if ($('dashCompareCustom')) $('dashCompareCustom').hidden = false;
  }));
  $('dashExportCsv')?.addEventListener('click', downloadDashboardCsv);
  $('dashPrintPdf')?.addEventListener('click', printDashboard);
  ['searchInput', 'startDateFilter', 'endDateFilter'].forEach((id) => $(id)?.addEventListener('input', () => { timelineVisibleLimit = 250; renderTimeline(); }));
  $('changeSearch')?.addEventListener('input', () => { changesVisibleLimit = 200; renderChanges(); });
  ['typeFilter', 'moduleFilter', 'pageFilter'].forEach((id) => $(id)?.addEventListener('change', () => { timelineVisibleLimit = 250; renderTimeline(); }));
  ['changeModuleFilter', 'changeSeverityFilter'].forEach((id) => $(id)?.addEventListener('change', () => { changesVisibleLimit = 200; renderChanges(); }));
  $('periodFilter').addEventListener('change', () => {
    $('customPeriod').hidden = $('periodFilter').value !== 'custom';
    timelineVisibleLimit = 250;
    renderTimeline();
  });

  let investigationNoteTimer = null;
  eventModal?.addEventListener('change', (event) => {
    if (!activeEventKey) return;
    if (event.target?.id === 'eventInvestigationStatus') {
      saveInvestigation(activeEventKey, { status: event.target.value });
      const hint = $('investigationSavedHint');
      if (hint) hint.textContent = `Salvo · ${investigationStatusLabel(event.target.value)}`;
      renderActiveTab();
    }
  });
  eventModal?.addEventListener('input', (event) => {
    if (!activeEventKey || event.target?.id !== 'eventInvestigationNote') return;
    clearTimeout(investigationNoteTimer);
    investigationNoteTimer = setTimeout(() => {
      saveInvestigation(activeEventKey, { note: event.target.value });
      const hint = $('investigationSavedHint');
      if (hint) hint.textContent = 'Observação salva';
      renderActiveTab();
    }, 350);
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-timeline-more]')) {
      timelineVisibleLimit += 250;
      renderTimeline();
      return;
    }
    if (event.target.closest('[data-changes-more]')) {
      changesVisibleLimit += 200;
      renderChanges();
      return;
    }
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
    if (!document.hidden && !dashboardView.hidden && autoRefreshMs > 0) refreshAll();
  });

  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    pageSessionId = createPageSessionId();
    latestPayload = analyticsPayload = null;
    periodEvents = [];
    derivedEvents.clear();
    loadedSections.clear();
    activeTab = 'dashboard';
    timelineVisibleLimit = 250;
    changesVisibleLimit = 200;
    showLocked();
    bootstrap();
  });

  bootstrap();
})();
