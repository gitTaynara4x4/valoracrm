const API_CLIENTES = '/api/clientes';
const API_CONTRATOS = '/api/contratos-admin';

const state = {
  clientes: [],
  contratos: [],
  filtrados: [],
  tipos: [],
  statusList: [],
  propostas: [],
  propostaSelecionada: null,
  contratoSelecionado: null,
  anexosTipos: [],
  anexos: [],
  carregando: false,
  salvando: false,
  enviandoAnexo: false,
};

const FIELD_LABELS = {
  cliente_id: 'Cliente',
  proposta_id: 'Proposta',
  numero_contrato: 'Número do contrato',
  tipo_contrato: 'Tipo de contrato',
  status: 'Status',
  valor_mensal: 'Valor mensal',
  data_pagamento: 'Data de pagamento',
  data_inicio: 'Data de início',
  data_fim: 'Data de fim',
  data_assinatura: 'Data de assinatura',
  vendedor_nome: 'Vendedor',
  data_aprovacao: 'Data de aprovação',
  indicacao: 'Indicação',
  observacoes: 'Observações',
  anexo: 'Anexo',
};

const dom = {};

function byId(id) {
  return document.getElementById(id);
}

function initDom() {
  dom.btnRecarregar = byId('btn-recarregar');
  dom.btnNovoContrato = byId('btn-novo-contrato');

  dom.buscaContrato = byId('busca-contrato');
  dom.filtroStatus = byId('filtro-status');
  dom.filtroCliente = byId('filtro-cliente');
  dom.contratosStatus = byId('contratos-status');
  dom.contratosLista = byId('contratos-lista');

  dom.modoLabel = byId('modo-label');
  dom.contratoTitulo = byId('contrato-titulo');
  dom.contratoSubtitulo = byId('contrato-subtitulo');
  dom.badgeTipo = byId('badge-tipo');
  dom.badgeStatus = byId('badge-status');
  dom.registroMeta = byId('registro-meta');

  dom.form = byId('form-contrato');
  dom.clienteId = byId('cliente_id');
  dom.propostaId = byId('proposta_id');
  dom.numeroContrato = byId('numero_contrato');
  dom.tipoContrato = byId('tipo_contrato');
  dom.status = byId('status');
  dom.motivoRow = byId('motivo-row');

  dom.btnGerarNumero = byId('btn-gerar-numero');
  dom.btnLimparForm = byId('btn-limpar-form');
  dom.btnSalvarContrato = byId('btn-salvar-contrato');
  dom.btnImportarProposta = byId('btn-importar-proposta');

  dom.propostaPreview = byId('proposta-preview');
  dom.propostaPreviewTitulo = byId('proposta-preview-titulo');
  dom.propostaPreviewMeta = byId('proposta-preview-meta');

  dom.anexosCard = byId('anexos-card');
  dom.formAnexo = byId('form-anexo');
  dom.tipoAnexo = byId('tipo_anexo');
  dom.descricaoAnexo = byId('descricao_anexo');
  dom.arquivoAnexo = byId('arquivo_anexo');
  dom.btnEnviarAnexo = byId('btn-enviar-anexo');
  dom.btnRecarregarAnexos = byId('btn-recarregar-anexos');
  dom.anexosStatus = byId('anexos-status');
  dom.anexosLista = byId('anexos-lista');

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

function extractArray(data, ...keys) {
  if (Array.isArray(data)) return data;

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }

  return [];
}

function getClienteNome(cliente) {
  return firstFilled(cliente.nome, cliente.razao_social, cliente.nome_fantasia, cliente.pessoa_contato, `Cliente #${cliente.id}`);
}

function getClienteDocumento(cliente) {
  return firstFilled(cliente.cpf_cnpj, cliente.cpf, cliente.cnpj, cliente.documento);
}

function getTipoLabel(value) {
  const item = state.tipos.find((tipo) => tipo.value === value);
  return item?.label || value || 'Contrato';
}

function getStatusLabel(value) {
  const item = state.statusList.find((status) => status.value === value);
  return item?.label || value || 'Rascunho';
}

