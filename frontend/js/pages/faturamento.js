(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  if (!$('[data-financeiro-faturamento-page]')) return;

  const state = { items: [], current: null, selectedId: null, opcoes: {} };
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

  function qs(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && String(value).trim() !== '') query.set(key, value);
    });
    return query.toString() ? `?${query.toString()}` : '';
  }

  function option(label, value) {
    return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  }

  function statusBadge(status) {
    const labels = { pendente: 'Em aberto', devolvido: 'Devolvido', autenticado: 'Faturado', cancelado: 'Cancelado' };
    const classes = { pendente: 'warn', devolvido: 'danger', autenticado: 'ok', cancelado: 'danger' };
    const key = String(status || 'pendente').toLowerCase();
    return `<span class="financeiro-pill ${classes[key] || 'blue'}">${labels[key] || escapeHtml(key)}</span>`;
  }

  function documentBadge(item) {
    const type = item.documento_origem_tipo || 'orcamento';
    const labels = { dav: 'DAV', orcamento: 'Orçamento', os: 'OS' };
    return `<span class="financeiro-doc-badge financeiro-doc-badge--${escapeHtml(type)}">${labels[type] || 'Documento'}</span>`;
  }

  function paymentLabel(item) {
    const payments = Array.isArray(item.pagamentos_json) ? item.pagamentos_json : [];
    const selected = payments.find((payment) => Boolean(payment.selecionada)) || (payments.length === 1 ? payments[0] : null);
    if (!selected) return '—';
    const installments = Number(selected.parcelas || 1);
    return `${selected.nome || selected.tipo || 'Condição'}${installments > 1 ? ` • ${installments}x` : ''}`;
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
    const node = $('#faturamento-status-text');
    if (node) node.textContent = text;
  }

  function populateOptions() {
    const ops = state.opcoes || {};
    const clients = $('#faturamento-filtro-cliente');
    if (clients) {
      const current = clients.value;
      clients.innerHTML = '<option value="">Todos os clientes</option>' + (ops.clientes || []).map((item) => option(`${item.codigo || ''} - ${item.nome}`, item.id)).join('');
      clients.value = current;
    }

    const definitions = {
      'formas-cobranca': [(ops.formas_cobranca || []), (item) => item.nome],
      formas: [(ops.formas_pagamento || []), (item) => item.nome],
      contas: [(ops.contas_bancos || []).filter((item) => item.ativo !== false), (item) => [item.nome, item.banco, item.agencia, item.conta_corrente].filter(Boolean).join(' • ')],
      categorias: [(ops.categorias || []).filter((item) => ['receita', 'ambos'].includes(item.tipo)), (item) => `${item.nome} (${item.tipo})`],
      'contas-contabeis': [(ops.contas_contabeis || []).filter((item) => item.ativo !== false && item.aceita_lancamento !== false), (item) => `${item.codigo} - ${item.nome}`],
      'tipos-documento': [(ops.tipos_documento || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => item.nome],
      'naturezas-operacao': [(ops.naturezas_operacao || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => `${item.codigo ? `${item.codigo} - ` : ''}${item.nome_exibicao || item.nome}`],
      'centros-custo': [(ops.centros_custo || []).filter((item) => item.ativo !== false && !item.centro_pai_id), (item) => `${item.codigo ? `${item.codigo} - ` : ''}${item.nome}`],
      'regras-encargos': [(ops.regras_encargos || []).filter((item) => !item.aplicacao || ['receber', 'ambos'].includes(item.aplicacao)), (item) => `${item.nome}${item.padrao ? ' (padrão)' : ''}`],
    };
    Object.entries(definitions).forEach(([name, [items, labelFn]]) => {
      $$(`[data-faturamento-select="${name}"]`).forEach((select) => {
        const current = select.value;
        select.innerHTML = '<option value="">Selecione...</option>' + items.map((item) => option(labelFn(item), item.id)).join('');
        if (items.some((item) => String(item.id) === String(current))) select.value = current;
      });
    });
  }

  function selectDocument(id) {
    state.selectedId = id ? Number(id) : null;
    const selected = state.items.find((item) => Number(item.id) === state.selectedId);
    $('#faturamento-selecionado-label').textContent = selected ? `${selected.orcamento_codigo} • ${selected.documento_origem_label}` : 'Nenhum';
    const button = $('#btn-faturar-selecionado');
    if (button) button.disabled = !selected || selected.status !== 'pendente';
    $$('[data-faturamento-radio]').forEach((input) => { input.checked = Number(input.value) === state.selectedId; });
    $$('#tbody-faturamento tr[data-faturamento-row]').forEach((row) => row.classList.toggle('is-selected', Number(row.dataset.faturamentoRow) === state.selectedId));
  }

  function renderTable() {
    const tbody = $('#tbody-faturamento');
    if (!tbody) return;
    if (!state.items.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="financeiro-empty">Nenhum documento encontrado para os filtros informados.</td></tr>';
      selectDocument(null);
      return;
    }
    tbody.innerHTML = state.items.map((item) => {
      const editable = item.status === 'pendente';
      return `<tr data-faturamento-row="${item.id}">
        <td class="financeiro-select-cell"><input type="radio" name="faturamento_documento" value="${item.id}" data-faturamento-radio ${editable ? '' : 'disabled'} aria-label="Selecionar ${escapeHtml(item.orcamento_codigo)}"></td>
        <td><div class="financeiro-lancamento-cell"><span class="financeiro-lancamento-icon blue"><i class="fa-solid fa-file-invoice"></i></span><div><strong>${escapeHtml(item.orcamento_codigo || '—')}</strong><small>${documentBadge(item)} ${escapeHtml(item.orcamento_titulo || '')}</small></div></div></td>
        <td>${dateBR(item.data_venda)}<small>${item.enviado_em ? `Financeiro ${dateTimeBR(item.enviado_em)}` : ''}</small></td>
        <td><strong>${escapeHtml(item.cliente_nome || '—')}</strong><small>${escapeHtml(item.cliente_documento || '')}</small></td>
        <td class="financeiro-amount"><strong>${money(item.valor_total)}</strong></td>
        <td>${escapeHtml(paymentLabel(item))}</td>
        <td>${statusBadge(item.status)}${item.motivo_devolucao ? `<small title="${escapeHtml(item.motivo_devolucao)}">${escapeHtml(item.motivo_devolucao)}</small>` : ''}</td>
        <td><div class="actions-cell"><button class="financeiro-mini-btn ${editable ? 'ok' : ''}" type="button" data-abrir-faturamento="${item.id}"><i class="fa-solid ${editable ? 'fa-file-invoice-dollar' : 'fa-eye'}"></i> ${editable ? 'Faturar' : 'Visualizar'}</button><a class="financeiro-mini-btn" href="/orcamentos?orcamento_id=${item.orcamento_id}"><i class="fa-regular fa-file-lines"></i> Origem</a></div></td>
      </tr>`;
    }).join('');
    const stillExists = state.items.some((item) => Number(item.id) === state.selectedId && item.status === 'pendente');
    if (!stillExists) selectDocument(null); else selectDocument(state.selectedId);
  }

  function updateKpis(summary = {}) {
    const set = (key, value) => { const node = $(`[data-kpi-faturamento="${key}"]`); if (node) node.textContent = value; };
    const abertos = Number(summary.pendentes || 0);
    const valorAberto = Number(summary.valor_pendente || 0);
    set('abertos', String(abertos));
    set('valor-aberto', money(valorAberto));
    set('faturados', String(Number(summary.autenticadas || 0)));
    set('valor-faturado', money(summary.valor_autenticado || 0));
    set('saldo', money(valorAberto));
  }

  async function loadData({ openFromUrl = false } = {}) {
    setStatus('Carregando documentos...');
    const budgetIdFromUrl = Number(new URLSearchParams(window.location.search).get('orcamento_id') || 0);
    const filters = {
      status: openFromUrl && budgetIdFromUrl ? '' : ($('#faturamento-filtro-status')?.value || ''),
      busca: $('#faturamento-filtro-busca')?.value || '',
      cliente_id: $('#faturamento-filtro-cliente')?.value || '',
      tipo_documento: $('#faturamento-filtro-tipo')?.value || '',
      data_inicial: $('#faturamento-data-inicial')?.value || '',
      data_final: $('#faturamento-data-final')?.value || '',
      limit: 300,
    };
    try {
      const [options, result] = await Promise.all([
        request('/api/financeiro/opcoes'),
        request(`/api/financeiro/faturamento/documentos${qs(filters)}`),
      ]);
      state.opcoes = options || {};
      state.items = result.items || [];
      populateOptions();
      renderTable();
      updateKpis(result.resumo || {});
      setStatus(`${result.total || 0} documento(s) no resultado.`);
      if (openFromUrl && budgetIdFromUrl) {
        const found = state.items.find((item) => Number(item.orcamento_id) === budgetIdFromUrl);
        if (found) {
          selectDocument(found.id);
          await openDocument(found.id);
        } else notify('O documento deste orçamento ainda não foi enviado ao Financeiro.', 'error');
      }
    } catch (error) {
      console.error('[faturamento]', error);
      setStatus('Erro ao carregar.');
      notify(`Erro ao carregar faturamento: ${error.message}`, 'error');
    }
  }

  function openModal() {
    const modal = $('#modal-faturamento');
    modal?.classList.add('is-open');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('financeiro-modal-open');
  }

  function closeModal() {
    const modal = $('#modal-faturamento');
    modal?.classList.remove('is-open');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('financeiro-modal-open');
    state.current = null;
  }

  function renderDetail(item) {
    $('#faturamento-modal-titulo').textContent = `${item.documento_origem_label} ${item.orcamento_codigo}`;
    $('#faturamento-modal-subtitulo').textContent = item.status === 'pendente'
      ? 'Confira o documento antes de gerar o Contas a Receber.'
      : `Documento ${item.status === 'autenticado' ? 'já faturado' : item.status}.`;
    $('#faturamento-resumo').innerHTML = `
      <div><span>Documento</span><strong>${escapeHtml(item.orcamento_codigo)}</strong><small>${escapeHtml(item.documento_origem_label)}</small></div>
      <div><span>Cliente</span><strong>${escapeHtml(item.cliente_nome)}</strong><small>${escapeHtml(item.cliente_documento || '')}</small></div>
      <div><span>Emissão</span><strong>${dateBR(item.data_venda)}</strong><small>${escapeHtml(item.consultor_nome || 'Sem consultor')}</small></div>
      <div><span>Total</span><strong>${money(item.valor_total)}</strong><small>${escapeHtml(paymentLabel(item))}</small></div>`;

    $('#faturamento-itens').innerHTML = (item.itens_json || []).map((line) => `<article><div><strong>${escapeHtml(line.descricao || 'Item')}</strong><small>${escapeHtml(line.codigo || '')}</small></div><span>${Number(line.quantidade || 0).toLocaleString('pt-BR')} × ${money(line.valor_unitario)}</span><strong>${money(line.valor_total)}</strong></article>`).join('') || '<div class="financeiro-empty-soft">Nenhum item no documento.</div>';

    const payments = item.pagamentos_json || [];
    $('#faturamento-condicoes').innerHTML = payments.map((payment, index) => `<article class="${payment.selecionada ? 'is-selected' : ''}"><div><strong>${escapeHtml(payment.nome || `Opção ${index + 1}`)}</strong><small>${Number(payment.parcelas || 1)} parcela(s)${Number(payment.entrada_valor || 0) > 0 ? ` • entrada ${money(payment.entrada_valor)}` : ''}</small></div><span>${money(payment.total || item.valor_total)}</span></article>`).join('') || '<div class="financeiro-empty-soft">Nenhuma condição estruturada.</div>';

    const form = $('#form-faturamento');
    form.reset();
    form.elements.venda_id.value = item.id;
    const condition = form.elements.condicao_pagamento_indice;
    condition.innerHTML = '<option value="">Selecionar condição</option>' + payments.map((payment, index) => option(`${payment.nome || `Opção ${index + 1}`} — ${payment.parcelas || 1} parcela(s) — ${money(payment.total || item.valor_total)}`, index)).join('');
    const selectedIndex = payments.findIndex((payment) => Boolean(payment.selecionada));
    if (selectedIndex >= 0) condition.value = String(selectedIndex);
    else if (payments.length === 1) condition.value = '0';
    const preferred = selectedIndex >= 0 ? payments[selectedIndex] : (payments.length === 1 ? payments[0] : null);
    form.elements.parcelas.value = Math.max(1, Number(preferred?.parcelas || 1));
    populateOptions();
    const defaultRule = (state.opcoes.regras_encargos || []).find((rule) => rule.padrao && ['receber', 'ambos'].includes(rule.aplicacao || 'ambos'));
    if (defaultRule) form.elements.regra_encargos_id.value = String(defaultRule.id);

    const editable = item.status === 'pendente';
    $$('input,select,textarea', form).forEach((field) => { if (field.name !== 'venda_id') field.disabled = !editable; });
    $('#btn-confirmar-faturamento').hidden = !editable;
    $('#btn-devolver-faturamento').hidden = !editable;
    $('#btn-cancelar-faturamento').hidden = item.status !== 'autenticado';
    if (!editable && item.lancamentos_gerados?.length) {
      $('#faturamento-condicoes').insertAdjacentHTML('beforeend', `<div class="financeiro-venda-generated"><strong>Contas a Receber geradas</strong><span>${item.lancamentos_gerados.map((id) => `#${id}`).join(', ')}</span><a href="/contas-receber">Abrir Contas a Receber</a></div>`);
    }
  }

  async function openDocument(id) {
    try {
      const item = await request(`/api/financeiro/faturamento/documentos/${id}`);
      state.current = item;
      if (item.status === 'pendente') selectDocument(item.id);
      renderDetail(item);
      openModal();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function conditionChanged() {
    const form = $('#form-faturamento');
    const index = form.elements.condicao_pagamento_indice.value === '' ? -1 : Number(form.elements.condicao_pagamento_indice.value);
    const payment = state.current?.pagamentos_json?.[index];
    if (payment?.parcelas) form.elements.parcelas.value = Math.max(1, Number(payment.parcelas));
  }

  async function faturar(event) {
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
      regra_encargos_id: nullable(data.regra_encargos_id),
      observacoes: String(data.observacoes || '').trim() || null,
    };
    if (!payload.data_primeiro_vencimento || !payload.forma_cobranca_id || !payload.conta_banco_id || !payload.categoria_id || !payload.conta_contabil_id) {
      notify('Preencha vencimento, forma de cobrança, conta, categoria e Plano de Contas.', 'error');
      return;
    }
    if (!confirm(`Faturar ${state.current.documento_origem_label} ${state.current.orcamento_codigo} e gerar ${payload.parcelas} título(s) em Contas a Receber?\n\nTotal: ${money(state.current.valor_total)}`)) return;
    const button = $('#btn-confirmar-faturamento');
    try {
      setLoading(button, true, 'Faturando...');
      const result = await request(`/api/financeiro/faturamento/documentos/${state.current.id}/faturar`, { method: 'POST', body: payload });
      notify(`Documento faturado. ${result.quantidade} título(s) criado(s) em Contas a Receber.`);
      selectDocument(null);
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function devolver() {
    if (!state.current || state.current.status !== 'pendente') return;
    const reason = prompt('Informe o motivo para devolver este documento ao Comercial:');
    if (!reason?.trim()) return;
    const button = $('#btn-devolver-faturamento');
    try {
      setLoading(button, true, 'Devolvendo...');
      await request(`/api/financeiro/faturamento/documentos/${state.current.id}/devolver`, { method: 'POST', body: { motivo: reason.trim() } });
      notify('Documento devolvido ao Comercial.');
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  async function cancelarFaturamento() {
    if (!state.current || state.current.status !== 'autenticado') return;
    const reason = prompt('Informe o motivo para cancelar o faturamento e os títulos gerados:');
    if (!reason?.trim()) return;
    if (!confirm('Os títulos gerados serão cancelados. Se houver recebimento, a operação será bloqueada até o estorno. Continuar?')) return;
    const button = $('#btn-cancelar-faturamento');
    try {
      setLoading(button, true, 'Cancelando...');
      await request(`/api/financeiro/faturamento/documentos/${state.current.id}/cancelar-faturamento`, { method: 'POST', body: { motivo: reason.trim() } });
      notify('Faturamento cancelado e documento devolvido ao Comercial.');
      closeModal();
      await loadData();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(button, false);
    }
  }

  function bind() {
    $('#btn-atualizar-faturamento')?.addEventListener('click', () => loadData());
    $('#btn-filtrar-faturamento')?.addEventListener('click', () => loadData());
    $('#btn-limpar-faturamento')?.addEventListener('click', () => {
      $('#faturamento-filtro-busca').value = '';
      $('#faturamento-filtro-status').value = 'pendente';
      $('#faturamento-filtro-tipo').value = '';
      $('#faturamento-filtro-cliente').value = '';
      $('#faturamento-data-inicial').value = '';
      $('#faturamento-data-final').value = '';
      selectDocument(null);
      loadData();
    });
    $('#faturamento-filtro-busca')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') loadData(); });
    $('#tbody-faturamento')?.addEventListener('change', (event) => {
      const radio = event.target.closest('[data-faturamento-radio]');
      if (radio) selectDocument(Number(radio.value));
    });
    $('#tbody-faturamento')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-abrir-faturamento]');
      if (button) openDocument(Number(button.dataset.abrirFaturamento));
    });
    $('#btn-faturar-selecionado')?.addEventListener('click', () => { if (state.selectedId) openDocument(state.selectedId); });
    $$('[data-fechar-faturamento]').forEach((button) => button.addEventListener('click', closeModal));
    $('#modal-faturamento')?.addEventListener('click', (event) => { if (event.target.id === 'modal-faturamento') closeModal(); });
    $('#form-faturamento')?.addEventListener('submit', faturar);
    $('#form-faturamento [name="condicao_pagamento_indice"]')?.addEventListener('change', conditionChanged);
    $('#btn-devolver-faturamento')?.addEventListener('click', devolver);
    $('#btn-cancelar-faturamento')?.addEventListener('click', cancelarFaturamento);
  }

  bind();
  loadData({ openFromUrl: true });
})();
