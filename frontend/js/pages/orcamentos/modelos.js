/*
 * ValoraCRM · Orçamentos · modelos.js
 * Categorias, modelos de orçamento e edição dos cadastros auxiliares.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function resetCategoryEditor() {
    $('category-id').value = '';
    $('category-name').value = '';
    $('category-description').value = '';
    $('category-order').value = '0';
    $('category-active').checked = true;
    $('category-editor-title').textContent = 'Nova categoria';
  }

  function renderCategories() {
    $('categories-list').innerHTML = state.categories.map((category) => `
      <article class="settings-list-item category-settings-card ${category.ativo === false ? 'is-inactive' : ''}">
        <span class="category-settings-icon"><i class="fa-regular fa-folder-open"></i></span>
        <div class="category-settings-copy">
          <div class="category-settings-title">
            <strong>${escapeHtml(category.nome)}</strong>
            <span class="settings-status-badge ${category.ativo === false ? 'inactive' : ''}">${category.ativo === false ? 'Inativa' : 'Ativa'}</span>
          </div>
          <small>${escapeHtml(category.descricao || 'Categoria sem descrição interna.')}</small>
          <span class="category-settings-order">Ordem ${Number(category.ordem || 0)}</span>
        </div>
        <div class="settings-list-actions">
          <button class="budget-action-btn" data-edit-category="${category.id}" type="button" title="Editar categoria"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-category="${category.id}" type="button" title="Excluir categoria"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state"><span><i class="fa-regular fa-folder-open"></i></span><strong>Nenhuma categoria criada</strong><small>Crie categorias para organizar e identificar os tipos de orçamento.</small></div>`;
  }

  function editCategory(id) {
    const category = state.categories.find((item) => Number(item.id) === Number(id));
    if (!category) return;
    $('category-id').value = category.id;
    $('category-name').value = category.nome;
    $('category-description').value = category.descricao || '';
    $('category-order').value = category.ordem || 0;
    $('category-active').checked = category.ativo !== false;
    $('category-editor-title').textContent = 'Editar categoria';
  }

  async function saveCategory() {
    const id = Number($('category-id').value) || null;
    const payload = { nome: $('category-name').value.trim(), descricao: $('category-description').value.trim() || null, ordem: Number($('category-order').value || 0), ativo: $('category-active').checked };
    if (!payload.nome) { toast('Informe o nome da categoria.', 'error'); return; }
    try {
      await api(id ? `${API}/categorias/${id}` : `${API}/categorias`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria salva.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function deleteCategory(id) {
    if (!await budgetConfirm({
      title: 'Excluir categoria',
      message: 'Excluir esta categoria? Os orçamentos existentes continuarão salvos.',
      confirmText: 'Excluir categoria',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/categorias/${id}`, { method: 'DELETE' });
      state.categories = await api(`${API}/categorias?incluir_inativas=true`);
      renderCategories(); renderSelects(); resetCategoryEditor();
      toast('Categoria excluída.');
    } catch (error) { toast(error.message, 'error'); }
  }

  function renderKits() {
    $('kits-list').innerHTML = state.kits.map((kit) => `
      <article class="kit-settings-card settings-simple-row ${kit.ativo === false ? 'is-inactive' : ''}">
        <span class="kit-settings-icon settings-simple-icon"><i class="fa-solid fa-layer-group"></i></span>
        <div class="kit-settings-copy">
          <h5>${escapeHtml(kit.nome)}</h5>
          <p>${escapeHtml(kit.descricao || 'Conjunto de produtos pronto para inserção no orçamento.')}</p>
        </div>
        <div class="kit-settings-meta">
          <span><i class="fa-solid fa-boxes-stacked"></i> ${Number(kit.itens_quantidade || 0)} ${Number(kit.itens_quantidade || 0) === 1 ? 'produto' : 'produtos'}</span>
          <strong>${formatMoney(kit.valor_estimado)}</strong>
        </div>
        <span class="settings-status-badge ${kit.ativo === false ? 'inactive' : ''}">${kit.ativo === false ? 'Inativo' : 'Ativo'}</span>
        <div class="kit-settings-actions">
          <button class="budget-action-btn" data-edit-kit="${kit.id}" type="button" title="Editar kit"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn" data-duplicate-kit="${kit.id}" type="button" title="Duplicar kit"><i class="fa-regular fa-copy"></i></button>
          <button class="budget-action-btn danger" data-delete-kit="${kit.id}" type="button" title="Excluir kit"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-solid fa-layer-group"></i></span><strong>Nenhum kit criado</strong><small>Monte um conjunto de produtos para adicioná-los ao orçamento com um clique.</small></div>`;
  }

  function openKitEditor(kit = null) {
    $('kits-list-view').classList.add('is-hidden');
    $('kit-editor').classList.remove('is-hidden');
    $('kit-id').value = kit?.id || '';
    $('kit-name').value = kit?.nome || '';
    $('kit-description').value = kit?.descricao || '';
    $('kit-active').checked = kit?.ativo !== false;
    state.kitItems = (kit?.itens || []).map(normalizeItem);
    $('kit-editor-title').textContent = kit ? 'Editar kit' : 'Novo kit';
    $('kit-product-search').hidden = true;
    resetProductSearch('kit');
    renderKitItems();
  }

  function closeKitEditor() {
    $('kit-editor').classList.add('is-hidden');
    $('kits-list-view').classList.remove('is-hidden');
    state.kitItems = [];
    resetProductSearch('kit');
  }

  async function editKit(id) {
    try {
      openKitEditor(await api(`${API}/kits/${id}`));
    } catch (error) {
      toast(error.message || 'Não foi possível abrir o kit.', 'error');
    }
  }

  function renderKitItems() {
    const count = state.kitItems.length;
    const estimatedTotal = state.kitItems.reduce((sum, item) => sum + parseNumber(item.quantidade) * parseNumber(item.valor_unitario), 0);
    $('kit-items-count').textContent = String(count);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
    $('kit-items-body').innerHTML = state.kitItems.map((item, index) => `
      <tr data-kit-index="${index}">
        <td><div class="kit-product-cell"><strong>${escapeHtml(item.descricao || 'Produto')}</strong><small>${escapeHtml(item.referencia || 'Produto cadastrado')}</small></div></td>
        <td>${escapeHtml(item.codigo || '—')}</td>
        <td>${escapeHtml(item.unidade || 'UN')}</td>
        <td><input class="kit-quantity-input" data-kit-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td>${formatMoney(item.valor_unitario)}</td>
        <td class="kit-line-total">${formatMoney(parseNumber(item.quantidade) * parseNumber(item.valor_unitario))}</td>
        <td><button class="item-remove" data-remove-kit-item="${index}" type="button" title="Remover produto"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum produto adicionado ao kit.</td></tr>';
  }

  function updateKitItem(input) {
    const row = input.closest('tr');
    const item = state.kitItems[Number(row?.dataset.kitIndex)];
    if (!item) return;
    item.quantidade = Math.max(parseInputNumber(input.value), 0.0001);
    row.querySelector('.kit-line-total').textContent = formatMoney(item.quantidade * parseNumber(item.valor_unitario));
    const estimatedTotal = state.kitItems.reduce((sum, current) => sum + parseNumber(current.quantidade) * parseNumber(current.valor_unitario), 0);
    $('kit-estimated-total').textContent = formatMoney(estimatedTotal);
  }

  async function saveKit() {
    const button = $('btn-salvar-kit');
    const id = Number($('kit-id').value) || null;
    const payload = {
      nome: $('kit-name').value.trim(),
      descricao: $('kit-description').value.trim() || null,
      ativo: $('kit-active').checked,
      itens: state.kitItems.map((item, index) => ({
        produto_id: Number(item.produto_id),
        quantidade: Math.max(parseNumber(item.quantidade), 0.0001),
        ordem: index,
      })),
    };
    if (!payload.nome) { toast('Informe o nome do kit.', 'error'); return; }
    if (!payload.itens.length) { toast('Adicione pelo menos um produto ao kit.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/kits/${id}` : `${API}/kits`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      closeKitEditor();
      toast('Kit salvo. Ele já está disponível em Modelo e em Adicionar kit.');
    } catch (error) {
      toast(error.message || 'Não foi possível salvar o kit.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function duplicateKit(id) {
    try {
      await api(`${API}/kits/${id}/duplicar`, { method: 'POST' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      toast('Kit duplicado.');
    } catch (error) {
      toast(error.message || 'Não foi possível duplicar o kit.', 'error');
    }
  }

  async function deleteKit(id) {
    if (!await budgetConfirm({
      title: 'Excluir kit',
      message: 'Excluir este kit? Os produtos e orçamentos existentes não serão apagados.',
      confirmText: 'Excluir kit',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/kits/${id}`, { method: 'DELETE' });
      state.kits = await api(`${API}/kits?incluir_inativos=true`);
      renderKits();
      renderSelects();
      closeKitEditor();
      toast('Kit excluído.');
    } catch (error) {
      toast(error.message || 'Não foi possível excluir o kit.', 'error');
    }
  }

  function renderTemplates() {
    $('templates-list').innerHTML = state.templates.map((template) => `
      <article class="template-card settings-simple-row ${template.ativo === false ? 'is-inactive' : ''}">
        <span class="template-card-icon settings-simple-icon"><i class="fa-regular fa-file-lines"></i></span>
        <div class="template-card-copy">
          <h5>${escapeHtml(template.nome)}</h5>
          <p>${escapeHtml(template.descricao || template.titulo || 'Estrutura reutilizável de orçamento.')}</p>
        </div>
        <div class="template-card-meta">
          <span><i class="fa-regular fa-folder"></i> ${escapeHtml(template.categoria_nome || 'Sem categoria')}</span>
          ${template.validade_dias ? `<span><i class="fa-regular fa-calendar"></i> ${template.validade_dias} dias</span>` : ''}
        </div>
        <span class="settings-status-badge ${template.ativo === false ? 'inactive' : ''}">${template.ativo === false ? 'Inativo' : 'Ativo'}</span>
        <div class="template-card-actions">
          <button class="budget-action-btn" data-edit-template="${template.id}" type="button" title="Editar modelo"><i class="fa-solid fa-pen"></i></button>
          <button class="budget-action-btn danger" data-delete-template="${template.id}" type="button" title="Excluir modelo"><i class="fa-solid fa-trash"></i></button>
        </div>
      </article>`).join('') || `
      <div class="settings-empty-state settings-empty-wide"><span><i class="fa-regular fa-file-lines"></i></span><strong>Nenhum modelo criado</strong><small>Crie estruturas prontas para preencher títulos, condições e itens automaticamente.</small></div>`;
  }

  function openTemplateEditor(template = null) {
    $('templates-list-view').classList.add('is-hidden');
    $('template-editor').classList.remove('is-hidden');
    $('template-id').value = template?.id || '';
    $('template-name').value = template?.nome || '';
    $('template-category').value = template?.categoria_id || '';
    $('template-title').value = template?.titulo || '';
    $('template-validity').value = template?.validade_dias ?? state.meta.configuracao?.validade_padrao_dias ?? 7;
    $('template-deadline').value = template?.prazo_execucao || '';
    $('template-conditions').value = template?.condicoes || '';
    $('template-notes').value = template?.observacoes || '';
    $('template-active').checked = template?.ativo !== false;
    state.templateItems = (template?.itens || []).map(normalizeItem);
    $('template-editor-title').textContent = template ? 'Editar modelo' : 'Novo modelo';
    renderTemplateItems();
  }

  function closeTemplateEditor() {
    $('template-editor').classList.add('is-hidden');
    $('templates-list-view').classList.remove('is-hidden');
    state.templateItems = [];
  }

  async function editTemplate(id) {
    try { openTemplateEditor(await api(`${API}/modelos/${id}`)); }
    catch (error) { toast(error.message, 'error'); }
  }

  function renderTemplateItems() {
    $('template-items-body').innerHTML = state.templateItems.map((item, index) => `
      <tr data-template-index="${index}"><td><textarea data-template-field="descricao">${escapeHtml(item.descricao)}</textarea></td><td><input data-template-field="codigo" value="${escapeHtml(item.codigo)}" /></td><td><input data-template-field="unidade" value="${escapeHtml(item.unidade)}" /></td><td><input data-template-field="quantidade" value="${inputMoney(item.quantidade)}" /></td><td><input data-template-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" /></td><td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}"><input data-template-field="custo_unitario" value="${inputMoney(item.custo_unitario)}" /></td><td><button class="item-remove" data-remove-template-item="${index}" type="button"><i class="fa-solid fa-xmark"></i></button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-state">Nenhum item no modelo.</td></tr>';
  }

  function updateTemplateItem(input) {
    const item = state.templateItems[Number(input.closest('tr').dataset.templateIndex)];
    const field = input.dataset.templateField;
    item[field] = ['quantidade', 'valor_unitario', 'custo_unitario'].includes(field) ? parseInputNumber(input.value) : input.value;
  }

  async function saveTemplate() {
    const button = $('btn-salvar-modelo');
    const id = Number($('template-id').value) || null;
    const payload = {
      nome: $('template-name').value.trim(), categoria_id: Number($('template-category').value) || null,
      titulo: $('template-title').value.trim() || null, descricao: null,
      validade_dias: Number($('template-validity').value || 0), prazo_execucao: $('template-deadline').value.trim() || null,
      condicoes: $('template-conditions').value.trim() || null, observacoes: $('template-notes').value.trim() || null,
      pagamentos: [], ativo: $('template-active').checked, itens: state.templateItems.map((item, index) => ({ ...item, ordem: index })),
    };
    if (!payload.nome) { toast('Informe o nome do modelo.', 'error'); return; }
    try {
      setButtonLoading(button, true);
      await api(id ? `${API}/modelos/${id}` : `${API}/modelos`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); closeTemplateEditor(); toast('Modelo salvo.');
    } catch (error) { toast(error.message, 'error'); }
    finally { setButtonLoading(button, false); }
  }

  async function deleteTemplate(id) {
    if (!await budgetConfirm({
      title: 'Excluir modelo',
      message: 'Excluir este modelo de orçamento?',
      confirmText: 'Excluir modelo',
      cancelText: 'Cancelar',
      tone: 'danger',
    })) return;
    try {
      await api(`${API}/modelos/${id}`, { method: 'DELETE' });
      state.templates = await api(`${API}/modelos?incluir_inativos=true`);
      renderTemplates(); renderSelects(); toast('Modelo excluído.');
    } catch (error) { toast(error.message, 'error'); }
  }
