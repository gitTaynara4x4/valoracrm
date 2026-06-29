(function () {
  'use strict';

  const VERSION = '20260629-financeiro-menu';

  const ROUTES = {
    home: '/dashboard',
    clientes: '/clientes',
    fornecedores: '/fornecedores',
    cotacoes: '/cotacoes',
    produtos: '/produtos',
    patrimonio: '/patrimonio',
    financeiro: '/financeiro',
    'contas-receber': '/contas-receber',
    'contas-pagar': '/contas-pagar',
    'fluxo-caixa': '/fluxo-caixa',
    'categorias-financeiras': '/categorias-financeiras',
    'formas-pagamento': '/formas-pagamento',
    'contas-bancos': '/contas-bancos',
    'relatorios-financeiros': '/relatorios-financeiros',
    propostas: '/propostas',
    'area-cliente-admin': '/area-cliente-admin',
    'contratos-admin': '/contratos-admin',
    usuarios: '/usuarios',
    config: '/configuracoes',
    formularios: '/formularios',
    ajuda: '/ajuda',
    perfil: '/perfil',
    empresa: '/empresa'
  };

  function normalizePath(path) {
    return String(path || '/')
      .toLowerCase()
      .split('?')[0]
      .split('#')[0]
      .replace(/\/+$/, '') || '/';
  }

  function currentTarget() {
    const path = normalizePath(window.location.pathname);
    if (['/', '/dashboard', '/home', '/inicio', '/frontend/dashboard.html', '/frontend/inicio.html'].includes(path)) return 'home';
    if (path.includes('clientes')) return 'clientes';
    if (path.includes('fornecedores')) return 'fornecedores';
    if (path.includes('cotacoes')) return 'cotacoes';
    if (path.includes('produtos')) return 'produtos';
    if (path.includes('patrimonio')) return 'patrimonio';
    if (path.includes('contas-receber')) return 'contas-receber';
    if (path.includes('contas-pagar')) return 'contas-pagar';
    if (path.includes('fluxo-caixa')) return 'fluxo-caixa';
    if (path.includes('categorias-financeiras')) return 'categorias-financeiras';
    if (path.includes('formas-pagamento')) return 'formas-pagamento';
    if (path.includes('contas-bancos')) return 'contas-bancos';
    if (path.includes('relatorios-financeiros')) return 'relatorios-financeiros';
    if (path.includes('financeiro')) return 'financeiro';
    if (path.includes('propostas')) return 'propostas';
    if (path.includes('area-cliente-admin')) return 'area-cliente-admin';
    if (path.includes('contratos-admin')) return 'contratos-admin';
    if (path.includes('usuarios')) return 'usuarios';
    if (path.includes('configuracoes') || path.includes('config')) return 'config';
    if (path.includes('formularios')) return 'formularios';
    if (path.includes('ajuda')) return 'ajuda';
    if (path.includes('perfil')) return 'perfil';
    if (path.includes('empresa')) return 'empresa';
    return 'home';
  }

  function getStoredUser() {
    const nome = localStorage.getItem('nome') || localStorage.getItem('user_nome') || localStorage.getItem('usuario_nome') || 'Usuário';
    const email = localStorage.getItem('email') || localStorage.getItem('user_email') || localStorage.getItem('usuario_email') || 'email@empresa.com';
    return { nome, email };
  }

  function initialsFromName(name) {
    const clean = String(name || '').trim();
    if (!clean) return 'U';
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return clean.slice(0, 2).toUpperCase();
  }

  function navigate(target) {
    const url = ROUTES[target];
    if (!url) {
      console.warn('[Valora menu] target desconhecido:', target);
      return;
    }
    window.location.href = url;
  }

  function menuTemplate() {
    const { nome, email } = getStoredUser();
    const initials = initialsFromName(nome);

    return `
      <header class="valora-menu-shell" data-valora-menu-version="${VERSION}">
        <button class="valora-menu-logo-btn" type="button" data-target="home" aria-label="Valora">
          <img class="valora-menu-logo" src="/frontend/img/logo-favicon.jpg" alt="Valora" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <span class="valora-menu-fallback">V</span>
        </button>

        <button class="valora-menu-mobile-btn" id="valoraMobileMenuBtn" type="button" aria-label="Abrir menu" aria-controls="valoraMobilePanel" aria-expanded="false">
          <i class="fa-solid fa-bars"></i>
        </button>

        <nav class="valora-menu-desktop" aria-label="Menu principal">
          <div class="valora-menu-group" data-menu-group>
            <button class="valora-menu-trigger" type="button">Operação <i class="fa-solid fa-chevron-down"></i></button>
            <div class="valora-menu-dropdown">
              <button class="valora-menu-item" type="button" data-target="home">Dashboard</button>
              <button class="valora-menu-item" type="button" data-target="propostas">Propostas</button>
              <button class="valora-menu-item" type="button" data-target="contratos-admin">Contratos</button>
              <button class="valora-menu-item" type="button" data-target="area-cliente-admin">Dados para Contrato</button>
            </div>
          </div>

          <div class="valora-menu-group" data-menu-group>
            <button class="valora-menu-trigger" type="button">Cadastros <i class="fa-solid fa-chevron-down"></i></button>
            <div class="valora-menu-dropdown">
              <button class="valora-menu-item" type="button" data-target="clientes">Clientes</button>
              <button class="valora-menu-item" type="button" data-target="fornecedores">Fornecedores</button>
              <button class="valora-menu-item" type="button" data-target="cotacoes">Cotações</button>
              <button class="valora-menu-item" type="button" data-target="produtos">Produtos</button>
              <button class="valora-menu-item" type="button" data-target="patrimonio">Patrimônio</button>
              <button class="valora-menu-item" type="button" data-target="usuarios">Usuários</button>
              <button class="valora-menu-item" type="button" data-target="empresa">Empresa</button>
            </div>
          </div>

          <div class="valora-menu-group" data-menu-group>
            <button class="valora-menu-trigger" type="button">Financeiro <i class="fa-solid fa-chevron-down"></i></button>
            <div class="valora-menu-dropdown valora-menu-dropdown-financeiro">
              <button class="valora-menu-item" type="button" data-target="financeiro">Visão Geral</button>
              <button class="valora-menu-item" type="button" data-target="contas-receber">Contas a Receber</button>
              <button class="valora-menu-item" type="button" data-target="contas-pagar">Contas a Pagar</button>
              <button class="valora-menu-item" type="button" data-target="fluxo-caixa">Fluxo de Caixa</button>
              <button class="valora-menu-item" type="button" data-target="categorias-financeiras">Categorias</button>
              <button class="valora-menu-item" type="button" data-target="formas-pagamento">Formas de Pagamento</button>
              <button class="valora-menu-item" type="button" data-target="contas-bancos">Contas/Bancos</button>
              <button class="valora-menu-item" type="button" data-target="relatorios-financeiros">Relatórios Financeiros</button>
            </div>
          </div>

          <div class="valora-menu-group" data-menu-group>
            <button class="valora-menu-trigger" type="button">Relatórios <i class="fa-solid fa-chevron-down"></i></button>
            <div class="valora-menu-dropdown">
              <button class="valora-menu-item" type="button" data-target="home">Dashboard</button>
              <button class="valora-menu-item" type="button" data-target="formularios">Formulários</button>
            </div>
          </div>

          <button class="valora-menu-link" type="button" data-target="formularios">Formulários</button>
          <button class="valora-menu-link" type="button" data-target="ajuda">Ajuda</button>
        </nav>

        <div class="valora-menu-right">
          <button class="valora-menu-plain" type="button" data-target="ajuda">Primeiros passos</button>
          <button class="valora-menu-new" type="button" data-target="propostas"><span class="plus">+</span><span class="label">Nova Proposta</span></button>
          <button class="valora-menu-icon valora-menu-bell" type="button" data-target="home" aria-label="Notificações"><i class="fa-solid fa-bell"></i></button>

          <div class="valora-menu-pop" data-menu-pop="settings">
            <button class="valora-menu-icon" type="button" data-pop-trigger aria-label="Configurações"><i class="fa-solid fa-gear"></i></button>
            <div class="valora-pop-menu">
              <div class="valora-pop-title">Aparência</div>
              <button class="valora-theme-option" type="button" data-theme-option="light"><span>Tema claro</span></button>
              <button class="valora-theme-option" type="button" data-theme-option="dark"><span>Tema escuro</span></button>
              <div class="valora-pop-divider"></div>
              <button class="valora-user-item" type="button" data-target="config"><span><i class="fa-solid fa-sliders"></i> Configurações</span></button>
              <button class="valora-user-item" type="button" data-target="empresa"><span><i class="fa-solid fa-building"></i> Minha Empresa</span></button>
              <button class="valora-user-item" type="button" data-target="perfil"><span><i class="fa-regular fa-user"></i> Meu Perfil</span></button>
            </div>
          </div>

          <div class="valora-menu-pop" data-menu-pop="user">
            <button class="valora-menu-user" type="button" data-pop-trigger aria-label="Usuário"><span class="valora-user-initials">${initials}</span><i class="fa-solid fa-chevron-down"></i></button>
            <div class="valora-pop-menu">
              <div class="valora-user-card"><strong>${escapeHtml(nome)}</strong><span>${escapeHtml(email)}</span></div>
              <button class="valora-user-item" type="button" data-target="perfil"><span><i class="fa-regular fa-user"></i> Meu Perfil</span></button>
              <button class="valora-user-item" type="button" data-target="empresa"><span><i class="fa-solid fa-building"></i> Minha Empresa</span></button>
              <button class="valora-user-item" type="button" data-target="config"><span><i class="fa-solid fa-gear"></i> Configurações</span></button>
              <button class="valora-user-item danger" type="button" data-logout><span><i class="fa-solid fa-arrow-right-from-bracket"></i> Sair do Sistema</span></button>
            </div>
          </div>
        </div>
      </header>

      <div class="valora-menu-mobile-panel" id="valoraMobilePanel">
        <div class="valora-mobile-section">
          <div class="valora-mobile-title">Operação</div>
          <button class="valora-mobile-link" type="button" data-target="home"><i class="fa-solid fa-chart-line"></i> Dashboard</button>
          <button class="valora-mobile-link" type="button" data-target="propostas"><i class="fa-solid fa-file-signature"></i> Propostas</button>
          <button class="valora-mobile-link" type="button" data-target="contratos-admin"><i class="fa-solid fa-file-contract"></i> Contratos</button>
          <button class="valora-mobile-link" type="button" data-target="area-cliente-admin"><i class="fa-solid fa-address-card"></i> Dados para Contrato</button>
        </div>
        <div class="valora-mobile-section">
          <div class="valora-mobile-title">Cadastros</div>
          <button class="valora-mobile-link" type="button" data-target="clientes"><i class="fa-solid fa-user-group"></i> Clientes</button>
          <button class="valora-mobile-link" type="button" data-target="fornecedores"><i class="fa-solid fa-truck"></i> Fornecedores</button>
          <button class="valora-mobile-link" type="button" data-target="cotacoes"><i class="fa-solid fa-scale-balanced"></i> Cotações</button>
          <button class="valora-mobile-link" type="button" data-target="produtos"><i class="fa-solid fa-box-open"></i> Produtos</button>
          <button class="valora-mobile-link" type="button" data-target="patrimonio"><i class="fa-solid fa-tags"></i> Patrimônio</button>
          <button class="valora-mobile-link" type="button" data-target="usuarios"><i class="fa-solid fa-id-badge"></i> Usuários</button>
          <button class="valora-mobile-link" type="button" data-target="empresa"><i class="fa-solid fa-building"></i> Empresa</button>
        </div>
        <div class="valora-mobile-section">
          <div class="valora-mobile-title">Financeiro</div>
          <button class="valora-mobile-link" type="button" data-target="financeiro"><i class="fa-solid fa-chart-pie"></i> Visão Geral</button>
          <button class="valora-mobile-link" type="button" data-target="contas-receber"><i class="fa-solid fa-hand-holding-dollar"></i> Contas a Receber</button>
          <button class="valora-mobile-link" type="button" data-target="contas-pagar"><i class="fa-solid fa-file-invoice-dollar"></i> Contas a Pagar</button>
          <button class="valora-mobile-link" type="button" data-target="fluxo-caixa"><i class="fa-solid fa-money-bill-transfer"></i> Fluxo de Caixa</button>
          <button class="valora-mobile-link" type="button" data-target="categorias-financeiras"><i class="fa-solid fa-folder-tree"></i> Categorias</button>
          <button class="valora-mobile-link" type="button" data-target="formas-pagamento"><i class="fa-solid fa-credit-card"></i> Formas de Pagamento</button>
          <button class="valora-mobile-link" type="button" data-target="contas-bancos"><i class="fa-solid fa-building-columns"></i> Contas/Bancos</button>
          <button class="valora-mobile-link" type="button" data-target="relatorios-financeiros"><i class="fa-solid fa-chart-column"></i> Relatórios Financeiros</button>
        </div>
        <div class="valora-mobile-section">
          <div class="valora-mobile-title">Ajustes</div>
          <button class="valora-mobile-link" type="button" data-target="formularios"><i class="fa-solid fa-wand-magic-sparkles"></i> Formulários</button>
          <button class="valora-mobile-link" type="button" data-target="config"><i class="fa-solid fa-gear"></i> Configurações</button>
          <button class="valora-mobile-link" type="button" data-target="ajuda"><i class="fa-regular fa-circle-question"></i> Ajuda</button>
        </div>
      </div>
    `;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char];
    });
  }

  function closeMenus(root) {
    root.querySelectorAll('.is-open').forEach((el) => el.classList.remove('is-open'));
    const panel = root.querySelector('#valoraMobilePanel');
    const btn = root.querySelector('#valoraMobileMenuBtn');
    if (panel) panel.classList.remove('is-open');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
    document.body.classList.remove('valora-mobile-menu-open');
  }

  function toggleMobile(root) {
    const panel = root.querySelector('#valoraMobilePanel');
    const btn = root.querySelector('#valoraMobileMenuBtn');
    if (!panel || !btn) return;
    const open = !panel.classList.contains('is-open');
    root.querySelectorAll('[data-menu-group], [data-menu-pop]').forEach((el) => el.classList.remove('is-open'));
    panel.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
    document.body.classList.toggle('valora-mobile-menu-open', open);
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
    } catch (err) {
      console.warn('[Valora menu] logout via API falhou, redirecionando mesmo assim:', err);
    }
    const theme = localStorage.getItem('valora_theme') || 'light';
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('valora_theme', theme);
    window.location.replace('/login');
  }

  function applyTheme(theme) {
    const finalTheme = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem('valora_theme', finalTheme);
    document.documentElement.setAttribute('data-theme', finalTheme);
  }

  function initEvents(root) {
    root.addEventListener('click', function (event) {
      const mobileBtn = event.target.closest('#valoraMobileMenuBtn');
      if (mobileBtn) {
        event.preventDefault();
        event.stopPropagation();
        toggleMobile(root);
        return;
      }

      const trigger = event.target.closest('.valora-menu-trigger');
      if (trigger) {
        event.preventDefault();
        event.stopPropagation();
        const group = trigger.closest('[data-menu-group]');
        const open = group && !group.classList.contains('is-open');
        root.querySelectorAll('[data-menu-group], [data-menu-pop]').forEach((el) => {
          if (el !== group) el.classList.remove('is-open');
        });
        if (group) group.classList.toggle('is-open', open);
        return;
      }

      const popTrigger = event.target.closest('[data-pop-trigger]');
      if (popTrigger) {
        event.preventDefault();
        event.stopPropagation();
        const pop = popTrigger.closest('[data-menu-pop]');
        const open = pop && !pop.classList.contains('is-open');
        root.querySelectorAll('[data-menu-group], [data-menu-pop]').forEach((el) => {
          if (el !== pop) el.classList.remove('is-open');
        });
        if (pop) pop.classList.toggle('is-open', open);
        return;
      }

      const themeBtn = event.target.closest('[data-theme-option]');
      if (themeBtn) {
        event.preventDefault();
        event.stopPropagation();
        applyTheme(themeBtn.dataset.themeOption);
        closeMenus(root);
        return;
      }

      const logoutBtn = event.target.closest('[data-logout]');
      if (logoutBtn) {
        event.preventDefault();
        event.stopPropagation();
        logout();
        return;
      }

      const targetBtn = event.target.closest('[data-target]');
      if (targetBtn) {
        event.preventDefault();
        event.stopPropagation();
        const target = targetBtn.dataset.target;
        closeMenus(root);
        navigate(target);
      }
    });

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) closeMenus(root);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenus(root);
    });
  }

  function markActive(root) {
    const current = currentTarget();
    root.querySelectorAll('[data-target]').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.target === current);
    });
  }

  function init() {
    document.querySelectorAll('iframe.sidebar-frame').forEach((iframe) => iframe.remove());

    let root = document.getElementById('valora-menu-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'valora-menu-root';
      document.body.prepend(root);
    }

    if (root.dataset.initialized === VERSION) return;
    root.dataset.initialized = VERSION;
    root.innerHTML = menuTemplate();

    applyTheme(localStorage.getItem('valora_theme') || 'light');
    markActive(root);
    initEvents(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
