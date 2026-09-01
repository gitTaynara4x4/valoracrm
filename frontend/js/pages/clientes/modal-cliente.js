import { state } from './state.js';
import { obterClienteNoServidor, obterClienteNaPosicaoDaLista, prefetchClienteNoServidor, carregarFormularioClientes, salvarClienteNoServidor, apiJson } from './api.js?v=20260831-client-nav-perf-v36';
import { $, $$, escapeHtml, toast, openModal, closeModal } from './utils.js';
import { confirmDialog } from './confirm.js';
import {
  renderCustomFieldsInputs,
  normalizeCustomFieldsPayload,
  validateRequiredCustomFields,
} from './custom-fields.js?v=20260831-client-nav-perf-v36';

let _afterSave = async () => {};
let _bound = false;
let currentDetail = null;
let originalClienteTabsHtml = '';
let fichaClienteController = null;
let clienteModalSomenteLeitura = false;
let clienteModalDirty = false;
let clienteModalHydrating = false;
let clienteModalListPosition = null;
let clienteModalListPositionOverride = null;
let clienteModalListTotal = 0;
let fichaFieldDirtySequence = 0;

async function syncAgendaCliente(cliente = null, readonly = false) {
  try {
    const agenda = await window.ValoraAgendaReady;
    await agenda?.setEntityContext?.({
      containerId: 'agenda-cliente',
      entidadeTipo: 'cliente',
      entidadeId: Number(cliente?.id || 0) || null,
      entidadeNome: String(cliente?.nome || cliente?.nome_fantasia || 'Cliente'),
      readonly: !!readonly,
    });
  } catch (error) {
    console.warn('[Clientes] agenda indisponível:', error);
  }
}

const AGENDA_TIPOS_AGENDADOS_CLIENTE = new Set([
  'lembrete',
  'enviar_proposta',
  'abrir_ordem_servico',
  'transferir_departamento',
]);

function textoAgendaMascarado(value) {
  const text = String(value ?? '').trim();
  return text.length >= 3 && /^[*•●·\s]+$/.test(text);
}

function abrirAgendaClienteParaCorrecao() {
  const fixedButton = document.querySelector(
    '[data-agenda-fixed-open="tab-historico"][data-agenda-scope="#formCliente"]'
  );
  if (fixedButton) {
    fixedButton.click();
    return;
  }
  switchTab('tab-historico');
}

function prepararAgendaPendenteCliente() {
  const container = $('agenda-cliente');
  const form = container?.querySelector('[data-agenda-form]');
  if (!form || clienteModalSomenteLeitura) return null;

  const value = (name) => String(form.querySelector(`[name="${name}"]`)?.value || '').trim();
  const tipo = value('tipo') || 'registro';
  const assunto = value('assunto');
  const descricao = value('descricao');
  const localDate = value('agendado_para');
  const status = value('status') || 'em_aberto';
  const motivoStatus = value('motivo_status');
  const informacoesLivres = value('informacoes_livres');
  const departamentoDestino = value('departamento_destino');
  const scheduled = AGENDA_TIPOS_AGENDADOS_CLIENTE.has(tipo);

  // O tipo/status padrão não conta como rascunho. Só interceptamos o salvar
  // do cliente quando a pessoa realmente digitou ou alterou algo na Agenda.
  const hasDraft = Boolean(
    assunto ||
    descricao ||
    localDate ||
    motivoStatus ||
    informacoesLivres ||
    departamentoDestino ||
    tipo !== 'registro'
  );

  if (!hasDraft) return null;

  if (!assunto) {
    throw new Error('Preencha o assunto da Agenda antes de salvar o cliente.');
  }
  if (textoAgendaMascarado(assunto)) {
    throw new Error('Digite um assunto válido na Agenda em vez de apenas asteriscos.');
  }
  if (scheduled && !localDate) {
    throw new Error('Informe a data e o horário do agendamento antes de salvar o cliente.');
  }
  if (tipo === 'transferir_departamento' && !departamentoDestino) {
    throw new Error('Informe o departamento de destino na Agenda antes de salvar o cliente.');
  }

  let agendadoPara = null;
  if (localDate) {
    const parsed = new Date(localDate);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error('A data e o horário informados na Agenda são inválidos.');
    }
    agendadoPara = parsed.toISOString();
  }

  return {
    form,
    tipo,
    scheduled,
    payload: {
      entidade_tipo: 'cliente',
      entidade_id: Number(state.clienteEditandoId || currentDetail?.id || 0),
      tipo,
      assunto,
      descricao: descricao || null,
      agendado_para: scheduled ? agendadoPara : null,
      status: scheduled ? status : null,
      motivo_status: scheduled ? (motivoStatus || null) : null,
      informacoes_livres: scheduled ? (informacoesLivres || null) : null,
      departamento_destino: tipo === 'transferir_departamento' ? departamentoDestino : null,
    },
  };
}

async function salvarAgendaPendenteCliente(agendaDraft, clienteId = null) {
  if (!agendaDraft?.form || !agendaDraft?.payload) return false;

  const entidadeId = Number(clienteId || agendaDraft.payload.entidade_id || 0);
  if (!entidadeId) {
    throw new Error('Não foi possível identificar o cliente para gravar a Agenda.');
  }

  await apiJson('/api/agenda/itens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...agendaDraft.payload,
      entidade_id: entidadeId,
    }),
  });

  const form = agendaDraft.form;
  form.querySelectorAll('input, textarea').forEach((input) => {
    input.value = '';
  });

  const typeSelect = form.querySelector('[name="tipo"]');
  const statusSelect = form.querySelector('[name="status"]');
  const motiveSelect = form.querySelector('[name="motivo_status"]');
  if (typeSelect) typeSelect.value = 'registro';
  if (statusSelect) statusSelect.value = 'em_aberto';
  if (motiveSelect) motiveSelect.value = '';
  typeSelect?.dispatchEvent(new Event('change', { bubbles: true }));

  // A gravação principal já foi concluída. Falha ao atualizar a interface
  // não deve transformar uma gravação bem-sucedida em erro para o usuário.
  try {
    const agenda = await window.ValoraAgendaReady;
    await Promise.allSettled([
      agenda?.refreshEntity?.('agenda-cliente', { force: true }),
      agenda?.refreshNotifications?.({ showAlerts: false, force: true }),
    ]);
  } catch (_) {}

  return true;
}

function defaultCliente() {
  return {
    codigo: '',
    tipo_pessoa: 'PF',
    situacao: 'ativo',
    nome: '',
    nome_fantasia: '',
    cpf_cnpj: '',
    rg_ie: '',
    inscricao_municipal: '',
    suframa: '',
    data_nascimento: '',
    codigo_referencia: '',
    retencao_percentual: '',
    site: '',
    telefone: '',
    whatsapp: '',
    fax: '',
    contato: '',
    email: '',
    email_nfe: '',
    email_cobranca: '',
    email_fiscal: '',
    parceiro_comercial: '',
    percentual_comissao: '',
    percentual_desconto: '',
    modalidade_pagamento: '',
    regiao: '',
    segmento: '',
    classificacao: '',
    pais: 'Brasil',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    codigo_ibge_cidade: '',
    codigo_ibge_uf: '',
    observacoes: '',
    enderecos: [],
    referencias_comerciais: [],
    referencias_bancarias: [],
    socios: [],
    ocorrencias: [],
    anexos: [],
    historico: {},
    criado_em: '',
    atualizado_em: '',
    custom_fields: {},
  };
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function generateNextClientCode() {
  const proximoId =
    state.clientes.length > 0
      ? Math.max(...state.clientes.map((c) => Number(c.id) || 0)) + 1
      : 1;

  return String(proximoId).padStart(4, '0');
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? '';
}

function getValue(id) {
  return $(id)?.value ?? '';
}


function restoreReadonlyElement(el) {
  if (!el || el.dataset.readonlyTouched !== 'true') return;

  el.disabled = el.dataset.readonlyWasDisabled === 'true';
  el.readOnly = el.dataset.readonlyWasReadonly === 'true';
  el.removeAttribute('aria-readonly');
  el.classList.remove('is-readonly-field');

  delete el.dataset.readonlyTouched;
  delete el.dataset.readonlyWasDisabled;
  delete el.dataset.readonlyWasReadonly;
}

function applyReadonlyElement(el) {
  if (!el || el.dataset.readonlyTouched === 'true') return;

  el.dataset.readonlyTouched = 'true';
  el.dataset.readonlyWasDisabled = el.disabled ? 'true' : 'false';
  el.dataset.readonlyWasReadonly = el.readOnly ? 'true' : 'false';

  const tag = String(el.tagName || '').toLowerCase();
  const type = String(el.type || '').toLowerCase();

  if (tag === 'select' || type === 'checkbox' || type === 'radio' || type === 'file' || type === 'button') {
    el.disabled = true;
  } else {
    el.readOnly = true;
  }

  el.setAttribute('aria-readonly', 'true');
  el.classList.add('is-readonly-field');
}

function setHiddenByReadonly(id, enabled) {
  const el = $(id);
  if (!el) return;

  if (enabled) {
    if (el.dataset.readonlyTouchedHidden !== 'true') {
      el.dataset.readonlyTouchedHidden = 'true';
      el.dataset.readonlyWasHidden = el.hidden ? 'true' : 'false';
    }
    el.hidden = true;
    el.style.display = 'none';
    return;
  }

  if (el.dataset.readonlyTouchedHidden === 'true') {
    el.hidden = el.dataset.readonlyWasHidden === 'true';
    el.style.display = '';
    delete el.dataset.readonlyTouchedHidden;
    delete el.dataset.readonlyWasHidden;
  }
}

function setClienteModalReadonly(enabled) {
  clienteModalSomenteLeitura = !!enabled;

  const backdrop = $('modal-cliente-backdrop');
  const form = $('formCliente');
  const cancelBtn = $('btn-cancelar-cliente');
  const title = $('modal-cliente-titulo');

  backdrop?.classList.toggle('modal-readonly', clienteModalSomenteLeitura);
  form?.classList.toggle('modal-readonly-form', clienteModalSomenteLeitura);

  if (form) {
    form.querySelectorAll('input, select, textarea').forEach((el) => {
      if (clienteModalSomenteLeitura) applyReadonlyElement(el);
      else restoreReadonlyElement(el);
    });
  }

  [
    'btn-salvar-cliente',
    'btn-add-endereco',
    'btn-add-ref-comercial',
    'btn-add-ref-bancaria',
    'btn-add-socio',
    'btn-add-ocorrencia',
    'btn-escolher-anexo',
  ].forEach((id) => setHiddenByReadonly(id, clienteModalSomenteLeitura));

  document
    .querySelectorAll('#modal-cliente-backdrop [data-remove], #modal-cliente-backdrop [data-remove-anexo]')
    .forEach((btn) => {
      if (clienteModalSomenteLeitura) {
        if (btn.dataset.readonlyTouchedHidden !== 'true') {
          btn.dataset.readonlyTouchedHidden = 'true';
          btn.dataset.readonlyWasHidden = btn.hidden ? 'true' : 'false';
        }
        btn.hidden = true;
        btn.style.display = 'none';
      } else if (btn.dataset.readonlyTouchedHidden === 'true') {
        btn.hidden = btn.dataset.readonlyWasHidden === 'true';
        btn.style.display = '';
        delete btn.dataset.readonlyTouchedHidden;
        delete btn.dataset.readonlyWasHidden;
      }
    });

  if (cancelBtn) {
    if (clienteModalSomenteLeitura) {
      cancelBtn.dataset.normalText = cancelBtn.dataset.normalText || cancelBtn.textContent || 'Cancelar';
      cancelBtn.textContent = 'Fechar';
    } else if (cancelBtn.dataset.normalText) {
      cancelBtn.textContent = cancelBtn.dataset.normalText;
    }
  }

  if (title && !clienteModalSomenteLeitura) {
    title.removeAttribute('data-readonly-title');
  }

  syncZapsChatButton(currentDetail);
}

function formatarDataCadastroSistema(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;

  return raw;
}

function syncFichaPrincipalCadastro(dataCadastro, usarHoje = false) {
  const raw = dataCadastro || (usarHoje ? new Date().toISOString() : '');
  setValue('campo-data-cadastro-ficha-principal', formatarDataCadastroSistema(raw));
}

function switchTab(targetId) {
  const targetPanel = targetId ? document.getElementById(targetId) : null;
  const keepTab = targetPanel?.dataset.fichaKeep === 'true';
  if (state.usarFichaPrincipalClientes && !keepTab) {
    targetId = 'tab-campos-personalizados';
  }

  $$('.cliente-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === targetId);
  });

  $$('.cliente-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === targetId);
  });
}

