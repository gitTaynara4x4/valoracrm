const API_CLIENTES = '/api/clientes';
const API_CONTRATOS = '/api/contratos-admin';
const API_FINANCEIRO = '/api/financeiro';

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
  financeiroOpcoes: null,
  recorrencia: null,
  financeiroDisponivel: true,
  carregandoRecorrencia: false,
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

  dom.recorrenciaSection = byId('recorrencia-financeira');
  dom.recorrenciaAccess = byId('recorrencia-access');
  dom.recorrenciaConfig = byId('recorrencia-config');
  dom.recorrenciaStatusBadge = byId('recorrencia-status-badge');
  dom.recorrenciaWarning = byId('recorrencia-warning');
  dom.recorrenciaError = byId('recorrencia-error');
  dom.recorrenciaSummary = byId('recorrencia-summary');
  dom.recorrenciaTitulos = byId('recorrencia-titulos');
  dom.recorrenciaFrequencia = byId('recorrencia_frequencia');
  dom.recorrenciaPrimeiroVencimento = byId('recorrencia_primeiro_vencimento');
  dom.recorrenciaDiaVencimento = byId('recorrencia_dia_vencimento');
  dom.recorrenciaAntecipacao = byId('recorrencia_antecipacao');
  dom.recorrenciaFormaCobranca = byId('recorrencia_forma_cobranca');
  dom.recorrenciaFormaPagamento = byId('recorrencia_forma_pagamento');
  dom.recorrenciaContaBanco = byId('recorrencia_conta_banco');
  dom.recorrenciaCategoria = byId('recorrencia_categoria');
  dom.recorrenciaContaContabil = byId('recorrencia_conta_contabil');
  dom.recorrenciaRegraEncargos = byId('recorrencia_regra_encargos');
  dom.recorrenciaTipoDocumento = byId('recorrencia_tipo_documento');
  dom.recorrenciaNatureza = byId('recorrencia_natureza');
  dom.recorrenciaEntidadeEmissora = byId('recorrencia_entidade_emissora');
  dom.recorrenciaCcPrincipal = byId('recorrencia_cc_principal');
  dom.recorrenciaCcSecundario = byId('recorrencia_cc_secundario');
  dom.recorrenciaUcPrincipal = byId('recorrencia_uc_principal');
  dom.recorrenciaUcSecundaria = byId('recorrencia_uc_secundaria');
  dom.recorrenciaObservacoes = byId('recorrencia_observacoes');
  dom.btnSalvarRecorrencia = byId('btn-salvar-recorrencia');
  dom.btnAtivarRecorrencia = byId('btn-ativar-recorrencia');
  dom.btnSuspenderRecorrencia = byId('btn-suspender-recorrencia');
  dom.btnRetomarRecorrencia = byId('btn-retomar-recorrencia');
  dom.btnGerarRecorrencia = byId('btn-gerar-recorrencia');
  dom.btnCancelarRecorrencia = byId('btn-cancelar-recorrencia');

  if (dom.numeroContrato) {
    dom.numeroContrato.readOnly = true;
    dom.numeroContrato.required = false;
    dom.numeroContrato.setAttribute('aria-readonly', 'true');
    dom.numeroContrato.title = 'Número gerado automaticamente pelo sistema';
  }
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
    const error = new Error(message);
    error.status = response.status;
    throw error;
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

    await carregarOpcoesFinanceiras();
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
  state.recorrencia = null;

  dom.form.reset();
  limparPainelRecorrencia();
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
  dom.numeroContrato.readOnly = true;
  dom.numeroContrato.required = false;
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
  await carregarRecorrencia(contrato.id);
}

