const API_CLIENTES = '/api/clientes';
const API_AREA_CLIENTE = '/api/area-cliente-admin';
const API_ACESSOS = '/api/area-cliente-acessos-admin';

const state = {
  clientes: [],
  clienteSelecionado: null,
  dadosAtuais: null,
  acessos: [],
  acessoAtivo: null,
  carregando: false,
  salvando: false,
  gerandoAcesso: false,
};

const dom = {};

const CAMPOS_FORM = [
  'tipo_pessoa',
  'status_preenchimento',
  'origem_preenchimento',

  'nome_completo',
  'cpf',
  'rg',
  'nacionalidade',
  'profissao',
  'estado_civil',
  'data_nascimento',
  'email_pessoal',
  'telefone_pessoal',

  'razao_social',
  'cnpj',
  'email_empresa',
  'telefone_whatsapp_empresa',

  'representante_nome',
  'representante_cpf',
  'representante_rg',
  'representante_nacionalidade',
  'representante_profissao',
  'representante_estado_civil',
  'representante_data_nascimento',
  'representante_email_pessoal',
  'representante_telefone_pessoal',

  'endereco_rua',
  'endereco_numero',
  'endereco_bairro',
  'endereco_cidade',
  'endereco_uf',
  'endereco_cep',

  'observacoes_contrato',
];

const HISTORICO_LABELS = {
  dados_complementares: 'Dados complementares',
  tipo_pessoa: 'Tipo de pessoa',
  nome_completo: 'Nome completo',
  cpf: 'CPF',
  rg: 'RG',
  nacionalidade: 'Nacionalidade',
  profissao: 'Profissão',
  estado_civil: 'Estado civil',
  data_nascimento: 'Data de nascimento',
  email_pessoal: 'E-mail pessoal',
  telefone_pessoal: 'Telefone pessoal',
  razao_social: 'Razão social',
  cnpj: 'CNPJ',
  endereco: 'Endereço',
};

function byId(id) {
  return document.getElementById(id);
}

function initDom() {
  dom.btnRecarregar = byId('btn-recarregar');
  dom.btnSalvarTopo = byId('btn-salvar-topo');
  dom.clienteId = byId('cliente_id');
  dom.clienteResumo = byId('cliente-resumo');
  dom.statusGeral = byId('status-geral');

  dom.form = byId('form-dados-cliente');
  dom.btnSalvarDados = byId('btn-salvar-dados');
  dom.btnLimparForm = byId('btn-limpar-form');
  dom.registroMeta = byId('registro-meta');

  dom.acessoCard = byId('acesso-card');
  dom.acessoStatusBadge = byId('acesso-status-badge');
  dom.acessoAtivoBox = byId('acesso-ativo-box');
  dom.acessoAtivoTitulo = byId('acesso-ativo-titulo');
  dom.acessoAtivoTexto = byId('acesso-ativo-texto');

  dom.expiraEmDias = byId('expira_em_dias');
  dom.baseUrlAcesso = byId('base_url_acesso');
  dom.revogarAnteriores = byId('revogar_anteriores');
  dom.btnGerarAcesso = byId('btn-gerar-acesso');
  dom.btnRecarregarAcessos = byId('btn-recarregar-acessos');

  dom.acessoGeradoBox = byId('acesso-gerado-box');
  dom.linkPublicoGerado = byId('link_publico_gerado');
  dom.senhaProvisoriaGerada = byId('senha_provisoria_gerada');
  dom.mensagemWhatsappGerada = byId('mensagem_whatsapp_gerada');
  dom.btnCopiarLink = byId('btn-copiar-link');
  dom.btnCopiarSenha = byId('btn-copiar-senha');
  dom.btnCopiarMensagem = byId('btn-copiar-mensagem');

  dom.acessosStatus = byId('acessos-status');
  dom.acessosLista = byId('acessos-lista');

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

function extractArray(data, ...keys) {
  if (Array.isArray(data)) return data;

  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }

  return [];
}

function firstFilled(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }

  return '';
}

function getClienteNome(cliente) {
  return firstFilled(
    cliente?.nome,
    cliente?.razao_social,
    cliente?.nome_fantasia,
    cliente?.pessoa_contato,
    `Cliente #${cliente?.id || ''}`
  );
}

