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
