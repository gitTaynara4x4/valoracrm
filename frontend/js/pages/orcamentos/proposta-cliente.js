/*
 * ValoraCRM · Orçamentos · proposta-cliente.js
 * Preparação, publicação e acompanhamento da proposta enviada ao cliente.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function proposalSelectedValues(name) {
    return $$(`input[name="${name}"]:checked`).map((input) => input.value);
  }

  function setProposalCheckedValues(name, values = []) {
    const selected = new Set((values || []).map((value) => String(value)));
    $$(`input[name="${name}"]`).forEach((input) => { input.checked = selected.has(input.value); });
  }

  function selectedBudgetPayment() {
    return state.payments.find((payment) => payment.selecionada) || state.payments[0] || null;
  }

  function proposalPaymentFromBudget() {
    const payment = selectedBudgetPayment();
    if (!payment) return { forma: '', condicao: '' };
    const typeMap = {
      pix: 'pix',
      boleto: 'boleto',
      cartao: 'cartao',
      cheque: 'cheque',
      dinheiro: 'dinheiro',
      avista: '',
      entrada_parcelas: '',
      personalizado: '',
    };
    const parts = [payment.nome, payment.descricao].filter(Boolean);
    if (Number(payment.entrada_valor || 0) > 0) parts.push(`Entrada de ${formatMoney(payment.entrada_valor)}`);
    if (Number(payment.parcelas || 0) > 1) parts.push(`${Number(payment.parcelas)} parcelas`);
    if (Number(payment.juros_percentual || 0) > 0) parts.push(`${Number(payment.juros_percentual).toLocaleString('pt-BR')}% de juros`);
    return {
      forma: typeMap[String(payment.tipo || '').toLowerCase()] || 'outro',
      condicao: parts.join(' • ') || payment.nome || 'Condição definida no orçamento',
    };
  }

  function proposalDateTime(value) {
    if (!value) return '—';
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fillProposalClientPreparation(budget) {
    const prep = budget?.preparacao_cliente || {};
    const publication = budget?.publicacao_cliente || {};
    $('proposal-client-budget-code').textContent = budget?.codigo || '—';
    $('proposal-client-name').textContent = budget?.cliente_nome || budget?.cliente_razao_social || 'Cliente não vinculado';
    $('proposal-client-total').textContent = formatMoney(budget?.total || 0);
    const [statusLabel] = proposalPublicStatusInfo(publication.status || (prep.preparada ? 'preparada' : 'nao_gerado'));
    $('proposal-client-status').textContent = statusLabel;
    $('proposal-client-status').classList.toggle('is-ready', Boolean(prep.preparada));

    $$('input[name="proposal-natureza"]').forEach((input) => { input.checked = input.value === String(prep.natureza || ''); });
    setProposalCheckedValues('proposal-servico', prep.servicos || []);
    setProposalCheckedValues('proposal-plano', prep.planos || []);
    $('proposal-tipo-contrato').value = prep.tipo_contrato || '';
    $('proposal-valor-implantacao').value = inputMoney(prep.valor_implantacao || 0);
    $('proposal-valor-mensal').value = inputMoney(prep.valor_mensal || 0);
    $('proposal-dia-vencimento').value = prep.dia_vencimento || '';

    const budgetPayment = proposalPaymentFromBudget();
    $('proposal-forma-pagamento').value = prep.forma_pagamento || budgetPayment.forma || '';
    $('proposal-condicao-pagamento').value = prep.condicao_pagamento || budgetPayment.condicao || '';

    const approved = publication.status === 'aprovado';
    $('btn-salvar-proposal-client').disabled = approved;
    if (approved) $('btn-salvar-proposal-client').innerHTML = '<i class="fa-solid fa-check"></i> Aprovada pelo cliente';
    else $('btn-salvar-proposal-client').innerHTML = '<i class="fa-solid fa-link"></i> Salvar e gerar link';
  }

  function renderProposalClientLink(info = {}) {
    const status = String(info.status || 'nao_gerado');
    const [label, className] = proposalPublicStatusInfo(status);
    const badge = $('proposal-client-link-status');
    badge.textContent = info.desatualizado ? 'Link desatualizado' : label;
    badge.className = `proposal-client-link-badge ${info.desatualizado ? 'status-desativado' : className}`.trim();

    const hasLink = Boolean(info.tem_link && info.url);
    $('proposal-client-link-box').classList.toggle('is-hidden', !hasLink);
    $('proposal-client-link-empty').classList.toggle('is-hidden', hasLink);
    $('proposal-client-public-url').value = info.url || '';

    const meta = [];
    if (info.gerado_em) meta.push(`<span><i class="fa-regular fa-calendar"></i> Gerado ${escapeHtml(proposalDateTime(info.gerado_em))}</span>`);
    if (info.expira_em) meta.push(`<span><i class="fa-regular fa-clock"></i> Expira ${escapeHtml(proposalDateTime(info.expira_em))}</span>`);
    if (Number(info.visualizacoes || 0) > 0) meta.push(`<span><i class="fa-regular fa-eye"></i> ${Number(info.visualizacoes)} visualização${Number(info.visualizacoes) === 1 ? '' : 'ões'}</span>`);
    $('proposal-client-link-meta').innerHTML = meta.join('');

    const feedback = $('proposal-client-link-feedback');
    const messages = [];
    if (info.desatualizado) messages.push('O orçamento foi alterado depois que este link foi criado. Gere um novo link antes de enviar ao cliente.');
    if (status === 'visualizado' && info.primeira_visualizacao_em) messages.push(`O cliente abriu a proposta em ${proposalDateTime(info.primeira_visualizacao_em)}.`);
    if (status === 'aprovado') messages.push(`Aprovação registrada em ${proposalDateTime(info.aprovado_em)}.`);
    if (info.cadastro_contrato?.status === 'concluido') messages.push(`Cadastro para contrato concluído${info.cadastro_contrato.concluido_em ? ` em ${proposalDateTime(info.cadastro_contrato.concluido_em)}` : ''}.`);
    else if (status === 'aprovado' && ['pendente', 'em_preenchimento'].includes(info.cadastro_contrato?.status)) messages.push('Aguardando o cliente concluir o cadastro para contrato.');
    if (status === 'alteracao_solicitada') messages.push(`Cliente solicitou alteração${info.alteracao_solicitada_em ? ` em ${proposalDateTime(info.alteracao_solicitada_em)}` : ''}: ${info.alteracao_mensagem || 'sem mensagem'}`);
    feedback.textContent = messages.join(' ');
    feedback.classList.toggle('is-hidden', !messages.length);

    const approved = status === 'aprovado';
    $('btn-regenerar-proposal-link').disabled = approved;
    $('btn-desativar-proposal-link').disabled = approved;
    $('btn-copiar-proposal-link').disabled = !hasLink;
    $('btn-abrir-proposal-link').disabled = !hasLink;
    $('proposal-client-link-help').textContent = approved
      ? 'A aprovação foi registrada e preservada no histórico do orçamento.'
      : status === 'alteracao_solicitada'
        ? 'Revise os dados acima e gere uma nova versão para responder ao cliente.'
        : 'Compartilhe este link com o cliente para visualização e aprovação.';
  }

  async function loadProposalClientLink() {
    if (!state.currentId) return renderProposalClientLink({});
    try {
      const info = await api(`${API}/${state.currentId}/proposta-cliente/link`);
      renderProposalClientLink(info);
      if (state.current) {
        state.current.publicacao_cliente = { ...(state.current.publicacao_cliente || {}), status: info.status, link_ativo: info.ativo, versao_link: info.versao, aprovado_em: info.aprovado_em, alteracao_solicitada_em: info.alteracao_solicitada_em, alteracao_mensagem: info.alteracao_mensagem, cadastro_contrato: info.cadastro_contrato };
      }
    } catch (error) {
      renderProposalClientLink({});
      toast(error.message || 'Não foi possível consultar o link da proposta.', 'error');
    }
  }

  async function openProposalClientPreparation() {
    if (!state.currentId) {
      toast('Salve o orçamento antes de preparar o envio ao cliente.', 'error');
      return;
    }
    if (!Number($('orcamento-cliente-id').value || state.current?.cliente_id || 0)) {
      toast('Selecione um cliente antes de preparar o envio.', 'error');
      return;
    }
    fillProposalClientPreparation(state.current || {});
    renderProposalClientLink({ status: state.current?.publicacao_cliente?.status || 'nao_gerado' });
    openOverlay('proposal-client-modal');
    await loadProposalClientLink();
  }

  function useBudgetPaymentInProposal() {
    const payment = proposalPaymentFromBudget();
    if (!payment.condicao) {
      toast('Cadastre uma condição na aba Pagamento do orçamento primeiro.', 'error');
      return;
    }
    $('proposal-forma-pagamento').value = payment.forma;
    $('proposal-condicao-pagamento').value = payment.condicao;
    toast('Condição de pagamento trazida do orçamento.');
  }

  function collectProposalClientPreparation() {
    const natureza = $('proposal-natureza-options').querySelector('input[name="proposal-natureza"]:checked')?.value || '';
    const diaRaw = String($('proposal-dia-vencimento').value || '').trim();
    return {
      natureza,
      servicos: proposalSelectedValues('proposal-servico'),
      planos: proposalSelectedValues('proposal-plano'),
      tipo_contrato: $('proposal-tipo-contrato').value || null,
      valor_implantacao: parseInputNumber($('proposal-valor-implantacao').value),
      valor_mensal: parseInputNumber($('proposal-valor-mensal').value),
      dia_vencimento: diaRaw ? Number(diaRaw) : null,
      forma_pagamento: $('proposal-forma-pagamento').value,
      condicao_pagamento: $('proposal-condicao-pagamento').value.trim(),
    };
  }

  function validateProposalClientPreparation(payload) {
    if (!payload.natureza) throw new Error('Selecione a natureza da proposta.');
    if (!payload.forma_pagamento) throw new Error('Selecione a forma de pagamento.');
    if (!payload.condicao_pagamento) throw new Error('Informe a condição de pagamento.');
    if (payload.dia_vencimento !== null && (!Number.isInteger(payload.dia_vencimento) || payload.dia_vencimento < 1 || payload.dia_vencimento > 31)) {
      throw new Error('O dia de vencimento deve estar entre 1 e 31.');
    }
  }

  async function generateProposalClientLink(regenerar = false) {
    const info = await api(`${API}/${state.currentId}/proposta-cliente/link`, {
      method: 'POST',
      body: JSON.stringify({ regenerar: Boolean(regenerar) }),
    });
    renderProposalClientLink(info);
    if (state.current) {
      state.current.publicacao_cliente = { ...(state.current.publicacao_cliente || {}), status: info.status, link_ativo: info.ativo, versao_link: info.versao };
    }
    const topLabel = $('btn-gerar-link-cliente')?.querySelector('span');
    if (topLabel) topLabel.textContent = 'Link do cliente';
    return info;
  }

  async function saveProposalClientPreparation() {
    const button = $('btn-salvar-proposal-client');
    try {
      const payload = collectProposalClientPreparation();
      validateProposalClientPreparation(payload);
      setButtonLoading(button, true, 'Gerando link...');
      const budget = await api(`${API}/${state.currentId}/preparacao-cliente`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      fillProposalClientPreparation(budget);
      renderHistory(budget.historico || []);
      const info = await generateProposalClientLink(true);
      toast(info.url ? 'Link da proposta gerado. Agora você já pode enviar ao cliente.' : 'Preparação salva.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível gerar o link da proposta.', 'error');
    } finally {
      setButtonLoading(button, false);
      fillProposalClientPreparation(state.current || {});
    }
  }

  async function copyProposalClientLink() {
    const url = $('proposal-client-public-url').value.trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copiado.');
    } catch (_) {
      $('proposal-client-public-url').select();
      document.execCommand('copy');
      toast('Link copiado.');
    }
  }

  function openProposalClientLink() {
    const url = $('proposal-client-public-url').value.trim();
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function regenerateProposalClientLink() {
    if (!await budgetConfirm({
      title: 'Gerar nova versão do link',
      message: 'O link anterior deixará de funcionar. Deseja gerar uma nova versão?',
      confirmText: 'Gerar nova versão',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    await saveProposalClientPreparation();
  }

  async function deactivateProposalClientLink() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Desativar link da proposta',
      message: 'O cliente não conseguirá mais abrir a proposta por este link. Deseja desativá-lo?',
      confirmText: 'Desativar link',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    const button = $('btn-desativar-proposal-link');
    try {
      setButtonLoading(button, true, 'Desativando...');
      await api(`${API}/${state.currentId}/proposta-cliente/link/desativar`, { method: 'POST' });
      renderProposalClientLink({ status: 'desativado' });
      if (state.current?.publicacao_cliente) {
        state.current.publicacao_cliente.status = 'desativado';
        state.current.publicacao_cliente.link_ativo = false;
      }
      const topLabel = $('btn-gerar-link-cliente')?.querySelector('span');
      if (topLabel) topLabel.textContent = 'Gerar link para cliente';
      toast('Link desativado.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível desativar o link.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }
