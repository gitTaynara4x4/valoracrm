(() => {
  'use strict';

  const VERSION = '20260812-permissions-v30';
  const PARTIAL_URL = '/frontend/partials/sidebar-content.inc?v=' + VERSION;
  const CSS_URL = '/frontend/css/menu-global.css?v=' + VERSION;
  const ROUTES = {
    home: '/dashboard', clientes: '/clientes', 'arquivos-tecnicos': '/arquivos-tecnicos', fornecedores: '/fornecedores', cotacoes: '/cotacoes',
    produtos: '/produtos', patrimonio: '/patrimonio', orcamentos: '/orcamentos', propostas: '/propostas',
    'area-cliente-admin': '/area-cliente-admin', 'contratos-admin': '/contratos-admin', usuarios: '/usuarios',
    config: '/configuracoes', formularios: '/formularios', ajuda: '/ajuda', perfil: '/perfil', empresa: '/empresa',
    financeiro: '/financeiro', 'vendas-financeiro': '/vendas-financeiro', 'contas-receber': '/contas-receber',
    'contas-pagar': '/contas-pagar', 'fluxo-caixa': '/fluxo-caixa', 'categorias-financeiras': '/categorias-financeiras',
    'formas-pagamento': '/formas-pagamento', 'contas-bancos': '/contas-bancos',
    'cadastros-financeiros': '/cadastros-financeiros', 'relatorios-financeiros': '/relatorios-financeiros'
  };

  const TARGET_MODULES = {
    home: 'dashboard',
    clientes: 'clientes',
    'arquivos-tecnicos': 'arquivos_tecnicos',
    fornecedores: 'fornecedores',
    cotacoes: 'cotacoes',
    produtos: 'produtos',
    patrimonio: 'patrimonio',
    orcamentos: 'orcamentos',
    propostas: 'propostas',
    'area-cliente-admin': 'contratos',
    'contratos-admin': 'contratos',
    usuarios: 'usuarios',
    empresa: 'empresa',
    config: 'configuracoes',
    formularios: 'configuracoes',
    financeiro: 'financeiro',
    'vendas-financeiro': 'financeiro',
    'contas-receber': 'financeiro',
    'contas-pagar': 'financeiro',
    'fluxo-caixa': 'financeiro',
    'categorias-financeiras': 'financeiro',
    'formas-pagamento': 'financeiro',
    'contas-bancos': 'financeiro',
    'cadastros-financeiros': 'financeiro',
    'relatorios-financeiros': 'financeiro'
  };

  let permissionProfile = null;
  let permissionsLoaded = false;
  let root = null;
  let initialized = false;
  const prefetchedRoutes = new Set();

  function ensureCss() {
    if (document.querySelector('link[data-valora-menu-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_URL;
    link.dataset.valoraMenuCss = VERSION;
    document.head.appendChild(link);
  }

  function normalizePath(path) {
    return String(path || '/').toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  }

  function isEmbeddedPage() {
    try {
      return window.self !== window.top && new URL(window.location.href).searchParams.get('__valora_embed') === '1';
    } catch (_) {
      return window.self !== window.top;
    }
  }

  function navigateUrl(url, { replace = false } = {}) {
    if (!url) return;

    // Dentro do shell, o documento pai permanece vivo e troca somente o
    // conteúdo. É isso que elimina o pisca de uma navegação MPA tradicional.
    if (window.ValoraShell?.navigate) {
      window.ValoraShell.navigate(url, { replace });
      return;
    }

    // Módulos renderizados dentro do frame também podem pedir navegação ao
    // shell sem descarregar o documento atual.
    if (isEmbeddedPage()) {
      try {
        window.parent.postMessage({ type: 'valora:navigate', url, replace }, window.location.origin);
        return;
      } catch (_) {}
    }

    if (replace) window.location.replace(url);
    else window.location.assign(url);
  }

  window.ValoraNavigate = navigateUrl;

  function currentTarget() {
    const path = normalizePath(window.location.pathname);
    if (['/', '/dashboard', '/home', '/inicio', '/frontend/dashboard.html', '/frontend/inicio.html'].includes(path)) return 'home';
    const aliases = [
      ['arquivos-tecnicos','arquivos-tecnicos'], ['clientes','clientes'], ['fornecedores','fornecedores'], ['cotacoes','cotacoes'], ['produtos','produtos'],
      ['patrimonio','patrimonio'], ['orcamentos','orcamentos'], ['propostas','propostas'],
      ['area-cliente-admin','area-cliente-admin'], ['contratos-admin','contratos-admin'], ['usuarios','usuarios'],
      ['vendas-financeiro','vendas-financeiro'], ['contas-receber','contas-receber'], ['contas-pagar','contas-pagar'],
      ['fluxo-caixa','fluxo-caixa'], ['categorias-financeiras','categorias-financeiras'], ['formas-pagamento','formas-pagamento'],
      ['contas-bancos','contas-bancos'], ['cadastros-financeiros','cadastros-financeiros'],
      ['relatorios-financeiros','relatorios-financeiros'], ['financeiro','financeiro'], ['formularios','formularios'],
      ['ajuda','ajuda'], ['perfil','perfil'], ['empresa','empresa'], ['configuracoes','config'], ['config','config']
    ];
    for (const [needle, target] of aliases) if (path.includes(needle)) return target;
    return 'home';
  }

  function getStoredUser() {
    return {
      nome: localStorage.getItem('nome') || localStorage.getItem('user_nome') || localStorage.getItem('usuario_nome') || 'Usuário',
      email: localStorage.getItem('email') || localStorage.getItem('user_email') || localStorage.getItem('usuario_email') || 'email@empresa.com'
    };
  }

  function initials(name) {
    const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : String(parts[0] || 'U').slice(0, 2).toUpperCase();
  }

  function syncUser() {
    if (!root) return;
    const { nome, email } = getStoredUser();
    const name = root.querySelector('#sidebarUserName');
    const mail = root.querySelector('#sidebarUserEmail');
    const badge = root.querySelector('#sidebarUserInitials');
    if (name) name.textContent = nome;
    if (mail) mail.textContent = email;
    if (badge) badge.textContent = initials(nome);
  }

  function syncActive() {
    if (!root) return;
    const target = currentTarget();
    root.querySelectorAll('[data-target]').forEach((el) => el.classList.toggle('is-active', el.dataset.target === target));
  }

  function syncThemeButtons() {
    if (!root) return;
    const theme = localStorage.getItem('valora_theme') === 'dark' ? 'dark' : 'light';
    root.querySelectorAll('[data-theme-option]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.themeOption === theme));
  }

  function applyTheme(theme, { persist = true } = {}) {
    const finalTheme = theme === 'dark' ? 'dark' : 'light';
    if (persist) localStorage.setItem('valora_theme', finalTheme);
    document.documentElement.setAttribute('data-theme', finalTheme);
    syncThemeButtons();
    document.dispatchEvent(new CustomEvent('valora:theme-changed', { detail: { theme: finalTheme } }));
  }

  function closeMenus() {
    if (!root) return;
    root.querySelectorAll('[data-menu-group].is-open').forEach((el) => el.classList.remove('is-open'));
    root.querySelector('#settingsWrap')?.classList.remove('is-open');
    root.querySelector('#userWrap')?.classList.remove('is-open');
    const panel = root.querySelector('#mobilePanel');
    panel?.classList.remove('is-open');
    const btn = root.querySelector('#mobileMenuBtn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
    }
    root.classList.remove('mobile-menu-open');
  }

  function hasModulePermission(module, action = 'ver') {
    if (!module || !permissionsLoaded) return true;
    const role = String(permissionProfile?.papel || '').trim().toLowerCase();
    if (role === 'owner' || role === 'admin') return true;
    return Boolean(permissionProfile?.permissoes?.[module]?.[`pode_${action}`]);
  }

  function targetAllowed(target, action = 'ver') {
    const module = TARGET_MODULES[target];
    return module ? hasModulePermission(module, action) : true;
  }

  function applyMenuPermissions() {
    if (!root || !permissionsLoaded) return;

    root.querySelectorAll('[data-target]').forEach((el) => {
      const target = el.dataset.target;
      const action = el.classList.contains('new-action') ? 'criar' : 'ver';
      const allowed = targetAllowed(target, action);
      el.dataset.permissionHidden = allowed ? '0' : '1';
      el.hidden = !allowed;
      if (!allowed) el.classList.remove('is-active');
    });

    root.querySelectorAll('[data-menu-group]').forEach((group) => {
      const items = Array.from(group.querySelectorAll('[data-target]'));
      group.hidden = items.length > 0 && !items.some((item) => item.dataset.permissionHidden !== '1');
    });

    root.querySelectorAll('.mobile-section').forEach((section) => {
      const items = Array.from(section.querySelectorAll('.mobile-link[data-target]'));
      section.hidden = items.length > 0 && !items.some((item) => item.dataset.permissionHidden !== '1');
    });
  }

  async function refreshPermissions() {
    try {
      const response = await fetch('/api/permissoes/me', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      permissionProfile = await response.json();
      permissionsLoaded = true;
      applyMenuPermissions();
      window.ValoraPermissions = {
        profile: permissionProfile,
        can: (module, action = 'ver') => hasModulePermission(module, action),
        canTarget: (target, action = 'ver') => targetAllowed(target, action),
        refresh: refreshPermissions
      };
      document.dispatchEvent(new CustomEvent('valora:permissions-ready', { detail: permissionProfile }));
    } catch (error) {
      // Em caso de falha, o menu não bloqueia visualmente. O backend continua
      // sendo a autoridade e impede qualquer acesso/operação sem permissão.
      console.warn('[Valora menu] Não foi possível carregar permissões:', error);
    }
  }

  function prefetchRoute(target) {
    if (!targetAllowed(target, 'ver')) return;
    const url = ROUTES[target];
    if (!url || prefetchedRoutes.has(url) || normalizePath(url) === normalizePath(window.location.pathname)) return;
    prefetchedRoutes.add(url);

    if (window.ValoraShell?.prefetch) {
      window.ValoraShell.prefetch(url);
      return;
    }

    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = url;
    link.as = 'document';
    link.dataset.valoraPrefetch = url;
    document.head.appendChild(link);
  }

  function navigate(target) {
    if (!targetAllowed(target, 'ver')) return;
    const url = ROUTES[target];
    if (url) navigateUrl(url);
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const theme = localStorage.getItem('valora_theme') || 'light';
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('valora_theme', theme);
      navigateUrl('/login', { replace: true });
    } catch (error) {
      console.error('[Valora menu] logout:', error);
      alert('Não foi possível encerrar a sessão. Tente novamente.');
    }
  }

  function openAgenda() {
    closeMenus();
    if (window.ValoraAgenda?.openPanel) window.ValoraAgenda.openPanel();
    else window.ValoraAgendaReady?.then((agenda) => agenda?.openPanel?.());
  }

  function toggleExclusive(element) {
    if (!root || !element) return;
    const willOpen = !element.classList.contains('is-open');
    root.querySelectorAll('[data-menu-group].is-open, #settingsWrap.is-open, #userWrap.is-open').forEach((el) => {
      if (el !== element) el.classList.remove('is-open');
    });
    element.classList.toggle('is-open', willOpen);
  }

  function initMobileSections() {
    const panel = root?.querySelector('#mobilePanel');
    if (!panel || panel.dataset.ready === VERSION) return;
    panel.dataset.ready = VERSION;
    const sections = Array.from(panel.querySelectorAll('.mobile-section'));
    const search = panel.querySelector('#mobileMenuSearch');
    const clear = panel.querySelector('#mobileMenuSearchClear');
    let empty = panel.querySelector('.mobile-panel-empty');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'mobile-panel-empty';
      empty.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><br>Nenhuma opção encontrada.';
      panel.appendChild(empty);
    }

    const expandCurrent = () => {
      const current = panel.querySelector('.mobile-link.is-active')?.closest('.mobile-section') || sections[0];
      sections.forEach((section) => {
        const open = section === current;
        section.classList.toggle('is-expanded', open);
        section.querySelector('.mobile-title')?.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    };

    sections.forEach((section) => {
      const title = section.querySelector('.mobile-title');
      if (!title) return;
      title.setAttribute('role', 'button');
      title.setAttribute('tabindex', '0');
      const toggle = () => {
        const open = !section.classList.contains('is-expanded');
        sections.forEach((other) => {
          other.classList.remove('is-expanded');
          other.querySelector('.mobile-title')?.setAttribute('aria-expanded', 'false');
        });
        section.classList.toggle('is-expanded', open);
        title.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      title.addEventListener('click', toggle);
      title.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      });
    });

    const applySearch = () => {
      const q = String(search?.value || '').trim().toLocaleLowerCase('pt-BR');
      let matches = 0;
      panel.classList.toggle('is-searching', !!q);
      sections.forEach((section) => {
        let sectionMatches = 0;
        section.querySelectorAll('.mobile-link').forEach((link) => {
          const denied = link.dataset.permissionHidden === '1';
          const visible = !denied && (!q || String(link.textContent || '').toLocaleLowerCase('pt-BR').includes(q));
          link.hidden = !visible;
          if (visible && q) { matches++; sectionMatches++; }
        });
        section.classList.toggle('has-search-result', sectionMatches > 0);
      });
      panel.classList.toggle('is-search-empty', !!q && matches === 0);
      if (clear) clear.hidden = !q;
      if (!q) expandCurrent();
    };
    search?.addEventListener('input', applySearch);
    clear?.addEventListener('click', () => { if (search) { search.value = ''; applySearch(); search.focus(); } });
    expandCurrent();
  }

  function bindEvents() {
    root.addEventListener('pointerover', (event) => {
      const targetBtn = event.target.closest('[data-target]');
      if (targetBtn) prefetchRoute(targetBtn.dataset.target);
    });

    root.addEventListener('focusin', (event) => {
      const targetBtn = event.target.closest('[data-target]');
      if (targetBtn) prefetchRoute(targetBtn.dataset.target);
    });

    root.addEventListener('click', (event) => {
      const groupTrigger = event.target.closest('.nav-trigger');
      if (groupTrigger) { event.preventDefault(); event.stopPropagation(); toggleExclusive(groupTrigger.closest('[data-menu-group]')); return; }

      const settingsBtn = event.target.closest('#settingsBtn');
      if (settingsBtn) { event.preventDefault(); event.stopPropagation(); toggleExclusive(root.querySelector('#settingsWrap')); return; }

      const userBtn = event.target.closest('#userProfileBtn');
      if (userBtn) { event.preventDefault(); event.stopPropagation(); toggleExclusive(root.querySelector('#userWrap')); return; }

      const mobileBtn = event.target.closest('#mobileMenuBtn');
      if (mobileBtn) {
        event.preventDefault(); event.stopPropagation();
        const panel = root.querySelector('#mobilePanel');
        const open = !panel?.classList.contains('is-open');
        closeMenus();
        panel?.classList.toggle('is-open', open);
        root.classList.toggle('mobile-menu-open', open);
        mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobileBtn.innerHTML = open ? '<i class="fa-solid fa-xmark"></i>' : '<i class="fa-solid fa-bars"></i>';
        return;
      }

      const themeBtn = event.target.closest('[data-theme-option]');
      if (themeBtn) { event.preventDefault(); applyTheme(themeBtn.dataset.themeOption); closeMenus(); return; }

      const agendaBtn = event.target.closest('[data-action="agenda"]');
      if (agendaBtn) { event.preventDefault(); openAgenda(); return; }

      const logoutBtn = event.target.closest('[data-action="logout"]');
      if (logoutBtn) { event.preventDefault(); void logout(); return; }

      const targetBtn = event.target.closest('[data-target]');
      if (targetBtn) { event.preventDefault(); const target = targetBtn.dataset.target; closeMenus(); navigate(target); }
    });

    const desktopMenuCloseTimers = new WeakMap();

    const cancelDesktopMenuClose = (group) => {
      const timer = desktopMenuCloseTimers.get(group);
      if (timer) {
        clearTimeout(timer);
        desktopMenuCloseTimers.delete(group);
      }
    };

    const scheduleDesktopMenuClose = (group) => {
      cancelDesktopMenuClose(group);
      const timer = window.setTimeout(() => {
        group.classList.remove('is-open');
        desktopMenuCloseTimers.delete(group);
      }, 180);
      desktopMenuCloseTimers.set(group, timer);
    };

    root.querySelectorAll('[data-menu-group]').forEach((group) => {
      group.addEventListener('mouseenter', () => {
        if (window.innerWidth <= 920) return;
        cancelDesktopMenuClose(group);
        root.querySelectorAll('[data-menu-group].is-open').forEach((other) => {
          if (other !== group) {
            cancelDesktopMenuClose(other);
            other.classList.remove('is-open');
          }
        });
        root.querySelector('#settingsWrap')?.classList.remove('is-open');
        root.querySelector('#userWrap')?.classList.remove('is-open');
        group.classList.add('is-open');
      });

      group.addEventListener('mouseleave', () => {
        if (window.innerWidth <= 920) return;
        scheduleDesktopMenuClose(group);
      });
    });

    root.addEventListener('mouseleave', () => {
      if (window.innerWidth <= 920) return;
      root.querySelectorAll('[data-menu-group].is-open').forEach((group) => scheduleDesktopMenuClose(group));
    });

    document.addEventListener('click', (event) => { if (root && !root.contains(event.target)) closeMenus(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });
  }

  function activateRenderedMenu() {
    root.dataset.initialized = VERSION;
    applyTheme(localStorage.getItem('valora_theme') || 'light', { persist: false });
    syncUser();
    syncActive();
    syncThemeButtons();
    initMobileSections();
    bindEvents();
    document.dispatchEvent(new CustomEvent('valora:menu-ready'));
    void refreshPermissions();
    window.ValoraAgenda?.refreshNotifications?.({ showAlerts: false });
  }

  async function init() {
    if (initialized) return;

    // O menu visual pertence ao shell. Dentro do iframe mantemos apenas os
    // helpers globais, evitando reconstruir a barra superior a cada módulo.
    if (isEmbeddedPage()) {
      initialized = true;
      return;
    }

    root = document.getElementById('valora-menu-root');
    if (!root) return;
    initialized = true;
    ensureCss();

    // O backend já pode entregar o partial dentro do HTML inicial. Nesse caso
    // não substituímos o menu novamente depois do primeiro paint, evitando o
    // pequeno sumiço/reaparecimento que ainda ocorria em páginas mais pesadas.
    if (root.children.length > 0 || root.dataset.valoraSsrMenu === '1') {
      activateRenderedMenu();
      return;
    }

    try {
      const response = await fetch(PARTIAL_URL, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      root.innerHTML = await response.text();
      activateRenderedMenu();
    } catch (error) {
      initialized = false;
      console.error('[Valora menu] Falha ao carregar menu:', error);
    }
  }

  window.ValoraMenu = { init, applyTheme, syncUser, syncActive, closeMenus, refreshPermissions };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
