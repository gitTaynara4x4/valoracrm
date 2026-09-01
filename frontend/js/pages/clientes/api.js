import { state, API_CLIENTES, API_CAMPOS, API_FORMULARIOS } from './state.js';
import { getFiltroClientes } from './filters.js';


const CLIENTE_DETAIL_CACHE_TTL_MS = 60_000;
const FORMULARIO_CLIENTES_CACHE_TTL_MS = 45_000;
const clienteDetailCache = new Map();
const clienteDetailInFlight = new Map();

function cloneClienteDetail(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (_) {}
  }
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return value; }
}

function getCachedClienteDetail(id) {
  const key = Number(id || 0);
  if (!key) return null;
  const cached = clienteDetailCache.get(key);
  if (!cached) return null;
  if ((Date.now() - cached.at) > CLIENTE_DETAIL_CACHE_TTL_MS) {
    clienteDetailCache.delete(key);
    return null;
  }
  return cloneClienteDetail(cached.data);
}

function setCachedClienteDetail(cliente) {
  const key = Number(cliente?.id || 0);
  if (!key || !cliente || typeof cliente !== 'object') return;
  clienteDetailCache.set(key, { at: Date.now(), data: cloneClienteDetail(cliente) });
}

export function invalidarClienteCache(id = null) {
  const key = Number(id || 0);
  if (key) {
    clienteDetailCache.delete(key);
    clienteDetailInFlight.delete(key);
    return;
  }
  clienteDetailCache.clear();
  clienteDetailInFlight.clear();
}

function formatValidationLocation(location = []) {
  const parts = Array.isArray(location) ? location : [];
  const visible = parts.filter((part) => !['body', 'query', 'path'].includes(String(part)));
  return visible.length ? visible.join(' > ') : '';
}

function formatApiDetail(detail, fallback = 'Erro na requisição.') {
  if (typeof detail === 'string' && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (!item || typeof item !== 'object') return String(item || '').trim();
        const location = formatValidationLocation(item.loc);
        const message = String(item.msg || item.message || '').trim();
        if (location && message) return `${location}: ${message}`;
        return message || location;
      })
      .filter(Boolean);
    if (messages.length) return messages.join(' • ');
  }

  if (detail && typeof detail === 'object') {
    const nestedMessage = detail.message || detail.msg || detail.error;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage.trim();
    }
    try {
      const serialized = JSON.stringify(detail);
      if (serialized && serialized !== '{}') return serialized;
    } catch (_) {}
  }

  return String(fallback || 'Erro na requisição.');
}

export async function apiJson(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const txt = await resp.text();
    let payload = null;
    try {
      payload = txt ? JSON.parse(txt) : null;
    } catch (_) {}

    const detail = payload?.detail ?? payload?.message ?? txt;
    const error = new Error(formatApiDetail(detail, txt || 'Erro na requisição.'));
    error.status = resp.status;
    error.payload = payload;
    error.detail = payload?.detail ?? null;
    throw error;
  }

  if (resp.status === 204) return null;
  return resp.json();
}

