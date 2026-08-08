import { state } from './state.js';
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

function renderActionIcon(action) {
  switch (action) {
    case 'arquivos-tecnicos':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" class="cliente-action-svg cliente-action-svg-list">
          <rect x="3.5" y="4.25" width="4.25" height="4.25" rx="1"></rect>
          <path d="M11.25 6.38H20.5"></path>
          <rect x="3.5" y="9.88" width="4.25" height="4.25" rx="1"></rect>
          <path d="M11.25 12H20.5"></path>
          <rect x="3.5" y="15.5" width="4.25" height="4.25" rx="1"></rect>
          <path d="M11.25 17.63H20.5"></path>
        </svg>`;
    case 'zapschat':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" class="cliente-action-svg cliente-action-svg-whatsapp">
          <path d="M20.2 11.62a8.18 8.18 0 0 1-12.12 7.17L4 20l1.23-3.62a8.16 8.16 0 1 1 14.97-4.76Z"></path>
          <path d="M8.72 8.31c.18-.4.37-.41.55-.42h.47c.16 0 .43.06.65.32.23.25.88.86.88 2.1 0 1.23-.9 2.42-1.03 2.59-.13.17-1.77 2.84-4.4 3.86" transform="scale(-1 1) translate(-24 0)"></path>
          <path d="M9.15 8.5c-.17-.38-.35-.38-.52-.39h-.45c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.39 1.01 2.56.13.17 1.75 2.8 4.33 3.81 2.13.83 2.56.67 3.03.63.47-.05 1.51-.62 1.72-1.21.21-.59.21-1.1.15-1.21-.06-.11-.22-.17-.47-.3-.25-.13-1.47-.72-1.7-.8-.22-.08-.38-.13-.54.13-.16.25-.61.8-.75.96-.14.17-.28.19-.52.06-.25-.13-1.03-.38-1.97-1.2-.73-.65-1.23-1.46-1.37-1.71-.14-.25-.02-.39.11-.52.12-.12.25-.3.38-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.07-.13-.58-1.41-.79-1.94Z"></path>
        </svg>`;
    case 'editar':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" class="cliente-action-svg cliente-action-svg-pencil">
          <path d="M4.1 16.85 3.3 20.7l3.85-.8L18.3 8.75l-3.05-3.05L4.1 16.85Z"></path>
          <path d="m14.35 6.6 2.3-2.3a1.35 1.35 0 0 1 1.91 0l1.14 1.14a1.35 1.35 0 0 1 0 1.91l-2.3 2.3"></path>
          <path d="M5.1 16.2 7.8 18.9"></path>
        </svg>`;
    case 'excluir':
      return `
        <svg viewBox="0 0 24 24" aria-hidden="true" class="cliente-action-svg cliente-action-svg-trash">
          <path d="M4.8 7.25h14.4"></path>
          <path d="M9.15 7.25V5.5c0-.55.45-1 1-1h3.7c.55 0 1 .45 1 1v1.75"></path>
          <path d="m7.1 7.25.72 11.2c.05.83.74 1.48 1.58 1.48h5.2c.84 0 1.53-.65 1.58-1.48l.72-11.2"></path>
          <path d="M10 10.25v6.5"></path>
          <path d="M14 10.25v6.5"></path>
        </svg>`;
    default:
      return '';
  }
}

function renderAcoes(c) {
  return `
    <td class="cliente-acoes-cell">
      <div class="cliente-acoes-grid" role="group" aria-label="Ações do cliente">
        <button class="cliente-action-btn cliente-action-btn-list" data-action="arquivos-tecnicos" data-id="${escapeHtml(c.id)}" title="Arquivos técnicos" aria-label="Arquivos técnicos">
          ${renderActionIcon('arquivos-tecnicos')}
        </button>
        <button class="cliente-action-btn cliente-action-btn-whatsapp" data-action="zapschat" data-id="${escapeHtml(c.id)}" title="Abrir no ZapChats" aria-label="Abrir no ZapChats">
          ${renderActionIcon('zapschat')}
        </button>
        <button class="cliente-action-btn" data-action="editar" data-id="${escapeHtml(c.id)}" title="Editar" aria-label="Editar">
          ${renderActionIcon('editar')}
        </button>
        <button class="cliente-action-btn" data-action="excluir" data-id="${escapeHtml(c.id)}" title="Excluir" aria-label="Excluir">
          ${renderActionIcon('excluir')}
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
        <tr>
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
  const wraps = document.querySelectorAll('[data-pagination="clientes"]');
  if (!wraps.length) return;

  const page = state.clientesPage || {};
  const offset = Number(page.offset || 0);
  const limit = Number(page.limit || 50);
  const total = Number(page.total || 0);
  const atual = total ? Math.floor(offset / limit) + 1 : 1;
  const paginas = Math.max(1, Math.ceil(total / limit));

  const lastOffset = Math.max(0, (paginas - 1) * limit);
  const html = `
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="first" ${offset <= 0 ? 'disabled' : ''}>Primeira</button>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
    <span class="pagination-info">Página ${atual} de ${paginas}</span>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="next" ${!page.hasMore ? 'disabled' : ''}>Próxima</button>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="last" data-last-offset="${lastOffset}" ${offset >= lastOffset ? 'disabled' : ''}>Última</button>
  `;

  wraps.forEach((wrap) => {
    wrap.innerHTML = html;
  });
}
