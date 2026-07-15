// /frontend/js/shared/localizar-personalizado.js
// Monta filtros/colunas da listagem usando o construtor de Formulários
// e respeita a configuração visual feita na prévia do Localizar.
(() => {
  'use strict';

  const API_FORMULARIOS = '/api/formularios';
  const LAYOUT_PREFIX = 'valora_localizar_layout_v3:';
  const cache = new Map();

  const NATIVE_FILTERS = {
    clientes: {
      busca: 'filtro-busca',
      tipo: 'filtro-tipo',
      situacao: 'filtro-situacao',
      cidade: 'filtro-cidade',
    },
    fornecedores: {
      busca: 'filtro-busca',
      tipo: 'filtro-tipo',
      situacao: 'filtro-situacao',
      cidade: 'filtro-cidade',
    },
    produtos: {
      busca: 'busca-produtos',
      categoria: 'filtro-categoria-produtos',
      situacao: 'filtro-ativo-produtos',
    },
  };

  const NATIVE_COLUMNS = {
    clientes: [
      { key: 'codigo', label: 'Código' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'nome', label: 'Nome / Razão Social' },
      { key: 'documento', label: 'Documento' },
      { key: 'cidade', label: 'Cidade / UF' },
      { key: 'contato', label: 'Contato' },
      { key: 'situacao', label: 'Situação' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    fornecedores: [
      { key: 'codigo', label: 'Código' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'fornecedor', label: 'Fornecedor' },
      { key: 'documento', label: 'Documento' },
      { key: 'cidade', label: 'Cidade / UF' },
      { key: 'contato', label: 'Contato' },
      { key: 'situacao', label: 'Situação' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    produtos: [
      { key: 'codigo', label: 'Código' },
      { key: 'produto', label: 'Produto' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'preco', label: 'Preço' },
      { key: 'estoque', label: 'Estoque' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
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

  function parseMaybeJson(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(String(value));
    } catch (_) {
      return fallback;
    }
  }

  function normalizarTipo(tipo) {
    const t = String(tipo || 'texto').trim().toLowerCase();
    const mapa = {
      text: 'texto',
      texto: 'texto',
      textarea: 'textarea',
      numero: 'numero',
      number: 'numero',
      data: 'data',
      date: 'data',
      select: 'select',
      lista: 'select',
      multiselect: 'multiselect',
      checkbox: 'checkbox',
      email: 'email',
      telefone: 'telefone',
      tel: 'telefone',
      moeda: 'moeda',
      percentual: 'percentual',
    };
    return mapa[t] || t;
  }

  function getCondicao(campo) {
    return parseMaybeJson(campo?.condicao, null) || parseMaybeJson(campo?.condicao_json, null) || {};
  }

  function getExibicao(campo) {
    const condicao = getCondicao(campo);
    return condicao.exibicao || condicao.listagem || {};
  }

  function boolFlag(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'sim';
  }

  function campoOrigemReal(campo) {
    return String(campo?.origem || 'personalizado').toLowerCase() === 'sistema' ? 'sistema' : 'custom';
  }

  function campoChave(campo) {
    if (campoOrigemReal(campo) === 'sistema') {
      return String(campo?.campo_sistema || '').trim();
    }

    return String(
      campo?.slug ||
      campo?.campo_personalizado_slug ||
      campo?.campo ||
      slugify(campo?.label || campo?.nome || '')
    ).trim();
  }

  function layoutStorageKey(modulo) {
    return `${LAYOUT_PREFIX}${modulo || 'clientes'}`;
  }

  function normalizarOrdem(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function normalizarLayout(raw) {
    const hiddenFilters = Array.isArray(raw?.hiddenFilters) ? raw.hiddenFilters : [];
    const hiddenColumns = Array.isArray(raw?.hiddenColumns) ? raw.hiddenColumns : [];

    return {
      hiddenFilters: [...new Set(hiddenFilters.map((item) => String(item || '').trim()).filter(Boolean))],
      hiddenColumns: [...new Set(hiddenColumns.map((item) => String(item || '').trim()).filter(Boolean))],
      filterOrder: normalizarOrdem(raw?.filterOrder),
      columnOrder: normalizarOrdem(raw?.columnOrder),
    };
  }

  function getLayout(modulo) {
    try {
      return normalizarLayout(JSON.parse(localStorage.getItem(layoutStorageKey(modulo)) || '{}'));
    } catch (_) {
      return normalizarLayout({});
    }
  }


  async function carregarLayoutServidor(modulo) {
    try {
      const data = await apiJson(`${API_FORMULARIOS}/layout-localizar/${encodeURIComponent(modulo)}`);
      const layout = normalizarLayout(data?.layout || {});
      localStorage.setItem(layoutStorageKey(modulo), JSON.stringify(layout));
      return layout;
    } catch (err) {
      console.warn('[Localizar] layout compartilhado indisponível; usando configuração deste navegador.', err);
      return getLayout(modulo);
    }
  }

  function itemLayoutKey(origin, key) {
    return `${origin || 'nativo'}:${key || ''}`;
  }


  function orderProp(area) {
    return area === 'columns' ? 'columnOrder' : 'filterOrder';
  }

  function sortLayoutItems(modulo, area, items) {
    const layout = getLayout(modulo);
    const saved = layout[orderProp(area)] || [];
    const indexMap = new Map(saved.map((key, index) => [key, index]));

    return [...items].sort((a, b) => {
      const aFixed = !!a?.fixed || a?.key === 'acoes';
      const bFixed = !!b?.fixed || b?.key === 'acoes';
      if (aFixed !== bFixed) return aFixed ? 1 : -1;

      const aKey = itemLayoutKey(a?.origin || a?.origem, a?.key);
      const bKey = itemLayoutKey(b?.origin || b?.origem, b?.key);
      const aIndex = indexMap.has(aKey) ? indexMap.get(aKey) : Number.MAX_SAFE_INTEGER;
      const bIndex = indexMap.has(bKey) ? indexMap.get(bKey) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;

      return Number(a?.defaultOrder || a?.ordem || 0) - Number(b?.defaultOrder || b?.ordem || 0);
    });
  }

  function isItemVisible(modulo, area, origin, key, fixed = false) {
    if (fixed || key === 'acoes') return true;

    const layout = getLayout(modulo);
    const hiddenList = area === 'columns' ? layout.hiddenColumns : layout.hiddenFilters;
    return !hiddenList.includes(itemLayoutKey(origin, key));
  }

  function normalizarCampo(campo) {
    const origem = campoOrigemReal(campo);
    const key = campoChave(campo);
    const exibicao = getExibicao(campo);
    const tipo = normalizarTipo(campo?.tipo_campo || campo?.tipo || 'texto');

    return {
      id: campo?.id,
      origem,
      key,
      slug: origem === 'custom' ? key : '',
      campo_sistema: origem === 'sistema' ? key : '',
      label: String(campo?.label || campo?.nome || key || 'Campo').trim(),
      tipo,
      opcoes: parseMaybeJson(campo?.opcoes, null) || parseMaybeJson(campo?.opcoes_json, null),
      ordem: Number(campo?.ordem || 0),
      usarNoLocalizar: boolFlag(exibicao.usar_no_localizar ?? exibicao.localizar ?? exibicao.filtro),
      mostrarNaTabela: boolFlag(exibicao.mostrar_na_tabela ?? exibicao.tabela ?? exibicao.coluna),
    };
  }

  function getCamposFromModelo(modeloCompleto) {
    const direto = Array.isArray(modeloCompleto?.campos) ? modeloCompleto.campos : [];
    const semSecao = Array.isArray(modeloCompleto?.campos_sem_secao) ? modeloCompleto.campos_sem_secao : [];
    const emSecoes = Array.isArray(modeloCompleto?.secoes)
      ? modeloCompleto.secoes.flatMap((secao) => Array.isArray(secao.campos) ? secao.campos : [])
      : [];

    const map = new Map();
    [...direto, ...semSecao, ...emSecoes].forEach((campo) => {
      if (!campo || campo.ativo === false || campo.origem === 'visual') return;
      const normalized = normalizarCampo(campo);
      if (!normalized.key) return;
      map.set(`${normalized.origem}:${normalized.key}`, normalized);
    });

    return [...map.values()].sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
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
      let message = text || 'Erro ao carregar formulário.';
      try {
        const json = JSON.parse(text);
        message = json.detail || json.message || message;
      } catch (_) {}
      throw new Error(message);
    }

    if (!text || resp.status === 204) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  function campoDeveEntrarNoLocalizar(field, modulo) {
    if (!field) return false;

    const filtroVisivel = isItemVisible(modulo, 'filters', field.origem, field.key);
    if (!filtroVisivel) return false;

    // Regra nova: o Localizar precisa conversar com a tabela.
    // Se o campo aparece como coluna, ele também vira filtro automaticamente.
    // Ainda dá para criar campo só para filtro marcando "Usar no localizar".
    if (field.mostrarNaTabela && isItemVisible(modulo, 'columns', field.origem, field.key)) {
      return true;
    }

    return !!field.usarNoLocalizar;
  }

  async function carregarModulo(modulo, { force = false } = {}) {
    const key = String(modulo || '').trim();
    if (!key) return { fields: [], filterFields: [], tableFields: [] };
    if (!force && cache.has(key)) return cache.get(key);

    const modelos = await apiJson(`${API_FORMULARIOS}/modelos?modulo=${encodeURIComponent(key)}&ativo=true`);
    const lista = Array.isArray(modelos) ? modelos : [];
    const modeloResumo = lista.find((m) => m.usar_como_ficha_principal) || lista.find((m) => m.padrao) || lista[0];

    if (!modeloResumo?.id) {
      const empty = { modulo: key, modelo: null, fields: [], filterFields: [], tableFields: [] };
      cache.set(key, empty);
      return empty;
    }

    const completo = await apiJson(`${API_FORMULARIOS}/modelos/${modeloResumo.id}`);
    const fields = getCamposFromModelo(completo);
    const filterFields = sortLayoutItems(
      key,
      'filters',
      fields.filter((field) => campoDeveEntrarNoLocalizar(field, key))
    );
    const tableFields = sortLayoutItems(
      key,
      'columns',
      fields.filter((field) => field.mostrarNaTabela && isItemVisible(key, 'columns', field.origem, field.key))
    );
    const value = {
      modulo: key,
      modelo: completo?.modelo || modeloResumo,
      fields,
      filterFields,
      tableFields,
    };

    cache.set(key, value);
    return value;
  }

  function normalizarOpcoes(opcoes) {
    const parsed = parseMaybeJson(opcoes, opcoes);

    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (item && typeof item === 'object') {
            const value = item.value ?? item.valor ?? item.label ?? item.nome ?? '';
            const label = item.label ?? item.nome ?? item.valor ?? item.value ?? '';
            return { value: String(value || '').trim(), label: String(label || value || '').trim() };
          }
          return { value: String(item || '').trim(), label: String(item || '').trim() };
        })
        .filter((item) => item.value || item.label);
    }

    return String(parsed || '')
      .split(/\r?\n|;/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => ({ value: item, label: item }));
  }

  function renderCampoFiltro(field, modulo, containerId) {
    const inputId = `lp-${slugify(modulo)}-${field.origem}-${slugify(field.key)}`;
    const label = escapeHtml(field.label || field.key);
    const dataAttrs = `
      data-localizar-personalizado="true"
      data-localizar-container-id="${escapeHtml(containerId || '')}"
      data-origem="${escapeHtml(field.origem)}"
      data-field="${escapeHtml(field.key)}"
      data-filter-type="${escapeHtml(field.tipo || 'texto')}"
      data-param="${escapeHtml(field.origem === 'sistema' ? `filtro_sistema_${field.key}` : `filtro_custom_${field.key}`)}"
    `;
    const wrapperAttrs = `
      data-localizar-filter-item="true"
      data-origin="${escapeHtml(field.origem)}"
      data-key="${escapeHtml(field.key)}"
      data-layout-key="${escapeHtml(itemLayoutKey(field.origem, field.key))}"
    `;

    if (field.tipo === 'checkbox') {
      return `
        <div class="form-group localizar-personalizado-field" ${wrapperAttrs}>
          <label for="${escapeHtml(inputId)}">${label}</label>
          <select id="${escapeHtml(inputId)}" ${dataAttrs}>
            <option value="">Todos</option>
            <option value="true">Sim</option>
            <option value="false">Não</option>
          </select>
        </div>
      `;
    }

    const opcoes = (field.tipo === 'select' || field.tipo === 'multiselect') ? normalizarOpcoes(field.opcoes) : [];
    if (opcoes.length) {
      return `
        <div class="form-group localizar-personalizado-field" ${wrapperAttrs}>
          <label for="${escapeHtml(inputId)}">${label}</label>
          <select id="${escapeHtml(inputId)}" ${dataAttrs}>
            <option value="">Todos</option>
            ${opcoes.map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label || opt.value)}</option>`).join('')}
          </select>
        </div>
      `;
    }

    const type = field.tipo === 'data' ? 'date' : (field.tipo === 'numero' ? 'number' : 'text');
    const placeholder = field.tipo === 'data' ? '' : `Filtrar por ${field.label || field.key}`;

    return `
      <div class="form-group localizar-personalizado-field" ${wrapperAttrs}>
        <label for="${escapeHtml(inputId)}">${label}</label>
        <input id="${escapeHtml(inputId)}" type="${type}" placeholder="${escapeHtml(placeholder)}" ${dataAttrs} />
      </div>
    `;
  }

  function renderFiltros(modulo, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const config = cache.get(modulo) || { filterFields: [] };
    const fields = Array.isArray(config.filterFields) ? config.filterFields : [];

    container.innerHTML = fields.map((field) => renderCampoFiltro(field, modulo, containerId)).join('');
    container.hidden = !fields.length;
    container.classList.toggle('has-custom-filters', !!fields.length);
    container.classList.toggle('is-layout-contents', !!fields.length);
  }

  function applyNativeFilterLayout(modulo, filtersContainerId) {
    const map = NATIVE_FILTERS[modulo] || {};
    const config = cache.get(modulo) || { filterFields: [] };
    const nativeItems = Object.keys(map).map((key, index) => ({
      origin: 'nativo',
      key,
      defaultOrder: index,
    }));
    const dynamicItems = (config.filterFields || []).map((field, index) => ({
      ...field,
      origin: field.origem,
      defaultOrder: nativeItems.length + index,
    }));
    const ordered = sortLayoutItems(modulo, 'filters', [...nativeItems, ...dynamicItems]);
    const orderMap = new Map(ordered.map((item, index) => [itemLayoutKey(item.origin || item.origem, item.key), index]));

    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;

      const visible = isItemVisible(modulo, 'filters', 'nativo', key);
      const group = el.closest('.form-group') || el;

      group.hidden = !visible;
      group.classList.toggle('localizar-native-hidden', !visible);
      group.style.order = String(orderMap.get(itemLayoutKey('nativo', key)) ?? 9999);
      el.toggleAttribute('data-localizar-native-hidden', !visible);

      if (!visible) el.value = '';
    });

    const container = filtersContainerId ? document.getElementById(filtersContainerId) : null;
    container?.querySelectorAll('[data-localizar-filter-item="true"]').forEach((group) => {
      const fullKey = String(group.dataset.layoutKey || '');
      group.style.order = String(orderMap.get(fullKey) ?? 9999);
    });
  }

  async function setup({ modulo, filtersContainerId, force = false } = {}) {
    await carregarLayoutServidor(modulo);
    if (force) cache.delete(String(modulo || '').trim());
    const config = await carregarModulo(modulo, { force });
    if (filtersContainerId) renderFiltros(modulo, filtersContainerId);
    applyNativeFilterLayout(modulo, filtersContainerId);
    return config;
  }

  function addParams(params, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !params) return params;

    let activeCount = 0;
    container.querySelectorAll('[data-localizar-personalizado="true"]').forEach((el) => {
      if (el.disabled) return;
      const value = String(el.value ?? '').trim();
      const param = String(el.dataset.param || '').trim();
      if (!param || !value) return;
      params.set(param, value);
      activeCount += 1;
    });

    // Ajuda a detectar regressões no navegador: qualquer filtro preenchido
    // precisa resultar em um parâmetro enviado para a API.
    container.dataset.activeFilterCount = String(activeCount);
    return params;
  }

  function clearFilters(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('[data-localizar-personalizado="true"]').forEach((el) => {
      el.value = '';
    });
  }

  function bindFilters(containerId, onChange) {
    const container = document.getElementById(containerId);
    if (!container || container.dataset.localizarBound === 'true') return;

    let timer = null;
    const fire = (delay = 350) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (typeof onChange === 'function') onChange();
      }, delay);
    };

    container.addEventListener('input', (event) => {
      if (event.target?.matches?.('[data-localizar-personalizado="true"]')) fire(350);
    });

    container.addEventListener('change', (event) => {
      if (event.target?.matches?.('[data-localizar-personalizado="true"]')) fire(0);
    });

    container.dataset.localizarBound = 'true';
  }

  function getTableFields(modulo) {
    const config = cache.get(modulo) || { tableFields: [] };
    return Array.isArray(config.tableFields) ? config.tableFields : [];
  }

  function getNativeColumns(modulo) {
    const columns = NATIVE_COLUMNS[modulo] || NATIVE_COLUMNS.clientes;
    const visible = columns
      .filter((col) => isItemVisible(modulo, 'columns', 'nativo', col.key, col.fixed))
      .map((col, index) => ({ ...col, origin: 'nativo', defaultOrder: index }));
    return sortLayoutItems(modulo, 'columns', visible);
  }

  function getOrderedTableColumns(modulo) {
    const nativeBefore = [];
    const nativeAfter = [];

    (NATIVE_COLUMNS[modulo] || NATIVE_COLUMNS.clientes)
      .filter((col) => isItemVisible(modulo, 'columns', 'nativo', col.key, col.fixed))
      .forEach((col) => {
        const normalized = { ...col, kind: 'native', origin: 'nativo' };
        if (col.key === 'situacao' || col.key === 'acoes') nativeAfter.push(normalized);
        else nativeBefore.push(normalized);
      });

    const dynamic = getTableFields(modulo).map((field) => ({
      ...field,
      kind: 'dynamic',
      origin: field.origem,
    }));

    const defaults = [...nativeBefore, ...dynamic, ...nativeAfter]
      .map((item, index) => ({ ...item, defaultOrder: index }));

    return sortLayoutItems(modulo, 'columns', defaults);
  }

  function formatDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';

    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('pt-BR').format(date);
    }

    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return text;
  }

  function parseArrayValue(value) {
    if (Array.isArray(value)) return value;
    const parsed = parseMaybeJson(value, null);
    if (Array.isArray(parsed)) return parsed;
    return null;
  }

  function getRawValue(item, field) {
    if (!item || !field) return '';

    if (field.origem === 'sistema') {
      const aliases = {
        data_cadastro: 'criado_em',
        ativo: 'ativo',
        status: 'situacao',
      };
      const key = aliases[field.key] || field.key;
      return item[key] ?? item[field.key] ?? '';
    }

    return item.custom_fields?.[field.slug || field.key] ?? '';
  }

  function formatValue(item, field) {
    const raw = getRawValue(item, field);
    if (raw == null || raw === '') return '-';

    if (field.tipo === 'checkbox') {
      return boolFlag(raw) ? 'Sim' : 'Não';
    }

    if (field.tipo === 'data') {
      return formatDate(raw) || '-';
    }

    const arr = parseArrayValue(raw);
    if (arr) return arr.filter(Boolean).join(', ') || '-';

    return String(raw);
  }

  window.ValoraLocalizarPersonalizado = {
    setup,
    addParams,
    clearFilters,
    bindFilters,
    getTableFields,
    getNativeColumns,
    getOrderedTableColumns,
    getLayout,
    isItemVisible,
    formatValue,
    escapeHtml,
    slugify,
  };
})();
