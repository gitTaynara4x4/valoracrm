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
// FOOTER GLOBAL AUTOMÁTICO (NOVO E COMPLETO)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const mainElement = document.querySelector('.main');

  if (mainElement) {
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