function getClienteDocumento(cliente) {
  return firstFilled(
    cliente?.cpf_cnpj,
    cliente?.cpf,
    cliente?.cnpj,
    cliente?.documento
  );
}

function getClienteEmail(cliente) {
  return firstFilled(cliente?.email, cliente?.email_pessoal, cliente?.email_empresa);
}

function getClienteTelefone(cliente) {
  return firstFilled(cliente?.telefone, cliente?.telefone_pessoal, cliente?.celular, cliente?.whatsapp);
}

function formatDate(value) {
  if (!value) return '';
  const text = String(value);

  if (text.includes('T')) {
    return formatDateTime(text);
  }

  const parts = text.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;

  return text;
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

  if (dom.btnRecarregar) {
    dom.btnRecarregar.disabled = isLoading;
  }

  if (dom.clienteId) {
    dom.clienteId.disabled = isLoading;
  }
}

function setSaving(isSaving) {
  state.salvando = isSaving;

  if (dom.btnSalvarDados) {
    dom.btnSalvarDados.disabled = isSaving;
  }

  if (dom.btnSalvarTopo) {
    dom.btnSalvarTopo.disabled = isSaving;
  }

  if (dom.btnLimparForm) {
    dom.btnLimparForm.disabled = isSaving;
  }
}

function setGenerating(isGenerating) {
  state.gerandoAcesso = isGenerating;

  if (dom.btnGerarAcesso) {
    dom.btnGerarAcesso.disabled = isGenerating;
  }

  if (dom.btnRecarregarAcessos) {
    dom.btnRecarregarAcessos.disabled = isGenerating;
  }

  if (dom.expiraEmDias) {
    dom.expiraEmDias.disabled = isGenerating;
  }

  if (dom.baseUrlAcesso) {
    dom.baseUrlAcesso.disabled = isGenerating;
  }

  if (dom.revogarAnteriores) {
    dom.revogarAnteriores.disabled = isGenerating;
  }
}

async function carregarBase() {
  setLoading(true);
  dom.statusGeral.textContent = 'Carregando clientes...';

  try {
    const clientesData = await apiJson(API_CLIENTES);
    state.clientes = extractArray(clientesData, 'items', 'clientes', 'data');

    preencherSelectClientes();

    dom.statusGeral.textContent = state.clientes.length
      ? `${state.clientes.length} cliente(s) carregado(s).`
      : 'Nenhum cliente encontrado.';

    if (state.clientes.length === 1) {
      const unicoCliente = state.clientes[0];

      dom.clienteId.value = String(unicoCliente.id);
      renderClienteResumo(unicoCliente);
      dom.statusGeral.textContent = `Cliente carregado: ${getClienteNome(unicoCliente)}. Carregando dados...`;

      setTimeout(() => {
        selecionarCliente(unicoCliente.id).catch((error) => {
          console.error('[Área Cliente Admin] erro ao selecionar cliente automático:', error);
          toast(error.message || 'Erro ao carregar dados do cliente.', 'error');
        });
      }, 0);
    }
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar base:', error);
    dom.statusGeral.textContent = 'Erro ao carregar clientes.';
    toast(error.message || 'Erro ao carregar clientes.', 'error');
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
  ];

  dom.clienteId.innerHTML = options.join('');
}

async function selecionarCliente(clienteId) {
  const id = String(clienteId || '').trim();

  limparResultadoAcessoGerado();

  if (!id) {
    state.clienteSelecionado = null;
    state.dadosAtuais = null;
    state.acessos = [];
    state.acessoAtivo = null;

    limparFormulario();
    renderClienteResumo(null);
    renderAcessoSemCliente();
    renderHistorico([]);
    dom.historicoCard.hidden = true;
    dom.statusGeral.textContent = 'Selecione um cliente para continuar.';
    return;
  }

  const cliente = state.clientes.find((item) => String(item.id) === id) || null;
  state.clienteSelecionado = cliente;

  renderClienteResumo(cliente);
  dom.statusGeral.textContent = `Cliente selecionado: ${getClienteNome(cliente)}. Carregando dados, acessos e histórico...`;

  dom.acessoCard.hidden = false;
  dom.historicoCard.hidden = false;

  await Promise.allSettled([
    carregarDadosCliente(id),
    carregarAcessosCliente(id),
    carregarHistoricoCliente(id),
  ]);

  dom.statusGeral.textContent = `Cliente selecionado: ${getClienteNome(cliente)}.`;
}

