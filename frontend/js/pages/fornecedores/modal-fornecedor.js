import { state } from './state.js';
import { obterFornecedorNoServidor, obterProximoCodigoFornecedor, salvarFornecedorNoServidor } from './api.js';
import { $, $$, toast, openModal, closeModal } from './utils.js';
import {
  renderCustomFieldsInputs,
  normalizeCustomFieldsPayload,
  validateRequiredCustomFields,
} from './custom-fields.js';

let _afterSave = async () => {};
let _bound = false;

function defaultFornecedor() {
  return {
    codigo: '',
    tipo_fornecedor: '',
    situacao: 'ativo',
    nome: '',
    nome_fantasia: '',
    cpf_cnpj: '',
    inscricao_estadual: '',
    inscricao_municipal: '',
    contato: '',
    telefone: '',
    whatsapp: '',
    fax: '',
    email: '',
    site: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    pais: 'Brasil',
    codigo_ibge_cidade: '',
    codigo_ibge_uf: '',
    limite_compras: '',
    classificacao: '',
    plano_contas: '',
    observacoes: '',
    custom_fields: {},
  };
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '').trim();
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? '';
}

function getValue(id) {
  return $(id)?.value ?? '';
}

function switchTab(targetId) {
  $$('.fornecedor-tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === targetId));
  $$('.fornecedor-tab').forEach((tab) => tab.classList.toggle('active', tab.id === targetId));
}

function travarCampoCodigoFornecedor() {
  const el = $('campo-codigo-fornecedor');
  if (!el) return;

  el.readOnly = true;
  el.setAttribute('readonly', 'readonly');
  el.setAttribute('aria-readonly', 'true');
  el.title = 'Código gerado automaticamente pelo sistema. Não pode ser alterado.';
}

function limparCamposObrigatoriosPendentes() {
  document
    .querySelectorAll('.campo-obrigatorio-pendente, .is-required-missing')
    .forEach((el) => {
      el.classList.remove('campo-obrigatorio-pendente', 'is-required-missing');
    });
}

function isCampoVazio(el) {
  if (!el) return false;

  if (el.type === 'checkbox') {
    return !el.checked;
  }

  return String(el.value ?? '').trim() === '';
}

function abrirAbaDoCampo(el) {
  if (!el) return;

  const tab = el.closest('.fornecedor-tab');
  if (tab?.id) {
    switchTab(tab.id);
  }
}

function getModalScrollContainer(el) {
  return (
    el?.closest('.fornecedor-modal-scroll') ||
    document.querySelector('#modal-fornecedor-backdrop .fornecedor-modal-scroll') ||
    document.querySelector('#modal-fornecedor-backdrop .fornecedor-modal-main') ||
    document.querySelector('#modal-fornecedor-backdrop .fornecedor-modal-content')
  );
}

function scrollCampoDentroDoModal(el) {
  if (!el) return;

  const scrollEl = getModalScrollContainer(el);
  if (!scrollEl) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const elRect = el.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();
  const targetTop = scrollEl.scrollTop + (elRect.top - scrollRect.top) - 120;

  scrollEl.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  });
}

function focarCampoObrigatorio(el) {
  if (!el) return;

  abrirAbaDoCampo(el);

  setTimeout(() => {
    const grupo = el.closest('.form-group, .custom-field-item, .custom-checkbox');

    el.classList.add('campo-obrigatorio-pendente', 'is-required-missing');

    if (grupo) {
      grupo.classList.add('campo-obrigatorio-pendente', 'is-required-missing');
    }

    scrollCampoDentroDoModal(el);

    setTimeout(() => {
      try {
        el.focus({ preventScroll: true });
      } catch (_) {
        el.focus();
      }
    }, 220);
  }, 120);
}

