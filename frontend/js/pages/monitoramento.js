const API_BASE = '/api/monitoramento';

const state = {
  moduloAtivo: false,
  contas: [],
  contasBase: [],
  contaAtual: null,
  detailConta: null,
  editandoId: null,
  contatoEditandoId: null,
};

function $(id) {
  return document.getElementById(id);
}

function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toast(message, type = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }

  const el = $('valora-toast');
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message || '';
  el.classList.remove('is-error');

  if (type === 'error') {
    el.classList.add('is-error');
  }

  el.classList.add('show');

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.classList.remove('show');
  }, 2800);
}

async function apiJson(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await resp.text();

  if (!resp.ok) {
    let message = text || 'Erro na requisição.';

    try {
      const parsed = JSON.parse(text);
      message = parsed.detail || message;
    } catch (_) {}

    throw new Error(message);
  }

  if (!text || resp.status === 204) return null;

  return JSON.parse(text);
}

function openModal(id) {
  if (window.ValoraModal) return window.ValoraModal.open(id);
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));
}

function closeModal(id) {
  if (window.ValoraModal) return window.ValoraModal.close(id);
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; modal.style.display = 'none'; }, 160);
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;

  if (el.type === 'checkbox') {
    el.checked = !!value;
    return;
  }

  el.value = value ?? '';
}

function getValue(id) {
  const el = $(id);
  if (!el) return '';

  if (el.type === 'checkbox') {
    return !!el.checked;
  }

  return el.value ?? '';
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function buildQuery(params) {
  const qs = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      qs.set(key, value);
    }
  });

  const out = qs.toString();

  return out ? `?${out}` : '';
}

function showListView() {
  $('monitoramento-list-view').hidden = false;
  $('monitoramento-detail-view').hidden = true;
}

function showDetailView() {
  $('monitoramento-list-view').hidden = true;
  $('monitoramento-detail-view').hidden = false;
}

function switchTab(tabId) {
  $$('.cliente-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  $$('.cliente-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === tabId);
  });
}

function switchDetailTab(tabId) {
  $$('.detail-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.detailTab === tabId);
  });

  $$('.detail-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === tabId);
  });
}

async function carregarStatusModulo() {
  const data = await apiJson(`${API_BASE}/modulo`);
  state.moduloAtivo = !!data.ativo;
}

function getFiltros() {
  return {
    busca: String(getValue('filtro-monitoramento-busca') || '').trim(),
    status_monitoramento: String(getValue('filtro-monitoramento-status') || '').trim(),
    ativo: String(getValue('filtro-monitoramento-ativo') || '').trim(),
    cidade: String(getValue('filtro-monitoramento-cidade') || '').trim(),
  };
}

