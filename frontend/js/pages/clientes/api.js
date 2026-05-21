import { state, API_CLIENTES, API_CAMPOS } from './state.js';

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

export async function carregarClientes() {
  const data = await apiJson(API_CLIENTES);
  state.clientes = Array.isArray(data) ? data : [];
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