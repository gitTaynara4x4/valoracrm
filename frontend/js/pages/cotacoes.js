(() => {
  'use strict';

  const API_COTACOES = '/api/cotacoes';
  const API_FORNECEDORES = '/api/fornecedores';

  const state = {
    cotacoes: [],
    fornecedores: [],
    fornecedorRows: [],
    editandoId: null,
    page: { offset: 0, limit: 50, total: 0, hasMore: false },
    loading: false,
  };

  const STATUS_LABELS = {
    rascunho: 'Rascunho',
    em_cotacao: 'Em cotação',
    respondida: 'Respondida',
    em_analise: 'Em análise',
    aprovada: 'Aprovada',
    convertida: 'Convertida',
    recusada: 'Recusada',
    cancelada: 'Cancelada',
  };

  const URGENCIA_LABELS = {
    baixa: 'Baixa',
    media: 'Média',
    alta: 'Alta',
    critica: 'Crítica',
  };

  function $(id) {
    return document.getElementById(id);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function onlyDigits(value) {
    return String(value ?? '').replace(/\D+/g, '').trim();
  }

  function normalizeText(value) {
    return String(value || '').trim();
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    let text = String(value).replace(/R\$/gi, '').replace(/\s+/g, '').trim();
    if (!text) return 0;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }

  function formatNumber(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '0,00';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatMoney(value) {
    const n = parseNumber(value);
    if (!n) return '--';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function calcTotalRow(row) {
    const quantidade = parseNumber($('cotacao-quantidade')?.value || 1) || 1;
    const unit = parseNumber(row.valor_unitario);
    const frete = parseNumber(row.frete);
    return ((quantidade * unit) + frete).toFixed(2);
  }

  function statusBadge(status) {
    const key = String(status || 'rascunho').trim().toLowerCase();
    return `<span class="status-badge-cotacao ${escapeHtml(key)}">${escapeHtml(STATUS_LABELS[key] || key || 'Rascunho')}</span>`;
  }

  function urgenciaBadge(urgencia) {
    const key = String(urgencia || '').trim().toLowerCase();
    if (!key) return '';
    return `<span class="urgencia-badge ${escapeHtml(key)}">${escapeHtml(URGENCIA_LABELS[key] || key)}</span>`;
  }

  function toast(message, error = false, ms = 2800) {
    const el = $('valora-toast');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', !!error);
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async function apiJson(url, options = {}) {
    const resp = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (resp.status === 204) return null;

    const text = await resp.text();
    if (!resp.ok) {
      let message = text || 'Erro na requisição.';
      try {
        const parsed = JSON.parse(text);
        message = parsed.detail || parsed.message || message;
      } catch (_) {}
      throw new Error(typeof message === 'string' ? message : 'Erro na requisição.');
    }

    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  }

  function openModal() {
    if (window.ValoraModal) return window.ValoraModal.open('modal-cotacao-backdrop');
    const modal = $('modal-cotacao-backdrop');
    if (!modal) return;
    modal.hidden = false;
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('show'));
  }

  function closeModal() {
    if (window.ValoraModal) return window.ValoraModal.close('modal-cotacao-backdrop');
    const modal = $('modal-cotacao-backdrop');
    if (!modal) return;
    modal.classList.remove('show');
    setTimeout(() => { modal.hidden = true; modal.style.display = 'none'; }, 160);
  }

  function setLoadingTable() {
    const tbody = $('tbody-cotacoes');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Carregando cotações...</td></tr>';
  }

  function renderCotacoes() {
    const tbody = $('tbody-cotacoes');
    if (!tbody) return;

    if (!state.cotacoes.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhuma cotação encontrada.</td></tr>';
      return;
    }

    tbody.innerHTML = state.cotacoes.map((c) => {
      const fornecedor = c.fornecedor_vencedor_nome || '--';
      const qtd = [c.quantidade, c.unidade].filter(Boolean).join(' ') || '--';
      const urgencia = urgenciaBadge(c.urgencia);
      return `
        <tr>
          <td><strong>${escapeHtml(c.codigo || '')}</strong></td>
          <td>
            <strong>${escapeHtml(c.item_nome || '')}</strong>
            <span class="muted-line">${escapeHtml(c.categoria || '')}</span>
            ${urgencia ? `<div class="row-badges">${urgencia}</div>` : ''}
          </td>
          <td>${escapeHtml(qtd)}</td>
          <td>${statusBadge(c.status)}</td>
          <td>${escapeHtml(fornecedor)}</td>
          <td><strong>${formatMoney(c.valor_aprovado)}</strong></td>
          <td class="text-right">
            <div class="cotacao-actions">
              <button class="cotacao-icon-btn" type="button" data-action="edit" data-id="${c.id}" title="Abrir cotação">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button class="cotacao-icon-btn danger" type="button" data-action="delete" data-id="${c.id}" title="Excluir cotação">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPagination() {
    const el = $('paginacao-cotacoes');
    if (!el) return;

    const start = state.page.total ? state.page.offset + 1 : 0;
    const end = Math.min(state.page.offset + state.cotacoes.length, state.page.total);

    el.innerHTML = `
      <span class="counter-text">${start}-${end} de ${state.page.total}</span>
      <div class="pagination-actions">
        <button class="btn btn-secondary" type="button" id="btn-cotacoes-anterior" ${state.page.offset <= 0 ? 'disabled' : ''}>Anterior</button>
        <button class="btn btn-secondary" type="button" id="btn-cotacoes-proxima" ${!state.page.hasMore ? 'disabled' : ''}>Próxima</button>
      </div>
    `;

    $('btn-cotacoes-anterior')?.addEventListener('click', () => {
      state.page.offset = Math.max(0, state.page.offset - state.page.limit);
      carregarCotacoes();
    });

    $('btn-cotacoes-proxima')?.addEventListener('click', () => {
      if (!state.page.hasMore) return;
      state.page.offset += state.page.limit;
      carregarCotacoes();
    });
  }

  async function carregarCotacoes({ reset = false } = {}) {
    if (state.loading) return;
    state.loading = true;

    if (reset) state.page.offset = 0;
    setLoadingTable();

    try {
      const busca = normalizeText($('busca-cotacoes')?.value);
      const status = normalizeText($('filtro-status-cotacoes')?.value);
      const params = new URLSearchParams({
        paginated: 'true',
        limit: String(state.page.limit),
        offset: String(state.page.offset),
      });
      if (busca) params.set('busca', busca);
      if (status) params.set('status', status);

      const data = await apiJson(`${API_COTACOES}?${params.toString()}`);
      state.cotacoes = Array.isArray(data?.items) ? data.items : [];
      state.page.total = Number(data?.total || state.cotacoes.length || 0);
      state.page.hasMore = !!data?.has_more;

      const counter = $('contagem-cotacoes');
      if (counter) counter.textContent = `${state.page.total} cotação${state.page.total === 1 ? '' : 'es'}`;

      renderCotacoes();
      renderPagination();
    } catch (err) {
      console.error(err);
      const tbody = $('tbody-cotacoes');
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${escapeHtml(err.message || 'Erro ao carregar cotações.')}</td></tr>`;
      toast(err.message || 'Erro ao carregar cotações.', true);
    } finally {
      state.loading = false;
    }
  }

  async function carregarFornecedores() {
    try {
      const data = await apiJson(`${API_FORNECEDORES}?paginated=true&limit=200&offset=0`);
      state.fornecedores = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      renderFornecedorSelects();
    } catch (err) {
      console.warn('Não foi possível carregar fornecedores:', err);
      state.fornecedores = [];
      renderFornecedorSelects();
    }
  }

  function fornecedorOptions(selectedId = '') {
    return ['<option value="">Fornecedor livre</option>'].concat(
      state.fornecedores.map((f) => `
        <option value="${escapeHtml(f.id)}" ${String(selectedId || '') === String(f.id) ? 'selected' : ''}>
          ${escapeHtml(f.nome || f.nome_fantasia || `Fornecedor #${f.id}`)}
        </option>
      `)
    ).join('');
  }

  function renderFornecedorSelects() {
    const select = $('cotacao-fornecedor-id');
    if (select) select.innerHTML = ['<option value="">Selecione ou digite o nome ao lado</option>'].concat(
      state.fornecedores.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.nome || f.nome_fantasia || `Fornecedor #${f.id}`)}</option>`)
    ).join('');

    renderFornecedorRows();
  }

  function limparFornecedorInputs() {
    ['cotacao-fornecedor-id', 'cotacao-fornecedor-nome', 'cotacao-valor-unitario', 'cotacao-frete', 'cotacao-prazo', 'cotacao-condicao', 'cotacao-fornecedor-observacoes']
      .forEach((id) => {
        const el = $(id);
        if (!el) return;
        el.value = '';
      });
  }

  function addFornecedorFromInputs() {
    const fornecedorId = normalizeText($('cotacao-fornecedor-id')?.value);
    const fornecedorNome = normalizeText($('cotacao-fornecedor-nome')?.value);
    const fornecedorSelecionado = state.fornecedores.find((f) => String(f.id) === String(fornecedorId));

    if (!fornecedorId && !fornecedorNome) {
      toast('Informe um fornecedor para adicionar na cotação.', true);
      return;
    }

    const row = {
      _tempId: `tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      fornecedor_id: fornecedorId || null,
      fornecedor_nome: fornecedorNome || fornecedorSelecionado?.nome || '',
      valor_unitario: normalizeText($('cotacao-valor-unitario')?.value),
      frete: normalizeText($('cotacao-frete')?.value),
      prazo_entrega: normalizeText($('cotacao-prazo')?.value),
      condicao_pagamento: normalizeText($('cotacao-condicao')?.value),
      observacoes: normalizeText($('cotacao-fornecedor-observacoes')?.value),
      vencedor: !state.fornecedorRows.length,
    };
    row.valor_total = calcTotalRow(row);

    state.fornecedorRows.push(row);
    limparFornecedorInputs();
    renderFornecedorRows();
  }

  function collectFornecedorRowsFromDOM() {
    const rows = $$('#tbody-cotacao-fornecedores tr[data-row-key]');
    return rows.map((tr) => {
      const row = {
        id: tr.dataset.id ? Number(tr.dataset.id) : null,
        _tempId: tr.dataset.tempId || null,
        fornecedor_id: normalizeText(tr.querySelector('[data-field="fornecedor_id"]')?.value) || null,
        fornecedor_nome: normalizeText(tr.querySelector('[data-field="fornecedor_nome"]')?.value),
        valor_unitario: normalizeText(tr.querySelector('[data-field="valor_unitario"]')?.value),
        frete: normalizeText(tr.querySelector('[data-field="frete"]')?.value),
        prazo_entrega: normalizeText(tr.querySelector('[data-field="prazo_entrega"]')?.value),
        condicao_pagamento: normalizeText(tr.querySelector('[data-field="condicao_pagamento"]')?.value),
        observacoes: normalizeText(tr.querySelector('[data-field="observacoes"]')?.value),
        vencedor: !!tr.querySelector('[data-field="vencedor"]')?.checked,
      };
      row.valor_total = calcTotalRow(row);
      return row;
    });
  }

  function setFornecedorRowsFromDOM() {
    state.fornecedorRows = collectFornecedorRowsFromDOM();
  }

  function renderComparativo() {
    const box = $('cotacao-comparativo');
    const menorTotalEl = $('cotacao-menor-total');
    const fornecedorEl = $('cotacao-fornecedor-indicado');
    if (!box || !menorTotalEl || !fornecedorEl) return;

    if (!state.fornecedorRows.length) {
      box.hidden = true;
      return;
    }

    const rowsComTotal = state.fornecedorRows
      .map((row) => ({ ...row, totalNumber: parseNumber(row.valor_total || calcTotalRow(row)) }))
      .filter((row) => row.totalNumber > 0);

    if (!rowsComTotal.length) {
      box.hidden = true;
      return;
    }

    rowsComTotal.sort((a, b) => a.totalNumber - b.totalNumber);
    const menor = rowsComTotal[0];
    box.hidden = false;
    menorTotalEl.textContent = menor.totalNumber.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    fornecedorEl.textContent = menor.fornecedor_nome || nomeFornecedorById(menor.fornecedor_id) || '--';
  }

  function nomeFornecedorById(id) {
    if (!id) return '';
    const f = state.fornecedores.find((item) => String(item.id) === String(id));
    return f?.nome || f?.nome_fantasia || '';
  }

  function renderFornecedorRows() {
    const tbody = $('tbody-cotacao-fornecedores');
    if (!tbody) return;

    if (!state.fornecedorRows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum fornecedor adicionado.</td></tr>';
      renderComparativo();
      return;
    }

    const totals = state.fornecedorRows.map((row) => parseNumber(row.valor_total || calcTotalRow(row))).filter((n) => n > 0);
    const menorTotal = totals.length ? Math.min(...totals) : null;

    tbody.innerHTML = state.fornecedorRows.map((row, index) => {
      const key = row.id ? `id_${row.id}` : (row._tempId || `tmp_${index}`);
      const total = row.valor_total || calcTotalRow(row);
      const isBest = menorTotal !== null && parseNumber(total) === menorTotal;
      const isWinner = !!row.vencedor;
      return `
        <tr data-row-key="${escapeHtml(key)}" data-id="${row.id || ''}" data-temp-id="${escapeHtml(row._tempId || '')}" class="${isWinner ? 'cotacao-row-vencedor' : ''}">
          <td>
            <input class="fornecedor-vencedor-radio" type="radio" name="cotacao-vencedor" data-field="vencedor" ${isWinner ? 'checked' : ''} />
          </td>
          <td>
            <select data-field="fornecedor_id">${fornecedorOptions(row.fornecedor_id)}</select>
            <input data-field="fornecedor_nome" type="text" value="${escapeHtml(row.fornecedor_nome || '')}" placeholder="Nome livre" />
          </td>
          <td><input data-field="valor_unitario" type="text" inputmode="decimal" value="${escapeHtml(row.valor_unitario || '')}" placeholder="0,00" /></td>
          <td><input data-field="frete" type="text" inputmode="decimal" value="${escapeHtml(row.frete || '')}" placeholder="0,00" /></td>
          <td>
            <strong>${formatMoney(total)}</strong>
            ${isBest ? '<div><span class="cotacao-best-badge"><i class="fa-solid fa-arrow-trend-down"></i> Menor total</span></div>' : ''}
          </td>
          <td><input data-field="prazo_entrega" type="text" value="${escapeHtml(row.prazo_entrega || '')}" placeholder="Prazo" /></td>
          <td><input data-field="condicao_pagamento" type="text" value="${escapeHtml(row.condicao_pagamento || '')}" placeholder="Pagamento" /></td>
          <td class="text-right">
            <button class="cotacao-icon-btn danger" type="button" data-remove-row="${escapeHtml(key)}" title="Remover fornecedor">
              <i class="fa-solid fa-trash"></i>
            </button>
            <input data-field="observacoes" type="hidden" value="${escapeHtml(row.observacoes || '')}" />
          </td>
        </tr>
      `;
    }).join('');

    renderComparativo();

    if (window.ValoraLongFields?.refresh) {
      window.ValoraLongFields.refresh(tbody);
    }
  }

  function limparForm() {
    state.editandoId = null;
    state.fornecedorRows = [];
    const form = $('formCotacao');
    form?.reset();
    $('cotacao-codigo').value = '';
    $('cotacao-status').value = 'rascunho';
    $('cotacao-quantidade').value = '1';
    $('modal-cotacao-titulo').textContent = 'Nova cotação';
    $('btn-aprovar-cotacao').hidden = true;
    $('btn-converter-cotacao-produto').hidden = true;
    renderFornecedorRows();
    window.ValoraRequired?.refresh?.(document);
  }

  async function novaCotacao() {
    limparForm();
    await carregarFornecedores();
    openModal();
  }

  async function abrirCotacao(id) {
    limparForm();
    openModal();
    $('modal-cotacao-titulo').textContent = 'Carregando cotação...';

    try {
      await carregarFornecedores();
      const data = await apiJson(`${API_COTACOES}/${id}`);
      state.editandoId = Number(data.id);
      $('modal-cotacao-titulo').textContent = `Cotação ${data.codigo || ''}`;
      $('cotacao-codigo').value = onlyDigits(data.codigo || '');
      $('cotacao-status').value = data.status || 'rascunho';
      $('cotacao-urgencia').value = data.urgencia || '';
      $('cotacao-item-nome').value = data.item_nome || '';
      $('cotacao-quantidade').value = data.quantidade || '1';
      $('cotacao-unidade').value = data.unidade || '';
      $('cotacao-categoria').value = data.categoria || '';
      $('cotacao-descricao').value = data.descricao || '';
      $('cotacao-observacoes').value = data.observacoes || '';
      state.fornecedorRows = Array.isArray(data.fornecedores) ? data.fornecedores.map((row) => ({ ...row })) : [];
      renderFornecedorRows();
      $('btn-aprovar-cotacao').hidden = !state.editandoId || data.status === 'convertida';
      $('btn-converter-cotacao-produto').hidden = !state.editandoId || data.status === 'convertida';
      window.ValoraRequired?.refresh?.(document);
      window.ValoraCamposLongos?.enhance?.(document);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao abrir cotação.', true);
      closeModal();
    }
  }

  function payloadCotacao() {
    return {
      codigo: onlyDigits($('cotacao-codigo')?.value),
      status: $('cotacao-status')?.value || 'rascunho',
      urgencia: $('cotacao-urgencia')?.value || null,
      item_nome: normalizeText($('cotacao-item-nome')?.value),
      quantidade: normalizeText($('cotacao-quantidade')?.value),
      unidade: normalizeText($('cotacao-unidade')?.value),
      categoria: normalizeText($('cotacao-categoria')?.value),
      descricao: normalizeText($('cotacao-descricao')?.value),
      observacoes: normalizeText($('cotacao-observacoes')?.value),
    };
  }

  async function syncFornecedores(cotacaoId) {
    setFornecedorRowsFromDOM();

    let winnerId = null;

    for (const row of state.fornecedorRows) {
      const payload = {
        fornecedor_id: row.fornecedor_id ? Number(row.fornecedor_id) : null,
        fornecedor_nome: row.fornecedor_nome || nomeFornecedorById(row.fornecedor_id) || null,
        valor_unitario: row.valor_unitario || null,
        frete: row.frete || null,
        valor_total: row.valor_total || null,
        prazo_entrega: row.prazo_entrega || null,
        condicao_pagamento: row.condicao_pagamento || null,
        observacoes: row.observacoes || null,
        vencedor: !!row.vencedor,
      };

      if (!payload.fornecedor_id && !payload.fornecedor_nome) continue;

      let saved;
      if (row.id) {
        saved = await apiJson(`${API_COTACOES}/${cotacaoId}/fornecedores/${row.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        saved = await apiJson(`${API_COTACOES}/${cotacaoId}/fornecedores`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      if (row.vencedor && saved?.id) winnerId = saved.id;
    }

    if (winnerId) {
      await apiJson(`${API_COTACOES}/${cotacaoId}/fornecedores/${winnerId}/vencedor`, { method: 'POST' });
    }
  }

  async function salvarCotacao() {
    const form = $('formCotacao');
    if (window.ValoraRequired?.validateContainer && form) {
      const result = window.ValoraRequired.validateContainer(form);
      if (!result.ok) return;
    }

    const payload = payloadCotacao();
    if (!payload.item_nome) {
      toast('Informe o item desejado.', true);
      return;
    }

    try {
      const saved = state.editandoId
        ? await apiJson(`${API_COTACOES}/${state.editandoId}`, { method: 'PUT', body: JSON.stringify(payload) })
        : await apiJson(API_COTACOES, { method: 'POST', body: JSON.stringify(payload) });

      state.editandoId = Number(saved.id);
      await syncFornecedores(state.editandoId);

      toast('Cotação salva com sucesso.');
      closeModal();
      await carregarCotacoes({ reset: !state.editandoId });
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar cotação.', true);
    }
  }

  async function excluirCotacao(id) {
    if (!confirm('Excluir esta cotação?')) return;

    try {
      await apiJson(`${API_COTACOES}/${id}`, { method: 'DELETE' });
      toast('Cotação excluída.');
      await carregarCotacoes();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir cotação.', true);
    }
  }

  async function removerFornecedorRow(key) {
    const tr = $$('#tbody-cotacao-fornecedores tr[data-row-key]').find((rowEl) => rowEl.dataset.rowKey === key);
    if (!tr) return;
    const id = tr.dataset.id;

    if (id && state.editandoId) {
      if (!confirm('Remover este fornecedor da cotação?')) return;
      try {
        await apiJson(`${API_COTACOES}/${state.editandoId}/fornecedores/${id}`, { method: 'DELETE' });
      } catch (err) {
        toast(err.message || 'Erro ao remover fornecedor.', true);
        return;
      }
    }

    setFornecedorRowsFromDOM();
    state.fornecedorRows = state.fornecedorRows.filter((row) => {
      const rowKey = row.id ? `id_${row.id}` : row._tempId;
      return rowKey !== key;
    });
    if (state.fornecedorRows.length && !state.fornecedorRows.some((row) => row.vencedor)) {
      state.fornecedorRows[0].vencedor = true;
    }
    renderFornecedorRows();
  }

  async function aprovarCotacao() {
    if (!state.editandoId) return;

    try {
      await salvarCotacaoSemFechar();
      const data = await apiJson(`${API_COTACOES}/${state.editandoId}/aprovar`, { method: 'POST' });
      toast('Cotação aprovada.');
      await abrirCotacao(data.id);
      await carregarCotacoes();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao aprovar cotação.', true);
    }
  }

  async function salvarCotacaoSemFechar() {
    const payload = payloadCotacao();
    const saved = state.editandoId
      ? await apiJson(`${API_COTACOES}/${state.editandoId}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await apiJson(API_COTACOES, { method: 'POST', body: JSON.stringify(payload) });
    state.editandoId = Number(saved.id);
    await syncFornecedores(state.editandoId);
    return saved;
  }

  async function converterCotacaoProduto() {
    if (!state.editandoId) return;
    if (!confirm('Converter esta cotação em produto?')) return;

    try {
      await salvarCotacaoSemFechar();
      const data = await apiJson(`${API_COTACOES}/${state.editandoId}/converter-produto`, { method: 'POST' });
      toast(data?.message || 'Cotação convertida em produto.');
      closeModal();
      await carregarCotacoes();
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao converter em produto.', true);
    }
  }

  function debounce(fn, wait = 350) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function bindEvents() {
    $('btn-nova-cotacao')?.addEventListener('click', novaCotacao);
    $('btn-atualizar-cotacoes')?.addEventListener('click', () => carregarCotacoes({ reset: true }));
    $('btn-fechar-modal-cotacao')?.addEventListener('click', closeModal);
    $('btn-cancelar-cotacao')?.addEventListener('click', closeModal);
    $('btn-salvar-cotacao')?.addEventListener('click', salvarCotacao);
    $('btn-adicionar-fornecedor-cotacao')?.addEventListener('click', addFornecedorFromInputs);
    $('btn-aprovar-cotacao')?.addEventListener('click', aprovarCotacao);
    $('btn-converter-cotacao-produto')?.addEventListener('click', converterCotacaoProduto);

    $('busca-cotacoes')?.addEventListener('input', debounce(() => carregarCotacoes({ reset: true }), 350));
    $('filtro-status-cotacoes')?.addEventListener('change', () => carregarCotacoes({ reset: true }));
    $('cotacao-quantidade')?.addEventListener('input', () => {
      setFornecedorRowsFromDOM();
      state.fornecedorRows = state.fornecedorRows.map((row) => ({ ...row, valor_total: calcTotalRow(row) }));
      renderFornecedorRows();
    });

    document.addEventListener('click', (event) => {
      const actionBtn = event.target.closest('[data-action][data-id]');
      if (actionBtn) {
        const id = Number(actionBtn.dataset.id);
        const action = actionBtn.dataset.action;
        if (action === 'edit') abrirCotacao(id);
        if (action === 'delete') excluirCotacao(id);
        return;
      }

      const removeBtn = event.target.closest('[data-remove-row]');
      if (removeBtn) {
        removerFornecedorRow(removeBtn.dataset.removeRow);
      }
    });

    document.addEventListener('input', (event) => {
      if (!event.target.closest('#tbody-cotacao-fornecedores')) return;
      setFornecedorRowsFromDOM();
      state.fornecedorRows = state.fornecedorRows.map((row) => ({ ...row, valor_total: calcTotalRow(row) }));
      renderComparativo();
    });

    document.addEventListener('change', (event) => {
      if (!event.target.closest('#tbody-cotacao-fornecedores')) return;
      setFornecedorRowsFromDOM();
      if (event.target.matches('[data-field="vencedor"]')) {
        const tr = event.target.closest('tr[data-row-key]');
        const key = tr?.dataset.rowKey;
        state.fornecedorRows = state.fornecedorRows.map((row) => {
          const rowKey = row.id ? `id_${row.id}` : row._tempId;
          return { ...row, vencedor: rowKey === key };
        });
        renderFornecedorRows();
      } else {
        renderComparativo();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    bindEvents();
    await Promise.all([carregarFornecedores(), carregarCotacoes({ reset: true })]);
  });
})();