function formatDate(value) {
  if (!value) return '';
  const parts = String(value).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return String(value);
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

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return 'Sem valor';
  const number = Number(String(value).replace(',', '.'));

  if (Number.isNaN(number)) return String(value);

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(number);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (!value) return 'tamanho não informado';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function setLoading(isLoading) {
  state.carregando = isLoading;
  dom.btnRecarregar.disabled = isLoading;
  dom.btnNovoContrato.disabled = isLoading;
}

function setSaving(isSaving) {
  state.salvando = isSaving;
  dom.btnSalvarContrato.disabled = isSaving;
  dom.btnGerarNumero.disabled = isSaving;
  dom.btnLimparForm.disabled = isSaving;
}

function setUploading(isUploading) {
  state.enviandoAnexo = isUploading;
  dom.btnEnviarAnexo.disabled = isUploading;
  dom.btnRecarregarAnexos.disabled = isUploading;
  dom.tipoAnexo.disabled = isUploading;
  dom.descricaoAnexo.disabled = isUploading;
  dom.arquivoAnexo.disabled = isUploading;
}

async function carregarBase() {
  setLoading(true);
  dom.contratosStatus.textContent = 'Carregando dados...';

  try {
    const [clientesData, tiposData, statusData, anexosTiposData] = await Promise.all([
      apiJson(API_CLIENTES),
      apiJson(`${API_CONTRATOS}/tipos`),
      apiJson(`${API_CONTRATOS}/status`),
      apiJson(`${API_CONTRATOS}/anexos/tipos`),
    ]);

    state.clientes = extractArray(clientesData, 'items', 'clientes', 'data');
    state.tipos = extractArray(tiposData, 'items', 'tipos', 'data');
    state.statusList = extractArray(statusData, 'items', 'status', 'data');
    state.anexosTipos = extractArray(anexosTiposData, 'items', 'tipos', 'data');

    preencherSelectClientes();
    preencherSelectTipos();
    preencherSelectStatus();
    preencherSelectTiposAnexo();

    await carregarContratos();

    if (state.clientes.length === 1 && !dom.clienteId.value) {
      dom.clienteId.value = String(state.clientes[0].id);
      await onClienteChange();
    }
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar base:', error);
    toast(error.message || 'Erro ao carregar dados iniciais.', 'error');
    dom.contratosStatus.textContent = 'Erro ao carregar dados.';
  } finally {
    setLoading(false);
  }
}

function preencherSelectClientes() {
  const options = [
    '<option value="">Selecione um cliente</option>',
    ...state.clientes.map((cliente) => {
      const nome = getClienteNome(cliente);
      const doc = getClienteDocumento(cliente);
      const label = doc ? `${nome} • ${doc}` : nome;
      return `<option value="${escapeHtml(cliente.id)}">${escapeHtml(label)}</option>`;
    }),
  ].join('');

  dom.clienteId.innerHTML = options;

  dom.filtroCliente.innerHTML = [
    '<option value="">Todos</option>',
    ...state.clientes.map((cliente) => {
      const nome = getClienteNome(cliente);
      return `<option value="${escapeHtml(cliente.id)}">${escapeHtml(nome)}</option>`;
    }),
  ].join('');
}

function preencherSelectTipos() {
  if (!state.tipos.length) {
    dom.tipoContrato.innerHTML = '<option value="outro">Outro</option>';
    return;
  }

  dom.tipoContrato.innerHTML = state.tipos.map((tipo) => {
    return `<option value="${escapeHtml(tipo.value)}">${escapeHtml(tipo.label)}</option>`;
  }).join('');
}

function preencherSelectStatus() {
  const statusOptions = state.statusList.length
    ? state.statusList
    : [{ value: 'rascunho', label: 'Rascunho' }];

  dom.status.innerHTML = statusOptions.map((item) => {
    return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`;
  }).join('');

  dom.filtroStatus.innerHTML = [
    '<option value="">Todos</option>',
    ...statusOptions.map((item) => {
      return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`;
    }),
  ].join('');
}

function preencherSelectTiposAnexo() {
  const tipos = state.anexosTipos.length
    ? state.anexosTipos
    : [{ value: 'contrato_assinado', label: 'Contrato assinado' }];

  dom.tipoAnexo.innerHTML = tipos.map((item) => {
    return `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`;
  }).join('');

  dom.tipoAnexo.value = 'contrato_assinado';
}

