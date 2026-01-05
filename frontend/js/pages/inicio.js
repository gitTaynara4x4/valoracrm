<<<<<<< HEAD
// /frontend/js/pages/inicio.js
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function irParaSecao(target) {
  switch (target) {
    case 'home':
      // Home do OrçaPro
      window.location.href = '/orca';
      break;
    case 'clientes':
      window.location.href = '/frontend/clientes.html';
      break;
    case 'produtos':
      window.location.href = '/frontend/produtos.html';
      break;
    case 'propostas':
      window.location.href = '/frontend/propostas.html';
      break;
    case 'config':
      window.location.href = '/frontend/config.html';
      break;
    case 'ajuda':
      window.location.href = '/frontend/ajuda.html';
      break;
    default:
      console.warn('[4X OrçaPro] target desconhecido:', target);
  }
}

function initNav() {
  // sidebar
  $$('.orca-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // cards grandes (atalhos)
  $$('.orca-home-card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // botões de atalho nos side-cards
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // botão "Nova proposta"
  const novaBtn = $('[data-action="nova-proposta"]');
  if (novaBtn) {
    novaBtn.addEventListener('click', () => {
      window.location.href = '/frontend/propostas.html?nova=1';
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initNav();
});
=======
// /frontend/js/pages/inicio.js
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function irParaSecao(target) {
  switch (target) {
    case 'home':
      // Home do OrçaPro
      window.location.href = '/orca';
      break;
    case 'clientes':
      window.location.href = '/frontend/clientes.html';
      break;
    case 'produtos':
      window.location.href = '/frontend/produtos.html';
      break;
    case 'propostas':
      window.location.href = '/frontend/propostas.html';
      break;
    case 'config':
      window.location.href = '/frontend/config.html';
      break;
    case 'ajuda':
      window.location.href = '/frontend/ajuda.html';
      break;
    default:
      console.warn('[4X OrçaPro] target desconhecido:', target);
  }
}

function initNav() {
  // sidebar
  $$('.orca-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // cards grandes (atalhos)
  $$('.orca-home-card').forEach(card => {
    card.addEventListener('click', () => {
      const target = card.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // botões de atalho nos side-cards
  $$('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (!target) return;
      irParaSecao(target);
    });
  });

  // botão "Nova proposta"
  const novaBtn = $('[data-action="nova-proposta"]');
  if (novaBtn) {
    novaBtn.addEventListener('click', () => {
      window.location.href = '/frontend/propostas.html?nova=1';
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initNav();
});
>>>>>>> b5237cd (Initial commit OrçaPro)
