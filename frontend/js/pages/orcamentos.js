(() => {
  'use strict';

  const API = '/api/orcamentos';
  const API_CLIENTS = '/api/clientes';
  const API_PRODUCTS = '/api/produtos';
  const API_BUDGET_PRODUCTS = `${API}/produtos`;
  const API_USERS = '/api/usuarios';
  const API_COMPANY = '/api/empresa/atual';

  const state = {
    budgets: [],
    currentId: null,
    current: null,
    items: [],
    payments: [],
    selectedClient: null,
    clients: [],
    clientResults: [],
    clientSearchVersion: 0,
    clientPageSize: 10,
    clientOffset: 0,
    clientHasMore: false,
    clientLoading: false,
    clientQuery: '',
    clientTotal: 0,
    productSearch: {
      budget: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
      template: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
      kit: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
    },
    categories: [],
    templates: [],
    kits: [],
    emitters: [],
    users: [],
    company: null,
    meta: { pode_ver_custos: false, pode_configurar: false, configuracao: {} },
    activeTab: 'dados',
    templateItems: [],
    kitItems: [],
    settingsTab: 'geral',
    calculation: null,
    calculationVersion: 0,
    calculationTimer: null,
    initialRouteHandled: false,
  };

  const statusMeta = {
    rascunho: ['Em elaboração', 'status-rascunho'],
    enviado: ['Enviado', 'status-enviado'],
    em_negociacao: ['Em negociação', 'status-em_negociacao'],
    aprovado: ['Aprovado', 'status-aprovado'],
    recusado: ['Recusado', 'status-recusado'],
    cancelado: ['Cancelado', 'status-cancelado'],
    expirado: ['Expirado', 'status-expirado'],
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
    if (!text) return 0;
    if (text.includes(',') && text.includes('.')) text = text.replaceAll('.', '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function formatMoney(value) {
    return parseNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDavValue(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDavQuantity(value) {
    const number = parseNumber(value);
    return number.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 4 });
  }

  function inputMoney(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function inputQuantity(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function formatPercent(value) {
    return `${parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function localDate(value) {
    if (!value) return '—';
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-');
    return y && m && d ? `${d}/${m}/${y}` : '—';
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(dateString, days) {
    const date = new Date(`${dateString || today()}T12:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function toast(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else alert(message);
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof data === 'object' ? data.detail : data;
      const method = String(options.method || 'GET').toUpperCase();
      const message = detail || `Erro HTTP ${response.status}`;
      const error = new Error(`${message} (${method} ${url} — HTTP ${response.status})`);
      error.status = response.status;
      error.url = url;
      error.method = method;
      throw error;
    }
    return data;
  }

  function openOverlay(id) {
    const overlay = $(id);
    if (!overlay) {
      console.warn('[orcamentos] Modal não encontrado:', id);
      return;
    }

    // Usa o controlador global oficial do Valora quando estiver disponível.
    // O app.css exige a classe "show" para tornar o modal visível.
    if (window.ValoraModal?.open) {
      window.ValoraModal.open(overlay);
      return;
    }

    overlay.hidden = false;
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function closeOverlay(id) {
    const overlay = $(id);
    if (!overlay) return;

    if (window.ValoraModal?.close) {
      window.ValoraModal.close(overlay);
      return;
    }

    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      if (!$$('.modal-overlay.show').length) document.body.classList.remove('modal-open');
    }, 160);
  }

  function setButtonLoading(button, loading, text = 'Salvando...') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(text)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function getStatus(status) {
    return statusMeta[status] || statusMeta.rascunho;
  }

  async function bootstrap() {
    try {
      const [meta, categories, templates, kits, users, company, clientsResponse] = await Promise.all([
        api(`${API}/meta`),
        api(`${API}/categorias`),
        api(`${API}/modelos`),
        api(`${API}/kits`),
        api(API_USERS),
        api(API_COMPANY).catch(() => null),
        api(`${API_CLIENTS}?paginated=true&limit=20&offset=0`).catch(() => ({ items: [] })),
      ]);
      state.meta = meta;
      state.categories = categories || [];
      state.templates = templates || [];
      state.kits = kits || [];
      state.users = (users || []).filter((user) => user.ativo !== false);
      state.company = company;
      state.emitters = meta.emitentes || [];
      state.clients = normalizeCollection(clientsResponse);
      applyPermissions();
      renderSelects();
      fillSettingsForm();
      await loadBudgets();
      await handleInitialRoute();
    } catch (error) {
      console.error('[orcamentos] bootstrap:', error);

      const apiNaoCarregada = error?.status === 404 && String(error?.url || '').startsWith(API);
      const message = apiNaoCarregada
        ? 'A API de Orçamentos ainda não está carregada no backend. Confirme os arquivos backend/main.py e backend/routers/orcamentos.py e reinicie ou reconstrua o FastAPI.'
        : (error.message || 'Não foi possível carregar o módulo de orçamentos.');

      toast(message, 'error');
      $('tbody-orcamentos').innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(message)}</td></tr>`;
    }
  }

  function canShowCosts() {
    return Boolean(state.meta.pode_ver_custos && state.meta.configuracao?.controlar_custos !== false);
  }

  function applyPermissions() {
    const showCosts = canShowCosts();
    $$('.cost-only').forEach((element) => element.classList.toggle('is-hidden', !showCosts));
    $('btn-configurar-orcamentos').classList.toggle('is-hidden', !state.meta.pode_configurar);
    if ($('btn-gerenciar-kits')) $('btn-gerenciar-kits').classList.toggle('is-hidden', !state.meta.pode_configurar);
  }

  async function loadBudgets() {
    $('tbody-orcamentos').innerHTML = '<tr><td colspan="7" class="empty-state">Carregando orçamentos...</td></tr>';
    state.budgets = await api(API);
    renderBudgets();
  }

  function filteredBudgets() {
    const search = $('busca-orcamentos').value.trim().toLowerCase();
    const status = $('filtro-status-orcamentos').value;
    return state.budgets.filter((budget) => {
      const haystack = [budget.codigo, budget.titulo, budget.cliente_nome, budget.categoria_nome].join(' ').toLowerCase();
      return (!search || haystack.includes(search)) && (!status || budget.status === status);
    });
  }

  function renderBudgets() {
    const list = filteredBudgets();
    const tbody = $('tbody-orcamentos');
    $('contagem-orcamentos').textContent = `${list.length} ${list.length === 1 ? 'orçamento' : 'orçamentos'}`;

    $('kpi-total-orcamentos').textContent = state.budgets.length;
    $('kpi-rascunhos').textContent = state.budgets.filter((b) => b.status === 'rascunho').length;
    $('kpi-negociacao').textContent = state.budgets.filter((b) => ['enviado', 'em_negociacao'].includes(b.status)).length;
    $('kpi-aprovado').textContent = formatMoney(state.budgets.filter((b) => b.status === 'aprovado').reduce((sum, b) => sum + parseNumber(b.total), 0));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum orçamento encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((budget) => {
      const [label, className] = getStatus(budget.status);
      const approval = budget.aprovacao_necessaria && budget.aprovacao_status !== 'aprovado'
        ? '<small><i class="fa-solid fa-triangle-exclamation"></i> aprovação pendente</small>' : '';
      return `
        <tr>
          <td data-label="Número"><span class="budget-number"><i class="fa-regular fa-file-lines"></i>${escapeHtml(budget.codigo)}</span></td>
          <td data-label="Emissão">${escapeHtml(localDate(budget.data_emissao))}</td>
          <td data-label="Cliente"><div class="budget-client-cell"><strong>${escapeHtml(budget.cliente_nome || 'Cliente não vinculado')}</strong><small>${escapeHtml(budget.cliente_documento || '')}</small></div></td>
          <td data-label="Descrição"><div class="budget-title-cell"><strong>${escapeHtml(budget.titulo)}</strong><small>${escapeHtml(budget.categoria_nome || budget.nome_documento || '')}</small>${approval}</div></td>
          <td data-label="Status"><span class="budget-status ${className}">${label}</span></td>
          <td data-label="Total" class="text-right"><span class="budget-value-cell">${formatMoney(budget.total)}</span></td>
          <td data-label="Ações" class="text-right"><div class="budget-row-actions">
            <button class="budget-action-btn" data-action="edit" data-id="${budget.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="budget-action-btn" data-action="print" data-id="${budget.id}" title="Imprimir/PDF"><i class="fa-solid fa-print"></i></button>
            <button class="budget-action-btn" data-action="whatsapp" data-id="${budget.id}" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
            <button class="budget-action-btn" data-action="duplicate" data-id="${budget.id}" title="Duplicar"><i class="fa-regular fa-copy"></i></button>
            <button class="budget-action-btn danger" data-action="delete" data-id="${budget.id}" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
          </div></td>
        </tr>`;
    }).join('');
  }

  function renderSelects() {
    const activeCategories = state.categories.filter((category) => category.ativo !== false);
    const activeTemplates = state.templates.filter((template) => template.ativo !== false);
    const activeEmitters = state.emitters.filter((emitter) => emitter.ativo !== false);
    const categoryOptions = '<option value="">Sem categoria</option>' + activeCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.nome)}</option>`).join('');
    $('orcamento-categoria').innerHTML = categoryOptions;
    $('template-category').innerHTML = categoryOptions;
    $('orcamento-modelo').innerHTML = '<option value="">Começar do zero</option>' + activeTemplates.map((template) => `<option value="${template.id}">${escapeHtml(template.nome)}</option>`).join('');
    $('orcamento-consultor').innerHTML = '<option value="">Selecionar</option>' + state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.nome)}</option>`).join('');
    if ($('orcamento-emitente-id')) {
      $('orcamento-emitente-id').innerHTML = '<option value="">Selecionar empresa</option>' + activeEmitters.map((emitter) => `<option value="${emitter.id}">${escapeHtml(emitter.nome)}${emitter.padrao ? ' (padrão)' : ''}</option>`).join('');
    }
  }

  function syncClientEditButton() {
    const button = $('btn-editar-cliente-orcamento');
    if (!button) return;

    const clientId = Number($('orcamento-cliente-id')?.value || state.selectedClient?.id || 0);
    button.classList.toggle('is-hidden', !clientId);
    button.disabled = !clientId;
    button.dataset.clientId = clientId ? String(clientId) : '';
  }

  function openSelectedClientEditor() {
    const clientId = Number($('orcamento-cliente-id')?.value || state.selectedClient?.id || 0);
    if (!clientId) {
      toast('Selecione um cliente primeiro.', 'error');
      return;
    }

    const url = `/clientes?editar_cliente_id=${encodeURIComponent(clientId)}`;
    const popup = window.open(url, '_blank');
    if (!popup) {
      toast('O navegador bloqueou a nova aba. Libere pop-ups para editar o cliente sem perder o orçamento.', 'error');
      return;
    }
    popup.opener = null;
  }

  function resetBudgetForm() {
    state.currentId = null;
    state.current = null;
    state.items = [];
    state.payments = [];
    state.selectedClient = null;
    state.calculation = null;
    $('form-orcamento').reset();
    $('orcamento-cliente-id').value = '';
    syncClientEditButton();
    $('orcamento-codigo').value = '';
    $('orcamento-data-solicitacao').value = today();
    $('orcamento-data-emissao').value = today();
    $('orcamento-data-validade').value = addDays(today(), state.meta.configuracao?.validade_padrao_dias || 7);
    $('orcamento-consultor').value = String(state.meta.usuario?.id || '');
    $('orcamento-nome-documento').value = state.meta.configuracao?.nome_documento || 'Orçamento';
    $('orcamento-prazo-execucao').value = state.meta.configuracao?.prazo_execucao_padrao || '';
    $('orcamento-condicoes').value = state.meta.configuracao?.condicoes_padrao || '';
    $('orcamento-observacoes').value = state.meta.configuracao?.observacoes_padrao || '';
    $('orcamento-usar-capa').checked = Boolean(state.meta.configuracao?.usar_capa);
    $('orcamento-titulo-capa').value = state.meta.configuracao?.titulo_capa || '';
    $('orcamento-subtitulo-capa').value = state.meta.configuracao?.subtitulo_capa || '';
    $('orcamento-desconto-tipo').value = 'valor';
    $('orcamento-desconto-valor').value = '0,00';
    $('orcamento-frete').value = '0,00';
    $('orcamento-acrescimo').value = '0,00';
    $('orcamento-status').value = 'rascunho';
    const defaultEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false) || state.emitters.find((emitter) => emitter.ativo !== false);
    if ($('orcamento-emitente-id')) $('orcamento-emitente-id').value = defaultEmitter ? String(defaultEmitter.id) : '';
    if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = 'Novo orçamento';
    if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = 'Código não gerado';
    $('btn-imprimir-orcamento').classList.add('is-hidden');
    $('btn-whatsapp-orcamento').classList.add('is-hidden');
    $('btn-aprovar-margem').classList.add('is-hidden');
    $$('.edit-only').forEach((el) => el.classList.add('is-hidden'));
    setTab('dados');
    addDefaultPayment();
    renderItems();
    renderPayments();
    updateStatusPreview();
    updateTotals();
    renderHistory([]);
  }

  async function openNewBudget() {
    resetBudgetForm();
    $('budget-modal-title').textContent = 'Novo orçamento';
    $('budget-modal-subtitle').textContent = 'Documento global e personalizável para sua empresa.';
    openOverlay('budget-modal');
    try {
      const result = await api(`${API}/proximo-codigo`);
      $('orcamento-codigo').value = result.codigo || '';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = result.codigo || 'Código não gerado';
    } catch (_) {}
  }

  async function openEditBudget(id) {
    try {
      const budget = await api(`${API}/${id}`);
      state.currentId = id;
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      state.selectedClient = budget.cliente_id ? {
        id: budget.cliente_id,
        nome: budget.cliente_razao_social || budget.cliente_nome,
        nome_fantasia: budget.cliente_nome_fantasia || budget.cliente_nome,
        cpf_cnpj: budget.cliente_documento,
        rg_ie: budget.cliente_rg_ie_documento,
        telefone: budget.cliente_telefone_documento,
        whatsapp: budget.cliente_whatsapp,
        fax: budget.cliente_fax_documento,
        email: budget.cliente_email,
        email_nfe: budget.cliente_email_nfe_documento,
        contato: budget.cliente_contato_documento,
      } : null;
      fillBudgetForm(budget);
      $('budget-modal-title').textContent = `Editar ${budget.codigo}`;
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = budget.titulo || 'Orçamento';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = budget.codigo || 'Código não gerado';
      $('btn-imprimir-orcamento').classList.remove('is-hidden');
      $('btn-whatsapp-orcamento').classList.remove('is-hidden');
      $$('.edit-only').forEach((el) => el.classList.remove('is-hidden'));
      syncRefreshPricesButton(budget.status);
      const canApprove = state.meta.pode_configurar && budget.aprovacao_necessaria && budget.aprovacao_status !== 'aprovado';
      $('btn-aprovar-margem').classList.toggle('is-hidden', !canApprove);
      setTab('dados');
      openOverlay('budget-modal');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function canRefreshBudgetPrices(status) {
    return !['aprovado', 'recusado', 'cancelado', 'expirado'].includes(String(status || '').toLowerCase());
  }

  function syncRefreshPricesButton(status = $('orcamento-status')?.value) {
    const button = $('btn-atualizar-precos-itens');
    if (!button) return;
    const visible = Boolean(state.currentId) && canRefreshBudgetPrices(status);
    button.classList.toggle('is-hidden', !visible);
  }

  async function refreshCurrentBudgetPrices() {
    const button = $('btn-atualizar-precos-itens');
    if (!state.currentId) {
      toast('Salve o orçamento antes de atualizar os preços.', 'error');
      return;
    }
    const status = $('orcamento-status')?.value || state.current?.status;
    if (!canRefreshBudgetPrices(status)) {
      toast('Este orçamento já está encerrado. Duplique-o para atualizar os preços.', 'error');
      return;
    }
    const linkedItems = state.items.filter((item) => Number(item.produto_id) > 0);
    if (!linkedItems.length) {
      toast('Não há produtos vinculados ao cadastro neste orçamento.', 'error');
      return;
    }
    const confirmed = confirm(
      `Atualizar os preços de compra e venda de ${linkedItems.length} item(ns) pela tabela atual de produtos?\n\n` +
      'Quantidade, desconto, descrição e observações serão mantidos. A alteração será salva no orçamento.'
    );
    if (!confirmed) return;

    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true, 'Atualizando...');
      const budget = await api(`${API}/${state.currentId}?atualizar_precos=true`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      fillBudgetForm(budget);
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      syncRefreshPricesButton(budget.status);

      const summary = budget.atualizacao_precos || {};
      const updated = Number(summary.itens_atualizados || 0);
      if (!updated) {
        toast('Os preços deste orçamento já estavam iguais aos da tabela atual.');
      } else {
        const sale = Number(summary.precos_venda_alterados || 0);
        const cost = Number(summary.custos_alterados || 0);
        toast(`${updated} item(ns) atualizado(s): ${sale} preço(s) de venda e ${cost} custo(s).`);
      }
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar os preços.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncRefreshPricesButton();
    }
  }

  function fillBudgetForm(budget) {
    const emitterSelect = $('orcamento-emitente-id');
    const fallbackEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false)
      || state.emitters.find((emitter) => emitter.ativo !== false);
    if (emitterSelect && budget?.emitente_id && !Array.from(emitterSelect.options).some((option) => Number(option.value) === Number(budget.emitente_id))) {
      const label = budget.emitente_nome_documento || budget.emitente_nome_fantasia_documento || budget.emitente_razao_social_documento || 'Empresa emitente arquivada';
      emitterSelect.insertAdjacentHTML('beforeend', `<option value="${Number(budget.emitente_id)}" data-archived-emitter="true">${escapeHtml(label)} (inativa)</option>`);
    }
    const map = {
      'orcamento-codigo': budget.codigo,
      'orcamento-titulo': budget.titulo,
      'orcamento-status': budget.status,
      'orcamento-emitente-id': budget.emitente_id || fallbackEmitter?.id || '',
      'orcamento-cliente-id': budget.cliente_id || '',
      'orcamento-cliente-busca': budget.cliente_nome || '',
      'orcamento-categoria': budget.categoria_id || '',
      'orcamento-modelo': budget.modelo_id || '',
      'orcamento-data-solicitacao': String(budget.data_solicitacao || '').slice(0, 10),
      'orcamento-data-emissao': String(budget.data_emissao || '').slice(0, 10),
      'orcamento-data-validade': String(budget.data_validade || '').slice(0, 10),
      'orcamento-consultor': budget.consultor_id || '',
      'orcamento-responsavel-cliente': budget.responsavel_cliente || '',
      'orcamento-contato-cliente': budget.contato_cliente || '',
      'orcamento-cep': budget.endereco_cep || '',
      'orcamento-logradouro': budget.endereco_logradouro || '',
      'orcamento-numero': budget.endereco_numero || '',
      'orcamento-complemento': budget.endereco_complemento || '',
      'orcamento-bairro': budget.endereco_bairro || '',
      'orcamento-cidade': budget.endereco_cidade || '',
      'orcamento-estado': budget.endereco_estado || '',
      'orcamento-desconto-tipo': budget.desconto_tipo || 'valor',
      'orcamento-desconto-valor': inputMoney(budget.desconto_valor),
      'orcamento-frete': inputMoney(budget.frete),
      'orcamento-acrescimo': inputMoney(budget.acrescimo),
      'orcamento-prazo-execucao': budget.prazo_execucao || '',
      'orcamento-nome-documento': budget.nome_documento || '',
      'orcamento-condicoes': budget.condicoes || '',
      'orcamento-observacoes': budget.observacoes || '',
      'orcamento-titulo-capa': budget.titulo_capa || '',
      'orcamento-subtitulo-capa': budget.subtitulo_capa || '',
    };
    Object.entries(map).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    $('orcamento-usar-capa').checked = Boolean(budget.usar_capa);
    syncClientEditButton();
    renderItems();
    if (!state.payments.length) addDefaultPayment();
    renderPayments();
    renderHistory(budget.historico || []);
    updateStatusPreview();
    syncRefreshPricesButton(budget.status);
    updateTotals();
  }

  function setTab(tab) {
    state.activeTab = tab;
    $$('.budget-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.budget-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    if (tab === 'documento') renderPreview();
    if (tab === 'analise') renderAnalysis();
  }

  function updateStatusPreview() {
    const status = $('orcamento-status').value || 'rascunho';
    const [label, className] = getStatus(status);
    $('budget-status-preview').className = `budget-status ${className}`;
    $('budget-status-preview').textContent = label;
  }

  function normalizeCollection(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  }

  function clientResultMarkup(client) {
    const displayName = client.nome_fantasia || client.nome || `Cliente #${client.id}`;
    const details = [
      client.codigo ? `Cód. ${client.codigo}` : '',
      client.cpf_cnpj,
      client.whatsapp || client.telefone,
      [client.cidade, client.estado].filter(Boolean).join('/'),
    ].filter(Boolean).join(' • ');

    return `
      <button type="button" class="autocomplete-item" data-client-id="${client.id}">
        <strong>${escapeHtml(displayName)}</strong>
        <small>${escapeHtml(details || 'Cliente cadastrado')}</small>
      </button>`;
  }

  function renderClientLoadStatus() {
    const box = $('orcamento-cliente-resultados');
    box.querySelector('[data-client-load-status]')?.remove();

    if (state.clientLoading) {
      box.insertAdjacentHTML('beforeend', `
        <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
          <small><i class="fa-solid fa-spinner fa-spin"></i> Buscando mais clientes...</small>
        </div>`);
      return;
    }

    if (!state.clientResults.length) return;

    const shown = state.clientResults.length;
    const totalText = state.clientTotal ? ` de ${state.clientTotal}` : '';
    const message = state.clientHasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} clientes carregados`;

    box.insertAdjacentHTML('beforeend', `
      <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
        <small>${escapeHtml(message)}</small>
      </div>`);
  }

  function renderClientResults(clients, {
    append = false,
    emptyMessage = 'Nenhum cliente encontrado.',
  } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalized = normalizeCollection(clients);

    if (!append) box.innerHTML = '';
    else box.querySelector('[data-client-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-client-id]', box).map((item) => String(item.dataset.clientId)),
    );
    const newClients = normalized.filter((client) => !existingIds.has(String(client.id)));

    if (newClients.length) {
      box.insertAdjacentHTML('beforeend', newClients.map(clientResultMarkup).join(''));
    }

    if (!box.querySelector('[data-client-id]')) {
      box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(emptyMessage)}</small></div>`;
    } else {
      box.querySelector('.autocomplete-empty:not([data-client-load-status])')?.remove();
      renderClientLoadStatus();
    }

    box.hidden = false;
    $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
  }

  async function loadClientOptions(query = '', { append = false } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalizedQuery = String(query || '').trim();

    if (append && (state.clientLoading || !state.clientHasMore)) return;

    let version;
    let offset;

    if (append) {
      version = state.clientSearchVersion;
      offset = state.clientOffset;
      state.clientLoading = true;
      renderClientLoadStatus();
    } else {
      version = ++state.clientSearchVersion;
      offset = 0;
      state.clientQuery = normalizedQuery;
      state.clientOffset = 0;
      state.clientHasMore = false;
      state.clientTotal = 0;
      state.clientResults = [];
      state.clientLoading = true;
      box.innerHTML = '<div class="autocomplete-item autocomplete-empty"><small><i class="fa-solid fa-spinner fa-spin"></i> Carregando clientes...</small></div>';
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        limit: String(state.clientPageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_CLIENTS}?${params.toString()}`);
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;

      const clients = normalizeCollection(response);
      const knownIds = new Set(state.clientResults.map((client) => String(client.id)));
      const uniqueClients = clients.filter((client) => !knownIds.has(String(client.id)));

      state.clientResults = append
        ? [...state.clientResults, ...uniqueClients]
        : clients;
      state.clientOffset = offset + clients.length;
      state.clientTotal = Number(response?.total ?? state.clientResults.length) || state.clientResults.length;
      state.clientHasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : clients.length === state.clientPageSize;
      state.clientLoading = false;

      if (!normalizedQuery) state.clients = [...state.clientResults];

      renderClientResults(append ? uniqueClients : state.clientResults, {
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum cliente encontrado para essa busca.'
          : 'Nenhum cliente cadastrado.',
      });
    } catch (error) {
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;
      state.clientLoading = false;
      box.querySelector('[data-client-load-status]')?.remove();

      if (append && state.clientResults.length) {
        box.insertAdjacentHTML('beforeend', `
          <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
            <small>${escapeHtml(error.message)} • role novamente para tentar</small>
          </div>`);
      } else {
        box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(error.message)}</small></div>`;
      }
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }
  }

  const searchClients = debounce(() => {
    const query = $('orcamento-cliente-busca').value.trim();
    loadClientOptions(query, { append: false });
  }, 250);

  function showClientOptions() {
    const box = $('orcamento-cliente-resultados');
    const query = $('orcamento-cliente-busca').value.trim();

    if (!box.hidden && state.clientQuery === query && (state.clientResults.length || state.clientLoading)) {
      return;
    }

    loadClientOptions(query, { append: false });
  }

  function loadMoreClientsOnScroll() {
    const box = $('orcamento-cliente-resultados');
    if (box.hidden || state.clientLoading || !state.clientHasMore) return;

    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= 48) {
      loadClientOptions(state.clientQuery, { append: true });
    }
  }

  async function selectClient(id) {
    try {
      const client = await api(`${API_CLIENTS}/${id}`);
      state.selectedClient = client;
      $('orcamento-cliente-id').value = client.id;
      $('orcamento-cliente-busca').value = client.nome_fantasia || client.nome;
      $('orcamento-responsavel-cliente').value ||= client.contato || '';
      $('orcamento-contato-cliente').value ||= client.whatsapp || client.telefone || '';
      $('orcamento-cliente-resultados').hidden = true;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      syncClientEditButton();
      fillAddressFromClient(client, false);
      updateTotals();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function fillAddressFromClient(client, force = true) {
    if (!client) return;
    const address = (client.enderecos || []).find((item) => item.principal) || (client.enderecos || [])[0] || client;
    const values = {
      'orcamento-cep': address.cep || client.cep || '',
      'orcamento-logradouro': address.endereco || address.logradouro || client.endereco || '',
      'orcamento-numero': address.numero || client.numero || '',
      'orcamento-complemento': address.complemento || client.complemento || '',
      'orcamento-bairro': address.bairro || client.bairro || '',
      'orcamento-cidade': address.cidade || client.cidade || '',
      'orcamento-estado': address.estado || client.estado || '',
    };
    Object.entries(values).forEach(([id, value]) => { if (force || !$(id).value) $(id).value = value; });
  }

  function normalizeItem(item = {}) {
    const hasExplicitCostFlag = typeof item.custo_informado === 'boolean';
    const hasCostValue = item.custo_unitario !== null && item.custo_unitario !== undefined && item.custo_unitario !== '';
    return {
      id: item.id || null,
      produto_id: item.produto_id || null,
      origem: item.origem || (item.produto_id ? 'produto' : 'manual'),
      codigo: item.codigo || '',
      descricao: item.descricao || '',
      referencia: item.referencia || '',
      unidade: item.unidade || 'UN',
      quantidade: parseNumber(item.quantidade || 1),
      valor_unitario: parseNumber(item.valor_unitario),
      desconto: parseNumber(item.desconto),
      custo_unitario: hasCostValue ? parseNumber(item.custo_unitario) : null,
      custo_informado: hasExplicitCostFlag ? item.custo_informado : hasCostValue,
      observacao: item.observacao || '',
      ordem: Number(item.ordem || 0),
    };
  }

  function addManualItem(target = 'budget') {
    const item = normalizeItem({ quantidade: 1, unidade: 'UN', custo_unitario: null, custo_informado: false });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
    }
  }

  function getProductSearchState(target = 'budget') {
    if (target === 'template') return state.productSearch.template;
    if (target === 'kit') return state.productSearch.kit;
    return state.productSearch.budget;
  }

  function getProductSearchElements(target = 'budget') {
    if (target === 'template') {
      return {
        input: $('template-product-input'),
        results: $('template-product-results'),
        box: $('template-product-search'),
      };
    }
    if (target === 'kit') {
      return {
        input: $('kit-product-input'),
        results: $('kit-product-results'),
        box: $('kit-product-search'),
      };
    }

    return {
      input: $('produto-search-input'),
      results: $('produto-search-results'),
      box: $('produto-search-box'),
    };
  }

  function productResultMarkup(product, target = 'budget') {
    const details = [
      product.codigo ? `Cód. ${product.codigo}` : '',
      product.categoria,
      product.unidade,
      product.estoque_atual !== null && product.estoque_atual !== undefined && product.estoque_atual !== ''
        ? `Estoque: ${product.estoque_atual}`
        : '',
    ].filter(Boolean).join(' • ');

    return `
      <button class="product-result" type="button" data-product-id="${product.id}" data-target="${target}">
        <strong>${escapeHtml(product.nome || `Produto #${product.id}`)}</strong>
        <span>${escapeHtml(details || product.descricao || 'Produto cadastrado')}</span>
        <em>${formatMoney(product.preco_venda)}</em>
      </button>`;
  }

  function renderProductLoadStatus(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    results.querySelector('[data-product-load-status]')?.remove();

    if (searchState.loading) {
      results.insertAdjacentHTML('beforeend', `
        <div class="product-load-status" data-product-load-status>
          <i class="fa-solid fa-spinner fa-spin"></i> Buscando mais produtos...
        </div>`);
      return;
    }

    if (!searchState.results.length) return;

    const shown = searchState.results.length;
    const totalText = searchState.total ? ` de ${searchState.total}` : '';
    const message = searchState.hasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} produtos carregados`;

    results.insertAdjacentHTML('beforeend', `
      <div class="product-load-status" data-product-load-status>
        ${escapeHtml(message)}
      </div>`);
  }

  function renderProductResults(products, {
    target = 'budget',
    append = false,
    emptyMessage = 'Nenhum produto encontrado.',
  } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalized = normalizeCollection(products);

    if (!append) results.innerHTML = '';
    else results.querySelector('[data-product-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-product-id]', results).map((item) => String(item.dataset.productId)),
    );
    const newProducts = normalized.filter((product) => !existingIds.has(String(product.id)));

    if (newProducts.length) {
      results.insertAdjacentHTML('beforeend', newProducts.map((product) => productResultMarkup(product, target)).join(''));
    }

    if (!results.querySelector('[data-product-id]')) {
      results.innerHTML = `<div class="product-empty">${escapeHtml(emptyMessage)}</div>`;
    } else {
      results.querySelector('.product-empty')?.remove();
      renderProductLoadStatus(target);
    }

    results._items = [...searchState.results];
  }

  async function loadProductOptions(query = '', target = 'budget', { append = false } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalizedQuery = String(query || '').trim();

    if (append && (searchState.loading || !searchState.hasMore)) return;

    let version;
    let offset;

    if (append) {
      version = searchState.version;
      offset = searchState.offset;
      searchState.loading = true;
      renderProductLoadStatus(target);
    } else {
      version = ++searchState.version;
      offset = 0;
      searchState.query = normalizedQuery;
      searchState.offset = 0;
      searchState.hasMore = false;
      searchState.total = 0;
      searchState.results = [];
      searchState.loading = true;
      results.innerHTML = '<div class="product-empty"><i class="fa-solid fa-spinner fa-spin"></i> Carregando produtos...</div>';
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        ativo: 'true',
        limit: String(searchState.pageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_BUDGET_PRODUCTS}?${params.toString()}`);
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;

      const products = normalizeCollection(response);
      const knownIds = new Set(searchState.results.map((product) => String(product.id)));
      const uniqueProducts = products.filter((product) => !knownIds.has(String(product.id)));

      searchState.results = append
        ? [...searchState.results, ...uniqueProducts]
        : products;
      searchState.offset = offset + products.length;
      searchState.total = Number(response?.total ?? searchState.results.length) || searchState.results.length;
      searchState.hasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : products.length === searchState.pageSize;
      searchState.loading = false;

      renderProductResults(append ? uniqueProducts : searchState.results, {
        target,
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum produto encontrado para essa busca.'
          : 'Nenhum produto cadastrado.',
      });
    } catch (error) {
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;
      searchState.loading = false;
      results.querySelector('[data-product-load-status]')?.remove();

      if (append && searchState.results.length) {
        results.insertAdjacentHTML('beforeend', `
          <div class="product-load-status product-load-error" data-product-load-status>
            ${escapeHtml(error.message)} • role novamente para tentar
          </div>`);
      } else {
        results.innerHTML = `<div class="product-empty">${escapeHtml(error.message)}</div>`;
      }
    }
  }

  function searchProducts(query, target = 'budget') {
    return loadProductOptions(query, target, { append: false });
  }

  function showProductOptions(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { input } = getProductSearchElements(target);
    const query = input.value.trim();

    if (searchState.query === query && (searchState.results.length || searchState.loading)) return;
    loadProductOptions(query, target, { append: false });
  }

  function loadMoreProductsOnScroll(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    if (searchState.loading || !searchState.hasMore) return;

    const distanceFromBottom = results.scrollHeight - results.scrollTop - results.clientHeight;
    if (distanceFromBottom <= 56) {
      loadProductOptions(searchState.query, target, { append: true });
    }
  }

  function resetProductSearch(target = 'budget', { reload = false } = {}) {
    const searchState = getProductSearchState(target);
    const { input, results } = getProductSearchElements(target);
    input.value = '';
    searchState.version += 1;
    searchState.results = [];
    searchState.offset = 0;
    searchState.hasMore = false;
    searchState.loading = false;
    searchState.query = '';
    searchState.total = 0;
    results._items = [];
    results.innerHTML = '';
    if (reload) loadProductOptions('', target, { append: false });
  }

  function addProduct(id, target = 'budget') {
    const searchState = getProductSearchState(target);
    const product = searchState.results.find((item) => Number(item.id) === Number(id));
    if (!product) return;
    const item = normalizeItem({
      produto_id: product.id,
      origem: 'produto',
      codigo: product.codigo,
      descricao: product.nome,
      referencia: product.descricao || '',
      unidade: product.unidade || 'UN',
      quantidade: 1,
      valor_unitario: product.preco_venda,
      custo_unitario: product.custo ?? null,
      custo_informado: product.custo !== null && product.custo !== undefined && product.custo !== '',
    });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
      resetProductSearch('template', { reload: true });
    } else if (target === 'kit') {
      const existing = state.kitItems.find((current) => Number(current.produto_id) === Number(item.produto_id));
      if (existing) existing.quantidade = parseNumber(existing.quantidade) + 1;
      else state.kitItems.push(item);
      renderKitItems();
      resetProductSearch('kit', { reload: true });
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
      resetProductSearch('budget', { reload: true });
    }
  }

  function itemTotal(item) {
    return Math.max(item.quantidade * item.valor_unitario - item.desconto, 0);
  }

  function renderItems() {
    const tbody = $('budget-items-body');
    $('budget-items-empty').style.display = state.items.length ? 'none' : 'flex';
    tbody.innerHTML = state.items.map((item, index) => `
      <tr data-index="${index}">
        <td class="item-order-cell">${index + 1}</td>
        <td><textarea data-field="descricao" placeholder="Descrição do produto ou serviço">${escapeHtml(item.descricao)}</textarea><input data-field="referencia" value="${escapeHtml(item.referencia)}" placeholder="Referência/detalhe (opcional)" /></td>
        <td><input data-field="codigo" value="${escapeHtml(item.codigo)}" /></td>
        <td><input data-field="unidade" value="${escapeHtml(item.unidade)}" /></td>
        <td><input data-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td><input data-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" inputmode="decimal" /></td>
        <td><input data-field="desconto" value="${inputMoney(item.desconto)}" inputmode="decimal" /></td>
        <td class="item-total-cell">${formatMoney(itemTotal(item))}</td>
        <td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}"><input data-field="custo_unitario" value="${item.custo_unitario === null ? '' : inputMoney(item.custo_unitario)}" inputmode="decimal" placeholder="Não informado" /></td>
        <td><button class="item-remove" type="button" data-remove-item="${index}" title="Remover"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`).join('');
  }

  function updateItemField(input) {
    const row = input.closest('tr');
    const item = state.items[Number(row.dataset.index)];
    if (!item) return;
    const field = input.dataset.field;
    if (field === 'custo_unitario') {
      item.custo_unitario = String(input.value || '').trim() === '' ? null : parseNumber(input.value);
      item.custo_informado = item.custo_unitario !== null;
    } else {
      item[field] = ['quantidade', 'valor_unitario', 'desconto'].includes(field) ? parseNumber(input.value) : input.value;
    }
    const totalCell = row.querySelector('.item-total-cell');
    if (totalCell) totalCell.textContent = formatMoney(itemTotal(item));
    updateTotals();
  }

  function normalizePayment(payment = {}) {
    return {
      tipo: payment.tipo || 'personalizado',
      nome: payment.nome || 'Nova condição',
      descricao: payment.descricao || '',
      desconto_percentual: parseNumber(payment.desconto_percentual),
      entrada_percentual: parseNumber(payment.entrada_percentual),
      entrada_valor: parseNumber(payment.entrada_valor),
      parcelas: Math.max(Number(payment.parcelas || 1), 1),
      juros_percentual: parseNumber(payment.juros_percentual),
      valor_parcela: parseNumber(payment.valor_parcela),
      total: parseNumber(payment.total),
      selecionada: Boolean(payment.selecionada),
    };
  }

  function addDefaultPayment() {
    const defaults = (state.meta.configuracao?.formas_pagamento || []).filter((option) => option.ativo !== false);
    const first = defaults[0] || { tipo: 'avista', nome: 'À vista' };
    state.payments = [normalizePayment({ ...first, selecionada: true })];
  }

  function renderPayments() {
    const container = $('payment-options');
    if (!state.payments.length) addDefaultPayment();
    container.innerHTML = state.payments.map((payment, index) => `
      <article class="payment-option" data-payment-index="${index}">
        <div class="payment-option-head">
          <input type="radio" name="payment-selected" data-payment-field="selecionada" ${payment.selecionada ? 'checked' : ''} title="Destacar no orçamento" />
          <input class="payment-name" data-payment-field="nome" value="${escapeHtml(payment.nome)}" placeholder="Nome da condição" />
          <button class="payment-remove" type="button" data-remove-payment="${index}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="payment-option-grid">
          <div><label>Tipo</label><select data-payment-field="tipo"><option value="avista" ${payment.tipo === 'avista' ? 'selected' : ''}>À vista</option><option value="entrada_parcelas" ${payment.tipo === 'entrada_parcelas' ? 'selected' : ''}>Entrada + parcelas</option><option value="cartao" ${payment.tipo === 'cartao' ? 'selected' : ''}>Cartão</option><option value="pix" ${payment.tipo === 'pix' ? 'selected' : ''}>PIX</option><option value="boleto" ${payment.tipo === 'boleto' ? 'selected' : ''}>Boleto</option><option value="personalizado" ${payment.tipo === 'personalizado' ? 'selected' : ''}>Personalizado</option></select></div>
          <div><label>Desconto %</label><input data-payment-field="desconto_percentual" value="${inputMoney(payment.desconto_percentual)}" /></div>
          <div><label>Entrada %</label><input data-payment-field="entrada_percentual" value="${inputMoney(payment.entrada_percentual)}" /></div>
          <div><label>Parcelas</label><input type="number" min="1" data-payment-field="parcelas" value="${payment.parcelas}" /></div>
          <div><label>Juros %</label><input data-payment-field="juros_percentual" value="${inputMoney(payment.juros_percentual)}" /></div>
        </div>
        <div class="form-group" style="margin-top:10px"><label>Descrição complementar</label><input data-payment-field="descricao" value="${escapeHtml(payment.descricao)}" placeholder="Ex.: Entrada no aceite e saldo em 30/60 dias" /></div>
      </article>`).join('');
    recalculatePayments();
  }

  function updatePaymentField(input) {
    const card = input.closest('[data-payment-index]');
    const payment = state.payments[Number(card.dataset.paymentIndex)];
    const field = input.dataset.paymentField;
    if (field === 'selecionada') {
      state.payments.forEach((item, index) => { item.selecionada = index === Number(card.dataset.paymentIndex); });
    } else if (['desconto_percentual', 'entrada_percentual', 'juros_percentual'].includes(field)) {
      payment[field] = parseNumber(input.value);
    } else if (field === 'parcelas') payment.parcelas = Math.max(Number(input.value || 1), 1);
    else payment[field] = input.value;
    recalculatePayments();
    renderPreviewIfVisible();
  }

  function recalculatePayments() {
    const total = calculateTotals().total;
    state.payments.forEach((payment) => {
      const discounted = total * (1 - payment.desconto_percentual / 100);
      const withInterest = discounted * (1 + payment.juros_percentual / 100);
      payment.total = Math.max(withInterest, 0);
      payment.entrada_valor = payment.total * payment.entrada_percentual / 100;
      payment.valor_parcela = Math.max((payment.total - payment.entrada_valor) / Math.max(payment.parcelas, 1), 0);
    });
  }

  function calculateTotals() {
    const subtotal = state.items.reduce((sum, item) => sum + itemTotal(item), 0);
    const type = $('orcamento-desconto-tipo').value;
    const discountInput = Math.max(parseNumber($('orcamento-desconto-valor').value), 0);
    const discount = type === 'percentual' ? Math.min(subtotal * discountInput / 100, subtotal) : Math.min(discountInput, subtotal);
    const freight = Math.max(parseNumber($('orcamento-frete').value), 0);
    const addition = Math.max(parseNumber($('orcamento-acrescimo').value), 0);
    const total = Math.max(subtotal - discount + freight + addition, 0);
    const cost = state.items.reduce((sum, item) => sum + item.quantidade * parseNumber(item.custo_unitario), 0);
    const profit = total - cost;
    const margin = total > 0 ? profit / total * 100 : 0;
    return { subtotal, discount, freight, addition, total, cost, profit, margin };
  }

  function applyAnalysisResult(result) {
    if (!result || !canShowCosts()) return;
    state.calculation = result;
    $('analysis-sale').textContent = formatMoney(result.total);
    $('analysis-cost').textContent = formatMoney(result.custo_total);
    $('analysis-profit').textContent = formatMoney(result.lucro_total);
    $('analysis-margin').textContent = formatPercent(result.margem_percentual);
    const missing = Number(result.itens_sem_custo || 0);
    $('missing-cost-alert')?.classList.toggle('is-hidden', missing === 0);
    if ($('missing-cost-title')) $('missing-cost-title').textContent = missing === 1 ? '1 item está sem custo informado' : `${missing} itens estão sem custo informado`;
    const minMargin = parseNumber(state.meta.configuracao?.margem_minima);
    const alert = Boolean(state.meta.configuracao?.exigir_aprovacao_margem) && parseNumber(result.margem_percentual) < minMargin;
    $('margin-alert').classList.toggle('is-hidden', !alert);
    renderAnalysis();
  }

  function scheduleServerCalculation() {
    if (!canShowCosts()) return;
    clearTimeout(state.calculationTimer);
    const version = ++state.calculationVersion;
    state.calculationTimer = setTimeout(async () => {
      try {
        const payload = collectBudgetPayload();
        const result = await api(`${API}/calcular`, { method: 'POST', body: JSON.stringify(payload) });
        if (version !== state.calculationVersion) return;
        applyAnalysisResult(result);
      } catch (error) {
        if (version !== state.calculationVersion) return;
        console.warn('[orcamentos] cálculo financeiro:', error);
      }
    }, 260);
  }

  function updateTotals() {
    state.calculation = null;
    const totals = calculateTotals();
    $('summary-subtotal').textContent = formatMoney(totals.subtotal);
    $('summary-desconto').textContent = formatMoney(totals.discount);
    $('summary-total').textContent = formatMoney(totals.total);
    $('footer-total').textContent = formatMoney(totals.total);
    if ($('budget-sidebar-total')) $('budget-sidebar-total').textContent = formatMoney(totals.total);
    if (!state.calculation) {
      $('analysis-sale').textContent = formatMoney(totals.total);
      $('analysis-cost').textContent = formatMoney(totals.cost);
      $('analysis-profit').textContent = formatMoney(totals.profit);
      $('analysis-margin').textContent = formatPercent(totals.margin);
    }
    recalculatePayments();
    renderAnalysis();
    renderPreviewIfVisible();
    scheduleServerCalculation();
  }

  function renderAnalysis() {
    const tbody = $('analysis-items-body');
    const items = state.calculation?.itens || state.items.map((item) => {
      const sale = itemTotal(item);
      const cost = item.quantidade * parseNumber(item.custo_unitario);
      const profit = sale - cost;
      return { ...item, valor_total: sale, custo_total: cost, lucro_total: profit, margem_percentual: sale > 0 ? profit / sale * 100 : 0 };
    });
    tbody.innerHTML = items.map((item) => {
      const costKnown = item.custo_informado !== false;
      return `<tr><td>${escapeHtml(item.descricao || 'Item sem descrição')}</td><td class="text-right">${formatMoney(item.valor_total)}</td><td class="text-right ${costKnown ? '' : 'analysis-missing-cost'}">${costKnown ? formatMoney(item.custo_total) : 'Não informado'}</td><td class="text-right">${costKnown ? formatMoney(item.lucro_total) : '—'}</td><td class="text-right">${costKnown ? formatPercent(item.margem_percentual) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty-state">Nenhum item.</td></tr>';
  }


  function paymentDescription(payment) {
    const parts = [];
    if (payment.desconto_percentual > 0) parts.push(`${formatPercent(payment.desconto_percentual)} de desconto`);
    if (payment.entrada_percentual > 0) parts.push(`entrada de ${formatPercent(payment.entrada_percentual)} (${formatMoney(payment.entrada_valor)})`);
    if (payment.parcelas > 1) parts.push(`${payment.parcelas} parcelas de ${formatMoney(payment.valor_parcela)}`);
    if (payment.juros_percentual > 0) parts.push(`juros de ${formatPercent(payment.juros_percentual)}`);
    if (payment.descricao) parts.push(payment.descricao);
    return parts.join(' • ') || `Total: ${formatMoney(payment.total)}`;
  }

  function companyAddress() {
    const company = state.company || {};
    return [company.rua || company.endereco, company.numero, company.complemento, company.cidade, company.estado, company.cep].filter(Boolean).join(', ');
  }

  function budgetAddress() {
    return [
      $('orcamento-logradouro').value,
      $('orcamento-numero').value,
      $('orcamento-complemento').value,
      $('orcamento-bairro').value,
      $('orcamento-cidade').value,
      $('orcamento-estado').value,
      $('orcamento-cep').value,
    ].filter(Boolean).join(', ');
  }

  function buildStandardPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const color = state.meta.configuracao?.cor_primaria || '#65ACDE';
    const documentName = $('orcamento-nome-documento').value || state.meta.configuracao?.nome_documento || 'Orçamento';
    const code = $('orcamento-codigo').value || 'Prévia';
    const title = $('orcamento-titulo').value || 'Orçamento comercial';
    const clientName = $('orcamento-cliente-busca').value || 'Cliente não selecionado';
    const logo = company.logo ? `<img src="${escapeHtml(company.logo)}" alt="Logo">` : '';
    const rows = state.items.map((item, index) => `
      <tr>
        ${state.meta.configuracao?.mostrar_codigo !== false ? `<td>${escapeHtml(item.codigo || String(index + 1).padStart(4, '0'))}</td>` : ''}
        <td><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td style="text-align:center">${inputMoney(item.quantidade)}</td>
        <td style="text-align:center">${escapeHtml(item.unidade)}</td>
        <td style="text-align:right">${formatMoney(item.valor_unitario)}</td>
        <td style="text-align:right">${formatMoney(itemTotal(item))}</td>
      </tr>`).join('');
    const payments = state.payments.map((payment) => `<li><strong>${escapeHtml(payment.nome)}</strong>: ${escapeHtml(paymentDescription(payment))}</li>`).join('');
    const cover = $('orcamento-usar-capa').checked ? `
      <section class="preview-cover">
        <div class="preview-cover-brand">${logo}<div><strong>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</strong><p>${escapeHtml(company.endereco || companyAddress())}</p></div></div>
        <div class="preview-cover-title"><h1>${escapeHtml($('orcamento-titulo-capa').value || documentName)}</h1><p>${escapeHtml($('orcamento-subtitulo-capa').value || title)}</p></div>
        <div class="preview-cover-client"><small>Preparado para</small><h2>${escapeHtml(clientName)}</h2><p>${escapeHtml(code)} • ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p></div>
      </section>` : '';

    return `<div style="--preview-color:${escapeHtml(color)}">${cover}
      <section class="preview-document-page">
        <header class="preview-doc-header">
          <div class="preview-doc-brand">${logo}<div><h2>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</h2>${company.cnpj ? `<p>CNPJ: ${escapeHtml(company.cnpj)}</p>` : ''}<p>${escapeHtml(company.endereco || companyAddress())}</p><p>${escapeHtml([company.telefone, company.email].filter(Boolean).join(' • '))}</p></div></div>
          <div class="preview-doc-meta"><h1>${escapeHtml(documentName)}</h1><p><strong>${escapeHtml(code)}</strong></p><p>Emissão: ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p><p>Validade: ${escapeHtml(localDate($('orcamento-data-validade').value))}</p></div>
        </header>
        <div class="preview-title"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(state.categories.find((c) => String(c.id) === $('orcamento-categoria').value)?.nome || '')}</p></div>
        <div class="preview-client-box">
          <div class="preview-field"><label>Cliente</label><strong>${escapeHtml(clientName)}</strong></div>
          <div class="preview-field"><label>Responsável</label><span>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</span></div>
          <div class="preview-field"><label>Endereço/local</label><span>${escapeHtml(budgetAddress() || '—')}</span></div>
          <div class="preview-field"><label>Consultor</label><span>${escapeHtml(state.users.find((u) => String(u.id) === $('orcamento-consultor').value)?.nome || '—')}</span></div>
        </div>
        <table class="preview-items"><thead><tr>${state.meta.configuracao?.mostrar_codigo !== false ? '<th>Código</th>' : ''}<th>Descrição</th><th style="text-align:center">Qtd.</th><th style="text-align:center">Un.</th><th style="text-align:right">Unitário</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows || `<tr><td colspan="6">Nenhum item adicionado.</td></tr>`}</tbody></table>
        <div class="preview-summary"><div class="preview-summary-row"><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong></div>${totals.discount > 0 ? `<div class="preview-summary-row"><span>Desconto</span><strong>-${formatMoney(totals.discount)}</strong></div>` : ''}${totals.freight > 0 ? `<div class="preview-summary-row"><span>Frete</span><strong>${formatMoney(totals.freight)}</strong></div>` : ''}${totals.addition > 0 ? `<div class="preview-summary-row"><span>Acréscimo</span><strong>${formatMoney(totals.addition)}</strong></div>` : ''}<div class="preview-summary-total"><span>VALOR TOTAL</span><strong>${formatMoney(totals.total)}</strong></div></div>
        ${payments ? `<section class="preview-section"><h4>Formas de pagamento</h4><ul class="preview-payments">${payments}</ul></section>` : ''}
        ${$('orcamento-prazo-execucao').value ? `<section class="preview-section"><h4>Prazo de entrega/execução</h4><p>${escapeHtml($('orcamento-prazo-execucao').value)}</p></section>` : ''}
        ${$('orcamento-condicoes').value ? `<section class="preview-section"><h4>Condições gerais</h4><p>${escapeHtml($('orcamento-condicoes').value)}</p></section>` : ''}
        ${$('orcamento-observacoes').value ? `<section class="preview-section"><h4>Observações</h4><p>${escapeHtml($('orcamento-observacoes').value)}</p></section>` : ''}
        <footer class="preview-footer"><span>${escapeHtml(company.rodape || state.meta.configuracao?.rodape_padrao || company.fantasia || company.razao || '')}</span><span>Documento gerado pelo Valora CRM</span></footer>
      </section></div>`;
  }


  function usesDavDocument() {
    return String(state.meta.configuracao?.modelo_documento || 'padrao').toLowerCase() === 'dav';
  }

  function selectedEmitterData() {
    const selectedId = Number($('orcamento-emitente-id')?.value || state.current?.emitente_id || 0);
    return state.emitters.find((emitter) => Number(emitter.id) === selectedId) || null;
  }

  function documentCompanyData() {
    const config = state.meta.configuracao || {};
    const company = state.company || {};
    const budget = state.current || {};
    const emitter = selectedEmitterData() || {};
    const selectedId = Number($('orcamento-emitente-id')?.value || budget.emitente_id || 0);
    const useSnapshot = selectedId > 0 && Number(budget.emitente_id || 0) === selectedId;
    const snapshotAddress = useSnapshot ? budget.emitente_endereco_documento : null;
    const emitterAddress = [emitter.endereco, emitter.numero, emitter.complemento, emitter.bairro, emitter.cidade, emitter.estado, emitter.cep].filter(Boolean).join(', ');
    return {
      razao: (useSnapshot ? budget.emitente_razao_social_documento : null) || emitter.razao_social || config.cabecalho_razao_social || company.nome || 'Sua empresa',
      fantasia: (useSnapshot ? budget.emitente_nome_fantasia_documento : null) || emitter.nome_fantasia || config.cabecalho_nome_fantasia || '',
      cnpj: (useSnapshot ? budget.emitente_cnpj_documento : null) || emitter.cnpj || config.cabecalho_cnpj || company.cnpj || '',
      ie: (useSnapshot ? budget.emitente_ie_documento : null) || emitter.inscricao_estadual || '',
      email: (useSnapshot ? budget.emitente_email_documento : null) || emitter.email || config.cabecalho_email || company.email || '',
      site: (useSnapshot ? budget.emitente_site_documento : null) || emitter.site || config.cabecalho_site || '',
      telefone: (useSnapshot ? budget.emitente_telefone_documento : null) || emitter.telefone || config.cabecalho_telefone || company.telefone || '',
      endereco: snapshotAddress || emitterAddress || config.cabecalho_endereco || companyAddress(),
      logo: (useSnapshot ? budget.emitente_logo_documento : null) || emitter.logo_url || company.logo_url || '',
      rodape: (useSnapshot ? budget.emitente_rodape_documento : null) || emitter.rodape || config.cabecalho_rodape || config.rodape_padrao || company.nome || '',
      titulo: config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
    };
  }


  function documentClientData() {
    const budget = state.current || {};
    const client = state.selectedClient || {};
    return {
      razao: client.nome || budget.cliente_razao_social || $('orcamento-cliente-busca').value || 'Cliente não selecionado',
      fantasia: client.nome_fantasia || budget.cliente_nome_fantasia || '',
      documento: client.cpf_cnpj || budget.cliente_documento || '',
      rgIe: client.rg_ie || budget.cliente_rg_ie_documento || '',
      telefone: client.telefone || budget.cliente_telefone_documento || $('orcamento-contato-cliente').value || '',
      whatsapp: client.whatsapp || budget.cliente_whatsapp || '',
      fax: client.fax || budget.cliente_fax_documento || '',
      emailNfe: client.email_nfe || client.email || budget.cliente_email_nfe_documento || budget.cliente_email || '',
      contato: client.contato || budget.cliente_contato_documento || '',
    };
  }

  function davTimestamp() {
    const source = state.current?.criado_em || state.current?.atualizado_em;
    const value = source ? new Date(source) : new Date();
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  function normalizeDavLines(rawLines) {
    let nextNumber = 0;
    return rawLines
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s*[-.)]\s*(.*)$/);
        if (match) {
          nextNumber = Math.max(nextNumber, Number(match[1]) || 0);
          return `${match[1]}- ${match[2]}`;
        }
        nextNumber += 1;
        return `${nextNumber}- ${line}`;
      });
  }

  function davObservationLines() {
    const conditions = $('orcamento-condicoes').value.split(/\r?\n/);
    const notes = $('orcamento-observacoes').value.split(/\r?\n/);
    const raw = [...conditions, ...notes].map((line) => line.trim()).filter(Boolean);

    if ($('orcamento-prazo-execucao').value.trim() && !raw.some((line) => /prazo/i.test(line))) {
      raw.push(`Prazo de entrega/execução: ${$('orcamento-prazo-execucao').value.trim()}`);
    }

    if (state.payments.length) {
      const paymentText = state.payments
        .map((payment) => `${payment.nome}: ${paymentDescription(payment)}`)
        .join(' / ');
      raw.push(`Formas de pagamento: ${paymentText}`);
    }
    return normalizeDavLines(raw);
  }

  function buildDavPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const client = documentClientData();
    const seller = state.users.find((user) => String(user.id) === $('orcamento-consultor').value) || {};
    const timestamp = davTimestamp();
    const code = $('orcamento-codigo').value || 'PRÉVIA';
    const totalQuantity = state.items.reduce((sum, item) => sum + parseNumber(item.quantidade), 0);
    const globalDiscountPercent = $('orcamento-desconto-tipo').value === 'percentual'
      ? parseNumber($('orcamento-desconto-valor').value)
      : (totals.subtotal > 0 ? (totals.discount / totals.subtotal) * 100 : 0);

    const rows = state.items.map((item, index) => {
      const quantity = Math.max(parseNumber(item.quantidade), 0);
      const unitValue = Math.max(parseNumber(item.valor_unitario), 0);
      const lineDiscount = Math.max(parseNumber(item.desconto), 0);
      const discountUnit = quantity > 0 ? lineDiscount / quantity : 0;
      const unitAfterDiscount = Math.max(unitValue - discountUnit, 0);
      return `<tr>
        <td class="dav-code">${escapeHtml(item.codigo || String(index + 1).padStart(6, '0'))}</td>
        <td class="dav-description"><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td class="dav-center">${escapeHtml(item.unidade || 'UN')}</td>
        <td class="dav-center">${formatDavQuantity(quantity)}</td>
        <td class="dav-number">${formatDavValue(unitValue)}</td>
        <td class="dav-number">${formatDavValue(discountUnit)}</td>
        <td class="dav-number">${formatDavValue(unitAfterDiscount)}</td>
        <td class="dav-number">${formatDavValue(itemTotal(item))}</td>
      </tr>`;
    }).join('');

    const observationLines = davObservationLines()
      .map((line) => `<div>${escapeHtml(line)}</div>`)
      .join('');
    const contactText = [client.contato, client.whatsapp || client.telefone].filter(Boolean).join(' ');
    const sellerText = [seller.nome || state.current?.consultor_nome, seller.telefone || state.current?.consultor_telefone].filter(Boolean).join(' ');
    const address = $('orcamento-logradouro').value || '—';
    const issueDate = localDate($('orcamento-data-emissao').value);
    const issueTime = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return `<section class="dav-document">
      <header class="dav-header">
        <div class="dav-company-title">
          <strong>${escapeHtml(company.razao)}</strong>
          <span>${escapeHtml([company.email ? `E-Mail: ${company.email}` : '', company.site ? `Site: ${company.site}` : ''].filter(Boolean).join(' / '))}</span>
          <h1>${escapeHtml(company.titulo)}</h1>
        </div>
        <div class="dav-document-meta">
          <div><b>Nº:</b><span>${escapeHtml(code)}</span></div>
          <div><b>Página:</b><span>1</span></div>
          <div><b>Data:</b><span>${escapeHtml(issueDate)}</span></div>
          <div><b></b><span>${escapeHtml(issueTime)}</span></div>
        </div>
      </header>

      <table class="dav-client-table">
        <tbody>
          <tr><td colspan="7"><label>NOME/RAZÃO SOCIAL:</label><strong>${escapeHtml(client.razao)}</strong></td><td colspan="2"><label>CPF/CNPJ:</label><strong>${escapeHtml(client.documento || '—')}</strong></td><td colspan="3"><label>RG/INSCRIÇÃO ESTADUAL:</label><strong>${escapeHtml(client.rgIe || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>ENDEREÇO:</label><strong>${escapeHtml(address)}</strong></td><td><label>NÚMERO:</label><strong>${escapeHtml($('orcamento-numero').value || '—')}</strong></td><td colspan="3"><label>BAIRRO:</label><strong>${escapeHtml($('orcamento-bairro').value || '—')}</strong></td><td colspan="3"><label>CEP:</label><strong>${escapeHtml($('orcamento-cep').value || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>MUNICÍPIO:</label><strong>${escapeHtml($('orcamento-cidade').value || '—')}</strong></td><td><label>UF:</label><strong>${escapeHtml($('orcamento-estado').value || '—')}</strong></td><td colspan="2"><label>FONE:</label><strong>${escapeHtml(client.telefone || '—')}</strong></td><td colspan="2"><label>FAX:</label><strong>${escapeHtml(client.fax || '—')}</strong></td><td colspan="2"><label>CONTATO:</label><strong>${escapeHtml(contactText || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>VENDEDOR:</label><strong>${escapeHtml(sellerText || '—')}</strong></td><td colspan="4"><label>RESPONSÁVEL PEDIDO:</label><strong>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</strong></td><td colspan="3"><label>VALIDADE DA PROPOSTA:</label><strong>${escapeHtml(localDate($('orcamento-data-validade').value))}</strong></td></tr>
          <tr><td colspan="12"><label>E-mail (p/ envio da NF-e):</label><strong>${escapeHtml(client.emailNfe || '—')}</strong></td></tr>
        </tbody>
      </table>

      <div class="dav-reference-line">${escapeHtml($('orcamento-titulo').value || '')}${state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome ? ` • ${escapeHtml(state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome)}` : ''}</div>

      <table class="dav-items-table">
        <thead><tr><th>CÓDIGO<br>PRODUTO:</th><th>DESCRIÇÃO DOS PRODUTOS:<br><span>REFERÊNCIA</span></th><th>UND.</th><th>QTDE:</th><th>VALOR(SD)<br>UNITÁRIO:</th><th>VALOR<br>DESCONTO:</th><th>VALOR(CD)<br>UNITÁRIO:</th><th>VALOR<br>TOTAL:</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="dav-empty">Nenhum item adicionado.</td></tr>'}</tbody>
      </table>

      <table class="dav-totals-table"><tbody><tr>
        <td class="dav-total-spacer"></td>
        <td class="dav-order-total"><div><b>Total do Pedido</b><strong>${formatDavValue(totals.total)}</strong></div><div><b>Desconto........................</b><span>${formatDavValue(globalDiscountPercent)}% &nbsp; + &nbsp; ${formatDavValue(totals.discount)} &nbsp; = &nbsp; ${formatDavValue(totals.total)}</span></div></td>
        <td class="dav-total-middle"></td>
        <td class="dav-note-total"><div><b>Total Produtos:</b><strong>${formatDavQuantity(totalQuantity)}</strong></div><div><b>Total da Nota:</b><strong>${formatDavValue(totals.total)}</strong></div></td>
      </tr></tbody></table>

      <section class="dav-observations"><h2>OBSERVAÇÃO:</h2><div class="dav-observation-lines">${observationLines || '<div>—</div>'}</div></section>
      <footer class="dav-footer">${escapeHtml(company.rodape)}</footer>
    </section>`;
  }

  function buildPreviewHtml() {
    return usesDavDocument() ? buildDavPreviewHtml() : buildStandardPreviewHtml();
  }

  function renderPreview() {
    const preview = $('document-preview');
    preview.classList.toggle('dav-preview-active', usesDavDocument());
    preview.innerHTML = buildPreviewHtml();
  }

  function renderPreviewIfVisible() {
    if (state.activeTab === 'documento') renderPreview();
  }

  function renderHistoryValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }

  function renderHistory(history) {
    $('budget-history').innerHTML = (history || []).map((item) => {
      const changes = Array.isArray(item.dados?.alteracoes) ? item.dados.alteracoes : [];
      const details = changes.length ? `<details class="history-details"><summary>${changes.length} ${changes.length === 1 ? 'alteração' : 'alterações'}</summary>${changes.map((change) => {
        const label = change.nome || change.campo_nome || change.campo || 'Informação';
        const before = change.anterior ?? change.valor_anterior;
        const after = change.novo ?? change.valor_novo;
        return `<div class="history-change"><strong>${escapeHtml(change.secao || 'Geral')} • ${escapeHtml(label)}</strong><span><del>${escapeHtml(renderHistoryValue(before))}</del><i class="fa-solid fa-arrow-right"></i><ins>${escapeHtml(renderHistoryValue(after))}</ins></span></div>`;
      }).join('')}</details>` : '';
      const parsedDate = item.criado_em ? new Date(item.criado_em) : null;
      const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString('pt-BR') : '';
      return `<article class="history-item"><strong>${escapeHtml(item.usuario_nome || 'Sistema')} • ${escapeHtml((item.acao || '').replaceAll('_', ' '))}</strong><p>${escapeHtml(item.descricao || '')}</p>${details}${dateLabel ? `<small>${escapeHtml(dateLabel)}</small>` : ''}</article>`;
    }).join('') || '<div class="empty-state">O histórico será criado ao salvar o orçamento.</div>';
  }


  function collectBudgetPayload() {
    return {
      cliente_id: Number($('orcamento-cliente-id').value) || null,
      emitente_id: Number($('orcamento-emitente-id')?.value) || null,
      consultor_id: Number($('orcamento-consultor').value) || null,
      categoria_id: Number($('orcamento-categoria').value) || null,
      modelo_id: Number($('orcamento-modelo').value) || null,
      titulo: $('orcamento-titulo').value.trim(),
      nome_documento: $('orcamento-nome-documento').value.trim(),
      status: $('orcamento-status').value,
      data_solicitacao: $('orcamento-data-solicitacao').value || null,
      data_emissao: $('orcamento-data-emissao').value || null,
      data_validade: $('orcamento-data-validade').value || null,
      responsavel_cliente: $('orcamento-responsavel-cliente').value.trim() || null,
      contato_cliente: $('orcamento-contato-cliente').value.trim() || null,
      endereco_cep: $('orcamento-cep').value.trim() || null,
      endereco_logradouro: $('orcamento-logradouro').value.trim() || null,
      endereco_numero: $('orcamento-numero').value.trim() || null,
      endereco_complemento: $('orcamento-complemento').value.trim() || null,
      endereco_bairro: $('orcamento-bairro').value.trim() || null,
      endereco_cidade: $('orcamento-cidade').value.trim() || null,
      endereco_estado: $('orcamento-estado').value.trim() || null,
      desconto_tipo: $('orcamento-desconto-tipo').value,
      desconto_valor: parseNumber($('orcamento-desconto-valor').value),
      frete: parseNumber($('orcamento-frete').value),
      acrescimo: parseNumber($('orcamento-acrescimo').value),
      prazo_execucao: $('orcamento-prazo-execucao').value.trim() || null,
      condicoes: $('orcamento-condicoes').value.trim() || null,
      observacoes: $('orcamento-observacoes').value.trim() || null,
      pagamentos: state.payments,
      usar_capa: $('orcamento-usar-capa').checked,
      titulo_capa: $('orcamento-titulo-capa').value.trim() || null,
      subtitulo_capa: $('orcamento-subtitulo-capa').value.trim() || null,
      itens: state.items.map((item, index) => ({ ...item, custo_unitario: item.custo_unitario === null ? null : parseNumber(item.custo_unitario), custo_informado: Boolean(item.custo_informado), ordem: index })),
    };
  }

  function validateBudget(payload) {
    if (!payload.titulo) { setTab('dados'); $('orcamento-titulo').focus(); throw new Error('Informe o título do orçamento.'); }
    if (!payload.emitente_id) { setTab('dados'); $('orcamento-emitente-id')?.focus(); throw new Error('Selecione a empresa emitente.'); }
    if (!payload.cliente_id) { setTab('dados'); $('orcamento-cliente-busca').focus(); throw new Error('Selecione um cliente.'); }
    if (!payload.itens.length) { setTab('itens'); throw new Error('Adicione pelo menos um produto ou serviço.'); }
    if (payload.itens.some((item) => !String(item.descricao || '').trim())) { setTab('itens'); throw new Error('Preencha a descrição de todos os itens.'); }
  }

  async function saveBudget() {
    const button = $('btn-salvar-orcamento');
    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true);
      const budget = await api(state.currentId ? `${API}/${state.currentId}` : API, {
        method: state.currentId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      state.currentId = budget.id;
      state.current = budget;
      toast('Orçamento salvo com sucesso.');
      closeOverlay('budget-modal');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível salvar.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function applyTemplate(templateId) {
    if (!templateId) return;
    try {
      const template = await api(`${API}/modelos/${templateId}`);
      if (state.items.length && !confirm('Aplicar o modelo substituirá os itens atuais. Continuar?')) {
        $('orcamento-modelo').value = '';
        return;
      }
      $('orcamento-titulo').value = template.titulo || $('orcamento-titulo').value;
      $('orcamento-categoria').value = template.categoria_id || '';
      if (template.validade_dias) $('orcamento-data-validade').value = addDays($('orcamento-data-emissao').value, template.validade_dias);
      $('orcamento-prazo-execucao').value = template.prazo_execucao || $('orcamento-prazo-execucao').value;
      $('orcamento-condicoes').value = template.condicoes || $('orcamento-condicoes').value;
      $('orcamento-observacoes').value = template.observacoes || $('orcamento-observacoes').value;
      state.items = (template.itens || []).map(normalizeItem);
      state.payments = (template.pagamentos || []).map(normalizePayment);
      if (!state.payments.length) addDefaultPayment();
      renderItems();
      renderPayments();
      updateTotals();
      toast('Modelo aplicado ao orçamento.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function deleteBudget(id) {
    if (!confirm('Excluir este orçamento permanentemente?')) return;
    try {
      await api(`${API}/${id}`, { method: 'DELETE' });
      toast('Orçamento excluído.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function duplicateBudget(id) {
    try {
      const duplicated = await api(`${API}/${id}/duplicar`, { method: 'POST' });
      toast(`Orçamento ${duplicated.codigo} criado.`);
      await loadBudgets();
      await openEditBudget(duplicated.id);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function approveMargin() {
    if (!state.currentId) return;
    try {
      const budget = await api(`${API}/${state.currentId}/aprovar-margem`, { method: 'POST' });
      state.current = budget;
      $('btn-aprovar-margem').classList.add('is-hidden');
      toast('Margem aprovada pelo gestor.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

  function printCurrent() {
    const html = buildPreviewHtml();
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { toast('Permita pop-ups para gerar o PDF.', 'error'); return; }
    try { win.opener = null; } catch (_) {}
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><base href="${escapeHtml(`${window.location.origin}/`)}"><title>${escapeHtml($('orcamento-codigo').value || 'Orçamento')}</title><style>${printStyles()}</style></head><body><div class="document-preview">${html}</div><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    win.document.close();
  }

  async function printBudget(id) {
    if (state.currentId === id && !$('budget-modal').hidden) { printCurrent(); return; }
    try {
      const budget = await api(`${API}/${id}`);
      const previous = { currentId: state.currentId, current: state.current, items: state.items, payments: state.payments, client: state.selectedClient };
      state.currentId = id; state.current = budget; state.items = (budget.itens || []).map(normalizeItem); state.payments = (budget.pagamentos || []).map(normalizePayment); state.selectedClient = null;
      fillBudgetForm(budget);
      printCurrent();
      Object.assign(state, { currentId: previous.currentId, current: previous.current, items: previous.items, payments: previous.payments, selectedClient: previous.client });
    } catch (error) { toast(error.message, 'error'); }
  }

  function printStyles() {
    if (usesDavDocument()) {
      return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#000}.document-preview{width:auto;margin:0;background:#fff}.dav-document{width:100%;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:9.5pt}.dav-header{position:relative;min-height:18mm;padding:0 31mm 2mm 0;border-bottom:1px solid #000}.dav-company-title{text-align:center}.dav-company-title>strong{display:inline-block;padding:0 2mm;border-bottom:1px solid #000;font-size:13pt;font-weight:600}.dav-company-title>span{display:block;margin-top:1mm;font-size:9pt}.dav-company-title h1{margin:3mm 0 0;font-size:16pt;line-height:1.1}.dav-document-meta{position:absolute;top:0;right:0;width:30mm;font-size:8.5pt}.dav-document-meta div{display:grid;grid-template-columns:12mm 1fr;gap:1mm;min-height:4mm;align-items:center}.dav-document-meta b,.dav-document-meta span{text-align:right}.dav-client-table,.dav-items-table,.dav-totals-table{width:100%;border-collapse:collapse;table-layout:fixed}.dav-client-table td{min-height:8mm;padding:1mm 1.2mm;border:1px solid #000;vertical-align:top}.dav-client-table label{display:block;font-size:8pt;font-weight:700;line-height:1.15}.dav-client-table strong{display:block;margin-top:.6mm;font-size:9pt;font-weight:400;line-height:1.25;overflow-wrap:anywhere}.dav-reference-line{min-height:7mm;padding:1.5mm 1mm;border:1px solid #000;border-top:0;font-size:9pt}.dav-items-table thead{display:table-header-group}.dav-items-table tr{break-inside:avoid;page-break-inside:avoid}.dav-items-table th{padding:1.2mm .7mm;border-bottom:1px solid #000;font-size:8pt;line-height:1.15;text-align:center;vertical-align:bottom}.dav-items-table th:nth-child(1){width:9%}.dav-items-table th:nth-child(2){width:35%;text-align:left}.dav-items-table th:nth-child(3){width:6%}.dav-items-table th:nth-child(4){width:7%}.dav-items-table th:nth-child(5){width:11%}.dav-items-table th:nth-child(6){width:10%}.dav-items-table th:nth-child(7){width:11%}.dav-items-table th:nth-child(8){width:11%}.dav-items-table td{padding:1.5mm .8mm;border-bottom:.25mm solid #aaa;font-size:9pt;line-height:1.25;vertical-align:top}.dav-description strong{font-weight:400}.dav-description small{display:block;margin-top:.5mm;font-size:8pt}.dav-center{text-align:center}.dav-number{text-align:right;white-space:nowrap}.dav-empty{text-align:center}.dav-totals-table,.dav-observations,.dav-footer{break-inside:avoid;page-break-inside:avoid}.dav-totals-table td{min-height:15mm;border:1px solid #000;vertical-align:middle}.dav-total-spacer{width:13%}.dav-order-total{width:50%;padding:1.5mm 2mm}.dav-order-total>div{width:48%;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;vertical-align:middle}.dav-order-total b,.dav-note-total b{font-size:8.5pt}.dav-order-total strong,.dav-note-total strong{font-size:9.5pt}.dav-order-total span{font-size:8pt}.dav-total-middle{width:15%}.dav-note-total{width:22%;padding:1mm 2mm}.dav-note-total div{display:flex;justify-content:space-between;gap:2mm;padding:.7mm 0}.dav-observations{min-height:35mm;padding:2.5mm 2mm;border:1px solid #000;border-top:0}.dav-observations h2{margin:0 0 4mm;font-size:9pt}.dav-observation-lines{font-size:9pt;line-height:1.45}.dav-footer{min-height:5mm;padding:1mm;border:1px solid #000;border-top:0;background:#edf7fc;text-align:center;font-size:8pt}@page{size:A4 portrait;margin:8mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
    }
    return `*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#263746}.document-preview{width:auto;margin:0;background:#fff}.preview-cover{min-height:265mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}.preview-cover-brand,.preview-doc-brand{display:flex;align-items:center;gap:16px}.preview-cover-brand img{width:76px;max-height:76px;object-fit:contain}.preview-cover-title{margin:auto 0}.preview-cover-title h1{margin:0 0 14px;color:var(--preview-color);font-size:42px}.preview-cover-title p{color:#667783;font-size:18px}.preview-cover-client{padding-top:24px;border-top:2px solid var(--preview-color)}.preview-doc-header{display:flex;justify-content:space-between;gap:20px;padding-bottom:20px;border-bottom:3px solid var(--preview-color)}.preview-doc-brand img{width:58px;max-height:58px;object-fit:contain}.preview-doc-brand h2{margin:0 0 4px;font-size:18px}.preview-doc-brand p,.preview-doc-meta p{margin:2px 0;color:#687884;font-size:10px}.preview-doc-meta{text-align:right}.preview-doc-meta h1{margin:0 0 6px;color:var(--preview-color);font-size:22px}.preview-title{margin:22px 0 15px}.preview-title h3{margin:0 0 4px;font-size:17px}.preview-title p{margin:0;color:#71808b;font-size:10px}.preview-client-box{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin-bottom:18px;padding:14px 16px;border:1px solid #dfe6ea;border-radius:8px;background:#f8fafb}.preview-field label{display:block;color:#82909a;font-size:8px;text-transform:uppercase}.preview-field strong,.preview-field span{font-size:10px}.preview-items{width:100%;border-collapse:collapse}.preview-items thead{display:table-header-group}.preview-items tr{break-inside:avoid}.preview-items th{padding:8px 7px;color:#fff;background:#365465;font-size:8px;text-align:left}.preview-items td{padding:9px 7px;border-bottom:1px solid #e2e8eb;font-size:9px;vertical-align:top}.preview-items td small{display:block;margin-top:3px;color:#84919a}.preview-summary{width:310px;margin:18px 0 0 auto}.preview-summary-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e2e8eb;font-size:9px}.preview-summary-total{margin-top:8px;padding:12px 14px;border-radius:7px;color:#fff;background:var(--preview-color)}.preview-summary-total span{font-size:8px}.preview-summary-total strong{display:block;margin-top:3px;font-size:17px}.preview-section{margin-top:18px;padding:13px 15px;border:1px solid #dfe6ea;border-radius:8px;break-inside:avoid}.preview-section h4{margin:0 0 7px;font-size:10px}.preview-section p,.preview-section li{font-size:9px;line-height:1.55;white-space:pre-line}.preview-footer{margin-top:24px;padding-top:12px;border-top:1px solid #e0e7eb;display:flex;justify-content:space-between;color:#88949c;font-size:8px}@page{size:A4 portrait;margin:10mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  }


  async function sendWhatsApp(id) {
    try {
      const budget = state.currentId === id && state.current ? state.current : await api(`${API}/${id}`);
      let phone = String(budget.cliente_whatsapp || state.selectedClient?.whatsapp || '').replace(/\D/g, '');
      if (!phone) { toast('O cliente não possui WhatsApp cadastrado.', 'error'); return; }
      if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
      const message = [`Olá, ${budget.cliente_nome || 'tudo bem'}!`, '', `Segue o ${budget.nome_documento || 'orçamento'} ${budget.codigo}.`, budget.titulo, `Valor total: ${formatMoney(budget.total)}`, budget.data_validade ? `Validade: ${localDate(budget.data_validade)}` : '', '', 'Fico à disposição para esclarecer qualquer dúvida.'].filter(Boolean).join('\n');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      if (budget.status === 'rascunho') {
        await api(`${API}/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'enviado', observacao: 'Orçamento compartilhado pelo WhatsApp.' }) });
        await loadBudgets();
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  // Kits de produtos no orçamento
  function activeKits() {
    return (state.kits || []).filter((kit) => kit.ativo !== false);
  }

  function renderKitPicker() {
    const query = String($('kit-picker-search-input')?.value || '').trim().toLowerCase();
    const kits = activeKits().filter((kit) => !query || [kit.nome, kit.descricao].join(' ').toLowerCase().includes(query));
    $('kit-picker-count').textContent = `${kits.length} ${kits.length === 1 ? 'kit disponível' : 'kits disponíveis'}`;
    $('kit-picker-list').innerHTML = kits.map((kit) => `
      <article class="kit-picker-card">
        <div class="kit-picker-card-icon"><i class="fa-solid fa-layer-group"></i></div>
        <div class="kit-picker-card-copy">
          <h4>${escapeHtml(kit.nome)}</h4>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para o orçamento.')}</p>
          <div class="kit-picker-card-meta">
            <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
            <span><i class="fa-solid fa-coins"></i> ${formatMoney(kit.valor_estimado)}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-small" type="button" data-add-kit="${kit.id}"><i class="fa-solid fa-plus"></i> Adicionar</button>
      </article>`).join('') || `
      <div class="kit-picker-empty">
        <i class="fa-solid fa-layer-group"></i>
        <strong>${query ? 'Nenhum kit encontrado' : 'Nenhum kit cadastrado'}</strong>
        <span>${query ? 'Tente buscar por outro nome.' : 'Crie kits em Configurações de orçamentos para inserir vários produtos de uma vez.'}</span>
      </div>`;
  }

  async function openKitPicker() {
    try {
      state.kits = await api(`${API}/kits`);
      $('kit-picker-search-input').value = '';
      renderKitPicker();
      openOverlay('kit-picker-modal');
      setTimeout(() => $('kit-picker-search-input')?.focus(), 80);
    } catch (error) {
      toast(error.message || 'Não foi possível carregar os kits.', 'error');
    }
  }

  async function addKitToBudget(kitId, button = null) {
    try {
      setButtonLoading(button, true, 'Adicionando...');
      const kit = await api(`${API}/kits/${kitId}`);
      let addedLines = 0;
      let mergedLines = 0;
      (kit.itens || []).forEach((rawItem) => {
        const item = normalizeItem(rawItem);
        const existing = item.produto_id
          ? state.items.find((current) => Number(current.produto_id) === Number(item.produto_id))
          : null;
        if (existing) {
          existing.quantidade = parseNumber(existing.quantidade) + parseNumber(item.quantidade);
          mergedLines += 1;
        } else {
          state.items.push(item);
          addedLines += 1;
        }
      });
      renderItems();
      updateTotals();
      setTab('itens');
      closeOverlay('kit-picker-modal');
      const detail = mergedLines ? ` (${mergedLines} quantidades somadas aos produtos já existentes)` : '';
      toast(`Kit “${kit.nome}” adicionado com ${addedLines + mergedLines} produtos${detail}.`);
    } catch (error) {
      toast(error.message || 'Não foi possível adicionar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  // Configurações
  async function openSettings() {
    try {
      const [categories, templates, kits, emitters] = await Promise.all([
        api(`${API}/categorias?incluir_inativas=true`),
        api(`${API}/modelos?incluir_inativos=true`),
        api(`${API}/kits?incluir_inativos=true`),
        api(`${API}/emitentes?incluir_inativos=true`),
      ]);
      state.categories = categories || [];
      state.templates = templates || [];
      state.kits = kits || [];
      state.emitters = emitters || [];
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar as configurações.', 'error');
    }
    fillSettingsForm();
    renderCategories();
    renderTemplates();
    renderKits();
    renderEmitters();
    resetEmitterEditor();
    renderSelects();
    setSettingsTab('geral');
    openOverlay('settings-modal');
  }

  function updateSettingsFooter(tab) {
    const footer = $('settings-footer');
    const primaryButton = $('btn-salvar-settings');
    if (!footer || !primaryButton) return;

    const visible = tab === 'geral' || tab === 'emitentes';
    footer.classList.toggle('is-hidden', !visible);
    footer.dataset.mode = tab;

    if (tab === 'emitentes') {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar empresa';
      primaryButton.setAttribute('aria-label', 'Salvar empresa emitente');
    } else {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar configurações';
      primaryButton.setAttribute('aria-label', 'Salvar configurações gerais');
    }
  }

  function setSettingsTab(tab) {
    state.settingsTab = tab;
    $$('.settings-tabs button').forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === tab));
    updateSettingsFooter(tab);
    if ($('settings-modal') && !$('settings-modal').hidden) $('settings-modal').querySelector('.settings-body').scrollTop = 0;
  }

  function normalizeSettingsColor(value, fallback = '#65ACDE') {
    const raw = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toUpperCase()}` : fallback;
  }

  function syncSettingsColorFromPicker() {
    const color = normalizeSettingsColor($('config-cor').value);
    $('config-cor').value = color;
    $('config-cor-hex').value = color.slice(1);
  }

  function syncSettingsColorFromText(force = false) {
    const typed = String($('config-cor-hex').value || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(typed)) {
      const color = `#${typed.toUpperCase()}`;
      $('config-cor').value = color;
      $('config-cor-hex').value = typed.toUpperCase();
      return;
    }
    if (force) syncSettingsColorFromPicker();
  }

  function updateSettingsConditionalFields() {
    const isDav = $('config-modelo-documento').value === 'dav';
    $$('[data-settings-dav]').forEach((field) => field.classList.toggle('is-hidden', !isDav));

    const useCover = $('config-usar-capa').checked;
    $$('[data-settings-cover-field]').forEach((field) => field.classList.toggle('settings-fields-muted', !useCover));
  }

  function fillSettingsForm() {
    const config = state.meta.configuracao || {};
    const values = {
      'config-nome-documento': config.nome_documento || 'Orçamento',
      'config-prefixo': config.prefixo || 'ORC',
      'config-validade': config.validade_padrao_dias ?? 7,
      'config-prazo': config.prazo_execucao_padrao || '',
      'config-condicoes': config.condicoes_padrao || '',
      'config-observacoes': config.observacoes_padrao || '',
      'config-rodape': config.rodape_padrao || '',
      'config-margem-minima': inputMoney(config.margem_minima),
      'config-titulo-capa': config.titulo_capa || '',
      'config-subtitulo-capa': config.subtitulo_capa || '',
      'config-modelo-documento': config.modelo_documento || 'padrao',
      'config-dav-titulo': config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
      'config-cabecalho-razao': config.cabecalho_razao_social || '',
      'config-cabecalho-fantasia': config.cabecalho_nome_fantasia || '',
      'config-cabecalho-cnpj': config.cabecalho_cnpj || '',
      'config-cabecalho-email': config.cabecalho_email || '',
      'config-cabecalho-site': config.cabecalho_site || '',
      'config-cabecalho-telefone': config.cabecalho_telefone || '',
      'config-cabecalho-endereco': config.cabecalho_endereco || '',
      'config-cabecalho-rodape': config.cabecalho_rodape || '',
    };
    Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    const primaryColor = normalizeSettingsColor(config.cor_primaria || '#65ACDE');
    $('config-cor').value = primaryColor;
    $('config-cor-hex').value = primaryColor.slice(1);
    $('config-exigir-aprovacao').checked = Boolean(config.exigir_aprovacao_margem);
    $('config-controlar-custos').checked = config.controlar_custos !== false;
    $('config-usar-capa').checked = Boolean(config.usar_capa);
    $('config-mostrar-codigo').checked = config.mostrar_codigo !== false;
    updateSettingsConditionalFields();
  }

  async function saveSettings() {
    const button = $('btn-salvar-settings');
    try {
      setButtonLoading(button, true);
      const config = state.meta.configuracao || {};
      const payload = {
        nome_documento: $('config-nome-documento').value.trim() || 'Orçamento',
        prefixo: $('config-prefixo').value.trim() || 'ORC',
        modelo_documento: $('config-modelo-documento').value || 'padrao',
        dav_titulo: $('config-dav-titulo').value.trim() || 'DAV - Documento Auxiliar de Venda',
        cabecalho_razao_social: $('config-cabecalho-razao').value.trim() || null,
        cabecalho_nome_fantasia: $('config-cabecalho-fantasia').value.trim() || null,
        cabecalho_cnpj: $('config-cabecalho-cnpj').value.trim() || null,
        cabecalho_email: $('config-cabecalho-email').value.trim() || null,
        cabecalho_site: $('config-cabecalho-site').value.trim() || null,
        cabecalho_telefone: $('config-cabecalho-telefone').value.trim() || null,
        cabecalho_endereco: $('config-cabecalho-endereco').value.trim() || null,
        cabecalho_rodape: $('config-cabecalho-rodape').value.trim() || null,
        validade_padrao_dias: Number($('config-validade').value || 0),
        prazo_execucao_padrao: $('config-prazo').value.trim() || null,
        condicoes_padrao: $('config-condicoes').value.trim() || null,
        observacoes_padrao: $('config-observacoes').value.trim() || null,
        rodape_padrao: $('config-rodape').value.trim() || null,
        cor_primaria: normalizeSettingsColor($('config-cor-hex').value || $('config-cor').value),
        titulo_capa: $('config-titulo-capa').value.trim() || null,
        subtitulo_capa: $('config-subtitulo-capa').value.trim() || null,
        usar_capa: $('config-usar-capa').checked,
        mostrar_codigo: $('config-mostrar-codigo').checked,
        mostrar_desconto: config.mostrar_desconto !== false,
        mostrar_imagens: Boolean(config.mostrar_imagens),
        controlar_custos: $('config-controlar-custos').checked,
        margem_minima: parseNumber($('config-margem-minima').value),
        exigir_aprovacao_margem: $('config-exigir-aprovacao').checked,
        formas_pagamento: config.formas_pagamento || [],
      };
      state.meta.configuracao = await api(`${API}/configuracao`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Configurações salvas.');
      applyPermissions();
      closeOverlay('settings-modal');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  function resetEmitterEditor() {
    const ids = ['emitter-id','emitter-name','emitter-legal-name','emitter-fantasy-name','emitter-cnpj','emitter-ie','emitter-email','emitter-site','emitter-phone','emitter-cep','emitter-address','emitter-number','emitter-complement','emitter-neighborhood','emitter-city','emitter-state','emitter-logo','emitter-footer'];
    ids.forEach((id) => { if ($(id)) $(id).value = ''; });
    $('emitter-default').checked = !state.emitters.some((emitter) => emitter.padrao && emitter.ativo !== false);
    $('emitter-active').checked = true;
    $('emitter-editor-title').textContent = 'Nova empresa emitente';
  }

  function renderEmitters() {
    if (!$('emitters-list')) return;
    $('emitters-list').innerHTML = state.emitters.map((emitter) => `<article class="emitter-list-item ${emitter.ativo === false ? 'is-inactive' : ''}"><div><strong>${escapeHtml(emitter.nome)}</strong><span>${escapeHtml(emitter.razao_social || '')}</span><small>${escapeHtml([emitter.cnpj, emitter.cidade, emitter.estado].filter(Boolean).join(' • '))}</small></div><div class="emitter-list-actions">${emitter.padrao ? '<span class="settings-status-badge">Padrão</span>' : ''}<button type="button" class="budget-action-btn" data-edit-emitter="${emitter.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>${emitter.ativo === false ? '' : `<button type="button" class="budget-action-btn danger" data-delete-emitter="${emitter.id}" title="Desativar"><i class="fa-regular fa-trash-can"></i></button>`}</div></article>`).join('') || '<div class="settings-empty-state"><strong>Nenhuma empresa emitente</strong><small>Cadastre a empresa que deverá aparecer no orçamento.</small></div>';
  }

  function editEmitter(id) {
    const emitter = state.emitters.find((item) => Number(item.id) === Number(id));
    if (!emitter) return;
    const values = {
      'emitter-id': emitter.id, 'emitter-name': emitter.nome, 'emitter-legal-name': emitter.razao_social,
      'emitter-fantasy-name': emitter.nome_fantasia, 'emitter-cnpj': emitter.cnpj, 'emitter-ie': emitter.inscricao_estadual,
      'emitter-email': emitter.email, 'emitter-site': emitter.site, 'emitter-phone': emitter.telefone, 'emitter-cep': emitter.cep,
      'emitter-address': emitter.endereco, 'emitter-number': emitter.numero, 'emitter-complement': emitter.complemento,
      'emitter-neighborhood': emitter.bairro, 'emitter-city': emitter.cidade, 'emitter-state': emitter.estado,
      'emitter-logo': emitter.logo_url, 'emitter-footer': emitter.rodape,
    };
    Object.entries(values).forEach(([idField, value]) => { $(idField).value = value || ''; });
    $('emitter-default').checked = Boolean(emitter.padrao);
    $('emitter-active').checked = emitter.ativo !== false;
    $('emitter-editor-title').textContent = `Editar ${emitter.nome}`;
  }

  function emitterPayload() {
    return {
      nome: $('emitter-name').value.trim(), razao_social: $('emitter-legal-name').value.trim(), nome_fantasia: $('emitter-fantasy-name').value.trim() || null,
      cnpj: $('emitter-cnpj').value.trim() || null, inscricao_estadual: $('emitter-ie').value.trim() || null, email: $('emitter-email').value.trim() || null,
      site: $('emitter-site').value.trim() || null, telefone: $('emitter-phone').value.trim() || null, cep: $('emitter-cep').value.trim() || null,
      endereco: $('emitter-address').value.trim() || null, numero: $('emitter-number').value.trim() || null, complemento: $('emitter-complement').value.trim() || null,
      bairro: $('emitter-neighborhood').value.trim() || null, cidade: $('emitter-city').value.trim() || null, estado: $('emitter-state').value.trim().toUpperCase() || null,
      logo_url: $('emitter-logo').value.trim() || null, rodape: $('emitter-footer').value.trim() || null,
      padrao: $('emitter-default').checked, ativo: $('emitter-active').checked,
    };
  }

  async function saveEmitter(triggerButton = null) {
    const button = triggerButton || $('btn-salvar-emitente');
    try {
      const payload = emitterPayload();
      if (!payload.nome || !payload.razao_social) throw new Error('Informe o nome interno e a razão social.');
      setButtonLoading(button, true);
      const id = Number($('emitter-id').value || 0);
      await api(id ? `${API}/emitentes/${id}` : `${API}/emitentes`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      state.meta.emitentes = state.emitters.filter((emitter) => emitter.ativo !== false);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente salva.');
    } catch (error) { toast(error.message || 'Não foi possível salvar a empresa.', 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteEmitter(id) {
    if (!confirm('Desativar esta empresa emitente? Orçamentos antigos manterão os dados gravados.')) return;
    try {
      await api(`${API}/emitentes/${id}`, { method: 'DELETE' });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente desativada.');
    } catch (error) { toast(error.message, 'error'); }
  }

  function resetCategoryEditor() {
    $('category-id').value = '';
    $('category-name').value = '';
    $('category-description').value = '';
    $('category-order').value = '0';
    $('category-active').checked = true;
    $('category-editor-title').textContent = 'Nova categoria';
  }

  function renderCategories() {
    $('categories-list').innerHTML = state.categories.map((category) => `
      <article class="settings-list-item category-settings-card ${category.ativo === false ? 'is-inactive' : ''}">
        <span class="category-settings-icon"><i class="fa-regular fa-folder-open"></i></span>
        <div class="category-settings-copy">
          <div class="category-settings-title">
            <strong>${escapeHtml(category.nome)}</strong>
            <span class="settings-status-badge ${category.ativo === false ? 'inactive' : ''}">${category.ativo === false ? 'Inativa' : 'Ativa'}</span>
          </div>
          <small>${escapeHtml(category.descricao || 'Categoria sem descrição interna.')}</small>
          <span class="category-settings-order">Ordem ${Number(category.ordem || 0)}</span>
        </div>
        <div class="settings-list-actions">
          <button class="budget-action-btn" data-edit-category="${category.id}" type="button" title="Editar categoria"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-category="${category.id}" type="button" title="Excluir categoria"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state"><span><i class="fa-regular fa-folder-open"></i></span><strong>Nenhuma categoria criada</strong><small>Crie categorias para organizar e identificar os tipos de orçamento.</small></div>`;
  }

  function editCategory(id) {
    const category = state.categories.find((item) => Number(item.id) === Number(id));
    if (!category) return;
    $('category-id').value = category.id;
    $('category-name').value = category.nome;
    $('category-description').value = category.descricao || '';
    $('category-order').value = category.ordem || 0;
    $('category-active').checked = category.ativo !== false;
    $('category-editor-title').textContent = 'Editar categoria';
  }

  async function saveCategory() {
    const id = Number($('category-id').value) || null;
    const payload = { nome: $('category-name').value.trim(), descricao: $('category-description').value.trim() || null, ordem: Number($('category-order').value || 0), ativo: $('category-active').checked };
    if (!payload.nome) { toast('Informe o nome da categoria.', 'error'); return; }
    try {
      await api(id ? `${API}/categorias/${id}` : `${API}/categorias`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria salva.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function deleteCategory(id) {
    if (!confirm('Excluir esta categoria? Os orçamentos existentes continuarão salvos.')) return;
    try {
      await api(`${API}/categorias/${id}`, { method: 'DELETE' });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria excluída.');
    } catch (error) { toast(error.message, 'error'); }
  }

  function renderKits() {
    $('kits-list').innerHTML = state.kits.map((kit) => `
      <article class="kit-settings-card ${kit.ativo === false ? 'is-inactive' : ''}">
        <div class="kit-settings-card-top">
          <span class="kit-settings-icon"><i class="fa-solid fa-layer-group"></i></span>
          <span class="settings-status-badge ${kit.ativo === false ? 'inactive' : ''}">${kit.ativo === false ? 'Inativo' : 'Ativo'}</span>
        </div>
        <div class="kit-settings-copy">
          <h5>${escapeHtml(kit.nome)}</h5>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para inserção no orçamento.')}</p>
        </div>
        <div class="kit-settings-meta">
          <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
          <strong>${formatMoney(kit.valor_estimado)}</strong>
        </div>
        <div class="kit-settings-actions">
          <button class="budget-action-btn" data-edit-kit="${kit.id}" type="button" title="Editar kit"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn" data-duplicate-kit="${kit.id}" type="button" title="Duplicar kit"><i class="fa-regular fa-copy"></i></button>
          <button class="budget-action-btn danger" data-delete-kit="${kit.id}" type="button" title="Excluir kit"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-solid fa-layer-group"></i></span><strong>Nenhum kit criado</strong><small>Monte um conjunto de produtos para adicioná-los ao orçamento com um clique.</small></div>`;
  }

  function openKitEditor(kit = null) {
    $('kits-list-view').classList.add('is-hidden');
    $('kit-editor').classList.remove('is-hidden');
    $('kit-id').value = kit?.id || '';
    $('kit-name').value = kit?.nome || '';
    $('kit-description').value = kit?.descricao || '';
    $('kit-active').checked = kit?.ativo !== false;
    state.kitItems = (kit?.itens || []).map(normalizeItem);
    $('kit-editor-title').textContent = kit ? 'Editar kit' : 'Novo kit';
    $('kit-product-search').hidden = true;
    resetProductSearch('kit');
    renderKitItems();
  }

  function closeKitEditor() {
    $('kit-editor').classList.add('is-hidden');
    $('kits-list-view').classList.remove('is-hidden');
    state.kitItems = [];
    resetProductSearch('kit');
  }

  async function editKit(id) {
    try {
      openKitEditor(await api(`${API}/kits/${id}`));
    } catch (error) {
      toast(error.message || 'Não foi possível abrir o kit.', 'error');
    }
  }

  function renderKitItems() {
    const count = state.kitItems.length;
    const estimatedTotal = state.kitItems.reduce((sum, item) => sum + parseNumber(item.quantidade) * parseNumber(item.valor_unitario), 0);
    $('kit-items-count').textContent = String(count);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
    $('kit-items-body').innerHTML = state.kitItems.map((item, index) => `
      <tr data-kit-index="${index}">
        <td><div class="kit-product-cell"><strong>${escapeHtml(item.descricao || 'Produto')}</strong><small>${escapeHtml(item.referencia || 'Produto cadastrado')}</small></div></td>
        <td>${escapeHtml(item.codigo || '—')}</td>
        <td>${escapeHtml(item.unidade || 'UN')}</td>
        <td><input class="kit-quantity-input" data-kit-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td>${formatMoney(item.valor_unitario)}</td>
        <td class="kit-line-total">${formatMoney(parseNumber(item.quantidade) * parseNumber(item.valor_unitario))}</td>
        <td><button class="item-remove" data-remove-kit-item="${index}" type="button" title="Remover produto"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum produto adicionado ao kit.</td></tr>';
  }

  function updateKitItem(input) {
    const row = input.closest('tr');
    const item = state.kitItems[Number(row?.dataset.kitIndex)];
    if (!item) return;
    item.quantidade = Math.max(parseNumber(input.value), 0.0001);
    row.querySelector('.kit-line-total').textContent = formatMoney(item.quantidade * parseNumber(item.valor_unitario));
    const estimatedTotal = state.kitItems.reduce((sum, current) => sum + parseNumber(current.quantidade) * parseNumber(current.valor_unitario), 0);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
  }

  async function saveKit() {
    const button = $('btn-salvar-kit');
    const id = Number($('kit-id').value) || null;
    const payload = {
      nome: $('kit-name').value.trim(),
      descricao: $('kit-description').value.trim() || null,
      ativo: $('kit-active').checked,
      itens: state.kitItems.map((item, index) => ({
        produto_id: Number(item.produto_id),
        quantidade: Math.max(parseNumber(item.quantidade), 0.0001),
        ordem: index,
      })),
    };
    if (!payload.nome) { toast('Informe o nome do kit.', 'error'); return; }
    if (!payload.itens.length) { toast('Adicione pelo menos um produto ao kit.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/kits/${id}` : `${API}/kits`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      closeKitEditor();
      toast('Kit salvo. Ele já está disponível na etapa Itens do orçamento.');
    } catch (error) {
      toast(error.message || 'Não foi possível salvar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function duplicateKit(id) {
    try {
      await api(`${API}/kits/${id}/duplicar`, { method: 'POST' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      toast('Kit duplicado.');
    } catch (error) {
      toast(error.message || 'Não foi possível duplicar o kit.', 'error');
    }
  }

  async function deleteKit(id) {
    if (!confirm('Excluir este kit? Os produtos e orçamentos existentes não serão apagados.')) return;
    try {
      await api(`${API}/kits/${id}`, { method: 'DELETE' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      closeKitEditor();
      toast('Kit excluído.');
    } catch (error) {
      toast(error.message || 'Não foi possível excluir o kit.', 'error');
    }
  }

  function renderTemplates() {
    $('templates-list').innerHTML = state.templates.map((template) => `
      <article class="template-card ${template.ativo === false ? 'is-inactive' : ''}">
        <div class="template-card-top">
          <span class="template-card-icon"><i class="fa-regular fa-file-lines"></i></span>
          <span class="settings-status-badge ${template.ativo === false ? 'inactive' : ''}">${template.ativo === false ? 'Inativo' : 'Ativo'}</span>
        </div>
        <h5>${escapeHtml(template.nome)}</h5>
        <p>${escapeHtml(template.descricao || template.titulo || 'Estrutura reutilizável de orçamento.')}</p>
        <div class="template-card-meta">
          <span><i class="fa-regular fa-folder"></i> ${escapeHtml(template.categoria_nome || 'Sem categoria')}</span>
          ${template.validade_dias ? `<span><i class="fa-regular fa-calendar"></i> ${template.validade_dias} dias</span>` : ''}
        </div>
        <div class="template-card-actions">
          <button class="budget-action-btn" data-edit-template="${template.id}" type="button" title="Editar modelo"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-template="${template.id}" type="button" title="Excluir modelo"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-regular fa-file-lines"></i></span><strong>Nenhum modelo criado</strong><small>Crie estruturas prontas para preencher títulos, condições e itens automaticamente.</small></div>`;
  }

  function openTemplateEditor(template = null) {
    $('templates-list-view').classList.add('is-hidden');
    $('template-editor').classList.remove('is-hidden');
    $('template-id').value = template?.id || '';
    $('template-name').value = template?.nome || '';
    $('template-category').value = template?.categoria_id || '';
    $('template-title').value = template?.titulo || '';
    $('template-validity').value = template?.validade_dias ?? state.meta.configuracao?.validade_padrao_dias ?? 7;
    $('template-deadline').value = template?.prazo_execucao || '';
    $('template-conditions').value = template?.condicoes || '';
    $('template-notes').value = template?.observacoes || '';
    $('template-active').checked = template?.ativo !== false;
    state.templateItems = (template?.itens || []).map(normalizeItem);
    $('template-editor-title').textContent = template ? 'Editar modelo' : 'Novo modelo';
    renderTemplateItems();
  }

  function closeTemplateEditor() {
    $('template-editor').classList.add('is-hidden');
    $('templates-list-view').classList.remove('is-hidden');
    state.templateItems = [];
  }

  async function editTemplate(id) {
    try { openTemplateEditor(await api(`${API}/modelos/${id}`)); }
    catch (error) { toast(error.message, 'error'); }
  }

  function renderTemplateItems() {
    $('template-items-body').innerHTML = state.templateItems.map((item, index) => `
      <tr data-template-index="${index}"><td><textarea data-template-field="descricao">${escapeHtml(item.descricao)}</textarea></td><td><input data-template-field="codigo" value="${escapeHtml(item.codigo)}" /></td><td><input data-template-field="unidade" value="${escapeHtml(item.unidade)}" /></td><td><input data-template-field="quantidade" value="${inputMoney(item.quantidade)}" /></td><td><input data-template-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" /></td><td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}"><input data-template-field="custo_unitario" value="${inputMoney(item.custo_unitario)}" /></td><td><button class="item-remove" data-remove-template-item="${index}" type="button"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum item no modelo.</td></tr>';
  }

  function updateTemplateItem(input) {
    const item = state.templateItems[Number(input.closest('tr').dataset.templateIndex)];
    const field = input.dataset.templateField;
    item[field] = ['quantidade', 'valor_unitario', 'custo_unitario'].includes(field) ? parseNumber(input.value) : input.value;
  }

  async function saveTemplate() {
    const button = $('btn-salvar-modelo');
    const id = Number($('template-id').value) || null;
    const payload = {
      nome: $('template-name').value.trim(), categoria_id: Number($('template-category').value) || null,
      titulo: $('template-title').value.trim() || null, descricao: null,
      validade_dias: Number($('template-validity').value || 0), prazo_execucao: $('template-deadline').value.trim() || null,
      condicoes: $('template-conditions').value.trim() || null, observacoes: $('template-notes').value.trim() || null,
      pagamentos: [], ativo: $('template-active').checked, itens: state.templateItems.map((item, index) => ({ ...item, ordem: index })),
    };
    if (!payload.nome) { toast('Informe o nome do modelo.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/modelos/${id}` : `${API}/modelos`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); closeTemplateEditor(); toast('Modelo salvo.');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteTemplate(id) {
    if (!confirm('Excluir este modelo?')) return;
    try {
      await api(`${API}/modelos/${id}`, { method: 'DELETE' });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); toast('Modelo excluído.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function handleInitialRoute() {
    if (state.initialRouteHandled) return;
    state.initialRouteHandled = true;
    const params = new URLSearchParams(window.location.search);
    const budgetId = Number(params.get('orcamento_id') || 0);
    const clientId = Number(params.get('cliente_id') || 0);
    if (budgetId) {
      await openEditBudget(budgetId);
      return;
    }
    if (params.get('novo') === '1' || clientId) {
      await openNewBudget();
      if (clientId) await selectClient(clientId);
    }
  }

  function bindEvents() {
    $('btn-novo-orcamento').addEventListener('click', openNewBudget);
    $('btn-atualizar-orcamentos').addEventListener('click', loadBudgets);
    $('btn-configurar-orcamentos').addEventListener('click', openSettings);
    $('btn-limpar-filtros').addEventListener('click', () => { $('busca-orcamentos').value = ''; $('filtro-status-orcamentos').value = ''; renderBudgets(); });
    $('busca-orcamentos').addEventListener('input', renderBudgets);
    $('filtro-status-orcamentos').addEventListener('change', renderBudgets);

    $('tbody-orcamentos').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action][data-id]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const actions = { edit: openEditBudget, print: printBudget, whatsapp: sendWhatsApp, duplicate: duplicateBudget, delete: deleteBudget };
      actions[button.dataset.action]?.(id);
    });

    $('btn-fechar-budget-modal').addEventListener('click', () => closeOverlay('budget-modal'));
    $('btn-cancelar-orcamento').addEventListener('click', () => closeOverlay('budget-modal'));
    $('btn-salvar-orcamento').addEventListener('click', saveBudget);
    $('btn-imprimir-orcamento').addEventListener('click', printCurrent);
    $('btn-whatsapp-orcamento').addEventListener('click', () => state.currentId && sendWhatsApp(state.currentId));
    $('btn-aprovar-margem').addEventListener('click', approveMargin);
    $$('.budget-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('orcamento-status').addEventListener('change', () => { updateStatusPreview(); syncRefreshPricesButton(); });
    $('orcamento-titulo').addEventListener('input', (event) => {
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = event.target.value.trim() || 'Novo orçamento';
    });
    $('orcamento-modelo').addEventListener('change', (event) => applyTemplate(event.target.value));

    $('orcamento-cliente-busca').addEventListener('focus', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('click', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('input', () => {
      $('orcamento-cliente-id').value = '';
      state.selectedClient = null;
      syncClientEditButton();
      searchClients();
    });
    $('btn-editar-cliente-orcamento')?.addEventListener('click', openSelectedClientEditor);
    $('orcamento-cliente-resultados').addEventListener('click', (event) => { const button = event.target.closest('[data-client-id]'); if (button) selectClient(button.dataset.clientId); });
    $('orcamento-cliente-resultados').addEventListener('scroll', loadMoreClientsOnScroll, { passive: true });
    $('btn-usar-endereco-cliente').addEventListener('click', async () => {
      const id = Number($('orcamento-cliente-id').value);
      if (!id) { toast('Selecione um cliente primeiro.', 'error'); return; }
      if (!state.selectedClient?.endereco) state.selectedClient = await api(`${API_CLIENTS}/${id}`);
      fillAddressFromClient(state.selectedClient, true);
    });

    $('btn-atualizar-precos-itens')?.addEventListener('click', refreshCurrentBudgetPrices);
    $('btn-adicionar-kit').addEventListener('click', openKitPicker);
    $('btn-fechar-kit-picker').addEventListener('click', () => closeOverlay('kit-picker-modal'));
    $('btn-cancelar-kit-picker').addEventListener('click', () => closeOverlay('kit-picker-modal'));
    $('kit-picker-search-input').addEventListener('input', renderKitPicker);
    $('kit-picker-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-kit]');
      if (button) addKitToBudget(Number(button.dataset.addKit), button);
    });
    $('btn-gerenciar-kits').addEventListener('click', async () => {
      closeOverlay('kit-picker-modal');
      await openSettings();
      setSettingsTab('kits');
    });

    $('btn-buscar-produto').addEventListener('click', () => {
      const box = $('produto-search-box');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('produto-search-input').focus();
        showProductOptions('budget');
      }
    });
    $('btn-adicionar-item').addEventListener('click', () => addManualItem('budget'));
    $('produto-search-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'budget'), 250));
    $('produto-search-results').addEventListener('scroll', () => loadMoreProductsOnScroll('budget'), { passive: true });
    $('produto-search-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'budget'); });
    $('budget-items-body').addEventListener('input', (event) => { if (event.target.dataset.field) updateItemField(event.target); });
    $('budget-items-body').addEventListener('focusout', (event) => { const field = event.target.dataset.field; if (!['quantidade', 'valor_unitario', 'desconto', 'custo_unitario'].includes(field)) return; if (field === 'custo_unitario' && !String(event.target.value || '').trim()) event.target.value = ''; else event.target.value = field === 'quantidade' ? inputQuantity(event.target.value) : inputMoney(event.target.value); updateItemField(event.target); });
    $('budget-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-item]'); if (button) { state.items.splice(Number(button.dataset.removeItem), 1); renderItems(); updateTotals(); } });

    ['orcamento-desconto-tipo', 'orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('input', updateTotals));
    ['orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('blur', (event) => { event.target.value = inputMoney(event.target.value); updateTotals(); }));
    $('btn-adicionar-pagamento').addEventListener('click', () => { state.payments.push(normalizePayment({ nome: 'Nova condição' })); renderPayments(); });
    $('payment-options').addEventListener('input', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('change', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-payment]'); if (button) { state.payments.splice(Number(button.dataset.removePayment), 1); renderPayments(); } });
    $('orcamento-emitente-id')?.addEventListener('change', renderPreviewIfVisible);
    ['orcamento-titulo', 'orcamento-nome-documento', 'orcamento-condicoes', 'orcamento-observacoes', 'orcamento-prazo-execucao', 'orcamento-titulo-capa', 'orcamento-subtitulo-capa', 'orcamento-usar-capa', 'orcamento-categoria', 'orcamento-consultor', 'orcamento-data-emissao', 'orcamento-data-validade'].forEach((id) => $(id).addEventListener('input', renderPreviewIfVisible));

    // Settings
    $('btn-fechar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-cancelar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-salvar-settings').addEventListener('click', () => {
      if (state.settingsTab === 'emitentes') {
        saveEmitter($('btn-salvar-settings'));
        return;
      }
      saveSettings();
    });
    $('btn-novo-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-cancelar-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-salvar-emitente')?.addEventListener('click', saveEmitter);
    $('emitters-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-emitter]'); const del = event.target.closest('[data-delete-emitter]'); if (edit) editEmitter(edit.dataset.editEmitter); if (del) deleteEmitter(del.dataset.deleteEmitter); });
    $$('.settings-tabs button').forEach((button) => button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab)));
    $('config-cor').addEventListener('input', syncSettingsColorFromPicker);
    $('config-cor-hex').addEventListener('input', () => syncSettingsColorFromText(false));
    $('config-cor-hex').addEventListener('blur', () => syncSettingsColorFromText(true));
    $('config-modelo-documento').addEventListener('change', updateSettingsConditionalFields);
    $('config-usar-capa').addEventListener('change', updateSettingsConditionalFields);
    $('btn-nova-categoria').addEventListener('click', resetCategoryEditor);
    $('btn-salvar-categoria').addEventListener('click', saveCategory);
    $('categories-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-category]'); const del = event.target.closest('[data-delete-category]'); if (edit) editCategory(edit.dataset.editCategory); if (del) deleteCategory(del.dataset.deleteCategory); });
    $('btn-novo-kit').addEventListener('click', () => openKitEditor());
    $('btn-voltar-kits').addEventListener('click', closeKitEditor);
    $('btn-cancelar-kit').addEventListener('click', closeKitEditor);
    $('btn-salvar-kit').addEventListener('click', saveKit);
    $('kits-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-kit]');
      const duplicate = event.target.closest('[data-duplicate-kit]');
      const del = event.target.closest('[data-delete-kit]');
      if (edit) editKit(edit.dataset.editKit);
      if (duplicate) duplicateKit(duplicate.dataset.duplicateKit);
      if (del) deleteKit(del.dataset.deleteKit);
    });
    $('btn-kit-product').addEventListener('click', () => {
      const box = $('kit-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('kit-product-input').focus();
        showProductOptions('kit');
      }
    });
    $('kit-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'kit'), 250));
    $('kit-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('kit'), { passive: true });
    $('kit-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'kit'); });
    $('kit-items-body').addEventListener('input', (event) => { if (event.target.dataset.kitField) updateKitItem(event.target); });
    $('kit-items-body').addEventListener('focusout', (event) => { if (event.target.dataset.kitField === 'quantidade') { event.target.value = inputQuantity(event.target.value); updateKitItem(event.target); } });
    $('kit-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-kit-item]'); if (button) { state.kitItems.splice(Number(button.dataset.removeKitItem), 1); renderKitItems(); } });

    $('btn-novo-modelo').addEventListener('click', () => openTemplateEditor());
    $('btn-voltar-modelos').addEventListener('click', closeTemplateEditor);
    $('btn-cancelar-modelo').addEventListener('click', closeTemplateEditor);
    $('btn-salvar-modelo').addEventListener('click', saveTemplate);
    $('templates-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-template]'); const del = event.target.closest('[data-delete-template]'); if (edit) editTemplate(edit.dataset.editTemplate); if (del) deleteTemplate(del.dataset.deleteTemplate); });
    $('btn-template-product').addEventListener('click', () => {
      const box = $('template-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('template-product-input').focus();
        showProductOptions('template');
      }
    });
    $('btn-template-manual').addEventListener('click', () => addManualItem('template'));
    $('template-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'template'), 250));
    $('template-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('template'), { passive: true });
    $('template-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'template'); });
    $('template-items-body').addEventListener('input', (event) => { if (event.target.dataset.templateField) updateTemplateItem(event.target); });
    $('template-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-template-item]'); if (button) { state.templateItems.splice(Number(button.dataset.removeTemplateItem), 1); renderTemplateItems(); } });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.autocomplete-field')) {
        $('orcamento-cliente-resultados').hidden = true;
        $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('kit-picker-modal').hidden) closeOverlay('kit-picker-modal');
        else if (!$('settings-modal').hidden) closeOverlay('settings-modal');
        else if (!$('budget-modal').hidden) closeOverlay('budget-modal');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    bootstrap();
  });
})();