async function carregarContas() {
  const tbody = $('tbody-monitoramento');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">Carregando...</td>
      </tr>
    `;
  }

  const filtros = getFiltros();

  const data = await apiJson(`${API_BASE}/contas${buildQuery({
    busca: filtros.busca,
    status_monitoramento: filtros.status_monitoramento,
    ativo: filtros.ativo,
    limit: 500,
  })}`);

  state.contasBase = Array.isArray(data) ? data : [];
  aplicarFiltrosLocais();
}

function aplicarFiltrosLocais() {
  const filtros = getFiltros();
  const cidade = normalizeText(filtros.cidade);

  let lista = [...state.contasBase];

  if (cidade) {
    lista = lista.filter((conta) => normalizeText(conta.cliente_cidade).includes(cidade));
  }

  state.contas = lista;

  renderContas();
  renderContador();
}

function renderContador() {
  const total = state.contas.length;
  const counter = $('monitoramento-counter');

  if (counter) {
    counter.textContent = `${total} ${total === 1 ? 'conta' : 'contas'}`;
  }
}

function renderStatus(conta) {
  if (conta.monitoramento_habilitado) {
    return `<span class="badge-status ativo">Habilitado</span>`;
  }

  return `<span class="badge-status inativo">Desabilitado</span>`;
}

function formatCidadeUf(conta) {
  return [conta.cliente_cidade, conta.cliente_estado].filter(Boolean).join(' / ') || '-';
}

function formatContato(conta) {
  return conta.cliente_whatsapp || conta.cliente_telefone || '-';
}

function resumoRota(conta) {
  const linhas = [];

  if (conta.rota_1) linhas.push(escapeHtml(conta.rota_1));
  if (conta.nivel_risco) linhas.push(escapeHtml(conta.nivel_risco));

  return linhas.length ? linhas.join('<br>') : '<span class="subtle">-</span>';
}

function renderContas() {
  const tbody = $('tbody-monitoramento');
  if (!tbody) return;

  if (!state.contas.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          Nenhuma conta de monitoramento encontrada.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.contas.map((conta) => {
    const clienteNome = conta.cliente_nome || conta.cliente_nome_fantasia || '-';
    const contaCodigo = conta.codigo_conta || conta.cliente_codigo || '-';

    return `
      <tr>
        <td>
          <span class="badge-codigo">${escapeHtml(contaCodigo)}</span>
        </td>

        <td>
          <div class="monitoramento-client-cell">
            <strong>${escapeHtml(clienteNome)}</strong>
            <span>${escapeHtml(conta.cliente_codigo || '')}</span>
          </div>
        </td>

        <td>${renderStatus(conta)}</td>

        <td>${escapeHtml(conta.grupo_cliente || '-')}</td>

        <td>${escapeHtml(formatCidadeUf(conta))}</td>

        <td>${escapeHtml(formatContato(conta))}</td>

        <td>${resumoRota(conta)}</td>

        <td>
          <div class="monitoramento-mini-counts">
            <span>${Number(conta.total_contatos || 0)} contatos</span>
            <span>${Number(conta.total_produtos || 0)} produtos</span>
            <span>${Number(conta.total_caracteristicas || 0)} caract.</span>
          </div>
        </td>

        <td class="text-right">
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn-icon" type="button" data-action="abrir-conta" data-id="${conta.id}" title="Abrir">
              <i class="fa-solid fa-eye"></i>
            </button>

            <button class="btn-icon" type="button" data-action="editar-conta" data-id="${conta.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>

            <button class="btn-icon danger" type="button" data-action="excluir-conta" data-id="${conta.id}" title="Excluir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function buscarClientes() {
  const termo = String(getValue('mon-cliente-busca') || '').trim();
  const select = $('mon-cliente-id');

  if (!select) return;

  select.innerHTML = '<option value="">Carregando...</option>';

  try {
    const clientes = await apiJson(`${API_BASE}/clientes${buildQuery({ busca: termo, limit: 50 })}`);

    if (!Array.isArray(clientes) || !clientes.length) {
      select.innerHTML = '<option value="">Nenhum cliente encontrado</option>';
      return;
    }

    select.innerHTML = [
      '<option value="">Selecione um cliente</option>',
      ...clientes.map((c) => {
        const nome = c.nome || c.nome_fantasia || 'Cliente sem nome';
        const meta = [c.codigo, c.telefone || c.whatsapp, c.cidade].filter(Boolean).join(' • ');

        return `
          <option value="${c.id}">
            ${escapeHtml(nome)}${meta ? ` — ${escapeHtml(meta)}` : ''}
          </option>
        `;
      }),
    ].join('');
  } catch (err) {
    select.innerHTML = '<option value="">Erro ao buscar clientes</option>';
    toast(err.message || 'Erro ao buscar clientes.', 'error');
  }
}

function limparFormularioConta() {
  state.editandoId = null;
  state.contaAtual = null;

  $('formMonitoramento')?.reset();

  setValue('mon-cliente-busca', '');
  setValue('mon-cliente-id', '');
  setValue('mon-sistema-origem', 'segware');
  setValue('mon-status-monitoramento', 'habilitado');
  setValue('mon-monitoramento-habilitado', true);
  setValue('mon-ativo', true);

  $('lista-monitoramento-contatos').innerHTML = '';
  $('lista-monitoramento-produtos').innerHTML = '';
  $('lista-monitoramento-caracteristicas').innerHTML = '';

  limparFormProduto();
  limparFormCaracteristica();

  switchTab('tab-monitoramento-conta');
}