function syncFichaPrincipalCode(codigo) {
  const value = onlyDigits(codigo);

  setValue('campo-codigo', value);
  setValue('campo-codigo-ficha-principal', value);

  ['campo-codigo', 'campo-codigo-ficha-principal'].forEach((id) => {
    const el = $(id);
    if (!el) return;

    el.readOnly = true;
    el.setAttribute('readonly', 'readonly');
    el.classList.add('codigo-sistema-readonly');
    el.title = 'Código único gerado pelo sistema. Não pode ser alterado.';
  });

  atualizarResumoSidebarCliente(currentDetail || { codigo: value });
}

async function obterProximoCodigoClienteServidor() {
  try {
    const data = await apiJson('/api/clientes/proximo-codigo');
    return onlyDigits(data?.codigo);
  } catch (err) {
    toast(err.message || 'Não foi possível buscar o próximo código do cliente.', 'error');
    return '';
  }
}

function getValorResumoCliente(...ids) {
  for (const id of ids) {
    const el = $(id);

    if (!el) continue;

    const value = String(el.value ?? '').trim();

    if (value) return value;
  }

  return '';
}

function atualizarResumoSidebarCliente(cliente = null) {
  const nomeEl = $('cliente-sidebar-nome');
  const codigoEl = $('cliente-sidebar-codigo');

  if (!nomeEl && !codigoEl) return;

  const nomeCampo =
    getValorResumoCliente('campo-nome', 'campo-nome-fantasia') ||
    cliente?.nome ||
    cliente?.nome_fantasia ||
    '';

  const codigoCampo =
    getValorResumoCliente('campo-codigo', 'campo-codigo-ficha-principal') ||
    cliente?.codigo ||
    '';

  const nomeFinal = String(nomeCampo || '').trim() || 'Novo cliente';
  const codigoFinal = onlyDigits(codigoCampo);

  if (nomeEl) {
    nomeEl.textContent = nomeFinal;
    nomeEl.title = nomeFinal;
  }

  if (codigoEl) {
    const texto = codigoFinal ? `Código ${codigoFinal}` : 'Cadastro em andamento';
    codigoEl.textContent = texto;
    codigoEl.title = texto;
  }
}

function agendarResumoSidebarCliente(cliente = null) {
  atualizarResumoSidebarCliente(cliente || currentDetail);

  requestAnimationFrame(() => {
    atualizarResumoSidebarCliente(cliente || currentDetail);
  });

  setTimeout(() => {
    atualizarResumoSidebarCliente(cliente || currentDetail);
  }, 80);

  setTimeout(() => {
    atualizarResumoSidebarCliente(cliente || currentDetail);
  }, 220);
}


function syncZapsChatButton(cliente = null) {
  const btn = $('btn-abrir-zapschat-cliente');
  if (!btn) return;

  const id = cliente?.id || state.clienteEditandoId || currentDetail?.id || null;
  const phone = onlyDigits(cliente?.whatsapp || cliente?.telefone || currentDetail?.whatsapp || currentDetail?.telefone || '');

  btn.hidden = !id;
  btn.disabled = !id || !phone;
  btn.title = !id
    ? 'Salve o cliente antes de abrir no ZapChats'
    : phone
      ? 'Abrir conversa deste cliente no ZapChats'
      : 'Este cliente não tem WhatsApp/telefone cadastrado';
}

export async function abrirClienteNoZapsChat(clienteId, options = {}) {
  const id = Number(clienteId || state.clienteEditandoId || currentDetail?.id || 0);
  if (!id) {
    toast('Salve o cliente antes de abrir no ZapChats.', 'error');
    return;
  }

  const btn = options.button || $('btn-abrir-zapschat-cliente');
  const original = btn?.innerHTML || '';

  // Abre a aba imediatamente para o navegador não bloquear o popup.
  const popup = window.open('about:blank', '_blank');

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Abrindo...';
    }

    const data = await apiJson(`/api/integracoes/zapschat/abrir-cliente/${id}`);

    if (!data?.url) {
      throw new Error('O backend não retornou o link do ZapChats.');
    }

    if (popup && !popup.closed) {
      try { popup.opener = null; } catch (_) {}
      popup.location.href = data.url;
    } else {
      window.location.href = data.url;
    }

    toast('Abrindo conversa no ZapChats.', 'success');
  } catch (err) {
    if (popup && !popup.closed) {
      try { popup.close(); } catch (_) {}
    }

    toast(err.message || 'Erro ao abrir ZapChats.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      if (original) btn.innerHTML = original;
    }
  }
}

const GOOGLE_MAPS_ADDRESS_PARTS = ['cep', 'endereco', 'numero', 'bairro', 'cidade', 'estado', 'pais'];

function isCustomLocationSection(card) {
  if (!card) return false;

  const title = normalizeFichaKey(
    card.dataset.customSectionTitle ||
    card.querySelector('.custom-section-head h4')?.textContent ||
    card.querySelector('h4')?.textContent ||
    ''
  );

  if (!title) return false;

  return (
    (title.includes('localizacao') && title.includes('imovel')) ||
    (title.includes('endereco') && title.includes('imovel'))
  );
}

function getCustomLocationSection() {
  const sections = Array.from(document.querySelectorAll('#custom-fields-container .custom-section-card'));
  return sections.find((section) =>
    Array.from(section.querySelectorAll('[data-custom-field-wrapper="true"]'))
      .some((wrapper) => isFlagEnabled(wrapper.dataset.googleMapsEnabled))
  ) || sections.find(isCustomLocationSection) || null;
}

function addressFieldMatches(part, rawKey) {
  const key = normalizeFichaKey(rawKey);
  if (!key) return false;

  if (part === 'cep') {
    return key === 'cep' || key.startsWith('cep_') || key.includes('codigo_postal');
  }

  if (part === 'endereco') {
    return /^(endereco|logradouro|rua|avenida)(_|$)/.test(key);
  }

  if (part === 'numero') {
    return key === 'numero' || key.startsWith('numero_');
  }

  if (part === 'bairro') {
    return key === 'bairro' || key.startsWith('bairro_');
  }

  if (part === 'cidade') {
    return key === 'cidade' || key === 'municipio' || key.startsWith('cidade_') || key.startsWith('municipio_');
  }

  if (part === 'estado') {
    return key === 'uf' || key === 'estado' || key.startsWith('uf_') || key.startsWith('estado_');
  }

  if (part === 'pais') {
    return key === 'pais' || key.startsWith('pais_');
  }

  return false;
}

function getAddressPartFromCustomLocation(part) {
  const section = getCustomLocationSection();
  const roots = [section, document.querySelector('#custom-fields-container')].filter(Boolean);
  const seen = new Set();
  const records = [];

  roots.forEach((root) => {
    Array.from(root.querySelectorAll('[data-custom-field]')).forEach((el, index) => {
      if (seen.has(el)) return;
      seen.add(el);
      const wrapper = el.closest('[data-custom-field-wrapper="true"]');
      const keys = [
        wrapper?.dataset.systemField,
        el.dataset.customField,
        el.dataset.customLabel,
        wrapper?.dataset.customLabel,
      ].filter(Boolean);
      if (!keys.some((key) => addressFieldMatches(part, key))) return;
      records.push({ el, index: records.length + index, keys });
    });
  });

  const selected = chooseRenderedField(records);
  if (!selected) return { found: false, value: '' };

  return { found: true, value: getRenderedFieldValue(selected.el) };
}

function getNativeAddressParts() {
  return {
    cep: String(getValue('campo-cep') || '').trim(),
    endereco: String(getValue('campo-endereco') || '').trim(),
    numero: String(getValue('campo-numero') || '').trim(),
    bairro: String(getValue('campo-bairro') || '').trim(),
    cidade: String(getValue('campo-cidade') || '').trim(),
    estado: String(getValue('campo-estado') || '').trim(),
    pais: String(getValue('campo-pais') || '').trim(),
  };
}

function getCurrentAddressPartsForMaps() {
  const address = getNativeAddressParts();

  if (!state.usarFichaPrincipalClientes) return address;

  GOOGLE_MAPS_ADDRESS_PARTS.forEach((part) => {
    const custom = getAddressPartFromCustomLocation(part);
    if (custom.found) address[part] = custom.value;
  });

  return address;
}

function buildGoogleMapsAddressQuery() {
  const address = getCurrentAddressPartsForMaps();
  const cityState = [address.cidade, address.estado].filter(Boolean).join(' - ');

  return [
    address.endereco,
    address.numero,
    address.bairro,
    cityState,
    address.cep,
    address.pais,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(', ');
}

function hasUsefulGoogleMapsAddress() {
  const address = getCurrentAddressPartsForMaps();
  return !!(address.endereco || address.cep || address.cidade);
}

function createGoogleMapsAddressButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-secondary btn-sm cliente-google-maps-btn cliente-google-maps-btn--generated';
  button.dataset.openGoogleMapsClientAddress = '';
  button.innerHTML = '<i class="fa-solid fa-location-dot" aria-hidden="true"></i><span>Abrir no Google Maps</span>';
  return button;
}

function ensureGoogleMapsButtonInCustomLocation() {
  document
    .querySelectorAll('#custom-fields-container .cliente-google-maps-btn--generated')
    .forEach((button) => button.remove());

  if (!state.usarFichaPrincipalClientes) return;

  const section = getCustomLocationSection();
  const head = section?.querySelector('.custom-section-head');
  if (!head) return;

  const mapsEnabled = Array.from(section.querySelectorAll('[data-custom-field-wrapper="true"]'))
    .some((wrapper) => isFlagEnabled(wrapper.dataset.googleMapsEnabled));
  if (!mapsEnabled) return;

  head.classList.add('custom-section-head--actions');
  head.appendChild(createGoogleMapsAddressButton());
}

function updateGoogleMapsAddressButtons() {
  const enabled = hasUsefulGoogleMapsAddress();
  const title = enabled
    ? 'Abrir este endereço no Google Maps'
    : 'Preencha o endereço para abrir no Google Maps';

  document
    .querySelectorAll('#modal-cliente-backdrop [data-open-google-maps-client-address]')
    .forEach((button) => {
      button.disabled = !enabled;
      button.title = title;
      button.setAttribute('aria-label', title);
    });
}

function syncGoogleMapsAddressActions() {
  ensureGoogleMapsButtonInCustomLocation();
  updateGoogleMapsAddressButtons();
}

function openCurrentClientAddressInGoogleMaps() {
  const query = buildGoogleMapsAddressQuery();

  if (!query || !hasUsefulGoogleMapsAddress()) {
    toast('Preencha o endereço do imóvel antes de abrir o Google Maps.', 'error');
    return;
  }

  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.click();
}