function montarPayload() {
  const rawPropostaId = String(dom.propostaId.value || '').trim();

  return {
    cliente_id: Number(dom.clienteId.value || 0),
    proposta_id: rawPropostaId ? Number(rawPropostaId) : null,
    // Número de contrato é do sistema. No POST o backend reserva o número real.
    // Na edição, o número é mantido apenas para exibição e não é alterado.
    numero_contrato: state.contratoSelecionado?.id
      ? String(dom.numeroContrato.value || '').trim() || null
      : null,
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

  // O número é gerado/confirmado pelo backend no momento de salvar.
  // A sugestão visível na tela é apenas prévia e não bloqueia o cadastro.
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


function preencherSelectFinanceiro(select, items, {
  placeholder = 'Selecione',
  valueKey = 'id',
  labelFn = (item) => item.nome || item.label || `#${item.id}`,
} = {}) {
  if (!select) return;
  const atual = String(select.value || '');
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    ...items.map((item) => `<option value="${escapeHtml(item[valueKey])}">${escapeHtml(labelFn(item))}</option>`),
  ].join('');
  if (atual && [...select.options].some((option) => option.value === atual)) {
    select.value = atual;
  }
}

function filtrarAplicacao(items, tipo = 'receber') {
  return (items || []).filter((item) => !item.aplicacao || ['ambos', tipo].includes(String(item.aplicacao)));
}

async function carregarOpcoesFinanceiras() {
  try {
    state.financeiroOpcoes = await apiJson(`${API_FINANCEIRO}/opcoes`);
    state.financeiroDisponivel = true;

    preencherSelectFinanceiro(dom.recorrenciaFormaCobranca, state.financeiroOpcoes.formas_cobranca || []);
    preencherSelectFinanceiro(dom.recorrenciaFormaPagamento, state.financeiroOpcoes.formas_pagamento || [], { placeholder: 'Não definida' });
    preencherSelectFinanceiro(dom.recorrenciaContaBanco, state.financeiroOpcoes.contas_bancos || []);
    preencherSelectFinanceiro(
      dom.recorrenciaCategoria,
      (state.financeiroOpcoes.categorias || []).filter((item) => ['receita', 'ambos'].includes(String(item.tipo || ''))),
    );
    preencherSelectFinanceiro(
      dom.recorrenciaContaContabil,
      (state.financeiroOpcoes.contas_contabeis || []).filter((item) => item.aceita_lancamento !== false),
      { labelFn: (item) => `${item.codigo ? `${item.codigo} • ` : ''}${item.nome || ''}` },
    );
    preencherSelectFinanceiro(dom.recorrenciaRegraEncargos, filtrarAplicacao(state.financeiroOpcoes.regras_encargos), { placeholder: 'Sem multa ou mora' });
    preencherSelectFinanceiro(dom.recorrenciaTipoDocumento, filtrarAplicacao(state.financeiroOpcoes.tipos_documento), { placeholder: 'Não definido' });
    preencherSelectFinanceiro(dom.recorrenciaNatureza, filtrarAplicacao(state.financeiroOpcoes.naturezas_operacao), { placeholder: 'Não definida' });
    preencherSelectFinanceiro(dom.recorrenciaEntidadeEmissora, state.financeiroOpcoes.contas_bancos || [], { placeholder: 'Não definida' });
    preencherSelectFinanceiro(dom.recorrenciaCcPrincipal, state.financeiroOpcoes.centros_custo || [], {
      placeholder: 'Não definido',
      labelFn: (item) => `${item.codigo ? `${item.codigo} • ` : ''}${item.nome || ''}`,
    });
    preencherSelectFinanceiro(dom.recorrenciaCcSecundario, state.financeiroOpcoes.centros_custo || [], {
      placeholder: 'Não definido',
      labelFn: (item) => `${item.codigo ? `${item.codigo} • ` : ''}${item.nome || ''}`,
    });
    preencherSelectFinanceiro(dom.recorrenciaUcPrincipal, state.financeiroOpcoes.unidades_consumo || [], { placeholder: 'Não definida' });
    preencherSelectFinanceiro(dom.recorrenciaUcSecundaria, state.financeiroOpcoes.unidades_consumo || [], { placeholder: 'Não definida' });
  } catch (error) {
    state.financeiroDisponivel = false;
    state.financeiroOpcoes = null;
    console.warn('[Contratos Admin] financeiro recorrente indisponível:', error);
  }
}

function limparPainelRecorrencia() {
  state.recorrencia = null;
  if (!dom.recorrenciaSection) return;
  dom.recorrenciaSection.hidden = true;
  dom.recorrenciaConfig.hidden = true;
  dom.recorrenciaAccess.textContent = 'Salve ou selecione um contrato para configurar a cobrança recorrente.';
  dom.recorrenciaSummary.innerHTML = '';
  dom.recorrenciaTitulos.innerHTML = '';
  dom.recorrenciaWarning.hidden = true;
  dom.recorrenciaError.hidden = true;
}

function setRecorrenciaBusy(isBusy) {
  state.carregandoRecorrencia = isBusy;
  [
    dom.btnSalvarRecorrencia,
    dom.btnAtivarRecorrencia,
    dom.btnSuspenderRecorrencia,
    dom.btnRetomarRecorrencia,
    dom.btnGerarRecorrencia,
    dom.btnCancelarRecorrencia,
  ].forEach((button) => {
    if (button) button.disabled = isBusy;
  });
}

function setSelectValue(select, value) {
  if (!select) return;
  const target = value === null || value === undefined ? '' : String(value);
  select.value = [...select.options].some((option) => option.value === target) ? target : '';
}

async function carregarRecorrencia(contratoId) {
  if (!dom.recorrenciaSection) return;
  dom.recorrenciaSection.hidden = false;
  dom.recorrenciaConfig.hidden = true;
  dom.recorrenciaAccess.textContent = 'Carregando configuração financeira...';
  dom.recorrenciaWarning.hidden = true;
  dom.recorrenciaError.hidden = true;

  if (!state.financeiroDisponivel) {
    dom.recorrenciaAccess.textContent = 'O módulo Financeiro não está disponível para este usuário ou a migração 006 ainda não foi aplicada.';
    return;
  }

  setRecorrenciaBusy(true);
  try {
    state.recorrencia = await apiJson(`${API_FINANCEIRO}/contratos-recorrentes/${contratoId}`);
    aplicarRecorrenciaNoFormulario();
    renderRecorrencia();
  } catch (error) {
    state.recorrencia = null;
    dom.recorrenciaAccess.textContent = error.message || 'Não foi possível carregar a cobrança recorrente.';
    dom.recorrenciaConfig.hidden = true;
  } finally {
    setRecorrenciaBusy(false);
  }
}

function aplicarRecorrenciaNoFormulario() {
  const item = state.recorrencia;
  if (!item) return;

  dom.recorrenciaConfig.hidden = false;
  dom.recorrenciaAccess.textContent = 'A configuração pertence a este contrato e será copiada para cada nova mensalidade.';
  dom.recorrenciaFrequencia.value = item.financeiro_frequencia || 'mensal';
  const vencimentoPadrao = item.financeiro_primeiro_vencimento
    || state.contratoSelecionado?.data_pagamento
    || state.contratoSelecionado?.data_inicio
    || '';
  dom.recorrenciaPrimeiroVencimento.value = vencimentoPadrao;
  dom.recorrenciaDiaVencimento.value = item.financeiro_dia_vencimento
    || (vencimentoPadrao ? Number(String(vencimentoPadrao).slice(-2)) : '');
  dom.recorrenciaAntecipacao.value = String(item.financeiro_meses_antecipacao ?? 1);
  setSelectValue(dom.recorrenciaFormaCobranca, item.financeiro_forma_cobranca_id);
  setSelectValue(dom.recorrenciaFormaPagamento, item.financeiro_forma_pagamento_id);
  setSelectValue(dom.recorrenciaContaBanco, item.financeiro_conta_banco_id);
  setSelectValue(dom.recorrenciaCategoria, item.financeiro_categoria_id);
  setSelectValue(dom.recorrenciaContaContabil, item.financeiro_conta_contabil_id);
  setSelectValue(dom.recorrenciaRegraEncargos, item.financeiro_regra_encargos_id);
  setSelectValue(dom.recorrenciaTipoDocumento, item.financeiro_tipo_documento_id);
  setSelectValue(dom.recorrenciaNatureza, item.financeiro_natureza_operacao_id);
  setSelectValue(dom.recorrenciaEntidadeEmissora, item.financeiro_entidade_emissora_id);
  setSelectValue(dom.recorrenciaCcPrincipal, item.financeiro_centro_custo_principal_id);
  setSelectValue(dom.recorrenciaCcSecundario, item.financeiro_centro_custo_secundario_id);
  setSelectValue(dom.recorrenciaUcPrincipal, item.financeiro_unidade_consumo_principal_id);
  setSelectValue(dom.recorrenciaUcSecundaria, item.financeiro_unidade_consumo_secundaria_id);
  dom.recorrenciaObservacoes.value = item.financeiro_observacoes || '';
}

function formatCompetencia(value) {
  if (!value) return 'Não gerada';
  const parts = String(value).slice(0, 10).split('-');
  return parts.length >= 2 ? `${parts[1]}/${parts[0]}` : String(value);
}

function renderRecorrencia() {
  const item = state.recorrencia;
  if (!item) return;

  const status = item.financeiro_status || 'nao_configurado';
  dom.recorrenciaStatusBadge.textContent = item.financeiro_status_label || status;
  dom.recorrenciaStatusBadge.dataset.status = status;

  const assinado = item.status === 'assinado';
  dom.recorrenciaWarning.hidden = assinado || status === 'cancelado';
  if (!assinado && status !== 'cancelado') {
    dom.recorrenciaWarning.textContent = 'A configuração pode ser salva, mas a cobrança só poderá ser ativada quando o contrato estiver com status Assinado.';
  }

  dom.recorrenciaError.hidden = !item.financeiro_ultimo_erro;
  dom.recorrenciaError.textContent = item.financeiro_ultimo_erro
    ? `Última geração falhou: ${item.financeiro_ultimo_erro}`
    : '';

  dom.btnAtivarRecorrencia.hidden = !['configurado', 'nao_configurado'].includes(status);
  dom.btnAtivarRecorrencia.disabled = !item.configuracao_completa || !assinado;
  dom.btnSuspenderRecorrencia.hidden = status !== 'ativo';
  dom.btnRetomarRecorrencia.hidden = status !== 'suspenso';
  dom.btnGerarRecorrencia.hidden = status !== 'ativo';
  dom.btnCancelarRecorrencia.hidden = !['configurado', 'ativo', 'suspenso'].includes(status);
  dom.btnSalvarRecorrencia.disabled = status === 'cancelado';

  const resumo = item.resumo_financeiro || {};
  dom.recorrenciaSummary.innerHTML = [
    ['Títulos gerados', resumo.total_titulos ?? 0],
    ['Saldo em aberto', formatMoney(resumo.saldo_em_aberto || 0)],
    ['Última competência', formatCompetencia(item.financeiro_ultima_competencia_gerada)],
    ['Próxima competência', formatCompetencia(item.financeiro_proxima_competencia)],
  ].map(([label, value]) => `
    <article class="recorrencia-summary-card">
      <small>${escapeHtml(label)}</small>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');

  const titulos = Array.isArray(item.titulos) ? item.titulos : [];
  if (!titulos.length) {
    dom.recorrenciaTitulos.innerHTML = '<div class="recorrencia-empty">Nenhuma cobrança recorrente foi gerada para este contrato.</div>';
    return;
  }

  dom.recorrenciaTitulos.innerHTML = titulos.map((titulo) => `
    <article class="recorrencia-titulo-item">
      <strong>${escapeHtml(titulo.descricao || `Título #${titulo.id}`)}</strong>
      <span>Comp. ${escapeHtml(formatCompetencia(titulo.competencia))}</span>
      <span>${escapeHtml(formatDate(titulo.data_vencimento))} • ${escapeHtml(formatMoney(titulo.valor_total))}</span>
      <span class="recorrencia-titulo-status">${escapeHtml(titulo.status || 'aberto')}</span>
    </article>
  `).join('');
}

function valorInteiro(select) {
  const value = String(select?.value || '').trim();
  return value ? Number(value) : null;
}

function montarPayloadRecorrencia() {
  return {
    frequencia: dom.recorrenciaFrequencia.value || 'mensal',
    primeiro_vencimento: dom.recorrenciaPrimeiroVencimento.value || null,
    dia_vencimento: Number(dom.recorrenciaDiaVencimento.value || 0) || null,
    meses_antecipacao: Number(dom.recorrenciaAntecipacao.value || 0),
    forma_cobranca_id: valorInteiro(dom.recorrenciaFormaCobranca),
    forma_pagamento_id: valorInteiro(dom.recorrenciaFormaPagamento),
    conta_banco_id: valorInteiro(dom.recorrenciaContaBanco),
    categoria_id: valorInteiro(dom.recorrenciaCategoria),
    conta_contabil_id: valorInteiro(dom.recorrenciaContaContabil),
    tipo_documento_id: valorInteiro(dom.recorrenciaTipoDocumento),
    natureza_operacao_id: valorInteiro(dom.recorrenciaNatureza),
    centro_custo_principal_id: valorInteiro(dom.recorrenciaCcPrincipal),
    centro_custo_secundario_id: valorInteiro(dom.recorrenciaCcSecundario),
    unidade_consumo_principal_id: valorInteiro(dom.recorrenciaUcPrincipal),
    unidade_consumo_secundaria_id: valorInteiro(dom.recorrenciaUcSecundaria),
    regra_encargos_id: valorInteiro(dom.recorrenciaRegraEncargos),
    entidade_emissora_id: valorInteiro(dom.recorrenciaEntidadeEmissora),
    observacoes: String(dom.recorrenciaObservacoes.value || '').trim() || null,
  };
}

async function salvarConfiguracaoRecorrencia() {
  const contratoId = state.contratoSelecionado?.id;
  if (!contratoId || state.carregandoRecorrencia) return;

  const valorTela = Number(String(byId('valor_mensal').value || '').replace('.', '').replace(',', '.'));
  const valorSalvo = Number(state.contratoSelecionado?.valor_mensal || 0);
  if (Number.isFinite(valorTela) && Math.abs(valorTela - valorSalvo) > 0.009) {
    toast('Salve primeiro o contrato para aplicar o novo valor mensal.', 'error');
    return;
  }

  const payload = montarPayloadRecorrencia();
  if (!payload.primeiro_vencimento) {
    toast('Informe o primeiro vencimento.', 'error');
    dom.recorrenciaPrimeiroVencimento.focus();
    return;
  }
  if (!payload.forma_cobranca_id || !payload.conta_banco_id || !payload.categoria_id || !payload.conta_contabil_id) {
    toast('Preencha forma de cobrança, conta bancária, categoria e conta contábil.', 'error');
    return;
  }

  setRecorrenciaBusy(true);
  try {
    state.recorrencia = await apiJson(`${API_FINANCEIRO}/contratos-recorrentes/${contratoId}/configuracao`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    aplicarRecorrenciaNoFormulario();
    renderRecorrencia();
    await carregarHistorico();
    toast('Configuração financeira salva.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao salvar recorrência:', error);
    toast(error.message || 'Erro ao salvar a cobrança recorrente.', 'error');
  } finally {
    setRecorrenciaBusy(false);
  }
}

async function executarAcaoRecorrencia(acao) {
  const contratoId = state.contratoSelecionado?.id;
  if (!contratoId || state.carregandoRecorrencia) return;

  let motivo = null;
  if (acao === 'suspender') {
    motivo = window.prompt('Motivo da suspensão (opcional):', '') || null;
  } else if (acao === 'cancelar') {
    motivo = window.prompt('Informe o motivo do cancelamento da recorrência:', '') || '';
    if (!motivo.trim()) return;
    if (!window.confirm('Cancelar a recorrência? Os títulos já gerados serão preservados.')) return;
  } else if (acao === 'ativar' && !window.confirm('Ativar a cobrança recorrente e gerar os primeiros títulos?')) {
    return;
  }

  setRecorrenciaBusy(true);
  try {
    state.recorrencia = await apiJson(`${API_FINANCEIRO}/contratos-recorrentes/${contratoId}/${acao}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo }),
    });
    aplicarRecorrenciaNoFormulario();
    renderRecorrencia();
    await carregarHistorico();
    const quantidade = Number(state.recorrencia?.geracao?.quantidade || 0);
    toast(quantidade ? `${quantidade} cobrança(s) gerada(s).` : 'Recorrência atualizada com sucesso.');
  } catch (error) {
    console.error(`[Contratos Admin] erro na ação ${acao}:`, error);
    toast(error.message || 'Erro ao atualizar a recorrência.', 'error');
  } finally {
    setRecorrenciaBusy(false);
  }
}

