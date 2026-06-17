(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  function getLS(key, fallback = '') {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function getFirstName(name) {
    return String(name || 'Usuário').trim().split(/\s+/)[0] || 'Usuário';
  }

  function getInitials(name) {
    const clean = String(name || 'Usuário').trim();

    if (!clean) return 'U';

    const parts = clean.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return clean.slice(0, 2).toUpperCase();
  }

  function applyLocalUser() {
    const nome =
      getLS('nome') ||
      getLS('user_nome') ||
      getLS('usuario_nome') ||
      'Usuário';

    const email =
      getLS('email') ||
      getLS('user_email') ||
      getLS('usuario_email') ||
      'email@empresa.com';

    const empresaId =
      getLS('empresa_id') ||
      getLS('empresaId') ||
      '--';

    const plano =
      getLS('plano') ||
      getLS('empresa_plano') ||
      'Essencial';

    setText('userName', nome);
    setText('userEmail', email);
    setText('userAvatar', getInitials(nome));

    setText('welcomeTitle', `Olá, ${getFirstName(nome)} 👋`);
    setText(
      'welcomeText',
      'Configure sua conta, cadastre seus primeiros clientes e comece a gerar propostas de forma rápida e profissional.'
    );

    setText('planName', plano);
    setText('companyIdInfo', empresaId === '--' ? 'ID da Empresa: #--' : `ID da Empresa: #${empresaId}`);
  }

  function applyResumo(data) {
    const empresa = data?.empresa || {};
    const stats = data?.stats || {};

    if (data?.sistema_online === false) {
      setText('dashboardStatusText', 'Sistema indisponível');
    } else {
      setText('dashboardStatusText', 'Sistema Online e Ativo');
    }

    if (empresa.plano) {
      setText('planName', empresa.plano);
    }

    if (empresa.id) {
      setText('companyIdInfo', `ID da Empresa: #${empresa.id}`);
    }

    setText('statClientes', String(stats.clientes_total ?? stats.clientes ?? 0));
    setText('statPropostas', String(stats.propostas_ativas ?? stats.propostas_mes ?? stats.propostas ?? 0));
    setText('statUsuarios', String(stats.usuarios_total ?? stats.usuarios ?? 1));

    const licenca = stats.licenca_status || stats.status_licenca || 'Regular';
    setText('statLicenca', licenca);

    const checkClientes = $('checkClientes');
    if (checkClientes) {
      checkClientes.checked = Number(stats.clientes_total || stats.clientes || 0) > 0;
    }

    const checkPropostas = $('checkPropostas');
    if (checkPropostas) {
      checkPropostas.checked = Number(stats.propostas_ativas || stats.propostas_mes || stats.propostas || 0) > 0;
    }

    const checkConfig = $('checkConfig');
    if (checkConfig) {
      checkConfig.checked = !!empresa.id || !!empresa.nome;
    }

    const checkSeguranca = $('checkSeguranca');
    if (checkSeguranca) {
      checkSeguranca.checked = true;
    }
  }

  async function loadResumo() {
    try {
      const response = await fetch('/api/dashboard/resumo', {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      applyResumo(data);
    } catch (error) {
      console.warn('[Valora Dashboard] Não foi possível carregar /api/dashboard/resumo:', error);

      setText('dashboardStatusText', 'Sistema Online e Ativo');

      setText('statClientes', '0');
      setText('statPropostas', '0');
      setText('statUsuarios', '1');
      setText('statLicenca', 'Regular');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyLocalUser();
    loadResumo();
  });
})();