// /frontend/js/pages/inicio.js

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function getHomeUrl() {
  // Se você tiver um alias /orca no backend, ele continua funcionando.
  // Senão, cai no arquivo do frontend.
  if (window.location.pathname.startsWith('/orca')) return '/orca';
  return '/frontend/inicio.html';
}

function irParaSecao(target) {
  const routes = {
    home: getHomeUrl(),
    clientes: '/frontend/clientes.html',
    produtos: '/frontend/produtos.html',
    propostas: '/frontend/propostas.html',
    config: '/frontend/config.html',
    ajuda: '/frontend/ajuda.html',
  };

  const url = routes[target];
  if (!url) {
    console.warn('[4X OrçaPro] target desconhecido:', target);
    return;
  }

  window.location.href = url;
}

function initAtalhos() {
  // Cards e botões com data-target
  $$('[data-target]').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.target;
      if (!target) return;

      // “Novo cliente / novo produto” ainda não tem modal aqui,
      // então vai pra página do módulo (V1).
      irParaSecao(target);
    });
  });

  // Botões “Nova proposta”
  $$('[data-action="nova-proposta"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = '/frontend/propostas.html?nova=1';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initAtalhos();
});