function encontrarCampoCustomPorSlug(slug) {
  const clean = String(slug || '').trim();
  if (!clean) return null;

  const safeSlug =
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(clean)
      : clean.replace(/"/g, '\\"');

  return document.querySelector(`[data-custom-field="${safeSlug}"]`);
}

function encontrarPrimeiroCampoObrigatorioVazio() {
  const campos = Array.isArray(state.camposFornecedores) ? state.camposFornecedores : [];

  for (const campo of campos) {
    if (campo?.ativo === false || !campo?.obrigatorio) continue;

    const el = encontrarCampoCustomPorSlug(campo.slug);
    if (el && isCampoVazio(el)) return el;
  }

  return document.querySelector('#custom-fields-container [data-required="true"]:invalid');
}

async function buscarCodigoPrevistoFornecedor() {
  try {
    const data = await obterProximoCodigoFornecedor();
    return onlyDigits(data?.codigo || '');
  } catch (err) {
    console.warn('[Valora][Fornecedores] Não foi possível prever o próximo código:', err);
    return '';
  }
}

function fillFornecedorForm(fornecedor = {}) {
  const data = { ...defaultFornecedor(), ...(fornecedor || {}) };

  setValue('campo-codigo-fornecedor', onlyDigits(data.codigo));
  travarCampoCodigoFornecedor();

  setValue('campo-tipo-fornecedor', data.tipo_fornecedor);
  setValue('campo-situacao-fornecedor', data.situacao);
  setValue('campo-nome-fornecedor', data.nome);
  setValue('campo-nome-fantasia-fornecedor', data.nome_fantasia);
  setValue('campo-cpf-cnpj-fornecedor', data.cpf_cnpj);
  setValue('campo-ie-fornecedor', data.inscricao_estadual);
  setValue('campo-im-fornecedor', data.inscricao_municipal);
  setValue('campo-contato-fornecedor', data.contato);
  setValue('campo-telefone-fornecedor', data.telefone);
  setValue('campo-whatsapp-fornecedor', data.whatsapp);
  setValue('campo-fax-fornecedor', data.fax);
  setValue('campo-email-fornecedor', data.email);
  setValue('campo-site-fornecedor', data.site);
  setValue('campo-cep-fornecedor', data.cep);
  setValue('campo-endereco-fornecedor', data.endereco);
  setValue('campo-numero-fornecedor', data.numero);
  setValue('campo-complemento-fornecedor', data.complemento);
  setValue('campo-bairro-fornecedor', data.bairro);
  setValue('campo-cidade-fornecedor', data.cidade);
  setValue('campo-estado-fornecedor', data.estado);
  setValue('campo-pais-fornecedor', data.pais || 'Brasil');
  setValue('campo-ibge-cidade-fornecedor', data.codigo_ibge_cidade);
  setValue('campo-ibge-uf-fornecedor', data.codigo_ibge_uf);
  setValue('campo-limite-compras-fornecedor', data.limite_compras);
  setValue('campo-classificacao-fornecedor', data.classificacao);
  setValue('campo-plano-contas-fornecedor', data.plano_contas);
  setValue('campo-observacoes-fornecedor', data.observacoes);

  renderCustomFieldsInputs(state.camposFornecedores, data.custom_fields || {});
  switchTab('tab-fornecedor-cadastro');
}

function buildPayload() {
  return {
    codigo: onlyDigits(getValue('campo-codigo-fornecedor') || ''),
    tipo_fornecedor: String(getValue('campo-tipo-fornecedor') || '').trim(),
    situacao: String(getValue('campo-situacao-fornecedor') || 'ativo').trim(),
    nome: String(getValue('campo-nome-fornecedor') || '').trim(),
    nome_fantasia: String(getValue('campo-nome-fantasia-fornecedor') || '').trim(),
    cpf_cnpj: String(getValue('campo-cpf-cnpj-fornecedor') || '').trim(),
    inscricao_estadual: String(getValue('campo-ie-fornecedor') || '').trim(),
    inscricao_municipal: String(getValue('campo-im-fornecedor') || '').trim(),
    contato: String(getValue('campo-contato-fornecedor') || '').trim(),
    telefone: String(getValue('campo-telefone-fornecedor') || '').trim(),
    whatsapp: String(getValue('campo-whatsapp-fornecedor') || '').trim(),
    fax: String(getValue('campo-fax-fornecedor') || '').trim(),
    email: String(getValue('campo-email-fornecedor') || '').trim(),
    site: String(getValue('campo-site-fornecedor') || '').trim(),
    cep: String(getValue('campo-cep-fornecedor') || '').trim(),
    endereco: String(getValue('campo-endereco-fornecedor') || '').trim(),
    numero: String(getValue('campo-numero-fornecedor') || '').trim(),
    complemento: String(getValue('campo-complemento-fornecedor') || '').trim(),
    bairro: String(getValue('campo-bairro-fornecedor') || '').trim(),
    cidade: String(getValue('campo-cidade-fornecedor') || '').trim(),
    estado: String(getValue('campo-estado-fornecedor') || '').trim(),
    pais: String(getValue('campo-pais-fornecedor') || '').trim(),
    codigo_ibge_cidade: String(getValue('campo-ibge-cidade-fornecedor') || '').trim(),
    codigo_ibge_uf: String(getValue('campo-ibge-uf-fornecedor') || '').trim(),
    limite_compras: String(getValue('campo-limite-compras-fornecedor') || '').trim(),
    classificacao: String(getValue('campo-classificacao-fornecedor') || '').trim(),
    plano_contas: String(getValue('campo-plano-contas-fornecedor') || '').trim(),
    observacoes: String(getValue('campo-observacoes-fornecedor') || '').trim(),
    custom_fields: normalizeCustomFieldsPayload(),
  };
}

export function bindFornecedorModal({ afterSave } = {}) {
  _afterSave = typeof afterSave === 'function' ? afterSave : async () => {};

  if (_bound) return;
  _bound = true;

  $$('.fornecedor-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('btn-fechar-modal-fornecedor')?.addEventListener('click', closeFornecedorModal);
  $('btn-cancelar-fornecedor')?.addEventListener('click', closeFornecedorModal);
  $('formFornecedor')?.addEventListener('submit', saveFornecedor);
  $('btn-salvar-fornecedor')?.addEventListener('click', (e) => {
    const form = $('formFornecedor');
    if (form?.requestSubmit) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  $('modal-fornecedor-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('modal-fornecedor-backdrop')) {
      closeFornecedorModal();
    }
  });

  travarCampoCodigoFornecedor();
}

export async function openFornecedorModalNew() {
  state.fornecedorEditandoId = null;
  $('modal-fornecedor-titulo').textContent = 'Novo fornecedor';
  $('formFornecedor')?.reset();

  fillFornecedorForm({ codigo: '' });
  openModal('modal-fornecedor-backdrop');

  const codigoPrevisto = await buscarCodigoPrevistoFornecedor();
  if (state.fornecedorEditandoId == null && codigoPrevisto) {
    setValue('campo-codigo-fornecedor', codigoPrevisto);
    travarCampoCodigoFornecedor();
  }
}

export async function openFornecedorModalEdit(id) {
  try {
    const fornecedor = await obterFornecedorNoServidor(id);
    state.fornecedorEditandoId = fornecedor.id;
    $('modal-fornecedor-titulo').textContent = 'Editar fornecedor';
    fillFornecedorForm(fornecedor);
    openModal('modal-fornecedor-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar fornecedor.', 'error');
  }
}

export function closeFornecedorModal() {
  closeModal('modal-fornecedor-backdrop');
}

export async function saveFornecedor(e) {
  if (e?.preventDefault) e.preventDefault();

  limparCamposObrigatoriosPendentes();

  const nome = String(getValue('campo-nome-fornecedor') || '').trim();
  if (!nome) {
    const campoNome = $('campo-nome-fornecedor');
    if (campoNome) focarCampoObrigatorio(campoNome);
    toast('Preencha o nome do fornecedor.', 'error');
    return;
  }

  const payload = buildPayload();
  const requiredCheck = validateRequiredCustomFields(state.camposFornecedores, payload.custom_fields);

  if (!requiredCheck.ok) {
    const campo = encontrarCampoCustomPorSlug(requiredCheck.slug) || encontrarPrimeiroCampoObrigatorioVazio();
    if (campo) focarCampoObrigatorio(campo);
    toast(requiredCheck.message, 'error');
    return;
  }

  // Código é do sistema, único e imutável.
  // O backend gera no POST e preserva no PUT.
  delete payload.codigo;

  const btn = $('btn-salvar-fornecedor');
  const original = btn?.innerHTML || 'Salvar fornecedor';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await salvarFornecedorNoServidor(payload, state.fornecedorEditandoId);
    await _afterSave();
    closeFornecedorModal();
    toast('Fornecedor salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar fornecedor.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}
