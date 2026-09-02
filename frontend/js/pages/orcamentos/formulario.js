/*
 * ValoraCRM · Orçamentos · formulario.js
 * Abertura, edição, preenchimento e controle do formulário de orçamento.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function resetBudgetForm() {
    state.currentId = null;
    state.current = null;
    state.appliedTemplateId = null;
    state.items = [];
    state.payments = [];
    state.selectedClient = null;
    state.calculation = null;
    state.serviceProposalModel = 'padrao';
    state.serviceProposalData = {};
    $('form-orcamento').reset();
    $('orcamento-cliente-id').value = '';
    syncClientEditButton();
    $('orcamento-codigo').value = '';
    $('orcamento-data-solicitacao').value = today();
    $('orcamento-data-emissao').value = today();
    $('orcamento-data-validade').value = addDays(today(), state.meta.configuracao?.validade_padrao_dias || 7);
    $('orcamento-consultor').value = String(state.meta.usuario?.id || '');
    $('orcamento-nome-documento').value = state.meta.configuracao?.nome_documento || 'Orçamento';
    $('orcamento-prazo-execucao').value = state.meta.configuracao?.prazo_execucao_padrao || '';
    $('orcamento-condicoes').value = state.meta.configuracao?.condicoes_padrao || '';
    $('orcamento-observacoes').value = state.meta.configuracao?.observacoes_padrao || '';
    $('orcamento-usar-capa').checked = Boolean(state.meta.configuracao?.usar_capa);
    $('orcamento-titulo-capa').value = state.meta.configuracao?.titulo_capa || '';
    $('orcamento-subtitulo-capa').value = state.meta.configuracao?.subtitulo_capa || '';
    syncBudgetScale(companyDocumentScale(), { render: false });
    $('orcamento-desconto-tipo').value = 'valor';
    $('orcamento-desconto-valor').value = '0,00';
    $('orcamento-frete').value = '0,00';
    $('orcamento-acrescimo').value = '0,00';
    $('orcamento-status').value = 'rascunho';
    const defaultEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false) || state.emitters.find((emitter) => emitter.ativo !== false);
    if ($('orcamento-emitente-id')) $('orcamento-emitente-id').value = defaultEmitter ? String(defaultEmitter.id) : '';
    if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = 'Novo orçamento';
    if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = 'Código não gerado';
    $('btn-imprimir-orcamento').classList.add('is-hidden');
    $('btn-whatsapp-orcamento').classList.add('is-hidden');
    $('btn-gerar-link-cliente')?.classList.add('is-hidden');
    $('btn-gerar-contrato-cliente')?.classList.add('is-hidden');
    $('btn-aprovar-margem').classList.add('is-hidden');
    $('budget-financeiro-status')?.classList.add('is-hidden');
    $('btn-enviar-financeiro')?.classList.add('is-hidden');
    $('btn-cancelar-envio-financeiro')?.classList.add('is-hidden');
    $('btn-abrir-financeiro-orcamento')?.classList.add('is-hidden');
    $$('.edit-only').forEach((el) => el.classList.add('is-hidden'));
    setTab('dados');
    addDefaultPayment();
    renderItems();
    renderPayments();
    updateStatusPreview();
    updateTotals();
    renderHistory([]);
    renderServiceProposal('padrao', {});
    setBudgetDirty(false);
    closeBudgetActionsMenu();
  }

  async function openNewBudget() {
    resetBudgetForm();
    $('budget-modal-title').textContent = 'Novo orçamento';
    $('budget-modal-subtitle').textContent = 'Documento global e personalizável para sua empresa.';
    openOverlay('budget-modal');
    try {
      const result = await api(`${API}/proximo-codigo`);
      $('orcamento-codigo').value = result.codigo || '';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = result.codigo || 'Código não gerado';
      setBudgetDirty(false);
    } catch (_) {}
  }

  async function openEditBudget(id) {
    try {
      const budget = await api(`${API}/${id}`);
      state.currentId = id;
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      state.selectedClient = budget.cliente_id ? {
        id: budget.cliente_id,
        codigo: budget.cliente_codigo || '',
        nome: budget.cliente_razao_social || budget.cliente_nome,
        nome_fantasia: budget.cliente_nome_fantasia || budget.cliente_nome,
        cpf_cnpj: budget.cliente_documento,
        rg_ie: budget.cliente_rg_ie_documento,
        telefone: budget.cliente_telefone_documento,
        whatsapp: budget.cliente_whatsapp,
        fax: budget.cliente_fax_documento,
        email: budget.cliente_email,
        email_nfe: budget.cliente_email_nfe_documento,
        contato: budget.cliente_contato_documento,
      } : null;
      fillBudgetForm(budget);
      $('budget-modal-title').textContent = `Editar ${budget.codigo}`;
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = budget.titulo || 'Orçamento';
      if ($('budget-sidebar-code')) $('budget-sidebar-code').textContent = budget.codigo || 'Código não gerado';
      $('btn-imprimir-orcamento').classList.remove('is-hidden');
      $('btn-whatsapp-orcamento').classList.remove('is-hidden');
      $('btn-gerar-link-cliente')?.classList.remove('is-hidden');
      const proposalButtonLabel = $('btn-gerar-link-cliente')?.querySelector('span');
      if (proposalButtonLabel) proposalButtonLabel.textContent = budget.publicacao_cliente?.link_ativo ? 'Link do cliente' : 'Gerar link para cliente';
      const contractEligible = budget.publicacao_cliente?.status === 'aprovado' && budget.publicacao_cliente?.cadastro_contrato?.status === 'concluido';
      $('btn-gerar-contrato-cliente')?.classList.toggle('is-hidden', !contractEligible);
      const contractTopLabel = $('btn-gerar-contrato-cliente')?.querySelector('span');
      if (contractTopLabel) contractTopLabel.textContent = budget.publicacao_cliente?.contrato?.status === 'gerado' ? 'Contrato gerado' : 'Gerar contrato';
      $$('.edit-only').forEach((el) => el.classList.remove('is-hidden'));
      syncRefreshPricesButton(budget.status);
      const canApprove = state.meta.pode_configurar && budget.aprovacao_necessaria && budget.aprovacao_status !== 'aprovado';
      $('btn-aprovar-margem').classList.toggle('is-hidden', !canApprove);
      syncFinanceiroActions(budget);
      setTab('dados');
      openOverlay('budget-modal');
      setBudgetDirty(false);
      closeBudgetActionsMenu();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function canRefreshBudgetPrices(status) {
    return !['aprovado', 'recusado', 'cancelado', 'expirado'].includes(String(status || '').toLowerCase());
  }

  function syncRefreshPricesButton(status = $('orcamento-status')?.value) {
    const button = $('btn-atualizar-precos-itens');
    if (!button) return;
    const visible = Boolean(state.currentId) && canRefreshBudgetPrices(status);
    button.classList.toggle('is-hidden', !visible);
  }

  async function refreshCurrentBudgetPrices() {
    const button = $('btn-atualizar-precos-itens');
    if (!state.currentId) {
      toast('Salve o orçamento antes de atualizar os preços.', 'error');
      return;
    }
    const status = $('orcamento-status')?.value || state.current?.status;
    if (!canRefreshBudgetPrices(status)) {
      toast('Este orçamento já está encerrado. Duplique-o para atualizar os preços.', 'error');
      return;
    }
    const linkedItems = state.items.filter((item) => Number(item.produto_id) > 0);
    if (!linkedItems.length) {
      toast('Não há produtos vinculados ao cadastro neste orçamento.', 'error');
      return;
    }
    const confirmed = await budgetConfirm({
      title: 'Atualizar preços do orçamento',
      message: `Atualizar os preços de compra e venda de ${linkedItems.length} item(ns) pela tabela atual de produtos?\n\nQuantidade, desconto, descrição e observações serão mantidos. A alteração será salva no orçamento.`,
      confirmText: 'Atualizar preços',
      cancelText: 'Cancelar',
    });
    if (!confirmed) return;

    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true, 'Atualizando...');
      const budget = await api(`${API}/${state.currentId}?atualizar_precos=true`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      state.current = budget;
      state.items = (budget.itens || []).map(normalizeItem);
      state.payments = (budget.pagamentos || []).map(normalizePayment);
      fillBudgetForm(budget);
      $('budget-modal-subtitle').textContent = `Versão ${budget.versao || 1} • atualizado em ${localDate(budget.atualizado_em)}`;
      syncRefreshPricesButton(budget.status);

      const summary = budget.atualizacao_precos || {};
      const updated = Number(summary.itens_atualizados || 0);
      if (!updated) {
        toast('Os preços deste orçamento já estavam iguais aos da tabela atual.');
      } else {
        const sale = Number(summary.precos_venda_alterados || 0);
        const cost = Number(summary.custos_alterados || 0);
        toast(`${updated} item(ns) atualizado(s): ${sale} preço(s) de venda e ${cost} custo(s).`);
      }
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar os preços.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncRefreshPricesButton();
    }
  }

  function fillBudgetForm(budget) {
    state.appliedTemplateId = Number(budget?.modelo_id) || null;
    const emitterSelect = $('orcamento-emitente-id');
    const fallbackEmitter = state.emitters.find((emitter) => emitter.padrao && emitter.ativo !== false)
      || state.emitters.find((emitter) => emitter.ativo !== false);
    if (emitterSelect && budget?.emitente_id && !Array.from(emitterSelect.options).some((option) => Number(option.value) === Number(budget.emitente_id))) {
      const label = budget.emitente_nome_documento || budget.emitente_nome_fantasia_documento || budget.emitente_razao_social_documento || 'Empresa emitente arquivada';
      emitterSelect.insertAdjacentHTML('beforeend', `<option value="${Number(budget.emitente_id)}" data-archived-emitter="true">${escapeHtml(label)} (inativa)</option>`);
    }
    const map = {
      'orcamento-codigo': budget.codigo,
      'orcamento-titulo': budget.titulo,
      'orcamento-status': budget.status,
      'orcamento-emitente-id': budget.emitente_id || fallbackEmitter?.id || '',
      'orcamento-cliente-id': budget.cliente_id || '',
      'orcamento-cliente-busca': budget.cliente_nome || '',
      'orcamento-categoria': budget.categoria_id || '',
      'orcamento-modelo': budget.modelo_id || '',
      'orcamento-data-solicitacao': String(budget.data_solicitacao || '').slice(0, 10),
      'orcamento-data-emissao': String(budget.data_emissao || '').slice(0, 10),
      'orcamento-data-validade': String(budget.data_validade || '').slice(0, 10),
      'orcamento-consultor': budget.consultor_id || '',
      'orcamento-responsavel-cliente': budget.responsavel_cliente || '',
      'orcamento-contato-cliente': budget.contato_cliente || '',
      'orcamento-cep': budget.endereco_cep || '',
      'orcamento-logradouro': budget.endereco_logradouro || '',
      'orcamento-numero': budget.endereco_numero || '',
      'orcamento-complemento': budget.endereco_complemento || '',
      'orcamento-bairro': budget.endereco_bairro || '',
      'orcamento-cidade': budget.endereco_cidade || '',
      'orcamento-estado': budget.endereco_estado || '',
      'orcamento-desconto-tipo': budget.desconto_tipo || 'valor',
      'orcamento-desconto-valor': inputMoney(budget.desconto_valor),
      'orcamento-frete': inputMoney(budget.frete),
      'orcamento-acrescimo': inputMoney(budget.acrescimo),
      'orcamento-prazo-execucao': budget.prazo_execucao || '',
      'orcamento-nome-documento': budget.nome_documento || '',
      'orcamento-condicoes': budget.condicoes || '',
      'orcamento-observacoes': budget.observacoes || '',
      'orcamento-titulo-capa': budget.titulo_capa || '',
      'orcamento-subtitulo-capa': budget.subtitulo_capa || '',
    };
    Object.entries(map).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    $('orcamento-usar-capa').checked = Boolean(budget.usar_capa);
    syncBudgetScale(budget.escala_documento ?? companyDocumentScale(), { render: false });
    syncClientEditButton();
    renderItems();
    if (!state.payments.length) addDefaultPayment();
    renderPayments();
    renderHistory(budget.historico || []);
    renderServiceProposal(budget.proposta_modelo || 'padrao', budget.proposta_comercial || {});
    updateStatusPreview();
    syncRefreshPricesButton(budget.status);
    updateTotals();
  }

  function setTab(tab) {
    state.activeTab = tab;
    $$('.budget-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
    $$('.budget-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab));
    if (tab === 'documento') renderPreview();
    if (tab === 'analise') renderAnalysis();
  }

  function updateStatusPreview() {
    const status = $('orcamento-status').value || 'rascunho';
    const [label, className] = getStatus(status);
    $('budget-status-preview').className = `budget-status ${className}`;
    $('budget-status-preview').textContent = label;
  }

  function normalizeCollection(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && Array.isArray(payload.results)) return payload.results;
    return [];
  }

