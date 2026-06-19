import { state } from './state.js';
import { obterClienteNoServidor, salvarClienteNoServidor, apiJson } from './api.js';
import { $, $$, escapeHtml, toast, openModal, closeModal } from './utils.js';
import {
  renderCustomFieldsInputs,
  normalizeCustomFieldsPayload,
  validateRequiredCustomFields,
} from './custom-fields.js';

let _afterSave = async () => {};
let _bound = false;
let currentDetail = null;
let originalClienteTabsHtml = '';
let fichaClienteController = null;

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

function switchTab(targetId) {
  if (state.usarFichaPrincipalClientes) {
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
  const value = onlyDigits(codigo) || generateNextClientCode();

  setValue('campo-codigo', value);
  setValue('campo-codigo-ficha-principal', value);

  atualizarResumoSidebarCliente(currentDetail || { codigo: value });
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

function getCustomValue(custom, keys, fallback = '') {
  for (const key of keys) {
    const value = custom?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return fallback;
}

function buildBaseFromFichaPrincipal(customFields, fallback = {}) {
  const custom = customFields || {};

  const tipoCliente = getCustomValue(custom, ['tipo_cliente'], fallback.tipo_pessoa || 'PF');

  const tipoPessoa =
    String(tipoCliente).toLowerCase().includes('jur') ||
    String(tipoCliente).toLowerCase() === 'pj'
      ? 'PJ'
      : 'PF';

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
      generateNextClientCode(),

    tipo_pessoa: tipoPessoa,
    situacao: fallback.situacao || 'ativo',

    nome,
    nome_fantasia: getCustomValue(custom, ['nome_fantasia'], fallback.nome_fantasia || ''),
    cpf_cnpj: getCustomValue(custom, ['cpf_cnpj', 'cnpj', 'cpf'], fallback.cpf_cnpj || ''),
    rg_ie: getCustomValue(custom, ['rg', 'inscricao_estadual'], fallback.rg_ie || ''),
    inscricao_municipal: getCustomValue(custom, ['inscricao_municipal'], fallback.inscricao_municipal || ''),
    suframa: getCustomValue(custom, ['suframa'], fallback.suframa || ''),

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

    site: getCustomValue(custom, ['home_page', 'site'], fallback.site || ''),

    cep: getCustomValue(custom, ['cep'], fallback.cep || ''),
    endereco: getCustomValue(custom, ['endereco', 'logradouro'], fallback.endereco || ''),
    numero: getCustomValue(custom, ['numero'], fallback.numero || ''),
    complemento: getCustomValue(custom, ['complemento'], fallback.complemento || ''),
    bairro: getCustomValue(custom, ['bairro'], fallback.bairro || ''),
    cidade: getCustomValue(custom, ['cidade'], fallback.cidade || ''),
    estado: getCustomValue(custom, ['uf', 'estado'], fallback.estado || ''),
    pais: getCustomValue(custom, ['pais'], fallback.pais || 'Brasil'),

    regiao: getCustomValue(custom, ['regiao'], fallback.regiao || ''),
    segmento: getCustomValue(custom, ['tipo_de_imovel', 'tipo_imovel', 'segmento'], fallback.segmento || ''),
    classificacao: getCustomValue(custom, ['classificacao', 'tipo_cliente'], fallback.classificacao || ''),

    observacoes: getCustomValue(custom, ['observacoes', 'observacao'], fallback.observacoes || ''),
  };
}

async function fillClientForm(cliente = {}) {
  const data = { ...defaultCliente(), ...(cliente || {}) };
  currentDetail = data;

  syncFichaPrincipalCode(data.codigo || generateNextClientCode());

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

  await renderCustomFieldsInputs(state.camposClientes, data.custom_fields || {});

  syncFichaPrincipalCode(data.codigo || getValue('campo-codigo') || generateNextClientCode());
  setFichaPrincipalMode(state.usarFichaPrincipalClientes);

  renderEnderecos(data.enderecos || []);
  renderRefsComerciais(data.referencias_comerciais || []);
  renderRefsBancarias(data.referencias_bancarias || []);
  renderSocios(data.socios || []);
  renderOcorrencias(data.ocorrencias || []);
  renderAnexos(data.anexos || []);
  renderHistorico(data.historico || {});

  switchTab(state.usarFichaPrincipalClientes ? 'tab-campos-personalizados' : 'tab-cadastro');

  bindResumoSidebarCliente();
  agendarResumoSidebarCliente(data);
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
  const customFields = normalizeCustomFieldsPayload();

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
    Object.assign(payload, buildBaseFromFichaPrincipal(customFields, payload));
  }

  if (!payload.codigo) {
    payload.codigo = generateNextClientCode();
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

function renderHistorico(data = {}) {
  const resumo = $('historico-resumo');
  const propostas = $('historico-propostas');
  const ocorrencias = $('historico-ocorrencias');

  const resumoData = data.resumo || {};
  const ultimasPropostas = Array.isArray(data.ultimas_propostas) ? data.ultimas_propostas : [];
  const ultimasOcorrencias = Array.isArray(data.ultimas_ocorrencias) ? data.ultimas_ocorrencias : [];

  if (resumo) {
    resumo.innerHTML = `
      <div class="history-item">
        <strong>Total de propostas:</strong> ${escapeHtml(resumoData.total_propostas ?? 0)}
      </div>

      <div class="history-item">
        <strong>Propostas aprovadas:</strong> ${escapeHtml(resumoData.propostas_aprovadas ?? 0)}
      </div>
    `;
  }

  if (propostas) {
    propostas.innerHTML = ultimasPropostas.length
      ? ultimasPropostas
          .map(
            (item) => `
              <div class="history-item">
                <strong>${escapeHtml(item.codigo || 'Sem código')}</strong>
                <div class="subtle">${escapeHtml(item.titulo || '')}</div>
                <div class="subtle">
                  Status: ${escapeHtml(item.status || '-')} • Total: ${escapeHtml(item.total || '-')}
                </div>
              </div>
            `
          )
          .join('')
      : `<div class="empty-soft">Nenhuma proposta encontrada para este cliente.</div>`;
  }

  if (ocorrencias) {
    ocorrencias.innerHTML = ultimasOcorrencias.length
      ? ultimasOcorrencias
          .map(
            (item) => `
              <div class="history-item">
                <strong>${escapeHtml(item.tipo || 'Ocorrência')}</strong>
                <div class="subtle">${escapeHtml(item.data_movimento || '')}</div>
                <div>${escapeHtml(item.descricao || '')}</div>
              </div>
            `
          )
          .join('')
      : `<div class="empty-soft">Nenhuma ocorrência registrada.</div>`;
  }
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
      await renderCustomFieldsInputs(state.camposClientes, currentDetail?.custom_fields || {});
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

    await renderCustomFieldsInputs(state.camposClientes, currentDetail?.custom_fields || {});
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

  $('btn-fechar-modal-cliente')?.addEventListener('click', closeClientModal);
  $('btn-cancelar-cliente')?.addEventListener('click', closeClientModal);
  $('btn-salvar-cliente')?.addEventListener('click', saveCliente);
  $('toggle-ficha-principal-cliente')?.addEventListener('change', salvarToggleFichaPrincipalCliente);
  bindResumoSidebarCliente();

  $('modal-cliente-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('modal-cliente-backdrop')) {
      closeClientModal();
    }
  });

  $('btn-add-endereco')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.enderecos.push(enderecoVazio());
    renderEnderecos(currentDetail.enderecos);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-ref-comercial')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_comerciais.push(refComercialVazia());
    renderRefsComerciais(currentDetail.referencias_comerciais);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-ref-bancaria')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_bancarias.push(refBancariaVazia());
    renderRefsBancarias(currentDetail.referencias_bancarias);
    agendarResumoSidebarCliente(currentDetail);
  });

  $('btn-add-socio')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.socios.push(socioVazio());
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
  state.clienteEditandoId = null;

  $('modal-cliente-titulo').textContent = 'Novo cliente';
  $('formCliente')?.reset();

  await fillClientForm({ codigo: generateNextClientCode() });

  openModal('modal-cliente-backdrop');

  bindResumoSidebarCliente();
  agendarResumoSidebarCliente(currentDetail);
}

export async function openClientModalEdit(id) {
  try {
    const cliente = await obterClienteNoServidor(id);

    state.clienteEditandoId = cliente.id;
    $('modal-cliente-titulo').textContent = 'Editar cliente';

    await fillClientForm(cliente);

    openModal('modal-cliente-backdrop');

    bindResumoSidebarCliente();
    agendarResumoSidebarCliente(cliente);
  } catch (err) {
    toast(err.message || 'Erro ao carregar cliente.', 'error');
  }
}

export function closeClientModal() {
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

export async function saveCliente(e) {
  if (e?.preventDefault) {
    e.preventDefault();
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

  if (!payload.codigo) {
    payload.codigo = generateNextClientCode();
  }

  payload.codigo = onlyDigits(payload.codigo);

  const btn = $('btn-salvar-cliente');
  const original = btn?.innerHTML || 'Salvar cliente';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await salvarClienteNoServidor(payload, state.clienteEditandoId);
    await _afterSave();

    closeClientModal();

    toast('Cliente salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar cliente.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}
