(() => {
  'use strict';

  const API_BASE = '/api/formularios';

  /*
    IMPORTANTE:
    Aqui deixei customEndpoint como null para todos os módulos.
    Assim o Formulários não tenta buscar rotas que não existem,
    como /api/campos-fornecedores, e não trava a tela.
  */
  const MODULOS = {
    clientes: {
      label: 'Clientes',
      icon: 'fa-user-group',
      customEndpoint: null,
    },
    fornecedores: {
      label: 'Fornecedores',
      icon: 'fa-truck',
      customEndpoint: null,
    },
    produtos: {
      label: 'Produtos',
      icon: 'fa-box-open',
      customEndpoint: null,
    },
    patrimonio: {
      label: 'Patrimônio',
      icon: 'fa-tags',
      customEndpoint: null,
    },
    cotacoes: {
      label: 'Cotações',
      icon: 'fa-scale-balanced',
      customEndpoint: null,
    },
    propostas: {
      label: 'Propostas',
      icon: 'fa-file-signature',
      customEndpoint: null,
    },
    contratos: {
      label: 'Contratos',
      icon: 'fa-file-contract',
      customEndpoint: null,
    },
  };

  const ICONES_SECOES = [
    { value: 'fa-id-card', label: 'Cadastro / Dados básicos' },
    { value: 'fa-address-book', label: 'Contato' },
    { value: 'fa-house', label: 'Imóvel / Endereço' },
    { value: 'fa-location-dot', label: 'Localização' },
    { value: 'fa-user-shield', label: 'Responsável / Titular' },
    { value: 'fa-building', label: 'Empresa / Pessoa jurídica' },
    { value: 'fa-user-gear', label: 'Administrativo / Gerência' },
    { value: 'fa-wallet', label: 'Financeiro / Cobrança' },
    { value: 'fa-credit-card', label: 'Pagamento' },
    { value: 'fa-share-nodes', label: 'Redes sociais' },
    { value: 'fa-file-signature', label: 'Contratos / Assinatura' },
    { value: 'fa-scale-balanced', label: 'Jurídico / Legal' },
    { value: 'fa-tags', label: 'Classificação / Categoria' },
    { value: 'fa-briefcase', label: 'Comercial' },
    { value: 'fa-folder-open', label: 'Dados adicionais' },
    { value: 'fa-sliders', label: 'Campos personalizados' },
    { value: 'fa-clipboard-list', label: 'Ocorrências / Registros' },
    { value: 'fa-paperclip', label: 'Anexos / Documentos' },
    { value: 'fa-clock-rotate-left', label: 'Histórico' },
    { value: 'fa-list-check', label: 'Checklist' },
    { value: 'fa-box', label: 'Produto / Item' },
    { value: 'fa-barcode', label: 'Código / Série' },
    { value: 'fa-truck', label: 'Fornecedor / Entrega' },
    { value: 'fa-file-contract', label: 'Contrato formal' },
    { value: 'fa-circle-info', label: 'Informações' },
    { value: 'fa-triangle-exclamation', label: 'Aviso / Atenção' },
    { value: 'fa-layer-group', label: 'Padrão / Outro' },
  ];

  const state = {
    modulo: getInitialModulo(),
    modelos: [],
    modeloAtual: null,
    camposSistema: [],
    camposPersonalizados: [],
    campoEditando: null,
    secaoEditando: null,
    modeloEditando: null,
  };

  const qs = (id) => document.getElementById(id);

  function getInitialModulo() {
    const params = new URLSearchParams(window.location.search);
    const modulo = params.get('modulo') || 'clientes';
    return MODULOS[modulo] ? modulo : 'clientes';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toast(message, error = false, ms = 2800) {
    const el = qs('valora-toast');
    if (!el) return;

    el.textContent = message || '';
    el.classList.toggle('is-error', !!error);
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

      throw new Error(detail);
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  function openModal(id) {
    if (window.ValoraModal) return window.ValoraModal.open(id);

    const modal = document.getElementById(id);
    if (!modal) return;

    modal.hidden = false;
    modal.style.display = 'flex';

    requestAnimationFrame(() => modal.classList.add('show'));
  }

  function closeModal(id) {
    if (window.ValoraModal) return window.ValoraModal.close(id);

    const modal = document.getElementById(id);
    if (!modal) return;

    modal.classList.remove('show');

    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';
    }, 160);
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.show').forEach((modal) => {
      modal.classList.remove('show');
    });
  }

  function setLoadingSelect(select, text = 'Carregando...') {
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(text)}</option>`;
  }

  function moduloLabel(modulo = state.modulo) {
    return MODULOS[modulo]?.label || modulo;
  }

  function origemLabel(origem) {
    const map = {
      sistema: 'Sistema',
      personalizado: 'Personalizado',
      visual: 'Visual',
    };

    return map[origem] || origem || '-';
  }

  function tipoLabel(campo) {
    if (!campo) return '-';
    if (campo.origem === 'visual') return campo.tipo_visual || 'visual';
    return campo.tipo_campo || 'texto';
  }

  function widthLabel(width) {
    if (!width) return '100%';
    if (String(width).includes('%')) return width;
    if (/^\d+$/.test(String(width))) return `${width}%`;
    return width;
  }

  function parseOpcoes(raw) {
    return String(raw || '')
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function opcoesToInput(value) {
    if (!value) return '';

    if (Array.isArray(value)) return value.join('\n');

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.join('\n');
      } catch (_) {}

      return value.replaceAll(',', '\n');
    }

    return '';
  }

  function normalizarTextoIcone(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizarIconeSecao(icone) {
    let value = String(icone || '').trim();

    if (!value) return '';

    value = value
      .replaceAll('fa-solid', '')
      .replaceAll('fas', '')
      .replaceAll('far', '')
      .trim();

    if (!value.startsWith('fa-')) return '';

    return value;
  }

  function iconeFallbackSecao(titulo = '') {
    const t = normalizarTextoIcone(titulo);

    if (!t) return 'fa-layer-group';

    if (
      t.includes('dados basicos') ||
      t.includes('basico') ||
      t.includes('cadastro') ||
      t.includes('identificacao') ||
      t.includes('principal')
    ) {
      return 'fa-id-card';
    }

    if (
      t.includes('imovel') ||
      t.includes('endereco') ||
      t.includes('residencia') ||
      t.includes('casa') ||
      t.includes('local')
    ) {
      return 'fa-house';
    }

    if (
      t.includes('titular responsavel') ||
      t.includes('responsavel legal') ||
      t.includes('responsavel') ||
      t.includes('titular')
    ) {
      return 'fa-user-shield';
    }

    if (
      t.includes('pessoa juridica') ||
      t.includes('juridica') ||
      t.includes('cnpj') ||
      t.includes('empresa')
    ) {
      return 'fa-building';
    }

    if (
      t.includes('administrativo') ||
      t.includes('administracao') ||
      t.includes('gerencia') ||
      t.includes('gerente')
    ) {
      return 'fa-user-gear';
    }

    if (
      t.includes('financeiro') ||
      t.includes('cobranca') ||
      t.includes('pagamento') ||
      t.includes('boleto') ||
      t.includes('pix') ||
      t.includes('cartao')
    ) {
      return 'fa-wallet';
    }

    if (
      t.includes('redes sociais') ||
      t.includes('rede social') ||
      t.includes('social') ||
      t.includes('instagram') ||
      t.includes('facebook') ||
      t.includes('linkedin') ||
      t.includes('site')
    ) {
      return 'fa-share-nodes';
    }

    if (
      t.includes('contrato') ||
      t.includes('contratos') ||
      t.includes('emissao') ||
      t.includes('assinatura')
    ) {
      return 'fa-file-signature';
    }

    if (
      t.includes('legal') ||
      t.includes('legais') ||
      t.includes('juridico') ||
      t.includes('lgpd')
    ) {
      return 'fa-scale-balanced';
    }

    if (
      t.includes('classificacao') ||
      t.includes('categoria') ||
      t.includes('segmento') ||
      t.includes('tipo')
    ) {
      return 'fa-tags';
    }

    if (
      t.includes('contato') ||
      t.includes('telefone') ||
      t.includes('whatsapp') ||
      t.includes('email')
    ) {
      return 'fa-address-book';
    }

    if (
      t.includes('comercial') ||
      t.includes('venda') ||
      t.includes('negociacao')
    ) {
      return 'fa-briefcase';
    }

    if (
      t.includes('ocorrencia') ||
      t.includes('historico') ||
      t.includes('registro')
    ) {
      return 'fa-clipboard-list';
    }

    if (
      t.includes('anexo') ||
      t.includes('arquivo') ||
      t.includes('documento')
    ) {
      return 'fa-paperclip';
    }

    if (
      t.includes('personalizado') ||
      t.includes('campo')
    ) {
      return 'fa-sliders';
    }

    return 'fa-layer-group';
  }

  function getIconeSecao(secao) {
    return normalizarIconeSecao(secao?.icone) || iconeFallbackSecao(secao?.titulo);
  }

  function getIconeOptionsComSelecionado(selectedValue = '') {
    const selected = normalizarIconeSecao(selectedValue);
    const exists = ICONES_SECOES.some((item) => item.value === selected);
    const options = [...ICONES_SECOES];

    if (selected && !exists) {
      options.unshift({
        value: selected,
        label: selected,
      });
    }

    return { selected, options };
  }

  function renderIconeSecaoPicker(selectedValue = '') {
    const picker = qs('secao-icones-picker');
    if (!picker) return;

    const { selected, options } = getIconeOptionsComSelecionado(selectedValue || 'fa-layer-group');
    const selectedFinal = selected || 'fa-layer-group';

    picker.innerHTML = options.map((item) => {
      const active = item.value === selectedFinal ? 'is-active' : '';

      return `
        <button
          class="secao-icone-option ${active}"
          type="button"
          data-secao-icon="${escapeHtml(item.value)}"
          title="${escapeHtml(item.label)}"
          aria-label="${escapeHtml(item.label)}"
        >
          <i class="fa-solid ${escapeHtml(item.value)}"></i>
        </button>
      `;
    }).join('');
  }

  function marcarIconeSecaoAtivo(value = '') {
    const picker = qs('secao-icones-picker');
    if (!picker) return;

    const selected = normalizarIconeSecao(value) || 'fa-layer-group';

    picker.querySelectorAll('.secao-icone-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.secaoIcon === selected);
    });
  }

  function abrirPickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    const trigger = qs('btn-abrir-icones-secao');
    if (!popover || !trigger) return;

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');
  }

  function fecharPickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    const trigger = qs('btn-abrir-icones-secao');
    if (!popover || !trigger) return;

    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
  }

  function togglePickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    if (!popover) return;

    if (popover.hidden) {
      abrirPickerIconesSecao();
    } else {
      fecharPickerIconesSecao();
    }
  }

  function atualizarTriggerIconeSecao() {
    const select = qs('secao-icone');
    const icon = normalizarIconeSecao(select?.value) || 'fa-layer-group';
    const triggerIcon = document.querySelector('#btn-abrir-icones-secao .secao-icone-trigger-box i');
    const triggerText = qs('secao-icone-trigger-text');

    if (triggerIcon) {
      triggerIcon.className = `fa-solid ${icon}`;
    }

    if (triggerText) {
      triggerText.textContent = 'Escolher ícone';
    }
  }

  function selecionarIconeSecao(value = '') {
    const icon = normalizarIconeSecao(value) || 'fa-layer-group';
    const select = qs('secao-icone');

    if (select) {
      const hasOption = Array.from(select.options || []).some((opt) => opt.value === icon);

      if (!hasOption) {
        const opt = document.createElement('option');
        opt.value = icon;
        opt.textContent = icon;
        select.prepend(opt);
      }

      select.value = icon;
    }

    marcarIconeSecaoAtivo(icon);
    atualizarPreviewIconeSecao();
    atualizarTriggerIconeSecao();
    fecharPickerIconesSecao();
  }

  function renderIconeSecaoOptions(selectedValue = '') {
    const select = qs('secao-icone');
    if (!select) return;

    const { selected, options } = getIconeOptionsComSelecionado(selectedValue);

    select.innerHTML = options.map((item) => {
      const isSelected = item.value === selected ? 'selected' : '';

      return `
        <option value="${escapeHtml(item.value)}" ${isSelected}>
          ${escapeHtml(item.label)} — ${escapeHtml(item.value)}
        </option>
      `;
    }).join('');

    renderIconeSecaoPicker(selected || 'fa-layer-group');
  }

  function atualizarPreviewIconeSecao() {
    const select = qs('secao-icone');
    const titulo = qs('secao-titulo')?.value || state.secaoEditando?.titulo || '';
    const icon = normalizarIconeSecao(select?.value) || iconeFallbackSecao(titulo);

    const previewIcon = document.querySelector('#secao-icone-preview i');
    const previewText = qs('secao-icone-preview-text');

    if (previewIcon) {
      previewIcon.className = `fa-solid ${icon}`;
    }

    if (previewText) {
      previewText.textContent = 'Ícone selecionado';
    }

    marcarIconeSecaoAtivo(icon);
    atualizarTriggerIconeSecao();
  }

  function getSecoes() {
    return Array.isArray(state.modeloAtual?.secoes) ? state.modeloAtual.secoes : [];
  }

  function getAllCampos() {
    const direto = Array.isArray(state.modeloAtual?.campos) ? state.modeloAtual.campos : [];
    const semSecao = Array.isArray(state.modeloAtual?.campos_sem_secao) ? state.modeloAtual.campos_sem_secao : [];

    const emSecoes = getSecoes().flatMap((secao) => {
      return Array.isArray(secao.campos) ? secao.campos : [];
    });

    const map = new Map();

    [...direto, ...semSecao, ...emSecoes].forEach((campo) => {
      if (campo?.id != null) {
        map.set(Number(campo.id), campo);
      }
    });

    return [...map.values()];
  }

  async function carregarModelos() {
    const data = await apiJson(`${API_BASE}/modelos?modulo=${encodeURIComponent(state.modulo)}`);
    state.modelos = Array.isArray(data) ? data : [];

    renderModelosSelect();

    if (state.modelos.length) {
      const fichaPrincipal = state.modelos.find((m) => m.usar_como_ficha_principal);
      const padrao = state.modelos.find((m) => m.padrao);
      const escolhido = fichaPrincipal || padrao || state.modelos[0];

      await carregarModeloCompleto(escolhido.id);
    } else {
      state.modeloAtual = null;
      renderModeloAtual();
    }
  }

  async function carregarModeloCompleto(id) {
    if (!id) {
      state.modeloAtual = null;
      renderModeloAtual();
      return;
    }

    const data = await apiJson(`${API_BASE}/modelos/${id}`);
    state.modeloAtual = data;

    const select = qs('select-modelo');

    if (select) {
      select.value = String(id);
    }

    renderModeloAtual();
  }

  async function garantirModeloAtual() {
    let modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (modeloId) {
      if (!state.modeloAtual?.modelo?.id) {
        await carregarModeloCompleto(modeloId);
      }

      return state.modeloAtual?.modelo?.id || modeloId;
    }

    const data = await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    await carregarModelos();

    modeloId = data?.modelo?.id || state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (modeloId) {
      await carregarModeloCompleto(modeloId);
      return modeloId;
    }

    throw new Error('Não foi possível criar ou selecionar o formulário padrão.');
  }

  async function garantirSecaoPadrao() {
    const modeloId = await garantirModeloAtual();

    if (getSecoes().length) {
      return true;
    }

    await apiJson(`${API_BASE}/modelos/${modeloId}/secoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: 'Dados principais',
        descricao: 'Campos principais do cadastro.',
        icone: 'fa-id-card',
        ordem: 1,
        ativo: true,
      }),
    });

    await carregarModeloCompleto(modeloId);

    return true;
  }

  async function carregarCamposSistema() {
    try {
      const data = await apiJson(`${API_BASE}/campos-sistema?modulo=${encodeURIComponent(state.modulo)}`);
      state.camposSistema = Array.isArray(data?.campos) ? data.campos : [];
    } catch (err) {
      console.error('[Formulários] erro ao carregar campos do sistema:', err);
      state.camposSistema = [];
    }

    renderCampoSistemaSelect();
  }

  async function carregarCamposPersonalizados() {
    const endpoint = MODULOS[state.modulo]?.customEndpoint;

    if (!endpoint) {
      state.camposPersonalizados = [];
      renderCampoPersonalizadoSelect();
      return;
    }

    try {
      const data = await apiJson(endpoint);
      state.camposPersonalizados = Array.isArray(data) ? data : [];

      state.camposPersonalizados.sort((a, b) => {
        return Number(a.ordem || 0) - Number(b.ordem || 0) ||
          String(a.nome || '').localeCompare(String(b.nome || ''));
      });
    } catch (err) {
      console.warn('[Formulários] não foi possível carregar campos personalizados:', err);
      state.camposPersonalizados = [];
    }

    renderCampoPersonalizadoSelect();
  }

  function renderModelosSelect() {
    const select = qs('select-modelo');
    if (!select) return;

    if (!state.modelos.length) {
      select.innerHTML = '<option value="">Nenhum formulário criado</option>';
      return;
    }

    select.innerHTML = state.modelos.map((modelo) => {
      const badges = [];

      if (modelo.padrao) {
        badges.push('padrão');
      }

      if (modelo.usar_como_ficha_principal) {
        badges.push('ficha principal');
      }

      const badgeText = badges.length ? ` • ${badges.join(' • ')}` : '';

      return `<option value="${modelo.id}">${escapeHtml(modelo.nome)}${escapeHtml(badgeText)}</option>`;
    }).join('');
  }

  function renderModeloAtual() {
    const modelo = state.modeloAtual?.modelo || null;

    const moduloTitulo = qs('modulo-titulo');
    const modeloNome = qs('modelo-nome');
    const modeloDescricao = qs('modelo-descricao');

    if (moduloTitulo) moduloTitulo.textContent = moduloLabel();

    if (modeloNome) {
      modeloNome.textContent = modelo ? modelo.nome : 'Nenhum formulário selecionado';
    }

    if (modeloDescricao) {
      if (!modelo) {
        modeloDescricao.textContent = 'Crie um formulário padrão para começar.';
      } else {
        const flags = [];

        if (modelo.padrao) {
          flags.push('formulário padrão');
        }

        if (modelo.usar_como_ficha_principal) {
          flags.push('ficha principal do cadastro');
        }

        const fallback = flags.length
          ? `${moduloLabel()} • ${flags.join(' • ')}`
          : `${moduloLabel()} • formulário personalizado`;

        modeloDescricao.textContent = modelo.descricao || fallback;
      }
    }

    const hasModelo = !!(modelo?.id || qs('select-modelo')?.value);

    const btnEditar = qs('btn-editar-modelo');
    const btnNovaSecao = qs('btn-nova-secao');
    const btnCampoSistema = qs('btn-campo-sistema');
    const btnNovoCampo = qs('btn-novo-campo');

    if (btnEditar) btnEditar.disabled = !hasModelo;

    if (btnNovaSecao) btnNovaSecao.disabled = false;
    if (btnCampoSistema) btnCampoSistema.disabled = false;
    if (btnNovoCampo) btnNovoCampo.disabled = false;

    const empty = qs('builder-empty');
    const wrap = qs('secoes-container');

    if (!modelo) {
      if (empty) empty.style.display = '';
      if (wrap) wrap.innerHTML = '';
      return;
    }

    if (empty) empty.style.display = 'none';

    renderSecoes();
    renderSecaoSelect();
  }

  function camposOrdenados(campos = []) {
    return [...campos].sort((a, b) => {
      return Number(a.ordem || 0) - Number(b.ordem || 0) ||
        Number(a.id || 0) - Number(b.id || 0);
    });
  }

  function renderSecoes() {
    const wrap = qs('secoes-container');
    if (!wrap) return;

    const atual = state.modeloAtual;

    if (!atual?.modelo) {
      wrap.innerHTML = '';
      return;
    }

    const secoes = getSecoes();
    const camposSemSecao = Array.isArray(atual.campos_sem_secao) ? atual.campos_sem_secao : [];

    if (!secoes.length && !camposSemSecao.length) {
      wrap.innerHTML = `
        <div class="builder-empty panel-card">
          <i class="fa-solid fa-folder-open"></i>
          <strong>Este formulário ainda está vazio.</strong>
          <span>Crie uma seção primeiro. Depois coloque campos dentro dela.</span>
        </div>
      `;
      return;
    }

    let html = '';

    secoes.forEach((secao) => {
      html += renderSecaoCard(secao);
    });

    if (camposSemSecao.length) {
      html += renderSecaoCard({
        id: '',
        titulo: 'Campos sem seção',
        descricao: 'Campos antigos que ainda não foram organizados em uma seção.',
        icone: 'fa-layer-group',
        ativo: true,
        campos: camposSemSecao,
        semSecao: true,
      });
    }

    wrap.innerHTML = html;
  }

  function renderSecaoCard(secao) {
    const campos = camposOrdenados(secao.campos || []);
    const inactive = secao.ativo === false ? '<span class="badge off">Inativa</span>' : '';
    const icon = getIconeSecao(secao);

    const actions = secao.semSecao ? '' : `
      <div class="secao-actions">
        <button class="icon-btn" type="button" data-action="editar-secao" data-id="${secao.id}" title="Editar seção">
          <i class="fa-solid fa-pen"></i>
        </button>

        <button class="icon-btn danger" type="button" data-action="excluir-secao" data-id="${secao.id}" title="Excluir seção">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    const camposHtml = campos.length
      ? campos.map(renderCampoCard).join('')
      : `<div class="empty-section">Nenhum campo nesta seção ainda.</div>`;

    return `
      <article class="secao-card">
        <div class="secao-head">
          <div class="secao-title-wrap">
            <h4 class="secao-title">
              <i class="fa-solid ${escapeHtml(icon)}"></i>
              <span>${escapeHtml(secao.titulo || 'Seção')}</span>
              ${inactive}
            </h4>

            ${secao.descricao ? `<p class="secao-desc">${escapeHtml(secao.descricao)}</p>` : ''}
          </div>

          ${actions}
        </div>

        <div class="campos-list">
          ${camposHtml}
        </div>
      </article>
    `;
  }

  function renderCampoCard(campo) {
    const origem = campo.origem || 'personalizado';
    const badgeClass = origem === 'sistema' ? 'system' : origem === 'visual' ? 'visual' : 'custom';

    const inactive = campo.ativo === false ? '<span class="badge off">Inativo</span>' : '';
    const required = campo.obrigatorio ? '<span class="badge">Obrigatório</span>' : '';
    const readonly = campo.somente_leitura ? '<span class="badge">Somente leitura</span>' : '';

    const detalhes = [
      `Origem: ${origemLabel(origem)}`,
      `Tipo: ${tipoLabel(campo)}`,
      `Largura: ${widthLabel(campo.largura)}`,
      `Ordem: ${Number(campo.ordem || 0)}`,
      campo.visibilidade && campo.visibilidade !== 'todos' ? `Visibilidade: ${campo.visibilidade}` : '',
    ].filter(Boolean);

    return `
      <div class="campo-card">
        <div class="campo-main">
          <div class="campo-title">
            <span class="badge ${badgeClass}">
              <i class="fa-solid ${origem === 'visual' ? 'fa-heading' : origem === 'sistema' ? 'fa-database' : 'fa-pen-to-square'}"></i>
              ${escapeHtml(origemLabel(origem))}
            </span>

            <strong>${escapeHtml(campo.label || '-')}</strong>

            ${required}
            ${readonly}
            ${inactive}
          </div>

          <div class="campo-meta">
            ${detalhes.map((d) => `<span>${escapeHtml(d)}</span>`).join('')}
          </div>

          ${campo.ajuda ? `<div class="campo-ajuda">${escapeHtml(campo.ajuda)}</div>` : ''}
        </div>

        <div class="campo-actions">
          <button class="icon-btn" type="button" data-action="editar-campo" data-id="${campo.id}" title="Editar campo">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button class="icon-btn danger" type="button" data-action="excluir-campo" data-id="${campo.id}" title="Excluir campo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  function renderSecaoSelect(selectedId = '') {
    const select = qs('campo-secao');
    if (!select) return;

    const secoes = getSecoes();

    if (!secoes.length) {
      select.innerHTML = '<option value="">Crie uma seção antes</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione uma seção</option>' + secoes.map((secao) => {
      const selected = String(selectedId || '') === String(secao.id) ? 'selected' : '';
      return `<option value="${secao.id}" ${selected}>${escapeHtml(secao.titulo)}</option>`;
    }).join('');
  }

  function renderCampoSistemaSelect(selectedValue = '') {
    const select = qs('campo-sistema');
    if (!select) return;

    if (!state.camposSistema.length) {
      select.innerHTML = '<option value="">Nenhum campo do sistema encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposSistema.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.campo || '') ? 'selected' : '';

      return `
        <option
          value="${escapeHtml(campo.campo)}"
          data-label="${escapeHtml(campo.label)}"
          data-tipo="${escapeHtml(campo.tipo || 'texto')}"
          ${selected}
        >
          ${escapeHtml(campo.label)} (${escapeHtml(campo.campo)})
        </option>
      `;
    }).join('');
  }

  function renderCampoPersonalizadoSelect(selectedValue = '') {
    const select = qs('campo-personalizado');
    if (!select) return;

    if (!state.camposPersonalizados.length) {
      select.innerHTML = '<option value="">Nenhum campo personalizado encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposPersonalizados.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.id || '') ? 'selected' : '';

      return `
        <option
          value="${campo.id}"
          data-label="${escapeHtml(campo.nome || '')}"
          data-tipo="${escapeHtml(campo.tipo || 'texto')}"
          ${selected}
        >
          ${escapeHtml(campo.nome || '-')} (${escapeHtml(campo.slug || campo.id)})
        </option>
      `;
    }).join('');
  }

  function atualizarCampoPreview() {
    const previewLabel = qs('campo-preview-label');
    const previewHint = qs('campo-preview-hint');
    const previewIcon = document.querySelector('#campo-preview .campo-preview-icon i');

    if (!previewLabel || !previewHint) return;

    const origem = qs('campo-origem')?.value || 'personalizado';

    let texto = '';
    let dica = '';
    let icon = 'fa-pen-to-square';

    if (origem === 'sistema') {
      const opt = qs('campo-sistema')?.selectedOptions?.[0];
      texto = opt?.dataset?.label || opt?.textContent || '';
      dica = 'Campo do sistema: usa informação que já existe no cadastro.';
      icon = 'fa-database';
    } else if (origem === 'visual') {
      texto = qs('campo-label')?.value || qs('campo-tipo-visual')?.value || '';
      dica = 'Item visual: título, aviso ou separador para organizar o formulário.';
      icon = 'fa-heading';
    } else {
      texto = qs('campo-label')?.value || '';
      const tipo = qs('campo-tipo-campo')?.selectedOptions?.[0]?.textContent || 'Texto';
      dica = `Novo campo personalizado • Tipo: ${tipo}`;
      icon = 'fa-pen-to-square';
    }

    texto = String(texto || '').replace(/\s*\(.+\)\s*$/, '').trim();

    previewLabel.textContent = texto || (origem === 'sistema' ? 'Nenhum campo selecionado' : 'Novo campo personalizado');

    previewHint.textContent = texto
      ? dica
      : (origem === 'sistema'
        ? 'Escolha o campo do sistema que entrará no formulário.'
        : 'Digite o nome do campo para ver como ele ficará no formulário.');

    if (previewIcon) {
      previewIcon.className = `fa-solid ${icon}`;
    }
  }

  function syncCampoOpcoesVisibility() {
    const tipo = qs('campo-tipo-campo')?.value || 'texto';
    const row = qs('campo-opcoes')?.closest('.form-group');
    if (!row) return;

    const shouldShow = tipo === 'select';
    row.hidden = !shouldShow;
    row.classList.toggle('is-hidden', !shouldShow);

    if (!shouldShow && !state.campoEditando) {
      const input = qs('campo-opcoes');
      if (input) input.value = '';
    }
  }

  function aplicarModoCampo(origem) {
    origem = origem || 'personalizado';

    const isSistema = origem === 'sistema';
    const isVisual = origem === 'visual';

    const rowSistema = qs('row-campo-sistema');
    const rowNovo = qs('row-campo-novo');
    const rowPersonalizado = qs('row-campo-personalizado');
    const rowVisual = qs('row-campo-visual');
    const guide = qs('campo-simple-guide');
    const title = qs('modal-campo-title');
    const subtitle = qs('modal-campo-subtitle');
    const btnSalvar = qs('btn-salvar-campo');

    if (rowSistema) rowSistema.style.display = isSistema ? '' : 'none';
    if (rowNovo) rowNovo.style.display = isSistema ? 'none' : '';
    if (rowPersonalizado) rowPersonalizado.style.display = 'none';
    if (rowVisual) rowVisual.style.display = isVisual ? '' : 'none';

    if (isSistema) {
      if (title) title.textContent = 'Adicionar campo do sistema';
      if (subtitle) subtitle.textContent = 'Escolha uma informação que já existe no cadastro e coloque dentro da seção.';
      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Adicionar campo';

      if (guide) {
        guide.innerHTML = `
          <strong>Adicionar campo do sistema</strong>
          <ol>
            <li>Escolha em qual seção o campo vai aparecer.</li>
            <li>Escolha uma informação já existente.</li>
            <li>Marque se é obrigatório e mantenha ativo.</li>
            <li>Salve.</li>
          </ol>
        `;
      }
    } else {
      if (title) title.textContent = isVisual ? 'Adicionar item visual' : 'Novo campo';

      if (subtitle) {
        subtitle.textContent = isVisual
          ? 'Crie um título, aviso ou separador para organizar o formulário.'
          : 'Crie uma nova informação personalizada para este formulário.';
      }

      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Criar campo';

      if (guide) {
        guide.innerHTML = `
          <strong>${isVisual ? 'Adicionar item visual' : 'Novo campo'}</strong>
          <ol>
            <li>Escolha em qual seção vai aparecer.</li>
            <li>${isVisual ? 'Digite o texto ou título.' : 'Digite o nome do novo campo.'}</li>
            <li>${isVisual ? 'Defina a ordem, se precisar.' : 'Escolha o tipo e marque se é obrigatório.'}</li>
            <li>Salve.</li>
          </ol>
        `;
      }
    }

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
  }

  function toggleCampoOrigem() {
    const origem = qs('campo-origem')?.value || 'personalizado';
    aplicarModoCampo(origem);
  }

  function preencherLabelPorSistema() {
    const opt = qs('campo-sistema')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';
    const nomeLimpo = label.replace(/\s*\(.+\)\s*$/, '').trim();

    if (nomeLimpo) qs('campo-label').value = nomeLimpo;
    qs('campo-tipo-campo').value = tipo || 'texto';

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
  }

  function preencherLabelPorPersonalizado() {
    const opt = qs('campo-personalizado')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';
    const nomeLimpo = label.replace(/\s*\(.+\)\s*$/, '').trim();

    if (nomeLimpo) qs('campo-label').value = nomeLimpo;
    qs('campo-tipo-campo').value = tipo || 'texto';

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
  }

  function resetModeloForm(edit = false) {
    state.modeloEditando = edit ? state.modeloAtual?.modelo : null;

    qs('modal-modelo-title').textContent = edit ? 'Editar formulário' : 'Novo formulário';
    qs('modelo-id').value = edit && state.modeloEditando ? state.modeloEditando.id : '';
    qs('modelo-modulo').value = edit && state.modeloEditando ? state.modeloEditando.modulo : state.modulo;
    qs('modelo-nome-input').value = edit && state.modeloEditando ? state.modeloEditando.nome || '' : '';
    qs('modelo-descricao-input').value = edit && state.modeloEditando ? state.modeloEditando.descricao || '' : '';
    qs('modelo-ativo').checked = edit && state.modeloEditando ? state.modeloEditando.ativo !== false : true;
    qs('modelo-padrao').checked = edit && state.modeloEditando ? !!state.modeloEditando.padrao : false;
    qs('modelo-ficha-principal').checked = edit && state.modeloEditando ? !!state.modeloEditando.usar_como_ficha_principal : false;
  }

  function resetSecaoForm(secao = null) {
    state.secaoEditando = secao;

    qs('modal-secao-title').textContent = secao ? 'Editar seção' : 'Nova seção';
    qs('secao-id').value = secao?.id || '';
    qs('secao-titulo').value = secao?.titulo || '';
    qs('secao-descricao').value = secao?.descricao || '';
    qs('secao-ordem').value = secao ? Number(secao.ordem || 0) : proximaOrdemSecao();
    qs('secao-ativo').checked = secao ? secao.ativo !== false : true;
    qs('btn-excluir-secao').style.display = secao ? '' : 'none';

    const icon = normalizarIconeSecao(secao?.icone) || iconeFallbackSecao(secao?.titulo || '');
    renderIconeSecaoOptions(icon);

    const selectIcon = qs('secao-icone');
    if (selectIcon) {
      selectIcon.value = icon;
    }

    atualizarPreviewIconeSecao();
  }

  function resetCampoForm(campo = null, modo = 'novo') {
    state.campoEditando = campo;

    const origemInicial = campo?.origem || (modo === 'sistema' ? 'sistema' : 'personalizado');

    qs('campo-id').value = campo?.id || '';
    qs('campo-modo').value = origemInicial === 'sistema' ? 'sistema' : 'novo';

    renderSecaoSelect(campo?.secao_id || '');
    renderCampoSistemaSelect(campo?.campo_sistema || '');
    renderCampoPersonalizadoSelect(campo?.campo_personalizado_id || '');

    qs('campo-secao').value = campo?.secao_id || '';
    qs('campo-origem').value = origemInicial;
    qs('campo-sistema').value = campo?.campo_sistema || '';
    qs('campo-personalizado').value = campo?.campo_personalizado_id || '';
    qs('campo-tipo-visual').value = campo?.tipo_visual || 'titulo';
    qs('campo-tipo-campo').value = campo?.tipo_campo || 'texto';
    qs('campo-label').value = campo?.label || '';
    qs('campo-placeholder').value = campo?.placeholder || '';
    qs('campo-ajuda').value = campo?.ajuda || '';
    qs('campo-largura').value = campo?.largura || (origemInicial === 'sistema' ? '50' : '100');
    qs('campo-visibilidade').value = campo?.visibilidade || 'todos';
    qs('campo-ordem').value = campo ? Number(campo.ordem || 0) : proximaOrdemCampo();
    qs('campo-opcoes').value = opcoesToInput(campo?.opcoes || campo?.opcoes_json || '');
    qs('campo-obrigatorio').checked = campo ? !!campo.obrigatorio : false;
    qs('campo-somente-leitura').checked = campo ? !!campo.somente_leitura : false;
    qs('campo-ativo').checked = campo ? campo.ativo !== false : true;
    qs('btn-excluir-campo').style.display = campo ? '' : 'none';

    const avancado = qs('campo-avancado');
    if (avancado) avancado.open = false;

    aplicarModoCampo(origemInicial);
    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
  }

  function proximaOrdemSecao() {
    const secoes = getSecoes();
    if (!secoes.length) return 1;
    return Math.max(...secoes.map((s) => Number(s.ordem || 0))) + 1;
  }

  function proximaOrdemCampo() {
    const campos = getAllCampos();
    if (!campos.length) return 1;
    return Math.max(...campos.map((c) => Number(c.ordem || 0))) + 1;
  }

  function buildModeloPayload() {
    return {
      modulo: qs('modelo-modulo').value,
      nome: qs('modelo-nome-input').value.trim(),
      descricao: qs('modelo-descricao-input').value.trim() || null,
      ativo: qs('modelo-ativo').checked,
      padrao: qs('modelo-padrao').checked,
      usar_como_ficha_principal: qs('modelo-ficha-principal').checked,
    };
  }

  function buildSecaoPayload() {
    const titulo = qs('secao-titulo').value.trim();
    const iconeSelecionado = normalizarIconeSecao(qs('secao-icone')?.value);

    return {
      titulo,
      descricao: qs('secao-descricao').value.trim() || null,
      icone: iconeSelecionado || iconeFallbackSecao(titulo),
      ordem: Number(qs('secao-ordem').value || 0),
      ativo: qs('secao-ativo').checked,
    };
  }

  function buildCampoPayload() {
    const origem = qs('campo-origem').value || 'personalizado';
    const opcoes = parseOpcoes(qs('campo-opcoes').value);

    const payload = {
      secao_id: qs('campo-secao').value ? Number(qs('campo-secao').value) : null,
      origem,
      campo_sistema: null,
      campo_personalizado_id: null,
      tipo_visual: null,
      tipo_campo: qs('campo-tipo-campo').value || 'texto',
      label: qs('campo-label').value.trim(),
      placeholder: qs('campo-placeholder').value.trim() || null,
      ajuda: qs('campo-ajuda').value.trim() || null,
      opcoes: opcoes.length ? opcoes : null,
      obrigatorio: qs('campo-obrigatorio').checked,
      somente_leitura: qs('campo-somente-leitura').checked,
      ativo: qs('campo-ativo').checked,
      largura: qs('campo-largura').value || '100',
      ordem: Number(qs('campo-ordem').value || 0),
      visibilidade: qs('campo-visibilidade').value || 'todos',
      condicao: null,
    };

    if (origem === 'sistema') {
      payload.campo_sistema = qs('campo-sistema').value || null;

      const opt = qs('campo-sistema')?.selectedOptions?.[0];
      const label = opt?.dataset?.label || opt?.textContent || '';
      const tipo = opt?.dataset?.tipo || payload.tipo_campo || 'texto';

      payload.label = payload.label || String(label).replace(/\s*\(.+\)\s*$/, '').trim();
      payload.tipo_campo = tipo;
    }

    if (origem === 'visual') {
      payload.tipo_visual = qs('campo-tipo-visual').value || 'titulo';
      payload.tipo_campo = null;
      payload.obrigatorio = false;
      payload.somente_leitura = true;
    }

    return payload;
  }

  async function salvarModelo() {
    const payload = buildModeloPayload();

    if (!payload.nome) {
      toast('Informe o nome do formulário.', true);
      return;
    }

    const id = qs('modelo-id').value;
    const btn = qs('btn-salvar-modelo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      let salvo;

      if (id) {
        salvo = await apiJson(`${API_BASE}/modelos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        salvo = await apiJson(`${API_BASE}/modelos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      state.modulo = salvo.modulo || payload.modulo;

      marcarModuloAtivo();

      await carregarModelos();

      if (salvo?.id) {
        await carregarModeloCompleto(salvo.id);
      }

      closeModal('modal-modelo');
      toast('Formulário salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar formulário.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar formulário';
    }
  }

  async function salvarSecao() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário antes de criar seção.', true);
      return;
    }

    const payload = buildSecaoPayload();

    if (!payload.titulo) {
      toast('Informe o título da seção.', true);
      return;
    }

    const id = qs('secao-id').value;
    const btn = qs('btn-salvar-secao');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        await apiJson(`${API_BASE}/secoes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson(`${API_BASE}/modelos/${modeloId}/secoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(modeloId);

      closeModal('modal-secao');
      toast('Seção salva com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar seção.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar seção';
    }
  }

  async function salvarCampo() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário antes de criar campo.', true);
      return;
    }

    const payload = buildCampoPayload();

    if (!payload.secao_id) {
      toast('Escolha uma seção antes de salvar o campo.', true);
      return;
    }

    if (!payload.label) {
      toast('Informe o nome exibido do campo.', true);
      return;
    }

    if (payload.origem === 'sistema' && !payload.campo_sistema) {
      toast('Selecione o campo do sistema.', true);
      return;
    }

    const id = qs('campo-id').value;
    const btn = qs('btn-salvar-campo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        await apiJson(`${API_BASE}/campos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson(`${API_BASE}/modelos/${modeloId}/campos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(modeloId);

      closeModal('modal-campo');
      toast('Campo salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar campo.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar campo';
    }
  }

  async function criarPadrao() {
    const btn = qs('btn-criar-padrao');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Criando...';
    }

    try {
      const data = await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      await carregarModelos();

      const modeloId = data?.modelo?.id || state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

      if (modeloId) {
        await carregarModeloCompleto(modeloId);
      }

      toast(`Formulário padrão de ${moduloLabel()} pronto para uso.`);
      return data;
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao criar formulário padrão.', true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Criar padrão';
      }
    }
  }

  async function excluirSecao(id) {
    if (!id) return;

    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) return;

    const ok = confirm('Excluir esta seção? Os campos serão movidos para "sem seção".');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/secoes/${id}?mover_campos_para_sem_secao=true`, {
        method: 'DELETE',
      });

      await carregarModeloCompleto(modeloId);

      toast('Seção excluída.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir seção.', true);
    }
  }

  async function excluirCampo(id) {
    if (!id) return;

    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) return;

    const ok = confirm('Excluir este campo do formulário?');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/campos/${id}`, {
        method: 'DELETE',
      });

      await carregarModeloCompleto(modeloId);

      closeModal('modal-campo');
      toast('Campo removido do formulário.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir campo.', true);
    }
  }

  function findSecao(id) {
    return getSecoes().find((s) => Number(s.id) === Number(id));
  }

  function findCampo(id) {
    return getAllCampos().find((c) => Number(c.id) === Number(id));
  }

  function marcarModuloAtivo() {
    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.modulo === state.modulo);
    });

    const titulo = qs('modulo-titulo');
    if (titulo) titulo.textContent = moduloLabel();
  }

  async function trocarModulo(modulo) {
    if (!MODULOS[modulo]) return;

    state.modulo = modulo;
    state.modeloAtual = null;
    state.modelos = [];
    state.camposSistema = [];
    state.camposPersonalizados = [];

    const params = new URLSearchParams(window.location.search);
    params.set('modulo', modulo);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);

    marcarModuloAtivo();

    setLoadingSelect(qs('select-modelo'), 'Carregando...');

    await Promise.all([
      carregarCamposSistema(),
      carregarCamposPersonalizados(),
    ]);

    await carregarModelos();
  }

  function podeAbrirCampo() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário primeiro.', true);
      return false;
    }

    if (!getSecoes().length) {
      toast('Crie uma seção antes de adicionar campos.', true);
      return false;
    }

    return true;
  }

  async function abrirNovaSecao() {
    try {
      await garantirModeloAtual();

      resetSecaoForm(null);
      openModal('modal-secao');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o formulário para criar seção.', true);
    }
  }

  async function abrirCampoSistema(campo = null) {
    try {
      if (!campo) {
        await garantirSecaoPadrao();
      }

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);

      resetCampoForm(campo, 'sistema');
      openModal('modal-campo');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o campo do sistema.', true);
    }
  }

  async function abrirNovoCampo(campo = null) {
    try {
      if (!campo) {
        await garantirSecaoPadrao();
      }

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);

      resetCampoForm(campo, 'novo');
      openModal('modal-campo');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o novo campo.', true);
    }
  }

  function abrirCampoParaEditar(campo) {
    if (!campo) return;

    if (campo.origem === 'sistema') {
      abrirCampoSistema(campo);
      return;
    }

    abrirNovoCampo(campo);
  }

  function bindEventos() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
          modal.classList.remove('show');
        }
      });
    });

    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.addEventListener('click', () => trocarModulo(btn.dataset.modulo));
    });

    qs('select-modelo')?.addEventListener('change', async (e) => {
      await carregarModeloCompleto(e.target.value);
    });

    qs('btn-atualizar')?.addEventListener('click', () => trocarModulo(state.modulo));
    qs('btn-criar-padrao')?.addEventListener('click', criarPadrao);

    qs('btn-novo-modelo')?.addEventListener('click', () => {
      resetModeloForm(false);
      openModal('modal-modelo');
    });

    qs('btn-editar-modelo')?.addEventListener('click', async () => {
      const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

      if (!modeloId) {
        toast('Selecione um formulário para editar.', true);
        return;
      }

      if (!state.modeloAtual?.modelo?.id) {
        await carregarModeloCompleto(modeloId);
      }

      resetModeloForm(true);
      openModal('modal-modelo');
    });

    qs('btn-salvar-modelo')?.addEventListener('click', salvarModelo);
    qs('btn-nova-secao')?.addEventListener('click', abrirNovaSecao);
    qs('btn-salvar-secao')?.addEventListener('click', salvarSecao);

    qs('secao-titulo')?.addEventListener('input', () => {
      const select = qs('secao-icone');

      if (select && (!select.value || select.value === 'fa-layer-group')) {
        const icon = iconeFallbackSecao(qs('secao-titulo').value);
        select.value = icon;
      }

      atualizarPreviewIconeSecao();
    });

    qs('secao-icone')?.addEventListener('change', atualizarPreviewIconeSecao);

    qs('btn-abrir-icones-secao')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePickerIconesSecao();
    });

    qs('secao-icones-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-secao-icon]');
      if (!btn) return;

      selecionarIconeSecao(btn.dataset.secaoIcon);
    });

    document.addEventListener('click', (e) => {
      const selector = qs('secao-icone-selector');
      if (!selector) return;
      if (selector.contains(e.target)) return;
      fecharPickerIconesSecao();
    });

    qs('btn-excluir-secao')?.addEventListener('click', () => {
      const id = qs('secao-id').value;
      closeModal('modal-secao');
      excluirSecao(id);
    });

    qs('btn-campo-sistema')?.addEventListener('click', () => abrirCampoSistema(null));
    qs('btn-novo-campo')?.addEventListener('click', () => abrirNovoCampo(null));
    qs('btn-salvar-campo')?.addEventListener('click', salvarCampo);
    qs('btn-excluir-campo')?.addEventListener('click', () => excluirCampo(qs('campo-id').value));

    qs('campo-origem')?.addEventListener('change', toggleCampoOrigem);
    qs('campo-sistema')?.addEventListener('change', preencherLabelPorSistema);
    qs('campo-personalizado')?.addEventListener('change', preencherLabelPorPersonalizado);
    qs('campo-label')?.addEventListener('input', atualizarCampoPreview);
    qs('campo-tipo-campo')?.addEventListener('change', () => {
      syncCampoOpcoesVisibility();
      atualizarCampoPreview();
    });
    qs('campo-tipo-visual')?.addEventListener('change', atualizarCampoPreview);

    qs('secoes-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'editar-secao') {
        const secao = findSecao(id);

        if (secao) {
          resetSecaoForm(secao);
          openModal('modal-secao');
        }
      }

      if (action === 'excluir-secao') {
        excluirSecao(id);
      }

      if (action === 'editar-campo') {
        const campo = findCampo(id);

        if (campo) {
          abrirCampoParaEditar(campo);
        }
      }

      if (action === 'excluir-campo') {
        excluirCampo(id);
      }
    });
  }

  async function init() {
    console.log('[Formulários] JS carregou corretamente');

    bindEventos();
    renderIconeSecaoOptions('fa-layer-group');
    atualizarTriggerIconeSecao();
    fecharPickerIconesSecao();

    try {
      marcarModuloAtivo();

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);

      await carregarModelos();
    } catch (err) {
      console.error('[Formulários] erro no init:', err);
      toast(err.message || 'Erro ao carregar formulários.', true, 5000);
      renderModeloAtual();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();