function maskCepValue(value) {
  const digits = String(value || '').replace(/\D+/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

async function fetchCepProvider(provider, cep) {
  if (provider === 'brasilapi') {
    const response = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
    if (!response.ok) throw new Error('BrasilAPI indisponível');
    const data = await response.json();
    return {
      cep: data.cep || cep,
      logradouro: data.street || '',
      bairro: data.neighborhood || '',
      cidade: data.city || '',
      estado: data.state || '',
    };
  }

  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  if (!response.ok) throw new Error('ViaCEP indisponível');
  const data = await response.json();
  if (data.erro) throw new Error('CEP não encontrado');
  return {
    cep: data.cep || cep,
    logradouro: data.logradouro || '',
    bairro: data.bairro || '',
    cidade: data.localidade || '',
    estado: data.uf || '',
  };
}

async function buscarEnderecoPorCep(cep, provider = 'viacep', fallback = '') {
  const clean = String(cep || '').replace(/\D+/g, '');
  if (clean.length !== 8) return null;

  try {
    return await fetchCepProvider(provider || 'viacep', clean);
  } catch (error) {
    if (fallback && fallback !== provider) {
      return fetchCepProvider(fallback, clean);
    }
    throw error;
  }
}

function findCustomCepSourceField() {
  const records = Array.from(document.querySelectorAll('#custom-fields-container [data-custom-field]'))
    .map((el, index) => ({
      el,
      index,
      wrapper: el.closest('[data-custom-field-wrapper="true"]'),
    }))
    .filter((record) => isFlagEnabled(record.wrapper?.dataset.cepSource));

  return chooseRenderedField(records) || null;
}

function getCustomCepTargets() {
  return Array.from(document.querySelectorAll('#custom-fields-container [data-custom-field]'))
    .map((el, index) => ({
      el,
      index,
      wrapper: el.closest('[data-custom-field-wrapper="true"]'),
    }));
}

function fillCustomCepTargets(address = {}, sourceField = null) {
  const sourceSection = sourceField?.closest?.('.custom-section-card') || null;

  getCustomCepTargets().forEach(({ el, wrapper }) => {
    if (!wrapper || el === sourceField) return;

    const keys = [
      wrapper.dataset.systemField,
      el.dataset.customField,
      el.dataset.customLabel,
    ].filter(Boolean);
    const sameSection = !!sourceSection && el.closest('.custom-section-card') === sourceSection;
    const inferred = (part) => sameSection && keys.some((key) => addressFieldMatches(part, key));

    if (isFlagEnabled(wrapper.dataset.cepFillLogradouro) || inferred('endereco')) {
      setRenderedFieldValue(el, address.logradouro || '');
    }
    if (isFlagEnabled(wrapper.dataset.cepFillBairro) || inferred('bairro')) {
      setRenderedFieldValue(el, address.bairro || '');
    }
    if (isFlagEnabled(wrapper.dataset.cepFillCidade) || inferred('cidade')) {
      setRenderedFieldValue(el, address.cidade || '');
    }
    if (isFlagEnabled(wrapper.dataset.cepFillEstado) || inferred('estado')) {
      setRenderedFieldValue(el, address.estado || '');
    }
  });
}

function fillNativeCepTargets(address = {}) {
  if (address.logradouro) setValue('campo-endereco', address.logradouro || '');
  if (address.bairro) setValue('campo-bairro', address.bairro || '');
  if (address.cidade) setValue('campo-cidade', address.cidade || '');
  if (address.estado) setValue('campo-estado', address.estado || '');
  if (address.cep) setValue('campo-cep', maskCepValue(address.cep));
}

async function handleCepAutomationFromField(field) {
  if (!field) return;

  const wrapper = field.closest('[data-custom-field-wrapper="true"]');
  const cepDigits = String(getRenderedFieldValue(field) || '').replace(/\D+/g, '');
  if (cepDigits.length !== 8) return;
  if (field.dataset.cepLookupInFlight === cepDigits) return;

  const provider = wrapper?.dataset.cepProvider || 'viacep';
  const fallback = wrapper?.dataset.cepFallback || '';
  field.dataset.cepLookupInFlight = cepDigits;

  try {
    const address = await buscarEnderecoPorCep(cepDigits, provider, fallback);
    if (!address) return;
    setRenderedFieldValue(field, maskCepValue(address.cep || cepDigits));
    fillCustomCepTargets(address, field);
    updateGoogleMapsAddressButtons();
    toast('Endereço preenchido automaticamente pelo CEP.', 'success');
  } catch (error) {
    console.error('[Clientes] erro ao buscar CEP personalizado:', error);
    toast('Não foi possível localizar o CEP informado.', 'error');
  } finally {
    delete field.dataset.cepLookupInFlight;
  }
}

async function handleNativeCepAutomation() {
  const input = $('campo-cep');
  const cepDigits = String(getValue('campo-cep') || '').replace(/\D+/g, '');
  if (!input || cepDigits.length !== 8) return;
  if (input.dataset.cepLookupInFlight === cepDigits) return;
  input.dataset.cepLookupInFlight = cepDigits;

  try {
    const address = await buscarEnderecoPorCep(cepDigits, 'viacep', 'brasilapi');
    if (!address) return;
    fillNativeCepTargets(address);
    updateGoogleMapsAddressButtons();
    toast('Endereço preenchido automaticamente pelo CEP.', 'success');
  } catch (error) {
    console.error('[Clientes] erro ao buscar CEP nativo:', error);
    toast('Não foi possível localizar o CEP informado.', 'error');
  } finally {
    delete input.dataset.cepLookupInFlight;
  }
}

function handleCepFieldInputMask(event) {
  const target = event.target;
  if (!target) return;
  if (target.id === 'campo-cep' || isFlagEnabled(target.closest?.('[data-custom-field-wrapper="true"]')?.dataset.cepSource)) {
    target.value = maskCepValue(target.value);
  }
}

function bindResumoSidebarCliente() {
  [
    'campo-nome',
    'campo-nome-fantasia',
    'campo-codigo',
    'campo-codigo-ficha-principal',
  ].forEach((id) => {
    const el = $(id);

    if (!el || el.dataset.resumoSidebarBound === 'true') return;

    el.dataset.resumoSidebarBound = 'true';

    el.addEventListener('input', () => {
      agendarResumoSidebarCliente(currentDetail);
    });

    el.addEventListener('change', () => {
      agendarResumoSidebarCliente(currentDetail);
    });
  });
}

function getSectionTitleFromCard(card, index) {
  const raw =
    card.querySelector('.custom-section-head h4')?.textContent ||
    card.querySelector('h4')?.textContent ||
    `Seção ${index + 1}`;

  return String(raw)
    .replace(/\s+/g, ' ')
    .trim();
}

function mostrarSomenteAbaCamposPersonalizados() {
  $$('.cliente-tab').forEach((tab) => {
    const isCustomTab = tab.id === 'tab-campos-personalizados';
    tab.classList.toggle('active', isCustomTab);
    tab.style.display = isCustomTab ? 'block' : 'none';
  });
}

function mostrarTodasSecoesFormulario() {
  document
    .querySelectorAll('#custom-fields-container .custom-section-card')
    .forEach((card) => {
      card.style.display = '';
    });
}

function ativarSecaoFormulario(index = 0) {
  const cards = Array.from(document.querySelectorAll('#custom-fields-container .custom-section-card'));
  const buttons = Array.from(document.querySelectorAll('.cliente-tab-btn[data-ficha-section]'));

  if (!cards.length) return;

  cards.forEach((card, cardIndex) => {
    card.style.display = cardIndex === Number(index) ? 'block' : 'none';
  });

  buttons.forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.fichaSection) === Number(index));
  });
}

function montarTabsDasSecoesDoFormulario() {
  const tabs = document.querySelector('.cliente-tabs');
  const cards = Array.from(document.querySelectorAll('#custom-fields-container .custom-section-card'));

  if (!tabs) return;

  tabs.style.display = '';

  if (!cards.length) {
    tabs.innerHTML = `
      <button type="button" class="cliente-tab-btn active" data-ficha-section="0">
        Campos do formulário
      </button>
    `;
    return;
  }

  tabs.innerHTML = cards
    .map((card, index) => {
      const title = getSectionTitleFromCard(card, index);

      return `
        <button
          type="button"
          class="cliente-tab-btn ${index === 0 ? 'active' : ''}"
          data-ficha-section="${index}"
        >
          ${escapeHtml(title)}
        </button>
      `;
    })
    .join('');
}

function ensureFichaClienteController() {
  if (fichaClienteController || !window.ValoraFichaPrincipal?.createTabFichaController) {
    return fichaClienteController;
  }

  fichaClienteController = window.ValoraFichaPrincipal.createTabFichaController({
    formSelector: '#formCliente',
    tabsSelector: '.cliente-tabs',
    tabButtonSelector: '.cliente-tab-btn',
    tabPanelSelector: '.cliente-tab',
    customTabId: 'tab-campos-personalizados',
    customContainerSelector: '#custom-fields-container',
    codeCardSelector: '#cliente-ficha-principal-code',
    toggleSelector: '#toggle-ficha-principal-cliente',
    normalTabId: 'tab-cadastro',
    buttonClass: 'cliente-tab-btn',
  });

  return fichaClienteController;
}

function setFichaPrincipalMode(enabled) {
  const controller = ensureFichaClienteController();

  if (controller) {
    controller.setMode(enabled);
    return;
  }

  const form = $('formCliente');
  const codeCard = $('cliente-ficha-principal-code');
  const toggle = $('toggle-ficha-principal-cliente');
  const tabs = document.querySelector('.cliente-tabs');

  if (form) {
    form.classList.toggle('is-ficha-principal', !!enabled);
  }

  if (codeCard) {
    codeCard.hidden = !enabled;
  }

  if (toggle) {
    toggle.checked = !!enabled;
  }

  if (!tabs) return;

  if (!originalClienteTabsHtml) {
    originalClienteTabsHtml = tabs.innerHTML;
  }

  if (enabled) {
    mostrarSomenteAbaCamposPersonalizados();
    montarTabsDasSecoesDoFormulario();
    ativarSecaoFormulario(0);
    return;
  }

  tabs.innerHTML = originalClienteTabsHtml;
  tabs.style.display = '';

  $$('.cliente-tab').forEach((tab) => {
    tab.style.display = '';
  });

  mostrarTodasSecoesFormulario();
  switchTab('tab-cadastro');
}

const CLIENT_SYSTEM_FIELDS = new Set([
  'tipo_pessoa', 'situacao', 'nome', 'nome_fantasia', 'cpf_cnpj', 'rg_ie',
  'inscricao_municipal', 'suframa', 'data_nascimento', 'codigo_referencia',
  'retencao_percentual', 'telefone', 'whatsapp', 'fax', 'email', 'email_nfe',
  'email_cobranca', 'email_fiscal', 'site', 'contato', 'parceiro_comercial',
  'percentual_comissao', 'percentual_desconto', 'regiao', 'segmento',
  'modalidade_pagamento', 'classificacao', 'cep', 'endereco', 'numero',
  'complemento', 'bairro', 'cidade', 'estado', 'pais', 'codigo_ibge_cidade',
  'codigo_ibge_uf', 'observacoes',
]);

function normalizeFichaKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getRenderedFieldValue(el) {
  if (!el) return '';

  if (el.type === 'checkbox') {
    return el.checked ? 'true' : 'false';
  }

  if (el.matches('select[multiple]')) {
    const values = Array.from(el.selectedOptions || [])
      .map((option) => String(option.value ?? '').trim())
      .filter(Boolean);
    return values.length ? JSON.stringify(values) : '';
  }

  return String(el.value ?? '').trim();
}
function setRenderedFieldValue(el, value) {
  if (!el || el.disabled || el.dataset.customReadonly === 'true') return;

  if (el.type === 'checkbox') {
    el.checked = value === true || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'sim';
  } else {
    el.value = value ?? '';
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function isFlagEnabled(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'sim';
}


function isRenderedFieldVisible(el) {
  if (!el || el.hidden) return false;
  if (el.closest('[hidden]')) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

function chooseRenderedField(records = []) {
  const enabled = records.filter((record) => !record.el.disabled && record.el.dataset.customReadonly !== 'true');
  const candidates = enabled.length ? enabled : records;

  return [...candidates].sort((a, b) => {
    const dirtyA = Number(a.el.dataset.customDirtyOrder || 0);
    const dirtyB = Number(b.el.dataset.customDirtyOrder || 0);
    if (dirtyA !== dirtyB) return dirtyB - dirtyA;

    const visibleA = isRenderedFieldVisible(a.el) ? 1 : 0;
    const visibleB = isRenderedFieldVisible(b.el) ? 1 : 0;
    if (visibleA !== visibleB) return visibleB - visibleA;

    return a.index - b.index;
  })[0] || null;
}

function collectFichaValues() {
  const root = $('custom-fields-container');
  const elements = root ? Array.from(root.querySelectorAll('[data-custom-field]')) : [];

  if (!elements.length) {
    return {
      customFields: normalizeCustomFieldsPayload(),
      systemFields: {},
    };
  }

  const validCustomSlugs = new Set(
    (state.camposClientes || [])
      .map((campo) => String(campo?.slug || '').trim())
      .filter(Boolean)
  );

  const groups = new Map();

  elements.forEach((el, index) => {
    const slug = String(el.dataset.customField || '').trim();
    if (!slug) return;

    const wrapper = el.closest('[data-custom-field-wrapper="true"]');
    const origin = String(wrapper?.dataset.customOrigin || '').trim().toLowerCase();
    const declaredSystemField = normalizeFichaKey(wrapper?.dataset.systemField || '');
    const normalizedSlug = normalizeFichaKey(slug);

    let bucket = 'custom';
    let key = slug;

    if (declaredSystemField || origin === 'sistema') {
      bucket = 'system';
      key = declaredSystemField || normalizedSlug;
    } else if (!validCustomSlugs.has(slug) && CLIENT_SYSTEM_FIELDS.has(normalizedSlug)) {
      // Compatibilidade com fichas antigas que não gravavam a origem do campo.
      bucket = 'system';
      key = normalizedSlug;
    }

    if (bucket === 'system' && !CLIENT_SYSTEM_FIELDS.has(key)) return;
    if (bucket === 'custom' && validCustomSlugs.size && !validCustomSlugs.has(slug)) return;

    const groupKey = `${bucket}:${key}`;
    const record = { el, index, bucket, key, slug };
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  });

  const customFields = {};
  const systemFields = {};

  groups.forEach((records) => {
    const selected = chooseRenderedField(records);
    if (!selected) return;

    const value = getRenderedFieldValue(selected.el);
    if (selected.bucket === 'system') {
      systemFields[selected.key] = value;
    } else {
      // Envia também string vazia. O backend usa a presença da chave para
      // apagar corretamente um valor que o usuário limpou durante a edição.
      customFields[selected.key] = value;
    }
  });

  return { customFields, systemFields };
}

function buildFichaRenderValues(data = {}) {
  const customFields = data?.custom_fields && typeof data.custom_fields === 'object'
    ? { ...data.custom_fields }
    : {};
  const systemFields = {
    ...data,
    data_cadastro: data?.data_cadastro || data?.criado_em || data?.created_at || '',
  };

  return {
    ...data,
    ...customFields,
    data_cadastro: systemFields.data_cadastro,
    __custom_fields: customFields,
    __system_fields: systemFields,
  };
}

function getCustomValue(custom, keys, fallback = '') {
  let found = false;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(custom || {}, key)) continue;
    found = true;
    const value = custom?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return found ? '' : fallback;
}

function normalizeTipoPessoa(value, fallback = 'PF') {
  const normalized = normalizeFichaKey(value);
  if (normalized === 'pj' || normalized.includes('juridica')) return 'PJ';
  if (normalized === 'pf' || normalized.includes('fisica')) return 'PF';
  return String(fallback || 'PF').toUpperCase() === 'PJ' ? 'PJ' : 'PF';
}

function applySystemFieldsToPayload(payload, systemFields = {}) {
  Object.entries(systemFields || {}).forEach(([key, rawValue]) => {
    if (!CLIENT_SYSTEM_FIELDS.has(key)) return;
    const value = String(rawValue ?? '').trim();

    if (key === 'tipo_pessoa') {
      payload.tipo_pessoa = normalizeTipoPessoa(value, payload.tipo_pessoa);
      return;
    }

    payload[key] = value;
  });
}

function buildBaseFromFichaPrincipal(customFields, fallback = {}) {
  const custom = customFields || {};

  const tipoCliente = getCustomValue(
    custom,
    ['tipo_pessoa', 'tipo_cliente', 'pessoa_fisica_juridica', 'tipo_de_pessoa'],
    fallback.tipo_pessoa || 'PF'
  );

  const tipoPessoa = normalizeTipoPessoa(tipoCliente, fallback.tipo_pessoa || 'PF');

  const nome = getCustomValue(
    custom,
    [
      'cliente',
      'nome',
      'nome_razao_social',
      'razao_social',
      'nome_completo',
      'nome_fantasia',
    ],
    fallback.nome || ''
  );

  const telefoneContato = getCustomValue(
    custom,
    [
      'telefone_contato_whatsapp',
      'telefone_contato',
      'telefone_principal',
      'telefone_celular',
      'telefone',
      'whatsapp',
    ],
    fallback.telefone || ''
  );

  const email = getCustomValue(
    custom,
    [
      'e_mail',
      'email',
      'email_principal',
      'e_mail_principal',
    ],
    fallback.email || ''
  );

  return {
    codigo:
      onlyDigits(fallback.codigo) ||
      onlyDigits(getValue('campo-codigo')) ||
      onlyDigits(getValue('campo-codigo-ficha-principal')) ||
      '',

    tipo_pessoa: tipoPessoa,
    situacao: getCustomValue(custom, ['situacao', 'status'], fallback.situacao || 'ativo'),

    nome,
    nome_fantasia: getCustomValue(custom, ['nome_fantasia'], fallback.nome_fantasia || ''),
    cpf_cnpj: getCustomValue(custom, tipoPessoa === 'PJ'
      ? ['cpf_cnpj', 'cnpj', 'cnpj_pessoa_juridica', 'cnpj_pj', 'documento']
      : ['cpf_cnpj', 'cpf', 'cpf_pessoa_fisica', 'cpf_pf', 'documento'], fallback.cpf_cnpj || ''),
    rg_ie: getCustomValue(custom, tipoPessoa === 'PJ'
      ? ['rg_ie', 'inscricao_estadual', 'ie']
      : ['rg_ie', 'rg', 'registro_geral'], fallback.rg_ie || ''),
    inscricao_municipal: getCustomValue(custom, ['inscricao_municipal'], fallback.inscricao_municipal || ''),
    suframa: getCustomValue(custom, ['suframa'], fallback.suframa || ''),
    data_nascimento: getCustomValue(custom, ['data_nascimento', 'nascimento'], fallback.data_nascimento || ''),
    codigo_referencia: getCustomValue(custom, ['codigo_referencia', 'referencia'], fallback.codigo_referencia || ''),
    retencao_percentual: getCustomValue(custom, ['retencao_percentual', 'percentual_retencao', 'retencao'], fallback.retencao_percentual || ''),

    telefone: telefoneContato,
    whatsapp: getCustomValue(
      custom,
      ['whatsapp', 'telefone_contato_whatsapp', 'telefone_celular'],
      fallback.whatsapp || telefoneContato
    ),

    fax: getCustomValue(custom, ['fax'], fallback.fax || ''),
    contato: getCustomValue(custom, ['contato', 'responsavel', 'nome_completo_responsavel'], fallback.contato || ''),
    email,
    email_nfe: getCustomValue(custom, ['email_nfe', 'e_mail_nfe'], fallback.email_nfe || ''),
    email_cobranca: getCustomValue(custom, ['email_cobranca', 'e_mail_cobranca'], fallback.email_cobranca || ''),
    email_fiscal: getCustomValue(custom, ['email_fiscal', 'e_mail_fiscal'], fallback.email_fiscal || ''),

    site: getCustomValue(custom, ['home_page', 'homepage', 'site'], fallback.site || ''),

    cep: getCustomValue(custom, ['cep'], fallback.cep || ''),
    endereco: getCustomValue(custom, ['endereco', 'logradouro'], fallback.endereco || ''),
    numero: getCustomValue(custom, ['numero'], fallback.numero || ''),
    complemento: getCustomValue(custom, ['complemento'], fallback.complemento || ''),
    bairro: getCustomValue(custom, ['bairro'], fallback.bairro || ''),
    cidade: getCustomValue(custom, ['cidade'], fallback.cidade || ''),
    estado: getCustomValue(custom, ['uf', 'estado'], fallback.estado || ''),
    pais: getCustomValue(custom, ['pais'], fallback.pais || 'Brasil'),
    codigo_ibge_cidade: getCustomValue(custom, ['codigo_ibge_cidade', 'ibge_cidade'], fallback.codigo_ibge_cidade || ''),
    codigo_ibge_uf: getCustomValue(custom, ['codigo_ibge_uf', 'ibge_uf'], fallback.codigo_ibge_uf || ''),

    parceiro_comercial: getCustomValue(custom, ['parceiro_comercial', 'parceiro', 'vendedor'], fallback.parceiro_comercial || ''),
    percentual_comissao: getCustomValue(custom, ['percentual_comissao', 'comissao_percentual', 'comissao'], fallback.percentual_comissao || ''),
    percentual_desconto: getCustomValue(custom, ['percentual_desconto', 'desconto_percentual', 'desconto'], fallback.percentual_desconto || ''),
    modalidade_pagamento: getCustomValue(custom, ['modalidade_pagamento', 'forma_pagamento', 'condicao_pagamento'], fallback.modalidade_pagamento || ''),

    regiao: getCustomValue(custom, ['regiao'], fallback.regiao || ''),
    segmento: getCustomValue(custom, ['tipo_de_imovel', 'tipo_imovel', 'segmento'], fallback.segmento || ''),
    classificacao: getCustomValue(custom, ['classificacao', 'tipo_cliente'], fallback.classificacao || ''),

    observacoes: getCustomValue(custom, ['observacoes', 'observacao'], fallback.observacoes || ''),
  };
}

async function fillClientForm(cliente = {}) {
  clienteModalHydrating = true;
  const data = { ...defaultCliente(), ...(cliente || {}) };
  currentDetail = data;
  syncZapsChatButton(data);

  syncFichaPrincipalCode(data.codigo);
  syncFichaPrincipalCadastro(data.criado_em || data.data_cadastro || data.created_at, !data.id);

  setValue('campo-tipo-pessoa', data.tipo_pessoa);
  setValue('campo-situacao', data.situacao);
  setValue('campo-nome', data.nome);
  setValue('campo-nome-fantasia', data.nome_fantasia);
  setValue('campo-cpf-cnpj', data.cpf_cnpj);
  setValue('campo-rg-ie', data.rg_ie);
  setValue('campo-inscricao-municipal', data.inscricao_municipal);
  setValue('campo-suframa', data.suframa);
  setValue('campo-data-nascimento', data.data_nascimento);
  setValue('campo-codigo-referencia', data.codigo_referencia);
  setValue('campo-retencao-percentual', data.retencao_percentual);
  setValue('campo-site', data.site);
  setValue('campo-telefone', data.telefone);
  setValue('campo-whatsapp', data.whatsapp);
  setValue('campo-fax', data.fax);
  setValue('campo-contato', data.contato);
  setValue('campo-email', data.email);
  setValue('campo-email-nfe', data.email_nfe);
  setValue('campo-email-cobranca', data.email_cobranca);
  setValue('campo-email-fiscal', data.email_fiscal);
  setValue('campo-parceiro-comercial', data.parceiro_comercial);
  setValue('campo-percentual-comissao', data.percentual_comissao);
  setValue('campo-percentual-desconto', data.percentual_desconto);
  setValue('campo-modalidade-pagamento', data.modalidade_pagamento);
  setValue('campo-regiao', data.regiao);
  setValue('campo-segmento', data.segmento);
  setValue('campo-classificacao', data.classificacao);
  setValue('campo-pais', data.pais || 'Brasil');
  setValue('campo-cep', data.cep);
  setValue('campo-endereco', data.endereco);
  setValue('campo-numero', data.numero);
  setValue('campo-complemento', data.complemento);
  setValue('campo-bairro', data.bairro);
  setValue('campo-cidade', data.cidade);
  setValue('campo-estado', data.estado);
  setValue('campo-codigo-ibge-cidade', data.codigo_ibge_cidade);
  setValue('campo-codigo-ibge-uf', data.codigo_ibge_uf);
  setValue('campo-observacoes', data.observacoes);

  await renderCustomFieldsInputs(state.camposClientes, buildFichaRenderValues(data));
  syncGoogleMapsAddressActions();

  syncFichaPrincipalCode(data.codigo || getValue('campo-codigo'));
  setFichaPrincipalMode(state.usarFichaPrincipalClientes);

  renderEnderecos(data.enderecos || []);
  renderRefsComerciais(data.referencias_comerciais || []);
  renderRefsBancarias(data.referencias_bancarias || []);
  renderSocios(data.socios || []);
  renderOcorrencias(data.ocorrencias || []);
  renderAnexos(data.anexos || []);
  renderHistorico(data.historico || {});

  syncClienteStatusPill(data.situacao);
  syncClienteBudgetActions();
  closeClienteActionsMenu();
  switchTab(state.usarFichaPrincipalClientes ? 'tab-campos-personalizados' : 'tab-cadastro');

  bindResumoSidebarCliente();
  agendarResumoSidebarCliente(data);
  clienteModalHydrating = false;
  setClienteModalDirty(false);
  syncClienteRecordNavigation();
  prefetchClientesAdjacentes();
}

function getRowsData(containerId) {
  const wrap = $(containerId);
  if (!wrap) return [];

  return $$('.mini-item', wrap).map((item) => {
    const data = {};

    $$('[data-key]', item).forEach((input) => {
      data[input.dataset.key] = input.value;
    });

    return data;
  });
}

function buildPayload() {
  const { customFields, systemFields } = state.usarFichaPrincipalClientes
    ? collectFichaValues()
    : { customFields: normalizeCustomFieldsPayload(), systemFields: {} };

  const payload = {
    codigo: onlyDigits(getValue('campo-codigo') || getValue('campo-codigo-ficha-principal')),
    tipo_pessoa: String(getValue('campo-tipo-pessoa') || 'PF').trim(),
    situacao: String(getValue('campo-situacao') || 'ativo').trim(),
    nome: String(getValue('campo-nome') || '').trim(),
    nome_fantasia: String(getValue('campo-nome-fantasia') || '').trim(),
    cpf_cnpj: String(getValue('campo-cpf-cnpj') || '').trim(),
    rg_ie: String(getValue('campo-rg-ie') || '').trim(),
    inscricao_municipal: String(getValue('campo-inscricao-municipal') || '').trim(),
    suframa: String(getValue('campo-suframa') || '').trim(),
    data_nascimento: getValue('campo-data-nascimento'),
    codigo_referencia: String(getValue('campo-codigo-referencia') || '').trim(),
    retencao_percentual: String(getValue('campo-retencao-percentual') || '').trim(),
    site: String(getValue('campo-site') || '').trim(),
    telefone: String(getValue('campo-telefone') || '').trim(),
    whatsapp: String(getValue('campo-whatsapp') || '').trim(),
    fax: String(getValue('campo-fax') || '').trim(),
    contato: String(getValue('campo-contato') || '').trim(),
    email: String(getValue('campo-email') || '').trim(),
    email_nfe: String(getValue('campo-email-nfe') || '').trim(),
    email_cobranca: String(getValue('campo-email-cobranca') || '').trim(),
    email_fiscal: String(getValue('campo-email-fiscal') || '').trim(),
    parceiro_comercial: String(getValue('campo-parceiro-comercial') || '').trim(),
    percentual_comissao: String(getValue('campo-percentual-comissao') || '').trim(),
    percentual_desconto: String(getValue('campo-percentual-desconto') || '').trim(),
    modalidade_pagamento: String(getValue('campo-modalidade-pagamento') || '').trim(),
    regiao: String(getValue('campo-regiao') || '').trim(),
    segmento: String(getValue('campo-segmento') || '').trim(),
    classificacao: String(getValue('campo-classificacao') || '').trim(),
    pais: String(getValue('campo-pais') || '').trim(),
    cep: String(getValue('campo-cep') || '').trim(),
    endereco: String(getValue('campo-endereco') || '').trim(),
    numero: String(getValue('campo-numero') || '').trim(),
    complemento: String(getValue('campo-complemento') || '').trim(),
    bairro: String(getValue('campo-bairro') || '').trim(),
    cidade: String(getValue('campo-cidade') || '').trim(),
    estado: String(getValue('campo-estado') || '').trim(),
    codigo_ibge_cidade: String(getValue('campo-codigo-ibge-cidade') || '').trim(),
    codigo_ibge_uf: String(getValue('campo-codigo-ibge-uf') || '').trim(),
    observacoes: String(getValue('campo-observacoes') || '').trim(),
    enderecos: getRowsData('lista-enderecos'),
    referencias_comerciais: getRowsData('lista-refs-comerciais'),
    referencias_bancarias: getRowsData('lista-refs-bancarias'),
    socios: getRowsData('lista-socios'),
    ocorrencias: getRowsData('lista-ocorrencias'),
    custom_fields: customFields,
  };

  if (state.usarFichaPrincipalClientes) {
    // Primeiro aplica os aliases de fichas antigas/personalizadas e depois os
    // campos do sistema identificados de forma exata. Assim, CPF/CNPJ e os
    // demais dados nativos sempre refletem o campo realmente editado.
    Object.assign(payload, buildBaseFromFichaPrincipal(customFields, payload));
    applySystemFieldsToPayload(payload, systemFields);
  }

  payload.codigo = onlyDigits(payload.codigo);

  return payload;
}

function enderecoVazio() {
  return {
    tipo_endereco: 'entrega',
    descricao: '',
    cep: '',
    logradouro: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    pais: 'Brasil',
    codigo_ibge_cidade: '',
    codigo_ibge_uf: '',
    email_destino: '',
  };
}

function refComercialVazia() {
  return {
    empresa_nome: '',
    telefone: '',
    data_ultima_compra: '',
    valor_ultima_compra: '',
    valor_prestacao: '',
    vencimento_ultima_parcela: '',
    observacoes: '',
  };
}

function refBancariaVazia() {
  return {
    banco: '',
    agencia: '',
    conta_corrente: '',
    gerente: '',
    telefone_agencia: '',
    limite_credito: '',
    status: '',
    observacoes: '',
  };
}

function socioVazio() {
  return {
    nome: '',
    cpf: '',
    rg: '',
    data_nascimento: '',
    telefone: '',
    cargo: '',
    participacao_percentual: '',
  };
}

function ocorrenciaVazia() {
  const dt = new Date().toISOString().slice(0, 16);

  return {
    data_movimento: dt,
    tipo: 'Interna',
    status: 'Aberta',
    descricao: '',
  };
}

function renderEnderecos(items = []) {
  const wrap = $('lista-enderecos');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhum endereço adicional cadastrado.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, idx) => `
        <div class="mini-item" data-index="${idx}">
          <div class="mini-item-grid">
            <div class="form-group">
              <label>Tipo</label>
              <select data-key="tipo_endereco">
                <option value="cobranca" ${item.tipo_endereco === 'cobranca' ? 'selected' : ''}>Cobrança</option>
                <option value="entrega" ${item.tipo_endereco === 'entrega' ? 'selected' : ''}>Entrega</option>
                <option value="fiscal" ${item.tipo_endereco === 'fiscal' ? 'selected' : ''}>Fiscal</option>
                <option value="outro" ${item.tipo_endereco === 'outro' ? 'selected' : ''}>Outro</option>
              </select>
            </div>

            <div class="form-group">
              <label>Descrição</label>
              <input type="text" data-key="descricao" value="${escapeHtml(item.descricao || '')}" />
            </div>

            <div class="form-group">
              <label>CEP</label>
              <input type="text" data-key="cep" value="${escapeHtml(item.cep || '')}" />
            </div>

            <div class="form-group">
              <label>E-mail destino</label>
              <input type="text" data-key="email_destino" value="${escapeHtml(item.email_destino || '')}" />
            </div>

            <div class="form-group" style="grid-column: span 2;">
              <label>Logradouro</label>
              <input type="text" data-key="logradouro" value="${escapeHtml(item.logradouro || '')}" />
            </div>

            <div class="form-group">
              <label>Número</label>
              <input type="text" data-key="numero" value="${escapeHtml(item.numero || '')}" />
            </div>

            <div class="form-group">
              <label>Complemento</label>
              <input type="text" data-key="complemento" value="${escapeHtml(item.complemento || '')}" />
            </div>

            <div class="form-group">
              <label>Bairro</label>
              <input type="text" data-key="bairro" value="${escapeHtml(item.bairro || '')}" />
            </div>

            <div class="form-group">
              <label>Cidade</label>
              <input type="text" data-key="cidade" value="${escapeHtml(item.cidade || '')}" />
            </div>

            <div class="form-group">
              <label>UF</label>
              <input type="text" data-key="estado" value="${escapeHtml(item.estado || '')}" />
            </div>

            <div class="form-group">
              <label>País</label>
              <input type="text" data-key="pais" value="${escapeHtml(item.pais || 'Brasil')}" />
            </div>
          </div>

          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="endereco" data-index="${idx}">
              Remover
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderRefsComerciais(items = []) {
  const wrap = $('lista-refs-comerciais');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhuma referência comercial cadastrada.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, idx) => `
        <div class="mini-item" data-index="${idx}">
          <div class="mini-item-grid">
            <div class="form-group">
              <label>Empresa</label>
              <input type="text" data-key="empresa_nome" value="${escapeHtml(item.empresa_nome || '')}" />
            </div>

            <div class="form-group">
              <label>Telefone</label>
              <input type="text" data-key="telefone" value="${escapeHtml(item.telefone || '')}" />
            </div>

            <div class="form-group">
              <label>Data última compra</label>
              <input type="date" data-key="data_ultima_compra" value="${escapeHtml(item.data_ultima_compra || '')}" />
            </div>

            <div class="form-group">
              <label>Valor última compra</label>
              <input type="text" data-key="valor_ultima_compra" value="${escapeHtml(item.valor_ultima_compra || '')}" />
            </div>

            <div class="form-group">
              <label>Valor prestação</label>
              <input type="text" data-key="valor_prestacao" value="${escapeHtml(item.valor_prestacao || '')}" />
            </div>

            <div class="form-group">
              <label>Venc. última parcela</label>
              <input type="date" data-key="vencimento_ultima_parcela" value="${escapeHtml(item.vencimento_ultima_parcela || '')}" />
            </div>

            <div class="form-group" style="grid-column: span 2;">
              <label>Observações</label>
              <input type="text" data-key="observacoes" value="${escapeHtml(item.observacoes || '')}" />
            </div>
          </div>

          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="refcom" data-index="${idx}">
              Remover
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderRefsBancarias(items = []) {
  const wrap = $('lista-refs-bancarias');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhuma referência bancária cadastrada.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, idx) => `
        <div class="mini-item" data-index="${idx}">
          <div class="mini-item-grid">
            <div class="form-group">
              <label>Banco</label>
              <input type="text" data-key="banco" value="${escapeHtml(item.banco || '')}" />
            </div>

            <div class="form-group">
              <label>Agência</label>
              <input type="text" data-key="agencia" value="${escapeHtml(item.agencia || '')}" />
            </div>

            <div class="form-group">
              <label>Conta Corrente</label>
              <input type="text" data-key="conta_corrente" value="${escapeHtml(item.conta_corrente || '')}" />
            </div>

            <div class="form-group">
              <label>Gerente</label>
              <input type="text" data-key="gerente" value="${escapeHtml(item.gerente || '')}" />
            </div>

            <div class="form-group">
              <label>Telefone agência</label>
              <input type="text" data-key="telefone_agencia" value="${escapeHtml(item.telefone_agencia || '')}" />
            </div>

            <div class="form-group">
              <label>Limite</label>
              <input type="text" data-key="limite_credito" value="${escapeHtml(item.limite_credito || '')}" />
            </div>

            <div class="form-group">
              <label>Status</label>
              <input type="text" data-key="status" value="${escapeHtml(item.status || '')}" />
            </div>

            <div class="form-group">
              <label>Observações</label>
              <input type="text" data-key="observacoes" value="${escapeHtml(item.observacoes || '')}" />
            </div>
          </div>

          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="refbanc" data-index="${idx}">
              Remover
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderSocios(items = []) {
  const wrap = $('lista-socios');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhum sócio cadastrado.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, idx) => `
        <div class="mini-item" data-index="${idx}">
          <div class="mini-item-grid">
            <div class="form-group">
              <label>Nome</label>
              <input type="text" data-key="nome" value="${escapeHtml(item.nome || '')}" />
            </div>

            <div class="form-group">
              <label>CPF</label>
              <input type="text" data-key="cpf" value="${escapeHtml(item.cpf || '')}" />
            </div>

            <div class="form-group">
              <label>RG</label>
              <input type="text" data-key="rg" value="${escapeHtml(item.rg || '')}" />
            </div>

            <div class="form-group">
              <label>Nascimento</label>
              <input type="date" data-key="data_nascimento" value="${escapeHtml(item.data_nascimento || '')}" />
            </div>

            <div class="form-group">
              <label>Telefone</label>
              <input type="text" data-key="telefone" value="${escapeHtml(item.telefone || '')}" />
            </div>

            <div class="form-group">
              <label>Cargo</label>
              <input type="text" data-key="cargo" value="${escapeHtml(item.cargo || '')}" />
            </div>

            <div class="form-group">
              <label>% Participação</label>
              <input type="text" data-key="participacao_percentual" value="${escapeHtml(item.participacao_percentual || '')}" />
            </div>
          </div>

          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="socio" data-index="${idx}">
              Remover
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderOcorrencias(items = []) {
  const wrap = $('lista-ocorrencias');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhuma ocorrência lançada.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item, idx) => `
        <div class="mini-item" data-index="${idx}">
          <div class="mini-item-grid">
            <div class="form-group">
              <label>Data</label>
              <input type="datetime-local" data-key="data_movimento" value="${escapeHtml(String(item.data_movimento || '').slice(0, 16))}" />
            </div>

            <div class="form-group">
              <label>Tipo</label>
              <input type="text" data-key="tipo" value="${escapeHtml(item.tipo || '')}" />
            </div>

            <div class="form-group">
              <label>Status</label>
              <input type="text" data-key="status" value="${escapeHtml(item.status || '')}" />
            </div>

            <div class="form-group" style="grid-column: span 4;">
              <label>Descrição</label>
              <textarea rows="3" data-key="descricao">${escapeHtml(item.descricao || '')}</textarea>
            </div>
          </div>

          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="ocorrencia" data-index="${idx}">
              Remover
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function renderAnexos(items = []) {
  const wrap = $('lista-anexos');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = `<div class="empty-soft">Nenhum anexo cadastrado.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map(
      (item) => `
        <div class="anexo-row">
          <div style="display:flex; flex-direction:column; gap:4px;">
            <strong>${escapeHtml(item.arquivo_nome || '')}</strong>
            <span class="subtle">
              ${escapeHtml(item.tipo_documento || '')}${item.descricao ? ` • ${escapeHtml(item.descricao)}` : ''}
            </span>
            <span class="subtle">${escapeHtml(item.usuario_nome || '')}</span>
          </div>

          <div style="display:flex; gap:8px;">
            <a class="btn btn-secondary btn-sm" href="${escapeHtml(item.arquivo_path || '#')}" target="_blank" rel="noopener noreferrer">
              Abrir
            </a>

            <button type="button" class="btn btn-secondary btn-sm" data-remove-anexo="${item.id}">
              Excluir
            </button>
          </div>
        </div>
      `
    )
    .join('');
}

function formatHistoryValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatHistoryMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '—';
  const raw = String(value).trim().replace(/[^0-9,.-]/g, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const number = Number(normalized);
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : String(value);
}

function formatHistoryDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString('pt-BR');
}

