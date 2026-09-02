/*
 * ValoraCRM · Orçamentos · inicializacao.js
 * Eventos da tela, rota inicial e inicialização final do módulo.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  async function handleInitialRoute() {
    if (state.initialRouteHandled) return;
    state.initialRouteHandled = true;
    const params = new URLSearchParams(window.location.search);
    const budgetId = Number(params.get('orcamento_id') || 0);
    const clientId = Number(params.get('cliente_id') || 0);
    if (budgetId) {
      await openEditBudget(budgetId);
      return;
    }
    if (params.get('novo') === '1' || clientId) {
      await openNewBudget();
      if (clientId) await selectClient(clientId);
    }
  }

  function bindEvents() {
    $('budget-confirm-cancel')?.addEventListener('click', () => closeBudgetConfirm(false));
    $('budget-confirm-ok')?.addEventListener('click', () => closeBudgetConfirm(true));
    $('budget-confirm-backdrop')?.addEventListener('click', (event) => {
      if (event.target === $('budget-confirm-backdrop')) closeBudgetConfirm(false);
    });

    $('btn-novo-orcamento').addEventListener('click', openNewBudget);
    $('btn-atualizar-orcamentos').addEventListener('click', () => loadBudgets());
    $('btn-configurar-orcamentos').addEventListener('click', openSettings);
    $('btn-limpar-filtros').addEventListener('click', () => {
      $('busca-orcamentos').value = '';
      $('filtro-status-orcamentos').value = '';
      loadBudgets({ offset: 0 });
    });
    $('busca-orcamentos').addEventListener('input', () => {
      clearTimeout(state.budgetSearchTimer);
      state.budgetSearchTimer = setTimeout(() => loadBudgets({ offset: 0 }), 250);
    });
    $('filtro-status-orcamentos').addEventListener('change', () => loadBudgets({ offset: 0 }));

    $('paginacao-orcamentos')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-budget-page]');
      if (!button || button.disabled) return;

      const limit = Number(state.budgetPage.limit || 50);
      const total = Number(state.budgetPage.total || 0);
      const lastOffset = Math.max(0, (Math.ceil(total / limit) - 1) * limit);
      let offset = Number(state.budgetPage.offset || 0);

      if (button.dataset.budgetPage === 'first') offset = 0;
      if (button.dataset.budgetPage === 'prev') offset = Math.max(0, offset - limit);
      if (button.dataset.budgetPage === 'next') offset = Math.min(lastOffset, offset + limit);
      if (button.dataset.budgetPage === 'last') offset = lastOffset;

      await loadBudgets({ offset });
    });

    $('tbody-orcamentos').addEventListener('click', (event) => {
      const button = event.target.closest('[data-action][data-id]');
      if (!button) return;
      const id = Number(button.dataset.id);
      const actions = { edit: openEditBudget, print: printBudget, whatsapp: sendWhatsApp, duplicate: duplicateBudget, delete: deleteBudget };
      actions[button.dataset.action]?.(id);
    });

    $('btn-fechar-budget-modal').addEventListener('click', requestCloseBudgetModal);
    $('btn-cancelar-orcamento').addEventListener('click', requestCloseBudgetModal);
    $('btn-budget-acoes')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
      setBudgetActionsMenuOpen(!expanded);
    });
    $('budget-actions-menu')?.addEventListener('click', (event) => {
      const action = event.target.closest('button');
      if (action && !action.disabled) closeBudgetActionsMenu();
    });
    $('form-orcamento')?.addEventListener('input', (event) => {
      if (event.target?.readOnly || event.target?.disabled) return;
      markBudgetDirty();
    });
    $('form-orcamento')?.addEventListener('change', (event) => {
      if (event.target?.readOnly || event.target?.disabled) return;
      markBudgetDirty();
    });
    $('form-orcamento')?.addEventListener('click', (event) => {
      if (event.target.closest('#btn-adicionar-item, #btn-adicionar-pagamento, [data-remove-item], [data-remove-payment], [data-add-kit]')) markBudgetDirty();
    });
    $('btn-toggle-budget-maximize')?.addEventListener('click', toggleBudgetMaximized);
    $('btn-imprimir-analise-financeira')?.addEventListener('click', printFinancialAnalysis);
    $('btn-salvar-orcamento').addEventListener('click', saveBudget);
    $('btn-enviar-financeiro')?.addEventListener('click', enviarVendaFinanceiro);
    $('btn-cancelar-envio-financeiro')?.addEventListener('click', cancelarEnvioFinanceiro);
    $('btn-abrir-financeiro-orcamento')?.addEventListener('click', abrirVendaNoFinanceiro);
    $('btn-imprimir-orcamento').addEventListener('click', printCurrent);
    $('btn-whatsapp-orcamento').addEventListener('click', () => state.currentId && sendWhatsApp(state.currentId));
    $('btn-gerar-link-cliente')?.addEventListener('click', openProposalClientPreparation);
    $('btn-gerar-contrato-cliente')?.addEventListener('click', openContractClient);
    $('btn-enviar-assinatura-contract-client')?.addEventListener('click', sendContractToSignature);
    $('btn-cancelar-assinatura-contract-client')?.addEventListener('click', cancelContractSignature);
    $('btn-pdf-assinado-contract-client')?.addEventListener('click', openSignedContractPdf);
    $('btn-fechar-contract-client')?.addEventListener('click', () => closeOverlay('contract-client-modal'));
    $('btn-cancelar-contract-client')?.addEventListener('click', () => closeOverlay('contract-client-modal'));
    $('btn-gerar-contract-client')?.addEventListener('click', generateContractClient);
    $('btn-visualizar-contract-client')?.addEventListener('click', () => openContractPdf(false));
    $('btn-baixar-contract-client')?.addEventListener('click', () => openContractPdf(true));
    $('btn-fechar-proposal-client')?.addEventListener('click', () => closeOverlay('proposal-client-modal'));
    $('btn-cancelar-proposal-client')?.addEventListener('click', () => closeOverlay('proposal-client-modal'));
    $('btn-usar-pagamento-orcamento')?.addEventListener('click', useBudgetPaymentInProposal);
    $('btn-salvar-proposal-client')?.addEventListener('click', saveProposalClientPreparation);
    $('btn-copiar-proposal-link')?.addEventListener('click', copyProposalClientLink);
    $('btn-abrir-proposal-link')?.addEventListener('click', openProposalClientLink);
    $('btn-regenerar-proposal-link')?.addEventListener('click', regenerateProposalClientLink);
    $('btn-desativar-proposal-link')?.addEventListener('click', deactivateProposalClientLink);
    $('btn-aprovar-margem').addEventListener('click', approveMargin);
    $$('.budget-tab').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));
    $('service-proposal-model-grid')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-service-proposal-model]');
      if (!button) return;
      const nextModel = button.dataset.serviceProposalModel || 'padrao';
      if (nextModel !== 'padrao' && !canUseNilsonProposalModels()) {
        toast('Estes modelos de monitoramento são exclusivos da conta configurada.', 'error');
        return;
      }
      if (nextModel === serviceProposalSelectedModel()) return;
      if (serviceProposalSelectedModel() !== 'padrao') {
        const ok = await budgetConfirm({
          title: 'Trocar modelo de proposta',
          message: 'Os serviços, textos e valores personalizados do modelo atual serão substituídos.',
          confirmText: 'Trocar modelo',
          cancelText: 'Cancelar',
          tone: 'danger',
        });
        if (!ok) return;
      }
      applyServiceProposalModel(nextModel, { preserveDocumentName: false, markDirty: true });
    });
    $('btn-reset-service-proposal')?.addEventListener('click', resetCurrentServiceProposal);
    $('btn-manage-service-proposal-template')?.addEventListener('click', openServiceProposalTemplateManager);
    $('btn-close-service-proposal-template')?.addEventListener('click', closeServiceProposalTemplateManager);
    $('btn-cancel-service-template')?.addEventListener('click', closeServiceProposalTemplateManager);
    $('btn-add-service-template-section')?.addEventListener('click', addServiceTemplateSection);
    $('btn-save-service-template')?.addEventListener('click', saveServiceProposalTemplate);
    $('btn-reset-service-template-global')?.addEventListener('click', resetGlobalServiceProposalTemplate);
    $('service-template-sections')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-service-template-action]');
      if (!button || button.disabled) return;
      await handleServiceTemplateAction(button);
    });
    $('service-proposal-services')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-service-proposal-toggle-section]');
      if (!button) return;
      toggleServiceProposalSection(button.dataset.serviceProposalToggleSection);
    });
    $('service-proposal-services')?.addEventListener('change', syncServiceProposalStateFromForm);
    $('service-proposal-values')?.addEventListener('input', (event) => {
      if (!event.target.matches('[data-service-proposal-value]')) return;
      syncServiceProposalStateFromForm();
    });
    ['service-proposal-introduction', 'service-proposal-conditions', 'service-proposal-notes'].forEach((id) => {
      $(id)?.addEventListener('input', syncServiceProposalStateFromForm);
    });
    $('orcamento-status').addEventListener('change', () => { updateStatusPreview(); syncRefreshPricesButton(); syncFinanceiroActions(state.current); });
    $('orcamento-titulo').addEventListener('input', (event) => {
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = event.target.value.trim() || 'Novo orçamento';
    });
    $('orcamento-modelo').addEventListener('change', (event) => applyTemplate(event.target.value));

    $('orcamento-cliente-busca').addEventListener('focus', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('click', showClientOptions);
    $('orcamento-cliente-busca').addEventListener('input', () => {
      $('orcamento-cliente-id').value = '';
      state.selectedClient = null;
      syncClientEditButton();
      searchClients();
    });
    $('btn-editar-cliente-orcamento')?.addEventListener('click', openSelectedClientEditor);
    $('orcamento-cliente-resultados').addEventListener('click', (event) => { const button = event.target.closest('[data-client-id]'); if (button) selectClient(button.dataset.clientId); });
    $('orcamento-cliente-resultados').addEventListener('scroll', loadMoreClientsOnScroll, { passive: true });
    $('btn-usar-endereco-cliente').addEventListener('click', async () => {
      const id = Number($('orcamento-cliente-id').value);
      if (!id) { toast('Selecione um cliente primeiro.', 'error'); return; }
      if (!state.selectedClient?.endereco) state.selectedClient = await api(`${API_CLIENTS}/${id}`);
      fillAddressFromClient(state.selectedClient, true);
    });

    $('btn-atualizar-precos-itens')?.addEventListener('click', refreshCurrentBudgetPrices);
    $('btn-adicionar-kit').addEventListener('click', openKitPicker);
    $('btn-fechar-kit-picker').addEventListener('click', () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
    });
    $('btn-cancelar-kit-picker').addEventListener('click', () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
    });
    $('btn-kit-picker-layout')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleKitLayoutMenu();
    });
    $('kit-layout-menu')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-kit-layout]');
      if (!option) return;
      setKitPickerLayout(option.dataset.kitLayout);
      closeKitLayoutMenu();
    });
    $('kit-picker-search-input').addEventListener('input', renderKitPicker);
    $('kit-picker-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-add-kit]');
      if (button) addKitToBudget(Number(button.dataset.addKit), button);
    });
    $('btn-gerenciar-kits').addEventListener('click', async () => {
      closeKitLayoutMenu();
      closeOverlay('kit-picker-modal');
      await openSettings();
      setSettingsTab('kits');
    });
    document.addEventListener('click', (event) => {
      const kitTrigger = event.target.closest('#btn-kit-picker-layout');
      const kitPanel = event.target.closest('#kit-layout-menu');
      if (!kitTrigger && !kitPanel) closeKitLayoutMenu();

      const productTrigger = event.target.closest('#btn-product-search-layout');
      const productPanel = event.target.closest('#product-layout-menu');
      if (!productTrigger && !productPanel) closeProductLayoutMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeKitLayoutMenu();
        closeProductLayoutMenu();
      }
    });

    $('btn-buscar-produto').addEventListener('click', () => {
      const box = $('produto-search-box');
      box.hidden = !box.hidden;
      closeProductLayoutMenu();
      if (!box.hidden) {
        updateProductPickerLayoutUI();
        const input = $('produto-search-input');
        input.focus();
        if (input.value.trim()) showProductOptions('budget');
        else renderBudgetProductSearchPrompt();
      }
    });
    $('btn-product-search-layout')?.addEventListener('click', (event) => {
      event.stopPropagation();
      toggleProductLayoutMenu();
    });
    $('product-layout-menu')?.addEventListener('click', (event) => {
      const option = event.target.closest('[data-product-layout]');
      if (!option) return;
      setProductPickerLayout(option.dataset.productLayout);
      closeProductLayoutMenu();
    });
    $('btn-adicionar-item').addEventListener('click', () => addManualItem('budget'));
    $('produto-search-input').addEventListener('input', debounce((event) => handleBudgetProductSearch(event.target.value), 250));
    $('produto-search-results').addEventListener('scroll', () => loadMoreProductsOnScroll('budget'), { passive: true });
    $('produto-search-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'budget'); });
    $('budget-items-body').addEventListener('focusin', (event) => {
      if (event.target.dataset.field !== 'codigo') return;
      const row = event.target.closest('tr[data-index]');
      const item = state.items[Number(row?.dataset.index)];
      if (!item) return;
      event.target.dataset.originalCode = item.codigo || '';
      event.target.dataset.originalProductId = item.produto_id || '';
    });

    $('budget-items-body').addEventListener('input', (event) => {
      if (event.target.dataset.field) updateItemField(event.target);
    });

    $('budget-items-body').addEventListener('keydown', (event) => {
      if (event.target.dataset.field === 'codigo' && event.key === 'Enter') {
        event.preventDefault();
        event.target.blur();
      }
    });

    $('budget-items-body').addEventListener('focusout', (event) => {
      const field = event.target.dataset.field;
      if (field === 'codigo') {
        replaceBudgetItemByCode(event.target);
        return;
      }
      if (!['quantidade', 'valor_unitario', 'desconto', 'custo_unitario'].includes(field)) return;
      if (field === 'custo_unitario' && !String(event.target.value || '').trim()) event.target.value = '';
      else event.target.value = field === 'quantidade' ? inputQuantity(event.target.value) : inputMoney(event.target.value);
      updateItemField(event.target);
    });

    $('budget-items-body').addEventListener('dragstart', startBudgetItemDrag);
    $('budget-items-body').addEventListener('dragover', overBudgetItemDrag);
    $('budget-items-body').addEventListener('dragend', clearBudgetDragState);
    $('budget-items-body').addEventListener('drop', (event) => {
      if (dropBudgetItem(event)) markBudgetDirty();
    });

    $('budget-items-body').addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-remove-item]');
      if (!removeButton) return;
      state.items.splice(Number(removeButton.dataset.removeItem), 1);
      state.items.forEach((item, index) => { item.ordem = index; });
      renderItems();
      updateTotals();
    });

    ['orcamento-desconto-tipo' , 'orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('input', updateTotals));
    ['orcamento-desconto-valor', 'orcamento-frete', 'orcamento-acrescimo'].forEach((id) => $(id).addEventListener('blur', (event) => { event.target.value = inputMoney(event.target.value); updateTotals(); }));
    $('btn-adicionar-pagamento').addEventListener('click', () => { state.payments.push(normalizePayment({ nome: 'Nova condição' })); renderPayments(); });
    $('payment-options').addEventListener('input', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('change', (event) => { if (event.target.dataset.paymentField) updatePaymentField(event.target); });
    $('payment-options').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-payment]'); if (button) { state.payments.splice(Number(button.dataset.removePayment), 1); renderPayments(); } });
    $('orcamento-emitente-id')?.addEventListener('change', renderPreviewIfVisible);
    ['orcamento-titulo', 'orcamento-nome-documento', 'orcamento-condicoes', 'orcamento-observacoes', 'orcamento-prazo-execucao', 'orcamento-titulo-capa', 'orcamento-subtitulo-capa', 'orcamento-usar-capa', 'orcamento-categoria', 'orcamento-consultor', 'orcamento-data-emissao', 'orcamento-data-validade'].forEach((id) => $(id).addEventListener('input', renderPreviewIfVisible));
    $('orcamento-escala-preset').addEventListener('change', (event) => {
      if (event.target.value === 'custom') return;
      syncBudgetScale(event.target.value);
    });
    $('orcamento-escala-documento').addEventListener('input', (event) => syncBudgetScale(event.target.value));
    $('btn-restaurar-escala-documento').addEventListener('click', () => syncBudgetScale(companyDocumentScale()));

    // Settings
    $('btn-fechar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-cancelar-settings').addEventListener('click', () => closeOverlay('settings-modal'));
    $('btn-salvar-settings').addEventListener('click', () => {
      if (state.settingsTab === 'emitentes') {
        saveEmitter($('btn-salvar-settings'));
        return;
      }
      saveSettings();
    });
    $('btn-novo-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-cancelar-emitente')?.addEventListener('click', resetEmitterEditor);
    $('btn-salvar-emitente')?.addEventListener('click', saveEmitter);
    $('emitters-list')?.addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-emitter]'); const del = event.target.closest('[data-delete-emitter]'); if (edit) editEmitter(edit.dataset.editEmitter); if (del) deleteEmitter(del.dataset.deleteEmitter); });
    $$('.settings-tabs button').forEach((button) => button.addEventListener('click', () => setSettingsTab(button.dataset.settingsTab)));
    $('config-cor').addEventListener('input', syncSettingsColorFromPicker);
    $('config-cor-hex').addEventListener('input', () => syncSettingsColorFromText(false));
    $('config-cor-hex').addEventListener('blur', () => syncSettingsColorFromText(true));
    $('config-escala-preset').addEventListener('change', (event) => {
      if (event.target.value === 'custom') return;
      syncSettingsScale(event.target.value);
    });
    $('config-escala-documento').addEventListener('input', (event) => syncSettingsScale(event.target.value));
    $('config-modelo-documento').addEventListener('change', updateSettingsConditionalFields);
    $('config-usar-capa').addEventListener('change', updateSettingsConditionalFields);
    $('btn-nova-categoria').addEventListener('click', resetCategoryEditor);
    $('btn-salvar-categoria').addEventListener('click', saveCategory);
    $('categories-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-category]'); const del = event.target.closest('[data-delete-category]'); if (edit) editCategory(edit.dataset.editCategory); if (del) deleteCategory(del.dataset.deleteCategory); });
    $('btn-novo-kit').addEventListener('click', () => openKitEditor());
    $('btn-voltar-kits').addEventListener('click', closeKitEditor);
    $('btn-cancelar-kit').addEventListener('click', closeKitEditor);
    $('btn-salvar-kit').addEventListener('click', saveKit);
    $('kits-list').addEventListener('click', (event) => {
      const edit = event.target.closest('[data-edit-kit]');
      const duplicate = event.target.closest('[data-duplicate-kit]');
      const del = event.target.closest('[data-delete-kit]');
      if (edit) editKit(edit.dataset.editKit);
      if (duplicate) duplicateKit(duplicate.dataset.duplicateKit);
      if (del) deleteKit(del.dataset.deleteKit);
    });
    $('btn-kit-product').addEventListener('click', () => {
      const box = $('kit-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('kit-product-input').focus();
        showProductOptions('kit');
      }
    });
    $('kit-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'kit'), 250));
    $('kit-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('kit'), { passive: true });
    $('kit-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'kit'); });
    $('kit-items-body').addEventListener('input', (event) => { if (event.target.dataset.kitField) updateKitItem(event.target); });
    $('kit-items-body').addEventListener('focusout', (event) => { if (event.target.dataset.kitField === 'quantidade') { event.target.value = inputQuantity(event.target.value); updateKitItem(event.target); } });
    $('kit-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-kit-item]'); if (button) { state.kitItems.splice(Number(button.dataset.removeKitItem), 1); renderKitItems(); } });

    $('btn-novo-modelo').addEventListener('click', () => openTemplateEditor());
    $('btn-voltar-modelos').addEventListener('click', closeTemplateEditor);
    $('btn-cancelar-modelo').addEventListener('click', closeTemplateEditor);
    $('btn-salvar-modelo').addEventListener('click', saveTemplate);
    $('templates-list').addEventListener('click', (event) => { const edit = event.target.closest('[data-edit-template]'); const del = event.target.closest('[data-delete-template]'); if (edit) editTemplate(edit.dataset.editTemplate); if (del) deleteTemplate(del.dataset.deleteTemplate); });
    $('btn-template-product').addEventListener('click', () => {
      const box = $('template-product-search');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        $('template-product-input').focus();
        showProductOptions('template');
      }
    });
    $('btn-template-manual').addEventListener('click', () => addManualItem('template'));
    $('template-product-input').addEventListener('input', debounce((event) => searchProducts(event.target.value, 'template'), 250));
    $('template-product-results').addEventListener('scroll', () => loadMoreProductsOnScroll('template'), { passive: true });
    $('template-product-results').addEventListener('click', (event) => { const button = event.target.closest('[data-product-id]'); if (button) addProduct(button.dataset.productId, 'template'); });
    $('template-items-body').addEventListener('input', (event) => { if (event.target.dataset.templateField) updateTemplateItem(event.target); });
    $('template-items-body').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-template-item]'); if (button) { state.templateItems.splice(Number(button.dataset.removeTemplateItem), 1); renderTemplateItems(); } });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.autocomplete-field')) {
        $('orcamento-cliente-resultados').hidden = true;
        $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      }
      if (!event.target.closest('#budget-actions-dropdown')) closeBudgetActionsMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('budget-confirm-backdrop')?.hidden) {
        event.preventDefault();
        closeBudgetConfirm(false);
        return;
      }
      if (event.key === 'Enter' && !$('budget-confirm-backdrop')?.hidden) {
        event.preventDefault();
        closeBudgetConfirm(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's' && isBudgetModalOpen()) {
        event.preventDefault();
        saveBudget();
        return;
      }
      if (event.key === 'Escape') {
        if ($('btn-budget-acoes')?.getAttribute('aria-expanded') === 'true') {
          closeBudgetActionsMenu();
          return;
        }
        if (!$('kit-picker-modal').hidden) closeOverlay('kit-picker-modal');
        else if (!$('settings-modal').hidden) closeOverlay('settings-modal');
        else if (!$('budget-modal').hidden) requestCloseBudgetModal();
      }
    });
  }

  function initializeOrcamentosPage() {
    bindEvents();
    bootstrap();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeOrcamentosPage, { once: true });
  } else {
    initializeOrcamentosPage();
  }
