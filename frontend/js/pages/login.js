(() => {
  'use strict';

  const form = document.getElementById('form-login');
  const emailInput = document.getElementById('email');
  const senhaInput = document.getElementById('senha');
  const rememberInput = document.getElementById('remember');
  const erroBox = document.getElementById('erro');
  const btnLogin = document.getElementById('btn-login');
  const togglePassBtn = document.getElementById('togglePassBtn');

  const step1Fields = document.getElementById('step1-fields');
  const step2Fields = document.getElementById('step2-fields');
  const tokenInput = document.getElementById('login-token');
  const tokenInfo = document.getElementById('token-info');
  const btnTokenBack = document.getElementById('btn-token-back');

  let currentStep = 'password';
  let lastLoginPayload = null;

  function setError(message) {
    if (!erroBox) return;

    if (!message) {
      erroBox.classList.add('hidden');
      erroBox.textContent = '';
      return;
    }

    erroBox.textContent = message;
    erroBox.classList.remove('hidden');
  }

  function setLoading(isLoading) {
    if (!btnLogin) return;

    btnLogin.disabled = !!isLoading;

    if (isLoading) {
      btnLogin.innerHTML = '<span>Entrando...</span><i class="fa-solid fa-spinner fa-spin"></i>';
      return;
    }

    if (currentStep === 'token') {
      btnLogin.innerHTML = '<span>Validar código</span><i class="fa-solid fa-arrow-right"></i>';
      return;
    }

    btnLogin.innerHTML = '<span>Entrar</span><i class="fa-solid fa-arrow-right"></i>';
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function goToTokenStep(data = {}) {
    currentStep = 'token';

    step1Fields?.classList.add('hidden');
    step2Fields?.classList.remove('hidden');

    if (tokenInfo) {
      const email = normalizeEmail(emailInput?.value);
      tokenInfo.textContent = data.message || `Digite o código enviado para ${email}.`;
    }

    setError('');
    setLoading(false);

    setTimeout(() => {
      tokenInput?.focus();
    }, 50);
  }

  function goToPasswordStep() {
    currentStep = 'password';

    step2Fields?.classList.add('hidden');
    step1Fields?.classList.remove('hidden');

    if (tokenInput) tokenInput.value = '';

    setError('');
    setLoading(false);

    setTimeout(() => {
      senhaInput?.focus();
    }, 50);
  }

  function saveSessionData(data = {}) {
    const user = data.user || data.usuario || data.conta || {};
    const empresa = data.empresa || {};

    const token =
      data.access_token ||
      data.token ||
      data.jwt ||
      data.session_token ||
      '';

    if (token) {
      localStorage.setItem('access_token', token);
      localStorage.setItem('token', token);
    }

    const nome =
      user.nome ||
      user.name ||
      data.nome ||
      data.user_nome ||
      '';

    const email =
      user.email ||
      data.email ||
      emailInput?.value ||
      '';

    const empresaId =
      empresa.id ||
      data.empresa_id ||
      user.empresa_id ||
      '';

    const plano =
      empresa.plano ||
      data.plano ||
      '';

    if (nome) localStorage.setItem('nome', nome);
    if (email) localStorage.setItem('email', email);
    if (empresaId) localStorage.setItem('empresa_id', String(empresaId));
    if (plano) localStorage.setItem('plano', plano);

    if (rememberInput?.checked && email) {
      localStorage.setItem('valora_remember_email', email);
    } else {
      localStorage.removeItem('valora_remember_email');
    }
  }

  function redirectAfterLogin(data = {}) {
    const url =
      data.redirect_url ||
      data.redirect ||
      data.next ||
      '/dashboard';

    window.location.href = url;
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data = {};

    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }

    if (!response.ok) {
      const message =
        data.detail ||
        data.message ||
        data.erro ||
        data.error ||
        `Erro HTTP ${response.status}`;

      const err = new Error(message);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  async function tryLogin(payload) {
    const endpoints = [
      '/api/auth/login',
      '/api/login',
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        return await postJson(endpoint, payload);
      } catch (error) {
        lastError = error;

        if (error.status !== 404 && error.status !== 405) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Não foi possível conectar ao servidor.');
  }

  async function tryValidateToken(payload) {
    const endpoints = [
      '/api/auth/validar-token',
      '/api/auth/confirmar-token',
      '/api/auth/login',
      '/api/login',
    ];

    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        return await postJson(endpoint, payload);
      } catch (error) {
        lastError = error;

        if (error.status !== 404 && error.status !== 405) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Não foi possível validar o código.');
  }

  function needsToken(data = {}) {
    return !!(
      data.requer_token ||
      data.requires_token ||
      data.token_required ||
      data.two_factor_required ||
      data.mfa_required ||
      data.precisa_token
    );
  }

  async function handlePasswordSubmit() {
    const email = normalizeEmail(emailInput?.value);
    const senha = String(senhaInput?.value || '');

    if (!email) {
      setError('Digite seu e-mail.');
      emailInput?.focus();
      return;
    }

    if (!isValidEmail(email)) {
      setError('Digite um e-mail válido.');
      emailInput?.focus();
      return;
    }

    if (!senha) {
      setError('Digite sua senha.');
      senhaInput?.focus();
      return;
    }

    setError('');
    setLoading(true);

    const payload = {
      email,
      senha,
      password: senha,
      remember: !!rememberInput?.checked,
    };

    lastLoginPayload = payload;

    try {
      const data = await tryLogin(payload);

      if (needsToken(data)) {
        goToTokenStep(data);
        return;
      }

      saveSessionData(data);
      redirectAfterLogin(data);
    } catch (error) {
      setError(error.message || 'Não foi possível entrar. Verifique os dados e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTokenSubmit() {
    const token = String(tokenInput?.value || '').trim();

    if (!token || token.length < 4) {
      setError('Digite o código de verificação.');
      tokenInput?.focus();
      return;
    }

    setError('');
    setLoading(true);

    const payload = {
      ...(lastLoginPayload || {}),
      token,
      codigo: token,
      code: token,
    };

    try {
      const data = await tryValidateToken(payload);

      saveSessionData(data);
      redirectAfterLogin(data);
    } catch (error) {
      setError(error.message || 'Código inválido. Confira e tente novamente.');
    } finally {
      setLoading(false);
    }
  }

  function initRememberedEmail() {
    const remembered = localStorage.getItem('valora_remember_email');

    if (remembered && emailInput) {
      emailInput.value = remembered;

      if (rememberInput) {
        rememberInput.checked = true;
      }

      senhaInput?.focus();
      return;
    }

    emailInput?.focus();
  }

  function initPasswordToggle() {
    if (!togglePassBtn || !senhaInput) return;

    togglePassBtn.addEventListener('click', () => {
      const isPassword = senhaInput.type === 'password';

      senhaInput.type = isPassword ? 'text' : 'password';

      togglePassBtn.innerHTML = isPassword
        ? '<i class="fa-regular fa-eye-slash"></i>'
        : '<i class="fa-regular fa-eye"></i>';

      togglePassBtn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
      senhaInput.focus();
    });
  }

  function initTokenInput() {
    if (!tokenInput) return;

    tokenInput.addEventListener('input', () => {
      tokenInput.value = tokenInput.value.replace(/\D/g, '').slice(0, 6);
    });
  }

  function initEvents() {
    form?.addEventListener('submit', (event) => {
      event.preventDefault();

      if (currentStep === 'token') {
        handleTokenSubmit();
      } else {
        handlePasswordSubmit();
      }
    });

    btnTokenBack?.addEventListener('click', () => {
      goToPasswordStep();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && currentStep === 'token') {
        goToPasswordStep();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initRememberedEmail();
    initPasswordToggle();
    initTokenInput();
    initEvents();
    setError('');
    setLoading(false);
  });
})();