function renderClienteResumo(cliente) {
  if (!cliente) {
    dom.clienteResumo.innerHTML = `
      <div class="cliente-resumo-icon">
        <i class="fa-solid fa-user"></i>
      </div>
      <div>
        <strong>Nenhum cliente selecionado</strong>
        <span>Escolha um cliente para continuar.</span>
      </div>
    `;
    return;
  }

  const nome = getClienteNome(cliente);
  const doc = getClienteDocumento(cliente) || 'Documento não informado';
  const email = getClienteEmail(cliente) || 'E-mail não informado';
  const tel = getClienteTelefone(cliente) || 'Telefone não informado';

  dom.clienteResumo.innerHTML = `
    <div class="cliente-resumo-icon">
      <i class="fa-solid fa-user-check"></i>
    </div>
    <div>
      <strong>${escapeHtml(nome)}</strong>
      <span>${escapeHtml(doc)}</span>
      <span>${escapeHtml(email)} • ${escapeHtml(tel)}</span>
    </div>
  `;
}

function limparFormulario() {
  dom.form.reset();

  byId('tipo_pessoa').value = 'PF';
  byId('status_preenchimento').value = 'rascunho';
  byId('origem_preenchimento').value = 'admin';
  byId('motivo_alteracao').value = '';

  dom.registroMeta.textContent = 'Nenhum cliente selecionado';
}

async function carregarDadosCliente(clienteId) {
  try {
    const data = await apiJson(`${API_AREA_CLIENTE}/clientes/${clienteId}/dados-base`);
    state.dadosAtuais = data || {};
    preencherFormulario(data || {});
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar dados:', error);
    state.dadosAtuais = null;
    limparFormulario();
    toast(error.message || 'Erro ao carregar dados do cliente.', 'error');
  }
}

function preencherFormulario(data) {
  const cliente = state.clienteSelecionado;

  for (const campo of CAMPOS_FORM) {
    const el = byId(campo);
    if (!el) continue;

    const value = data?.[campo];

    if (value !== undefined && value !== null) {
      el.value = String(value);
    } else {
      el.value = '';
    }
  }

  if (!byId('tipo_pessoa').value) byId('tipo_pessoa').value = 'PF';
  if (!byId('status_preenchimento').value) byId('status_preenchimento').value = 'rascunho';
  if (!byId('origem_preenchimento').value) byId('origem_preenchimento').value = 'admin';

  if (!byId('nome_completo').value && cliente) {
    byId('nome_completo').value = getClienteNome(cliente);
  }

  if (!byId('cpf').value && cliente) {
    const doc = getClienteDocumento(cliente);
    if (doc && doc.replace(/\D/g, '').length <= 11) {
      byId('cpf').value = doc;
    }
  }

  if (!byId('cnpj').value && cliente) {
    const doc = getClienteDocumento(cliente);
    if (doc && doc.replace(/\D/g, '').length > 11) {
      byId('cnpj').value = doc;
    }
  }

  if (!byId('email_pessoal').value && cliente) {
    byId('email_pessoal').value = getClienteEmail(cliente);
  }

  if (!byId('telefone_pessoal').value && cliente) {
    byId('telefone_pessoal').value = getClienteTelefone(cliente);
  }

  byId('motivo_alteracao').value = '';

  const id = data?.id;
  const atualizado = data?.atualizado_em || data?.criado_em;

  dom.registroMeta.textContent = id
    ? `Registro #${id}${atualizado ? ` • atualizado em ${formatDateTime(atualizado)}` : ''}`
    : 'Registro ainda não salvo';
}

