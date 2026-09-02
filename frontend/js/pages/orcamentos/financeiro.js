/*
 * ValoraCRM · Orçamentos · financeiro.js
 * Payload, validações, salvamento, integração com Financeiro, duplicação e aprovação de margem.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function collectBudgetPayload() {
    return {
      cliente_id: Number($('orcamento-cliente-id').value) || null,
      emitente_id: Number($('orcamento-emitente-id')?.value) || null,
      consultor_id: Number($('orcamento-consultor').value) || null,
      categoria_id: Number($('orcamento-categoria').value) || null,
      modelo_id: Number(state.appliedTemplateId) || null,
      titulo: $('orcamento-titulo').value.trim(),
      nome_documento: $('orcamento-nome-documento').value.trim(),
      status: $('orcamento-status').value,
      data_solicitacao: $('orcamento-data-solicitacao').value || null,
      data_emissao: $('orcamento-data-emissao').value || null,
      data_validade: $('orcamento-data-validade').value || null,
      responsavel_cliente: $('orcamento-responsavel-cliente').value.trim() || null,
      contato_cliente: $('orcamento-contato-cliente').value.trim() || null,
      endereco_cep: $('orcamento-cep').value.trim() || null,
      endereco_logradouro: $('orcamento-logradouro').value.trim() || null,
      endereco_numero: $('orcamento-numero').value.trim() || null,
      endereco_complemento: $('orcamento-complemento').value.trim() || null,
      endereco_bairro: $('orcamento-bairro').value.trim() || null,
      endereco_cidade: $('orcamento-cidade').value.trim() || null,
      endereco_estado: $('orcamento-estado').value.trim() || null,
      desconto_tipo: $('orcamento-desconto-tipo').value,
      desconto_valor: parseNumber($('orcamento-desconto-valor').value),
      frete: parseNumber($('orcamento-frete').value),
      acrescimo: parseNumber($('orcamento-acrescimo').value),
      prazo_execucao: $('orcamento-prazo-execucao').value.trim() || null,
      condicoes: $('orcamento-condicoes').value.trim() || null,
      observacoes: $('orcamento-observacoes').value.trim() || null,
      proposta_modelo: serviceProposalSelectedModel(),
      proposta_comercial: collectServiceProposalData(),
      pagamentos: state.payments,
      usar_capa: $('orcamento-usar-capa').checked,
      titulo_capa: $('orcamento-titulo-capa').value.trim() || null,
      subtitulo_capa: $('orcamento-subtitulo-capa').value.trim() || null,
      escala_documento: currentDocumentScale(),
      itens: state.items.map((item, index) => ({ ...item, custo_unitario: item.custo_unitario === null ? null : parseNumber(item.custo_unitario), custo_informado: Boolean(item.custo_informado), ordem: index })),
    };
  }

  function validateBudget(payload) {
    if (!payload.titulo) { setTab('dados'); $('orcamento-titulo').focus(); throw new Error('Informe o título do orçamento.'); }
    if (!payload.emitente_id) { setTab('dados'); $('orcamento-emitente-id')?.focus(); throw new Error('Selecione a empresa emitente.'); }
    if (!payload.cliente_id) { setTab('dados'); $('orcamento-cliente-busca').focus(); throw new Error('Selecione um cliente.'); }
    if (!payload.itens.length && payload.proposta_modelo === 'padrao') { setTab('itens'); throw new Error('Adicione pelo menos um produto ou serviço.'); }
    if (payload.itens.some((item) => !String(item.descricao || '').trim())) { setTab('itens'); throw new Error('Preencha a descrição de todos os itens.'); }
  }

  async function enviarVendaFinanceiro() {
    if (!state.currentId || !state.current) return;

    let payload;
    try {
      payload = collectBudgetPayload();
      validateBudget(payload);
    } catch (error) {
      toast(error.message || 'Revise os dados do orçamento antes de enviar.', 'error');
      return;
    }
    if (String(payload.status || '').toLowerCase() !== 'aprovado') {
      toast('Aprove o orçamento antes de fechar a venda.', 'error');
      return;
    }

    const texto = state.current.financeiro_status === 'devolvido'
      ? `Reenviar a venda ${state.current.codigo} ao Financeiro com os dados atuais?`
      : `Fechar a venda ${state.current.codigo} e enviar ao Financeiro para conferência?`;
    if (!await budgetConfirm({
      title: state.current.financeiro_status === 'devolvido' ? 'Reenviar ao Financeiro' : 'Fechar venda',
      message: `${texto}\n\nAs alterações abertas serão salvas e o orçamento ficará bloqueado enquanto estiver em conferência.`,
      confirmText: state.current.financeiro_status === 'devolvido' ? 'Reenviar' : 'Fechar e enviar',
      cancelText: 'Cancelar',
    })) return;

    const button = $('btn-enviar-financeiro');
    try {
      setButtonLoading(button, true, 'Salvando e enviando...');
      state.current = await api(`${API}/${state.currentId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await api(`${API}/${state.currentId}/enviar-financeiro`, {
        method: 'POST',
        body: JSON.stringify({ tipo_venda: 'avulsa', observacao: 'Venda fechada pelo Comercial.' }),
      });
      state.current = await api(`${API}/${state.currentId}`);
      fillBudgetForm(state.current);
      syncFinanceiroActions(state.current);
      toast('Venda enviada para autenticação do Financeiro.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível enviar a venda.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncFinanceiroActions(state.current);
    }
  }

  async function cancelarEnvioFinanceiro() {
    if (!state.currentId || !state.current) return;
    const motivo = prompt('Informe o motivo do cancelamento do envio ao Financeiro:');
    if (!motivo?.trim()) return;
    const button = $('btn-cancelar-envio-financeiro');
    try {
      setButtonLoading(button, true, 'Cancelando...');
      await api(`${API}/${state.currentId}/cancelar-envio-financeiro`, {
        method: 'POST', body: JSON.stringify({ observacao: motivo.trim(), tipo_venda: 'avulsa' }),
      });
      state.current = await api(`${API}/${state.currentId}`);
      syncFinanceiroActions(state.current);
      toast('Envio ao Financeiro cancelado. O orçamento pode ser editado novamente.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível cancelar o envio.', 'error');
    } finally {
      setButtonLoading(button, false);
      syncFinanceiroActions(state.current);
    }
  }

  function abrirVendaNoFinanceiro() {
    if (!state.currentId) return;
    const targetUrl = `/faturamento?orcamento_id=${encodeURIComponent(state.currentId)}`;
    if (window.ValoraNavigate) window.ValoraNavigate(targetUrl);
    else window.location.href = targetUrl;
  }

  async function saveBudget() {
    const button = $('btn-salvar-orcamento');
    try {
      const payload = collectBudgetPayload();
      validateBudget(payload);
      setButtonLoading(button, true);
      const budget = await api(state.currentId ? `${API}/${state.currentId}` : API, {
        method: state.currentId ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      state.currentId = budget.id;
      state.current = budget;
      setBudgetDirty(false);
      closeBudgetActionsMenu();
      toast('Orçamento salvo com sucesso.');
      closeOverlay('budget-modal');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível salvar.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function applyTemplate(selectionValue) {
    const select = $('orcamento-modelo');
    const rawValue = String(selectionValue || '').trim();

    if (!rawValue) {
      state.appliedTemplateId = null;
      return;
    }

    if (rawValue.startsWith('kit:')) {
      const kitId = Number(rawValue.slice(4));
      const restoreTemplateId = Number(state.appliedTemplateId) || null;
      if (!kitId) {
        if (select) select.value = restoreTemplateId ? String(restoreTemplateId) : '';
        return;
      }
      await addKitToBudget(kitId, null, { closePicker: false });
      if (select) select.value = restoreTemplateId ? String(restoreTemplateId) : '';
      return;
    }

    const templateId = Number(rawValue);
    if (!templateId) return;
    const previousTemplateId = Number(state.appliedTemplateId) || null;

    try {
      const template = await api(`${API}/modelos/${templateId}`);
      if (state.items.length && !await budgetConfirm({
        title: 'Aplicar modelo de orçamento',
        message: 'Aplicar este modelo substituirá os itens atuais. Deseja continuar?',
        confirmText: 'Aplicar modelo',
        cancelText: 'Cancelar',
        tone: 'danger',
      })) {
        if (select) select.value = previousTemplateId ? String(previousTemplateId) : '';
        return;
      }
      $('orcamento-titulo').value = template.titulo || $('orcamento-titulo').value;
      $('orcamento-categoria').value = template.categoria_id || '';
      if (template.validade_dias) $('orcamento-data-validade').value = addDays($('orcamento-data-emissao').value, template.validade_dias);
      $('orcamento-prazo-execucao').value = template.prazo_execucao || $('orcamento-prazo-execucao').value;
      $('orcamento-condicoes').value = template.condicoes || $('orcamento-condicoes').value;
      $('orcamento-observacoes').value = template.observacoes || $('orcamento-observacoes').value;
      state.items = (template.itens || []).map(normalizeItem);
      state.payments = (template.pagamentos || []).map(normalizePayment);
      state.appliedTemplateId = templateId;
      if (select) select.value = String(templateId);
      if (!state.payments.length) addDefaultPayment();
      renderItems();
      renderPayments();
      updateTotals();
      toast('Modelo aplicado ao orçamento.');
    } catch (error) {
      if (select) select.value = previousTemplateId ? String(previousTemplateId) : '';
      toast(error.message, 'error');
    }
  }

  async function deleteBudget(id) {
    if (!await budgetConfirm({
      title: 'Excluir orçamento',
      message: 'Excluir este orçamento permanentemente? Esta ação não poderá ser desfeita.',
      confirmText: 'Excluir orçamento',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/${id}`, { method: 'DELETE' });
      toast('Orçamento excluído.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function duplicateBudget(id) {
    try {
      const duplicated = await api(`${API}/${id}/duplicar`, { method: 'POST' });
      toast(`Orçamento ${duplicated.codigo} criado.`);
      await loadBudgets();
      await openEditBudget(duplicated.id);
    } catch (error) { toast(error.message, 'error'); }
  }

  async function approveMargin() {
    if (!state.currentId) return;
    try {
      const budget = await api(`${API}/${state.currentId}/aprovar-margem`, { method: 'POST' });
      state.current = budget;
      $('btn-aprovar-margem').classList.add('is-hidden');
      toast('Margem aprovada pelo gestor.');
      await loadBudgets();
    } catch (error) { toast(error.message, 'error'); }
  }

