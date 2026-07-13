// /frontend/js/shared/localizar-personalizado.js
// Monta filtros/colunas da listagem usando o construtor de Formulários
// e respeita a configuração visual feita na prévia do Localizar.
(() => {
  'use strict';

  const API_FORMULARIOS = '/api/formularios';
  const LAYOUT_PREFIX = 'valora_localizar_layout_v2:';
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

  function normalizarLayout(raw) {
    const hiddenFilters = Array.isArray(raw?.hiddenFilters) ? raw.hiddenFilters : [];
    const hiddenColumns = Array.isArray(raw?.hiddenColumns) ? raw.hiddenColumns : [];

    return {
      hiddenFilters: [...new Set(hiddenFilters.map((item) => String(item || '').trim()).filter(Boolean))],
      hiddenColumns: [...new Set(hiddenColumns.map((item) => String(item || '').trim()).filter(Boolean))],
    };
  }

  function getLayout(modulo) {
    try {
      return normalizarLayout(JSON.parse(localStorage.getItem(layoutStorageKey(modulo)) || '{}'));
    } catch (_) {
      return normalizarLayout({});
    }
  }

  function itemLayoutKey(origin, key) {
    return `${origin || 'nativo'}:${key || ''}`;
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
    const value = {
      modulo: key,
      modelo: completo?.modelo || modeloResumo,
      fields,
      filterFields: fields.filter((field) => campoDeveEntrarNoLocalizar(field, key)),
      tableFields: fields.filter((field) => field.mostrarNaTabela && isItemVisible(key, 'columns', field.origem, field.key)),
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

  function renderCampoFiltro(field, modulo) {
    const inputId = `lp-${slugify(modulo)}-${field.origem}-${slugify(field.key)}`;
    const label = escapeHtml(field.label || field.key);
    const dataAttrs = `
      data-localizar-personalizado="true"
      data-origem="${escapeHtml(field.origem)}"
      data-field="${escapeHtml(field.key)}"
      data-param="${escapeHtml(field.origem === 'sistema' ? `filtro_sistema_${field.key}` : `filtro_custom_${field.key}`)}"
    `;

    if (field.tipo === 'checkbox') {
      return `
        <div class="form-group localizar-personalizado-field">
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
        <div class="form-group localizar-personalizado-field">
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
      <div class="form-group localizar-personalizado-field">
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

    container.innerHTML = fields.map((field) => renderCampoFiltro(field, modulo)).join('');
    container.hidden = !fields.length;
    container.classList.toggle('has-custom-filters', !!fields.length);
  }

  function applyNativeFilterLayout(modulo) {
    const map = NATIVE_FILTERS[modulo] || {};

    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;

      const visible = isItemVisible(modulo, 'filters', 'nativo', key);
      const group = el.closest('.form-group') || el;

      group.hidden = !visible;
      group.classList.toggle('localizar-native-hidden', !visible);
      el.toggleAttribute('data-localizar-native-hidden', !visible);

      if (!visible) {
        el.value = '';
      }
    });
  }

  async function setup({ modulo, filtersContainerId, force = false } = {}) {
    const config = await carregarModulo(modulo, { force });
    applyNativeFilterLayout(modulo);
    if (filtersContainerId) renderFiltros(modulo, filtersContainerId);
    return config;
  }

  function addParams(params, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !params) return params;

    container.querySelectorAll('[data-localizar-personalizado="true"]').forEach((el) => {
      const value = String(el.value ?? '').trim();
      const param = String(el.dataset.param || '').trim();
      if (param && value) params.set(param, value);
    });

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
    return columns.filter((col) => isItemVisible(modulo, 'columns', 'nativo', col.key, col.fixed));
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
    getLayout,
    isItemVisible,
    formatValue,
    escapeHtml,
    slugify,
  };
})();