function montarPayloadDados() {
  const payload = {};

  for (const campo of CAMPOS_FORM) {
    const el = byId(campo);
    if (!el) continue;

    const value = String(el.value || '').trim();
    payload[campo] = value || null;
  }

  payload.tipo_pessoa = payload.tipo_pessoa || 'PF';
  payload.status_preenchimento = payload.status_preenchimento || 'rascunho';
  payload.origem_preenchimento = payload.origem_preenchimento || 'admin';
  payload.motivo_alteracao = String(byId('motivo_alteracao').value || '').trim() || null;

  return payload;
}

async function salvarDados(event) {
  if (event) event.preventDefault();

  if (state.salvando) return;

  const clienteId = String(dom.clienteId.value || '').trim();

  if (!clienteId) {
    toast('Selecione um cliente antes de salvar.', 'error');
    dom.clienteId.focus();
    return;
  }

  const payload = montarPayloadDados();

  setSaving(true);

  try {
    const salvo = await apiJson(`${API_AREA_CLIENTE}/clientes/${clienteId}/dados-base`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    state.dadosAtuais = salvo || {};
    preencherFormulario(salvo || {});
    await carregarHistoricoCliente(clienteId);

    toast('Dados complementares salvos com sucesso.');
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao salvar dados:', error);
    toast(error.message || 'Erro ao salvar dados complementares.', 'error');
  } finally {
    setSaving(false);
  }
}

async function carregarAcessosCliente(clienteId) {
  if (!clienteId) {
    renderAcessoSemCliente();
    return;
  }

  dom.acessosStatus.textContent = 'Carregando acessos...';
  dom.acessosLista.innerHTML = '<div class="history-empty">Carregando acessos provisórios...</div>';

  try {
    const [ativoData, acessosData] = await Promise.all([
      apiJson(`${API_ACESSOS}/clientes/${clienteId}/ativo`),
      apiJson(`${API_ACESSOS}/clientes/${clienteId}/acessos`),
    ]);

    state.acessoAtivo = ativoData?.ativo ? ativoData.acesso : null;
    state.acessos = Array.isArray(acessosData) ? acessosData : [];

    renderAcessoAtivo();
    renderListaAcessos();
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao carregar acessos:', error);
    state.acessoAtivo = null;
    state.acessos = [];
    dom.acessosStatus.textContent = 'Erro ao carregar acessos.';
    dom.acessosLista.innerHTML = '<div class="history-empty">Não foi possível carregar os acessos do cliente.</div>';
    renderAcessoAtivo();
  }
}

function renderAcessoSemCliente() {
  dom.acessoCard.hidden = true;
  dom.acessoStatusBadge.textContent = 'Sem acesso';
  dom.acessoStatusBadge.className = 'soft-badge';
  dom.acessoAtivoBox.className = 'acesso-ativo-box';
  dom.acessoAtivoTitulo.textContent = 'Nenhum cliente selecionado';
  dom.acessoAtivoTexto.textContent = 'Selecione um cliente para verificar ou gerar o acesso provisório.';
  dom.acessosStatus.textContent = 'Selecione um cliente para carregar os acessos.';
  dom.acessosLista.innerHTML = '';
  limparResultadoAcessoGerado();
}

function renderAcessoAtivo() {
  const acesso = state.acessoAtivo;

  dom.acessoAtivoBox.className = acesso
    ? 'acesso-ativo-box is-active'
    : 'acesso-ativo-box';

  if (!acesso) {
    dom.acessoStatusBadge.textContent = 'Sem acesso ativo';
    dom.acessoStatusBadge.className = 'soft-badge';

    dom.acessoAtivoTitulo.textContent = 'Nenhum acesso ativo';
    dom.acessoAtivoTexto.textContent = 'Gere um novo acesso provisório para este cliente.';

    return;
  }

  const status = String(acesso.status || 'pendente').toLowerCase();
  dom.acessoStatusBadge.textContent = acesso.status_label || status;
  dom.acessoStatusBadge.className = `soft-badge is-${status}`;

  dom.acessoAtivoTitulo.textContent = `Acesso ${acesso.status_label || status}`;
  dom.acessoAtivoTexto.textContent = [
    acesso.cliente_codigo ? `Código: ${acesso.cliente_codigo}` : null,
    acesso.token_hint ? `Token: ${acesso.token_hint}` : null,
    acesso.expira_em ? `Expira em: ${formatDateTime(acesso.expira_em)}` : null,
    acesso.criado_por_nome ? `Criado por: ${acesso.criado_por_nome}` : null,
  ].filter(Boolean).join(' • ');
}

function renderListaAcessos() {
  if (!state.acessos.length) {
    dom.acessosStatus.textContent = 'Nenhum acesso gerado para este cliente.';
    dom.acessosLista.innerHTML = '<div class="history-empty">Ainda não há acessos provisórios.</div>';
    return;
  }

  dom.acessosStatus.textContent = `${state.acessos.length} acesso(s) encontrado(s).`;

  dom.acessosLista.innerHTML = state.acessos.map((acesso) => {
    const status = String(acesso.status || '').toLowerCase();
    const podeRevogar = status === 'pendente';

    const meta = [
      acesso.cliente_codigo ? `Código ${acesso.cliente_codigo}` : null,
      acesso.token_hint ? `Token ${acesso.token_hint}` : null,
      acesso.expira_em ? `Expira em ${formatDateTime(acesso.expira_em)}` : null,
      acesso.criado_por_nome ? `Criado por ${acesso.criado_por_nome}` : null,
      acesso.criado_em ? `Criado em ${formatDateTime(acesso.criado_em)}` : null,
    ].filter(Boolean).join(' • ');

    return `
      <article class="acesso-item" data-acesso-id="${escapeHtml(acesso.id)}">
        <div class="acesso-item-main">
          <div class="acesso-item-title">
            <span>Acesso #${escapeHtml(acesso.id)}</span>
            <span class="soft-badge is-${escapeHtml(status)}">${escapeHtml(acesso.status_label || acesso.status)}</span>
          </div>
          <div class="acesso-item-meta">${escapeHtml(meta || 'Sem detalhes.')}</div>
        </div>

        <div class="acesso-item-actions">
          ${podeRevogar ? `
            <button class="btn btn-danger-soft" type="button" data-revogar-acesso="${escapeHtml(acesso.id)}">
              <i class="fa-solid fa-ban"></i>
              Revogar
            </button>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

async function gerarAcessoCliente() {
  if (state.gerandoAcesso) return;

  const clienteId = String(dom.clienteId.value || '').trim();

  if (!clienteId) {
    toast('Selecione um cliente antes de gerar acesso.', 'error');
    dom.clienteId.focus();
    return;
  }

  const expiraEmDias = Number(dom.expiraEmDias.value || 7);
  const baseUrl = String(dom.baseUrlAcesso.value || '').trim() || 'https://segsis.com.br/area-cliente';

  setGenerating(true);

  try {
    const data = await apiJson(`${API_ACESSOS}/clientes/${clienteId}/gerar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expira_em_dias: expiraEmDias,
        base_url: baseUrl,
        revogar_anteriores: Boolean(dom.revogarAnteriores.checked),
      }),
    });

    renderResultadoAcessoGerado(data);
    await carregarAcessosCliente(clienteId);

    toast('Acesso provisório gerado com sucesso.');
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao gerar acesso:', error);
    toast(error.message || 'Erro ao gerar acesso provisório.', 'error');
  } finally {
    setGenerating(false);
  }
}

function renderResultadoAcessoGerado(data) {
  dom.acessoGeradoBox.hidden = false;
  dom.linkPublicoGerado.value = data?.link_publico || '';
  dom.senhaProvisoriaGerada.value = data?.senha_provisoria || '';
  dom.mensagemWhatsappGerada.value = data?.mensagem_whatsapp || '';
}

function limparResultadoAcessoGerado() {
  dom.acessoGeradoBox.hidden = true;
  dom.linkPublicoGerado.value = '';
  dom.senhaProvisoriaGerada.value = '';
  dom.mensagemWhatsappGerada.value = '';
}

async function copiarTexto(texto, label) {
  const value = String(texto || '').trim();

  if (!value) {
    toast(`Nada para copiar em ${label}.`, 'error');
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} copiado.`);
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao copiar:', error);

    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();

    try {
      document.execCommand('copy');
      toast(`${label} copiado.`);
    } catch {
      toast(`Não foi possível copiar ${label}.`, 'error');
    } finally {
      area.remove();
    }
  }
}

async function revogarAcesso(acessoId) {
  if (!acessoId) return;

  const acesso = state.acessos.find((item) => Number(item.id) === Number(acessoId));
  const label = acesso ? `acesso #${acesso.id}` : `acesso #${acessoId}`;

  const confirmar = window.confirm(`Revogar ${label}?`);
  if (!confirmar) return;

  try {
    await apiJson(`${API_ACESSOS}/${acessoId}/revogar`, {
      method: 'POST',
    });

    await carregarAcessosCliente(dom.clienteId.value);

    toast('Acesso revogado com sucesso.');
  } catch (error) {
    console.error('[Área Cliente Admin] erro ao revogar acesso:', error);
    toast(error.message || 'Erro ao revogar acesso.', 'error');
  }
}

async function carregarHistoricoCliente(clienteId) {
  if (!clienteId) {
    renderHistorico([]);
    return;
  }

  dom.historicoLista.innerHTML = '<div class="history-empty">Carregando histórico...</div>';

  try {
    const rows = await apiJson(`${API_AREA_CLIENTE}/clientes/${clienteId}/historico-alteracoes`);
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
    const campo = item.campo || item.tipo || 'dados_complementares';
    const label = HISTORICO_LABELS[campo] || campo;
    const usuario = item.usuario_nome || 'Usuário não informado';

    const hasDiff = item.valor_anterior !== undefined && item.valor_novo !== undefined && item.campo;

    const diff = hasDiff ? `
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
            <div class="history-desc">${escapeHtml(usuario)}</div>
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
  dom.btnRecarregar.addEventListener('click', carregarBase);

  dom.clienteId.addEventListener('change', () => {
    selecionarCliente(dom.clienteId.value);
  });

  dom.btnSalvarTopo.addEventListener('click', () => {
    dom.form.requestSubmit();
  });

  dom.form.addEventListener('submit', salvarDados);

  dom.btnLimparForm.addEventListener('click', () => {
    limparFormulario();

    if (state.clienteSelecionado) {
      preencherFormulario(state.dadosAtuais || {});
    }
  });

  dom.btnGerarAcesso.addEventListener('click', gerarAcessoCliente);

  dom.btnRecarregarAcessos.addEventListener('click', () => {
    const clienteId = String(dom.clienteId.value || '').trim();
    if (clienteId) carregarAcessosCliente(clienteId);
  });

  dom.btnCopiarLink.addEventListener('click', () => {
    copiarTexto(dom.linkPublicoGerado.value, 'Link');
  });

  dom.btnCopiarSenha.addEventListener('click', () => {
    copiarTexto(dom.senhaProvisoriaGerada.value, 'Senha');
  });

  dom.btnCopiarMensagem.addEventListener('click', () => {
    copiarTexto(dom.mensagemWhatsappGerada.value, 'Mensagem');
  });

  dom.acessosLista.addEventListener('click', (event) => {
    const btnRevogar = event.target.closest('[data-revogar-acesso]');
    if (!btnRevogar) return;

    revogarAcesso(btnRevogar.dataset.revogarAcesso);
  });

  dom.btnRecarregarHistorico.addEventListener('click', () => {
    const clienteId = String(dom.clienteId.value || '').trim();
    if (clienteId) carregarHistoricoCliente(clienteId);
  });
}

async function boot() {
  initDom();
  bindEvents();
  limparFormulario();
  renderAcessoSemCliente();

  await carregarBase();

  const url = new URL(window.location.href);
  const clienteId = url.searchParams.get('cliente_id') || url.searchParams.get('cliente');

  if (clienteId) {
    dom.clienteId.value = String(clienteId);

    setTimeout(() => {
      selecionarCliente(clienteId).catch((error) => {
        console.error('[Área Cliente Admin] erro ao selecionar cliente pela URL:', error);
        toast(error.message || 'Erro ao carregar cliente.', 'error');
      });
    }, 0);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  boot().catch((error) => {
    console.error('[Área Cliente Admin] falha no boot:', error);
    toast(error.message || 'Erro ao iniciar Área do Cliente.', 'error');
  });
});