function getClienteAtualId() {
  return Number(state.clienteEditandoId || currentDetail?.id || 0);
}

function clienteModalEstaAberto() {
  const backdrop = $('modal-cliente-backdrop');
  return !!backdrop && !backdrop.hidden;
}

function setClienteModalDirty(dirty) {
  clienteModalDirty = Boolean(dirty);
  const pill = $('cliente-unsaved-pill');
  if (pill) pill.hidden = !clienteModalDirty;
}

function markClienteModalDirty() {
  if (clienteModalHydrating || clienteModalSomenteLeitura) return;
  setClienteModalDirty(true);
}

function deriveClienteListPosition(clientId) {
  const items = Array.isArray(state.clientes) ? state.clientes : [];
  const index = items.findIndex((item) => Number(item?.id) === Number(clientId || 0));
  if (index < 0) return null;
  return Number(state.clientesPage?.offset || 0) + index;
}

function prepareClienteListPosition(clientId) {
  if (clienteModalListPositionOverride !== null) {
    clienteModalListPosition = Number(clienteModalListPositionOverride);
    clienteModalListPositionOverride = null;
  } else {
    clienteModalListPosition = deriveClienteListPosition(clientId);
  }
  clienteModalListTotal = Number(state.clientesPage?.total || state.clientes?.length || 0);
}

