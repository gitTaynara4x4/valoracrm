(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  if (!$('[data-financeiro-vendas-page]')) return;

  const state = { items: [], current: null, opcoes: {} };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));

  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateBR = (value) => {
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(value);
  };
  const dateTimeBR = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? dateBR(value) : parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };

  function notify(message, type = 'success') {
    if (typeof window.showToast === 'function') window.showToast(message, type);
    else if (type === 'error') alert(message);
  }

  async function request(path, options = {}) {
    const config = { credentials: 'include', ...options };
    config.headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (config.body && !(config.body instanceof FormData)) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(config.body);
    }
    const response = await fetch(path, config);
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.detail || `${response.status} ${response.statusText}`);
    return data;
  }

  function option(label, value) {
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }

  function statusBadge(status) {
    const labels = { pendente: 'Pendente', devolvido: 'Devolvida', autenticado: 'Autenticada', cancelado: 'Cancelada' };
    const classes = { pendente: 'warn', devolvido: 'danger', autenticado: 'ok', cancelado: 'danger' };
    const key = String(status || 'pendente').toLowerCase();
    return `<span class="financeiro-pill ${classes[key] || 'blue'}">${labels[key] || escapeHtml(key)}</span>`;
  }

  function setLoading(button, loading, text = 'Processando...') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(text)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }

  function setStatus(text) {
    const node = $('#vendas-status-text');
    if (node) node.textContent = text;
  }

  function qs(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value).trim() !== '') query.set(key, value);
    });
    return query.toString() ? `?${query.toString()}` : '';
  }

  function populateOptions() {
    const ops = state.opcoes || {};
    const clients = $('#vendas-filtro-cliente');
    if (clients) clients.innerHTML = '<option value="">Todos os clientes</option>' + (ops.clientes || []).map((item) => option(`${item.codigo || ''} - ${item.nome}`, item.id)).join('');

    const definitions = {
      'formas-cobranca': [(ops.formas_cobranca || []), (item) => item.nome],
      formas: [(ops.formas_pagamento || []), (item) => item.nome],
      contas: [(ops.contas_bancos || []), (item) => item.nome],
      categorias: [(ops.categorias || []).filter((item) => ['receita', 'ambos'].includes(item.tipo)), (item) => `${item.nome} (${item.tipo})`],
      'contas-contabeis': [(ops.contas_contabeis || []).filter((item) => item.aceita_lancamento !== false), (item) => `${item.codigo} - ${item.nome}`],
      'tipos-documento': [(ops.tipos_documento || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => item.nome],
      'naturezas-operacao': [(ops.naturezas_operacao || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => `${item.codigo ? `${item.codigo} - ` : ''}${item.nome}`],
      'centros-custo': [(ops.centros_custo || []), (item) => `${item.codigo ? `${item.codigo} - ` : ''}${item.nome}`],
      'unidades-consumo': [(ops.unidades_consumo || []), (item) => `${item.codigo ? `${item.codigo} - ` : ''}${item.nome}`],
      'regras-encargos': [(ops.regras_encargos || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => `${item.nome}${item.padrao ? ' (padrão)' : ''}`],
    };
    Object.entries(definitions).forEach(([name, [items, labelFn]]) => {
      $$(`[data-venda-select="${name}"]`).forEach((select) => {
        const current = select.value;
        select.innerHTML = '<option value="">Selecione...</option>' + items.map((item) => option(labelFn(item), item.id)).join('');
        if (items.some((item) => String(item.id) === String(current))) select.value = current;
      });
    });
  }

  function renderTable() {
    const tbody = $('#tbody-vendas-financeiro');
    if (!tbody) return;
    if (!state.items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="financeiro-empty">Nenhuma venda encontrada.</td></tr>';
      return;
    }
    tbody.innerHTML = state.items.map((item) => `
      <tr>
        <td><div class="financeiro-lancamento-cell"><span class="financeiro-lancamento-icon blue"><i class="fa-solid fa-cart-shopping"></i></span><div><strong>${escapeHtml(item.orcamento_codigo)}</strong><small>${escapeHtml(item.orcamento_titulo)}</small></div></div></td>
        <td><strong>${escapeHtml(item.cliente_nome)}</strong><small>${escapeHtml(item.cliente_documento || '')}</small></td>
        <td>${dateBR(item.data_venda)}<small>Enviado ${dateTimeBR(item.enviado_em)}</small></td>
        <td>${escapeHtml(item.consultor_nome || '—')}</td>
        <td class="financeiro-amount"><strong>${money(item.valor_total)}</strong></td>
        <td>${statusBadge(item.status)}${item.motivo_devolucao ? `<small title="${escapeHtml(item.motivo_devolucao)}">${escapeHtml(item.motivo_devolucao)}</small>` : ''}</td>
        <td><div class="actions-cell"><button class="financeiro-mini-btn ${item.status === 'pendente' ? 'ok' : ''}" type="button" data-venda-id="${item.id}"><i class="fa-solid ${item.status === 'pendente' ? 'fa-file-circle-check' : 'fa-eye'}"></i> ${item.status === 'pendente' ? 'Conferir' : 'Visualizar'}</button><a class="financeiro-mini-btn" href="/orcamentos?orcamento_id=${item.orcamento_id}"><i class="fa-regular fa-file-lines"></i> Orçamento</a></div></td>
      </tr>`).join('');
  }

  function updateKpis(summary = {}) {
    const set = (key, value) => { const node = $(`[data-kpi-venda="${key}"]`); if (node) node.textContent = value; };
    set('pendentes', String(Number(summary.pendentes || 0)));
    set('valor-pendente', money(summary.valor_pendente || 0));
    set('autenticadas', String(Number(summary.autenticadas || 0)));
    set('valor-autenticado', money(summary.valor_autenticado || 0));
    set('devolvidas', String(Number(summary.devolvidas || 0)));
  }

  async function loadData({ openFromUrl = false } = {}) {
    setStatus('Carregando vendas...');
    const budgetIdFromUrl = Number(new URLSearchParams(window.location.search).get('orcamento_id') || 0);
    const filters = {
      status: openFromUrl && budgetIdFromUrl ? '' : ($('#vendas-filtro-status')?.value || ''),
      busca: $('#vendas-filtro-busca')?.value || '',
      cliente_id: $('#vendas-filtro-cliente')?.value || '',
      limit: 300,
    };
    try {
      const [options, result] = await Promise.all([
        request('/api/financeiro/opcoes'),
        request(`/api/financeiro/vendas-pendentes${qs(filters)}`),
      ]);
      state.opcoes = options || {};
      state.items = result.items || [];
      populateOptions();
      renderTable();
      updateKpis(result.resumo || {});
      setStatus(`${result.total || 0} venda(s) no resultado.`);
      if (openFromUrl && budgetIdFromUrl) {
        const found = state.items.find((item) => Number(item.orcamento_id) === budgetIdFromUrl);
        if (found) await openSale(found.id);
        else notify('A venda vinculada a este orçamento não foi encontrada no Financeiro.', 'error');
      }
    } catch (error) {
      console.error('[vendas-financeiro]', error);
      setStatus('Erro ao carregar.');
      notify(`Erro ao carregar vendas: ${error.message}`, 'error');
    }
  }

  function openModal() {
    const modal = $('#modal-venda-financeiro');
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('financeiro-modal-open');
  }

  function closeModal() {
    const modal = $('#modal-venda-financeiro');
    modal?.classList.remove('is-open');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('financeiro-modal-open');
    state.current = null;
  }

  function renderSaleDetail(sale) {
    $('#venda-modal-titulo').textContent = `${sale.orcamento_codigo} — ${sale.cliente_nome}`;
    $('#venda-modal-subtitulo').textContent = sale.status === 'pendente'
      ? 'Confira a venda e defina como os títulos serão gerados.'
      : `Venda ${sale.status}. Este registro permanece disponível para auditoria.`;
    $('#venda-resumo').innerHTML = `
      <div><span>Cliente</span><strong>${escapeHtml(sale.cliente_nome)}</strong><small>${escapeHtml(sale.cliente_documento || '')}</small></div>
      <div><span>Venda</span><strong>${escapeHtml(sale.orcamento_codigo)}</strong><small>${dateBR(sale.data_venda)}</small></div>
      <div><span>Consultor</span><strong>${escapeHtml(sale.consultor_nome || '—')}</strong><small>${escapeHtml(sale.enviado_por_nome || '')}</small></div>
      <div><span>Valor total</span><strong>${money(sale.valor_total)}</strong><small>${statusBadge(sale.status)}</small></div>`;

    const items = sale.itens_json || [];
    $('#venda-itens').innerHTML = items.map((item) => `
      <article><div><strong>${escapeHtml(item.descricao || 'Item')}</strong><small>${escapeHtml(item.codigo || '')}</small></div><span>${Number(item.quantidade || 0).toLocaleString('pt-BR')} × ${money(item.valor_unitario)}</span><strong>${money(item.valor_total)}</strong></article>`).join('') || '<div class="financeiro-empty-soft">Nenhum item no snapshot.</div>';

    const payments = sale.pagamentos_json || [];
    const conditionSelect = $('#form-autenticar-venda [name="condicao_pagamento_indice"]');
    conditionSelect.innerHTML = '<option value="">Selecionar durante a conferência</option>' + payments.map((item, index) => option(`${item.nome || `Opção ${index + 1}`} — ${item.parcelas || 1} parcela(s) — ${money(item.total || sale.valor_total)}`, index)).join('');
    const selectedIndex = payments.findIndex((item) => Boolean(item.selecionada));
    if (selectedIndex >= 0) conditionSelect.value = String(selectedIndex);
    else if (payments.length === 1) conditionSelect.value = '0';

    $('#venda-condicoes').innerHTML = payments.map((item, index) => `
      <article class="${item.selecionada ? 'is-selected' : ''}"><div><strong>${escapeHtml(item.nome || `Opção ${index + 1}`)}</strong><small>${Number(item.parcelas || 1)} parcela(s)${Number(item.entrada_valor || 0) > 0 ? ` • entrada ${money(item.entrada_valor)}` : ''}</small></div><span>${money(item.total || sale.valor_total)}</span></article>`).join('') || '<div class="financeiro-empty-soft">Nenhuma condição estruturada no orçamento.</div>';

    const form = $('#form-autenticar-venda');
    form.reset();
    form.elements.venda_id.value = sale.id;
    conditionSelect.innerHTML = '<option value="">Selecionar durante a conferência</option>' + payments.map((item, index) => option(`${item.nome || `Opção ${index + 1}`} — ${item.parcelas || 1} parcela(s) — ${money(item.total || sale.valor_total)}`, index)).join('');
    if (selectedIndex >= 0) conditionSelect.value = String(selectedIndex);
    else if (payments.length === 1) conditionSelect.value = '0';
    const preferred = selectedIndex >= 0 ? payments[selectedIndex] : payments.length === 1 ? payments[0] : null;
    form.elements.parcelas.value = Math.max(1, Number(preferred?.parcelas || 1));
    const defaultRule = (state.opcoes.regras_encargos || []).find((item) => item.padrao && ['receber', 'ambos'].includes(item.aplicacao || 'ambos'));
    if (defaultRule) form.elements.regra_encargos_id.value = String(defaultRule.id);
    populateOptions();
    if (defaultRule) form.elements.regra_encargos_id.value = String(defaultRule.id);

    const editable = sale.status === 'pendente';
    $$('input,select,textarea', form).forEach((field) => { if (field.name !== 'venda_id') field.disabled = !editable; });
    $('#btn-autenticar-venda').hidden = !editable;
    $('#btn-devolver-venda').hidden = !editable;
    $('#btn-cancelar-autenticacao-venda').hidden = sale.status !== 'autenticado';
    if (!editable && sale.lancamentos_gerados?.length) {
      $('#venda-condicoes').insertAdjacentHTML('beforeend', `<div class="financeiro-venda-generated"><strong>Títulos gerados</strong><span>${sale.lancamentos_gerados.map((id) => `#${id}`).join(', ')}</span><a href="/contas-receber">Abrir Contas a Receber</a></div>`);
    }
    if (sale.motivo_devolucao) {
      $('#venda-condicoes').insertAdjacentHTML('beforeend', `<div class="financeiro-alert danger"><strong>Motivo da devolução:</strong> ${escapeHtml(sale.motivo_devolucao)}</div>`);
    }
  }

  async function openSale(id) {
    try {
      const sale = await request(`/api/financeiro/vendas-pendentes/${id}`);
      state.current = sale;
      renderSaleDetail(sale);
      openModal();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function selectedConditionChanged() {
    const select = $('#form-autenticar-venda [name="condicao_pagamento_indice"]');
    const index = select.value === '' ? -1 : Number(select.value);
    const payment = state.current?.pagamentos_json?.[index];
    if (payment?.parcelas) $('#form-autenticar-venda [name="parcelas"]').value = Math.max(1, Number(payment.parcelas));
  }

  async function authenticateSale(event) {
    event.preventDefault();
    if (!state.current || state.current.status !== 'pendente') return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const nullable = (value) => value === '' ? null : Number(value);
    const payload = {
      data_primeiro_vencimento: data.data_primeiro_vencimento,
      parcelas: Number(data.parcelas || 1),
      intervalo_meses: Number(data.intervalo_meses || 1),
      condicao_pagamento_indice: nullable(data.condicao_pagamento_indice),
      forma_cobranca_id: Number(data.forma_cobranca_id),
      forma_pagamento_id: nullable(data.forma_pagamento_id),
      conta_banco_id: Number(data.conta_banco_id),
      categoria_id: Number(data.categoria_id),
      conta_contabil_id: Number(data.conta_contabil_id),
      tipo_documento_id: nullable(data.tipo_documento_id),
      natureza_operacao_id: nullable(data.natureza_operacao_id),
      centro_custo_principal_id: nullable(data.centro_custo_principal_id),
      unidade_consumo_principal_id: nullable(data.unidade_consumo_principal_id),
      regra_encargos_id: nullable(data.regra_encargos_id),
      observacoes: String(data.observacoes || '').trim() || null,
    };
    if (!payload.data_primeiro_vencimento || !payload.forma_cobranca_id || !payload.conta_banco_id || !payload.categoria_id || !payload.conta_contabil_id) {
      notify('Preencha primeiro vencimento, forma de cobrança, conta, categoria e conta contábil.', 'error');
      return;
    }
    if (!confirm(`Gerar ${payload.parcelas} título(s) a receber no total de ${money(state.current.valor_total)}?\n\nEsta ação não poderá ser repetida.`)) return;
    const button = $('#btn-autenticar-venda');
    try {
      setLoading(button, true, 'Gerando títulos...');
      const result = await request(`/api/financeiro/vendas-pendentes/${state.current.id}/autenticar`, { method: 'POST', body: payload });
      notify(`${result.quantidade} título(s) gerado(s) com sucesso.`);
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function returnSale() {
    if (!state.current || state.current.status !== 'pendente') return;
    const reason = prompt('Informe claramente o que o Comercial precisa corrigir:');
    if (!reason?.trim()) return;
    const button = $('#btn-devolver-venda');
    try {
      setLoading(button, true, 'Devolvendo...');
      await request(`/api/financeiro/vendas-pendentes/${state.current.id}/devolver`, { method: 'POST', body: { motivo: reason.trim() } });
      notify('Venda devolvida ao Comercial com o motivo registrado.');
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function cancelAuthentication() {
    if (!state.current || state.current.status !== 'autenticado') return;
    const reason = prompt('Informe o motivo para cancelar todos os títulos e devolver a venda ao Comercial:');
    if (!reason?.trim()) return;
    if (!confirm('Todos os títulos desta venda serão cancelados. A operação só será permitida se não houver recebimentos em aberto. Continuar?')) return;
    const button = $('#btn-cancelar-autenticacao-venda');
    try {
      setLoading(button, true, 'Cancelando títulos...');
      await request(`/api/financeiro/vendas-pendentes/${state.current.id}/cancelar-autenticacao`, {
        method: 'POST',
        body: { motivo: reason.trim() },
      });
      notify('Títulos cancelados e venda devolvida ao Comercial.');
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  function bind() {
    $('#btn-atualizar-vendas')?.addEventListener('click', () => loadData());
    $('#btn-filtrar-vendas')?.addEventListener('click', () => loadData());
    $('#btn-limpar-vendas')?.addEventListener('click', () => {
      $('#vendas-filtro-busca').value = '';
      $('#vendas-filtro-status').value = 'pendente';
      $('#vendas-filtro-cliente').value = '';
      loadData();
    });
    $('#vendas-filtro-busca')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadData(); });
    $('#tbody-vendas-financeiro')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-venda-id]');
      if (button) openSale(Number(button.dataset.vendaId));
    });
    $$('[data-fechar-venda-modal]').forEach((button) => button.addEventListener('click', closeModal));
    $('#modal-venda-financeiro')?.addEventListener('click', (event) => { if (event.target.id === 'modal-venda-financeiro') closeModal(); });
    $('#form-autenticar-venda')?.addEventListener('submit', authenticateSale);
    $('#form-autenticar-venda [name="condicao_pagamento_indice"]')?.addEventListener('change', selectedConditionChanged);
    $('#btn-devolver-venda')?.addEventListener('click', returnSale);
    $('#btn-cancelar-autenticacao-venda')?.addEventListener('click', cancelAuthentication);
  }

  bind();
  loadData({ openFromUrl: true });
})();
