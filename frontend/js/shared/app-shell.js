(() => {
  'use strict';

  const VERSION = '20260822-financeiro-subnav-unico-v2';
  const EMBED_PARAM = '__valora_embed';
  const stage = document.getElementById('valora-shell-stage');
  const progress = document.getElementById('valora-shell-progress');
  const firstLoad = document.getElementById('valora-shell-first-load');

  if (!stage) return;

  let activeFrame = null;
  let pendingFrame = null;
  let navigationToken = 0;
  let currentCleanUrl = '';
  const FRAME_CACHE_LIMIT = 2;
  const FRAME_CACHE_TTL = 5 * 60 * 1000;
  const frameCache = new Map();

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
    if (path === '/auditoria-programadora' || path === '/auditoria-programadora/') return false;
    if (path === '/frontend/login.html' || path === '/frontend/cadastro.html' || path === '/frontend/inicio.html' || path === '/frontend/app-shell.html') return false;
    if (path === '/frontend/auditoria-programadora.html') return false;
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


  function cacheKey(input) {
    const url = sameOriginUrl(input);
    if (!url) return cleanUrl(input);
    url.searchParams.delete(EMBED_PARAM);
    // Estes parâmetros apenas mandam abrir um cadastro dentro do módulo.
    // Não precisam criar outra cópia inteira do mesmo iframe.
    ['editar_cliente_id', 'editar_fornecedor_id', 'editar_produto_id', 'abrir_agenda'].forEach((name) => {
      url.searchParams.delete(name);
    });
    return url.pathname + url.search;
  }

  function signalFrame(frame, active, routeUrl = '') {
    try {
      frame?.contentWindow?.postMessage({
        type: 'valora:shell-activity',
        active: !!active,
        routeUrl: routeUrl || '',
      }, window.location.origin);
    } catch (_) {}
  }

  function frameEntry(frame) {
    for (const [key, entry] of frameCache.entries()) {
      if (entry.frame === frame) return [key, entry];
    }
    return null;
  }

  function rememberFrame(frame, input) {
    if (!frame) return;
    const existing = frameEntry(frame);
    if (existing) frameCache.delete(existing[0]);
    const key = cacheKey(input || frameLocation(frame));
    frameCache.set(key, { frame, usedAt: Date.now(), createdAt: Date.now() });
  }

  function findCachedFrame(input) {
    const wanted = cacheKey(input);
    const now = Date.now();

    // Reindexa usando a URL real do iframe. Isso é importante porque os módulos
    // removem editar_* da própria URL depois de abrir o cadastro.
    for (const [key, entry] of [...frameCache.entries()]) {
      if (!entry.frame?.isConnected || now - entry.createdAt > FRAME_CACHE_TTL) {
        frameCache.delete(key);
        try { entry.frame?.remove(); } catch (_) {}
        continue;
      }
      const actualKey = cacheKey(frameLocation(entry.frame));
      if (actualKey && actualKey !== key) {
        frameCache.delete(key);
        frameCache.set(actualKey, entry);
      }
    }

    const entry = frameCache.get(wanted);
    if (!entry || entry.frame === pendingFrame) return null;
    entry.usedAt = now;
    frameCache.delete(wanted);
    frameCache.set(wanted, entry);
    return entry.frame;
  }

  function pruneFrameCache() {
    while (frameCache.size > FRAME_CACHE_LIMIT) {
      const oldest = [...frameCache.entries()].find(([, entry]) => entry.frame !== activeFrame && entry.frame !== pendingFrame);
      if (!oldest) break;
      frameCache.delete(oldest[0]);
      signalFrame(oldest[1].frame, false);
      try { oldest[1].frame.remove(); } catch (_) {}
    }
  }

  function deactivateFrame(frame) {
    if (!frame) return;
    frame.classList.remove('is-active', 'is-preparing');
    frame.classList.add('is-cached');
    frame.setAttribute('aria-hidden', 'true');
    signalFrame(frame, false);
  }

  function activateFrame(frame, targetUrl = '') {
    if (!frame) return;
    frame.classList.remove('is-preparing', 'is-cached');
    frame.classList.add('is-active');
    frame.removeAttribute('aria-hidden');
    signalFrame(frame, true, targetUrl);
    syncFinanceSubnavInto(frame);
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

  function syncFinanceSubnavInto(frame) {
    try {
      const doc = frame?.contentDocument;
      if (!doc?.querySelector?.('.financeiro-tabs--primary')) return;
      void window.ValoraFinanceSubnav?.sync?.(doc);
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
      syncFinanceSubnavInto(frame);
      document.title = frameTitle(frame);
      rememberFrame(frame, frameLocation(frame));
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

    // Reutiliza o módulo já aberto. Para editar_cliente_id/fornecedor/produto,
    // o próprio iframe recebe routeUrl e abre somente aquele cadastro.
    if (!options.force) {
      const cached = findCachedFrame(target.href);
      if (cached) {
        const old = activeFrame;
        if (old && old !== cached) deactivateFrame(old);
        activeFrame = cached;
        activateFrame(cached, clean);
        syncThemeInto(cached);
        rememberFrame(cached, target.href);
        pruneFrameCache();
        firstLoad?.remove();
        currentCleanUrl = clean;

        if (historyMode === 'push') history.pushState({ valoraShell: true, url: clean }, '', clean);
        else if (historyMode === 'replace') history.replaceState({ valoraShell: true, url: clean }, '', clean);

        document.title = frameTitle(cached);
        window.ValoraMenu?.syncActive?.();
        setLoading(false);
        return;
      }
    }

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

      if (old && old !== next) deactivateFrame(old);
      activateFrame(next);
      activeFrame = next;
      pendingFrame = null;
      bindActiveFrame(next);
      rememberFrame(next, frameLocation(next) || target.href);
      pruneFrameCache();
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
    frameCache.forEach((entry) => syncThemeInto(entry.frame));
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
