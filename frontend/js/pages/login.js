// /frontend/js/pages/login.js

// === Guard: Proteção de Login ===
(function alreadyLoggedGuard(){
  function hasCookie(name){
    try {
      var re = new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&') + '=');
      return re.test(document.cookie || '');
    } catch (e) { return false; }
  }
  function hasSessionCookie() { return hasCookie('empresa_id'); }
  
  function redirectHome(){
    var params = new URLSearchParams(location.search || '');
    var next = params.get('next');
    var target = (next && /^\/[^\s]*$/.test(next)) ? next : '/dashboard';
    window.location.replace(target);
  }

  if (hasSessionCookie()) redirectHome();

  window.addEventListener('pageshow', function (e) {
    var nav = (performance && performance.getEntriesByType) ? performance.getEntriesByType('navigation') : null;
    var backForward = !!(nav && nav[0] && nav[0].type === 'back_forward');
    if (e.persisted || backForward) {
      if (hasSessionCookie()) redirectHome();
    }
  });
})();

// === UI: Mostrar/Ocultar senha ===
(function(){
  var btn = document.getElementById('togglePassBtn');
  var input = document.getElementById('senha');
  
  if (btn && input) {
    btn.addEventListener('click', function(){
      var type = input.type === 'password' ? 'text' : 'password';
      input.type = type;
      btn.style.opacity = type === 'text' ? '1' : '0.6';
    });
  }
})();

// === Helpers de Notificação ===
function notifyWarn(msg){
  var box = document.getElementById('erro');
  if (box){ box.textContent = msg; box.classList.remove('hidden'); }
}
function clearNotify(){
  var box = document.getElementById('erro');
  if (box){ box.textContent = ''; box.classList.add('hidden'); }
}

// Alerta temporário para os botões do Google/Microsoft
function showLoginAlert() {
  notifyWarn("Integração com contas corporativas (Google/Microsoft Workspace) será liberada em breve.");
}
window.showLoginAlert = showLoginAlert;

// === Lógica de Submit (Auth 2 Etapas) ===
(function(){
  var form = document.getElementById('form-login');
  var btn  = document.getElementById('btn-login');
  var emailInput = document.getElementById('email');
  var senhaInput = document.getElementById('senha');
  var rememberInput = document.getElementById('remember');

  var step1 = document.getElementById('step1-fields');
  var step2 = document.getElementById('step2-fields');
  var tokenInput = document.getElementById('login-token');

  var currentStep = 1;
  var tokenEmail = null;
  var tokenRemember = false;

  if (!form) return;

  function disable(){ if(btn){ btn.disabled = true; } }
  function enable(){ if(btn){ btn.disabled = false; btn.textContent = (currentStep === 1 ? 'Acessar plataforma' : 'Confirmar código'); } }

  function goToStep(step){
    currentStep = step;
    if (step1) step1.classList.toggle('hidden', step !== 1);
    if (step2) step2.classList.toggle('hidden', step !== 2);
    if (btn) btn.textContent = (step === 1 ? 'Acessar plataforma' : 'Confirmar código');
    if (step === 2 && tokenInput){
      tokenInput.value = '';
      try { tokenInput.focus(); } catch (e) {}
    }
  }

  var btnBack = document.getElementById('btn-token-back');
  if (btnBack){
    btnBack.addEventListener('click', function(){
      tokenEmail = null;
      tokenRemember = false;
      goToStep(1);
      enable();
      clearNotify();
    });
  }

  // Função final de sucesso
  async function finalizeLoginSuccess(d, email, remember){
    var token = d.access_token || d.token || '';
    if (token) {
      try {
        localStorage.setItem('access_token', token);
        localStorage.setItem('token', token);
      } catch (e) {}
    }

    var empresaId = (d.hasOwnProperty('empresaId') && d.empresaId !== null) ? d.empresaId : (d.empresa_id || 1);
    if (empresaId !== undefined && empresaId !== null) {
      try { localStorage.setItem('empresa_id', String(empresaId)); } catch (e) {}
    }

    try { localStorage.setItem('email', email); } catch (e) {}
    if (d && d.nome) {
      try { localStorage.setItem('nome', d.nome); } catch (e) {}
    } else {
      try { localStorage.setItem('nome', 'Administrador'); } catch (e) {}
    }

    clearNotify();

    var params = new URLSearchParams(window.location.search || '');
    var next = params.get('next');
    var target = (next && /^\/[^\s]*$/.test(next)) ? next : '/dashboard';
    window.location.replace(target);
  }

  // Submit Handler
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    clearNotify();

    if (currentStep === 1){
      var email = (emailInput && emailInput.value) ? emailInput.value.trim().toLowerCase() : '';
      var senha = (senhaInput && senhaInput.value) ? senhaInput.value.trim() : '';
      var remember = !!(rememberInput && rememberInput.checked);

      if (!email || !senha){ notifyWarn('Preencha e-mail e senha.'); return; }

      // 🚧 BYPASS DE TESTE 🚧
      if (email === 'admin@valora.com' && senha === '123456') {
         document.cookie = "empresa_id=1; path=/"; 
         document.cookie = "user_id=1; path=/";
         await finalizeLoginSuccess({ nome: 'Taynara Admin', empresa_id: 1 }, email, remember);
         return;
      }

      disable();
      if (btn) btn.textContent = 'Autenticando...';

      try {
        var res = await fetch('/api/auth/login', {
          method : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ email: email, senha: senha, remember: remember })
        });

        if (res.status === 401) { notifyWarn('E-mail e/ou senha incorretos.'); enable(); return; }
        if (res.status === 404) { notifyWarn('E-mail não cadastrado.'); enable(); return; }
        if (!res.ok) { notifyWarn('Erro ao entrar. O backend pode estar offline.'); enable(); return; }

        var d = await res.json().catch(function(){ return {}; });

        if (d && d.require_token){
          tokenEmail = email;
          tokenRemember = remember;
          var infoEl = document.getElementById('token-info');
          if (infoEl) infoEl.textContent = d.mensagem || 'Enviamos um código de acesso para o seu e-mail.';
          goToStep(2);
          enable();
          return;
        }

        await finalizeLoginSuccess(d, email, remember);

      } catch (err) {
        console.error(err);
        notifyWarn('Erro de conexão. O servidor backend está rodando?');
        enable();
      }
      return;
    }

    // PASSO 2: Token
    var email2 = tokenEmail || ((emailInput && emailInput.value) ? emailInput.value.trim().toLowerCase() : '');
    var codigo = (tokenInput && tokenInput.value) ? tokenInput.value.trim() : '';

    if (!codigo){ notifyWarn('Digite o código de acesso enviado para o seu e-mail.'); return; }

    disable();
    if (btn) btn.textContent = 'Validando...';

    try {
      var res2 = await fetch('/api/auth/login/token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email2, token: codigo, remember: !!tokenRemember })
      });

      if (!res2.ok){ notifyWarn('Código inválido ou expirado.'); enable(); return; }

      var d2 = await res2.json().catch(function(){ return {}; });
      await finalizeLoginSuccess(d2, email2, !!tokenRemember);

    } catch (err2){
      console.error(err2);
      notifyWarn('Erro de conexão com o servidor.');
      enable();
    }
  });
})();