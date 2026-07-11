import { state } from './state.js?v=20260710-integridade-clientes-v1';
import { carregarClientes, carregarCamposClientes, excluirClienteNoServidor } from './api.js?v=20260710-integridade-clientes-v1';
import { $, toast } from './utils.js';
import { renderTabelaClientes } from './table.js?v=20260710-localizar-ordenavel-v3';
import { filtrarClientes, initFilters, limparFiltrosClientes } from './filters.js?v=20260710-integridade-clientes-v1';
import { bindConfirmDialog, confirmDialog } from './confirm.js';
import { bindClientModal, openClientModalNew, openClientModalEdit, openClientModalView, abrirClienteNoZapsChat } from './modal-cliente.js?v=20260710-integridade-clientes-v1';
import { bindImportExport, exportarClientesJSON } from './import-export.js?v=20260710-integridade-clientes-v1';

function renderAll() {
  renderTabelaClientes(filtrarClientes(state.clientes));
}

function setTabelaLoading(message = 'Carregando clientes...') {
  const tbody = $('tbody-clientes');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="empty-state" style="border:none; text-align:center;">
        ${message}
      </td>
    </tr>
  `;
}

function scrollToHighlightedClient() {
  requestAnimationFrame(() => {
    const row = document.querySelector('tr.cliente-row-saved');
    if (!row) return;
    try {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}
  });
}

async function reloadClientes({ offset = 0, silent = false, highlightId = null, focusId = null } = {}) {
  if (!silent) setTabelaLoading('Buscando clientes no banco...');

  const loaded = await carregarClientes({ offset, focusId });
  if (loaded === null) return false;

  state.lastSavedClienteId = highlightId ? Number(highlightId) : null;
  renderAll();

  if (state.lastSavedClienteId) scrollToHighlightedClient();
  return true;
}

async function reloadTudo() {
  const [, clientes] = await Promise.all([
    carregarCamposClientes(),
    carregarClientes({ offset: 0 }),
  ]);

  if (clientes !== null) {
    state.lastSavedClienteId = null;
    renderAll();
  }
}

async function mostrarClienteQueAcabouDeSerSalvo(cliente) {
  limparFiltrosClientes();

  const busca = $('filtro-busca');
  if (busca) {
    busca.value = String(cliente?.codigo || cliente?.cpf_cnpj || cliente?.nome || '').trim();
  }

  await reloadClientes({
    offset: 0,
    highlightId: cliente?.id || null,
    focusId: cliente?.id || null,
  });
}

async function handleExcluirCliente(id) {
  const ok = await confirmDialog({
    title: 'Excluir cliente',
    message: 'Deseja realmente excluir este cliente?',
    confirmText: 'Excluir',
    cancelText: 'Cancelar',
  });

  if (!ok) return;

  try {
    await excluirClienteNoServidor(id);
    await reloadClientes({ offset: state.clientesPage?.offset || 0 });
    toast('Cliente excluído com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir cliente.', 'error');
  }
}

function bindTabelaActions() {
  $('tbody-clientes')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.dataset.action === 'zapschat') {
      await abrirClienteNoZapsChat(id, { button: btn });
      return;
    }

    if (btn.dataset.action === 'visualizar') {
      await openClientModalView(id);
      return;
    }

    if (btn.dataset.action === 'editar') {
      await openClientModalEdit(id);
      return;
    }

    if (btn.dataset.action === 'excluir') {
      await handleExcluirCliente(id);
    }
  });
}

function bindPagination() {
  $('paginacao-clientes')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-page-action]');
    if (!btn || btn.disabled) return;

    const page = state.clientesPage || { offset: 0, limit: 50 };
    const limit = Number(page.limit || 50);
    let offset = Number(page.offset || 0);

    if (btn.dataset.pageAction === 'prev') offset = Math.max(0, offset - limit);
    if (btn.dataset.pageAction === 'next') offset += limit;

    try {
      await reloadClientes({ offset });
    } catch (err) {
      toast(err.message || 'Erro ao carregar página.', 'error');
    }
  });
}

function bindTopActions() {
  $('btn-novo-cliente')?.addEventListener('click', openClientModalNew);

  $('btn-filtrar-clientes')?.addEventListener('click', async () => {
    try {
      await reloadClientes({ offset: 0 });
    } catch (err) {
      toast(err.message || 'Erro ao filtrar clientes.', 'error');
    }
  });

  $('btn-limpar-filtros')?.addEventListener('click', async () => {
    limparFiltrosClientes();
    try {
      await reloadClientes({ offset: 0 });
    } catch (err) {
      toast(err.message || 'Erro ao limpar filtros.', 'error');
    }
  });

  $('btn-exportar-clientes-json')?.addEventListener('click', exportarClientesJSON);
}

function bindFormularioActions() {
  $('btn-gerenciar-formulario-cliente')?.addEventListener('click', () => {
    window.location.href = '/frontend/formularios.html?modulo=clientes';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindConfirmDialog();

  bindClientModal({
    afterSave: mostrarClienteQueAcabouDeSerSalvo,
  });

  bindImportExport({
    afterImport: async () => {
      limparFiltrosClientes();
      await reloadClientes({ offset: 0 });
    },
  });

  bindTabelaActions();
  bindPagination();
  bindTopActions();
  bindFormularioActions();

  try {
    await window.ValoraLocalizarPersonalizado?.setup?.({
      modulo: 'clientes',
      filtersContainerId: 'localizar-personalizado-clientes',
      force: true,
    });

    window.ValoraLocalizarPersonalizado?.bindFilters?.(
      'localizar-personalizado-clientes',
      async () => {
        try {
          await reloadClientes({ offset: 0, silent: true });
        } catch (err) {
          toast(err.message || 'Erro ao filtrar clientes.', 'error');
        }
      }
    );
  } catch (err) {
    console.warn('[Clientes] localizar personalizado indisponível:', err);
  }

  initFilters(async () => {
    try {
      await reloadClientes({ offset: 0, silent: true });
    } catch (err) {
      toast(err.message || 'Erro ao filtrar clientes.', 'error');
    }
  });

  try {
    await reloadTudo();
  } catch (err) {
    toast(err.message || 'Erro ao carregar dados do servidor.', 'error');
  }
});
