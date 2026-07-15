
// ==========================================
// AGENDA E LEMBRETES GLOBAIS
// Carrega o sino, avisos e componentes de histórico em todas as páginas.
// ==========================================
(() => {
  if (!document.querySelector('link[data-valora-agenda-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/frontend/css/agenda.css?v=20260715-agenda-fixa-leve-v8';
    link.dataset.valoraAgendaCss = 'true';
    document.head.appendChild(link);
  }

  if (!window.ValoraAgendaReady) {
    window.ValoraAgendaReady = new Promise((resolve, reject) => {
      if (window.ValoraAgenda) {
        resolve(window.ValoraAgenda);
        return;
      }
      const script = document.createElement('script');
      script.src = '/frontend/js/shared/agenda.js?v=20260715-agenda-fixa-leve-v8';
      script.defer = true;
      script.onload = () => resolve(window.ValoraAgenda);
      script.onerror = () => reject(new Error('Não foi possível carregar a agenda do Valora.'));
      document.head.appendChild(script);
    });
  }
})();

// 1. CARREGA O TEMA SALVO ASSIM QUE A PÁGINA ABRIR
(() => {
  const savedTheme = localStorage.getItem('valora_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

(() => {
  'use strict';

  function hasCookie(name) {
    try {
      const re = new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + '=');
      return re.test(document.cookie || '');
    } catch (e) {
      return false;
    }
  }

  function getLS(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function guessPlan() {
    try {
      const p = (localStorage.getItem('plano') || 'Essencial').toLowerCase();
      if (p === 'profissional') return 'Profissional';
      if (p === 'empresarial') return 'Empresarial';
      return 'Essencial';
    } catch (e) {
      return 'Essencial';
    }
  }

  if (!hasCookie('empresa_id')) {
    // Mantive comentado caso você esteja testando sem login obrigatório no momento
    // window.location.replace('/login');
    // return;
  }

  const nome = getLS('nome', 'Usuário');
  const email = getLS('email', 'email@empresa.com');
  const empresaId = getLS('empresa_id', '--');
  const plano = guessPlan();

  // Seletores
  const userName = document.getElementById('userName');
  const userEmail = document.getElementById('userEmail');
  const userAvatar = document.getElementById('userAvatar');

  const welcomeTitle = document.getElementById('welcomeTitle');
  const welcomeText = document.getElementById('welcomeText');

  const planName = document.getElementById('planName');
  const companyIdInfo = document.getElementById('companyIdInfo');

  const summaryUser = document.getElementById('summaryUser');
  const summaryEmail = document.getElementById('summaryEmail');
  const summaryEmpresaId = document.getElementById('summaryEmpresaId');
  const summaryPlano = document.getElementById('summaryPlano');

  // Popula os dados na tela
  if (userName) userName.textContent = nome;
  if (userEmail) userEmail.textContent = email;
  if (userAvatar) userAvatar.textContent = (nome || 'U').trim().charAt(0).toUpperCase();

  if (welcomeTitle) welcomeTitle.textContent = `Olá, ${nome.split(' ')[0]} 👋`;
  if (welcomeText) {
    welcomeText.textContent =
      'Sua conta foi criada com sucesso. Agora você pode cadastrar clientes, criar propostas e começar a estruturar sua operação dentro do Valora CRM.';
  }

  if (planName) planName.textContent = plano;
  if (companyIdInfo) companyIdInfo.textContent = `Empresa #${empresaId}`;

  if (summaryUser) summaryUser.textContent = nome;
  if (summaryEmail) summaryEmail.textContent = email;
  if (summaryEmpresaId) summaryEmpresaId.textContent = empresaId;
  if (summaryPlano) summaryPlano.textContent = plano;
})();

// ==========================================
// FUNÇÃO GLOBAL DE NOTIFICAÇÕES (TOAST)
// ==========================================
window.showToast = function(message, type = 'success') {
  let container = document.getElementById('valora-global-toast');
  if (!container) {
    container = document.createElement('div');
    container.id = 'valora-global-toast';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `valora-toast ${type}`;
  
  const icon = type === 'success' 
    ? `<i class="fa-solid fa-circle-check" style="color: var(--brand); font-size: 18px;"></i>` 
    : `<i class="fa-solid fa-circle-exclamation" style="color: #ef4444; font-size: 18px;"></i>`;
  
  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400); 
  }, 3500);
};



// ==========================================
// MODAL GLOBAL PADRÃO VALORA
// Um único jeito de abrir/fechar modal em todo o sistema.
// Uso: ValoraModal.open('modal-id') / ValoraModal.close('modal-id')
// ==========================================
(() => {
  'use strict';

  const OPEN_CLASS = 'show';
  const BODY_LOCK_CLASS = 'modal-open';

  function getModal(modalOrId) {
    if (!modalOrId) return null;
    if (typeof modalOrId === 'string') return document.getElementById(modalOrId);
    if (modalOrId instanceof HTMLElement) return modalOrId;
    return null;
  }

  function updateBodyLock() {
    const algumAberto = document.querySelector('.modal-overlay.show');
    document.body.classList.toggle(BODY_LOCK_CLASS, !!algumAberto);
  }

  function open(modalOrId) {
    const modal = getModal(modalOrId);

    if (!modal) {
      console.warn('[ValoraModal] Modal não encontrado:', modalOrId);
      return;
    }

    modal.hidden = false;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    modal.setAttribute('role', modal.getAttribute('role') || 'dialog');
    modal.setAttribute('aria-modal', modal.getAttribute('aria-modal') || 'true');

    document.body.classList.add(BODY_LOCK_CLASS);

    requestAnimationFrame(() => {
      modal.classList.add(OPEN_CLASS);

      const firstFocusable = modal.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (firstFocusable) {
        setTimeout(() => {
          try {
            firstFocusable.focus({ preventScroll: true });
          } catch (_) {
            firstFocusable.focus();
          }
        }, 80);
      }
    });
  }

  function close(modalOrId) {
    const modal = getModal(modalOrId);
    if (!modal) return;

    modal.classList.remove(OPEN_CLASS);
    modal.setAttribute('aria-hidden', 'true');

    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';
      updateBodyLock();
    }, 160);
  }

  function closeAll() {
    document.querySelectorAll('.modal-overlay.show').forEach((modal) => close(modal));
  }

  function bindGlobalEvents() {
    document.addEventListener('click', (event) => {
      const closeBtn = event.target.closest('[data-modal-close], [data-close-modal], .modal-close, .btn-close');

      if (closeBtn) {
        event.preventDefault();
        const target =
          closeBtn.dataset.modalClose ||
          closeBtn.dataset.closeModal ||
          closeBtn.closest('.modal-overlay')?.id;

        if (target) close(target);
        return;
      }

      const overlay = event.target.closest('.modal-overlay');
      if (overlay && event.target === overlay) {
        const bloquearCliqueFora = overlay.dataset.closeTarget === 'false';
        if (!bloquearCliqueFora) close(overlay);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modais = Array.from(document.querySelectorAll('.modal-overlay.show'));
      const ultimo = modais.at(-1);
      if (ultimo) close(ultimo);
    });
  }

  window.ValoraModal = { open, close, closeAll };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindGlobalEvents);
  } else {
    bindGlobalEvents();
  }
})();

