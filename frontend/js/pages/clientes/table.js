import { state } from './state.js?v=20260710-integridade-clientes-v1';
import { escapeHtml } from './utils.js';

const DEFAULT_NATIVE_COLUMNS = [
  { key: 'codigo', label: 'Código' },
  { key: 'tipo', label: 'Tipo' },
  { key: 'nome', label: 'Nome / Razão Social' },
  { key: 'documento', label: 'Documento' },
  { key: 'cidade', label: 'Cidade / UF' },
  { key: 'contato', label: 'Contato' },
  { key: 'situacao', label: 'Situação' },
  { key: 'acoes', label: 'Ações', fixed: true },
];

function getOrderedColumns() {
  const columns = window.ValoraLocalizarPersonalizado?.getOrderedTableColumns?.('clientes');
  if (Array.isArray(columns) && columns.length) return columns;

  return DEFAULT_NATIVE_COLUMNS.map((column, index) => ({
    ...column,
    kind: 'native',
    origin: 'nativo',
    defaultOrder: index,
  }));
}

function renderHeaders(columns) {
  const row = document.querySelector('.valora-table thead tr');
  if (!row) return;

  row.innerHTML = columns
    .map((column) => `
      <th class="${column.key === 'acoes' ? 'text-right' : ''}">
        ${escapeHtml(column.label || column.key)}
      </th>
    `)
    .join('');
}

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
  const id = escapeHtml(cliente?.id || '');
  const nomeHtml = !fantasia
    ? `<strong>${escapeHtml(nome)}</strong>`
    : `
      <span style="display:flex; flex-direction:column; gap:2px;">
        <strong>${escapeHtml(nome)}</strong>
        <span class="subtle">${escapeHtml(fantasia)}</span>
      </span>
    `;

  return `
    <button
      type="button"
      class="table-name-link"
      data-action="visualizar"
      data-id="${id}"
      title="Visualizar cliente"
    >
      ${nomeHtml}
    </button>
  `;
}

function renderAcoes(c) {
  return `
    <td style="text-align:right;">
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="btn-icon" data-action="zapschat" data-id="${escapeHtml(c.id)}" title="Abrir no ZapChats">
          <i class="fa-brands fa-whatsapp"></i>
        </button>
        <button class="btn-icon" data-action="editar" data-id="${escapeHtml(c.id)}" title="Editar">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon danger" data-action="excluir" data-id="${escapeHtml(c.id)}" title="Excluir">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </td>
  `;
}

function renderNativeCell(cliente, key) {
  switch (key) {
    case 'codigo':
      return `<td><span class="badge-codigo">${escapeHtml(cliente.codigo || '-')}</span></td>`;
    case 'tipo':
      return `<td>${renderBadgeTipo(cliente.tipo_pessoa)}</td>`;
    case 'nome':
      return `<td>${formatNome(cliente)}</td>`;
    case 'documento':
      return `<td>${escapeHtml(formatDocumento(cliente))}</td>`;
    case 'cidade':
      return `<td>${escapeHtml(formatCidadeUf(cliente))}</td>`;
    case 'contato':
      return `<td>${escapeHtml(formatContato(cliente))}</td>`;
    case 'situacao':
      return `<td>${renderBadgeSituacao(cliente.situacao)}</td>`;
    case 'acoes':
      return renderAcoes(cliente);
    default:
      return '';
  }
}

function renderColumnCell(cliente, column) {
  if (column?.kind === 'dynamic') {
    const value = window.ValoraLocalizarPersonalizado?.formatValue?.(cliente, column) || '-';
    return `<td>${escapeHtml(value)}</td>`;
  }

  return renderNativeCell(cliente, column?.key);
}

export function renderTabelaClientes(clientes) {
  const tbody = document.getElementById('tbody-clientes');
  const spanCount = document.getElementById('contagem-clientes');

  if (!tbody) return;

  const columns = getOrderedColumns();

  renderHeaders(columns);
  const colspan = columns.length;

  if (!Array.isArray(clientes) || !clientes.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${colspan}" class="empty-state" style="border:none; text-align:center;">
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
        <tr class="${Number(c?.id) === Number(state.lastSavedClienteId) ? 'cliente-row-saved' : ''}" data-cliente-row-id="${escapeHtml(c?.id || '')}">
          ${columns.map((column) => renderColumnCell(c, column)).join('')}
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
