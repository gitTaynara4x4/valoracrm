/*
 * ValoraCRM · Orçamentos · propostas.js
 * Propostas comerciais, modelos especiais do Nilson, personalização e layout/PDF das propostas.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function serviceProposalSelectedModel() {
    return state.serviceProposalModel || 'padrao';
  }

  function serviceProposalModelName(key = serviceProposalSelectedModel()) {
    return serviceProposalDefinition(key).name || 'Proposta padrão';
  }

  function renderServiceProposalSelectedCount() {
    const target = $('service-proposal-selected-count');
    if (!target) return;
    const count = $$('#service-proposal-services input[type="checkbox"]:checked').length;
    target.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
  }

  function renderServiceProposalServices(model, data) {
    const root = $('service-proposal-services');
    if (!root) return;
    const selected = data?.selected_services || {};
    root.innerHTML = (model.sections || []).map((section) => {
      const selectedIds = new Set(Array.isArray(selected[section.id]) ? selected[section.id] : []);
      const services = (section.services || []).map((service) => `
        <label class="service-proposal-check">
          <input type="checkbox" data-service-proposal-section="${escapeHtml(section.id)}" data-service-proposal-service="${escapeHtml(service.id)}" ${selectedIds.has(service.id) ? 'checked' : ''} />
          <span>${escapeHtml(service.label)}</span>
        </label>`).join('');
      return `<section class="service-proposal-section" data-service-proposal-section-card="${escapeHtml(section.id)}">
        <header class="service-proposal-section-header">
          <strong>${escapeHtml(section.title)}</strong>
          <button type="button" data-service-proposal-toggle-section="${escapeHtml(section.id)}">Marcar todos</button>
        </header>
        <div class="service-proposal-check-list">${services}</div>
      </section>`;
    }).join('');
    renderServiceProposalSelectedCount();
  }

  function renderServiceProposalValues(model, data) {
    const root = $('service-proposal-values');
    if (!root) return;
    const values = data?.values || {};
    root.innerHTML = (model.values || []).map((value) => `
      <div class="service-proposal-value-card">
        <label for="service-proposal-value-${escapeHtml(value.id)}">${escapeHtml(value.label)}</label>
        <div class="service-proposal-value-input">
          <span>R$</span>
          <input id="service-proposal-value-${escapeHtml(value.id)}" type="text" inputmode="decimal" data-service-proposal-value="${escapeHtml(value.id)}" value="${escapeHtml(inputMoney(values[value.id] ?? value.default ?? 0))}" />
        </div>
      </div>`).join('');
  }

  function renderServiceProposal(modelKey = serviceProposalSelectedModel(), data = null) {
    const safeKey = SERVICE_PROPOSAL_MODELS[modelKey] ? modelKey : 'padrao';
    const model = serviceProposalDefinition(safeKey);
    const defaults = defaultServiceProposalData(safeKey);
    const incoming = data && typeof data === 'object' ? data : {};
    const normalized = {
      ...defaults,
      ...incoming,
      selected_services: { ...(defaults.selected_services || {}), ...(incoming.selected_services || {}) },
      values: { ...(defaults.values || {}), ...(incoming.values || {}) },
    };
    state.serviceProposalModel = safeKey;
    state.serviceProposalData = normalized;

    $$('[data-service-proposal-model]').forEach((button) => {
      button.classList.toggle('active', button.dataset.serviceProposalModel === safeKey);
      button.setAttribute('aria-pressed', button.dataset.serviceProposalModel === safeKey ? 'true' : 'false');
    });

    const standard = safeKey === 'padrao';
    $('service-proposal-standard-note')?.classList.toggle('is-hidden', !standard);
    $('service-proposal-editor')?.classList.toggle('is-hidden', standard);
    if (standard) {
      renderPreviewIfVisible();
      return;
    }

    if ($('service-proposal-editor-title')) $('service-proposal-editor-title').textContent = model.name;
    if ($('service-proposal-editor-description')) $('service-proposal-editor-description').textContent = model.description || '';
    if ($('service-proposal-introduction')) $('service-proposal-introduction').value = normalized.introduction ?? model.introduction ?? '';
    if ($('service-proposal-conditions')) $('service-proposal-conditions').value = normalized.conditions ?? model.conditions ?? '';
    if ($('service-proposal-notes')) $('service-proposal-notes').value = normalized.notes || '';
    renderServiceProposalServices(model, normalized);
    renderServiceProposalValues(model, normalized);
    renderPreviewIfVisible();
  }

  function collectServiceProposalData() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return {};
    const model = serviceProposalDefinition(key);
    const selectedServices = {};
    (model.sections || []).forEach((section) => {
      selectedServices[section.id] = $$(`input[data-service-proposal-section="${CSS.escape(section.id)}"]:checked`, $('service-proposal-services'))
        .map((input) => input.dataset.serviceProposalService)
        .filter(Boolean);
    });
    const values = {};
    $$('[data-service-proposal-value]', $('service-proposal-values')).forEach((input) => {
      values[input.dataset.serviceProposalValue] = parseInputNumber(input.value);
    });
    return {
      introduction: $('service-proposal-introduction')?.value?.trim() || '',
      selected_services: selectedServices,
      values,
      conditions: $('service-proposal-conditions')?.value?.trim() || '',
      notes: $('service-proposal-notes')?.value?.trim() || '',
    };
  }

  function syncServiceProposalStateFromForm() {
    state.serviceProposalData = collectServiceProposalData();
    renderServiceProposalSelectedCount();
    renderPreviewIfVisible();
  }

  function applyServiceProposalModel(modelKey, { preserveDocumentName = false, markDirty = true } = {}) {
    const safeKey = SERVICE_PROPOSAL_MODELS[modelKey] ? modelKey : 'padrao';
    const model = serviceProposalDefinition(safeKey);
    const data = defaultServiceProposalData(safeKey);
    renderServiceProposal(safeKey, data);
    if (!preserveDocumentName && $('orcamento-nome-documento')) {
      $('orcamento-nome-documento').value = safeKey === 'padrao'
        ? (state.meta.configuracao?.nome_documento || 'Orçamento')
        : (model.documentName || 'Proposta Comercial');
    }
    if (safeKey !== 'padrao' && $('orcamento-titulo') && !$('orcamento-titulo').value.trim()) {
      $('orcamento-titulo').value = model.name;
      if ($('budget-sidebar-title')) $('budget-sidebar-title').textContent = model.name;
    }
    if (markDirty) markBudgetDirty();
  }

  async function resetCurrentServiceProposal() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return;
    const ok = await budgetConfirm({
      title: 'Restaurar modelo',
      message: 'Restaurar os serviços, textos e valores padrão deste modelo? As personalizações feitas nesta proposta serão perdidas.',
      confirmText: 'Restaurar modelo',
      cancelText: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;
    applyServiceProposalModel(key, { preserveDocumentName: true, markDirty: true });
    toast('Modelo restaurado para o padrão.');
  }

  function serviceTemplateId(prefix = 'item') {
    const random = Math.random().toString(36).slice(2, 7);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
  }

  function syncServiceTemplateDraftFromForm() {
    const draft = state.serviceProposalTemplateDraft;
    if (!draft) return;
    draft.introduction = $('service-template-introduction')?.value ?? draft.introduction ?? '';
    draft.conditions = $('service-template-conditions')?.value ?? draft.conditions ?? '';
    $$('#service-template-sections [data-service-template-section-title]').forEach((input) => {
      const sectionIndex = Number(input.dataset.serviceTemplateSectionTitle);
      if (draft.sections?.[sectionIndex]) draft.sections[sectionIndex].title = input.value;
    });
    $$('#service-template-sections [data-service-template-service-label]').forEach((input) => {
      const sectionIndex = Number(input.dataset.sectionIndex);
      const serviceIndex = Number(input.dataset.serviceIndex);
      const service = draft.sections?.[sectionIndex]?.services?.[serviceIndex];
      if (service) service.label = input.value;
    });
    $$('#service-template-sections [data-service-template-service-checked]').forEach((input) => {
      const sectionIndex = Number(input.dataset.sectionIndex);
      const serviceIndex = Number(input.dataset.serviceIndex);
      const service = draft.sections?.[sectionIndex]?.services?.[serviceIndex];
      if (service) service.checked = Boolean(input.checked);
    });
  }

  function renderServiceTemplateEditor() {
    const draft = state.serviceProposalTemplateDraft;
    const root = $('service-template-sections');
    if (!draft || !root) return;
    if ($('service-proposal-template-title')) $('service-proposal-template-title').textContent = `Personalizar • ${draft.name}`;
    if ($('service-template-introduction')) $('service-template-introduction').value = draft.introduction || '';
    if ($('service-template-conditions')) $('service-template-conditions').value = draft.conditions || '';

    root.innerHTML = (draft.sections || []).map((section, sectionIndex) => {
      const services = (section.services || []).map((service, serviceIndex) => `
        <div class="service-template-service-row">
          <span class="service-template-drag-hint"><i class="fa-solid fa-grip-vertical"></i></span>
          <input type="text" value="${escapeHtml(service.label || '')}" data-service-template-service-label data-section-index="${sectionIndex}" data-service-index="${serviceIndex}" aria-label="Descrição do serviço" />
          <label class="service-template-default-check" title="Marcado por padrão nas novas propostas">
            <input type="checkbox" data-service-template-service-checked data-section-index="${sectionIndex}" data-service-index="${serviceIndex}" ${service.checked !== false ? 'checked' : ''} />
            <span>Padrão</span>
          </label>
          <div class="service-template-row-actions">
            <button type="button" data-service-template-action="service-up" data-section-index="${sectionIndex}" data-service-index="${serviceIndex}" title="Mover para cima" ${serviceIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" data-service-template-action="service-down" data-section-index="${sectionIndex}" data-service-index="${serviceIndex}" title="Mover para baixo" ${serviceIndex === (section.services || []).length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="danger" data-service-template-action="service-delete" data-section-index="${sectionIndex}" data-service-index="${serviceIndex}" title="Excluir serviço"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </div>`).join('');

      return `<article class="service-template-section-card">
        <header class="service-template-section-head">
          <div class="service-template-section-title-field">
            <span>${String(sectionIndex + 1).padStart(2, '0')}</span>
            <input type="text" value="${escapeHtml(section.title || '')}" data-service-template-section-title="${sectionIndex}" aria-label="Título do grupo" />
          </div>
          <div class="service-template-row-actions">
            <button type="button" data-service-template-action="section-up" data-section-index="${sectionIndex}" title="Mover grupo para cima" ${sectionIndex === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" data-service-template-action="section-down" data-section-index="${sectionIndex}" title="Mover grupo para baixo" ${sectionIndex === (draft.sections || []).length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="danger" data-service-template-action="section-delete" data-section-index="${sectionIndex}" title="Excluir grupo"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </header>
        <div class="service-template-service-list">${services || '<div class="service-template-empty">Nenhum serviço neste grupo.</div>'}</div>
        <button type="button" class="service-template-add-service" data-service-template-action="service-add" data-section-index="${sectionIndex}"><i class="fa-solid fa-plus"></i> Adicionar serviço</button>
      </article>`;
    }).join('') || '<div class="service-template-empty service-template-empty-large"><strong>Nenhum grupo criado</strong><span>Clique em “Novo grupo” para começar.</span></div>';
  }

  function openServiceProposalTemplateManager() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao' || !canUseNilsonProposalModels()) return;
    const model = serviceProposalDefinition(key);
    state.serviceProposalTemplateDraft = {
      key,
      name: model.name,
      introduction: model.introduction || '',
      conditions: model.conditions || '',
      sections: JSON.parse(JSON.stringify(model.sections || [])),
    };
    renderServiceTemplateEditor();
    openOverlay('service-proposal-template-modal');
  }

  function closeServiceProposalTemplateManager() {
    state.serviceProposalTemplateDraft = null;
    closeOverlay('service-proposal-template-modal');
  }

  function moveArrayItem(list, from, to) {
    if (!Array.isArray(list) || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  }

  async function handleServiceTemplateAction(button) {
    const draft = state.serviceProposalTemplateDraft;
    if (!draft || !button) return;
    syncServiceTemplateDraftFromForm();
    const action = button.dataset.serviceTemplateAction;
    const sectionIndex = Number(button.dataset.sectionIndex);
    const serviceIndex = Number(button.dataset.serviceIndex);
    const section = draft.sections?.[sectionIndex];

    if (action === 'section-up') moveArrayItem(draft.sections, sectionIndex, sectionIndex - 1);
    if (action === 'section-down') moveArrayItem(draft.sections, sectionIndex, sectionIndex + 1);
    if (action === 'service-up' && section) moveArrayItem(section.services, serviceIndex, serviceIndex - 1);
    if (action === 'service-down' && section) moveArrayItem(section.services, serviceIndex, serviceIndex + 1);
    if (action === 'service-add' && section) {
      section.services = Array.isArray(section.services) ? section.services : [];
      section.services.push({ id: serviceTemplateId('servico'), label: 'Novo serviço', checked: true });
    }
    if (action === 'section-delete' && section) {
      const ok = await budgetConfirm({
        title: 'Excluir grupo',
        message: `Excluir o grupo “${section.title || 'Sem título'}” e todos os serviços dele?`,
        confirmText: 'Excluir grupo',
        cancelText: 'Cancelar',
        tone: 'danger',
      });
      if (!ok) return;
      draft.sections.splice(sectionIndex, 1);
    }
    if (action === 'service-delete' && section?.services?.[serviceIndex]) {
      const service = section.services[serviceIndex];
      const ok = await budgetConfirm({
        title: 'Excluir serviço',
        message: `Excluir “${service.label || 'este serviço'}” do modelo padrão?`,
        confirmText: 'Excluir serviço',
        cancelText: 'Cancelar',
        tone: 'danger',
      });
      if (!ok) return;
      section.services.splice(serviceIndex, 1);
    }
    renderServiceTemplateEditor();
  }

  function addServiceTemplateSection() {
    const draft = state.serviceProposalTemplateDraft;
    if (!draft) return;
    syncServiceTemplateDraftFromForm();
    draft.sections.push({
      id: serviceTemplateId('grupo'),
      title: 'Novo grupo de serviços',
      services: [{ id: serviceTemplateId('servico'), label: 'Novo serviço', checked: true }],
    });
    renderServiceTemplateEditor();
    const cards = $$('.service-template-section-card', $('service-template-sections'));
    cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validateServiceTemplateDraft(draft) {
    if (!draft) throw new Error('Modelo não carregado.');
    for (const section of draft.sections || []) {
      if (!String(section.title || '').trim()) throw new Error('Preencha o nome de todos os grupos.');
      for (const service of section.services || []) {
        if (!String(service.label || '').trim()) throw new Error(`Existe um serviço sem descrição no grupo “${section.title}”.`);
      }
    }
  }

  function reconcileProposalDataAfterTemplateChange(oldModel, newModel, currentData) {
    if (!currentData || typeof currentData !== 'object') return defaultServiceProposalData(newModel.key);
    const next = { ...currentData, selected_services: {}, values: { ...(currentData.values || {}) } };
    const oldSectionMap = new Map((oldModel.sections || []).map((section) => [section.id, section]));
    (newModel.sections || []).forEach((section) => {
      const oldSection = oldSectionMap.get(section.id);
      const oldIds = new Set((oldSection?.services || []).map((service) => service.id));
      const currentSelected = new Set(Array.isArray(currentData.selected_services?.[section.id]) ? currentData.selected_services[section.id] : []);
      next.selected_services[section.id] = (section.services || []).filter((service) => {
        if (currentSelected.has(service.id)) return true;
        return !oldIds.has(service.id) && service.checked !== false;
      }).map((service) => service.id);
      if (!oldSection) next.selected_services[section.id] = (section.services || []).filter((service) => service.checked !== false).map((service) => service.id);
    });
    if (String(currentData.introduction ?? '') === String(oldModel.introduction ?? '')) next.introduction = newModel.introduction || '';
    if (String(currentData.conditions ?? '') === String(oldModel.conditions ?? '')) next.conditions = newModel.conditions || '';
    return next;
  }

  async function saveServiceProposalTemplate() {
    const draft = state.serviceProposalTemplateDraft;
    if (!draft) return;
    syncServiceTemplateDraftFromForm();
    try {
      validateServiceTemplateDraft(draft);
    } catch (error) {
      toast(error.message || 'Revise os campos do modelo.', 'error');
      return;
    }

    const button = $('btn-save-service-template');
    const oldModel = serviceProposalDefinition(draft.key);
    const activeSameModel = serviceProposalSelectedModel() === draft.key;
    const currentData = activeSameModel ? collectServiceProposalData() : null;
    const payload = {
      introduction: String(draft.introduction || '').trim(),
      conditions: String(draft.conditions || '').trim(),
      sections: (draft.sections || []).map((section) => ({
        id: section.id,
        title: String(section.title || '').trim(),
        services: (section.services || []).map((service) => ({
          id: service.id,
          label: String(service.label || '').trim(),
          checked: service.checked !== false,
        })),
      })),
    };

    try {
      setButtonLoading(button, true, 'Salvando padrão...');
      const response = await api(`${API}/modelos-proposta-servicos/${encodeURIComponent(draft.key)}`, { method: 'PUT', body: JSON.stringify(payload) });
      state.meta.modelos_proposta_personalizados = state.meta.modelos_proposta_personalizados || {};
      state.meta.modelos_proposta_personalizados[draft.key] = response?.definicao || payload;
      const newModel = serviceProposalDefinition(draft.key);
      if (activeSameModel) {
        const reconciled = reconcileProposalDataAfterTemplateChange(oldModel, newModel, currentData);
        renderServiceProposal(draft.key, reconciled);
        markBudgetDirty();
      }
      state.serviceProposalTemplateDraft = {
        key: draft.key,
        name: newModel.name,
        introduction: newModel.introduction || '',
        conditions: newModel.conditions || '',
        sections: JSON.parse(JSON.stringify(newModel.sections || [])),
      };
      renderServiceTemplateEditor();
      toast('Modelo padrão salvo. As próximas propostas já usarão esta estrutura.');
    } catch (error) {
      toast(error.message || 'Não foi possível salvar o modelo.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function resetGlobalServiceProposalTemplate() {
    const draft = state.serviceProposalTemplateDraft;
    if (!draft) return;
    const ok = await budgetConfirm({
      title: 'Restaurar modelo original',
      message: 'Remover todas as personalizações globais e voltar exatamente ao modelo original enviado pela SEG?',
      confirmText: 'Restaurar original',
      cancelText: 'Cancelar',
      tone: 'danger',
    });
    if (!ok) return;

    const oldModel = serviceProposalDefinition(draft.key);
    const activeSameModel = serviceProposalSelectedModel() === draft.key;
    const currentData = activeSameModel ? collectServiceProposalData() : null;
    try {
      await api(`${API}/modelos-proposta-servicos/${encodeURIComponent(draft.key)}`, { method: 'DELETE' });
      if (state.meta.modelos_proposta_personalizados) delete state.meta.modelos_proposta_personalizados[draft.key];
      const newModel = serviceProposalDefinition(draft.key);
      if (activeSameModel) {
        const reconciled = reconcileProposalDataAfterTemplateChange(oldModel, newModel, currentData);
        renderServiceProposal(draft.key, reconciled);
        markBudgetDirty();
      }
      state.serviceProposalTemplateDraft = {
        key: draft.key,
        name: newModel.name,
        introduction: newModel.introduction || '',
        conditions: newModel.conditions || '',
        sections: JSON.parse(JSON.stringify(newModel.sections || [])),
      };
      renderServiceTemplateEditor();
      toast('Modelo original restaurado.');
    } catch (error) {
      toast(error.message || 'Não foi possível restaurar o modelo original.', 'error');
    }
  }

  function toggleServiceProposalSection(sectionId) {
    const inputs = $$(`input[data-service-proposal-section="${CSS.escape(sectionId)}"]`, $('service-proposal-services'));
    if (!inputs.length) return;
    const allChecked = inputs.every((input) => input.checked);
    inputs.forEach((input) => { input.checked = !allChecked; });
    const button = $('service-proposal-services')?.querySelector(`[data-service-proposal-toggle-section="${CSS.escape(sectionId)}"]`);
    if (button) button.textContent = allChecked ? 'Marcar todos' : 'Desmarcar todos';
    markBudgetDirty();
    syncServiceProposalStateFromForm();
  }

  function serviceProposalPreviewHtml() {
    const key = serviceProposalSelectedModel();
    if (key === 'padrao') return '';
    const model = serviceProposalDefinition(key);
    const data = collectServiceProposalData();
    const selected = data.selected_services || {};
    const sectionsHtml = (model.sections || []).map((section) => {
      const selectedIds = new Set(Array.isArray(selected[section.id]) ? selected[section.id] : []);
      const items = (section.services || []).filter((service) => selectedIds.has(service.id));
      if (!items.length) return '';
      return `<section class="preview-service-proposal-section"><h5>${escapeHtml(section.title)}</h5><ul>${items.map((service) => `<li>${escapeHtml(service.label)}</li>`).join('')}</ul></section>`;
    }).filter(Boolean).join('');
    const valuesHtml = (model.values || []).map((value) => {
      const amount = parseNumber(data.values?.[value.id] || 0);
      return `<div class="preview-service-proposal-value"><span>${escapeHtml(value.label)}</span><strong>${formatMoney(amount)}</strong></div>`;
    }).join('');
    const intro = data.introduction ? `<div class="preview-service-proposal-intro"><h4>${escapeHtml(model.name)}</h4><p>${escapeHtml(data.introduction)}</p></div>` : '';
    const conditions = data.conditions ? `<div class="preview-service-proposal-note"><h5>Condições gerais</h5><p>${escapeHtml(data.conditions)}</p></div>` : '';
    const notes = data.notes ? `<div class="preview-service-proposal-note"><h5>Observações adicionais</h5><p>${escapeHtml(data.notes)}</p></div>` : '';
    return `<section class="preview-service-proposal">${intro}${sectionsHtml ? `<div class="preview-service-proposal-grid">${sectionsHtml}</div>` : ''}${valuesHtml ? `<div class="preview-service-proposal-values">${valuesHtml}</div>` : ''}${conditions}${notes}</section>`;
  }


  function isNilsonServiceProposalModel(key = serviceProposalSelectedModel()) {
    return NILSON_PROPOSAL_MODELS.has(String(key || ''));
  }

  function proposalMoneyWordsPtBr(value) {
    const totalCents = Math.max(0, Math.round((parseNumber(value) + Number.EPSILON) * 100));
    const reais = Math.floor(totalCents / 100);
    const centavos = totalCents % 100;

    const ate999 = (n) => {
      const unidades = ['', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove'];
      const especiais = ['Dez', 'Onze', 'Doze', 'Treze', 'Quatorze', 'Quinze', 'Dezesseis', 'Dezessete', 'Dezoito', 'Dezenove'];
      const dezenas = ['', '', 'Vinte', 'Trinta', 'Quarenta', 'Cinquenta', 'Sessenta', 'Setenta', 'Oitenta', 'Noventa'];
      const centenas = ['', 'Cento', 'Duzentos', 'Trezentos', 'Quatrocentos', 'Quinhentos', 'Seiscentos', 'Setecentos', 'Oitocentos', 'Novecentos'];
      n = Math.floor(n);
      if (n === 0) return '';
      if (n === 100) return 'Cem';
      const parts = [];
      if (n >= 100) {
        parts.push(centenas[Math.floor(n / 100)]);
        n %= 100;
      }
      if (n >= 10 && n < 20) {
        parts.push(especiais[n - 10]);
        n = 0;
      } else if (n >= 20) {
        parts.push(dezenas[Math.floor(n / 10)]);
        n %= 10;
      }
      if (n > 0) parts.push(unidades[n]);
      return parts.filter(Boolean).join(' e ');
    };

    const inteiro = (n) => {
      n = Math.floor(n);
      if (n === 0) return 'Zero';
      const grupos = [
        { divisor: 1000000000, singular: 'Bilhão', plural: 'Bilhões' },
        { divisor: 1000000, singular: 'Milhão', plural: 'Milhões' },
        { divisor: 1000, singular: 'Mil', plural: 'Mil' },
      ];
      const parts = [];
      let resto = n;
      grupos.forEach((group) => {
        if (resto < group.divisor) return;
        const quantidade = Math.floor(resto / group.divisor);
        resto %= group.divisor;
        if (group.divisor === 1000) {
          parts.push(quantidade === 1 ? 'Mil' : `${ate999(quantidade)} Mil`);
        } else {
          parts.push(`${ate999(quantidade)} ${quantidade === 1 ? group.singular : group.plural}`);
        }
      });
      if (resto) parts.push(ate999(resto));
      return parts.join(' e ');
    };

    const reaisText = `${inteiro(reais)} ${reais === 1 ? 'Real' : 'Reais'}`;
    if (!centavos) return reaisText;
    return `${reaisText} e ${inteiro(centavos)} ${centavos === 1 ? 'Centavo' : 'Centavos'}`;
  }

  function proposalMoneyReference(value) {
    return `${formatMoney(parseNumber(value))} (${proposalMoneyWordsPtBr(value)})`;
  }

  function nilsonProposalSellerData() {
    const budget = state.current || {};
    const selected = state.users.find((user) => String(user.id) === String($('orcamento-consultor')?.value || '')) || {};
    return {
      nome: selected.nome || budget.consultor_nome || state.meta?.usuario?.nome || 'Nilson',
      telefone: selected.telefone || budget.consultor_telefone || '',
    };
  }

  function nilsonProposalClientData() {
    const budget = state.current || {};
    const client = state.selectedClient || {};
    return {
      codigo: client.codigo || budget.cliente_codigo || '',
      nome: client.nome || budget.cliente_razao_social || budget.cliente_nome || $('orcamento-cliente-busca')?.value || 'Cliente não selecionado',
      telefone: client.whatsapp || client.telefone || budget.cliente_whatsapp || budget.cliente_telefone_documento || $('orcamento-contato-cliente')?.value || '',
      endereco: budgetAddress() || '—',
    };
  }

  function nilsonProposalSection(model, sectionOrId) {
    if (sectionOrId && typeof sectionOrId === 'object') return sectionOrId;
    const sectionId = String(sectionOrId || '');
    return (model.sections || []).find((section) => section.id === sectionId) || { id: sectionId, title: '', services: [] };
  }

  function nilsonProposalSelected(data, sectionId, serviceId) {
    const ids = Array.isArray(data.selected_services?.[sectionId]) ? data.selected_services[sectionId] : [];
    return ids.includes(serviceId);
  }

  function nilsonMonitorServicesHtml(model, data, sectionOrId) {
    const section = nilsonProposalSection(model, sectionOrId);
    if (!section?.title) return '';
    return `<section class="nilson-monitor-group">
      <h3>${escapeHtml(section.title)}${String(section.title || '').trim().endsWith(':') ? '' : ':'}</h3>
      <div class="nilson-monitor-services">
        ${(section.services || []).map((service) => `<div><b>${nilsonProposalSelected(data, section.id, service.id) ? '(X)' : '(*)'}</b><span>${escapeHtml(service.label)}</span></div>`).join('')}
      </div>
    </section>`;
  }

  function nilsonBulletServicesHtml(model, data, sectionOrId) {
    const section = nilsonProposalSection(model, sectionOrId);
    const selected = (section.services || []).filter((service) => nilsonProposalSelected(data, section.id, service.id));
    return `<ul>${selected.map((service) => `<li>${escapeHtml(service.label)}</li>`).join('')}</ul>`;
  }

  function nilsonProposalHeaderHtml(client, seller) {
    const codeName = [client.codigo, client.nome].filter(Boolean).join('- ');
    const dateLabel = localDate($('orcamento-data-emissao')?.value || new Date().toISOString().slice(0, 10));
    return `
      <header class="nilson-reference-header">
        <img src="/frontend/img/propostas/segsis-modelo-logo.png" class="nilson-reference-logo" alt="SEG">
        <div class="nilson-reference-company">
          <h1>SISTEMAS E GERENCIAMENTOS INTEGRADOS</h1>
          <strong>R. Francisco de Paula Simões, 131 - Vila Paulista - Taubaté SP 12031-050</strong>
          <div><strong>Tel. (012) 974101924 * 3633-4871* E-mail:</strong> <u>callcenter.segsis@gmail.com</u></div>
        </div>
      </header>
      <div class="nilson-reference-client-row">
        <div class="nilson-reference-client-main">
          <strong><span class="nilson-reference-client-name">${escapeHtml(codeName || client.nome)}</span>${client.telefone ? `<span class="nilson-reference-client-phone">${escapeHtml(client.telefone)}</span>` : ''}</strong>
          <span>${escapeHtml(client.endereco)}</span>
        </div>
        <div class="nilson-reference-client-side">
          <strong>${escapeHtml(dateLabel)}</strong>
          <strong>${escapeHtml(seller.nome || 'Nilson')}</strong>
          <strong>${escapeHtml(seller.telefone || '')}</strong>
        </div>
      </div>`;
  }

  function nilsonProposalSignatureHtml() {
    return `
      <div class="nilson-reference-signature">
        <div class="nilson-reference-consultant">ASS. CONSULTOR: ___________________________________</div>
        <div class="nilson-reference-approval">
          <strong>APROVAÇÃO:</strong>
          <div>DATA: ____/____/____ <span>HORA: _____:_____</span></div>
          <div>_______________________________________________________________</div>
          <small>ASSINATURA CLIENTE</small>
        </div>
      </div>
      <div class="nilson-reference-site">http://www.segsis.com.br</div>`;
  }

  function nilsonProposalStyles() {
    return `<style>
      .nilson-proposal-sheet{box-sizing:border-box;width:210mm;height:297mm;min-height:297mm;margin:0 auto;padding:9mm 9.5mm 36mm;background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:8pt;line-height:1.22;position:relative;overflow:hidden}.nilson-monitor-sheet{height:auto;min-height:297mm;padding-bottom:8mm;overflow:visible}
      .nilson-proposal-sheet *{box-sizing:border-box}.nilson-reference-header{height:30mm;display:grid;grid-template-columns:29mm max-content;align-items:center;justify-content:center;column-gap:4mm;padding:0 1mm;position:relative}
      .nilson-reference-logo{position:static;display:block;width:29mm;height:29mm;object-fit:contain}
      .nilson-reference-company{width:auto;max-width:154mm;padding:0;text-align:center;font-family:"Times New Roman",serif;color:#000}
      .nilson-reference-company h1{margin:0;font-size:16.6pt;line-height:1;font-weight:700;white-space:nowrap;color:#000}
      .nilson-reference-company strong,.nilson-reference-company div{font-size:10.5pt;line-height:1.12;color:#000}.nilson-reference-company u{color:#0563c1}
      .nilson-reference-client-row{min-height:14.5mm;height:auto;border:.35mm solid #000;display:grid;grid-template-columns:minmax(0,1fr) 31mm;font-size:9.3pt;color:#000}
      .nilson-reference-client-main{padding:1.3mm 2.2mm;display:flex;flex-direction:column;justify-content:center;gap:1mm;overflow:hidden;color:#000}.nilson-reference-client-main strong,.nilson-reference-client-main>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#000}.nilson-reference-client-main strong{display:flex;align-items:center;gap:5mm}.nilson-reference-client-name,.nilson-reference-client-phone{display:inline-block;color:#000}
      .nilson-reference-client-side{border-left:.35mm solid #000;padding:.9mm 1.3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.55mm;font-size:8.5pt;color:#000}.nilson-reference-client-side strong{color:#000}
      .nilson-reference-title{margin:3.6mm 0 3mm;text-align:center;font-size:12.5pt;font-weight:700}
      .nilson-reference-intro{font-size:8.2pt;line-height:1.3;text-align:justify}.nilson-reference-intro p{margin:0 0 2.2mm}.nilson-reference-intro strong{text-decoration:underline}
      .nilson-monitor-columns{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:1.4mm;align-items:start}.nilson-monitor-column{min-width:0}
      .nilson-monitor-group{margin:0 0 3.5mm;break-inside:avoid;page-break-inside:avoid}.nilson-monitor-group h3{margin:0 0 1.5mm;font-size:8.2pt;font-weight:700}.nilson-monitor-services{display:grid;gap:.8mm}
      .nilson-monitor-services>div{display:grid;grid-template-columns:7mm 1fr;gap:.3mm;font-size:7.75pt;line-height:1.2}.nilson-monitor-services b{font-weight:400}
      .nilson-reference-observations{margin-top:1.3mm;font-size:7.15pt;line-height:1.25}.nilson-reference-observations h4{margin:0 0 .8mm;font-size:7.7pt}.nilson-reference-observations div{margin:.35mm 0}
      .nilson-reference-footnotes{margin-top:2.2mm;font-size:6.35pt;line-height:1.22}.nilson-reference-footnotes div{margin:.28mm 0}
      .nilson-reference-promo{display:block;width:100%;max-height:37mm;object-fit:contain;margin-top:1.6mm}
      .nilson-reference-values{margin-top:4mm;font-size:9.5pt;font-weight:700;break-inside:avoid;page-break-inside:avoid}.nilson-monitor-sheet>.nilson-reference-values{position:static;margin-top:4mm}.nilson-reference-value{display:flex;align-items:flex-end;gap:1.5mm;margin:1.2mm 0}
      .nilson-reference-value .label{white-space:nowrap}.nilson-reference-value .dots{flex:1;border-bottom:1px dotted #000;transform:translateY(-1.2mm)}.nilson-reference-value .amount{white-space:nowrap}
      .nilson-reference-signature{position:absolute;left:9.5mm;right:9.5mm;bottom:10mm;height:18mm;border:.35mm solid #000;display:grid;grid-template-columns:44% 56%;font-size:7.4pt;font-weight:700}.nilson-monitor-sheet .nilson-reference-signature{position:static;left:auto;right:auto;bottom:auto;width:100%;margin-top:3.8mm;break-inside:avoid;page-break-inside:avoid}
      .nilson-reference-consultant{display:flex;align-items:flex-end;padding:0 2mm 4.3mm}
      .nilson-reference-approval{border-left:.35mm solid #000;padding:1.2mm 2mm;text-align:left;position:relative}.nilson-reference-approval>strong{display:block;margin-bottom:2mm}.nilson-reference-approval>div:nth-of-type(1){display:flex;justify-content:space-between;gap:5mm;text-align:left}.nilson-reference-approval>div:nth-of-type(1) span{float:none}.nilson-reference-approval>div:nth-of-type(2){margin-top:2.5mm;text-align:center}.nilson-reference-approval small{display:block;text-align:center;margin-top:.5mm;font-size:7.2pt}
      .nilson-reference-site{position:absolute;left:0;right:0;bottom:4.2mm;text-align:center;font-size:10pt}.nilson-monitor-sheet .nilson-reference-site{position:static;left:auto;right:auto;bottom:auto;margin-top:1.5mm;break-inside:avoid;page-break-inside:avoid}
      .nilson-tele-intro{margin:3.5mm 0 2.2mm;font-size:8.1pt;line-height:1.32;text-align:justify}.nilson-tele-intro p{margin:0 0 2.2mm}.nilson-tele-intro strong{text-decoration:underline}
      .nilson-tele-grid{display:grid;grid-template-columns:1fr 1fr;border:.35mm solid #000}.nilson-tele-box{padding:1.3mm 1.6mm;font-size:7.55pt;line-height:1.25;min-height:116mm;display:flex;flex-direction:column}.nilson-tele-box+.nilson-tele-box{border-left:.35mm solid #000}
      .nilson-tele-box h3{font-size:8pt;margin:0 0 1.5mm}.nilson-tele-box p{margin:0 0 1.7mm;text-align:justify}.nilson-tele-box h4{font-size:7.7pt;margin:0 0 1mm;text-decoration:underline}.nilson-tele-box ul{margin:0 0 2mm 5.5mm;padding-left:4mm}.nilson-tele-box li{margin:.45mm 0}
      .nilson-tele-box .nilson-reference-value{font-size:8.1pt;margin-top:auto}.nilson-tele-observations{font-size:7.2pt;margin-top:1.8mm}.nilson-tele-observations strong{display:block;margin-bottom:.8mm}.nilson-tele-observations div{margin:.35mm 0}
      .nilson-tele-general{margin:2.3mm .8mm 1.5mm;font-size:7.2pt;line-height:1.25}.nilson-tele-general h4{font-size:7.8pt;margin:0 0 1mm}.nilson-tele-general div{margin:.35mm 0}
      @page{size:A4 portrait;margin:0}
      @media print{html,body{margin:0!important;padding:0!important;background:#fff!important}.document-preview{padding:0!important;margin:0!important}.nilson-proposal-sheet{margin:0;width:210mm;min-height:297mm;box-shadow:none}.nilson-monitor-sheet{height:auto;padding-bottom:8mm;overflow:visible}.nilson-monitor-sheet .nilson-reference-header,.nilson-monitor-sheet .nilson-reference-client-row,.nilson-monitor-sheet .nilson-reference-values,.nilson-monitor-sheet .nilson-reference-signature,.nilson-monitor-sheet .nilson-reference-site{break-inside:avoid;page-break-inside:avoid}}
    </style>`;
  }

  function buildNilsonMonitorProposalHtml(key, model, data, client, seller) {
    const conditions = String(data.conditions || model.conditions || '');
    const blocks = conditions.split(/\n\s*\n/);
    const observationLines = (blocks.shift() || '').split(/\r?\n/).filter(Boolean);
    const footnoteLines = blocks.join('\n').split(/\r?\n/).filter(Boolean);
    const values = data.values || {};
    const sections = model.sections || [];
    const leftCount = Math.ceil(sections.length / 2);
    const leftSections = sections.slice(0, leftCount);
    const rightSections = sections.slice(leftCount);

    return `${nilsonProposalStyles()}
      <section class="nilson-proposal-sheet nilson-monitor-sheet">
        ${nilsonProposalHeaderHtml(client, seller)}
        <h2 class="nilson-reference-title">SERVIÇOS DE MONITORAMENTO 24 HORAS</h2>
        <div class="nilson-reference-intro">
          ${String(data.introduction || model.introduction || '').split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
          <strong>Serviços Oferecidos:</strong>
        </div>
        <div class="nilson-monitor-columns">
          <div class="nilson-monitor-column">
            ${leftSections.map((section) => nilsonMonitorServicesHtml(model, data, section)).join('')}
            <div class="nilson-reference-observations">
              <h4>Observações:</h4>
              ${observationLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
            <div class="nilson-reference-footnotes">
              ${footnoteLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
              ${data.notes ? `<div>${escapeHtml(data.notes)}</div>` : ''}
            </div>
          </div>
          <div class="nilson-monitor-column">
            ${rightSections.map((section) => nilsonMonitorServicesHtml(model, data, section)).join('')}
            <img src="/frontend/img/propostas/my-security-modelo.png" class="nilson-reference-promo" alt="Aplicativo My Security">
          </div>
        </div>
        <div class="nilson-reference-values">
          <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt;&gt;&gt;&gt; VALOR IMPLANTAÇÃO (Único)</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao || 0))}</span></div>
          <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt;&gt;&gt;&gt; VALOR SERVIÇOS MONIT24HS (Mensal)</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.mensalidade || 0))}</span></div>
        </div>
        ${nilsonProposalSignatureHtml()}
      </section>`;
  }

  function buildNilsonTeleProposalHtml(model, data, client, seller) {
    const values = data.values || {};
    const conditionText = String(data.conditions || model.conditions || '');
    const split = conditionText.split(/Condições Gerais:\s*/i);
    const leftObservationLines = (split[0] || '').split(/\r?\n/).filter(Boolean);
    const generalLines = (split.slice(1).join('Condições Gerais:') || '').split(/\r?\n/).filter(Boolean);
    const sections = model.sections || [];
    const emergencySection = sections.find((section) => section.id === 'monitoramento_emergencial') || sections[0] || null;
    const rightSections = sections.filter((section) => section !== emergencySection);
    const cftvClientSection = rightSections.find((section) => section.id === 'cftv_cliente') || rightSections[0] || null;
    const extraRightSections = rightSections.filter((section) => section !== cftvClientSection);
    const emergencyTitle = emergencySection?.title || '1- Monitoramento Emergencial';
    const cftvTitle = cftvClientSection?.title || '2- Sistema de CFTV com Monitoramento via Aplicativo';
    const cftvHeading = String(cftvTitle).replace(/\s*-\s*Para o Cliente\s*:??\s*$/i, '');

    return `${nilsonProposalStyles()}
      <section class="nilson-proposal-sheet nilson-tele-sheet">
        ${nilsonProposalHeaderHtml(client, seller)}
        <h2 class="nilson-reference-title">SERVIÇOS DE MONITORAMENTO 24 HORAS - TELE ASSISTÊNCIA</h2>
        <div class="nilson-tele-intro">
          ${String(data.introduction || model.introduction || '').split(/\n\s*\n/).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
          <strong>Serviços Oferecidos:</strong>
        </div>
        <div class="nilson-tele-grid">
          <section class="nilson-tele-box">
            <h3>${escapeHtml(emergencyTitle)}${String(emergencyTitle).trim().endsWith(':') ? '' : ':'}</h3>
            ${emergencySection?.id === 'monitoramento_emergencial' ? '<p>Sistema de Monitoramento Eletrônico 24 horas para Recebimentos de Eventos Emergenciais através do Acionamento de Botão de Ajuda.</p><h4>Serviços:</h4>' : ''}
            ${emergencySection ? nilsonBulletServicesHtml(model, data, emergencySection) : ''}
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Implantação</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao_emergencial || 0))}</span></div>
            <div class="nilson-tele-observations">
              <strong>Observações:</strong>
              ${leftObservationLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
            </div>
          </section>
          <section class="nilson-tele-box">
            ${cftvClientSection ? `
              <h3>${escapeHtml(cftvHeading)}${String(cftvHeading).trim().endsWith(':') ? '' : ':'}</h3>
              ${cftvClientSection.id === 'cftv_cliente' ? '<p>Sistema de CFTV composto por DVR e 04 Cameras de Alta Resolução, Full HD (1080P).</p><h4>Para o Cliente:</h4>' : ''}
              ${nilsonBulletServicesHtml(model, data, cftvClientSection)}
            ` : ''}
            ${extraRightSections.map((section) => `
              <h4>${escapeHtml(section.title)}${String(section.title || '').trim().endsWith(':') ? '' : ':'}</h4>
              ${section.id === 'cftv_central' ? '<p>Monitoramento 24 horas para os Eventos:</p>' : ''}
              ${nilsonBulletServicesHtml(model, data, section)}
            `).join('')}
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Implantação</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.implantacao_cftv || 0))}</span></div>
            <div class="nilson-reference-value"><span class="label">&gt;&gt;&gt; Mensal</span><span class="dots"></span><span class="amount">${escapeHtml(proposalMoneyReference(values.mensalidade_cftv || 0))}</span></div>
            <div class="nilson-tele-observations">
              <strong>Observações:</strong>
              <div>1- Sistema Requer Internet Banda Larga no Imovel e Visualizado remota.</div>
              <div>2- Local Instalação Cameras: Quarto/Cozinha/Sala/Corredor</div>
            </div>
          </section>
        </div>
        <div class="nilson-tele-general">
          <h4>Condições Gerais: Observações:</h4>
          ${generalLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
          ${data.notes ? `<div>${escapeHtml(data.notes)}</div>` : ''}
        </div>
        ${nilsonProposalSignatureHtml()}
      </section>`;
  }

  function buildNilsonServiceProposalHtml() {
    const key = serviceProposalSelectedModel();
    const model = serviceProposalDefinition(key);
    const data = collectServiceProposalData();
    const client = nilsonProposalClientData();
    const seller = nilsonProposalSellerData();
    if (key === 'teleassistencia_idosos') return buildNilsonTeleProposalHtml(model, data, client, seller);
    return buildNilsonMonitorProposalHtml(key, model, data, client, seller);
  }
