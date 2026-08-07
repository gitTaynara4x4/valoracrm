(() => {
  'use strict';

  const VERSION = '20260806-direct-menu-v1';
  const PARTIAL_URL = '/frontend/partials/sidebar-content.inc?v=' + VERSION;
  const CSS_URL = '/frontend/css/menu-global.css?v=' + VERSION;
  const ROUTES = {
    home: '/dashboard', clientes: '/clientes', fornecedores: '/fornecedores', cotacoes: '/cotacoes',
    produtos: '/produtos', patrimonio: '/patrimonio', orcamentos: '/orcamentos', propostas: '/propostas',
    'area-cliente-admin': '/area-cliente-admin', 'contratos-admin': '/contratos-admin', usuarios: '/usuarios',
    config: '/configuracoes', formularios: '/formularios', ajuda: '/ajuda', perfil: '/perfil', empresa: '/empresa',
    financeiro: '/financeiro', 'vendas-financeiro': '/vendas-financeiro', 'contas-receber': '/contas-receber',
    'contas-pagar': '/contas-pagar', 'fluxo-caixa': '/fluxo-caixa', 'categorias-financeiras': '/categorias-financeiras',
    'formas-pagamento': '/formas-pagamento', 'contas-bancos': '/contas-bancos',
    'cadastros-financeiros': '/cadastros-financeiros', 'relatorios-financeiros': '/relatorios-financeiros'
  };

  let root = null;
  let initialized = false;

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

  function currentTarget() {
    const path = normalizePath(window.location.pathname);
    if (['/', '/dashboard', '/home', '/inicio', '/frontend/dashboard.html', '/frontend/inicio.html'].includes(path)) return 'home';
    const aliases = [
      ['clientes','clientes'], ['fornecedores','fornecedores'], ['cotacoes','cotacoes'], ['produtos','produtos'],
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

  function navigate(target) {
    const url = ROUTES[target];
    if (url) window.location.assign(url);
  }

  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const theme = localStorage.getItem('valora_theme') || 'light';
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('valora_theme', theme);
      window.location.replace('/login');
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
          const visible = !q || String(link.textContent || '').toLocaleLowerCase('pt-BR').includes(q);
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

    root.querySelectorAll('[data-menu-group]').forEach((group) => {
      group.addEventListener('mouseenter', () => {
        if (window.innerWidth <= 920) return;
        root.querySelectorAll('[data-menu-group].is-open').forEach((other) => { if (other !== group) other.classList.remove('is-open'); });
        root.querySelector('#settingsWrap')?.classList.remove('is-open');
        root.querySelector('#userWrap')?.classList.remove('is-open');
        group.classList.add('is-open');
      });
    });

    document.addEventListener('click', (event) => { if (root && !root.contains(event.target)) closeMenus(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });
  }

  async function init() {
    if (initialized) return;
    root = document.getElementById('valora-menu-root');
    if (!root) return;
    initialized = true;
    ensureCss();
    try {
      const response = await fetch(PARTIAL_URL, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      root.innerHTML = await response.text();
      root.dataset.initialized = VERSION;
      applyTheme(localStorage.getItem('valora_theme') || 'light', { persist: false });
      syncUser();
      syncActive();
      syncThemeButtons();
      initMobileSections();
      bindEvents();
      document.dispatchEvent(new CustomEvent('valora:menu-ready'));
      window.ValoraAgenda?.refreshNotifications?.({ showAlerts: false });
    } catch (error) {
      initialized = false;
      console.error('[Valora menu] Falha ao carregar menu:', error);
    }
  }

  window.ValoraMenu = { init, applyTheme, syncUser, syncActive, closeMenus };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