// ==========================================
// FOOTER GLOBAL AUTOMÁTICO (NOVO E COMPLETO)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const mainElement = document.querySelector('.main');

  if (mainElement && !document.querySelector('.valora-footer')) {
    const footer = document.createElement('footer');
    footer.className = 'valora-footer';
    
    footer.innerHTML = `
      <div class="footer-content">
        <div class="footer-left">
          <span>&copy; 2026 Valora CRM.</span>
          <span class="footer-version">v1.0.0</span>
          <a href="#" class="footer-status" title="Verificar status dos servidores">
            <span class="status-dot"></span>
            Sistemas Operacionais
          </a>
        </div>

        <div class="footer-links">
          <a href="#"><i class="fa-solid fa-headset" style="margin-right: 4px;"></i> Suporte</a>
          <a href="#">Privacidade</a>
          <a href="#">Termos</a>
          
          <div class="footer-divider"></div>
          
          <a href="#" title="Nosso Instagram"><i class="fa-brands fa-instagram" style="font-size: 16px;"></i></a>
          <a href="#" title="Nosso LinkedIn"><i class="fa-brands fa-linkedin" style="font-size: 16px;"></i></a>
        </div>
      </div>
    `;

    mainElement.appendChild(footer);
  }
});
// ==========================================
// ROLAGEM HORIZONTAL DUPLICADA NO TOPO
// Mantém a barra original no fim da tabela e cria outra sincronizada no topo.
// Assim, tabelas com muitas colunas podem ser arrastadas sem descer a página.
// ==========================================
(() => {
  'use strict';

  const WRAPPER_SELECTOR = [
    '.valora-table-wrapper',
    '.table-wrapper',
    '.financeiro-table-wrap',
    '.proposal-table-wrap',
    '.contatos-table-wrapper',
    '.fornecedores-cotados-wrapper',
    '.budget-items-table-wrap'
  ].join(', ');

  const controllers = new WeakMap();
  let scanScheduled = false;

  function getScrollableContent(wrapper) {
    return wrapper.querySelector('table') || wrapper.firstElementChild;
  }

  function createTopScrollbar(wrapper) {
    if (!(wrapper instanceof HTMLElement)) return;
    if (controllers.has(wrapper)) return;
    if (wrapper.closest('.table-scroll-sync')) return;

    const content = getScrollableContent(wrapper);
    if (!(content instanceof HTMLElement)) return;

    const topScrollbar = document.createElement('div');
    topScrollbar.className = 'table-scroll-sync';
    topScrollbar.setAttribute('aria-label', 'Rolagem horizontal da tabela');
    topScrollbar.setAttribute('role', 'region');
    topScrollbar.tabIndex = 0;

    const topScrollbarInner = document.createElement('div');
    topScrollbarInner.className = 'table-scroll-sync__inner';
    topScrollbar.appendChild(topScrollbarInner);

    wrapper.parentNode?.insertBefore(topScrollbar, wrapper);

    let syncing = false;
    let updateFrame = 0;

    function syncScroll(source, target) {
      if (syncing) return;
      if (Math.abs(target.scrollLeft - source.scrollLeft) < 1) return;

      syncing = true;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        syncing = false;
      });
    }

    function update() {
      updateFrame = 0;

      if (!wrapper.isConnected || !topScrollbar.isConnected) return;

      const visibleWidth = Math.max(0, wrapper.clientWidth);
      const contentWidth = Math.max(
        wrapper.scrollWidth,
        content.scrollWidth,
        content.getBoundingClientRect().width
      );
      const hasHorizontalOverflow = visibleWidth > 0 && contentWidth > visibleWidth + 2;

      topScrollbarInner.style.width = `${Math.ceil(contentWidth)}px`;
      topScrollbar.classList.toggle('is-active', hasHorizontalOverflow);
      topScrollbar.setAttribute('aria-hidden', hasHorizontalOverflow ? 'false' : 'true');

      if (hasHorizontalOverflow) {
        topScrollbar.scrollLeft = wrapper.scrollLeft;
      } else {
        topScrollbar.scrollLeft = 0;
      }
    }

    function scheduleUpdate() {
      if (updateFrame) cancelAnimationFrame(updateFrame);
      updateFrame = requestAnimationFrame(update);
    }

    topScrollbar.addEventListener('scroll', () => syncScroll(topScrollbar, wrapper), { passive: true });
    wrapper.addEventListener('scroll', () => syncScroll(wrapper, topScrollbar), { passive: true });

    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleUpdate)
      : null;

    resizeObserver?.observe(wrapper);
    resizeObserver?.observe(content);

    const contentObserver = new MutationObserver(scheduleUpdate);
    contentObserver.observe(content, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });

    const controller = {
      update: scheduleUpdate,
      destroy() {
        resizeObserver?.disconnect();
        contentObserver.disconnect();
        topScrollbar.remove();
        controllers.delete(wrapper);
      }
    };

    controllers.set(wrapper, controller);
    scheduleUpdate();
  }

  function scan(root = document) {
    if (!root?.querySelectorAll) return;

    if (root instanceof HTMLElement && root.matches(WRAPPER_SELECTOR)) {
      createTopScrollbar(root);
    }

    root.querySelectorAll(WRAPPER_SELECTOR).forEach(createTopScrollbar);
  }

  function scheduleScan(root = document) {
    if (scanScheduled) return;
    scanScheduled = true;

    requestAnimationFrame(() => {
      scanScheduled = false;
      scan(root);
    });
  }

  function init() {
    scan(document);

    const pageObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList' || !mutation.addedNodes.length) continue;
        scheduleScan(document);
        break;
      }
    });

    pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    window.addEventListener('resize', () => {
      document.querySelectorAll(WRAPPER_SELECTOR).forEach((wrapper) => {
        controllers.get(wrapper)?.update();
      });
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();


// ==========================================
// RESPONSIVO REAL PARA TABELAS
// Em telas pequenas, transforma tabelas em cards usando os títulos do <thead>.
// Isso evita coluna cortada e texto saindo da tela no mobile.
// ==========================================
(() => {
  'use strict';

  function textFromHeader(th) {
    return String(th?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function enhanceTable(table) {
    if (!table || table.dataset.valoraResponsiveEnhanced === 'running') return;
    table.dataset.valoraResponsiveEnhanced = 'running';

    try {
      const headers = Array.from(table.querySelectorAll('thead th')).map(textFromHeader);
      if (!headers.length) return;

      Array.from(table.querySelectorAll('tbody tr')).forEach((row) => {
        const cells = Array.from(row.children).filter((el) => el && el.tagName === 'TD');
        cells.forEach((td, index) => {
          if (td.colSpan && Number(td.colSpan) > 1) return;
          if (!td.getAttribute('data-label')) {
            td.setAttribute('data-label', headers[index] || '');
          }
        });
      });
    } finally {
      delete table.dataset.valoraResponsiveEnhanced;
    }
  }

  function enhanceResponsiveTables(root = document) {
    const tables = root.querySelectorAll ? root.querySelectorAll('table') : [];
    tables.forEach(enhanceTable);
  }

  let scheduled = false;
  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceResponsiveTables(document);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    enhanceResponsiveTables(document);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        if (!mutation.addedNodes || !mutation.addedNodes.length) continue;
        scheduleEnhance();
        break;
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
})();


// ==========================================
// AJUDA GLOBAL CONTEXTUAL VALORA
// Botão "Ajuda" automático em todas as páginas que carregam app.js.
// ==========================================
(() => {
  'use strict';

  const HELP_DATA = {
    dashboard: {
      title: 'Ajuda do Dashboard',
      subtitle: 'Visão geral da operação e atalhos principais.',
      icon: 'fa-chart-line',
      steps: [
        'Use os cards para enxergar rapidamente cadastros, contratos, propostas e movimentações.',
        'Clique nos atalhos para ir direto ao módulo que precisa trabalhar.',
        'Atualize a página quando quiser conferir dados recém-criados em outros módulos.'
      ],
      tips: [
        'O Dashboard é para visão rápida; cadastros e alterações ficam nas telas específicas.',
        'Se algum número parecer desatualizado, use Ctrl + F5 ou o botão de atualizar da própria tela.'
      ]
    },
    clientes: {
      title: 'Ajuda de Clientes',
      subtitle: 'Cadastro, ficha principal, campos personalizados e dados comerciais.',
      icon: 'fa-user-group',
      steps: [
        'Clique em Novo cliente para cadastrar uma pessoa ou empresa.',
        'O código do cliente é do sistema: aparece na tela, mas não deve ser editado.',
        'Preencha os campos obrigatórios. Se faltar algo, o sistema deve levar direto ao campo.',
        'Use Formulários para escolher quais seções, campos e ícones aparecem na ficha.'
      ],
      tips: [
        'Não use o código como campo personalizado. Código é único e automático.',
        'Organize a ficha por seções: Dados básicos, Contato, Endereço, Financeiro e Observações.'
      ]
    },
    fornecedores: {
      title: 'Ajuda de Fornecedores',
      subtitle: 'Cadastro de parceiros, contatos e dados de compra.',
      icon: 'fa-truck',
      steps: [
        'Cadastre fornecedores com nome, e-mail, WhatsApp e dados comerciais.',
        'O código é único por empresa e gerado automaticamente pelo sistema.',
        'Use os campos personalizados para criar informações específicas de compra, prazo ou categoria.',
        'Os ícones das seções são configurados em Formulários → Fornecedores.'
      ],
      tips: [
        'Evite duplicar o mesmo fornecedor com nomes diferentes. Pesquise antes de cadastrar.',
        'Se um campo obrigatório estiver vazio, o sistema deve destacar e focar o campo.'
      ]
    },
    produtos: {
      title: 'Ajuda de Produtos',
      subtitle: 'Catálogo, estoque, preço, custo e movimentações.',
      icon: 'fa-box-open',
      steps: [
        'Cadastre produto ou serviço pelo botão Novo produto.',
        'O código do produto é automático, sequencial e não deve ser alterado.',
        'Use preço, custo, unidade e categoria para manter o catálogo organizado.',
        'Registre entradas e saídas quando usar controle de movimentação.'
      ],
      tips: [
        'Campos como código, estoque e preço não devem virar campos personalizados duplicados.',
        'Use Formulários → Produtos para criar seções como Fiscal, Estoque, Fornecedores e Observações.'
      ]
    },
    patrimonio: {
      title: 'Ajuda de Patrimônio',
      subtitle: 'Controle de bens, equipamentos, responsável e localização.',
      icon: 'fa-tags',
      steps: [
        'Cadastre bens da empresa, equipamentos em comodato ou itens de uso interno.',
        'Informe localização, responsável, número de série e status.',
        'O código do patrimônio é gerado pelo sistema e não deve ser editado.',
        'Use campos personalizados para informações extras, como garantia, manutenção e observações técnicas.'
      ],
      tips: [
        'Use status claro: ativo, manutenção, baixado ou extraviado.',
        'A seção com ícone ajuda o cliente a entender rápido onde preencher cada informação.'
      ]
    },
    cotacoes: {
      title: 'Ajuda de Cotações',
      subtitle: 'Solicitação, comparação e aprovação de compras.',
      icon: 'fa-scale-balanced',
      steps: [
        'Crie uma cotação para pesquisar preço de produto ou serviço.',
        'O código da cotação é automático e único por empresa.',
        'Preencha item, quantidade, fornecedor e valores quando disponíveis.',
        'Use status para acompanhar o andamento: rascunho, em análise, aprovada ou recusada.'
      ],
      tips: [
        'Cotações ajudam antes de virar produto, compra ou proposta.',
        'Se usar fornecedores cadastrados, a comparação fica mais organizada.'
      ]
    },
    orcamentos: {
      title: 'Ajuda de Orçamentos',
      subtitle: 'Produtos, serviços, valores, envio e aprovação comercial.',
      icon: 'fa-file-invoice-dollar',
      steps: [
        'Clique em Novo orçamento, selecione o cliente, o tipo e o consultor responsável.',
        'Use um modelo pronto ou adicione produtos e serviços manualmente.',
        'Configure desconto, frete, acréscimo e uma ou mais formas de pagamento.',
        'Preencha prazo, condições gerais, observações e a capa comercial opcional.',
        'Revise o documento, salve, imprima em PDF ou envie o resumo pelo WhatsApp.'
      ],
      tips: [
        'Owner e administrador podem criar categorias, modelos e regras globais do módulo.',
        'Custos e margem ficam restritos a usuários gerenciais e não aparecem no PDF do cliente.'
      ]
    },
    propostas: {
      title: 'Ajuda de Propostas',
      subtitle: 'Registros comerciais antigos, itens, valores e aprovação.',
      icon: 'fa-file-signature',
      steps: [
        'Crie propostas vinculadas a um cliente.',
        'Adicione itens, serviços, valores e condições comerciais.',
        'Acompanhe o status até aprovação, recusa ou cancelamento.',
        'Quando aprovada, a proposta pode alimentar o contrato.'
      ],
      tips: [
        'Propostas é o módulo legado; novos documentos comerciais devem ser criados em Orçamentos.',
        'Registros antigos são importados automaticamente quando a nova estrutura é inicializada.'
      ]
    },
    'contratos-admin': {
      title: 'Ajuda de Contratos',
      subtitle: 'Contratos vinculados ao cliente, proposta aprovada e anexos.',
      icon: 'fa-file-contract',
      steps: [
        'Selecione o cliente para criar um novo contrato.',
        'O número do contrato é do sistema: único por empresa, sequencial e não editável.',
        'Importe proposta aprovada quando existir para preencher dados comerciais.',
        'Depois de salvar, use anexos para contrato assinado, documentos e comprovantes.'
      ],
      tips: [
        'Não altere número de contrato na edição. Histórico e anexos dependem desse registro.',
        'Use motivo da alteração quando editar um contrato já existente.'
      ]
    },
    formularios: {
      title: 'Ajuda de Formulários',
      subtitle: 'Monte as fichas dos módulos com seções, campos e ícones.',
      icon: 'fa-wand-magic-sparkles',
      steps: [
        'Escolha o módulo: Clientes, Fornecedores, Produtos, Patrimônio, Cotações, Propostas ou Contratos.',
        'Crie seções para organizar a ficha. Cada seção pode ter um ícone.',
        'Adicione campos do sistema quando o dado já existe no cadastro.',
        'Crie campos personalizados só quando precisar de uma informação extra.',
        'Marque obrigatório apenas para campos realmente indispensáveis.'
      ],
      tips: [
        'Não crie campo personalizado duplicando código, nome ou status se já existir campo do sistema.',
        'Use ícones simples: dados básicos, contato, endereço, financeiro, anexos e histórico.'
      ]
    },
    usuarios: {
      title: 'Ajuda de Usuários',
      subtitle: 'Acesso, papéis, permissões e segurança.',
      icon: 'fa-user-shield',
      steps: [
        'Cadastre usuários da empresa com nome, e-mail e senha inicial.',
        'Escolha o papel: owner, admin, colaborador ou visualizador.',
        'Para colaborador e visualizador, configure permissões por módulo.',
        'E-mail pode existir em outra empresa; dentro da mesma empresa não pode repetir.'
      ],
      tips: [
        'Não desative o último owner da empresa.',
        'Use somente leitura para usuários que precisam consultar, mas não alterar dados.'
      ]
    },
    empresa: {
      title: 'Ajuda da Empresa',
      subtitle: 'Dados cadastrais, identidade e configurações da empresa.',
      icon: 'fa-building',
      steps: [
        'Confira nome, CNPJ, contatos e dados principais da empresa.',
        'Mantenha e-mail e telefone atualizados para documentos e comunicações.',
        'Use a logo da empresa para deixar propostas e telas mais profissionais.'
      ],
      tips: [
        'Dados da empresa aparecem em vários módulos, então evite abreviações confusas.'
      ]
    },
    configuracoes: {
      title: 'Ajuda de Configurações',
      subtitle: 'Preferências gerais e ajustes do sistema.',
      icon: 'fa-gear',
      steps: [
        'Use esta tela para ajustar preferências globais do Valora.',
        'Altere apenas configurações que você entende, porque podem afetar outras telas.',
        'Depois de alterar, atualize o navegador se a mudança visual não aparecer.'
      ],
      tips: [
        'Configuração global deve ser simples. Evite criar opções duplicadas em cada módulo.'
      ]
    },
    monitoramento: {
      title: 'Ajuda de Monitoramento',
      subtitle: 'Acompanhamento operacional e eventos.',
      icon: 'fa-tower-broadcast',
      steps: [
        'Use filtros para localizar eventos, clientes ou situações específicas.',
        'Confira status e detalhes antes de tomar ação.',
        'Mantenha registros organizados para auditoria e atendimento.'
      ],
      tips: [
        'Tela de monitoramento deve ser objetiva: menos clique, mais clareza.'
      ]
    },
    'area-cliente-admin': {
      title: 'Ajuda da Área do Cliente',
      subtitle: 'Configuração do portal e acessos do cliente.',
      icon: 'fa-id-badge',
      steps: [
        'Use esta tela para administrar o que o cliente acessa no portal.',
        'Confira vínculo com cliente e dados antes de liberar acesso.',
        'Revogue acessos quando não forem mais necessários.'
      ],
      tips: [
        'Portal do cliente precisa ser simples e seguro. Libere só o necessário.'
      ]
    },
    perfil: {
      title: 'Ajuda do Perfil',
      subtitle: 'Dados do usuário logado e preferências pessoais.',
      icon: 'fa-user',
      steps: [
        'Confira nome, e-mail e dados do usuário.',
        'Atualize informações pessoais quando necessário.',
        'Use senha forte para proteger o acesso ao CRM.'
      ],
      tips: [
        'Dados de perfil não substituem o cadastro da empresa.'
      ]
    },
    ajuda: {
      title: 'Central de Ajuda',
      subtitle: 'Orientações gerais para usar o Valora CRM.',
      icon: 'fa-circle-question',
      steps: [
        'Procure pelo módulo ou dúvida que precisa resolver.',
        'Use as explicações rápidas antes de chamar suporte.',
        'Quando algo não funcionar, anote a tela, ação e mensagem de erro.'
      ],
      tips: [
        'Uma boa ajuda reduz treinamento e evita erro de cadastro.'
      ]
    },
    default: {
      title: 'Ajuda da página',
      subtitle: 'Orientações rápidas para usar esta tela do Valora CRM.',
      icon: 'fa-circle-question',
      steps: [
        'Use os botões do topo para criar, atualizar ou gerenciar registros.',
        'Preencha campos obrigatórios antes de salvar.',
        'Se aparecer erro, leia a mensagem e confira os campos destacados.'
      ],
      tips: [
        'Ajuda contextual fica disponível no topo das páginas principais.'
      ]
    }
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getPageKey() {
    const path = String(window.location.pathname || '').split('/').pop() || 'dashboard.html';
    return path.replace(/\.html$/i, '') || 'dashboard';
  }

  function getHelpData() {
    const key = getPageKey();
    return HELP_DATA[key] || HELP_DATA.default;
  }

  function buildList(items) {
    return (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  function createHelpDrawer() {
    if (document.getElementById('valora-help-layer')) return;

    const data = getHelpData();
    const layer = document.createElement('div');
    layer.id = 'valora-help-layer';
    layer.className = 'valora-help-layer';
    layer.hidden = true;

    layer.innerHTML = `
      <div class="valora-help-backdrop" data-valora-help-close></div>
      <aside class="valora-help-panel" role="dialog" aria-modal="true" aria-labelledby="valora-help-title">
        <div class="valora-help-head">
          <div class="valora-help-titlebox">
            <span class="valora-help-titleicon"><i class="fa-solid ${escapeHtml(data.icon || 'fa-circle-question')}"></i></span>
            <div>
              <span class="valora-help-kicker">Ajuda rápida</span>
              <h2 id="valora-help-title">${escapeHtml(data.title)}</h2>
              <p>${escapeHtml(data.subtitle)}</p>
            </div>
          </div>
          <button class="valora-help-close" type="button" data-valora-help-close aria-label="Fechar ajuda">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="valora-help-body">
          <section class="valora-help-card">
            <h3><i class="fa-solid fa-list-check"></i> Como usar</h3>
            <ol>${buildList(data.steps)}</ol>
          </section>

          <section class="valora-help-card valora-help-card-soft">
            <h3><i class="fa-solid fa-lightbulb"></i> Dicas importantes</h3>
            <ul>${buildList(data.tips)}</ul>
          </section>

          <section class="valora-help-mini">
            <strong>Atalho:</strong>
            <span>pressione <kbd>Esc</kbd> para fechar esta ajuda.</span>
          </section>
        </div>
      </aside>
    `;

    document.body.appendChild(layer);
  }

  function openHelp() {
    createHelpDrawer();
    const layer = document.getElementById('valora-help-layer');
    if (!layer) return;

    layer.hidden = false;
    document.body.classList.add('valora-help-open');

    requestAnimationFrame(() => {
      layer.classList.add('is-open');
      const close = layer.querySelector('[data-valora-help-close]');
      if (close) {
        try { close.focus({ preventScroll: true }); } catch (_) { close.focus(); }
      }
    });
  }

  function closeHelp() {
    const layer = document.getElementById('valora-help-layer');
    if (!layer) return;

    layer.classList.remove('is-open');
    document.body.classList.remove('valora-help-open');

    setTimeout(() => {
      if (!layer.classList.contains('is-open')) layer.hidden = true;
    }, 180);
  }

  function addHelpButton() {
    if (document.querySelector('[data-valora-help-open]')) return;

    const data = getHelpData();
    const actions = document.querySelector('.topbar-actions, .contratos-actions');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = actions ? 'btn btn-secondary valora-page-help-btn' : 'valora-floating-help-btn';
    btn.setAttribute('data-valora-help-open', 'true');
    btn.setAttribute('aria-label', `Abrir ajuda: ${data.title}`);
    btn.innerHTML = actions
      ? '<i class="fa-solid fa-circle-question"></i><span>Ajuda</span>'
      : '<i class="fa-solid fa-circle-question"></i>';

    if (actions) {
      actions.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
  }

  function bindHelpEvents() {
    document.addEventListener('click', (event) => {
      const openBtn = event.target.closest('[data-valora-help-open]');
      if (openBtn) {
        event.preventDefault();
        openHelp();
        return;
      }

      const closeBtn = event.target.closest('[data-valora-help-close]');
      if (closeBtn) {
        event.preventDefault();
        closeHelp();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById('valora-help-layer')?.classList.contains('is-open')) {
        closeHelp();
      }
    });
  }

  function initPageHelp() {
    const pageKey = getPageKey();

    // Evita aparecer em telas públicas/login/cadastro.
    if (['login', 'cadastro', 'inicio'].includes(pageKey)) return;

    addHelpButton();
    createHelpDrawer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageHelp);
  } else {
    initPageHelp();
  }

  bindHelpEvents();
})();