async function gerarRecorrenciaAgora() {
  const contratoId = state.contratoSelecionado?.id;
  if (!contratoId || state.carregandoRecorrencia) return;
  setRecorrenciaBusy(true);
  try {
    state.recorrencia = await apiJson(`${API_FINANCEIRO}/contratos-recorrentes/${contratoId}/gerar`, {
      method: 'POST',
    });
    aplicarRecorrenciaNoFormulario();
    renderRecorrencia();
    await carregarHistorico();
    const quantidade = Number(state.recorrencia?.geracao?.quantidade || 0);
    toast(quantidade ? `${quantidade} novo(s) título(s) gerado(s).` : 'Nenhum título novo precisava ser gerado.');
  } catch (error) {
    console.error('[Contratos Admin] erro ao gerar recorrência:', error);
    toast(error.message || 'Erro ao gerar cobranças recorrentes.', 'error');
  } finally {
    setRecorrenciaBusy(false);
  }
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

  dom.recorrenciaPrimeiroVencimento?.addEventListener('change', () => {
    if (dom.recorrenciaPrimeiroVencimento.value && !dom.recorrenciaDiaVencimento.value) {
      dom.recorrenciaDiaVencimento.value = String(Number(dom.recorrenciaPrimeiroVencimento.value.slice(-2)));
    }
  });
  dom.btnSalvarRecorrencia?.addEventListener('click', salvarConfiguracaoRecorrencia);
  dom.btnAtivarRecorrencia?.addEventListener('click', () => executarAcaoRecorrencia('ativar'));
  dom.btnSuspenderRecorrencia?.addEventListener('click', () => executarAcaoRecorrencia('suspender'));
  dom.btnRetomarRecorrencia?.addEventListener('click', () => executarAcaoRecorrencia('retomar'));
  dom.btnGerarRecorrencia?.addEventListener('click', gerarRecorrenciaAgora);
  dom.btnCancelarRecorrencia?.addEventListener('click', () => executarAcaoRecorrencia('cancelar'));

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