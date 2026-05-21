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

function generateNextClientCode() {
  const proximoId =
    state.clientes.length > 0
      ? Math.max(...state.clientes.map((c) => Number(c.id) || 0)) + 1
      : 1;

  return `CLI-${String(proximoId).padStart(4, '0')}`;
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
  $$('.cliente-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === targetId);
  });

  $$('.cliente-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === targetId);
  });
}

function fillClientForm(cliente = {}) {
  const data = { ...defaultCliente(), ...(cliente || {}) };
  currentDetail = data;

  setValue('campo-codigo', data.codigo || generateNextClientCode());
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

  renderCustomFieldsInputs(state.camposClientes, data.custom_fields || {});
  renderEnderecos(data.enderecos || []);
  renderRefsComerciais(data.referencias_comerciais || []);
  renderRefsBancarias(data.referencias_bancarias || []);
  renderSocios(data.socios || []);
  renderOcorrencias(data.ocorrencias || []);
  renderAnexos(data.anexos || []);
  renderHistorico(data.historico || {});

  switchTab('tab-cadastro');
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
  return {
    codigo: String(getValue('campo-codigo') || '').trim(),
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
    custom_fields: normalizeCustomFieldsPayload(),
  };
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
            <button type="button" class="btn btn-secondary btn-sm" data-remove="endereco" data-index="${idx}">Remover</button>
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
            <div class="form-group"><label>Empresa</label><input type="text" data-key="empresa_nome" value="${escapeHtml(item.empresa_nome || '')}" /></div>
            <div class="form-group"><label>Telefone</label><input type="text" data-key="telefone" value="${escapeHtml(item.telefone || '')}" /></div>
            <div class="form-group"><label>Data última compra</label><input type="date" data-key="data_ultima_compra" value="${escapeHtml(item.data_ultima_compra || '')}" /></div>
            <div class="form-group"><label>Valor última compra</label><input type="text" data-key="valor_ultima_compra" value="${escapeHtml(item.valor_ultima_compra || '')}" /></div>
            <div class="form-group"><label>Valor prestação</label><input type="text" data-key="valor_prestacao" value="${escapeHtml(item.valor_prestacao || '')}" /></div>
            <div class="form-group"><label>Venc. última parcela</label><input type="date" data-key="vencimento_ultima_parcela" value="${escapeHtml(item.vencimento_ultima_parcela || '')}" /></div>
            <div class="form-group" style="grid-column: span 2;"><label>Observações</label><input type="text" data-key="observacoes" value="${escapeHtml(item.observacoes || '')}" /></div>
          </div>
          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="refcom" data-index="${idx}">Remover</button>
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
            <div class="form-group"><label>Banco</label><input type="text" data-key="banco" value="${escapeHtml(item.banco || '')}" /></div>
            <div class="form-group"><label>Agência</label><input type="text" data-key="agencia" value="${escapeHtml(item.agencia || '')}" /></div>
            <div class="form-group"><label>Conta Corrente</label><input type="text" data-key="conta_corrente" value="${escapeHtml(item.conta_corrente || '')}" /></div>
            <div class="form-group"><label>Gerente</label><input type="text" data-key="gerente" value="${escapeHtml(item.gerente || '')}" /></div>
            <div class="form-group"><label>Telefone agência</label><input type="text" data-key="telefone_agencia" value="${escapeHtml(item.telefone_agencia || '')}" /></div>
            <div class="form-group"><label>Limite</label><input type="text" data-key="limite_credito" value="${escapeHtml(item.limite_credito || '')}" /></div>
            <div class="form-group"><label>Status</label><input type="text" data-key="status" value="${escapeHtml(item.status || '')}" /></div>
            <div class="form-group"><label>Observações</label><input type="text" data-key="observacoes" value="${escapeHtml(item.observacoes || '')}" /></div>
          </div>
          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="refbanc" data-index="${idx}">Remover</button>
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
            <div class="form-group"><label>Nome</label><input type="text" data-key="nome" value="${escapeHtml(item.nome || '')}" /></div>
            <div class="form-group"><label>CPF</label><input type="text" data-key="cpf" value="${escapeHtml(item.cpf || '')}" /></div>
            <div class="form-group"><label>RG</label><input type="text" data-key="rg" value="${escapeHtml(item.rg || '')}" /></div>
            <div class="form-group"><label>Nascimento</label><input type="date" data-key="data_nascimento" value="${escapeHtml(item.data_nascimento || '')}" /></div>
            <div class="form-group"><label>Telefone</label><input type="text" data-key="telefone" value="${escapeHtml(item.telefone || '')}" /></div>
            <div class="form-group"><label>Cargo</label><input type="text" data-key="cargo" value="${escapeHtml(item.cargo || '')}" /></div>
            <div class="form-group"><label>% Participação</label><input type="text" data-key="participacao_percentual" value="${escapeHtml(item.participacao_percentual || '')}" /></div>
          </div>
          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="socio" data-index="${idx}">Remover</button>
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
            <div class="form-group"><label>Data</label><input type="datetime-local" data-key="data_movimento" value="${escapeHtml(String(item.data_movimento || '').slice(0, 16))}" /></div>
            <div class="form-group"><label>Tipo</label><input type="text" data-key="tipo" value="${escapeHtml(item.tipo || '')}" /></div>
            <div class="form-group"><label>Status</label><input type="text" data-key="status" value="${escapeHtml(item.status || '')}" /></div>
            <div class="form-group" style="grid-column: span 4;">
              <label>Descrição</label>
              <textarea rows="3" data-key="descricao">${escapeHtml(item.descricao || '')}</textarea>
            </div>
          </div>
          <div class="mini-item-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-remove="ocorrencia" data-index="${idx}">Remover</button>
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
            <span class="subtle">${escapeHtml(item.tipo_documento || '')}${item.descricao ? ` • ${escapeHtml(item.descricao)}` : ''}</span>
            <span class="subtle">${escapeHtml(item.usuario_nome || '')}</span>
          </div>
          <div style="display:flex; gap:8px;">
            <a class="btn btn-secondary btn-sm" href="${escapeHtml(item.arquivo_path || '#')}" target="_blank" rel="noopener noreferrer">Abrir</a>
            <button type="button" class="btn btn-secondary btn-sm" data-remove-anexo="${item.id}">Excluir</button>
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
      <div class="history-item"><strong>Total de propostas:</strong> ${escapeHtml(resumoData.total_propostas ?? 0)}</div>
      <div class="history-item"><strong>Propostas aprovadas:</strong> ${escapeHtml(resumoData.propostas_aprovadas ?? 0)}</div>
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
                <div class="subtle">Status: ${escapeHtml(item.status || '-')} • Total: ${escapeHtml(item.total || '-')}</div>
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
    if (!resp.ok) throw new Error(text || 'Erro ao enviar anexo.');

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
  if (!resp.ok) throw new Error(text || 'Erro na requisição.');
  return text ? JSON.parse(text) : null;
}