async function carregarContratos() {
  dom.contratosStatus.textContent = 'Carregando contratos...';
  dom.contratosLista.innerHTML = '';

  const params = new URLSearchParams();
  const filtroCliente = String(dom.filtroCliente.value || '').trim();
  const filtroStatus = String(dom.filtroStatus.value || '').trim();

  if (filtroCliente) params.set('cliente_id', filtroCliente);
  if (filtroStatus) params.set('status_contrato', filtroStatus);

  const url = params.toString() ? `${API_CONTRATOS}?${params.toString()}` : API_CONTRATOS;

  try {
    const data = await apiJson(url);
    state.contratos = Array.isArray(data) ? data : [];
    filtrarContratos();

    dom.contratosStatus.textContent = state.contratos.length
      ? `${state.contratos.length} contrato(s) carregado(s).`
      : 'Nenhum contrato encontrado.';
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar contratos:', error);
    state.contratos = [];
    state.filtrados = [];
    renderContratos();
    dom.contratosStatus.textContent = 'Erro ao carregar contratos.';
    toast(error.message || 'Erro ao carregar contratos.', 'error');
  }
}

function filtrarContratos() {
  const q = normalizeText(dom.buscaContrato.value || '');

  state.filtrados = state.contratos.filter((contrato) => {
    if (!q) return true;

    const haystack = normalizeText([
      contrato.id,
      contrato.numero_contrato,
      contrato.cliente_nome,
      contrato.tipo_contrato_label,
      contrato.status_label,
      contrato.proposta_codigo,
      contrato.proposta_titulo,
      contrato.valor_mensal,
      contrato.vendedor_nome,
      contrato.indicacao,
    ].join(' '));

    return haystack.includes(q);
  });

  renderContratos();
}

function renderContratos() {
  const selecionadoId = state.contratoSelecionado ? Number(state.contratoSelecionado.id) : null;

  if (!state.filtrados.length) {
    dom.contratosLista.innerHTML = '<div class="history-empty">Nenhum contrato para exibir.</div>';
    return;
  }

  dom.contratosLista.innerHTML = state.filtrados.map((contrato) => {
    const active = selecionadoId === Number(contrato.id) ? ' active' : '';

    const proposta = contrato.proposta_codigo
      ? `Proposta ${contrato.proposta_codigo}`
      : 'Sem proposta vinculada';

    const valor = formatMoney(contrato.valor_mensal);
    const pagamento = contrato.data_pagamento ? `Pagamento: ${formatDate(contrato.data_pagamento)}` : 'Sem data de pagamento';

    return `
      <button class="contrato-item${active}" type="button" data-contrato-id="${escapeHtml(contrato.id)}">
        <span class="contrato-item-top">
          <span class="contrato-numero">${escapeHtml(contrato.numero_contrato)}</span>
          <span class="contrato-status">${escapeHtml(contrato.status_label || contrato.status)}</span>
        </span>
        <span class="contrato-item-meta">
          <span><strong>${escapeHtml(contrato.cliente_nome || 'Cliente')}</strong></span>
          <span>${escapeHtml(contrato.tipo_contrato_label || contrato.tipo_contrato)}</span>
          <span>${escapeHtml(proposta)}</span>
          <span>${escapeHtml(valor)} • ${escapeHtml(pagamento)}</span>
        </span>
      </button>
    `;
  }).join('');
}

function limparFormulario() {
  state.contratoSelecionado = null;
  state.propostaSelecionada = null;
  state.anexos = [];

  dom.form.reset();
  dom.propostaId.innerHTML = '<option value="">Sem proposta vinculada</option>';
  esconderResumoProposta();

  dom.historicoCard.hidden = true;
  dom.historicoLista.innerHTML = '';

  dom.anexosCard.hidden = true;
  dom.anexosStatus.textContent = 'Salve ou selecione um contrato para enviar anexos.';
  dom.anexosLista.innerHTML = '';
  dom.formAnexo.reset();

  if (state.clientes.length === 1) {
    dom.clienteId.value = String(state.clientes[0].id);
  }

  if (state.tipos.length) {
    dom.tipoContrato.value = state.tipos[0].value;
  } else {
    dom.tipoContrato.value = 'outro';
  }

  if (state.anexosTipos.length) {
    dom.tipoAnexo.value = 'contrato_assinado';
  }

  dom.status.value = 'rascunho';

  dom.modoLabel.textContent = 'Novo contrato';
  dom.contratoTitulo.textContent = 'Preencha os dados do contrato';
  dom.contratoSubtitulo.textContent = 'Selecione um cliente para gerar o número automático.';
  dom.badgeTipo.textContent = 'Contrato';
  dom.badgeStatus.textContent = 'Rascunho';
  dom.registroMeta.textContent = 'Novo registro';

  dom.motivoRow.hidden = true;

  renderContratos();

  if (dom.clienteId.value) {
    onClienteChange();
  }
}