function syncClienteRecordNavigation() {
  const navigation = $('cliente-record-navigation');
  const previous = $('btn-cliente-anterior');
  const next = $('btn-cliente-proximo');
  const position = $('cliente-record-position');
  if (!navigation || !previous || !next || !position) return;

  const clientId = getClienteAtualId();
  const currentPosition = Number(clienteModalListPosition);
  const total = Number(clienteModalListTotal || state.clientesPage?.total || 0);

  if (!clientId || clienteModalListPosition === null || !Number.isFinite(currentPosition) || total <= 0) {
    navigation.hidden = true;
    return;
  }

  navigation.hidden = false;
  position.textContent = `${currentPosition + 1} de ${total}`;
  previous.disabled = currentPosition <= 0;
  next.disabled = currentPosition >= total - 1;
  previous.dataset.targetListOffset = currentPosition > 0 ? String(currentPosition - 1) : '';
  next.dataset.targetListOffset = currentPosition < total - 1 ? String(currentPosition + 1) : '';
}

function prefetchClientesAdjacentes() {
  const items = Array.isArray(state.clientes) ? state.clientes : [];
  const pageOffset = Number(state.clientesPage?.offset || 0);
  const position = Number(clienteModalListPosition);
  if (!items.length || clienteModalListPosition === null || !Number.isFinite(position)) return;

  const localIndex = position - pageOffset;
  [localIndex - 1, localIndex + 1].forEach((index) => {
    const id = Number(items[index]?.id || 0);
    if (id) void prefetchClienteNoServidor(id);
  });
}

async function confirmarDescarteAlteracoesCliente(message = 'Existem alterações não salvas. Deseja continuar e descartar essas alterações?') {
  if (!clienteModalDirty) return true;
  return confirmDialog({
    title: 'Alterações não salvas',
    message,
    confirmText: 'Descartar e continuar',
    cancelText: 'Continuar editando',
  });
}

async function requestCloseClientModal() {
  const canClose = await confirmarDescarteAlteracoesCliente(
    'Existem alterações não salvas neste cliente. Deseja fechar mesmo assim?'
  );
  if (!canClose) return false;
  closeClientModal();
  return true;
}

async function navegarParaClienteAdjacente(targetOffset) {
  const offset = Number(targetOffset);
  if (!Number.isFinite(offset) || offset < 0) return;

  const canNavigate = await confirmarDescarteAlteracoesCliente(
    'Existem alterações não salvas. Deseja descartá-las e abrir outro cliente?'
  );
  if (!canNavigate) return;

  try {
    const result = await obterClienteNaPosicaoDaLista(offset);
    const nextId = Number(result?.item?.id || 0);
    if (!nextId) {
      toast('Não foi possível localizar o cliente nessa posição da lista.', 'error');
      return;
    }

    setClienteModalDirty(false);
    clienteModalListPositionOverride = Number(result.offset ?? offset);
    clienteModalListTotal = Number(result.total || clienteModalListTotal || 0);
    if (clienteModalSomenteLeitura) await openClientModalView(nextId);
    else await openClientModalEdit(nextId);
  } catch (error) {
    toast(error.message || 'Não foi possível abrir o próximo cliente.', 'error');
  }
}

function setClienteActionsMenuOpen(open) {
  const trigger = $('btn-cliente-acoes');
  const menu = $('cliente-actions-menu');
  const dropdown = $('cliente-actions-dropdown');
  if (!trigger || !menu) return;

  const active = Boolean(open);
  menu.hidden = !active;
  trigger.setAttribute('aria-expanded', active ? 'true' : 'false');
  dropdown?.classList.toggle('is-open', active);
}

function closeClienteActionsMenu() {
  setClienteActionsMenuOpen(false);
}

function hasClienteDraftForDuplicate() {
  try {
    const payload = buildPayload();
    return Boolean(
      payload.nome ||
      payload.nome_fantasia ||
      payload.cpf_cnpj ||
      payload.email ||
      payload.telefone ||
      payload.whatsapp ||
      (Array.isArray(payload.enderecos) && payload.enderecos.length)
    );
  } catch (_) {
    return Boolean(currentDetail?.nome || currentDetail?.nome_fantasia || currentDetail?.cpf_cnpj);
  }
}

function syncClienteStatusPill(situacao = null) {
  const pill = $('cliente-status-pill');
  if (!pill) return;

  const normalized = String(situacao ?? getValue('campo-situacao') ?? currentDetail?.situacao ?? 'ativo')
    .trim()
    .toLowerCase();

  let label = 'Ativo';
  let stateKey = 'ativo';

  if (['inativo', 'inativa', 'desativado', 'desativada'].includes(normalized)) {
    label = 'Inativo';
    stateKey = 'inativo';
  } else if (['bloqueado', 'bloqueada', 'suspenso', 'suspensa'].includes(normalized)) {
    label = 'Bloqueado';
    stateKey = 'bloqueado';
  }

  pill.classList.toggle('is-inativo', stateKey === 'inativo');
  pill.classList.toggle('is-bloqueado', stateKey === 'bloqueado');
  pill.dataset.tooltip = label;
  pill.setAttribute('aria-label', `Status: ${label}`);
  const labelEl = pill.querySelector('.cliente-top-status-text');
  if (labelEl) labelEl.textContent = label;
}

function setClienteActionAvailability(action, enabled, disabledMessage = '') {
  const button = document.querySelector(`[data-cliente-action="${action}"]`);
  if (!button) return;
  button.disabled = !enabled;
  if (!enabled && disabledMessage) {
    button.title = disabledMessage;
    button.setAttribute('aria-label', `${button.textContent.trim()}. ${disabledMessage}`);
  } else {
    button.removeAttribute('title');
    button.setAttribute('aria-label', button.textContent.trim());
  }
}

function syncClienteBudgetActions() {
  const clientId = getClienteAtualId();
  const hasDraft = hasClienteDraftForDuplicate();

  setClienteActionAvailability('arquivos', !!clientId, 'Salve o cliente antes de acessar os arquivos técnicos.');
  setClienteActionAvailability('orcamento', !!clientId, 'Salve o cliente antes de criar um orçamento.');
  setClienteActionAvailability('duplicar', !!clientId || hasDraft, 'Preencha ou salve um cliente antes de duplicar.');
  setClienteActionAvailability('agenda', true);

  const trigger = $('btn-cliente-acoes');
  if (trigger) {
    trigger.disabled = false;
  }
}

function buildClienteDuplicadoPayload() {
  const payload = buildPayload();
  return {
    ...defaultCliente(),
    ...payload,
    id: null,
    codigo: '',
    cpf_cnpj: '',
    rg_ie: '',
    inscricao_municipal: '',
    suframa: '',
    ocorrencias: [],
    anexos: [],
    historico: {},
    criado_em: '',
    atualizado_em: '',
  };
}

async function duplicarClienteAtual() {
  const clientId = getClienteAtualId();
  if (!clientId && !hasClienteDraftForDuplicate()) {
    toast('Preencha ou salve um cliente antes de duplicar.', 'error');
    return;
  }

  const confirmed = await confirmDialog({
    title: 'Duplicar cliente',
    message: 'Deseja criar um novo cadastro com base neste cliente? Os dados serão carregados para revisão antes de salvar.',
    confirmText: 'Duplicar cadastro',
    cancelText: 'Cancelar',
  });

  if (!confirmed) return;

  const proximoCodigo = await obterProximoCodigoClienteServidor();
  const duplicado = buildClienteDuplicadoPayload();

  setClienteModalReadonly(false);
  state.clienteEditandoId = null;
  clienteModalListPosition = null;
  clienteModalListPositionOverride = null;
  clienteModalListTotal = 0;
  syncZapsChatButton(null);
  $('modal-cliente-titulo').textContent = 'Duplicar cliente';

  await fillClientForm({
    ...duplicado,
    codigo: proximoCodigo,
  });

  syncFichaPrincipalCadastro('', true);
  syncClienteBudgetActions();
  syncClienteStatusPill(duplicado.situacao || 'ativo');
  await syncAgendaCliente(null, false);
  setClienteModalDirty(true);
  closeClienteActionsMenu();
  switchTab(state.usarFichaPrincipalClientes ? 'tab-campos-personalizados' : 'tab-cadastro');
  toast('Cópia carregada. Revise os dados e clique em salvar.', 'success');
}

function abrirArquivosTecnicosDoCliente() {
  const clientId = getClienteAtualId();
  if (!clientId) {
    toast('Salve o cliente antes de acessar os arquivos técnicos.', 'error');
    return;
  }
  const targetUrl = `/arquivos-tecnicos?cliente=${encodeURIComponent(clientId)}`;
  if (window.ValoraNavigate) window.ValoraNavigate(targetUrl);
  else window.location.href = targetUrl;
}

function abrirOrcamentoDoCliente() {
  const clientId = getClienteAtualId();
  if (!clientId) {
    toast('Salve o cliente antes de criar um orçamento.', 'error');
    return;
  }

  const targetUrl = `/orcamentos?novo=1&cliente_id=${encodeURIComponent(clientId)}`;
  if (window.ValoraNavigate) window.ValoraNavigate(targetUrl);
  else window.location.href = targetUrl;
}

