(() => {
  'use strict';

  const API_BASE = '/api/formularios';

  /*
    IMPORTANTE:
    Aqui deixei customEndpoint como null para todos os módulos.
    Assim o Formulários não tenta buscar rotas que não existem,
    como /api/campos-fornecedores, e não trava a tela.
  */
  const MODULOS = {
    clientes: {
      label: 'Clientes',
      icon: 'fa-user-group',
      customEndpoint: null,
    },
    fornecedores: {
      label: 'Fornecedores',
      icon: 'fa-truck',
      customEndpoint: null,
    },
    produtos: {
      label: 'Produtos',
      icon: 'fa-box-open',
      customEndpoint: null,
    },
    patrimonio: {
      label: 'Patrimônio',
      icon: 'fa-tags',
      customEndpoint: null,
    },
    cotacoes: {
      label: 'Cotações',
      icon: 'fa-scale-balanced',
      customEndpoint: null,
    },
    propostas: {
      label: 'Propostas',
      icon: 'fa-file-signature',
      customEndpoint: null,
    },
    contratos: {
      label: 'Contratos',
      icon: 'fa-file-contract',
      customEndpoint: null,
    },
    contas_receber: {
      label: 'Contas a receber',
      icon: 'fa-hand-holding-dollar',
      customEndpoint: null,
    },
    contas_pagar: {
      label: 'Contas a pagar',
      icon: 'fa-money-bill-transfer',
      customEndpoint: null,
    },
  };


  const LOCALIZAR_LAYOUT_PREFIX = 'valora_localizar_layout_v3:';
  const localizarLayoutSyncTimers = new Map();

  const PREVIEW_LOCALIZAR_NATIVO = {
    clientes: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Nome, código, CPF/CNPJ, telefone, e-mail...' },
      { key: 'tipo', label: 'Tipo', kind: 'select', placeholder: 'Todos' },
      { key: 'situacao', label: 'Situação', kind: 'select', placeholder: 'Todas' },
      { key: 'cidade', label: 'Cidade', kind: 'input', placeholder: 'Cidade' },
    ],
    fornecedores: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Nome, código, CNPJ/CPF, telefone, e-mail...' },
      { key: 'tipo', label: 'Tipo', kind: 'input', placeholder: 'Distribuidor, fábrica...' },
      { key: 'situacao', label: 'Situação', kind: 'select', placeholder: 'Todas' },
      { key: 'cidade', label: 'Cidade', kind: 'input', placeholder: 'Cidade' },
    ],
    produtos: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Nome, código, categoria, descrição...' },
      { key: 'categoria', label: 'Categoria', kind: 'input', placeholder: 'Categoria' },
      { key: 'situacao', label: 'Situação', kind: 'select', placeholder: 'Todas' },
    ],
    patrimonio: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Nome, código, série, local...' },
      { key: 'categoria', label: 'Categoria', kind: 'input', placeholder: 'Categoria' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'localizacao', label: 'Localização', kind: 'input', placeholder: 'Localização' },
    ],
    cotacoes: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Item, código, categoria...' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'urgencia', label: 'Urgência', kind: 'select', placeholder: 'Todas' },
    ],
    propostas: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Título, cliente, código...' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'cliente', label: 'Cliente', kind: 'input', placeholder: 'Cliente' },
    ],
    contratos: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Contrato, cliente, documento...' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'tipo', label: 'Tipo', kind: 'select', placeholder: 'Todos' },
    ],
    contas_receber: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Cliente, documento, descrição...' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'vencimento', label: 'Vencimento', kind: 'input', placeholder: 'Período' },
      { key: 'cliente', label: 'Cliente', kind: 'input', placeholder: 'Cliente' },
    ],
    contas_pagar: [
      { key: 'busca', label: 'Busca', kind: 'input', placeholder: 'Fornecedor, documento, descrição...' },
      { key: 'status', label: 'Status', kind: 'select', placeholder: 'Todos' },
      { key: 'vencimento', label: 'Vencimento', kind: 'input', placeholder: 'Período' },
      { key: 'fornecedor', label: 'Fornecedor', kind: 'input', placeholder: 'Fornecedor' },
    ],
  };

  const PREVIEW_TABELA_NATIVA = {
    clientes: [
      { key: 'codigo', label: 'Código' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'nome', label: 'Nome / Razão Social' },
      { key: 'documento', label: 'Documento' },
      { key: 'cidade', label: 'Cidade / UF' },
      { key: 'contato', label: 'Contato' },
      { key: 'situacao', label: 'Situação' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    fornecedores: [
      { key: 'codigo', label: 'Código' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'fornecedor', label: 'Fornecedor' },
      { key: 'documento', label: 'Documento' },
      { key: 'cidade', label: 'Cidade / UF' },
      { key: 'contato', label: 'Contato' },
      { key: 'situacao', label: 'Situação' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    produtos: [
      { key: 'codigo', label: 'Código' },
      { key: 'produto', label: 'Produto' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'preco', label: 'Preço' },
      { key: 'estoque', label: 'Estoque' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    patrimonio: [
      { key: 'codigo', label: 'Código' },
      { key: 'patrimonio', label: 'Patrimônio' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'localizacao', label: 'Localização' },
      { key: 'status', label: 'Status' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    cotacoes: [
      { key: 'codigo', label: 'Código' },
      { key: 'item', label: 'Item' },
      { key: 'categoria', label: 'Categoria' },
      { key: 'quantidade', label: 'Quantidade' },
      { key: 'status', label: 'Status' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    propostas: [
      { key: 'codigo', label: 'Código' },
      { key: 'titulo', label: 'Título' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'status', label: 'Status' },
      { key: 'valor', label: 'Valor' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    contratos: [
      { key: 'contrato', label: 'Contrato' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'tipo', label: 'Tipo' },
      { key: 'status', label: 'Status' },
      { key: 'valor_mensal', label: 'Valor mensal' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    contas_receber: [
      { key: 'emissao', label: 'Emissão' },
      { key: 'vencimento', label: 'Vencimento' },
      { key: 'documento', label: 'Documento' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'valor', label: 'Valor' },
      { key: 'saldo', label: 'Saldo' },
      { key: 'status', label: 'Status' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
    contas_pagar: [
      { key: 'emissao', label: 'Emissão' },
      { key: 'vencimento', label: 'Vencimento' },
      { key: 'documento', label: 'Documento' },
      { key: 'fornecedor', label: 'Fornecedor / Sacado' },
      { key: 'valor', label: 'Valor' },
      { key: 'saldo', label: 'Saldo' },
      { key: 'status', label: 'Status' },
      { key: 'acoes', label: 'Ações', fixed: true },
    ],
  };

  const CAMPOS_SISTEMA_FALLBACK = {
    clientes: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'nome', label: 'Nome / Razão social', tipo: 'texto' },
      { campo: 'nome_fantasia', label: 'Nome fantasia', tipo: 'texto' },
      { campo: 'tipo_pessoa', label: 'Tipo de pessoa', tipo: 'select' },
      { campo: 'situacao', label: 'Situação', tipo: 'select' },
      { campo: 'cpf_cnpj', label: 'CPF / CNPJ', tipo: 'texto' },
      { campo: 'telefone', label: 'Telefone', tipo: 'telefone' },
      { campo: 'whatsapp', label: 'WhatsApp', tipo: 'telefone' },
      { campo: 'email', label: 'E-mail', tipo: 'email' },
      { campo: 'cep', label: 'CEP', tipo: 'texto' },
      { campo: 'endereco', label: 'Endereço', tipo: 'texto' },
      { campo: 'cidade', label: 'Cidade', tipo: 'texto' },
      { campo: 'estado', label: 'Estado', tipo: 'texto' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
    fornecedores: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'nome', label: 'Nome', tipo: 'texto' },
      { campo: 'whatsapp', label: 'WhatsApp', tipo: 'telefone' },
      { campo: 'email', label: 'E-mail', tipo: 'email' },
    ],
    produtos: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'nome', label: 'Nome', tipo: 'texto' },
      { campo: 'descricao', label: 'Descrição', tipo: 'textarea' },
      { campo: 'categoria', label: 'Categoria', tipo: 'texto' },
      { campo: 'unidade', label: 'Unidade', tipo: 'texto' },
      { campo: 'preco_venda', label: 'Preço de venda', tipo: 'moeda' },
      { campo: 'custo', label: 'Custo', tipo: 'moeda' },
      { campo: 'estoque_atual', label: 'Estoque atual', tipo: 'numero' },
      { campo: 'ativo', label: 'Ativo', tipo: 'checkbox' },
    ],
    patrimonio: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'nome', label: 'Nome do patrimônio', tipo: 'texto' },
      { campo: 'descricao', label: 'Descrição', tipo: 'textarea' },
      { campo: 'categoria', label: 'Categoria', tipo: 'texto' },
      { campo: 'marca', label: 'Marca', tipo: 'texto' },
      { campo: 'modelo', label: 'Modelo', tipo: 'texto' },
      { campo: 'numero_serie', label: 'Número de série', tipo: 'texto' },
      { campo: 'localizacao', label: 'Localização', tipo: 'texto' },
      { campo: 'responsavel', label: 'Responsável', tipo: 'texto' },
      { campo: 'status', label: 'Status', tipo: 'select' },
      { campo: 'valor_aquisicao', label: 'Valor de aquisição', tipo: 'moeda' },
      { campo: 'data_aquisicao', label: 'Data de aquisição', tipo: 'data' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
    cotacoes: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'item_nome', label: 'Item desejado', tipo: 'texto' },
      { campo: 'descricao', label: 'Descrição', tipo: 'textarea' },
      { campo: 'quantidade', label: 'Quantidade', tipo: 'numero' },
      { campo: 'unidade', label: 'Unidade', tipo: 'texto' },
      { campo: 'categoria', label: 'Categoria', tipo: 'texto' },
      { campo: 'status', label: 'Status', tipo: 'select' },
      { campo: 'urgencia', label: 'Urgência', tipo: 'select' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
      { campo: 'valor_aprovado', label: 'Valor aprovado', tipo: 'moeda' },
    ],
    propostas: [
      { campo: 'codigo', label: 'Código', tipo: 'numero' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'titulo', label: 'Título', tipo: 'texto' },
      { campo: 'cliente_id', label: 'Cliente', tipo: 'relacao_cliente' },
      { campo: 'status', label: 'Status', tipo: 'select' },
      { campo: 'valor_total', label: 'Valor total', tipo: 'moeda' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
    contratos: [
      { campo: 'numero_contrato', label: 'Número do contrato', tipo: 'texto' },
      { campo: 'data_cadastro', label: 'Data de cadastro', tipo: 'data', somente_leitura: true },
      { campo: 'cliente_id', label: 'Cliente', tipo: 'relacao_cliente' },
      { campo: 'tipo_contrato', label: 'Tipo de contrato', tipo: 'select' },
      { campo: 'status', label: 'Status', tipo: 'select' },
      { campo: 'valor_mensal', label: 'Valor mensal', tipo: 'moeda' },
      { campo: 'data_pagamento', label: 'Data de pagamento', tipo: 'data' },
      { campo: 'data_inicio', label: 'Data de início', tipo: 'data' },
      { campo: 'data_fim', label: 'Data de fim', tipo: 'data' },
      { campo: 'data_assinatura', label: 'Data de assinatura', tipo: 'data' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
    contas_receber: [
      { campo: 'tipo', label: 'Tipo', tipo: 'select', somente_leitura: true },
      { campo: 'status', label: 'Status', tipo: 'select', somente_leitura: true },
      { campo: 'documento', label: 'Documento', tipo: 'texto' },
      { campo: 'descricao', label: 'Descrição', tipo: 'texto' },
      { campo: 'moeda', label: 'Moeda', tipo: 'select' },
      { campo: 'valor_total', label: 'Valor total', tipo: 'moeda' },
      { campo: 'valor_pago', label: 'Valor recebido', tipo: 'moeda', somente_leitura: true },
      { campo: 'data_emissao', label: 'Emissão', tipo: 'data' },
      { campo: 'data_vencimento', label: 'Vencimento', tipo: 'data' },
      { campo: 'data_pagamento', label: 'Recebimento', tipo: 'data', somente_leitura: true },
      { campo: 'cliente_id', label: 'Cliente', tipo: 'relacao_cliente' },
      { campo: 'categoria_id', label: 'Categoria', tipo: 'select' },
      { campo: 'forma_pagamento_id', label: 'Forma de recebimento', tipo: 'select' },
      { campo: 'conta_banco_id', label: 'Conta de destino', tipo: 'select' },
      { campo: 'tipo_documento_id', label: 'Tipo de documento', tipo: 'select' },
      { campo: 'natureza_operacao_id', label: 'Natureza da operação', tipo: 'select' },
      { campo: 'centro_custo_principal_id', label: 'Centro de custo principal', tipo: 'select' },
      { campo: 'centro_custo_secundario_id', label: 'Centro de custo secundário', tipo: 'select' },
      { campo: 'conta_contabil_id', label: 'Plano de Contas', tipo: 'select' },
      { campo: 'forma_cobranca_id', label: 'Forma de cobrança', tipo: 'select' },
      { campo: 'regra_encargos_id', label: 'Regra de multa e mora', tipo: 'select' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
    contas_pagar: [
      { campo: 'tipo', label: 'Tipo', tipo: 'select', somente_leitura: true },
      { campo: 'status', label: 'Status', tipo: 'select', somente_leitura: true },
      { campo: 'documento', label: 'Documento', tipo: 'texto' },
      { campo: 'descricao', label: 'Descrição', tipo: 'texto' },
      { campo: 'moeda', label: 'Moeda', tipo: 'select' },
      { campo: 'valor_total', label: 'Valor total', tipo: 'moeda' },
      { campo: 'valor_pago', label: 'Valor pago', tipo: 'moeda', somente_leitura: true },
      { campo: 'data_emissao', label: 'Emissão', tipo: 'data' },
      { campo: 'data_vencimento', label: 'Vencimento', tipo: 'data' },
      { campo: 'data_pagamento', label: 'Pagamento', tipo: 'data', somente_leitura: true },
      { campo: 'fornecedor_id', label: 'Fornecedor / Sacado', tipo: 'relacao_fornecedor' },
      { campo: 'categoria_id', label: 'Categoria', tipo: 'select' },
      { campo: 'forma_pagamento_id', label: 'Forma de pagamento', tipo: 'select' },
      { campo: 'conta_banco_id', label: 'Conta/Banco', tipo: 'select' },
      { campo: 'tipo_documento_id', label: 'Tipo de documento', tipo: 'select' },
      { campo: 'natureza_operacao_id', label: 'Natureza da operação', tipo: 'select' },
      { campo: 'tipo_gasto_id', label: 'Tipo de gasto', tipo: 'select' },
      { campo: 'centro_custo_principal_id', label: 'Centro de custo principal', tipo: 'select' },
      { campo: 'centro_custo_secundario_id', label: 'Centro de custo secundário', tipo: 'select' },
      { campo: 'conta_contabil_id', label: 'Plano de Contas', tipo: 'select' },
      { campo: 'regra_encargos_id', label: 'Regra de multa e mora', tipo: 'select' },
      { campo: 'observacoes', label: 'Observações', tipo: 'textarea' },
    ],
  };

  function camposSistemaFallback(modulo = state.modulo) {
    return (CAMPOS_SISTEMA_FALLBACK[modulo] || []).map((campo) => ({ ...campo }));
  }

  const ICONES_SECOES = [
    { value: 'fa-id-card', label: 'Cadastro / Dados básicos' },
    { value: 'fa-address-book', label: 'Contato' },
    { value: 'fa-house', label: 'Imóvel / Endereço' },
    { value: 'fa-location-dot', label: 'Localização' },
    { value: 'fa-user-shield', label: 'Responsável / Titular' },
    { value: 'fa-building', label: 'Empresa / Pessoa jurídica' },
    { value: 'fa-user-gear', label: 'Administrativo / Gerência' },
    { value: 'fa-wallet', label: 'Financeiro / Cobrança' },
    { value: 'fa-credit-card', label: 'Pagamento' },
    { value: 'fa-share-nodes', label: 'Redes sociais' },
    { value: 'fa-file-signature', label: 'Contratos / Assinatura' },
    { value: 'fa-scale-balanced', label: 'Jurídico / Legal' },
    { value: 'fa-tags', label: 'Classificação / Categoria' },
    { value: 'fa-briefcase', label: 'Comercial' },
    { value: 'fa-folder-open', label: 'Dados adicionais' },
    { value: 'fa-sliders', label: 'Campos personalizados' },
    { value: 'fa-clipboard-list', label: 'Ocorrências / Registros' },
    { value: 'fa-paperclip', label: 'Anexos / Documentos' },
    { value: 'fa-clock-rotate-left', label: 'Histórico' },
    { value: 'fa-list-check', label: 'Checklist' },
    { value: 'fa-box', label: 'Produto / Item' },
    { value: 'fa-barcode', label: 'Código / Série' },
    { value: 'fa-truck', label: 'Fornecedor / Entrega' },
    { value: 'fa-file-contract', label: 'Contrato formal' },
    { value: 'fa-circle-info', label: 'Informações' },
    { value: 'fa-triangle-exclamation', label: 'Aviso / Atenção' },
    { value: 'fa-layer-group', label: 'Padrão / Outro' },
  ];

  const state = {
    modulo: getInitialModulo(),
    modelos: [],
    modeloAtual: null,
    camposSistema: [],
    camposPersonalizados: [],
    campoEditando: null,
    secaoEditando: null,
    modeloEditando: null,
    secoesAbertas: new Set(),
    etapaAtiva: 'cadastro',
    secaoSelecionadaId: null,
    campoSelecionadoId: null,
    campoBusca: '',
    campoTipoFiltro: '',
  };

  const qs = (id) => document.getElementById(id);

  function getInitialModulo() {
    const params = new URLSearchParams(window.location.search);
    const modulo = params.get('modulo') || 'clientes';
    return MODULOS[modulo] ? modulo : 'clientes';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toast(message, error = false, ms = 2800) {
    const el = qs('valora-toast');
    if (!el) return;

    el.replaceChildren(document.createTextNode(message || ''));
    el.classList.toggle('is-error', !!error);
    el.classList.remove('has-action');
    el.classList.add('show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  function toastComAcao(message, actionLabel, onAction, ms = 5200) {
    const el = qs('valora-toast');
    if (!el) return;

    const messageEl = document.createElement('span');
    messageEl.textContent = message || '';

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'toast-action-btn';
    actionBtn.textContent = actionLabel || 'Desfazer';
    actionBtn.addEventListener('click', () => {
      clearTimeout(toast._timer);
      el.classList.remove('show', 'has-action');
      if (typeof onAction === 'function') onAction();
    }, { once: true });

    el.replaceChildren(messageEl, actionBtn);
    el.classList.remove('is-error');
    el.classList.add('has-action', 'show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      el.classList.remove('show', 'has-action');
    }, ms);
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

    if (resp.status === 204) return null;

    const text = await resp.text();

    if (!resp.ok) {
      let detail = text || 'Erro na requisição.';

      try {
        const json = JSON.parse(text);
        detail = json.detail || json.message || detail;
      } catch (_) {}

      throw new Error(detail);
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }


  function atualizarContadoresCaracteres(root = document) {
    root.querySelectorAll('[data-count-for]').forEach((counter) => {
      const input = qs(counter.dataset.countFor);
      if (!input) return;

      const max = input.getAttribute('maxlength') || counter.textContent.split('/')[1] || '';
      const len = String(input.value || '').length;
      counter.textContent = max ? `${len}/${max}` : String(len);
    });
  }

  function toggleModalSize(id) {
    const modal = document.getElementById(id);
    const content = modal?.querySelector('.modal-content');
    const button = modal?.querySelector('[data-toggle-modal-size]');
    const icon = button?.querySelector('i');
    if (!modal || !content) return;

    const expanded = content.classList.toggle('is-expanded');
    modal.classList.toggle('is-expanded', expanded);

    if (button) {
      const label = expanded ? 'Reduzir modal' : 'Aumentar modal';
      button.setAttribute('title', label);
      button.setAttribute('aria-label', label);
    }

    if (icon) {
      icon.className = expanded
        ? 'fa-solid fa-down-left-and-up-right-to-center'
        : 'fa-solid fa-up-right-and-down-left-from-center';
    }
  }

  function isDockedFieldInspector() {
    return window.matchMedia && window.matchMedia('(min-width: 1380px)').matches;
  }

  function setDockedFieldInspectorState(open) {
    const page = document.querySelector('main.formularios-vnext');
    if (!page) return;
    page.classList.toggle('campo-inspector-open', !!open && isDockedFieldInspector());
  }

  function openModal(id) {
    const modal = document.getElementById(id);

    if (id === 'modal-campo' && modal && isDockedFieldInspector()) {
      modal.hidden = false;
      modal.style.display = 'flex';
      atualizarContadoresCaracteres(modal);
      enhanceValoraSelects(modal);
      setDockedFieldInspectorState(true);
      requestAnimationFrame(() => {
        syncAllValoraSelects(modal);
        modal.classList.add('show');
        scheduleCampoModalIntegrity();
      });
      return;
    }

    if (window.ValoraModal) {
      window.ValoraModal.open(id);
      if (modal) atualizarContadoresCaracteres(modal);
      if (modal) { enhanceValoraSelects(modal); requestAnimationFrame(() => syncAllValoraSelects(modal)); }
      if (id === 'modal-campo') scheduleCampoModalIntegrity();
      return;
    }

    if (!modal) return;

    modal.hidden = false;
    modal.style.display = 'flex';
    atualizarContadoresCaracteres(modal);
    enhanceValoraSelects(modal);
    requestAnimationFrame(() => {
      syncAllValoraSelects(modal);
      modal.classList.add('show');
      if (id === 'modal-campo') scheduleCampoModalIntegrity();
    });
  }

  function closeModal(id) {
    const modal = document.getElementById(id);

    if (modal) {
      modal.classList.remove('is-expanded');
      modal.querySelector('.modal-content')?.classList.remove('is-expanded');

      const sizeBtn = modal.querySelector('[data-toggle-modal-size]');
      const sizeBtnIcon = sizeBtn?.querySelector('i');

      if (sizeBtn) {
        sizeBtn.setAttribute('title', 'Aumentar modal');
        sizeBtn.setAttribute('aria-label', 'Aumentar modal');
      }

      if (sizeBtnIcon) sizeBtnIcon.className = 'fa-solid fa-up-right-and-down-left-from-center';
    }

    if (id === 'modal-campo' && modal && isDockedFieldInspector()) {
      modal.classList.remove('show');
      setDockedFieldInspectorState(false);
      setTimeout(() => {
        modal.hidden = true;
        modal.style.display = 'none';
      }, 150);
      return;
    }

    if (window.ValoraModal) return window.ValoraModal.close(id);

    if (!modal) return;

    modal.classList.remove('show');

    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';
      modal.classList.remove('is-expanded');
      modal.querySelector('.modal-content')?.classList.remove('is-expanded');
      const sizeBtn = modal.querySelector('[data-toggle-modal-size]');
      const sizeBtnIcon = sizeBtn?.querySelector('i');
      if (sizeBtn) {
        sizeBtn.setAttribute('title', 'Aumentar modal');
        sizeBtn.setAttribute('aria-label', 'Aumentar modal');
      }
      if (sizeBtnIcon) sizeBtnIcon.className = 'fa-solid fa-up-right-and-down-left-from-center';
    }, 160);
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.show').forEach((modal) => {
      closeModal(modal.id);
    });
  }

  function ensureLoadingSelectShell(select) {
    if (!select) return null;

    let shell = select.closest('.valora-select-loading-shell');
    if (!shell) {
      shell = document.createElement('div');
      shell.className = 'valora-select-loading-shell';
      select.parentNode.insertBefore(shell, select);
      shell.appendChild(select);
    }

    let indicator = shell.querySelector('.valora-select-loading-indicator');
    if (!indicator) {
      indicator = document.createElement('span');
      indicator.className = 'valora-select-loading-indicator';
      indicator.setAttribute('aria-hidden', 'true');
      indicator.innerHTML = `
        <span class="valora-select-loading-spinner"></span>
        <span class="valora-select-loading-text">Carregando...</span>
      `;
      shell.appendChild(indicator);
    }

    return { shell, indicator };
  }

  function setLoadingSelect(select, text = 'Carregando...') {
    if (!select) return;

    const loading = ensureLoadingSelectShell(select);
    select.innerHTML = '<option value=""></option>';
    select.disabled = true;
    select.setAttribute('aria-busy', 'true');
    select.classList.add('valora-select-loading');

    if (loading?.indicator) {
      loading.indicator.hidden = false;
      const label = loading.indicator.querySelector('.valora-select-loading-text');
      if (label) label.textContent = text;
    }
  }

  function clearLoadingSelect(select) {
    if (!select) return;

    select.disabled = false;
    select.removeAttribute('aria-busy');
    select.classList.remove('valora-select-loading');

    const indicator = select.closest('.valora-select-loading-shell')
      ?.querySelector('.valora-select-loading-indicator');
    if (indicator) indicator.hidden = true;
  }

  function moduloLabel(modulo = state.modulo) {
    return MODULOS[modulo]?.label || modulo;
  }

  function origemLabel(origem) {
    const map = {
      sistema: 'Sistema',
      personalizado: 'Personalizado',
      visual: 'Visual',
    };

    return map[origem] || origem || '-';
  }

  function normalizarTipoCampoFrontend(value) {
    const raw = String(value || 'texto').trim();
    const key = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const map = {
      texto: 'texto',
      'texto longo': 'textarea',
      textarea: 'textarea',
      numero: 'numero',
      data: 'data',
      lista: 'select',
      'lista de opcoes': 'select',
      select: 'select',
      'lista multipla': 'multiselect',
      'lista com multipla selecao': 'multiselect',
      multiselect: 'multiselect',
      checkbox: 'checkbox',
      flag: 'checkbox',
      email: 'email',
      'e mail': 'email',
      telefone: 'telefone',
      moeda: 'moeda',
      percentual: 'percentual',
      'puxar cliente': 'relacao_cliente',
      'puxa cliente': 'relacao_cliente',
      'puxar clientes': 'relacao_cliente',
      cliente: 'relacao_cliente',
      clientes: 'relacao_cliente',
      'puxar fornecedor': 'relacao_fornecedor',
      'puxa fornecedor': 'relacao_fornecedor',
      'puxar fornecedores': 'relacao_fornecedor',
      fornecedor: 'relacao_fornecedor',
      fornecedores: 'relacao_fornecedor',
      'puxar produto': 'relacao_produto',
      'puxa produto': 'relacao_produto',
      'puxar produtos': 'relacao_produto',
      produto: 'relacao_produto',
      produtos: 'relacao_produto',
      'puxar patrimonio': 'relacao_patrimonio',
      'puxa patrimonio': 'relacao_patrimonio',
      'puxar patrimonios': 'relacao_patrimonio',
      patrimonio: 'relacao_patrimonio',
      patrimonios: 'relacao_patrimonio',
      'puxar cotacao': 'relacao_cotacao',
      'puxa cotacao': 'relacao_cotacao',
      'puxar cotacoes': 'relacao_cotacao',
      cotacao: 'relacao_cotacao',
      cotacoes: 'relacao_cotacao',
      'puxar proposta': 'relacao_proposta',
      'puxa proposta': 'relacao_proposta',
      'puxar propostas': 'relacao_proposta',
      proposta: 'relacao_proposta',
      propostas: 'relacao_proposta',
      'puxar contrato': 'relacao_contrato',
      'puxa contrato': 'relacao_contrato',
      'puxar contratos': 'relacao_contrato',
      contrato: 'relacao_contrato',
      contratos: 'relacao_contrato',
      'puxar varios clientes': 'relacao_cliente_multi',
      'puxar varios fornecedores': 'relacao_fornecedor_multi',
      'puxar varios produtos': 'relacao_produto_multi',
      'puxar varios patrimonios': 'relacao_patrimonio_multi',
      'puxar varias cotacoes': 'relacao_cotacao_multi',
      'puxar varios cotacoes': 'relacao_cotacao_multi',
      'puxar varias propostas': 'relacao_proposta_multi',
      'puxar varios contratos': 'relacao_contrato_multi',
    };

    if (raw.startsWith('relacao_') || raw.startsWith('lookup_')) {
      return raw.replace(/^lookup_/, 'relacao_');
    }

    return map[key] || raw;
  }

  function tipoLabel(campo) {
    if (!campo) return '-';
    if (campo.origem === 'visual') return campo.tipo_visual || 'visual';

    const map = {
      texto: 'Texto',
      textarea: 'Texto longo',
      numero: 'Número',
      data: 'Data',
      select: 'Lista',
      multiselect: 'Lista múltipla',
      checkbox: 'Checkbox / flag',
      email: 'E-mail',
      telefone: 'Telefone',
      moeda: 'Moeda',
      percentual: 'Percentual',
      relacao_cliente: 'Puxa Clientes',
      relacao_fornecedor: 'Puxa Fornecedores',
      relacao_produto: 'Puxa Produtos',
      relacao_patrimonio: 'Puxa Patrimônio',
      relacao_cotacao: 'Puxa Cotações',
      relacao_proposta: 'Puxa Propostas',
      relacao_contrato: 'Puxa Contratos',
      relacao_cliente_multi: 'Puxa vários Clientes',
      relacao_fornecedor_multi: 'Puxa vários Fornecedores',
      relacao_produto_multi: 'Puxa vários Produtos',
      relacao_patrimonio_multi: 'Puxa vários Patrimônios',
      relacao_cotacao_multi: 'Puxa várias Cotações',
      relacao_proposta_multi: 'Puxa várias Propostas',
      relacao_contrato_multi: 'Puxa vários Contratos',
    };

    const tipo = normalizarTipoCampoFrontend(campo.tipo_campo || 'texto');
    return map[tipo] || tipo;
  }

  function tipoIcone(campo) {
    if (!campo) return 'fa-font';
    if (campo.origem === 'visual') return 'fa-heading';

    const tipo = normalizarTipoCampoFrontend(campo.tipo_campo || 'texto');
    const map = {
      texto: 'fa-font',
      textarea: 'fa-align-left',
      numero: 'fa-hashtag',
      data: 'fa-calendar-days',
      select: 'fa-list-ul',
      multiselect: 'fa-list-check',
      checkbox: 'fa-square-check',
      email: 'fa-envelope',
      telefone: 'fa-phone',
      moeda: 'fa-dollar-sign',
      percentual: 'fa-percent',
      relacao_cliente: 'fa-user-group',
      relacao_fornecedor: 'fa-truck',
      relacao_produto: 'fa-box-open',
      relacao_patrimonio: 'fa-tags',
      relacao_cotacao: 'fa-scale-balanced',
      relacao_proposta: 'fa-file-signature',
      relacao_contrato: 'fa-file-contract',
      relacao_cliente_multi: 'fa-users',
      relacao_fornecedor_multi: 'fa-truck',
      relacao_produto_multi: 'fa-boxes-stacked',
      relacao_patrimonio_multi: 'fa-tags',
      relacao_cotacao_multi: 'fa-scale-balanced',
      relacao_proposta_multi: 'fa-file-signature',
      relacao_contrato_multi: 'fa-file-contract',
    };

    return map[tipo] || 'fa-font';
  }

  function widthLabel(width) {
    if (!width) return '100%';
    if (String(width).includes('%')) return width;
    if (/^\d+$/.test(String(width))) return `${width}%`;
    return width;
  }

  function parseOpcoes(raw) {
    return String(raw || '')
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function opcoesToInput(value) {
    if (!value) return '';

    if (Array.isArray(value)) return value.join('\n');

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.join('\n');
      } catch (_) {}

      return value.replaceAll(',', '\n');
    }

    return '';
  }


  function parseMaybeJson(value, fallback = null) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(String(value));
    } catch (_) {
      return fallback;
    }
  }

  function getCampoCondicao(campo) {
    return parseMaybeJson(campo?.condicao, null) || parseMaybeJson(campo?.condicao_json, null) || {};
  }

  function getCampoExibicao(campo) {
    const condicao = getCampoCondicao(campo);
    return condicao.exibicao || condicao.listagem || {};
  }

  function isFlagOn(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'sim';
  }
  const RELACAO_ENTIDADES = ['cliente', 'fornecedor', 'produto', 'patrimonio', 'cotacao', 'proposta', 'contrato'];

  function getCampoIntegracoes(campo) {
    const condicao = getCampoCondicao(campo);
    return parseMaybeJson(condicao.integracoes, null) || {};
  }

  function getRelacaoConfigFromTipo(tipo) {
    const normalizado = normalizarTipoCampoFrontend(tipo || '');
    if (!String(normalizado).startsWith('relacao_')) {
      return { entidade: '', multiplo: false };
    }

    const multiplo = String(normalizado).endsWith('_multi');
    const entidade = String(normalizado)
      .replace(/^relacao_/, '')
      .replace(/_multi$/, '')
      .trim();

    return {
      entidade: RELACAO_ENTIDADES.includes(entidade) ? entidade : '',
      multiplo,
    };
  }

  function getTipoCampoBaseSelect(tipo) {
    const normalizado = normalizarTipoCampoFrontend(tipo || 'texto');
    return String(normalizado).startsWith('relacao_') ? 'texto' : normalizado;
  }

  function buildRelacaoTipo(entidade = '', multiplo = false) {
    const key = String(entidade || '').trim().toLowerCase();
    if (!RELACAO_ENTIDADES.includes(key)) return '';
    return `relacao_${key}${multiplo ? '_multi' : ''}`;
  }

  function getTipoCampoEfetivo() {
    const entidade = qs('campo-relacao-entidade')?.value || '';
    const multiplo = !!qs('campo-relacao-multiplo')?.checked;
    const relacaoTipo = buildRelacaoTipo(entidade, multiplo);
    return relacaoTipo || normalizarTipoCampoFrontend(qs('campo-tipo-campo')?.value || 'texto');
  }

  function getFieldAutomationProfile() {
    const secaoTextoRaw = String(qs('campo-secao')?.selectedOptions?.[0]?.textContent || '').toLowerCase();
    const labelRaw = String(qs('campo-label')?.value || '').toLowerCase();
    const sistemaRaw = String(qs('campo-sistema')?.value || '').toLowerCase();
    const normalize = (value) => String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const secaoTexto = normalize(secaoTextoRaw);
    const label = normalize(labelRaw);
    const sistema = normalize(sistemaRaw);
    const textoCampo = [label, sistema].filter(Boolean).join(' ');

    const isCep = /(^| )cep( |$)/.test(textoCampo) || sistema === 'cep';
    const isEndereco = /(^| )(endereco|logradouro|rua|avenida)( |$)/.test(textoCampo) || ['endereco', 'logradouro'].includes(sistema);
    const isBairro = /(^| )bairro( |$)/.test(textoCampo) || sistema === 'bairro';
    const isCidade = /(^| )(cidade|municipio)( |$)/.test(textoCampo) || ['cidade', 'municipio'].includes(sistema);
    const isEstado = /(^| )(estado|uf)( |$)/.test(textoCampo) || ['estado', 'uf'].includes(sistema);
    const isLocationField = isCep || isEndereco || isBairro || isCidade || isEstado;
    const isLocationSection = /(localizacao|endereco|imovel|logradouro)/.test(secaoTexto);

    return {
      isCep,
      isEndereco,
      isBairro,
      isCidade,
      isEstado,
      isLocationField,
      isLocationSection,
      isLocationContext: isLocationField || isLocationSection,
    };
  }

  function getCampoLocationFlags() {
    return {
      buscar: !!qs('campo-cep-buscar')?.checked,
      logradouro: !!qs('campo-cep-preencher-logradouro')?.checked,
      bairro: !!qs('campo-cep-preencher-bairro')?.checked,
      cidade: !!qs('campo-cep-preencher-cidade')?.checked,
      estado: !!qs('campo-cep-preencher-estado')?.checked,
      mapas: !!qs('campo-google-maps-ativo')?.checked,
    };
  }

  function hasCampoLocationAutomation(flags = getCampoLocationFlags()) {
    return Object.values(flags).some(Boolean);
  }

  function getActiveLocationPreset(profile = getFieldAutomationProfile(), flags = getCampoLocationFlags()) {
    // A função escolhida deve funcionar mesmo quando o cliente dá um nome livre
    // ao campo (ex.: "R" para Logradouro). Por isso a automação salva é a
    // autoridade; o nome serve apenas como sugestão inicial.
    if (flags.buscar) return 'cep';
    if (flags.logradouro || flags.mapas) return 'endereco';
    if (flags.cidade) return 'cidade';
    if (flags.estado) return 'estado';
    return '';
  }

  function getLocationPurposeCopy(preset = '') {
    const copy = {
      cep: {
        title: 'CEP — buscar endereço automaticamente',
        text: 'Quando este campo for preenchido com um CEP válido, o Valora consulta ViaCEP/BrasilAPI e envia Logradouro, Bairro, Cidade e Estado para os campos que você mapear abaixo.',
      },
      endereco: {
        title: 'Endereço / Logradouro',
        text: 'Identifica este campo como endereço. O nome pode ser livre — por exemplo, “R”. Também libera recursos de localização, como abrir no Google Maps.',
      },
      cidade: {
        title: 'Cidade / Município',
        text: 'Identifica este campo como destino de cidade. O nome exibido do campo pode ser qualquer um.',
      },
      estado: {
        title: 'Estado / UF',
        text: 'Identifica este campo como destino de Estado/UF. O nome exibido do campo pode ser qualquer um.',
      },
      '': {
        title: 'Nenhuma função especial',
        text: 'Use para campos comuns que não precisam de automação de localização.',
      },
    };
    return copy[preset] || copy[''];
  }

  function syncLocationPurposeControl(profile = getFieldAutomationProfile(), flags = getCampoLocationFlags()) {
    const preset = getActiveLocationPreset(profile, flags);
    const select = qs('campo-location-purpose');
    const title = qs('campo-location-purpose-help-title');
    const text = qs('campo-location-purpose-help-text');
    const copy = getLocationPurposeCopy(preset);

    if (select && select.value !== preset) select.value = preset;
    if (title) title.textContent = copy.title;
    if (text) text.textContent = copy.text;
  }

  let campoModalIntegrityLock = false;

  function forceVisibleElement(el, display = '') {
    if (!el) return;
    el.hidden = false;
    el.removeAttribute('aria-hidden');
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('content-visibility', 'visible', 'important');
    if (display) el.style.setProperty('display', display, 'important');
  }

  function ensureCampoModalIntegrity() {
    const modal = qs('modal-campo');
    const content = modal?.querySelector(':scope > .modal-content.modal-field-editor, :scope > .modal-content');
    if (!modal || !content || campoModalIntegrityLock) return;

    campoModalIntegrityLock = true;
    try {
      forceVisibleElement(content, 'flex');

      // O contêiner externo do modal nunca deve rolar. Chromium pode alterar
      // scrollTop automaticamente ao focar/abrir um <select>, mesmo quando o
      // CSS usa overflow:hidden. Isso era a causa da tela branca.
      content.scrollTop = 0;
      content.scrollLeft = 0;
      content.style.setProperty('overflow', 'clip', 'important');
      content.style.setProperty('overscroll-behavior', 'none', 'important');

      const header = content.querySelector(':scope > .modal-header');
      const body = content.querySelector(':scope > .modal-body');
      const footer = content.querySelector(':scope > .modal-footer');
      const form = body?.querySelector(':scope > form');

      forceVisibleElement(header, 'flex');
      forceVisibleElement(body, 'block');
      forceVisibleElement(footer, 'flex');
      // premium-form-grid foi desenhado para fluxo em bloco; não forçamos grid
      // aqui para não aumentar artificialmente a área rolável do modal.
      forceVisibleElement(form, 'block');
      // O wrapper de configuração precisa existir nas duas abas, mas as
      // subseções internas são controladas exclusivamente pelas abas.
      forceVisibleElement(form?.querySelector(':scope > .field-config-section'), 'block');
      forceVisibleElement(form?.querySelector(':scope > #campo-preview'), 'flex');
      syncCampoDrawerTabContent();
    } finally {
      campoModalIntegrityLock = false;
    }
  }

  function scheduleCampoModalIntegrity() {
    ensureCampoModalIntegrity();
    requestAnimationFrame(() => ensureCampoModalIntegrity());
    [0, 50, 160].forEach((delay) => setTimeout(() => ensureCampoModalIntegrity(), delay));
  }

  function setElementHidden(id, hidden) {
    const el = qs(id);
    if (el) el.hidden = !!hidden;
  }

  function normalizeCepDestinationText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getCampoDestinationSearchText(campo) {
    return [
      campo?.campo_sistema,
      campo?.campo_personalizado_slug,
      campo?.slug,
      campo?.label,
      campo?.nome,
    ]
      .map(normalizeCepDestinationText)
      .filter(Boolean)
      .join(' ');
  }

  function campoMatchesCepDestination(campo, part) {
    const text = ` ${getCampoDestinationSearchText(campo)} `;
    if (!text.trim()) return false;

    if (part === 'logradouro') {
      return / (endereco|logradouro|rua|avenida) /.test(text);
    }
    if (part === 'bairro') return / bairro /.test(text);
    if (part === 'cidade') return / (cidade|municipio) /.test(text);
    if (part === 'estado') return / (estado|uf) /.test(text);
    if (part === 'cep') return / cep /.test(text);
    return false;
  }

  function getCamposDaSecaoSelecionada() {
    const secaoId = String(qs('campo-secao')?.value || '');
    if (!secaoId) return [];

    const currentId = Number(qs('campo-id')?.value || 0) || null;
    const secao = getSecoes().find((item) => String(item?.id || '') === secaoId);
    const candidates = [
      ...(Array.isArray(secao?.campos) ? secao.campos : []),
      ...getAllCampos().filter((campo) => String(campo?.secao_id || '') === secaoId),
    ];

    const unique = new Map();
    candidates.forEach((campo, index) => {
      if (!campo) return;
      if (String(campo?.origem || '').toLowerCase() === 'visual') return;
      if (currentId && Number(campo.id || 0) === currentId) return;
      const key = campo.id != null
        ? `id:${campo.id}`
        : `tmp:${getCampoDestinationSearchText(campo)}:${index}`;
      if (!unique.has(key)) unique.set(key, campo);
    });

    return [...unique.values()];
  }

  function getCampoDestinationLabel(campo) {
    return String(
      campo?.label ||
      campo?.nome ||
      campo?.campo_sistema ||
      campo?.campo_personalizado_slug ||
      campo?.slug ||
      'Campo'
    ).trim();
  }

  function getCampoDestinationOrigin(campo) {
    const origem = String(campo?.origem || '').toLowerCase();
    if (origem === 'sistema') return 'Sistema';
    if (origem === 'personalizado') return 'Personalizado';
    return 'Campo';
  }

  function getCampoDestinationRef(campo) {
    if (!campo) return '';
    const formId = Number(campo?.id || 0) || 0;
    if (formId) return `form:${formId}`;

    const systemField = String(campo?.campo_sistema || '').trim();
    if (systemField) return `system:${systemField}`;

    const slug = String(campo?.campo_personalizado_slug || campo?.slug || '').trim();
    if (slug) return `slug:${slug}`;

    const label = normalizeCepDestinationText(campo?.label || campo?.nome || '');
    return label ? `label:${label}` : '';
  }

  function getSavedCepDestinationConfig() {
    const integracoes = getCampoIntegracoes(state.campoEditando);
    const cep = parseMaybeJson(integracoes.cep, null) || {};
    const destinos = parseMaybeJson(cep.destinos, null) || {};
    const configured = isFlagOn(cep.destinos_configurados) || Object.prototype.hasOwnProperty.call(cep, 'destinos');
    return { destinos, configured };
  }

  function getCepDestinationDraft() {
    const draft = {};
    document.querySelectorAll('#campo-cep-destination-list [data-cep-destination-select]').forEach((select) => {
      const key = String(select.dataset.cepDestinationSelect || '').trim();
      if (key) draft[key] = String(select.value || '');
    });
    return draft;
  }

  function findCepDestinationField(campos, part) {
    return campos.find((campo) => campoMatchesCepDestination(campo, part)) || null;
  }

  function renderCepDestinationPreview(profile = getFieldAutomationProfile(), flags = getCampoLocationFlags()) {
    const wrap = qs('campo-cep-destinations');
    const list = qs('campo-cep-destination-list');
    const sectionBadge = qs('campo-cep-destination-section');
    if (!wrap || !list) return;

    const enabled = profile.isCep || flags.buscar;
    wrap.hidden = !enabled;
    if (!enabled) return;

    const sectionSelect = qs('campo-secao');
    const sectionId = String(sectionSelect?.value || '');
    const sectionName = String(sectionSelect?.selectedOptions?.[0]?.textContent || '').trim();
    if (sectionBadge) {
      sectionBadge.textContent = sectionId && sectionName ? sectionName : 'Selecione uma seção';
      sectionBadge.title = sectionBadge.textContent;
    }

    if (!sectionId) {
      list.innerHTML = `
        <div class="cep-destination-row is-missing" style="grid-column:1/-1;">
          <span class="cep-destination-status"><i class="fa-solid fa-triangle-exclamation"></i></span>
          <span class="cep-destination-copy">
            <strong>Selecione a seção do campo CEP</strong>
            <small>Depois disso você poderá escolher exatamente quais campos receberão cada informação.</small>
          </span>
        </div>
      `;
      return;
    }

    const draftBeforeRender = getCepDestinationDraft();
    const saved = getSavedCepDestinationConfig();
    const campos = getCamposDaSecaoSelecionada();
    const mappings = [
      { key: 'logradouro', label: 'Logradouro', icon: 'fa-road' },
      { key: 'bairro', label: 'Bairro', icon: 'fa-location-dot' },
      { key: 'cidade', label: 'Cidade', icon: 'fa-city' },
      { key: 'estado', label: 'Estado / UF', icon: 'fa-map' },
    ];

    const optionMap = new Map();
    campos.forEach((campo) => {
      const ref = getCampoDestinationRef(campo);
      if (ref && !optionMap.has(ref)) optionMap.set(ref, campo);
    });

    const rows = mappings.map((item) => {
      const inferred = findCepDestinationField(campos, item.key);
      const inferredRef = getCampoDestinationRef(inferred);
      let selectedRef = '';
      let selectedBy = 'manual';

      if (Object.prototype.hasOwnProperty.call(draftBeforeRender, item.key)) {
        selectedRef = String(draftBeforeRender[item.key] || '');
        selectedBy = 'rascunho';
      } else if (saved.configured) {
        selectedRef = String(saved.destinos?.[item.key] || '');
        selectedBy = 'salvo';
      } else {
        selectedRef = inferredRef;
        selectedBy = inferredRef ? 'sugerido' : 'manual';
      }

      if (selectedRef && !optionMap.has(selectedRef)) {
        selectedRef = saved.configured ? '' : inferredRef;
      }

      const options = [
        '<option value="">Não preencher automaticamente</option>',
        ...campos.map((campo) => {
          const ref = getCampoDestinationRef(campo);
          if (!ref) return '';
          const selected = ref === selectedRef ? 'selected' : '';
          const origin = getCampoDestinationOrigin(campo);
          return `<option value="${escapeHtml(ref)}" ${selected}>${escapeHtml(getCampoDestinationLabel(campo))} — ${escapeHtml(origin)}</option>`;
        }),
      ].join('');

      const target = selectedRef ? optionMap.get(selectedRef) : null;
      const rowClass = target ? 'is-found' : 'is-manual';
      const icon = target ? 'fa-check' : 'fa-minus';
      const targetLabel = target ? getCampoDestinationLabel(target) : 'Não preencher automaticamente';
      const targetOrigin = target ? getCampoDestinationOrigin(target) : '';
      const helper = target
        ? (selectedBy === 'sugerido' ? 'Sugestão automática — você pode trocar' : 'Destino definido manualmente')
        : 'Não preencher este dado';

      return `
        <div class="cep-destination-row ${rowClass}" data-cep-destination-row="${escapeHtml(item.key)}">
          <span class="cep-destination-status"><i class="fa-solid ${icon}"></i></span>
          <span class="cep-destination-copy cep-destination-copy--select">
            <strong>${escapeHtml(item.label)}</strong>

            <div class="cep-destination-current">
              <span class="cep-destination-current-value">
                ${target ? `<span class="cep-destination-arrow">→</span> ${escapeHtml(targetLabel)}` : escapeHtml(targetLabel)}
                ${targetOrigin ? `<span class="cep-destination-origin">${escapeHtml(targetOrigin)}</span>` : ''}
              </span>
              <button
                type="button"
                class="cep-destination-edit-btn"
                data-cep-destination-edit="${escapeHtml(item.key)}"
                aria-label="Alterar campo que receberá ${escapeHtml(item.label)}"
              >
                <i class="fa-solid fa-pen"></i>
                <span>Alterar</span>
              </button>
            </div>

            <div class="cep-destination-editor" hidden>
              <select class="cep-destination-select" data-cep-destination-select="${escapeHtml(item.key)}" aria-label="Campo que receberá ${escapeHtml(item.label)}">
                ${options}
              </select>
            </div>
            <small>${escapeHtml(helper)}</small>
          </span>
        </div>
      `;
    });

    rows.push(`
      <div class="cep-destination-row is-manual">
        <span class="cep-destination-status"><i class="fa-solid fa-keyboard"></i></span>
        <span class="cep-destination-copy">
          <strong>Número</strong>
          <small>Preenchimento manual</small>
        </span>
      </div>
    `);
    rows.push(`
      <div class="cep-destination-row is-manual">
        <span class="cep-destination-status"><i class="fa-solid fa-keyboard"></i></span>
        <span class="cep-destination-copy">
          <strong>Complemento</strong>
          <small>Preenchimento manual</small>
        </span>
      </div>
    `);

    list.innerHTML = rows.join('');
  }

  function syncCampoAutomationState() {
    const origem = qs('campo-origem')?.value || 'personalizado';
    const isPersonalizado = origem === 'personalizado';
    const isVisual = origem === 'visual';
    const profile = getFieldAutomationProfile();
    const flags = getCampoLocationFlags();
    const relationEntity = qs('campo-relacao-entidade')?.value || '';
    const locationConfigured = hasCampoLocationAutomation(flags);

    const automationSection = document.querySelector('#modal-campo .field-flat-automation');
    const presetPanel = qs('campo-location-presets');
    const automationGrid = qs('campo-automation-grid');
    const relacaoCard = qs('automation-card-relacao');
    const cepCard = qs('automation-card-cep');
    const mapsCard = qs('automation-card-maps');

    if (automationSection) automationSection.hidden = isVisual;
    if (isVisual) {
      ensureCampoModalIntegrity();
      return;
    }

    if (presetPanel) {
      presetPanel.hidden = !isPersonalizado || !!relationEntity;
    }

    const showRelacao = isPersonalizado && (
      !!relationEntity || (!profile.isLocationField && !locationConfigured)
    );
    const showCep = profile.isLocationField || flags.buscar || flags.logradouro || flags.bairro || flags.cidade || flags.estado;
    const showMaps = profile.isEndereco || flags.mapas;

    if (relacaoCard) relacaoCard.hidden = !showRelacao;
    if (cepCard) cepCard.hidden = !showCep;
    if (mapsCard) mapsCard.hidden = !showMaps;

    const visibleCards = [relacaoCard, cepCard, mapsCard].filter((card) => card && !card.hidden);
    if (automationGrid) {
      automationGrid.hidden = visibleCards.length === 0;
      automationGrid.classList.toggle('is-single', visibleCards.length === 1);
    }
    if (automationSection) {
      // Para campos personalizados comuns, mantenha o bloco disponível.
      // Nunca escondemos a seção inteira por causa de uma troca de tipo
      // (ex.: Texto -> Lista com múltipla seleção).
      automationSection.hidden = false;
    }

    setElementHidden('row-campo-cep-buscar', !(profile.isCep || flags.buscar));
    setElementHidden('row-campo-cep-preencher-logradouro', !(profile.isEndereco || flags.logradouro));
    setElementHidden('row-campo-cep-preencher-bairro', !(profile.isBairro || flags.bairro));
    setElementHidden('row-campo-cep-preencher-cidade', !(profile.isCidade || flags.cidade));
    setElementHidden('row-campo-cep-preencher-estado', !(profile.isEstado || flags.estado));
    setElementHidden('row-campo-cep-providers', !(profile.isCep || flags.buscar));
    setElementHidden('campo-cep-auto-hint', !(profile.isCep || flags.buscar));
    renderCepDestinationPreview(profile, flags);

    syncLocationPurposeControl(profile, flags);

    ensureCampoModalIntegrity();
  }

  function clearCampoLocationAutomation() {
    [
      'campo-cep-buscar',
      'campo-cep-preencher-logradouro',
      'campo-cep-preencher-bairro',
      'campo-cep-preencher-cidade',
      'campo-cep-preencher-estado',
      'campo-google-maps-ativo',
    ].forEach((id) => {
      const input = qs(id);
      if (input) input.checked = false;
    });
  }

  function applyLocationPreset(preset) {
    const key = String(preset || '').trim().toLowerCase();
    const presets = {
      cep: {
        label: 'CEP',
        placeholder: '00000-000',
        largura: '50',
        flag: 'campo-cep-buscar',
      },
      endereco: {
        label: 'Endereço',
        placeholder: 'Rua, avenida ou logradouro',
        largura: '100',
        flag: 'campo-cep-preencher-logradouro',
        maps: true,
      },
      cidade: {
        label: 'Cidade',
        placeholder: 'Cidade',
        largura: '50',
        flag: 'campo-cep-preencher-cidade',
      },
      estado: {
        label: 'Estado',
        placeholder: 'UF',
        largura: '25',
        flag: 'campo-cep-preencher-estado',
      },
    };

    const config = presets[key];
    if (!config) return;

    if (qs('campo-origem')) qs('campo-origem').value = 'personalizado';
    if (qs('campo-tipo-campo')) qs('campo-tipo-campo').value = 'texto';
    if (qs('campo-relacao-entidade')) qs('campo-relacao-entidade').value = '';
    if (qs('campo-relacao-multiplo')) qs('campo-relacao-multiplo').checked = false;

    clearCampoLocationAutomation();

    // A função não manda no nome do campo. Se o usuário chamou de "R",
    // continua "R". Só sugerimos nome/placeholder quando ainda estão vazios.
    if (qs('campo-label') && !String(qs('campo-label').value || '').trim()) {
      qs('campo-label').value = config.label;
    }
    if (qs('campo-placeholder') && !String(qs('campo-placeholder').value || '').trim()) {
      qs('campo-placeholder').value = config.placeholder;
    }
    if (qs(config.flag)) qs(config.flag).checked = true;
    if (config.maps && qs('campo-google-maps-ativo')) qs('campo-google-maps-ativo').checked = true;
    if (qs('campo-cep-provedor')) qs('campo-cep-provedor').value = 'viacep';
    if (qs('campo-cep-fallback')) qs('campo-cep-fallback').value = 'brasilapi';

    syncCampoOpcoesVisibility();
    syncCampoAutomationState();
    atualizarCampoPreview();
  }

  function applyCampoRelationConfig(tipo) {
    const relacao = getRelacaoConfigFromTipo(tipo || '');
    const select = qs('campo-relacao-entidade');
    const check = qs('campo-relacao-multiplo');
    if (select) select.value = relacao.entidade || '';
    if (check) check.checked = !!relacao.multiplo;
  }

  function applyCampoIntegracoesConfig(campo = null) {
    const integracoes = getCampoIntegracoes(campo);
    const cep = parseMaybeJson(integracoes.cep, null) || {};
    const mapas = parseMaybeJson(integracoes.mapas, null) || {};

    if (qs('campo-cep-buscar')) qs('campo-cep-buscar').checked = isFlagOn(cep.buscar_endereco ?? cep.buscarEndereco ?? cep.buscar);
    if (qs('campo-cep-preencher-logradouro')) qs('campo-cep-preencher-logradouro').checked = isFlagOn(cep.preencher_logradouro ?? cep.logradouro);
    if (qs('campo-cep-preencher-bairro')) qs('campo-cep-preencher-bairro').checked = isFlagOn(cep.preencher_bairro ?? cep.bairro);
    if (qs('campo-cep-preencher-cidade')) qs('campo-cep-preencher-cidade').checked = isFlagOn(cep.preencher_cidade ?? cep.cidade);
    if (qs('campo-cep-preencher-estado')) qs('campo-cep-preencher-estado').checked = isFlagOn(cep.preencher_estado ?? cep.estado);
    if (qs('campo-cep-provedor')) qs('campo-cep-provedor').value = cep.provedor || 'viacep';
    if (qs('campo-cep-fallback')) qs('campo-cep-fallback').value = cep.fallback || '';
    if (qs('campo-google-maps-ativo')) qs('campo-google-maps-ativo').checked = isFlagOn(mapas.abrir_google_maps ?? mapas.google_maps ?? mapas.ativo);
    if (qs('campo-google-maps-destino')) qs('campo-google-maps-destino').value = mapas.destino || 'nova_aba';

    syncCampoAutomationState();
  }

  function buildCampoIntegracoesPayload() {
    const integracoes = {};
    const entidade = qs('campo-relacao-entidade')?.value || '';
    if (entidade) {
      integracoes.relacao = {
        entidade,
        multiplo: !!qs('campo-relacao-multiplo')?.checked,
      };
    }

    const cepDestinos = getCepDestinationDraft();
    const cep = {
      buscar_endereco: !!qs('campo-cep-buscar')?.checked,
      preencher_logradouro: !!qs('campo-cep-preencher-logradouro')?.checked,
      preencher_bairro: !!qs('campo-cep-preencher-bairro')?.checked,
      preencher_cidade: !!qs('campo-cep-preencher-cidade')?.checked,
      preencher_estado: !!qs('campo-cep-preencher-estado')?.checked,
      provedor: qs('campo-cep-provedor')?.value || 'viacep',
      fallback: qs('campo-cep-fallback')?.value || '',
    };
    if (cep.buscar_endereco) {
      cep.destinos_configurados = true;
      cep.destinos = {
        logradouro: String(cepDestinos.logradouro || ''),
        bairro: String(cepDestinos.bairro || ''),
        cidade: String(cepDestinos.cidade || ''),
        estado: String(cepDestinos.estado || ''),
      };
    }
    const cepAtivo = cep.buscar_endereco || cep.preencher_logradouro || cep.preencher_bairro || cep.preencher_cidade || cep.preencher_estado;
    if (cepAtivo) {
      integracoes.cep = cep;
    }

    const mapasAtivo = !!qs('campo-google-maps-ativo')?.checked;
    if (mapasAtivo) {
      integracoes.mapas = {
        abrir_google_maps: true,
        destino: qs('campo-google-maps-destino')?.value || 'nova_aba',
      };
    }

    return integracoes;
  }


  function normalizarTextoIcone(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizarIconeSecao(icone) {
    let value = String(icone || '').trim();

    if (!value) return '';

    value = value
      .replaceAll('fa-solid', '')
      .replaceAll('fas', '')
      .replaceAll('far', '')
      .trim();

    if (!value.startsWith('fa-')) return '';

    return value;
  }

  function iconeFallbackSecao(titulo = '') {
    const t = normalizarTextoIcone(titulo);

    if (!t) return 'fa-layer-group';

    if (
      t.includes('dados basicos') ||
      t.includes('basico') ||
      t.includes('cadastro') ||
      t.includes('identificacao') ||
      t.includes('principal')
    ) {
      return 'fa-id-card';
    }

    if (
      t.includes('imovel') ||
      t.includes('endereco') ||
      t.includes('residencia') ||
      t.includes('casa') ||
      t.includes('local')
    ) {
      return 'fa-house';
    }

    if (
      t.includes('titular responsavel') ||
      t.includes('responsavel legal') ||
      t.includes('responsavel') ||
      t.includes('titular')
    ) {
      return 'fa-user-shield';
    }

    if (
      t.includes('pessoa juridica') ||
      t.includes('juridica') ||
      t.includes('cnpj') ||
      t.includes('empresa')
    ) {
      return 'fa-building';
    }

    if (
      t.includes('administrativo') ||
      t.includes('administracao') ||
      t.includes('gerencia') ||
      t.includes('gerente')
    ) {
      return 'fa-user-gear';
    }

    if (
      t.includes('financeiro') ||
      t.includes('cobranca') ||
      t.includes('pagamento') ||
      t.includes('boleto') ||
      t.includes('pix') ||
      t.includes('cartao')
    ) {
      return 'fa-wallet';
    }

    if (
      t.includes('redes sociais') ||
      t.includes('rede social') ||
      t.includes('social') ||
      t.includes('instagram') ||
      t.includes('facebook') ||
      t.includes('linkedin') ||
      t.includes('site')
    ) {
      return 'fa-share-nodes';
    }

    if (
      t.includes('contrato') ||
      t.includes('contratos') ||
      t.includes('emissao') ||
      t.includes('assinatura')
    ) {
      return 'fa-file-signature';
    }

    if (
      t.includes('legal') ||
      t.includes('legais') ||
      t.includes('juridico') ||
      t.includes('lgpd')
    ) {
      return 'fa-scale-balanced';
    }

    if (
      t.includes('classificacao') ||
      t.includes('categoria') ||
      t.includes('segmento') ||
      t.includes('tipo')
    ) {
      return 'fa-tags';
    }

    if (
      t.includes('contato') ||
      t.includes('telefone') ||
      t.includes('whatsapp') ||
      t.includes('email')
    ) {
      return 'fa-address-book';
    }

    if (
      t.includes('comercial') ||
      t.includes('venda') ||
      t.includes('negociacao')
    ) {
      return 'fa-briefcase';
    }

    if (
      t.includes('ocorrencia') ||
      t.includes('historico') ||
      t.includes('registro')
    ) {
      return 'fa-clipboard-list';
    }

    if (
      t.includes('anexo') ||
      t.includes('arquivo') ||
      t.includes('documento')
    ) {
      return 'fa-paperclip';
    }

    if (
      t.includes('personalizado') ||
      t.includes('campo')
    ) {
      return 'fa-sliders';
    }

    return 'fa-layer-group';
  }

  function getIconeSecao(secao) {
    return normalizarIconeSecao(secao?.icone) || iconeFallbackSecao(secao?.titulo);
  }

  function getIconeOptionsComSelecionado(selectedValue = '') {
    const selected = normalizarIconeSecao(selectedValue);
    const exists = ICONES_SECOES.some((item) => item.value === selected);
    const options = [...ICONES_SECOES];

    if (selected && !exists) {
      options.unshift({
        value: selected,
        label: selected,
      });
    }

    return { selected, options };
  }

  function renderIconeSecaoPicker(selectedValue = '') {
    const picker = qs('secao-icones-picker');
    if (!picker) return;

    const { selected, options } = getIconeOptionsComSelecionado(selectedValue || 'fa-layer-group');
    const selectedFinal = selected || 'fa-layer-group';

    picker.innerHTML = options.map((item) => {
      const active = item.value === selectedFinal ? 'is-active' : '';

      return `
        <button
          class="secao-icone-option ${active}"
          type="button"
          data-secao-icon="${escapeHtml(item.value)}"
          title="${escapeHtml(item.label)}"
          aria-label="${escapeHtml(item.label)}"
        >
          <i class="fa-solid ${escapeHtml(item.value)}"></i>
        </button>
      `;
    }).join('');
  }

  function marcarIconeSecaoAtivo(value = '') {
    const picker = qs('secao-icones-picker');
    if (!picker) return;

    const selected = normalizarIconeSecao(value) || 'fa-layer-group';

    picker.querySelectorAll('.secao-icone-option').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.secaoIcon === selected);
    });
  }

  function abrirPickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    const trigger = qs('btn-abrir-icones-secao');
    if (!popover || !trigger) return;

    popover.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('is-open');
  }

  function fecharPickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    const trigger = qs('btn-abrir-icones-secao');
    if (!popover || !trigger) return;

    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('is-open');
  }

  function togglePickerIconesSecao() {
    const popover = qs('secao-icones-popover');
    if (!popover) return;

    if (popover.hidden) {
      abrirPickerIconesSecao();
    } else {
      fecharPickerIconesSecao();
    }
  }

  function atualizarTriggerIconeSecao() {
    const select = qs('secao-icone');
    const icon = normalizarIconeSecao(select?.value) || 'fa-layer-group';
    const triggerIcon = document.querySelector('#btn-abrir-icones-secao .secao-icone-trigger-box i');
    const triggerText = qs('secao-icone-trigger-text');

    if (triggerIcon) {
      triggerIcon.className = `fa-solid ${icon}`;
    }

    if (triggerText) {
      triggerText.textContent = 'Escolher ícone';
    }
  }

  function selecionarIconeSecao(value = '') {
    const icon = normalizarIconeSecao(value) || 'fa-layer-group';
    const select = qs('secao-icone');

    if (select) {
      const hasOption = Array.from(select.options || []).some((opt) => opt.value === icon);

      if (!hasOption) {
        const opt = document.createElement('option');
        opt.value = icon;
        opt.textContent = icon;
        select.prepend(opt);
      }

      select.value = icon;
    }

    marcarIconeSecaoAtivo(icon);
    atualizarPreviewIconeSecao();
    atualizarTriggerIconeSecao();
    fecharPickerIconesSecao();
  }

  function renderIconeSecaoOptions(selectedValue = '') {
    const select = qs('secao-icone');
    if (!select) return;

    const { selected, options } = getIconeOptionsComSelecionado(selectedValue);

    select.innerHTML = options.map((item) => {
      const isSelected = item.value === selected ? 'selected' : '';

      return `
        <option value="${escapeHtml(item.value)}" ${isSelected}>
          ${escapeHtml(item.label)} — ${escapeHtml(item.value)}
        </option>
      `;
    }).join('');

    renderIconeSecaoPicker(selected || 'fa-layer-group');
  }

  function atualizarPreviewIconeSecao() {
    const select = qs('secao-icone');
    const titulo = qs('secao-titulo')?.value || state.secaoEditando?.titulo || '';
    const icon = normalizarIconeSecao(select?.value) || iconeFallbackSecao(titulo);

    const previewIcon = document.querySelector('#secao-icone-preview i');
    const previewText = qs('secao-icone-preview-text');

    if (previewIcon) {
      previewIcon.className = `fa-solid ${icon}`;
    }

    if (previewText) {
      previewText.textContent = titulo.trim() || 'Dados Básicos';
    }

    marcarIconeSecaoAtivo(icon);
    atualizarTriggerIconeSecao();
  }

  function getSecoes() {
    return Array.isArray(state.modeloAtual?.secoes) ? state.modeloAtual.secoes : [];
  }

  function getAllCampos() {
    const direto = Array.isArray(state.modeloAtual?.campos) ? state.modeloAtual.campos : [];
    const semSecao = Array.isArray(state.modeloAtual?.campos_sem_secao) ? state.modeloAtual.campos_sem_secao : [];

    const emSecoes = getSecoes().flatMap((secao) => {
      return Array.isArray(secao.campos) ? secao.campos : [];
    });

    const map = new Map();

    [...direto, ...semSecao, ...emSecoes].forEach((campo) => {
      if (campo?.id != null) {
        map.set(Number(campo.id), campo);
      }
    });

    return [...map.values()];
  }

  function campoMarcadoLocalizar(campo) {
    const exibicao = getCampoExibicao(campo);
    return isFlagOn(exibicao.usar_no_localizar ?? exibicao.localizar ?? exibicao.filtro);
  }

  function campoMarcadoTabela(campo) {
    const exibicao = getCampoExibicao(campo);
    return isFlagOn(exibicao.mostrar_na_tabela ?? exibicao.tabela ?? exibicao.coluna);
  }

  function campoDeveAparecerNoLocalizarPreview(campo) {
    // O preview precisa bater com a tela real: campo mostrado na tabela
    // também aparece no card Localizar, salvo se o usuário ocultar pelo olho.
    return campoMarcadoLocalizar(campo) || campoMarcadoTabela(campo);
  }

  function getCamposPreview(predicate) {
    return getAllCampos()
      .filter((campo) => campo && campo.ativo !== false && campo.origem !== 'visual' && predicate(campo))
      .sort((a, b) => {
        return Number(a.ordem || 0) - Number(b.ordem || 0) ||
          String(a.label || '').localeCompare(String(b.label || ''));
      });
  }

  function localizarStorageKey(modulo = state.modulo) {
    return `${LOCALIZAR_LAYOUT_PREFIX}${modulo || 'clientes'}`;
  }

  function normalizarOrdemLayout(value) {
    const list = Array.isArray(value) ? value : [];
    return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function normalizarLayoutLocalizar(raw) {
    const hiddenFilters = Array.isArray(raw?.hiddenFilters) ? raw.hiddenFilters : [];
    const hiddenColumns = Array.isArray(raw?.hiddenColumns) ? raw.hiddenColumns : [];

    return {
      hiddenFilters: [...new Set(hiddenFilters.map((item) => String(item || '').trim()).filter(Boolean))],
      hiddenColumns: [...new Set(hiddenColumns.map((item) => String(item || '').trim()).filter(Boolean))],
      filterOrder: normalizarOrdemLayout(raw?.filterOrder),
      columnOrder: normalizarOrdemLayout(raw?.columnOrder),
    };
  }

  function getLayoutLocalizar(modulo = state.modulo) {
    try {
      return normalizarLayoutLocalizar(JSON.parse(localStorage.getItem(localizarStorageKey(modulo)) || '{}'));
    } catch (_) {
      return normalizarLayoutLocalizar({});
    }
  }

  async function carregarLayoutLocalizarServidor(modulo = state.modulo) {
    try {
      const data = await apiJson(`${API_BASE}/layout-localizar/${encodeURIComponent(modulo)}`);
      const layout = normalizarLayoutLocalizar(data?.layout || {});
      localStorage.setItem(localizarStorageKey(modulo), JSON.stringify(layout));
      return layout;
    } catch (err) {
      console.warn('[Formulários] layout compartilhado indisponível; usando cache local.', err);
      return getLayoutLocalizar(modulo);
    }
  }

  function agendarSalvarLayoutLocalizar(layout, modulo = state.modulo) {
    const key = String(modulo || 'clientes');
    clearTimeout(localizarLayoutSyncTimers.get(key));

    const timer = setTimeout(async () => {
      try {
        await apiJson(`${API_BASE}/layout-localizar/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalizarLayoutLocalizar(layout)),
        });
      } catch (err) {
        console.warn('[Formulários] não foi possível sincronizar o layout; ele continua salvo neste navegador.', err);
      } finally {
        localizarLayoutSyncTimers.delete(key);
      }
    }, 180);

    localizarLayoutSyncTimers.set(key, timer);
  }

  function setLayoutLocalizar(layout, modulo = state.modulo) {
    const normalized = normalizarLayoutLocalizar(layout);
    localStorage.setItem(localizarStorageKey(modulo), JSON.stringify(normalized));
    agendarSalvarLayoutLocalizar(normalized, modulo);
  }

  function itemLayoutKey(origin, key) {
    return `${origin || 'nativo'}:${key || ''}`;
  }

  function slugLocalizar(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120);
  }

  function origemCampoPreview(campo) {
    return String(campo?.origem || '').toLowerCase() === 'sistema' ? 'sistema' : 'custom';
  }

  function chaveCampoPreview(campo) {
    if (origemCampoPreview(campo) === 'sistema') {
      return String(campo?.campo_sistema || '').trim() || `campo_${campo?.id || slugLocalizar(campo?.label || campo?.nome || 'sistema')}`;
    }

    return String(
      campo?.slug ||
      campo?.campo_personalizado_slug ||
      campo?.campo ||
      slugLocalizar(campo?.label || campo?.nome || campo?.id || 'campo')
    ).trim();
  }

  function layoutOrderProp(area) {
    return area === 'columns' ? 'columnOrder' : 'filterOrder';
  }

  function ordenarItensLayout(area, items) {
    const layout = getLayoutLocalizar();
    const ordemSalva = layout[layoutOrderProp(area)] || [];
    const indexMap = new Map(ordemSalva.map((key, index) => [key, index]));

    return [...items].sort((a, b) => {
      const aFixed = !!a?.fixed || a?.key === 'acoes';
      const bFixed = !!b?.fixed || b?.key === 'acoes';
      if (aFixed !== bFixed) return aFixed ? 1 : -1;

      const aKey = itemLayoutKey(a?.origin, a?.key);
      const bKey = itemLayoutKey(b?.origin, b?.key);
      const aIndex = indexMap.has(aKey) ? indexMap.get(aKey) : Number.MAX_SAFE_INTEGER;
      const bIndex = indexMap.has(bKey) ? indexMap.get(bKey) : Number.MAX_SAFE_INTEGER;

      if (aIndex !== bIndex) return aIndex - bIndex;
      return Number(a?.defaultOrder || 0) - Number(b?.defaultOrder || 0);
    });
  }

  function isItemPreviewVisivel(area, origin, key, fixed = false) {
    if (fixed || key === 'acoes') return true;

    const layout = getLayoutLocalizar();
    const hiddenList = area === 'columns' ? layout.hiddenColumns : layout.hiddenFilters;
    return !hiddenList.includes(itemLayoutKey(origin, key));
  }

  function setItemPreviewVisivel(area, origin, key, visible, fixed = false) {
    if (fixed || key === 'acoes') {
      toast('A coluna Ações fica fixa para não perder editar e excluir.', true);
      return;
    }

    const layout = getLayoutLocalizar();
    const prop = area === 'columns' ? 'hiddenColumns' : 'hiddenFilters';
    const current = new Set(layout[prop]);
    const fullKey = itemLayoutKey(origin, key);

    if (visible) current.delete(fullKey);
    else current.add(fullKey);

    layout[prop] = [...current];
    setLayoutLocalizar(layout);
    renderPreviewLocalizar();
  }

  function toggleItemPreview(area, origin, key, fixed = false) {
    const visible = isItemPreviewVisivel(area, origin, key, fixed);
    setItemPreviewVisivel(area, origin, key, !visible, fixed);
  }

  function removerItemPersonalizadoPreview(area, origin, key, fixed = false) {
    if (origin === 'nativo') {
      toggleItemPreview(area, origin, key, fixed);
      return;
    }

    const visible = isItemPreviewVisivel(area, origin, key, fixed);
    setItemPreviewVisivel(area, origin, key, !visible, fixed);

    if (visible) {
      const message = area === 'columns'
        ? 'Informação removida da lista.'
        : 'Filtro removido da tela.';

      toastComAcao(message, 'Desfazer', () => {
        setItemPreviewVisivel(area, origin, key, true, fixed);
        toast(area === 'columns' ? 'Informação restaurada na lista.' : 'Filtro restaurado na tela.');
      });
    } else {
      toast(area === 'columns' ? 'Informação restaurada na lista.' : 'Filtro restaurado na tela.');
    }
  }

  function formatarLocalizarPadrao() {
    setLayoutLocalizar(normalizarLayoutLocalizar({}));
    renderPreviewLocalizar();
    toast('Filtros e informações da lista restaurados ao padrão.');
  }

  function labelOrigemPreview(origin) {
    if (origin === 'nativo') return 'Nativo';
    if (origin === 'sistema') return 'Sistema';
    return 'Personalizado';
  }

  function renderDragHandlePreview({ fixed = false }) {
    if (fixed) return '';

    return `
      <span class="localizar-preview-drag" title="Arraste para mudar a posição" aria-hidden="true">
        <i class="fa-solid fa-grip-vertical"></i>
      </span>
    `;
  }

  function renderActionPreview({ area, origin, key, visible, fixed = false }) {
    if (fixed || key === 'acoes') return '';

    if (origin === 'nativo') {
      return `
        <button
          type="button"
          class="localizar-preview-toggle"
          data-localizar-preview-toggle="true"
          data-area="${escapeHtml(area)}"
          data-origin="${escapeHtml(origin)}"
          data-key="${escapeHtml(key)}"
          title="${visible ? 'Ocultar este campo nativo' : 'Mostrar este campo nativo'}"
          aria-pressed="${visible ? 'true' : 'false'}"
        >
          <i class="fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
        </button>
      `;
    }

    const actionTitle = area === 'columns'
      ? (visible ? 'Remover somente da tabela' : 'Adicionar novamente à tabela')
      : (visible ? 'Remover somente do Localizar' : 'Adicionar novamente ao Localizar');
    return `
      <button
        type="button"
        class="localizar-preview-remove ${visible ? '' : 'is-restore'}"
        data-localizar-preview-remove="true"
        data-area="${escapeHtml(area)}"
        data-origin="${escapeHtml(origin)}"
        data-key="${escapeHtml(key)}"
        title="${escapeHtml(actionTitle)}"
        aria-pressed="${visible ? 'false' : 'true'}"
      >
        <i class="fa-solid ${visible ? 'fa-trash-can' : 'fa-arrow-rotate-left'}"></i>
      </button>
    `;
  }

  function iconeCampoPreview({ key = '', label = '', kind = '', area = '' } = {}) {
    const value = `${key} ${label}`.toLowerCase();
    if (value.includes('cidade') || value.includes('uf') || value.includes('endereco')) return 'fa-location-dot';
    if (value.includes('codigo') || value.includes('código')) return 'fa-hashtag';
    if (value.includes('contato') || value.includes('cliente') || value.includes('fornecedor') || value.includes('monit')) return 'fa-user';
    if (value.includes('document') || value.includes('cpf') || value.includes('cnpj')) return 'fa-id-card';
    if (value.includes('tipo') || value.includes('situacao') || value.includes('situação') || kind === 'select') return 'fa-list';
    if (area === 'columns') return 'fa-table-columns';
    return 'fa-font';
  }

  function renderPreviewField(field, extraClass = '') {
    const label = field?.label || 'Campo';
    const key = field?.key || slugLocalizar(label);
    const origin = field?.origin || 'nativo';
    const originLabel = labelOrigemPreview(origin);
    const fixed = !!field?.fixed;
    const visible = isItemPreviewVisivel('filters', origin, key, fixed);

    // Campos personalizados removidos somem da visualização. Campos nativos
    // ocultos continuam visíveis em estado apagado para poder reativá-los pelo olho.
    if (!visible && origin !== 'nativo') return '';

    const hiddenClass = visible ? '' : 'is-hidden-preview';
    const statusLabel = visible ? originLabel : 'Oculto';
    const icon = iconeCampoPreview({ key, label, kind: field?.kind, area: 'filters' });

    return `
      <div
        class="localizar-preview-filter ${escapeHtml(extraClass)} ${hiddenClass}"
        data-origin="${escapeHtml(origin)}"
        data-key="${escapeHtml(key)}"
        data-area="filters"
        data-layout-key="${escapeHtml(itemLayoutKey(origin, key))}"
        data-localizar-preview-item="true"
        draggable="${fixed ? 'false' : 'true'}"
      >
        <div class="localizar-preview-filter-top">
          ${renderDragHandlePreview({ fixed })}
          <span class="localizar-preview-kind" aria-hidden="true"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
          <span class="localizar-preview-item-label">${escapeHtml(label)}</span>
          <em class="localizar-preview-origin">${escapeHtml(statusLabel)}</em>
          ${renderActionPreview({ area: 'filters', origin, key, visible, fixed })}
        </div>
      </div>
    `;
  }

  function renderPreviewColumn(column, origin = 'nativo') {
    const col = typeof column === 'string' ? { key: slugLocalizar(column), label: column } : column;
    const label = col?.label || 'Campo';
    const key = col?.key || slugLocalizar(label);
    const fixed = !!col?.fixed || key === 'acoes';
    const originLabel = labelOrigemPreview(origin);
    const visible = isItemPreviewVisivel('columns', origin, key, fixed);

    // Ao remover um campo personalizado da lista, ele deixa de ocupar espaço.
    // Nativos ocultos permanecem visíveis apenas para permitir reativação rápida.
    if (!visible && origin !== 'nativo') return '';

    const hiddenClass = visible ? '' : 'is-hidden-preview';
    const statusLabel = fixed ? 'Fixo' : (visible ? originLabel : 'Oculto');
    const icon = iconeCampoPreview({ key, label, area: 'columns' });

    return `
      <span
        class="localizar-preview-col ${hiddenClass}"
        data-origin="${escapeHtml(origin)}"
        data-key="${escapeHtml(key)}"
        data-area="columns"
        data-layout-key="${escapeHtml(itemLayoutKey(origin, key))}"
        data-localizar-preview-item="true"
        draggable="${fixed ? 'false' : 'true'}"
      >
        ${renderDragHandlePreview({ fixed })}
        <span class="localizar-preview-kind" aria-hidden="true"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
        <span class="localizar-preview-item-label">${escapeHtml(label)}</span>
        <em>${escapeHtml(statusLabel)}</em>
        ${renderActionPreview({ area: 'columns', origin, key, visible, fixed })}
      </span>
    `;
  }

  function itensPreviewFiltros(nativeFilters, camposLocalizar) {
    const nativeItems = nativeFilters.map((field, index) => ({
      ...field,
      origin: 'nativo',
      defaultOrder: index,
    }));

    const customItems = camposLocalizar.map((campo, index) => {
      const tipo = normalizarTipoCampoFrontend(campo.tipo_campo || 'texto');
      return {
        key: chaveCampoPreview(campo),
        label: campo.label || campo.nome || 'Campo',
        kind: tipo === 'select' || tipo === 'multiselect' || tipo === 'checkbox' ? 'select' : 'input',
        placeholder: campo.placeholder || `Filtrar por ${campo.label || campo.nome || 'campo'}`,
        origin: origemCampoPreview(campo),
        defaultOrder: nativeItems.length + index,
      };
    });

    return ordenarItensLayout('filters', [...nativeItems, ...customItems]);
  }

  function itensPreviewTabela(nativeColumns, camposTabela) {
    const nativeBefore = [];
    const nativeAfter = [];

    nativeColumns.forEach((column) => {
      const col = typeof column === 'string' ? { key: slugLocalizar(column), label: column } : { ...column };
      if (col.key === 'situacao' || col.key === 'acoes') nativeAfter.push(col);
      else nativeBefore.push(col);
    });

    const customItems = camposTabela.map((campo) => ({
      key: chaveCampoPreview(campo),
      label: campo.label || campo.nome || 'Campo',
      origin: origemCampoPreview(campo),
    }));

    const defaultItems = [
      ...nativeBefore.map((col) => ({ ...col, origin: 'nativo' })),
      ...customItems,
      ...nativeAfter.map((col) => ({ ...col, origin: 'nativo' })),
    ].map((item, index) => ({ ...item, defaultOrder: index }));

    return ordenarItensLayout('columns', defaultItems);
  }

  function renderPreviewLocalizar() {
    const card = qs('localizar-preview-card');
    const filtersWrap = qs('preview-localizar-fields');
    const tableWrap = qs('preview-tabela-fields');
    const summary = qs('localizar-preview-summary');
    const filtersCount = qs('preview-localizar-count');
    const columnsCount = qs('preview-tabela-count');
    if (!card || !filtersWrap || !tableWrap) return;

    const modelo = state.modeloAtual?.modelo || null;
    const nativeFilters = PREVIEW_LOCALIZAR_NATIVO[state.modulo] || PREVIEW_LOCALIZAR_NATIVO.clientes;
    const nativeColumns = PREVIEW_TABELA_NATIVA[state.modulo] || PREVIEW_TABELA_NATIVA.clientes;

    if (!modelo) {
      filtersWrap.innerHTML = `
        <div class="localizar-preview-empty">
          Escolha um formulário para ver como a busca e a lista vão ficar.
        </div>
      `;
      tableWrap.innerHTML = '<div class="localizar-preview-empty">A lista aparece aqui quando o formulário for carregado.</div>';
      if (summary) summary.textContent = 'Nenhum formulário selecionado';
      if (filtersCount) filtersCount.textContent = '0 opções';
      if (columnsCount) columnsCount.textContent = '0 itens';
      return;
    }

    const camposLocalizar = getCamposPreview(campoDeveAparecerNoLocalizarPreview);
    const camposTabela = getCamposPreview(campoMarcadoTabela);
    const filtros = itensPreviewFiltros(nativeFilters, camposLocalizar);
    const colunas = itensPreviewTabela(nativeColumns, camposTabela);

    filtersWrap.innerHTML = `
      <div class="localizar-preview-items-list">
        ${filtros.map((field) => renderPreviewField(
          field,
          field.origin === 'nativo' ? '' : 'is-custom'
        )).join('')}
      </div>
      <button type="button" class="localizar-preview-drop-hint" data-open-preview-picker="filters">
        <i class="fa-solid fa-plus"></i>
        <span>Adicionar outro campo à busca</span>
      </button>
    `;

    tableWrap.innerHTML = `
      <div class="localizar-preview-table-row">
        ${colunas.map((col) => renderPreviewColumn(col, col.origin || 'nativo')).join('')}
      </div>
      <button type="button" class="localizar-preview-drop-hint" data-open-preview-picker="columns">
        <i class="fa-solid fa-plus"></i>
        <span>Adicionar outra informação à lista</span>
      </button>
    `;

    const filtrosVisiveis = filtros.filter((field) => isItemPreviewVisivel('filters', field.origin || 'nativo', field.key, !!field.fixed)).length;
    const colunasVisiveis = colunas.filter((col) => {
      const origin = col.origin || 'nativo';
      const fixed = !!col.fixed || col.key === 'acoes';
      return isItemPreviewVisivel('columns', origin, col.key, fixed);
    }).length;

    if (filtersCount) filtersCount.textContent = `${filtrosVisiveis} ${filtrosVisiveis === 1 ? 'opção' : 'opções'}`;
    if (columnsCount) columnsCount.textContent = `${colunasVisiveis} ${colunasVisiveis === 1 ? 'item' : 'itens'}`;
    if (summary) summary.textContent = `${filtrosVisiveis} ${filtrosVisiveis === 1 ? 'campo para procurar' : 'campos para procurar'} • ${colunasVisiveis} ${colunasVisiveis === 1 ? 'informação na lista' : 'informações na lista'}`;
  }

  function campoEstaDisponivelNoPreview(area, campo) {
    if (!campo || campo.ativo === false || campo.origem === 'visual') return false;
    return area === 'columns' ? campoMarcadoTabela(campo) : campoDeveAparecerNoLocalizarPreview(campo);
  }

  function itensDisponiveisParaAdicionar(area) {
    const isColumns = area === 'columns';
    const nativeSource = isColumns
      ? (PREVIEW_TABELA_NATIVA[state.modulo] || PREVIEW_TABELA_NATIVA.clientes)
      : (PREVIEW_LOCALIZAR_NATIVO[state.modulo] || PREVIEW_LOCALIZAR_NATIVO.clientes);

    const itens = [];

    nativeSource.forEach((raw, index) => {
      const item = typeof raw === 'string'
        ? { key: slugLocalizar(raw), label: raw }
        : { ...raw };
      const key = String(item.key || slugLocalizar(item.label || '')).trim();
      const fixed = !!item.fixed || key === 'acoes';
      if (!key || fixed) return;
      const visible = isItemPreviewVisivel(area, 'nativo', key, fixed);
      if (visible) return;
      itens.push({
        area,
        origin: 'nativo',
        key,
        label: item.label || key,
        kind: item.kind || '',
        campoId: null,
        alreadyConfigured: true,
        defaultOrder: index,
      });
    });

    getAllCampos()
      .filter((campo) => campo && campo.ativo !== false && campo.origem !== 'visual')
      .forEach((campo, index) => {
        const origin = origemCampoPreview(campo);
        const key = chaveCampoPreview(campo);
        if (!key) return;
        const configured = campoEstaDisponivelNoPreview(area, campo);
        const visible = configured && isItemPreviewVisivel(area, origin, key, false);
        if (visible) return;
        itens.push({
          area,
          origin,
          key,
          label: campo.label || campo.nome || 'Campo',
          kind: campo.tipo_campo || '',
          campoId: Number(campo.id),
          alreadyConfigured: configured,
          defaultOrder: 1000 + index,
        });
      });

    return itens.sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'pt-BR'));
  }

  function renderPreviewPicker(area = state.previewPickerArea || 'columns') {
    const list = qs('preview-picker-list');
    const input = qs('preview-picker-search');
    if (!list) return;

    const termo = slugLocalizar(input?.value || '');
    const itens = itensDisponiveisParaAdicionar(area).filter((item) => {
      if (!termo) return true;
      return slugLocalizar(`${item.label || ''} ${item.key || ''}`).includes(termo);
    });

    if (!itens.length) {
      const vazio = input?.value?.trim()
        ? 'Nenhum campo disponível corresponde à busca.'
        : (area === 'columns'
          ? 'Todos os campos disponíveis já estão na lista.'
          : 'Todos os campos disponíveis já estão na busca.');
      list.innerHTML = `<div class="preview-picker-empty"><i class="fa-regular fa-circle-check"></i><strong>${escapeHtml(vazio)}</strong><span>Você pode ocultar ou reorganizar os campos diretamente na etapa.</span></div>`;
      return;
    }

    list.innerHTML = itens.map((item) => {
      const originLabel = labelOrigemPreview(item.origin);
      const icon = iconeCampoPreview({ key: item.key, label: item.label, kind: item.kind, area });
      const action = item.alreadyConfigured ? 'Restaurar' : 'Adicionar';
      return `<button type="button" class="preview-picker-item" data-preview-picker-add="true" data-area="${escapeHtml(area)}" data-origin="${escapeHtml(item.origin)}" data-key="${escapeHtml(item.key)}" data-campo-id="${item.campoId || ''}">
        <span class="preview-picker-item-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></span>
        <span class="preview-picker-item-copy"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(originLabel)}</small></span>
        <span class="preview-picker-item-action"><i class="fa-solid fa-plus"></i> ${escapeHtml(action)}</span>
      </button>`;
    }).join('');
  }

  function abrirPreviewPicker(area) {
    if (!state.modeloAtual?.modelo?.id) {
      toast('Escolha um formulário antes de adicionar campos.', true);
      return;
    }
    state.previewPickerArea = area === 'filters' ? 'filters' : 'columns';
    const isColumns = state.previewPickerArea === 'columns';
    const title = qs('preview-picker-title');
    const subtitle = qs('preview-picker-subtitle');
    const search = qs('preview-picker-search');
    if (title) title.textContent = isColumns ? 'Adicionar à lista' : 'Adicionar à busca';
    if (subtitle) subtitle.textContent = isColumns
      ? 'Escolha uma informação já existente no cadastro para mostrar na lista.'
      : 'Escolha uma informação já existente no cadastro para usar na pesquisa e nos filtros.';
    if (search) search.value = '';
    renderPreviewPicker(state.previewPickerArea);
    openModal('modal-preview-picker');
    setTimeout(() => search?.focus(), 60);
  }

  async function adicionarItemAoPreview(button) {
    const area = button?.dataset?.area === 'filters' ? 'filters' : 'columns';
    const origin = button?.dataset?.origin || 'nativo';
    const key = button?.dataset?.key || '';
    const campoId = Number(button?.dataset?.campoId || 0) || null;
    if (!key) return;

    button.disabled = true;
    const original = button.innerHTML;
    button.querySelector('.preview-picker-item-action')?.replaceChildren(document.createTextNode('Adicionando...'));

    try {
      if (origin === 'nativo') {
        setItemPreviewVisivel(area, origin, key, true, false);
      } else if (campoId) {
        const campo = findCampo(campoId);
        if (!campo) throw new Error('Campo não encontrado no formulário atual.');

        const prop = area === 'columns' ? 'mostrar_na_tabela' : 'usar_no_localizar';
        const condicao = { ...getCampoCondicao(campo) };
        condicao.exibicao = { ...(condicao.exibicao || {}), [prop]: true };

        await apiJson(`${API_BASE}/campos/${campoId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ condicao }),
        });

        // Se o campo já havia sido removido visualmente, restaura também o layout.
        const layout = getLayoutLocalizar();
        const hiddenProp = area === 'columns' ? 'hiddenColumns' : 'hiddenFilters';
        const fullKey = itemLayoutKey(origin, key);
        layout[hiddenProp] = (layout[hiddenProp] || []).filter((item) => item !== fullKey);
        setLayoutLocalizar(layout);

        const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;
        await carregarModeloCompleto(modeloId);
      }

      renderPreviewLocalizar();
      renderPreviewPicker(area);
      toast(area === 'columns' ? 'Informação adicionada à lista.' : 'Campo adicionado à busca.');
    } catch (err) {
      console.error('[Formulários] erro ao adicionar campo ao preview:', err);
      button.innerHTML = original;
      button.disabled = false;
      toast(err.message || 'Não foi possível adicionar o campo.', true);
    }
  }

  let previewDragState = null;

  function getPreviewItemsArea(area) {
    const root = area === 'columns'
      ? qs('preview-tabela-fields')?.querySelector('.localizar-preview-table-row')
      : qs('preview-localizar-fields');

    if (!root) return [];
    return [...root.querySelectorAll(`[data-localizar-preview-item="true"][data-area="${area}"]`)];
  }

  function salvarOrdemPreview(area) {
    const layout = getLayoutLocalizar();
    layout[layoutOrderProp(area)] = getPreviewItemsArea(area)
      .map((item) => String(item.dataset.layoutKey || '').trim())
      .filter(Boolean);
    setLayoutLocalizar(layout);
  }

  function limparEstadoDragPreview() {
    document.querySelectorAll('.localizar-preview-card .is-dragging, .localizar-preview-card .is-drag-target')
      .forEach((el) => el.classList.remove('is-dragging', 'is-drag-target'));
    previewDragState = null;
  }

  function bindPreviewDrag(card) {
    card.addEventListener('dragstart', (event) => {
      const item = event.target.closest?.('[data-localizar-preview-item="true"]');
      if (!item || item.getAttribute('draggable') !== 'true') return;

      previewDragState = {
        item,
        area: item.dataset.area,
        moved: false,
      };
      item.classList.add('is-dragging');

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.dataset.layoutKey || '');
      }
    });

    card.addEventListener('dragover', (event) => {
      if (!previewDragState?.item) return;

      const target = event.target.closest?.('[data-localizar-preview-item="true"]');
      if (!target || target === previewDragState.item || target.dataset.area !== previewDragState.area) return;

      event.preventDefault();
      const parent = target.parentElement;
      if (!parent) return;

      document.querySelectorAll('.localizar-preview-card .is-drag-target')
        .forEach((el) => el.classList.remove('is-drag-target'));
      target.classList.add('is-drag-target');

      const rect = target.getBoundingClientRect();
      const before = previewDragState.area === 'filters'
        ? event.clientY < rect.top + rect.height / 2
        : (event.clientY >= rect.top && event.clientY <= rect.bottom
          ? event.clientX < rect.left + rect.width / 2
          : event.clientY < rect.top + rect.height / 2);

      parent.insertBefore(previewDragState.item, before ? target : target.nextSibling);
      previewDragState.moved = true;
    });

    card.addEventListener('drop', (event) => {
      if (!previewDragState?.item) return;
      event.preventDefault();

      const area = previewDragState.area;
      salvarOrdemPreview(area);
      limparEstadoDragPreview();
      renderPreviewLocalizar();
      toast(area === 'columns' ? 'Ordem das colunas atualizada.' : 'Ordem dos filtros atualizada.');
    });

    card.addEventListener('dragend', () => {
      const moved = previewDragState?.moved;
      const area = previewDragState?.area;
      if (moved && area) salvarOrdemPreview(area);
      limparEstadoDragPreview();
      renderPreviewLocalizar();
    });
  }

  async function carregarModelos() {
    const data = await apiJson(`${API_BASE}/modelos?modulo=${encodeURIComponent(state.modulo)}`);
    state.modelos = Array.isArray(data) ? data : [];

    renderModelosSelect();

    if (state.modelos.length) {
      const fichaPrincipal = state.modelos.find((m) => m.usar_como_ficha_principal);
      const padrao = state.modelos.find((m) => m.padrao);
      const escolhido = fichaPrincipal || padrao || state.modelos[0];

      await carregarModeloCompleto(escolhido.id);
    } else if (["contas_receber", "contas_pagar"].includes(state.modulo)) {
      // No Financeiro o formulário padrão representa a ficha que já existe no sistema.
      // Criá-lo ao entrar no módulo permite personalizar imediatamente os campos
      // nativos, sem obrigar o usuário a montar uma ficha vazia do zero.
      await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      await carregarModelos();
      return;
    } else {
      state.modeloAtual = null;
      renderModeloAtual();
    }
  }

  async function carregarModeloCompleto(id) {
    if (!id) {
      state.modeloAtual = null;
      renderModeloAtual();
      return;
    }

    const data = await apiJson(`${API_BASE}/modelos/${id}`);
    state.modeloAtual = data;

    const select = qs('select-modelo');

    if (select) {
      select.value = String(id);
    }

    renderModeloAtual();
  }

  async function garantirModeloAtual() {
    let modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (modeloId) {
      if (!state.modeloAtual?.modelo?.id) {
        await carregarModeloCompleto(modeloId);
      }

      return state.modeloAtual?.modelo?.id || modeloId;
    }

    const data = await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    await carregarModelos();

    modeloId = data?.modelo?.id || state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (modeloId) {
      await carregarModeloCompleto(modeloId);
      return modeloId;
    }

    throw new Error('Não foi possível criar ou selecionar o formulário padrão.');
  }

  async function garantirSecaoPadrao() {
    const modeloId = await garantirModeloAtual();

    if (getSecoes().length) {
      return true;
    }

    await apiJson(`${API_BASE}/modelos/${modeloId}/secoes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: 'Dados Básicos',
        descricao: 'Campos principais do cadastro.',
        icone: 'fa-id-card',
        ordem: 1,
        ativo: true,
      }),
    });

    await carregarModeloCompleto(modeloId);

    return true;
  }

  async function carregarCamposSistema() {
    setLoadingSelect(qs('campo-sistema'), 'Carregando campos...');
    const fallback = camposSistemaFallback(state.modulo);

    try {
      const data = await apiJson(`${API_BASE}/campos-sistema?modulo=${encodeURIComponent(state.modulo)}`);
      state.camposSistema = Array.isArray(data?.campos) && data.campos.length ? data.campos : fallback;
    } catch (err) {
      console.warn('[Formulários] campos do sistema vieram do fallback local:', err);
      state.camposSistema = fallback;
    }

    renderCampoSistemaSelect();
  }

  async function carregarCamposPersonalizados() {
    setLoadingSelect(qs('campo-personalizado'), 'Carregando campos...');
    const endpoint = MODULOS[state.modulo]?.customEndpoint;

    if (!endpoint) {
      state.camposPersonalizados = [];
      renderCampoPersonalizadoSelect();
      return;
    }

    try {
      const data = await apiJson(endpoint);
      state.camposPersonalizados = Array.isArray(data) ? data : [];

      state.camposPersonalizados.sort((a, b) => {
        return Number(a.ordem || 0) - Number(b.ordem || 0) ||
          String(a.nome || '').localeCompare(String(b.nome || ''));
      });
    } catch (err) {
      console.warn('[Formulários] não foi possível carregar campos personalizados:', err);
      state.camposPersonalizados = [];
    }

    renderCampoPersonalizadoSelect();
  }

  function normalizarNomeModelo(valor = '') {
    return String(valor || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function tituloCadastroModulo(modulo = state.modulo) {
    const titulos = {
      clientes: 'Cadastro de clientes',
      fornecedores: 'Cadastro de fornecedores',
      produtos: 'Cadastro de produtos',
      patrimonio: 'Cadastro de patrimônio',
      cotacoes: 'Cadastro de cotações',
      propostas: 'Cadastro de propostas',
      contratos: 'Cadastro de contratos',
      contas_receber: 'Contas a receber',
      contas_pagar: 'Contas a pagar',
    };

    return titulos[modulo] || `Cadastro de ${String(MODULOS[modulo]?.label || modulo || 'itens').toLowerCase()}`;
  }

  function modeloTemNomeGenericoPadrao(modelo) {
    const nome = normalizarNomeModelo(modelo?.nome);
    if (!nome) return false;

    const modulo = String(modelo?.modulo || state.modulo || '');
    const aliases = {
      clientes: [
        'cadastro padrao clientes',
        'cadastro padrao cliente',
        'cadastro padrao de clientes',
        'cadastro padrao de cliente',
        'cadastro de clientes',
        'cadastro de cliente',
      ],
      fornecedores: [
        'cadastro padrao fornecedores',
        'cadastro padrao fornecedor',
        'cadastro padrao de fornecedores',
        'cadastro padrao de fornecedor',
        'cadastro de fornecedores',
        'cadastro de fornecedor',
      ],
      produtos: [
        'cadastro padrao produtos',
        'cadastro padrao produto',
        'cadastro padrao de produtos',
        'cadastro padrao de produto',
        'cadastro de produtos',
        'cadastro de produto',
      ],
      patrimonio: [
        'cadastro padrao patrimonio',
        'cadastro padrao de patrimonio',
        'cadastro de patrimonio',
      ],
      cotacoes: [
        'cadastro padrao cotacoes',
        'cadastro padrao cotacao',
        'cadastro padrao de cotacoes',
        'cadastro padrao de cotacao',
        'cadastro de cotacoes',
        'cadastro de cotacao',
      ],
      propostas: [
        'cadastro padrao propostas',
        'cadastro padrao proposta',
        'cadastro padrao de propostas',
        'cadastro padrao de proposta',
        'cadastro de propostas',
        'cadastro de proposta',
      ],
      contratos: [
        'cadastro padrao contratos',
        'cadastro padrao contrato',
        'cadastro padrao de contratos',
        'cadastro padrao de contrato',
        'cadastro de contratos',
        'cadastro de contrato',
      ],
    };

    return (aliases[modulo] || []).includes(nome);
  }

  function modeloPrincipalDaLista(modelos = state.modelos) {
    return modelos.find((m) => m.usar_como_ficha_principal)
      || modelos.find((m) => m.padrao)
      || modelos[0]
      || null;
  }

  function modelosVisiveisNoSeletor() {
    const modelos = Array.isArray(state.modelos) ? state.modelos : [];
    if (!modelos.length) return [];

    const principal = modeloPrincipalDaLista(modelos);
    const existeModeloOficial = modelos.some((m) => m.padrao || m.usar_como_ficha_principal);
    const atualId = Number(state.modeloAtual?.modelo?.id || 0);

    return modelos.filter((modelo) => {
      const id = Number(modelo.id || 0);

      // O modelo efetivamente usado pelo sistema sempre aparece.
      if (principal && id === Number(principal.id)) return true;

      // Se o usuário já estiver editando um modelo específico, não o faça sumir no meio da edição.
      if (atualId && id === atualId) return true;

      // Padrão e ficha principal são configurações relevantes e nunca são ocultadas.
      if (modelo.padrao || modelo.usar_como_ficha_principal) return true;

      // Havendo um modelo oficial, modelos antigos com nomes genéricos equivalentes
      // (ex.: "Cadastro padrão de cliente") deixam de poluir o seletor principal.
      if (existeModeloOficial && modeloTemNomeGenericoPadrao(modelo)) return false;

      // Modelos realmente personalizados continuam disponíveis normalmente.
      return true;
    });
  }

  function nomeModeloNoSeletor(modelo) {
    const generico = modeloTemNomeGenericoPadrao(modelo);
    let nome = generico ? tituloCadastroModulo(modelo?.modulo) : String(modelo?.nome || 'Formulário');

    if (modelo?.usar_como_ficha_principal) {
      nome += ' — Principal';
    } else if (modelo?.padrao) {
      nome += ' — Padrão';
    }

    return nome;
  }

  function renderModelosSelect() {
    const select = qs('select-modelo');
    if (!select) return;

    clearLoadingSelect(select);

    if (!state.modelos.length) {
      select.innerHTML = '<option value="">Nenhum formulário criado</option>';
      return;
    }

    const modelosVisiveis = modelosVisiveisNoSeletor();

    select.innerHTML = modelosVisiveis.map((modelo) => {
      return `<option value="${modelo.id}">${escapeHtml(nomeModeloNoSeletor(modelo))}</option>`;
    }).join('');
  }

  function getResumoFormulario() {
    const atual = state.modeloAtual || {};
    const secoes = getSecoes();
    const semSecao = Array.isArray(atual.campos_sem_secao) ? atual.campos_sem_secao : [];
    const campos = [
      ...secoes.flatMap((secao) => Array.isArray(secao.campos) ? secao.campos : []),
      ...semSecao,
    ];

    const personalizados = campos.filter((campo) => (campo.origem || 'personalizado') === 'personalizado').length;
    const sistema = campos.filter((campo) => campo.origem === 'sistema').length;
    const visual = campos.filter((campo) => campo.origem === 'visual').length;

    return {
      secoes: secoes.length,
      campos: campos.length,
      personalizados,
      sistema,
      visual,
    };
  }

  function renderResumoFormulario() {
    const resumo = getResumoFormulario();
    const nativeFilters = PREVIEW_LOCALIZAR_NATIVO[state.modulo] || [];
    const nativeColumns = PREVIEW_TABELA_NATIVA[state.modulo] || [];
    const camposLocalizar = getCamposPreview(campoDeveAparecerNoLocalizarPreview);
    const camposTabela = getCamposPreview(campoMarcadoTabela);
    const filtros = itensPreviewFiltros(nativeFilters, camposLocalizar);
    const colunas = itensPreviewTabela(nativeColumns, camposTabela);
    const filtrosVisiveis = filtros.filter((field) => isItemPreviewVisivel('filters', field.origin || 'nativo', field.key, !!field.fixed)).length;
    const colunasVisiveis = colunas.filter((col) => {
      const origin = col.origin || 'nativo';
      const fixed = !!col.fixed || col.key === 'acoes';
      return isItemPreviewVisivel('columns', origin, col.key, fixed);
    }).length;

    const values = {
      'stat-cadastro-count': resumo.campos,
      'stat-cadastro-secoes': resumo.secoes,
      'stat-lista-count': colunasVisiveis,
      'stat-busca-count': filtrosVisiveis,
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = qs(id);
      if (el) el.textContent = String(value || 0);
    });

    atualizarContagemModuloSidebar(resumo.campos);

    const modelo = state.modeloAtual?.modelo || null;
    const chip = qs('form-status-chip');
    if (chip) {
      chip.textContent = modelo?.usar_como_ficha_principal ? 'Principal' : (modelo?.padrao ? 'Padrão' : 'Personalizado');
      chip.classList.toggle('is-off', modelo?.ativo === false);
    }
  }

  function renderModeloAtual() {
    const modelo = state.modeloAtual?.modelo || null;
    const moduloTitulo = qs('modulo-titulo');
    const breadcrumbModulo = qs('workspace-breadcrumb-module');
    const pageTitle = qs('form-page-title');
    const modeloNome = qs('modelo-nome');
    const modeloDescricao = qs('modelo-descricao');
    const selectShell = qs('model-switcher-shell');
    const toggleModel = qs('btn-toggle-model-select');

    if (moduloTitulo) moduloTitulo.textContent = moduloLabel();
    if (breadcrumbModulo) breadcrumbModulo.textContent = moduloLabel();
    if (pageTitle) pageTitle.textContent = `Cadastro de ${moduloLabel().toLowerCase()}`;
    if (modeloNome) modeloNome.textContent = modelo ? nomeModeloNoSeletor(modelo) : `Cadastro de ${moduloLabel().toLowerCase()}`;
    if (modeloDescricao) modeloDescricao.textContent = modelo?.descricao || 'Defina o que aparece no cadastro, na lista e na busca.';

    const modelosVisiveis = modelosVisiveisNoSeletor();
    if (toggleModel) toggleModel.hidden = modelosVisiveis.length <= 1;
    if (selectShell) {
      selectShell.hidden = modelosVisiveis.length <= 1 || !selectShell.classList.contains('is-open');
    }

    const hasModelo = !!(modelo?.id || qs('select-modelo')?.value);
    ['btn-editar-modelo','btn-nova-secao','btn-campo-sistema','btn-novo-campo'].forEach((id) => {
      const el = qs(id); if (el) el.disabled = !hasModelo;
    });

    const empty = qs('builder-empty');
    const wrap = qs('secoes-container');
    if (!modelo) {
      if (empty) empty.hidden = false;
      if (wrap) wrap.innerHTML = '';
      renderResumoFormulario();
      renderPreviewLocalizar();
      return;
    }
    if (empty) empty.hidden = true;
    renderResumoFormulario();
    renderSecoes();
    renderSecaoSelect();
    renderPreviewLocalizar();
    atualizarEtapasUI();
  }

  function camposOrdenados(campos = []) {
    return [...campos].sort((a, b) => {
      return Number(a.ordem || 0) - Number(b.ordem || 0) ||
        Number(a.id || 0) - Number(b.id || 0);
    });
  }

  function normalizarTextoWorkspace(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function aplicarFiltroCamposWorkspace() {
    const wrap = qs('secoes-container');
    if (!wrap) return;

    const buscaInput = wrap.querySelector('[data-field-search]');
    const tipoSelect = wrap.querySelector('[data-field-type-filter]');
    const termo = normalizarTextoWorkspace(buscaInput?.value ?? state.campoBusca);
    const tipo = normalizarTextoWorkspace(tipoSelect?.value ?? state.campoTipoFiltro);

    state.campoBusca = buscaInput?.value ?? state.campoBusca;
    state.campoTipoFiltro = tipoSelect?.value ?? state.campoTipoFiltro;

    const rows = Array.from(wrap.querySelectorAll('.form-field-row[data-field-label]'));
    let visiveis = 0;
    rows.forEach((row) => {
      const label = normalizarTextoWorkspace(row.dataset.fieldLabel);
      const rowTipo = normalizarTextoWorkspace(row.dataset.fieldType);
      const mostrar = (!termo || label.includes(termo)) && (!tipo || rowTipo === tipo);
      row.hidden = !mostrar;
      if (mostrar) visiveis += 1;
    });

    const empty = wrap.querySelector('[data-field-filter-empty]');
    if (empty) empty.hidden = rows.length === 0 || visiveis > 0;
  }

  function renderSecoes() {
    const wrap = qs('secoes-container');
    if (!wrap) return;
    const atual = state.modeloAtual;
    if (!atual?.modelo) { wrap.innerHTML = ''; return; }

    const secoes = getSecoes();
    const camposSemSecao = Array.isArray(atual.campos_sem_secao) ? atual.campos_sem_secao : [];
    if (!secoes.length && !camposSemSecao.length) {
      wrap.innerHTML = `<div class="form-builder-empty"><i class="fa-regular fa-folder-open"></i><strong>Seu formulário ainda está vazio</strong><span>Crie a primeira seção para começar a organizar o cadastro.</span><button class="btn btn-primary" type="button" data-action="nova-secao"><i class="fa-solid fa-plus"></i> Criar primeira seção</button></div>`;
      return;
    }

    const todasSecoes = [...secoes];
    if (camposSemSecao.length) todasSecoes.push({ id: 'sem-secao', titulo: 'Campos sem seção', icone: 'fa-layer-group', campos: camposSemSecao, semSecao: true, ativo: true });

    let selecionada = todasSecoes.find(s => String(s.id) === String(state.secaoSelecionadaId));
    if (!selecionada) selecionada = todasSecoes[0];
    state.secaoSelecionadaId = selecionada?.id ?? null;

    const campos = camposOrdenados(selecionada?.campos || []);
    let campoSelecionado = campos.find(c => Number(c.id) === Number(state.campoSelecionadoId));
    if (!campoSelecionado) campoSelecionado = campos[0] || null;
    state.campoSelecionadoId = campoSelecionado?.id ?? null;

    const secoesHtml = todasSecoes.map((secao) => {
      const ativo = String(secao.id) === String(state.secaoSelecionadaId);
      const count = Array.isArray(secao.campos) ? secao.campos.length : 0;
      return `<button class="form-section-item ${ativo ? 'is-active' : ''}" type="button" data-action="selecionar-secao" data-id="${escapeHtml(secao.id)}">
        <span class="form-section-icon"><i class="fa-solid ${escapeHtml(getIconeSecao(secao))}"></i></span>
        <span class="form-section-copy"><strong>${escapeHtml(secao.titulo || 'Seção')}</strong><small>${count} ${count === 1 ? 'campo' : 'campos'}</small></span>
        ${secao.semSecao ? '' : `<span class="form-section-actions"><span class="icon-btn" data-action="editar-secao" data-id="${secao.id}" title="Editar seção"><i class="fa-solid fa-ellipsis"></i></span></span>`}
      </button>`;
    }).join('');

    const tiposDisponiveis = [...new Set(campos.map((campo) => tipoLabel(campo)).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
    const tipoOptions = tiposDisponiveis.map((tipo) => `<option value="${escapeHtml(tipo)}" ${String(state.campoTipoFiltro) === String(tipo) ? 'selected' : ''}>${escapeHtml(tipo)}</option>`).join('');

    const camposHtml = campos.length ? campos.map((campo, index) => {
      const selecionado = Number(campo.id) === Number(state.campoSelecionadoId);
      const tipo = tipoLabel(campo);
      const origem = campo.origem === 'sistema' ? 'Sistema' : (campo.origem === 'visual' ? 'Visual' : 'Personalizado');
      const ordem = index + 1;
      return `<div class="form-field-row ${selecionado ? 'is-active' : ''} ${campo.ativo === false ? 'is-hidden-field' : ''}" role="button" tabindex="0" data-action="selecionar-campo" data-id="${campo.id}" data-field-label="${escapeHtml(`${campo.label || ''} ${origem} ${tipo}`)}" data-field-type="${escapeHtml(tipo)}" aria-pressed="${selecionado ? 'true' : 'false'}">
        <span class="form-field-order">${escapeHtml(ordem)}</span>
        <span class="form-field-copy"><strong>${escapeHtml(campo.label || '-')}</strong><small>${escapeHtml(origem)}${campo.ativo === false ? ' · Oculto' : ''}</small></span>
        <span class="form-field-type-badge">${escapeHtml(tipo)}</span>
        <span class="form-field-flags">${campo.obrigatorio ? '<em class="flag-required">Obrigatório</em>' : '<em>Opcional</em>'}</span>
        <button class="form-field-edit" type="button" data-action="editar-campo" data-id="${campo.id}" title="Editar campo" aria-label="Editar ${escapeHtml(campo.label || 'campo')}"><i class="fa-solid fa-pen"></i></button>
      </div>`;
    }).join('') : `<div class="fields-empty"><span>Nenhum campo nesta seção.</span><button type="button" class="btn btn-primary btn-small" data-action="novo-campo-secao"><i class="fa-solid fa-plus"></i> Adicionar campo</button></div>`;

    wrap.innerHTML = `<div class="form-builder-grid workspace-builder-grid">
      <section class="form-builder-column sections-column">
        <div class="builder-column-head"><div><h3>Seções do formulário</h3><p>Organize o cadastro por assuntos.</p></div><button class="btn btn-secondary btn-small" type="button" data-action="nova-secao"><i class="fa-solid fa-plus"></i> Nova seção</button></div>
        <div class="form-sections-list">${secoesHtml}</div>
      </section>
      <section class="form-builder-column fields-column">
        <div class="builder-column-head"><div><h3>Campos da seção</h3><p>${escapeHtml(selecionada?.titulo || '')} · ${campos.length} ${campos.length === 1 ? 'campo' : 'campos'}</p></div><button class="btn btn-primary btn-small builder-head-add-field" type="button" data-action="novo-campo-secao"><i class="fa-solid fa-plus"></i> Adicionar campo</button></div>
        ${campos.length ? `<div class="workspace-field-tools">
          <label class="workspace-field-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-field-search placeholder="Buscar campo..." autocomplete="off" value="${escapeHtml(state.campoBusca)}"></label>
          <select class="workspace-field-type" data-field-type-filter aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>${tipoOptions}</select>
        </div>
        <div class="workspace-field-table-head" aria-hidden="true"><span>Ordem</span><span>Nome do campo</span><span>Tipo</span><span>Regra</span><span>Ações</span></div>` : ''}
        <div class="form-fields-list">${camposHtml}${campos.length ? '<div class="workspace-filter-empty" data-field-filter-empty hidden><i class="fa-solid fa-magnifying-glass"></i><strong>Nenhum campo encontrado</strong><span>Tente outro nome ou tipo.</span></div>' : ''}</div>
      </section>
    </div>`;

    aplicarFiltroCamposWorkspace();
  }

  function renderEditorRapidoCampo(campo) {
    const exibicao = getCampoExibicao(campo);
    const onBusca = isFlagOn(exibicao.usar_no_localizar ?? exibicao.localizar ?? exibicao.filtro);
    const onLista = isFlagOn(exibicao.mostrar_na_tabela ?? exibicao.tabela ?? exibicao.coluna);
    const origem = campo.origem === 'sistema' ? 'Campo do sistema' : (campo.origem === 'visual' ? 'Elemento visual' : 'Campo personalizado');
    const toggle = (key, checked, label, desc='') => `<label class="quick-toggle"><span><strong>${label}</strong>${desc ? `<small>${desc}</small>` : ''}</span><input type="checkbox" data-quick-field="${key}" data-id="${campo.id}" ${checked ? 'checked' : ''}><i aria-hidden="true"></i></label>`;
    return `<div class="quick-editor-head"><div><span class="eyebrow">Editar campo</span><h3>${escapeHtml(campo.label || 'Campo')}</h3><p>${escapeHtml(origem)} · ${escapeHtml(tipoLabel(campo))}</p></div><button class="icon-btn" type="button" data-action="editar-campo" data-id="${campo.id}" title="Abrir opções completas"><i class="fa-solid fa-pen"></i></button></div>
      <div class="quick-editor-group"><h4>Visibilidade</h4>
        ${toggle('ativo', campo.ativo !== false, 'Mostrar no cadastro', 'Exibe este campo na ficha.')}
        ${toggle('mostrar_na_tabela', onLista, 'Mostrar na lista', 'Exibe como informação na listagem.')}
        ${toggle('usar_no_localizar', onBusca, 'Usar na busca', 'Permite procurar e filtrar por ele.')}
      </div>
      <div class="quick-editor-group"><h4>Regra</h4>${toggle('obrigatorio', !!campo.obrigatorio, 'Obrigatório', 'Exige preenchimento antes de salvar.')}</div>
      <button class="btn btn-secondary quick-full-edit" type="button" data-action="editar-campo" data-id="${campo.id}"><i class="fa-solid fa-sliders"></i> Mais opções do campo</button>`;
  }

  function atualizarEtapasUI() {
    document.querySelectorAll('[data-form-step]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.formStep === state.etapaAtiva));
    document.querySelectorAll('[data-form-pane]').forEach((pane) => pane.hidden = pane.dataset.formPane !== state.etapaAtiva);
  }

  async function atualizarCampoRapido(id, key, checked, input) {
    const campo = findCampo(id);
    if (!campo) return;
    const payload = {};
    if (key === 'ativo' || key === 'obrigatorio') {
      payload[key] = !!checked;
    } else {
      const condicao = { ...getCampoCondicao(campo) };
      condicao.exibicao = { ...(condicao.exibicao || {}), [key]: !!checked };
      payload.condicao = condicao;
    }
    if (input) input.disabled = true;
    try {
      await apiJson(`${API_BASE}/campos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;
      await carregarModeloCompleto(modeloId);
      toast('Alteração salva automaticamente.');
    } catch (err) {
      if (input) input.checked = !checked;
      toast(err.message || 'Não foi possível alterar o campo.', true);
    } finally {
      if (input) input.disabled = false;
    }
  }

  function renderSecaoSelect(selectedId = '') {
    const select = qs('campo-secao');
    if (!select) return;

    const secoes = getSecoes();

    if (!secoes.length) {
      select.innerHTML = '<option value="">Crie uma seção antes</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione uma seção</option>' + secoes.map((secao) => {
      const selected = String(selectedId || '') === String(secao.id) ? 'selected' : '';
      return `<option value="${secao.id}" ${selected}>${escapeHtml(secao.titulo)}</option>`;
    }).join('');
  }

  function renderCampoSistemaSelect(selectedValue = '') {
    const select = qs('campo-sistema');
    if (!select) return;

    clearLoadingSelect(select);

    if (!state.camposSistema.length) {
      select.innerHTML = '<option value="">Nenhum campo do sistema encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposSistema.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.campo || '') ? 'selected' : '';

      return `
        <option
          value="${escapeHtml(campo.campo)}"
          data-label="${escapeHtml(campo.label)}"
          data-tipo="${escapeHtml(campo.tipo || 'texto')}"
          ${selected}
        >
          ${escapeHtml(campo.label)} (${escapeHtml(campo.campo)})
        </option>
      `;
    }).join('');
  }

  function renderCampoPersonalizadoSelect(selectedValue = '') {
    const select = qs('campo-personalizado');
    if (!select) return;

    clearLoadingSelect(select);

    if (!state.camposPersonalizados.length) {
      select.innerHTML = '<option value="">Nenhum campo personalizado encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposPersonalizados.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.id || '') ? 'selected' : '';

      return `
        <option
          value="${campo.id}"
          data-label="${escapeHtml(campo.nome || '')}"
          data-tipo="${escapeHtml(campo.tipo || 'texto')}"
          ${selected}
        >
          ${escapeHtml(campo.nome || '-')} (${escapeHtml(campo.slug || campo.id)})
        </option>
      `;
    }).join('');
  }

  function applyCampoDrawerSectionVisibility(element, visible, display = 'block') {
    if (!element) return;

    element.hidden = !visible;
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');

    // Existem regras antigas do editor com display !important e também uma
    // rotina de integridade que já aplicou estilos inline. Por isso a aba
    // precisa controlar o display no próprio elemento, com a mesma prioridade.
    if (visible) {
      element.style.setProperty('display', display, 'important');
      element.style.setProperty('visibility', 'visible', 'important');
      element.style.setProperty('opacity', '1', 'important');
      element.style.setProperty('content-visibility', 'visible', 'important');
    } else {
      element.style.setProperty('display', 'none', 'important');
      element.style.setProperty('visibility', 'hidden', 'important');
      element.style.setProperty('opacity', '0', 'important');
      element.style.setProperty('content-visibility', 'hidden', 'important');
    }
  }

  function syncCampoDrawerTabContent() {
    const modal = qs('modal-campo');
    if (!modal) return;

    const isAdvanced = modal.dataset.campoTab === 'avancado';

    modal.querySelectorAll('.field-main-section').forEach((section) => {
      applyCampoDrawerSectionVisibility(section, !isAdvanced, 'block');
    });

    modal.querySelectorAll('.field-flat-toggles').forEach((section) => {
      applyCampoDrawerSectionVisibility(section, !isAdvanced, 'block');
    });

    modal.querySelectorAll('.field-flat-properties, .field-flat-automation, .field-flat-help').forEach((section) => {
      applyCampoDrawerSectionVisibility(section, isAdvanced, 'block');
    });

    modal.querySelectorAll('.field-flat-divider').forEach((divider) => {
      applyCampoDrawerSectionVisibility(divider, isAdvanced, 'block');
    });
  }

  function setCampoDrawerTab(tab = 'geral') {
    const modal = qs('modal-campo');
    if (!modal) return;

    const normalized = tab === 'avancado' ? 'avancado' : 'geral';
    modal.dataset.campoTab = normalized;

    modal.querySelectorAll('[data-campo-drawer-tab]').forEach((button) => {
      const active = button.dataset.campoDrawerTab === normalized;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });

    syncCampoDrawerTabContent();

    const body = modal.querySelector('.premium-modal-body');
    if (body) body.scrollTop = 0;
  }

  function setSecaoDrawerTab(tab = 'geral') {
    const modal = qs('modal-secao');
    if (!modal) return;

    const normalized = tab === 'avancado' ? 'avancado' : 'geral';
    modal.dataset.secaoTab = normalized;

    modal.querySelectorAll('[data-secao-drawer-tab]').forEach((button) => {
      const active = button.dataset.secaoDrawerTab === normalized;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    });

    modal.querySelectorAll('.secao-drawer-geral').forEach((section) => {
      section.hidden = normalized !== 'geral';
    });
    modal.querySelectorAll('.secao-drawer-avancado').forEach((section) => {
      section.hidden = normalized !== 'avancado';
    });

    const body = modal.querySelector('.premium-modal-body');
    if (body) body.scrollTop = 0;
  }

  function atualizarSecaoDrawerSummary() {
    const labelEl = qs('secao-drawer-summary-label');
    const subtitleEl = qs('secao-drawer-summary-subtitle');
    const activeBadge = qs('secao-drawer-badge-active');
    const icon = document.querySelector('#secao-drawer-summary .campo-drawer-summary-icon i');
    if (!labelEl) return;

    const titulo = qs('secao-titulo')?.value?.trim() || (state.secaoEditando ? 'Editar seção' : 'Nova seção');
    labelEl.textContent = titulo;
    if (subtitleEl) subtitleEl.textContent = state.modulo ? `Seção de ${tituloModulo(state.modulo)}` : 'Seção do formulário';

    const ativo = qs('secao-ativo')?.checked !== false;
    if (activeBadge) {
      activeBadge.textContent = ativo ? 'Seção ativa' : 'Seção oculta';
      activeBadge.classList.toggle('is-active', ativo);
      activeBadge.classList.toggle('is-inactive', !ativo);
    }

    const iconClass = normalizarIconeSecao(qs('secao-icone')?.value) || 'fa-table-list';
    if (icon) icon.className = `fa-solid ${iconClass}`;
  }

  function atualizarCampoDrawerSummary() {
    const labelEl = qs('campo-drawer-summary-label');
    const sectionEl = qs('campo-drawer-summary-section');
    const originBadge = qs('campo-drawer-badge-origin');
    const activeBadge = qs('campo-drawer-badge-active');
    const icon = document.querySelector('#campo-drawer-summary .campo-drawer-summary-icon i');

    if (!labelEl || !sectionEl) return;

    const origem = qs('campo-origem')?.value || 'personalizado';
    const sectionText = qs('campo-secao')?.selectedOptions?.[0]?.textContent?.trim() || 'Selecione uma seção';
    let label = qs('campo-label')?.value?.trim() || '';
    let originText = 'Personalizado';
    let iconClass = 'fa-font';

    if (origem === 'sistema') {
      const opt = qs('campo-sistema')?.selectedOptions?.[0];
      label = label || opt?.dataset?.label || opt?.textContent?.trim() || 'Campo do sistema';
      originText = 'Campo do sistema';
      iconClass = 'fa-database';
    } else if (origem === 'visual') {
      label = label || 'Item visual';
      originText = 'Item visual';
      iconClass = 'fa-heading';
    }

    labelEl.textContent = label || 'Novo campo';
    sectionEl.textContent = sectionText || 'Selecione uma seção';

    if (originBadge) {
      originBadge.textContent = originText;
      originBadge.classList.toggle('is-system', origem === 'sistema');
      originBadge.classList.toggle('is-visual', origem === 'visual');
    }

    if (activeBadge) {
      const active = qs('campo-ativo')?.checked !== false;
      activeBadge.textContent = active ? 'Campo ativo' : 'Campo oculto';
      activeBadge.classList.toggle('is-active', active);
      activeBadge.classList.toggle('is-inactive', !active);
    }

    if (icon) icon.className = `fa-solid ${iconClass}`;
  }

  function atualizarCampoPreview() {
    const previewLabel = qs('campo-preview-label');
    const previewHint = qs('campo-preview-hint');
    const previewIcon = document.querySelector('#campo-preview .campo-preview-icon i');

    if (!previewLabel || !previewHint) return;

    const origem = qs('campo-origem')?.value || 'personalizado';

    let texto = '';
    let dica = '';
    let icon = 'fa-pen-to-square';

    if (origem === 'sistema') {
      const opt = qs('campo-sistema')?.selectedOptions?.[0];
      texto = opt?.dataset?.label || opt?.textContent || '';
      dica = 'Campo do sistema: usa informação que já existe no cadastro.';
      icon = 'fa-database';
    } else if (origem === 'visual') {
      texto = qs('campo-label')?.value || qs('campo-tipo-visual')?.value || '';
      dica = 'Item visual: título, aviso ou separador para organizar o formulário.';
      icon = 'fa-heading';
    } else {
      texto = qs('campo-label')?.value || '';
      const selectTipo = qs('campo-tipo-campo');
      const tipoValue = getTipoCampoEfetivo();
      const relacao = getRelacaoConfigFromTipo(tipoValue);
      const tipoBase = relacao.entidade
        ? `Vinculado a ${relacao.entidade}${relacao.multiplo ? ' (múltiplo)' : ''}`
        : (selectTipo?.selectedOptions?.[0]?.textContent || 'Texto');
      dica = `Novo campo personalizado • Tipo: ${tipoBase}`;

      if (tipoValue === 'multiselect') {
        icon = 'fa-list-check';
      } else if (String(tipoValue).startsWith('relacao_') && String(tipoValue).endsWith('_multi')) {
        icon = 'fa-object-group';
      } else if (String(tipoValue).startsWith('relacao_')) {
        icon = 'fa-database';
      } else {
        icon = 'fa-pen-to-square';
      }
    }

    texto = String(texto || '').replace(/\s*\(.+\)\s*$/, '').trim();

    previewLabel.textContent = texto || (origem === 'sistema' ? 'Nenhum campo selecionado' : 'Novo campo personalizado');

    previewHint.textContent = texto
      ? dica
      : (origem === 'sistema'
        ? 'Escolha o campo do sistema que entrará no formulário.'
        : 'Digite o nome do campo para ver como ele ficará no formulário.');

    if (previewIcon) {
      previewIcon.className = `fa-solid ${icon}`;
    }

    atualizarCampoDrawerSummary();
  }

  function syncCampoOpcoesVisibility() {
    const tipo = getTipoCampoEfetivo();
    const row = qs('campo-opcoes')?.closest('.form-group');
    const hint = row?.querySelector('.field-hint');
    if (!row) return;

    const shouldShow = tipo === 'select' || tipo === 'multiselect';
    const isRelation = String(tipo).startsWith('relacao_');
    const isRelationMulti = isRelation && String(tipo).endsWith('_multi');

    row.hidden = !shouldShow;
    row.classList.toggle('is-hidden', !shouldShow);
    row.classList.toggle('is-relation-hidden', isRelation);

    if (hint) {
      hint.textContent = isRelationMulti
        ? 'Esse campo puxará cadastros do sistema e permitirá selecionar vários registros.'
        : (tipo === 'multiselect'
          ? 'Uma opção por linha. Ao remover uma opção, cadastros antigos mantêm o valor salvo e ele será sinalizado até ser atualizado.'
          : 'Uma opção por linha. Ao remover uma opção, cadastros antigos mantêm o valor salvo e ele será sinalizado até ser atualizado.');
    }

    if (!shouldShow && !state.campoEditando) {
      const input = qs('campo-opcoes');
      if (input) input.value = '';
    }

    ensureCampoModalIntegrity();
  }

  function aplicarModoCampo(origem) {
    origem = origem || 'personalizado';

    const isSistema = origem === 'sistema';
    const isVisual = origem === 'visual';

    const rowSistema = qs('row-campo-sistema');
    const rowNovo = qs('row-campo-novo');
    const rowPersonalizado = qs('row-campo-personalizado');
    const rowVisual = qs('row-campo-visual');
    const guide = qs('campo-simple-guide');
    const title = qs('modal-campo-title');
    const subtitle = qs('modal-campo-subtitle');
    const btnSalvar = qs('btn-salvar-campo');

    if (rowSistema) rowSistema.style.display = isSistema ? '' : 'none';
    if (rowNovo) rowNovo.style.display = isSistema ? 'none' : '';
    if (rowPersonalizado) rowPersonalizado.style.display = 'none';
    if (rowVisual) rowVisual.style.display = isVisual ? '' : 'none';

    if (isSistema) {
      if (title) title.textContent = 'Adicionar campo do sistema';
      if (subtitle) subtitle.textContent = 'Escolha uma informação que já existe no cadastro e coloque dentro da seção.';
      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-check"></i> Adicionar campo';

      if (guide) {
        guide.innerHTML = `
          <strong>Adicionar campo do sistema</strong>
          <ol>
            <li>Escolha em qual seção o campo vai aparecer.</li>
            <li>Escolha uma informação já existente.</li>
            <li>Marque se é obrigatório e mantenha ativo.</li>
            <li>Salve.</li>
          </ol>
        `;
      }
    } else {
      if (title) title.textContent = isVisual ? 'Adicionar item visual' : 'Novo campo';

      if (subtitle) {
        subtitle.textContent = isVisual
          ? 'Crie um título, aviso ou separador para organizar o formulário.'
          : 'Crie uma nova informação personalizada para este formulário.';
      }

      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-check"></i> Criar campo';

      if (guide) {
        guide.innerHTML = `
          <strong>${isVisual ? 'Adicionar item visual' : 'Novo campo'}</strong>
          <ol>
            <li>Escolha em qual seção vai aparecer.</li>
            <li>${isVisual ? 'Digite o texto ou título.' : 'Digite o nome do novo campo.'}</li>
            <li>${isVisual ? 'Defina a ordem, se precisar.' : 'Escolha o tipo e marque se é obrigatório.'}</li>
            <li>Salve.</li>
          </ol>
        `;
      }
    }

    syncCampoOpcoesVisibility();
    syncCampoAutomationState();
    atualizarCampoPreview();
  }

  function toggleCampoOrigem() {
    const origem = qs('campo-origem')?.value || 'personalizado';
    aplicarModoCampo(origem);
  }

  function preencherLabelPorSistema() {
    const opt = qs('campo-sistema')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';
    const nomeLimpo = label.replace(/\s*\(.+\)\s*$/, '').trim();

    if (nomeLimpo) qs('campo-label').value = nomeLimpo;
    qs('campo-tipo-campo').value = getTipoCampoBaseSelect(tipo || 'texto');
    applyCampoRelationConfig(tipo || '');

    syncCampoOpcoesVisibility();
    syncCampoAutomationState();
    atualizarCampoPreview();
  }

  function preencherLabelPorPersonalizado() {
    const opt = qs('campo-personalizado')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';
    const nomeLimpo = label.replace(/\s*\(.+\)\s*$/, '').trim();

    if (nomeLimpo) qs('campo-label').value = nomeLimpo;
    qs('campo-tipo-campo').value = getTipoCampoBaseSelect(tipo || 'texto');
    applyCampoRelationConfig(tipo || '');

    syncCampoOpcoesVisibility();
    syncCampoAutomationState();
    atualizarCampoPreview();
  }

  function syncModeloFichaPrincipalCopy() {
    const checkbox = qs('modelo-ficha-principal');
    const card = checkbox?.closest('.check-card');
    if (!checkbox || !card) return;

    const modulo = String(qs('modelo-modulo')?.value || state.modulo || '');
    const financeiro = ['contas_receber', 'contas_pagar'].includes(modulo);
    const title = card.querySelector('strong');
    const help = card.querySelector('small');

    if (title) title.textContent = financeiro ? 'Ficha simplificada' : 'Ficha principal';
    if (help) {
      help.textContent = financeiro
        ? 'Mostra os campos essenciais do financeiro e os personalizados; campos opcionais do sistema ficam ocultos.'
        : 'Mostra só o código do sistema e as seções deste formulário no cadastro.';
    }
  }

  function resetModeloForm(edit = false) {
    state.modeloEditando = edit ? state.modeloAtual?.modelo : null;

    qs('modal-modelo-title').textContent = edit ? 'Editar formulário' : 'Novo formulário';
    qs('modelo-id').value = edit && state.modeloEditando ? state.modeloEditando.id : '';
    qs('modelo-modulo').value = edit && state.modeloEditando ? state.modeloEditando.modulo : state.modulo;
    qs('modelo-nome-input').value = edit && state.modeloEditando ? state.modeloEditando.nome || '' : '';
    qs('modelo-descricao-input').value = edit && state.modeloEditando ? state.modeloEditando.descricao || '' : '';
    qs('modelo-ativo').checked = edit && state.modeloEditando ? state.modeloEditando.ativo !== false : true;
    qs('modelo-padrao').checked = edit && state.modeloEditando ? !!state.modeloEditando.padrao : false;
    qs('modelo-ficha-principal').checked = edit && state.modeloEditando ? !!state.modeloEditando.usar_como_ficha_principal : false;
    syncModeloFichaPrincipalCopy();
  }

  function resetSecaoForm(secao = null) {
    state.secaoEditando = secao;
    setSecaoDrawerTab('geral');

    qs('modal-secao-title').textContent = secao ? 'Editar seção' : 'Nova seção';
    qs('secao-id').value = secao?.id || '';
    qs('secao-titulo').value = secao?.titulo || '';
    qs('secao-descricao').value = secao?.descricao || '';
    qs('secao-ordem').value = secao ? Number(secao.ordem || 0) : proximaOrdemSecao();
    qs('secao-ativo').checked = secao ? secao.ativo !== false : true;
    qs('btn-excluir-secao').style.display = secao ? '' : 'none';

    const icon = normalizarIconeSecao(secao?.icone) || iconeFallbackSecao(secao?.titulo || '');
    renderIconeSecaoOptions(icon);

    const selectIcon = qs('secao-icone');
    if (selectIcon) {
      selectIcon.value = icon;
    }

    atualizarPreviewIconeSecao();
    atualizarSecaoDrawerSummary();
  }

  function resetCampoForm(campo = null, modo = 'novo') {
    state.campoEditando = campo;
    setCampoDrawerTab('geral');

    const origemInicial = campo?.origem || (modo === 'sistema' ? 'sistema' : 'personalizado');

    qs('campo-id').value = campo?.id || '';
    qs('campo-modo').value = origemInicial === 'sistema' ? 'sistema' : 'novo';

    renderSecaoSelect(campo?.secao_id || '');
    renderCampoSistemaSelect(campo?.campo_sistema || '');
    renderCampoPersonalizadoSelect(campo?.campo_personalizado_id || '');

    qs('campo-secao').value = campo?.secao_id || '';
    qs('campo-origem').value = origemInicial;
    qs('campo-sistema').value = campo?.campo_sistema || '';
    qs('campo-personalizado').value = campo?.campo_personalizado_id || '';
    qs('campo-tipo-visual').value = campo?.tipo_visual || 'titulo';
    qs('campo-tipo-campo').value = getTipoCampoBaseSelect(campo?.tipo_campo || 'texto');
    applyCampoRelationConfig(campo?.tipo_campo || '');
    qs('campo-label').value = campo?.label || '';
    qs('campo-placeholder').value = campo?.placeholder || '';
    qs('campo-ajuda').value = campo?.ajuda || '';
    qs('campo-largura').value = campo?.largura || (origemInicial === 'sistema' ? '50' : '100');
    qs('campo-visibilidade').value = campo?.visibilidade || 'todos';
    qs('campo-ordem').value = campo ? Number(campo.ordem || 0) : proximaOrdemCampo();
    qs('campo-opcoes').value = opcoesToInput(campo?.opcoes || campo?.opcoes_json || '');
    qs('campo-obrigatorio').checked = campo ? !!campo.obrigatorio : false;
    qs('campo-somente-leitura').checked = campo ? !!campo.somente_leitura : false;

    const exibicaoCampo = getCampoExibicao(campo);
    if (qs('campo-usar-localizar')) {
      qs('campo-usar-localizar').checked = campo
        ? isFlagOn(exibicaoCampo.usar_no_localizar ?? exibicaoCampo.localizar ?? exibicaoCampo.filtro)
        : false;
    }
    if (qs('campo-mostrar-tabela')) {
      qs('campo-mostrar-tabela').checked = campo
        ? isFlagOn(exibicaoCampo.mostrar_na_tabela ?? exibicaoCampo.tabela ?? exibicaoCampo.coluna)
        : false;
    }

    qs('campo-ativo').checked = campo ? campo.ativo !== false : true;
    applyCampoIntegracoesConfig(campo);
    qs('btn-excluir-campo').style.display = campo ? '' : 'none';

    const avancado = qs('campo-avancado');
    if (avancado) avancado.open = false;

    aplicarModoCampo(origemInicial);

    const editando = !!campo?.id;
    const title = qs('modal-campo-title');
    const subtitle = qs('modal-campo-subtitle');
    const btnSalvar = qs('btn-salvar-campo');
    const titleIcon = document.querySelector('#modal-campo .modal-title-icon i');

    if (editando) {
      if (origemInicial === 'sistema') {
        if (title) title.textContent = 'Editar campo do sistema';
      } else if (origemInicial === 'visual') {
        if (title) title.textContent = 'Editar item visual';
      } else {
        if (title) title.textContent = 'Editar campo';
      }

      if (subtitle) subtitle.textContent = 'Altere as informações deste campo.';
      if (btnSalvar) btnSalvar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';
      if (titleIcon) titleIcon.className = 'fa-solid fa-pen-to-square';
    } else {
      if (titleIcon) titleIcon.className = 'fa-solid fa-plus';
    }

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
    requestAnimationFrame(() => syncAllValoraSelects(qs('modal-campo') || document));
  }

  function proximaOrdemSecao() {
    const secoes = getSecoes();
    if (!secoes.length) return 1;
    return Math.max(...secoes.map((s) => Number(s.ordem || 0))) + 1;
  }

  function proximaOrdemCampo() {
    const campos = getAllCampos();
    if (!campos.length) return 1;
    return Math.max(...campos.map((c) => Number(c.ordem || 0))) + 1;
  }

  function buildModeloPayload() {
    return {
      modulo: qs('modelo-modulo').value,
      nome: qs('modelo-nome-input').value.trim(),
      descricao: qs('modelo-descricao-input').value.trim() || null,
      ativo: qs('modelo-ativo').checked,
      padrao: qs('modelo-padrao').checked,
      usar_como_ficha_principal: qs('modelo-ficha-principal').checked,
    };
  }

  function buildSecaoPayload() {
    const titulo = qs('secao-titulo').value.trim();
    const iconeSelecionado = normalizarIconeSecao(qs('secao-icone')?.value);

    return {
      titulo,
      descricao: qs('secao-descricao').value.trim() || null,
      icone: iconeSelecionado || iconeFallbackSecao(titulo),
      ordem: Number(qs('secao-ordem').value || 0),
      ativo: qs('secao-ativo').checked,
    };
  }

  function buildCampoPayload() {
    const origem = qs('campo-origem').value || 'personalizado';
    const opcoes = parseOpcoes(qs('campo-opcoes').value);

    const payload = {
      secao_id: qs('campo-secao').value ? Number(qs('campo-secao').value) : null,
      origem,
      campo_sistema: null,
      campo_personalizado_id: null,
      tipo_visual: null,
      tipo_campo: getTipoCampoEfetivo(),
      label: qs('campo-label').value.trim(),
      placeholder: qs('campo-placeholder').value.trim() || null,
      ajuda: qs('campo-ajuda').value.trim() || null,
      opcoes: opcoes.length ? opcoes : null,
      obrigatorio: qs('campo-obrigatorio').checked,
      somente_leitura: qs('campo-somente-leitura').checked,
      ativo: qs('campo-ativo').checked,
      largura: qs('campo-largura').value || '100',
      ordem: Number(qs('campo-ordem').value || 0),
      visibilidade: qs('campo-visibilidade').value || 'todos',
      condicao: {
        ...getCampoCondicao(state.campoEditando),
        exibicao: {
          ...(getCampoCondicao(state.campoEditando).exibicao || {}),
          usar_no_localizar: !!qs('campo-usar-localizar')?.checked,
          mostrar_na_tabela: !!qs('campo-mostrar-tabela')?.checked,
        },
        integracoes: buildCampoIntegracoesPayload(),
      },
    };

    if (origem === 'sistema') {
      payload.campo_sistema = qs('campo-sistema').value || null;

      const opt = qs('campo-sistema')?.selectedOptions?.[0];
      const label = opt?.dataset?.label || opt?.textContent || '';
      const tipo = opt?.dataset?.tipo || payload.tipo_campo || 'texto';

      payload.label = payload.label || String(label).replace(/\s*\(.+\)\s*$/, '').trim();
      payload.tipo_campo = normalizarTipoCampoFrontend(tipo);
    }

    if (origem === 'visual') {
      payload.tipo_visual = qs('campo-tipo-visual').value || 'titulo';
      payload.tipo_campo = null;
      payload.obrigatorio = false;
      payload.somente_leitura = true;
    }

    return payload;
  }

  async function salvarModelo() {
    const payload = buildModeloPayload();

    if (!payload.nome) {
      toast('Informe o nome do formulário.', true);
      return;
    }

    const id = qs('modelo-id').value;
    const btn = qs('btn-salvar-modelo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      let salvo;

      if (id) {
        salvo = await apiJson(`${API_BASE}/modelos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        salvo = await apiJson(`${API_BASE}/modelos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      state.modulo = salvo.modulo || payload.modulo;

      marcarModuloAtivo();

      await carregarModelos();

      if (salvo?.id) {
        await carregarModeloCompleto(salvo.id);
      }

      closeModal('modal-modelo');
      toast('Formulário salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar formulário.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar formulário';
    }
  }

  async function salvarSecao() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário antes de criar seção.', true);
      return;
    }

    const payload = buildSecaoPayload();

    if (!payload.titulo) {
      toast('Informe o título da seção.', true);
      return;
    }

    const id = qs('secao-id').value;
    const btn = qs('btn-salvar-secao');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        await apiJson(`${API_BASE}/secoes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson(`${API_BASE}/modelos/${modeloId}/secoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(modeloId);

      closeModal('modal-secao');
      toast('Seção salva com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar seção.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar seção';
    }
  }

  async function salvarCampo() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário antes de criar campo.', true);
      return;
    }

    const payload = buildCampoPayload();

    if (!payload.secao_id) {
      toast('Escolha uma seção antes de salvar o campo.', true);
      return;
    }

    if (!payload.label) {
      toast('Informe o nome exibido do campo.', true);
      return;
    }

    if (payload.origem === 'sistema' && !payload.campo_sistema) {
      toast('Selecione o campo do sistema.', true);
      return;
    }

    const id = qs('campo-id').value;
    const btn = qs('btn-salvar-campo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        const salvarEdicao = async (confirmarExclusaoOpcoes = false) => {
          const query = confirmarExclusaoOpcoes ? '?excluir_valores_opcoes_removidas=true' : '';
          return apiJson(`${API_BASE}/campos/${id}${query}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        };

        try {
          await salvarEdicao(false);
        } catch (err) {
          const message = String(err?.message || '');
          if (!message.startsWith('OPCOES_REMOVIDAS|')) throw err;

          const [, cadastrosRaw, valoresRaw] = message.split('|');
          const cadastros = Number(cadastrosRaw || 0);
          const valores = Number(valoresRaw || 0);
          const texto = [
            `Existem ${cadastros} cadastro${cadastros === 1 ? '' : 's'} usando opção${valores === 1 ? '' : 'ões'} que não existe${valores === 1 ? '' : 'm'} mais neste campo.`,
            '',
            `Ao continuar, ${valores} valor${valores === 1 ? '' : 'es'} antigo${valores === 1 ? '' : 's'} ser${valores === 1 ? 'á' : 'ão'} apagado${valores === 1 ? '' : 's'} definitivamente.`,
            '',
            'Deseja remover esses valores e salvar a nova lista de opções?'
          ].join('\n');

          if (!confirm(texto)) return;
          await salvarEdicao(true);
        }
      } else {
        await apiJson(`${API_BASE}/modelos/${modeloId}/campos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(modeloId);

      closeModal('modal-campo');
      toast('Campo salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar campo.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = id ? '<i class="fa-solid fa-floppy-disk"></i> Salvar alterações' : '<i class="fa-solid fa-check"></i> Criar campo';
    }
  }

  async function criarPadrao() {
    const btn = qs('btn-criar-padrao');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Criando...';
    }

    try {
      const data = await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      await carregarModelos();

      const modeloId = data?.modelo?.id || state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

      if (modeloId) {
        await carregarModeloCompleto(modeloId);
      }

      toast(`Formulário padrão de ${moduloLabel()} pronto para uso.`);
      return data;
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao criar formulário padrão.', true);
      throw err;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Criar padrão';
      }
    }
  }

  async function excluirSecao(id) {
    if (!id) return;

    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) return;

    const ok = confirm('Excluir esta seção? Os campos serão movidos para "sem seção".');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/secoes/${id}?mover_campos_para_sem_secao=true`, {
        method: 'DELETE',
      });

      await carregarModeloCompleto(modeloId);

      toast('Seção excluída.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir seção.', true);
    }
  }

  async function excluirCampo(id) {
    if (!id) return;

    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;
    if (!modeloId) return;

    try {
      const uso = await apiJson(`${API_BASE}/campos/${id}/uso`);
      const label = String(uso?.label || 'este campo').trim();
      const total = Number(uso?.cadastros_com_dados || 0);
      const personalizado = String(uso?.origem || '') === 'personalizado';

      let mensagem = '';
      if (personalizado && total > 0) {
        mensagem = [
          `O campo "${label}" possui dados salvos em ${total} cadastro${total === 1 ? '' : 's'}.`,
          '',
          'Ao excluir, o campo e todos esses dados serão apagados definitivamente.',
          'Essa ação não pode ser desfeita.',
          '',
          'Tem certeza que deseja excluir?'
        ].join('\n');
      } else if (personalizado) {
        mensagem = [
          `Excluir o campo "${label}" definitivamente?`,
          '',
          'O campo será removido por completo do cadastro.'
        ].join('\n');
      } else {
        mensagem = [
          `Remover o campo "${label}" deste formulário?`,
          '',
          'Dados nativos do sistema não serão apagados.'
        ].join('\n');
      }

      if (!confirm(mensagem)) return;

      const query = personalizado ? '?excluir_dados=true' : '';
      const resultado = await apiJson(`${API_BASE}/campos/${id}${query}`, {
        method: 'DELETE',
      });

      await carregarModeloCompleto(modeloId);
      closeModal('modal-campo');

      if (personalizado && total > 0) {
        toast(`Campo excluído definitivamente. ${total} cadastro${total === 1 ? '' : 's'} tinha${total === 1 ? '' : 'm'} dados nesse campo.`);
      } else {
        toast(resultado?.message || 'Campo excluído.');
      }
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir campo.', true);
    }
  }

  function findSecao(id) {
    return getSecoes().find((s) => Number(s.id) === Number(id));
  }

  function findCampo(id) {
    return getAllCampos().find((c) => Number(c.id) === Number(id));
  }

  const MODULE_SIDEBAR_STORAGE = 'valora_formularios_sidebar_groups_v1';

  function normalizarBuscaSidebar(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function salvarEstadoGruposSidebar() {
    try {
      const data = {};
      document.querySelectorAll('.module-group[data-module-group]').forEach((group) => {
        data[group.dataset.moduleGroup] = group.classList.contains('is-collapsed');
      });
      localStorage.setItem(MODULE_SIDEBAR_STORAGE, JSON.stringify(data));
    } catch (_) {
      // Preferência visual: falhar silenciosamente não afeta o formulário.
    }
  }

  function definirGrupoSidebarRecolhido(group, collapsed, persist = true) {
    if (!group) return;
    group.classList.toggle('is-collapsed', !!collapsed);

    const toggle = group.querySelector('[data-module-group-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    if (persist) salvarEstadoGruposSidebar();
  }

  function restaurarEstadoGruposSidebar() {
    try {
      const saved = JSON.parse(localStorage.getItem(MODULE_SIDEBAR_STORAGE) || '{}');
      document.querySelectorAll('.module-group[data-module-group]').forEach((group) => {
        definirGrupoSidebarRecolhido(group, saved[group.dataset.moduleGroup] === true, false);
      });
    } catch (_) {
      document.querySelectorAll('.module-group[data-module-group]').forEach((group) => {
        definirGrupoSidebarRecolhido(group, false, false);
      });
    }
  }

  function atualizarContagemModuloSidebar(total = null) {
    const count = Number.isFinite(Number(total)) ? Number(total) : getResumoFormulario().campos;
    const badge = document.querySelector(`[data-module-count="${state.modulo}"]`);
    if (!badge) return;

    badge.textContent = `${count} campo${count === 1 ? '' : 's'}`;
    badge.hidden = false;
  }

  function filtrarModulosSidebar(value = '') {
    const sidebar = qs('modulos-grid');
    const empty = qs('module-search-empty');
    const query = normalizarBuscaSidebar(value);
    let visibleCount = 0;

    sidebar?.classList.toggle('is-searching', !!query);

    document.querySelectorAll('.module-group[data-module-group]').forEach((group) => {
      let groupVisible = 0;

      group.querySelectorAll('.module-card[data-modulo]').forEach((btn) => {
        const label = normalizarBuscaSidebar(btn.querySelector('strong')?.textContent || btn.dataset.modulo);
        const visible = !query || label.includes(query);
        btn.hidden = !visible;
        if (visible) {
          groupVisible += 1;
          visibleCount += 1;
        }
      });

      group.hidden = groupVisible === 0;
    });

    if (empty) empty.hidden = visibleCount > 0;
  }

  function initModuleSidebar() {
    const sidebar = qs('modulos-grid');
    const search = qs('module-sidebar-search');
    if (!sidebar || sidebar.dataset.interactiveReady === 'true') return;
    sidebar.dataset.interactiveReady = 'true';

    restaurarEstadoGruposSidebar();

    sidebar.querySelectorAll('[data-module-group-toggle]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.module-group');
        if (!group) return;
        definirGrupoSidebarRecolhido(group, !group.classList.contains('is-collapsed'));
      });
    });

    search?.addEventListener('input', () => filtrarModulosSidebar(search.value));
    search?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (search.value) {
        search.value = '';
        filtrarModulosSidebar('');
      } else {
        search.blur();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (document.querySelector('.modal-overlay:not([hidden])')) return;
      event.preventDefault();
      search?.focus({ preventScroll: true });
      search?.select();
    });
  }

  function marcarModuloAtivo() {
    let activeButton = null;

    document.querySelectorAll('.module-card').forEach((btn) => {
      const active = btn.dataset.modulo === state.modulo;
      btn.classList.toggle('is-active', active);
      if (active) {
        btn.setAttribute('aria-current', 'page');
        activeButton = btn;
      } else {
        btn.removeAttribute('aria-current');
      }
    });

    const activeGroup = activeButton?.closest('.module-group');
    if (activeGroup?.classList.contains('is-collapsed')) {
      definirGrupoSidebarRecolhido(activeGroup, false, false);
    }

    const titulo = qs('modulo-titulo');
    const breadcrumbModulo = qs('workspace-breadcrumb-module');
    if (titulo) titulo.textContent = moduloLabel();
    if (breadcrumbModulo) breadcrumbModulo.textContent = moduloLabel();
  }

  async function trocarModulo(modulo) {
    if (!MODULOS[modulo]) return;

    state.modulo = modulo;
    state.modeloAtual = null;
    state.modelos = [];
    state.camposSistema = [];
    state.camposPersonalizados = [];
    state.etapaAtiva = 'cadastro';
    state.secaoSelecionadaId = null;
    state.campoSelecionadoId = null;
    state.campoBusca = '';
    state.campoTipoFiltro = '';

    const params = new URLSearchParams(window.location.search);
    params.set('modulo', modulo);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);

    marcarModuloAtivo();

    setLoadingSelect(qs('select-modelo'), 'Carregando...');

    await Promise.all([
      carregarCamposSistema(),
      carregarCamposPersonalizados(),
      carregarLayoutLocalizarServidor(modulo),
    ]);

    // Ao trocar de módulo, mantém o inspetor fechado.
    // Ele só deve abrir quando o usuário clicar explicitamente no lápis de um campo.
    closeModal('modal-campo');
    await carregarModelos();
  }

  function abrirInspectorCampoSelecionado() {
    if (!isDockedFieldInspector()) return;
    const campo = findCampo(state.campoSelecionadoId);
    if (!campo) return;
    abrirCampoParaEditar(campo);
  }

  function podeAbrirCampo() {
    const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

    if (!modeloId) {
      toast('Crie ou selecione um formulário primeiro.', true);
      return false;
    }

    if (!getSecoes().length) {
      toast('Crie uma seção antes de adicionar campos.', true);
      return false;
    }

    return true;
  }

  async function abrirNovaSecao() {
    try {
      await garantirModeloAtual();

      resetSecaoForm(null);
      openModal('modal-secao');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o formulário para criar seção.', true);
    }
  }

  async function abrirCampoSistema(campo = null) {
    try {
      if (!campo) {
        await garantirSecaoPadrao();
      }

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
        carregarLayoutLocalizarServidor(state.modulo),
      ]);

      resetCampoForm(campo, 'sistema');
      openModal('modal-campo');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o campo do sistema.', true);
    }
  }

  async function abrirNovoCampo(campo = null) {
    try {
      if (!campo) {
        await garantirSecaoPadrao();
      }

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);

      resetCampoForm(campo, 'novo');
      openModal('modal-campo');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao preparar o novo campo.', true);
    }
  }

  function abrirCampoParaEditar(campo) {
    if (!campo) return;

    if (campo.origem === 'sistema') {
      abrirCampoSistema(campo);
      return;
    }

    abrirNovoCampo(campo);
  }

  function bindEventos() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    document.querySelectorAll('[data-toggle-modal-size]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        toggleModalSize(btn.dataset.toggleModalSize);
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) {
          closeModal(modal.id);
        }
      });
    });

    // Proteção específica do editor de campos: ao interagir com selects,
    // mantenha o scroll somente no .modal-body. O wrapper externo deve ficar
    // sempre em scrollTop 0 para não desaparecer visualmente.
    const campoModal = qs('modal-campo');
    ['focusin', 'pointerdown', 'change'].forEach((eventName) => {
      campoModal?.addEventListener(eventName, (event) => {
        if (!event.target?.closest?.('select')) return;
        const content = campoModal.querySelector(':scope > .modal-content.modal-field-editor');
        if (content) {
          content.scrollTop = 0;
          content.scrollLeft = 0;
        }
        scheduleCampoModalIntegrity();
      }, true);
    });

    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.addEventListener('click', () => trocarModulo(btn.dataset.modulo));
    });

    qs('select-modelo')?.addEventListener('change', async (e) => {
      await carregarModeloCompleto(e.target.value);
    });

    qs('btn-atualizar')?.addEventListener('click', () => trocarModulo(state.modulo));
    qs('btn-ajuda-formularios')?.addEventListener('click', () => {
      toast('Escolha o módulo, selecione o formulário e organize as seções com os campos necessários.');
    });

    qs('btn-formatar-localizar')?.addEventListener('click', formatarLocalizarPadrao);

    const localizarPreviewCard = qs('localizar-preview-card');
    localizarPreviewCard?.addEventListener('click', (e) => {
      const pickerBtn = e.target.closest('[data-open-preview-picker]');
      if (pickerBtn) {
        abrirPreviewPicker(pickerBtn.dataset.openPreviewPicker);
        return;
      }

      const toggleBtn = e.target.closest('[data-localizar-preview-toggle="true"]');
      if (toggleBtn) {
        toggleItemPreview(toggleBtn.dataset.area, toggleBtn.dataset.origin, toggleBtn.dataset.key);
        return;
      }

      const removeBtn = e.target.closest('[data-localizar-preview-remove="true"]');
      if (removeBtn) {
        removerItemPersonalizadoPreview(
          removeBtn.dataset.area,
          removeBtn.dataset.origin,
          removeBtn.dataset.key
        );
      }
    });
    if (localizarPreviewCard) bindPreviewDrag(localizarPreviewCard);

    qs('preview-picker-search')?.addEventListener('input', () => renderPreviewPicker(state.previewPickerArea || 'columns'));
    qs('modal-preview-picker')?.addEventListener('click', async (e) => {
      const addBtn = e.target.closest('[data-preview-picker-add="true"]');
      if (addBtn) await adicionarItemAoPreview(addBtn);
    });

    qs('btn-criar-padrao')?.addEventListener('click', criarPadrao);

    qs('btn-novo-modelo')?.addEventListener('click', () => {
      resetModeloForm(false);
      openModal('modal-modelo');
    });

    qs('btn-editar-modelo')?.addEventListener('click', async () => {
      const modeloId = state.modeloAtual?.modelo?.id || qs('select-modelo')?.value;

      if (!modeloId) {
        toast('Selecione um formulário para editar.', true);
        return;
      }

      if (!state.modeloAtual?.modelo?.id) {
        await carregarModeloCompleto(modeloId);
      }

      resetModeloForm(true);
      openModal('modal-modelo');
    });

    qs('modelo-modulo')?.addEventListener('change', syncModeloFichaPrincipalCopy);
    qs('btn-salvar-modelo')?.addEventListener('click', salvarModelo);
    qs('btn-nova-secao')?.addEventListener('click', abrirNovaSecao);
    qs('btn-salvar-secao')?.addEventListener('click', salvarSecao);

    qs('secao-titulo')?.addEventListener('input', () => {
      const select = qs('secao-icone');

      if (select && (!select.value || select.value === 'fa-layer-group')) {
        const icon = iconeFallbackSecao(qs('secao-titulo').value);
        select.value = icon;
      }

      atualizarPreviewIconeSecao();
      atualizarSecaoDrawerSummary();
    });

    qs('secao-icone')?.addEventListener('change', () => {
      atualizarPreviewIconeSecao();
      atualizarSecaoDrawerSummary();
    });
    qs('secao-ativo')?.addEventListener('change', atualizarSecaoDrawerSummary);

    qs('modal-secao')?.querySelector('.secao-drawer-tabs')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-secao-drawer-tab]');
      if (!button) return;
      setSecaoDrawerTab(button.dataset.secaoDrawerTab);
    });

    qs('btn-abrir-icones-secao')?.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePickerIconesSecao();
    });

    qs('secao-icones-picker')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-secao-icon]');
      if (!btn) return;

      selecionarIconeSecao(btn.dataset.secaoIcon);
    });

    document.addEventListener('click', (e) => {
      const selector = qs('secao-icone-selector');
      if (!selector) return;
      if (selector.contains(e.target)) return;
      fecharPickerIconesSecao();
    });

    qs('btn-excluir-secao')?.addEventListener('click', () => {
      const id = qs('secao-id').value;
      closeModal('modal-secao');
      excluirSecao(id);
    });

    qs('btn-campo-sistema')?.addEventListener('click', () => abrirCampoSistema(null));
    qs('btn-novo-campo')?.addEventListener('click', () => abrirNovoCampo(null));

    qs('btn-add-existing-field')?.addEventListener('click', () => {
      const secaoId = state.secaoSelecionadaId && state.secaoSelecionadaId !== 'sem-secao' ? String(state.secaoSelecionadaId) : '';
      closeModal('modal-adicionar-campo');
      abrirCampoSistema(null).then(() => {
        if (secaoId && qs('campo-secao')) {
          qs('campo-secao').value = secaoId;
          syncValoraSelect(qs('campo-secao'));
        }
      });
    });

    qs('btn-add-custom-field')?.addEventListener('click', () => {
      const secaoId = state.secaoSelecionadaId && state.secaoSelecionadaId !== 'sem-secao' ? String(state.secaoSelecionadaId) : '';
      closeModal('modal-adicionar-campo');
      abrirNovoCampo(null).then(() => {
        if (secaoId && qs('campo-secao')) {
          qs('campo-secao').value = secaoId;
          syncValoraSelect(qs('campo-secao'));
        }
      });
    });

    qs('btn-salvar-campo')?.addEventListener('click', salvarCampo);
    qs('btn-excluir-campo')?.addEventListener('click', () => excluirCampo(qs('campo-id').value));

    qs('campo-origem')?.addEventListener('change', () => {
      toggleCampoOrigem();
      atualizarCampoDrawerSummary();
    });
    qs('campo-sistema')?.addEventListener('change', () => {
      preencherLabelPorSistema();
      atualizarCampoDrawerSummary();
    });
    qs('campo-personalizado')?.addEventListener('change', preencherLabelPorPersonalizado);
    qs('campo-label')?.addEventListener('input', () => {
      syncCampoAutomationState();
      atualizarCampoPreview();
    });
    qs('campo-secao')?.addEventListener('change', () => {
      syncCampoAutomationState();
      atualizarCampoDrawerSummary();
    });
    qs('campo-tipo-campo')?.addEventListener('change', () => {
      try {
        const tipoSelecionado = qs('campo-tipo-campo')?.value || 'texto';
        const optionsRow = qs('campo-opcoes')?.closest('.campo-options-control, .form-group');

        // Select e multiselect só alternam a área de opções.
        // Eles não podem fechar, ocultar ou reconstruir o modal.
        if (optionsRow && (tipoSelecionado === 'select' || tipoSelecionado === 'multiselect')) {
          optionsRow.hidden = false;
          optionsRow.classList.remove('is-hidden');
        }

        syncCampoOpcoesVisibility();
        syncCampoAutomationState();
        atualizarCampoPreview();
      } catch (error) {
        console.error('[Formulários] erro ao trocar tipo do campo:', error);
      } finally {
        scheduleCampoModalIntegrity();
      }
    });
    qs('campo-relacao-entidade')?.addEventListener('change', () => {
      try {
        syncCampoOpcoesVisibility();
        syncCampoAutomationState();
        atualizarCampoPreview();
      } finally {
        scheduleCampoModalIntegrity();
      }
    });
    qs('campo-relacao-multiplo')?.addEventListener('change', () => {
      try {
        syncCampoOpcoesVisibility();
        syncCampoAutomationState();
        atualizarCampoPreview();
      } finally {
        scheduleCampoModalIntegrity();
      }
    });
    [
      'campo-cep-buscar',
      'campo-cep-preencher-logradouro',
      'campo-cep-preencher-bairro',
      'campo-cep-preencher-cidade',
      'campo-cep-preencher-estado',
      'campo-google-maps-ativo'
    ].forEach((id) => qs(id)?.addEventListener('change', syncCampoAutomationState));
    qs('campo-location-purpose')?.addEventListener('change', (event) => {
      const preset = String(event.target.value || '').trim();

      if (!preset) {
        clearCampoLocationAutomation();
        syncCampoAutomationState();
        atualizarCampoPreview();
        scheduleCampoModalIntegrity();
        return;
      }

      applyLocationPreset(preset);
    });
    qs('campo-cep-destination-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-cep-destination-edit]');
      if (!button) return;

      event.preventDefault();
      const row = button.closest('[data-cep-destination-row]');
      const editor = row?.querySelector('.cep-destination-editor');
      const select = editor?.querySelector('[data-cep-destination-select]');
      if (!editor || !select) return;

      document.querySelectorAll('#campo-cep-destination-list .cep-destination-editor').forEach((other) => {
        if (other !== editor) other.hidden = true;
      });

      editor.hidden = !editor.hidden;
      if (!editor.hidden) {
        requestAnimationFrame(() => select.focus());
      }
    });
    qs('campo-cep-destination-list')?.addEventListener('change', (event) => {
      const select = event.target.closest('[data-cep-destination-select]');
      if (!select) return;

      const value = String(select.value || '');
      if (value) {
        const duplicate = Array.from(document.querySelectorAll('#campo-cep-destination-list [data-cep-destination-select]'))
          .find((other) => other !== select && String(other.value || '') === value);
        if (duplicate) {
          select.value = '';
          toast('Este campo já está sendo usado por outro dado do CEP. Escolha outro destino.', true);
        }
      }
      renderCepDestinationPreview();
      scheduleCampoModalIntegrity();
    });
    qs('campo-ativo')?.addEventListener('change', atualizarCampoDrawerSummary);

    qs('modal-campo')?.querySelector('.campo-drawer-tabs')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-campo-drawer-tab]');
      if (!button) return;
      setCampoDrawerTab(button.dataset.campoDrawerTab);
    });

    qs('campo-tipo-visual')?.addEventListener('change', () => {
      atualizarCampoPreview();
      atualizarCampoDrawerSummary();
    });

    document.querySelector('[data-form-steps]')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-form-step]');
      if (!btn) return;
      state.etapaAtiva = btn.dataset.formStep || 'cadastro';
      atualizarEtapasUI();
    });

    qs('btn-toggle-model-select')?.addEventListener('click', () => {
      const shell = qs('model-switcher-shell');
      if (!shell) return;
      shell.classList.toggle('is-open');
      shell.hidden = !shell.classList.contains('is-open');
      if (!shell.hidden) qs('select-modelo')?.focus();
    });

    qs('secoes-container')?.addEventListener('input', (e) => {
      const input = e.target.closest('[data-field-search]');
      if (!input) return;
      state.campoBusca = input.value;
      aplicarFiltroCamposWorkspace();
    });

    qs('secoes-container')?.addEventListener('change', (e) => {
      const typeFilter = e.target.closest('[data-field-type-filter]');
      if (typeFilter) {
        state.campoTipoFiltro = typeFilter.value;
        aplicarFiltroCamposWorkspace();
        return;
      }

      const input = e.target.closest('[data-quick-field]');
      if (!input) return;
      atualizarCampoRapido(input.dataset.id, input.dataset.quickField, input.checked, input);
    });

    qs('secoes-container')?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('.form-field-row[data-action="selecionar-campo"]');
      if (!row || e.target.closest('button')) return;
      e.preventDefault();
      row.click();
    });

    qs('secoes-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'selecionar-secao') {
        state.secaoSelecionadaId = id;
        state.campoSelecionadoId = null;
        state.campoBusca = '';
        state.campoTipoFiltro = '';
        renderSecoes();
        return;
      }

      if (action === 'selecionar-campo') {
        // Selecionar a linha não abre o editor.
        // O painel "Editar campo" abre somente pelo botão de lápis.
        state.campoSelecionadoId = id;
        renderSecoes();
        return;
      }

      if (action === 'nova-secao') {
        abrirNovaSecao();
        return;
      }

      if (action === 'novo-campo-secao') {
        openModal('modal-adicionar-campo');
        return;
      }

      if (action === 'editar-secao') {
        const secao = findSecao(id);

        if (secao) {
          resetSecaoForm(secao);
          openModal('modal-secao');
        }
      }

      if (action === 'toggle-secao') {
        const sid = String(id || 'sem-secao');
        if (state.secoesAbertas.has(sid)) {
          state.secoesAbertas.delete(sid);
        } else {
          state.secoesAbertas.add(sid);
        }
        renderSecoes();
      }

      if (action === 'excluir-secao') {
        excluirSecao(id);
      }

      if (action === 'editar-campo') {
        const campo = findCampo(id);

        if (campo) {
          abrirCampoParaEditar(campo);
        }
      }

      if (action === 'excluir-campo') {
        excluirCampo(id);
      }
    });
  }


  // =========================================================
  // Valora Select — substitui a UI nativa do Chrome dentro
  // dos modais de Formulários sem alterar o <select> real.
  // O select original continua sendo a fonte de verdade para
  // toda a lógica de salvamento já existente.
  // =========================================================
  const valoraSelectState = {
    currentSelect: null,
    popover: null,
    observer: null,
  };

  function isValoraSelectEligible(select) {
    if (!select || select.tagName !== 'SELECT') return false;
    if (!select.closest('.modal-overlay')) return false;
    if (select.classList.contains('secao-icone-native')) return false;
    if (select.getAttribute('aria-hidden') === 'true') return false;
    if (select.hidden) return false;
    return true;
  }

  function normalizeValoraSelectText(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function valoraSelectOptionData(select, option) {
    const text = String(option?.textContent || '').trim();
    const value = String(option?.value || '');
    const label = String(option?.dataset?.label || '').trim();
    const id = select?.id || '';
    const technical = (id === 'campo-sistema' || id === 'campo-personalizado') && value && label
      ? value
      : '';

    return {
      value,
      label: label || text || 'Selecione',
      text: text || label || 'Selecione',
      technical,
      disabled: !!option?.disabled,
    };
  }

  function getValoraSelectLabel(select) {
    const option = select?.selectedOptions?.[0];
    if (!option) return 'Selecione';
    const data = valoraSelectOptionData(select, option);
    return data.label || data.text || 'Selecione';
  }

  function closeValoraSelectPopover() {
    const popover = valoraSelectState.popover;
    if (popover) popover.remove();
    valoraSelectState.popover = null;

    if (valoraSelectState.currentSelect?._valoraSelect?.shell) {
      valoraSelectState.currentSelect._valoraSelect.shell.classList.remove('is-open');
      valoraSelectState.currentSelect._valoraSelect.trigger.setAttribute('aria-expanded', 'false');
    }
    valoraSelectState.currentSelect = null;
  }

  function syncValoraSelect(select) {
    const api = select?._valoraSelect;
    if (!api) return;
    api.label.textContent = getValoraSelectLabel(select);
    api.trigger.disabled = !!select.disabled;
    api.trigger.classList.toggle('is-placeholder', !String(select.value || '').trim());
    api.trigger.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
  }

  function syncAllValoraSelects(root = document) {
    root.querySelectorAll?.('select.valora-select-native').forEach(syncValoraSelect);
  }

  function positionValoraSelectPopover(select) {
    const popover = valoraSelectState.popover;
    const trigger = select?._valoraSelect?.trigger;
    if (!popover || !trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportGap = 12;
    const desiredWidth = Math.max(rect.width, 260);
    const width = Math.min(desiredWidth, window.innerWidth - viewportGap * 2);
    let left = Math.min(rect.left, window.innerWidth - width - viewportGap);
    left = Math.max(viewportGap, left);

    popover.style.width = `${width}px`;
    popover.style.left = `${left}px`;

    // Mede depois de definir largura para decidir se abre em cima ou embaixo.
    const estimatedHeight = Math.min(popover.scrollHeight || 340, 390);
    const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
    const spaceAbove = rect.top - viewportGap;

    if (spaceBelow >= Math.min(estimatedHeight, 240) || spaceBelow >= spaceAbove) {
      popover.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 80)}px`;
      popover.style.bottom = 'auto';
      popover.classList.remove('opens-up');
    } else {
      popover.style.top = 'auto';
      popover.style.bottom = `${Math.max(viewportGap, window.innerHeight - rect.top + 6)}px`;
      popover.classList.add('opens-up');
    }
  }

  function renderValoraSelectOptions(select, listEl, query = '') {
    const normalizedQuery = normalizeValoraSelectText(query || '');
    const options = Array.from(select.options || []);
    listEl.innerHTML = '';

    const visible = options.filter((option) => {
      const data = valoraSelectOptionData(select, option);
      if (!normalizedQuery) return true;
      return normalizeValoraSelectText(`${data.text} ${data.label} ${data.value}`).includes(normalizedQuery);
    });

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'valora-select-empty';
      empty.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><strong>Nenhuma opção encontrada</strong><span>Tente pesquisar por outro termo.</span>';
      listEl.appendChild(empty);
      return;
    }

    visible.forEach((option) => {
      const data = valoraSelectOptionData(select, option);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'valora-select-option';
      button.disabled = data.disabled;
      button.dataset.value = data.value;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      if (option.selected) button.classList.add('is-selected');

      const copy = document.createElement('span');
      copy.className = 'valora-select-option-copy';

      const primary = document.createElement('span');
      primary.className = 'valora-select-option-title';
      primary.textContent = data.label || data.text;
      copy.appendChild(primary);

      if (data.technical) {
        const meta = document.createElement('small');
        meta.textContent = data.technical;
        copy.appendChild(meta);
      }

      button.appendChild(copy);

      if (option.selected) {
        const check = document.createElement('i');
        check.className = 'fa-solid fa-check valora-select-option-check';
        check.setAttribute('aria-hidden', 'true');
        button.appendChild(check);
      }

      button.addEventListener('click', () => {
        if (select.disabled || option.disabled) return;
        select.value = data.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncValoraSelect(select);
        closeValoraSelectPopover();
        select._valoraSelect?.trigger?.focus({ preventScroll: true });
      });

      listEl.appendChild(button);
    });
  }

  function openValoraSelectPopover(select) {
    if (!select || select.disabled) return;
    if (valoraSelectState.currentSelect === select) {
      closeValoraSelectPopover();
      return;
    }

    closeValoraSelectPopover();
    syncValoraSelect(select);

    const optionCount = Array.from(select.options || []).filter((opt) => !opt.disabled).length;
    const searchable = select.id === 'campo-sistema' || select.id === 'campo-personalizado' || optionCount > 9;

    const popover = document.createElement('div');
    popover.className = 'valora-select-popover';
    popover.setAttribute('role', 'listbox');

    if (searchable) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'valora-select-search';
      searchWrap.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';

      const input = document.createElement('input');
      input.type = 'search';
      input.autocomplete = 'off';
      input.placeholder = select.id === 'campo-sistema' ? 'Buscar campo do sistema...' : 'Buscar opção...';
      searchWrap.appendChild(input);
      popover.appendChild(searchWrap);
    }

    const list = document.createElement('div');
    list.className = 'valora-select-options';
    popover.appendChild(list);
    document.body.appendChild(popover);

    valoraSelectState.currentSelect = select;
    valoraSelectState.popover = popover;
    select._valoraSelect.shell.classList.add('is-open');
    select._valoraSelect.trigger.setAttribute('aria-expanded', 'true');

    renderValoraSelectOptions(select, list);
    positionValoraSelectPopover(select);

    const input = popover.querySelector('.valora-select-search input');
    if (input) {
      input.addEventListener('input', () => renderValoraSelectOptions(select, list, input.value));
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
  }

  function enhanceValoraSelect(select) {
    if (!isValoraSelectEligible(select) || select._valoraSelect) return;

    const shell = document.createElement('div');
    shell.className = 'valora-select-shell';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'valora-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'valora-select-trigger-label';

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down valora-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    trigger.append(label, chevron);

    select.parentNode.insertBefore(shell, select);
    shell.appendChild(select);
    shell.appendChild(trigger);
    select.classList.add('valora-select-native');

    select._valoraSelect = { shell, trigger, label };

    trigger.addEventListener('click', () => openValoraSelectPopover(select));
    select.addEventListener('change', () => syncValoraSelect(select));
    select.addEventListener('focus', () => {
      trigger.focus({ preventScroll: true });
      openValoraSelectPopover(select);
    });

    const observer = new MutationObserver(() => {
      syncValoraSelect(select);
      if (valoraSelectState.currentSelect === select && valoraSelectState.popover) {
        const list = valoraSelectState.popover.querySelector('.valora-select-options');
        const search = valoraSelectState.popover.querySelector('.valora-select-search input');
        if (list) renderValoraSelectOptions(select, list, search?.value || '');
      }
    });
    observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    select._valoraSelect.observer = observer;

    syncValoraSelect(select);
  }

  function enhanceValoraSelects(root = document) {
    root.querySelectorAll?.('.modal-overlay select').forEach(enhanceValoraSelect);
  }

  function initValoraSelectSystem() {
    enhanceValoraSelects(document);

    if (!valoraSelectState.observer) {
      valoraSelectState.observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return;
            if (node.matches?.('select')) enhanceValoraSelect(node);
            enhanceValoraSelects(node);
          });
        });
      });
      valoraSelectState.observer.observe(document.body, { childList: true, subtree: true });
    }

    document.addEventListener('pointerdown', (event) => {
      const popover = valoraSelectState.popover;
      const trigger = valoraSelectState.currentSelect?._valoraSelect?.trigger;
      if (!popover) return;
      if (popover.contains(event.target) || trigger?.contains(event.target)) return;
      closeValoraSelectPopover();
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && valoraSelectState.popover) {
        event.stopPropagation();
        closeValoraSelectPopover();
      }
    });

    // Alguns handlers antigos alteram outro select por JavaScript após um change.
    // Sincroniza os triggers no fim do mesmo ciclo sem mexer na lógica existente.
    document.addEventListener('change', (event) => {
      if (!event.target?.closest?.('.modal-overlay')) return;
      queueMicrotask(() => syncAllValoraSelects(event.target.closest('.modal-overlay') || document));
    });

    window.addEventListener('resize', () => {
      if (valoraSelectState.currentSelect) positionValoraSelectPopover(valoraSelectState.currentSelect);
    });

    document.addEventListener('scroll', (event) => {
      if (!valoraSelectState.popover) return;
      if (valoraSelectState.popover.contains(event.target)) return;
      closeValoraSelectPopover();
    }, true);
  }

  async function init() {
    console.log('[Formulários] JS carregou corretamente');

    bindEventos();
    initModuleSidebar();
    initValoraSelectSystem();
    renderIconeSecaoOptions('fa-layer-group');
    atualizarTriggerIconeSecao();
    fecharPickerIconesSecao();

    try {
      marcarModuloAtivo();

      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);

      await carregarModelos();

      // A página sempre inicia com o inspetor de campo fechado.
      // O usuário abre o painel apenas clicando no lápis de um campo.
      const campoModal = qs('modal-campo');
      if (campoModal) {
        campoModal.classList.remove('show');
        campoModal.hidden = true;
        campoModal.style.display = 'none';
      }
      setDockedFieldInspectorState(false);
    } catch (err) {
      console.error('[Formulários] erro no init:', err);
      toast(err.message || 'Erro ao carregar formulários.', true, 5000);
      renderModeloAtual();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();