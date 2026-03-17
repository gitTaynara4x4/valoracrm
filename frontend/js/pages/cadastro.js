(() => {
  'use strict';

  const form = document.getElementById('form-cadastro');
  const btn = document.getElementById('btn-cadastrar');

  const empresaNome = document.getElementById('empresa_nome');
  const responsavelNome = document.getElementById('responsavel_nome');
  const email = document.getElementById('email');
  const telefone = document.getElementById('telefone');
  const senha = document.getElementById('senha');
  const confirmarSenha = document.getElementById('confirmar_senha');
  const exigirTokenLogin = document.getElementById('exigir_token_login');

  const erro = document.getElementById('erro');
  const sucesso = document.getElementById('sucesso');

  const step1 = document.getElementById('step1-fields');
  const step2 = document.getElementById('step2-fields');
  const tokenInput = document.getElementById('cadastro-token');
  const btnBack = document.getElementById('btn-token-back');

  const selectedPlanName = document.getElementById('selectedPlanName');
  const selectedPlanDesc = document.getElementById('selectedPlanDesc');

  let currentStep = 1;
  let currentEmail = '';

  function showError(msg) {
    sucesso.classList.add('hidden');
    sucesso.textContent = '';
    erro.textContent = msg;
    erro.classList.remove('hidden');
  }

  function showSuccess(msg) {
    erro.classList.add('hidden');
    erro.textContent = '';
    sucesso.textContent = msg;
    sucesso.classList.remove('hidden');
  }

  function clearMessages() {
    erro.classList.add('hidden');
    erro.textContent = '';
    sucesso.classList.add('hidden');
    sucesso.textContent = '';
  }

  function setLoading(state, text) {
    btn.disabled = !!state;
    btn.textContent = text || (currentStep === 1 ? 'Enviar código' : 'Confirmar cadastro');
  }

  function goToStep(step) {
    currentStep = step;
    step1.classList.toggle('hidden', step !== 1);
    step2.classList.toggle('hidden', step !== 2);
    btn.textContent = step === 1 ? 'Enviar código' : 'Confirmar cadastro';
    if (step === 2 && tokenInput) {
      tokenInput.value = '';
      tokenInput.focus();
    }
  }

  function onlyDigits(v) {
    return (v || '').replace(/\D/g, '');
  }

  function maskPhone(v) {
    v = onlyDigits(v).slice(0, 11);
    if (v.length <= 10) {
      return v
        .replace(/^(\d{0,2})/, '($1')
        .replace(/^(\(\d{2})(\d)/, '$1) $2')
        .replace(/(\d{4})(\d)/, '$1-$2');
    }
    return v
      .replace(/^(\d{0,2})/, '($1')
      .replace(/^(\(\d{2})(\d)/, '$1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  }

  function getPlanoDaUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const plano = (params.get('plano') || 'essencial').toLowerCase();
    if (!['essencial', 'profissional', 'empresarial'].includes(plano)) {
      return 'essencial';
    }
    return plano;
  }

  function getPlanoMeta(plano) {
    const planos = {
      essencial: {
        nome: 'Essencial — R$ 0',
        descricao: 'Plano gratuito para começar.'
      },
      profissional: {
        nome: 'Profissional — R$ 97/mês',
        descricao: 'Inclui teste grátis de 7 dias.'
      },
      empresarial: {
        nome: 'Empresarial — R$ 197/mês',
        descricao: 'Plano para equipes e operação avançada.'
      }
    };
    return planos[plano] || planos.essencial;
  }

  const planoSelecionado = getPlanoDaUrl();
  const planoMeta = getPlanoMeta(planoSelecionado);

  if (selectedPlanName) selectedPlanName.textContent = planoMeta.nome;
  if (selectedPlanDesc) selectedPlanDesc.textContent = planoMeta.descricao;

  if (telefone) {
    telefone.addEventListener('input', () => {
      telefone.value = maskPhone(telefone.value);
    });
  }

  document.querySelectorAll('.toggle-pass').forEach((b) => {
    b.addEventListener('click', function () {
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      this.style.opacity = input.type === 'text' ? '1' : '.7';
    });
  });

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      clearMessages();
      goToStep(1);
      setLoading(false, 'Enviar código');
    });
  }

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();

    if (currentStep === 1) {
      const payload = {
        empresa_nome: (empresaNome.value || '').trim(),
        responsavel_nome: (responsavelNome.value || '').trim(),
        email: (email.value || '').trim().toLowerCase(),
        telefone: (telefone.value || '').trim(),
        senha: (senha.value || '').trim(),
        confirmar_senha: (confirmarSenha.value || '').trim(),
        cargo: 'admin',
        exigir_token_login: !!(exigirTokenLogin && exigirTokenLogin.checked),
        plano: planoSelecionado
      };

      if (!payload.empresa_nome) return showError('Digite o nome da empresa.');
      if (!payload.responsavel_nome) return showError('Digite o nome do responsável.');
      if (!payload.email) return showError('Digite o e-mail.');
      if (!payload.telefone) return showError('Digite o telefone.');
      if (onlyDigits(payload.telefone).length < 10) return showError('Digite um telefone válido.');
      if (!payload.senha) return showError('Digite a senha.');
      if (payload.senha.length < 6) return showError('A senha deve ter no mínimo 6 caracteres.');
      if (payload.senha !== payload.confirmar_senha) return showError('As senhas não conferem.');

      try {
        setLoading(true, 'Enviando código...');

        const res = await fetch('/api/auth/cadastro/iniciar', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          showError(data.detail || 'Não foi possível enviar o código.');
          setLoading(false, 'Enviar código');
          return;
        }

        currentEmail = payload.email;
        showSuccess('Código enviado com sucesso.');
        goToStep(2);
        setLoading(false, 'Confirmar cadastro');
        return;

      } catch (err) {
        console.error(err);
        showError('Erro de conexão com o servidor.');
        setLoading(false, 'Enviar código');
        return;
      }
    }

    const codigo = (tokenInput.value || '').trim();

    if (!codigo) {
      showError('Digite o código de confirmação.');
      return;
    }

    try {
      setLoading(true, 'Confirmando...');

      const res2 = await fetch('/api/auth/cadastro/confirmar', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentEmail || (email.value || '').trim().toLowerCase(),
          token: codigo
        })
      });

      const data2 = await res2.json().catch(() => ({}));

      if (!res2.ok) {
        showError(data2.detail || 'Código inválido ou expirado.');
        setLoading(false, 'Confirmar cadastro');
        return;
      }

      showSuccess('Conta criada com sucesso. Redirecionando para o login...');
      form.reset();
      setLoading(false, 'Confirmar cadastro');

      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);

    } catch (err2) {
      console.error(err2);
      showError('Erro de conexão com o servidor.');
      setLoading(false, 'Confirmar cadastro');
    }
  });
})();