function renderHistorico(data = {}) {
  const resumo = $('historico-resumo');
  const propostas = $('historico-propostas');
  const orcamentos = $('historico-orcamentos');
  const ocorrencias = $('historico-ocorrencias');
  const alteracoes = $('historico-alteracoes');

  const resumoData = data.resumo || {};
  const ultimasPropostas = Array.isArray(data.ultimas_propostas) ? data.ultimas_propostas : [];
  const ultimosOrcamentos = Array.isArray(data.ultimos_orcamentos) ? data.ultimos_orcamentos : [];
  const ultimasOcorrencias = Array.isArray(data.ultimas_ocorrencias) ? data.ultimas_ocorrencias : [];
  const historicoAlteracoes = Array.isArray(data.alteracoes) ? data.alteracoes : [];

  if (resumo) {
    resumo.innerHTML = `
      <div class="history-item"><strong>Propostas:</strong> ${escapeHtml(resumoData.total_propostas ?? 0)} <span class="subtle">(${escapeHtml(resumoData.propostas_aprovadas ?? 0)} aprovadas)</span></div>
      <div class="history-item"><strong>Orçamentos:</strong> ${escapeHtml(resumoData.total_orcamentos ?? 0)} <span class="subtle">(${escapeHtml(resumoData.orcamentos_aprovados ?? 0)} aprovados)</span></div>
      <div class="history-item"><strong>Alterações registradas:</strong> ${escapeHtml(resumoData.total_alteracoes ?? 0)}</div>
    `;
  }

  if (propostas) {
    propostas.innerHTML = ultimasPropostas.length
      ? ultimasPropostas.map((item) => `
          <div class="history-item">
            <strong>${escapeHtml(item.codigo || 'Sem código')}</strong>
            <div class="subtle">${escapeHtml(item.titulo || '')}</div>
            <div class="subtle">Status: ${escapeHtml(item.status || '-')} • Total: ${escapeHtml(formatHistoryMoney(item.total))}</div>
          </div>`).join('')
      : '<div class="empty-soft">Nenhuma proposta encontrada para este cliente.</div>';
  }

  if (orcamentos) {
    orcamentos.innerHTML = ultimosOrcamentos.length
      ? ultimosOrcamentos.map((item) => `
          <a class="history-item history-budget-link" href="/orcamentos?orcamento_id=${encodeURIComponent(item.id)}">
            <strong>${escapeHtml(item.codigo || 'Sem código')} • ${escapeHtml(item.titulo || 'Orçamento')}</strong>
            <div class="subtle">${escapeHtml(item.data_emissao || '')} • ${escapeHtml(item.status || '-')}</div>
            <div>${escapeHtml(formatHistoryMoney(item.total))}</div>
          </a>`).join('')
      : '<div class="empty-soft">Nenhum orçamento encontrado para este cliente.</div>';
  }

  if (ocorrencias) {
    ocorrencias.innerHTML = ultimasOcorrencias.length
      ? ultimasOcorrencias.map((item) => `
          <div class="history-item">
            <strong>${escapeHtml(item.tipo || 'Ocorrência')}</strong>
            <div class="subtle">${escapeHtml(item.data_movimento || '')}</div>
            <div>${escapeHtml(item.descricao || '')}</div>
          </div>`).join('')
      : '<div class="empty-soft">Nenhuma ocorrência registrada.</div>';
  }

  if (alteracoes) {
    alteracoes.innerHTML = historicoAlteracoes.length
      ? historicoAlteracoes.map((item) => `
          <article class="history-item history-audit-item">
            <div class="history-audit-meta"><strong>${escapeHtml(item.secao || 'Cadastro')} • ${escapeHtml(item.campo_nome || item.campo || 'Informação')}</strong><span>${escapeHtml(item.usuario_nome || 'Sistema')} • ${escapeHtml(formatHistoryDate(item.criado_em))}</span></div>
            <div class="history-audit-values"><del>${escapeHtml(formatHistoryValue(item.valor_anterior))}</del><i class="fa-solid fa-arrow-right"></i><ins>${escapeHtml(formatHistoryValue(item.valor_novo))}</ins></div>
          </article>`).join('')
      : '<div class="empty-soft">Nenhuma alteração registrada. As próximas edições serão exibidas aqui.</div>';
  }

  syncClienteBudgetActions();
}


