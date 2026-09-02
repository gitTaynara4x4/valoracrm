/*
 * ValoraCRM · Orçamentos · configuracoes.js
 * Kits, emitentes e configurações gerais do módulo de Orçamentos.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function activeKits() {
    return (state.kits || []).filter((kit) => kit.ativo !== false);
  }

  function updateKitPickerLayoutUI() {
    const list = $('kit-picker-list');
    const layout = state.kitPickerLayout === 'row' ? 'row' : 'column';
    if (list) list.classList.toggle('is-row-layout', layout === 'row');
    $$('[data-kit-layout]').forEach((option) => {
      const active = option.dataset.kitLayout === layout;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function closeKitLayoutMenu() {
    const menu = $('kit-layout-menu');
    const button = $('btn-kit-picker-layout');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleKitLayoutMenu(force) {
    const menu = $('kit-layout-menu');
    const button = $('btn-kit-picker-layout');
    if (!menu || !button) return;
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setKitPickerLayout(layout) {
    state.kitPickerLayout = layout === 'row' ? 'row' : 'column';
    saveKitPickerLayout(state.kitPickerLayout);
    updateKitPickerLayoutUI();
  }

  function renderKitPicker() {
    const query = String($('kit-picker-search-input')?.value || '').trim().toLowerCase();
    const kits = activeKits().filter((kit) => !query || [kit.nome, kit.descricao].join(' ').toLowerCase().includes(query));
    $('kit-picker-count').textContent = `${kits.length} ${kits.length === 1 ? 'kit disponível' : 'kits disponíveis'}`;
    updateKitPickerLayoutUI();
    $('kit-picker-list').innerHTML = kits.map((kit) => `
      <article class="kit-picker-card">
        <div class="kit-picker-card-icon"><i class="fa-solid fa-layer-group"></i></div>
        <div class="kit-picker-card-copy">
          <h4>${escapeHtml(kit.nome)}</h4>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para o orçamento.')}</p>
          <div class="kit-picker-card-meta">
            <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
            <span><i class="fa-solid fa-coins"></i> ${formatMoney(kit.valor_estimado)}</span>
          </div>
        </div>
        <button class="btn btn-primary btn-small" type="button" data-add-kit="${kit.id}"><i class="fa-solid fa-plus"></i> Adicionar</button>
      </article>`).join('') || `
      <div class="kit-picker-empty">
        <i class="fa-solid fa-layer-group"></i>
        <strong>${query ? 'Nenhum kit encontrado' : 'Nenhum kit cadastrado'}</strong>
        <span>${query ? 'Tente buscar por outro nome.' : 'Crie kits em Configurações de orçamentos para inserir vários produtos de uma vez.'}</span>
      </div>`;
  }

  async function openKitPicker() {
    try {
      state.kits = await api(`${API}/kits`);
      $('kit-picker-search-input').value = '';
      closeKitLayoutMenu();
      renderKitPicker();
      openOverlay('kit-picker-modal');
      setTimeout(() => $('kit-picker-search-input')?.focus(), 80);
    } catch (error) {
      toast(error.message || 'Não foi possível carregar os kits.', 'error');
    }
  }

  async function addKitToBudget(kitId, button = null, { closePicker = true } = {}) {
    try {
      setButtonLoading(button, true, 'Adicionando...');
      const kit = await api(`${API}/kits/${kitId}`);
      let addedLines = 0;
      let mergedLines = 0;
      (kit.itens || []).forEach((rawItem) => {
        const item = normalizeItem(rawItem);
        const existing = item.produto_id
          ? state.items.find((current) => Number(current.produto_id) === Number(item.produto_id))
          : null;
        if (existing) {
          existing.quantidade = parseNumber(existing.quantidade) + parseNumber(item.quantidade);
          mergedLines += 1;
        } else {
          state.items.push(item);
          addedLines += 1;
        }
      });
      renderItems();
      updateTotals();
      setTab('itens');
      closeKitLayoutMenu();
      if (closePicker) closeOverlay('kit-picker-modal');
      const detail = mergedLines ? ` (${mergedLines} quantidades somadas aos produtos já existentes)` : '';
      toast(`Kit “${kit.nome}” adicionado com ${addedLines + mergedLines} produtos${detail}.`);
    } catch (error) {
      toast(error.message || 'Não foi possível adicionar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  // Configurações
  async function openSettings() {
    try {
      const [categories, templates, kits, emitters] = await Promise.all([
        api(`${API}/categorias?incluir_inativas=true`),
        api(`${API}/modelos?incluir_inativos=true`),
        api(`${API}/kits?incluir_inativos=true`),
        api(`${API}/emitentes?incluir_inativos=true`),
      ]);
      state.categories = categories || [];
      state.templates = templates || [];
      state.kits = kits || [];
      state.emitters = emitters || [];
    } catch (error) {
      toast(error.message || 'Não foi possível atualizar as configurações.', 'error');
    }
    fillSettingsForm();
    renderCategories();
    renderTemplates();
    renderKits();
    renderEmitters();
    resetEmitterEditor();
    renderSelects();
    setSettingsTab('geral');
    openOverlay('settings-modal');
  }

  function updateSettingsFooter(tab) {
    const footer = $('settings-footer');
    const primaryButton = $('btn-salvar-settings');
    if (!footer || !primaryButton) return;

    const visible = tab === 'geral' || tab === 'emitentes';
    footer.classList.toggle('is-hidden', !visible);
    footer.dataset.mode = tab;

    if (tab === 'emitentes') {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar empresa';
      primaryButton.setAttribute('aria-label', 'Salvar empresa emitente');
    } else {
      primaryButton.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar configurações';
      primaryButton.setAttribute('aria-label', 'Salvar configurações gerais');
    }
  }

  function setSettingsTab(tab) {
    state.settingsTab = tab;
    $$('.settings-tabs button').forEach((button) => {
      const active = button.dataset.settingsTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    $$('.settings-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.settingsPanel === tab));
    updateSettingsFooter(tab);
    if ($('settings-modal') && !$('settings-modal').hidden) $('settings-modal').querySelector('.settings-body').scrollTop = 0;
  }

  function normalizeSettingsColor(value, fallback = '#65ACDE') {
    const raw = String(value || '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toUpperCase()}` : fallback;
  }

  function syncSettingsColorFromPicker() {
    const color = normalizeSettingsColor($('config-cor').value);
    $('config-cor').value = color;
    $('config-cor-hex').value = color.slice(1);
  }

  function syncSettingsColorFromText(force = false) {
    const typed = String($('config-cor-hex').value || '').trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(typed)) {
      const color = `#${typed.toUpperCase()}`;
      $('config-cor').value = color;
      $('config-cor-hex').value = typed.toUpperCase();
      return;
    }
    if (force) syncSettingsColorFromPicker();
  }

  function updateSettingsConditionalFields() {
    const isDav = $('config-modelo-documento').value === 'dav';
    $$('[data-settings-dav]').forEach((field) => field.classList.toggle('is-hidden', !isDav));

    const useCover = $('config-usar-capa').checked;
    $$('[data-settings-cover-field]').forEach((field) => field.classList.toggle('settings-fields-muted', !useCover));
  }

  function fillSettingsForm() {
    const config = state.meta.configuracao || {};
    const values = {
      'config-nome-documento': config.nome_documento || 'Orçamento',
      'config-prefixo': config.prefixo || 'ORC',
      'config-validade': config.validade_padrao_dias ?? 7,
      'config-prazo': config.prazo_execucao_padrao || '',
      'config-condicoes': config.condicoes_padrao || '',
      'config-observacoes': config.observacoes_padrao || '',
      'config-rodape': config.rodape_padrao || '',
      'config-margem-minima': inputMoney(config.margem_minima),
      'config-titulo-capa': config.titulo_capa || '',
      'config-subtitulo-capa': config.subtitulo_capa || '',
      'config-modelo-documento': config.modelo_documento || 'padrao',
      'config-dav-titulo': config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
      'config-cabecalho-razao': config.cabecalho_razao_social || '',
      'config-cabecalho-fantasia': config.cabecalho_nome_fantasia || '',
      'config-cabecalho-cnpj': config.cabecalho_cnpj || '',
      'config-cabecalho-email': config.cabecalho_email || '',
      'config-cabecalho-site': config.cabecalho_site || '',
      'config-cabecalho-telefone': config.cabecalho_telefone || '',
      'config-cabecalho-endereco': config.cabecalho_endereco || '',
      'config-cabecalho-rodape': config.cabecalho_rodape || '',
    };
    Object.entries(values).forEach(([id, value]) => { if ($(id)) $(id).value = value; });
    syncSettingsScale(config.escala_documento_padrao ?? DOCUMENT_SCALE_DEFAULT);
    const primaryColor = normalizeSettingsColor(config.cor_primaria || '#65ACDE');
    $('config-cor').value = primaryColor;
    $('config-cor-hex').value = primaryColor.slice(1);
    $('config-exigir-aprovacao').checked = Boolean(config.exigir_aprovacao_margem);
    $('config-controlar-custos').checked = config.controlar_custos !== false;
    $('config-usar-capa').checked = Boolean(config.usar_capa);
    $('config-mostrar-codigo').checked = config.mostrar_codigo !== false;
    updateSettingsConditionalFields();
  }

  async function saveSettings() {
    const button = $('btn-salvar-settings');
    try {
      setButtonLoading(button, true);
      const config = state.meta.configuracao || {};
      const payload = {
        nome_documento: $('config-nome-documento').value.trim() || 'Orçamento',
        prefixo: $('config-prefixo').value.trim() || 'ORC',
        modelo_documento: $('config-modelo-documento').value || 'padrao',
        dav_titulo: $('config-dav-titulo').value.trim() || 'DAV - Documento Auxiliar de Venda',
        cabecalho_razao_social: $('config-cabecalho-razao').value.trim() || null,
        cabecalho_nome_fantasia: $('config-cabecalho-fantasia').value.trim() || null,
        cabecalho_cnpj: $('config-cabecalho-cnpj').value.trim() || null,
        cabecalho_email: $('config-cabecalho-email').value.trim() || null,
        cabecalho_site: $('config-cabecalho-site').value.trim() || null,
        cabecalho_telefone: $('config-cabecalho-telefone').value.trim() || null,
        cabecalho_endereco: $('config-cabecalho-endereco').value.trim() || null,
        cabecalho_rodape: $('config-cabecalho-rodape').value.trim() || null,
        validade_padrao_dias: Number($('config-validade').value || 0),
        prazo_execucao_padrao: $('config-prazo').value.trim() || null,
        condicoes_padrao: $('config-condicoes').value.trim() || null,
        observacoes_padrao: $('config-observacoes').value.trim() || null,
        rodape_padrao: $('config-rodape').value.trim() || null,
        cor_primaria: normalizeSettingsColor($('config-cor-hex').value || $('config-cor').value),
        titulo_capa: $('config-titulo-capa').value.trim() || null,
        subtitulo_capa: $('config-subtitulo-capa').value.trim() || null,
        usar_capa: $('config-usar-capa').checked,
        escala_documento_padrao: normalizeDocumentScale($('config-escala-documento').value),
        mostrar_codigo: $('config-mostrar-codigo').checked,
        mostrar_desconto: config.mostrar_desconto !== false,
        mostrar_imagens: Boolean(config.mostrar_imagens),
        controlar_custos: $('config-controlar-custos').checked,
        margem_minima: parseNumber($('config-margem-minima').value),
        exigir_aprovacao_margem: $('config-exigir-aprovacao').checked,
        formas_pagamento: config.formas_pagamento || [],
      };
      state.meta.configuracao = await api(`${API}/configuracao`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Configurações salvas.');
      applyPermissions();
      closeOverlay('settings-modal');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  function resetEmitterEditor() {
    const ids = ['emitter-id','emitter-name','emitter-legal-name','emitter-fantasy-name','emitter-cnpj','emitter-ie','emitter-email','emitter-site','emitter-phone','emitter-cep','emitter-address','emitter-number','emitter-complement','emitter-neighborhood','emitter-city','emitter-state','emitter-logo','emitter-footer'];
    ids.forEach((id) => { if ($(id)) $(id).value = ''; });
    $('emitter-default').checked = !state.emitters.some((emitter) => emitter.padrao && emitter.ativo !== false);
    $('emitter-active').checked = true;
    $('emitter-editor-title').textContent = 'Nova empresa emitente';
  }

  function renderEmitters() {
    if (!$('emitters-list')) return;
    $('emitters-list').innerHTML = state.emitters.map((emitter) => `<article class="emitter-list-item ${emitter.ativo === false ? 'is-inactive' : ''}"><div><strong>${escapeHtml(emitter.nome)}</strong><span>${escapeHtml(emitter.razao_social || '')}</span><small>${escapeHtml([emitter.cnpj, emitter.cidade, emitter.estado].filter(Boolean).join(' • '))}</small></div><div class="emitter-list-actions">${emitter.padrao ? '<span class="settings-status-badge">Padrão</span>' : ''}<button type="button" class="budget-action-btn" data-edit-emitter="${emitter.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>${emitter.ativo === false ? '' : `<button type="button" class="budget-action-btn danger" data-delete-emitter="${emitter.id}" title="Desativar"><i class="fa-regular fa-trash-can"></i></button>`}</div></article>`).join('') || '<div class="settings-empty-state"><strong>Nenhuma empresa emitente</strong><small>Cadastre a empresa que deverá aparecer no orçamento.</small></div>';
  }

  function editEmitter(id) {
    const emitter = state.emitters.find((item) => Number(item.id) === Number(id));
    if (!emitter) return;
    const values = {
      'emitter-id': emitter.id, 'emitter-name': emitter.nome, 'emitter-legal-name': emitter.razao_social,
      'emitter-fantasy-name': emitter.nome_fantasia, 'emitter-cnpj': emitter.cnpj, 'emitter-ie': emitter.inscricao_estadual,
      'emitter-email': emitter.email, 'emitter-site': emitter.site, 'emitter-phone': emitter.telefone, 'emitter-cep': emitter.cep,
      'emitter-address': emitter.endereco, 'emitter-number': emitter.numero, 'emitter-complement': emitter.complemento,
      'emitter-neighborhood': emitter.bairro, 'emitter-city': emitter.cidade, 'emitter-state': emitter.estado,
      'emitter-logo': emitter.logo_url, 'emitter-footer': emitter.rodape,
    };
    Object.entries(values).forEach(([idField, value]) => { $(idField).value = value || ''; });
    $('emitter-default').checked = Boolean(emitter.padrao);
    $('emitter-active').checked = emitter.ativo !== false;
    $('emitter-editor-title').textContent = `Editar ${emitter.nome}`;
  }

  function emitterPayload() {
    return {
      nome: $('emitter-name').value.trim(), razao_social: $('emitter-legal-name').value.trim(), nome_fantasia: $('emitter-fantasy-name').value.trim() || null,
      cnpj: $('emitter-cnpj').value.trim() || null, inscricao_estadual: $('emitter-ie').value.trim() || null, email: $('emitter-email').value.trim() || null,
      site: $('emitter-site').value.trim() || null, telefone: $('emitter-phone').value.trim() || null, cep: $('emitter-cep').value.trim() || null,
      endereco: $('emitter-address').value.trim() || null, numero: $('emitter-number').value.trim() || null, complemento: $('emitter-complement').value.trim() || null,
      bairro: $('emitter-neighborhood').value.trim() || null, cidade: $('emitter-city').value.trim() || null, estado: $('emitter-state').value.trim().toUpperCase() || null,
      logo_url: $('emitter-logo').value.trim() || null, rodape: $('emitter-footer').value.trim() || null,
      padrao: $('emitter-default').checked, ativo: $('emitter-active').checked,
    };
  }

  async function saveEmitter(triggerButton = null) {
    const button = triggerButton || $('btn-salvar-emitente');
    try {
      const payload = emitterPayload();
      if (!payload.nome || !payload.razao_social) throw new Error('Informe o nome interno e a razão social.');
      setButtonLoading(button, true);
      const id = Number($('emitter-id').value || 0);
      await api(id ? `${API}/emitentes/${id}` : `${API}/emitentes`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      state.meta.emitentes = state.emitters.filter((emitter) => emitter.ativo !== false);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente salva.');
    } catch (error) { toast(error.message || 'Não foi possível salvar a empresa.', 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteEmitter(id) {
    if (!await budgetConfirm({
      title: 'Desativar empresa emitente',
      message: 'Desativar esta empresa emitente? Orçamentos antigos manterão os dados gravados.',
      confirmText: 'Desativar',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/emitentes/${id}`, { method: 'DELETE' });
      state.emitters = await api(`${API}/emitentes?incluir_inativos=true`);
      renderEmitters(); renderSelects(); resetEmitterEditor();
      toast('Empresa emitente desativada.');
    } catch (error) { toast(error.message, 'error'); }
  }

