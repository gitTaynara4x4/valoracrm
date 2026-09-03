/*
 * ValoraCRM · Orçamentos · core.js
 * Estado global, constantes, modelos base, API, bootstrap e listagem principal.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
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
    serviceProposalTemplateDraft: null,
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
    const baseSections = model.copySectionsFrom
      ? SERVICE_PROPOSAL_MODELS[model.copySectionsFrom].sections
      : model.sections;
    const custom = state.meta?.modelos_proposta_personalizados?.[key];
    const sections = Array.isArray(custom?.sections) ? custom.sections : (baseSections || []);
    return {
      ...model,
      ...(custom && typeof custom === 'object' ? {
        introduction: custom.introduction ?? model.introduction ?? '',
        conditions: custom.conditions ?? model.conditions ?? '',
      } : {}),
      sections: JSON.parse(JSON.stringify(sections || [])),
      values: JSON.parse(JSON.stringify(model.values || [])),
      customized: Boolean(custom),
    };
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

  // Valores digitados seguem pt-BR: vírgula é decimal e ponto separa milhares.
  // Mantemos parseNumber para números já normalizados vindos da API (ex.: 1.6).
  function parseInputNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    let text = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
    if (!text) return 0;

    if (text.includes(',')) {
      const decimalIndex = text.lastIndexOf(',');
      const integerPart = text.slice(0, decimalIndex).replace(/[.,]/g, '');
      const decimalPart = text.slice(decimalIndex + 1).replace(/[.,]/g, '');
      text = decimalPart ? `${integerPart}.${decimalPart}` : integerPart;
    } else if (text.includes('.')) {
      const negative = text.startsWith('-');
      const unsigned = negative ? text.slice(1) : text;
      const groups = unsigned.split('.');
      const isThousands = groups.length > 1
        && /^[0-9]{1,3}$/.test(groups[0])
        && groups[0] !== '0'
        && groups.slice(1).every((group) => /^[0-9]{3}$/.test(group));
      if (isThousands) text = `${negative ? '-' : ''}${groups.join('')}`;
    }

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
