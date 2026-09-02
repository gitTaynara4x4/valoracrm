/*
 * ValoraCRM · Orçamentos · calculos.js
 * Pagamentos, totais, cálculos, custos, lucro e análise financeira.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function normalizePayment(payment = {}) {
    return {
      tipo: payment.tipo || 'personalizado',
      nome: payment.nome || 'Nova condição',
      descricao: payment.descricao || '',
      desconto_percentual: parseNumber(payment.desconto_percentual),
      entrada_percentual: parseNumber(payment.entrada_percentual),
      entrada_valor: parseNumber(payment.entrada_valor),
      parcelas: Math.max(Number(payment.parcelas || 1), 1),
      juros_percentual: parseNumber(payment.juros_percentual),
      valor_parcela: parseNumber(payment.valor_parcela),
      total: parseNumber(payment.total),
      selecionada: Boolean(payment.selecionada),
    };
  }

  function addDefaultPayment() {
    const defaults = (state.meta.configuracao?.formas_pagamento || []).filter((option) => option.ativo !== false);
    const first = defaults[0] || { tipo: 'avista', nome: 'À vista' };
    state.payments = [normalizePayment({ ...first, selecionada: true })];
  }

  function renderPayments() {
    const container = $('payment-options');
    if (!state.payments.length) addDefaultPayment();
    container.innerHTML = state.payments.map((payment, index) => `
      <article class="payment-option" data-payment-index="${index}">
        <div class="payment-option-head">
          <input type="radio" name="payment-selected" data-payment-field="selecionada" ${payment.selecionada ? 'checked' : ''} title="Destacar no orçamento" />
          <input class="payment-name" data-payment-field="nome" value="${escapeHtml(payment.nome)}" placeholder="Nome da condição" />
          <button class="payment-remove" type="button" data-remove-payment="${index}"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="payment-option-grid">
          <div><label>Tipo</label><select data-payment-field="tipo"><option value="avista" ${payment.tipo === 'avista' ? 'selected' : ''}>À vista</option><option value="entrada_parcelas" ${payment.tipo === 'entrada_parcelas' ? 'selected' : ''}>Entrada + parcelas</option><option value="cartao" ${payment.tipo === 'cartao' ? 'selected' : ''}>Cartão</option><option value="pix" ${payment.tipo === 'pix' ? 'selected' : ''}>PIX</option><option value="boleto" ${payment.tipo === 'boleto' ? 'selected' : ''}>Boleto</option><option value="personalizado" ${payment.tipo === 'personalizado' ? 'selected' : ''}>Personalizado</option></select></div>
          <div><label>Desconto %</label><input data-payment-field="desconto_percentual" value="${inputMoney(payment.desconto_percentual)}" /></div>
          <div><label>Entrada %</label><input data-payment-field="entrada_percentual" value="${inputMoney(payment.entrada_percentual)}" /></div>
          <div><label>Parcelas</label><input type="number" min="1" data-payment-field="parcelas" value="${payment.parcelas}" /></div>
          <div><label>Juros %</label><input data-payment-field="juros_percentual" value="${inputMoney(payment.juros_percentual)}" /></div>
        </div>
        <div class="form-group" style="margin-top:10px"><label>Descrição complementar</label><input data-payment-field="descricao" value="${escapeHtml(payment.descricao)}" placeholder="Ex.: Entrada no aceite e saldo em 30/60 dias" /></div>
      </article>`).join('');
    recalculatePayments();
  }

  function updatePaymentField(input) {
    const card = input.closest('[data-payment-index]');
    const payment = state.payments[Number(card.dataset.paymentIndex)];
    const field = input.dataset.paymentField;
    if (field === 'selecionada') {
      state.payments.forEach((item, index) => { item.selecionada = index === Number(card.dataset.paymentIndex); });
    } else if (['desconto_percentual', 'entrada_percentual', 'juros_percentual'].includes(field)) {
      payment[field] = parseNumber(input.value);
    } else if (field === 'parcelas') payment.parcelas = Math.max(Number(input.value || 1), 1);
    else payment[field] = input.value;
    recalculatePayments();
    renderPreviewIfVisible();
  }

  function recalculatePayments() {
    const total = calculateTotals().total;
    state.payments.forEach((payment) => {
      const discounted = total * (1 - payment.desconto_percentual / 100);
      const withInterest = discounted * (1 + payment.juros_percentual / 100);
      payment.total = Math.max(withInterest, 0);
      payment.entrada_valor = payment.total * payment.entrada_percentual / 100;
      payment.valor_parcela = Math.max((payment.total - payment.entrada_valor) / Math.max(payment.parcelas, 1), 0);
    });
  }

  function calculateTotals() {
    const subtotal = state.items.reduce((sum, item) => sum + itemTotal(item), 0);
    const type = $('orcamento-desconto-tipo').value;
    const discountInput = Math.max(parseNumber($('orcamento-desconto-valor').value), 0);
    const discount = type === 'percentual' ? Math.min(subtotal * discountInput / 100, subtotal) : Math.min(discountInput, subtotal);
    const freight = Math.max(parseNumber($('orcamento-frete').value), 0);
    const addition = Math.max(parseNumber($('orcamento-acrescimo').value), 0);
    const total = Math.max(subtotal - discount + freight + addition, 0);
    const cost = state.items.reduce((sum, item) => sum + item.quantidade * parseNumber(item.custo_unitario), 0);
    const profit = total - cost;
    const margin = total > 0 ? profit / total * 100 : 0;
    return { subtotal, discount, freight, addition, total, cost, profit, margin };
  }

  function applyAnalysisResult(result) {
    if (!result || !canShowCosts()) return;
    state.calculation = result;
    $('analysis-sale').textContent = formatMoney(result.total);
    $('analysis-cost').textContent = formatMoney(result.custo_total);
    $('analysis-profit').textContent = formatMoney(result.lucro_total);
    $('analysis-margin').textContent = formatPercent(result.margem_percentual);
    const missing = Number(result.itens_sem_custo || 0);
    $('missing-cost-alert')?.classList.toggle('is-hidden', missing === 0);
    if ($('missing-cost-title')) $('missing-cost-title').textContent = missing === 1 ? '1 item está sem custo informado' : `${missing} itens estão sem custo informado`;
    const minMargin = parseNumber(state.meta.configuracao?.margem_minima);
    const alert = Boolean(state.meta.configuracao?.exigir_aprovacao_margem) && parseNumber(result.margem_percentual) < minMargin;
    $('margin-alert').classList.toggle('is-hidden', !alert);
    renderAnalysis();
  }

  function scheduleServerCalculation() {
    if (!canShowCosts()) return;
    clearTimeout(state.calculationTimer);
    const version = ++state.calculationVersion;
    state.calculationTimer = setTimeout(async () => {
      try {
        const payload = collectBudgetPayload();
        const result = await api(`${API}/calcular`, { method: 'POST', body: JSON.stringify(payload) });
        if (version !== state.calculationVersion) return;
        applyAnalysisResult(result);
      } catch (error) {
        if (version !== state.calculationVersion) return;
        console.warn('[orcamentos] cálculo financeiro:', error);
      }
    }, 260);
  }

  function updateTotals() {
    state.calculation = null;
    const totals = calculateTotals();
    $('summary-subtotal').textContent = formatMoney(totals.subtotal);
    $('summary-desconto').textContent = formatMoney(totals.discount);
    $('summary-total').textContent = formatMoney(totals.total);
    $('footer-total').textContent = formatMoney(totals.total);
    if ($('budget-sidebar-total')) $('budget-sidebar-total').textContent = formatMoney(totals.total);
    if (!state.calculation) {
      $('analysis-sale').textContent = formatMoney(totals.total);
      $('analysis-cost').textContent = formatMoney(totals.cost);
      $('analysis-profit').textContent = formatMoney(totals.profit);
      $('analysis-margin').textContent = formatPercent(totals.margin);
    }
    recalculatePayments();
    renderAnalysis();
    renderPreviewIfVisible();
    scheduleServerCalculation();
  }

  function currentAnalysisItems() {
    return state.calculation?.itens || state.items.map((item) => {
      const sale = itemTotal(item);
      const cost = item.quantidade * parseNumber(item.custo_unitario);
      const profit = sale - cost;
      return { ...item, valor_total: sale, custo_total: cost, lucro_total: profit, margem_percentual: sale > 0 ? profit / sale * 100 : 0 };
    });
  }

  function renderAnalysis() {
    const tbody = $('analysis-items-body');
    const items = currentAnalysisItems();
    tbody.innerHTML = items.map((item) => {
      const costKnown = item.custo_informado !== false;
      return `<tr><td>${escapeHtml(item.descricao || 'Item sem descrição')}</td><td class="text-right">${formatMoney(item.valor_total)}</td><td class="text-right ${costKnown ? '' : 'analysis-missing-cost'}">${costKnown ? formatMoney(item.custo_total) : 'Não informado'}</td><td class="text-right">${costKnown ? formatMoney(item.lucro_total) : '—'}</td><td class="text-right">${costKnown ? formatPercent(item.margem_percentual) : '—'}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty-state">Nenhum item.</td></tr>';
  }


  function paymentDescription(payment) {
    const parts = [];
    if (payment.desconto_percentual > 0) parts.push(`${formatPercent(payment.desconto_percentual)} de desconto`);
    if (payment.entrada_percentual > 0) parts.push(`entrada de ${formatPercent(payment.entrada_percentual)} (${formatMoney(payment.entrada_valor)})`);
    if (payment.parcelas > 1) parts.push(`${payment.parcelas} parcelas de ${formatMoney(payment.valor_parcela)}`);
    if (payment.juros_percentual > 0) parts.push(`juros de ${formatPercent(payment.juros_percentual)}`);
    if (payment.descricao) parts.push(payment.descricao);
    return parts.join(' • ') || `Total: ${formatMoney(payment.total)}`;
  }

  function companyAddress() {
    const company = state.company || {};
    return [company.rua || company.endereco, company.numero, company.complemento, company.cidade, company.estado, company.cep].filter(Boolean).join(', ');
  }

  function budgetAddress() {
    return [
      $('orcamento-logradouro').value,
      $('orcamento-numero').value,
      $('orcamento-complemento').value,
      $('orcamento-bairro').value,
      $('orcamento-cidade').value,
      $('orcamento-estado').value,
      $('orcamento-cep').value,
    ].filter(Boolean).join(', ');
  }