async function selecionarContrato(contratoId) {
  const contrato = state.contratos.find((item) => Number(item.id) === Number(contratoId));
  if (!contrato) {
    toast('Contrato não encontrado na lista carregada.', 'error');
    return;
  }

  try {
    const completo = await apiJson(`${API_CONTRATOS}/${contratoId}`);
    state.contratoSelecionado = completo;

    await preencherFormulario(completo);
    renderContratos();
    await carregarAnexos();
    await carregarHistorico();

    toast('Contrato carregado.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao selecionar contrato:', error);
    toast(error.message || 'Erro ao carregar contrato.', 'error');
  }
}

async function preencherFormulario(contrato) {
  dom.clienteId.value = contrato.cliente_id ? String(contrato.cliente_id) : '';
  await carregarPropostasAprovadas(contrato.cliente_id, contrato.proposta_id);

  dom.propostaId.value = contrato.proposta_id ? String(contrato.proposta_id) : '';

  if (contrato.proposta_id) {
    await carregarResumoProposta(contrato.proposta_id);
  } else {
    esconderResumoProposta();
  }

  dom.numeroContrato.value = contrato.numero_contrato || '';
  dom.tipoContrato.value = contrato.tipo_contrato || 'outro';
  dom.status.value = contrato.status || 'rascunho';
  byId('valor_mensal').value = contrato.valor_mensal || '';
  byId('data_pagamento').value = contrato.data_pagamento || '';
  byId('data_inicio').value = contrato.data_inicio || '';
  byId('data_fim').value = contrato.data_fim || '';
  byId('data_assinatura').value = contrato.data_assinatura || '';
  byId('vendedor_nome').value = contrato.vendedor_nome || '';
  byId('data_aprovacao').value = contrato.data_aprovacao || '';
  byId('indicacao').value = contrato.indicacao || '';
  byId('observacoes').value = contrato.observacoes || '';
  byId('motivo_alteracao').value = '';

  dom.modoLabel.textContent = `Editando contrato #${contrato.id}`;
  dom.contratoTitulo.textContent = contrato.numero_contrato || 'Contrato';
  dom.contratoSubtitulo.textContent = `${contrato.cliente_nome || 'Cliente'} • ${formatMoney(contrato.valor_mensal)}`;
  dom.badgeTipo.textContent = contrato.tipo_contrato_label || getTipoLabel(contrato.tipo_contrato);
  dom.badgeStatus.textContent = contrato.status_label || getStatusLabel(contrato.status);
  dom.registroMeta.textContent = `Registro #${contrato.id} • atualizado em ${formatDateTime(contrato.atualizado_em || contrato.criado_em)}`;

  dom.motivoRow.hidden = false;
  dom.anexosCard.hidden = false;
}

function montarPayload() {
  const rawPropostaId = String(dom.propostaId.value || '').trim();

  return {
    cliente_id: Number(dom.clienteId.value || 0),
    proposta_id: rawPropostaId ? Number(rawPropostaId) : null,
    numero_contrato: String(dom.numeroContrato.value || '').trim() || null,
    tipo_contrato: String(dom.tipoContrato.value || 'outro').trim() || 'outro',
    status: String(dom.status.value || 'rascunho').trim() || 'rascunho',
    valor_mensal: String(byId('valor_mensal').value || '').trim() || null,
    data_pagamento: String(byId('data_pagamento').value || '').trim() || null,
    data_inicio: String(byId('data_inicio').value || '').trim() || null,
    data_fim: String(byId('data_fim').value || '').trim() || null,
    data_assinatura: String(byId('data_assinatura').value || '').trim() || null,
    vendedor_nome: String(byId('vendedor_nome').value || '').trim() || null,
    data_aprovacao: String(byId('data_aprovacao').value || '').trim() || null,
    indicacao: String(byId('indicacao').value || '').trim() || null,
    observacoes: String(byId('observacoes').value || '').trim() || null,
    motivo_alteracao: String(byId('motivo_alteracao').value || '').trim() || null,
  };
}

