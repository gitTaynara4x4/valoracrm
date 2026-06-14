import { state } from './state.js';
import { escapeHtml } from './utils.js';

function renderBadgeTipo(tipo) {
  return `<span class="badge-tipo">${escapeHtml(tipo || 'PF')}</span>`;
}

function renderBadgeSituacao(situacao) {
  const s = String(situacao || 'ativo').toLowerCase();
  return `<span class="badge-status ${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function formatCidadeUf(cliente) {
  const cidade = String(cliente?.cidade || '').trim();
  const uf = String(cliente?.estado || '').trim();
  return [cidade, uf].filter(Boolean).join(' / ') || '-';
}

function formatContato(cliente) {
  return (
    cliente?.whatsapp ||
    cliente?.telefone ||
    cliente?.email ||
    cliente?.contato ||
    '-'
  );
}

function formatDocumento(cliente) {
  return cliente?.cpf_cnpj || '-';
}

function formatNome(cliente) {
  const nome = cliente?.nome || '-';
  const fantasia = cliente?.nome_fantasia || '';
  if (!fantasia) return `<strong>${escapeHtml(nome)}</strong>`;

  return `
    <div style="display:flex; flex-direction:column; gap:2px;">
      <strong>${escapeHtml(nome)}</strong>
      <span class="subtle">${escapeHtml(fantasia)}</span>
    </div>
  `;
}

export function renderTabelaClientes(clientes) {
  const tbody = document.getElementById('tbody-clientes');
  const spanCount = document.getElementById('contagem-clientes');

  if (!tbody) return;

  if (!Array.isArray(clientes) || !clientes.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="border:none; text-align:center;">
          Nenhum cliente encontrado.
        </td>
      </tr>
    `;
    if (spanCount) spanCount.textContent = '0 clientes';
    renderPaginacaoClientes();
    return;
  }

  tbody.innerHTML = clientes
    .map(
      (c) => `
        <tr>
          <td><span class="badge-codigo">${escapeHtml(c.codigo || '-')}</span></td>
          <td>${renderBadgeTipo(c.tipo_pessoa)}</td>
          <td>${formatNome(c)}</td>
          <td>${escapeHtml(formatDocumento(c))}</td>
          <td>${escapeHtml(formatCidadeUf(c))}</td>
          <td>${escapeHtml(formatContato(c))}</td>
          <td>${renderBadgeSituacao(c.situacao)}</td>
          <td style="text-align:right;">
            <div style="display:flex; gap:8px; justify-content:flex-end;">
              <button class="btn-icon" data-action="editar" data-id="${c.id}" title="Editar">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-action="excluir" data-id="${c.id}" title="Excluir">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');

  if (spanCount) {
    const page = state.clientesPage || {};
    const total = Number(page.total || clientes.length || 0);
    const ini = total ? Number(page.offset || 0) + 1 : 0;
    const fim = Math.min(Number(page.offset || 0) + clientes.length, total);
    spanCount.textContent = total === clientes.length
      ? (clientes.length === 1 ? '1 cliente' : `${clientes.length} clientes`)
      : `${ini}-${fim} de ${total} clientes`;
  }

  renderPaginacaoClientes();
}

export function renderPaginacaoClientes() {
  const wrap = document.getElementById('paginacao-clientes');
  if (!wrap) return;

  const page = state.clientesPage || {};
  const offset = Number(page.offset || 0);
  const limit = Number(page.limit || 50);
  const total = Number(page.total || 0);
  const atual = total ? Math.floor(offset / limit) + 1 : 1;
  const paginas = Math.max(1, Math.ceil(total / limit));

  wrap.innerHTML = `
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
    <span class="pagination-info">Página ${atual} de ${paginas}</span>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="next" ${!page.hasMore ? 'disabled' : ''}>Próxima</button>
  `;
}
