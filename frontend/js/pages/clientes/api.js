import { state, API_CLIENTES, API_CAMPOS, API_FORMULARIOS } from './state.js';
import { getFiltroClientes } from './filters.js';

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

export async function obterClienteNoServidor(id) {
  return apiJson(`${API_CLIENTES}/${id}`);
}

export async function salvarClienteNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_CLIENTES : `${API_CLIENTES}/${editandoId}`;

  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function excluirClienteNoServidor(id) {
  return apiJson(`${API_CLIENTES}/${id}`, { method: 'DELETE' });
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
  if (window.ValoraFichaPrincipal?.carregarFormularioModulo) {
    const completo = await window.ValoraFichaPrincipal.carregarFormularioModulo('clientes', {
      apiJsonImpl: apiJson,
      ativo: true,
      forceRefresh,
      loadingContainer,
    });

    state.formularioClientes = completo;
    state.usarFichaPrincipalClientes = !!completo?.modelo?.usar_como_ficha_principal;

    return completo;
  }

  const modelos = await apiJson(`${API_FORMULARIOS}/modelos?modulo=clientes&ativo=true`);
  const lista = Array.isArray(modelos) ? modelos : [];

  if (!lista.length) {
    state.formularioClientes = null;
    state.usarFichaPrincipalClientes = false;
    return null;
  }

  const modeloResumo =
    lista.find((modelo) => modelo.usar_como_ficha_principal) ||
    lista.find((modelo) => modelo.padrao) ||
    lista[0];

  if (!modeloResumo?.id) {
    state.formularioClientes = null;
    state.usarFichaPrincipalClientes = false;
    return null;
  }

  const completo = await apiJson(`${API_FORMULARIOS}/modelos/${modeloResumo.id}`);

  state.formularioClientes = completo;
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
