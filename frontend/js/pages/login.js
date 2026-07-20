(() => {
  'use strict';

  const form = document.getElementById('form-login');
  const emailInput = document.getElementById('email');
  const senhaInput = document.getElementById('senha');
  const rememberInput = document.getElementById('remember');
  const erroBox = document.getElementById('erro');
  const btnLogin = document.getElementById('btn-login');
  const togglePassBtn = document.getElementById('togglePassBtn');
  const googleLoginBtn = document.getElementById('btn-google-login');
  const ssoLoginBtn = document.getElementById('btn-sso-login');
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const supportLink = document.getElementById('support-link');

  const step1Fields = document.getElementById('step1-fields');
  const step2Fields = document.getElementById('step2-fields');
  const tokenInput = document.getElementById('login-token');
  const tokenInfo = document.getElementById('token-info');
  const btnTokenBack = document.getElementById('btn-token-back');
  const companyField = document.getElementById('company-field');
  const companySelect = document.getElementById('empresa-login');

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
      btnLogin.innerHTML = '<span>Entrando...</span><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
      return;
    }

    if (currentStep === 'token') {
      btnLogin.innerHTML = '<span>Validar código</span>';
      return;
    }

    btnLogin.innerHTML = '<span>Entrar</span>';
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

  function hideCompanyChoices() {
    companyField?.classList.add('hidden');
    if (companySelect) companySelect.innerHTML = '';
  }

  function showCompanyChoices(empresas = []) {
    if (!companyField || !companySelect || !Array.isArray(empresas) || !empresas.length) return;

    companySelect.replaceChildren();

    empresas.forEach((empresa) => {
      const id = String(empresa.empresa_id || empresa.id || '');
      const nome = String(empresa.nome || `Empresa #${id}`);
      const option = document.createElement('option');
      option.value = id;
      option.textContent = nome;
      companySelect.appendChild(option);
    });

    const rememberedCompany = localStorage.getItem('empresa_id');
    if (rememberedCompany && [...companySelect.options].some((option) => option.value === rememberedCompany)) {
      companySelect.value = rememberedCompany;
    }

    companyField.classList.remove('hidden');
    companySelect.focus();
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
      const detail = data.detail;
      const message =
        (detail && typeof detail === 'object' ? detail.message : detail) ||
        data.message ||
        data.erro ||
        data.error ||
        `Erro HTTP ${response.status}`;

      const err = new Error(String(message));
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
    return postJson('/api/auth/login/token', payload);
  }

  function needsToken(data = {}) {
    return !!(
      data.require_token ||
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
      empresa_id: companySelect?.value ? Number(companySelect.value) : null,
    };

    lastLoginPayload = payload;

    try {
      const data = await tryLogin(payload);

      if (needsToken(data)) {
        lastLoginPayload = {
          ...payload,
          challenge: data.challenge || null,
          empresa_id: data.empresa_id || payload.empresa_id || null,
        };
        goToTokenStep(data);
        return;
      }

      saveSessionData(data);
      redirectAfterLogin(data);
    } catch (error) {
      const detail = error?.data?.detail;
      const requiresCompany = error?.data?.requires_company || detail?.requires_company;
      const empresas = error?.data?.empresas || detail?.empresas || [];

      if (requiresCompany && empresas.length) {
        showCompanyChoices(empresas);
        setError('Este e-mail está vinculado a mais de uma empresa. Escolha qual deseja acessar.');
      } else {
        setError(error.message || 'Não foi possível entrar. Verifique os dados e tente novamente.');
      }
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

  function showUnavailableFeature(message) {
    setError(message);
    erroBox?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function initEvents() {
    emailInput?.addEventListener('input', hideCompanyChoices);

    googleLoginBtn?.addEventListener('click', () => {
      showUnavailableFeature('O acesso com Google ainda não está configurado neste ambiente. Use seu e-mail e senha.');
    });

    ssoLoginBtn?.addEventListener('click', () => {
      showUnavailableFeature('O acesso por SSO ainda não está configurado neste ambiente. Use seu e-mail e senha.');
    });

    forgotPasswordLink?.addEventListener('click', (event) => {
      event.preventDefault();
      showUnavailableFeature('A recuperação automática de senha ainda não está configurada. Entre em contato com o suporte.');
    });

    supportLink?.addEventListener('click', (event) => {
      event.preventDefault();
      showUnavailableFeature('Entre em contato com o administrador da sua empresa para receber ajuda com o acesso.');
    });

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