function montarUrlClientes({ offset = 0, limit = state.clientesPage?.limit || 50 } = {}) {
  const filtro = getFiltroClientes();
  const params = new URLSearchParams();
  params.set('paginated', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (filtro.busca) params.set('busca', filtro.busca);
  if (filtro.tipo) params.set('tipo_pessoa', filtro.tipo);
  if (filtro.situacao) params.set('situacao', filtro.situacao);
  if (filtro.cidade) params.set('cidade', filtro.cidade);

  // Inclui os filtros montados pela ficha principal (campos do sistema e
  // personalizados). Sem isso, o valor aparecia na tela, mas nunca era
  // enviado ao backend e a listagem continuava trazendo todos os clientes.
  window.ValoraLocalizarPersonalizado?.addParams?.(
    params,
    'localizar-personalizado-clientes'
  );

  return `${API_CLIENTES}?${params.toString()}`;
}

export async function carregarClientes({ offset = state.clientesPage?.offset || 0, limit = state.clientesPage?.limit || 50 } = {}) {
  const data = await apiJson(montarUrlClientes({ offset, limit }));

  if (Array.isArray(data)) {
    state.clientes = data;
    state.clientesPage = {
      offset: 0,
      limit: data.length || limit,
      total: data.length,
      hasMore: false,
    };
    return state.clientes;
  }

  state.clientes = Array.isArray(data?.items) ? data.items : [];
  state.clientesPage = {
    offset: Number(data?.offset || 0),
    limit: Number(data?.limit || limit),
    total: Number(data?.total || state.clientes.length),
    hasMore: !!data?.has_more,
  };

  return state.clientes;
}

export async function obterClienteNoServidor(id, { forceRefresh = false } = {}) {
  const key = Number(id || 0);
  if (!key) throw new Error('Cliente inválido.');

  if (!forceRefresh) {
    const cached = getCachedClienteDetail(key);
    if (cached) return cached;

    const pending = clienteDetailInFlight.get(key);
    if (pending) return cloneClienteDetail(await pending);
  }

  const request = apiJson(`${API_CLIENTES}/${key}`)
    .then((cliente) => {
      setCachedClienteDetail(cliente);
      return cliente;
    })
    .finally(() => {
      clienteDetailInFlight.delete(key);
    });

  clienteDetailInFlight.set(key, request);
  return cloneClienteDetail(await request);
}

export function prefetchClienteNoServidor(id) {
  const key = Number(id || 0);
  if (!key || getCachedClienteDetail(key) || clienteDetailInFlight.has(key)) {
    return Promise.resolve();
  }
  return obterClienteNoServidor(key).then(() => undefined).catch(() => undefined);
}

export async function obterClienteNaPosicaoDaLista(offset) {
  const safeOffset = Math.max(0, Number(offset || 0));
  const pageOffset = Number(state.clientesPage?.offset || 0);
  const items = Array.isArray(state.clientes) ? state.clientes : [];
  const localIndex = safeOffset - pageOffset;

  // O registro já está na página atual: não faz uma nova chamada só para descobrir o ID.
  if (localIndex >= 0 && localIndex < items.length) {
    return {
      item: items[localIndex] || null,
      offset: safeOffset,
      total: Number(state.clientesPage?.total || items.length || 0),
      fromMemory: true,
    };
  }

  // Só consulta o backend quando a navegação cruza a borda da página carregada.
  const data = await apiJson(montarUrlClientes({ offset: safeOffset, limit: 1 }));

  if (Array.isArray(data)) {
    return {
      item: data[0] || null,
      offset: safeOffset,
      total: Number(state.clientesPage?.total || data.length || 0),
      fromMemory: false,
    };
  }

  return {
    item: Array.isArray(data?.items) ? (data.items[0] || null) : null,
    offset: Number(data?.offset ?? safeOffset),
    total: Number(data?.total || 0),
    fromMemory: false,
  };
}

export async function salvarClienteNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_CLIENTES : `${API_CLIENTES}/${editandoId}`;
  const result = await apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Nunca reaproveita detalhe anterior depois de uma gravação.
  invalidarClienteCache(editandoId);
  invalidarClienteCache(result?.id);
  return result;
}

export async function excluirClienteNoServidor(id) {
  const result = await apiJson(`${API_CLIENTES}/${id}`, { method: 'DELETE' });
  invalidarClienteCache(id);
  return result;
}

export async function carregarCamposClientes() {
  const data = await apiJson(API_CAMPOS);

  state.camposClientes = Array.isArray(data) ? data : [];

  state.camposClientes.sort(
    (a, b) =>
      Number(a.ordem || 0) - Number(b.ordem || 0) ||
      String(a.nome || '').localeCompare(String(b.nome || ''))
  );

  return state.camposClientes;
}

export async function carregarFormularioClientes({ forceRefresh = false, loadingContainer = null } = {}) {
  const checkedAt = Number(state.formularioClientesCheckedAt || 0);
  if (
    !forceRefresh &&
    checkedAt > 0 &&
    (Date.now() - checkedAt) < FORMULARIO_CLIENTES_CACHE_TTL_MS
  ) {
    return state.formularioClientes;
  }

  if (window.ValoraFichaPrincipal?.carregarFormularioModulo) {
    const completo = await window.ValoraFichaPrincipal.carregarFormularioModulo('clientes', {
      apiJsonImpl: apiJson,
      ativo: true,
      forceRefresh,
      loadingContainer,
    });

    state.formularioClientes = completo;
    state.formularioClientesCheckedAt = Date.now();
    state.usarFichaPrincipalClientes = !!completo?.modelo?.usar_como_ficha_principal;

    return completo;
  }

  const modelos = await apiJson(`${API_FORMULARIOS}/modelos?modulo=clientes&ativo=true`);
  const lista = Array.isArray(modelos) ? modelos : [];

  if (!lista.length) {
    state.formularioClientes = null;
    state.formularioClientesCheckedAt = Date.now();
    state.usarFichaPrincipalClientes = false;
    return null;
  }

  const modeloResumo =
    lista.find((modelo) => modelo.usar_como_ficha_principal) ||
    lista.find((modelo) => modelo.padrao) ||
    lista[0];

  if (!modeloResumo?.id) {
    state.formularioClientes = null;
    state.formularioClientesCheckedAt = Date.now();
    state.usarFichaPrincipalClientes = false;
    return null;
  }

  const completo = await apiJson(`${API_FORMULARIOS}/modelos/${modeloResumo.id}`);

  state.formularioClientes = completo;
  state.formularioClientesCheckedAt = Date.now();
  state.usarFichaPrincipalClientes = !!completo?.modelo?.usar_como_ficha_principal;

  return completo;
}

export async function obterCampoCliente(id) {
  return apiJson(`${API_CAMPOS}/${id}`);
}

export async function salvarCampoCliente(payload, editandoId) {
  const url = editandoId == null ? API_CAMPOS : `${API_CAMPOS}/${editandoId}`;

  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function excluirCampoCliente(id) {
  return apiJson(`${API_CAMPOS}/${id}`, { method: 'DELETE' });
}
