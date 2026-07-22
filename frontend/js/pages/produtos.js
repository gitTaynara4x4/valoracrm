// /frontend/js/pages/produtos.js
// Produtos | Valora CRM
// Modal padrão Clientes + campos nativos + campos vindos do construtor de Formulários.

(() => {
  'use strict';

  const API_PRODUTOS = '/api/produtos';
  const MODULO_FORMULARIO = 'produtos';
  const ATUALIZACAO_PRECOS_LIMITE_PAGINA = 25;
  const ATUALIZACAO_PRECOS_COLUNAS_STORAGE = 'valora:produtos:atualizacao-precos:colunas-v1';

  const SYSTEM_FIELD_SLUGS = new Set([
    'codigo',
    'cod_ref_id',
    'cod_ref',
    'codigo_referencia',
    'codigo_barras',
    'nome',
    'produto',
    'nome_produto',
    'nome_do_produto',
    'identificacao_do_produto',
    'identificacao_produto',
    'nome_generico',
    'descricao',
    'descricao_do_produto',
    'descricao_produto',
    'descricao_curta',
    'observacoes',
    'observacao',
    'categoria',
    'categorias',
    'classe',
    'grupo',
    'familia',
    'unidade',
    'unidade_medida',
    'preco_venda',
    'valor_de_venda',
    'custo',
    'valor_de_custo',
    'custo_efetivo',
    'estoque_atual',
    'quantidade_atual',
    'qtd_atual',
    'estoque',
    'ativo',
    'status',
    'status_atual',
    'situacao',
    'data_cadastro',
  ]);

  let produtos = [];
  let produtosPage = { offset: 0, limit: 50, total: 0, hasMore: false };
  let produtoEditandoId = null;
  let formularioProdutos = null;
  let usarFichaPrincipalProdutos = false;
  let fichaProdutoController = null;
  let produtoAtualDetalhe = null;
  let produtoModalSomenteLeitura = false;

  let atualizacaoPrecosMeta = null;
  let atualizacaoPrecosItens = [];
  let atualizacaoPrecosPage = { offset: 0, limit: ATUALIZACAO_PRECOS_LIMITE_PAGINA, total: 0, hasMore: false };
  let alteracoesPrecos = new Map();
  let podeEditarPrecos = false;
  let telaPrecosAberta = false;
  let atualizacaoPrecosBuscaTimer = null;
  let atualizacaoPrecosColunasTimer = null;
  let atualizacaoPrecosRequestController = null;
  let atualizacaoPrecosRequestId = 0;
  let atualizacaoPrecosResumoFrame = null;
  let colunasPrecosVisiveis = new Set();

  async function syncAgendaProduto(produto = null, readonly = false) {
    try {
      const agenda = await window.ValoraAgendaReady;
      await agenda?.setEntityContext?.({
        containerId: 'agenda-produto',
        entidadeTipo: 'produto',
        entidadeId: Number(produto?.id || 0) || null,
        entidadeNome: String(produto?.nome || produto?.descricao || 'Produto'),
        readonly: !!readonly,
      });
    } catch (error) {
      console.warn('[Produtos] agenda indisponível:', error);
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
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

  function setProdutoDataCadastro(dataCadastro, usarHoje = false) {
    const raw = dataCadastro || (usarHoje ? new Date().toISOString() : '');
    setValue('campo-data-cadastro-ficha-principal-produto', formatarDataCadastroSistema(raw));
  }

  function toast(message, options = {}) {
    const error = typeof options === 'boolean' ? options : !!options.error;
    const ms = typeof options === 'object' && options.ms ? Number(options.ms) : 2600;

    if (typeof window.showToast === 'function') {
      window.showToast(message, error ? 'error' : 'success');
      return;
    }

    const el = $('valora-toast');

    if (!el) {
      alert(message);
      return;
    }

    el.textContent = message || '';
    el.classList.toggle('is-error', error);
    el.classList.add('show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      el.classList.remove('show');
    }, ms);
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

    const text = await resp.text();

    if (!resp.ok) {
      let message = text || 'Erro na requisição.';

      try {
        const parsed = JSON.parse(text);
        message = parsed.detail || parsed.message || message;
      } catch (_) {}

      throw new Error(typeof message === 'string' ? message : 'Erro na requisição.');
    }

    if (!text || resp.status === 204) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  async function carregarProximoCodigoProduto() {
    try {
      const data = await apiJson(`${API_PRODUTOS}/proximo-codigo`);
      return onlyDigits(data?.codigo || '');
    } catch (err) {
      console.warn('[Produtos] não foi possível carregar próximo código:', err);
      return '';
    }
  }

  function openModal(id) {
    if (window.ValoraModal) {
      return window.ValoraModal.open(id);
    }

    const modal = $(id);
    if (!modal) return;

    modal.hidden = false;
    modal.style.display = 'flex';

    requestAnimationFrame(() => {
      modal.classList.add('show');
    });
  }

  function closeModal(id) {
    if (window.ValoraModal) {
      return window.ValoraModal.close(id);
    }

    const modal = $(id);
    if (!modal) return;

    modal.classList.remove('show');

    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';
    }, 160);
  }

  function normalizeCustomFields(value) {
    if (!value) return {};

    if (typeof value === 'object' && !Array.isArray(value)) {
      return { ...value };
    }

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

  function filtrarCustomFieldsSistema(customFields = {}, options = {}) {
    const clean = {};
    const preservarCamposFormulario = !!options.preservarCamposFormulario;

    Object.entries(customFields || {}).forEach(([key, value]) => {
      const slug = String(key || '').trim();
      if (!slug) return;

      // Quando o valor veio do formulário/ficha principal, ele precisa ser salvo
      // exatamente no slug do campo, mesmo que o slug tenha nome parecido com
      // campo nativo do sistema, como classe, categoria, grupo, marca, unidade,
      // situação, preço, custo etc.
      // O filtro antigo removia esses slugs e fazia o campo voltar para
      // "Selecione" ao reabrir o cadastro.
      if (!preservarCamposFormulario && SYSTEM_FIELD_SLUGS.has(slug)) return;

      clean[slug] = value;
    });

    return clean;
  }

  function limparDestaquesObrigatorios() {
    document
      .querySelectorAll('.campo-obrigatorio-pendente, .is-required-missing')
      .forEach((el) => el.classList.remove('campo-obrigatorio-pendente', 'is-required-missing'));
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

  function desativarValidacaoGlobalProduto() {
    // A validação global insere o resumo como primeiro filho do FORM.
    // Como este modal usa grid (sidebar + conteúdo), isso quebrava o layout
    // e deixava os campos obrigatórios espremidos no canto esquerdo.
    const form = $('formProduto');
    const btn = $('btn-salvar-produto');

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

  function abrirAbaDoCampoProduto(el) {
    if (!el) return;

    if (el.matches('[data-custom-field]') || el.closest('#tab-produto-ficha')) {
      switchProdutoTab('tab-produto-ficha');

      const card = el.closest('.custom-section-card');
      const container = $('custom-fields-container');

      if (usarFichaPrincipalProdutos && card && container && fichaProdutoController?.activateSection) {
        const cards = Array.from(container.querySelectorAll('.custom-section-card'));
        const index = Math.max(0, cards.indexOf(card));
        fichaProdutoController.activateSection(index);
      }

      return;
    }

    switchProdutoTab('tab-produto-dados');
  }

  function getCustomValue(custom, keys, fallback = '') {
    const data = normalizeCustomFields(custom);

    for (const key of keys) {
      const value = data?.[key];

      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }

    return fallback;
  }

  function firstUsefulCustomValue(custom) {
    const data = normalizeCustomFields(custom);
    const blocked = new Set([
      'data_cadastro',
      'status_atual',
      'ativo',
      'codigo',
      'cod_ref_id',
      'codigo_barras',
      'quantidade_atual',
      'estoque_atual',
      'preco_venda',
      'valor_de_custo',
      'custo',
    ]);

    for (const [key, value] of Object.entries(data)) {
      if (blocked.has(String(key))) continue;
      const text = String(value ?? '').trim();
      if (text && !/^true|false$/i.test(text) && text.length >= 2) return text;
    }

    return '';
  }

  function buildProdutoBaseFromCustom(customFields, fallback = {}) {
    const custom = normalizeCustomFields(customFields);

    const nome = getCustomValue(custom, [
      'nome',
      'produto',
      'nome_produto',
      'nome_do_produto',
      'identificacao_do_produto',
      'identificacao_produto',
      'nome_generico',
      'descricao_curta',
      'titulo',
    ], fallback.nome || '') || firstUsefulCustomValue(custom);

    const descricao = getCustomValue(custom, [
      'descricao',
      'descricao_do_produto',
      'descricao_produto',
      'observacoes',
      'observacao',
      'detalhes',
    ], fallback.descricao || '');

    const categoria = getCustomValue(custom, [
      'categoria',
      'categorias',
      'classe',
      'grupo',
      'familia',
    ], fallback.categoria || '');

    const unidade = getCustomValue(custom, [
      'unidade',
      'tipo_medida',
      'medida',
      'unidade_medida',
    ], fallback.unidade || '');

    const precoVenda = getCustomValue(custom, [
      'preco_venda',
      'preco_final_venda_tabela_01',
      'preco_final',
      'valor_venda',
      'venda',
    ], fallback.preco_venda || '');

    const custo = getCustomValue(custom, [
      'custo',
      'valor_de_custo',
      'custo_efetivo',
      'preco_custo',
    ], fallback.custo || '');

    const estoqueAtual = getCustomValue(custom, [
      'estoque_atual',
      'quantidade_atual',
      'qtd_atual',
      'estoque',
    ], fallback.estoque_atual || '');

    const statusAtual = String(getCustomValue(custom, [
      'status_atual',
      'situacao',
      'status',
    ], fallback.ativo === false ? 'inativo' : '')).toLowerCase();

    const ativo = !['inativo', 'bloqueado', 'descontinuado', 'fora de linha', 'fora_de_linha'].includes(statusAtual);

    return {
      codigo: onlyDigits(fallback.codigo || $('campo-codigo-ficha-principal-produto')?.value || ''),
      nome,
      descricao,
      categoria,
      unidade,
      preco_venda: precoVenda,
      custo,
      estoque_atual: estoqueAtual,
      ativo,
    };
  }

  function preencherAliasesCustomProduto(custom, aliases = [], value = '') {
    const text = String(value ?? '').trim();
    if (!text) return;

    aliases.forEach((slug) => {
      if (!slug) return;
      if (custom[slug] === undefined || custom[slug] === null || String(custom[slug]).trim() === '') {
        custom[slug] = text;
      }
    });
  }

  function buildCustomValuesFromProduto(produto = {}) {
    const custom = normalizeCustomFields(produto.custom_fields);
    custom.data_cadastro = produto.data_cadastro || produto.criado_em || produto.created_at || custom.data_cadastro || '';

    preencherAliasesCustomProduto(custom, [
      'nome',
      'produto',
      'nome_produto',
      'nome_do_produto',
      'identificacao_do_produto',
      'identificacao_produto',
      'nome_generico',
      'descricao_curta',
      'titulo',
    ], produto.nome);

    preencherAliasesCustomProduto(custom, [
      'descricao',
      'descricao_do_produto',
      'descricao_produto',
      'observacoes',
      'observacao',
      'detalhes',
    ], produto.descricao);

    preencherAliasesCustomProduto(custom, [
      'categoria',
      'categorias',
      'classe',
      'grupo',
      'familia',
    ], produto.categoria);

    preencherAliasesCustomProduto(custom, [
      'unidade',
      'tipo_medida',
      'medida',
      'unidade_medida',
    ], produto.unidade);

    preencherAliasesCustomProduto(custom, [
      'preco_venda',
      'preco_final_venda_tabela_01',
      'preco_final',
      'valor_venda',
      'valor_de_venda',
      'venda',
    ], produto.preco_venda);

    preencherAliasesCustomProduto(custom, [
      'custo',
      'valor_de_custo',
      'custo_efetivo',
      'preco_custo',
    ], produto.custo);

    preencherAliasesCustomProduto(custom, [
      'estoque_atual',
      'quantidade_atual',
      'qtd_atual',
      'estoque',
    ], produto.estoque_atual);

    const statusFallback = produto.ativo === false ? 'inativo' : produto.ativo === true ? 'ativo' : '';
    preencherAliasesCustomProduto(custom, [
      'status',
      'status_atual',
      'situacao',
    ], statusFallback);

    return custom;
  }

  function buildCustomValuesNovoProduto() {
    return {
      data_cadastro: todayISO(),
    };
  }

  function setProdutoFichaCode(codigo) {
    const value = onlyDigits(codigo);

    const fichaEl = $('campo-codigo-ficha-principal-produto');
    const nativeEl = $('campo-codigo-produto');

    if (fichaEl) fichaEl.value = value;
    if (nativeEl) nativeEl.value = value;

    return value;
  }

  function setValue(id, value = '') {
    const el = $(id);
    if (!el) return;
    el.value = value ?? '';
  }

  function getValue(id) {
    return String($(id)?.value ?? '').trim();
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
    const el = $(id);
    if (!el) return;

    if (enabled) {
      if (el.dataset.readonlyTouchedHidden !== 'true') {
        el.dataset.readonlyTouchedHidden = 'true';
        el.dataset.readonlyWasHidden = el.hidden ? 'true' : 'false';
      }
      el.hidden = true;
      el.style.display = 'none';
      return;
    }

    if (el.dataset.readonlyTouchedHidden === 'true') {
      el.hidden = el.dataset.readonlyWasHidden === 'true';
      el.style.display = '';
      delete el.dataset.readonlyTouchedHidden;
      delete el.dataset.readonlyWasHidden;
    }
  }

  function setProdutoModalReadonly(enabled) {
    produtoModalSomenteLeitura = !!enabled;

    const backdrop = $('modal-produto-backdrop');
    const form = $('formProduto');
    const cancelBtn = $('btn-cancelar-produto');

    backdrop?.classList.toggle('modal-readonly', produtoModalSomenteLeitura);
    form?.classList.toggle('modal-readonly-form', produtoModalSomenteLeitura);

    if (form) {
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        if (produtoModalSomenteLeitura) applyReadonlyElement(el);
        else restoreReadonlyElement(el);
      });
    }

    [
      'btn-salvar-produto',
      'btn-atualizar-formulario-produto',
    ].forEach((id) => setHiddenByReadonly(id, produtoModalSomenteLeitura));

    if (cancelBtn) {
      if (produtoModalSomenteLeitura) {
        cancelBtn.dataset.normalText = cancelBtn.dataset.normalText || cancelBtn.textContent || 'Cancelar';
        cancelBtn.textContent = 'Fechar';
      } else if (cancelBtn.dataset.normalText) {
        cancelBtn.textContent = cancelBtn.dataset.normalText;
      }
    }
  }

  function getProdutoNativeValues() {
    return {
      codigo: onlyDigits(getValue('campo-codigo-produto') || getValue('campo-codigo-ficha-principal-produto')),
      nome: getValue('campo-nome-produto'),
      descricao: getValue('campo-descricao-produto'),
      categoria: getValue('campo-categoria-produto'),
      unidade: getValue('campo-unidade-produto'),
      preco_venda: getValue('campo-preco-venda-produto'),
      custo: getValue('campo-custo-produto'),
      estoque_atual: getValue('campo-estoque-atual-produto'),
      ativo: getValue('campo-ativo-produto') !== 'false',
    };
  }

  function fillProdutoNativeFields(produto = {}) {
    const codigo = setProdutoFichaCode(produto.codigo || '');
    setProdutoDataCadastro(produto.criado_em || produto.data_cadastro || produto.created_at, !produto.id);

    setValue('campo-codigo-produto', codigo);
    setValue('campo-nome-produto', produto.nome || '');
    setValue('campo-descricao-produto', produto.descricao || '');
    setValue('campo-categoria-produto', produto.categoria || '');
    setValue('campo-unidade-produto', produto.unidade || '');
    setValue('campo-preco-venda-produto', produto.preco_venda || '');
    setValue('campo-custo-produto', produto.custo || '');
    setValue('campo-estoque-atual-produto', produto.estoque_atual || '');
    setValue('campo-ativo-produto', produto.ativo === false ? 'false' : 'true');
  }

  function focusProdutoNativeNome() {
    if (usarFichaPrincipalProdutos) {
      switchProdutoTab('tab-produto-ficha');
      setTimeout(() => focusFirstCustomField(), 80);
      return;
    }

    const el = $('campo-nome-produto');
    if (!el) return;

    switchProdutoTab('tab-produto-dados');

    setTimeout(() => {
      el.focus?.();
      el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 80);
  }

  function switchProdutoTab(targetId) {
    if (!targetId) return;

    const targetPanel = document.getElementById(targetId);
    const keepTab = targetPanel?.dataset.fichaKeep === 'true';
    if (usarFichaPrincipalProdutos && !keepTab) {
      targetId = 'tab-produto-ficha';
    }

    $$('.produto-tab-btn[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === targetId);
    });

    $$('.produto-tab').forEach((tab) => {
      tab.classList.toggle('active', tab.id === targetId);
    });
  }

  function ensureFichaProdutoController() {
    if (fichaProdutoController || !window.ValoraFichaPrincipal?.createTabFichaController) {
      return fichaProdutoController;
    }

    fichaProdutoController = window.ValoraFichaPrincipal.createTabFichaController({
      formSelector: '#formProduto',
      tabsSelector: '.produto-tabs',
      tabButtonSelector: '.produto-tab-btn',
      tabPanelSelector: '.produto-tab',
      customTabId: 'tab-produto-ficha',
      customContainerSelector: '#custom-fields-container',
      codeCardSelector: '#produto-ficha-principal-code',
      toggleSelector: '#toggle-ficha-principal-produto',
      normalTabId: 'tab-produto-dados',
      buttonClass: 'produto-tab-btn',
    });

    fichaProdutoController.bindSectionClicks();
    return fichaProdutoController;
  }

  function aplicarModoFichaProduto() {
    const controller = ensureFichaProdutoController();

    if (controller) {
      controller.setMode(usarFichaPrincipalProdutos);
      return;
    }

    const form = $('formProduto');
    const toggle = $('toggle-ficha-principal-produto');
    const codeCard = $('produto-ficha-principal-code');

    if (form) form.classList.toggle('is-ficha-principal', !!usarFichaPrincipalProdutos);
    if (toggle) toggle.checked = !!usarFichaPrincipalProdutos;
    if (codeCard) codeCard.hidden = !usarFichaPrincipalProdutos;

    if (usarFichaPrincipalProdutos) {
      switchProdutoTab('tab-produto-ficha');
    }
  }

  function renderFormularioCabecalho() {
    const nomeEl = $('produto-formulario-nome');
    const descEl = $('produto-formulario-descricao');
    const descTopEl = $('produto-formulario-descricao-topo');
    const modelo = formularioProdutos?.modelo || null;

    const nome = modelo?.nome || 'Ficha do produto';
    const descricao = modelo?.descricao || 'Cadastro completo do produto organizado por seções.';

    if (nomeEl) nomeEl.textContent = nome;
    if (descEl) descEl.textContent = modelo ? descricao : 'Nenhum formulário de produtos carregado.';
    if (descTopEl) descTopEl.textContent = modelo ? descricao : 'Crie um formulário para Produtos em Configurações > Formulários.';
  }

  async function carregarFormularioProdutos({ loadingContainer = null, forceRefresh = false } = {}) {
    const container = loadingContainer || '#custom-fields-container';

    try {
      if (!window.ValoraFichaPrincipal) {
        throw new Error('Componente de ficha principal não carregado.');
      }

      window.ValoraFichaPrincipal.showLoading?.(
        container,
        'Carregando formulário de Produtos...',
        'Buscando seções e campos configurados no construtor de formulários.'
      );

      const formulario = await window.ValoraFichaPrincipal.carregarFormularioModulo(MODULO_FORMULARIO, {
        apiJsonImpl: apiJson,
        ativo: true,
        forceRefresh,
        loadingContainer: container,
      });

      formularioProdutos = formulario;
      usarFichaPrincipalProdutos = !!formulario?.modelo?.usar_como_ficha_principal;

      renderFormularioCabecalho();
      return formulario;
    } catch (err) {
      console.error('[Produtos] erro ao carregar formulário:', err);
      formularioProdutos = null;
      usarFichaPrincipalProdutos = false;
      renderFormularioCabecalho();
      throw err;
    }
  }

  async function renderCustomFieldsInputs(values = {}, { forceRefresh = false } = {}) {
    const container = $('custom-fields-container');
    if (!container) return;

    if (!window.ValoraFichaPrincipal) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          Não foi possível carregar o componente de ficha principal.
        </div>
      `;
      return;
    }

    if (!formularioProdutos?.modelo || forceRefresh) {
      await carregarFormularioProdutos({
        loadingContainer: container,
        forceRefresh,
      });
    }

    window.ValoraFichaPrincipal.renderCustomFormSections({
      container,
      formulario: formularioProdutos,
      camposAvulsos: [],
      values,
      usarFichaPrincipal: usarFichaPrincipalProdutos,
      flatTitle: 'Ficha do produto',
      flatDescription: 'Campos extras do cadastro de produtos.',
      emptyMessage: formularioProdutos?.modelo
        ? 'Nenhum campo ativo neste formulário de produtos.'
        : 'Nenhum formulário de Produtos encontrado. Crie um formulário em Configurações > Formulários.',
    });

    aplicarModoFichaProduto();

    if (!usarFichaPrincipalProdutos) {
      const activeTab = $('formProduto')?.querySelector('.produto-tab.active');
      if (!activeTab) {
        switchProdutoTab('tab-produto-dados');
      }
    }

    if (window.ValoraRequired?.refresh) {
      window.ValoraRequired.refresh(container);
    }
  }

  function collectCustomFieldsValues() {
    if (window.ValoraFichaPrincipal?.collectCustomFieldsValues) {
      return window.ValoraFichaPrincipal.collectCustomFieldsValues($('formProduto') || document);
    }

    const values = {};

    $$('[data-custom-field]', $('formProduto') || document).forEach((el) => {
      const key = el.getAttribute('data-custom-field');
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

  function focusFirstCustomField() {
    const first = $('formProduto')?.querySelector('[data-custom-field]:not([disabled])');
    first?.focus?.();
    first?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }

  function validarCamposFormulario() {
    desativarValidacaoGlobalProduto();

    const form = $('formProduto') || document;
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
    abrirAbaDoCampoProduto(primeiroVazio);
    marcarCampoObrigatorio(primeiroVazio);

    return false;
  }

  async function salvarToggleFichaPrincipalProduto(event) {
    const checked = !!event.target.checked;

    try {
      if (!window.ValoraFichaPrincipal) {
        throw new Error('Componente de ficha principal não carregado.');
      }

      if (!formularioProdutos?.modelo?.id) {
        await carregarFormularioProdutos({ loadingContainer: '#custom-fields-container' });
      }

      const modelo = formularioProdutos?.modelo;

      if (!modelo?.id) {
        event.target.checked = false;
        toast('Nenhum formulário de Produtos encontrado para ativar como ficha principal.', {
          error: true,
          ms: 4200,
        });
        return;
      }

      event.target.disabled = true;

      const valoresAtuais = collectCustomFieldsValues();

      window.ValoraFichaPrincipal.showLoading?.(
        '#custom-fields-container',
        checked ? 'Montando ficha principal...' : 'Voltando para o cadastro padrão...'
      );

      const atualizado = await window.ValoraFichaPrincipal.atualizarFichaPrincipalModelo(modelo, checked, {
        apiJsonImpl: apiJson,
        moduloFallback: MODULO_FORMULARIO,
      });

      usarFichaPrincipalProdutos = checked;
      formularioProdutos = {
        ...formularioProdutos,
        modelo: {
          ...modelo,
          ...(atualizado || {}),
          usar_como_ficha_principal: checked,
        },
      };

      await renderCustomFieldsInputs(valoresAtuais);
      aplicarModoFichaProduto();

      toast(
        checked
          ? 'Ficha principal ativada para Produtos.'
          : 'Ficha principal desativada para Produtos.',
        { ms: 2200 }
      );
    } catch (err) {
      event.target.checked = !checked;
      toast(err.message || 'Erro ao alterar ficha principal.', {
        error: true,
        ms: 4500,
      });
    } finally {
      event.target.disabled = false;
    }
  }

  function montarUrlProdutos({ offset = produtosPage.offset || 0, limit = produtosPage.limit || 50 } = {}) {
    const params = new URLSearchParams();
    const busca = String($('busca-produtos')?.value || '').trim();
    const categoria = String($('filtro-categoria-produtos')?.value || '').trim();
    const ativo = String($('filtro-ativo-produtos')?.value || '').trim();

    params.set('paginated', 'true');
    params.set('limit', String(limit));
    params.set('offset', String(offset));

    if (busca) params.set('busca', busca);
    if (categoria) params.set('categoria', categoria);
    if (ativo) params.set('ativo', ativo);

    window.ValoraLocalizarPersonalizado?.addParams?.(params, 'localizar-personalizado-produtos');

    return `${API_PRODUTOS}?${params.toString()}`;
  }

  function setProdutosLoading(message = 'Buscando produtos no banco...') {
    const tbody = $('tbody-produtos');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="${Math.max(1, getColunasOrdenadasProdutos().length)}" class="empty-state" style="border:none; text-align:center;">
          ${escapeHtml(message)}
        </td>
      </tr>
    `;
  }

  async function carregarProdutos({ offset = produtosPage.offset || 0, silent = false } = {}) {
    try {
      if (!silent) setProdutosLoading();

      const data = await apiJson(montarUrlProdutos({ offset }));

      if (Array.isArray(data)) {
        produtos = data;
        produtosPage = {
          offset: 0,
          limit: data.length || 50,
          total: data.length,
          hasMore: false,
        };
      } else {
        produtos = Array.isArray(data?.items) ? data.items : [];
        produtosPage = {
          offset: Number(data?.offset || 0),
          limit: Number(data?.limit || 50),
          total: Number(data?.total || produtos.length),
          hasMore: !!data?.has_more,
        };
      }
    } catch (err) {
      produtos = [];
      toast(err.message || 'Erro ao carregar produtos.', { error: true, ms: 4200 });
    }

    renderTabelaProdutos();
  }

  async function obterProdutoNoServidor(id) {
    return apiJson(`${API_PRODUTOS}/${id}`);
  }

  async function salvarProdutoNoServidor(payload, editandoId) {
    const url = editandoId == null ? API_PRODUTOS : `${API_PRODUTOS}/${editandoId}`;
    const method = editandoId == null ? 'POST' : 'PUT';

    const cleanPayload = {
      ...(payload || {}),
      custom_fields: normalizeCustomFields(payload?.custom_fields || {}),
    };

    // Código é do sistema: aparece na tela, mas não é editável nem confiável no payload.
    delete cleanPayload.codigo;

    return apiJson(url, {
      method,
      body: JSON.stringify(cleanPayload),
    });
  }

  async function excluirProdutoNoServidor(id) {
    return apiJson(`${API_PRODUTOS}/${id}`, {
      method: 'DELETE',
    });
  }

  function formatCurrency(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '-';
    const normalized = raw.replace(/R\$/gi, '').replace(/\./g, '').replace(',', '.').trim();
    const n = Number(normalized);
    if (!Number.isFinite(n)) return raw;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  const DEFAULT_NATIVE_COLUMNS_PRODUTOS = [
    { key: 'codigo', label: 'Código' },
    { key: 'produto', label: 'Produto' },
    { key: 'categoria', label: 'Categoria' },
    { key: 'preco', label: 'Preço' },
    { key: 'estoque', label: 'Estoque' },
    { key: 'acoes', label: 'Ações', fixed: true },
  ];

  function getColunasOrdenadasProdutos() {
    const columns = window.ValoraLocalizarPersonalizado?.getOrderedTableColumns?.('produtos');
    if (Array.isArray(columns) && columns.length) return columns;

    return DEFAULT_NATIVE_COLUMNS_PRODUTOS.map((column, index) => ({
      ...column,
      kind: 'native',
      origin: 'nativo',
      defaultOrder: index,
    }));
  }

  function renderHeadersProdutos(columns) {
    const row = document.querySelector('.valora-table thead tr');
    if (!row) return;

    row.innerHTML = columns.map((column) => `
      <th class="${column.key === 'acoes' ? 'text-right' : ''}">
        ${escapeHtml(column.label || column.key)}
      </th>
    `).join('');
  }

  function renderAcoesProduto(produto) {
    return `
      <td class="text-right">
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn-icon" data-action="editar" data-id="${escapeHtml(produto.id)}" title="Editar produto">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button class="btn-icon danger" data-action="excluir" data-id="${escapeHtml(produto.id)}" title="Excluir produto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
  }

  function renderCelulaNativaProduto(produto, key) {
    switch (key) {
      case 'codigo':
        return `<td><span class="badge-codigo">${escapeHtml(produto.codigo || '-')}</span></td>`;
      case 'produto':
        return `
          <td>
            <button
              type="button"
              class="table-name-link produto-main"
              data-action="visualizar"
              data-id="${escapeHtml(produto.id)}"
              title="Visualizar produto"
            >
              <strong>${escapeHtml(produto.nome || '-')}</strong>
              ${produto.descricao ? `<span>${escapeHtml(produto.descricao)}</span>` : ''}
            </button>
          </td>
        `;
      case 'categoria':
        return `<td>${escapeHtml(produto.categoria || '-')}</td>`;
      case 'preco':
        return `<td>${escapeHtml(formatCurrency(produto.preco_venda || ''))}</td>`;
      case 'estoque':
        return `<td>${escapeHtml(produto.estoque_atual || '-')}</td>`;
      case 'acoes':
        return renderAcoesProduto(produto);
      default:
        return '';
    }
  }

  function renderColunaProduto(produto, column) {
    if (column?.kind === 'dynamic') {
      const value = window.ValoraLocalizarPersonalizado?.formatValue?.(produto, column) || '-';
      return `<td>${escapeHtml(value)}</td>`;
    }

    return renderCelulaNativaProduto(produto, column?.key);
  }

  function renderTabelaProdutos() {
    const tbody = $('tbody-produtos');
    const spanCount = $('contagem-produtos');

    if (!tbody) return;

    const columns = getColunasOrdenadasProdutos();
    renderHeadersProdutos(columns);
    const colspan = columns.length;

    if (!produtos.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="${colspan}" class="empty-state">Nenhum produto encontrado.</td>
        </tr>
      `;

      if (spanCount) spanCount.textContent = '0 produtos';
      renderPaginacaoProdutos();
      return;
    }

    tbody.innerHTML = produtos.map((produto) => `
      <tr>
        ${columns.map((column) => renderColunaProduto(produto, column)).join('')}
      </tr>
    `).join('');

    if (spanCount) {
      const total = Number(produtosPage.total || produtos.length || 0);
      const ini = total ? Number(produtosPage.offset || 0) + 1 : 0;
      const fim = Math.min(Number(produtosPage.offset || 0) + produtos.length, total);

      spanCount.textContent = total === produtos.length
        ? (produtos.length === 1 ? '1 produto' : `${produtos.length} produtos`)
        : `${ini}-${fim} de ${total} produtos`;
    }

    renderPaginacaoProdutos();
  }

  function renderPaginacaoProdutos() {
    const wraps = document.querySelectorAll('[data-pagination="produtos"]');
    if (!wraps.length) return;

    const offset = Number(produtosPage.offset || 0);
    const limit = Number(produtosPage.limit || 50);
    const total = Number(produtosPage.total || 0);
    const atual = total ? Math.floor(offset / limit) + 1 : 1;
    const paginas = Math.max(1, Math.ceil(total / limit));

    const lastOffset = Math.max(0, (paginas - 1) * limit);

    const html = `
      <button class="btn btn-secondary btn-sm" type="button" data-page-action="first" ${offset <= 0 ? 'disabled' : ''}>Primeira</button>
      <button class="btn btn-secondary btn-sm" type="button" data-page-action="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
      <span class="pagination-info">Página ${atual} de ${paginas}</span>
      <button class="btn btn-secondary btn-sm" type="button" data-page-action="next" ${!produtosPage.hasMore ? 'disabled' : ''}>Próxima</button>
      <button class="btn btn-secondary btn-sm" type="button" data-page-action="last" data-last-offset="${lastOffset}" ${offset >= lastOffset ? 'disabled' : ''}>Última</button>
    `;

    wraps.forEach((wrap) => {
      wrap.innerHTML = html;
    });
  }

  function abrirModalProduto() {
    openModal('modal-produto-backdrop');
  }

  function fecharModalProduto() {
    setProdutoModalReadonly(false);
    closeModal('modal-produto-backdrop');
    produtoEditandoId = null;
    produtoAtualDetalhe = null;
  }

  async function abrirModalProdutoNovo() {
    setProdutoModalReadonly(false);
    desativarValidacaoGlobalProduto();
    const titulo = $('modal-produto-titulo');
    if (titulo) titulo.textContent = 'Novo produto';

    produtoEditandoId = null;
    produtoAtualDetalhe = null;

    const proximoCodigo = await carregarProximoCodigoProduto();
    fillProdutoNativeFields({ codigo: proximoCodigo, ativo: true });

    const values = buildCustomValuesNovoProduto();
    await renderCustomFieldsInputs(values);
    aplicarModoFichaProduto();

    abrirModalProduto();
    setProdutoModalReadonly(false);
    await syncAgendaProduto(null, false);

    setTimeout(() => {
      if (usarFichaPrincipalProdutos) {
        switchProdutoTab('tab-produto-ficha');
        focusFirstCustomField();
      } else {
        switchProdutoTab('tab-produto-dados');
        focusProdutoNativeNome();
      }
    }, 120);
  }

  async function abrirModalProdutoEditar(produto) {
    desativarValidacaoGlobalProduto();
    const titulo = $('modal-produto-titulo');
    if (titulo) titulo.textContent = 'Editar produto';

    produtoEditandoId = produto.id;
    produtoAtualDetalhe = produto;

    fillProdutoNativeFields(produto);

    const values = buildCustomValuesFromProduto(produto);
    await renderCustomFieldsInputs(values);
    aplicarModoFichaProduto();

    abrirModalProduto();
    setProdutoModalReadonly(false);
    await syncAgendaProduto(produto, false);

    setTimeout(() => {
      switchProdutoTab(usarFichaPrincipalProdutos ? 'tab-produto-ficha' : 'tab-produto-dados');
    }, 80);
  }


  async function abrirModalProdutoVisualizar(produto) {
    try {
      desativarValidacaoGlobalProduto();
      const titulo = $('modal-produto-titulo');
      if (titulo) titulo.textContent = 'Visualizar produto';

      produtoEditandoId = produto.id;
      produtoAtualDetalhe = produto;

      fillProdutoNativeFields(produto);

      const values = buildCustomValuesFromProduto(produto);
      await renderCustomFieldsInputs(values);
      aplicarModoFichaProduto();

      abrirModalProduto();
      setProdutoModalReadonly(true);
      await syncAgendaProduto(produto, true);

      setTimeout(() => {
        switchProdutoTab(usarFichaPrincipalProdutos ? 'tab-produto-ficha' : 'tab-produto-dados');
      }, 80);
    } catch (err) {
      console.error('[Produtos] erro ao visualizar produto:', err);
      toast(err.message || 'Não foi possível visualizar o produto.', { error: true, ms: 5000 });
    }
  }

  function buildPayloadProduto() {
    const customFields = collectCustomFieldsValues();
    const nativeFields = getProdutoNativeValues();
    const customFallback = buildProdutoBaseFromCustom(customFields, produtoAtualDetalhe || {});

    const base = usarFichaPrincipalProdutos
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
          unidade: nativeFields.unidade || customFallback.unidade || '',
          preco_venda: nativeFields.preco_venda || customFallback.preco_venda || '',
          custo: nativeFields.custo || customFallback.custo || '',
          estoque_atual: nativeFields.estoque_atual || customFallback.estoque_atual || '',
        };

    return {
      ...base,
      codigo: onlyDigits(base.codigo),
      custom_fields: filtrarCustomFieldsSistema(customFields, { preservarCamposFormulario: true }),
    };
  }

  async function salvarProduto() {
    if (produtoModalSomenteLeitura) {
      toast('Este produto está aberto apenas para visualização.', { error: true, ms: 3000 });
      return;
    }

    desativarValidacaoGlobalProduto();
    limparDestaquesObrigatorios();

    const payload = buildPayloadProduto();

    if (!payload.nome) {
      toast(
        usarFichaPrincipalProdutos
          ? 'Preencha no formulário um campo de identificação/nome do produto.'
          : 'Preencha o nome do produto.',
        { error: true, ms: 4200 }
      );

      if (usarFichaPrincipalProdutos) {
        switchProdutoTab('tab-produto-ficha');
        setTimeout(() => {
          const first = $('formProduto')?.querySelector('[data-custom-field]:not([disabled])');
          if (first) marcarCampoObrigatorio(first);
          else focusFirstCustomField();
        }, 80);
      } else {
        const nomeEl = $('campo-nome-produto');
        if (nomeEl) marcarCampoObrigatorio(nomeEl);
        focusProdutoNativeNome();
      }

      return;
    }

    const requiredOk = validarCamposFormulario();
    if (!requiredOk) return;

    const btn = $('btn-salvar-produto');
    const original = btn ? btn.innerHTML : '';

    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
      }

      await salvarProdutoNoServidor(payload, produtoEditandoId);
      await carregarProdutos();

      fecharModalProduto();
      toast('Produto salvo com sucesso.', { ms: 1800 });
    } catch (err) {
      console.error('[Produtos] erro ao salvar:', err);
      toast(err.message || 'Erro ao salvar produto.', { error: true, ms: 5200 });
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original || '<i class="fa-solid fa-floppy-disk"></i> Salvar produto';
      }
    }
  }

  let _confirmResolver = null;

  function confirmDialog({
    title = 'Confirmar',
    message = 'Tem certeza?',
    confirmText = 'OK',
    cancelText = 'Cancelar',
    danger = false,
  } = {}) {
    const backdrop = $('Valora-confirm-backdrop');
    const titleEl = $('Valora-confirm-title');
    const msgEl = $('Valora-confirm-message');
    const okBtn = $('Valora-confirm-ok');
    const cancelBtn = $('Valora-confirm-cancel');

    if (!backdrop || !okBtn || !cancelBtn) {
      return Promise.resolve(window.confirm(message));
    }

    titleEl.textContent = title || 'Confirmar';
    msgEl.textContent = message || 'Tem certeza?';
    okBtn.textContent = confirmText || 'OK';
    cancelBtn.textContent = cancelText || 'Cancelar';

    okBtn.classList.toggle('danger-action', !!danger);

    openModal('Valora-confirm-backdrop');

    return new Promise((resolve) => {
      _confirmResolver = resolve;
    });
  }

  function closeConfirm(result = false) {
    closeModal('Valora-confirm-backdrop');

    if (typeof _confirmResolver === 'function') {
      const fn = _confirmResolver;
      _confirmResolver = null;
      fn(!!result);
    }
  }

  function downloadFile(filename, content, mime = 'application/octet-stream') {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function pickProdutosForExport() {
    return (produtos || []).map((p) => ({
      id: p.id ?? null,
      codigo: p.codigo ?? '',
      nome: p.nome ?? '',
      descricao: p.descricao ?? '',
      categoria: p.categoria ?? '',
      unidade: p.unidade ?? '',
      preco_venda: p.preco_venda ?? '',
      custo: p.custo ?? '',
      estoque_atual: p.estoque_atual ?? '',
      ativo: p.ativo ?? true,
      custom_fields: normalizeCustomFields(p.custom_fields),
    }));
  }

  function exportarProdutosJSON() {
    const dt = new Date();
    const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');

    const payload = {
      exported_at: dt.toISOString(),
      formulario: formularioProdutos?.modelo || null,
      total: (produtos || []).length,
      items: pickProdutosForExport(),
    };

    downloadFile(
      `produtos_${stamp}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    );

    toast('Exportado JSON.', { ms: 1800 });
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    const must = /[;\n\r"]/g.test(s);
    const out = s.replaceAll('"', '""');
    return must ? `"${out}"` : out;
  }

  function flattenCustomKeys(items = []) {
    const out = new Set();
    items.forEach((item) => {
      Object.keys(normalizeCustomFields(item.custom_fields)).forEach((key) => out.add(key));
    });
    return Array.from(out);
  }

  function exportarProdutosCSV() {
    const dt = new Date();
    const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
    const items = pickProdutosForExport();
    const baseCols = ['codigo', 'nome', 'descricao', 'categoria', 'unidade', 'preco_venda', 'custo', 'estoque_atual', 'ativo'];
    const customCols = flattenCustomKeys(items);
    const cols = [...baseCols, ...customCols];
    const lines = [cols.join(';')];

    items.forEach((produto) => {
      const custom = normalizeCustomFields(produto.custom_fields);
      lines.push(cols.map((key) => {
        if (baseCols.includes(key)) return csvEscape(produto?.[key] ?? '');
        return csvEscape(custom?.[key] ?? '');
      }).join(';'));
    });

    downloadFile(
      `produtos_${stamp}.csv`,
      '\ufeff' + lines.join('\n'),
      'text/csv;charset=utf-8'
    );

    toast('Exportado CSV.', { ms: 1800 });
  }

  function parseCSV(text) {
    const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = raw.split('\n').filter((line) => line.trim().length);

    if (!lines.length) return [];

    const firstLine = lines[0];
    const semicolon = (firstLine.match(/;/g) || []).length;
    const comma = (firstLine.match(/,/g) || []).length;
    const delim = semicolon >= comma ? ';' : ',';

    function parseLine(line) {
      const out = [];
      let cur = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];

        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }

        if (!inQuotes && ch === delim) {
          out.push(cur);
          cur = '';
          continue;
        }

        cur += ch;
      }

      out.push(cur);
      return out.map((v) => v.trim());
    }

    const headers = parseLine(lines[0]).map((h) => slugify(h));

    return lines.slice(1).map((line) => {
      const vals = parseLine(line);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = vals[idx] ?? '';
      });
      return obj;
    });
  }

  function parseXLSX(arrayBuffer) {
    if (!window.XLSX) {
      throw new Error('Biblioteca XLSX não carregada.');
    }

    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }

  async function importarProdutosArquivo(file) {
    if (!file) {
      toast('Selecione um arquivo para importar.', { error: true });
      return;
    }

    try {
      const lower = String(file.name || '').toLowerCase();
      let items = [];

      if (lower.endsWith('.json')) {
        const text = await file.text();
        const data = JSON.parse(text || '{}');
        items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      } else if (lower.endsWith('.xlsx')) {
        const buffer = await file.arrayBuffer();
        items = parseXLSX(buffer);
      } else {
        const text = await file.text();
        items = parseCSV(text);
      }

      if (!Array.isArray(items) || !items.length) {
        toast('Arquivo vazio ou inválido.', { error: true });
        return;
      }

      const ok = await confirmDialog({
        title: 'Importar produtos',
        message: `Importar ${items.length} produto(s)?`,
        confirmText: 'Importar',
        cancelText: 'Cancelar',
      });

      if (!ok) return;

      let success = 0;
      let fail = 0;

      for (const raw of items) {
        try {
          const normalized = {};
          Object.entries(raw || {}).forEach(([key, value]) => {
            normalized[slugify(key)] = value;
          });

          const base = buildProdutoBaseFromCustom(normalized, normalized);
          const payload = {
            ...base,
            custom_fields: filtrarCustomFieldsSistema(normalized),
          };

          if (!payload.nome) {
            fail += 1;
            continue;
          }

          await salvarProdutoNoServidor(payload, null);
          success += 1;
        } catch (_) {
          fail += 1;
        }
      }

      await carregarProdutos({ offset: 0 });

      toast(
        `Importação concluída: ${success} sucesso(s)${fail ? ` • ${fail} falha(s)` : ''}`,
        { error: !!fail, ms: 3800 }
      );
    } catch (err) {
      console.error('[Produtos] erro ao importar:', err);
      toast(err.message || 'Erro ao importar arquivo.', { error: true, ms: 5000 });
    }
  }

  function abrirGerenciadorFormulario() {
    window.location.href = '/frontend/formularios.html?modulo=produtos';
  }

  async function atualizarFormularioProduto() {
    const valoresAtuais = collectCustomFieldsValues();
    await carregarFormularioProdutos({ loadingContainer: '#custom-fields-container', forceRefresh: true });
    await renderCustomFieldsInputs(valoresAtuais);
    toast('Ficha de Produtos atualizada.', { ms: 1800 });
  }

  function canonicalPriceValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    let cleaned = raw
      .replace(/R\$/gi, '')
      .replace(/%/g, '')
      .replace(/[\s\u00a0]/g, '');

    if (cleaned.includes(',') && cleaned.includes('.')) {
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if ((cleaned.match(/\./g) || []).length > 1) {
      const parts = cleaned.split('.');
      cleaned = `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
    }

    const number = Number(cleaned);
    if (!Number.isFinite(number)) return raw;
    return String(number);
  }

  function formatPriceInputValue(value) {
    return String(value ?? '').trim();
  }

  function camposPadraoAtualizacaoPrecos(fields = atualizacaoPrecosMeta?.campos_preco || []) {
    const available = new Set(fields.map((field) => String(field.key)));
    const defaults = ['custo', 'preco_venda'].filter((key) => available.has(key));
    if (defaults.length) return defaults;
    return fields.slice(0, 2).map((field) => String(field.key));
  }

  function salvarPreferenciasColunasPrecos() {
    try {
      localStorage.setItem(ATUALIZACAO_PRECOS_COLUNAS_STORAGE, JSON.stringify([...colunasPrecosVisiveis]));
    } catch (_) {}
  }

  function prepararColunasPrecosVisiveis(fields = atualizacaoPrecosMeta?.campos_preco || []) {
    const validKeys = new Set(fields.map((field) => String(field.key)));
    let stored = [];

    try {
      const parsed = JSON.parse(localStorage.getItem(ATUALIZACAO_PRECOS_COLUNAS_STORAGE) || '[]');
      stored = Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {}

    const current = colunasPrecosVisiveis.size ? [...colunasPrecosVisiveis] : stored;
    const valid = current.filter((key) => validKeys.has(key));
    colunasPrecosVisiveis = new Set(valid.length ? valid : camposPadraoAtualizacaoPrecos(fields));
    salvarPreferenciasColunasPrecos();
  }

  function camposVisiveisAtualizacaoPrecos() {
    const fields = atualizacaoPrecosMeta?.campos_preco || [];
    if (!colunasPrecosVisiveis.size) prepararColunasPrecosVisiveis(fields);
    return fields.filter((field) => colunasPrecosVisiveis.has(String(field.key)));
  }

  function atualizarAvisoCamposPrecos() {
    const fields = atualizacaoPrecosMeta?.campos_preco || [];
    const visible = camposVisiveisAtualizacaoPrecos();
    const editable = fields.filter((field) => field.editable).length;
    const info = $('aviso-campos-precos');
    const count = $('contador-colunas-precos');

    if (count) count.textContent = String(visible.length);
    if (!info) return;

    if (!podeEditarPrecos) {
      info.textContent = `Exibindo ${visible.length} de ${fields.length} coluna(s). Você não possui permissão para editar.`;
      return;
    }

    const performanceHint = visible.length > 8 ? ' Muitas colunas podem deixar a tabela mais lenta.' : '';
    info.textContent = `${fields.length} campo(s) identificado(s), ${editable} editável(is). Exibindo ${visible.length}.${performanceHint}`;
  }

  function renderSeletorColunasPrecos() {
    const list = $('lista-colunas-precos');
    if (!list) return;

    const fields = atualizacaoPrecosMeta?.campos_preco || [];
    list.innerHTML = fields.map((field) => {
      const key = String(field.key);
      const checked = colunasPrecosVisiveis.has(key);
      return `
        <label class="price-column-option">
          <input type="checkbox" value="${escapeHtml(key)}" data-price-column="true" ${checked ? 'checked' : ''} />
          <span>
            <strong>${escapeHtml(field.label)}</strong>
            <small>${escapeHtml(field.secao || 'Formação de preços')}</small>
          </span>
          ${field.editable ? '' : '<i class="fa-solid fa-lock" title="Somente leitura"></i>'}
        </label>
      `;
    }).join('');

    atualizarAvisoCamposPrecos();
  }

  function fecharSeletorColunasPrecos() {
    const panel = $('painel-colunas-precos');
    const button = $('btn-colunas-precos');
    if (panel) panel.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  }

  function alternarSeletorColunasPrecos() {
    const panel = $('painel-colunas-precos');
    const button = $('btn-colunas-precos');
    if (!panel || !button) return;
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  }

  function priceFieldMap() {
    return new Map((atualizacaoPrecosMeta?.campos_preco || []).map((field) => [String(field.key), field]));
  }

  function getPendingProduct(productId) {
    return alteracoesPrecos.get(Number(productId)) || null;
  }

  function getPendingValue(productId, key, fallback = '') {
    const pending = getPendingProduct(productId);
    if (!pending) return fallback;
    return pending.valores.has(String(key)) ? pending.valores.get(String(key)) : fallback;
  }

  function totalCamposAlteradosPrecos() {
    let total = 0;
    alteracoesPrecos.forEach((item) => { total += item.valores.size; });
    return total;
  }

  function atualizarResumoAlteracoesPrecos() {
    const produtosAlterados = alteracoesPrecos.size;
    const camposAlterados = totalCamposAlteradosPrecos();
    const hasChanges = produtosAlterados > 0;
    const text = hasChanges
      ? `${produtosAlterados} produto(s) e ${camposAlterados} campo(s) alterado(s)`
      : 'Nenhuma alteração pendente';

    if ($('contador-alteracoes-precos')) $('contador-alteracoes-precos').textContent = text;
    if ($('barra-contador-precos')) $('barra-contador-precos').textContent = hasChanges
      ? `${produtosAlterados} produto(s) alterado(s)`
      : '0 produtos alterados';

    ['btn-salvar-precos', 'btn-salvar-precos-barra'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !hasChanges || !podeEditarPrecos;
    });

    ['btn-descartar-precos', 'btn-descartar-precos-barra'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !hasChanges;
    });

    const bar = $('barra-salvar-precos');
    if (bar) bar.hidden = !hasChanges;
  }

  function agendarAtualizacaoResumoPrecos() {
    if (atualizacaoPrecosResumoFrame !== null) return;
    const schedule = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
    atualizacaoPrecosResumoFrame = schedule(() => {
      atualizacaoPrecosResumoFrame = null;
      atualizarResumoAlteracoesPrecos();
    });
  }

  function setPriceFilterOptions(selectId, filterMeta, emptyLabel) {
    const select = $(selectId);
    if (!select) return;

    const options = Array.isArray(filterMeta?.options) ? filterMeta.options : [];
    const configured = filterMeta?.source === 'native' || !!filterMeta?.campo;

    select.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>` + options.map((value) => (
      `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
    )).join('');

    select.disabled = !configured;
    select.title = configured ? '' : 'Esse campo ainda não foi configurado no formulário de Produtos.';

    if (!configured) {
      select.innerHTML = '<option value="">Campo não configurado</option>';
    }
  }

  function preencherFiltrosAtualizacaoPrecos() {
    const filters = atualizacaoPrecosMeta?.filtros || {};
    setPriceFilterOptions('preco-filtro-situacao', filters.situacao_comercial, 'Todas');
    setPriceFilterOptions('preco-filtro-tipo', filters.tipo_produto, 'Todos');
    setPriceFilterOptions('preco-filtro-origem', filters.origem_produto, 'Todas');
    setPriceFilterOptions('preco-filtro-categoria', filters.categoria, 'Todas');
    setPriceFilterOptions('preco-filtro-fornecedor', filters.fornecedor, 'Todos');
    setPriceFilterOptions('preco-filtro-fabricante', filters.fabricante, 'Todos');
  }

  async function carregarMetaAtualizacaoPrecos() {
    const [meta, me] = await Promise.all([
      apiJson(`${API_PRODUTOS}/atualizacao-precos/meta`),
      apiJson('/api/permissoes/me'),
    ]);

    atualizacaoPrecosMeta = meta || { campos_preco: [], filtros: {} };
    podeEditarPrecos = !!me?.permissoes?.produtos?.pode_editar;
    preencherFiltrosAtualizacaoPrecos();
    prepararColunasPrecosVisiveis(atualizacaoPrecosMeta?.campos_preco || []);
    renderSeletorColunasPrecos();
  }

  function montarUrlAtualizacaoPrecos({ offset = atualizacaoPrecosPage.offset || 0 } = {}) {
    const params = new URLSearchParams({
      limit: String(atualizacaoPrecosPage.limit || ATUALIZACAO_PRECOS_LIMITE_PAGINA),
      offset: String(offset),
    });

    const visibleKeys = camposVisiveisAtualizacaoPrecos().map((field) => String(field.key));
    if (visibleKeys.length) params.set('campos', visibleKeys.join(','));

    const fields = {
      busca: 'preco-filtro-busca',
      situacao_comercial: 'preco-filtro-situacao',
      tipo_produto: 'preco-filtro-tipo',
      origem_produto: 'preco-filtro-origem',
      categoria: 'preco-filtro-categoria',
      fornecedor: 'preco-filtro-fornecedor',
      fabricante: 'preco-filtro-fabricante',
    };

    Object.entries(fields).forEach(([key, id]) => {
      const value = String($(id)?.value || '').trim();
      if (value) params.set(key, value);
    });

    return `${API_PRODUTOS}/atualizacao-precos?${params.toString()}`;
  }

  function setAtualizacaoPrecosLoading(message = 'Carregando produtos e campos de preço...') {
    const tbody = $('tbody-atualizacao-precos');
    if (!tbody) return;
    const colspan = Math.max(3, 2 + camposVisiveisAtualizacaoPrecos().length);
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(message)}</td></tr>`;
  }

  async function carregarAtualizacaoPrecos({ offset = atualizacaoPrecosPage.offset || 0, silent = false } = {}) {
    if (!atualizacaoPrecosMeta) await carregarMetaAtualizacaoPrecos();

    atualizacaoPrecosRequestController?.abort();
    const controller = new AbortController();
    const requestId = ++atualizacaoPrecosRequestId;
    atualizacaoPrecosRequestController = controller;

    try {
      if (!silent) setAtualizacaoPrecosLoading();

      const data = await apiJson(montarUrlAtualizacaoPrecos({ offset }), { signal: controller.signal });
      if (requestId !== atualizacaoPrecosRequestId) return;

      atualizacaoPrecosItens = Array.isArray(data?.items) ? data.items : [];
      atualizacaoPrecosPage = {
        offset: Number(data?.offset || 0),
        limit: Number(data?.limit || ATUALIZACAO_PRECOS_LIMITE_PAGINA),
        total: Number(data?.total || 0),
        hasMore: !!data?.has_more,
      };

      renderTabelaAtualizacaoPrecos();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      if (requestId !== atualizacaoPrecosRequestId) return;
      atualizacaoPrecosItens = [];
      renderTabelaAtualizacaoPrecos();
      toast(error.message || 'Erro ao carregar atualização de preços.', { error: true, ms: 5000 });
    } finally {
      if (atualizacaoPrecosRequestController === controller) {
        atualizacaoPrecosRequestController = null;
      }
    }
  }

  function fieldInputMode(field) {
    return ['moeda', 'numero', 'percentual'].includes(String(field?.tipo || '').toLowerCase()) ? 'decimal' : 'text';
  }

  function fieldUsesSelectOptions(field) {
    const type = String(field?.tipo || '').trim().toLowerCase();
    return ['select', 'lista', 'dropdown', 'radio'].includes(type);
  }

  function renderPriceCell(product, field) {
    const original = String(product?.valores?.[field.key] ?? '');
    const effective = getPendingValue(product.id, field.key, original);
    const pending = getPendingProduct(product.id)?.valores.has(String(field.key));
    const readonly = !podeEditarPrecos || !field.editable;
    const title = readonly ? `${field.label} — somente leitura` : `${field.label} — editável`;
    const configuredOptions = Array.isArray(field?.options)
      ? field.options.map((option) => String(option ?? '').trim()).filter(Boolean)
      : [];
    const usesSelect = fieldUsesSelectOptions(field) && configuredOptions.length > 0;
    const options = usesSelect ? [...configuredOptions] : [];
    if (usesSelect && effective && !options.some((option) => String(option) === String(effective))) {
      options.unshift(effective);
    }

    const commonAttributes = `
      data-price-input="true"
      data-product-id="${escapeHtml(product.id)}"
      data-product-code="${escapeHtml(product.codigo || '')}"
      data-product-name="${escapeHtml(product.nome || '')}"
      data-field-key="${escapeHtml(field.key)}"
      data-original-value="${escapeHtml(original)}"
      title="${escapeHtml(title)}"
      aria-label="${escapeHtml(`${field.label} de ${product.nome}`)}"
    `;

    const editor = usesSelect
      ? `
        <select class="price-inline-input price-inline-select" ${commonAttributes} ${readonly ? 'disabled' : ''}>
          <option value="">—</option>
          ${options.map((option) => `
            <option value="${escapeHtml(option)}" ${String(option) === String(effective) ? 'selected' : ''}>${escapeHtml(option)}</option>
          `).join('')}
        </select>
      `
      : `
        <input
          class="price-inline-input"
          type="text"
          inputmode="${fieldInputMode(field)}"
          value="${escapeHtml(formatPriceInputValue(effective))}"
          ${commonAttributes}
          maxlength="80"
          ${readonly ? 'readonly' : ''}
        />
      `;

    return `
      <td class="price-value-cell ${pending ? 'is-price-changed' : ''}" data-price-cell="${escapeHtml(product.id)}:${escapeHtml(field.key)}">
        <div class="price-input-wrap">
          ${editor}
          ${readonly ? '<i class="fa-solid fa-lock price-field-lock" aria-hidden="true"></i>' : ''}
        </div>
      </td>
    `;
  }

  function renderTabelaAtualizacaoPrecos() {
    const thead = $('thead-atualizacao-precos');
    const tbody = $('tbody-atualizacao-precos');
    const count = $('contagem-atualizacao-precos');
    if (!thead || !tbody) return;

    const fields = camposVisiveisAtualizacaoPrecos();
    thead.innerHTML = `
      <tr>
        <th class="price-sticky-code">Código</th>
        <th class="price-sticky-name">Nome oficial do produto</th>
        ${fields.map((field) => `
          <th title="${escapeHtml(field.secao || 'Formação de preços')}">
            <span>${escapeHtml(field.label)}</span>
            ${field.editable ? '' : '<i class="fa-solid fa-lock" title="Somente leitura"></i>'}
          </th>
        `).join('')}
      </tr>
    `;

    if (!atualizacaoPrecosItens.length) {
      tbody.innerHTML = `<tr><td colspan="${Math.max(2, 2 + fields.length)}" class="empty-state">Nenhum produto encontrado.</td></tr>`;
    } else {
      tbody.innerHTML = atualizacaoPrecosItens.map((product) => `
        <tr data-price-row="${escapeHtml(product.id)}" class="${getPendingProduct(product.id) ? 'has-price-changes' : ''}">
          <td class="price-sticky-code"><span class="badge-codigo">${escapeHtml(product.codigo || '-')}</span></td>
          <td class="price-sticky-name">
            <div class="price-product-name">
              <strong>${escapeHtml(product.nome || '-')}</strong>
              <span>${escapeHtml(product.categoria || (product.ativo ? 'Ativo' : 'Inativo'))}</span>
            </div>
          </td>
          ${fields.map((field) => renderPriceCell(product, field)).join('')}
        </tr>
      `).join('');
    }

    const total = Number(atualizacaoPrecosPage.total || 0);
    const start = total ? Number(atualizacaoPrecosPage.offset || 0) + 1 : 0;
    const end = Math.min(Number(atualizacaoPrecosPage.offset || 0) + atualizacaoPrecosItens.length, total);
    if (count) count.textContent = total ? `${start}-${end} de ${total} produtos` : '0 produtos';

    renderPaginacaoAtualizacaoPrecos();
    atualizarResumoAlteracoesPrecos();
  }

  function renderPaginacaoAtualizacaoPrecos() {
    const wraps = document.querySelectorAll('[data-pagination="atualizacao-precos"]');
    if (!wraps.length) return;

    const offset = Number(atualizacaoPrecosPage.offset || 0);
    const limit = Number(atualizacaoPrecosPage.limit || ATUALIZACAO_PRECOS_LIMITE_PAGINA);
    const total = Number(atualizacaoPrecosPage.total || 0);
    const page = total ? Math.floor(offset / limit) + 1 : 1;
    const pages = Math.max(1, Math.ceil(total / limit));
    const lastOffset = Math.max(0, (pages - 1) * limit);

    const html = `
      <button class="btn btn-secondary btn-sm" type="button" data-price-page="first" ${offset <= 0 ? 'disabled' : ''}>Primeira</button>
      <button class="btn btn-secondary btn-sm" type="button" data-price-page="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
      <span class="pagination-info">Página ${page} de ${pages}</span>
      <button class="btn btn-secondary btn-sm" type="button" data-price-page="next" ${!atualizacaoPrecosPage.hasMore ? 'disabled' : ''}>Próxima</button>
      <button class="btn btn-secondary btn-sm" type="button" data-price-page="last" data-last-offset="${lastOffset}" ${offset >= lastOffset ? 'disabled' : ''}>Última</button>
    `;
    wraps.forEach((wrap) => { wrap.innerHTML = html; });
  }

  function registrarAlteracaoPreco(input) {
    if (!input || input.readOnly || input.disabled) return;

    const productId = Number(input.dataset.productId);
    const key = String(input.dataset.fieldKey || '');
    const original = String(input.dataset.originalValue || '');
    const current = String(input.value || '').trim();
    if (!productId || !key) return;

    let pending = getPendingProduct(productId);
    const isSame = canonicalPriceValue(current) === canonicalPriceValue(original);

    if (isSame) {
      if (pending) {
        pending.valores.delete(key);
        if (!pending.valores.size) alteracoesPrecos.delete(productId);
      }
    } else {
      if (!pending) {
        pending = {
          produto_id: productId,
          codigo: input.dataset.productCode || '',
          nome: input.dataset.productName || '',
          valores: new Map(),
        };
        alteracoesPrecos.set(productId, pending);
      }
      pending.valores.set(key, current);
    }

    const cell = input.closest('.price-value-cell');
    cell?.classList.toggle('is-price-changed', !isSame);
    input.closest('tr')?.classList.toggle('has-price-changes', !!getPendingProduct(productId));
    agendarAtualizacaoResumoPrecos();
  }

  async function salvarAlteracoesPrecos() {
    if (!podeEditarPrecos) {
      toast('Você não possui permissão para editar Produtos.', { error: true });
      return;
    }
    if (!alteracoesPrecos.size) return;
    if (alteracoesPrecos.size > Number(atualizacaoPrecosMeta?.limite_lote || 500)) {
      toast('O lote ultrapassa o limite de produtos permitido.', { error: true, ms: 4200 });
      return;
    }

    const ok = await confirmDialog({
      title: 'Salvar atualização de preços',
      message: `Confirmar alterações em ${alteracoesPrecos.size} produto(s)? O histórico será registrado.`,
      confirmText: 'Salvar',
      cancelText: 'Revisar',
    });
    if (!ok) return;

    const buttons = [$('btn-salvar-precos'), $('btn-salvar-precos-barra')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });

    try {
      const payload = {
        motivo: String($('motivo-atualizacao-precos')?.value || '').trim() || null,
        itens: Array.from(alteracoesPrecos.values()).map((item) => ({
          produto_id: item.produto_id,
          valores: Object.fromEntries(item.valores.entries()),
        })),
      };

      const result = await apiJson(`${API_PRODUTOS}/atualizacao-precos`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      alteracoesPrecos.clear();
      if ($('motivo-atualizacao-precos')) $('motivo-atualizacao-precos').value = '';
      await carregarMetaAtualizacaoPrecos();
      await carregarAtualizacaoPrecos({ offset: atualizacaoPrecosPage.offset });
      toast(result?.message || 'Valores atualizados com sucesso.', { ms: 2500 });
    } catch (error) {
      toast(error.message || 'Erro ao salvar atualização de preços.', { error: true, ms: 5200 });
    } finally {
      atualizarResumoAlteracoesPrecos();
    }
  }

  async function descartarAlteracoesPrecos({ ask = true } = {}) {
    if (!alteracoesPrecos.size) return true;
    if (ask) {
      const ok = await confirmDialog({
        title: 'Descartar alterações',
        message: 'As alterações ainda não salvas serão perdidas. Deseja continuar?',
        confirmText: 'Descartar',
        cancelText: 'Continuar editando',
        danger: true,
      });
      if (!ok) return false;
    }

    alteracoesPrecos.clear();
    renderTabelaAtualizacaoPrecos();
    return true;
  }

  async function abrirTelaAtualizacaoPrecos() {
    telaPrecosAberta = true;
    $('tela-catalogo-produtos')?.setAttribute('hidden', '');
    $('tela-atualizacao-precos')?.removeAttribute('hidden');
    document.querySelector('.topbar')?.setAttribute('hidden', '');

    try {
      await carregarMetaAtualizacaoPrecos();
      await carregarAtualizacaoPrecos({ offset: 0 });
    } catch (error) {
      toast(error.message || 'Não foi possível abrir a atualização de preços.', { error: true, ms: 5000 });
    }
  }

  async function fecharTelaAtualizacaoPrecos() {
    if (alteracoesPrecos.size) {
      const discarded = await descartarAlteracoesPrecos({ ask: true });
      if (!discarded) return;
    }

    telaPrecosAberta = false;
    atualizacaoPrecosRequestController?.abort();
    atualizacaoPrecosRequestController = null;
    fecharSeletorColunasPrecos();
    $('tela-atualizacao-precos')?.setAttribute('hidden', '');
    $('tela-catalogo-produtos')?.removeAttribute('hidden');
    document.querySelector('.topbar')?.removeAttribute('hidden');
    await carregarProdutos({ offset: produtosPage.offset, silent: true });
  }

  function formatHistoryDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date);
  }

  function formatHistoryValue(fieldKey, value) {
    if (value === null || value === undefined || String(value).trim() === '') return 'Vazio';
    const field = priceFieldMap().get(String(fieldKey));
    if (field?.tipo === 'moeda') return formatCurrency(value);
    if (field?.tipo === 'percentual') return `${String(value)}%`;
    return String(value);
  }

  async function carregarHistoricoPrecos() {
    const list = $('lista-historico-precos');
    if (!list) return;
    list.innerHTML = '<div class="empty-state">Carregando histórico...</div>';

    try {
      const productId = String($('historico-preco-produto')?.value || '').trim();
      const params = new URLSearchParams({ limit: '200' });
      if (productId) params.set('produto_id', productId);
      const rows = await apiJson(`${API_PRODUTOS}/atualizacao-precos/historico?${params.toString()}`);

      if (!Array.isArray(rows) || !rows.length) {
        list.innerHTML = '<div class="empty-state">Nenhuma alteração de preço registrada.</div>';
        return;
      }

      list.innerHTML = rows.map((row) => `
        <article class="price-history-item">
          <div class="price-history-product">
            <span class="badge-codigo">${escapeHtml(row.produto_codigo || '-')}</span>
            <div><strong>${escapeHtml(row.produto_nome || '-')}</strong><span>${escapeHtml(row.campo_nome || '-')}</span></div>
          </div>
          <div class="price-history-change">
            <span>${escapeHtml(formatHistoryValue(row.campo_chave, row.valor_anterior))}</span>
            <i class="fa-solid fa-arrow-right"></i>
            <strong>${escapeHtml(formatHistoryValue(row.campo_chave, row.valor_novo))}</strong>
          </div>
          <div class="price-history-meta">
            <span><i class="fa-regular fa-user"></i> ${escapeHtml(row.usuario_nome || '-')}</span>
            <span><i class="fa-regular fa-clock"></i> ${escapeHtml(formatHistoryDate(row.criado_em))}</span>
            ${row.motivo ? `<span class="price-history-reason"><i class="fa-regular fa-comment"></i> ${escapeHtml(row.motivo)}</span>` : ''}
          </div>
        </article>
      `).join('');
    } catch (error) {
      list.innerHTML = `<div class="empty-state is-error">${escapeHtml(error.message || 'Erro ao carregar histórico.')}</div>`;
    }
  }

  async function abrirHistoricoPrecos() {
    const select = $('historico-preco-produto');
    if (select) {
      const current = select.value;
      const products = [...atualizacaoPrecosItens].sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
      select.innerHTML = '<option value="">Todos os produtos</option>' + products.map((product) => (
        `<option value="${escapeHtml(product.id)}">${escapeHtml(`${product.codigo || ''} — ${product.nome || ''}`)}</option>`
      )).join('');
      select.value = current;
    }
    openModal('modal-historico-precos');
    await carregarHistoricoPrecos();
  }

  function fecharHistoricoPrecos() {
    closeModal('modal-historico-precos');
  }

  function bindEventosAtualizacaoPrecos() {
    $('btn-atualizacao-precos')?.addEventListener('click', abrirTelaAtualizacaoPrecos);
    $('btn-voltar-catalogo-produtos')?.addEventListener('click', fecharTelaAtualizacaoPrecos);
    $('btn-salvar-precos')?.addEventListener('click', salvarAlteracoesPrecos);
    $('btn-salvar-precos-barra')?.addEventListener('click', salvarAlteracoesPrecos);
    $('btn-descartar-precos')?.addEventListener('click', () => descartarAlteracoesPrecos({ ask: true }));
    $('btn-descartar-precos-barra')?.addEventListener('click', () => descartarAlteracoesPrecos({ ask: true }));
    $('btn-historico-precos')?.addEventListener('click', abrirHistoricoPrecos);
    $('btn-fechar-historico-precos')?.addEventListener('click', fecharHistoricoPrecos);
    $('historico-preco-produto')?.addEventListener('change', carregarHistoricoPrecos);

    const historyModal = $('modal-historico-precos');
    historyModal?.addEventListener('click', (event) => {
      if (event.target === historyModal) fecharHistoricoPrecos();
    });

    $('btn-colunas-precos')?.addEventListener('click', (event) => {
      event.stopPropagation();
      alternarSeletorColunasPrecos();
    });

    $('painel-colunas-precos')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const checkbox = event.target.closest('[data-price-column]');
      if (!checkbox) return;

      const key = String(checkbox.value || '');
      if (checkbox.checked) {
        colunasPrecosVisiveis.add(key);
      } else if (colunasPrecosVisiveis.size > 1) {
        colunasPrecosVisiveis.delete(key);
      } else {
        checkbox.checked = true;
        toast('Mantenha pelo menos uma coluna visível.', { error: true, ms: 2600 });
        return;
      }

      salvarPreferenciasColunasPrecos();
      atualizarAvisoCamposPrecos();
      clearTimeout(atualizacaoPrecosColunasTimer);
      atualizacaoPrecosColunasTimer = setTimeout(() => {
        carregarAtualizacaoPrecos({ offset: atualizacaoPrecosPage.offset, silent: false });
      }, 120);
    });

    $('btn-restaurar-colunas-precos')?.addEventListener('click', (event) => {
      event.stopPropagation();
      colunasPrecosVisiveis = new Set(camposPadraoAtualizacaoPrecos());
      salvarPreferenciasColunasPrecos();
      renderSeletorColunasPrecos();
      carregarAtualizacaoPrecos({ offset: atualizacaoPrecosPage.offset, silent: false });
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('#seletor-colunas-precos')) fecharSeletorColunasPrecos();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') fecharSeletorColunasPrecos();
    });

    const reloadPriceFilters = (delay = 0) => {
      clearTimeout(atualizacaoPrecosBuscaTimer);
      atualizacaoPrecosBuscaTimer = setTimeout(() => carregarAtualizacaoPrecos({ offset: 0, silent: true }), delay);
    };

    $('preco-filtro-busca')?.addEventListener('input', () => reloadPriceFilters(350));
    ['preco-filtro-situacao', 'preco-filtro-tipo', 'preco-filtro-origem', 'preco-filtro-categoria', 'preco-filtro-fornecedor', 'preco-filtro-fabricante']
      .forEach((id) => $(id)?.addEventListener('change', () => reloadPriceFilters(0)));

    $('btn-filtrar-precos')?.addEventListener('click', () => carregarAtualizacaoPrecos({ offset: 0 }));
    $('btn-limpar-filtros-precos')?.addEventListener('click', () => {
      ['preco-filtro-busca', 'preco-filtro-situacao', 'preco-filtro-tipo', 'preco-filtro-origem', 'preco-filtro-categoria', 'preco-filtro-fornecedor', 'preco-filtro-fabricante']
        .forEach((id) => { if ($(id)) $(id).value = ''; });
      carregarAtualizacaoPrecos({ offset: 0 });
    });

    const priceTableBody = $('tbody-atualizacao-precos');
    const handlePriceInput = (event) => {
      const input = event.target.closest('[data-price-input]');
      if (input) registrarAlteracaoPreco(input);
    };
    priceTableBody?.addEventListener('input', handlePriceInput);
    priceTableBody?.addEventListener('change', handlePriceInput);

    document.querySelectorAll('[data-pagination="atualizacao-precos"]').forEach((wrap) => {
      wrap.addEventListener('click', (event) => {
        const button = event.target.closest('[data-price-page]');
        if (!button || button.disabled) return;
        const offset = Number(atualizacaoPrecosPage.offset || 0);
        const limit = Number(atualizacaoPrecosPage.limit || ATUALIZACAO_PRECOS_LIMITE_PAGINA);
        const total = Number(atualizacaoPrecosPage.total || 0);
        const lastOffset = Math.max(0, (Math.max(1, Math.ceil(total / limit)) - 1) * limit);
        let nextOffset = offset;
        if (button.dataset.pricePage === 'first') nextOffset = 0;
        if (button.dataset.pricePage === 'prev') nextOffset = Math.max(0, offset - limit);
        if (button.dataset.pricePage === 'next') nextOffset = Math.min(lastOffset, offset + limit);
        if (button.dataset.pricePage === 'last') nextOffset = lastOffset;
        carregarAtualizacaoPrecos({ offset: nextOffset });
      });
    });

    window.addEventListener('beforeunload', (event) => {
      if (!alteracoesPrecos.size) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function bindEventos() {
    desativarValidacaoGlobalProduto();
    bindEventosAtualizacaoPrecos();
    const modalProdutoBackdrop = $('modal-produto-backdrop');
    const confirmBackdrop = $('Valora-confirm-backdrop');

    ensureFichaProdutoController();

    document.addEventListener('click', (event) => {
      const tabBtn = event.target.closest('.produto-tab-btn[data-tab]');
      if (!tabBtn) return;
      switchProdutoTab(tabBtn.dataset.tab);
    });

    $('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
    $('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

    confirmBackdrop?.addEventListener('click', (event) => {
      if (event.target === confirmBackdrop) closeConfirm(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;

      if (confirmBackdrop?.classList.contains('show')) {
        closeConfirm(false);
        return;
      }

      if (modalProdutoBackdrop?.classList.contains('show')) {
        fecharModalProduto();
      }
    });

    let produtosBuscaTimer = null;

    const recarregarProdutosFiltro = (delay = 350) => {
      clearTimeout(produtosBuscaTimer);
      produtosBuscaTimer = setTimeout(() => {
        carregarProdutos({ offset: 0, silent: true });
      }, delay);
    };

    $('busca-produtos')?.addEventListener('input', () => recarregarProdutosFiltro(350));
    $('filtro-categoria-produtos')?.addEventListener('input', () => recarregarProdutosFiltro(350));
    $('filtro-ativo-produtos')?.addEventListener('change', () => recarregarProdutosFiltro(0));
    window.ValoraLocalizarPersonalizado?.bindFilters?.('localizar-personalizado-produtos', () => recarregarProdutosFiltro(0));

    $('btn-filtrar-produtos')?.addEventListener('click', () => carregarProdutos({ offset: 0 }));
    $('btn-limpar-filtros-produtos')?.addEventListener('click', () => {
      if ($('busca-produtos')) $('busca-produtos').value = '';
      if ($('filtro-categoria-produtos')) $('filtro-categoria-produtos').value = '';
      if ($('filtro-ativo-produtos')) $('filtro-ativo-produtos').value = '';
      window.ValoraLocalizarPersonalizado?.clearFilters?.('localizar-personalizado-produtos');
      carregarProdutos({ offset: 0 });
    });

    document.querySelectorAll('[data-pagination="produtos"]').forEach((wrap) => {
      wrap.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-page-action]');
        if (!btn || btn.disabled) return;

        const limit = Number(produtosPage.limit || 50);
        const total = Number(produtosPage.total || 0);
        const paginas = Math.max(1, Math.ceil(total / limit));
        const lastOffset = Math.max(0, (paginas - 1) * limit);
        let offset = Number(produtosPage.offset || 0);

        if (btn.dataset.pageAction === 'first') offset = 0;
        if (btn.dataset.pageAction === 'prev') offset = Math.max(0, offset - limit);
        if (btn.dataset.pageAction === 'next') offset = Math.min(lastOffset, offset + limit);
        if (btn.dataset.pageAction === 'last') offset = lastOffset;

        carregarProdutos({ offset });
      });
    });

    $('btn-novo-produto')?.addEventListener('click', abrirModalProdutoNovo);
    $('btn-fechar-modal-produto')?.addEventListener('click', fecharModalProduto);
    $('btn-cancelar-produto')?.addEventListener('click', fecharModalProduto);
    $('btn-salvar-produto')?.addEventListener('click', salvarProduto);
    $('toggle-ficha-principal-produto')?.addEventListener('change', salvarToggleFichaPrincipalProduto);
    $('btn-atualizar-formulario-produto')?.addEventListener('click', atualizarFormularioProduto);
    $('btn-gerenciar-formulario-produto')?.addEventListener('click', abrirGerenciadorFormulario);

    $('formProduto')?.addEventListener('submit', (event) => {
      event.preventDefault();
      salvarProduto();
    });

    modalProdutoBackdrop?.addEventListener('click', (event) => {
      if (event.target === modalProdutoBackdrop) fecharModalProduto();
    });

    $('btn-exportar-produtos-json')?.addEventListener('click', exportarProdutosJSON);
    $('btn-exportar-produtos-csv')?.addEventListener('click', exportarProdutosCSV);

    const inputImport = $('input-importar-produtos');

    $('btn-importar-produtos')?.addEventListener('click', () => {
      if (inputImport) inputImport.click();
      else toast('Faltou o input de importação.', { error: true, ms: 4200 });
    });

    inputImport?.addEventListener('change', async () => {
      const file = inputImport.files && inputImport.files[0] ? inputImport.files[0] : null;
      await importarProdutosArquivo(file);
      inputImport.value = '';
    });

    $('tbody-produtos')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action][data-id]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = Number(btn.dataset.id);
      if (!id) return;

      if (action === 'visualizar') {
        try {
          const full = await obterProdutoNoServidor(id);
          await abrirModalProdutoVisualizar(full);
        } catch (err) {
          console.error('[Produtos] erro ao abrir produto:', err);
          toast(err.message || 'Não foi possível abrir o produto.', { error: true, ms: 5000 });
        }
        return;
      }

      if (action === 'editar') {
        try {
          const full = await obterProdutoNoServidor(id);
          await abrirModalProdutoEditar(full);
        } catch (err) {
          console.error('[Produtos] erro ao abrir produto:', err);
          toast(err.message || 'Não foi possível abrir o produto.', { error: true, ms: 5000 });
        }
        return;
      }

      if (action === 'excluir') {
        const ok = await confirmDialog({
          title: 'Excluir produto',
          message: 'Deseja realmente excluir este produto?',
          confirmText: 'Excluir',
          cancelText: 'Cancelar',
          danger: true,
        });

        if (!ok) return;

        try {
          await excluirProdutoNoServidor(id);
          await carregarProdutos();
          toast('Produto excluído.', { ms: 1800 });
        } catch (err) {
          console.error('[Produtos] erro ao excluir:', err);
          toast(err.message || 'Erro ao excluir produto.', { error: true, ms: 5000 });
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEventos();

    try {
      await carregarFormularioProdutos({ loadingContainer: '#custom-fields-container' });
      await window.ValoraLocalizarPersonalizado?.setup?.({
        modulo: 'produtos',
        filtersContainerId: 'localizar-personalizado-produtos',
      });
      await renderCustomFieldsInputs({});
      await carregarProdutos();
    } catch (err) {
      console.error('[Produtos] erro ao iniciar:', err);
      await carregarProdutos();
      toast(err.message || 'Erro ao carregar ficha de produtos.', { error: true, ms: 5000 });
      return;
    }

    try {
      const agenda = await window.ValoraAgendaReady;
      const pending = agenda?.consumePendingNavigation?.();
      if (pending?.type === 'produto' && Number(pending.entityId)) {
        const full = await obterProdutoNoServidor(Number(pending.entityId));
        await abrirModalProdutoEditar(full);
        document.querySelector('[data-agenda-fixed-open="tab-produto-agenda"]')?.click();
      }
    } catch (err) {
      console.warn('[Produtos] não foi possível abrir o cadastro pelo lembrete:', err);
    }
  });
})();
