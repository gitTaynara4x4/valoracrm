import { state, API_FORNECEDORES, API_CAMPOS } from './state.js';
import { getFiltroFornecedores } from './filters.js';

export async function apiJson(url, options = {}) {
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

  if (resp.status === 204 || !text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function montarUrlFornecedores({ offset = 0, limit = state.fornecedoresPage?.limit || 50 } = {}) {
  const filtro = getFiltroFornecedores();
  const params = new URLSearchParams();
  params.set('paginated', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (filtro.busca) params.set('busca', filtro.busca);
  if (filtro.tipo) params.set('tipo_fornecedor', filtro.tipo);
  if (filtro.situacao) params.set('situacao', filtro.situacao);
  if (filtro.cidade) params.set('cidade', filtro.cidade);

  return `${API_FORNECEDORES}?${params.toString()}`;
}

export async function carregarFornecedores({ offset = state.fornecedoresPage?.offset || 0, limit = state.fornecedoresPage?.limit || 50 } = {}) {
  const data = await apiJson(montarUrlFornecedores({ offset, limit }));

  if (Array.isArray(data)) {
    state.fornecedores = data;
    state.fornecedoresPage = {
      offset: 0,
      limit: data.length || limit,
      total: data.length,
      hasMore: false,
    };
    return state.fornecedores;
  }

  state.fornecedores = Array.isArray(data?.items) ? data.items : [];
  state.fornecedoresPage = {
    offset: Number(data?.offset || 0),
    limit: Number(data?.limit || limit),
    total: Number(data?.total || state.fornecedores.length),
    hasMore: !!data?.has_more,
  };

  return state.fornecedores;
}

export async function obterFornecedorNoServidor(id) {
  return apiJson(`${API_FORNECEDORES}/${id}`);
}

export async function obterProximoCodigoFornecedor() {
  return apiJson(`${API_FORNECEDORES}/proximo-codigo`);
}

export async function salvarFornecedorNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_FORNECEDORES : `${API_FORNECEDORES}/${editandoId}`;
  const bodyPayload = { ...(payload || {}) };

  // Código é do sistema: único e imutável.
  // Nunca deixa o front decidir/alterar código de fornecedor.
  delete bodyPayload.codigo;

  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload),
  });
}

export async function excluirFornecedorNoServidor(id) {
  return apiJson(`${API_FORNECEDORES}/${id}`, { method: 'DELETE' });
}

export async function carregarCamposFornecedores() {
  const data = await apiJson(API_CAMPOS);
  state.camposFornecedores = Array.isArray(data) ? data : [];
  state.camposFornecedores.sort(
    (a, b) =>
      Number(a.ordem || 0) - Number(b.ordem || 0) ||
      String(a.nome || '').localeCompare(String(b.nome || ''))
  );
  return state.camposFornecedores;
}

export async function obterCampoFornecedor(id) {
  return apiJson(`${API_CAMPOS}/${id}`);
}

export async function salvarCampoFornecedor(payload, editandoId) {
  const url = editandoId == null ? API_CAMPOS : `${API_CAMPOS}/${editandoId}`;
  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function excluirCampoFornecedor(id) {
  return apiJson(`${API_CAMPOS}/${id}`, { method: 'DELETE' });
}
