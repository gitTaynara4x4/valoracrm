import { state } from './state.js';
import { obterCampoCliente, salvarCampoCliente } from './api.js';
import { $, slugify, toast, openModal, closeModal } from './utils.js';

let _afterSave = async () => {};

function syncCampoTipo() {
  const tipo = $('campo-custom-tipo')?.value || 'texto';
  const wrap = $('wrap-custom-opcoes');
  if (wrap) wrap.hidden = tipo !== 'select';
}

export function bindFieldModal({ afterSave } = {}) {
  _afterSave = typeof afterSave === 'function' ? afterSave : async () => {};

  $('campo-custom-tipo')?.addEventListener('change', syncCampoTipo);
  $('btn-fechar-modal-campo')?.addEventListener('click', closeFieldModal);
  $('btn-cancelar-campo')?.addEventListener('click', closeFieldModal);
  $('btn-salvar-campo')?.addEventListener('click', saveCampo);

  $('modal-campo-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('modal-campo-backdrop')) {
      closeFieldModal();
    }
  });
}

export function openFieldModalNew() {
  state.campoEditandoId = null;
  $('modal-campo-titulo').textContent = 'Novo campo';

  $('campo-custom-nome').value = '';
  $('campo-custom-tipo').value = 'texto';
  $('campo-custom-ordem').value = '0';
  $('campo-custom-opcoes').value = '';
  $('campo-custom-obrigatorio').checked = false;
  $('campo-custom-ativo').checked = true;

  syncCampoTipo();
  openModal('modal-campo-backdrop');
}

export async function openFieldModalEdit(id) {
  try {
    const campo = await obterCampoCliente(id);
    state.campoEditandoId = campo.id;

    $('modal-campo-titulo').textContent = 'Editar campo';
    $('campo-custom-nome').value = campo.nome || '';
    $('campo-custom-tipo').value = campo.tipo || 'texto';
    $('campo-custom-ordem').value = String(campo.ordem ?? 0);
    $('campo-custom-obrigatorio').checked = !!campo.obrigatorio;
    $('campo-custom-ativo').checked = campo.ativo !== false;

    let opcoes = [];
    try {
      opcoes = JSON.parse(campo.opcoes_json || '[]');
    } catch {
      opcoes = [];
    }

    $('campo-custom-opcoes').value = Array.isArray(opcoes) ? opcoes.join('\n') : '';

    syncCampoTipo();
    openModal('modal-campo-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar campo.', 'error');
  }
}

export function closeFieldModal() {
  closeModal('modal-campo-backdrop');
}

export async function saveCampo() {
  const nome = String($('campo-custom-nome')?.value || '').trim();
  const tipo = String($('campo-custom-tipo')?.value || 'texto').trim();
  const ordem = Number($('campo-custom-ordem')?.value || 0);
  const obrigatorio = !!$('campo-custom-obrigatorio')?.checked;
  const ativo = !!$('campo-custom-ativo')?.checked;

  if (!nome) {
    toast('Preencha o nome do campo.', 'error');
    return;
  }

  const payload = {
    nome,
    slug: slugify(nome),
    tipo,
    obrigatorio,
    ativo,
    ordem,
  };

  if (tipo === 'select') {
    const opcoes = String($('campo-custom-opcoes')?.value || '')
      .split('\n')
      .map((v) => v.trim())
      .filter(Boolean);

    if (!opcoes.length) {
      toast('Preencha pelo menos uma opção para o campo de lista.', 'error');
      return;
    }

    payload.opcoes_json = JSON.stringify(opcoes);
  }

  const btn = $('btn-salvar-campo');
  const original = btn?.innerHTML || 'Salvar Campo';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await salvarCampoCliente(payload, state.campoEditandoId);
    await _afterSave();
    closeFieldModal();
    toast('Campo salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar campo.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}