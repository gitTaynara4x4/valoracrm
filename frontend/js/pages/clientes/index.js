import { state } from './state.js';
import { carregarClientes, carregarCamposClientes, excluirClienteNoServidor } from './api.js';
import { $, toast } from './utils.js';
import { renderTabelaClientes } from './table.js';
import { filtrarClientes, initFilters, limparFiltrosClientes } from './filters.js';
import { bindConfirmDialog, confirmDialog } from './confirm.js';
import { bindClientModal, openClientModalNew, openClientModalEdit } from './modal-cliente.js';
import { bindImportExport, exportarClientesJSON } from './import-export.js';

function renderAll() {
  renderTabelaClientes(filtrarClientes(state.clientes));
}

async function reloadClientes() {
  await carregarClientes();
  renderAll();
}

async function reloadTudo() {
  await Promise.all([carregarCamposClientes(), carregarClientes()]);
  renderAll();
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
    await reloadClientes();
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

    if (btn.dataset.action === 'editar') {
      await openClientModalEdit(id);
      return;
    }

    if (btn.dataset.action === 'excluir') {
      await handleExcluirCliente(id);
    }
  });
}

function bindTopActions() {
  $('btn-novo-cliente')?.addEventListener('click', openClientModalNew);

  $('btn-filtrar-clientes')?.addEventListener('click', renderAll);

  $('btn-limpar-filtros')?.addEventListener('click', () => {
    limparFiltrosClientes();
    renderAll();
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
    afterSave: async () => {
      await reloadClientes();
    },
  });

  bindImportExport({
    afterImport: async () => {
      await reloadClientes();
    },
  });

  bindTabelaActions();
  bindTopActions();
  bindFormularioActions();
  initFilters(renderAll);

  try {
    await reloadTudo();
  } catch (err) {
    toast(err.message || 'Erro ao carregar dados do servidor.', 'error');
  }
});