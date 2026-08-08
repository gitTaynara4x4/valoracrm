(() => {
  'use strict';

  const VERSION = '20260807-shell-v3';
  const EMBED_PARAM = '__valora_embed';
  const stage = document.getElementById('valora-shell-stage');
  const progress = document.getElementById('valora-shell-progress');
  const firstLoad = document.getElementById('valora-shell-first-load');

  if (!stage) return;

  let activeFrame = null;
  let pendingFrame = null;
  let navigationToken = 0;
  let currentCleanUrl = '';

  function sameOriginUrl(input) {
    try {
      const url = new URL(String(input || ''), window.location.href);
      return url.origin === window.location.origin ? url : null;
    } catch (_) {
      return null;
    }
  }

  function isAppPage(url) {
    if (!url || url.origin !== window.location.origin) return false;
    const path = url.pathname.toLowerCase();
    if (path.startsWith('/api/') || path.startsWith('/uploads/')) return false;
    if (path.startsWith('/frontend/css/') || path.startsWith('/frontend/js/') || path.startsWith('/frontend/img/') || path.startsWith('/frontend/fonts/')) return false;
    if (path === '/login' || path === '/cadastro' || path === '/' || path === '/inicio' || path === '/valora') return false;
    if (path === '/frontend/login.html' || path === '/frontend/cadastro.html' || path === '/frontend/inicio.html' || path === '/frontend/app-shell.html') return false;
    return true;
  }

  function cleanUrl(input) {
    const url = sameOriginUrl(input);
    if (!url) return String(input || '');
    url.searchParams.delete(EMBED_PARAM);

    const match = url.pathname.match(/^\/frontend\/([a-z0-9_-]+)\.html$/i);
    if (match && !['login', 'cadastro', 'inicio'].includes(match[1].toLowerCase())) {
      url.pathname = '/' + match[1];
    }
    return url.pathname + url.search + url.hash;
  }

  function embeddedUrl(input) {
    const url = sameOriginUrl(input);
    if (!url) return String(input || '');
    url.searchParams.set(EMBED_PARAM, '1');
    return url.href;
  }

  function setLoading(loading) {
    progress?.classList.toggle('is-loading', !!loading);
    progress?.setAttribute('aria-hidden', loading ? 'false' : 'true');
  }

  function createFrame(url) {
    const frame = document.createElement('iframe');
    frame.className = 'valora-shell-frame is-preparing';
    frame.dataset.valoraShellVersion = VERSION;
    frame.setAttribute('title', 'Conteúdo do Valora CRM');
    frame.setAttribute('loading', 'eager');
    frame.src = embeddedUrl(url);
    return frame;
  }

  function frameLocation(frame) {
    try {
      return frame?.contentWindow?.location?.href || frame?.src || '';
    } catch (_) {
      return frame?.src || '';
    }
  }

  function frameTitle(frame) {
    try {
      return frame?.contentDocument?.title || 'Valora CRM';
    } catch (_) {
      return 'Valora CRM';
    }
  }

  function syncThemeInto(frame) {
    try {
      const theme = localStorage.getItem('valora_theme') === 'dark' ? 'dark' : 'light';
      frame?.contentDocument?.documentElement?.setAttribute('data-theme', theme);
    } catch (_) {}
  }

  async function waitUntilPaintable(frame) {
    try {
      const doc = frame.contentDocument;
      if (doc?.fonts?.ready) {
        await Promise.race([
          doc.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 180)),
        ]);
      }
    } catch (_) {}

    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function updateParentFromFrame(frame, mode = 'replace') {
    const actual = sameOriginUrl(frameLocation(frame));
    if (!actual) return;

    const path = actual.pathname.toLowerCase();
    if (path === '/login' || path === '/frontend/login.html') {
      window.location.replace('/login');
      return;
    }

    const clean = cleanUrl(actual.href);
    if (!clean || clean === currentCleanUrl) return;

    currentCleanUrl = clean;
    if (mode === 'push') history.pushState({ valoraShell: true, url: clean }, '', clean);
    else history.replaceState({ valoraShell: true, url: clean }, '', clean);
    window.ValoraMenu?.syncActive?.();
  }

  function bindActiveFrame(frame) {
    frame.addEventListener('load', () => {
      if (frame !== activeFrame) return;
      syncThemeInto(frame);
      document.title = frameTitle(frame);
      updateParentFromFrame(frame, 'push');
    });
  }

  async function navigate(input, options = {}) {
    const target = sameOriginUrl(input);
    if (!target) {
      window.location.assign(String(input || ''));
      return;
    }

    if (!isAppPage(target)) {
      if (options.replace) window.location.replace(target.href);
      else window.location.assign(target.href);
      return;
    }

    const clean = cleanUrl(target.href);
    const historyMode = options.history || (options.replace ? 'replace' : 'push');

    if (clean === currentCleanUrl && activeFrame && !options.force) {
      window.ValoraMenu?.syncActive?.();
      return;
    }

    const token = ++navigationToken;
    setLoading(true);

    if (pendingFrame) {
      try { pendingFrame.remove(); } catch (_) {}
      pendingFrame = null;
    }

    const next = createFrame(target.href);
    pendingFrame = next;
    stage.appendChild(next);

    const loaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tempo excedido ao carregar a página.')), 30000);
      next.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
      next.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Falha ao carregar a página.')); }, { once: true });
    });

    try {
      await loaded;
      if (token !== navigationToken) return;

      const actual = sameOriginUrl(frameLocation(next));
      if (actual && (actual.pathname === '/login' || actual.pathname === '/frontend/login.html')) {
        window.location.replace('/login');
        return;
      }

      await waitUntilPaintable(next);
      if (token !== navigationToken) return;

      syncThemeInto(next);
      const old = activeFrame;

      next.classList.remove('is-preparing');
      next.classList.add('is-active');
      activeFrame = next;
      pendingFrame = null;
      bindActiveFrame(next);

      if (old && old !== next) old.remove();
      firstLoad?.remove();

      const actualClean = cleanUrl(frameLocation(next)) || clean;
      currentCleanUrl = actualClean;

      if (historyMode === 'push') {
        history.pushState({ valoraShell: true, url: actualClean }, '', actualClean);
      } else if (historyMode === 'replace') {
        history.replaceState({ valoraShell: true, url: actualClean }, '', actualClean);
      }

      document.title = frameTitle(next);
      window.ValoraMenu?.syncActive?.();
      setLoading(false);
    } catch (error) {
      if (next === pendingFrame) pendingFrame = null;
      try { next.remove(); } catch (_) {}
      setLoading(false);
      console.error('[Valora shell] navegação:', error);

      // Se o carregamento preparado falhar, mantém a tela atual visível e só
      // então usa a navegação tradicional como último recurso.
      window.location.assign(target.href);
    }
  }

  function prefetch(input) {
    const target = sameOriginUrl(input);
    if (!target || !isAppPage(target)) return;
    const linkKey = 'valora-shell-prefetch-' + btoa(unescape(encodeURIComponent(cleanUrl(target.href)))).replace(/=+$/g, '').replace(/[^a-z0-9]/gi, '');
    if (document.getElementById(linkKey)) return;
    const link = document.createElement('link');
    link.id = linkKey;
    link.rel = 'prefetch';
    link.as = 'document';
    link.href = embeddedUrl(target.href);
    document.head.appendChild(link);
  }

  window.ValoraShell = {
    navigate,
    prefetch,
    get activeFrame() { return activeFrame; },
  };

  window.addEventListener('popstate', () => {
    void navigate(window.location.href, { history: 'none', force: true });
  });

  document.addEventListener('valora:theme-changed', () => {
    syncThemeInto(activeFrame);
    syncThemeInto(pendingFrame);
  });

  // Se um módulo aberto dentro do frame solicitar navegação pelo helper global,
  // a troca passa sempre pelo shell e a página antiga continua visível até a nova estar pronta.
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data || {};
    if (data.type !== 'valora:navigate' || !data.url) return;
    void navigate(data.url, { replace: !!data.replace });
  });

  const initial = window.location.pathname + window.location.search + window.location.hash;
  currentCleanUrl = '';
  void navigate(initial, { history: 'replace', force: true });
})();