export function bindClientModal({ afterSave } = {}) {
  _afterSave = typeof afterSave === 'function' ? afterSave : async () => {};

  if (_bound) return;
  _bound = true;

  $$('.cliente-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $('btn-fechar-modal-cliente')?.addEventListener('click', closeClientModal);
  $('btn-cancelar-cliente')?.addEventListener('click', closeClientModal);
  $('btn-salvar-cliente')?.addEventListener('click', saveCliente);

  $('modal-cliente-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('modal-cliente-backdrop')) {
      closeClientModal();
    }
  });

  $('btn-add-endereco')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.enderecos.push(enderecoVazio());
    renderEnderecos(currentDetail.enderecos);
  });

  $('btn-add-ref-comercial')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_comerciais.push(refComercialVazia());
    renderRefsComerciais(currentDetail.referencias_comerciais);
  });

  $('btn-add-ref-bancaria')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.referencias_bancarias.push(refBancariaVazia());
    renderRefsBancarias(currentDetail.referencias_bancarias);
  });

  $('btn-add-socio')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.socios.push(socioVazio());
    renderSocios(currentDetail.socios);
  });

  $('btn-add-ocorrencia')?.addEventListener('click', () => {
    currentDetail ??= defaultCliente();
    currentDetail.ocorrencias.unshift(ocorrenciaVazia());
    renderOcorrencias(currentDetail.ocorrencias);
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

    if (key === 'enderecos') renderEnderecos(currentDetail.enderecos);
    if (key === 'referencias_comerciais') renderRefsComerciais(currentDetail.referencias_comerciais);
    if (key === 'referencias_bancarias') renderRefsBancarias(currentDetail.referencias_bancarias);
    if (key === 'socios') renderSocios(currentDetail.socios);
    if (key === 'ocorrencias') renderOcorrencias(currentDetail.ocorrencias);
  });
}

export function openClientModalNew() {
  state.clienteEditandoId = null;
  $('modal-cliente-titulo').textContent = 'Novo cliente';
  $('formCliente')?.reset();
  fillClientForm({ codigo: generateNextClientCode() });
  openModal('modal-cliente-backdrop');
}

export async function openClientModalEdit(id) {
  try {
    const cliente = await obterClienteNoServidor(id);
    state.clienteEditandoId = cliente.id;
    $('modal-cliente-titulo').textContent = 'Editar cliente';
    fillClientForm(cliente);
    openModal('modal-cliente-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar cliente.', 'error');
  }
}

export function closeClientModal() {
  closeModal('modal-cliente-backdrop');
}

export async function saveCliente(e) {
  if (e?.preventDefault) e.preventDefault();

  const nome = String(getValue('campo-nome') || '').trim();
  if (!nome) {
    toast('Preencha o nome do cliente.', 'error');
    return;
  }

  const payload = buildPayload();
  const requiredCheck = validateRequiredCustomFields(state.camposClientes, payload.custom_fields);

  if (!requiredCheck.ok) {
    toast(requiredCheck.message, 'error');
    return;
  }

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