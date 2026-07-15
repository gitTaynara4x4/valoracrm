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

    el.textContent = message || '';
    el.classList.toggle('is-error', !!error);
    el.classList.add('show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), ms);
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

  function openModal(id) {
    const modal = document.getElementById(id);

    if (window.ValoraModal) {
      window.ValoraModal.open(id);
      if (modal) atualizarContadoresCaracteres(modal);
      return;
    }

    if (!modal) return;

    modal.hidden = false;
    modal.style.display = 'flex';
    atualizarContadoresCaracteres(modal);

    requestAnimationFrame(() => modal.classList.add('show'));
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

  function setLoadingSelect(select, text = 'Carregando...') {
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(text)}</option>`;
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
      toast(
        area === 'columns'
          ? 'Campo removido somente da tabela. O campo e os dados cadastrados continuam intactos.'
          : 'Campo removido somente do Localizar. O campo e os dados cadastrados continuam intactos.'
      );
    } else {
      toast(area === 'columns' ? 'Campo adicionado novamente à tabela.' : 'Campo adicionado novamente ao Localizar.');
    }
  }

  function formatarLocalizarPadrao() {
    setLayoutLocalizar(normalizarLayoutLocalizar({}));
    renderPreviewLocalizar();
    toast('Prévia formatada: visibilidade e posições voltaram ao padrão do módulo.');
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

  function renderPreviewField(field, extraClass = '') {
    const label = field?.label || 'Campo';
    const key = field?.key || slugLocalizar(label);
    const placeholder = field?.placeholder || (field?.kind === 'select' ? 'Todos' : `Filtrar por ${label}`);
    const icon = field?.kind === 'select' ? 'fa-chevron-down' : 'fa-magnifying-glass';
    const origin = field?.origin || 'nativo';
    const originLabel = labelOrigemPreview(origin);
    const fixed = !!field?.fixed;
    const visible = isItemPreviewVisivel('filters', origin, key, fixed);
    const hiddenClass = visible ? '' : 'is-hidden-preview';
    const statusLabel = visible ? originLabel : (origin === 'nativo' ? 'Oculto' : 'Removido');

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
          <span class="localizar-preview-item-label">${escapeHtml(label)}</span>
          <em class="localizar-preview-origin">${escapeHtml(statusLabel)}</em>
          ${renderActionPreview({ area: 'filters', origin, key, visible, fixed })}
        </div>
        <div class="localizar-preview-input">
          <i class="fa-solid ${escapeHtml(icon)}"></i>
          <span>${escapeHtml(placeholder)}</span>
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
    const hiddenClass = visible ? '' : 'is-hidden-preview';
    const statusLabel = fixed ? 'Fixo' : (visible ? originLabel : (origin === 'nativo' ? 'Oculto' : 'Removido'));

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
    if (!card || !filtersWrap || !tableWrap) return;

    const modelo = state.modeloAtual?.modelo || null;
    const nativeFilters = PREVIEW_LOCALIZAR_NATIVO[state.modulo] || PREVIEW_LOCALIZAR_NATIVO.clientes;
    const nativeColumns = PREVIEW_TABELA_NATIVA[state.modulo] || PREVIEW_TABELA_NATIVA.clientes;

    if (!modelo) {
      filtersWrap.innerHTML = `
        <div class="localizar-preview-empty">
          Escolha um formulário para ver a prévia do localizar.
        </div>
      `;
      tableWrap.innerHTML = '<div class="localizar-preview-empty">A tabela aparece aqui depois que o formulário carregar.</div>';
      if (summary) summary.textContent = 'Sem formulário selecionado';
      return;
    }

    const camposLocalizar = getCamposPreview(campoDeveAparecerNoLocalizarPreview);
    const camposTabela = getCamposPreview(campoMarcadoTabela);
    const filtros = itensPreviewFiltros(nativeFilters, camposLocalizar);
    const colunas = itensPreviewTabela(nativeColumns, camposTabela);

    filtersWrap.innerHTML = filtros.map((field) => renderPreviewField(
      field,
      field.origin === 'nativo' ? '' : 'is-custom'
    )).join('') + (camposLocalizar.length ? '' : `
      <div class="localizar-preview-note">
        Marque <strong>Mostrar na tabela</strong> ou <strong>Usar no localizar</strong> para o campo aparecer aqui.
      </div>
    `);

    tableWrap.innerHTML = `
      <div class="localizar-preview-table-row">
        ${colunas.map((col) => renderPreviewColumn(col, col.origin || 'nativo')).join('')}
      </div>
      ${camposTabela.length ? '' : `
        <div class="localizar-preview-note tabela-note">
          Marque <strong>Mostrar na tabela</strong> para adicionar colunas extras. Depois, arraste para escolher a posição.
        </div>
      `}
    `;

    if (summary) {
      const layout = getLayoutLocalizar();
      const camposUnicos = new Set([
        ...camposLocalizar.map((campo) => `${origemCampoPreview(campo)}:${chaveCampoPreview(campo)}`),
        ...camposTabela.map((campo) => `${origemCampoPreview(campo)}:${chaveCampoPreview(campo)}`),
      ]);
      const adicionados = camposUnicos.size;
      const chavesNativasFiltros = new Set(nativeFilters.map((field) => itemLayoutKey('nativo', field.key)));
      const chavesNativasColunas = new Set(nativeColumns.map((col) => itemLayoutKey('nativo', typeof col === 'string' ? slugLocalizar(col) : col.key)));
      const ocultosNativos = [
        ...layout.hiddenFilters.filter((key) => chavesNativasFiltros.has(key)),
        ...layout.hiddenColumns.filter((key) => chavesNativasColunas.has(key)),
      ].length;
      const removidosAdicionados = [
        ...layout.hiddenFilters.filter((key) => !key.startsWith('nativo:')),
        ...layout.hiddenColumns.filter((key) => !key.startsWith('nativo:')),
      ].length;

      const partes = [`${adicionados} ${adicionados === 1 ? 'campo adicionado' : 'campos adicionados'}`];
      if (ocultosNativos) partes.push(`${ocultosNativos} ${ocultosNativos === 1 ? 'nativo oculto' : 'nativos ocultos'}`);
      if (removidosAdicionados) partes.push(`${removidosAdicionados} ${removidosAdicionados === 1 ? 'removido' : 'removidos'}`);
      summary.textContent = partes.join(' • ');
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
      const pointerInsideSameRow = event.clientY >= rect.top && event.clientY <= rect.bottom;
      const before = pointerInsideSameRow
        ? event.clientX < rect.left + rect.width / 2
        : event.clientY < rect.top + rect.height / 2;

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

  function renderModelosSelect() {
    const select = qs('select-modelo');
    if (!select) return;

    if (!state.modelos.length) {
      select.innerHTML = '<option value="">Nenhum formulário criado</option>';
      return;
    }

    select.innerHTML = state.modelos.map((modelo) => {
      return `<option value="${modelo.id}">${escapeHtml(modelo.nome)}</option>`;
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
    const pairs = [
      ['side-stat-secoes', resumo.secoes],
      ['side-stat-campos', resumo.campos],
      ['side-stat-custom', resumo.personalizados],
      ['side-stat-system', resumo.sistema],
      ['toolbar-stat-secoes', resumo.secoes],
      ['toolbar-stat-campos', resumo.campos],
    ];

    pairs.forEach(([id, value]) => {
      const el = qs(id);
      if (el) el.textContent = String(value || 0);
    });

    const chip = qs('form-status-chip');
    const modelo = state.modeloAtual?.modelo || null;
    if (chip) {
      chip.textContent = modelo?.ativo === false ? 'Inativo' : 'Ativo';
      chip.classList.toggle('is-off', modelo?.ativo === false);
    }
  }

  function renderModeloAtual() {
    const modelo = state.modeloAtual?.modelo || null;

    const moduloTitulo = qs('modulo-titulo');
    const modeloNome = qs('modelo-nome');
    const modeloDescricao = qs('modelo-descricao');

    if (moduloTitulo) moduloTitulo.textContent = moduloLabel();

    if (modeloNome) {
      modeloNome.textContent = modelo ? modelo.nome : 'Nenhum formulário selecionado';
    }

    if (modeloDescricao) {
      if (!modelo) {
        modeloDescricao.textContent = 'Crie um formulário padrão para começar.';
      } else {
        const flags = [];

        if (modelo.padrao) {
          flags.push('formulário padrão');
        }

        if (modelo.usar_como_ficha_principal) {
          flags.push('ficha principal do cadastro');
        }

        const fallback = modelo.padrao
          ? 'Modelo padrão gerado automaticamente pelo ValoraCRM.'
          : (flags.length ? `${moduloLabel()} • ${flags.join(' • ')}` : `${moduloLabel()} • formulário personalizado`);

        modeloDescricao.textContent = modelo.descricao || fallback;
      }
    }

    const hasModelo = !!(modelo?.id || qs('select-modelo')?.value);

    const btnEditar = qs('btn-editar-modelo');
    const btnNovaSecao = qs('btn-nova-secao');
    const btnCampoSistema = qs('btn-campo-sistema');
    const btnNovoCampo = qs('btn-novo-campo');

    if (btnEditar) btnEditar.disabled = !hasModelo;

    if (btnNovaSecao) btnNovaSecao.disabled = false;
    if (btnCampoSistema) btnCampoSistema.disabled = false;
    if (btnNovoCampo) btnNovoCampo.disabled = false;

    const empty = qs('builder-empty');
    const wrap = qs('secoes-container');

    if (!modelo) {
      if (empty) empty.style.display = '';
      if (wrap) wrap.innerHTML = '';
      renderResumoFormulario();
      renderPreviewLocalizar();
      return;
    }

    if (empty) empty.style.display = 'none';

    renderResumoFormulario();
    renderSecoes();
    renderSecaoSelect();
    renderPreviewLocalizar();
  }

  function camposOrdenados(campos = []) {
    return [...campos].sort((a, b) => {
      return Number(a.ordem || 0) - Number(b.ordem || 0) ||
        Number(a.id || 0) - Number(b.id || 0);
    });
  }

  function renderSecoes() {
    const wrap = qs('secoes-container');
    if (!wrap) return;

    const atual = state.modeloAtual;

    if (!atual?.modelo) {
      wrap.innerHTML = '';
      return;
    }

    const secoes = getSecoes();
    const camposSemSecao = Array.isArray(atual.campos_sem_secao) ? atual.campos_sem_secao : [];

    if (!secoes.length && !camposSemSecao.length) {
      wrap.innerHTML = `
        <div class="builder-empty panel-card">
          <i class="fa-solid fa-folder-open"></i>
          <strong>Este formulário ainda está vazio.</strong>
          <span>Crie uma seção primeiro. Depois coloque campos dentro dela.</span>
        </div>
      `;
      return;
    }

    let html = '';

    secoes.forEach((secao, index) => {
      html += renderSecaoCard(secao, index);
    });

    if (camposSemSecao.length) {
      html += renderSecaoCard({
        id: '',
        titulo: 'Campos sem seção',
        descricao: 'Campos antigos que ainda não foram organizados em uma seção.',
        icone: 'fa-layer-group',
        ativo: true,
        campos: camposSemSecao,
        semSecao: true,
      });
    }

    wrap.innerHTML = html;
  }

  function renderSecaoCard(secao, index = 0) {
    const campos = camposOrdenados(secao.campos || []);
    const inactive = secao.ativo === false ? '<span class="badge off">Inativa</span>' : '';
    const icon = getIconeSecao(secao);
    const sid = String(secao.id || 'sem-secao');
    const isOpen = secao.semSecao || state.secoesAbertas.has(sid);
    const originClass = secao.semSecao ? 'neutral' : `tone-${(index % 5) + 1}`;

    const actions = secao.semSecao ? '' : `
      <div class="secao-actions" aria-label="Ações da seção">
        <button class="secao-count-pill" type="button" data-action="toggle-secao" data-id="${secao.id}" title="Abrir ou recolher seção" aria-label="Abrir ou recolher seção">
          <i class="fa-solid fa-list-check"></i>
          <span>${campos.length} ${campos.length === 1 ? 'campo' : 'campos'}</span>
          <i class="fa-solid fa-chevron-down secao-toggle-icon"></i>
        </button>

        <button class="icon-btn" type="button" data-action="editar-secao" data-id="${secao.id}" title="Editar seção" aria-label="Editar seção">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>

        <button class="icon-btn danger" type="button" data-action="excluir-secao" data-id="${secao.id}" title="Excluir seção" aria-label="Excluir seção">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;

    const camposHtml = campos.length
      ? campos.map(renderCampoCard).join('')
      : `<div class="empty-section">Nenhum campo nesta seção ainda.</div>`;

    return `
      <article class="secao-card secao-card-premium ${originClass} ${isOpen ? 'is-open' : 'is-collapsed'}" data-secao-id="${escapeHtml(sid)}">
        <div class="secao-head">
          <div class="secao-title-wrap">
            <h4 class="secao-title">
              <i class="fa-solid ${escapeHtml(icon)}"></i>
              <span>${escapeHtml(secao.titulo || 'Seção')}</span>
              ${inactive}
            </h4>

            ${secao.descricao ? `<p class="secao-desc">${escapeHtml(secao.descricao)}</p>` : ''}
          </div>

          ${actions}
        </div>

        <div class="campos-list">
          ${camposHtml}
        </div>
      </article>
    `;
  }

  function renderCampoCard(campo) {
    const origem = campo.origem || 'personalizado';
    const tipo = tipoLabel(campo);
    const tipoNormalizado = normalizarTipoCampoFrontend(campo.tipo_campo || 'texto');
    const icon = tipoIcone(campo);

    const exibicao = getCampoExibicao(campo);
    const required = campo.obrigatorio ? '<span class="badge badge-required">Obrigatório</span>' : '';
    const readonly = campo.somente_leitura ? '<span class="badge badge-muted">Somente leitura</span>' : '';
    const inactive = campo.ativo === false ? '<span class="badge badge-off">Inativo</span>' : '';
    const localizar = isFlagOn(exibicao.usar_no_localizar ?? exibicao.localizar ?? exibicao.filtro)
      ? '<span class="badge badge-muted">Filtro</span>'
      : '';
    const tabela = isFlagOn(exibicao.mostrar_na_tabela ?? exibicao.tabela ?? exibicao.coluna)
      ? '<span class="badge badge-muted">Tabela</span>'
      : '';

    const chipsDireita = [required, readonly, localizar, tabela, inactive].filter(Boolean).join('');
    const origemAttr = escapeHtml(origem);

    return `
      <div class="campo-card campo-card-premium campo-row-clean" data-origem="${origemAttr}">
        <span class="campo-drag" title="Arrastar campo"><i class="fa-solid fa-grip-vertical"></i></span>

        <span class="campo-type-icon" aria-hidden="true"><i class="fa-solid ${escapeHtml(icon)}"></i></span>

        <div class="campo-main">
          <div class="campo-title">
            <strong>${escapeHtml(campo.label || '-')}</strong>
            <span class="campo-type-chip tipo-${escapeHtml(tipoNormalizado)}">${escapeHtml(tipo)}</span>
          </div>

          ${campo.ajuda ? `<div class="campo-ajuda">${escapeHtml(campo.ajuda)}</div>` : ''}
        </div>

        <div class="campo-actions">
          <span class="campo-right-chips">${chipsDireita}</span>

          <button class="icon-btn" type="button" data-action="editar-campo" data-id="${campo.id}" title="Editar campo">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button class="icon-btn danger" type="button" data-action="excluir-campo" data-id="${campo.id}" title="Excluir campo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
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
      const tipoValue = selectTipo?.value || 'texto';
      const tipo = selectTipo?.selectedOptions?.[0]?.textContent || 'Texto';
      dica = `Novo campo personalizado • Tipo: ${tipo}`;

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
  }

  function syncCampoOpcoesVisibility() {
    const tipo = qs('campo-tipo-campo')?.value || 'texto';
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
    qs('campo-tipo-campo').value = tipo || 'texto';

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
  }

  function preencherLabelPorPersonalizado() {
    const opt = qs('campo-personalizado')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';
    const nomeLimpo = label.replace(/\s*\(.+\)\s*$/, '').trim();

    if (nomeLimpo) qs('campo-label').value = nomeLimpo;
    qs('campo-tipo-campo').value = tipo || 'texto';

    syncCampoOpcoesVisibility();
    atualizarCampoPreview();
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
  }

  function resetSecaoForm(secao = null) {
    state.secaoEditando = secao;

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
  }

  function resetCampoForm(campo = null, modo = 'novo') {
    state.campoEditando = campo;

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
    qs('campo-tipo-campo').value = normalizarTipoCampoFrontend(campo?.tipo_campo || 'texto');
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
      tipo_campo: normalizarTipoCampoFrontend(qs('campo-tipo-campo').value || 'texto'),
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
        await apiJson(`${API_BASE}/campos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
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

    const ok = confirm('Excluir este campo do formulário?');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/campos/${id}`, {
        method: 'DELETE',
      });

      await carregarModeloCompleto(modeloId);

      closeModal('modal-campo');
      toast('Campo removido do formulário.');
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

  function marcarModuloAtivo() {
    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.modulo === state.modulo);
    });

    const titulo = qs('modulo-titulo');
    if (titulo) titulo.textContent = moduloLabel();
  }

  async function trocarModulo(modulo) {
    if (!MODULOS[modulo]) return;

    state.modulo = modulo;
    state.modeloAtual = null;
    state.modelos = [];
    state.camposSistema = [];
    state.camposPersonalizados = [];

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

    await carregarModelos();
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
    });

    qs('secao-icone')?.addEventListener('change', atualizarPreviewIconeSecao);

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
    qs('btn-salvar-campo')?.addEventListener('click', salvarCampo);
    qs('btn-excluir-campo')?.addEventListener('click', () => excluirCampo(qs('campo-id').value));

    qs('campo-origem')?.addEventListener('change', toggleCampoOrigem);
    qs('campo-sistema')?.addEventListener('change', preencherLabelPorSistema);
    qs('campo-personalizado')?.addEventListener('change', preencherLabelPorPersonalizado);
    qs('campo-label')?.addEventListener('input', atualizarCampoPreview);
    qs('campo-tipo-campo')?.addEventListener('change', () => {
      syncCampoOpcoesVisibility();
      atualizarCampoPreview();
    });
    qs('campo-tipo-visual')?.addEventListener('change', atualizarCampoPreview);

    qs('secoes-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

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

  async function init() {
    console.log('[Formulários] JS carregou corretamente');

    bindEventos();
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
    } catch (err) {
      console.error('[Formulários] erro no init:', err);
      toast(err.message || 'Erro ao carregar formulários.', true, 5000);
      renderModeloAtual();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();