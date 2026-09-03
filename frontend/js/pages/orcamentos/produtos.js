/*
 * ValoraCRM · Orçamentos · produtos.js
 * Pesquisa de produtos, substituição por código e itens do orçamento.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function normalizeItem(item = {}) {
    const hasExplicitCostFlag = typeof item.custo_informado === 'boolean';
    const hasCostValue = item.custo_unitario !== null && item.custo_unitario !== undefined && item.custo_unitario !== '';
    return {
      id: item.id || null,
      produto_id: item.produto_id || null,
      origem: item.origem || (item.produto_id ? 'produto' : 'manual'),
      codigo: item.codigo || '',
      descricao: item.descricao || '',
      referencia: item.referencia || '',
      unidade: item.unidade || 'UN',
      quantidade: parseNumber(item.quantidade || 1),
      valor_unitario: parseNumber(item.valor_unitario),
      desconto: parseNumber(item.desconto),
      custo_unitario: hasCostValue ? parseNumber(item.custo_unitario) : null,
      custo_informado: hasExplicitCostFlag ? item.custo_informado : hasCostValue,
      observacao: item.observacao || '',
      ordem: Number(item.ordem || 0),
    };
  }

  function addManualItem(target = 'budget') {
    const item = normalizeItem({ quantidade: 1, unidade: 'UN', custo_unitario: null, custo_informado: false });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
    }
  }

  function getProductSearchState(target = 'budget') {
    if (target === 'template') return state.productSearch.template;
    if (target === 'kit') return state.productSearch.kit;
    return state.productSearch.budget;
  }

  function getProductSearchElements(target = 'budget') {
    if (target === 'template') {
      return {
        input: $('template-product-input'),
        results: $('template-product-results'),
        box: $('template-product-search'),
      };
    }
    if (target === 'kit') {
      return {
        input: $('kit-product-input'),
        results: $('kit-product-results'),
        box: $('kit-product-search'),
      };
    }

    return {
      input: $('produto-search-input'),
      results: $('produto-search-results'),
      box: $('produto-search-box'),
    };
  }

  function updateProductPickerLayoutUI() {
    const results = $('produto-search-results');
    const header = $('produto-search-list-header');
    const layout = state.productPickerLayout === 'row' ? 'row' : 'column';
    const hasProducts = Boolean(results?.querySelector('[data-product-id]'));

    if (results) {
      results.classList.toggle('is-list-layout', layout === 'row');
      results.classList.toggle('is-column-layout', layout === 'column');
      results.classList.toggle('has-results', hasProducts);
    }
    if (header) header.hidden = layout !== 'row' || !hasProducts;

    $$('[data-product-layout]').forEach((option) => {
      const active = option.dataset.productLayout === layout;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function closeProductLayoutMenu() {
    const menu = $('product-layout-menu');
    const button = $('btn-product-search-layout');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function toggleProductLayoutMenu(force) {
    const menu = $('product-layout-menu');
    const button = $('btn-product-search-layout');
    if (!menu || !button) return;
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function setProductPickerLayout(layout) {
    state.productPickerLayout = layout === 'row' ? 'row' : 'column';
    saveProductPickerLayout(state.productPickerLayout);
    updateProductPickerLayoutUI();
  }

  function renderBudgetProductSearchPrompt() {
    const results = $('produto-search-results');
    const hint = $('produto-search-hint');
    const header = $('produto-search-list-header');
    if (results) {
      results.innerHTML = '';
      results._items = [];
      results.classList.remove('has-results');
    }
    if (hint) hint.hidden = false;
    if (header) header.hidden = true;
    updateProductPickerLayoutUI();
  }

  function handleBudgetProductSearch(query) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      resetProductSearch('budget');
      renderBudgetProductSearchPrompt();
      return;
    }
    const hint = $('produto-search-hint');
    if (hint) hint.hidden = true;
    searchProducts(normalizedQuery, 'budget');
  }

  function productResultMarkup(product, target = 'budget') {
    const details = [
      product.codigo ? `Cód. ${product.codigo}` : '',
      product.categoria,
      product.unidade,
      product.estoque_atual !== null && product.estoque_atual !== undefined && product.estoque_atual !== ''
        ? `Estoque: ${product.estoque_atual}`
        : '',
    ].filter(Boolean).join(' • ');

    return `
      <button class="product-result" type="button" data-product-id="${product.id}" data-target="${target}">
        <strong>${escapeHtml(product.nome || `Produto #${product.id}`)}</strong>
        <span>${escapeHtml(details || product.descricao || 'Produto cadastrado')}</span>
        <em>${formatMoney(product.preco_venda)}</em>
      </button>`;
  }

  function renderProductLoadStatus(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    results.querySelector('[data-product-load-status]')?.remove();

    if (searchState.loading) {
      results.insertAdjacentHTML('beforeend', `
        <div class="product-load-status" data-product-load-status>
          <i class="fa-solid fa-spinner fa-spin"></i> Buscando mais produtos...
        </div>`);
      return;
    }

    if (!searchState.results.length) return;

    const shown = searchState.results.length;
    const totalText = searchState.total ? ` de ${searchState.total}` : '';
    const message = searchState.hasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} produtos carregados`;

    results.insertAdjacentHTML('beforeend', `
      <div class="product-load-status" data-product-load-status>
        ${escapeHtml(message)}
      </div>`);
  }

  function renderProductResults(products, {
    target = 'budget',
    append = false,
    emptyMessage = 'Nenhum produto encontrado.',
  } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalized = normalizeCollection(products);

    if (!append) results.innerHTML = '';
    else results.querySelector('[data-product-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-product-id]', results).map((item) => String(item.dataset.productId)),
    );
    const newProducts = normalized.filter((product) => !existingIds.has(String(product.id)));

    if (newProducts.length) {
      results.insertAdjacentHTML('beforeend', newProducts.map((product) => productResultMarkup(product, target)).join(''));
    }

    if (!results.querySelector('[data-product-id]')) {
      results.innerHTML = `<div class="product-empty">${escapeHtml(emptyMessage)}</div>`;
    } else {
      results.querySelector('.product-empty')?.remove();
      renderProductLoadStatus(target);
    }

    results._items = [...searchState.results];

    if (target === 'budget') {
      const hint = $('produto-search-hint');
      if (hint) hint.hidden = true;
      updateProductPickerLayoutUI();
    }
  }

  async function loadProductOptions(query = '', target = 'budget', { append = false } = {}) {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    const normalizedQuery = String(query || '').trim();

    if (append && (searchState.loading || !searchState.hasMore)) return;

    let version;
    let offset;

    if (append) {
      version = searchState.version;
      offset = searchState.offset;
      searchState.loading = true;
      renderProductLoadStatus(target);
    } else {
      version = ++searchState.version;
      offset = 0;
      searchState.query = normalizedQuery;
      searchState.offset = 0;
      searchState.hasMore = false;
      searchState.total = 0;
      searchState.results = [];
      searchState.loading = true;
      if (target === 'budget') {
        const hint = $('produto-search-hint');
        if (hint) hint.hidden = true;
      }
      results.innerHTML = '<div class="product-empty"><i class="fa-solid fa-spinner fa-spin"></i> Carregando produtos...</div>';
      if (target === 'budget') updateProductPickerLayoutUI();
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        ativo: 'true',
        limit: String(searchState.pageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_BUDGET_PRODUCTS}?${params.toString()}`);
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;

      const products = normalizeCollection(response);
      const knownIds = new Set(searchState.results.map((product) => String(product.id)));
      const uniqueProducts = products.filter((product) => !knownIds.has(String(product.id)));

      searchState.results = append
        ? [...searchState.results, ...uniqueProducts]
        : products;
      searchState.offset = offset + products.length;
      searchState.total = Number(response?.total ?? searchState.results.length) || searchState.results.length;
      searchState.hasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : products.length === searchState.pageSize;
      searchState.loading = false;

      renderProductResults(append ? uniqueProducts : searchState.results, {
        target,
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum produto encontrado para essa busca.'
          : 'Nenhum produto cadastrado.',
      });
    } catch (error) {
      if (version !== searchState.version || normalizedQuery !== searchState.query) return;
      searchState.loading = false;
      results.querySelector('[data-product-load-status]')?.remove();

      if (append && searchState.results.length) {
        results.insertAdjacentHTML('beforeend', `
          <div class="product-load-status product-load-error" data-product-load-status>
            ${escapeHtml(error.message)} • role novamente para tentar
          </div>`);
      } else {
        results.innerHTML = `<div class="product-empty">${escapeHtml(error.message)}</div>`;
      }
    }
  }

  function searchProducts(query, target = 'budget') {
    return loadProductOptions(query, target, { append: false });
  }

  function showProductOptions(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { input } = getProductSearchElements(target);
    const query = input.value.trim();

    if (searchState.query === query && (searchState.results.length || searchState.loading)) return;
    loadProductOptions(query, target, { append: false });
  }

  function loadMoreProductsOnScroll(target = 'budget') {
    const searchState = getProductSearchState(target);
    const { results } = getProductSearchElements(target);
    if (searchState.loading || !searchState.hasMore) return;

    const distanceFromBottom = results.scrollHeight - results.scrollTop - results.clientHeight;
    if (distanceFromBottom <= 56) {
      loadProductOptions(searchState.query, target, { append: true });
    }
  }

  function resetProductSearch(target = 'budget', { reload = false } = {}) {
    const searchState = getProductSearchState(target);
    const { input, results } = getProductSearchElements(target);
    input.value = '';
    searchState.version += 1;
    searchState.results = [];
    searchState.offset = 0;
    searchState.hasMore = false;
    searchState.loading = false;
    searchState.query = '';
    searchState.total = 0;
    results._items = [];
    results.innerHTML = '';
    if (reload) loadProductOptions('', target, { append: false });
  }

  function addProduct(id, target = 'budget') {
    const searchState = getProductSearchState(target);
    const product = searchState.results.find((item) => Number(item.id) === Number(id));
    if (!product) return;
    const item = normalizeItem({
      produto_id: product.id,
      origem: 'produto',
      codigo: product.codigo,
      descricao: product.nome,
      referencia: product.descricao || '',
      unidade: product.unidade || 'UN',
      quantidade: 1,
      valor_unitario: product.preco_venda,
      custo_unitario: product.custo ?? null,
      custo_informado: product.custo !== null && product.custo !== undefined && product.custo !== '',
    });
    if (target === 'template') {
      state.templateItems.push(item);
      renderTemplateItems();
      resetProductSearch('template', { reload: true });
    } else if (target === 'kit') {
      const existing = state.kitItems.find((current) => Number(current.produto_id) === Number(item.produto_id));
      if (existing) existing.quantidade = parseNumber(existing.quantidade) + 1;
      else state.kitItems.push(item);
      renderKitItems();
      resetProductSearch('kit', { reload: true });
    } else {
      state.items.push(item);
      renderItems();
      updateTotals();
      resetProductSearch('budget');
      renderBudgetProductSearchPrompt();
      $('produto-search-input')?.focus();
    }
  }

  function normalizedProductCode(value) {
    return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
  }

  async function productByExactCode(code) {
    const normalized = String(code ?? '').trim();
    if (!normalized) return null;
    const params = new URLSearchParams({ codigo_exato: normalized, limit: '1', offset: '0' });
    const response = await api(`${API_BUDGET_PRODUCTS}?${params.toString()}`);
    return normalizeCollection(response)[0] || null;
  }

  async function replaceBudgetItemByCode(input) {
    const row = input?.closest('tr[data-index]');
    const index = Number(row?.dataset.index);
    const item = state.items[index];
    if (!row || !item || input.dataset.codeResolving === '1') return;

    const requestedCode = String(input.value || '').trim();
    const originalCode = String(input.dataset.originalCode ?? item.codigo ?? '').trim();
    const originalProductId = Number(input.dataset.originalProductId || item.produto_id || 0) || null;

    if (!requestedCode) {
      input.value = originalCode;
      item.codigo = originalCode;
      toast('Informe um código de produto válido para fazer a troca.', 'error');
      return;
    }

    if (normalizedProductCode(requestedCode) === normalizedProductCode(originalCode)) {
      item.codigo = requestedCode;
      return;
    }

    input.dataset.codeResolving = '1';
    input.disabled = true;
    row.classList.add('is-resolving-product-code');

    try {
      const product = await productByExactCode(requestedCode);
      if (state.items[index] !== item) return;
      if (!product) {
        throw new Error(`Nenhum produto ativo foi encontrado com o código ${requestedCode}.`);
      }

      const quantity = item.quantidade;
      const discount = item.desconto;
      const observation = item.observacao;
      const budgetItemId = item.id;

      const replacement = normalizeItem({
        id: budgetItemId,
        produto_id: product.id,
        origem: 'produto',
        codigo: product.codigo,
        descricao: product.nome,
        referencia: product.descricao || '',
        unidade: product.unidade || 'UN',
        quantidade: quantity,
        valor_unitario: product.preco_venda,
        desconto: discount,
        custo_unitario: product.custo ?? null,
        custo_informado: product.custo !== null && product.custo !== undefined && product.custo !== '',
        observacao: observation,
        ordem: index,
      });

      state.items[index] = replacement;
      renderItems();
      updateTotals();
      toast(`Item ${index + 1} alterado para ${product.codigo || requestedCode} — ${product.nome || 'produto'}.`);
    } catch (error) {
      if (state.items[index] !== item) return;
      item.codigo = originalCode;
      item.produto_id = originalProductId;
      input.disabled = false;
      input.value = originalCode;
      row.classList.remove('is-resolving-product-code');
      input.dataset.codeResolving = '0';
      toast(error.message || 'Não foi possível trocar o produto pelo código informado.', 'error');
    }
  }

  function itemTotal(item) {
    return Math.max(item.quantidade * item.valor_unitario - item.desconto, 0);
  }

  function renderItems() {
    const tbody = $('budget-items-body');
    const empty = $('budget-items-empty');

    if (empty) empty.style.display = state.items.length ? 'none' : 'flex';

    tbody.innerHTML = state.items.map((item, index) => `
      <tr data-index="${index}" class="budget-item-row">
        <td class="budget-order-cell">
          <div class="budget-order-inline">
            <button
              class="budget-order-drag"
              type="button"
              draggable="true"
              data-drag-item="${index}"
              title="Arraste para alterar a ordem"
              aria-label="Mover item ${index + 1}"
            >
              <i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>
            </button>
            <span class="budget-order-index">${String(index + 1).padStart(2, '0')}</span>
          </div>
        </td>

        <td class="budget-item-description-cell">
          <textarea
            data-field="descricao"
            placeholder="Descrição do produto ou serviço"
            rows="2"
          >${escapeHtml(item.descricao)}</textarea>
        </td>

        <td class="budget-item-code-cell">
          <input
            class="budget-item-code-input"
            data-field="codigo"
            value="${escapeHtml(item.codigo)}"
            autocomplete="off"
            spellcheck="false"
            title="Altere o código e saia do campo para trocar este produto"
            aria-label="Código do item ${index + 1}"
          />
          <small class="budget-item-code-help">Digite outro código para trocar</small>
        </td>

        <td><input data-field="unidade" value="${escapeHtml(item.unidade)}" /></td>
        <td><input data-field="quantidade" value="${inputQuantity(item.quantidade)}" inputmode="decimal" /></td>
        <td><input data-field="valor_unitario" value="${inputMoney(item.valor_unitario)}" inputmode="decimal" /></td>
        <td><input data-field="desconto" value="${inputMoney(item.desconto)}" inputmode="decimal" /></td>
        <td class="item-total-cell">${formatMoney(itemTotal(item))}</td>
        <td class="cost-only ${canShowCosts() ? '' : 'is-hidden'}">
          <input
            data-field="custo_unitario"
            value="${item.custo_unitario === null ? '' : inputMoney(item.custo_unitario)}"
            inputmode="decimal"
            placeholder="Não informado"
          />
        </td>
        <td class="item-actions-cell">
          <button
            class="item-remove"
            type="button"
            data-remove-item="${index}"
            title="Remover item"
            aria-label="Remover item ${index + 1}"
          >
            <i class="fa-regular fa-trash-can" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`).join('');
  }

  let draggedBudgetItemIndex = null;
  let draggedBudgetDropAfter = false;

  function clearBudgetDragState() {
    $$('.budget-item-row', $('budget-items-body')).forEach((row) => {
      row.classList.remove('is-dragging', 'drag-over-before', 'drag-over-after');
    });
    draggedBudgetItemIndex = null;
    draggedBudgetDropAfter = false;
  }

  function startBudgetItemDrag(event) {
    const handle = event.target.closest('[data-drag-item]');
    if (!handle) return;

    const row = handle.closest('tr[data-index]');
    const index = Number(row?.dataset.index);
    if (!row || !Number.isInteger(index)) return;

    draggedBudgetItemIndex = index;
    row.classList.add('is-dragging');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  function overBudgetItemDrag(event) {
    if (!Number.isInteger(draggedBudgetItemIndex)) return;

    const row = event.target.closest('tr[data-index]');
    if (!row) return;

    const targetIndex = Number(row.dataset.index);
    if (!Number.isInteger(targetIndex) || targetIndex === draggedBudgetItemIndex) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';

    const rect = row.getBoundingClientRect();
    draggedBudgetDropAfter = event.clientY > rect.top + (rect.height / 2);

    $$('.budget-item-row', $('budget-items-body')).forEach((currentRow) => {
      currentRow.classList.remove('drag-over-before', 'drag-over-after');
    });

    row.classList.add(draggedBudgetDropAfter ? 'drag-over-after' : 'drag-over-before');
  }

  function dropBudgetItem(event) {
    if (!Number.isInteger(draggedBudgetItemIndex)) return false;

    const row = event.target.closest('tr[data-index]');
    if (!row) {
      clearBudgetDragState();
      return false;
    }

    event.preventDefault();

    const fromIndex = draggedBudgetItemIndex;
    const targetIndex = Number(row.dataset.index);
    if (!Number.isInteger(targetIndex)) {
      clearBudgetDragState();
      return false;
    }

    let insertIndex = targetIndex + (draggedBudgetDropAfter ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;

    if (insertIndex === fromIndex) {
      clearBudgetDragState();
      return false;
    }

    const [item] = state.items.splice(fromIndex, 1);
    state.items.splice(insertIndex, 0, item);
    state.items.forEach((currentItem, index) => { currentItem.ordem = index; });

    clearBudgetDragState();
    renderItems();
    updateTotals();
    return true;
  }

  function updateItemField(input) {
    const row = input.closest('tr');
    const item = state.items[Number(row.dataset.index)];
    if (!item) return;
    const field = input.dataset.field;
    if (field === 'custo_unitario') {
      item.custo_unitario = String(input.value || '').trim() === '' ? null : parseInputNumber(input.value);
      item.custo_informado = item.custo_unitario !== null;
    } else {
      item[field] = ['quantidade', 'valor_unitario', 'desconto'].includes(field) ? parseInputNumber(input.value) : input.value;
    }
    const totalCell = row.querySelector('.item-total-cell');
    if (totalCell) totalCell.textContent = formatMoney(itemTotal(item));
    updateTotals();
  }
