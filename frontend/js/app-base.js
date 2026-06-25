// Compatibilidade: versões antigas do dashboard chamavam app-base.js.
// O shell real do Valora fica em /frontend/js/pages/app.js.
(() => {
  document.documentElement.setAttribute('data-head-ready', 'true');
  document.documentElement.setAttribute('data-loader-ready', 'true');
  document.documentElement.classList.remove('prepaint');

  window.PageLoading = window.PageLoading || {
    show() {},
    hide() {},
  };
})();