function montarPayloadConta() {
  return {
    cliente_id: Number(getValue('mon-cliente-id') || 0),

    codigo_conta: String(getValue('mon-codigo-conta') || '').trim(),
    sistema_origem: String(getValue('mon-sistema-origem') || 'segware').trim(),

    grupo_cliente: String(getValue('mon-grupo-cliente') || '').trim(),
    empresa_monitoramento: String(getValue('mon-empresa-monitoramento') || '').trim(),

    monitoramento_habilitado: !!getValue('mon-monitoramento-habilitado'),
    status_monitoramento: String(getValue('mon-status-monitoramento') || '').trim(),

    data_cadastro: String(getValue('mon-data-cadastro') || '').trim(),

    nome_responsavel: String(getValue('mon-nome-responsavel') || '').trim(),
    email_responsavel: String(getValue('mon-email-responsavel') || '').trim(),

    contrato: String(getValue('mon-contrato') || '').trim(),

    rota_1: String(getValue('mon-rota-1') || '').trim(),
    rota_2: String(getValue('mon-rota-2') || '').trim(),
    ramo_atividade: String(getValue('mon-ramo-atividade') || '').trim(),
    instalador: String(getValue('mon-instalador') || '').trim(),
    vendedor: String(getValue('mon-vendedor') || '').trim(),
    nivel_risco: String(getValue('mon-nivel-risco') || '').trim(),

    possui_chaves: !!getValue('mon-possui-chaves'),
    numero_chaveiro: String(getValue('mon-numero-chaveiro') || '').trim(),

    latitude: String(getValue('mon-latitude') || '').trim(),
    longitude: String(getValue('mon-longitude') || '').trim(),

    referencia_localizacao: String(getValue('mon-referencia-localizacao') || '').trim(),
    informacoes_adicionais: String(getValue('mon-informacoes-adicionais') || '').trim(),
    providencias_local: String(getValue('mon-providencias-local') || '').trim(),
    observacoes: String(getValue('mon-observacoes') || '').trim(),

    ativo: !!getValue('mon-ativo'),
  };
}

function preencherFormularioConta(conta) {
  state.contaAtual = conta;
  state.editandoId = conta.id;

  const clienteLabel = [
    conta.cliente_nome || conta.cliente_nome_fantasia || 'Cliente',
    conta.cliente_codigo ? `Código ${conta.cliente_codigo}` : '',
    conta.cliente_cidade || '',
  ].filter(Boolean).join(' • ');

  $('mon-cliente-id').innerHTML = `
    <option value="${conta.cliente_id}" selected>${escapeHtml(clienteLabel)}</option>
  `;

  setValue('mon-cliente-busca', conta.cliente_nome || '');
  setValue('mon-codigo-conta', conta.codigo_conta);
  setValue('mon-sistema-origem', conta.sistema_origem || 'segware');

  setValue('mon-grupo-cliente', conta.grupo_cliente);
  setValue('mon-empresa-monitoramento', conta.empresa_monitoramento);

  setValue('mon-monitoramento-habilitado', !!conta.monitoramento_habilitado);
  setValue('mon-status-monitoramento', conta.status_monitoramento || 'habilitado');

  setValue('mon-data-cadastro', conta.data_cadastro || '');

  setValue('mon-nome-responsavel', conta.nome_responsavel);
  setValue('mon-email-responsavel', conta.email_responsavel);

  setValue('mon-contrato', conta.contrato);

  setValue('mon-rota-1', conta.rota_1);
  setValue('mon-rota-2', conta.rota_2);
  setValue('mon-ramo-atividade', conta.ramo_atividade);
  setValue('mon-instalador', conta.instalador);
  setValue('mon-vendedor', conta.vendedor);
  setValue('mon-nivel-risco', conta.nivel_risco);

  setValue('mon-possui-chaves', !!conta.possui_chaves);
  setValue('mon-numero-chaveiro', conta.numero_chaveiro);

  setValue('mon-latitude', conta.latitude);
  setValue('mon-longitude', conta.longitude);

  setValue('mon-referencia-localizacao', conta.referencia_localizacao);
  setValue('mon-informacoes-adicionais', conta.informacoes_adicionais);
  setValue('mon-providencias-local', conta.providencias_local);
  setValue('mon-observacoes', conta.observacoes);

  setValue('mon-ativo', conta.ativo !== false);

  renderContatosResumo(conta.contatos || []);
  renderProdutos(conta.produtos || []);
  renderCaracteristicas(conta.caracteristicas || []);
}

async function abrirNovaConta() {
  limparFormularioConta();

  $('modal-monitoramento-titulo').textContent = 'Nova conta de monitoramento';

  await buscarClientes();

  openModal('modal-monitoramento-backdrop');
}

async function abrirEditarConta(id) {
  try {
    limparFormularioConta();

    const conta = await apiJson(`${API_BASE}/contas/${id}`);

    $('modal-monitoramento-titulo').textContent = `Conta ${conta.codigo_conta || conta.id}`;

    preencherFormularioConta(conta);
    openModal('modal-monitoramento-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar conta.', 'error');
  }
}

