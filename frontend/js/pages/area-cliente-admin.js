const API_CLIENTES = '/api/clientes';
const API_AREA_ADMIN = '/api/area-cliente-admin/clientes';

const state = {
  clientes: [],
  filtrados: [],
  clienteSelecionado: null,
  dadosAtual: null,
  carregando: false,
  salvando: false,
};

const FIELD_NAMES = [
  'tipo_pessoa',
  'status_preenchimento',
  'origem_solicitacao',
  'nome_completo',
  'cpf',
  'rg',
  'nacionalidade',
  'profissao',
  'estado_civil',
  'data_nascimento',
  'email_pessoal',
  'telefone_pessoal',
  'representante_nome',
  'representante_cpf',
  'representante_rg',
  'representante_nacionalidade',
  'representante_profissao',
  'representante_estado_civil',
  'representante_data_nascimento',
  'representante_email_pessoal',
  'representante_telefone_pessoal',
  'razao_social',
  'cnpj',
  'email_empresa',
  'telefone_whatsapp_empresa',
  'imovel_cep',
  'imovel_rua',
  'imovel_numero',
  'imovel_complemento',
  'imovel_bairro',
  'imovel_cidade',
  'imovel_uf',
  'contato_principal_nome',
  'contato_principal_telefone',
  'contato_principal_whatsapp',
  'contato_principal_email',
  'contato_principal_observacao',
  'observacoes_contrato',
  'motivo_alteracao',
];

const FIELD_LABELS = {
  tipo_pessoa: 'Tipo de pessoa',
  status_preenchimento: 'Status do preenchimento',
  origem_solicitacao: 'Canal da solicitação',
  nome_completo: 'Nome completo',
  cpf: 'CPF',
  rg: 'RG',
  nacionalidade: 'Nacionalidade',
  profissao: 'Profissão',
  estado_civil: 'Estado civil',
  data_nascimento: 'Data de nascimento',
  email_pessoal: 'E-mail pessoal',
  telefone_pessoal: 'Telefone pessoal',
  representante_nome: 'Representante',
  representante_cpf: 'CPF do representante',
  representante_rg: 'RG do representante',
  representante_nacionalidade: 'Nacionalidade do representante',
  representante_profissao: 'Profissão do representante',
  representante_estado_civil: 'Estado civil do representante',
  representante_data_nascimento: 'Nascimento do representante',
  representante_email_pessoal: 'E-mail do representante',
  representante_telefone_pessoal: 'Telefone do representante',
  razao_social: 'Razão social',
  cnpj: 'CNPJ',
  email_empresa: 'E-mail da empresa',
  telefone_whatsapp_empresa: 'WhatsApp da empresa',
  imovel_cep: 'CEP do imóvel',
  imovel_rua: 'Rua do imóvel',
  imovel_numero: 'Número do imóvel',
  imovel_complemento: 'Complemento do imóvel',
  imovel_bairro: 'Bairro do imóvel',
  imovel_cidade: 'Cidade do imóvel',
  imovel_uf: 'UF do imóvel',
  contato_principal_nome: 'Contato principal',
  contato_principal_telefone: 'Telefone do contato',
  contato_principal_whatsapp: 'WhatsApp do contato',
  contato_principal_email: 'E-mail do contato',
  contato_principal_observacao: 'Observação do contato',
  observacoes_contrato: 'Observações para contrato',
};

const dom = {};

function byId(id) {
  return document.getElementById(id);
}

