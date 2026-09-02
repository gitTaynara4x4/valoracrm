/*
 * ValoraCRM · Orçamentos · calculos.js
 * Pagamentos, totais, cálculos, custos, lucro e análise financeira.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function roundPaymentMoney(value) {
    return Math.round((Math.max(parseNumber(value), 0) + Number.EPSILON) * 100) / 100;
  }

  function isImmediatePaymentType(type) {
    return ['avista', 'pix'].includes(String(type || '').toLowerCase());
  }

  function normalizePaymentRules(payment, { changedField = '' } = {}) {
    if (!payment) return payment;

    payment.desconto_percentual = Math.min(Math.max(parseNumber(payment.desconto_percentual), 0), 100);
    payment.entrada_percentual = Math.min(Math.max(parseNumber(payment.entrada_percentual), 0), 100);
    payment.juros_percentual = Math.max(parseNumber(payment.juros_percentual), 0);
    payment.parcelas = Math.min(Math.max(Math.trunc(Number(payment.parcelas || 1)), 1), 120);

    const immediateType = isImmediatePaymentType(payment.tipo);
    const fullEntry = payment.entrada_percentual >= 100;

    if (immediateType) {
      payment.entrada_percentual = 100;
      payment.parcelas = 1;
      payment.juros_percentual = 0;
    } else if (fullEntry) {
      // 100% de entrada quita a condição: não faz sentido manter parcelas ou juros.
      payment.entrada_percentual = 100;
      payment.parcelas = 1;
      payment.juros_percentual = 0;
    }

    return payment;
  }

  function normalizePayment(payment = {}) {
    const normalized = {
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
    return normalizePaymentRules(normalized);
  }

  function addDefaultPayment() {
    const defaults = (state.meta.configuracao?.formas_pagamento || []).filter((option) => option.ativo !== false);
    const first = defaults[0] || { tipo: 'avista', nome: 'À vista' };
    state.payments = [normalizePayment({ ...first, selecionada: true })];
  }

  function paymentInstallmentSchedule(payment, simulation = paymentSimulationData(payment)) {
    if (simulation.singlePayment) {
      return [{ label: 'Pagamento único', value: simulation.finalTotal, kind: 'single' }];
    }

    const schedule = [];
    if (simulation.entry > 0) schedule.push({ label: 'Entrada', value: simulation.entry, kind: 'entry' });

    const count = Math.max(simulation.installments, 1);
    if (simulation.balance <= 0) return schedule;

    const base = roundPaymentMoney(simulation.balance / count);
    for (let i = 0; i < count; i += 1) {
      const value = i === count - 1
        ? roundPaymentMoney(simulation.balance - (base * (count - 1)))
        : base;
      schedule.push({
        label: `${i + 1}ª parcela`,
        value,
        kind: 'installment',
      });
    }

    return schedule;
  }

  function paymentSimulationData(payment) {
    normalizePaymentRules(payment);

    const budgetTotal = roundPaymentMoney(calculateTotals().total);
    const discountPercent = Math.min(Math.max(parseNumber(payment.desconto_percentual), 0), 100);
    const interestPercent = Math.max(parseNumber(payment.juros_percentual), 0);
    const afterDiscount = roundPaymentMoney(budgetTotal * (1 - discountPercent / 100));
    const discountAmount = roundPaymentMoney(budgetTotal - afterDiscount);
    const finalTotal = roundPaymentMoney(payment.total);
    const interestAmount = roundPaymentMoney(finalTotal - afterDiscount);
    const entryPercent = Math.min(Math.max(parseNumber(payment.entrada_percentual), 0), 100);
    const singlePayment = isImmediatePaymentType(payment.tipo) || entryPercent >= 100;
    const entry = singlePayment
      ? finalTotal
      : Math.min(roundPaymentMoney(payment.entrada_valor), finalTotal);
    const balance = singlePayment ? 0 : roundPaymentMoney(finalTotal - entry);
    const installments = singlePayment ? 1 : Math.max(Number(payment.parcelas || 1), 1);
    const installmentValue = singlePayment
      ? finalTotal
      : (balance > 0 ? roundPaymentMoney(balance / installments) : 0);
    const lastInstallmentValue = singlePayment
      ? finalTotal
      : (balance > 0
        ? roundPaymentMoney(balance - installmentValue * (installments - 1))
        : 0);

    return {
      budgetTotal,
      discountPercent,
      discountAmount,
      afterDiscount,
      interestPercent,
      interestAmount,
      finalTotal,
      entryPercent,
      entry,
      balance,
      installments,
      installmentValue,
      lastInstallmentValue,
      singlePayment,
    };
  }

  function paymentSimulationSentence(payment, simulation = paymentSimulationData(payment)) {
    if (simulation.singlePayment) {
      return `Pagamento único de ${formatMoney(simulation.finalTotal)}`;
    }

    const parts = [];
    if (simulation.entry > 0) parts.push(`Entrada de ${formatMoney(simulation.entry)}`);

    if (simulation.balance > 0) {
      if (simulation.installments > 1) {
        parts.push(`${simulation.installments}x de ${formatMoney(simulation.installmentValue)}`);
      } else {
        parts.push(`1x de ${formatMoney(simulation.installmentValue)}`);
      }
    }

    return parts.length ? parts.join(' + ') : `Pagamento de ${formatMoney(simulation.finalTotal)}`;
  }

  function paymentInstallmentMarkup(payment, simulation) {
    const schedule = paymentInstallmentSchedule(payment, simulation);
    if (!schedule.length) return '';

    const lastDiffers = !simulation.singlePayment
      && simulation.installments > 1
      && Math.abs(simulation.lastInstallmentValue - simulation.installmentValue) >= 0.005;

    return `
      <div class="payment-installment-plan">
        <div class="payment-installment-plan-head">
          <div>
            <span>Como o cliente vai pagar</span>
            <small>${simulation.singlePayment
              ? 'A condição foi tratada como pagamento à vista.'
              : `${simulation.entry > 0 ? 'Entrada + ' : ''}${simulation.installments} ${simulation.installments === 1 ? 'parcela' : 'parcelas'}`}</small>
          </div>
          ${lastDiffers ? `<small class="payment-rounding-note">Última parcela ajustada em centavos para fechar o total.</small>` : ''}
        </div>
        <div class="payment-installment-list">
          ${schedule.map((row) => `
            <div class="payment-installment-row ${row.kind === 'entry' ? 'is-entry' : ''} ${row.kind === 'single' ? 'is-single' : ''}">
              <span>${escapeHtml(row.label)}</span>
              <strong>${formatMoney(row.value)}</strong>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function paymentSimulationMarkup(payment, index) {
    const simulation = paymentSimulationData(payment);
    const hasDiscount = simulation.discountAmount > 0.004;
    const hasInterest = simulation.interestAmount > 0.004;

    return `
      <div class="payment-simulation-head">
        <div>
          <span class="payment-simulation-kicker"><i class="fa-solid fa-calculator"></i> Simulação da condição</span>
          <strong>${escapeHtml(paymentSimulationSentence(payment, simulation))}</strong>
        </div>
        <span class="payment-live-badge"><i class="fa-solid fa-bolt"></i> Atualização automática</span>
      </div>
      <div class="payment-simulation-grid">
        <div class="payment-sim-metric">
          <span>Total base</span>
          <strong>${formatMoney(simulation.budgetTotal)}</strong>
        </div>
        <div class="payment-sim-metric ${hasDiscount ? 'is-positive' : ''}">
          <span>Desconto da condição</span>
          <strong>${hasDiscount ? `- ${formatMoney(simulation.discountAmount)}` : formatMoney(0)}</strong>
        </div>
        <div class="payment-sim-metric is-entry">
          <span>${simulation.singlePayment ? 'Pagamento' : `Entrada ${simulation.entryPercent > 0 ? `(${formatPercent(simulation.entryPercent)})` : ''}`}</span>
          <strong>${formatMoney(simulation.entry)}</strong>
        </div>
        <div class="payment-sim-metric">
          <span>Saldo após entrada</span>
          <strong>${formatMoney(simulation.balance)}</strong>
        </div>
        <div class="payment-sim-metric is-installment">
          <span>${simulation.singlePayment ? 'Parcelamento' : `${simulation.installments} ${simulation.installments === 1 ? 'parcela' : 'parcelas'}`}</span>
          <strong>${simulation.singlePayment ? 'À vista' : formatMoney(simulation.installmentValue)}</strong>
          ${!simulation.singlePayment && simulation.installments > 1 && Math.abs(simulation.lastInstallmentValue - simulation.installmentValue) >= 0.005
            ? `<small>Última: ${formatMoney(simulation.lastInstallmentValue)}</small>`
            : ''}
        </div>
        <div class="payment-sim-metric ${hasInterest ? 'is-warning' : ''}">
          <span>Juros da condição</span>
          <strong>${hasInterest ? `+ ${formatMoney(simulation.interestAmount)}` : formatMoney(0)}</strong>
        </div>
      </div>
      ${paymentInstallmentMarkup(payment, simulation)}
      <div class="payment-simulation-total">
        <div>
          <span>Total final da condição</span>
          <small>${hasInterest ? `Inclui ${formatPercent(simulation.interestPercent)} de juros` : 'Sem custo adicional de juros'}</small>
        </div>
        <strong>${formatMoney(simulation.finalTotal)}</strong>
      </div>`;
  }

  function renderPaymentSimulations() {
    state.payments.forEach((payment, index) => {
      const card = document.querySelector(`[data-payment-index="${index}"]`);
      const simulation = card?.querySelector('[data-payment-simulation]');
      if (simulation) simulation.innerHTML = paymentSimulationMarkup(payment, index);
      card?.classList.toggle('is-selected', Boolean(payment.selecionada));
    });
  }

  function paymentControlLockedState(payment) {
    const immediateType = isImmediatePaymentType(payment.tipo);
    const fullEntry = parseNumber(payment.entrada_percentual) >= 100;
    return {
      entryLocked: immediateType,
      installmentsLocked: immediateType || fullEntry,
      interestLocked: immediateType || fullEntry,
    };
  }

  function syncPaymentRuleControls(card, payment, { preserveField = '' } = {}) {
    if (!card || !payment) return;
    const locks = paymentControlLockedState(payment);
    const entryInput = card.querySelector('[data-payment-field="entrada_percentual"]');
    const installmentsInput = card.querySelector('[data-payment-field="parcelas"]');
    const interestInput = card.querySelector('[data-payment-field="juros_percentual"]');

    if (entryInput) {
      if (preserveField !== 'entrada_percentual' || locks.entryLocked) entryInput.value = inputMoney(payment.entrada_percentual);
      entryInput.disabled = locks.entryLocked;
      entryInput.title = locks.entryLocked ? 'Este tipo de pagamento é considerado à vista.' : '';
    }
    if (installmentsInput) {
      if (preserveField !== 'parcelas' || locks.installmentsLocked) installmentsInput.value = String(payment.parcelas);
      installmentsInput.disabled = locks.installmentsLocked;
      installmentsInput.title = locks.installmentsLocked ? 'Com 100% pago na entrada não há saldo para parcelar.' : '';
    }
    if (interestInput) {
      if (preserveField !== 'juros_percentual' || locks.interestLocked) interestInput.value = inputMoney(payment.juros_percentual);
      interestInput.disabled = locks.interestLocked;
      interestInput.title = locks.interestLocked ? 'Pagamento integral não usa juros de parcelamento.' : '';
    }
  }

  function renderPayments() {
    const container = $('payment-options');
    if (!state.payments.length) addDefaultPayment();
    recalculatePayments();
    container.innerHTML = state.payments.map((payment, index) => {
      const locks = paymentControlLockedState(payment);
      return `
      <article class="payment-option ${payment.selecionada ? 'is-selected' : ''}" data-payment-index="${index}">
        <div class="payment-option-head">
          <input type="radio" name="payment-selected" data-payment-field="selecionada" ${payment.selecionada ? 'checked' : ''} title="Destacar no orçamento" />
          <input class="payment-name" data-payment-field="nome" value="${escapeHtml(payment.nome)}" placeholder="Nome da condição" />
          <button class="payment-remove" type="button" data-remove-payment="${index}" title="Excluir condição"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="payment-option-grid">
          <div><label>Tipo</label><select data-payment-field="tipo"><option value="avista" ${payment.tipo === 'avista' ? 'selected' : ''}>À vista</option><option value="entrada_parcelas" ${payment.tipo === 'entrada_parcelas' ? 'selected' : ''}>Entrada + parcelas</option><option value="cartao" ${payment.tipo === 'cartao' ? 'selected' : ''}>Cartão</option><option value="pix" ${payment.tipo === 'pix' ? 'selected' : ''}>PIX</option><option value="boleto" ${payment.tipo === 'boleto' ? 'selected' : ''}>Boleto</option><option value="personalizado" ${payment.tipo === 'personalizado' ? 'selected' : ''}>Personalizado</option></select></div>
          <div>
            <label>Desconto</label>
            <div class="payment-affix-field has-suffix">
              <input data-payment-field="desconto_percentual" value="${inputMoney(payment.desconto_percentual)}" inputmode="decimal" data-percent-min="0" data-percent-max="100" title="Informe um percentual entre 0 e 100" />
              <span class="payment-field-affix is-suffix" aria-hidden="true">%</span>
            </div>
          </div>
          <div>
            <label>Entrada</label>
            <div class="payment-affix-field has-suffix">
              <input data-payment-field="entrada_percentual" value="${inputMoney(payment.entrada_percentual)}" inputmode="decimal" data-percent-min="0" data-percent-max="100" title="Informe um percentual entre 0 e 100" ${locks.entryLocked ? 'disabled' : ''} />
              <span class="payment-field-affix is-suffix" aria-hidden="true">%</span>
            </div>
          </div>
          <div><label>Parcelas</label><input type="number" min="1" max="120" data-payment-field="parcelas" value="${payment.parcelas}" ${locks.installmentsLocked ? 'disabled' : ''} /></div>
          <div>
            <label>Juros</label>
            <div class="payment-affix-field has-suffix">
              <input data-payment-field="juros_percentual" value="${inputMoney(payment.juros_percentual)}" inputmode="decimal" ${locks.interestLocked ? 'disabled' : ''} />
              <span class="payment-field-affix is-suffix" aria-hidden="true">%</span>
            </div>
          </div>
        </div>
        <div class="form-group payment-description-field"><label>Descrição complementar</label><input data-payment-field="descricao" value="${escapeHtml(payment.descricao)}" placeholder="Ex.: Entrada no aceite e saldo em 30/60 dias" /></div>
        <div class="payment-simulation" data-payment-simulation>${paymentSimulationMarkup(payment, index)}</div>
      </article>`;
    }).join('');
  }

  function updatePaymentField(input) {
    const card = input.closest('[data-payment-index]');
    const payment = state.payments[Number(card.dataset.paymentIndex)];
    const field = input.dataset.paymentField;
    const previousType = payment.tipo;

    if (field === 'selecionada') {
      state.payments.forEach((item, index) => { item.selecionada = index === Number(card.dataset.paymentIndex); });
    } else if (field === 'entrada_percentual') {
      const previousEntryPercent = Math.min(Math.max(parseNumber(payment.entrada_percentual), 0), 100);
      const requestedEntryPercent = parseNumber(input.value);

      // Entrada é percentual: nunca aceitar valores negativos ou acima de 100%.
      // Em vez de transformar 260% silenciosamente em pagamento à vista,
      // mantemos o último valor válido e avisamos o usuário.
      if (requestedEntryPercent < 0 || requestedEntryPercent > 100) {
        input.value = inputMoney(previousEntryPercent);
        input.classList.add('is-payment-percent-invalid');
        input.setAttribute('aria-invalid', 'true');
        toast('A entrada deve ficar entre 0% e 100%.', 'error');
        return;
      }

      input.classList.remove('is-payment-percent-invalid');
      input.removeAttribute('aria-invalid');
      payment.entrada_percentual = requestedEntryPercent;
    } else if (field === 'desconto_percentual') {
      const requestedDiscountPercent = parseNumber(input.value);
      if (requestedDiscountPercent < 0 || requestedDiscountPercent > 100) {
        input.value = inputMoney(Math.min(Math.max(parseNumber(payment.desconto_percentual), 0), 100));
        input.classList.add('is-payment-percent-invalid');
        input.setAttribute('aria-invalid', 'true');
        toast('O desconto da condição deve ficar entre 0% e 100%.', 'error');
        return;
      }
      input.classList.remove('is-payment-percent-invalid');
      input.removeAttribute('aria-invalid');
      payment.desconto_percentual = requestedDiscountPercent;
    } else if (field === 'juros_percentual') {
      payment.juros_percentual = Math.max(parseNumber(input.value), 0);
    } else if (field === 'parcelas') {
      payment.parcelas = Math.max(Number(input.value || 1), 1);
    } else {
      payment[field] = input.value;
    }

    // Ao sair de um tipo obrigatoriamente à vista, libera uma condição nova para configuração.
    if (field === 'tipo' && isImmediatePaymentType(previousType) && !isImmediatePaymentType(payment.tipo)) {
      payment.entrada_percentual = 0;
      payment.parcelas = 1;
      payment.juros_percentual = 0;
    }

    normalizePaymentRules(payment, { changedField: field });
    recalculatePayments();
    syncPaymentRuleControls(card, payment, { preserveField: field });
    renderPaymentSimulations();
    renderPreviewIfVisible();
  }

  function recalculatePayments() {
    const total = roundPaymentMoney(calculateTotals().total);
    state.payments.forEach((payment) => {
      normalizePaymentRules(payment);
      const discounted = roundPaymentMoney(total * (1 - payment.desconto_percentual / 100));
      const withInterest = roundPaymentMoney(discounted * (1 + payment.juros_percentual / 100));
      payment.total = withInterest;
      payment.entrada_valor = roundPaymentMoney(payment.total * payment.entrada_percentual / 100);
      const balance = roundPaymentMoney(payment.total - payment.entrada_valor);
      payment.valor_parcela = balance > 0
        ? roundPaymentMoney(balance / Math.max(payment.parcelas, 1))
        : 0;
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
    renderPaymentSimulations();
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

