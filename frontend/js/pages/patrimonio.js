// /frontend/js/pages/patrimonio.js
// Patrimônio | Valora CRM
// Modal padrão Clientes + Formulários/Ficha Principal igual Clientes/Fornecedores.

(() => {
  'use strict';

  const API_PATRIMONIO = '/api/patrimonio';
  const MODULO_FORMULARIO = 'patrimonio';

  const SYSTEM_FIELD_SLUGS = new Set([
    'codigo',
    'cod_ref_id',
    'cod_ref',
    'codigo_referencia',
    'nome',
    'patrimonio',
    'nome_patrimonio',
    'nome_do_patrimonio',
    'identificacao_do_patrimonio',
    'identificacao_patrimonio',
    'bem',
    'equipamento',
    'titulo',
    'descricao',
    'descricao_do_patrimonio',
    'descricao_patrimonio',
    'detalhes',
    'observacoes',
    'observacao',
    'obs',
    'categoria',
    'tipo',
    'tipo_patrimonio',
    'grupo',
    'classe',
    'marca',
    'fabricante',
    'modelo',
    'modelo_equipamento',
    'numero_serie',
    'numero_de_serie',
    'serie',
    'serial',
    'numero_serial',
    'localizacao',
    'local',
    'setor',
    'sala',
    'departamento',
    'responsavel',
    'usuario_responsavel',
    'colaborador',
    'responsavel_pelo_bem',
    'status',
    'status_atual',
    'situacao',
    'valor_aquisicao',
    'valor_de_aquisicao',
    'valor_compra',
    'custo',
    'data_aquisicao',
    'data_de_aquisicao',
    'data_compra',
    'ativo',
    'visivel',
    'mostrar_na_listagem',
    'data_cadastro',
  ]);

  const state = {
    itens: [],
    editandoId: null,
    buscaTimer: null,
    formulario: null,
    usarFichaPrincipal: false,
    fichaController: null,
    detalheAtual: null,
    modalSomenteLeitura: false,
  };

  function qs(id) {
    return document.getElementById(id);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function onlyDigits(value) {
    return String(value ?? '').replace(/\D+/g, '').trim();
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function todayISO() {
    return new Date().toISOString().slice(0, 10);
  }


  function formatarDataCadastroSistema(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}/${match[2]}/${match[1]}`;

    return raw;
  }

  function setPatrimonioDataCadastro(dataCadastro, usarHoje = false) {
    const raw = dataCadastro || (usarHoje ? new Date().toISOString() : '');
    setValue('campo-data-cadastro-ficha-principal-patrimonio', formatarDataCadastroSistema(raw));
  }

  function toast(message, options = {}) {
    const error = typeof options === 'boolean' ? options : !!options.error;
    const ms = typeof options === 'object' && options.ms ? Number(options.ms) : 2800;

    if (typeof window.showToast === 'function') {
      window.showToast(message, error ? 'error' : 'success');
      return;
    }

    const el = qs('valora-toast');
    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message || '';
    el.classList.toggle('is-error', error);
    el.classList.add('show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async function apiJson(url, options = {}) {
    const resp = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (resp.status === 204) return null;

    const text = await resp.text();

    if (!resp.ok) {
      let detail = text || 'Erro na requisição.';
      try {
        const json = JSON.parse(text);
        detail = json.detail || json.message || detail;
      } catch (_) {}
      throw new Error(typeof detail === 'string' ? detail : 'Erro na requisição.');
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  async function carregarProximoCodigoPatrimonio() {
    try {
      const data = await apiJson(`${API_PATRIMONIO}/proximo-codigo`);
      return onlyDigits(data?.codigo || '');
    } catch (err) {
      console.warn('[Patrimônio] não foi possível carregar próximo código:', err);
      return '';
    }
  }

  function openModal(id) {
    if (window.ValoraModal) return window.ValoraModal.open(id);

    const modal = qs(id);
    if (!modal) return;

    modal.hidden = false;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
  }

  function closeModal(id) {
    if (window.ValoraModal) return window.ValoraModal.close(id);

    const modal = qs(id);
    if (!modal) return;

    modal.classList.remove('show');
    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';
    }, 160);
  }

  function normalizeCustomFields(value) {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return { ...value };

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    }

    return {};
  }

  function getCustomValue(customFields, keys, fallback = '') {
    const custom = normalizeCustomFields(customFields);

    for (const key of keys) {
      const value = custom?.[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }

    return fallback || '';
  }

  function firstUsefulCustomValue(customFields) {
    const custom = normalizeCustomFields(customFields);
    const blocked = new Set([
      'data_cadastro',
      'codigo',
      'cod_ref_id',
      'status',
      'status_atual',
      'ativo',
      'valor_aquisicao',
      'data_aquisicao',
    ]);

    for (const [key, value] of Object.entries(custom)) {
      if (blocked.has(String(key))) continue;
      const text = String(value ?? '').trim();
      if (text && !/^true|false$/i.test(text) && text.length >= 2) return text;
    }

    return '';
  }

  function buildPatrimonioBaseFromCustom(customFields, fallback = {}) {
    const custom = normalizeCustomFields(customFields);

    const nome = getCustomValue(custom, [
      'nome',
      'nome_patrimonio',
      'nome_do_patrimonio',
      'patrimonio',
      'identificacao_do_patrimonio',
      'identificacao_patrimonio',
      'bem',
      'equipamento',
      'titulo',
    ], fallback.nome || '') || firstUsefulCustomValue(custom);

    const descricao = getCustomValue(custom, [
      'descricao',
      'descricao_do_patrimonio',
      'descricao_patrimonio',
      'detalhes',
      'observacoes',
      'observacao',
    ], fallback.descricao || '');

    const categoria = getCustomValue(custom, [
      'categoria',
      'tipo',
      'tipo_patrimonio',
      'grupo',
      'classe',
    ], fallback.categoria || '');

    const marca = getCustomValue(custom, ['marca', 'fabricante'], fallback.marca || '');
    const modelo = getCustomValue(custom, ['modelo', 'modelo_equipamento'], fallback.modelo || '');
    const numeroSerie = getCustomValue(custom, [
      'numero_serie',
      'numero_de_serie',
      'serie',
      'serial',
      'numero_serial',
    ], fallback.numero_serie || '');

    const localizacao = getCustomValue(custom, [
      'localizacao',
      'local',
      'setor',
      'sala',
      'departamento',
    ], fallback.localizacao || '');

    const responsavel = getCustomValue(custom, [
      'responsavel',
      'usuario_responsavel',
      'colaborador',
      'responsavel_pelo_bem',
    ], fallback.responsavel || '');

    const status = getCustomValue(custom, [
      'status',
      'status_atual',
      'situacao',
    ], fallback.status || 'ativo') || 'ativo';

    const valorAquisicao = getCustomValue(custom, [
      'valor_aquisicao',
      'valor_de_aquisicao',
      'valor_compra',
      'custo',
    ], fallback.valor_aquisicao || '');

    const dataAquisicao = getCustomValue(custom, [
      'data_aquisicao',
      'data_de_aquisicao',
      'data_compra',
    ], fallback.data_aquisicao || '');

    const observacoes = getCustomValue(custom, [
      'observacoes',
      'observacao',
      'obs',
    ], fallback.observacoes || '');

    const ativoRaw = String(getCustomValue(custom, [
      'ativo',
      'visivel',
      'mostrar_na_listagem',
    ], fallback.ativo === false ? 'false' : 'true')).toLowerCase();

    const ativo = !['false', 'nao', 'não', 'inativo', 'oculto', '0'].includes(ativoRaw);

    return {
      codigo: onlyDigits(fallback.codigo || qs('campo-codigo-ficha-principal-patrimonio')?.value || ''),
      nome,
      descricao,
      categoria,
      marca,
      modelo,
      numero_serie: numeroSerie,
      localizacao,
      responsavel,
      status,
      valor_aquisicao: valorAquisicao,
      data_aquisicao: dataAquisicao,
      observacoes,
      ativo,
    };
  }

  function preencherAliasesCustomPatrimonio(custom, aliases = [], value = '') {
    const text = String(value ?? '').trim();
    if (!text) return;

    aliases.forEach((slug) => {
      if (!slug) return;
      if (custom[slug] === undefined || custom[slug] === null || String(custom[slug]).trim() === '') {
        custom[slug] = text;
      }
    });
  }

  function buildCustomValuesFromPatrimonio(item = {}) {
    const custom = normalizeCustomFields(item.custom_fields);
    custom.data_cadastro = item.data_cadastro || item.criado_em || item.created_at || custom.data_cadastro || '';

    preencherAliasesCustomPatrimonio(custom, [
      'nome',
      'nome_patrimonio',
      'nome_do_patrimonio',
      'patrimonio',
      'identificacao_do_patrimonio',
      'identificacao_patrimonio',
      'bem',
      'equipamento',
      'titulo',
    ], item.nome);

    preencherAliasesCustomPatrimonio(custom, [
      'descricao',
      'descricao_do_patrimonio',
      'descricao_patrimonio',
      'detalhes',
      'observacoes',
      'observacao',
      'obs',
    ], item.descricao || item.observacoes);

    preencherAliasesCustomPatrimonio(custom, [
      'categoria',
      'tipo',
      'tipo_patrimonio',
      'grupo',
      'classe',
    ], item.categoria);

    preencherAliasesCustomPatrimonio(custom, ['marca', 'fabricante'], item.marca);
    preencherAliasesCustomPatrimonio(custom, ['modelo', 'modelo_equipamento'], item.modelo);
    preencherAliasesCustomPatrimonio(custom, [
      'numero_serie',
      'numero_de_serie',
      'serie',
      'serial',
      'numero_serial',
    ], item.numero_serie);

    preencherAliasesCustomPatrimonio(custom, [
      'localizacao',
      'local',
      'setor',
      'sala',
      'departamento',
    ], item.localizacao);

    preencherAliasesCustomPatrimonio(custom, [
      'responsavel',
      'usuario_responsavel',
      'colaborador',
      'responsavel_pelo_bem',
    ], item.responsavel);

    preencherAliasesCustomPatrimonio(custom, [
      'status',
      'status_atual',
      'situacao',
    ], item.status);

    preencherAliasesCustomPatrimonio(custom, [
      'valor_aquisicao',
      'valor_de_aquisicao',
      'valor_compra',
      'custo',
    ], item.valor_aquisicao);

    preencherAliasesCustomPatrimonio(custom, [
      'data_aquisicao',
      'data_de_aquisicao',
      'data_compra',
    ], item.data_aquisicao);

    return custom;
  }

  function buildCustomValuesNovo() {
    return { data_cadastro: todayISO() };
  }

  function setValue(id, value = '') {
    const el = qs(id);
    if (!el) return;
    el.value = value ?? '';
  }

  function getValue(id) {
    return String(qs(id)?.value ?? '').trim();
  }


  function restoreReadonlyElement(el) {
    if (!el || el.dataset.readonlyTouched !== 'true') return;

    el.disabled = el.dataset.readonlyWasDisabled === 'true';
    el.readOnly = el.dataset.readonlyWasReadonly === 'true';
    el.removeAttribute('aria-readonly');
    el.classList.remove('is-readonly-field');

    delete el.dataset.readonlyTouched;
    delete el.dataset.readonlyWasDisabled;
    delete el.dataset.readonlyWasReadonly;
  }

  function applyReadonlyElement(el) {
    if (!el || el.dataset.readonlyTouched === 'true') return;

    el.dataset.readonlyTouched = 'true';
    el.dataset.readonlyWasDisabled = el.disabled ? 'true' : 'false';
    el.dataset.readonlyWasReadonly = el.readOnly ? 'true' : 'false';

    const tag = String(el.tagName || '').toLowerCase();
    const type = String(el.type || '').toLowerCase();

    if (tag === 'select' || type === 'checkbox' || type === 'radio' || type === 'file' || type === 'button') {
      el.disabled = true;
    } else {
      el.readOnly = true;
    }

    el.setAttribute('aria-readonly', 'true');
    el.classList.add('is-readonly-field');
  }

  function setHiddenByReadonly(id, enabled) {
    const el = qs(id);
    if (!el) return;

    if (enabled) {
      if (el.dataset.readonlyTouchedHidden !== 'true') {
        el.dataset.readonlyTouchedHidden = 'true';
        el.dataset.readonlyWasHidden = el.hidden ? 'true' : 'false';
        el.dataset.readonlyWasDisplay = el.style.display || '';
      }
      el.hidden = true;
      el.style.display = 'none';
      return;
    }

    if (el.dataset.readonlyTouchedHidden === 'true') {
      el.hidden = el.dataset.readonlyWasHidden === 'true';
      el.style.display = el.dataset.readonlyWasDisplay || '';
      delete el.dataset.readonlyTouchedHidden;
      delete el.dataset.readonlyWasHidden;
      delete el.dataset.readonlyWasDisplay;
    }
  }

  function setPatrimonioModalReadonly(enabled) {
    state.modalSomenteLeitura = !!enabled;

    const backdrop = qs('modal-patrimonio');
    const form = qs('formPatrimonio');
    const cancelBtn = qs('btn-cancelar-patrimonio');

    backdrop?.classList.toggle('modal-readonly', state.modalSomenteLeitura);
    form?.classList.toggle('modal-readonly-form', state.modalSomenteLeitura);

    if (form) {
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        if (state.modalSomenteLeitura) applyReadonlyElement(el);
        else restoreReadonlyElement(el);
      });
    }

    [
      'btn-salvar-patrimonio',
      'btn-excluir-patrimonio',
    ].forEach((id) => setHiddenByReadonly(id, state.modalSomenteLeitura));

    if (cancelBtn) {
      if (state.modalSomenteLeitura) {
        cancelBtn.dataset.normalText = cancelBtn.dataset.normalText || cancelBtn.textContent || 'Cancelar';
        cancelBtn.textContent = 'Fechar';
      } else if (cancelBtn.dataset.normalText) {
        cancelBtn.textContent = cancelBtn.dataset.normalText;
      }
    }
  }

  function filtrarCustomFieldsSistema(customFields = {}, options = {}) {
    const clean = {};
    const preservarCamposFormulario = !!options.preservarCamposFormulario;

    Object.entries(customFields || {}).forEach(([key, value]) => {
      const slug = String(key || '').trim();
      if (!slug) return;

      // Na ficha principal, campos como classe, categoria, tipo, marca,
      // fabricante, modelo, setor, responsável e status podem ter o mesmo slug
      // de campos nativos. Eles não podem ser descartados, senão o valor some
      // ao salvar e reabrir.
      if (!preservarCamposFormulario && SYSTEM_FIELD_SLUGS.has(slug)) return;

      clean[slug] = value;
    });

    return clean;
  }

  function limparDestaquesObrigatorios() {
    document
      .querySelectorAll('.campo-obrigatorio-pendente, .is-required-missing')
      .forEach((el) => el.classList.remove('campo-obrigatorio-pendente', 'is-required-missing', 'is-invalid'));

    document
      .querySelectorAll('[aria-invalid="true"].campo-obrigatorio-pendente, [aria-invalid="true"].is-required-missing')
      .forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function marcarCampoObrigatorio(el) {
    if (!el) return;

    const group = el.closest('.form-group, .custom-field-item, .custom-checkbox, .section-card, .custom-section-card');

    el.classList.add('campo-obrigatorio-pendente', 'is-required-missing', 'valora-field-invalid');
    el.setAttribute('aria-invalid', 'true');
    if (group) group.classList.add('campo-obrigatorio-pendente', 'is-required-missing', 'is-invalid');

    setTimeout(() => {
      const target = group || el;
      try {
        target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      } catch (_) {
        target.scrollIntoView?.();
      }

      try {
        el.focus?.({ preventScroll: true });
      } catch (_) {
        el.focus?.();
      }
    }, 140);
  }

  function desativarValidacaoGlobalPatrimonio() {
    // A validação global insere o resumo como primeiro filho do FORM.
    // Como este modal usa grid (sidebar + conteúdo), isso quebra a lateral.
    const form = qs('formPatrimonio');
    const btn = qs('btn-salvar-patrimonio');

    form?.setAttribute('data-skip-valora-validation', 'true');
    btn?.setAttribute('data-skip-valora-validation', 'true');
    btn?.removeAttribute('data-valora-submit');

    form
      ?.querySelectorAll(':scope > .valora-validation-summary')
      .forEach((el) => el.remove());
  }

  function isCampoCustomVazio(el) {
    if (!el) return false;

    const type = String(el.type || '').toLowerCase();

    if (type === 'checkbox') return !el.checked;
    if (type === 'radio' && el.name) {
      const form = el.form || document;
      return !form.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
    }

    return String(el.value ?? '').trim() === '';
  }

  function abrirAbaDoCampoPatrimonio(el) {
    if (!el) return;

    if (el.matches('[data-custom-field]') || el.closest('#tab-patrimonio-ficha')) {
      switchPatrimonioTab('tab-patrimonio-ficha');

      const card = el.closest('.custom-section-card');
      const container = qs('custom-fields-container');

      if (state.usarFichaPrincipal && card && container && state.fichaController?.activateSection) {
        const cards = Array.from(container.querySelectorAll('.custom-section-card'));
        const index = Math.max(0, cards.indexOf(card));
        state.fichaController.activateSection(index);
      }

      return;
    }

    switchPatrimonioTab('tab-patrimonio-dados');
  }

  function setPatrimonioFichaCode(codigo) {
    const value = onlyDigits(codigo);
    const fichaEl = qs('campo-codigo-ficha-principal-patrimonio');
    const nativeEl = qs('patrimonio-codigo');

    if (fichaEl) fichaEl.value = value;
    if (nativeEl) nativeEl.value = value;

    return value;
  }

  function getPatrimonioNativeValues() {
    return {
      codigo: onlyDigits(getValue('patrimonio-codigo') || getValue('campo-codigo-ficha-principal-patrimonio')),
      nome: getValue('patrimonio-nome'),
      descricao: getValue('patrimonio-descricao'),
      categoria: getValue('patrimonio-categoria'),
      marca: getValue('patrimonio-marca'),
      modelo: getValue('patrimonio-modelo'),
      numero_serie: getValue('patrimonio-numero-serie'),
      localizacao: getValue('patrimonio-localizacao'),
      responsavel: getValue('patrimonio-responsavel'),
      status: getValue('patrimonio-status') || 'ativo',
      valor_aquisicao: getValue('patrimonio-valor-aquisicao'),
      data_aquisicao: getValue('patrimonio-data-aquisicao'),
      observacoes: getValue('patrimonio-observacoes'),
      ativo: getValue('patrimonio-ativo') !== 'false',
    };
  }

  function fillPatrimonioNativeFields(item = {}) {
    const codigo = setPatrimonioFichaCode(item.codigo || '');
    setPatrimonioDataCadastro(item.criado_em || item.data_cadastro || item.created_at, !item.id);

    setValue('patrimonio-codigo', codigo);
    setValue('patrimonio-nome', item.nome || '');
    setValue('patrimonio-descricao', item.descricao || '');
    setValue('patrimonio-categoria', item.categoria || '');
    setValue('patrimonio-marca', item.marca || '');
    setValue('patrimonio-modelo', item.modelo || '');
    setValue('patrimonio-numero-serie', item.numero_serie || '');
    setValue('patrimonio-localizacao', item.localizacao || '');
    setValue('patrimonio-responsavel', item.responsavel || '');
    setValue('patrimonio-status', item.status || 'ativo');
    setValue('patrimonio-valor-aquisicao', item.valor_aquisicao || '');
    setValue('patrimonio-data-aquisicao', item.data_aquisicao || '');
    setValue('patrimonio-observacoes', item.observacoes || '');
    setValue('patrimonio-ativo', item.ativo === false ? 'false' : 'true');
  }

  function switchPatrimonioTab(targetId) {
    if (!targetId) return;

    if (state.usarFichaPrincipal) {
      targetId = 'tab-patrimonio-ficha';
    }

    qsa('.patrimonio-tab-btn[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === targetId);
    });

    qsa('.patrimonio-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.id === targetId);
    });
  }

  function focusFirstCustomField() {
    const el = qs('custom-fields-container')?.querySelector('input, select, textarea, button');
    if (!el) return;

    el.focus?.();
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  function focusPatrimonioNome() {
    if (state.usarFichaPrincipal) {
      switchPatrimonioTab('tab-patrimonio-ficha');
      setTimeout(() => focusFirstCustomField(), 80);
      return;
    }

    switchPatrimonioTab('tab-patrimonio-dados');

    setTimeout(() => {
      qs('patrimonio-nome')?.focus?.();
      qs('patrimonio-nome')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function ensureFichaController() {
    if (state.fichaController || !window.ValoraFichaPrincipal?.createTabFichaController) {
      return state.fichaController;
    }

    state.fichaController = window.ValoraFichaPrincipal.createTabFichaController({
      formSelector: '#formPatrimonio',
      tabsSelector: '.patrimonio-tabs',
      tabButtonSelector: '.patrimonio-tab-btn',
      tabPanelSelector: '.patrimonio-tab',
      customTabId: 'tab-patrimonio-ficha',
      customContainerSelector: '#custom-fields-container',
      codeCardSelector: '#patrimonio-ficha-principal-code',
      toggleSelector: '#toggle-ficha-principal-patrimonio',
      normalTabId: 'tab-patrimonio-dados',
      buttonClass: 'patrimonio-tab-btn',
    });

    state.fichaController.bindSectionClicks();
    return state.fichaController;
  }

  function aplicarModoFicha() {
    const controller = ensureFichaController();

    if (controller) {
      controller.setMode(state.usarFichaPrincipal);
      return;
    }

    const form = qs('formPatrimonio');
    const toggle = qs('toggle-ficha-principal-patrimonio');
    const codeCard = qs('patrimonio-ficha-principal-code');

    if (form) form.classList.toggle('is-ficha-principal', !!state.usarFichaPrincipal);
    if (toggle) toggle.checked = !!state.usarFichaPrincipal;
    if (codeCard) codeCard.hidden = !state.usarFichaPrincipal;

    if (state.usarFichaPrincipal) {
      switchPatrimonioTab('tab-patrimonio-ficha');
    }
  }

  function renderFormularioCabecalho() {
    const nomeEl = qs('patrimonio-formulario-nome');
    const descEl = qs('patrimonio-formulario-descricao');
    const descTopEl = qs('patrimonio-formulario-descricao-topo');
    const modelo = state.formulario?.modelo || null;

    const nome = modelo?.nome || 'Ficha do patrimônio';
    const descricao = modelo?.descricao || 'Cadastro completo do patrimônio organizado por seções.';

    if (nomeEl) nomeEl.textContent = nome;
    if (descEl) descEl.textContent = modelo ? descricao : 'Nenhum formulário de patrimônio carregado.';
    if (descTopEl) descTopEl.textContent = modelo ? descricao : 'Crie um formulário para Patrimônio em Configurações > Formulários.';
  }

  async function carregarFormularioPatrimonio({ loadingContainer = null, forceRefresh = false } = {}) {
    const container = loadingContainer || '#custom-fields-container';

    try {
      if (!window.ValoraFichaPrincipal) {
        throw new Error('Componente de ficha principal não carregado.');
      }

      window.ValoraFichaPrincipal.showLoading?.(
        container,
        'Carregando formulário de Patrimônio...',
        'Buscando seções e campos configurados no construtor de formulários.'
      );

      const formulario = await window.ValoraFichaPrincipal.carregarFormularioModulo(MODULO_FORMULARIO, {
        apiJsonImpl: apiJson,
        ativo: true,
        forceRefresh,
        loadingContainer: container,
      });

      state.formulario = formulario;
      state.usarFichaPrincipal = !!formulario?.modelo?.usar_como_ficha_principal;
      renderFormularioCabecalho();
      return formulario;
    } catch (err) {
      console.error('[Patrimônio] erro ao carregar formulário:', err);
      state.formulario = null;
      state.usarFichaPrincipal = false;
      renderFormularioCabecalho();
      throw err;
    }
  }

  async function renderCustomFieldsInputs(values = {}, { forceRefresh = false } = {}) {
    const container = qs('custom-fields-container');
    if (!container) return;

    if (!window.ValoraFichaPrincipal) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          Não foi possível carregar o componente de ficha principal.
        </div>
      `;
      return;
    }

    if (!state.formulario?.modelo || forceRefresh) {
      await carregarFormularioPatrimonio({
        loadingContainer: container,
        forceRefresh,
      });
    }

    window.ValoraFichaPrincipal.renderCustomFormSections({
      container,
      formulario: state.formulario,
      camposAvulsos: [],
      values,
      usarFichaPrincipal: state.usarFichaPrincipal,
      flatTitle: 'Ficha do patrimônio',
      flatDescription: 'Campos extras do cadastro de patrimônio.',
      emptyMessage: state.formulario?.modelo
        ? 'Nenhum campo ativo neste formulário de patrimônio.'
        : 'Nenhum formulário de Patrimônio encontrado. Crie um formulário em Configurações > Formulários.',
    });

    aplicarModoFicha();

    if (!state.usarFichaPrincipal) {
      const activeTab = qs('formPatrimonio')?.querySelector('.patrimonio-tab.active');
      if (!activeTab) switchPatrimonioTab('tab-patrimonio-dados');
    }

    window.ValoraRequired?.refresh?.(container);
    window.ValoraCamposLongos?.enhance?.(container);
  }

  function collectCustomFieldsValues() {
    if (window.ValoraFichaPrincipal?.collectCustomFieldsValues) {
      return window.ValoraFichaPrincipal.collectCustomFieldsValues(qs('formPatrimonio') || document);
    }

    const values = {};

    qsa('[data-custom-field]', qs('formPatrimonio') || document).forEach((el) => {
      const key = String(el.getAttribute('data-custom-field') || '').trim();
      if (!key) return;

      if (el.type === 'checkbox') {
        values[key] = el.checked ? 'true' : 'false';
        return;
      }

      const value = String(el.value ?? '').trim();
      if (value !== '') values[key] = value;
    });

    return values;
  }

  function validarCamposFormulario() {
    desativarValidacaoGlobalPatrimonio();

    const form = qs('formPatrimonio') || document;
    const obrigatorios = Array.from(
      form.querySelectorAll('[data-custom-field][data-required="true"]')
    ).filter((el) => !el.disabled && !el.readOnly);

    const primeiroVazio = obrigatorios.find(isCampoCustomVazio);

    if (!primeiroVazio) return true;

    const label =
      primeiroVazio.dataset.customLabel ||
      primeiroVazio.getAttribute('aria-label') ||
      primeiroVazio.getAttribute('data-custom-field') ||
      'campo obrigatório';

    toast(`Preencha o campo obrigatório: ${label}`, { error: true, ms: 5200 });
    abrirAbaDoCampoPatrimonio(primeiroVazio);
    marcarCampoObrigatorio(primeiroVazio);

    return false;
  }

  async function salvarToggleFichaPrincipalPatrimonio(event) {
    const checked = !!event.target.checked;

    try {
      if (!window.ValoraFichaPrincipal) {
        throw new Error('Componente de ficha principal não carregado.');
      }

      if (!state.formulario?.modelo?.id) {
        await carregarFormularioPatrimonio({ loadingContainer: '#custom-fields-container' });
      }

      const modelo = state.formulario?.modelo;

      if (!modelo?.id) {
        event.target.checked = false;
        toast('Nenhum formulário de Patrimônio encontrado para ativar como ficha principal.', { error: true, ms: 4200 });
        return;
      }

      event.target.disabled = true;
      window.ValoraFichaPrincipal.showLoading?.(
        '#custom-fields-container',
        checked ? 'Montando ficha principal...' : 'Voltando para o cadastro padrão...'
      );

      const valoresAtuais = collectCustomFieldsValues();
      const atualizado = await window.ValoraFichaPrincipal.atualizarFichaPrincipalModelo(modelo, checked, {
        apiJsonImpl: apiJson,
        moduloFallback: MODULO_FORMULARIO,
      });

      state.usarFichaPrincipal = checked;
      state.formulario = {
        ...state.formulario,
        modelo: {
          ...modelo,
          ...(atualizado || {}),
          usar_como_ficha_principal: checked,
        },
      };

      await renderCustomFieldsInputs(valoresAtuais);
      aplicarModoFicha();

      toast(
        checked
          ? 'Ficha principal ativada para Patrimônio.'
          : 'Ficha principal desativada para Patrimônio.',
        { ms: 2200 }
      );
    } catch (err) {
      event.target.checked = !checked;
      toast(err.message || 'Erro ao alterar ficha principal.', { error: true, ms: 4500 });
    } finally {
      event.target.disabled = false;
    }
  }

  function statusLabel(status) {
    const map = {
      ativo: 'Ativo',
      manutencao: 'Em manutenção',
      baixado: 'Baixado',
      extraviado: 'Extraviado',
    };

    return map[status] || status || '-';
  }

  function setLoading(message = 'Carregando patrimônios...') {
    const tbody = qs('patrimonio-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${escapeHtml(message)}</td></tr>`;
  }

  function renderTabela() {
    const tbody = qs('patrimonio-tbody');
    const contador = qs('patrimonio-contador');

    if (!tbody) return;

    if (contador) {
      contador.textContent = `${state.itens.length} ${state.itens.length === 1 ? 'item' : 'itens'}`;
    }

    if (!state.itens.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum patrimônio cadastrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = state.itens.map((item) => `
      <tr>
        <td><span class="badge-codigo">${escapeHtml(item.codigo || '-')}</span></td>
        <td>
          <button
            type="button"
            class="table-name-link"
            data-action="visualizar"
            data-id="${item.id}"
            title="Visualizar patrimônio"
          >
            <strong>${escapeHtml(item.nome || '-')}</strong>
            ${item.marca || item.modelo ? `<small>${escapeHtml([item.marca, item.modelo].filter(Boolean).join(' • '))}</small>` : ''}
          </button>
        </td>
        <td>${escapeHtml(item.categoria || '-')}</td>
        <td>${escapeHtml(item.numero_serie || '-')}</td>
        <td>${escapeHtml(item.localizacao || '-')}</td>
        <td>${escapeHtml(item.responsavel || '-')}</td>
        <td><span class="status-badge status-${escapeHtml(item.status || 'ativo')}">${escapeHtml(statusLabel(item.status))}</span></td>
        <td class="text-right">
          <div>
            <button class="btn-icon" type="button" data-action="editar" data-id="${item.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-icon danger" type="button" data-action="excluir" data-id="${item.id}" title="Excluir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function carregar({ silent = false } = {}) {
    const busca = normalizeText(qs('patrimonio-busca')?.value);
    const status = normalizeText(qs('patrimonio-status-filter')?.value);

    const params = new URLSearchParams();
    if (busca) params.set('busca', busca);
    if (status) params.set('status', status);

    if (!silent) setLoading();

    try {
      const data = await apiJson(`${API_PATRIMONIO}${params.toString() ? `?${params.toString()}` : ''}`);
      state.itens = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      renderTabela();
    } catch (err) {
      console.error(err);
      state.itens = [];
      renderTabela();
      toast(err.message || 'Erro ao carregar patrimônio.', { error: true, ms: 5000 });
    }
  }

  async function obterItem(id) {
    return apiJson(`${API_PATRIMONIO}/${id}`);
  }

  async function salvarItem(payload, editandoId) {
    const url = editandoId == null ? API_PATRIMONIO : `${API_PATRIMONIO}/${editandoId}`;
    const method = editandoId == null ? 'POST' : 'PUT';
    const payloadSeguro = { ...(payload || {}) };

    // Código é do sistema: único, sequencial e imutável.
    // O front apenas mostra, não envia como dado editável.
    delete payloadSeguro.codigo;

    return apiJson(url, {
      method,
      body: JSON.stringify(payloadSeguro),
    });
  }

  async function excluirItem(id) {
    return apiJson(`${API_PATRIMONIO}/${id}`, { method: 'DELETE' });
  }

  async function resetForm(item = null) {
    state.editandoId = item?.id ?? null;
    state.detalheAtual = item || null;

    const titulo = qs('modal-patrimonio-title');
    if (titulo) titulo.textContent = item ? 'Editar patrimônio' : 'Novo patrimônio';

    setValue('patrimonio-id', item?.id || '');
    fillPatrimonioNativeFields(item || { ativo: true, status: 'ativo' });

    if (!item) {
      const proximoCodigo = await carregarProximoCodigoPatrimonio();
      setPatrimonioFichaCode(proximoCodigo);
    }

    const btnExcluir = qs('btn-excluir-patrimonio');
    if (btnExcluir) btnExcluir.style.display = item ? '' : 'none';

    const values = item ? buildCustomValuesFromPatrimonio(item) : buildCustomValuesNovo();

    try {
      await renderCustomFieldsInputs(values);
    } catch (err) {
      const container = qs('custom-fields-container');
      if (container) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column:1 / -1;">
            ${escapeHtml(err.message || 'Erro ao carregar formulário de patrimônio.')}
          </div>
        `;
      }
      aplicarModoFicha();
    }
  }

  function buildPayload() {
    const customFields = collectCustomFieldsValues();
    const nativeFields = getPatrimonioNativeValues();
    const customFallback = buildPatrimonioBaseFromCustom(customFields, state.detalheAtual || {});

    const base = state.usarFichaPrincipal
      ? {
          ...customFallback,
          codigo: onlyDigits(customFallback.codigo || nativeFields.codigo || ''),
        }
      : {
          ...customFallback,
          ...nativeFields,
          nome: nativeFields.nome || customFallback.nome || '',
          descricao: nativeFields.descricao || customFallback.descricao || '',
          categoria: nativeFields.categoria || customFallback.categoria || '',
          marca: nativeFields.marca || customFallback.marca || '',
          modelo: nativeFields.modelo || customFallback.modelo || '',
          numero_serie: nativeFields.numero_serie || customFallback.numero_serie || '',
          localizacao: nativeFields.localizacao || customFallback.localizacao || '',
          responsavel: nativeFields.responsavel || customFallback.responsavel || '',
          status: nativeFields.status || customFallback.status || 'ativo',
          valor_aquisicao: nativeFields.valor_aquisicao || customFallback.valor_aquisicao || '',
          data_aquisicao: nativeFields.data_aquisicao || customFallback.data_aquisicao || '',
          observacoes: nativeFields.observacoes || customFallback.observacoes || '',
        };

    return {
      ...base,
      codigo: state.editandoId ? onlyDigits(base.codigo) : '',
      custom_fields: filtrarCustomFieldsSistema(customFields, { preservarCamposFormulario: true }),
    };
  }

  async function abrirNovo() {
    setPatrimonioModalReadonly(false);
    await resetForm(null);
    openModal('modal-patrimonio');

    setTimeout(() => {
      if (state.usarFichaPrincipal) {
        switchPatrimonioTab('tab-patrimonio-ficha');
        focusFirstCustomField();
      } else {
        switchPatrimonioTab('tab-patrimonio-dados');
        focusPatrimonioNome();
      }
    }, 120);
  }

  async function editar(id) {
    setPatrimonioModalReadonly(false);
    try {
      const item = await obterItem(id);
      await resetForm(item);
      openModal('modal-patrimonio');
      setPatrimonioModalReadonly(false);

      setTimeout(() => {
        switchPatrimonioTab(state.usarFichaPrincipal ? 'tab-patrimonio-ficha' : 'tab-patrimonio-dados');
      }, 80);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao abrir patrimônio.', { error: true, ms: 4200 });
    }
  }


  async function visualizar(id) {
    try {
      const item = await obterItem(id);
      await resetForm(item);

      const titulo = qs('modal-patrimonio-title');
      if (titulo) titulo.textContent = 'Visualizar patrimônio';

      openModal('modal-patrimonio');
      setPatrimonioModalReadonly(true);

      setTimeout(() => {
        switchPatrimonioTab(state.usarFichaPrincipal ? 'tab-patrimonio-ficha' : 'tab-patrimonio-dados');
      }, 80);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao visualizar patrimônio.', { error: true, ms: 4200 });
    }
  }

  async function salvar() {
    if (state.modalSomenteLeitura) {
      toast('Este patrimônio está aberto apenas para visualização.', { error: true, ms: 3000 });
      return;
    }

    desativarValidacaoGlobalPatrimonio();
    limparDestaquesObrigatorios();

    const payload = buildPayload();

    if (!payload.nome) {
      toast(
        state.usarFichaPrincipal
          ? 'Preencha no formulário um campo de identificação/nome do patrimônio.'
          : 'Informe o nome do patrimônio.',
        { error: true, ms: 4200 }
      );

      if (state.usarFichaPrincipal) {
        switchPatrimonioTab('tab-patrimonio-ficha');
        setTimeout(() => {
          const first = qs('formPatrimonio')?.querySelector('[data-custom-field]:not([disabled])');
          if (first) marcarCampoObrigatorio(first);
          else focusFirstCustomField();
        }, 80);
      } else {
        marcarCampoObrigatorio(qs('patrimonio-nome'));
        focusPatrimonioNome();
      }

      return;
    }

    if (!validarCamposFormulario()) return;

    const btn = qs('btn-salvar-patrimonio');
    const original = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      }

      await salvarItem(payload, state.editandoId);
      closeModal('modal-patrimonio');
      await carregar({ silent: true });
      toast('Patrimônio salvo com sucesso.', { ms: 1800 });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar patrimônio.', { error: true, ms: 5000 });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original || '<i class="fa-solid fa-floppy-disk"></i> Salvar patrimônio';
      }
    }
  }

  async function excluir(id = null) {
    const itemId = id || state.editandoId || qs('patrimonio-id')?.value;
    if (!itemId) return;

    if (!confirm('Excluir este patrimônio?')) return;

    const btn = qs('btn-excluir-patrimonio');
    if (btn) btn.disabled = true;

    try {
      await excluirItem(itemId);
      closeModal('modal-patrimonio');
      await carregar({ silent: true });
      toast('Patrimônio excluído.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir patrimônio.', { error: true, ms: 4200 });
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    desativarValidacaoGlobalPatrimonio();

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.closeModal === 'modal-patrimonio') setPatrimonioModalReadonly(false);
        closeModal(btn.dataset.closeModal);
      });
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('mousedown', (event) => {
        if (event.target === modal) {
          if (modal.id === 'modal-patrimonio') setPatrimonioModalReadonly(false);
          closeModal(modal.id);
        }
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setPatrimonioModalReadonly(false);
        closeModal('modal-patrimonio');
      }
    });

    document.addEventListener('click', (event) => {
      const btnTab = event.target.closest('.patrimonio-tab-btn[data-tab]');
      if (btnTab) {
        switchPatrimonioTab(btnTab.dataset.tab);
        return;
      }

      const btnVisualizar = event.target.closest('[data-action="visualizar"][data-id]');
      if (btnVisualizar?.dataset?.id) {
        visualizar(btnVisualizar.dataset.id);
        return;
      }

      const btnEditar = event.target.closest('[data-action="editar"][data-id]');
      if (btnEditar?.dataset?.id) {
        editar(btnEditar.dataset.id);
        return;
      }

      const btnExcluir = event.target.closest('[data-action="excluir"][data-id]');
      if (btnExcluir?.dataset?.id) {
        excluir(btnExcluir.dataset.id);
      }
    });

    qs('btn-novo-patrimonio')?.addEventListener('click', (event) => {
      event.preventDefault();
      abrirNovo();
    });

    qs('btn-atualizar-patrimonio')?.addEventListener('click', () => carregar());
    qs('btn-salvar-patrimonio')?.addEventListener('click', salvar);
    qs('btn-excluir-patrimonio')?.addEventListener('click', () => excluir());
    qs('btn-cancelar-patrimonio')?.addEventListener('click', () => {
      setPatrimonioModalReadonly(false);
      closeModal('modal-patrimonio');
    });

    qs('btn-gerenciar-formulario-patrimonio')?.addEventListener('click', () => {
      window.location.href = '/formularios?modulo=patrimonio';
    });

    qs('toggle-ficha-principal-patrimonio')?.addEventListener('change', salvarToggleFichaPrincipalPatrimonio);

    qs('patrimonio-codigo')?.addEventListener('input', (event) => {
      const value = onlyDigits(event.target.value);
      event.target.value = value;
      setPatrimonioFichaCode(value);
    });

    qs('campo-codigo-ficha-principal-patrimonio')?.addEventListener('input', (event) => {
      const value = onlyDigits(event.target.value);
      event.target.value = value;
      setPatrimonioFichaCode(value);
    });

    qs('patrimonio-busca')?.addEventListener('input', () => {
      clearTimeout(state.buscaTimer);
      state.buscaTimer = setTimeout(() => carregar(), 300);
    });

    qs('patrimonio-status-filter')?.addEventListener('change', () => carregar());
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bind();
    desativarValidacaoGlobalPatrimonio();

    try {
      await carregarFormularioPatrimonio({ loadingContainer: '#custom-fields-container' });
      await renderCustomFieldsInputs({});
    } catch (_) {
      aplicarModoFicha();
    }

    await carregar();
  });
})();
