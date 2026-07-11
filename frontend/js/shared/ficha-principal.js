// /frontend/js/shared/ficha-principal.js
// Componente universal da Ficha Principal do Valora CRM.
// Funciona com scripts tradicionais e também com páginas modularizadas via window.ValoraFichaPrincipal.
(function initValoraFichaPrincipal(global) {
  'use strict';

  const API_FORMULARIOS = '/api/formularios';

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

  async function apiJson(url, options = {}) {
    const resp = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
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

    if (!text || resp.status === 204) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }





  const CACHE_PREFIX = 'valora:ficha-principal:v3-icons';
  const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

  function getCacheKey(modulo) {
    return `${CACHE_PREFIX}:${slugify(modulo)}`;
  }

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function readFormularioCache(modulo) {
    try {
      const raw = global.localStorage?.getItem(getCacheKey(modulo));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.formulario?.modelo || !parsed.version) return null;

      const age = nowMs() - Number(parsed.savedAt || 0);
      if (Number.isFinite(age) && age > CACHE_MAX_AGE_MS) {
        global.localStorage?.removeItem(getCacheKey(modulo));
        return null;
      }

      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeFormularioCache(modulo, formulario, versionInfo = null) {
    try {
      const info = versionInfo || formulario?.cache_version || null;
      const modeloId = info?.modelo_id || formulario?.modelo?.id || null;
      const version = info?.version || formulario?.cache_version?.version || formulario?.modelo?.atualizado_em || null;

      if (!formulario?.modelo || !modeloId || !version) return;

      const payload = {
        modulo: slugify(modulo),
        modelo_id: Number(modeloId),
        version: String(version),
        versionInfo: info,
        formulario,
        savedAt: nowMs(),
      };

      global.localStorage?.setItem(getCacheKey(modulo), JSON.stringify(payload));
    } catch (_) {}
  }

  function clearFormularioCache(modulo = '') {
    try {
      if (modulo) {
        global.localStorage?.removeItem(getCacheKey(modulo));
        return;
      }

      const keys = [];
      for (let i = 0; i < (global.localStorage?.length || 0); i += 1) {
        const key = global.localStorage.key(i);
        if (key && key.startsWith(`${CACHE_PREFIX}:`)) keys.push(key);
      }
      keys.forEach((key) => global.localStorage.removeItem(key));
    } catch (_) {}
  }

  function sameVersion(cache, versionInfo) {
    if (!cache || !versionInfo || versionInfo.empty) return false;
    return (
      Number(cache.modelo_id) === Number(versionInfo.modelo_id) &&
      String(cache.version || '') === String(versionInfo.version || '')
    );
  }

  function attachCacheVersion(formulario, versionInfo) {
    if (!formulario || !versionInfo) return formulario;

    return {
      ...formulario,
      cache_version: versionInfo,
      modelo: {
        ...(formulario.modelo || {}),
        usar_como_ficha_principal:
          versionInfo.usar_como_ficha_principal ?? formulario.modelo?.usar_como_ficha_principal,
        padrao: versionInfo.padrao ?? formulario.modelo?.padrao,
      },
    };
  }


  function getElement(target) {
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  function showLoading(container, message = 'Carregando campos personalizados...', detail = 'Organizando as seções da ficha...') {
    const el = getElement(container);
    if (!el) return;

    el.classList.add('custom-form-sections', 'is-loading');
    el.classList.remove('form-row', 'is-ready');

    el.innerHTML = `
      <div class="ficha-loading-card" role="status" aria-live="polite">
        <div class="ficha-loading-head">
          <span class="ficha-loading-spinner" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(message)}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
        </div>

        <div class="ficha-loading-skeleton" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
  }

  function showFichaStatus(container, message, detail) {
    if (!container) return;
    showLoading(container, message, detail);
  }

  function animateRenderedSections(container) {
    const el = getElement(container);
    if (!el) return;

    el.classList.remove('is-loading');
    el.classList.add('is-ready');

    const cards = Array.from(el.querySelectorAll('.custom-section-card'));
    cards.forEach((card, index) => {
      card.style.setProperty('--ficha-delay', `${Math.min(index * 55, 330)}ms`);
      card.classList.remove('is-mounted', 'is-section-active');
      void card.offsetWidth;
      card.classList.add('is-mounted');
    });

    const fields = Array.from(el.querySelectorAll('.custom-field-item, .custom-fields-grid > .form-group, .custom-fields-grid > .check-card'));
    fields.forEach((field, index) => {
      field.style.setProperty('--field-delay', `${Math.min(index * 22, 280)}ms`);
      field.classList.remove('is-field-mounted');
      void field.offsetWidth;
      field.classList.add('is-field-mounted');
    });
  }

  function parseCampoOpcoes(campo) {
    if (!campo) return [];

    const raw = campo.opcoes ?? campo.opcoes_json ?? campo.options ?? campo.opcoesJson ?? null;

    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    }

    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return [];

      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
        }
      } catch (_) {}

      return text
        .split(/\n|,|;/)
        .map((x) => x.trim())
        .filter(Boolean);
    }

    return [];
  }

  function parseMultiValor(value) {
    if (value === null || value === undefined || value === '') return [];

    if (Array.isArray(value)) {
      return value.map((x) => String(x ?? '').trim()).filter(Boolean);
    }

    const text = String(value ?? '').trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
      }
    } catch (_) {}

    return text
      .split(/\n|,|;/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function isTipoRelacao(tipo) {
    return String(tipo || '').startsWith('relacao_');
  }

  function isTipoRelacaoMultipla(tipo) {
    return isTipoRelacao(tipo) && String(tipo || '').endsWith('_multi');
  }

  function getTipoRelacaoBase(tipo) {
    return String(tipo || '').replace(/_multi$/, '');
  }

  const LOOKUP_CONFIG = {
    relacao_cliente: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=cliente&limit=5000',
      fallbackEndpoint: '/api/clientes',
      keys: ['items', 'clientes', 'data'],
      empty: 'Nenhum cliente encontrado',
      label: (item) => firstFilled(item.label, item.codigo && item.nome ? `${item.codigo} • ${item.nome}` : '', item.nome, item.razao_social, item.nome_fantasia, item.pessoa_contato, `Cliente #${item.id}`),
    },
    relacao_fornecedor: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=fornecedor&limit=5000',
      fallbackEndpoint: '/api/fornecedores',
      keys: ['items', 'fornecedores', 'data'],
      empty: 'Nenhum fornecedor encontrado',
      label: (item) => firstFilled(item.label, item.codigo && item.nome ? `${item.codigo} • ${item.nome}` : '', item.nome, item.razao_social, item.nome_fantasia, item.email, `Fornecedor #${item.id}`),
    },
    relacao_produto: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=produto&limit=5000',
      fallbackEndpoint: '/api/produtos',
      keys: ['items', 'produtos', 'data'],
      empty: 'Nenhum produto encontrado',
      label: (item) => firstFilled(item.label, item.codigo && item.nome ? `${item.codigo} • ${item.nome}` : '', item.nome, item.descricao, item.categoria, `Produto #${item.id}`),
    },
    relacao_patrimonio: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=patrimonio&limit=5000',
      fallbackEndpoint: '/api/patrimonio',
      keys: ['items', 'patrimonios', 'patrimonio', 'data'],
      empty: 'Nenhum patrimônio encontrado',
      label: (item) => firstFilled(item.label, item.codigo && item.nome ? `${item.codigo} • ${item.nome}` : '', item.nome, item.descricao, item.numero_serie, `Patrimônio #${item.id}`),
    },
    relacao_cotacao: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=cotacao',
      fallbackEndpoint: '/api/cotacoes',
      keys: ['items', 'cotacoes', 'data'],
      empty: 'Nenhuma cotação encontrada',
      label: (item) => firstFilled(item.label, item.codigo && item.item_nome ? `${item.codigo} • ${item.item_nome}` : '', item.item_nome, item.titulo, item.descricao, `Cotação #${item.id}`),
    },
    relacao_proposta: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=proposta',
      fallbackEndpoint: '/api/propostas',
      keys: ['items', 'propostas', 'data'],
      empty: 'Nenhuma proposta encontrada',
      label: (item) => firstFilled(item.label, item.codigo && item.titulo ? `${item.codigo} • ${item.titulo}` : '', item.titulo, item.codigo, item.cliente_nome, `Proposta #${item.id}`),
    },
    relacao_contrato: {
      endpoint: '/api/formularios/opcoes-relacao?tipo=contrato',
      fallbackEndpoint: '/api/contratos-admin',
      keys: ['items', 'contratos', 'data'],
      empty: 'Nenhum contrato encontrado',
      label: (item) => firstFilled(item.label, item.numero_contrato && item.cliente_nome ? `${item.numero_contrato} • ${item.cliente_nome}` : '', item.numero_contrato, item.cliente_nome, `Contrato #${item.id}`),
    },
  };

  const lookupCache = new Map();

  function firstFilled(...values) {
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) return text;
    }
    return '';
  }

  function extractArray(data, keys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];

    for (const key of keys) {
      if (Array.isArray(data[key])) return data[key];
    }

    for (const key of ['items', 'data', 'resultados', 'rows']) {
      if (Array.isArray(data[key])) return data[key];
    }

    return [];
  }

  async function fetchLookupOptions(tipo) {
    const tipoBase = getTipoRelacaoBase(tipo);
    const config = LOOKUP_CONFIG[tipoBase];
    if (!config?.endpoint) return [];

    if (lookupCache.has(tipoBase)) return lookupCache.get(tipoBase);

    const promise = apiJson(config.endpoint)
      .then((data) => extractArray(data, config.keys))
      .then((items) => {
        if (items.length || !config.fallbackEndpoint) return items;
        return apiJson(config.fallbackEndpoint).then((fallbackData) => extractArray(fallbackData, config.keys));
      })
      .catch((error) => {
        console.warn('[ValoraFichaPrincipal] erro ao carregar relação principal, tentando fallback:', tipoBase, error);
        if (!config.fallbackEndpoint) return [];
        return apiJson(config.fallbackEndpoint)
          .then((fallbackData) => extractArray(fallbackData, config.keys))
          .catch((fallbackError) => {
            console.warn('[ValoraFichaPrincipal] erro ao carregar fallback da relação:', tipoBase, fallbackError);
            return [];
          });
      });

    lookupCache.set(tipoBase, promise);
    return promise;
  }

  function getLookupValue(item) {
    return String(item?.value ?? item?.id ?? item?.codigo ?? item?.numero_contrato ?? '').trim();
  }

  function hydrateLookupFields(root = document) {
    const base = root || document;
    const selects = Array.from(base.querySelectorAll('select[data-custom-lookup]'));
    const multiPanels = Array.from(base.querySelectorAll('.custom-relation-multi-panel[data-custom-lookup-multi]'));
    if (!selects.length && !multiPanels.length) return;

    selects.forEach(async (select) => {
      const tipo = select.getAttribute('data-custom-lookup');
      const tipoBase = getTipoRelacaoBase(tipo);
      const config = LOOKUP_CONFIG[tipoBase];
      const selectedValue = String(select.getAttribute('data-current-value') || '').trim();

      if (!config) return;

      select.disabled = true;
      const items = await fetchLookupOptions(tipoBase);
      const options = [];

      options.push('<option value="">Selecione</option>');

      let foundSelected = false;

      if (items.length) {
        items.forEach((item) => {
          const value = getLookupValue(item);
          if (!value) return;
          const label = config.label(item) || value;
          const selected = String(value) === String(selectedValue) ? 'selected' : '';
          if (selected) foundSelected = true;
          options.push(`<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(label)}</option>`);
        });

        if (selectedValue && !foundSelected) {
          options.push(`<option value="${escapeHtml(selectedValue)}" selected>Registro salvo #${escapeHtml(selectedValue)}</option>`);
        }
      } else {
        if (selectedValue) {
          options.push(`<option value="${escapeHtml(selectedValue)}" selected>Registro salvo #${escapeHtml(selectedValue)}</option>`);
        }
        options.push(`<option value="" disabled>${escapeHtml(config.empty || 'Nenhum item encontrado')}</option>`);
      }

      select.innerHTML = options.join('');
      select.disabled = select.hasAttribute('data-original-disabled');
    });

    multiPanels.forEach(async (panel) => {
      if (panel.dataset.lookupMultiBound === 'true') return;
      panel.dataset.lookupMultiBound = 'true';

      const tipo = panel.getAttribute('data-custom-lookup-multi');
      const tipoBase = getTipoRelacaoBase(tipo);
      const config = LOOKUP_CONFIG[tipoBase];
      const slug = String(panel.getAttribute('data-multiselect-ui') || '').trim();
      const hidden = slug ? base.querySelector(`input.custom-relation-hidden[data-custom-field="${cssEscape(slug)}"]`) : null;
      const selecionados = new Set(parseMultiValor(hidden?.value || panel.getAttribute('data-current-value') || ''));
      const disabled = panel.getAttribute('data-disabled') === 'true';

      if (!config || !hidden) return;

      panel.innerHTML = '<div class="custom-multiselect-empty">Carregando registros...</div>';
      const items = await fetchLookupOptions(tipoBase);

      if (!items.length) {
        panel.innerHTML = `<div class="custom-multiselect-empty">${escapeHtml(config.empty || 'Nenhum item encontrado')}</div>`;
        updateCustomMultiselectValue(base, slug);
        return;
      }

      panel.innerHTML = items.map((item, index) => {
        const value = getLookupValue(item);
        if (!value) return '';
        const label = config.label(item) || value;
        const checked = selecionados.has(String(value)) ? 'checked' : '';
        const optionId = `custom-lookup-${slug}-${index}`;
        return `
          <label class="custom-multiselect-option" for="${escapeHtml(optionId)}" data-option-text="${escapeHtml(label)}">
            <input
              type="checkbox"
              id="${escapeHtml(optionId)}"
              value="${escapeHtml(value)}"
              data-multiselect-option="${escapeHtml(slug)}"
              ${checked}
              ${disabled ? 'disabled' : ''}
            />
            <span>${escapeHtml(label)}</span>
          </label>
        `;
      }).join('') || `<div class="custom-multiselect-empty">${escapeHtml(config.empty || 'Nenhum item encontrado')}</div>`;

      hydrateCustomMultiselects(base);
      updateCustomMultiselectValue(base, slug);
      panel.addEventListener('change', (event) => {
        const input = event.target;
        if (!input || !input.matches('[data-multiselect-option]')) return;
        updateCustomMultiselectValue(base, slug);
      });
    });
  }

  function normalizarTipo(tipo) {
    const rawTipo = String(tipo || 'texto').trim().toLowerCase();
    const t = rawTipo
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const rawUnderscore = rawTipo.replace(/[-\s]+/g, '_');

    const map = {
      text: 'texto',
      texto: 'texto',
      textarea: 'textarea',
      numero: 'numero',
      number: 'numero',
      data: 'data',
      date: 'data',
      select: 'select',
      lista: 'select',
      checkbox: 'checkbox',
      multiselect: 'multiselect',
      multi_select: 'multiselect',
      multivalor: 'multiselect',
      lista_multipla: 'multiselect',
      lista_multiplas: 'multiselect',
      email: 'email',
      telefone: 'telefone',
      phone: 'telefone',
      tel: 'telefone',
      moeda: 'moeda',
      money: 'moeda',
      percentual: 'percentual',
      percent: 'percentual',
      'puxar cliente': 'relacao_cliente',
      'puxa cliente': 'relacao_cliente',
      'puxar clientes': 'relacao_cliente',
      'puxa clientes': 'relacao_cliente',
      cliente: 'relacao_cliente',
      clientes: 'relacao_cliente',
      'puxar fornecedor': 'relacao_fornecedor',
      'puxa fornecedor': 'relacao_fornecedor',
      'puxar fornecedores': 'relacao_fornecedor',
      'puxa fornecedores': 'relacao_fornecedor',
      fornecedor: 'relacao_fornecedor',
      fornecedores: 'relacao_fornecedor',
      'puxar produto': 'relacao_produto',
      'puxa produto': 'relacao_produto',
      'puxar produtos': 'relacao_produto',
      'puxa produtos': 'relacao_produto',
      produto: 'relacao_produto',
      produtos: 'relacao_produto',
      'puxar patrimonio': 'relacao_patrimonio',
      'puxa patrimonio': 'relacao_patrimonio',
      'puxar patrimonios': 'relacao_patrimonio',
      'puxa patrimonios': 'relacao_patrimonio',
      patrimonio: 'relacao_patrimonio',
      patrimonios: 'relacao_patrimonio',
      'puxar cotacao': 'relacao_cotacao',
      'puxa cotacao': 'relacao_cotacao',
      'puxar cotacoes': 'relacao_cotacao',
      'puxa cotacoes': 'relacao_cotacao',
      cotacao: 'relacao_cotacao',
      cotacoes: 'relacao_cotacao',
      'puxar proposta': 'relacao_proposta',
      'puxa proposta': 'relacao_proposta',
      'puxar propostas': 'relacao_proposta',
      'puxa propostas': 'relacao_proposta',
      proposta: 'relacao_proposta',
      propostas: 'relacao_proposta',
      'puxar contrato': 'relacao_contrato',
      'puxa contrato': 'relacao_contrato',
      'puxar contratos': 'relacao_contrato',
      'puxa contratos': 'relacao_contrato',
      contrato: 'relacao_contrato',
      contratos: 'relacao_contrato',
      'puxar varios clientes': 'relacao_cliente_multi',
      'puxa varios clientes': 'relacao_cliente_multi',
      'puxar varios fornecedores': 'relacao_fornecedor_multi',
      'puxa varios fornecedores': 'relacao_fornecedor_multi',
      'puxar varios produtos': 'relacao_produto_multi',
      'puxa varios produtos': 'relacao_produto_multi',
      'puxar varios patrimonios': 'relacao_patrimonio_multi',
      'puxa varios patrimonios': 'relacao_patrimonio_multi',
      'puxar varias cotacoes': 'relacao_cotacao_multi',
      'puxa varias cotacoes': 'relacao_cotacao_multi',
      'puxar varios cotacoes': 'relacao_cotacao_multi',
      'puxar varias propostas': 'relacao_proposta_multi',
      'puxa varias propostas': 'relacao_proposta_multi',
      'puxar varios contratos': 'relacao_contrato_multi',
      'puxa varios contratos': 'relacao_contrato_multi',
      relacao_cliente: 'relacao_cliente',
      lookup_cliente: 'relacao_cliente',
      relacao_cliente_multi: 'relacao_cliente_multi',
      lookup_cliente_multi: 'relacao_cliente_multi',
      relacao_fornecedor: 'relacao_fornecedor',
      lookup_fornecedor: 'relacao_fornecedor',
      relacao_fornecedor_multi: 'relacao_fornecedor_multi',
      lookup_fornecedor_multi: 'relacao_fornecedor_multi',
      relacao_produto: 'relacao_produto',
      lookup_produto: 'relacao_produto',
      relacao_produto_multi: 'relacao_produto_multi',
      lookup_produto_multi: 'relacao_produto_multi',
      relacao_patrimonio: 'relacao_patrimonio',
      lookup_patrimonio: 'relacao_patrimonio',
      relacao_patrimonio_multi: 'relacao_patrimonio_multi',
      lookup_patrimonio_multi: 'relacao_patrimonio_multi',
      relacao_cotacao: 'relacao_cotacao',
      lookup_cotacao: 'relacao_cotacao',
      relacao_cotacao_multi: 'relacao_cotacao_multi',
      lookup_cotacao_multi: 'relacao_cotacao_multi',
      relacao_proposta: 'relacao_proposta',
      lookup_proposta: 'relacao_proposta',
      relacao_proposta_multi: 'relacao_proposta_multi',
      lookup_proposta_multi: 'relacao_proposta_multi',
      relacao_contrato: 'relacao_contrato',
      lookup_contrato: 'relacao_contrato',
      relacao_contrato_multi: 'relacao_contrato_multi',
      lookup_contrato_multi: 'relacao_contrato_multi',
    };

    return map[rawTipo] || map[t] || map[rawUnderscore] || 'texto';
  }

  function isVisualCampo(campo) {
    return String(campo?.origem || '').toLowerCase() === 'visual' || !!campo?.tipo_visual;
  }

  function ordenarPorOrdemId(items = []) {
    return [...items].sort((a, b) =>
      Number(a?.ordem || 0) - Number(b?.ordem || 0) ||
      Number(a?.id || 0) - Number(b?.id || 0)
    );
  }

  function getCampoSlug(campo) {
    return String(
      campo?.slug ||
      campo?.campo_personalizado_slug ||
      campo?.campo_sistema ||
      slugify(campo?.nome || campo?.label || '')
    ).trim();
  }

  function indexarCamposAvulsos(camposAvulsos = []) {
    const byId = new Map();
    const bySlug = new Map();
    const byNome = new Map();

    (camposAvulsos || []).forEach((campo) => {
      const id = campo?.id != null ? Number(campo.id) : null;
      const slug = getCampoSlug(campo);
      const nome = slugify(campo?.nome || campo?.label || '');

      if (id) byId.set(id, campo);
      if (slug) bySlug.set(slug, campo);
      if (nome) byNome.set(nome, campo);
    });

    return { byId, bySlug, byNome };
  }

  function montarCampoFinal(campoAvulso, campoFormulario = null) {
    const nome =
      campoAvulso?.nome ||
      campoFormulario?.label ||
      campoFormulario?.nome ||
      campoFormulario?.campo_sistema ||
      '';

    const slug =
      campoAvulso?.slug ||
      campoFormulario?.campo_personalizado_slug ||
      campoFormulario?.campo_sistema ||
      slugify(nome);

    if (!slug) return null;

    const tipoFormulario = campoFormulario?.tipo_campo || campoFormulario?.tipo || '';
    const tipoAvulso = campoAvulso?.tipo || '';

    return {
      id: campoAvulso?.id || campoFormulario?.campo_personalizado_id || campoFormulario?.id || null,
      nome,
      slug,
      // O tipo salvo no formulário é a fonte principal.
      // Antes o tipo antigo sincronizado em /api/campos-clientes vinha como "texto"
      // e sobrescrevia "relacao_cliente", "relacao_fornecedor_multi" etc.
      tipo: normalizarTipo(tipoFormulario || tipoAvulso || 'texto'),
      obrigatorio: campoAvulso?.obrigatorio ?? campoFormulario?.obrigatorio ?? false,
      ativo: campoAvulso?.ativo ?? campoFormulario?.ativo ?? true,
      somente_leitura: campoAvulso?.somente_leitura ?? campoFormulario?.somente_leitura ?? false,
      origem: campoFormulario?.origem || campoAvulso?.origem || '',
      campo_sistema: campoFormulario?.campo_sistema || campoAvulso?.campo_sistema || '',
      opcoes_json: campoAvulso?.opcoes_json ?? campoFormulario?.opcoes_json ?? campoFormulario?.opcoes ?? null,
      ordem: Number(campoAvulso?.ordem ?? campoFormulario?.ordem ?? 0),
      largura: campoFormulario?.largura || campoAvulso?.largura || '50',
      ajuda: campoFormulario?.ajuda || campoAvulso?.ajuda || '',
      placeholder: campoFormulario?.placeholder || campoAvulso?.placeholder || '',
    };
  }

  function montarSecoesDoFormulario(formulario, camposAvulsos = [], { usarFichaPrincipal = false } = {}) {
    const index = indexarCamposAvulsos(camposAvulsos);
    const usados = new Set();
    const secoes = [];

    const formSecoes = Array.isArray(formulario?.secoes) ? ordenarPorOrdemId(formulario.secoes) : [];

    formSecoes.forEach((secao) => {
      if (secao?.ativo === false) return;

      const campos = [];
      const camposFormulario = Array.isArray(secao.campos) ? secao.campos : [];

      ordenarPorOrdemId(camposFormulario)
        .filter((campo) => campo?.ativo !== false)
        .filter((campo) => !isVisualCampo(campo))
        .forEach((campoFormulario) => {
          const label = campoFormulario?.label || campoFormulario?.nome || campoFormulario?.campo_sistema || '';
          const slug = campoFormulario?.campo_personalizado_slug || campoFormulario?.campo_sistema || slugify(label);
          const personalizadoId = campoFormulario?.campo_personalizado_id ? Number(campoFormulario.campo_personalizado_id) : null;

          const campoAvulso =
            (personalizadoId ? index.byId.get(personalizadoId) : null) ||
            index.bySlug.get(slug) ||
            index.byNome.get(slug) ||
            null;

          const campoFinal = montarCampoFinal(campoAvulso, campoFormulario);
          if (!campoFinal || campoFinal.ativo === false) return;

          usados.add(campoFinal.slug);
          campos.push(campoFinal);
        });

      if (campos.length) {
        secoes.push({
          id: secao.id,
          titulo: secao.titulo || 'Seção',
          descricao: secao.descricao || '',
          icone: getIconeSecao(secao, 'fa-layer-group'),
          ordem: Number(secao.ordem || 0),
          campos,
        });
      }
    });

    const semSecao = Array.isArray(formulario?.campos_sem_secao) ? formulario.campos_sem_secao : [];
    const camposSemSecao = ordenarPorOrdemId(semSecao)
      .filter((campo) => campo?.ativo !== false)
      .filter((campo) => !isVisualCampo(campo))
      .map((campoFormulario) => montarCampoFinal(null, campoFormulario))
      .filter(Boolean)
      .filter((campo) => {
        if (usados.has(campo.slug)) return false;
        usados.add(campo.slug);
        return true;
      });

    if (camposSemSecao.length) {
      secoes.push({
        id: 'sem_secao',
        titulo: 'Outros campos',
        descricao: 'Campos sem seção definida no formulário.',
        icone: 'fa-layer-group',
        ordem: 9998,
        campos: camposSemSecao,
      });
    }

    const extras = (camposAvulsos || [])
      .filter((campo) => campo?.ativo !== false)
      .map((campo) => montarCampoFinal(campo, null))
      .filter(Boolean)
      .filter((campo) => !usados.has(campo.slug))
      .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

    if (extras.length && !usarFichaPrincipal) {
      secoes.push({
        id: 'extras',
        titulo: 'Outros campos',
        descricao: 'Campos personalizados que ainda não estão organizados em uma seção.',
        icone: 'fa-layer-group',
        ordem: 9999,
        campos: extras,
      });
    }

    return secoes.sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
  }

  function montarSecoesFlat(camposAvulsos = [], { titulo = 'Campos personalizados', descricao = '' } = {}) {
    const campos = (camposAvulsos || [])
      .filter((campo) => campo?.ativo !== false)
      .map((campo) => montarCampoFinal(campo, null))
      .filter(Boolean)
      .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

    if (!campos.length) return [];

    return [
      {
        id: 'flat',
        titulo,
        descricao,
        icone: 'fa-sliders',
        ordem: 1,
        campos,
      },
    ];
  }

  function getCampoClass(campo) {
    const largura = String(campo?.largura || '').replace('%', '').trim().toLowerCase();
    const tipo = normalizarTipo(campo?.tipo);
    const nome = slugify(campo?.nome || campo?.label || campo?.slug || '');

    // Layout estilo Bitrix: campos personalizados entram no mesmo grid dos campos do sistema.
    // Regra principal: todo campo comum mantém o mesmo tamanho. Só campos naturalmente longos
    // (textarea/observações/descrições) ocupam a linha inteira.
    const nomesLongos = ['observacao', 'observacoes', 'descricao', 'comentario', 'comentarios', 'detalhes', 'anotacoes'];
    const isNomeLongo = nomesLongos.some((item) => nome === item || nome.includes(item));

    if (tipo === 'textarea' || isNomeLongo) return 'span-all bitrix-field-full';

    // Mantém compatibilidade caso no futuro o construtor tenha tamanho explícito.
    // Porém, valores antigos como 100% não forçam mais todos os campos a ficarem gigantes.
    if (largura === 'full' || largura === 'linha' || largura === 'linha_inteira' || largura === 'inteiro') {
      return 'span-all bitrix-field-full';
    }

    if (largura === '2' || largura === 'half' || largura === 'metade') return 'span-2 bitrix-field-half';

    return 'bitrix-field-normal';
  }

  function getValorCampo(values = {}, campo) {
    const slug = campo?.slug;
    if (!slug) return '';

    if (values[slug] !== undefined && values[slug] !== null) return values[slug];

    if (slug === 'data_cadastro') {
      return values.data_cadastro || values.criado_em || values.created_at || values.criadoEm || '';
    }

    if (slug === 'criado_em') {
      return values.criado_em || values.data_cadastro || values.created_at || values.criadoEm || '';
    }

    const labelSlug = slugify(campo?.nome || '');
    if (labelSlug && values[labelSlug] !== undefined && values[labelSlug] !== null) return values[labelSlug];

    return '';
  }

  function formatDateInput(value) {
    if (value === null || value === undefined || value === '') return '';
    const text = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
    return text;
  }

  function renderInputCampo(campo, values = {}) {
    const slug = campo.slug;
    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = normalizarTipo(campo.tipo);
    const valor = getValorCampo(values, campo);
    const required = campo.obrigatorio ? ' *' : '';
    const placeholder = campo.placeholder || '';
    const disabled = campo.somente_leitura ? 'disabled' : '';
    const fieldClass = getCampoClass(campo);
    const readonlyAttr = campo.somente_leitura ? 'data-custom-readonly="true"' : '';
    const fieldOrigin = String(campo.origem || 'personalizado').toLowerCase();

    if (tipo === 'checkbox') {
      const checked =
        String(valor).toLowerCase() === 'true' ||
        String(valor).toLowerCase() === 'sim' ||
        valor === true
          ? 'checked'
          : '';

      return `
        <div class="form-group custom-field-item ${fieldClass}" data-field-origin="${escapeHtml(fieldOrigin)}">
          <label class="custom-checkbox check-card">
            <input
              type="checkbox"
              id="${id}"
              data-custom-field="${escapeHtml(slug)}"
              data-custom-label="${escapeHtml(label)}"
              data-required="${campo.obrigatorio ? 'true' : 'false'}"
              ${checked}
              ${disabled}
            />
            <span>
              <strong>${escapeHtml(label)}${required}</strong>
              <small>${escapeHtml(campo.ajuda || 'Campo da ficha.')}</small>
            </span>
          </label>
        </div>
      `;
    }

    let html = `<div class="form-group custom-field-item ${fieldClass}" data-field-origin="${escapeHtml(fieldOrigin)}">`;
    html += `<label for="${id}">${escapeHtml(label)}${required}</label>`;

    if (tipo === 'textarea') {
      html += `
        <textarea
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          rows="3"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        >${escapeHtml(valor)}</textarea>
      `;
    } else if (tipo === 'numero') {
      html += `
        <input
          type="number"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else if (tipo === 'data') {
      html += `
        <input
          type="date"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(formatDateInput(valor))}"
          ${readonlyAttr}
          ${disabled}
        />
      `;
    } else if (tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);

      html += `
        <select
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          ${disabled}
        >
          <option value="">Selecione</option>
          ${opcoes
            .map((opcao) => {
              const selected = String(opcao) === String(valor) ? 'selected' : '';
              return `<option value="${escapeHtml(opcao)}" ${selected}>${escapeHtml(opcao)}</option>`;
            })
            .join('')}
        </select>
      `;
    } else if (tipo === 'multiselect') {
      const opcoes = parseCampoOpcoes(campo);
      const selecionados = new Set(parseMultiValor(valor));
      const initialValue = JSON.stringify(Array.from(selecionados));
      const disabledAttr = disabled ? 'disabled' : '';

      html += `
        <input
          type="hidden"
          id="${id}"
          class="custom-multiselect-hidden"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          data-custom-multiple="true"
          value="${escapeHtml(initialValue)}"
        />
        <div
          class="custom-multiselect-dropdown"
          data-multiselect-dropdown="${escapeHtml(slug)}"
          data-disabled="${disabled ? 'true' : 'false'}"
        >
          <button
            type="button"
            class="custom-multiselect-trigger"
            data-multiselect-trigger="${escapeHtml(slug)}"
            ${disabledAttr}
          >
            <span class="custom-multiselect-placeholder" data-multiselect-placeholder="${escapeHtml(slug)}">Clique para selecionar...</span>
            <span class="custom-multiselect-selected" data-multiselect-selected="${escapeHtml(slug)}"></span>
            <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
          </button>

          <div class="custom-multiselect-menu" data-multiselect-menu="${escapeHtml(slug)}">
            <div class="custom-multiselect-search-wrap">
              <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              <input
                type="search"
                class="custom-multiselect-search"
                data-multiselect-search="${escapeHtml(slug)}"
                placeholder="Buscar opção..."
              />
            </div>

            <div
              class="custom-multiselect-panel"
              data-multiselect-ui="${escapeHtml(slug)}"
              data-disabled="${disabled ? 'true' : 'false'}"
              role="group"
              aria-label="${escapeHtml(label)}"
            >
              ${opcoes.length
                ? opcoes
                    .map((opcao, index) => {
                      const checked = selecionados.has(String(opcao)) ? 'checked' : '';
                      const optionId = `${id}-opcao-${index}`;
                      return `
                        <label class="custom-multiselect-option" for="${escapeHtml(optionId)}" data-option-text="${escapeHtml(opcao)}">
                          <input
                            type="checkbox"
                            id="${escapeHtml(optionId)}"
                            value="${escapeHtml(opcao)}"
                            data-multiselect-option="${escapeHtml(slug)}"
                            ${checked}
                            ${disabledAttr}
                          />
                          <span>${escapeHtml(opcao)}</span>
                        </label>
                      `;
                    })
                    .join('')
                : '<div class="custom-multiselect-empty">Nenhuma opção cadastrada.</div>'}
            </div>
          </div>
        </div>
      `;

      html += '<small class="field-hint field-help">Clique no campo para abrir a lista e selecione uma ou mais opções.</small>';
    } else if (isTipoRelacao(tipo)) {
      if (isTipoRelacaoMultipla(tipo)) {
        const selecionados = parseMultiValor(valor);
        const initialValue = JSON.stringify(selecionados);
        html += `
          <input
            type="hidden"
            id="${id}"
            class="custom-multiselect-hidden custom-relation-hidden"
            data-custom-field="${escapeHtml(slug)}"
            data-custom-label="${escapeHtml(label)}"
            data-required="${campo.obrigatorio ? 'true' : 'false'}"
            data-custom-multiple="true"
            data-current-value="${escapeHtml(initialValue)}"
            value="${escapeHtml(initialValue)}"
          />
          <div
            class="custom-multiselect-dropdown custom-relation-dropdown"
            data-multiselect-dropdown="${escapeHtml(slug)}"
            data-disabled="${disabled ? 'true' : 'false'}"
          >
            <button
              type="button"
              class="custom-multiselect-trigger"
              data-multiselect-trigger="${escapeHtml(slug)}"
              ${disabled ? 'disabled' : ''}
            >
              <span class="custom-multiselect-placeholder" data-multiselect-placeholder="${escapeHtml(slug)}">Clique para selecionar...</span>
              <span class="custom-multiselect-selected" data-multiselect-selected="${escapeHtml(slug)}"></span>
              <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
            </button>

            <div class="custom-multiselect-menu" data-multiselect-menu="${escapeHtml(slug)}">
              <div class="custom-multiselect-search-wrap">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <input
                  type="search"
                  class="custom-multiselect-search"
                  data-multiselect-search="${escapeHtml(slug)}"
                  placeholder="Buscar registro..."
                />
              </div>

              <div
                class="custom-multiselect-panel custom-relation-multi-panel"
                data-multiselect-ui="${escapeHtml(slug)}"
                data-custom-lookup-multi="${escapeHtml(tipo)}"
                data-current-value="${escapeHtml(initialValue)}"
                data-disabled="${disabled ? 'true' : 'false'}"
                role="group"
                aria-label="${escapeHtml(label)}"
              >
                <div class="custom-multiselect-empty">Carregando registros...</div>
              </div>
            </div>
          </div>
        `;
        html += '<small class="field-hint field-help">Clique no campo para abrir a lista e selecione um ou mais registros.</small>';
      } else {
        html += `
          <select
            id="${id}"
            class="custom-lookup-select"
            data-custom-field="${escapeHtml(slug)}"
            data-custom-label="${escapeHtml(label)}"
            data-required="${campo.obrigatorio ? 'true' : 'false'}"
            data-custom-lookup="${escapeHtml(tipo)}"
            data-current-value="${escapeHtml(valor)}"
            ${disabled ? 'data-original-disabled="true" disabled' : ''}
          >
            <option value="">Carregando...</option>
          </select>
        `;
      }
    } else if (tipo === 'email') {
      html += `
        <input
          type="email"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else if (tipo === 'telefone') {
      html += `
        <input
          type="tel"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else {
      html += `
        <input
          type="text"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    }

    if (campo.ajuda && tipo !== 'checkbox') {
      html += `<small class="field-hint field-help">${escapeHtml(campo.ajuda)}</small>`;
    }

    html += '</div>';
    return html;
  }

  const FA_STYLE_CLASSES = new Set([
    'fa',
    'fas',
    'far',
    'fal',
    'fat',
    'fad',
    'fab',
    'fa-solid',
    'fa-regular',
    'fa-light',
    'fa-thin',
    'fa-duotone',
    'fa-brands',
    'fa-fw',
    'fa-sm',
    'fa-lg',
    'fa-xl',
    'fa-2x',
  ]);

  function normalizarIconeFontAwesome(value, fallback = 'fa-layer-group') {
    const text = String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/["']/g, ' ')
      .trim();

    if (!text) return fallback;

    const tokens = text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const icon = tokens.find((item) => /^fa-[a-z0-9-]+$/i.test(item) && !FA_STYLE_CLASSES.has(item));

    return icon || fallback;
  }


  function normalizarTextoIconeSecao(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function iconeFallbackPorTituloSecao(titulo) {
    const t = normalizarTextoIconeSecao(titulo);

    if (!t) return 'fa-layer-group';
    if (/(basico|cadastro|identificacao|principal|dados gerais)/.test(t)) return 'fa-id-card';
    if (/(imovel|endereco|residencia|casa|apartamento|localizacao|local)/.test(t)) return 'fa-house';
    if (/(responsavel|representante|titular|contato)/.test(t)) return 'fa-user-shield';
    if (/(pessoa juridica|juridica|cnpj|empresa|fornecedor)/.test(t)) return 'fa-building';
    if (/(pessoa fisica|cpf|cliente)/.test(t)) return 'fa-user';
    if (/(administrativo|administracao|gerencia|gerente)/.test(t)) return 'fa-user-gear';
    if (/(financeiro|cobranca|pagamento|boleto|pix|cartao|credito|compras|limite)/.test(t)) return 'fa-wallet';
    if (/(rede|social|instagram|facebook|linkedin|site)/.test(t)) return 'fa-share-nodes';
    if (/(contrato|emissao|assinatura|documento)/.test(t)) return 'fa-file-signature';
    if (/(telefone|whatsapp|email)/.test(t)) return 'fa-address-book';
    if (/(ocorrencia|historico|registro|protocolo)/.test(t)) return 'fa-clipboard-list';
    if (/(anexo|arquivo|foto|imagem)/.test(t)) return 'fa-paperclip';
    if (/(classificacao|categoria|segmento|tipo|grupo)/.test(t)) return 'fa-tags';
    if (/(comercial|venda|negociacao|proposta|cotacao)/.test(t)) return 'fa-briefcase';
    if (/(produto|item|material|estoque)/.test(t)) return 'fa-box';
    if (/(patrimonio|equipamento|ativo|maquina)/.test(t)) return 'fa-cubes';

    return 'fa-layer-group';
  }

  function getIconeSecao(secao, fallback = 'fa-layer-group') {
    const salvo = normalizarIconeFontAwesome(secao?.icone || '', '');
    return salvo || iconeFallbackPorTituloSecao(secao?.titulo || secao?.nome || '') || fallback;
  }

  function getSectionIconFromCard(card) {
    const fromData = normalizarIconeFontAwesome(card?.dataset?.customSectionIcon || '', '');
    if (fromData) return fromData;

    const iconEl = card?.querySelector?.('.custom-section-icon i, .custom-section-head i');
    if (iconEl?.classList?.length) {
      const fromClass = Array.from(iconEl.classList).find((item) => /^fa-[a-z0-9-]+$/i.test(item) && !FA_STYLE_CLASSES.has(item));
      if (fromClass) return fromClass;
    }

    return 'fa-layer-group';
  }

  function renderSecao(secao, values = {}) {
    const icon = getIconeSecao(secao, 'fa-layer-group');

    return `
      <article class="custom-section-card custom-section-card-bitrix" data-custom-section-icon="${escapeHtml(icon)}">
        <div class="custom-section-head">
          <div class="custom-section-title">
            <span class="custom-section-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
            <div>
              <h4>${escapeHtml(secao.titulo || 'Seção')}</h4>
              ${secao.descricao ? `<p>${escapeHtml(secao.descricao)}</p>` : ''}
            </div>
          </div>
        </div>

        <div class="custom-fields-grid">
          ${(secao.campos || []).map((campo) => renderInputCampo(campo, values)).join('')}
        </div>
      </article>
    `;
  }

  async function carregarFormularioModulo(
    modulo,
    {
      apiJsonImpl = apiJson,
      ativo = true,
      useCache = true,
      forceRefresh = false,
      loadingContainer = null,
    } = {}
  ) {
    const moduloNorm = slugify(modulo);
    const ativoQuery = ativo ? 'true' : 'false';
    const cache = useCache && !forceRefresh ? readFormularioCache(moduloNorm) : null;

    showFichaStatus(
      loadingContainer,
      'Verificando ficha principal...',
      'Conferindo se os campos personalizados foram alterados.'
    );

    try {
      const versionInfo = await apiJsonImpl(
        `${API_FORMULARIOS}/modelos/principal/${encodeURIComponent(moduloNorm)}/versao?ativo=${ativoQuery}`
      );

      if (!versionInfo || versionInfo.empty || !versionInfo.modelo_id) {
        clearFormularioCache(moduloNorm);
        return null;
      }

      if (useCache && !forceRefresh && sameVersion(cache, versionInfo)) {
        showFichaStatus(
          loadingContainer,
          'Carregando ficha salva...',
          'A estrutura não mudou. Usando cache local para abrir mais rápido.'
        );
        return attachCacheVersion(cache.formulario, versionInfo);
      }

      showFichaStatus(
        loadingContainer,
        'Buscando campos personalizados no banco de dados...',
        'Atualizando a estrutura da ficha principal.'
      );

      const formulario = await apiJsonImpl(
        `${API_FORMULARIOS}/modelos/principal/${encodeURIComponent(moduloNorm)}?ativo=${ativoQuery}`
      );
      const completo = attachCacheVersion(formulario, formulario?.cache_version || versionInfo);
      writeFormularioCache(moduloNorm, completo, completo?.cache_version || versionInfo);
      return completo;
    } catch (err) {
      // Fallback seguro para instalações que ainda não têm as novas rotas.
      if (cache?.formulario?.modelo) {
        showFichaStatus(
          loadingContainer,
          'Carregando ficha salva...',
          'A API de versão não respondeu. Usando a última ficha salva no navegador.'
        );
        return cache.formulario;
      }

      showFichaStatus(
        loadingContainer,
        'Buscando campos personalizados no banco de dados...',
        'Carregando pela rota padrão de formulários.'
      );

      const query = `${API_FORMULARIOS}/modelos?modulo=${encodeURIComponent(moduloNorm)}${ativo ? '&ativo=true' : ''}`;
      const modelos = await apiJsonImpl(query);
      const lista = Array.isArray(modelos) ? modelos : [];

      if (!lista.length) return null;

      const modeloResumo =
        lista.find((modelo) => modelo.usar_como_ficha_principal) ||
        lista.find((modelo) => modelo.padrao) ||
        lista[0];

      if (!modeloResumo?.id) return null;

      const formulario = await apiJsonImpl(`${API_FORMULARIOS}/modelos/${modeloResumo.id}`);
      writeFormularioCache(moduloNorm, formulario, {
        modelo_id: formulario?.modelo?.id,
        version: formulario?.modelo?.atualizado_em || String(nowMs()),
        modulo: moduloNorm,
      });
      return formulario;
    }
  }

  async function atualizarFichaPrincipalModelo(modelo, enabled, { apiJsonImpl = apiJson, moduloFallback = '' } = {}) {
    if (!modelo?.id) {
      throw new Error('Nenhum formulário foi encontrado para alterar a ficha principal.');
    }

    const modulo = modelo.modulo || moduloFallback;
    const payload = {
      modulo,
      nome: modelo.nome,
      descricao: modelo.descricao || null,
      ativo: modelo.ativo !== false,
      padrao: !!modelo.padrao,
      usar_como_ficha_principal: !!enabled,
    };

    const atualizado = await apiJsonImpl(`${API_FORMULARIOS}/modelos/${modelo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    clearFormularioCache(modulo);
    return atualizado;
  }



  const LONG_FIELD_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="search"]';

  function isVisibleElement(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /*
   * Campos longos agora são tratados pelo componente global:
   * frontend/js/shared/campos-longos.js
   *
   * Mantemos estas funções aqui apenas para compatibilidade com os módulos
   * que chamam ValoraFichaPrincipal.enhanceLongFields() após renderizar campos.
   */
  function enhanceLongFields(root = document) {
    if (global.ValoraCamposLongos && typeof global.ValoraCamposLongos.enhance === 'function') {
      global.ValoraCamposLongos.enhance(root);
    }
  }

  function syncLongFieldUi(el, { showPreview = false } = {}) {
    if (global.ValoraCamposLongos && typeof global.ValoraCamposLongos.sync === 'function') {
      return global.ValoraCamposLongos.sync(el, { expand: !!showPreview });
    }
    return false;
  }

  function initLongFieldEvents() {
    // Eventos reais ficam no componente global campos-longos.js.
  }


  function cssEscape(value) {
    if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function getMultiselectOptionLabel(input) {
    const label = input?.closest?.('.custom-multiselect-option');
    const spanText = label?.querySelector?.('span')?.textContent;
    return String(spanText || input?.value || '').trim();
  }

  function renderMultiselectResumo(base, slug, checkedInputs) {
    const safeSlug = cssEscape(slug);
    const dropdown = base.querySelector(`[data-multiselect-dropdown="${safeSlug}"]`);
    const selectedEl = base.querySelector(`[data-multiselect-selected="${safeSlug}"]`);
    const placeholderEl = base.querySelector(`[data-multiselect-placeholder="${safeSlug}"]`);
    if (!selectedEl || !placeholderEl) return;

    const checked = checkedInputs || Array.from(base.querySelectorAll(`[data-multiselect-option="${safeSlug}"]:checked`));
    const labels = checked.map(getMultiselectOptionLabel).filter(Boolean);

    placeholderEl.classList.toggle('is-hidden', labels.length > 0);
    selectedEl.innerHTML = '';

    if (!labels.length) {
      placeholderEl.textContent = 'Clique para selecionar...';
      dropdown?.classList.remove('has-value');
      return;
    }

    dropdown?.classList.add('has-value');

    labels.slice(0, 3).forEach((texto) => {
      const chip = document.createElement('span');
      chip.className = 'custom-multiselect-selected-chip';
      chip.textContent = texto;
      selectedEl.appendChild(chip);
    });

    if (labels.length > 3) {
      const more = document.createElement('span');
      more.className = 'custom-multiselect-selected-more';
      more.textContent = `+${labels.length - 3}`;
      selectedEl.appendChild(more);
    }
  }

  function updateCustomMultiselectValue(root, slug) {
    const base = root || document;
    const safeSlug = cssEscape(slug);
    const hidden = base.querySelector(`input.custom-multiselect-hidden[data-custom-field="${safeSlug}"]`);
    if (!hidden) return;

    const checkedInputs = Array.from(base.querySelectorAll(`[data-multiselect-option="${safeSlug}"]:checked`));
    const checked = checkedInputs
      .map((input) => String(input.value ?? '').trim())
      .filter(Boolean);

    hidden.value = JSON.stringify(checked);

    const panel = base.querySelector(`[data-multiselect-ui="${safeSlug}"]`);
    if (panel) {
      panel.classList.toggle('has-value', checked.length > 0);
      if (checked.length > 0) panel.classList.remove('is-invalid');
    }

    renderMultiselectResumo(base, slug, checkedInputs);
  }

  function fecharDropdownsMultiselect(exceto = null) {
    document.querySelectorAll('.custom-multiselect-dropdown.is-open').forEach((dropdown) => {
      if (exceto && dropdown === exceto) return;
      dropdown.classList.remove('is-open');
      dropdown.closest('.custom-field-item')?.classList.remove('is-dropdown-open');
      dropdown.closest('.form-group')?.classList.remove('is-dropdown-open');
    });
  }

  function filtrarOpcoesMultiselect(dropdown, termo) {
    const q = String(termo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();

    dropdown.querySelectorAll('.custom-multiselect-option').forEach((option) => {
      const text = String(option.getAttribute('data-option-text') || option.textContent || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

      option.hidden = q && !text.includes(q);
    });
  }

  function bindDropdownMultiselect(dropdown, base) {
    if (!dropdown || dropdown.dataset.dropdownBound === 'true') return;
    dropdown.dataset.dropdownBound = 'true';

    const slug = String(dropdown.getAttribute('data-multiselect-dropdown') || '').trim();
    const trigger = dropdown.querySelector('[data-multiselect-trigger]');
    const search = dropdown.querySelector('[data-multiselect-search]');

    trigger?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (dropdown.getAttribute('data-disabled') === 'true' || trigger.disabled) return;

      const willOpen = !dropdown.classList.contains('is-open');
      fecharDropdownsMultiselect(dropdown);
      dropdown.classList.toggle('is-open', willOpen);
      dropdown.closest('.custom-field-item')?.classList.toggle('is-dropdown-open', willOpen);
      dropdown.closest('.form-group')?.classList.toggle('is-dropdown-open', willOpen);

      if (willOpen) {
        search?.focus({ preventScroll: true });
        if (slug) updateCustomMultiselectValue(base, slug);
      }
    });

    search?.addEventListener('input', () => {
      filtrarOpcoesMultiselect(dropdown, search.value);
    });

    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
    });
  }

  function ensureMultiselectOutsideListener() {
    if (global.__valoraFichaPrincipalMultiselectOutsideBound) return;
    global.__valoraFichaPrincipalMultiselectOutsideBound = true;

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('.custom-multiselect-dropdown')) return;
      fecharDropdownsMultiselect();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') fecharDropdownsMultiselect();
    });
  }

  function hydrateCustomMultiselects(root = document) {
    const base = root || document;
    ensureMultiselectOutsideListener();

    base.querySelectorAll('.custom-multiselect-dropdown[data-multiselect-dropdown]').forEach((dropdown) => {
      bindDropdownMultiselect(dropdown, base);
    });

    base.querySelectorAll('.custom-multiselect-panel[data-multiselect-ui]:not(.custom-relation-multi-panel)').forEach((panel) => {
      const slug = String(panel.getAttribute('data-multiselect-ui') || '').trim();
      if (!slug) return;

      updateCustomMultiselectValue(base, slug);

      if (panel.dataset.multiselectBound === 'true') return;
      panel.dataset.multiselectBound = 'true';

      panel.addEventListener('change', (event) => {
        const input = event.target;
        if (!input || !input.matches('[data-multiselect-option]')) return;
        updateCustomMultiselectValue(base, slug);
      });
    });
  }

  function renderCustomFormSections({
    container,
    formulario = null,
    camposAvulsos = [],
    values = {},
    usarFichaPrincipal = false,
    flatTitle = 'Campos personalizados',
    flatDescription = 'Campos extras do cadastro.',
    emptyMessage = 'Nenhum campo configurado para este formulário.',
  } = {}) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return [];

    el.classList.add('custom-form-sections');
    el.classList.remove('form-row', 'is-loading');

    let secoes = [];

    if (formulario?.modelo) {
      secoes = montarSecoesDoFormulario(formulario, camposAvulsos, { usarFichaPrincipal });
    }

    if (!secoes.length && !usarFichaPrincipal) {
      secoes = montarSecoesFlat(camposAvulsos, {
        titulo: flatTitle,
        descricao: flatDescription,
      });
    }

    el.dataset.customSectionsCount = String(secoes.length || 0);

    if (!secoes.length) {
      el.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          ${escapeHtml(emptyMessage)}
        </div>
      `;
      animateRenderedSections(el);
      return [];
    }

    el.innerHTML = secoes.map((secao) => renderSecao(secao, values)).join('');
    hydrateCustomMultiselects(el);
    hydrateLookupFields(el);
    animateRenderedSections(el);
    enhanceLongFields(el);
    if (global.ValoraRequired && typeof global.ValoraRequired.refresh === 'function') {
      global.ValoraRequired.refresh(el);
    }
    return secoes;
  }

  function collectCustomFieldsValues(root = document, { includeSystem = false } = {}) {
    const out = {};

    root.querySelectorAll('[data-custom-field]').forEach((el) => {
      const slug = String(el.getAttribute('data-custom-field') || '').trim();
      if (!slug) return;
      if (el.disabled || el.dataset.customReadonly === 'true') return;

      const origin = String(
        el.dataset.fieldOrigin ||
        el.closest('[data-field-origin]')?.dataset?.fieldOrigin ||
        'personalizado'
      ).toLowerCase();

      if (!includeSystem && origin === 'sistema') return;

      if (el.type === 'checkbox') {
        out[slug] = el.checked ? 'true' : 'false';
        return;
      }

      if (el.matches('input.custom-multiselect-hidden[data-custom-multiple="true"]')) {
        const values = parseMultiValor(el.value);
        out[slug] = values.length ? JSON.stringify(values) : '';
        return;
      }

      if (el.matches('select[multiple], [data-custom-multiple="true"]')) {
        const values = Array.from(el.selectedOptions || [])
          .map((opt) => String(opt.value ?? '').trim())
          .filter(Boolean);

        out[slug] = values.length ? JSON.stringify(values) : '';
        return;
      }

      const value = String(el.value ?? '').trim();
      out[slug] = value;
    });

    return out;
  }

  function validateRequiredRenderedFields({ root = document, toast = null, switchToCustomTab = null } = {}) {
    const required = Array.from(root.querySelectorAll('[data-custom-field][data-required="true"]'));

    for (const el of required) {
      const label = el.dataset.customLabel || el.dataset.customField || 'Campo obrigatório';
      let invalid = false;

      if (el.type === 'checkbox') {
        invalid = !el.checked;
      } else if (el.matches('input.custom-multiselect-hidden[data-custom-multiple="true"]')) {
        invalid = parseMultiValor(el.value).length === 0;
      } else if (el.matches('select[multiple], [data-custom-multiple="true"]')) {
        invalid = !Array.from(el.selectedOptions || []).some((opt) => String(opt.value || '').trim());
      } else {
        invalid = String(el.value ?? '').trim() === '';
      }

      if (!invalid) continue;

      if (typeof switchToCustomTab === 'function') switchToCustomTab();
      if (typeof toast === 'function') toast(`Preencha o campo obrigatório: ${label}`, 'error');

      if (el.matches('input.custom-multiselect-hidden[data-custom-multiple="true"]')) {
        const panel = root.querySelector(`[data-multiselect-ui="${cssEscape(el.dataset.customField || '')}"]`);
        if (panel) {
          panel.classList.add('is-invalid');
          try { panel.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
          const firstOption = panel.querySelector('input[type="checkbox"]');
          try { firstOption?.focus(); } catch (_) {}
        }
      } else {
        try { el.focus(); } catch (_) {}
      }
      return false;
    }

    return true;
  }

  function cleanSectionTitleForSidebar(value, index = 0) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[:;|]+\s*$/g, '')
      .trim();

    return text || `Seção ${index + 1}`;
  }

  function getSectionTitleFromCard(card, index) {
    const raw =
      card.querySelector('.custom-section-head h4')?.textContent ||
      card.querySelector('h4')?.textContent ||
      `Seção ${index + 1}`;

    return cleanSectionTitleForSidebar(raw, index);
  }

  function createTabFichaController({
    formSelector,
    tabsSelector,
    tabButtonSelector,
    tabPanelSelector,
    customTabId,
    customContainerSelector,
    codeCardSelector,
    toggleSelector,
    normalTabId,
    modeClass = 'is-ficha-principal',
    sectionButtonClass = 'ficha-section-tab-btn',
    buttonClass = '',
    onSectionChange = null,
  } = {}) {
    let originalTabsHtml = '';

    const q = (selector) => selector ? document.querySelector(selector) : null;
    const qa = (selector) => selector ? Array.from(document.querySelectorAll(selector)) : [];

    function showOnlyCustomTab() {
      qa(tabPanelSelector).forEach((tab) => {
        const isCustom = tab.id === customTabId;
        tab.classList.toggle('active', isCustom);
        tab.style.display = isCustom ? 'block' : 'none';
      });
    }

    function showAllTabs() {
      qa(tabPanelSelector).forEach((tab) => {
        tab.style.display = '';
      });
    }

    function showAllSections() {
      const container = q(customContainerSelector);
      if (!container) return;

      container.querySelectorAll('.custom-section-card').forEach((card) => {
        card.style.display = '';
      });
    }

    function activateSection(index = 0) {
      const container = q(customContainerSelector);
      if (!container) return;

      const cards = Array.from(container.querySelectorAll('.custom-section-card'));
      const buttons = qa(`${tabsSelector} [data-ficha-section]`);

      if (!cards.length) return;

      cards.forEach((card, cardIndex) => {
        const active = cardIndex === Number(index);
        card.classList.remove('is-section-active');
        card.style.display = active ? 'block' : 'none';

        if (active) {
          void card.offsetWidth;
          card.classList.add('is-section-active');
        }
      });

      buttons.forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.fichaSection) === Number(index));
      });

      if (typeof onSectionChange === 'function') onSectionChange(Number(index));
    }

    function mountSectionTabs() {
      const tabs = q(tabsSelector);
      const container = q(customContainerSelector);
      if (!tabs || !container) return;

      tabs.style.display = '';
      const cards = Array.from(container.querySelectorAll('.custom-section-card'));

      if (!cards.length) {
        tabs.innerHTML = `
          <button type="button" class="${escapeHtml(buttonClass || sectionButtonClass)} active" data-ficha-section="0">
            <span class="ficha-section-tab-icon" aria-hidden="true"><i class="fa-solid fa-layer-group"></i></span>
            <span class="ficha-section-tab-label">Campos do formulário</span>
          </button>
        `;
        return;
      }

      tabs.innerHTML = cards
        .map((card, index) => {
          const icon = getSectionIconFromCard(card);
          const title = getSectionTitleFromCard(card, index);

          return `
            <button
              type="button"
              class="${escapeHtml(buttonClass || sectionButtonClass)} ${index === 0 ? 'active' : ''}"
              data-ficha-section="${index}"
            >
              <span class="ficha-section-tab-icon" aria-hidden="true"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
              <span class="ficha-section-tab-label">${escapeHtml(title)}</span>
            </button>
          `;
        })
        .join('');
    }

    function switchTab(targetId) {
      qa(tabButtonSelector).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === targetId);
      });

      qa(tabPanelSelector).forEach((tab) => {
        tab.classList.toggle('active', tab.id === targetId);
      });
    }

    function setMode(enabled) {
      const form = q(formSelector);
      const tabs = q(tabsSelector);
      const codeCard = q(codeCardSelector);
      const toggle = q(toggleSelector);

      if (form) {
        form.classList.toggle(modeClass, !!enabled);
        form.classList.remove('is-ficha-entering', 'is-ficha-leaving');
        void form.offsetWidth;
        form.classList.add(enabled ? 'is-ficha-entering' : 'is-ficha-leaving');
        window.setTimeout(() => {
          form.classList.remove('is-ficha-entering', 'is-ficha-leaving');
        }, 420);
      }
      if (codeCard) codeCard.hidden = !enabled;
      if (toggle) toggle.checked = !!enabled;

      if (!tabs) return;

      if (!originalTabsHtml) {
        originalTabsHtml = tabs.innerHTML;
      }

      if (enabled) {
        showOnlyCustomTab();
        mountSectionTabs();
        activateSection(0);
        return;
      }

      tabs.innerHTML = originalTabsHtml;
      tabs.style.display = '';
      showAllTabs();
      showAllSections();
      switchTab(normalTabId);
    }

    function bindSectionClicks() {
      document.addEventListener('click', (event) => {
        const btn = event.target.closest(`${tabsSelector} [data-ficha-section]`);
        if (!btn) return;
        activateSection(btn.dataset.fichaSection);
      });
    }

    return {
      setMode,
      switchTab,
      activateSection,
      mountSectionTabs,
      bindSectionClicks,
    };
  }

  global.ValoraFichaPrincipal = {
    API_FORMULARIOS,
    slugify,
    escapeHtml,
    apiJson,
    parseCampoOpcoes,
    normalizarTipo,
    carregarFormularioModulo,
    clearFormularioCache,
    readFormularioCache,
    writeFormularioCache,
    atualizarFichaPrincipalModelo,
    renderCustomFormSections,
    collectCustomFieldsValues,
    validateRequiredRenderedFields,
    showLoading,
    animateRenderedSections,
    createTabFichaController,
    enhanceLongFields,
    syncLongFieldUi,
  };

  initLongFieldEvents();
})(window);