async function salvarConta() {
  const payload = montarPayloadConta();

  if (!payload.cliente_id) {
    toast('Selecione o cliente vinculado.', 'error');
    return;
  }

  const btn = $('btn-salvar-monitoramento');
  const original = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    const url = state.editandoId
      ? `${API_BASE}/contas/${state.editandoId}`
      : `${API_BASE}/contas`;

    const method = state.editandoId ? 'PUT' : 'POST';

    const conta = await apiJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    preencherFormularioConta(conta);

    await carregarContas();

    if (state.detailConta && state.detailConta.id === conta.id) {
      await abrirDetalheConta(conta.id, false);
    }

    toast('Conta salva com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar conta.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function excluirConta(id) {
  const ok = confirm('Deseja realmente excluir esta conta de monitoramento?');
  if (!ok) return;

  try {
    await apiJson(`${API_BASE}/contas/${id}`, { method: 'DELETE' });

    if (state.detailConta && state.detailConta.id === id) {
      showListView();
      state.detailConta = null;
    }

    toast('Conta excluída.', 'success');
    await carregarContas();
  } catch (err) {
    toast(err.message || 'Erro ao excluir conta.', 'error');
  }
}

/* =========================================================
   DETALHE DA CONTA
========================================================= */

async function abrirDetalheConta(id, mudarTela = true) {
  try {
    const conta = await apiJson(`${API_BASE}/contas/${id}`);
    state.detailConta = conta;

    renderDetalheConta(conta);

    if (mudarTela) {
      showDetailView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  } catch (err) {
    toast(err.message || 'Erro ao abrir conta.', 'error');
  }
}

function renderDetalheConta(conta) {
  const clienteNome = conta.cliente_nome || conta.cliente_nome_fantasia || 'Cliente';
  const codigoConta = conta.codigo_conta || conta.cliente_codigo || conta.id;

  $('detail-cliente-nome').textContent = clienteNome;
  $('detail-cliente-subtitle').textContent = `${conta.cliente_codigo || ''} ${conta.sistema_origem ? `• Origem: ${conta.sistema_origem}` : ''}`.trim();
  $('detail-conta-codigo').textContent = codigoConta || '-';
  $('detail-grupo-cliente').textContent = conta.grupo_cliente || '-';
  $('detail-status-monitoramento').textContent = conta.monitoramento_habilitado ? 'Habilitado' : 'Desabilitado';
  $('detail-cidade-uf').textContent = formatCidadeUf({
    cliente_cidade: conta.cliente_cidade,
    cliente_estado: conta.cliente_estado,
  });

  $('detail-contatos-title').textContent = `Conta ${codigoConta} > Usuários e contatos`;

  renderTabelaContatosDetalhe(conta.contatos || []);
  renderDadosContaDetalhe(conta);
  renderProdutosDetalhe(conta.produtos || []);
  renderCaracteristicasDetalhe(conta.caracteristicas || []);
}

function renderTabelaContatosDetalhe(contatos) {
  const tbody = $('tbody-detail-contatos');
  if (!tbody) return;

  if (!contatos.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" class="empty-state">
          Nenhum contato cadastrado para esta conta.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = contatos.map((contato) => {
    const ativo = contato.ativo !== false;
    const w1 = Boolean(String(contato.whatsapp_1 || '').trim());
    const w2 = Boolean(String(contato.whatsapp_2 || '').trim());

    return `
      <tr>
        <td>
          <span class="contato-status-icon ${ativo ? '' : 'off'}">
            <i class="fa-solid ${ativo ? 'fa-check' : 'fa-minus'}"></i>
          </span>
        </td>

        <td>${escapeHtml(contato.lista ?? '-')}</td>
        <td>${escapeHtml(contato.prioridade ?? '-')}</td>
        <td><strong>${escapeHtml(contato.nome || '-')}</strong></td>
        <td>${escapeHtml(contato.funcao || '-')}</td>
        <td>${escapeHtml(contato.codigo_painel || '-')}</td>
        <td>${escapeHtml(contato.telefone_1 || '-')}</td>

        <td>
          ${w1 ? '<i class="fa-brands fa-whatsapp whatsapp-check"></i>' : '<span class="whatsapp-empty">-</span>'}
        </td>

        <td>${escapeHtml(contato.telefone_2 || '-')}</td>

        <td>
          ${w2 ? '<i class="fa-brands fa-whatsapp whatsapp-check"></i>' : '<span class="whatsapp-empty">-</span>'}
        </td>

        <td class="text-right">
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn-icon" type="button" data-action="editar-contato" data-id="${contato.id}" title="Editar contato">
              <i class="fa-solid fa-pen"></i>
            </button>

            <button class="btn-icon danger" type="button" data-action="excluir-contato" data-id="${contato.id}" title="Excluir contato">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderDadosContaDetalhe(conta) {
  const grid = $('detail-dados-grid');
  if (!grid) return;

  const itens = [
    ['Conta', conta.codigo_conta],
    ['Origem', conta.sistema_origem],
    ['Grupo', conta.grupo_cliente],
    ['Status', conta.status_monitoramento],
    ['Contrato', conta.contrato],
    ['Responsável', conta.nome_responsavel],
    ['E-mail responsável', conta.email_responsavel],
    ['Rota 1', conta.rota_1],
    ['Rota 2', conta.rota_2],
    ['Ramo de atividade', conta.ramo_atividade],
    ['Instalador', conta.instalador],
    ['Vendedor', conta.vendedor],
    ['Nível de risco', conta.nivel_risco],
    ['Chaves do local', conta.possui_chaves ? 'Sim' : 'Não'],
    ['Número do chaveiro', conta.numero_chaveiro],
    ['Latitude', conta.latitude],
    ['Longitude', conta.longitude],
  ];

  grid.innerHTML = itens.map(([label, value]) => `
    <div class="detail-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
    </div>
  `).join('');
}

function renderProdutosDetalhe(produtos) {
  const wrap = $('detail-produtos-list');
  if (!wrap) return;

  if (!produtos.length) {
    wrap.innerHTML = '<div class="empty-soft">Nenhum produto/equipamento cadastrado nesta conta.</div>';
    return;
  }

  wrap.innerHTML = produtos.map((item) => `
    <div class="monitoramento-list-card">
      <div>
        <strong>${escapeHtml(item.nome_produto || 'Produto sem nome')}</strong>
        <p>
          ${item.codigo_produto ? `Código: ${escapeHtml(item.codigo_produto)} • ` : ''}
          ${item.marca ? `Marca: ${escapeHtml(item.marca)} • ` : ''}
          ${item.grupo_produto ? `Grupo: ${escapeHtml(item.grupo_produto)} • ` : ''}
          ${item.valor ? `Valor: ${escapeHtml(item.valor)}` : 'Valor: 0'}
        </p>
      </div>
    </div>
  `).join('');
}

function renderCaracteristicasDetalhe(caracteristicas) {
  const wrap = $('detail-caracteristicas-list');
  if (!wrap) return;

  if (!caracteristicas.length) {
    wrap.innerHTML = '<div class="empty-soft">Nenhuma característica cadastrada nesta conta.</div>';
    return;
  }

  wrap.innerHTML = caracteristicas.map((item) => `
    <div class="monitoramento-list-card">
      <div>
        <strong>${escapeHtml(item.nome || 'Característica')}</strong>
        <p>
          ${item.codigo ? `Código: ${escapeHtml(item.codigo)} • ` : ''}
          ${item.grupo ? `Grupo: ${escapeHtml(item.grupo)} • ` : ''}
          ${item.habilitado ? 'Habilitado' : 'Desabilitado'}
        </p>
      </div>
    </div>
  `).join('');
}

/* =========================================================
   CONTATOS
========================================================= */

function limparFormularioContato() {
  state.contatoEditandoId = null;

  $('formContatoMonitoramento')?.reset();

  setValue('contato-id', '');
  setValue('contato-ativo', true);
  setValue('contato-lista', '');
  setValue('contato-prioridade', '');
  setValue('contato-nome', '');
  setValue('contato-funcao', '');
  setValue('contato-codigo-painel', '');
  setValue('contato-telefone-1', '');
  setValue('contato-whatsapp-1', false);
  setValue('contato-telefone-2', '');
  setValue('contato-whatsapp-2', false);
  setValue('contato-observacoes', '');
}

function abrirNovoContato() {
  if (!state.detailConta) {
    toast('Abra uma conta antes de adicionar contato.', 'error');
    return;
  }

  limparFormularioContato();
  $('modal-contato-titulo').textContent = 'Novo contato';
  openModal('modal-contato-backdrop');
}

function abrirEditarContato(id) {
  if (!state.detailConta) return;

  const contato = (state.detailConta.contatos || []).find((item) => Number(item.id) === Number(id));

  if (!contato) {
    toast('Contato não encontrado.', 'error');
    return;
  }

  state.contatoEditandoId = contato.id;

  setValue('contato-id', contato.id);
  setValue('contato-ativo', contato.ativo !== false);
  setValue('contato-lista', contato.lista ?? '');
  setValue('contato-prioridade', contato.prioridade ?? '');
  setValue('contato-nome', contato.nome || '');
  setValue('contato-funcao', contato.funcao || '');
  setValue('contato-codigo-painel', contato.codigo_painel || '');
  setValue('contato-telefone-1', contato.telefone_1 || '');
  setValue('contato-whatsapp-1', Boolean(String(contato.whatsapp_1 || '').trim()));
  setValue('contato-telefone-2', contato.telefone_2 || '');
  setValue('contato-whatsapp-2', Boolean(String(contato.whatsapp_2 || '').trim()));
  setValue('contato-observacoes', contato.observacoes || '');

  $('modal-contato-titulo').textContent = 'Editar contato';
  openModal('modal-contato-backdrop');
}

function montarPayloadContato() {
  return {
    ativo: !!getValue('contato-ativo'),
    lista: getValue('contato-lista') ? Number(getValue('contato-lista')) : null,
    prioridade: getValue('contato-prioridade') ? Number(getValue('contato-prioridade')) : null,

    nome: String(getValue('contato-nome') || '').trim(),
    funcao: String(getValue('contato-funcao') || '').trim(),
    codigo_painel: String(getValue('contato-codigo-painel') || '').trim(),

    telefone_1: String(getValue('contato-telefone-1') || '').trim(),
    whatsapp_1: getValue('contato-whatsapp-1') ? 'sim' : '',

    telefone_2: String(getValue('contato-telefone-2') || '').trim(),
    whatsapp_2: getValue('contato-whatsapp-2') ? 'sim' : '',

    observacoes: String(getValue('contato-observacoes') || '').trim(),
  };
}

async function salvarContato() {
  if (!state.detailConta) {
    toast('Abra uma conta antes de salvar contato.', 'error');
    return;
  }

  const payload = montarPayloadContato();

  if (!payload.nome) {
    toast('Informe o nome do contato.', 'error');
    return;
  }

  const btn = $('btn-salvar-contato');
  const original = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

    if (state.contatoEditandoId) {
      await apiJson(`${API_BASE}/contatos/${state.contatoEditandoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await apiJson(`${API_BASE}/contas/${state.detailConta.id}/contatos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    closeModal('modal-contato-backdrop');

    await abrirDetalheConta(state.detailConta.id, false);
    await carregarContas();

    toast('Contato salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar contato.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function excluirContato(id) {
  const ok = confirm('Deseja realmente excluir este contato?');
  if (!ok) return;

  try {
    await apiJson(`${API_BASE}/contatos/${id}`, { method: 'DELETE' });

    if (state.detailConta) {
      await abrirDetalheConta(state.detailConta.id, false);
    }

    await carregarContas();

    toast('Contato excluído.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir contato.', 'error');
  }
}

function renderContatosResumo(items) {
  const wrap = $('lista-monitoramento-contatos');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-soft">Nenhum contato cadastrado nesta conta.</div>';
    return;
  }

  wrap.innerHTML = items.map((item) => `
    <div class="monitoramento-list-card">
      <div>
        <strong>${escapeHtml(item.nome || 'Contato sem nome')}</strong>
        <p>
          ${escapeHtml(item.funcao || '-')}
          ${item.codigo_painel ? ` • Código painel: ${escapeHtml(item.codigo_painel)}` : ''}
          ${item.telefone_1 ? ` • Fone 1: ${escapeHtml(item.telefone_1)}` : ''}
          ${item.telefone_2 ? ` • Fone 2: ${escapeHtml(item.telefone_2)}` : ''}
          ${item.lista ? ` • Lista: ${escapeHtml(item.lista)}` : ''}
          ${item.prioridade ? ` • Prioridade: ${escapeHtml(item.prioridade)}` : ''}
        </p>
      </div>
    </div>
  `).join('');
}

/* =========================================================
   PRODUTOS / CARACTERÍSTICAS
========================================================= */

function renderProdutos(items) {
  const wrap = $('lista-monitoramento-produtos');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-soft">Nenhum produto/equipamento cadastrado nesta conta.</div>';
    return;
  }

  wrap.innerHTML = items.map((item) => `
    <div class="monitoramento-list-card">
      <div>
        <strong>${escapeHtml(item.nome_produto || 'Produto sem nome')}</strong>
        <p>
          ${item.codigo_produto ? `Código: ${escapeHtml(item.codigo_produto)} • ` : ''}
          ${item.marca ? `Marca: ${escapeHtml(item.marca)} • ` : ''}
          ${item.grupo_produto ? `Grupo: ${escapeHtml(item.grupo_produto)} • ` : ''}
          ${item.valor ? `Valor: ${escapeHtml(item.valor)}` : 'Valor: 0'}
        </p>
      </div>

      <div class="monitoramento-list-actions">
        <button type="button" class="btn-icon danger" data-delete-produto="${item.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function renderCaracteristicas(items) {
  const wrap = $('lista-monitoramento-caracteristicas');
  if (!wrap) return;

  if (!items.length) {
    wrap.innerHTML = '<div class="empty-soft">Nenhuma característica cadastrada nesta conta.</div>';
    return;
  }

  wrap.innerHTML = items.map((item) => `
    <div class="monitoramento-list-card">
      <div>
        <strong>${escapeHtml(item.nome || 'Característica')}</strong>
        <p>
          ${item.codigo ? `Código: ${escapeHtml(item.codigo)} • ` : ''}
          ${item.grupo ? `Grupo: ${escapeHtml(item.grupo)} • ` : ''}
          ${item.habilitado ? 'Habilitado' : 'Desabilitado'}
        </p>
      </div>

      <div class="monitoramento-list-actions">
        <button type="button" class="btn-icon danger" data-delete-caracteristica="${item.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function limparFormProduto() {
  [
    'mon-produto-codigo',
    'mon-produto-nome',
    'mon-produto-valor',
    'mon-produto-marca',
    'mon-produto-grupo',
  ].forEach((id) => setValue(id, ''));
}

function limparFormCaracteristica() {
  [
    'mon-caracteristica-codigo',
    'mon-caracteristica-nome',
    'mon-caracteristica-grupo',
  ].forEach((id) => setValue(id, ''));
}

async function recarregarContaAtual() {
  const contaId = state.editandoId || (state.detailConta && state.detailConta.id);

  if (!contaId) return;

  const conta = await apiJson(`${API_BASE}/contas/${contaId}`);

  if (state.editandoId) {
    preencherFormularioConta(conta);
  }

  if (state.detailConta && state.detailConta.id === conta.id) {
    state.detailConta = conta;
    renderDetalheConta(conta);
  }

  await carregarContas();
}

async function adicionarProduto() {
  if (!state.editandoId) {
    toast('Salve a conta antes de adicionar produtos.', 'error');
    return;
  }

  const payload = {
    codigo_produto: String(getValue('mon-produto-codigo') || '').trim(),
    nome_produto: String(getValue('mon-produto-nome') || '').trim(),
    valor: getValue('mon-produto-valor') ? Number(getValue('mon-produto-valor')) : 0,
    marca: String(getValue('mon-produto-marca') || '').trim(),
    grupo_produto: String(getValue('mon-produto-grupo') || '').trim(),
    habilitado: true,
  };

  if (!payload.nome_produto) {
    toast('Informe o nome do produto.', 'error');
    return;
  }

  try {
    await apiJson(`${API_BASE}/contas/${state.editandoId}/produtos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    limparFormProduto();
    await recarregarContaAtual();

    toast('Produto adicionado.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao adicionar produto.', 'error');
  }
}

async function adicionarCaracteristica() {
  if (!state.editandoId) {
    toast('Salve a conta antes de adicionar características.', 'error');
    return;
  }

  const payload = {
    codigo: String(getValue('mon-caracteristica-codigo') || '').trim(),
    nome: String(getValue('mon-caracteristica-nome') || '').trim(),
    grupo: String(getValue('mon-caracteristica-grupo') || '').trim(),
    exibe_monitoramento: true,
    habilitado: true,
  };

  if (!payload.nome) {
    toast('Informe o nome da característica.', 'error');
    return;
  }

  try {
    await apiJson(`${API_BASE}/contas/${state.editandoId}/caracteristicas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    limparFormCaracteristica();
    await recarregarContaAtual();

    toast('Característica adicionada.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao adicionar característica.', 'error');
  }
}

async function deleteNested(url, successMessage) {
  const ok = confirm('Deseja remover este item?');
  if (!ok) return;

  try {
    await apiJson(url, { method: 'DELETE' });

    await recarregarContaAtual();

    toast(successMessage, 'success');
  } catch (err) {
    toast(err.message || 'Erro ao remover item.', 'error');
  }
}

function limparFiltros() {
  setValue('filtro-monitoramento-busca', '');
  setValue('filtro-monitoramento-status', '');
  setValue('filtro-monitoramento-ativo', '');
  setValue('filtro-monitoramento-cidade', '');
}

/* =========================================================
   EVENTOS
========================================================= */

function bindEvents() {
  $('btn-atualizar-monitoramento')?.addEventListener('click', carregarContas);
  $('btn-filtrar-monitoramento')?.addEventListener('click', carregarContas);

  $('btn-limpar-monitoramento')?.addEventListener('click', async () => {
    limparFiltros();
    await carregarContas();
  });

  ['filtro-monitoramento-busca', 'filtro-monitoramento-cidade'].forEach((id) => {
    $(id)?.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await carregarContas();
      }
    });
  });

  $('btn-nova-conta-monitoramento')?.addEventListener('click', abrirNovaConta);

  $('btn-fechar-modal-monitoramento')?.addEventListener('click', () => {
    closeModal('modal-monitoramento-backdrop');
  });

  $('btn-cancelar-monitoramento')?.addEventListener('click', () => {
    closeModal('modal-monitoramento-backdrop');
  });

  $('modal-monitoramento-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('modal-monitoramento-backdrop')) {
      closeModal('modal-monitoramento-backdrop');
    }
  });

  $('btn-salvar-monitoramento')?.addEventListener('click', salvarConta);
  $('btn-buscar-cliente-monitoramento')?.addEventListener('click', buscarClientes);

  $('mon-cliente-busca')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      buscarClientes();
    }
  });

  $$('.cliente-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  $$('.detail-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchDetailTab(btn.dataset.detailTab));
  });

  $('btn-add-produto-monitoramento')?.addEventListener('click', adicionarProduto);
  $('btn-add-caracteristica-monitoramento')?.addEventListener('click', adicionarCaracteristica);

  $('btn-voltar-monitoramento')?.addEventListener('click', () => {
    showListView();
  });

  $('btn-atualizar-conta-detail')?.addEventListener('click', async () => {
    if (state.detailConta) {
      await abrirDetalheConta(state.detailConta.id, false);
      toast('Conta atualizada.', 'success');
    }
  });

  $('btn-editar-conta-detail')?.addEventListener('click', async () => {
    if (state.detailConta) {
      await abrirEditarConta(state.detailConta.id);
    }
  });

  $('btn-novo-contato-detail')?.addEventListener('click', abrirNovoContato);

  $('btn-ir-contatos-detail')?.addEventListener('click', async () => {
    if (!state.editandoId) {
      toast('Salve ou abra uma conta antes de ver a tabela completa.', 'error');
      return;
    }

    closeModal('modal-monitoramento-backdrop');
    await abrirDetalheConta(state.editandoId, true);
    switchDetailTab('detail-tab-contatos');
  });

  $('btn-fechar-modal-contato')?.addEventListener('click', () => {
    closeModal('modal-contato-backdrop');
  });

  $('btn-cancelar-contato')?.addEventListener('click', () => {
    closeModal('modal-contato-backdrop');
  });

  $('modal-contato-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('modal-contato-backdrop')) {
      closeModal('modal-contato-backdrop');
    }
  });

  $('btn-salvar-contato')?.addEventListener('click', salvarContato);

  $('tbody-monitoramento')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id || 0);
    if (!id) return;

    if (btn.dataset.action === 'abrir-conta') {
      await abrirDetalheConta(id, true);
      return;
    }

    if (btn.dataset.action === 'editar-conta') {
      await abrirEditarConta(id);
      return;
    }

    if (btn.dataset.action === 'excluir-conta') {
      await excluirConta(id);
    }
  });

  $('tbody-detail-contatos')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id || 0);
    if (!id) return;

    if (btn.dataset.action === 'editar-contato') {
      abrirEditarContato(id);
      return;
    }

    if (btn.dataset.action === 'excluir-contato') {
      await excluirContato(id);
    }
  });

  document.addEventListener('click', async (event) => {
    const produto = event.target.closest('[data-delete-produto]');
    if (produto) {
      await deleteNested(`${API_BASE}/produtos/${produto.dataset.deleteProduto}`, 'Produto removido.');
      return;
    }

    const caracteristica = event.target.closest('[data-delete-caracteristica]');
    if (caracteristica) {
      await deleteNested(`${API_BASE}/caracteristicas/${caracteristica.dataset.deleteCaracteristica}`, 'Característica removida.');
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();

  try {
    await carregarStatusModulo();

    if (!state.moduloAtivo) {
      $('tbody-monitoramento').innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            Módulo Monitoramento não está ativo para esta empresa.
          </td>
        </tr>
      `;

      renderContador();
      return;
    }

    await carregarContas();
  } catch (err) {
    toast(err.message || 'Erro ao iniciar módulo de monitoramento.', 'error');

    $('tbody-monitoramento').innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          ${escapeHtml(err.message || 'Erro ao iniciar módulo.')}
        </td>
      </tr>
    `;

    renderContador();
  }
});