async function uploadAnexo() {
  if (!state.clienteEditandoId) {
    toast('Salve o cliente antes de enviar anexos.', 'error');
    return;
  }

  const input = $('input-anexo');
  const file = input?.files?.[0];

  if (!file) {
    toast('Escolha um arquivo primeiro.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', file);
  formData.append('descricao', getValue('anexo-descricao'));
  formData.append('tipo_documento', getValue('anexo-tipo'));

  try {
    const resp = await fetch(`/api/clientes/${state.clienteEditandoId}/anexos/upload`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    const text = await resp.text();

    if (!resp.ok) {
      throw new Error(text || 'Erro ao enviar anexo.');
    }

    toast('Anexo enviado com sucesso.', 'success');

    input.value = '';
    setValue('anexo-descricao', '');
    setValue('anexo-tipo', '');

    await openClientModalEdit(state.clienteEditandoId);
  } catch (err) {
    toast(err.message || 'Erro ao enviar anexo.', 'error');
  }
}

async function excluirAnexo(anexoId) {
  try {
    await apiJsonDelete(`/api/clientes/anexos/${anexoId}`);

    toast('Anexo excluído.', 'success');

    if (state.clienteEditandoId) {
      await openClientModalEdit(state.clienteEditandoId);
    }
  } catch (err) {
    toast(err.message || 'Erro ao excluir anexo.', 'error');
  }
}

async function apiJsonDelete(url) {
  const resp = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const text = await resp.text();

  if (!resp.ok) {
    throw new Error(text || 'Erro na requisição.');
  }

  return text ? JSON.parse(text) : null;
}

async function salvarToggleFichaPrincipalCliente(event) {
  const checked = !!event.target.checked;

  try {
    if (!state.formularioClientes?.modelo?.id) {
      await renderCustomFieldsInputs(state.camposClientes, buildFichaRenderValues(currentDetail || {}));
    }

    const modelo = state.formularioClientes?.modelo;

    if (!modelo?.id) {
      event.target.checked = false;
      toast('Nenhum formulário de Clientes encontrado para ativar como ficha principal.', 'error');
      return;
    }

    event.target.disabled = true;
    window.ValoraFichaPrincipal?.showLoading?.(
      '#custom-fields-container',
      checked ? 'Montando ficha principal...' : 'Voltando para o cadastro padrão...'
    );

    const atualizado = window.ValoraFichaPrincipal?.atualizarFichaPrincipalModelo
      ? await window.ValoraFichaPrincipal.atualizarFichaPrincipalModelo(modelo, checked, {
          apiJsonImpl: apiJson,
          moduloFallback: 'clientes',
        })
      : await apiJson(`/api/formularios/modelos/${modelo.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            modulo: modelo.modulo || 'clientes',
            nome: modelo.nome,
            descricao: modelo.descricao || null,
            ativo: modelo.ativo !== false,
            padrao: !!modelo.padrao,
            usar_como_ficha_principal: checked,
          }),
        });

    state.usarFichaPrincipalClientes = checked;

    state.formularioClientes = {
      ...state.formularioClientes,
      modelo: {
        ...modelo,
        ...(atualizado || {}),
        usar_como_ficha_principal: checked,
      },
    };
    state.formularioClientesCheckedAt = Date.now();

    await renderCustomFieldsInputs(state.camposClientes, buildFichaRenderValues(currentDetail || {}));
    syncGoogleMapsAddressActions();
    setFichaPrincipalMode(checked);
    bindResumoSidebarCliente();
    agendarResumoSidebarCliente(currentDetail);

    toast(
      checked
        ? 'Ficha principal ativada para Clientes.'
        : 'Ficha principal desativada para Clientes.',
      'success'
    );
  } catch (err) {
    event.target.checked = !checked;
    toast(err.message || 'Erro ao alterar ficha principal.', 'error');
  } finally {
    event.target.disabled = false;
  }
}

export function bindClientModal({ afterSave } = {}) {
  _afterSave = typeof afterSave === 'function' ? afterSave : async () => {};

  if (_bound) return;
  _bound = true;

  const customFieldsContainer = $('custom-fields-container');
  const markFichaFieldDirty = (event) => {
    let field = event.target?.closest?.('[data-custom-field]');
    if (!field && event.type === 'change' && event.target?.matches?.('[data-multiselect-option]')) {
      const wrapper = event.target.closest('[data-custom-field-wrapper="true"]');
      field = wrapper?.querySelector?.('[data-custom-field]') || null;
    }
    if (!field || !customFieldsContainer?.contains(field)) return;
    fichaFieldDirtySequence += 1;
    field.dataset.customDirty = 'true';
    field.dataset.customDirtyOrder = String(fichaFieldDirtySequence);
  };
  customFieldsContainer?.addEventListener('input', markFichaFieldDirty);
  customFieldsContainer?.addEventListener('change', markFichaFieldDirty);

  document.addEventListener('click', (e) => {
    const sectionBtn = e.target.closest('.cliente-tab-btn[data-ficha-section]');
    if (!sectionBtn) return;

    const controller = ensureFichaClienteController();
    if (controller) {
      controller.activateSection(sectionBtn.dataset.fichaSection);
      return;
    }

    ativarSecaoFormulario(sectionBtn.dataset.fichaSection);
  });

  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.cliente-tab-btn[data-tab]');
    if (!tabBtn) return;

    switchTab(tabBtn.dataset.tab);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-fechar-modal-cliente')?.addEventListener('click', () => { void requestCloseClientModal(); });
  $('btn-cancelar-cliente')?.addEventListener('click', () => { void requestCloseClientModal(); });
  $('formCliente')?.addEventListener('submit', saveCliente);

  $('formCliente')?.addEventListener('input', (event) => {
    handleCepFieldInputMask(event);
    updateGoogleMapsAddressButtons();
    if (event.target?.id !== 'toggle-ficha-principal-cliente') markClienteModalDirty();
  });
  $('formCliente')?.addEventListener('change', (event) => {
    updateGoogleMapsAddressButtons();
    if (event.target?.id !== 'toggle-ficha-principal-cliente') markClienteModalDirty();
  });
  $('formCliente')?.addEventListener('focusout', (event) => {
    const target = event.target;
    if (!target) return;
    if (target.id === 'campo-cep') {
      handleNativeCepAutomation();
      return;
    }
    if (isFlagEnabled(target.closest?.('[data-custom-field-wrapper="true"]')?.dataset.cepSource)) {
      handleCepAutomationFromField(target);
    }
  });

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-google-maps-client-address]');
    if (!button || !$('modal-cliente-backdrop')?.contains(button)) return;

    event.preventDefault();
    openCurrentClientAddressInGoogleMaps();
  });

  syncGoogleMapsAddressActions();

  // A Agenda fica dentro do <form> principal do cliente. Sem este bloqueio,
  // Enter em um campo da Agenda pode disparar o submit de "Salvar cliente".
  // Textareas continuam aceitando Enter normalmente.
  $('agenda-cliente')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    if (event.target?.closest?.('textarea')) return;
    event.preventDefault();
    event.stopPropagation();
  });
  $('btn-abrir-zapschat-cliente')?.addEventListener('click', (event) => abrirClienteNoZapsChat(state.clienteEditandoId || currentDetail?.id, { button: event.currentTarget }));
  $('btn-novo-orcamento-cliente')?.addEventListener('click', abrirOrcamentoDoCliente);
  $('toggle-ficha-principal-cliente')?.addEventListener('change', salvarToggleFichaPrincipalCliente);
  $('btn-cliente-acoes')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
    setClienteActionsMenuOpen(!expanded);
  });
  $('cliente-actions-menu')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-cliente-action]');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.clienteAction;
    if (action === 'arquivos') abrirArquivosTecnicosDoCliente();
    if (action === 'orcamento') abrirOrcamentoDoCliente();
    if (action === 'agenda') abrirAgendaClienteParaCorrecao();
    if (action === 'duplicar') await duplicarClienteAtual();
    if (action !== 'duplicar') closeClienteActionsMenu();
  });
  $('formCliente')?.addEventListener('change', (event) => {
    const wrapper = event.target?.closest?.('[data-custom-field-wrapper="true"]');
    if (event.target?.id === 'campo-situacao' || wrapper?.dataset.systemField === 'situacao') {
      try { syncClienteStatusPill(buildPayload().situacao); } catch (_) { syncClienteStatusPill(event.target?.value); }
    }
    syncClienteBudgetActions();
  });
  $('formCliente')?.addEventListener('input', () => {
    syncClienteBudgetActions();
  });
  document.addEventListener('click', (event) => {
    const dropdown = $('cliente-actions-dropdown');
    if (!dropdown || dropdown.contains(event.target)) return;
    closeClienteActionsMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeClienteActionsMenu();

    const isSaveShortcut = (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's';
    if (!isSaveShortcut || !clienteModalEstaAberto() || clienteModalSomenteLeitura) return;
    if (!$('Valora-confirm-backdrop')?.hidden) return;
    event.preventDefault();
    $('formCliente')?.requestSubmit?.();
  });
  $('btn-cliente-anterior')?.addEventListener('click', (event) => {
    void navegarParaClienteAdjacente(event.currentTarget.dataset.targetListOffset);
  });
  $('btn-cliente-proximo')?.addEventListener('click', (event) => {
    void navegarParaClienteAdjacente(event.currentTarget.dataset.targetListOffset);
  });
  bindResumoSidebarCliente();

  $('modal-cliente-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('modal-cliente-backdrop')) {
      void requestCloseClientModal();
    }
  });

  $('btn-add-endereco')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.enderecos.push(enderecoVazio());
    markClienteModalDirty();
    renderEnderecos(currentDetail.enderecos);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-ref-comercial')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_comerciais.push(refComercialVazia());
    markClienteModalDirty();
    renderRefsComerciais(currentDetail.referencias_comerciais);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-ref-bancaria')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_bancarias.push(refBancariaVazia());
    markClienteModalDirty();
    renderRefsBancarias(currentDetail.referencias_bancarias);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-socio')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.socios.push(socioVazio());
    markClienteModalDirty();
    renderSocios(currentDetail.socios);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-ocorrencia')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.ocorrencias.unshift(ocorrenciaVazia());
    renderOcorrencias(currentDetail.ocorrencias);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-escolher-anexo')?.addEventListener('click', () => $('input-anexo')?.click());
  $('input-anexo')?.addEventListener('change', uploadAnexo);

  $('lista-anexos')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-remove-anexo]');
    if (!btn) return;

    const id = Number(btn.dataset.removeAnexo);
    if (!id) return;

    await excluirAnexo(id);
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');

    if (!btn || !currentDetail) return;

    const index = Number(btn.dataset.index);

    if (Number.isNaN(index)) return;

    const map = {
      endereco: 'enderecos',
      refcom: 'referencias_comerciais',
      refbanc: 'referencias_bancarias',
      socio: 'socios',
      ocorrencia: 'ocorrencias',
    };

    const key = map[btn.dataset.remove];

    if (!key || !Array.isArray(currentDetail[key])) return;

    currentDetail[key].splice(index, 1);
    markClienteModalDirty();

    if (key === 'enderecos') {
      renderEnderecos(currentDetail.enderecos);
      agendarResumoSidebarCliente(currentDetail);
    }

    if (key === 'referencias_comerciais') {
      renderRefsComerciais(currentDetail.referencias_comerciais);
      agendarResumoSidebarCliente(currentDetail);
    }

    if (key === 'referencias_bancarias') {
      renderRefsBancarias(currentDetail.referencias_bancarias);
      agendarResumoSidebarCliente(currentDetail);
    }

    if (key === 'socios') {
      renderSocios(currentDetail.socios);
      agendarResumoSidebarCliente(currentDetail);
    }

    if (key === 'ocorrencias') {
      renderOcorrencias(currentDetail.ocorrencias);
      agendarResumoSidebarCliente(currentDetail);
    }
  });
}

export async function openClientModalNew() {
  setClienteModalReadonly(false);
  clienteModalListPosition = null;
  clienteModalListPositionOverride = null;
  clienteModalListTotal = 0;
  state.clienteEditandoId = null;
  syncZapsChatButton(null);
  closeClienteActionsMenu();
  syncClienteBudgetActions();

  $('modal-cliente-titulo').textContent = 'Novo cliente';
  $('formCliente')?.reset();

  const proximoCodigo = await obterProximoCodigoClienteServidor();
  await fillClientForm({ codigo: proximoCodigo });

  openModal('modal-cliente-backdrop');
  setClienteModalReadonly(false);
  await syncAgendaCliente(null, false);
  setClienteModalDirty(false);

  bindResumoSidebarCliente();
  agendarResumoSidebarCliente(currentDetail);
}

export async function openClientModalEdit(id) {
  setClienteModalReadonly(false);
  try {
    const [cliente] = await Promise.all([
      obterClienteNoServidor(id),
      carregarFormularioClientes().catch(() => null),
    ]);

    state.clienteEditandoId = cliente.id;
    prepareClienteListPosition(cliente.id);
    syncClienteBudgetActions();
    $('modal-cliente-titulo').textContent = 'Editar cliente';

    await fillClientForm(cliente);

    openModal('modal-cliente-backdrop');
    setClienteModalReadonly(false);
    await syncAgendaCliente(cliente, false);
    setClienteModalDirty(false);

    bindResumoSidebarCliente();
    agendarResumoSidebarCliente(cliente);
  } catch (err) {
    toast(err.message || 'Erro ao carregar cliente.', 'error');
  }
}



export async function openClientModalView(id) {
  try {
    const [cliente] = await Promise.all([
      obterClienteNoServidor(id),
      carregarFormularioClientes().catch(() => null),
    ]);

    state.clienteEditandoId = cliente.id;
    prepareClienteListPosition(cliente.id);
    syncClienteBudgetActions();
    $('modal-cliente-titulo').textContent = 'Visualizar cliente';

    await fillClientForm(cliente);

    openModal('modal-cliente-backdrop');
    setClienteModalReadonly(true);
    await syncAgendaCliente(cliente, true);
    setClienteModalDirty(false);

    bindResumoSidebarCliente();
    agendarResumoSidebarCliente(cliente);
  } catch (err) {
    toast(err.message || 'Erro ao carregar cliente.', 'error');
  }
}

export function closeClientModal() {
  setClienteModalReadonly(false);
  setClienteModalDirty(false);
  closeClienteActionsMenu();
  closeModal('modal-cliente-backdrop');
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

  const tab = el.closest('.cliente-tab');

  if (tab?.id) {
    switchTab(tab.id);
  }

  const sectionCard = el.closest('.custom-section-card');

  if (sectionCard) {
    const cards = Array.from(
      document.querySelectorAll('#custom-fields-container .custom-section-card')
    );

    const index = cards.indexOf(sectionCard);

    if (index >= 0) {
      const controller = ensureFichaClienteController();

      if (controller?.activateSection) {
        controller.activateSection(index);
      } else {
        ativarSecaoFormulario(index);
      }
    }
  }
}

function getModalScrollContainer(el) {
  return (
    el?.closest('.cliente-modal-scroll') ||
    document.querySelector('#modal-cliente-backdrop .cliente-modal-scroll') ||
    document.querySelector('#modal-cliente-backdrop .cliente-modal-main') ||
    document.querySelector('#modal-cliente-backdrop .cliente-modal-content')
  );
}

function scrollCampoDentroDoModal(el) {
  if (!el) return;

  const scrollEl = getModalScrollContainer(el);

  if (!scrollEl) return;

  const elRect = el.getBoundingClientRect();
  const scrollRect = scrollEl.getBoundingClientRect();

  const targetTop =
    scrollEl.scrollTop +
    (elRect.top - scrollRect.top) -
    120;

  scrollEl.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth',
  });
}

function focarCampoObrigatorio(el) {
  if (!el) return;

  abrirAbaDoCampo(el);

  setTimeout(() => {
    const grupo = el.closest(
      '.form-group, .custom-field-item, .custom-checkbox, .mini-item'
    );

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
    }, 260);
  }, 180);
}

function encontrarPrimeiroCampoObrigatorioVazio() {
  const domRequired = Array.from(
    document.querySelectorAll('[data-custom-field][data-required="true"]')
  );

  for (const el of domRequired) {
    if (isCampoVazio(el)) {
      return el;
    }
  }

  const campos = Array.isArray(state.camposClientes) ? state.camposClientes : [];

  for (const campo of campos) {
    if (campo?.ativo === false || !campo?.obrigatorio) continue;

    const slug = String(campo.slug || '').trim();
    if (!slug) continue;

    const safeSlug =
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(slug)
        : slug.replace(/"/g, '\\"');

    const el = document.querySelector(`[data-custom-field="${safeSlug}"]`);

    if (el && isCampoVazio(el)) {
      return el;
    }
  }

  return null;
}

function encontrarCampoNomeObrigatorio() {
  return (
    $('campo-nome') ||
    document.querySelector('[data-custom-field="nome"]') ||
    document.querySelector('[data-custom-field="nome_razao_social"]') ||
    document.querySelector('[data-custom-field="razao_social"]') ||
    document.querySelector('[data-custom-field="cliente"]')
  );
}

function getDuplicateConflict(error) {
  const detail = error?.detail;
  if (Number(error?.status) !== 409 || !detail || typeof detail !== 'object') return null;
  if (detail.code !== 'cliente_duplicado') return null;
  return detail;
}

async function salvarClienteComConfirmacaoDeDuplicidade(payload) {
  try {
    return await salvarClienteNoServidor(payload, state.clienteEditandoId);
  } catch (error) {
    const conflict = getDuplicateConflict(error);
    if (!conflict) throw error;

    const message = String(
      conflict.message ||
      error.message ||
      'Já existe outro cliente com os mesmos dados.'
    );

    // CPF/CNPJ e demais identificadores bloqueantes nunca podem ser duplicados.
    if (conflict.blocking) {
      const blockedError = new Error(message);
      blockedError.status = error.status;
      blockedError.detail = conflict;
      throw blockedError;
    }

    const confirmed = await confirmDialog({
      title: 'Possível cliente duplicado',
      message: `${message} Deseja salvar este cadastro mesmo assim?`,
      confirmText: 'Salvar mesmo assim',
      cancelText: 'Revisar dados',
    });

    if (!confirmed) {
      const cancelledError = new Error('Salvamento cancelado para revisão dos dados.');
      cancelledError.code = 'duplicate_cancelled';
      throw cancelledError;
    }

    return salvarClienteNoServidor(
      { ...payload, permitir_duplicado: true },
      state.clienteEditandoId
    );
  }
}

export async function saveCliente(e) {
  if (e?.preventDefault) {
    e.preventDefault();
  }

  if (clienteModalSomenteLeitura) {
    toast('Este cliente está aberto apenas para visualização.', 'error');
    return;
  }

  limparCamposObrigatoriosPendentes();

  const payload = buildPayload();

  const requiredCheck = validateRequiredCustomFields(state.camposClientes, payload.custom_fields);

  if (!requiredCheck.ok) {
    const campo = encontrarPrimeiroCampoObrigatorioVazio();

    if (campo) {
      focarCampoObrigatorio(campo);
    }

    toast(requiredCheck.message, 'error');
    return;
  }

  if (!payload.nome) {
    const campoNome = encontrarCampoNomeObrigatorio();

    if (campoNome) {
      focarCampoObrigatorio(campoNome);
    }

    toast('Preencha o nome do cliente.', 'error');
    return;
  }

  // Código é único, fixo e pertence ao sistema.
  // Na criação, o backend gera e decide o código real.
  // Na edição, mantemos o código que veio do banco, mesmo que alguém altere o DOM.
  if (!state.clienteEditandoId) {
    delete payload.codigo;
  } else {
    payload.codigo = onlyDigits(currentDetail?.codigo || payload.codigo);
  }

  const btn = $('btn-salvar-cliente');
  const original = btn?.innerHTML || 'Salvar cliente';
  let clienteFoiSalvo = false;
  let agendaDraft = null;
  let agendaFoiSalva = false;

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validando...';
    }

    // Valida o rascunho da Agenda ANTES de gravar o cliente. Assim um
    // agendamento incompleto nunca é descartado quando o modal é fechado.
    try {
      agendaDraft = prepararAgendaPendenteCliente();
    } catch (agendaError) {
      abrirAgendaClienteParaCorrecao();
      throw agendaError;
    }

    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando cliente...';
    }

    const clienteSalvo = await salvarClienteComConfirmacaoDeDuplicidade(payload);
    clienteFoiSalvo = true;
    await _afterSave();

    if (agendaDraft) {
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando agenda...';
      }

      const clienteId = Number(clienteSalvo?.id || state.clienteEditandoId || currentDetail?.id || 0);
      try {
        agendaFoiSalva = await salvarAgendaPendenteCliente(agendaDraft, clienteId);
      } catch (agendaError) {
        abrirAgendaClienteParaCorrecao();
        const wrapped = new Error(
          `O cliente foi salvo, mas a Agenda não foi gravada: ${agendaError.message} Os dados da Agenda continuam preenchidos.`
        );
        wrapped.code = 'agenda_save_failed_after_client';
        throw wrapped;
      }
    }

    setClienteModalDirty(false);
    closeClientModal();

    toast(
      agendaFoiSalva
        ? 'Cliente e informações da Agenda salvos com sucesso.'
        : 'Cliente salvo com sucesso.',
      'success'
    );
  } catch (err) {
    if (err?.code !== 'duplicate_cancelled') {
      toast(err.message || 'Erro ao salvar cliente.', 'error');
    }

    // Se o cliente já foi persistido, mantemos o modal aberto quando a Agenda
    // falha para que o usuário possa corrigir/tentar novamente sem perder texto.
    if (clienteFoiSalvo && err?.code === 'agenda_save_failed_after_client') {
      abrirAgendaClienteParaCorrecao();
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}
