(() => {
  'use strict';

  const API = '/api/orcamentos';
  const API_CLIENTS = '/api/clientes';
  const API_PRODUCTS = '/api/produtos';
  const API_BUDGET_PRODUCTS = `${API}/produtos`;
  const API_USERS = '/api/usuarios';
  const NILSON_PROPOSAL_EMAIL = 'nlsgv2010@gmail.com';
  const NILSON_PROPOSAL_MODELS = new Set(['monitoramento_24h', 'monitoramento_24h_comodato', 'teleassistencia_idosos']);
  const API_COMPANY = '/api/empresa/atual';

  const state = {
    budgets: [],
    budgetPage: { offset: 0, limit: 50, total: 0, hasMore: false },
    budgetSummary: { total: 0, rascunhos: 0, negociacao: 0, aprovado_total: 0 },
    budgetSearchTimer: null,
    currentId: null,
    current: null,
    appliedTemplateId: null,
    items: [],
    payments: [],
    selectedClient: null,
    clients: [],
    clientResults: [],
    clientSearchVersion: 0,
    clientPageSize: 10,
    clientOffset: 0,
    clientHasMore: false,
    clientLoading: false,
    clientQuery: '',
    clientTotal: 0,
    productSearch: {
      budget: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
      template: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
      kit: { results: [], version: 0, pageSize: 10, offset: 0, hasMore: false, loading: false, query: '', total: 0 },
    },
    categories: [],
    templates: [],
    kits: [],
    emitters: [],
    users: [],
    company: null,
    meta: { pode_ver_custos: false, pode_configurar: false, configuracao: {} },
    activeTab: 'dados',
    templateItems: [],
    kitItems: [],
    settingsTab: 'geral',
    calculation: null,
    calculationVersion: 0,
    calculationTimer: null,
    initialRouteHandled: false,
    kitPickerLayout: loadKitPickerLayout(),
    productPickerLayout: loadProductPickerLayout(),
    budgetDirty: false,
    serviceProposalModel: 'padrao',
    serviceProposalData: {},
  };

  const statusMeta = {
    rascunho: ['Em elaboração', 'status-rascunho'],
    enviado: ['Enviado', 'status-enviado'],
    em_negociacao: ['Em negociação', 'status-em_negociacao'],
    aprovado: ['Aprovado', 'status-aprovado'],
    recusado: ['Recusado', 'status-recusado'],
    cancelado: ['Cancelado', 'status-cancelado'],
    expirado: ['Expirado', 'status-expirado'],
  };

  const financeiroStatusMeta = {
    nao_enviado: ['Não enviado ao Financeiro', 'finance-nao-enviado'],
    pendente: ['Aguardando Financeiro', 'finance-pendente'],
    devolvido: ['Devolvido pelo Financeiro', 'finance-devolvido'],
    autenticado: ['Títulos gerados', 'finance-autenticado'],
    cancelado: ['Envio cancelado', 'finance-cancelado'],
  };

  const proposalPublicStatusMeta = {
    nao_gerado: ['Ainda não gerado', ''],
    preparada: ['Preparada', ''],
    aguardando: ['Aguardando cliente', 'status-aguardando'],
    visualizado: ['Visualizada', 'status-visualizado'],
    alteracao_solicitada: ['Alteração solicitada', 'status-alteracao_solicitada'],
    aprovado: ['Aprovada pelo cliente', 'status-aprovado'],
    desativado: ['Link desativado', 'status-desativado'],
  };

  const SERVICE_PROPOSAL_MODELS = {
    padrao: {
      key: 'padrao',
      name: 'Proposta padrão',
      documentName: 'Orçamento',
      description: 'Orçamento normal de produtos e serviços, sem blocos adicionais de monitoramento.',
      introduction: '',
      sections: [],
      values: [],
      conditions: '',
    },
    monitoramento_24h: {
      key: 'monitoramento_24h',
      name: 'Monitoramento 24h',
      documentName: 'Proposta Comercial - Serviços de Monitoramento 24 Horas',
      description: 'Modelo comercial de monitoramento 24 horas, gerenciamento, apoio e interação via aplicativo.',
      introduction: 'No mercado desde 1996 somos uma empresa que atua nas Áreas de Segurança Eletrônica, Automação, Telecomunicações e Faciliteis.\n\nDentro da área de Segurança Eletrônica destacamos os Serviços de Monitoramento 24 horas o qual tem por finalidade Integrar os Equipamentos de Segurança e Controle de Acesso instalados nos imóveis monitorado com nossa Central de Operações.',
      sections: [
        { id: 'gerenciamento_padrao', title: '01- Gerenciamento Padrão', services: [
          { id: 'plantao_24h', label: 'Plantão 24 horas p/ Atendimento de Ocorrências', checked: true },
          { id: 'sinais_internet', label: 'Monitoramento/Recepção Sinais Via Internet.', checked: true },
          { id: 'radio_gprs_opcao', label: 'Opção de Monitoramento via Tecnologias de Rádio e GPRS*', checked: false },
          { id: 'rede_sem_fio', label: 'Rede de Monitoramento Sem Fio com Rede Própria (Rádio/GPRS)', checked: true },
          { id: 'corte_energia_linha', label: 'Identificação de Corte de Energia / Corte de Linha Telefônica', checked: true },
        ]},
        { id: 'controle_acesso', title: '02- Gerenciamento de Controle de Acesso', services: [
          { id: 'nao_ativado_horario', label: 'Notificação p/ Sistemas NÃO Ativado em Horário Programado', checked: true },
          { id: 'desativado_antes_horario', label: 'Notificação p/ Sistemas Desativado Antes do Horário', checked: true },
          { id: 'cerca_desativada', label: 'Notificação p/ Cerca Elétrica Desativada', checked: true },
          { id: 'ativacao_remota', label: 'Ativação Remota de Sistemas em casos de Necessidade. *', checked: true },
          { id: 'desativacao_fora_horario', label: 'Acompanhamento de Desativação Fora de Horário Programado.', checked: true },
          { id: 'autoteste_comunicacao', label: 'Autoteste Comunicação Painel x Central 24hs em Tempo Real*', checked: true },
        ]},
        { id: 'ocorrencias_alarme', title: '03- Gerenciamento de Ocorrências - Alarme', services: [
          { id: 'eventos_disparo', label: 'Análise e Tratamento de Eventos de Disparos de Alarme', checked: true },
          { id: 'coacao_panico', label: 'Análise e Tratamento de Eventos de Coação / Pânico Silencioso', checked: true },
          { id: 'pronta_resposta_virtual', label: 'Pronta Resposta Virtual c/ Acompanhamento Via CFTV*', checked: true },
          { id: 'pronta_resposta_local', label: 'Envio de Atendimento de Pronta Resposta IN-LOCO*', checked: true },
          { id: 'preservacao_local', label: 'Preservação de Local até Chegada do Responsável pelo Imóvel *', checked: true },
          { id: 'autoridades', label: 'Notificação /Envio de Autoridades em Casos de Sinistro (Polícia 190)', checked: true },
          { id: 'pessoas_avisadas', label: 'Notificação de Pessoas a serem avisadas em casos de Sinistros', checked: true },
          { id: 'procedimentos_cliente', label: 'Execução de Procedimentos Definidos pelo Cliente em Sinistros', checked: true },
        ]},
        { id: 'servicos_apoio', title: '04- Serviços de Apoio', services: [
          { id: 'my_security', label: 'Aplicativo MY Security para Acompanhamento/Interação Remota', checked: true },
          { id: 'usuarios_remotos', label: 'Gerenciamento Remoto de Usuários (Criação/Bloqueio)', checked: true },
          { id: 'visita_bimestral', label: 'Visita Técnica Bimestral para Revisão Preventiva', checked: true },
          { id: 'assistencia_tecnica', label: 'Assistência Técnica p/ Alarme /Cerca Elétrica /CFTV/ Interfonia.', checked: true },
          { id: 'relatorios', label: 'Relatórios Quinzenal ou Mensal Via E-mail', checked: true },
        ]},
        { id: 'aplicativo', title: '05- Funções e Serviços com Interação Via Aplicativo', services: [
          { id: 'ativar_desativar', label: 'Ativação / Desativação de Sistema de Alarme / Eletrificador', checked: true },
          { id: 'anulacao_setores', label: 'Anulação de Setores e Perímetros', checked: true },
          { id: 'eventos_tempo_real', label: 'Acompanhamento Eventos Ativação/Desativação em Tempo Real', checked: true },
          { id: 'sistemas_nao_ativados', label: 'Acompanhamento Sistemas Desativados Não Ativados no Horário', checked: true },
          { id: 'ordens_servicos', label: 'Solicitação / Acompanhamento de Ordens de Serviços', checked: true },
        ]},
        { id: 'pre_programados', title: '06- Serviços Pré Programados (Habilitados mediante a Contratação)', services: [
          { id: 'integracao_cftv', label: 'Possibilidade de Integração Sistema de CFTV *', checked: true },
          { id: 'chegada_assistida', label: 'Acompanhamento de Chegada Assistida*', checked: false },
          { id: 'portoes', label: 'Possibilidade de Abertura /Fechamento Portões Automáticos *', checked: false },
          { id: 'automacao_processos', label: 'Automação de Processos (Iluminação / Outros) *', checked: false },
          { id: 'care', label: 'Monitoramento /Acompanhamento Remoto de Idosos (CARE)*', checked: false },
          { id: 'incendio_gas', label: 'Monitoramento de Sistemas de Incêndio ou Vazamento de Gás*', checked: false },
          { id: 'panico_app', label: 'Botão de Pânico Silencioso Via Aplicativo*', checked: false },
          { id: 'backup_cftv', label: 'Armazenamento /Backup Imagens CFTV em Nuvem*', checked: false },
          { id: 'assistencia_24h', label: 'Assistência Técnica Emergencial 24 Horas *', checked: false },
          { id: 'limpeza_perimetros', label: 'Serviços de Limpeza e Conservação de Perímetros Monitorado*', checked: false },
          { id: 'faciliteis', label: 'Serviços e Faciliteis*', checked: false },
        ]},
      ],
      values: [
        { id: 'implantacao', label: 'Valor implantação (único)', default: 0 },
        { id: 'mensalidade', label: 'Valor Serviços Monit24hs (mensal)', default: 0 },
      ],
      conditions: '1- Plano Comercial 12 Meses com Renovação Automática\n2- Equipamentos Instalados: Modulo Comunicação\n3- Mão de Obra de Serviços de Revisão /Manutenção Geral (Alarme/Cerca)\n4- Condições Gerais Descrito Contrato com Base em cada Serviço Contratado.\n\n* O Aplicativo My Security faz Parte Integrante dos Serviços de Monitoramento 24horas\n* Os Serviços apresentados dependem de Área de Cobertura Técnica /Operacional\n* Os Serviços podem depender de Hardware Específicos e Serviços de Terceiros\n* Todos os Serviços são regidos conforme clausulas contratual e seus Anexos.\n* O Aplicativo My Security Requer Smartphone c /Sistema Operacional IOS/Android 4.0',
    },
    monitoramento_24h_comodato: {
      key: 'monitoramento_24h_comodato',
      name: 'Monitoramento 24h - Comodato',
      documentName: 'Proposta Comercial - Serviços de Monitoramento 24 Horas - Comodato',
      description: 'Mesmo conjunto de serviços de monitoramento, com condições específicas da modalidade COMODATO.',
      introduction: 'No mercado desde 1996 somos uma empresa que atua nas Áreas de Segurança Eletrônica, Automação, Telecomunicações e Faciliteis.\n\nDentro da área de Segurança Eletrônica destacamos os Serviços de Monitoramento 24 horas o qual tem por finalidade Integrar os Equipamentos de Segurança e Controle de Acesso instalados nos imóveis monitorado com nossa Central de Operações.',
      copySectionsFrom: 'monitoramento_24h',
      values: [
        { id: 'implantacao', label: 'Valor implantação (único)', default: 0 },
        { id: 'mensalidade', label: 'Valor Serviços Monit24hs (mensal)', default: 0 },
      ],
      conditions: '1- Para Plano Comodato - Fidelidade 12 (Doze) Meses. Renovação Automática\n2- Equipamentos: Vide Orçamento em Anexo (Orçamento Comodato).\n3- Mão de Obra de Serviços de Revisão /Manutenção Geral (Alarme/Cerca)\n4- Condições Gerais Descrito Contrato com Base em cada Serviço Contratado.\n\n* O Aplicativo My Security faz Parte Integrante dos Serviços de Monitoramento 24horas\n* Os Serviços apresentados dependem de Área de Cobertura Técnica /Operacional\n* Os Serviços podem depender de Hardware Específicos e Serviços de Terceiros\n* Todos os Serviços são regidos conforme clausulas contratual e seus Anexos.\n* O Aplicativo My Security Requer Smartphone c /Sistema Operacional IOS/Android 4.0',
    },
    teleassistencia_idosos: {
      key: 'teleassistencia_idosos',
      name: 'Tele Assistência - Idosos',
      documentName: 'Proposta Comercial - Monitoramento 24 Horas - Tele Assistência',
      description: 'Modelo para acompanhamento a distância de idosos e pessoas em processo de recuperação de saúde.',
      introduction: 'Atuando no mercado desde 1996, somos uma empresa especializada nas áreas de Segurança Eletrônica, Automação, Telecomunicações e Gestão de Facilities.\n\nNa área de Segurança Eletrônica, destacamos o serviço de Monitoramento 24 Horas - Tele Assistência, que é formada por um conjunto de Serviços projetados para o acompanhamento a distância de idosos e Pessoas em processo de Recuperação de Saúde, garantindo sua Segurança e Bem-estar.',
      sections: [
        { id: 'monitoramento_emergencial', title: '1- Monitoramento Emergencial', services: [
          { id: 'pedidos_ajuda', label: 'Monitoramento 24 horas Pedidos de Ajuda Solicitados.', checked: true },
          { id: 'identificacao_solicitante', label: 'Identificação do Solicitante (Idoso/ Acompanhante).', checked: true },
          { id: 'samu', label: 'Notificação Autoridades Emergenciais (SAMU 192).', checked: true },
          { id: 'pessoas_avisadas', label: 'Notificação de Pessoas a serem Avisadas.', checked: true },
          { id: 'procedimentos_cliente', label: 'Execução de Procedimentos Definidos pelo Cliente.', checked: true },
          { id: 'falta_energia', label: 'Identificação de Falta de Energia Eletrica.', checked: true },
          { id: 'perda_comunicacao', label: 'Identificação de Perda de Comunicação.', checked: true },
          { id: 'relatorios_emergenciais', label: 'Relatórios Automáticos de Eventos Emergenciais.', checked: true },
          { id: 'app_tempo_real', label: 'Aplicativo para Acompanhamento em Tempo Real.', checked: true },
          { id: 'gprs_internet', label: 'Monitoramento com Comunicação Via GPRS e Internet.', checked: true },
        ]},
        { id: 'cftv_cliente', title: '2- Sistema de CFTV com Monitoramento via Aplicativo - Para o Cliente', services: [
          { id: 'visualizacao_tempo_real', label: 'Visualização das Cameras em Tempo Real', checked: true },
          { id: 'visao_noturna_audio', label: 'Visão Noturna e Captação de Audio', checked: true },
          { id: 'armazenamento_15_dias', label: 'Armazenamento Vídeos com Áudio de até 15 (Quize)dias.', checked: true },
          { id: 'acesso_aplicativo', label: 'Acesso as Imagens Via Aplicativo (Celular / PC Notbook)', checked: true },
          { id: 'deteccao_movimentos', label: 'Monitoramento com Deteção de Movimentos no Imovel', checked: true },
        ]},
        { id: 'cftv_central', title: 'Suporte Central Monitoramento', services: [
          { id: 'falha_internet', label: 'Falhas de Conexão com Internet', checked: true },
          { id: 'falha_hd', label: 'Falta /Falhas / Erros de Disco HD', checked: true },
          { id: 'perda_video', label: 'Perda de Vídeo', checked: true },
          { id: 'mascaramento', label: 'Mascaramento de Cameras', checked: true },
          { id: 'assistencia_24h', label: 'Assistência Tecnica 24 Horas.', checked: true },
        ]},
      ],
      values: [
        { id: 'implantacao_emergencial', label: 'Implantação - Monitoramento Emergencial', default: 750 },
        { id: 'implantacao_cftv', label: 'Implantação - Sistema de CFTV', default: 980 },
        { id: 'mensalidade_cftv', label: 'Mensalidade - CFTV / Monitoramento', default: 400 },
      ],
      conditions: '1- Disponibilização de 02 Acionadores Tipo Chaveiro\n2- Opção Rede Monitoramento em Locais sem Internet (Rádio/GPRS)\n\nCondições Gerais:\n1- Plano com Equipamentos instalados na Modalidade COMODATO com Fidelidade de 12 (Doze) Meses e Renovação Automática.\n3- Mão de Obra de Serviços de Revisão /Manutenção Geral já inclusos\n4- Condições Gerais Descrito Contrato com Base em cada Serviço Contratado.\n5- Sistema de Redundância para CFTV em Casos de Falta de Energia Eletrica é Opcional\n6- Aplicativos utilizados fazem Parte Integrante dos Serviços de Monit24hs. Requisitos Smartphone: Sistema Operacional IOS/Android 4.0\n7- Os Serviços apresentados dependem de Área de Cobertura Técnica e podem depender de Hardware Específicos e Serviços de Terceiros.\n8- Todos os Serviços são regidos conforme clausulas contratual e seus Anexos.',
    },
  };

  function serviceProposalDefinition(key) {
    const model = SERVICE_PROPOSAL_MODELS[key] || SERVICE_PROPOSAL_MODELS.padrao;
    const sections = model.copySectionsFrom
      ? SERVICE_PROPOSAL_MODELS[model.copySectionsFrom].sections
      : model.sections;
    return { ...model, sections: JSON.parse(JSON.stringify(sections || [])) };
  }

  function defaultServiceProposalData(key) {
    const model = serviceProposalDefinition(key);
    const selectedServices = {};
    (model.sections || []).forEach((section) => {
      selectedServices[section.id] = (section.services || []).filter((service) => service.checked !== false).map((service) => service.id);
    });
    const values = {};
    (model.values || []).forEach((value) => { values[value.id] = Number(value.default || 0); });
    return {
      introduction: model.introduction || '',
      selected_services: selectedServices,
      values,
      conditions: model.conditions || '',
      notes: '',
    };
  }

  const DOCUMENT_SCALE_MIN = 70;
  const DOCUMENT_SCALE_MAX = 125;
  const DOCUMENT_SCALE_DEFAULT = 100;
  const DOCUMENT_SCALE_PRESETS = new Set([85, 100, 115]);
  const BUDGET_MAXIMIZED_STORAGE_KEY = 'valora:orcamentos:maximized';

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function normalizeDocumentScale(value, fallback = DOCUMENT_SCALE_DEFAULT) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    const fallbackParsed = Number.parseInt(String(fallback ?? DOCUMENT_SCALE_DEFAULT), 10);
    const safeFallback = Number.isFinite(fallbackParsed) ? fallbackParsed : DOCUMENT_SCALE_DEFAULT;
    const safeValue = Number.isFinite(parsed) ? parsed : safeFallback;
    return Math.min(DOCUMENT_SCALE_MAX, Math.max(DOCUMENT_SCALE_MIN, safeValue));
  }

  function setScaleControl(rangeId, presetId, outputId, value) {
    const range = $(rangeId);
    const preset = $(presetId);
    const output = $(outputId);
    const normalized = normalizeDocumentScale(value);
    if (range) range.value = String(normalized);
    if (preset) preset.value = DOCUMENT_SCALE_PRESETS.has(normalized) ? String(normalized) : 'custom';
    if (output) {
      output.value = `${normalized}%`;
      output.textContent = `${normalized}%`;
    }
    return normalized;
  }

  function currentDocumentScale() {
    const companyDefault = normalizeDocumentScale(state.meta.configuracao?.escala_documento_padrao);
    return normalizeDocumentScale($('orcamento-escala-documento')?.value, companyDefault);
  }

  function companyDocumentScale() {
    return normalizeDocumentScale(state.meta.configuracao?.escala_documento_padrao);
  }

  function scaledCssValue(base, unit, scale = currentDocumentScale(), precision = 2) {
    const value = Number(base) * normalizeDocumentScale(scale) / 100;
    const rounded = Number(value.toFixed(precision));
    return `${rounded}${unit}`;
  }

  function syncBudgetScale(value, { render = true } = {}) {
    const normalized = setScaleControl('orcamento-escala-documento', 'orcamento-escala-preset', 'orcamento-escala-valor', value);
    if (render) renderPreviewIfVisible();
    return normalized;
  }

  function syncSettingsScale(value) {
    return setScaleControl('config-escala-documento', 'config-escala-preset', 'config-escala-valor', value);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function parseNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
    if (!text) return 0;
    if (text.includes(',') && text.includes('.')) text = text.replaceAll('.', '').replace(',', '.');
    else if (text.includes(',')) text = text.replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? number : 0;
  }

  function formatMoney(value) {
    return parseNumber(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDavValue(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDavQuantity(value) {
    const number = parseNumber(value);
    return number.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(number) ? 0 : 2, maximumFractionDigits: 4 });
  }

  function inputMoney(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function inputQuantity(value) {
    return parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  function formatPercent(value) {
    return `${parseNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function localDate(value) {
    if (!value) return '—';
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-');
    return y && m && d ? `${d}/${m}/${y}` : '—';
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function addDays(dateString, days) {
    const date = new Date(`${dateString || today()}T12:00:00`);
    date.setDate(date.getDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function loadKitPickerLayout() {
    try {
      const saved = localStorage.getItem('valora:orcamentos:kit-picker-layout');
      return saved === 'row' ? 'row' : 'column';
    } catch (_) {
      return 'column';
    }
  }

  function saveKitPickerLayout(layout) {
    try {
      localStorage.setItem('valora:orcamentos:kit-picker-layout', layout);
    } catch (_) {}
  }

  function loadProductPickerLayout() {
    try {
      const saved = localStorage.getItem('valora:orcamentos:product-picker-layout');
      return saved === 'row' ? 'row' : 'column';
    } catch (_) {
      return 'column';
    }
  }

  function saveProductPickerLayout(layout) {
    try {
      localStorage.setItem('valora:orcamentos:product-picker-layout', layout);
    } catch (_) {}
  }

  function toast(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else alert(message);
  }


  function isBudgetModalOpen() {
    const modal = $('budget-modal');
    return Boolean(modal && !modal.hidden && modal.getAttribute('aria-hidden') !== 'true');
  }

  function setBudgetDirty(dirty) {
    state.budgetDirty = Boolean(dirty);
    const pill = $('budget-unsaved-pill');
    if (pill) pill.hidden = !state.budgetDirty;
  }

  function markBudgetDirty() {
    if (!isBudgetModalOpen()) return;
    setBudgetDirty(true);
  }

  function setBudgetActionsMenuOpen(open) {
    const trigger = $('btn-budget-acoes');
    const menu = $('budget-actions-menu');
    const dropdown = $('budget-actions-dropdown');
    if (!trigger || !menu) return;
    const active = Boolean(open);
    menu.hidden = !active;
    trigger.setAttribute('aria-expanded', active ? 'true' : 'false');
    dropdown?.classList.toggle('is-open', active);
  }

  function closeBudgetActionsMenu() {
    setBudgetActionsMenuOpen(false);
  }

  let budgetConfirmResolver = null;

  function closeBudgetConfirm(result = false) {
    const backdrop = $('budget-confirm-backdrop');
    if (backdrop) {
      backdrop.classList.remove('show');
      backdrop.setAttribute('aria-hidden', 'true');
      window.setTimeout(() => { backdrop.hidden = true; }, 160);
    }
    if (typeof budgetConfirmResolver === 'function') {
      const resolver = budgetConfirmResolver;
      budgetConfirmResolver = null;
      resolver(Boolean(result));
    }
  }

  function budgetConfirm({
    title = 'Confirmar ação',
    message = 'Deseja continuar?',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    tone = 'default',
  } = {}) {
    const backdrop = $('budget-confirm-backdrop');
    const dialog = backdrop?.querySelector('.budget-confirm-dialog');
    if (!backdrop || !dialog) return Promise.resolve(false);

    $('budget-confirm-title').textContent = title;
    $('budget-confirm-message').textContent = message;
    $('budget-confirm-ok').textContent = confirmText;
    $('budget-confirm-cancel').textContent = cancelText;
    dialog.classList.toggle('is-danger', tone === 'danger');

    if (typeof budgetConfirmResolver === 'function') {
      const previous = budgetConfirmResolver;
      budgetConfirmResolver = null;
      previous(false);
    }

    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      backdrop.classList.add('show');
      $('budget-confirm-cancel')?.focus();
    });

    return new Promise((resolve) => {
      budgetConfirmResolver = resolve;
    });
  }

  async function requestCloseBudgetModal() {
    if (state.budgetDirty) {
      const ok = await budgetConfirm({
        title: 'Alterações não salvas',
        message: 'Existem alterações não salvas neste orçamento. Deseja fechar mesmo assim?',
        confirmText: 'Descartar e fechar',
        cancelText: 'Continuar editando',
        tone: 'danger',
      });
      if (!ok) return false;
    }
    setBudgetDirty(false);
    closeBudgetActionsMenu();
    closeOverlay('budget-modal');
    return true;
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof data === 'object' ? data.detail : data;
      const method = String(options.method || 'GET').toUpperCase();
      const message = detail || `Erro HTTP ${response.status}`;
      const error = new Error(`${message} (${method} ${url} — HTTP ${response.status})`);
      error.status = response.status;
      error.url = url;
      error.method = method;
      throw error;
    }
    return data;
  }

  function budgetMaximizedPreference() {
    try {
      return localStorage.getItem(BUDGET_MAXIMIZED_STORAGE_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function setBudgetMaximized(maximized, { persist = true } = {}) {
    const overlay = $('budget-modal');
    const content = overlay?.querySelector('.budget-modal-content');
    const button = $('btn-toggle-budget-maximize');
    const active = Boolean(maximized);

    overlay?.classList.toggle('is-maximized', active);
    content?.classList.toggle('is-maximized', active);

    if (button) {
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.setAttribute('aria-label', active ? 'Restaurar tamanho do orçamento' : 'Maximizar orçamento');
      button.title = active ? 'Restaurar tamanho do orçamento' : 'Maximizar orçamento';
      button.innerHTML = active
        ? '<i class="fa-solid fa-compress"></i><span>Restaurar</span>'
        : '<i class="fa-solid fa-expand"></i><span>Maximizar</span>';
    }

    if (persist) {
      try { localStorage.setItem(BUDGET_MAXIMIZED_STORAGE_KEY, active ? '1' : '0'); } catch (_) {}
    }
  }

  function toggleBudgetMaximized() {
    const overlay = $('budget-modal');
    setBudgetMaximized(!overlay?.classList.contains('is-maximized'));
  }

  function openOverlay(id) {
    const overlay = $(id);
    if (!overlay) {
      console.warn('[orcamentos] Modal não encontrado:', id);
      return;
    }

    if (id === 'budget-modal') {
      setBudgetMaximized(budgetMaximizedPreference(), { persist: false });
    }

    // Usa o controlador global oficial do Valora quando estiver disponível.
    // O app.css exige a classe "show" para tornar o modal visível.
    if (window.ValoraModal?.open) {
      window.ValoraModal.open(overlay);
      return;
    }

    overlay.hidden = false;
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function closeOverlay(id) {
    const overlay = $(id);
    if (!overlay) return;

    if (window.ValoraModal?.close) {
      window.ValoraModal.close(overlay);
      return;
    }

    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      overlay.hidden = true;
      overlay.style.display = 'none';
      if (!$$('.modal-overlay.show').length) document.body.classList.remove('modal-open');
    }, 160);
  }

  function setButtonLoading(button, loading, text = 'Salvando...') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(text)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

  function getStatus(status) {
    return statusMeta[status] || statusMeta.rascunho;
  }

  function proposalPublicStatusInfo(value) {
    return proposalPublicStatusMeta[String(value || 'nao_gerado')] || [String(value || 'Não gerado'), ''];
  }

  function canUseNilsonProposalModels() {
    const email = String(state.meta?.usuario?.email || '').trim().toLowerCase();
    return Boolean(state.meta?.modelos_proposta_monitoramento_habilitados || email === NILSON_PROPOSAL_EMAIL);
  }

  function applyExclusiveServiceProposalAccess() {
    const enabled = canUseNilsonProposalModels();
    $$('[data-nilson-proposal-only]').forEach((element) => {
      element.classList.toggle('is-hidden', !enabled);
    });
    if (!enabled && state.activeTab === 'proposta-comercial') setTab('dados');
  }

  async function bootstrap() {
    try {
      const [meta, categories, templates, kits, users, company, clientsResponse] = await Promise.all([
        api(`${API}/meta`),
        api(`${API}/categorias`),
        api(`${API}/modelos`),
        api(`${API}/kits`),
        api(API_USERS),
        api(API_COMPANY).catch(() => null),
        api(`${API_CLIENTS}?paginated=true&limit=20&offset=0`).catch(() => ({ items: [] })),
      ]);
      state.meta = meta;
      applyExclusiveServiceProposalAccess();
      state.categories = categories || [];
      state.templates = templates || [];
      state.kits = kits || [];
      state.users = (users || []).filter((user) => user.ativo !== false);
      state.company = company;
      state.emitters = meta.emitentes || [];
      state.clients = normalizeCollection(clientsResponse);
      applyPermissions();
      renderSelects();
      fillSettingsForm();
      await loadBudgets();
      await handleInitialRoute();
    } catch (error) {
      console.error('[orcamentos] bootstrap:', error);

      const apiNaoCarregada = error?.status === 404 && String(error?.url || '').startsWith(API);
      const message = apiNaoCarregada
        ? 'A API de Orçamentos ainda não está carregada no backend. Confirme os arquivos backend/main.py e backend/routers/orcamentos.py e reinicie ou reconstrua o FastAPI.'
        : (error.message || 'Não foi possível carregar o módulo de orçamentos.');

      toast(message, 'error');
      $('tbody-orcamentos').innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(message)}</td></tr>`;
    }
  }

  function canShowCosts() {
    return Boolean(state.meta.pode_ver_custos && state.meta.configuracao?.controlar_custos !== false);
  }

  function applyPermissions() {
    const showCosts = canShowCosts();
    $$('.cost-only').forEach((element) => element.classList.toggle('is-hidden', !showCosts));
    $('btn-configurar-orcamentos').classList.toggle('is-hidden', !state.meta.pode_configurar);
    if ($('btn-gerenciar-kits')) $('btn-gerenciar-kits').classList.toggle('is-hidden', !state.meta.pode_configurar);
  }

  async function loadBudgets({ offset = state.budgetPage.offset || 0 } = {}) {
    $('tbody-orcamentos').innerHTML = '<tr><td colspan="7" class="empty-state">Carregando orçamentos...</td></tr>';
    const params = new URLSearchParams({
      paginated: 'true',
      limit: String(state.budgetPage.limit || 50),
      offset: String(Math.max(0, Number(offset || 0))),
    });
    const search = $('busca-orcamentos').value.trim();
    const status = $('filtro-status-orcamentos').value;
    if (search) params.set('busca', search);
    if (status) params.set('status', status);

    const response = await api(`${API}?${params.toString()}`);
    state.budgets = normalizeCollection(response);
    state.budgetPage = {
      offset: Number(response?.offset ?? offset) || 0,
      limit: Number(response?.limit ?? state.budgetPage.limit) || 50,
      total: Number(response?.total ?? state.budgets.length) || 0,
      hasMore: Boolean(response?.has_more),
    };
    state.budgetSummary = {
      total: Number(response?.summary?.total ?? state.budgetPage.total) || 0,
      rascunhos: Number(response?.summary?.rascunhos ?? 0) || 0,
      negociacao: Number(response?.summary?.negociacao ?? 0) || 0,
      aprovado_total: response?.summary?.aprovado_total ?? 0,
    };

    if (!state.budgets.length && state.budgetPage.total > 0 && state.budgetPage.offset > 0) {
      const lastOffset = Math.max(0, (Math.ceil(state.budgetPage.total / state.budgetPage.limit) - 1) * state.budgetPage.limit);
      if (lastOffset !== state.budgetPage.offset) return loadBudgets({ offset: lastOffset });
    }
    renderBudgets();
  }

  function filteredBudgets() {
    return state.budgets;
  }

  function financeiroStatusInfo(status) {
    const key = String(status || 'nao_enviado').toLowerCase();
    return financeiroStatusMeta[key] || financeiroStatusMeta.nao_enviado;
  }

  function syncFinanceiroActions(budget = state.current) {
    const chip = $('budget-financeiro-status');
    const enviar = $('btn-enviar-financeiro');
    const cancelar = $('btn-cancelar-envio-financeiro');
    const abrir = $('btn-abrir-financeiro-orcamento');
    const currentStatus = String((state.currentId ? $('orcamento-status')?.value : '') || budget?.status || '').toLowerCase();
    const finStatus = String(budget?.financeiro_status || 'nao_enviado').toLowerCase();
    const [label, className] = financeiroStatusInfo(finStatus);

    if (chip) {
      chip.textContent = label;
      chip.className = `budget-finance-status ${className}${state.currentId ? '' : ' is-hidden'}`;
      chip.title = budget?.financeiro_motivo_retorno || label;
    }
    if (enviar) enviar.classList.toggle('is-hidden', !(state.currentId && currentStatus === 'aprovado' && ['nao_enviado', 'devolvido', 'cancelado'].includes(finStatus)));
    if (cancelar) cancelar.classList.toggle('is-hidden', !(state.currentId && finStatus === 'pendente'));
    if (abrir) abrir.classList.toggle('is-hidden', !(state.currentId && ['pendente', 'autenticado', 'devolvido'].includes(finStatus)));
  }

  function renderBudgets() {
    const list = filteredBudgets();
    const tbody = $('tbody-orcamentos');
    const inicio = state.budgetPage.total ? state.budgetPage.offset + 1 : 0;
    const fim = Math.min(state.budgetPage.offset + list.length, state.budgetPage.total);
    $('contagem-orcamentos').textContent = state.budgetPage.total
      ? `${inicio}–${fim} de ${state.budgetPage.total} orçamentos`
      : '0 orçamentos';

    $('kpi-total-orcamentos').textContent = state.budgetSummary.total;
    $('kpi-rascunhos').textContent = state.budgetSummary.rascunhos;
    $('kpi-negociacao').textContent = state.budgetSummary.negociacao;
    $('kpi-aprovado').textContent = formatMoney(state.budgetSummary.aprovado_total);
    renderBudgetPagination();

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum orçamento encontrado.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map((budget) => {
      const [label, className] = getStatus(budget.status);
      const approval = budget.aprovacao_necessaria && budget.aprovacao_status !== 'aprovado'
        ? '<small><i class="fa-solid fa-triangle-exclamation"></i> aprovação pendente</small>' : '';
      return `
        <tr>
          <td data-label="Número"><span class="budget-number"><i class="fa-regular fa-file-lines"></i>${escapeHtml(budget.codigo)}</span></td>
          <td data-label="Emissão">${escapeHtml(localDate(budget.data_emissao))}</td>
          <td data-label="Cliente"><div class="budget-client-cell"><strong>${escapeHtml(budget.cliente_nome || 'Cliente não vinculado')}</strong><small>${escapeHtml(budget.cliente_documento || '')}</small></div></td>
          <td data-label="Descrição"><div class="budget-title-cell"><strong>${escapeHtml(budget.titulo)}</strong><small>${escapeHtml(budget.categoria_nome || budget.nome_documento || '')}</small>${approval}</div></td>
          <td data-label="Status"><span class="budget-status ${className}">${label}</span>${budget.financeiro_status && budget.financeiro_status !== 'nao_enviado' ? `<small class="budget-finance-list ${financeiroStatusInfo(budget.financeiro_status)[1]}"><i class="fa-solid fa-building-columns"></i> ${escapeHtml(financeiroStatusInfo(budget.financeiro_status)[0])}</small>` : ''}${budget.publicacao_cliente?.status && !['nao_gerado', 'preparada'].includes(budget.publicacao_cliente.status) ? `<small class="budget-client-public-list ${escapeHtml(proposalPublicStatusInfo(budget.publicacao_cliente.status)[1])}"><i class="fa-solid fa-link"></i> ${escapeHtml(proposalPublicStatusInfo(budget.publicacao_cliente.status)[0])}</small>` : (budget.preparacao_cliente?.preparada ? '<small class="budget-client-prepared-list"><i class="fa-solid fa-link"></i> preparado para cliente</small>' : '')}${budget.publicacao_cliente?.cadastro_contrato?.status === 'concluido' ? '<small class="budget-client-contract-list"><i class="fa-solid fa-file-signature"></i> cadastro contrato concluído</small>' : ''}${budget.publicacao_cliente?.contrato?.status === 'gerado' ? `<small class="budget-generated-contract-list"><i class="fa-solid fa-file-contract"></i> contrato v${Number(budget.publicacao_cliente?.contrato?.versao || 1)} gerado</small>` : ''}</td>
          <td data-label="Total" class="text-right"><span class="budget-value-cell">${formatMoney(budget.total)}</span></td>
          <td data-label="Ações" class="text-right"><div class="budget-row-actions">
            <button class="budget-action-btn" data-action="edit" data-id="${budget.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
            <button class="budget-action-btn" data-action="print" data-id="${budget.id}" title="Imprimir/PDF"><i class="fa-solid fa-print"></i></button>
            <button class="budget-action-btn" data-action="whatsapp" data-id="${budget.id}" title="WhatsApp"><i class="fa-brands fa-whatsapp"></i></button>
            <button class="budget-action-btn" data-action="duplicate" data-id="${budget.id}" title="Duplicar"><i class="fa-regular fa-copy"></i></button>
            <button class="budget-action-btn danger" data-action="delete" data-id="${budget.id}" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
          </div></td>
        </tr>`;
    }).join('');

  }

  function renderBudgetPagination() {
    const box = $('paginacao-orcamentos');
    if (!box) return;

    const total = Number(state.budgetPage.total || 0);
    const limit = Number(state.budgetPage.limit || 50);
    const offset = Number(state.budgetPage.offset || 0);
    const paginas = Math.max(1, Math.ceil(total / limit));
    const atual = total ? Math.floor(offset / limit) + 1 : 1;
    const lastOffset = Math.max(0, (paginas - 1) * limit);

    box.innerHTML = `
      <span class="counter-text pagination-info">Página ${atual} de ${paginas}</span>
      <button class="btn btn-secondary btn-small" type="button" data-budget-page="first" ${offset <= 0 ? 'disabled' : ''}>Primeira</button>
      <button class="btn btn-secondary btn-small" type="button" data-budget-page="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
      <button class="btn btn-secondary btn-small" type="button" data-budget-page="next" ${offset >= lastOffset ? 'disabled' : ''}>Próxima</button>
      <button class="btn btn-secondary btn-small" type="button" data-budget-page="last" ${offset >= lastOffset ? 'disabled' : ''}>Última</button>
    `;
  }

  function renderSelects() {
    const activeCategories = state.categories.filter((category) => category.ativo !== false);
    const activeTemplates = state.templates.filter((template) => template.ativo !== false);
    const activeEmitters = state.emitters.filter((emitter) => emitter.ativo !== false);
    const categoryOptions = '<option value="">Sem categoria</option>' + activeCategories.map((category) => `<option value="${category.id}">${escapeHtml(category.nome)}</option>`).join('');
    $('orcamento-categoria').innerHTML = categoryOptions;
    $('template-category').innerHTML = categoryOptions;
    const activeKitsForModel = (state.kits || []).filter((kit) => kit.ativo !== false);
    const modelOptions = activeTemplates.length
      ? `<optgroup label="Modelos de orçamento">${activeTemplates.map((template) => `<option value="${template.id}">${escapeHtml(template.nome)}</option>`).join('')}</optgroup>`
      : '';
    const kitOptions = activeKitsForModel.length
      ? `<optgroup label="Kits de produtos">${activeKitsForModel.map((kit) => `<option value="kit:${kit.id}">${escapeHtml(kit.nome)}</option>`).join('')}</optgroup>`
      : '';
    $('orcamento-modelo').innerHTML = '<option value="">Começar do zero</option>' + modelOptions + kitOptions;
    $('orcamento-consultor').innerHTML = '<option value="">Selecionar</option>' + state.users.map((user) => `<option value="${user.id}">${escapeHtml(user.nome)}</option>`).join('');
    if ($('orcamento-emitente-id')) {
      $('orcamento-emitente-id').innerHTML = '<option value="">Selecionar empresa</option>' + activeEmitters.map((emitter) => `<option value="${emitter.id}">${escapeHtml(emitter.nome)}${emitter.padrao ? ' (padrão)' : ''}</option>`).join('');
    }
  }

  function syncClientEditButton() {
    const button = $('btn-editar-cliente-orcamento');
    if (!button) return;

    const clientId = Number($('orcamento-cliente-id')?.value || state.selectedClient?.id || 0);
    button.classList.toggle('is-hidden', !clientId);
    button.disabled = !clientId;
    button.dataset.clientId = clientId ? String(clientId) : '';
  }

  function openSelectedClientEditor() {
    const clientId = Number($('orcamento-cliente-id')?.value || state.selectedClient?.id || 0);
    if (!clientId) {
      toast('Selecione um cliente primeiro.', 'error');
      return;
    }

    const url = `/clientes?editar_cliente_id=${encodeURIComponent(clientId)}`;
    const popup = window.open(url, '_blank');
    if (!popup) {
      toast('O navegador bloqueou a nova aba. Libere pop-ups para editar o cliente sem perder o orçamento.', 'error');
      return;
    }
    popup.opener = null;
  }

  function serviceProposalSelectedModel() {
    return state.serviceProposalModel || 'padrao';
  }

  function serviceProposalModelName(key = serviceProposalSelectedModel()) {
    return serviceProposalDefinition(key).name || 'Proposta padrão';
  }

  function renderServiceProposalSelectedCount() {
    const target = $('service-proposal-selected-count');
    if (!target) return;
    const count = $$('#service-proposal-services input[type="checkbox"]:checked').length;
    target.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
  }

  function renderServiceProposalServices(model, data) {
    const root = $('service-proposal-services');
    if (!root) return;
    const selected = data?.selected_services || {};
    root.innerHTML = (model.sections || []).map((section) => {
      const selectedIds = new Set(Array.isArray(selected[section.id]) ? selected[section.id] : []);
      const services = (section.services || []).map((service) => `
        <label class="service-proposal-check">
          <input type="checkbox" data-service-proposal-section="${escapeHtml(section.id)}" data-service-proposal-service="${escapeHtml(service.id)}" ${selectedIds.has(service.id) ? 'checked' : ''} />
          <span>${escapeHtml(service.label)}</span>
        </label>`).join('');
      return `<section class="service-proposal-section" data-service-proposal-section-card="${escapeHtml(section.id)}">
        <header class="service-proposal-section-header">
          <strong>${escapeHtml(section.title)}</strong>
          <button type="button" data-service-proposal-toggle-section="${escapeHtml(section.id)}">Marcar todos</button>
        </header>
        <div class="service-proposal-check-list">${services}</div>
      </section>`;
    }).join('');
    renderServiceProposalSelectedCount();
  }

  function renderServiceProposalValues(model, data) {
    const root = $('service-proposal-values');
    if (!root) return;
    const values = data?.values || {};
    root.innerHTML = (model.values || []).map((value) => `
      <div class="service-proposal-value-card">
        <label for="service-proposal-value-${escapeHtml(value.id)}">${escapeHtml(value.label)}</label>
        <div class="service-proposal-value-input">
          <span>R$</span>
          <input id="service-proposal-value-${escapeHtml(value.id)}" type="text" inputmode="decimal" data-service-proposal-value="${escapeHtml(value.id)}" value="${escapeHtml(inputMoney(values[value.id] ?? value.default ?? 0))}" />
        </div>
      </div>`).join('');
  }

  function renderServiceProposal(modelKey = serviceProposalSelectedModel(), data = null) {
    const safeKey = SERVICE_PROPOSAL_MODELS[modelKey] ? modelKey : 'padrao';
    const model = serviceProposalDefinition(safeKey);
    const defaults = defaultServiceProposalData(safeKey);
    const incoming = data && typeof data === 'object' ? data : {};
    const normalized = {
      ...defaults,
      ...incoming,
      selected_services: { ...(defaults.selected_services || {}), ...(incoming.selected_services || {}) },
      values: { ...(defaults.values || {}), ...(incoming.values || {}) },
    };
    state.serviceProposalModel = safeKey;
    state.serviceProposalData = normalized;

    $$('[data-service-proposal-model]').forEach((button) => {
      button.classList.toggle('active', button.dataset.serviceProposalModel === safeKey);
      button.setAttribute('aria-pressed', button.dataset.serviceProposalModel === safeKey ? 'true' : 'false');
    });

    const standard = safeKey === 'padrao';
    $('service-proposal-standard-note')?.classList.toggle('is-hidden', !standard);
    $('service-proposal-editor')?.classList.toggle('is-hidden', standard);
    if (standard) {
      renderPreviewIfVisible();
      return;
    }

    if ($('service-proposal-editor-title')) $('service-proposal-editor-title').textContent = model.name;
    if ($('service-proposal-editor-description')) $('service-proposal-editor-description').textContent = model.description || '';
    if ($('service-proposal-introduction')) $('service-proposal-introduction').value = normalized.introduction ?? model.introduction ?? '';
    if ($('service-proposal-conditions')) $('service-proposal-conditions').value = normalized.conditions ?? model.conditions ?? '';
    if ($('service-proposal-notes')) $('service-proposal-notes').value = normalized.notes || '';
    renderServiceProposalServices(model, normalized);
    renderServiceProposalValues(model, normalized);
    renderPreviewIfVisible();
  }

  function collectServiceProposalData() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return {};
    const model = serviceProposalDefinition(key);
    const selectedServices = {};
    (model.sections || []).forEach((section) => {
      selectedServices[section.id] = $$(`input[data-service-proposal-section="${CSS.escape(section.id)}"]:checked`, $('service-proposal-services'))
        .map((input) => input.dataset.serviceProposalService)
        .filter(Boolean);
    });
    const values = {};
    $$('[data-service-proposal-value]', $('service-proposal-values')).forEach((input) => {
      values[input.dataset.serviceProposalValue] = parseNumber(input.value);
    });
    return {
      introduction: $('service-proposal-introduction')?.value?.trim() || '',
      selected_services: selectedServices,
      values,
      conditions: $('service-proposal-conditions')?.value?.trim() || '',
      notes: $('service-proposal-notes')?.value?.trim() || '',
    };
  }

  function syncServiceProposalStateFromForm() {
    state.serviceProposalData = collectServiceProposalData();
    renderServiceProposalSelectedCount();
    renderPreviewIfVisible();
  }

  function applyServiceProposalModel(modelKey, { preserveDocumentName = false, markDirty = true } = {}) {
    const safeKey = SERVICE_PROPOSAL_MODELS[modelKey] ? modelKey : 'padrao';
    const model = serviceProposalDefinition(safeKey);
    const data = defaultServiceProposalData(safeKey);
    renderServiceProposal(safeKey, data);
    if (!preserveDocumentName && $('orcamento-nome-documento')) {
      $('orcamento-nome-documento').value = safeKey === 'padrao'
        ? (state.meta.configuracao?.nome_documento || 'Orçamento')
        : (model.documentName || 'Proposta Comercial');
    }
    if (safeKey !== 'padrao' && $('orcamento-titulo') && !$('orcamento-titulo').value.trim()) {
      $('orcamento-titulo').value = model.name;
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = model.name;
    }
    if (markDirty) markBudgetDirty();
  }

  async function resetCurrentServiceProposal() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return;
    const ok = await budgetConfirm({
      title: 'Restaurar modelo',
      message: 'Restaurar os serviços, textos e valores padrão deste modelo? As personalizações feitas nesta proposta serão perdidas.',
      confirmText: 'Restaurar modelo',
      cancelText: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;
    applyServiceProposalModel(key, { preserveDocumentName: true, markDirty: true });
    toast('Modelo restaurado para o padrão.');
  }

  function toggleServiceProposalSection(sectionId) {
    const inputs = $$(`input[data-service-proposal-section="${CSS.escape(sectionId)}"]`, $('service-proposal-services'));
    if (!inputs.length) return;
    const allChecked = inputs.every((input) => input.checked);
    inputs.forEach((input) => { input.checked = !allChecked; });
    const button = $('service-proposal-services')?.querySelector(`[data-service-proposal-toggle-section="${CSS.escape(sectionId)}"]`);
    if (button) button.textContent = allChecked ? 'Marcar todos' : 'Desmarcar todos';
    markBudgetDirty();
    syncServiceProposalStateFromForm();
  }

  function serviceProposalPreviewHtml() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return '';
    const model = serviceProposalDefinition(key);
    const data = collectServiceProposalData();
    const selected = data.selected_services || {};
    const sectionsHtml = (model.sections || []).map((section) => {
      const selectedIds = new Set(Array.isArray(selected[section.id]) ? selected[section.id] : []);
      const items = (section.services || []).filter((service) => selectedIds.has(service.id));
      if (!items.length) return '';
      return `<section class="preview-service-proposal-section"><h5>${escapeHtml(section.title)}</h5><ul>${items.map((service) => `<li>${escapeHtml(service.label)}</li>`).join('')}</ul></section>`;
    }).filter(Boolean).join('');
    const valuesHtml = (model.values || []).map((value) => {
      const amount = parseNumber(data.values?.[value.id] || 0);
      return `<div class="preview-service-proposal-value"><span>${escapeHtml(value.label)}</span><strong>${formatMoney(amount)}</strong></div>`;
    }).join('');
    const intro = data.introduction ? `<div class="preview-service-proposal-intro"><h4>${escapeHtml(model.name)}</h4><p>${escapeHtml(data.introduction)}</p></div>` : '';
    const conditions = data.conditions ? `<div class="preview-service-proposal-note"><h5>Condições gerais</h5><p>${escapeHtml(data.conditions)}</p></div>` : '';
    const notes = data.notes ? `<div class="preview-service-proposal-note"><h5>Observações adicionais</h5><p>${escapeHtml(data.notes)}</p></div>` : '';
    return `<section class="preview-service-proposal">${intro}${sectionsHtml ? `<div class="preview-service-proposal-grid">${sectionsHtml}</div>` : ''}${valuesHtml ? `<div class="preview-service-proposal-values">${valuesHtml}</div>` : ''}${conditions}${notes}</section>`;
  }


  function isNilsonServiceProposalModel(key = serviceProposalSelectedModel()) {
    return NILSON_PROPOSAL_MODELS.has(String(key || ''));
  }

  function proposalMoneyWordsPtBr(value) {
    const totalCents = Math.max(0, Math.round((parseNumber(value) + Number.EPSILON) * 100));
    const reais = Math.floor(totalCents / 100);
    const centavos = totalCents % 100;

    const ate999 = (n) => {
      const unidades = ['', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove'];
      const especiais = ['Dez', 'Onze', 'Doze', 'Treze', 'Quatorze', 'Quinze', 'Dezesseis', 'Dezessete', 'Dezoito', 'Dezenove'];
      const dezenas = ['', '', 'Vinte', 'Trinta', 'Quarenta', 'Cinquenta', 'Sessenta', 'Setenta', 'Oitenta', 'Noventa'];
      const centenas = ['', 'Cento', 'Duzentos', 'Trezentos', 'Quatrocentos', 'Quinhentos', 'Seiscentos', 'Setecentos', 'Oitocentos', 'Novecentos'];
      n = Math.floor(n);
      if (n === 0) return '';
      if (n === 100) return 'Cem';
      const parts = [];
      if (n >= 100) {
        parts.push(centenas[Math.floor(n / 100)]);
        n %= 100;
      }
      if (n >= 10 && n < 20) {
        parts.push(especiais[n - 10]);
        n = 0;
      } else if (n >= 20) {
        parts.push(dezenas[Math.floor(n / 10)]);
        n %= 10;
      }
      if (n > 0) parts.push(unidades[n]);
      return parts.filter(Boolean).join(' e ');
    };

    const inteiro = (n) => {
      n = Math.floor(n);
      if (n === 0) return 'Zero';
      const grupos = [
        { divisor: 1000000000, singular: 'Bilhão', plural: 'Bilhões' },
        { divisor: 1000000, singular: 'Milhão', plural: 'Milhões' },
        { divisor: 1000, singular: 'Mil', plural: 'Mil' },
      ];
      const parts = [];
      let resto = n;
      grupos.forEach((group) => {
        if (resto < group.divisor) return;
        const quantidade = Math.floor(resto / group.divisor);
        resto %= group.divisor;
        if (group.divisor === 1000) {
          parts.push(quantidade === 1 ? 'Mil' : `${ate999(quantidade)} Mil`);
        } else {
          parts.push(`${ate999(quantidade)} ${quantidade === 1 ? group.singular : group.plural}`);
        }
      });
      if (resto) parts.push(ate999(resto));
      return parts.join(' e ');
    };

    const reaisText = `${inteiro(reais)} ${reais === 1 ? 'Real' : 'Reais'}`;
    if (!centavos) return reaisText;
    return `${reaisText} e ${inteiro(centavos)} ${centavos === 1 ? 'Centavo' : 'Centavos'}`;
  }

  function proposalMoneyReference(value) {
    return `${formatMoney(parseNumber(value))} (${proposalMoneyWordsPtBr(value)})`;
  }

  function nilsonProposalSellerData() {
    const budget = state.current || {};
    const selected = state.users.find((user) => String(user.id) === String($('orcamento-consultor')?.value || '')) || {};
    return {
      nome: selected.nome || budget.consultor_nome || state.meta?.usuario?.nome || 'Nilson',
      telefone: selected.telefone || budget.consultor_telefone || '',
    };
  }

  function nilsonProposalClientData() {
    const budget = state.current || {};
    const client = state.selectedClient || {};
    return {
      codigo: client.codigo || budget.cliente_codigo || '',
      nome: client.nome || budget.cliente_razao_social || budget.cliente_nome || $('orcamento-cliente-busca')?.value || 'Cliente não selecionado',
      telefone: client.whatsapp || client.telefone || budget.cliente_whatsapp || budget.cliente_telefone_documento || $('orcamento-contato-cliente')?.value || '',
      endereco: budgetAddress() || '—',
    };
  }

  function nilsonProposalSection(model, sectionId) {
    return (model.sections || []).find((section) => section.id === sectionId) || { id: sectionId, title: '', services: [] };
  }

  function nilsonProposalSelected(data, sectionId, serviceId) {
    const ids = Array.isArray(data.selected_services?.[sectionId]) ? data.selected_services[sectionId] : [];
    return ids.includes(serviceId);
  }

  function nilsonMonitorServicesHtml(model, data, sectionId) {
    const section = nilsonProposalSection(model, sectionId);
    return `<section class="nilson-monitor-group">
      <h3>${escapeHtml(section.title)}:</h3>
      <div class="nilson-monitor-services">
        ${(section.services || []).map((service) => `<div><b>${nilsonProposalSelected(data, section.id, service.id) ? '(X)' : '(*)'}</b><span>${escapeHtml(service.label)}</span></div>`).join('')}
      </div>
    </section>`;
  }

  function nilsonBulletServicesHtml(model, data, sectionId) {
    const section = nilsonProposalSection(model, sectionId);
    const selected = (section.services || []).filter((service) => nilsonProposalSelected(data, section.id, service.id));
    return `<ul>${selected.map((service) => `<li>${escapeHtml(service.label)}</li>`).join('')}</ul>`;
  }

  function nilsonProposalHeaderHtml(client, seller, { colorMode = 'none' } = {}) {
    const codeName = [client.codigo, client.nome].filter(Boolean).join('- ');
    const dateLabel = localDate($('orcamento-data-emissao')?.value || new Date().toISOString().slice(0, 10));
    const colorClass = colorMode === 'all' ? 'is-reference-red' : (colorMode === 'partial' ? 'is-reference-partial-red' : '');
    return `
      <header class="nilson-reference-header">
        <img src="/frontend/img/propostas/segsis-modelo-logo.png" class="nilson-reference-logo" alt="SEG">
        <div class="nilson-reference-company">
          <h1>SISTEMAS E GERENCIAMENTOS INTEGRADOS</h1>
          <strong>R. Francisco de Paula Simões, 131 - Vila Paulista - Taubaté SP 12031-050</strong>
          <div><strong>Tel. (012) 974101924 * 3633-4871* E-mail:</strong> <u>callcenter.segsis@gmail.com</u></div>
        </div>
      </header>
      <div class="nilson-reference-client-row ${colorClass}">
        <div class="nilson-reference-client-main">
          <strong><span class="nilson-reference-client-name">${escapeHtml(codeName || client.nome)}</span>${client.telefone ? `<span class="nilson-reference-client-phone">${escapeHtml(client.telefone)}</span>` : ''}</strong>
          <span>${escapeHtml(client.endereco)}</span>
        </div>
        <div class="nilson-reference-client-side">
          <strong>${escapeHtml(dateLabel)}</strong>
          <strong>${escapeHtml(seller.nome || 'Nilson')}</strong>
          <strong>${escapeHtml(seller.telefone || '')}</strong>
        </div>
      </div>`;
  }

  function nilsonProposalSignatureHtml() {
    return `
      <div class="nilson-reference-signature">
        <div class="nilson-reference-consultant">ASS. CONSULTOR: ___________________________________</div>
        <div class="nilson-reference-approval">
          <strong>APROVAÇÃO:</strong>
          <div>DATA: ____/____/____ <span>HORA: _____:_____</span></div>
          <div>_______________________________________________________________</div>
          <small>ASSINATURA CLIENTE</small>
        </div>
      </div>
      <div class="nilson-reference-site">http://www.segsis.com.br</div>`;
  }

  function nilsonProposalStyles() {
    return `<style>
      .nilson-proposal-sheet{box-sizing:border-box;width:210mm;height:297mm;min-height:297mm;margin:0 auto;padding:9mm 9.5mm 36mm;background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:8pt;line-height:1.22;position:relative;overflow:hidden}
      .nilson-proposal-sheet *{box-sizing:border-box}.nilson-reference-header{height:29mm;position:relative;display:flex;align-items:flex-start;padding-left:34mm}
      .nilson-reference-logo{position:absolute;left:3mm;top:0;width:29mm;height:29mm;object-fit:contain}
      .nilson-reference-company{width:100%;padding-top:1.5mm;text-align:center;font-family:"Times New Roman",serif}
      .nilson-reference-company h1{margin:0;font-size:16.6pt;line-height:1;font-weight:700;white-space:nowrap}
      .nilson-reference-company strong,.nilson-reference-company div{font-size:10.5pt;line-height:1.12}.nilson-reference-company u{color:#0563c1}
      .nilson-reference-client-row{height:13.5mm;border-top:.35mm solid #000;border-bottom:.35mm solid #000;display:grid;grid-template-columns:1fr 30mm;font-size:9.3pt}
      .nilson-reference-client-main{padding:1.2mm 2mm;display:flex;flex-direction:column;gap:1mm;overflow:hidden}.nilson-reference-client-main strong,.nilson-reference-client-main>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nilson-reference-client-main strong{display:flex;gap:5mm}.nilson-reference-client-name,.nilson-reference-client-phone{display:inline-block}
      .nilson-reference-client-side{border-left:.35mm solid #000;padding:.8mm 1.3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.5mm;font-size:8.5pt}
      .nilson-reference-client-row.is-reference-red .nilson-reference-client-main strong,.nilson-reference-client-row.is-reference-red .nilson-reference-client-main>span,.nilson-reference-client-row.is-reference-red .nilson-reference-client-side strong{color:#f00}.nilson-reference-client-row.is-reference-red .nilson-reference-client-main>span,.nilson-reference-client-row.is-reference-partial-red .nilson-reference-client-main>span{font-weight:700}.nilson-reference-client-row.is-reference-partial-red .nilson-reference-client-name,.nilson-reference-client-row.is-reference-partial-red .nilson-reference-client-side strong:nth-child(2){color:#f00}
      .nilson-reference-title{margin:4.2mm 0 3mm;text-align:center;font-size:12.5pt;font-weight:700}
      .nilson-reference-intro{font-size:8.2pt;line-height:1.3;text-align:justify}.nilson-reference-intro p{margin:0 0 2.2mm}.nilson-reference-intro strong{text-decoration:underline}
      .nilson-monitor-columns{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:1mm}.nilson-monitor-column{min-width:0}
      .nilson-monitor-group{margin:0 0 2.4mm}.nilson-monitor-group h3{margin:0 0 1.3mm;font-size:8.2pt;font-weight:700}.nilson-monitor-services{display:grid;gap:.65mm}
      .nilson-monitor-services>div{display:grid;grid-template-columns:7mm 1fr;gap:.3mm;font-size:7.75pt;line-height:1.2}.nilson-monitor-services b{font-weight:400}
      .nilson-reference-observations{margin-top:1.3mm;font-size:7.15pt;line-height:1.25}.nilson-reference-observations h4{margin:0 0 .8mm;font-size:7.7pt}.nilson-reference-observations div{margin:.35mm 0}
      .nilson-reference-footnotes{margin-top:2.2mm;font-size:6.35pt;line-height:1.22}.nilson-reference-footnotes div{margin:.28mm 0}
      .nilson-reference-promo{display:block;width:100%;max-height:39mm;object-fit:contain;margin-top:1.2mm}
      .nilson-reference-values{margin-top:2.7mm;font-size:9.5pt;font-weight:700}.nilson-monitor-sheet>.nilson-reference-values{position:absolute;left:9.5mm;right:9.5mm;bottom:31mm;margin:0}.nilson-reference-value{display:flex;align-items:flex-end;gap:1.5mm;margin:1.2mm 0}
      .nilson-reference-value .label{white-space:nowrap}.nilson-reference-value .dots{flex:1;border-bottom:1px dotted #000;transform:translateY(-1.2mm)}.nilson-reference-value .amount{white-space:nowrap}
      .nilson-reference-signature{position:absolute;left:9.5mm;right:9.5mm;bottom:10mm;height:18mm;border:.35mm solid #000;display:grid;grid-template-columns:44% 56%;font-size:7.4pt;font-weight:700}
      .nilson-reference-consultant{display:flex;align-items:flex-end;padding:0 2mm 4.3mm}
      .nilson-reference-approval{border-left:.35mm solid #000;padding:1.2mm 2mm;text-align:left;position:relative}.nilson-reference-approval>strong{display:block;margin-bottom:2mm}.nilson-reference-approval>div:nth-of-type(1){display:flex;justify-content:space-between;gap:5mm;text-align:left}.nilson-reference-approval>div:nth-of-type(1) span{float:none}.nilson-reference-approval>div:nth-of-type(2){margin-top:2.5mm;text-align:center}.nilson-reference-approval small{display:block;text-align:center;margin-top:.5mm;font-size:7.2pt}
      .nilson-reference-site{position:absolute;left:0;right:0;bottom:4.2mm;text-align:center;font-size:10pt}
      .nilson-tele-intro{margin:3.5mm 0 2.2mm;font-size:8.1pt;line-height:1.32;text-align:justify}.nilson-tele-intro p{margin:0 0 2.2mm}.nilson-tele-intro strong{text-decoration:underline}
      .nilson-tele-grid{display:grid;grid-template-columns:1fr 1fr;border:.35mm solid #000}.nilson-tele-box{padding:1.3mm 1.6mm;font-size:7.55pt;line-height:1.25;min-height:116mm;display:flex;flex-direction:column}.nilson-tele-box+.nilson-tele-box{border-left:.35mm solid #000}
      .nilson-tele-box h3{font-size:8pt;margin:0 0 1.5mm}.nilson-tele-box p{margin:0 0 1.7mm;text-align:justify}.nilson-tele-box h4{font-size:7.7pt;margin:0 0 1mm;text-decoration:underline}.nilson-tele-box ul{margin:0 0 2mm 5.5mm;padding-left:4mm}.nilson-tele-box li{margin:.45mm 0}
      .nilson-tele-box .nilson-reference-value{font-size:8.1pt;margin-top:auto}.nilson-tele-observations{font-size:7.2pt;margin-top:1.8mm}.nilson-tele-observations strong{display:block;margin-bottom:.8mm}.nilson-tele-observations div{margin:.35mm 0}
      .nilson-tele-general{margin:2.3mm .8mm 1.5mm;font-size:7.2pt;line-height:1.25}.nilson-tele-general h4{font-size:7.8pt;margin:0 0 1mm}.nilson-tele-general div{margin:.35mm 0}
      @page{size:A4 portrait;margin:0}
      @media print{html,body{margin:0!important;padding:0!important;background:#fff!important}.document-preview{padding:0!important;margin:0!important}.nilson-proposal-sheet{margin:0;width:210mm;min-height:297mm;box-shadow:none}}
    </style>`;
  }

  function buildNilsonMonitorProposalHtml(key, model, data, client, seller) {
    const conditions = String(data.conditions || model.conditions || '');
    const blocks = conditions.split(/\n\s*\n/);
    const observationLines = (blocks.shift() || '').split(/\r?\n/).filter(Boolean);
    const footnoteLines = blocks.join('\n').split(/\r?\n/).filter(Boolean);
    const colorMode = key === 'monitoramento_24h_comodato' ? 'all' : 'partial';
    const values = data.values || {};

    return `${nilsonProposalStyles()}
      <section class="nilson-proposal-sheet nilson-monitor-sheet">
        ${nilsonProposalHeaderHtml(client, seller, { colorMode })}
        <h2 class="nilson-reference-title">SERVIÇOS DE MONITORAMENTO 24 HORAS</h2>
        <div class="nilson-reference-intro">
          ${String(data.introduction || model.introduction || '').split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
          <strong>Serviços Oferecidos:</strong>
        </div>
        <div class="nilson-monitor-columns">
          <div class="nilson-monitor-column">
            ${nilsonMonitorServicesHtml(model, data, 'gerenciamento_padrao')}
            ${nilsonMonitorServicesHtml(model, data, 'controle_acesso')}
            ${nilsonMonitorServicesHtml(model, data, 'ocorrencias_alarme')}
            <div class="nilson-reference-observations">
              <h4>Observações:</h4>
              ${observationLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
            <div class="nilson-reference-footnotes">
              ${footnoteLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
              ${data.notes ? `<div>${escapeHtml(data.notes)}</div>` : ''}
            </div>
          </div>
          <div class="nilson-monitor-column">
            ${nilsonMonitorServicesHtml(model, data, 'servicos_apoio')}
            ${nilsonMonitorServicesHtml(model, data, 'aplicativo')}
            ${nilsonMonitorServicesHtml(model, data, 'pre_programados')}
            <img src="/frontend/img/propostas/my-security-modelo.png" class="nilson-reference-promo" alt="Aplicativo My Security">
          </div>
        </div>
        <div class="nilson-reference-values">
          <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt;&gt;&gt;&gt; VALOR IMPLANTAÇÃO (Único)</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao || 0))}</span></div>
          <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt;&gt;&gt;&gt; VALOR SERVIÇOS MONIT24HS (Mensal)</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.mensalidade || 0))}</span></div>
        </div>
        ${nilsonProposalSignatureHtml()}
      </section>`;
  }

  function buildNilsonTeleProposalHtml(model, data, client, seller) {
    const values = data.values || {};
    const conditionText = String(data.conditions || model.conditions || '');
    const split = conditionText.split(/Condições Gerais:\s*/i);
    const leftObservationLines = (split[0] || '').split(/\r?\n/).filter(Boolean);
    const generalLines = (split.slice(1).join('Condições Gerais:') || '').split(/\r?\n/).filter(Boolean);

    return `${nilsonProposalStyles()}
      <section class="nilson-proposal-sheet nilson-tele-sheet">
        ${nilsonProposalHeaderHtml(client, seller)}
        <h2 class="nilson-reference-title">SERVIÇOS DE MONITORAMENTO 24 HORAS - TELE ASSISTÊNCIA</h2>
        <div class="nilson-tele-intro">
          ${String(data.introduction || model.introduction || '').split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
          <strong>Serviços Oferecidos:</strong>
        </div>
        <div class="nilson-tele-grid">
          <section class="nilson-tele-box">
            <h3>1- Monitoramento Emergencial:</h3>
            <p>Sistema de Monitoramento Eletrônico 24 horas para Recebimentos de Eventos Emergenciais através do Acionamento de Botão de Ajuda.</p>
            <h4>Serviços:</h4>
            ${nilsonBulletServicesHtml(model, data, 'monitoramento_emergencial')}
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Implantação</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao_emergencial || 0))}</span></div>
            <div class="nilson-tele-observations">
              <strong>Observações:</strong>
              ${leftObservationLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
          </section>
          <section class="nilson-tele-box">
            <h3>2- Sistema de CFTV com Monitoramento via Aplicativo:</h3>
            <p>Sistema de CFTV composto por DVR e 04 Cameras de Alta Resolução, Full HD (1080P).</p>
            <h4>Para o Cliente:</h4>
            ${nilsonBulletServicesHtml(model, data, 'cftv_cliente')}
            <h4>Suporte Central Monitoramento:</h4>
            <p>Monitoramento 24 horas para os Eventos:</p>
            ${nilsonBulletServicesHtml(model, data, 'cftv_central')}
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Implantação</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao_cftv || 0))}</span></div>
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Mensal</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.mensalidade_cftv || 0))}</span></div>
            <div class="nilson-tele-observations">
              <strong>Observações:</strong>
              <div>1- Sistema Requer Internet Banda Larga no Imovel e Visualizado remota.</div>
              <div>2- Local Instalação Cameras: Quarto/Cozinha/Sala/Corredor</div>
            </div>
          </section>
        </div>
        <div class="nilson-tele-general">
          <h4>Condições Gerais: Observações:</h4>
          ${generalLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
          ${data.notes ? `<div>${escapeHtml(data.notes)}</div>` : ''}
        </div>
        ${nilsonProposalSignatureHtml()}
      </section>`;
  }

  function buildNilsonServiceProposalHtml() {
    const key = serviceProposalSelectedModel();
    const model = serviceProposalDefinition(key);
    const data = collectServiceProposalData();
    const client = nilsonProposalClientData();
    const seller = nilsonProposalSellerData();
    if (key === 'teleassistencia_idosos') return buildNilsonTeleProposalHtml(model, data, client, seller);
    return buildNilsonMonitorProposalHtml(key, model, data, client, seller);
  }

  function resetBudgetForm() {
    state.currentId = null;
    state.current = null;
    state.appliedTemplateId = null;
    state.items = [];
    state.payments = [];
    state.selectedClient = null;
    state.calculation = null;
    state.serviceProposalModel = 'padrao';
    state.serviceProposalData = {};
    $('form-orcamento').reset();
    $('orcamento-cliente-id').value = '';
    syncClientEditButton();
    $('orcamento-codigo').value = '';
    $('orcamento-data-solicitacao').value = today();
    $('orcamento-data-emissao').value = today();
    $('orcamento-data-validade').value = addDays(today(), state.meta.configuracao?.validade_padrao_dias || 7);
    $('orcamento-consultor').value = String(state.meta.usuario?.id || '');
    $('orcamento-nome-documento').value = state.meta.configuracao?.nome_documento || 'Orçamento';
    $('orcamento-prazo-execucao').value = state.meta.configuracao?.prazo_execucao_padrao || '';
    $('orcamento-condicoes').value = state.meta.configuracao?.condicoes_padrao || '';
    $('orcamento-observacoes').value = state.meta.configuracao?.observacoes_padrao || '';
    $('orcamento-usar-capa').checked = Boolean(state.meta.configuracao?.usar_capa);
    $('orcamento-titulo-capa').value = state.meta.configuracao?.titulo_capa || '';
    $('orcamento-subtitulo-capa').value = state.meta.configuracao?.subtitulo_capa || '';
    syncBudgetScale(companyDocumentScale(), { render: false });
    $('orcamento-desconto-tipo').value = 'valor';
    $('orcamento-desconto-valor').value = '0,00';
    $('orcamento-frete').value = '0,00';
    $('orcamento-acrescimo').value = '0,00';
    $('orcamento-status').value = 'rascunho';
    const defaultEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false) || state.emitters.find((emitter) => emitter.ativo !== false);
    if ($('orcamento-emitente-id')) $('orcamento-emitente-id').value = defaultEmitter ? String(defaultEmitter.id) : '';
    if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = 'Novo orçamento';
    if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = 'Código não gerado';
    $('btn-imprimir-orcamento').classList.add('is-hidden');
    $('btn-whatsapp-orcamento').classList.add('is-hidden');
    $('btn-gerar-link-cliente')?.classList.add('is-hidden');
    $('btn-gerar-contrato-cliente')?.classList.add('is-hidden');
    $('btn-aprovar-margem').classList.add('is-hidden');
    $('budget-financeiro-status')?.classList.add('is-hidden');
    $('btn-enviar-financeiro')?.classList.add('is-hidden');
    $('btn-cancelar-envio-financeiro')?.classList.add('is-hidden');
    $('btn-abrir-financeiro-orcamento')?.classList.add('is-hidden');
    $$('.edit-only').forEach((el) => el.classList.add('is-hidden'));
    setTab('dados');
    addDefaultPayment();
    renderItems();
    renderPayments();
    updateStatusPreview();
    updateTotals();
    renderHistory([]);
    renderServiceProposal('padrao', {});
    setBudgetDirty(false);
    closeBudgetActionsMenu();
  }

  async function openNewBudget() {
    resetBudgetForm();
    $('budget-modal-title').textContent = 'Novo orçamento';
    $('budget-modal-subtitle').textContent = 'Documento global e personalizável para sua empresa.';
    openOverlay('budget-modal');
    try {
      const result = await api(`${API}/proximo-codigo`);
      $('orcamento-codigo').value = result.codigo || '';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = result.codigo || 'Código não gerado';
      setBudgetDirty(false);
    } catch (_) {}
  }

  async function openEditBudget(id) {
    try {
      const budget = await api(`${API}/${id}`);
      state.currentId = id;
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      state.selectedClient = budget.cliente_id ? {
        id: budget.cliente_id,
        codigo: budget.cliente_codigo || '',
        nome: budget.cliente_razao_social || budget.cliente_nome,
        nome_fantasia: budget.cliente_nome_fantasia || budget.cliente_nome,
        cpf_cnpj: budget.cliente_documento,
        rg_ie: budget.cliente_rg_ie_documento,
        telefone: budget.cliente_telefone_documento,
        whatsapp: budget.cliente_whatsapp,
        fax: budget.cliente_fax_documento,
        email: budget.cliente_email,
        email_nfe: budget.cliente_email_nfe_documento,
        contato: budget.cliente_contato_documento,
      } : null;
      fillBudgetForm(budget);
      $('budget-modal-title').textContent = `Editar ${budget.codigo}`;
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = budget.titulo || 'Orçamento';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = budget.codigo || 'Código não gerado';
      $('btn-imprimir-orcamento').classList.remove('is-hidden');
      $('btn-whatsapp-orcamento').classList.remove('is-hidden');
      $('btn-gerar-link-cliente')?.classList.remove('is-hidden');
      const proposalButtonLabel = $('btn-gerar-link-cliente')?.querySelector('span');
      if (proposalButtonLabel) proposalButtonLabel.textContent = budget.publicacao_cliente?.link_ativo ? 'Link do cliente' : 'Gerar link para cliente';
      const contractEligible = budget.publicacao_cliente?.status === 'aprovado' && budget.publicacao_cliente?.cadastro_contrato?.status === 'concluido';
      $('btn-gerar-contrato-cliente')?.classList.toggle('is-hidden', !contractEligible);
      const contractTopLabel = $('btn-gerar-contrato-cliente')?.querySelector('span');
      if (contractTopLabel) contractTopLabel.textContent = budget.publicacao_cliente?.contrato?.status === 'gerado' ? 'Contrato gerado' : 'Gerar contrato';
      $$('.edit-only').forEach((el) => el.classList.remove('is-hidden'));
      syncRefreshPricesButton(budget.status);
      const canApprove = state.meta.pode_configurar && budget.aprovacao_necessaria && budget.aprovacao_status !== 'aprovado';
      $('btn-aprovar-margem').classList.toggle('is-hidden', !canApprove);
      syncFinanceiroActions(budget);
      setTab('dados');
      openOverlay('budget-modal');
      setBudgetDirty(false);
      closeBudgetActionsMenu();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function canRefreshBudgetPrices(status) {
    return !['aprovado', 'recusado', 'cancelado', 'expirado'].includes(String(status || '').toLowerCase());
  }

  function syncRefreshPricesButton(status = $('orcamento-status')?.value) {
    const button = $('btn-atualizar-precos-itens');
    if (!button) return;
    const visible = Boolean(state.currentId) && canRefreshBudgetPrices(status);
    button.classList.toggle('is-hidden', !visible);
  }

  async function refreshCurrentBudgetPrices() {
    const button = $('btn-atualizar-precos-itens');
    if (!state.currentId) {
      toast('Salve o orçamento antes de atualizar os preços.', 'error');
      return;
    }
    const status = $('orcamento-status')?.value || state.current?.status;
    if (!canRefreshBudgetPrices(status)) {
      toast('Este orçamento já está encerrado. Duplique-o para atualizar os preços.', 'error');
      return;
    }
    const linkedItems = state.items.filter((item) => Number(item.produto_id) > 0);
    if (!linkedItems.length) {
      toast('Não há produtos vinculados ao cadastro neste orçamento.', 'error');
      return;
    }
    const confirmed = await budgetConfirm({
      title: 'Atualizar preços do orçamento',
      message: `Atualizar os preços de compra e venda de ${linkedItems.length} item(ns) pela tabela atual de produtos?\n\nQuantidade, desconto, descrição e observações serão mantidos. A alteração será salva no orçamento.`,
      confirmText: 'Atualizar preços',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true, 'Atualizando...');
      const budget = await api(`${API}/${state.currentId}?atualizar_precos=true`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      fillBudgetForm(budget);
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      syncRefreshPricesButton(budget.status);

      const summary = budget.atualizacao_precos || {};
      const updated = Number(summary.itens_atualizados || 0);
      if (!updated) {
        toast('Os preços deste orçamento já estavam iguais aos da tabela atual.');
      } else {
        const sale = Number(summary.precos_venda_alterados || 0);
        const cost = Number(summary.custos_alterados || 0);
        toast(`${updated} item(ns) atualizado(s): ${sale} preço(s) de venda e ${cost} custo(s).`);
      }
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar os preços.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncRefreshPricesButton();
    }
  }

  function fillBudgetForm(budget) {
    state.appliedTemplateId = Number(budget?.modelo_id) || null;
    const emitterSelect = $('orcamento-emitente-id');
    const fallbackEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false)
      || state.emitters.find((emitter) => emitter.ativo !== false);
    if (emitterSelect && budget?.emitente_id && !Array.from(emitterSelect.options).some((option) => Number(option.value) === Number(budget.emitente_id))) {
      const label = budget.emitente_nome_documento || budget.emitente_nome_fantasia_documento || budget.emitente_razao_social_documento || 'Empresa emitente arquivada';
      emitterSelect.insertAdjacentHTML('beforeend', `<option value="${Number(budget.emitente_id)}" data-archived-emitter="true">${escapeHtml(label)} (inativa)</option>`);
    }
    const map = {
      'orcamento-codigo': budget.codigo,
      'orcamento-titulo': budget.titulo,
      'orcamento-status': budget.status,
      'orcamento-emitente-id': budget.emitente_id || fallbackEmitter?.id || '',
      'orcamento-cliente-id': budget.cliente_id || '',
      'orcamento-cliente-busca': budget.cliente_nome || '',
      'orcamento-categoria': budget.categoria_id || '',
      'orcamento-modelo': budget.modelo_id || '',
      'orcamento-data-solicitacao': String(budget.data_solicitacao || '').slice(0, 10),
      'orcamento-data-emissao': String(budget.data_emissao || '').slice(0, 10),
      'orcamento-data-validade': String(budget.data_validade || '').slice(0, 10),
      'orcamento-consultor': budget.consultor_id || '',
      'orcamento-responsavel-cliente': budget.responsavel_cliente || '',
      'orcamento-contato-cliente': budget.contato_cliente || '',
      'orcamento-cep': budget.endereco_cep || '',
      'orcamento-logradouro': budget.endereco_logradouro || '',
      'orcamento-numero': budget.endereco_numero || '',
      'orcamento-complemento': budget.endereco_complemento || '',
      'orcamento-bairro': budget.endereco_bairro || '',
      'orcamento-cidade': budget.endereco_cidade || '',
      'orcamento-estado': budget.endereco_estado || '',
      'orcamento-desconto-tipo': budget.desconto_tipo || 'valor',
      'orcamento-desconto-valor': inputMoney(budget.desconto_valor),
      'orcamento-frete': inputMoney(budget.frete),
      'orcamento-acrescimo': inputMoney(budget.acrescimo),
      'orcamento-prazo-execucao': budget.prazo_execucao || '',
      'orcamento-nome-documento': budget.nome_documento || '',
      'orcamento-condicoes': budget.condicoes || '',
      'orcamento-observacoes': budget.observacoes || '',
      'orcamento-titulo-capa': budget.titulo_capa || '',
      'orcamento-subtitulo-capa': budget.subtitulo_capa || '',
    };
    Object.entries(map).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    $('orcamento-usar-capa').checked = Boolean(budget.usar_capa);
    syncBudgetScale(budget.escala_documento ?? companyDocumentScale(), { render: false });
    syncClientEditButton();
    renderItems();
    if (!state.payments.length) addDefaultPayment();
    renderPayments();
    renderHistory(budget.historico || []);
    renderServiceProposal(budget.proposta_modelo || 'padrao', budget.proposta_comercial || {});
    updateStatusPreview();
    syncRefreshPricesButton(budget.status);
    updateTotals();
  }

  function setTab(tab) {
    state.activeTab = tab;
    $$('.budget-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.budget-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    if (tab === 'documento') renderPreview();
    if (tab === 'analise') renderAnalysis();
  }

  function updateStatusPreview() {
    const status = $('orcamento-status').value || 'rascunho';
    const [label, className] = getStatus(status);
    $('budget-status-preview').className = `budget-status ${className}`;
    $('budget-status-preview').textContent = label;
  }

  function normalizeCollection(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  }

  function clientResultMarkup(client) {
    const displayName = client.nome_fantasia || client.nome || `Cliente #${client.id}`;
    const details = [
      client.codigo ? `Cód. ${client.codigo}` : '',
      client.cpf_cnpj,
      client.whatsapp || client.telefone,
      [client.cidade, client.estado].filter(Boolean).join('/'),
    ].filter(Boolean).join(' • ');

    return `
      <button type="button" class="autocomplete-item" data-client-id="${client.id}">
        <strong>${escapeHtml(displayName)}</strong>
        <small>${escapeHtml(details || 'Cliente cadastrado')}</small>
      </button>`;
  }

  function renderClientLoadStatus() {
    const box = $('orcamento-cliente-resultados');
    box.querySelector('[data-client-load-status]')?.remove();

    if (state.clientLoading) {
      box.insertAdjacentHTML('beforeend', `
        <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
          <small><i class="fa-solid fa-spinner fa-spin"></i> Buscando mais clientes...</small>
        </div>`);
      return;
    }

    if (!state.clientResults.length) return;

    const shown = state.clientResults.length;
    const totalText = state.clientTotal ? ` de ${state.clientTotal}` : '';
    const message = state.clientHasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} clientes carregados`;

    box.insertAdjacentHTML('beforeend', `
      <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
        <small>${escapeHtml(message)}</small>
      </div>`);
  }

  function renderClientResults(clients, {
    append = false,
    emptyMessage = 'Nenhum cliente encontrado.',
  } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalized = normalizeCollection(clients);

    if (!append) box.innerHTML = '';
    else box.querySelector('[data-client-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-client-id]', box).map((item) => String(item.dataset.clientId)),
    );
    const newClients = normalized.filter((client) => !existingIds.has(String(client.id)));

    if (newClients.length) {
      box.insertAdjacentHTML('beforeend', newClients.map(clientResultMarkup).join(''));
    }

    if (!box.querySelector('[data-client-id]')) {
      box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(emptyMessage)}</small></div>`;
    } else {
      box.querySelector('.autocomplete-empty:not([data-client-load-status])')?.remove();
      renderClientLoadStatus();
    }

    box.hidden = false;
    $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
  }

  async function loadClientOptions(query = '', { append = false } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalizedQuery = String(query || '').trim();

    if (append && (state.clientLoading || !state.clientHasMore)) return;

    let version;
    let offset;

    if (append) {
      version = state.clientSearchVersion;
      offset = state.clientOffset;
      state.clientLoading = true;
      renderClientLoadStatus();
    } else {
      version = ++state.clientSearchVersion;
      offset = 0;
      state.clientQuery = normalizedQuery;
      state.clientOffset = 0;
      state.clientHasMore = false;
      state.clientTotal = 0;
      state.clientResults = [];
      state.clientLoading = true;
      box.innerHTML = '<div class="autocomplete-item autocomplete-empty"><small><i class="fa-solid fa-spinner fa-spin"></i> Carregando clientes...</small></div>';
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        limit: String(state.clientPageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_CLIENTS}?${params.toString()}`);
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;

      const clients = normalizeCollection(response);
      const knownIds = new Set(state.clientResults.map((client) => String(client.id)));
      const uniqueClients = clients.filter((client) => !knownIds.has(String(client.id)));

      state.clientResults = append
        ? [...state.clientResults, ...uniqueClients]
        : clients;
      state.clientOffset = offset + clients.length;
      state.clientTotal = Number(response?.total ?? state.clientResults.length) || state.clientResults.length;
      state.clientHasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : clients.length === state.clientPageSize;
      state.clientLoading = false;

      if (!normalizedQuery) state.clients = [...state.clientResults];

      renderClientResults(append ? uniqueClients : state.clientResults, {
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum cliente encontrado para essa busca.'
          : 'Nenhum cliente cadastrado.',
      });
    } catch (error) {
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;
      state.clientLoading = false;
      box.querySelector('[data-client-load-status]')?.remove();

      if (append && state.clientResults.length) {
        box.insertAdjacentHTML('beforeend', `
          <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
            <small>${escapeHtml(error.message)} • role novamente para tentar</small>
          </div>`);
      } else {
        box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(error.message)}</small></div>`;
      }
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }
  }

  const searchClients = debounce(() => {
    const query = $('orcamento-cliente-busca').value.trim();
    loadClientOptions(query, { append: false });
  }, 250);

  function showClientOptions() {
    const box = $('orcamento-cliente-resultados');
    const query = $('orcamento-cliente-busca').value.trim();

    if (!box.hidden && state.clientQuery === query && (state.clientResults.length || state.clientLoading)) {
      return;
    }

    loadClientOptions(query, { append: false });
  }

  function loadMoreClientsOnScroll() {
    const box = $('orcamento-cliente-resultados');
    if (box.hidden || state.clientLoading || !state.clientHasMore) return;

    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= 48) {
      loadClientOptions(state.clientQuery, { append: true });
    }
  }

  async function selectClient(id) {
    try {
      const client = await api(`${API_CLIENTS}/${id}`);
      state.selectedClient = client;
      $('orcamento-cliente-id').value = client.id;
      $('orcamento-cliente-busca').value = client.nome_fantasia || client.nome;
      $('orcamento-responsavel-cliente').value ||= client.contato || '';
      $('orcamento-contato-cliente').value ||= client.whatsapp || client.telefone || '';
      $('orcamento-cliente-resultados').hidden = true;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      syncClientEditButton();
      fillAddressFromClient(client, false);
      updateTotals();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function fillAddressFromClient(client, force = true) {
    if (!client) return;
    const address = (client.enderecos || []).find((item) => item.principal) || (client.enderecos || [])[0] || client;
    const values = {
      'orcamento-cep': address.cep || client.cep || '',
      'orcamento-logradouro': address.endereco || address.logradouro || client.endereco || '',
      'orcamento-numero': address.numero || client.numero || '',
      'orcamento-complemento': address.complemento || client.complemento || '',
      'orcamento-bairro': address.bairro || client.bairro || '',
      'orcamento-cidade': address.cidade || client.cidade || '',
      'orcamento-estado': address.estado || client.estado || '',
    };
    Object.entries(values).forEach(([id, value]) => { if (force || !$(id).value) $(id).value = value; });
  }

  function normalizeItem(item = {}) {
    const hasExplicitCostFlag = typeof item.custo_informado === 'boolean';
    const hasCostValue = item.custo_unitario !== null && item.custo_unitario !== undefined && item.custo_unitario !== '';
    return {
      id: item.id || null,
      produto_id: item.produto_id || null,
      origem: item.origem || (item.produto_id ? 'produto' : 'manual'),
      codigo: item.codigo || '',
      descricao: item.descricao || '',
      referencia: item.referencia || '',
      unidade: item.unidade || 'UN',
      quantidade: parseNumber(item.quantidade || 1),
      valor_unitario: parseNumber(item.valor_unitario),
      desconto: parseNumber(item.desconto),
      custo_unitario: hasCostValue ? parseNumber(item.custo_unitario) : null,
      custo_informado: hasExplicitCostFlag ? item.custo_informado : hasCostValue,
      observacao: item.observacao || '',
      ordem: Number(item.ordem || 0),
    };
  }

  function addManualItem(target = 'budget') {
    const item = normalizeItem({ quantidade: 1, unidade: 'UN', custo_unitario: null, custo_informado: false });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
    }
  }

  function getProductSearchState(target = 'budget') {
    if (target === 'template') return state.productSearch.template;
    if (target === 'kit') return state.productSearch.kit;
    return state.productSearch.budget;
  }

  function getProductSearchElements(target = 'budget') {
    if (target === 'template') {
      return {
        input: $('template-product-input'),
        results: $('template-product-results'),
        box: $('template-product-search'),
      };
    }
    if (target === 'kit') {
      return {
        input: $('kit-product-input'),
        results: $('kit-product-results'),
        box: $('kit-product-search'),
      };
    }

    return {
      input: $('produto-search-input'),
      results: $('produto-search-results'),
      box: $('produto-search-box'),
    };
  }

  function updateProductPickerLayoutUI() {
    const results = $('produto-search-results');
    const header = $('produto-search-list-header');
    const layout = state.productPickerLayout === 'row' ? 'row' : 'column';
    const hasProducts = Boolean(results?.querySelector('[data-product-id]'));

    if (results) {
      results.classList.toggle('is-list-layout', layout === 'row');
      results.classList.toggle('is-column-layout', layout === 'column');
      results.classList.toggle('has-results', hasProducts);
    }
    if (header) header.hidden = layout !== 'row' || !hasProducts;

    $$('[data-product-layout]').forEach((option) => {
      const active = option.dataset.productLayout === layout;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function closeProductLayoutMenu() {
    const menu = $('product-layout-menu');
    const button = $('btn-product-search-layout');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleProductLayoutMenu(force) {
    const menu = $('product-layout-menu');
    const button = $('btn-product-search-layout');
    if (!menu || !button) return;
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setProductPickerLayout(layout) {
    state.productPickerLayout = layout === 'row' ? 'row' : 'column';
    saveProductPickerLayout(state.productPickerLayout);
    updateProductPickerLayoutUI();
  }

  function renderBudgetProductSearchPrompt() {
    const results = $('produto-search-results');
    const hint = $('produto-search-hint');
    const header = $('produto-search-list-header');
    if (results) {
      results.innerHTML = '';
      results._items = [];
      results.classList.remove('has-results');
    }
    if (hint) hint.hidden = false;
    if (header) header.hidden = true;
    updateProductPickerLayoutUI();
  }

  function handleBudgetProductSearch(query) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      resetProductSearch('budget');
      renderBudgetProductSearchPrompt();
      return;
    }
    const hint = $('produto-search-hint');
    if (hint) hint.hidden = true;
    searchProducts(normalizedQuery, 'budget');
  }

  function productResultMarkup(product, target = 'budget') {
    const details = [
      product.codigo ? `Cód. ${product.codigo}` : '',
      product.categoria,
      product.unidade,
      product.estoque_atual !== null && product.estoque_atual !== undefined && product.estoque_atual !== ''
        ? `Estoque: ${product.estoque_atual}`
        : '',
    ].filter(Boolean).join(' • ');

    return `
      <button class="product-result" type="button" data-product-id="${product.id}" data-target="${target}">
        <strong>${escapeHtml(product.nome || `Produto #${product.id}`)}</strong>
        <span>${escapeHtml(details || product.descricao || 'Produto cadastrado')}</span>
        <em>${formatMoney(product.preco_venda)}</em>
      </button>`;
  }

  function renderProductLoadStatus(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    results.querySelector('[data-product-load-status]')?.remove();

    if (searchState.loading) {
      results.insertAdjacentHTML('beforeend', `
        <div class="product-load-status" data-product-load-status>
          <i class="fa-solid fa-spinner fa-spin"></i> Buscando mais produtos...
        </div>`);
      return;
    }

    if (!searchState.results.length) return;

    const shown = searchState.results.length;
    const totalText = searchState.total ? ` de ${searchState.total}` : '';
    const message = searchState.hasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} produtos carregados`;

    results.insertAdjacentHTML('beforeend', `
      <div class="product-load-status" data-product-load-status>
        ${escapeHtml(message)}
      </div>`);
  }

  function renderProductResults(products, {
    target = 'budget',
    append = false,
    emptyMessage = 'Nenhum produto encontrado.',
  } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalized = normalizeCollection(products);

    if (!append) results.innerHTML = '';
    else results.querySelector('[data-product-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-product-id]', results).map((item) => String(item.dataset.productId)),
    );
    const newProducts = normalized.filter((product) => !existingIds.has(String(product.id)));

    if (newProducts.length) {
      results.insertAdjacentHTML('beforeend', newProducts.map((product) => productResultMarkup(product, target)).join(''));
    }

    if (!results.querySelector('[data-product-id]')) {
      results.innerHTML = `<div class="product-empty">${escapeHtml(emptyMessage)}</div>`;
    } else {
      results.querySelector('.product-empty')?.remove();
      renderProductLoadStatus(target);
    }

    results._items = [...searchState.results];

    if (target === 'budget') {
      const hint = $('produto-search-hint');
      if (hint) hint.hidden = true;
      updateProductPickerLayoutUI();
    }
  }

  async function loadProductOptions(query = '', target = 'budget', { append = false } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalizedQuery = String(query || '').trim();

    if (append && (searchState.loading || !searchState.hasMore)) return;

    let version;
    let offset;

    if (append) {
      version = searchState.version;
      offset = searchState.offset;
      searchState.loading = true;
      renderProductLoadStatus(target);
    } else {
      version = ++searchState.version;
      offset = 0;
      searchState.query = normalizedQuery;
      searchState.offset = 0;
      searchState.hasMore = false;
      searchState.total = 0;
      searchState.results = [];
      searchState.loading = true;
      if (target === 'budget') {
        const hint = $('produto-search-hint');
        if (hint) hint.hidden = true;
      }
      results.innerHTML = '<div class="product-empty"><i class="fa-solid fa-spinner fa-spin"></i> Carregando produtos...</div>';
      if (target === 'budget') updateProductPickerLayoutUI();
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        ativo: 'true',
        limit: String(searchState.pageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_BUDGET_PRODUCTS}?${params.toString()}`);
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;

      const products = normalizeCollection(response);
      const knownIds = new Set(searchState.results.map((product) => String(product.id)));
      const uniqueProducts = products.filter((product) => !knownIds.has(String(product.id)));

      searchState.results = append
        ? [...searchState.results, ...uniqueProducts]
        : products;
      searchState.offset = offset + products.length;
      searchState.total = Number(response?.total ?? searchState.results.length) || searchState.results.length;
      searchState.hasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : products.length === searchState.pageSize;
      searchState.loading = false;

      renderProductResults(append ? uniqueProducts : searchState.results, {
        target,
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum produto encontrado para essa busca.'
          : 'Nenhum produto cadastrado.',
      });
    } catch (error) {
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;
      searchState.loading = false;
      results.querySelector('[data-product-load-status]')?.remove();

      if (append && searchState.results.length) {
        results.insertAdjacentHTML('beforeend', `
          <div class="product-load-status product-load-error" data-product-load-status>
            ${escapeHtml(error.message)} • role novamente para tentar
          </div>`);
      } else {
        results.innerHTML = `<div class="product-empty">${escapeHtml(error.message)}</div>`;
      }
    }
  }

  function searchProducts(query, target = 'budget') {
    return loadProductOptions(query, target, { append: false });
  }

  function showProductOptions(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { input } = getProductSearchElements(target);
    const query = input.value.trim();

    if (searchState.query === query && (searchState.results.length || searchState.loading)) return;
    loadProductOptions(query, target, { append: false });
  }

  function loadMoreProductsOnScroll(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    if (searchState.loading || !searchState.hasMore) return;

    const distanceFromBottom = results.scrollHeight - results.scrollTop - results.clientHeight;
    if (distanceFromBottom <= 56) {
      loadProductOptions(searchState.query, target, { append: true });
    }
  }

  function resetProductSearch(target = 'budget', { reload = false } = {}) {
    const searchState = getProductSearchState(target);
    const { input, results } = getProductSearchElements(target);
    input.value = '';
    searchState.version += 1;
    searchState.results = [];
    searchState.offset = 0;
    searchState.hasMore = false;
    searchState.loading = false;
    searchState.query = '';
    searchState.total = 0;
    results._items = [];
    results.innerHTML = '';
    if (reload) loadProductOptions('', target, { append: false });
  }

  function addProduct(id, target = 'budget') {
    const searchState = getProductSearchState(target);
    const product = searchState.results.find((item) => Number(item.id) === Number(id));
    if (!product) return;
    const item = normalizeItem({
      produto_id: product.id,
      origem: 'produto',
      codigo: product.codigo,
      descricao: product.nome,
      referencia: product.descricao || '',
      unidade: product.unidade || 'UN',
      quantidade: 1,
      valor_unitario: product.preco_venda,
      custo_unitario: product.custo ?? null,
      custo_informado: product.custo !== null && product.custo !== undefined && product.custo !== '',
    });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
      resetProductSearch('template', { reload: true });
    } else if (target === 'kit') {
      const existing = state.kitItems.find((current) => Number(current.produto_id) === Number(item.produto_id));
      if (existing) existing.quantidade = parseNumber(existing.quantidade) + 1;
      else state.kitItems.push(item);
      renderKitItems();
      resetProductSearch('kit', { reload: true });
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
      resetProductSearch('budget');
      renderBudgetProductSearchPrompt();
      $('produto-search-input')?.focus();
    }
  }

  function normalizedProductCode(value) {
    return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  }

  async function productByExactCode(code) {
    const normalized = String(code ?? '').trim();
    if (!normalized) return null;
    const params = new URLSearchParams({ codigo_exato: normalized, limit: '1', offset: '0' });
    const response = await api(`${API_BUDGET_PRODUCTS}?${params.toString()}`);
    return normalizeCollection(response)[0] || null;
  }

  async function replaceBudgetItemByCode(input) {
    const row = input?.closest('tr[data-index]');
    const index = Number(row?.dataset.index);
    const item = state.items[index];
    if (!row || !item || input.dataset.codeResolving === '1') return;

    const requestedCode = String(input.value || '').trim();
    const originalCode = String(input.dataset.originalCode ?? item.codigo ?? '').trim();
    const originalProductId = Number(input.dataset.originalProductId || item.produto_id || 0) || null;

    if (!requestedCode) {
      input.value = originalCode;
      item.codigo = originalCode;
      toast('Informe um código de produto válido para fazer a troca.', 'error');
      return;
    }

    if (normalizedProductCode(requestedCode) === normalizedProductCode(originalCode)) {
      item.codigo = requestedCode;
      return;
    }

    input.dataset.codeResolving = '1';
    input.disabled = true;
    row.classList.add('is-resolving-product-code');

    try {
      const product = await productByExactCode(requestedCode);
      if (state.items[index] !== item) return;
      if (!product) {
        throw new Error(`Nenhum produto ativo foi encontrado com o código ${requestedCode}.`);
      }

      const quantity = item.quantidade;
      const discount = item.desconto;
      const observation = item.observacao;
      const budgetItemId = item.id;

      const replacement = normalizeItem({
        id: budgetItemId,
        produto_id: product.id,
        origem: 'produto',
        codigo: product.codigo,
        descricao: product.nome,
        referencia: product.descricao || '',
        unidade: product.unidade || 'UN',
        quantidade: quantity,
        valor_unitario: product.preco_venda,
        desconto: discount,
        custo_unitario: product.custo ?? null,
        custo_informado: product.custo !== null && product.custo !== undefined && product.custo !== '',
        observacao: observation,
        ordem: index,
      });

      state.items[index] = replacement;
      renderItems();
      updateTotals();
      toast(`Item ${index + 1} alterado para ${product.codigo || requestedCode} — ${product.nome || 'produto'}.`);
    } catch (error) {
      if (state.items[index] !== item) return;
      item.codigo = originalCode;
      item.produto_id = originalProductId;
      input.disabled = false;
      input.value = originalCode;
      row.classList.remove('is-resolving-product-code');
      input.dataset.codeResolving = '0';
      toast(error.message || 'Não foi possível trocar o produto pelo código informado.', 'error');
    }
  }

  function itemTotal(item) {
    return Math.max(item.quantidade * item.valor_unitario - item.desconto, 0);
  }

  function renderItems() {
    const tbody = $('budget-items-body');
    $('budget-items-empty').style.display = state.items.length ? 'none' : 'flex';
    tbody.innerHTML = state.items.map((item, index) => `
      <tr data-index="${index}">
        <td class="item-order-cell">
          <div class="item-order-control">
            <span>${index + 1}</span>
            <div class="item-order-buttons">
              <button type="button" data-move-item="${index}" data-move-direction="-1" title="Subir item" aria-label="Subir item ${index + 1}" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
              <button type="button" data-move-item="${index}" data-move-direction="1" title="Descer item" aria-label="Descer item ${index + 1}" ${index === state.items.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
            </div>
          </div>
        </td>
        <td><textarea data-field="descricao" placeholder="Descrição do produto ou serviço">${escapeHtml(item.descricao)}</textarea><input data-field="referencia" value="${escapeHtml(item.referencia)}" placeholder="Referência/detalhe (opcional)" /></td>
        <td>
          <input
            class="budget-item-code-input"
            data-field="codigo"
            value="${escapeHtml(item.codigo)}"
            autocomplete="off"
            spellcheck="false"
            title="Altere o código e saia do campo para trocar este produto"
            aria-label="Código do item ${index + 1}"
          />
          <small class="budget-item-code-help">Digite outro código para trocar</small>
        </td>
        <td><input data-field="unidade" value="${escapeHtml(item.unidade)}" /></td>
        <td><input data-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td><input data-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" inputmode="decimal" /></td>
        <td><input data-field="desconto" value="${inputMoney(item.desconto)}" inputmode="decimal" /></td>
        <td class="item-total-cell">${formatMoney(itemTotal(item))}</td>
        <td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}"><input data-field="custo_unitario" value="${item.custo_unitario === null ? '' : inputMoney(item.custo_unitario)}" inputmode="decimal" placeholder="Não informado" /></td>
        <td><button class="item-remove" type="button" data-remove-item="${index}" title="Remover"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`).join('');
  }

  function moveBudgetItem(index, direction) {
    const currentIndex = Number(index);
    const targetIndex = currentIndex + Number(direction);
    if (
      !Number.isInteger(currentIndex)
      || !Number.isInteger(targetIndex)
      || currentIndex < 0
      || targetIndex < 0
      || currentIndex >= state.items.length
      || targetIndex >= state.items.length
    ) return;

    const [item] = state.items.splice(currentIndex, 1);
    state.items.splice(targetIndex, 0, item);
    renderItems();
    updateTotals();
  }

  function updateItemField(input) {
    const row = input.closest('tr');
    const item = state.items[Number(row.dataset.index)];
    if (!item) return;
    const field = input.dataset.field;
    if (field === 'custo_unitario') {
      item.custo_unitario = String(input.value || '').trim() === '' ? null : parseNumber(input.value);
      item.custo_informado = item.custo_unitario !== null;
    } else {
      item[field] = ['quantidade', 'valor_unitario', 'desconto'].includes(field) ? parseNumber(input.value) : input.value;
    }
    const totalCell = row.querySelector('.item-total-cell');
    if (totalCell) totalCell.textContent = formatMoney(itemTotal(item));
    updateTotals();
  }

  function normalizePayment(payment = {}) {
    return {
      tipo: payment.tipo || 'personalizado',
      nome: payment.nome || 'Nova condição',
      descricao: payment.descricao || '',
      desconto_percentual: parseNumber(payment.desconto_percentual),
      entrada_percentual: parseNumber(payment.entrada_percentual),
      entrada_valor: parseNumber(payment.entrada_valor),
      parcelas: Math.max(Number(payment.parcelas || 1), 1),
      juros_percentual: parseNumber(payment.juros_percentual),
      valor_parcela: parseNumber(payment.valor_parcela),
      total: parseNumber(payment.total),
      selecionada: Boolean(payment.selecionada),
    };
  }

  function addDefaultPayment() {
    const defaults = (state.meta.configuracao?.formas_pagamento || []).filter((option) => option.ativo !== false);
    const first = defaults[0] || { tipo: 'avista', nome: 'À vista' };
    state.payments = [normalizePayment({ ...first, selecionada: true })];
  }

  function renderPayments() {
    const container = $('payment-options');
    if (!state.payments.length) addDefaultPayment();
    container.innerHTML = state.payments.map((payment, index) => `
      <article class="payment-option" data-payment-index="${index}">
        <div class="payment-option-head">
          <input type="radio" name="payment-selected" data-payment-field="selecionada" ${payment.selecionada ? 'checked' : ''} title="Destacar no orçamento" />
          <input class="payment-name" data-payment-field="nome" value="${escapeHtml(payment.nome)}" placeholder="Nome da condição" />
          <button class="payment-remove" type="button" data-remove-payment="${index}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="payment-option-grid">
          <div><label>Tipo</label><select data-payment-field="tipo"><option value="avista" ${payment.tipo === 'avista' ? 'selected' : ''}>À vista</option><option value="entrada_parcelas" ${payment.tipo === 'entrada_parcelas' ? 'selected' : ''}>Entrada + parcelas</option><option value="cartao" ${payment.tipo === 'cartao' ? 'selected' : ''}>Cartão</option><option value="pix" ${payment.tipo === 'pix' ? 'selected' : ''}>PIX</option><option value="boleto" ${payment.tipo === 'boleto' ? 'selected' : ''}>Boleto</option><option value="personalizado" ${payment.tipo === 'personalizado' ? 'selected' : ''}>Personalizado</option></select></div>
          <div><label>Desconto %</label><input data-payment-field="desconto_percentual" value="${inputMoney(payment.desconto_percentual)}" /></div>
          <div><label>Entrada %</label><input data-payment-field="entrada_percentual" value="${inputMoney(payment.entrada_percentual)}" /></div>
          <div><label>Parcelas</label><input type="number" min="1" data-payment-field="parcelas" value="${payment.parcelas}" /></div>
          <div><label>Juros %</label><input data-payment-field="juros_percentual" value="${inputMoney(payment.juros_percentual)}" /></div>
        </div>
        <div class="form-group" style="margin-top:10px"><label>Descrição complementar</label><input data-payment-field="descricao" value="${escapeHtml(payment.descricao)}" placeholder="Ex.: Entrada no aceite e saldo em 30/60 dias" /></div>
      </article>`).join('');
    recalculatePayments();
  }

  function updatePaymentField(input) {
    const card = input.closest('[data-payment-index]');
    const payment = state.payments[Number(card.dataset.paymentIndex)];
    const field = input.dataset.paymentField;
    if (field === 'selecionada') {
      state.payments.forEach((item, index) => { item.selecionada = index === Number(card.dataset.paymentIndex); });
    } else if (['desconto_percentual', 'entrada_percentual', 'juros_percentual'].includes(field)) {
      payment[field] = parseNumber(input.value);
    } else if (field === 'parcelas') payment.parcelas = Math.max(Number(input.value || 1), 1);
    else payment[field] = input.value;
    recalculatePayments();
    renderPreviewIfVisible();
  }

  function recalculatePayments() {
    const total = calculateTotals().total;
    state.payments.forEach((payment) => {
      const discounted = total * (1 - payment.desconto_percentual / 100);
      const withInterest = discounted * (1 + payment.juros_percentual / 100);
      payment.total = Math.max(withInterest, 0);
      payment.entrada_valor = payment.total * payment.entrada_percentual / 100;
      payment.valor_parcela = Math.max((payment.total - payment.entrada_valor) / Math.max(payment.parcelas, 1), 0);
    });
  }

  function calculateTotals() {
    const subtotal = state.items.reduce((sum, item) => sum + itemTotal(item), 0);
    const type = $('orcamento-desconto-tipo').value;
    const discountInput = Math.max(parseNumber($('orcamento-desconto-valor').value), 0);
    const discount = type === 'percentual' ? Math.min(subtotal * discountInput / 100, subtotal) : Math.min(discountInput, subtotal);
    const freight = Math.max(parseNumber($('orcamento-frete').value), 0);
    const addition = Math.max(parseNumber($('orcamento-acrescimo').value), 0);
    const total = Math.max(subtotal - discount + freight + addition, 0);
    const cost = state.items.reduce((sum, item) => sum + item.quantidade * parseNumber(item.custo_unitario), 0);
    const profit = total - cost;
    const margin = total > 0 ? profit / total * 100 : 0;
    return { subtotal, discount, freight, addition, total, cost, profit, margin };
  }

  function applyAnalysisResult(result) {
    if (!result || !canShowCosts()) return;
    state.calculation = result;
    $('analysis-sale').textContent = formatMoney(result.total);
    $('analysis-cost').textContent = formatMoney(result.custo_total);
    $('analysis-profit').textContent = formatMoney(result.lucro_total);
    $('analysis-margin').textContent = formatPercent(result.margem_percentual);
    const missing = Number(result.itens_sem_custo || 0);
    $('missing-cost-alert')?.classList.toggle('is-hidden', missing === 0);
    if ($('missing-cost-title')) $('missing-cost-title').textContent = missing === 1 ? '1 item está sem custo informado' : `${missing} itens estão sem custo informado`;
    const minMargin = parseNumber(state.meta.configuracao?.margem_minima);
    const alert = Boolean(state.meta.configuracao?.exigir_aprovacao_margem) && parseNumber(result.margem_percentual) < minMargin;
    $('margin-alert').classList.toggle('is-hidden', !alert);
    renderAnalysis();
  }

  function scheduleServerCalculation() {
    if (!canShowCosts()) return;
    clearTimeout(state.calculationTimer);
    const version = ++state.calculationVersion;
    state.calculationTimer = setTimeout(async () => {
      try {
        const payload = collectBudgetPayload();
        const result = await api(`${API}/calcular`, { method: 'POST', body: JSON.stringify(payload) });
        if (version !== state.calculationVersion) return;
        applyAnalysisResult(result);
      } catch (error) {
        if (version !== state.calculationVersion) return;
        console.warn('[orcamentos] cálculo financeiro:', error);
      }
    }, 260);
  }

  function updateTotals() {
    state.calculation = null;
    const totals = calculateTotals();
    $('summary-subtotal').textContent = formatMoney(totals.subtotal);
    $('summary-desconto').textContent = formatMoney(totals.discount);
    $('summary-total').textContent = formatMoney(totals.total);
    $('footer-total').textContent = formatMoney(totals.total);
    if ($('budget-sidebar-total')) $('budget-sidebar-total').textContent = formatMoney(totals.total);
    if (!state.calculation) {
      $('analysis-sale').textContent = formatMoney(totals.total);
      $('analysis-cost').textContent = formatMoney(totals.cost);
      $('analysis-profit').textContent = formatMoney(totals.profit);
      $('analysis-margin').textContent = formatPercent(totals.margin);
    }
    recalculatePayments();
    renderAnalysis();
    renderPreviewIfVisible();
    scheduleServerCalculation();
  }

  function currentAnalysisItems() {
    return state.calculation?.itens || state.items.map((item) => {
      const sale = itemTotal(item);
      const cost = item.quantidade * parseNumber(item.custo_unitario);
      const profit = sale - cost;
      return { ...item, valor_total: sale, custo_total: cost, lucro_total: profit, margem_percentual: sale > 0 ? profit / sale * 100 : 0 };
    });
  }

  function renderAnalysis() {
    const tbody = $('analysis-items-body');
    const items = currentAnalysisItems();
    tbody.innerHTML = items.map((item) => {
      const costKnown = item.custo_informado !== false;
      return `<tr><td>${escapeHtml(item.descricao || 'Item sem descrição')}</td><td class="text-right">${formatMoney(item.valor_total)}</td><td class="text-right ${costKnown ? '' : 'analysis-missing-cost'}">${costKnown ? formatMoney(item.custo_total) : 'Não informado'}</td><td class="text-right">${costKnown ? formatMoney(item.lucro_total) : '—'}</td><td class="text-right">${costKnown ? formatPercent(item.margem_percentual) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty-state">Nenhum item.</td></tr>';
  }


  function paymentDescription(payment) {
    const parts = [];
    if (payment.desconto_percentual > 0) parts.push(`${formatPercent(payment.desconto_percentual)} de desconto`);
    if (payment.entrada_percentual > 0) parts.push(`entrada de ${formatPercent(payment.entrada_percentual)} (${formatMoney(payment.entrada_valor)})`);
    if (payment.parcelas > 1) parts.push(`${payment.parcelas} parcelas de ${formatMoney(payment.valor_parcela)}`);
    if (payment.juros_percentual > 0) parts.push(`juros de ${formatPercent(payment.juros_percentual)}`);
    if (payment.descricao) parts.push(payment.descricao);
    return parts.join(' • ') || `Total: ${formatMoney(payment.total)}`;
  }

  function companyAddress() {
    const company = state.company || {};
    return [company.rua || company.endereco, company.numero, company.complemento, company.cidade, company.estado, company.cep].filter(Boolean).join(', ');
  }

  function budgetAddress() {
    return [
      $('orcamento-logradouro').value,
      $('orcamento-numero').value,
      $('orcamento-complemento').value,
      $('orcamento-bairro').value,
      $('orcamento-cidade').value,
      $('orcamento-estado').value,
      $('orcamento-cep').value,
    ].filter(Boolean).join(', ');
  }

  function buildStandardPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const color = state.meta.configuracao?.cor_primaria || '#65ACDE';
    const documentName = $('orcamento-nome-documento').value || state.meta.configuracao?.nome_documento || 'Orçamento';
    const code = $('orcamento-codigo').value || 'Prévia';
    const title = $('orcamento-titulo').value || 'Orçamento comercial';
    const clientName = $('orcamento-cliente-busca').value || 'Cliente não selecionado';
    const logo = company.logo ? `<img src="${escapeHtml(company.logo)}" alt="Logo">` : '';
    const rows = state.items.map((item, index) => `
      <tr>
        ${state.meta.configuracao?.mostrar_codigo !== false ? `<td>${escapeHtml(item.codigo || String(index + 1).padStart(4, '0'))}</td>` : ''}
        <td><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td style="text-align:center">${inputMoney(item.quantidade)}</td>
        <td style="text-align:center">${escapeHtml(item.unidade)}</td>
        <td style="text-align:right">${formatMoney(item.valor_unitario)}</td>
        <td style="text-align:right">${formatMoney(itemTotal(item))}</td>
      </tr>`).join('');
    const payments = state.payments.map((payment) => `<li><strong>${escapeHtml(payment.nome)}</strong>: ${escapeHtml(paymentDescription(payment))}</li>`).join('');
    const itemsAndSummary = state.items.length ? `
      <table class="preview-items"><thead><tr>${state.meta.configuracao?.mostrar_codigo !== false ? '<th>Código</th>' : ''}<th>Descrição</th><th style="text-align:center">Qtd.</th><th style="text-align:center">Un.</th><th style="text-align:right">Unitário</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="preview-summary"><div class="preview-summary-row"><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong></div>${totals.discount > 0 ? `<div class="preview-summary-row"><span>Desconto</span><strong>-${formatMoney(totals.discount)}</strong></div>` : ''}${totals.freight > 0 ? `<div class="preview-summary-row"><span>Frete</span><strong>${formatMoney(totals.freight)}</strong></div>` : ''}${totals.addition > 0 ? `<div class="preview-summary-row"><span>Acréscimo</span><strong>${formatMoney(totals.addition)}</strong></div>` : ''}<div class="preview-summary-total"><span>VALOR TOTAL</span><strong>${formatMoney(totals.total)}</strong></div></div>` : '';
    const cover = $('orcamento-usar-capa').checked ? `
      <section class="preview-cover">
        <div class="preview-cover-brand">${logo}<div><strong>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</strong><p>${escapeHtml(company.endereco || companyAddress())}</p></div></div>
        <div class="preview-cover-title"><h1>${escapeHtml($('orcamento-titulo-capa').value || documentName)}</h1><p>${escapeHtml($('orcamento-subtitulo-capa').value || title)}</p></div>
        <div class="preview-cover-client"><small>Preparado para</small><h2>${escapeHtml(clientName)}</h2><p>${escapeHtml(code)} • ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p></div>
      </section>` : '';

    return `<div style="--preview-color:${escapeHtml(color)}">${cover}
      <section class="preview-document-page">
        <header class="preview-doc-header">
          <div class="preview-doc-brand">${logo}<div><h2>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</h2>${company.cnpj ? `<p>CNPJ: ${escapeHtml(company.cnpj)}</p>` : ''}<p>${escapeHtml(company.endereco || companyAddress())}</p><p>${escapeHtml([company.telefone, company.email].filter(Boolean).join(' • '))}</p></div></div>
          <div class="preview-doc-meta"><h1>${escapeHtml(documentName)}</h1><p><strong>${escapeHtml(code)}</strong></p><p>Emissão: ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p><p>Validade: ${escapeHtml(localDate($('orcamento-data-validade').value))}</p></div>
        </header>
        <div class="preview-title"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(state.categories.find((c) => String(c.id) === $('orcamento-categoria').value)?.nome || '')}</p></div>
        <div class="preview-client-box">
          <div class="preview-field"><label>Cliente</label><strong>${escapeHtml(clientName)}</strong></div>
          <div class="preview-field"><label>Responsável</label><span>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</span></div>
          <div class="preview-field"><label>Endereço/local</label><span>${escapeHtml(budgetAddress() || '—')}</span></div>
          <div class="preview-field"><label>Consultor</label><span>${escapeHtml(state.users.find((u) => String(u.id) === $('orcamento-consultor').value)?.nome || '—')}</span></div>
        </div>
        ${serviceProposalPreviewHtml()}
        ${itemsAndSummary}
        ${payments ? `<section class="preview-section"><h4>Formas de pagamento</h4><ul class="preview-payments">${payments}</ul></section>` : ''}
        ${$('orcamento-prazo-execucao').value ? `<section class="preview-section"><h4>Prazo de entrega/execução</h4><p>${escapeHtml($('orcamento-prazo-execucao').value)}</p></section>` : ''}
        ${$('orcamento-condicoes').value ? `<section class="preview-section"><h4>Condições gerais</h4><p>${escapeHtml($('orcamento-condicoes').value)}</p></section>` : ''}
        ${$('orcamento-observacoes').value ? `<section class="preview-section"><h4>Observações</h4><p>${escapeHtml($('orcamento-observacoes').value)}</p></section>` : ''}
        <footer class="preview-footer"><span>${escapeHtml(company.rodape || state.meta.configuracao?.rodape_padrao || company.fantasia || company.razao || '')}</span><span>Documento gerado pelo Valora CRM</span></footer>
      </section></div>`;
  }


  function usesDavDocument() {
    if (serviceProposalSelectedModel() !== 'padrao') return false;
    return String(state.meta.configuracao?.modelo_documento || 'padrao').toLowerCase() === 'dav';
  }

  function selectedEmitterData() {
    const selectedId = Number($('orcamento-emitente-id')?.value || state.current?.emitente_id || 0);
    return state.emitters.find((emitter) => Number(emitter.id) === selectedId) || null;
  }

  function documentCompanyData() {
    const config = state.meta.configuracao || {};
    const company = state.company || {};
    const budget = state.current || {};
    const emitter = selectedEmitterData() || {};
    const selectedId = Number($('orcamento-emitente-id')?.value || budget.emitente_id || 0);
    const useSnapshot = selectedId > 0 && Number(budget.emitente_id || 0) === selectedId;
    const snapshotAddress = useSnapshot ? budget.emitente_endereco_documento : null;
    const emitterAddress = [emitter.endereco, emitter.numero, emitter.complemento, emitter.bairro, emitter.cidade, emitter.estado, emitter.cep].filter(Boolean).join(', ');
    return {
      razao: (useSnapshot ? budget.emitente_razao_social_documento : null) || emitter.razao_social || config.cabecalho_razao_social || company.nome || 'Sua empresa',
      fantasia: (useSnapshot ? budget.emitente_nome_fantasia_documento : null) || emitter.nome_fantasia || config.cabecalho_nome_fantasia || '',
      cnpj: (useSnapshot ? budget.emitente_cnpj_documento : null) || emitter.cnpj || config.cabecalho_cnpj || company.cnpj || '',
      ie: (useSnapshot ? budget.emitente_ie_documento : null) || emitter.inscricao_estadual || '',
      email: (useSnapshot ? budget.emitente_email_documento : null) || emitter.email || config.cabecalho_email || company.email || '',
      site: (useSnapshot ? budget.emitente_site_documento : null) || emitter.site || config.cabecalho_site || '',
      telefone: (useSnapshot ? budget.emitente_telefone_documento : null) || emitter.telefone || config.cabecalho_telefone || company.telefone || '',
      endereco: snapshotAddress || emitterAddress || config.cabecalho_endereco || companyAddress(),
      logo: (useSnapshot ? budget.emitente_logo_documento : null) || emitter.logo_url || company.logo_url || '',
      rodape: (useSnapshot ? budget.emitente_rodape_documento : null) || emitter.rodape || config.cabecalho_rodape || config.rodape_padrao || company.nome || '',
      titulo: config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
    };
  }


  function documentClientData() {
    const budget = state.current || {};
    const client = state.selectedClient || {};
    return {
      razao: client.nome || budget.cliente_razao_social || $('orcamento-cliente-busca').value || 'Cliente não selecionado',
      fantasia: client.nome_fantasia || budget.cliente_nome_fantasia || '',
      documento: client.cpf_cnpj || budget.cliente_documento || '',
      rgIe: client.rg_ie || budget.cliente_rg_ie_documento || '',
      telefone: client.telefone || budget.cliente_telefone_documento || $('orcamento-contato-cliente').value || '',
      whatsapp: client.whatsapp || budget.cliente_whatsapp || '',
      fax: client.fax || budget.cliente_fax_documento || '',
      emailNfe: client.email_nfe || client.email || budget.cliente_email_nfe_documento || budget.cliente_email || '',
      contato: client.contato || budget.cliente_contato_documento || '',
    };
  }

  function davTimestamp() {
    const source = state.current?.criado_em || state.current?.atualizado_em;
    const value = source ? new Date(source) : new Date();
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  function davTextLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function davObservationGroups() {
    const groups = [];
    const conditions = davTextLines($('orcamento-condicoes').value);
    const notes = davTextLines($('orcamento-observacoes').value);
    const executionDeadline = $('orcamento-prazo-execucao').value.trim();

    if (conditions.length) {
      groups.push({ title: 'CONDIÇÕES GERAIS:', lines: conditions });
    }

    if (notes.length) {
      groups.push({ title: 'OBSERVAÇÕES ESPECÍFICAS:', lines: notes });
    }

    if (executionDeadline) {
      groups.push({ title: 'PRAZO DE ENTREGA/EXECUÇÃO:', lines: [executionDeadline] });
    }

    if (state.payments.length) {
      groups.push({
        title: 'FORMAS DE PAGAMENTO:',
        lines: state.payments.map((payment) => `${payment.nome}: ${paymentDescription(payment)}`),
      });
    }

    return groups;
  }

  function davObservationGroupsHtml() {
    return davObservationGroups()
      .map((group) => `<div class="dav-observation-group" style="margin-top:8px"><strong>${escapeHtml(group.title)}</strong>${group.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`)
      .join('');
  }

  function buildDavPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const client = documentClientData();
    const seller = state.users.find((user) => String(user.id) === $('orcamento-consultor').value) || {};
    const timestamp = davTimestamp();
    const code = $('orcamento-codigo').value || 'PRÉVIA';
    const totalQuantity = state.items.reduce((sum, item) => sum + parseNumber(item.quantidade), 0);
    const globalDiscountPercent = $('orcamento-desconto-tipo').value === 'percentual'
      ? parseNumber($('orcamento-desconto-valor').value)
      : (totals.subtotal > 0 ? (totals.discount / totals.subtotal) * 100 : 0);

    const rows = state.items.map((item, index) => {
      const quantity = Math.max(parseNumber(item.quantidade), 0);
      const unitValue = Math.max(parseNumber(item.valor_unitario), 0);
      const lineDiscount = Math.max(parseNumber(item.desconto), 0);
      const discountUnit = quantity > 0 ? lineDiscount / quantity : 0;
      const unitAfterDiscount = Math.max(unitValue - discountUnit, 0);
      return `<tr>
        <td class="dav-code">${escapeHtml(item.codigo || String(index + 1).padStart(6, '0'))}</td>
        <td class="dav-description"><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td class="dav-center">${escapeHtml(item.unidade || 'UN')}</td>
        <td class="dav-center">${formatDavQuantity(quantity)}</td>
        <td class="dav-number">${formatDavValue(unitValue)}</td>
        <td class="dav-number">${formatDavValue(discountUnit)}</td>
        <td class="dav-number">${formatDavValue(unitAfterDiscount)}</td>
        <td class="dav-number">${formatDavValue(itemTotal(item))}</td>
      </tr>`;
    }).join('');

    const observationGroups = davObservationGroupsHtml();
    const contactText = [client.contato, client.whatsapp || client.telefone].filter(Boolean).join(' ');
    const sellerText = [seller.nome || state.current?.consultor_nome, seller.telefone || state.current?.consultor_telefone].filter(Boolean).join(' ');
    const address = $('orcamento-logradouro').value || '—';
    const issueDate = localDate($('orcamento-data-emissao').value);
    const issueTime = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return `<section class="dav-document">
      <header class="dav-header">
        <div class="dav-company-title">
          <strong>${escapeHtml(company.razao)}</strong>
          <span>${escapeHtml([company.email ? `E-Mail: ${company.email}` : '', company.site ? `Site: ${company.site}` : ''].filter(Boolean).join(' / '))}</span>
          <h1>${escapeHtml(company.titulo)}</h1>
        </div>
        <div class="dav-document-meta">
          <div><b>Nº:</b><span>${escapeHtml(code)}</span></div>
          <div><b>Página:</b><span>1</span></div>
          <div><b>Data:</b><span>${escapeHtml(issueDate)}</span></div>
          <div><b></b><span>${escapeHtml(issueTime)}</span></div>
        </div>
      </header>

      <table class="dav-client-table">
        <tbody>
          <tr><td colspan="7"><label>NOME/RAZÃO SOCIAL:</label><strong>${escapeHtml(client.razao)}</strong></td><td colspan="2"><label>CPF/CNPJ:</label><strong>${escapeHtml(client.documento || '—')}</strong></td><td colspan="3"><label>RG/INSCRIÇÃO ESTADUAL:</label><strong>${escapeHtml(client.rgIe || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>ENDEREÇO:</label><strong>${escapeHtml(address)}</strong></td><td><label>NÚMERO:</label><strong>${escapeHtml($('orcamento-numero').value || '—')}</strong></td><td colspan="3"><label>BAIRRO:</label><strong>${escapeHtml($('orcamento-bairro').value || '—')}</strong></td><td colspan="3"><label>CEP:</label><strong>${escapeHtml($('orcamento-cep').value || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>MUNICÍPIO:</label><strong>${escapeHtml($('orcamento-cidade').value || '—')}</strong></td><td><label>UF:</label><strong>${escapeHtml($('orcamento-estado').value || '—')}</strong></td><td colspan="2"><label>FONE:</label><strong>${escapeHtml(client.telefone || '—')}</strong></td><td colspan="2"><label>FAX:</label><strong>${escapeHtml(client.fax || '—')}</strong></td><td colspan="2"><label>CONTATO:</label><strong>${escapeHtml(contactText || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>VENDEDOR:</label><strong>${escapeHtml(sellerText || '—')}</strong></td><td colspan="4"><label>RESPONSÁVEL PEDIDO:</label><strong>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</strong></td><td colspan="3"><label>VALIDADE DA PROPOSTA:</label><strong>${escapeHtml(localDate($('orcamento-data-validade').value))}</strong></td></tr>
          <tr><td colspan="12"><label>E-mail (p/ envio da NF-e):</label><strong>${escapeHtml(client.emailNfe || '—')}</strong></td></tr>
        </tbody>
      </table>

      <div class="dav-reference-line">${escapeHtml($('orcamento-titulo').value || '')}${state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome ? ` • ${escapeHtml(state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome)}` : ''}</div>

      <table class="dav-items-table">
        <thead><tr><th>CÓDIGO<br>PRODUTO:</th><th>DESCRIÇÃO DOS PRODUTOS:<br><span>REFERÊNCIA</span></th><th>UND.</th><th>QTDE:</th><th>VALOR(SD)<br>UNITÁRIO:</th><th>VALOR<br>DESCONTO:</th><th>VALOR(CD)<br>UNITÁRIO:</th><th>VALOR<br>TOTAL:</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="dav-empty">Nenhum item adicionado.</td></tr>'}</tbody>
      </table>

      <table class="dav-totals-table"><tbody><tr>
        <td class="dav-total-spacer"></td>
        <td class="dav-order-total"><div><b>Total do Pedido</b><strong>${formatDavValue(totals.total)}</strong></div><div><b>Desconto........................</b><span>${formatDavValue(globalDiscountPercent)}% &nbsp; + &nbsp; ${formatDavValue(totals.discount)} &nbsp; = &nbsp; ${formatDavValue(totals.total)}</span></div></td>
        <td class="dav-total-middle"></td>
        <td class="dav-note-total"><div><b>Total Produtos:</b><strong>${formatDavQuantity(totalQuantity)}</strong></div><div><b>Total da Nota:</b><strong>${formatDavValue(totals.total)}</strong></div></td>
      </tr></tbody></table>

      <section class="dav-observations"><h2>OBSERVAÇÕES E CONDIÇÕES:</h2><div class="dav-observation-lines">${observationGroups || '<div>—</div>'}</div></section>
      <footer class="dav-footer">${escapeHtml(company.rodape)}</footer>
    </section>`;
  }

  function buildPreviewHtml() {
    if (isNilsonServiceProposalModel()) return buildNilsonServiceProposalHtml();
    return usesDavDocument() ? buildDavPreviewHtml() : buildStandardPreviewHtml();
  }

  function applyPreviewScale(preview) {
    if (!preview) return;
    const scale = currentDocumentScale();
    const setPx = (name, base) => preview.style.setProperty(name, scaledCssValue(base, 'px', scale));
    preview.dataset.documentScale = String(scale);

    const variables = {
      '--doc-preview-padding': 44,
      '--std-cover-brand-gap': 16,
      '--std-cover-logo-size': 76,
      '--std-cover-title-gap': 14,
      '--std-cover-title-size': 42,
      '--std-cover-subtitle-size': 18,
      '--std-cover-client-padding': 24,
      '--std-header-gap': 22,
      '--std-header-padding': 20,
      '--std-brand-gap': 12,
      '--std-brand-logo-size': 58,
      '--std-brand-title-size': 18,
      '--std-meta-text-size': 10,
      '--std-meta-title-size': 22,
      '--std-title-top': 22,
      '--std-title-bottom': 15,
      '--std-title-size': 17,
      '--std-title-subtitle-size': 10,
      '--std-client-gap-row': 8,
      '--std-client-gap-column': 24,
      '--std-client-margin': 18,
      '--std-client-padding-y': 14,
      '--std-client-padding-x': 16,
      '--std-field-label-size': 8,
      '--std-field-value-size': 10,
      '--std-table-head-padding-y': 8,
      '--std-table-head-padding-x': 7,
      '--std-table-head-size': 8,
      '--std-table-cell-padding-y': 9,
      '--std-table-cell-padding-x': 7,
      '--std-table-cell-size': 9,
      '--std-table-small-gap': 3,
      '--std-summary-margin': 18,
      '--std-summary-row-padding': 7,
      '--std-summary-row-size': 9,
      '--std-summary-total-margin': 8,
      '--std-summary-total-padding-y': 12,
      '--std-summary-total-padding-x': 14,
      '--std-summary-label-size': 8,
      '--std-summary-value-size': 17,
      '--std-section-margin': 18,
      '--std-section-padding-y': 13,
      '--std-section-padding-x': 15,
      '--std-section-title-gap': 7,
      '--std-section-title-size': 10,
      '--std-section-text-size': 9,
      '--std-footer-margin': 24,
      '--std-footer-padding': 12,
      '--std-footer-gap': 20,
      '--std-footer-size': 8,
      '--dav-document-padding': 15,
      '--dav-base-font-size': 11,
      '--dav-header-min-height': 70,
      '--dav-header-padding-bottom': 6,
      '--dav-company-padding': 8,
      '--dav-company-title-size': 16,
      '--dav-company-subtitle-gap': 4,
      '--dav-company-subtitle-size': 10,
      '--dav-document-title-gap': 13,
      '--dav-document-title-size': 21,
      '--dav-meta-font-size': 9,
      '--dav-meta-row-height': 16,
      '--dav-meta-gap': 4,
      '--dav-client-padding-y': 3,
      '--dav-client-padding-x': 4,
      '--dav-client-label-size': 9,
      '--dav-client-value-gap': 2,
      '--dav-client-value-size': 10.5,
      '--dav-reference-min-height': 30,
      '--dav-reference-padding-y': 6,
      '--dav-reference-padding-x': 4,
      '--dav-reference-size': 10,
      '--dav-head-padding-y': 6,
      '--dav-head-padding-x': 3,
      '--dav-head-size': 8.8,
      '--dav-cell-min-height': 34,
      '--dav-cell-padding-y': 6,
      '--dav-cell-padding-x': 4,
      '--dav-cell-size': 10,
      '--dav-description-gap': 2,
      '--dav-description-size': 9,
      '--dav-total-height': 58,
      '--dav-total-padding-y': 4,
      '--dav-total-padding-x': 8,
      '--dav-total-gap': 4,
      '--dav-total-label-size': 9,
      '--dav-total-value-size': 10,
      '--dav-total-detail-size': 8.5,
      '--dav-note-row-padding': 3,
      '--dav-note-row-gap': 8,
      '--dav-observation-min-height': 140,
      '--dav-observation-padding-y': 10,
      '--dav-observation-padding-x': 8,
      '--dav-observation-title-gap': 18,
      '--dav-observation-title-size': 10,
      '--dav-observation-text-size': 10,
      '--dav-footer-min-height': 18,
      '--dav-footer-padding-y': 3,
      '--dav-footer-padding-x': 4,
      '--dav-footer-size': 9,
    };
    Object.entries(variables).forEach(([name, base]) => setPx(name, base));
  }

  function renderPreview() {
    const preview = $('document-preview');
    preview.classList.toggle('dav-preview-active', usesDavDocument());
    applyPreviewScale(preview);
    preview.innerHTML = buildPreviewHtml();
  }

  function renderPreviewIfVisible() {
    if (state.activeTab === 'documento') renderPreview();
  }

  function renderHistoryValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }

  function renderHistory(history) {
    $('budget-history').innerHTML = (history || []).map((item) => {
      const changes = Array.isArray(item.dados?.alteracoes) ? item.dados.alteracoes : [];
      const details = changes.length ? `<details class="history-details"><summary>${changes.length} ${changes.length === 1 ? 'alteração' : 'alterações'}</summary>${changes.map((change) => {
        const label = change.nome || change.campo_nome || change.campo || 'Informação';
        const before = change.anterior ?? change.valor_anterior;
        const after = change.novo ?? change.valor_novo;
        return `<div class="history-change"><strong>${escapeHtml(change.secao || 'Geral')} • ${escapeHtml(label)}</strong><span><del>${escapeHtml(renderHistoryValue(before))}</del><i class="fa-solid fa-arrow-right"></i><ins>${escapeHtml(renderHistoryValue(after))}</ins></span></div>`;
      }).join('')}</details>` : '';
      const parsedDate = item.criado_em ? new Date(item.criado_em) : null;
      const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString('pt-BR') : '';
      return `<article class="history-item"><strong>${escapeHtml(item.usuario_nome || 'Sistema')} • ${escapeHtml((item.acao || '').replaceAll('_', ' '))}</strong><p>${escapeHtml(item.descricao || '')}</p>${details}${dateLabel ? `<small>${escapeHtml(dateLabel)}</small>` : ''}</article>`;
    }).join('') || '<div class="empty-state">O histórico será criado ao salvar o orçamento.</div>';
  }


  function proposalSelectedValues(name) {
    return $$(`input[name="${name}"]:checked`).map((input) => input.value);
  }

  function setProposalCheckedValues(name, values = []) {
    const selected = new Set((values || []).map((value) => String(value)));
    $$(`input[name="${name}"]`).forEach((input) => { input.checked = selected.has(input.value); });
  }

  function selectedBudgetPayment() {
    return state.payments.find((payment) => payment.selecionada) || state.payments[0] || null;
  }

  function proposalPaymentFromBudget() {
    const payment = selectedBudgetPayment();
    if (!payment) return { forma: '', condicao: '' };
    const typeMap = {
      pix: 'pix',
      boleto: 'boleto',
      cartao: 'cartao',
      cheque: 'cheque',
      dinheiro: 'dinheiro',
      avista: '',
      entrada_parcelas: '',
      personalizado: '',
    };
    const parts = [payment.nome, payment.descricao].filter(Boolean);
    if (Number(payment.entrada_valor || 0) > 0) parts.push(`Entrada de ${formatMoney(payment.entrada_valor)}`);
    if (Number(payment.parcelas || 0) > 1) parts.push(`${Number(payment.parcelas)} parcelas`);
    if (Number(payment.juros_percentual || 0) > 0) parts.push(`${Number(payment.juros_percentual).toLocaleString('pt-BR')}% de juros`);
    return {
      forma: typeMap[String(payment.tipo || '').toLowerCase()] || 'outro',
      condicao: parts.join(' • ') || payment.nome || 'Condição definida no orçamento',
    };
  }

  function proposalDateTime(value) {
    if (!value) return '—';
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fillProposalClientPreparation(budget) {
    const prep = budget?.preparacao_cliente || {};
    const publication = budget?.publicacao_cliente || {};
    $('proposal-client-budget-code').textContent = budget?.codigo || '—';
    $('proposal-client-name').textContent = budget?.cliente_nome || budget?.cliente_razao_social || 'Cliente não vinculado';
    $('proposal-client-total').textContent = formatMoney(budget?.total || 0);
    const [statusLabel] = proposalPublicStatusInfo(publication.status || (prep.preparada ? 'preparada' : 'nao_gerado'));
    $('proposal-client-status').textContent = statusLabel;
    $('proposal-client-status').classList.toggle('is-ready', Boolean(prep.preparada));

    $$('input[name="proposal-natureza"]').forEach((input) => { input.checked = input.value === String(prep.natureza || ''); });
    setProposalCheckedValues('proposal-servico', prep.servicos || []);
    setProposalCheckedValues('proposal-plano', prep.planos || []);
    $('proposal-tipo-contrato').value = prep.tipo_contrato || '';
    $('proposal-valor-implantacao').value = inputMoney(prep.valor_implantacao || 0);
    $('proposal-valor-mensal').value = inputMoney(prep.valor_mensal || 0);
    $('proposal-dia-vencimento').value = prep.dia_vencimento || '';

    const budgetPayment = proposalPaymentFromBudget();
    $('proposal-forma-pagamento').value = prep.forma_pagamento || budgetPayment.forma || '';
    $('proposal-condicao-pagamento').value = prep.condicao_pagamento || budgetPayment.condicao || '';

    const approved = publication.status === 'aprovado';
    $('btn-salvar-proposal-client').disabled = approved;
    if (approved) $('btn-salvar-proposal-client').innerHTML = '<i class="fa-solid fa-check"></i> Aprovada pelo cliente';
    else $('btn-salvar-proposal-client').innerHTML = '<i class="fa-solid fa-link"></i> Salvar e gerar link';
  }

  function renderProposalClientLink(info = {}) {
    const status = String(info.status || 'nao_gerado');
    const [label, className] = proposalPublicStatusInfo(status);
    const badge = $('proposal-client-link-status');
    badge.textContent = info.desatualizado ? 'Link desatualizado' : label;
    badge.className = `proposal-client-link-badge ${info.desatualizado ? 'status-desativado' : className}`.trim();

    const hasLink = Boolean(info.tem_link && info.url);
    $('proposal-client-link-box').classList.toggle('is-hidden', !hasLink);
    $('proposal-client-link-empty').classList.toggle('is-hidden', hasLink);
    $('proposal-client-public-url').value = info.url || '';

    const meta = [];
    if (info.gerado_em) meta.push(`<span><i class="fa-regular fa-calendar"></i> Gerado ${escapeHtml(proposalDateTime(info.gerado_em))}</span>`);
    if (info.expira_em) meta.push(`<span><i class="fa-regular fa-clock"></i> Expira ${escapeHtml(proposalDateTime(info.expira_em))}</span>`);
    if (Number(info.visualizacoes || 0) > 0) meta.push(`<span><i class="fa-regular fa-eye"></i> ${Number(info.visualizacoes)} visualização${Number(info.visualizacoes) === 1 ? '' : 'ões'}</span>`);
    $('proposal-client-link-meta').innerHTML = meta.join('');

    const feedback = $('proposal-client-link-feedback');
    const messages = [];
    if (info.desatualizado) messages.push('O orçamento foi alterado depois que este link foi criado. Gere um novo link antes de enviar ao cliente.');
    if (status === 'visualizado' && info.primeira_visualizacao_em) messages.push(`O cliente abriu a proposta em ${proposalDateTime(info.primeira_visualizacao_em)}.`);
    if (status === 'aprovado') messages.push(`Aprovação registrada em ${proposalDateTime(info.aprovado_em)}.`);
    if (info.cadastro_contrato?.status === 'concluido') messages.push(`Cadastro para contrato concluído${info.cadastro_contrato.concluido_em ? ` em ${proposalDateTime(info.cadastro_contrato.concluido_em)}` : ''}.`);
    else if (status === 'aprovado' && ['pendente', 'em_preenchimento'].includes(info.cadastro_contrato?.status)) messages.push('Aguardando o cliente concluir o cadastro para contrato.');
    if (status === 'alteracao_solicitada') messages.push(`Cliente solicitou alteração${info.alteracao_solicitada_em ? ` em ${proposalDateTime(info.alteracao_solicitada_em)}` : ''}: ${info.alteracao_mensagem || 'sem mensagem'}`);
    feedback.textContent = messages.join(' ');
    feedback.classList.toggle('is-hidden', !messages.length);

    const approved = status === 'aprovado';
    $('btn-regenerar-proposal-link').disabled = approved;
    $('btn-desativar-proposal-link').disabled = approved;
    $('btn-copiar-proposal-link').disabled = !hasLink;
    $('btn-abrir-proposal-link').disabled = !hasLink;
    $('proposal-client-link-help').textContent = approved
      ? 'A aprovação foi registrada e preservada no histórico do orçamento.'
      : status === 'alteracao_solicitada'
        ? 'Revise os dados acima e gere uma nova versão para responder ao cliente.'
        : 'Compartilhe este link com o cliente para visualização e aprovação.';
  }

  async function loadProposalClientLink() {
    if (!state.currentId) return renderProposalClientLink({});
    try {
      const info = await api(`${API}/${state.currentId}/proposta-cliente/link`);
      renderProposalClientLink(info);
      if (state.current) {
        state.current.publicacao_cliente = { ...(state.current.publicacao_cliente || {}), status: info.status, link_ativo: info.ativo, versao_link: info.versao, aprovado_em: info.aprovado_em, alteracao_solicitada_em: info.alteracao_solicitada_em, alteracao_mensagem: info.alteracao_mensagem, cadastro_contrato: info.cadastro_contrato };
      }
    } catch (error) {
      renderProposalClientLink({});
      toast(error.message || 'Não foi possível consultar o link da proposta.', 'error');
    }
  }

  async function openProposalClientPreparation() {
    if (!state.currentId) {
      toast('Salve o orçamento antes de preparar o envio ao cliente.', 'error');
      return;
    }
    if (!Number($('orcamento-cliente-id').value || state.current?.cliente_id || 0)) {
      toast('Selecione um cliente antes de preparar o envio.', 'error');
      return;
    }
    fillProposalClientPreparation(state.current || {});
    renderProposalClientLink({ status: state.current?.publicacao_cliente?.status || 'nao_gerado' });
    openOverlay('proposal-client-modal');
    await loadProposalClientLink();
  }

  function useBudgetPaymentInProposal() {
    const payment = proposalPaymentFromBudget();
    if (!payment.condicao) {
      toast('Cadastre uma condição na aba Pagamento do orçamento primeiro.', 'error');
      return;
    }
    $('proposal-forma-pagamento').value = payment.forma;
    $('proposal-condicao-pagamento').value = payment.condicao;
    toast('Condição de pagamento trazida do orçamento.');
  }

  function collectProposalClientPreparation() {
    const natureza = $('proposal-natureza-options').querySelector('input[name="proposal-natureza"]:checked')?.value || '';
    const diaRaw = String($('proposal-dia-vencimento').value || '').trim();
    return {
      natureza,
      servicos: proposalSelectedValues('proposal-servico'),
      planos: proposalSelectedValues('proposal-plano'),
      tipo_contrato: $('proposal-tipo-contrato').value || null,
      valor_implantacao: parseNumber($('proposal-valor-implantacao').value),
      valor_mensal: parseNumber($('proposal-valor-mensal').value),
      dia_vencimento: diaRaw ? Number(diaRaw) : null,
      forma_pagamento: $('proposal-forma-pagamento').value,
      condicao_pagamento: $('proposal-condicao-pagamento').value.trim(),
    };
  }

  function validateProposalClientPreparation(payload) {
    if (!payload.natureza) throw new Error('Selecione a natureza da proposta.');
    if (!payload.forma_pagamento) throw new Error('Selecione a forma de pagamento.');
    if (!payload.condicao_pagamento) throw new Error('Informe a condição de pagamento.');
    if (payload.dia_vencimento !== null && (!Number.isInteger(payload.dia_vencimento) || payload.dia_vencimento < 1 || payload.dia_vencimento > 31)) {
      throw new Error('O dia de vencimento deve estar entre 1 e 31.');
    }
  }

  async function generateProposalClientLink(regenerar = false) {
    const info = await api(`${API}/${state.currentId}/proposta-cliente/link`, {
      method: 'POST',
      body: JSON.stringify({ regenerar: Boolean(regenerar) }),
    });
    renderProposalClientLink(info);
    if (state.current) {
      state.current.publicacao_cliente = { ...(state.current.publicacao_cliente || {}), status: info.status, link_ativo: info.ativo, versao_link: info.versao };
    }
    const topLabel = $('btn-gerar-link-cliente')?.querySelector('span');
    if (topLabel) topLabel.textContent = 'Link do cliente';
    return info;
  }

  async function saveProposalClientPreparation() {
    const button = $('btn-salvar-proposal-client');
    try {
      const payload = collectProposalClientPreparation();
      validateProposalClientPreparation(payload);
      setButtonLoading(button, true, 'Gerando link...');
      const budget = await api(`${API}/${state.currentId}/preparacao-cliente`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      fillProposalClientPreparation(budget);
      renderHistory(budget.historico || []);
      const info = await generateProposalClientLink(true);
      toast(info.url ? 'Link da proposta gerado. Agora você já pode enviar ao cliente.' : 'Preparação salva.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível gerar o link da proposta.', 'error');
    } finally {
      setButtonLoading(button, false);
      fillProposalClientPreparation(state.current || {});
    }
  }

  async function copyProposalClientLink() {
    const url = $('proposal-client-public-url').value.trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado.');
    } catch (_) {
      $('proposal-client-public-url').select();
      document.execCommand('copy');
      toast('Link copiado.');
    }
  }

  function openProposalClientLink() {
    const url = $('proposal-client-public-url').value.trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function regenerateProposalClientLink() {
    if (!await budgetConfirm({
      title: 'Gerar nova versão do link',
      message: 'O link anterior deixará de funcionar. Deseja gerar uma nova versão?',
      confirmText: 'Gerar nova versão',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    await saveProposalClientPreparation();
  }

  async function deactivateProposalClientLink() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Desativar link da proposta',
      message: 'O cliente não conseguirá mais abrir a proposta por este link. Deseja desativá-lo?',
      confirmText: 'Desativar link',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    const button = $('btn-desativar-proposal-link');
    try {
      setButtonLoading(button, true, 'Desativando...');
      await api(`${API}/${state.currentId}/proposta-cliente/link/desativar`, { method: 'POST' });
      renderProposalClientLink({ status: 'desativado' });
      if (state.current?.publicacao_cliente) {
        state.current.publicacao_cliente.status = 'desativado';
        state.current.publicacao_cliente.link_ativo = false;
      }
      const topLabel = $('btn-gerar-link-cliente')?.querySelector('span');
      if (topLabel) topLabel.textContent = 'Gerar link para cliente';
      toast('Link desativado.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível desativar o link.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function renderContractClient(info = {}) {
    const generated = Boolean(info.gerado || info.status === 'gerado');
    const outdated = Boolean(info.desatualizado);
    const version = Number(info.versao || 0);
    $('contract-client-status-label').textContent = generated ? (outdated ? 'Atualização necessária' : 'Contrato gerado') : 'Pronto para gerar';
    $('contract-client-number').textContent = generated ? (info.numero || 'Contrato gerado') : 'Contrato ainda não gerado';
    $('contract-client-description').textContent = generated
      ? `Gerado ${info.gerado_em ? `em ${proposalDateTime(info.gerado_em)}` : ''}. O PDF desta versão fica preservado.`
      : 'O Valora usará exatamente a proposta aprovada e os dados concluídos pelo cliente.';
    $('contract-client-version').textContent = generated ? `Versão ${version || 1}` : 'Nova versão';
    $('contract-client-warning').classList.toggle('is-hidden', !outdated);
    $('btn-visualizar-contract-client').classList.toggle('is-hidden', !generated);
    $('btn-baixar-contract-client').classList.toggle('is-hidden', !generated);
    const generateButton = $('btn-gerar-contract-client');
    generateButton.innerHTML = generated
      ? '<i class="fa-solid fa-rotate"></i> Gerar nova versão'
      : '<i class="fa-solid fa-file-circle-check"></i> Gerar contrato';
    generateButton.dataset.regenerar = generated ? 'true' : 'false';
    if (generated) loadContractSignature().catch(() => {});
    else renderContractSignature({ status: 'nao_enviado' });
  }

  async function loadContractClient() {
    if (!state.currentId) return renderContractClient({});
    const info = await api(`${API}/${state.currentId}/contrato`);
    renderContractClient(info);
    if (state.current?.publicacao_cliente) {
      state.current.publicacao_cliente.contrato = {
        status: info.status,
        versao: info.versao,
        gerado_em: info.gerado_em,
      };
    }
    return info;
  }

  async function openContractClient() {
    if (!state.currentId || !state.current) return;
    if (state.current.publicacao_cliente?.status !== 'aprovado') {
      toast('A proposta precisa estar aprovada pelo cliente antes de gerar o contrato.', 'error');
      return;
    }
    if (state.current.publicacao_cliente?.cadastro_contrato?.status !== 'concluido') {
      toast('Aguarde o cliente concluir o Cadastro para Contrato.', 'error');
      return;
    }
    $('contract-client-budget-code').textContent = state.current.codigo || '—';
    $('contract-client-name').textContent = state.current.cliente_razao_social || state.current.cliente_nome || 'Cliente';
    $('contract-client-approved').textContent = state.current.publicacao_cliente?.aprovado_em
      ? `Aprovada em ${proposalDateTime(state.current.publicacao_cliente.aprovado_em)}`
      : 'Aprovada';
    $('contract-client-registration').textContent = state.current.publicacao_cliente?.cadastro_contrato?.concluido_em
      ? `Concluído em ${proposalDateTime(state.current.publicacao_cliente.cadastro_contrato.concluido_em)}`
      : 'Concluído';
    openOverlay('contract-client-modal');
    try {
      await loadContractClient();
    } catch (error) {
      renderContractClient({});
      toast(error.message || 'Não foi possível consultar o contrato.', 'error');
    }
  }

  async function generateContractClient() {
    if (!state.currentId) return;
    const button = $('btn-gerar-contract-client');
    const regenerar = button.dataset.regenerar === 'true';
    if (regenerar && !await budgetConfirm({
      title: 'Gerar nova versão do contrato',
      message: 'Gerar uma nova versão do contrato com os dados atuais do cliente? A versão anterior continuará registrada no histórico.',
      confirmText: 'Gerar nova versão',
      cancelText: 'Cancelar',
    })) return;
    try {
      setButtonLoading(button, true, regenerar ? 'Gerando nova versão...' : 'Gerando contrato...');
      const info = await api(`${API}/${state.currentId}/contrato/gerar`, {
        method: 'POST',
        body: JSON.stringify({ regenerar }),
      });
      renderContractClient(info);
      if (state.current?.publicacao_cliente) {
        state.current.publicacao_cliente.contrato = { status: info.status, versao: info.versao, gerado_em: info.gerado_em };
      }
      const topLabel = $('btn-gerar-contrato-cliente')?.querySelector('span');
      if (topLabel) topLabel.textContent = 'Contrato gerado';
      toast(regenerar ? `Contrato versão ${info.versao} gerado.` : 'Contrato gerado com sucesso.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível gerar o contrato.', 'error');
    } finally {
      setButtonLoading(button, false);
      const generated = button.dataset.regenerar === 'true';
      button.innerHTML = generated
        ? '<i class="fa-solid fa-rotate"></i> Gerar nova versão'
        : '<i class="fa-solid fa-file-circle-check"></i> Gerar contrato';
    }
  }

  function openContractPdf(download = false) {
    if (!state.currentId) return;
    const url = `${API}/${state.currentId}/contrato/pdf${download ? '?download=true' : ''}`;
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function contractSignatureStatusInfo(status) {
    const map = {
      nao_enviado: ['Não enviado', 'neutral'],
      aguardando_assinatura: ['Aguardando assinatura', 'pending'],
      visualizado: ['Visualizado pelo cliente', 'viewed'],
      assinado: ['Assinado', 'signed'],
      cancelado: ['Solicitação cancelada', 'cancelled'],
    };
    return map[status] || [status || 'Não enviado', 'neutral'];
  }

  function renderContractSignature(info = {}) {
    const status = info.status || 'nao_enviado';
    const [label, cls] = contractSignatureStatusInfo(status);
    const panel = $('contract-signature-panel');
    if (panel) panel.classList.toggle('is-hidden', state.current?.publicacao_cliente?.contrato?.status !== 'gerado');
    $('contract-signature-status').textContent = label;
    $('contract-signature-chip').textContent = label;
    $('contract-signature-chip').className = `contract-signature-chip is-${cls}`;
    const desc = status === 'assinado'
      ? `Assinado ${info.assinado_em ? `em ${proposalDateTime(info.assinado_em)}` : ''}${info.assinante_nome ? ` por ${info.assinante_nome}` : ''}.`
      : status === 'visualizado'
        ? `O cliente visualizou esta versão${info.visualizado_em ? ` em ${proposalDateTime(info.visualizado_em)}` : ''}.`
        : status === 'aguardando_assinatura'
          ? `Disponível na Área do Cliente desde ${info.solicitada_em ? proposalDateTime(info.solicitada_em) : 'agora'}.`
          : status === 'cancelado'
            ? 'A solicitação anterior foi cancelada. Você pode enviar novamente esta mesma versão.'
            : 'Disponibilize esta versão na Área do Cliente para aceite eletrônico.';
    $('contract-signature-description').textContent = desc;
    const evidence = $('contract-signature-evidence');
    evidence?.classList.toggle('is-hidden', status !== 'assinado');
    $('contract-signature-id').textContent = info.assinatura_id ? `ID: ${info.assinatura_id}` : '—';
    $('contract-signature-hash').textContent = info.pdf_final_hash_sha256 || info.documento_hash_sha256 || '—';
    $('btn-enviar-assinatura-contract-client').classList.toggle('is-hidden', !info.pode_enviar);
    $('btn-cancelar-assinatura-contract-client').classList.toggle('is-hidden', !info.pode_cancelar);
    $('btn-pdf-assinado-contract-client').classList.toggle('is-hidden', !info.pdf_assinado_disponivel);
    const locked = ['aguardando_assinatura', 'visualizado', 'assinado'].includes(status);
    $('btn-gerar-contract-client').classList.toggle('is-hidden', locked);
  }

  async function loadContractSignature() {
    if (!state.currentId) return;
    const info = await api(`${API}/${state.currentId}/contrato/assinatura`);
    renderContractSignature(info);
    return info;
  }

  async function sendContractToSignature() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Enviar contrato para assinatura',
      message: 'Disponibilizar esta versão do contrato na Área do Cliente SEG para assinatura? Enquanto estiver aguardando assinatura ela ficará bloqueada para regeneração.',
      confirmText: 'Enviar para assinatura',
      cancelText: 'Cancelar',
    })) return;
    const button = $('btn-enviar-assinatura-contract-client');
    try {
      setButtonLoading(button, true, 'Enviando...');
      const info = await api(`${API}/${state.currentId}/contrato/assinatura/enviar`, { method: 'POST', body: '{}' });
      renderContractSignature(info);
      toast('Contrato disponibilizado na Área do Cliente SEG.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível enviar para assinatura.', 'error');
    } finally {
      setButtonLoading(button, false);
      button.innerHTML = '<i class="fa-solid fa-signature"></i> Enviar para assinatura';
    }
  }

  async function cancelContractSignature() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Cancelar assinatura',
      message: 'Cancelar a solicitação de assinatura desta versão?',
      confirmText: 'Cancelar solicitação',
      cancelText: 'Voltar',
      tone: 'danger',
    })) return;
    const button = $('btn-cancelar-assinatura-contract-client');
    try {
      setButtonLoading(button, true, 'Cancelando...');
      const info = await api(`${API}/${state.currentId}/contrato/assinatura/cancelar`, { method: 'POST', body: '{}' });
      renderContractSignature(info);
      toast('Solicitação de assinatura cancelada.');
    } catch (error) {
      toast(error.message || 'Não foi possível cancelar a solicitação.', 'error');
    } finally {
      setButtonLoading(button, false);
      button.innerHTML = '<i class="fa-solid fa-ban"></i> Cancelar solicitação';
    }
  }

  function openSignedContractPdf() {
    if (!state.currentId) return;
    window.open(`${API}/${state.currentId}/contrato/pdf-assinado`, '_blank', 'noopener,noreferrer');
  }

  function collectBudgetPayload() {
    return {
      cliente_id: Number($('orcamento-cliente-id').value) || null,
      emitente_id: Number($('orcamento-emitente-id')?.value) || null,
      consultor_id: Number($('orcamento-consultor').value) || null,
      categoria_id: Number($('orcamento-categoria').value) || null,
      modelo_id: Number(state.appliedTemplateId) || null,
      titulo: $('orcamento-titulo').value.trim(),
      nome_documento: $('orcamento-nome-documento').value.trim(),
      status: $('orcamento-status').value,
      data_solicitacao: $('orcamento-data-solicitacao').value || null,
      data_emissao: $('orcamento-data-emissao').value || null,
      data_validade: $('orcamento-data-validade').value || null,
      responsavel_cliente: $('orcamento-responsavel-cliente').value.trim() || null,
      contato_cliente: $('orcamento-contato-cliente').value.trim() || null,
      endereco_cep: $('orcamento-cep').value.trim() || null,
      endereco_logradouro: $('orcamento-logradouro').value.trim() || null,
      endereco_numero: $('orcamento-numero').value.trim() || null,
      endereco_complemento: $('orcamento-complemento').value.trim() || null,
      endereco_bairro: $('orcamento-bairro').value.trim() || null,
      endereco_cidade: $('orcamento-cidade').value.trim() || null,
      endereco_estado: $('orcamento-estado').value.trim() || null,
      desconto_tipo: $('orcamento-desconto-tipo').value,
      desconto_valor: parseNumber($('orcamento-desconto-valor').value),
      frete: parseNumber($('orcamento-frete').value),
      acrescimo: parseNumber($('orcamento-acrescimo').value),
      prazo_execucao: $('orcamento-prazo-execucao').value.trim() || null,
      condicoes: $('orcamento-condicoes').value.trim() || null,
      observacoes: $('orcamento-observacoes').value.trim() || null,
      proposta_modelo: serviceProposalSelectedModel(),
      proposta_comercial: collectServiceProposalData(),
      pagamentos: state.payments,
      usar_capa: $('orcamento-usar-capa').checked,
      titulo_capa: $('orcamento-titulo-capa').value.trim() || null,
      subtitulo_capa: $('orcamento-subtitulo-capa').value.trim() || null,
      escala_documento: currentDocumentScale(),
      itens: state.items.map((item, index) => ({ ...item, custo_unitario: item.custo_unitario === null ? null : parseNumber(item.custo_unitario), custo_informado: Boolean(item.custo_informado), ordem: index })),
    };
  }

  function validateBudget(payload) {
    if (!payload.titulo) { setTab('dados'); $('orcamento-titulo').focus(); throw new Error('Informe o título do orçamento.'); }
    if (!payload.emitente_id) { setTab('dados'); $('orcamento-emitente-id')?.focus(); throw new Error('Selecione a empresa emitente.'); }
    if (!payload.cliente_id) { setTab('dados'); $('orcamento-cliente-busca').focus(); throw new Error('Selecione um cliente.'); }
    if (!payload.itens.length && payload.proposta_modelo === 'padrao') { setTab('itens'); throw new Error('Adicione pelo menos um produto ou serviço.'); }
    if (payload.itens.some((item) => !String(item.descricao || '').trim())) { setTab('itens'); throw new Error('Preencha a descrição de todos os itens.'); }
  }

  async function enviarVendaFinanceiro() {
    if (!state.currentId || !state.current) return;

    let payload;
    try {
      payload = collectBudgetPayload();
      validateBudget(payload);
    } catch (error) {
      toast(error.message || 'Revise os dados do orçamento antes de enviar.', 'error');
      return;
    }
    if (String(payload.status || '').toLowerCase() !== 'aprovado') {
      toast('Aprove o orçamento antes de fechar a venda.', 'error');
      return;
    }

    const texto = state.current.financeiro_status === 'devolvido'
      ? `Reenviar a venda ${state.current.codigo} ao Financeiro com os dados atuais?`
      : `Fechar a venda ${state.current.codigo} e enviar ao Financeiro para conferência?`;
    if (!await budgetConfirm({
      title: state.current.financeiro_status === 'devolvido' ? 'Reenviar ao Financeiro' : 'Fechar venda',
      message: `${texto}\n\nAs alterações abertas serão salvas e o orçamento ficará bloqueado enquanto estiver em conferência.`,
      confirmText: state.current.financeiro_status === 'devolvido' ? 'Reenviar' : 'Fechar e enviar',
      cancelText: 'Cancelar',
    })) return;

    const button = $('btn-enviar-financeiro');
    try {
      setButtonLoading(button, true, 'Salvando e enviando...');
      state.current = await api(`${API}/${state.currentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await api(`${API}/${state.currentId}/enviar-financeiro`, {
        method: 'POST',
        body: JSON.stringify({ tipo_venda: 'avulsa', observacao: 'Venda fechada pelo Comercial.' }),
      });
      state.current = await api(`${API}/${state.currentId}`);
      fillBudgetForm(state.current);
      syncFinanceiroActions(state.current);
      toast('Venda enviada para autenticação do Financeiro.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível enviar a venda.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncFinanceiroActions(state.current);
    }
  }

  async function cancelarEnvioFinanceiro() {
    if (!state.currentId || !state.current) return;
    const motivo = prompt('Informe o motivo do cancelamento do envio ao Financeiro:');
    if (!motivo?.trim()) return;
    const button = $('btn-cancelar-envio-financeiro');
    try {
      setButtonLoading(button, true, 'Cancelando...');
      await api(`${API}/${state.currentId}/cancelar-envio-financeiro`, {
        method: 'POST', body: JSON.stringify({ observacao: motivo.trim(), tipo_venda: 'avulsa' }),
      });
      state.current = await api(`${API}/${state.currentId}`);
      syncFinanceiroActions(state.current);
      toast('Envio ao Financeiro cancelado. O orçamento pode ser editado novamente.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível cancelar o envio.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncFinanceiroActions(state.current);
    }
  }

  function abrirVendaNoFinanceiro() {
    if (!state.currentId) return;
    const targetUrl = `/faturamento?orcamento_id=${encodeURIComponent(state.currentId)}`;
    if (window.ValoraNavigate) window.ValoraNavigate(targetUrl);
    else window.location.href = targetUrl;
  }

  async function saveBudget() {
    const button = $('btn-salvar-orcamento');
    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true);
      const budget = await api(state.currentId ? `${API}/${state.currentId}` : API, {
        method: state.currentId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      state.currentId = budget.id;
      state.current = budget;
      setBudgetDirty(false);
      closeBudgetActionsMenu();
      toast('Orçamento salvo com sucesso.');
      closeOverlay('budget-modal');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível salvar.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function applyTemplate(selectionValue) {
    const select = $('orcamento-modelo');
    const rawValue = String(selectionValue || '').trim();

    if (!rawValue) {
      state.appliedTemplateId = null;
      return;
    }

    if (rawValue.startsWith('kit:')) {
      const kitId = Number(rawValue.slice(4));
      const restoreTemplateId = Number(state.appliedTemplateId) || null;
      if (!kitId) {
        if (select) select.value = restoreTemplateId ? String(restoreTemplateId) : '';
        return;
      }
      await addKitToBudget(kitId, null, { closePicker: false });
      if (select) select.value = restoreTemplateId ? String(restoreTemplateId) : '';
      return;
    }

    const templateId = Number(rawValue);
    if (!templateId) return;
    const previousTemplateId = Number(state.appliedTemplateId) || null;

    try {
      const template = await api(`${API}/modelos/${templateId}`);
      if (state.items.length && !await budgetConfirm({
        title: 'Aplicar modelo de orçamento',
        message: 'Aplicar este modelo substituirá os itens atuais. Deseja continuar?',
        confirmText: 'Aplicar modelo',
        cancelText: 'Cancelar',
        tone: 'danger',
      })) {
        if (select) select.value = previousTemplateId ? String(previousTemplateId) : '';
        return;
      }
      $('orcamento-titulo').value = template.titulo || $('orcamento-titulo').value;
      $('orcamento-categoria').value = template.categoria_id || '';
      if (template.validade_dias) $('orcamento-data-validade').value = addDays($('orcamento-data-emissao').value, template.validade_dias);
      $('orcamento-prazo-execucao').value = template.prazo_execucao || $('orcamento-prazo-execucao').value;
      $('orcamento-condicoes').value = template.condicoes || $('orcamento-condicoes').value;
      $('orcamento-observacoes').value = template.observacoes || $('orcamento-observacoes').value;
      state.items = (template.itens || []).map(normalizeItem);
      state.payments = (template.pagamentos || []).map(normalizePayment);
      state.appliedTemplateId = templateId;
      if (select) select.value = String(templateId);
      if (!state.payments.length) addDefaultPayment();
      renderItems();
      renderPayments();
      updateTotals();
      toast('Modelo aplicado ao orçamento.');
    } catch (error) {
      if (select) select.value = previousTemplateId ? String(previousTemplateId) : '';
      toast(error.message, 'error');
    }
  }

  async function deleteBudget(id) {
    if (!await budgetConfirm({
      title: 'Excluir orçamento',
      message: 'Excluir este orçamento permanentemente? Esta ação não poderá ser desfeita.',
      confirmText: 'Excluir orçamento',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/${id}`, { method: 'DELETE' });
      toast('Orçamento excluído.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function duplicateBudget(id) {
    try {
      const duplicated = await api(`${API}/${id}/duplicar`, { method: 'POST' });
      toast(`Orçamento ${duplicated.codigo} criado.`);
      await loadBudgets();
      await openEditBudget(duplicated.id);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function approveMargin() {
    if (!state.currentId) return;
    try {
      const budget = await api(`${API}/${state.currentId}/aprovar-margem`, { method: 'POST' });
      state.current = budget;
      $('btn-aprovar-margem').classList.add('is-hidden');
      toast('Margem aprovada pelo gestor.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

  function printFinancialAnalysis() {
    if (!canShowCosts()) {
      toast('Seu usuário não possui permissão para visualizar custos.', 'error');
      return;
    }

    const items = currentAnalysisItems();
    if (!items.length) {
      toast('Adicione pelo menos um item antes de imprimir a análise financeira.', 'error');
      return;
    }

    const calculation = state.calculation;
    const fallback = calculateTotals();
    const sale = calculation ? parseNumber(calculation.total) : fallback.total;
    const cost = calculation ? parseNumber(calculation.custo_total) : fallback.cost;
    const profit = calculation ? parseNumber(calculation.lucro_total) : fallback.profit;
    const margin = calculation ? parseNumber(calculation.margem_percentual) : fallback.margin;
    const missingCosts = calculation
      ? Number(calculation.itens_sem_custo || 0)
      : items.filter((item) => item.custo_informado === false).length;

    const code = $('orcamento-codigo')?.value?.trim() || 'Sem número';
    const title = $('orcamento-titulo')?.value?.trim() || 'Orçamento';
    const client = $('orcamento-cliente-busca')?.value?.trim() || 'Cliente não informado';
    const emission = $('orcamento-data-emissao')?.value ? localDate($('orcamento-data-emissao').value) : localDate(new Date().toISOString());
    const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

    const rows = items.map((item, index) => {
      const costKnown = item.custo_informado !== false;
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(item.descricao || 'Item sem descrição')}</strong>${item.codigo ? `<small>Cód. ${escapeHtml(item.codigo)}</small>` : ''}</td>
        <td class="num">${formatMoney(item.valor_total)}</td>
        <td class="num ${costKnown ? '' : 'missing'}">${costKnown ? formatMoney(item.custo_total) : 'Não informado'}</td>
        <td class="num">${costKnown ? formatMoney(item.lucro_total) : '—'}</td>
        <td class="num">${costKnown ? formatPercent(item.margem_percentual) : '—'}</td>
      </tr>`;
    }).join('');

    const warning = missingCosts > 0
      ? `<div class="warning"><strong>Atenção:</strong> ${missingCosts} item(ns) sem custo informado. A margem pode não representar o resultado real.</div>`
      : '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Análise financeira ${escapeHtml(code)}</title>
      <style>
        @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#17212b;margin:0;font-size:11px}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #dbe3e8;padding-bottom:14px;margin-bottom:18px}.head h1{font-size:20px;margin:3px 0 5px}.head p{margin:2px 0;color:#61717e}.internal{font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#9a6700;background:#fff7d6;border:1px solid #f0d98a;border-radius:6px;padding:6px 8px;align-self:flex-start}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px;margin-bottom:16px}.meta div{border-bottom:1px solid #eef2f4;padding:5px 0}.meta span{display:block;color:#74838f;font-size:9px;text-transform:uppercase}.meta strong{display:block;margin-top:3px;font-size:11px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 16px}.kpi{border:1px solid #dbe3e8;border-radius:8px;padding:10px}.kpi span{display:block;color:#74838f;font-size:9px;text-transform:uppercase}.kpi strong{display:block;margin-top:5px;font-size:16px}.warning{margin:0 0 14px;padding:9px 10px;border:1px solid #f1c56c;background:#fff8e8;border-radius:7px;color:#76500a}table{width:100%;border-collapse:collapse}th,td{padding:8px 7px;border-bottom:1px solid #e4e9ed;text-align:left;vertical-align:top}th{font-size:9px;text-transform:uppercase;color:#657681;background:#f6f8f9}.num{text-align:right;white-space:nowrap}.missing{color:#b42318;font-weight:600}td small{display:block;color:#7c8a94;margin-top:2px}.foot{margin-top:14px;color:#7c8a94;font-size:9px;display:flex;justify-content:space-between}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <div class="head"><div><p>Análise financeira do orçamento</p><h1>${escapeHtml(code)} — ${escapeHtml(title)}</h1><p>${escapeHtml(client)}</p></div><div class="internal">Documento interno</div></div>
      <div class="meta"><div><span>Cliente</span><strong>${escapeHtml(client)}</strong></div><div><span>Data de emissão</span><strong>${escapeHtml(emission)}</strong></div><div><span>Gerado em</span><strong>${escapeHtml(generatedAt)}</strong></div></div>
      <div class="kpis"><div class="kpi"><span>Valor de venda</span><strong>${formatMoney(sale)}</strong></div><div class="kpi"><span>Custo estimado</span><strong>${formatMoney(cost)}</strong></div><div class="kpi"><span>Lucro bruto</span><strong>${formatMoney(profit)}</strong></div><div class="kpi"><span>Margem</span><strong>${formatPercent(margin)}</strong></div></div>
      ${warning}
      <table><thead><tr><th>#</th><th>Item</th><th class="num">Venda</th><th class="num">Custo</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="foot"><span>Valora CRM — análise financeira</span><span>Informação de uso interno</span></div>
      <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;

    const win = window.open('', '_blank', 'width=1180,height=820');
    if (!win) {
      toast('Permita pop-ups para imprimir a análise financeira.', 'error');
      return;
    }
    try { win.opener = null; } catch (_) {}
    win.document.write(html);
    win.document.close();
  }

  function printCurrent() {
    const html = buildPreviewHtml();
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { toast('Permita pop-ups para gerar o PDF.', 'error'); return; }
    try { win.opener = null; } catch (_) {}
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><base href="${escapeHtml(`${window.location.origin}/`)}"><title>${escapeHtml($('orcamento-codigo').value || 'Orçamento')}</title><style>${printStyles()}</style></head><body><div class="document-preview">${html}</div><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    win.document.close();
  }

  async function printBudget(id) {
    if (state.currentId === id && !$('budget-modal').hidden) { printCurrent(); return; }
    try {
      const budget = await api(`${API}/${id}`);
      const previous = { currentId: state.currentId, current: state.current, items: state.items, payments: state.payments, client: state.selectedClient };
      state.currentId = id; state.current = budget; state.items = (budget.itens || []).map(normalizeItem); state.payments = (budget.pagamentos || []).map(normalizePayment); state.selectedClient = null;
      fillBudgetForm(budget);
      printCurrent();
      Object.assign(state, { currentId: previous.currentId, current: previous.current, items: previous.items, payments: previous.payments, selectedClient: previous.client });
    } catch (error) { toast(error.message, 'error'); }
  }

  function printStyles() {
    const scale = currentDocumentScale();
    const s = (base, unit = 'pt') => scaledCssValue(base, unit, scale);
    if (usesDavDocument()) {
      return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#000}.document-preview{width:auto;margin:0;background:#fff}.dav-document{width:100%;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:${s(9.5)}}.dav-header{position:relative;min-height:${s(18,'mm')};padding:0 31mm ${s(2,'mm')} 0;border-bottom:1px solid #000}.dav-company-title{text-align:center}.dav-company-title>strong{display:inline-block;padding:0 ${s(2,'mm')};border-bottom:1px solid #000;font-size:${s(13)};font-weight:600}.dav-company-title>span{display:block;margin-top:${s(1,'mm')};font-size:${s(9)}}.dav-company-title h1{margin:${s(3,'mm')} 0 0;font-size:${s(16)};line-height:1.1}.dav-document-meta{position:absolute;top:0;right:0;width:30mm;font-size:${s(8.5)}}.dav-document-meta div{display:grid;grid-template-columns:12mm 1fr;gap:${s(1,'mm')};min-height:${s(4,'mm')};align-items:center}.dav-document-meta b,.dav-document-meta span{text-align:right}.dav-client-table,.dav-items-table,.dav-totals-table{width:100%;border-collapse:collapse;table-layout:fixed}.dav-client-table td{min-height:${s(8,'mm')};padding:${s(1,'mm')} ${s(1.2,'mm')};border:1px solid #000;vertical-align:top}.dav-client-table label{display:block;font-size:${s(8)};font-weight:700;line-height:1.15}.dav-client-table strong{display:block;margin-top:${s(.6,'mm')};font-size:${s(9)};font-weight:400;line-height:1.25;overflow-wrap:anywhere}.dav-reference-line{min-height:${s(7,'mm')};padding:${s(1.5,'mm')} ${s(1,'mm')};border:1px solid #000;border-top:0;font-size:${s(9)};overflow-wrap:anywhere}.dav-items-table thead{display:table-header-group}.dav-items-table tr{break-inside:avoid;page-break-inside:avoid}.dav-items-table th{padding:${s(1.2,'mm')} ${s(.7,'mm')};border-bottom:1px solid #000;font-size:${s(8)};line-height:1.15;text-align:center;vertical-align:bottom}.dav-items-table th:nth-child(1){width:9%}.dav-items-table th:nth-child(2){width:35%;text-align:left}.dav-items-table th:nth-child(3){width:6%}.dav-items-table th:nth-child(4){width:7%}.dav-items-table th:nth-child(5){width:11%}.dav-items-table th:nth-child(6){width:10%}.dav-items-table th:nth-child(7){width:11%}.dav-items-table th:nth-child(8){width:11%}.dav-items-table td{padding:${s(1.5,'mm')} ${s(.8,'mm')};border-bottom:.25mm solid #aaa;font-size:${s(9)};line-height:1.25;vertical-align:top}.dav-description strong{font-weight:400}.dav-description small{display:block;margin-top:${s(.5,'mm')};font-size:${s(8)}}.dav-center{text-align:center}.dav-number{text-align:right;white-space:nowrap}.dav-empty{text-align:center}.dav-totals-table,.dav-observations,.dav-footer{break-inside:avoid;page-break-inside:avoid}.dav-totals-table td{min-height:${s(15,'mm')};border:1px solid #000;vertical-align:middle}.dav-total-spacer{width:13%}.dav-order-total{width:50%;padding:${s(1.5,'mm')} ${s(2,'mm')}}.dav-order-total>div{width:48%;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:${s(1,'mm')};vertical-align:middle}.dav-order-total b,.dav-note-total b{font-size:${s(8.5)}}.dav-order-total strong,.dav-note-total strong{font-size:${s(9.5)}}.dav-order-total span{font-size:${s(8)}}.dav-total-middle{width:15%}.dav-note-total{width:22%;padding:${s(1,'mm')} ${s(2,'mm')}}.dav-note-total div{display:flex;justify-content:space-between;gap:${s(2,'mm')};padding:${s(.7,'mm')} 0}.dav-observations{min-height:${s(35,'mm')};padding:${s(2.5,'mm')} ${s(2,'mm')};border:1px solid #000;border-top:0}.dav-observations h2{margin:0 0 ${s(4,'mm')};font-size:${s(9)}}.dav-observation-lines{font-size:${s(9)};line-height:1.45}.dav-footer{min-height:${s(5,'mm')};padding:${s(1,'mm')};border:1px solid #000;border-top:0;background:#edf7fc;text-align:center;font-size:${s(8)}}@page{size:A4 portrait;margin:8mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
    }
    return `*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#263746}.document-preview{width:auto;margin:0;background:#fff}.preview-cover{min-height:265mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}.preview-cover-brand,.preview-doc-brand{display:flex;align-items:center;gap:${s(16,'px')}}.preview-cover-brand img{width:${s(76,'px')};max-height:${s(76,'px')};object-fit:contain}.preview-cover-title{margin:auto 0}.preview-cover-title h1{margin:0 0 ${s(14,'px')};color:var(--preview-color);font-size:${s(42,'px')}}.preview-cover-title p{color:#667783;font-size:${s(18,'px')}}.preview-cover-client{padding-top:${s(24,'px')};border-top:2px solid var(--preview-color)}.preview-doc-header{display:flex;justify-content:space-between;gap:${s(20,'px')};padding-bottom:${s(20,'px')};border-bottom:3px solid var(--preview-color)}.preview-doc-brand img{width:${s(58,'px')};max-height:${s(58,'px')};object-fit:contain}.preview-doc-brand h2{margin:0 0 ${s(4,'px')};font-size:${s(18,'px')}}.preview-doc-brand p,.preview-doc-meta p{margin:${s(2,'px')} 0;color:#687884;font-size:${s(10,'px')}}.preview-doc-meta{text-align:right}.preview-doc-meta h1{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(22,'px')}}.preview-title{margin:${s(22,'px')} 0 ${s(15,'px')}}.preview-title h3{margin:0 0 ${s(4,'px')};font-size:${s(17,'px')}}.preview-title p{margin:0;color:#71808b;font-size:${s(10,'px')}}.preview-client-box{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')} ${s(24,'px')};margin-bottom:${s(18,'px')};padding:${s(14,'px')} ${s(16,'px')};border:1px solid #dfe6ea;border-radius:8px;background:#f8fafb}.preview-field label{display:block;color:#82909a;font-size:${s(8,'px')};text-transform:uppercase}.preview-field strong,.preview-field span{font-size:${s(10,'px')}}.preview-items{width:100%;border-collapse:collapse}.preview-items thead{display:table-header-group}.preview-items tr{break-inside:avoid;page-break-inside:avoid}.preview-items th{padding:${s(8,'px')} ${s(7,'px')};color:#fff;background:#365465;font-size:${s(8,'px')};text-align:left}.preview-items td{padding:${s(9,'px')} ${s(7,'px')};border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')};vertical-align:top}.preview-items td small{display:block;margin-top:${s(3,'px')};color:#84919a}.preview-summary{width:310px;margin:${s(18,'px')} 0 0 auto}.preview-summary-row{display:flex;justify-content:space-between;padding:${s(7,'px')} 0;border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')}}.preview-summary-total{margin-top:${s(8,'px')};padding:${s(12,'px')} ${s(14,'px')};border-radius:7px;color:#fff;background:var(--preview-color)}.preview-summary-total span{font-size:${s(8,'px')}}.preview-summary-total strong{display:block;margin-top:${s(3,'px')};font-size:${s(17,'px')}}.preview-section{margin-top:${s(18,'px')};padding:${s(13,'px')} ${s(15,'px')};border:1px solid #dfe6ea;border-radius:8px;break-inside:avoid;page-break-inside:avoid}.preview-section h4{margin:0 0 ${s(7,'px')};font-size:${s(10,'px')}}.preview-section p,.preview-section li{font-size:${s(9,'px')};line-height:1.55;white-space:pre-line}.preview-footer{margin-top:${s(24,'px')};padding-top:${s(12,'px')};border-top:1px solid #e0e7eb;display:flex;justify-content:space-between;gap:${s(20,'px')};color:#88949c;font-size:${s(8,'px')}}.preview-service-proposal{margin:${s(18,'px')} 0;display:grid;gap:${s(12,'px')}}.preview-service-proposal-intro{padding:${s(12,'px')} ${s(14,'px')};border:1px solid #e5eaf0;border-radius:8px;background:#fbfcfd;break-inside:avoid}.preview-service-proposal-intro h4{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(11,'px')}}.preview-service-proposal-intro p,.preview-service-proposal-note p{margin:0;white-space:pre-line;color:#445066;font-size:${s(8.5,'px')};line-height:1.5}.preview-service-proposal-grid{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')}}.preview-service-proposal-section{border:1px solid #dfe5eb;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-section h5{margin:0;padding:${s(7,'px')} ${s(9,'px')};background:#f6f8fa;color:#26354a;font-size:${s(9,'px')}}.preview-service-proposal-section ul{margin:0;padding:${s(7,'px')} ${s(9,'px')} ${s(8,'px')} ${s(22,'px')}}.preview-service-proposal-section li{margin:0 0 ${s(2,'px')};color:#3e4a5f;font-size:${s(8,'px')};line-height:1.35}.preview-service-proposal-values{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dfe6ed;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-value{padding:${s(9,'px')} ${s(10,'px')};border-right:1px solid #e3e9ef}.preview-service-proposal-value:last-child{border-right:0}.preview-service-proposal-value span,.preview-service-proposal-value strong{display:block}.preview-service-proposal-value span{color:#78869a;font-size:${s(7,'px')};text-transform:uppercase}.preview-service-proposal-value strong{margin-top:${s(3,'px')};color:#1d2a3d;font-size:${s(10,'px')}}.preview-service-proposal-note{padding:${s(10,'px')} ${s(12,'px')};border-left:3px solid var(--preview-color);background:#fafcfd;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-note h5{margin:0 0 ${s(4,'px')};font-size:${s(8.5,'px')}}@page{size:A4 portrait;margin:10mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  }

  async function sendWhatsApp(id) {
    try {
      const budget = state.currentId === id && state.current ? state.current : await api(`${API}/${id}`);
      let phone = String(budget.cliente_whatsapp || state.selectedClient?.whatsapp || '').replace(/\D/g, '');
      if (!phone) { toast('O cliente não possui WhatsApp cadastrado.', 'error'); return; }
      if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
      const message = [`Olá, ${budget.cliente_nome || 'tudo bem'}!`, '', `Segue o ${budget.nome_documento || 'orçamento'} ${budget.codigo}.`, budget.titulo, `Valor total: ${formatMoney(budget.total)}`, budget.data_validade ? `Validade: ${localDate(budget.data_validade)}` : '', '', 'Fico à disposição para esclarecer qualquer dúvida.'].filter(Boolean).join('\n');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      if (budget.status === 'rascunho') {
        await api(`${API}/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'enviado', observacao: 'Orçamento compartilhado pelo WhatsApp.' }) });
        await loadBudgets();
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  // Kits de produtos no orçamento
  function activeKits() {
    return (state.kits || []).filter((kit) => kit.ativo !== false);
  }

  function updateKitPickerLayoutUI() {
    const list = $('kit-picker-list');
    const layout = state.kitPickerLayout === 'row' ? 'row' : 'column';
    if (list) list.classList.toggle('is-row-layout', layout === 'row');
    $$('[data-kit-layout]').forEach((option) => {
      const active = option.dataset.kitLayout === layout;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function closeKitLayoutMenu() {
    const menu = $('kit-layout-menu');
    const button = $('btn-kit-picker-layout');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleKitLayoutMenu(force) {
    const menu = $('kit-layout-menu');
    const button = $('btn-kit-picker-layout');
    if (!menu || !button) return;
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setKitPickerLayout(layout) {
    state.kitPickerLayout = layout === 'row' ? 'row' : 'column';
    saveKitPickerLayout(state.kitPickerLayout);
    updateKitPickerLayoutUI();
  }

  function renderKitPicker() {
    const query = String($('kit-picker-search-input')?.value || '').trim().toLowerCase();
    const kits = activeKits().filter((kit) => !query || [kit.nome, kit.descricao].join(' ').toLowerCase().includes(query));
    $('kit-picker-count').textContent = `${kits.length} ${kits.length === 1 ? 'kit disponível' : 'kits disponíveis'}`;
    updateKitPickerLayoutUI();
    $('kit-picker-list').innerHTML = kits.map((kit) => `
      <article class="kit-picker-card">
        <div class="kit-picker-card-icon"><i class="fa-solid fa-layer-group"></i></div>
        <div class="kit-picker-card-copy">
          <h4>${escapeHtml(kit.nome)}</h4>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para o orçamento.')}</p>
          <div class="kit-picker-card-meta">
            <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
            <span><i class="fa-solid fa-coins"></i> ${formatMoney(kit.valor_estimado)}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-small" type="button" data-add-kit="${kit.id}"><i class="fa-solid fa-plus"></i> Adicionar</button>
      </article>`).join('') || `
      <div class="kit-picker-empty">
        <i class="fa-solid fa-layer-group"></i>
        <strong>${query ? 'Nenhum kit encontrado' : 'Nenhum kit cadastrado'}</strong>
        <span>${query ? 'Tente buscar por outro nome.' : 'Crie kits em Configurações de orçamentos para inserir vários produtos de uma vez.'}</span>
      </div>`;
  }

  async function openKitPicker() {
    try {
      state.kits = await api(`${API}/kits`);
      $('kit-picker-search-input').value = '';
      closeKitLayoutMenu();
      renderKitPicker();
      openOverlay('kit-picker-modal');
      setTimeout(() => $('kit-picker-search-input')?.focus(), 80);
    } catch (error) {
      toast(error.message || 'Não foi possível carregar os kits.', 'error');
    }
  }

  async function addKitToBudget(kitId, button = null, { closePicker = true } = {}) {
    try {
      setButtonLoading(button, true, 'Adicionando...');
      const kit = await api(`${API}/kits/${kitId}`);
      let addedLines = 0;
      let mergedLines = 0;
      (kit.itens || []).forEach((rawItem) => {
        const item = normalizeItem(rawItem);
        const existing = item.produto_id
          ? state.items.find((current) => Number(current.produto_id) === Number(item.produto_id))
          : null;
        if (existing) {
          existing.quantidade = parseNumber(existing.quantidade) + parseNumber(item.quantidade);
          mergedLines += 1;
        } else {
          state.items.push(item);
          addedLines += 1;
        }
      });
      renderItems();
      updateTotals();
      setTab('itens');
      closeKitLayoutMenu();
      if (closePicker) closeOverlay('kit-picker-modal');
      const detail = mergedLines ? ` (${mergedLines} quantidades somadas aos produtos já existentes)` : '';
      toast(`Kit “${kit.nome}” adicionado com ${addedLines + mergedLines} produtos${detail}.`);
    } catch (error) {
      toast(error.message || 'Não foi possível adicionar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  // Configurações
  async function openSettings() {
    try {
      const [categories, templates, kits, emitters] = await Promise.all([
        api(`${API}/categorias?incluir_inativas=true`),
        api(`${API}/modelos?incluir_inativos=true`),
        api(`${API}/kits?incluir_inativos=true`),
        api(`${API}/emitentes?incluir_inativos=true`),
      ]);
      state.categories = categories || [];
      state.templates = templates || [];
      state.kits = kits || [];
      state.emitters = emitters || [];
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar as configurações.', 'error');
    }
    fillSettingsForm();
    renderCategories();
    renderTemplates();
    renderKits();
    renderEmitters();
    resetEmitterEditor();
    renderSelects();
    setSettingsTab('geral');
    openOverlay('settings-modal');
  }

  function updateSettingsFooter(tab) {
    const footer = $('settings-footer');
    const primaryButton = $('btn-salvar-settings');
    if (!footer || !primaryButton) return;

    const visible = tab === 'geral' || tab === 'emitentes';
    footer.classList.toggle('is-hidden', !visible);
    footer.dataset.mode = tab;

    if (tab === 'emitentes') {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar empresa';
      primaryButton.setAttribute('aria-label', 'Salvar empresa emitente');
    } else {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar configurações';
      primaryButton.setAttribute('aria-label', 'Salvar configurações gerais');
    }
  }

  function setSettingsTab(tab) {
    state.settingsTab = tab;
    $$('.settings-tabs button').forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === tab));
    updateSettingsFooter(tab);
    if ($('settings-modal') && !$('settings-modal').hidden) $('settings-modal').querySelector('.settings-body').scrollTop = 0;
  }

  function normalizeSettingsColor(value, fallback = '#65ACDE') {
    const raw = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toUpperCase()}` : fallback;
  }

  function syncSettingsColorFromPicker() {
    const color = normalizeSettingsColor($('config-cor').value);
    $('config-cor').value = color;
    $('config-cor-hex').value = color.slice(1);
  }

  function syncSettingsColorFromText(force = false) {
    const typed = String($('config-cor-hex').value || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(typed)) {
      const color = `#${typed.toUpperCase()}`;
      $('config-cor').value = color;
      $('config-cor-hex').value = typed.toUpperCase();
      return;
    }
    if (force) syncSettingsColorFromPicker();
  }

  function updateSettingsConditionalFields() {
    const isDav = $('config-modelo-documento').value === 'dav';
    $$('[data-settings-dav]').forEach((field) => field.classList.toggle('is-hidden', !isDav));

    const useCover = $('config-usar-capa').checked;
    $$('[data-settings-cover-field]').forEach((field) => field.classList.toggle('settings-fields-muted', !useCover));
  }

  function fillSettingsForm() {
    const config = state.meta.configuracao || {};
    const values = {
      'config-nome-documento': config.nome_documento || 'Orçamento',
      'config-prefixo': config.prefixo || 'ORC',
      'config-validade': config.validade_padrao_dias ?? 7,
      'config-prazo': config.prazo_execucao_padrao || '',
      'config-condicoes': config.condicoes_padrao || '',
      'config-observacoes': config.observacoes_padrao || '',
      'config-rodape': config.rodape_padrao || '',
      'config-margem-minima': inputMoney(config.margem_minima),
      'config-titulo-capa': config.titulo_capa || '',
      'config-subtitulo-capa': config.subtitulo_capa || '',
      'config-modelo-documento': config.modelo_documento || 'padrao',
      'config-dav-titulo': config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
      'config-cabecalho-razao': config.cabecalho_razao_social || '',
      'config-cabecalho-fantasia': config.cabecalho_nome_fantasia || '',
      'config-cabecalho-cnpj': config.cabecalho_cnpj || '',
      'config-cabecalho-email': config.cabecalho_email || '',
      'config-cabecalho-site': config.cabecalho_site || '',
      'config-cabecalho-telefone': config.cabecalho_telefone || '',
      'config-cabecalho-endereco': config.cabecalho_endereco || '',
      'config-cabecalho-rodape': config.cabecalho_rodape || '',
    };
    Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    syncSettingsScale(config.escala_documento_padrao ?? DOCUMENT_SCALE_DEFAULT);
    const primaryColor = normalizeSettingsColor(config.cor_primaria || '#65ACDE');
    $('config-cor').value = primaryColor;
    $('config-cor-hex').value = primaryColor.slice(1);
    $('config-exigir-aprovacao').checked = Boolean(config.exigir_aprovacao_margem);
    $('config-controlar-custos').checked = config.controlar_custos !== false;
    $('config-usar-capa').checked = Boolean(config.usar_capa);
    $('config-mostrar-codigo').checked = config.mostrar_codigo !== false;
    updateSettingsConditionalFields();
  }

  async function saveSettings() {
    const button = $('btn-salvar-settings');
    try {
      setButtonLoading(button, true);
      const config = state.meta.configuracao || {};
      const payload = {
        nome_documento: $('config-nome-documento').value.trim() || 'Orçamento',
        prefixo: $('config-prefixo').value.trim() || 'ORC',
        modelo_documento: $('config-modelo-documento').value || 'padrao',
        dav_titulo: $('config-dav-titulo').value.trim() || 'DAV - Documento Auxiliar de Venda',
        cabecalho_razao_social: $('config-cabecalho-razao').value.trim() || null,
        cabecalho_nome_fantasia: $('config-cabecalho-fantasia').value.trim() || null,
        cabecalho_cnpj: $('config-cabecalho-cnpj').value.trim() || null,
        cabecalho_email: $('config-cabecalho-email').value.trim() || null,
        cabecalho_site: $('config-cabecalho-site').value.trim() || null,
        cabecalho_telefone: $('config-cabecalho-telefone').value.trim() || null,
        cabecalho_endereco: $('config-cabecalho-endereco').value.trim() || null,
        cabecalho_rodape: $('config-cabecalho-rodape').value.trim() || null,
        validade_padrao_dias: Number($('config-validade').value || 0),
        prazo_execucao_padrao: $('config-prazo').value.trim() || null,
        condicoes_padrao: $('config-condicoes').value.trim() || null,
        observacoes_padrao: $('config-observacoes').value.trim() || null,
        rodape_padrao: $('config-rodape').value.trim() || null,
        cor_primaria: normalizeSettingsColor($('config-cor-hex').value || $('config-cor').value),
        titulo_capa: $('config-titulo-capa').value.trim() || null,
        subtitulo_capa: $('config-subtitulo-capa').value.trim() || null,
        usar_capa: $('config-usar-capa').checked,
        escala_documento_padrao: normalizeDocumentScale($('config-escala-documento').value),
        mostrar_codigo: $('config-mostrar-codigo').checked,
        mostrar_desconto: config.mostrar_desconto !== false,
        mostrar_imagens: Boolean(config.mostrar_imagens),
        controlar_custos: $('config-controlar-custos').checked,
        margem_minima: parseNumber($('config-margem-minima').value),
        exigir_aprovacao_margem: $('config-exigir-aprovacao').checked,
        formas_pagamento: config.formas_pagamento || [],
      };
      state.meta.configuracao = await api(`${API}/configuracao`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Configurações salvas.');
      applyPermissions();
      closeOverlay('settings-modal');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  function resetEmitterEditor() {
    const ids = ['emitter-id','emitter-name','emitter-legal-name','emitter-fantasy-name','emitter-cnpj','emitter-ie','emitter-email','emitter-site','emitter-phone','emitter-cep','emitter-address','emitter-number','emitter-complement','emitter-neighborhood','emitter-city','emitter-state','emitter-logo','emitter-footer'];
    ids.forEach((id) => { if ($(id)) $(id).value = ''; });
    $('emitter-default').checked = !state.emitters.some((emitter) => emitter.padrao && emitter.ativo !== false);
    $('emitter-active').checked = true;
    $('emitter-editor-title').textContent = 'Nova empresa emitente';
  }

  function renderEmitters() {
    if (!$('emitters-list')) return;
    $('emitters-list').innerHTML = state.emitters.map((emitter) => `<article class="emitter-list-item ${emitter.ativo === false ? 'is-inactive' : ''}"><div><strong>${escapeHtml(emitter.nome)}</strong><span>${escapeHtml(emitter.razao_social || '')}</span><small>${escapeHtml([emitter.cnpj, emitter.cidade, emitter.estado].filter(Boolean).join(' • '))}</small></div><div class="emitter-list-actions">${emitter.padrao ? '<span class="settings-status-badge">Padrão</span>' : ''}<button type="button" class="budget-action-btn" data-edit-emitter="${emitter.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>${emitter.ativo === false ? '' : `<button type="button" class="budget-action-btn danger" data-delete-emitter="${emitter.id}" title="Desativar"><i class="fa-regular fa-trash-can"></i></button>`}</div></article>`).join('') || '<div class="settings-empty-state"><strong>Nenhuma empresa emitente</strong><small>Cadastre a empresa que deverá aparecer no orçamento.</small></div>';
  }

  function editEmitter(id) {
    const emitter = state.emitters.find((item) => Number(item.id) === Number(id));
    if (!emitter) return;
    const values = {
      'emitter-id': emitter.id, 'emitter-name': emitter.nome, 'emitter-legal-name': emitter.razao_social,
      'emitter-fantasy-name': emitter.nome_fantasia, 'emitter-cnpj': emitter.cnpj, 'emitter-ie': emitter.inscricao_estadual,
      'emitter-email': emitter.email, 'emitter-site': emitter.site, 'emitter-phone': emitter.telefone, 'emitter-cep': emitter.cep,
      'emitter-address': emitter.endereco, 'emitter-number': emitter.numero, 'emitter-complement': emitter.complemento,
      'emitter-neighborhood': emitter.bairro, 'emitter-city': emitter.cidade, 'emitter-state': emitter.estado,
      'emitter-logo': emitter.logo_url, 'emitter-footer': emitter.rodape,
    };
    Object.entries(values).forEach(([idField, value]) => { $(idField).value = value || ''; });
    $('emitter-default').checked = Boolean(emitter.padrao);
    $('emitter-active').checked = emitter.ativo !== false;
    $('emitter-editor-title').textContent = `Editar ${emitter.nome}`;
  }

  function emitterPayload() {
    return {
      nome: $('emitter-name').value.trim(), razao_social: $('emitter-legal-name').value.trim(), nome_fantasia: $('emitter-fantasy-name').value.trim() || null,
      cnpj: $('emitter-cnpj').value.trim() || null, inscricao_estadual: $('emitter-ie').value.trim() || null, email: $('emitter-email').value.trim() || null,
      site: $('emitter-site').value.trim() || null, telefone: $('emitter-phone').value.trim() || null, cep: $('emitter-cep').value.trim() || null,
      endereco: $('emitter-address').value.trim() || null, numero: $('emitter-number').value.trim() || null, complemento: $('emitter-complement').value.trim() || null,
      bairro: $('emitter-neighborhood').value.trim() || null, cidade: $('emitter-city').value.trim() || null, estado: $('emitter-state').value.trim().toUpperCase() || null,
      logo_url: $('emitter-logo').value.trim() || null, rodape: $('emitter-footer').value.trim() || null,
      padrao: $('emitter-default').checked, ativo: $('emitter-active').checked,
    };
  }

  async function saveEmitter(triggerButton = null) {
    const button = triggerButton || $('btn-salvar-emitente');
    try {
      const payload = emitterPayload();
      if (!payload.nome || !payload.razao_social) throw new Error('Informe o nome interno e a razão social.');
      setButtonLoading(button, true);
      const id = Number($('emitter-id').value || 0);
      await api(id ? `${API}/emitentes/${id}` : `${API}/emitentes`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      state.meta.emitentes = state.emitters.filter((emitter) => emitter.ativo !== false);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente salva.');
    } catch (error) { toast(error.message || 'Não foi possível salvar a empresa.', 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteEmitter(id) {
    if (!await budgetConfirm({
      title: 'Desativar empresa emitente',
      message: 'Desativar esta empresa emitente? Orçamentos antigos manterão os dados gravados.',
      confirmText: 'Desativar',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/emitentes/${id}`, { method: 'DELETE' });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente desativada.');
    } catch (error) { toast(error.message, 'error'); }
  }

  function resetCategoryEditor() {
    $('category-id').value = '';
    $('category-name').value = '';
    $('category-description').value = '';
    $('category-order').value = '0';
    $('category-active').checked = true;
    $('category-editor-title').textContent = 'Nova categoria';
  }

  function renderCategories() {
    $('categories-list').innerHTML = state.categories.map((category) => `
      <article class="settings-list-item category-settings-card ${category.ativo === false ? 'is-inactive' : ''}">
        <span class="category-settings-icon"><i class="fa-regular fa-folder-open"></i></span>
        <div class="category-settings-copy">
          <div class="category-settings-title">
            <strong>${escapeHtml(category.nome)}</strong>
            <span class="settings-status-badge ${category.ativo === false ? 'inactive' : ''}">${category.ativo === false ? 'Inativa' : 'Ativa'}</span>
          </div>
          <small>${escapeHtml(category.descricao || 'Categoria sem descrição interna.')}</small>
          <span class="category-settings-order">Ordem ${Number(category.ordem || 0)}</span>
        </div>
        <div class="settings-list-actions">
          <button class="budget-action-btn" data-edit-category="${category.id}" type="button" title="Editar categoria"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-category="${category.id}" type="button" title="Excluir categoria"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state"><span><i class="fa-regular fa-folder-open"></i></span><strong>Nenhuma categoria criada</strong><small>Crie categorias para organizar e identificar os tipos de orçamento.</small></div>`;
  }

  function editCategory(id) {
    const category = state.categories.find((item) => Number(item.id) === Number(id));
    if (!category) return;
    $('category-id').value = category.id;
    $('category-name').value = category.nome;
    $('category-description').value = category.descricao || '';
    $('category-order').value = category.ordem || 0;
    $('category-active').checked = category.ativo !== false;
    $('category-editor-title').textContent = 'Editar categoria';
  }

  async function saveCategory() {
    const id = Number($('category-id').value) || null;
    const payload = { nome: $('category-name').value.trim(), descricao: $('category-description').value.trim() || null, ordem: Number($('category-order').value || 0), ativo: $('category-active').checked };
    if (!payload.nome) { toast('Informe o nome da categoria.', 'error'); return; }
    try {
      await api(id ? `${API}/categorias/${id}` : `${API}/categorias`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria salva.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function deleteCategory(id) {
    if (!await budgetConfirm({
      title: 'Excluir categoria',
      message: 'Excluir esta categoria? Os orçamentos existentes continuarão salvos.',
      confirmText: 'Excluir categoria',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/categorias/${id}`, { method: 'DELETE' });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria excluída.');
    } catch (error) { toast(error.message, 'error'); }
  }

  function renderKits() {
    $('kits-list').innerHTML = state.kits.map((kit) => `
      <article class="kit-settings-card settings-simple-row ${kit.ativo === false ? 'is-inactive' : ''}">
        <span class="kit-settings-icon settings-simple-icon"><i class="fa-solid fa-layer-group"></i></span>
        <div class="kit-settings-copy">
          <h5>${escapeHtml(kit.nome)}</h5>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para inserção no orçamento.')}</p>
        </div>
        <div class="kit-settings-meta">
          <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
          <strong>${formatMoney(kit.valor_estimado)}</strong>
        </div>
        <span class="settings-status-badge ${kit.ativo === false ? 'inactive' : ''}">${kit.ativo === false ? 'Inativo' : 'Ativo'}</span>
        <div class="kit-settings-actions">
          <button class="budget-action-btn" data-edit-kit="${kit.id}" type="button" title="Editar kit"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn" data-duplicate-kit="${kit.id}" type="button" title="Duplicar kit"><i class="fa-regular fa-copy"></i></button>
          <button class="budget-action-btn danger" data-delete-kit="${kit.id}" type="button" title="Excluir kit"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-solid fa-layer-group"></i></span><strong>Nenhum kit criado</strong><small>Monte um conjunto de produtos para adicioná-los ao orçamento com um clique.</small></div>`;
  }

  function openKitEditor(kit = null) {
    $('kits-list-view').classList.add('is-hidden');
    $('kit-editor').classList.remove('is-hidden');
    $('kit-id').value = kit?.id || '';
    $('kit-name').value = kit?.nome || '';
    $('kit-description').value = kit?.descricao || '';
    $('kit-active').checked = kit?.ativo !== false;
    state.kitItems = (kit?.itens || []).map(normalizeItem);
    $('kit-editor-title').textContent = kit ? 'Editar kit' : 'Novo kit';
    $('kit-product-search').hidden = true;
    resetProductSearch('kit');
    renderKitItems();
  }

  function closeKitEditor() {
    $('kit-editor').classList.add('is-hidden');
    $('kits-list-view').classList.remove('is-hidden');
    state.kitItems = [];
    resetProductSearch('kit');
  }

  async function editKit(id) {
    try {
      openKitEditor(await api(`${API}/kits/${id}`));
    } catch (error) {
      toast(error.message || 'Não foi possível abrir o kit.', 'error');
    }
  }

  function renderKitItems() {
    const count = state.kitItems.length;
    const estimatedTotal = state.kitItems.reduce((sum, item) => sum + parseNumber(item.quantidade) * parseNumber(item.valor_unitario), 0);
    $('kit-items-count').textContent = String(count);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
    $('kit-items-body').innerHTML = state.kitItems.map((item, index) => `
      <tr data-kit-index="${index}">
        <td><div class="kit-product-cell"><strong>${escapeHtml(item.descricao || 'Produto')}</strong><small>${escapeHtml(item.referencia || 'Produto cadastrado')}</small></div></td>
        <td>${escapeHtml(item.codigo || '—')}</td>
        <td>${escapeHtml(item.unidade || 'UN')}</td>
        <td><input class="kit-quantity-input" data-kit-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td>${formatMoney(item.valor_unitario)}</td>
        <td class="kit-line-total">${formatMoney(parseNumber(item.quantidade) * parseNumber(item.valor_unitario))}</td>
        <td><button class="item-remove" data-remove-kit-item="${index}" type="button" title="Remover produto"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum produto adicionado ao kit.</td></tr>';
  }

  function updateKitItem(input) {
    const row = input.closest('tr');
    const item = state.kitItems[Number(row?.dataset.kitIndex)];
    if (!item) return;
    item.quantidade = Math.max(parseNumber(input.value), 0.0001);
    row.querySelector('.kit-line-total').textContent = formatMoney(item.quantidade * parseNumber(item.valor_unitario));
    const estimatedTotal = state.kitItems.reduce((sum, current) => sum + parseNumber(current.quantidade) * parseNumber(current.valor_unitario), 0);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
  }

  async function saveKit() {
    const button = $('btn-salvar-kit');
    const id = Number($('kit-id').value) || null;
    const payload = {
      nome: $('kit-name').value.trim(),
      descricao: $('kit-description').value.trim() || null,
      ativo: $('kit-active').checked,
      itens: state.kitItems.map((item, index) => ({
        produto_id: Number(item.produto_id),
        quantidade: Math.max(parseNumber(item.quantidade), 0.0001),
        ordem: index,
      })),
    };
    if (!payload.nome) { toast('Informe o nome do kit.', 'error'); return; }
    if (!payload.itens.length) { toast('Adicione pelo menos um produto ao kit.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/kits/${id}` : `${API}/kits`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      closeKitEditor();
      toast('Kit salvo. Ele já está disponível em Modelo e em Adicionar kit.');
    } catch (error) {
      toast(error.message || 'Não foi possível salvar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function duplicateKit(id) {
    try {
      await api(`${API}/kits/${id}/duplicar`, { method: 'POST' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      toast('Kit duplicado.');
    } catch (error) {
      toast(error.message || 'Não foi possível duplicar o kit.', 'error');
    }
  }

  async function deleteKit(id) {
    if (!await budgetConfirm({
      title: 'Excluir kit',
      message: 'Excluir este kit? Os produtos e orçamentos existentes não serão apagados.',
      confirmText: 'Excluir kit',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/kits/${id}`, { method: 'DELETE' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      closeKitEditor();
      toast('Kit excluído.');
    } catch (error) {
      toast(error.message || 'Não foi possível excluir o kit.', 'error');
    }
  }

  function renderTemplates() {
    $('templates-list').innerHTML = state.templates.map((template) => `
      <article class="template-card settings-simple-row ${template.ativo === false ? 'is-inactive' : ''}">
        <span class="template-card-icon settings-simple-icon"><i class="fa-regular fa-file-lines"></i></span>
        <div class="template-card-copy">
          <h5>${escapeHtml(template.nome)}</h5>
          <p>${escapeHtml(template.descricao || template.titulo || 'Estrutura reutilizável de orçamento.')}</p>
        </div>
        <div class="template-card-meta">
          <span><i class="fa-regular fa-folder"></i> ${escapeHtml(template.categoria_nome || 'Sem categoria')}</span>
          ${template.validade_dias ? `<span><i class="fa-regular fa-calendar"></i> ${template.validade_dias} dias</span>` : ''}
        </div>
        <span class="settings-status-badge ${template.ativo === false ? 'inactive' : ''}">${template.ativo === false ? 'Inativo' : 'Ativo'}</span>
        <div class="template-card-actions">
          <button class="budget-action-btn" data-edit-template="${template.id}" type="button" title="Editar modelo"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-template="${template.id}" type="button" title="Excluir modelo"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-regular fa-file-lines"></i></span><strong>Nenhum modelo criado</strong><small>Crie estruturas prontas para preencher títulos, condições e itens automaticamente.</small></div>`;
  }

  function openTemplateEditor(template = null) {
    $('templates-list-view').classList.add('is-hidden');
    $('template-editor').classList.remove('is-hidden');
    $('template-id').value = template?.id || '';
    $('template-name').value = template?.nome || '';
    $('template-category').value = template?.categoria_id || '';
    $('template-title').value = template?.titulo || '';
    $('template-validity').value = template?.validade_dias ?? state.meta.configuracao?.validade_padrao_dias ?? 7;
    $('template-deadline').value = template?.prazo_execucao || '';
    $('template-conditions').value = template?.condicoes || '';
    $('template-notes').value = template?.observacoes || '';
    $('template-active').checked = template?.ativo !== false;
    state.templateItems = (template?.itens || []).map(normalizeItem);
    $('template-editor-title').textContent = template ? 'Editar modelo' : 'Novo modelo';
    renderTemplateItems();
  }

  function closeTemplateEditor() {
    $('template-editor').classList.add('is-hidden');
    $('templates-list-view').classList.remove('is-hidden');
    state.templateItems = [];
  }

  async function editTemplate(id) {
    try { openTemplateEditor(await api(`${API}/modelos/${id}`)); }
    catch (error) { toast(error.message, 'error'); }
  }

  function renderTemplateItems() {
    $('template-items-body').innerHTML = state.templateItems.map((item, index) => `
      <tr data-template-index="${index}"><td><textarea data-template-field="descricao">${escapeHtml(item.descricao)}</textarea></td><td><input data-template-field="codigo" value="${escapeHtml(item.codigo)}" /></td><td><input data-template-field="unidade" value="${escapeHtml(item.unidade)}" /></td><td><input data-template-field="quantidade" value="${inputMoney(item.quantidade)}" /></td><td><input data-template-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" /></td><td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}"><input data-template-field="custo_unitario" value="${inputMoney(item.custo_unitario)}" /></td><td><button class="item-remove" data-remove-template-item="${index}" type="button"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum item no modelo.</td></tr>';
  }

  function updateTemplateItem(input) {
    const item = state.templateItems[Number(input.closest('tr').dataset.templateIndex)];
    const field = input.dataset.templateField;
    item[field] = ['quantidade', 'valor_unitario', 'custo_unitario'].includes(field) ? parseNumber(input.value) : input.value;
  }

  async function saveTemplate() {
    const button = $('btn-salvar-modelo');
    const id = Number($('template-id').value) || null;
    const payload = {
      nome: $('template-name').value.trim(), categoria_id: Number($('template-category').value) || null,
      titulo: $('template-title').value.trim() || null, descricao: null,
      validade_dias: Number($('template-validity').value || 0), prazo_execucao: $('template-deadline').value.trim() || null,
      condicoes: $('template-conditions').value.trim() || null, observacoes: $('template-notes').value.trim() || null,
      pagamentos: [], ativo: $('template-active').checked, itens: state.templateItems.map((item, index) => ({ ...item, ordem: index })),
    };
    if (!payload.nome) { toast('Informe o nome do modelo.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/modelos/${id}` : `${API}/modelos`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); closeTemplateEditor(); toast('Modelo salvo.');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteTemplate(id) {
    if (!await budgetConfirm({
      title: 'Excluir modelo',
      message: 'Excluir este modelo de orçamento?',
      confirmText: 'Excluir modelo',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/modelos/${id}`, { method: 'DELETE' });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); toast('Modelo excluído.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function handleInitialRoute() {
    if (state.initialRouteHandled) return;
    state.initialRouteHandled = true;
    const params = new URLSearchParams(window.location.search);
    const budgetId = Number(params.get('orcamento_id') || 0);
    const clientId = Number(params.get('cliente_id') || 0);
    if (budgetId) {
      await openEditBudget(budgetId);
      return;
    }
    if (params.get('novo') === '1' || clientId) {
      await openNewBudget();
      if (clientId) await selectClient(clientId);
    }
  }

  function bindEvents() {
    $('budget-confirm-cancel')?.addEventListener('click', () => closeBudgetConfirm(false));
    $('budget-confirm-ok')?.addEventListener('click', () => closeBudgetConfirm(true));
    $('budget-confirm-backdrop')?.addEventListener('click', (event) => {
      if (event.target === $('budget-confirm-backdrop')) closeBudgetConfirm(false);
    });

    $('btn-novo-orcamento').addEventListener('click', openNewBudget);
    $('btn-atualizar-orcamentos').addEventListener('click', () => loadBudgets());
    $('btn-configurar-orcamentos').addEventListener('click', openSettings);
    $('btn-limpar-filtros').addEventListener('click', () => {
      $('busca-orcamentos').value = '';
      $('filtro-status-orcamentos').value = '';
      loadBudgets({ offset: 0 });
    });
    $('busca-orcamentos').addEventListener('input', () => {
      clearTimeout(state.budgetSearchTimer);
      state.budgetSearchTimer = setTimeout(() => loadBudgets({ offset: 0 }), 250);
    });
    $('filtro-status-orcamentos').addEventListener('change', () => loadBudgets({ offset: 0 }));

    $('paginacao-orcamentos')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-budget-page]');
      if (!button || button.disabled) return;

      const limit = Number(state.budgetPage.limit || 50);
      const total = Number(state.budgetPage.total || 0);
      const lastOffset = Math.max(0, (Math.ceil(total / limit) - 1) * limit);
      let offset = Number(state.budgetPage.offset || 0);

      if (button.dataset.budgetPage === 'first') offset = 0;
      if (button.dataset.budgetPage === 'prev') offset = Math.max(0, offset - limit);
      if (button.dataset.budgetPage === 'next') offset = Math.min(lastOffset, offset + limit);
      if (button.dataset.budgetPage === 'last') offset = lastOffset;

      await loadBudgets({ offset });
    });

    $('tbody-orcamentos').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action][data-id]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const actions = { edit: openEditBudget, print: printBudget, whatsapp: sendWhatsApp, duplicate: duplicateBudget, delete: deleteBudget };
      actions[button.dataset.action]?.(id);
    });

    $('btn-fechar-budget-modal').addEventListener('click', requestCloseBudgetModal);
    $('btn-cancelar-orcamento').addEventListener('click', requestCloseBudgetModal);
    $('btn-budget-acoes')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
      setBudgetActionsMenuOpen(!expanded);
    });
    $('budget-actions-menu')?.addEventListener('click', (event) => {
      const action = event.target.closest('button');
      if (action && !action.disabled) closeBudgetActionsMenu();
    });
    $('form-orcamento')?.addEventListener('input', (event) => {
      if (event.target?.readOnly || event.target?.disabled) return;
      markBudgetDirty();
    });
    $('form-orcamento')?.addEventListener('change', (event) => {
      if (event.target?.readOnly || event.target?.disabled) return;
      markBudgetDirty();
    });
    $('form-orcamento')?.addEventListener('click', (event) => {
      if (event.target.closest('#btn-adicionar-item, #btn-adicionar-pagamento, [data-remove-item], [data-move-item], [data-remove-payment], [data-add-kit]')) markBudgetDirty();
    });
    $('btn-toggle-budget-maximize')?.addEventListener('click', toggleBudgetMaximized);
    $('btn-imprimir-analise-financeira')?.addEventListener('click', printFinancialAnalysis);
    $('btn-salvar-orcamento').addEventListener('click', saveBudget);
    $('btn-enviar-financeiro')?.addEventListener('click', enviarVendaFinanceiro);
    $('btn-cancelar-envio-financeiro')?.addEventListener('click', cancelarEnvioFinanceiro);
    $('btn-abrir-financeiro-orcamento')?.addEventListener('click', abrirVendaNoFinanceiro);
    $('btn-imprimir-orcamento').addEventListener('click', printCurrent);
    $('btn-whatsapp-orcamento').addEventListener('click', () => state.currentId && sendWhatsApp(state.currentId));
    $('btn-gerar-link-cliente')?.addEventListener('click', openProposalClientPreparation);
    $('btn-gerar-contrato-cliente')?.addEventListener('click', openContractClient);
    $('btn-enviar-assinatura-contract-client')?.addEventListener('click', sendContractToSignature);
    $('btn-cancelar-assinatura-contract-client')?.addEventListener('click', cancelContractSignature);
    $('btn-pdf-assinado-contract-client')?.addEventListener('click', openSignedContractPdf);
    $('btn-fechar-contract-client')?.addEventListener('click', () => closeOverlay('contract-client-modal'));
    $('btn-cancelar-contract-client')?.addEventListener('click', () => closeOverlay('contract-client-modal'));
    $('btn-gerar-contract-client')?.addEventListener('click', generateContractClient);
    $('btn-visualizar-contract-client')?.addEventListener('click', () => openContractPdf(false));
    $('btn-baixar-contract-client')?.addEventListener('click', () => openContractPdf(true));
    $('btn-fechar-proposal-client')?.addEventListener('click', () => closeOverlay('proposal-client-modal'));
    $('btn-cancelar-proposal-client')?.addEventListener('click', () => closeOverlay('proposal-client-modal'));
    $('btn-usar-pagamento-orcamento')?.addEventListener('click', useBudgetPaymentInProposal);
    $('btn-salvar-proposal-client')?.addEventListener('click', saveProposalClientPreparation);
    $('btn-copiar-proposal-link')?.addEventListener('click', copyProposalClientLink);
    $('btn-abrir-proposal-link')?.addEventListener('click', openProposalClientLink);
    $('btn-regenerar-proposal-link')?.addEventListener('click', regenerateProposalClientLink);
    $('btn-desativar-proposal-link')?.addEventListener('click', deactivateProposalClientLink);
    $('btn-aprovar-margem').addEventListener('click', approveMargin);
    $$('.budget-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('service-proposal-model-grid')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-service-proposal-model]');
      if (!button) return;
      const nextModel = button.dataset.serviceProposalModel || 'padrao';
      if (nextModel !== 'padrao' && !canUseNilsonProposalModels()) {
        toast('Estes modelos de monitoramento são exclusivos da conta configurada.', 'error');
        return;
      }
      if (nextModel === serviceProposalSelectedModel()) return;
      if (serviceProposalSelectedModel() !== 'padrao') {
        const ok = await budgetConfirm({
          title: 'Trocar modelo de proposta',
          message: 'Os serviços, textos e valores personalizados do modelo atual serão substituídos.',
          confirmText: 'Trocar modelo',
          cancelText: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
      }
      applyServiceProposalModel(nextModel, { preserveDocumentName: false, markDirty: true });
    });
    $('btn-reset-service-proposal')?.addEventListener('click', resetCurrentServiceProposal);
    $('service-proposal-services')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-service-proposal-toggle-section]');
      if (!button) return;
      toggleServiceProposalSection(button.dataset.serviceProposalToggleSection);
    });
    $('service-proposal-services')?.addEventListener('change', syncServiceProposalStateFromForm);
    $('service-proposal-values')?.addEventListener('input', (event) => {
      if (!event.target.matches('[data-service-proposal-value]')) return;
      syncServiceProposalStateFromForm();
    });
    ['service-proposal-introduction', 'service-proposal-conditions', 'service-proposal-notes'].forEach((id) => {
      $(id)?.addEventListener('input', syncServiceProposalStateFromForm);
    });
    $('orcamento-status').addEventListener('change', () => { updateStatusPreview(); syncRefreshPricesButton(); syncFinanceiroActions(state.current); });
    $('orcamento-titulo').addEventListener('input', (event) => {
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = event.target.value.trim() || 'Novo orçamento';
    });
    $('orcamento-modelo').addEventListener('change', (event) => applyTemplate(event.target.value));

    $('orcamento-cliente-busca').addEventListener('focus', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('click', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('input', () => {
      $('orcamento-cliente-id').value = '';
      state.selectedClient = null;
      syncClientEditButton();
      searchClients();
    });
    $('btn-editar-cliente-orcamento')?.addEventListener('click', openSelectedClientEditor);
    $('orcamento-cliente-resultados').addEventListener('click', (event) => { const button = event.target.closest('[data-client-id]'); if (button) selectClient(button.dataset.clientId); });
    $('orcamento-cliente-resultados').addEventListener('scroll', loadMoreClientsOnScroll, { passive: true });
    $('btn-usar-endereco-cliente').addEventListener('click', async () => {
      const id = Number($('orcamento-cliente-id').value);
      if (!id) { toast('Selecione um cliente primeiro.', 'error'); return; }
      if (!state.selectedClient?.endereco) state.selectedClient = await api(`${API_CLIENTS}/${id}`);
      fillAddressFromClient(state.selectedClient, true);
    });

    $('btn-atualizar-precos-itens')?.addEventListener('click', refreshCurrentBudgetPrices);
    $('btn-adicionar-kit').addEventListener('click', openKitPicker);
    $('btn-fechar-kit-picker').addEventListener('click', () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
    });
    $('btn-cancelar-kit-picker').addEventListener('click', () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
    });
    $('btn-kit-picker-layout')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleKitLayoutMenu();
    });
    $('kit-layout-menu')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-kit-layout]');
      if (!option) return;
      setKitPickerLayout(option.dataset.kitLayout);
      closeKitLayoutMenu();
    });
    $('kit-picker-search-input').addEventListener('input', renderKitPicker);
    $('kit-picker-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-kit]');
      if (button) addKitToBudget(Number(button.dataset.addKit), button);
    });
    $('btn-gerenciar-kits').addEventListener('click', async () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
      await openSettings();
      setSettingsTab('kits');
    });
    document.addEventListener('click', (event) => {
      const kitTrigger = event.target.closest('#btn-kit-picker-layout');
      const kitPanel = event.target.closest('#kit-layout-menu');
      if (!kitTrigger && !kitPanel) closeKitLayoutMenu();

      const productTrigger = event.target.closest('#btn-product-search-layout');
      const productPanel = event.target.closest('#product-layout-menu');
      if (!productTrigger && !productPanel) closeProductLayoutMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeKitLayoutMenu();
        closeProductLayoutMenu();
      }
    });

    $('btn-buscar-produto').addEventListener('click', () => {
      const box = $('produto-search-box');
      box.hidden = !box.hidden;
      closeProductLayoutMenu();
      if (!box.hidden) {
        updateProductPickerLayoutUI();
        const input = $('produto-search-input');
        input.focus();
        if (input.value.trim()) showProductOptions('budget');
        else renderBudgetProductSearchPrompt();
      }
    });
    $('btn-product-search-layout')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleProductLayoutMenu();
    });
    $('product-layout-menu')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-product-layout]');
      if (!option) return;
      setProductPickerLayout(option.dataset.productLayout);
      closeProductLayoutMenu();
    });
    $('btn-adicionar-item').addEventListener('click', () => addManualItem('budget'));
    $('produto-search-input').addEventListener('input', debounce((event) => handleBudgetProductSearch(event.target.value), 250));
    $('produto-search-results').addEventListener('scroll', () => loadMoreProductsOnScroll('budget'), { passive: true });
    $('produto-search-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'budget'); });
    $('budget-items-body').addEventListener('focusin', (event) => {
      if (event.target.dataset.field !== 'codigo') return;
      const row = event.target.closest('tr[data-index]');
      const item = state.items[Number(row?.dataset.index)];
      if (!item) return;
      event.target.dataset.originalCode = item.codigo || '';
      event.target.dataset.originalProductId = item.produto_id || '';
    });
    $('budget-items-body').addEventListener('input', (event) => { if (event.target.dataset.field) updateItemField(event.target); });
    $('budget-items-body').addEventListener('keydown', (event) => {
      if (event.target.dataset.field === 'codigo' && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });
    $('budget-items-body').addEventListener('focusout', (event) => {
      const field = event.target.dataset.field;
      if (field === 'codigo') {
        replaceBudgetItemByCode(event.target);
        return;
      }
      if (!['quantidade', 'valor_unitario', 'desconto', 'custo_unitario'].includes(field)) return;
      if (field === 'custo_unitario' && !String(event.target.value || '').trim()) event.target.value = '';
      else event.target.value = field === 'quantidade' ? inputQuantity(event.target.value) : inputMoney(event.target.value);
      updateItemField(event.target);
    });
    $('budget-items-body').addEventListener('click', (event) => {
      const moveButton = event.target.closest('[data-move-item]');
      if (moveButton) {
        moveBudgetItem(Number(moveButton.dataset.moveItem), Number(moveButton.dataset.moveDirection));
        return;
      }
      const removeButton = event.target.closest('[data-remove-item]');
      if (removeButton) {
        state.items.splice(Number(removeButton.dataset.removeItem), 1);
        renderItems();
        updateTotals();
      }
    });

    ['orcamento-desconto-tipo', 'orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('input', updateTotals));
    ['orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('blur', (event) => { event.target.value = inputMoney(event.target.value); updateTotals(); }));
    $('btn-adicionar-pagamento').addEventListener('click', () => { state.payments.push(normalizePayment({ nome: 'Nova condição' })); renderPayments(); });
    $('payment-options').addEventListener('input', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('change', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-payment]'); if (button) { state.payments.splice(Number(button.dataset.removePayment), 1); renderPayments(); } });
    $('orcamento-emitente-id')?.addEventListener('change', renderPreviewIfVisible);
    ['orcamento-titulo', 'orcamento-nome-documento', 'orcamento-condicoes', 'orcamento-observacoes', 'orcamento-prazo-execucao', 'orcamento-titulo-capa', 'orcamento-subtitulo-capa', 'orcamento-usar-capa', 'orcamento-categoria', 'orcamento-consultor', 'orcamento-data-emissao', 'orcamento-data-validade'].forEach((id) => $(id).addEventListener('input', renderPreviewIfVisible));
    $('orcamento-escala-preset').addEventListener('change', (event) => {
      if (event.target.value === 'custom') return;
      syncBudgetScale(event.target.value);
    });
    $('orcamento-escala-documento').addEventListener('input', (event) => syncBudgetScale(event.target.value));
    $('btn-restaurar-escala-documento').addEventListener('click', () => syncBudgetScale(companyDocumentScale()));

    // Settings
    $('btn-fechar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-cancelar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-salvar-settings').addEventListener('click', () => {
      if (state.settingsTab === 'emitentes') {
        saveEmitter($('btn-salvar-settings'));
        return;
      }
      saveSettings();
    });
    $('btn-novo-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-cancelar-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-salvar-emitente')?.addEventListener('click', saveEmitter);
    $('emitters-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-emitter]'); const del = event.target.closest('[data-delete-emitter]'); if (edit) editEmitter(edit.dataset.editEmitter); if (del) deleteEmitter(del.dataset.deleteEmitter); });
    $$('.settings-tabs button').forEach((button) => button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab)));
    $('config-cor').addEventListener('input', syncSettingsColorFromPicker);
    $('config-cor-hex').addEventListener('input', () => syncSettingsColorFromText(false));
    $('config-cor-hex').addEventListener('blur', () => syncSettingsColorFromText(true));
    $('config-escala-preset').addEventListener('change', (event) => {
      if (event.target.value === 'custom') return;
      syncSettingsScale(event.target.value);
    });
    $('config-escala-documento').addEventListener('input', (event) => syncSettingsScale(event.target.value));
    $('config-modelo-documento').addEventListener('change', updateSettingsConditionalFields);
    $('config-usar-capa').addEventListener('change', updateSettingsConditionalFields);
    $('btn-nova-categoria').addEventListener('click', resetCategoryEditor);
    $('btn-salvar-categoria').addEventListener('click', saveCategory);
    $('categories-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-category]'); const del = event.target.closest('[data-delete-category]'); if (edit) editCategory(edit.dataset.editCategory); if (del) deleteCategory(del.dataset.deleteCategory); });
    $('btn-novo-kit').addEventListener('click', () => openKitEditor());
    $('btn-voltar-kits').addEventListener('click', closeKitEditor);
    $('btn-cancelar-kit').addEventListener('click', closeKitEditor);
    $('btn-salvar-kit').addEventListener('click', saveKit);
    $('kits-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-kit]');
      const duplicate = event.target.closest('[data-duplicate-kit]');
      const del = event.target.closest('[data-delete-kit]');
      if (edit) editKit(edit.dataset.editKit);
      if (duplicate) duplicateKit(duplicate.dataset.duplicateKit);
      if (del) deleteKit(del.dataset.deleteKit);
    });
    $('btn-kit-product').addEventListener('click', () => {
      const box = $('kit-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('kit-product-input').focus();
        showProductOptions('kit');
      }
    });
    $('kit-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'kit'), 250));
    $('kit-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('kit'), { passive: true });
    $('kit-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'kit'); });
    $('kit-items-body').addEventListener('input', (event) => { if (event.target.dataset.kitField) updateKitItem(event.target); });
    $('kit-items-body').addEventListener('focusout', (event) => { if (event.target.dataset.kitField === 'quantidade') { event.target.value = inputQuantity(event.target.value); updateKitItem(event.target); } });
    $('kit-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-kit-item]'); if (button) { state.kitItems.splice(Number(button.dataset.removeKitItem), 1); renderKitItems(); } });

    $('btn-novo-modelo').addEventListener('click', () => openTemplateEditor());
    $('btn-voltar-modelos').addEventListener('click', closeTemplateEditor);
    $('btn-cancelar-modelo').addEventListener('click', closeTemplateEditor);
    $('btn-salvar-modelo').addEventListener('click', saveTemplate);
    $('templates-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-template]'); const del = event.target.closest('[data-delete-template]'); if (edit) editTemplate(edit.dataset.editTemplate); if (del) deleteTemplate(del.dataset.deleteTemplate); });
    $('btn-template-product').addEventListener('click', () => {
      const box = $('template-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('template-product-input').focus();
        showProductOptions('template');
      }
    });
    $('btn-template-manual').addEventListener('click', () => addManualItem('template'));
    $('template-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'template'), 250));
    $('template-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('template'), { passive: true });
    $('template-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'template'); });
    $('template-items-body').addEventListener('input', (event) => { if (event.target.dataset.templateField) updateTemplateItem(event.target); });
    $('template-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-template-item]'); if (button) { state.templateItems.splice(Number(button.dataset.removeTemplateItem), 1); renderTemplateItems(); } });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.autocomplete-field')) {
        $('orcamento-cliente-resultados').hidden = true;
        $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('#budget-actions-dropdown')) closeBudgetActionsMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('budget-confirm-backdrop')?.hidden) {
        event.preventDefault();
        closeBudgetConfirm(false);
        return;
      }
      if (event.key === 'Enter' && !$('budget-confirm-backdrop')?.hidden) {
        event.preventDefault();
        closeBudgetConfirm(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's' && isBudgetModalOpen()) {
        event.preventDefault();
        saveBudget();
        return;
      }
      if (event.key === 'Escape') {
        if ($('btn-budget-acoes')?.getAttribute('aria-expanded') === 'true') {
          closeBudgetActionsMenu();
          return;
        }
        if (!$('kit-picker-modal').hidden) closeOverlay('kit-picker-modal');
        else if (!$('settings-modal').hidden) closeOverlay('settings-modal');
        else if (!$('budget-modal').hidden) requestCloseBudgetModal();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    bootstrap();
  });
})();
