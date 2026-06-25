// Compatibilidade: evita 404 quando algum HTML antigo ainda estiver em cache.
(() => {
  async function authFetch(input, init = {}) {
    const response = await fetch(input, { credentials: 'include', ...init });
    if (response.status === 401) {
      window.location.replace('/login');
    }
    return response;
  }

  window.ZAuth = window.ZAuth || {};
  window.ZAuth.authFetch = window.ZAuth.authFetch || authFetch;
  window.ZAuth.guardFetch = window.ZAuth.guardFetch || authFetch;
})();
