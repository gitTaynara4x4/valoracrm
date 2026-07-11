import { state, API_CLIENTES, API_CAMPOS, API_FORMULARIOS } from './state.js?v=20260710-integridade-clientes-v1';
import { getFiltroClientes } from './filters.js?v=20260710-integridade-clientes-v1';

let clientesRequestSequence = 0;
let clientesAbortController = null;

function parseResponsePayload(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function getErrorMessage(payload, fallback = 'Erro na requisição.') {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();

  const detail = payload?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (detail && typeof detail === 'object') {
    return String(detail.message || detail.detail || detail.error || fallback);
  }

  return String(payload?.message || payload?.error || fallback);
}

export async function apiJson(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await resp.text();
  const payload = parseResponsePayload(text);

  if (!resp.ok) {
    const error = new Error(getErrorMessage(payload, `Erro HTTP ${resp.status}.`));
    error.status = resp.status;
    error.data = payload;
    error.url = url;
    throw error;
  }

  if (resp.status === 204) return null;
  return payload;
}

function montarUrlClientes({ offset = 0, limit = state.clientesPage?.limit || 50, focusId = null } = {}) {
  const filtro = getFiltroClientes();
  const params = new URLSearchParams();
  params.set('paginated', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (focusId) params.set('cliente_id', String(focusId));

  if (filtro.busca) params.set('busca', filtro.busca);
  if (filtro.tipo) params.set('tipo_pessoa', filtro.tipo);
  if (filtro.situacao) params.set('situacao', filtro.situacao);
  if (filtro.cidade) params.set('cidade', filtro.cidade);

  window.ValoraLocalizarPersonalizado?.addParams?.(
    params,
    'localizar-personalizado-clientes'
  );

  return `${API_CLIENTES}?${params.toString()}`;
}

function aplicarPaginaClientes(data, limitFallback) {
  if (Array.isArray(data)) {
    state.clientes = data;
    state.clientesPage = {
      offset: 0,
      limit: data.length || limitFallback,
      total: data.length,
      hasMore: false,
    };
    return;
  }

  state.clientes = Array.isArray(data?.items) ? data.items : [];
  state.clientesPage = {
    offset: Number(data?.offset || 0),
    limit: Number(data?.limit || limitFallback),
    total: Number(data?.total || state.clientes.length),
    hasMore: !!data?.has_more,
  };
}

async function buscarPaginaClientes({ offset, limit, focusId, signal }) {
  return apiJson(montarUrlClientes({ offset, limit, focusId }), { signal });
}

export async function carregarClientes({
  offset = state.clientesPage?.offset || 0,
  limit = state.clientesPage?.limit || 50,
  focusId = null,
} = {}) {
  const sequence = ++clientesRequestSequence;

  if (clientesAbortController) {
    clientesAbortController.abort();
  }

  const controller = new AbortController();
  clientesAbortController = controller;

  try {
    let data = await buscarPaginaClientes({ offset, limit, focusId, signal: controller.signal });

    if (sequence !== clientesRequestSequence) return null;

    // Se o último item de uma página foi excluído, volta automaticamente para
    // a última página válida em vez de deixar uma lista vazia parecendo sumiço.
    if (
      !Array.isArray(data) &&
      Number(offset) > 0 &&
      Array.isArray(data?.items) &&
      data.items.length === 0 &&
      Number(data?.total || 0) > 0
    ) {
      const total = Number(data.total || 0);
      const lastOffset = Math.floor((total - 1) / Number(limit || 50)) * Number(limit || 50);
      data = await buscarPaginaClientes({
        offset: Math.max(0, lastOffset),
        limit,
        focusId,
        signal: controller.signal,
      });
    }

    if (sequence !== clientesRequestSequence) return null;

    aplicarPaginaClientes(data, limit);
    return state.clientes;
  } catch (err) {
    if (err?.name === 'AbortError' || sequence !== clientesRequestSequence) {
      return null;
    }
    throw err;
  } finally {
    if (clientesAbortController === controller) {
      clientesAbortController = null;
    }
  }
}

export async function obterClienteNoServidor(id) {
  return apiJson(`${API_CLIENTES}/${id}`);
}

export async function verificarDuplicidadeCliente(payload = {}) {
  return apiJson(`${API_CLIENTES}/verificar-duplicidade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      codigo: payload.codigo || null,
      cpf_cnpj: payload.cpf_cnpj || null,
      telefone: payload.telefone || null,
      whatsapp: payload.whatsapp || null,
      email: payload.email || null,
      excluir_cliente_id: payload.excluir_cliente_id || null,
    }),
  });
}

export async function salvarClienteNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_CLIENTES : `${API_CLIENTES}/${editandoId}`;

  const salvo = await apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Confirma imediatamente que o registro gravado pode ser lido pela mesma
  // empresa antes de a tela fechar o modal.
  if (salvo?.id) {
    return obterClienteNoServidor(salvo.id);
  }

  return salvo;
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