async function salvarContrato(event) {
  event.preventDefault();

  if (state.salvando) return;

  const payload = montarPayload();

  if (!payload.cliente_id) {
    toast('Selecione um cliente.', 'error');
    dom.clienteId.focus();
    return;
  }

  if (!payload.numero_contrato) {
    toast('Informe ou gere o número do contrato.', 'error');
    dom.numeroContrato.focus();
    return;
  }

  setSaving(true);

  try {
    const editando = Boolean(state.contratoSelecionado?.id);
    const url = editando
      ? `${API_CONTRATOS}/${state.contratoSelecionado.id}`
      : API_CONTRATOS;

    const method = editando ? 'PUT' : 'POST';

    const salvo = await apiJson(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    state.contratoSelecionado = salvo;
    await carregarContratos();

    const recarregado = state.contratos.find((item) => Number(item.id) === Number(salvo.id)) || salvo;
    state.contratoSelecionado = recarregado;

    await preencherFormulario(recarregado);
    renderContratos();
    await carregarAnexos();
    await carregarHistorico();

    toast(editando ? 'Contrato atualizado com sucesso.' : 'Contrato criado com sucesso.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao salvar contrato:', error);
    toast(error.message || 'Erro ao salvar contrato.', 'error');
  } finally {
    setSaving(false);
  }
}

async function gerarNumeroContrato(force = true) {
  const clienteId = String(dom.clienteId.value || '').trim();
  const tipo = String(dom.tipoContrato.value || 'outro').trim() || 'outro';

  if (!clienteId) {
    if (force) toast('Selecione um cliente antes de gerar o número.', 'error');
    return;
  }

  if (!force && String(dom.numeroContrato.value || '').trim()) {
    return;
  }

  try {
    const params = new URLSearchParams({
      cliente_id: clienteId,
      tipo_contrato: tipo,
    });

    const data = await apiJson(`${API_CONTRATOS}/sugestao-numero?${params.toString()}`);
    dom.numeroContrato.value = data.numero_contrato || '';
  } catch (error) {
    console.error('[Contratos Admin] erro ao gerar número:', error);
    if (force) toast(error.message || 'Erro ao gerar número automático.', 'error');
  }
}

async function onClienteChange() {
  const clienteId = String(dom.clienteId.value || '').trim();

  dom.propostaId.value = '';
  state.propostaSelecionada = null;
  esconderResumoProposta();

  await carregarPropostasAprovadas(clienteId || null, null);

  if (!state.contratoSelecionado) {
    await gerarNumeroContrato(false);
  }
}

async function carregarPropostasAprovadas(clienteId, selectedId = null) {
  dom.propostaId.innerHTML = '<option value="">Carregando propostas...</option>';

  if (!clienteId) {
    state.propostas = [];
    dom.propostaId.innerHTML = '<option value="">Sem proposta vinculada</option>';
    atualizarBotaoImportarProposta();
    return;
  }

  try {
    const params = new URLSearchParams({ cliente_id: String(clienteId) });
    const data = await apiJson(`${API_CONTRATOS}/propostas-aprovadas?${params.toString()}`);
    state.propostas = Array.isArray(data) ? data : [];

    const options = ['<option value="">Sem proposta vinculada</option>'];

    for (const proposta of state.propostas) {
      const codigo = proposta.codigo || `#${proposta.id}`;
      const titulo = proposta.titulo || 'Proposta';
      const total = proposta.total ? ` • ${formatMoney(proposta.total)}` : '';
      const status = proposta.status ? ` • ${proposta.status}` : '';
      const label = `${codigo} • ${titulo}${total}${status}`;
      options.push(`<option value="${escapeHtml(proposta.id)}">${escapeHtml(label)}</option>`);
    }

    dom.propostaId.innerHTML = options.join('');

    if (selectedId) {
      dom.propostaId.value = String(selectedId);
    }

    atualizarBotaoImportarProposta();
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar propostas aprovadas:', error);
    state.propostas = [];
    dom.propostaId.innerHTML = '<option value="">Sem proposta vinculada</option>';
    atualizarBotaoImportarProposta();
  }
}

function atualizarBotaoImportarProposta() {
  const propostaId = String(dom.propostaId.value || '').trim();
  dom.btnImportarProposta.disabled = !propostaId;
}

async function onPropostaChange() {
  const propostaId = String(dom.propostaId.value || '').trim();

  atualizarBotaoImportarProposta();

  if (!propostaId) {
    state.propostaSelecionada = null;
    esconderResumoProposta();
    return;
  }

  await carregarResumoProposta(propostaId);
}

async function carregarResumoProposta(propostaId) {
  if (!propostaId) {
    esconderResumoProposta();
    return null;
  }

  try {
    const resumo = await apiJson(`${API_CONTRATOS}/propostas/${propostaId}/resumo`);
    state.propostaSelecionada = resumo;
    mostrarResumoProposta(resumo);
    return resumo;
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar resumo da proposta:', error);
    state.propostaSelecionada = null;
    esconderResumoProposta();
    toast(error.message || 'Erro ao carregar resumo da proposta.', 'error');
    return null;
  }
}

function mostrarResumoProposta(proposta) {
  if (!proposta) {
    esconderResumoProposta();
    return;
  }

  const codigo = proposta.codigo || `#${proposta.id}`;
  const titulo = proposta.titulo || 'Proposta aprovada';
  const total = proposta.total ? formatMoney(proposta.total) : 'sem valor';
  const dataOrcamento = proposta.data_orcamento ? formatDate(proposta.data_orcamento) : 'sem data';
  const vendedor = proposta.vendedor_nome || 'sem vendedor';
  const aprovacao = proposta.data_aprovacao ? formatDate(proposta.data_aprovacao) : 'sem data de aprovação';
  const indicacao = proposta.indicacao || 'sem indicação';

  dom.propostaPreview.hidden = false;
  dom.propostaPreviewTitulo.textContent = `${codigo} • ${titulo}`;
  dom.propostaPreviewMeta.textContent = `Valor: ${total} • Orçamento: ${dataOrcamento} • Vendedor: ${vendedor} • Aprovação: ${aprovacao} • Indicação: ${indicacao}`;
}

function esconderResumoProposta() {
  if (!dom.propostaPreview) return;
  dom.propostaPreview.hidden = true;
  dom.propostaPreviewTitulo.textContent = 'Proposta selecionada';
  dom.propostaPreviewMeta.textContent = 'Selecione uma proposta para ver o resumo.';
  atualizarBotaoImportarProposta();
}

async function importarDadosProposta() {
  const propostaId = String(dom.propostaId.value || '').trim();

  if (!propostaId) {
    toast('Selecione uma proposta aprovada para importar.', 'error');
    return;
  }

  const proposta = state.propostaSelecionada || await carregarResumoProposta(propostaId);

  if (!proposta) {
    toast('Não foi possível importar a proposta.', 'error');
    return;
  }

  if (proposta.cliente_id && String(proposta.cliente_id) !== String(dom.clienteId.value)) {
    toast('A proposta selecionada pertence a outro cliente.', 'error');
    return;
  }

  if (proposta.vendedor_nome) {
    byId('vendedor_nome').value = proposta.vendedor_nome;
  }

  if (proposta.data_aprovacao) {
    byId('data_aprovacao').value = proposta.data_aprovacao;
  }

  if (proposta.indicacao) {
    byId('indicacao').value = proposta.indicacao;
  }

  const observacoesAtual = String(byId('observacoes').value || '').trim();
  const codigo = proposta.codigo || `#${proposta.id}`;
  const titulo = proposta.titulo || 'Proposta aprovada';
  const dataOrcamento = proposta.data_orcamento ? formatDate(proposta.data_orcamento) : 'sem data';
  const total = proposta.total ? formatMoney(proposta.total) : 'sem valor';

  const blocoImportado = `Proposta importada: ${codigo} - ${titulo}. Data do orçamento: ${dataOrcamento}. Valor da proposta: ${total}.`;

  if (!observacoesAtual.includes(`Proposta importada: ${codigo}`)) {
    byId('observacoes').value = observacoesAtual
      ? `${observacoesAtual}\n${blocoImportado}`
      : blocoImportado;
  }

  toast('Dados da proposta importados para o contrato.');
}

async function carregarAnexos() {
  if (!state.contratoSelecionado?.id) {
    state.anexos = [];
    dom.anexosCard.hidden = true;
    return;
  }

  dom.anexosCard.hidden = false;
  dom.anexosStatus.textContent = 'Carregando anexos...';
  dom.anexosLista.innerHTML = '';

  try {
    const data = await apiJson(`${API_CONTRATOS}/${state.contratoSelecionado.id}/anexos`);
    state.anexos = Array.isArray(data) ? data : [];

    renderAnexos();

    dom.anexosStatus.textContent = state.anexos.length
      ? `${state.anexos.length} anexo(s) encontrado(s).`
      : 'Nenhum anexo enviado para este contrato.';
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar anexos:', error);
    state.anexos = [];
    dom.anexosStatus.textContent = 'Erro ao carregar anexos.';
    dom.anexosLista.innerHTML = '<div class="history-empty">Não foi possível carregar os anexos.</div>';
  }
}

function renderAnexos() {
  if (!state.anexos.length) {
    dom.anexosLista.innerHTML = '<div class="history-empty">Ainda não há anexos neste contrato.</div>';
    return;
  }

  dom.anexosLista.innerHTML = state.anexos.map((anexo) => {
    const tipo = anexo.tipo_documento_label || anexo.tipo_documento || 'Documento';
    const descricao = anexo.descricao || '';
    const usuario = anexo.usuario_nome || 'Usuário não informado';
    const data = formatDateTime(anexo.criado_em);
    const tamanho = formatBytes(anexo.arquivo_tamanho);

    return `
      <article class="anexo-item" data-anexo-id="${escapeHtml(anexo.id)}">
        <div class="anexo-icon">
          <i class="fa-solid fa-file-lines"></i>
        </div>

        <div class="anexo-info">
          <div class="anexo-nome">${escapeHtml(anexo.arquivo_nome)}</div>
          <div class="anexo-meta">${escapeHtml(tipo)} • ${escapeHtml(tamanho)} • Enviado por ${escapeHtml(usuario)}${data ? ` em ${escapeHtml(data)}` : ''}</div>
          ${descricao ? `<div class="anexo-desc">${escapeHtml(descricao)}</div>` : ''}
        </div>

        <div class="anexo-actions">
          <a class="btn btn-secondary" href="${escapeHtml(anexo.download_url || '#')}" target="_blank" rel="noopener">
            <i class="fa-solid fa-download"></i>
            Baixar
          </a>

          <button class="btn btn-danger-soft" type="button" data-excluir-anexo="${escapeHtml(anexo.id)}">
            <i class="fa-solid fa-trash"></i>
            Excluir
          </button>
        </div>
      </article>
    `;
  }).join('');
}

async function enviarAnexo(event) {
  event.preventDefault();

  if (state.enviandoAnexo) return;

  if (!state.contratoSelecionado?.id) {
    toast('Selecione ou salve um contrato antes de enviar anexo.', 'error');
    return;
  }

  const arquivo = dom.arquivoAnexo.files?.[0];

  if (!arquivo) {
    toast('Escolha um arquivo para enviar.', 'error');
    dom.arquivoAnexo.focus();
    return;
  }

  const formData = new FormData();
  formData.append('arquivo', arquivo);
  formData.append('tipo_documento', dom.tipoAnexo.value || 'contrato_assinado');
  formData.append('descricao', String(dom.descricaoAnexo.value || '').trim());

  setUploading(true);

  try {
    await apiJson(`${API_CONTRATOS}/${state.contratoSelecionado.id}/anexos/upload`, {
      method: 'POST',
      body: formData,
    });

    dom.formAnexo.reset();
    dom.tipoAnexo.value = 'contrato_assinado';

    await carregarAnexos();
    await carregarHistorico();

    toast('Anexo enviado com sucesso.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao enviar anexo:', error);
    toast(error.message || 'Erro ao enviar anexo.', 'error');
  } finally {
    setUploading(false);
  }
}

async function excluirAnexo(anexoId) {
  if (!anexoId) return;

  const anexo = state.anexos.find((item) => Number(item.id) === Number(anexoId));
  const nome = anexo?.arquivo_nome || `anexo #${anexoId}`;

  const confirmar = window.confirm(`Excluir o anexo "${nome}"?`);
  if (!confirmar) return;

  try {
    await apiJson(`${API_CONTRATOS}/anexos/${anexoId}`, {
      method: 'DELETE',
    });

    await carregarAnexos();
    await carregarHistorico();

    toast('Anexo excluído com sucesso.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao excluir anexo:', error);
    toast(error.message || 'Erro ao excluir anexo.', 'error');
  }
}

async function carregarHistorico() {
  if (!state.contratoSelecionado?.id) {
    dom.historicoCard.hidden = true;
    return;
  }

  dom.historicoCard.hidden = false;
  dom.historicoLista.innerHTML = '<div class="history-empty">Carregando histórico...</div>';

  try {
    const rows = await apiJson(`${API_CONTRATOS}/${state.contratoSelecionado.id}/historico`);
    renderHistorico(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error('[Contratos Admin] erro ao carregar histórico:', error);
    dom.historicoLista.innerHTML = '<div class="history-empty">Não foi possível carregar o histórico.</div>';
  }
}

function renderHistorico(rows) {
  if (!rows.length) {
    dom.historicoLista.innerHTML = '<div class="history-empty">Ainda não há histórico para este contrato.</div>';
    return;
  }

  dom.historicoLista.innerHTML = rows.map((item) => {
    const label = item.campo ? (FIELD_LABELS[item.campo] || item.campo) : 'Registro geral';
    const user = item.usuario_nome || 'Usuário não informado';

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
            <div class="history-desc">${escapeHtml(user)}</div>
          </div>
          <time class="history-date">${escapeHtml(formatDateTime(item.criado_em))}</time>
        </div>
        <div class="history-desc">${escapeHtml(item.descricao || 'Alteração registrada.')}</div>
        ${diff}
      </article>
    `;
  }).join('');
}

function bindEvents() {
  dom.btnRecarregar.addEventListener('click', async () => {
    await carregarBase();
  });

  dom.btnNovoContrato.addEventListener('click', () => {
    limparFormulario();
  });

  dom.buscaContrato.addEventListener('input', filtrarContratos);

  dom.filtroCliente.addEventListener('change', carregarContratos);
  dom.filtroStatus.addEventListener('change', carregarContratos);

  dom.contratosLista.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-contrato-id]');
    if (!btn) return;
    selecionarContrato(btn.dataset.contratoId);
  });

  dom.clienteId.addEventListener('change', onClienteChange);
  dom.propostaId.addEventListener('change', onPropostaChange);
  dom.btnImportarProposta.addEventListener('click', importarDadosProposta);

  dom.tipoContrato.addEventListener('change', async () => {
    if (!state.contratoSelecionado) {
      await gerarNumeroContrato(false);
    }

    dom.badgeTipo.textContent = getTipoLabel(dom.tipoContrato.value);
  });

  dom.status.addEventListener('change', () => {
    dom.badgeStatus.textContent = getStatusLabel(dom.status.value);
  });

  dom.btnGerarNumero.addEventListener('click', () => gerarNumeroContrato(true));

  dom.btnLimparForm.addEventListener('click', () => {
    limparFormulario();
  });

  dom.formAnexo.addEventListener('submit', enviarAnexo);

  dom.btnRecarregarAnexos.addEventListener('click', carregarAnexos);

  dom.anexosLista.addEventListener('click', (event) => {
    const btnExcluir = event.target.closest('[data-excluir-anexo]');
    if (!btnExcluir) return;

    excluirAnexo(btnExcluir.dataset.excluirAnexo);
  });

  dom.btnRecarregarHistorico.addEventListener('click', carregarHistorico);

  dom.form.addEventListener('submit', salvarContrato);
}

async function boot() {
  initDom();
  bindEvents();
  limparFormulario();
  await carregarBase();

  const url = new URL(window.location.href);
  const contratoId = url.searchParams.get('contrato_id') || url.searchParams.get('contrato');

  if (contratoId) {
    await selecionarContrato(contratoId);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error('[Contratos Admin] falha no boot:', error);
    toast(error.message || 'Erro ao iniciar tela de contratos.', 'error');
  });
});