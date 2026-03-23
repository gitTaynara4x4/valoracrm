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

  const step1 = document.getElementById('step1-fields');
  const step2 = document.getElementById('step2-fields');
  const tokenInput = document.getElementById('cadastro-token');
  const btnBack = document.getElementById('btn-token-back');

  const selectedPlanName = document.getElementById('selectedPlanName');
  const selectedPlanDesc = document.getElementById('selectedPlanDesc');

  let currentStep = 1;
  let currentEmail = '';

  // Função Padrão de Notificação do Valora CRM
  function toast(msg, error = false, ms = 3500) {
    const el = document.getElementById("valora-toast");
    if (!el) return;
    el.textContent = msg || "";
    if (error) el.classList.add("is-error");
    else el.classList.remove("is-error");
    
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.classList.remove("show"); }, ms);
  }

  function setLoading(state, text) {
    btn.disabled = !!state;
    if(state) {
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${text}`;
    } else {
      btn.textContent = text || (currentStep === 1 ? 'Enviar código' : 'Confirmar cadastro');
    }
  }

  function goToStep(step) {
    currentStep = step;
    step1.classList.toggle('hidden', step !== 1);
    step2.classList.toggle('hidden', step !== 2);
    setLoading(false, step === 1 ? 'Enviar código' : 'Confirmar cadastro');
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
      const icon = this.querySelector('i');
      if (!input) return;
      
      if(input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
      } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
      }
    });
  });

  if (btnBack) {
    btnBack.addEventListener('click', () => {
      goToStep(1);
    });
  }

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

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

      if (!payload.empresa_nome) return toast('Digite o nome da empresa.', true);
      if (!payload.responsavel_nome) return toast('Digite o nome do responsável.', true);
      if (!payload.email) return toast('Digite o e-mail.', true);
      if (!payload.telefone) return toast('Digite o telefone.', true);
      if (onlyDigits(payload.telefone).length < 10) return toast('Digite um telefone válido.', true);
      if (!payload.senha) return toast('Digite a senha.', true);
      if (payload.senha.length < 6) return toast('A senha deve ter no mínimo 6 caracteres.', true);
      if (payload.senha !== payload.confirmar_senha) return toast('As senhas não conferem.', true);

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
          toast(data.detail || 'Não foi possível enviar o código.', true);
          setLoading(false, 'Enviar código');
          return;
        }

        currentEmail = payload.email;
        toast('Código enviado para o seu e-mail!');
        goToStep(2);
        return;

      } catch (err) {
        console.error(err);
        toast('Erro de conexão com o servidor.', true);
        setLoading(false, 'Enviar código');
        return;
      }
    }

    // Step 2: Confirmação do Token
    const codigo = (tokenInput.value || '').trim();

    if (!codigo) {
      toast('Digite o código de confirmação.', true);
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
        toast(data2.detail || 'Código inválido ou expirado.', true);
        setLoading(false, 'Confirmar cadastro');
        return;
      }

      toast('Conta criada com sucesso! Redirecionando...');
      form.reset();
      
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);

    } catch (err2) {
      console.error(err2);
      toast('Erro de conexão com o servidor.', true);
      setLoading(false, 'Confirmar cadastro');
    }
  });
})();