function initDom() {
  dom.buscaCliente = byId('busca-cliente');
  dom.clientesLista = byId('clientes-lista');
  dom.clientesStatus = byId('clientes-status');
  dom.btnRecarregarClientes = byId('btn-recarregar-clientes');
  dom.btnSalvarTopo = byId('btn-salvar-topo');

  dom.clienteVazio = byId('cliente-vazio');
  dom.clienteConteudo = byId('cliente-conteudo');
  dom.clienteNome = byId('cliente-nome');
  dom.clienteResumo = byId('cliente-resumo');
  dom.badgeTipoPessoa = byId('badge-tipo-pessoa');
  dom.badgeStatus = byId('badge-status');
  dom.registroMeta = byId('registro-meta');

  dom.form = byId('form-dados-area-cliente');
  dom.sectionPf = byId('section-pf');
  dom.sectionPj = byId('section-pj');
  dom.tipoPessoa = byId('tipo_pessoa');
  dom.btnRecarregarDados = byId('btn-recarregar-dados');
  dom.btnSalvarDados = byId('btn-salvar-dados');

  dom.historicoCard = byId('historico-card');
  dom.historicoLista = byId('historico-lista');
  dom.btnRecarregarHistorico = byId('btn-recarregar-historico');
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const data = isJson ? await response.json().catch(() => null) : await response.text().catch(() => '');

  if (!response.ok) {
    const detail = data && typeof data === 'object' ? data.detail : data;
    const message = typeof detail === 'string' ? detail : `Erro HTTP ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

function toast(message, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }

  alert(message);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function getClienteNome(cliente) {
  return firstFilled(cliente.nome, cliente.razao_social, cliente.nome_fantasia, cliente.pessoa_contato, `Cliente #${cliente.id}`);
}

function getClienteDocumento(cliente) {
  return firstFilled(cliente.cpf_cnpj, cliente.cpf, cliente.cnpj, cliente.documento);
}

function getClienteTelefone(cliente) {
  return firstFilled(cliente.telefone, cliente.whatsapp, cliente.celular);
}

function getClienteEmail(cliente) {
  return firstFilled(cliente.email, cliente.email_pessoal, cliente.email_empresa);
}

function getClienteTipo(cliente) {
  return firstFilled(cliente.tipo_pessoa, cliente.tipo, 'PF').toUpperCase() === 'PJ' ? 'PJ' : 'PF';
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function setLoading(isLoading) {
  state.carregando = isLoading;
  dom.btnRecarregarClientes.disabled = isLoading;
  if (dom.buscaCliente) dom.buscaCliente.disabled = isLoading;
}

function setSaving(isSaving) {
  state.salvando = isSaving;
  if (dom.btnSalvarDados) dom.btnSalvarDados.disabled = isSaving || !state.clienteSelecionado;
  if (dom.btnSalvarTopo) dom.btnSalvarTopo.disabled = isSaving || !state.clienteSelecionado;
  if (dom.btnRecarregarDados) dom.btnRecarregarDados.disabled = isSaving || !state.clienteSelecionado;
}

function extractClientes(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.clientes)) return data.clientes;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function carregarClientes() {
  setLoading(true);
  dom.clientesStatus.textContent = 'Carregando clientes...';
  dom.clientesLista.innerHTML = '';

  try {
    const data = await apiJson(API_CLIENTES);
    state.clientes = extractClientes(data);
    filtrarClientes();

    if (!state.clientes.length) {
      dom.clientesStatus.textContent = 'Nenhum cliente encontrado.';
    } else {
      dom.clientesStatus.textContent = `${state.clientes.length} cliente(s) encontrado(s).`;
    }
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar clientes:', error);
    state.clientes = [];
    state.filtrados = [];
    renderClientes();
    dom.clientesStatus.textContent = 'Erro ao carregar clientes.';
    toast(error.message || 'Erro ao carregar clientes.', 'error');
  } finally {
    setLoading(false);
  }
}

function filtrarClientes() {
  const q = normalizeText(dom.buscaCliente?.value || '');

  state.filtrados = state.clientes.filter((cliente) => {
    if (!q) return true;

    const haystack = normalizeText([
      cliente.id,
      getClienteNome(cliente),
      getClienteDocumento(cliente),
      getClienteTelefone(cliente),
      getClienteEmail(cliente),
      cliente.cidade,
      cliente.estado,
    ].join(' '));

    return haystack.includes(q);
  });

  renderClientes();
}

function renderClientes() {
  const selecionadoId = state.clienteSelecionado ? Number(state.clienteSelecionado.id) : null;

  if (!state.filtrados.length) {
    dom.clientesLista.innerHTML = '<div class="history-empty">Nenhum cliente para exibir.</div>';
    return;
  }

  dom.clientesLista.innerHTML = state.filtrados.map((cliente) => {
    const id = Number(cliente.id);
    const nome = getClienteNome(cliente);
    const doc = getClienteDocumento(cliente) || 'Sem documento';
    const tel = getClienteTelefone(cliente) || 'Sem telefone';
    const email = getClienteEmail(cliente) || 'Sem e-mail';
    const active = selecionadoId === id ? ' active' : '';

    return `
      <button class="cliente-item${active}" type="button" data-cliente-id="${id}">
        <span class="cliente-item-top">
          <span class="cliente-item-name">${escapeHtml(nome)}</span>
          <span class="cliente-item-id">#${id}</span>
        </span>
        <span class="cliente-item-meta">
          <span>${escapeHtml(doc)}</span>
          <span>${escapeHtml(tel)}</span>
          <span>${escapeHtml(email)}</span>
        </span>
      </button>
    `;
  }).join('');
}

function enableClienteArea(cliente, dados) {
  dom.clienteVazio.hidden = true;
  dom.clienteConteudo.hidden = false;
  dom.form.hidden = false;
  dom.historicoCard.hidden = false;

  dom.clienteNome.textContent = getClienteNome(cliente);
  dom.clienteResumo.textContent = `Cliente #${cliente.id} • ${getClienteEmail(cliente) || 'sem e-mail'} • ${getClienteTelefone(cliente) || 'sem telefone'}`;
  dom.badgeTipoPessoa.textContent = dados?.tipo_pessoa || getClienteTipo(cliente);
  dom.badgeStatus.textContent = dados?.status_preenchimento || 'rascunho';

  const meta = dados?.id
    ? `Registro #${dados.id} • atualizado em ${formatDateTime(dados.atualizado_em || dados.criado_em)}`
    : 'Ainda não salvo em dados complementares';

  dom.registroMeta.textContent = meta;
  dom.btnSalvarTopo.disabled = false;
  dom.btnSalvarDados.disabled = false;
  dom.btnRecarregarDados.disabled = false;
}

function disableClienteArea() {
  dom.clienteVazio.hidden = false;
  dom.clienteConteudo.hidden = true;
  dom.form.hidden = true;
  dom.historicoCard.hidden = true;
  dom.btnSalvarTopo.disabled = true;
}

async function selecionarCliente(clienteId) {
  const cliente = state.clientes.find((item) => Number(item.id) === Number(clienteId));
  if (!cliente) {
    toast('Cliente não encontrado na lista carregada.', 'error');
    return;
  }

  state.clienteSelecionado = cliente;
  renderClientes();

  dom.clienteVazio.hidden = true;
  dom.clienteConteudo.hidden = false;
  dom.clienteNome.textContent = getClienteNome(cliente);
  dom.clienteResumo.textContent = `Carregando dados do cliente #${cliente.id}...`;
  dom.form.hidden = true;
  dom.historicoCard.hidden = true;

  await carregarDadosCliente();
  await carregarHistorico();
}

async function carregarDadosCliente() {
  if (!state.clienteSelecionado) return;

  const clienteId = state.clienteSelecionado.id;

  try {
    const dados = await apiJson(`${API_AREA_ADMIN}/${clienteId}/dados-base`);
    state.dadosAtual = dados;
    preencherFormulario(dados);
    enableClienteArea(state.clienteSelecionado, dados);
    atualizarVisibilidadeTipoPessoa();
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar dados:', error);
    toast(error.message || 'Erro ao carregar dados complementares.', 'error');
    disableClienteArea();
  }
}

function preencherFormulario(dados) {
  for (const field of FIELD_NAMES) {
    const el = byId(field);
    if (!el) continue;

    if (field === 'motivo_alteracao') {
      el.value = '';
      continue;
    }

    el.value = dados?.[field] ?? '';
  }

  if (!byId('origem_solicitacao').value) {
    byId('origem_solicitacao').value = 'interno';
  }

  if (!byId('status_preenchimento').value) {
    byId('status_preenchimento').value = 'rascunho';
  }

  if (!byId('tipo_pessoa').value) {
    byId('tipo_pessoa').value = 'PF';
  }
}

function montarPayload() {
  const payload = {
    origem_preenchimento: 'admin',
  };

  for (const field of FIELD_NAMES) {
    const el = byId(field);
    if (!el) continue;
    payload[field] = String(el.value ?? '').trim() || null;
  }

  payload.tipo_pessoa = payload.tipo_pessoa === 'PJ' ? 'PJ' : 'PF';
  payload.status_preenchimento = payload.status_preenchimento || 'rascunho';
  payload.origem_solicitacao = payload.origem_solicitacao || 'interno';

  return payload;
}

async function salvarDados(event) {
  if (event) event.preventDefault();
  if (!state.clienteSelecionado || state.salvando) return;

  const clienteId = state.clienteSelecionado.id;
  const payload = montarPayload();

  if (!payload.nome_completo && payload.tipo_pessoa === 'PF') {
    toast('Informe pelo menos o nome completo da pessoa física.', 'error');
    byId('nome_completo')?.focus();
    return;
  }

  if (!payload.razao_social && payload.tipo_pessoa === 'PJ') {
    toast('Informe pelo menos a razão social da pessoa jurídica.', 'error');
    byId('razao_social')?.focus();
    return;
  }

  setSaving(true);

  try {
    const dados = await apiJson(`${API_AREA_ADMIN}/${clienteId}/dados-base`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    state.dadosAtual = dados;
    preencherFormulario(dados);
    enableClienteArea(state.clienteSelecionado, dados);
    atualizarVisibilidadeTipoPessoa();
    await carregarHistorico();
    toast('Dados complementares salvos com sucesso.');
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao salvar dados:', error);
    toast(error.message || 'Erro ao salvar dados complementares.', 'error');
  } finally {
    setSaving(false);
  }
}

async function carregarHistorico() {
  if (!state.clienteSelecionado) return;

  const clienteId = state.clienteSelecionado.id;
  dom.historicoLista.innerHTML = '<div class="history-empty">Carregando histórico...</div>';

  try {
    const rows = await apiJson(`${API_AREA_ADMIN}/${clienteId}/historico-alteracoes`);
    renderHistorico(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar histórico:', error);
    dom.historicoLista.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
  }
}

function renderHistorico(rows) {
  if (!rows.length) {
    dom.historicoLista.innerHTML = '<div class="history-empty">Ainda não há histórico para este cliente.</div>';
    return;
  }

  dom.historicoLista.innerHTML = rows.map((item) => {
    const label = item.campo ? (FIELD_LABELS[item.campo] || item.campo) : 'Registro geral';
    const user = item.usuario_nome || 'Usuário não informado';
    const origem = item.origem || 'admin';
    const canal = item.canal_solicitacao || 'interno';

    const diff = item.campo ? `
      <div class="history-diff">
        <div class="diff-box">
          <small>Valor anterior</small>
          <span>${escapeHtml(item.valor_anterior || 'Vazio')}</span>
        </div>
        <div class="diff-box">
          <small>Valor novo</small>
          <span>${escapeHtml(item.valor_novo || 'Vazio')}</span>
        </div>
      </div>
    ` : '';

    return `
      <article class="history-item">
        <div class="history-item-top">
          <div>
            <div class="history-title">${escapeHtml(label)}</div>
            <div class="history-desc">${escapeHtml(user)} • origem: ${escapeHtml(origem)} • canal: ${escapeHtml(canal)}</div>
          </div>
          <time class="history-date">${escapeHtml(formatDateTime(item.criado_em))}</time>
        </div>
        <div class="history-desc">${escapeHtml(item.descricao || 'Alteração registrada.')}</div>
        ${diff}
      </article>
    `;
  }).join('');
}

function atualizarVisibilidadeTipoPessoa() {
  const tipo = byId('tipo_pessoa')?.value === 'PJ' ? 'PJ' : 'PF';

  if (dom.sectionPf) {
    dom.sectionPf.classList.toggle('is-muted', tipo === 'PJ');
  }

  if (dom.sectionPj) {
    dom.sectionPj.classList.toggle('is-muted', tipo === 'PF');
  }

  if (dom.badgeTipoPessoa) {
    dom.badgeTipoPessoa.textContent = tipo;
  }
}

function bindEvents() {
  dom.buscaCliente?.addEventListener('input', filtrarClientes);
  dom.btnRecarregarClientes?.addEventListener('click', carregarClientes);
  dom.btnSalvarTopo?.addEventListener('click', salvarDados);
  dom.btnRecarregarDados?.addEventListener('click', carregarDadosCliente);
  dom.btnRecarregarHistorico?.addEventListener('click', carregarHistorico);
  dom.form?.addEventListener('submit', salvarDados);
  dom.tipoPessoa?.addEventListener('change', atualizarVisibilidadeTipoPessoa);

  dom.clientesLista?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cliente-id]');
    if (!btn) return;
    selecionarCliente(btn.dataset.clienteId);
  });
}

async function boot() {
  initDom();
  bindEvents();
  disableClienteArea();
  await carregarClientes();

  const url = new URL(window.location.href);
  const clienteId = url.searchParams.get('cliente_id') || url.searchParams.get('cliente');

  if (clienteId) {
    await selecionarCliente(clienteId);
  } else if (state.clientes.length === 1) {
    await selecionarCliente(state.clientes[0].id);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error('[Área Cliente Admin] falha no boot:', error);
    toast(error.message || 'Erro ao iniciar tela.', 'error');
  });
});