import { state } from './state.js';
import {
  carregarFornecedores,
  carregarCamposFornecedores,
  excluirFornecedorNoServidor,
  excluirCampoFornecedor,
} from './api.js';
import { $, toast } from './utils.js';
import { renderTabelaFornecedores, renderListaCamposFornecedores } from './table.js';
import { filtrarFornecedores, initFilters, limparFiltrosFornecedores } from './filters.js';
import { bindConfirmDialog, confirmDialog } from './confirm.js';
import { bindFornecedorModal, openFornecedorModalNew, openFornecedorModalEdit } from './modal-fornecedor.js';
import { bindFieldModal, openFieldModalNew, openFieldModalEdit } from './modal-campos.js';
import { bindImportExport, exportarFornecedoresJSON } from './import-export.js';

function renderAll() {
  renderTabelaFornecedores(filtrarFornecedores(state.fornecedores));
  renderListaCamposFornecedores(state.camposFornecedores);
}

function setTabelaLoading(message = 'Carregando fornecedores...') {
  const tbody = $('tbody-fornecedores');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="empty-state" style="border:none; text-align:center;">
        ${message}
      </td>
    </tr>
  `;
}

async function reloadFornecedores({ offset = 0, silent = false } = {}) {
  if (!silent) setTabelaLoading('Buscando fornecedores no banco...');
  await carregarFornecedores({ offset });
  renderAll();
}

async function reloadCampos() {
  await carregarCamposFornecedores();
  renderAll();
}

async function reloadTudo() {
  await Promise.all([carregarCamposFornecedores(), carregarFornecedores({ offset: 0 })]);
  renderAll();
}

async function handleExcluirFornecedor(id) {
  const ok = await confirmDialog({
    title: 'Excluir fornecedor',
    message: 'Deseja realmente excluir este fornecedor?',
    confirmText: 'Excluir',
    cancelText: 'Cancelar',
  });

  if (!ok) return;

  try {
    await excluirFornecedorNoServidor(id);
    await reloadFornecedores({ offset: state.fornecedoresPage?.offset || 0 });
    toast('Fornecedor excluído com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir fornecedor.', 'error');
  }
}

async function handleExcluirCampo(id) {
  const ok = await confirmDialog({
    title: 'Excluir campo',
    message: 'Deseja realmente excluir este campo personalizado?',
    confirmText: 'Excluir',
    cancelText: 'Cancelar',
  });

  if (!ok) return;

  try {
    await excluirCampoFornecedor(id);
    await reloadCampos();
    toast('Campo excluído com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir campo.', 'error');
  }
}

function bindTabelaActions() {
  $('tbody-fornecedores')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.dataset.action === 'editar') {
      await openFornecedorModalEdit(id);
      return;
    }

    if (btn.dataset.action === 'excluir') {
      await handleExcluirFornecedor(id);
    }
  });
}

function bindPagination() {
  $('paginacao-fornecedores')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-page-action]');
    if (!btn || btn.disabled) return;

    const page = state.fornecedoresPage || { offset: 0, limit: 50 };
    const limit = Number(page.limit || 50);
    let offset = Number(page.offset || 0);

    if (btn.dataset.pageAction === 'prev') offset = Math.max(0, offset - limit);
    if (btn.dataset.pageAction === 'next') offset = offset + limit;

    try {
      await reloadFornecedores({ offset });
    } catch (err) {
      toast(err.message || 'Erro ao carregar página.', 'error');
    }
  });
}

function bindCampoActions() {
  $('lista-campos-fornecedores')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-campo-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.dataset.campoAction === 'editar') {
      await openFieldModalEdit(id);
      return;
    }

    if (btn.dataset.campoAction === 'excluir') {
      await handleExcluirCampo(id);
    }
  });
}

function bindTopActions() {
  $('btn-novo-fornecedor')?.addEventListener('click', openFornecedorModalNew);
  $('btn-novo-campo')?.addEventListener('click', openFieldModalNew);
  $('btn-novo-campo-inline')?.addEventListener('click', openFieldModalNew);

  $('btn-filtrar-fornecedores')?.addEventListener('click', async () => {
    try {
      await reloadFornecedores({ offset: 0 });
    } catch (err) {
      toast(err.message || 'Erro ao filtrar fornecedores.', 'error');
    }
  });

  $('btn-limpar-filtros-fornecedores')?.addEventListener('click', async () => {
    limparFiltrosFornecedores();
    try {
      await reloadFornecedores({ offset: 0 });
    } catch (err) {
      toast(err.message || 'Erro ao limpar filtros.', 'error');
    }
  });

  $('btn-exportar-fornecedores-json')?.addEventListener('click', exportarFornecedoresJSON);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindConfirmDialog();

  bindFornecedorModal({
    afterSave: async () => {
      await reloadFornecedores({ offset: state.fornecedoresPage?.offset || 0 });
    },
  });

  bindFieldModal({
    afterSave: async () => {
      await reloadCampos();
    },
  });

  bindImportExport({
    afterImport: async () => {
      await reloadFornecedores({ offset: 0 });
    },
  });

  bindTabelaActions();
  bindPagination();
  bindCampoActions();
  bindTopActions();
  initFilters(async () => {
    try {
      await reloadFornecedores({ offset: 0, silent: true });
    } catch (err) {
      toast(err.message || 'Erro ao filtrar fornecedores.', 'error');
    }
  });

  try {
    await reloadTudo();
  } catch (err) {
    toast(err.message || 'Erro ao carregar dados do servidor.', 'error');
  }
});
