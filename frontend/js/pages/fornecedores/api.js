import { state, API_FORNECEDORES, API_CAMPOS } from './state.js';

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
    throw new Error(txt || 'Erro na requisição.');
  }

  if (resp.status === 204) return null;
  return resp.json();
}

export async function carregarFornecedores() {
  const data = await apiJson(API_FORNECEDORES);
  state.fornecedores = Array.isArray(data) ? data : [];
  return state.fornecedores;
}

export async function obterFornecedorNoServidor(id) {
  return apiJson(`${API_FORNECEDORES}/${id}`);
}

export async function salvarFornecedorNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_FORNECEDORES : `${API_FORNECEDORES}/${editandoId}`;
  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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