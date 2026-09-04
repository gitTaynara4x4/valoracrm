(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { token: '', data: null, busy: false, contractLoading: false, contractLoaded: false, contractStatus: 'nao_iniciado' };

  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const date = (value) => {
    if (!value) return '—';
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-');
    return y && m && d ? `${d}/${m}/${y}` : raw;
  };
  const dateTime = (value) => {
    if (!value) return '—';
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const assetUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw, window.location.origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  };
  const whatsappUrl = (phone) => {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('0')) digits = digits.slice(1);
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (digits.length < 12 || digits.length > 13) return '';
    return `https://wa.me/${digits}`;
  };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body,
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_) { payload = {}; }
    if (!response.ok) throw new Error(payload.detail || payload.message || 'Não foi possível concluir a operação.');
    return payload;
  }

  function tokenFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    const index = parts.indexOf('proposta-cliente');
    return index >= 0 ? decodeURIComponent(parts[index + 1] || '') : '';
  }

  function detail(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="proposal-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function tags(list = []) {
    return list.map((item) => `<span class="proposal-tag">${escapeHtml(item.label || item.codigo || item)}</span>`).join('');
  }

  function renderProposal(response) {
    state.data = response;
    const proposal = response.proposta || {};
    const budget = proposal.orcamento || {};
    const client = proposal.cliente || {};
    const emitter = proposal.emitente || {};
    const commercial = proposal.comercial || {};

    const emitterName = emitter.razao_social || emitter.nome || 'SEG Sistemas';
    const emitterIdentity = [emitter.nome, emitter.razao_social].filter(Boolean).join(' ');
    const segsisFallbackLogo = /\bsegsis\b|\bseg\s+sistemas\b|sistemas\s+e\s+gerenciamentos\s+integrados/i.test(emitterIdentity)
      ? '/frontend/img/propostas/segsis-modelo-logo.png'
      : '';
    const logoUrl = assetUrl(emitter.logo || segsisFallbackLogo);
    const logo = $('proposal-brand-logo');
    const brandMark = $('proposal-brand-mark');
    $('proposal-emitter-name').textContent = emitterName;
    $('proposal-footer-emitter').textContent = emitterName;
    brandMark.textContent = String(emitter.nome || emitterName || 'SEG').trim().charAt(0).toUpperCase() || 'S';
    logo.hidden = !logoUrl;
    brandMark.hidden = Boolean(logoUrl);
    if (logoUrl) {
      logo.src = logoUrl;
      logo.alt = `Logo de ${emitterName}`;
      logo.onerror = () => {
        logo.hidden = true;
        brandMark.hidden = false;
      };
    } else {
      logo.removeAttribute('src');
      logo.alt = '';
    }
    $('proposal-emitter-address').textContent = emitter.endereco || '';
    $('proposal-emitter-address').hidden = !emitter.endereco;
    $('proposal-emitter-meta').textContent = [emitter.cnpj, emitter.telefone, emitter.email].filter(Boolean).join(' · ');
    $('proposal-emitter-meta').hidden = ![emitter.cnpj, emitter.telefone, emitter.email].some(Boolean);
    $('proposal-footer-contact').textContent = [emitter.endereco, emitter.telefone, emitter.email, emitter.site].filter(Boolean).join(' · ');
    const contactUrl = whatsappUrl(emitter.telefone);
    $('proposal-whatsapp-link').hidden = !contactUrl;
    $('proposal-whatsapp-link').href = contactUrl || '#';
    $('proposal-code').textContent = budget.codigo || '—';
    $('proposal-title').textContent = budget.titulo || 'Proposta comercial';
    document.title = `${budget.codigo || 'Proposta'} — ${emitter.nome || emitterName}`;
    $('proposal-client-name').textContent = client.nome_fantasia || client.nome || 'cliente';
    $('proposal-total').textContent = money(budget.total);
    $('proposal-validity').textContent = budget.data_validade ? `Válida até ${date(budget.data_validade)}` : 'Validade conforme condições da proposta';

    const items = proposal.itens || [];
    $('proposal-items').innerHTML = items.length ? items.map((item) => `
      <tr>
        <td><div class="proposal-item-description"><strong>${escapeHtml(item.descricao || 'Item')}</strong><small>${escapeHtml([item.codigo, item.unidade].filter(Boolean).join(' • '))}</small></div></td>
        <td data-label="Quantidade">${escapeHtml(item.quantidade || '0')}</td>
        <td data-label="Unitário">${money(item.valor_unitario)}</td>
        <td data-label="Total">${money(item.valor_total)}</td>
      </tr>`).join('') : '<tr><td colspan="4">Nenhum item informado.</td></tr>';

    const values = [
      ['Subtotal', budget.subtotal, Number(budget.subtotal || 0) > 0],
      ['Desconto', budget.desconto_total, Number(budget.desconto_total || 0) > 0],
      ['Frete', budget.frete, Number(budget.frete || 0) > 0],
      ['Acréscimos', budget.acrescimo, Number(budget.acrescimo || 0) > 0],
    ].filter(([, , show]) => show).map(([label, value]) => `<div class="proposal-value-line"><span>${label}</span><strong>${money(value)}</strong></div>`);
    values.push(`<div class="proposal-value-line total"><span>Total</span><strong>${money(budget.total)}</strong></div>`);
    $('proposal-values').innerHTML = values.join('');

    $('proposal-commercial-details').innerHTML = [
      detail('Natureza', commercial.natureza?.label),
      detail('Tipo de contrato', commercial.tipo_contrato?.label),
      detail('Prazo de execução', budget.prazo_execucao),
      detail('Validade', budget.data_validade ? date(budget.data_validade) : null),
    ].join('');

    $('proposal-services').innerHTML = tags(commercial.servicos || []);
    $('proposal-plans').innerHTML = tags(commercial.planos || []);
    $('proposal-services-group').hidden = !(commercial.servicos || []).length;
    $('proposal-plans-group').hidden = !(commercial.planos || []).length;

    $('proposal-payment-details').innerHTML = [
      detail('Forma de pagamento', commercial.forma_pagamento?.label),
      detail('Condição', commercial.condicao_pagamento),
      Number(commercial.valor_implantacao || 0) > 0 ? detail('Implantação', money(commercial.valor_implantacao)) : '',
      Number(commercial.valor_mensal || 0) > 0 ? detail('Mensalidade', money(commercial.valor_mensal)) : '',
      commercial.dia_vencimento ? detail('Vencimento mensal', `Dia ${commercial.dia_vencimento}`) : '',
    ].join('');

    const approved = response.status === 'aprovado';
    const changeRequested = response.status === 'alteracao_solicitada';
    $('proposal-outdated-alert').hidden = !response.desatualizada || approved || changeRequested;
    $('proposal-approved-alert').hidden = !approved;
    $('proposal-change-alert').hidden = !changeRequested;
    if (approved) $('proposal-approved-text').textContent = `Registrada em ${dateTime(response.aprovado_em)}.`;
    if (changeRequested) $('proposal-change-text').textContent = response.alteracao_mensagem || 'A equipe recebeu sua solicitação.';

    const canAct = Boolean(response.pode_aprovar || response.pode_solicitar_alteracao);
    $('proposal-action-panel').hidden = !canAct;
    $('proposal-accept-check').checked = false;
    $('btn-approve-proposal').disabled = true;
    $('proposal-change-form').hidden = true;

    const contractStatus = response.cadastro_contrato?.status || 'nao_iniciado';
    state.contractStatus = contractStatus;
    if (approved) {
      window.setTimeout(() => loadContractRegistration(false), 0);
    } else {
      $('contract-registration').hidden = true;
      state.contractLoaded = false;
    }
  }

  const value = (id) => ($(id)?.value || '').trim();
  const setValue = (id, content) => { if ($(id)) $(id).value = content || ''; };

  function selectedPersonType() {
    return document.querySelector('input[name="contract-person-type"]:checked')?.value || 'PF';
  }

  function updateContractPersonType(type) {
    const normalized = String(type || 'PF').toUpperCase() === 'PJ' ? 'PJ' : 'PF';
    document.querySelectorAll('input[name="contract-person-type"]').forEach((input) => { input.checked = input.value === normalized; });
    const isPJ = normalized === 'PJ';
    $('contract-trade-name-field').hidden = !isPJ;
    $('contract-municipal-field').hidden = !isPJ;
    $('contract-pf-extra').hidden = isPJ;
    $('contract-representative-block').hidden = !isPJ;
    $('contract-name-label').textContent = isPJ ? 'Razão Social *' : 'Nome completo *';
    $('contract-document-label').textContent = isPJ ? 'CNPJ *' : 'CPF *';
    $('contract-rg-label').textContent = isPJ ? 'Inscrição Estadual' : 'RG';
    $('contract-identification-title').textContent = isPJ ? 'Dados da empresa' : 'Dados pessoais';
    $('contract-address-step').textContent = isPJ ? '04' : '03';
    $('contract-contact-step').textContent = isPJ ? '05' : '04';
  }

  function renderContractRegistration(response, scroll = false) {
    const data = response.dados || {};
    const rep = data.representante || {};
    state.contractStatus = response.status || 'em_preenchimento';
    state.contractLoaded = true;
    $('contract-registration').hidden = false;
    updateContractPersonType(data.tipo_pessoa || 'PF');

    setValue('contract-name', data.nome);
    setValue('contract-trade-name', data.nome_fantasia);
    setValue('contract-document', data.cpf_cnpj);
    setValue('contract-rg-ie', data.rg_ie);
    setValue('contract-municipal', data.inscricao_municipal);
    setValue('contract-nationality', data.nacionalidade);
    setValue('contract-profession', data.profissao);
    setValue('contract-marital-status', data.estado_civil);
    setValue('contract-birth-date', data.data_nascimento);
    setValue('contract-cep', data.cep);
    setValue('contract-address', data.endereco);
    setValue('contract-number', data.numero);
    setValue('contract-complement', data.complemento);
    setValue('contract-neighborhood', data.bairro);
    setValue('contract-city', data.cidade);
    setValue('contract-state', data.estado);
    setValue('contract-reference', data.ponto_referencia);
    setValue('contract-phone', data.telefone);
    setValue('contract-email', data.email);
    setValue('contract-rep-name', rep.nome);
    setValue('contract-rep-cpf', rep.cpf);
    setValue('contract-rep-rg', rep.rg);
    setValue('contract-rep-role', rep.cargo);
    setValue('contract-rep-nationality', rep.nacionalidade);
    setValue('contract-rep-profession', rep.profissao);
    setValue('contract-rep-marital', rep.estado_civil);
    setValue('contract-rep-birth-date', rep.data_nascimento);
    setValue('contract-rep-phone', rep.telefone);
    setValue('contract-rep-email', rep.email);

    const complete = response.status === 'concluido';
    $('contract-registration-status').textContent = complete ? 'Concluído' : 'Aguardando preenchimento';
    $('contract-registration-status').classList.toggle('is-complete', complete);
    $('contract-complete-alert').hidden = !complete;
    $('contract-registration-form').hidden = complete;
    if (complete) $('contract-complete-text').textContent = response.concluido_em ? `Concluído em ${dateTime(response.concluido_em)}. Os dados já estão no Valora.` : 'Os dados já foram atualizados no Valora.';
    if (scroll) $('contract-registration').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadContractRegistration(scroll = false) {
    if (state.contractLoading || !state.token) return;
    state.contractLoading = true;
    try {
      const response = await api(`/api/proposta-cliente-publica/${encodeURIComponent(state.token)}/cadastro-contrato`);
      renderContractRegistration(response, scroll);
    } catch (error) {
      $('contract-registration').hidden = false;
      $('contract-feedback').hidden = false;
      $('contract-feedback').textContent = error.message;
    } finally {
      state.contractLoading = false;
    }
  }

  function contractPayload() {
    const type = selectedPersonType();
    const representative = type === 'PJ' ? {
      nome: value('contract-rep-name'),
      cpf: value('contract-rep-cpf'),
      rg: value('contract-rep-rg') || null,
      cargo: value('contract-rep-role'),
      nacionalidade: value('contract-rep-nationality') || null,
      profissao: value('contract-rep-profession') || null,
      estado_civil: value('contract-rep-marital') || null,
      data_nascimento: value('contract-rep-birth-date') || null,
      telefone: value('contract-rep-phone') || null,
      email: value('contract-rep-email') || null,
    } : null;
    return {
      tipo_pessoa: type,
      nome: value('contract-name'),
      nome_fantasia: type === 'PJ' ? (value('contract-trade-name') || null) : null,
      cpf_cnpj: value('contract-document'),
      rg_ie: value('contract-rg-ie') || null,
      inscricao_municipal: type === 'PJ' ? (value('contract-municipal') || null) : null,
      nacionalidade: type === 'PF' ? (value('contract-nationality') || null) : null,
      profissao: type === 'PF' ? (value('contract-profession') || null) : null,
      estado_civil: type === 'PF' ? (value('contract-marital-status') || null) : null,
      data_nascimento: type === 'PF' ? (value('contract-birth-date') || null) : null,
      telefone: value('contract-phone'),
      email: value('contract-email'),
      cep: value('contract-cep'),
      endereco: value('contract-address'),
      numero: value('contract-number'),
      complemento: value('contract-complement') || null,
      bairro: value('contract-neighborhood'),
      cidade: value('contract-city'),
      estado: value('contract-state').toUpperCase(),
      ponto_referencia: value('contract-reference') || null,
      representante: representative,
      confirmacao: Boolean($('contract-confirmation').checked),
    };
  }

  function validateContractClient(payload) {
    const required = [
      [payload.nome, payload.tipo_pessoa === 'PJ' ? 'Informe a Razão Social.' : 'Informe o nome completo.'],
      [payload.cpf_cnpj, `Informe o ${payload.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'}.`],
      [payload.cep, 'Informe o CEP.'], [payload.endereco, 'Informe o logradouro.'], [payload.numero, 'Informe o número.'],
      [payload.bairro, 'Informe o bairro.'], [payload.cidade, 'Informe a cidade.'], [payload.estado, 'Informe a UF.'],
      [payload.telefone, 'Informe o telefone/WhatsApp.'], [payload.email, 'Informe o e-mail.'],
    ];
    for (const [content, message] of required) if (!content) return message;
    if (payload.tipo_pessoa === 'PJ') {
      if (!payload.representante?.nome) return 'Informe o nome do representante legal.';
      if (!payload.representante?.cpf) return 'Informe o CPF do representante legal.';
      if (!payload.representante?.cargo) return 'Informe a função/cargo do representante legal.';
    }
    if (!payload.confirmacao) return 'Confirme que os dados informados estão corretos.';
    return '';
  }

  async function completeContractRegistration(event) {
    event.preventDefault();
    if (state.busy) return;
    const payload = contractPayload();
    const validation = validateContractClient(payload);
    if (validation) {
      $('contract-feedback').hidden = false;
      $('contract-feedback').textContent = validation;
      return;
    }
    state.busy = true;
    const button = $('btn-complete-contract-registration');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Salvando dados...';
    $('contract-feedback').hidden = true;
    try {
      const response = await api(`/api/proposta-cliente-publica/${encodeURIComponent(state.token)}/cadastro-contrato`, {
        method: 'POST', body: JSON.stringify(payload),
      });
      await loadContractRegistration(false);
      $('contract-complete-alert').hidden = false;
      $('contract-complete-text').textContent = response.mensagem || 'Os dados foram atualizados no Valora.';
      $('contract-registration').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      $('contract-feedback').hidden = false;
      $('contract-feedback').textContent = error.message;
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = original;
    }
  }

  function showError(message) {
    $('proposal-loading').hidden = true;
    $('proposal-document').hidden = true;
    $('proposal-error').hidden = false;
    $('proposal-error-message').textContent = message || 'Não foi possível abrir esta proposta.';
  }

  async function load() {
    state.token = tokenFromPath();
    if (!state.token) return showError('O link da proposta está incompleto.');
    try {
      const response = await api(`/api/proposta-cliente-publica/${encodeURIComponent(state.token)}`);
      renderProposal(response);
      $('proposal-loading').hidden = true;
      $('proposal-error').hidden = true;
      $('proposal-document').hidden = false;
    } catch (error) {
      showError(error.message);
    }
  }

  async function approve() {
    if (state.busy || !$('proposal-accept-check').checked) return;
    if (!window.confirm('Confirmar a aprovação desta proposta?')) return;
    state.busy = true;
    const button = $('btn-approve-proposal');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Aprovando...';
    try {
      await api(`/api/proposta-cliente-publica/${encodeURIComponent(state.token)}/aprovar`, {
        method: 'POST', body: JSON.stringify({ aceite: true }),
      });
      await load();
      await loadContractRegistration(true);
    } catch (error) {
      $('proposal-action-feedback').hidden = false;
      $('proposal-action-feedback').textContent = error.message;
    } finally {
      state.busy = false;
      button.textContent = original;
      if ($('proposal-action-panel').hidden === false) button.disabled = !$('proposal-accept-check').checked;
    }
  }

  async function sendChange() {
    if (state.busy) return;
    const message = $('proposal-change-message').value.trim();
    if (message.length < 5) {
      $('proposal-action-feedback').hidden = false;
      $('proposal-action-feedback').textContent = 'Explique em poucas palavras o que precisa ser alterado.';
      return;
    }
    state.busy = true;
    const button = $('btn-send-change');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Enviando...';
    try {
      await api(`/api/proposta-cliente-publica/${encodeURIComponent(state.token)}/solicitar-alteracao`, {
        method: 'POST', body: JSON.stringify({ mensagem: message }),
      });
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      $('proposal-action-feedback').hidden = false;
      $('proposal-action-feedback').textContent = error.message;
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = original;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btn-print-proposal').addEventListener('click', () => window.print());
    $('proposal-accept-check').addEventListener('change', (event) => { $('btn-approve-proposal').disabled = !event.target.checked; });
    $('btn-approve-proposal').addEventListener('click', approve);
    $('btn-request-change').addEventListener('click', () => {
      $('proposal-change-form').hidden = false;
      $('proposal-action-feedback').hidden = true;
      $('proposal-change-message').focus();
    });
    $('btn-cancel-change').addEventListener('click', () => { $('proposal-change-form').hidden = true; });
    $('btn-send-change').addEventListener('click', sendChange);
    document.querySelectorAll('input[name="contract-person-type"]').forEach((input) => input.addEventListener('change', () => updateContractPersonType(input.value)));
    $('contract-registration-form').addEventListener('submit', completeContractRegistration);
    $('contract-state').addEventListener('input', (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2); });
    load();
  });
})();
