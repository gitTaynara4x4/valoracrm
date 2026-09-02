/*
 * ValoraCRM · Orçamentos · impressao.js
 * Impressão/PDF, análise financeira impressa e compartilhamento por WhatsApp.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function printFinancialAnalysis() {
    if (!canShowCosts()) {
      toast('Seu usuário não possui permissão para visualizar custos.', 'error');
      return;
    }

    const items = currentAnalysisItems();
    if (!items.length) {
      toast('Adicione pelo menos um item antes de imprimir a análise financeira.', 'error');
      return;
    }

    const calculation = state.calculation;
    const fallback = calculateTotals();
    const sale = calculation ? parseNumber(calculation.total) : fallback.total;
    const cost = calculation ? parseNumber(calculation.custo_total) : fallback.cost;
    const profit = calculation ? parseNumber(calculation.lucro_total) : fallback.profit;
    const margin = calculation ? parseNumber(calculation.margem_percentual) : fallback.margin;
    const missingCosts = calculation
      ? Number(calculation.itens_sem_custo || 0)
      : items.filter((item) => item.custo_informado === false).length;

    const code = $('orcamento-codigo')?.value?.trim() || 'Sem número';
    const title = $('orcamento-titulo')?.value?.trim() || 'Orçamento';
    const client = $('orcamento-cliente-busca')?.value?.trim() || 'Cliente não informado';
    const emission = $('orcamento-data-emissao')?.value ? localDate($('orcamento-data-emissao').value) : localDate(new Date().toISOString());
    const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

    const rows = items.map((item, index) => {
      const costKnown = item.custo_informado !== false;
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${escapeHtml(item.descricao || 'Item sem descrição')}</strong>${item.codigo ? `<small>Cód. ${escapeHtml(item.codigo)}</small>` : ''}</td>
        <td class="num">${formatMoney(item.valor_total)}</td>
        <td class="num ${costKnown ? '' : 'missing'}">${costKnown ? formatMoney(item.custo_total) : 'Não informado'}</td>
        <td class="num">${costKnown ? formatMoney(item.lucro_total) : '—'}</td>
        <td class="num">${costKnown ? formatPercent(item.margem_percentual) : '—'}</td>
      </tr>`;
    }).join('');

    const warning = missingCosts > 0
      ? `<div class="warning"><strong>Atenção:</strong> ${missingCosts} item(ns) sem custo informado. A margem pode não representar o resultado real.</div>`
      : '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Análise financeira ${escapeHtml(code)}</title>
      <style>
        @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Inter,Arial,sans-serif;color:#17212b;margin:0;font-size:11px}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #dbe3e8;padding-bottom:14px;margin-bottom:18px}.head h1{font-size:20px;margin:3px 0 5px}.head p{margin:2px 0;color:#61717e}.internal{font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#9a6700;background:#fff7d6;border:1px solid #f0d98a;border-radius:6px;padding:6px 8px;align-self:flex-start}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 18px;margin-bottom:16px}.meta div{border-bottom:1px solid #eef2f4;padding:5px 0}.meta span{display:block;color:#74838f;font-size:9px;text-transform:uppercase}.meta strong{display:block;margin-top:3px;font-size:11px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 16px}.kpi{border:1px solid #dbe3e8;border-radius:8px;padding:10px}.kpi span{display:block;color:#74838f;font-size:9px;text-transform:uppercase}.kpi strong{display:block;margin-top:5px;font-size:16px}.warning{margin:0 0 14px;padding:9px 10px;border:1px solid #f1c56c;background:#fff8e8;border-radius:7px;color:#76500a}table{width:100%;border-collapse:collapse}th,td{padding:8px 7px;border-bottom:1px solid #e4e9ed;text-align:left;vertical-align:top}th{font-size:9px;text-transform:uppercase;color:#657681;background:#f6f8f9}.num{text-align:right;white-space:nowrap}.missing{color:#b42318;font-weight:600}td small{display:block;color:#7c8a94;margin-top:2px}.foot{margin-top:14px;color:#7c8a94;font-size:9px;display:flex;justify-content:space-between}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <div class="head"><div><p>Análise financeira do orçamento</p><h1>${escapeHtml(code)} — ${escapeHtml(title)}</h1><p>${escapeHtml(client)}</p></div><div class="internal">Documento interno</div></div>
      <div class="meta"><div><span>Cliente</span><strong>${escapeHtml(client)}</strong></div><div><span>Data de emissão</span><strong>${escapeHtml(emission)}</strong></div><div><span>Gerado em</span><strong>${escapeHtml(generatedAt)}</strong></div></div>
      <div class="kpis"><div class="kpi"><span>Valor de venda</span><strong>${formatMoney(sale)}</strong></div><div class="kpi"><span>Custo estimado</span><strong>${formatMoney(cost)}</strong></div><div class="kpi"><span>Lucro bruto</span><strong>${formatMoney(profit)}</strong></div><div class="kpi"><span>Margem</span><strong>${formatPercent(margin)}</strong></div></div>
      ${warning}
      <table><thead><tr><th>#</th><th>Item</th><th class="num">Venda</th><th class="num">Custo</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="foot"><span>Valora CRM — análise financeira</span><span>Informação de uso interno</span></div>
      <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`;

    const win = window.open('', '_blank', 'width=1180,height=820');
    if (!win) {
      toast('Permita pop-ups para imprimir a análise financeira.', 'error');
      return;
    }
    try { win.opener = null; } catch (_) {}
    win.document.write(html);
    win.document.close();
  }

  function printCurrent() {
    const html = buildPreviewHtml();
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) { toast('Permita pop-ups para gerar o PDF.', 'error'); return; }
    try { win.opener = null; } catch (_) {}
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><base href="${escapeHtml(`${window.location.origin}/`)}"><title>${escapeHtml($('orcamento-codigo').value || 'Orçamento')}</title><style>${printStyles()}</style></head><body><div class="document-preview">${html}</div><script>window.onload=()=>setTimeout(()=>window.print(),350)<\/script></body></html>`);
    win.document.close();
  }

  async function printBudget(id) {
    if (state.currentId === id && !$('budget-modal').hidden) { printCurrent(); return; }
    try {
      const budget = await api(`${API}/${id}`);
      const previous = { currentId: state.currentId, current: state.current, items: state.items, payments: state.payments, client: state.selectedClient };
      state.currentId = id; state.current = budget; state.items = (budget.itens || []).map(normalizeItem); state.payments = (budget.pagamentos || []).map(normalizePayment); state.selectedClient = null;
      fillBudgetForm(budget);
      printCurrent();
      Object.assign(state, { currentId: previous.currentId, current: previous.current, items: previous.items, payments: previous.payments, selectedClient: previous.client });
    } catch (error) { toast(error.message, 'error'); }
  }

  function printStyles() {
    const scale = currentDocumentScale();
    const s = (base, unit = 'pt') => scaledCssValue(base, unit, scale);
    if (usesDavDocument()) {
      return `*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#000}.document-preview{width:auto;margin:0;background:#fff}.dav-document{width:100%;padding:0;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:${s(9.5)}}.dav-header{position:relative;min-height:${s(18,'mm')};padding:0 31mm ${s(2,'mm')} 0;border-bottom:1px solid #000}.dav-company-title{text-align:center}.dav-company-title>strong{display:inline-block;padding:0 ${s(2,'mm')};border-bottom:1px solid #000;font-size:${s(13)};font-weight:600}.dav-company-title>span{display:block;margin-top:${s(1,'mm')};font-size:${s(9)}}.dav-company-title h1{margin:${s(3,'mm')} 0 0;font-size:${s(16)};line-height:1.1}.dav-document-meta{position:absolute;top:0;right:0;width:30mm;font-size:${s(8.5)}}.dav-document-meta div{display:grid;grid-template-columns:12mm 1fr;gap:${s(1,'mm')};min-height:${s(4,'mm')};align-items:center}.dav-document-meta b,.dav-document-meta span{text-align:right}.dav-client-table,.dav-items-table,.dav-totals-table{width:100%;border-collapse:collapse;table-layout:fixed}.dav-client-table td{min-height:${s(8,'mm')};padding:${s(1,'mm')} ${s(1.2,'mm')};border:1px solid #000;vertical-align:top}.dav-client-table label{display:block;font-size:${s(8)};font-weight:700;line-height:1.15}.dav-client-table strong{display:block;margin-top:${s(.6,'mm')};font-size:${s(9)};font-weight:400;line-height:1.25;overflow-wrap:anywhere}.dav-reference-line{min-height:${s(7,'mm')};padding:${s(1.5,'mm')} ${s(1,'mm')};border:1px solid #000;border-top:0;font-size:${s(9)};overflow-wrap:anywhere}.dav-items-table thead{display:table-header-group}.dav-items-table tr{break-inside:avoid;page-break-inside:avoid}.dav-items-table th{padding:${s(1.2,'mm')} ${s(.7,'mm')};border-bottom:1px solid #000;font-size:${s(8)};line-height:1.15;text-align:center;vertical-align:bottom}.dav-items-table th:nth-child(1){width:9%}.dav-items-table th:nth-child(2){width:35%;text-align:left}.dav-items-table th:nth-child(3){width:6%}.dav-items-table th:nth-child(4){width:7%}.dav-items-table th:nth-child(5){width:11%}.dav-items-table th:nth-child(6){width:10%}.dav-items-table th:nth-child(7){width:11%}.dav-items-table th:nth-child(8){width:11%}.dav-items-table td{padding:${s(1.5,'mm')} ${s(.8,'mm')};border-bottom:.25mm solid #aaa;font-size:${s(9)};line-height:1.25;vertical-align:top}.dav-description strong{font-weight:400}.dav-description small{display:block;margin-top:${s(.5,'mm')};font-size:${s(8)}}.dav-center{text-align:center}.dav-number{text-align:right;white-space:nowrap}.dav-empty{text-align:center}.dav-totals-table,.dav-observations,.dav-footer{break-inside:avoid;page-break-inside:avoid}.dav-totals-table td{min-height:${s(15,'mm')};border:1px solid #000;vertical-align:middle}.dav-total-spacer{width:13%}.dav-order-total{width:50%;padding:${s(1.5,'mm')} ${s(2,'mm')}}.dav-order-total>div{width:48%;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:${s(1,'mm')};vertical-align:middle}.dav-order-total b,.dav-note-total b{font-size:${s(8.5)}}.dav-order-total strong,.dav-note-total strong{font-size:${s(9.5)}}.dav-order-total span{font-size:${s(8)}}.dav-total-middle{width:15%}.dav-note-total{width:22%;padding:${s(1,'mm')} ${s(2,'mm')}}.dav-note-total div{display:flex;justify-content:space-between;gap:${s(2,'mm')};padding:${s(.7,'mm')} 0}.dav-observations{min-height:${s(35,'mm')};padding:${s(2.5,'mm')} ${s(2,'mm')};border:1px solid #000;border-top:0}.dav-observations h2{margin:0 0 ${s(4,'mm')};font-size:${s(9)}}.dav-observation-lines{font-size:${s(9)};line-height:1.45}.dav-footer{min-height:${s(5,'mm')};padding:${s(1,'mm')};border:1px solid #000;border-top:0;background:#edf7fc;text-align:center;font-size:${s(8)}}@page{size:A4 portrait;margin:8mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
    }
    return `*{box-sizing:border-box}body{margin:0;background:#fff;font-family:Arial,sans-serif;color:#263746}.document-preview{width:auto;margin:0;background:#fff}.preview-cover{min-height:265mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}.preview-cover-brand,.preview-doc-brand{display:flex;align-items:center;gap:${s(16,'px')}}.preview-cover-brand img{width:${s(76,'px')};max-height:${s(76,'px')};object-fit:contain}.preview-cover-title{margin:auto 0}.preview-cover-title h1{margin:0 0 ${s(14,'px')};color:var(--preview-color);font-size:${s(42,'px')}}.preview-cover-title p{color:#667783;font-size:${s(18,'px')}}.preview-cover-client{padding-top:${s(24,'px')};border-top:2px solid var(--preview-color)}.preview-doc-header{display:flex;justify-content:space-between;gap:${s(20,'px')};padding-bottom:${s(20,'px')};border-bottom:3px solid var(--preview-color)}.preview-doc-brand img{width:${s(58,'px')};max-height:${s(58,'px')};object-fit:contain}.preview-doc-brand h2{margin:0 0 ${s(4,'px')};font-size:${s(18,'px')}}.preview-doc-brand p,.preview-doc-meta p{margin:${s(2,'px')} 0;color:#687884;font-size:${s(10,'px')}}.preview-doc-meta{text-align:right}.preview-doc-meta h1{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(22,'px')}}.preview-title{margin:${s(22,'px')} 0 ${s(15,'px')}}.preview-title h3{margin:0 0 ${s(4,'px')};font-size:${s(17,'px')}}.preview-title p{margin:0;color:#71808b;font-size:${s(10,'px')}}.preview-client-box{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')} ${s(24,'px')};margin-bottom:${s(18,'px')};padding:${s(14,'px')} ${s(16,'px')};border:1px solid #dfe6ea;border-radius:8px;background:#f8fafb}.preview-field label{display:block;color:#82909a;font-size:${s(8,'px')};text-transform:uppercase}.preview-field strong,.preview-field span{font-size:${s(10,'px')}}.preview-items{width:100%;border-collapse:collapse}.preview-items thead{display:table-header-group}.preview-items tr{break-inside:avoid;page-break-inside:avoid}.preview-items th{padding:${s(8,'px')} ${s(7,'px')};color:#fff;background:#365465;font-size:${s(8,'px')};text-align:left}.preview-items td{padding:${s(9,'px')} ${s(7,'px')};border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')};vertical-align:top}.preview-items td small{display:block;margin-top:${s(3,'px')};color:#84919a}.preview-summary{width:310px;margin:${s(18,'px')} 0 0 auto}.preview-summary-row{display:flex;justify-content:space-between;padding:${s(7,'px')} 0;border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')}}.preview-summary-total{margin-top:${s(8,'px')};padding:${s(12,'px')} ${s(14,'px')};border-radius:7px;color:#fff;background:var(--preview-color)}.preview-summary-total span{font-size:${s(8,'px')}}.preview-summary-total strong{display:block;margin-top:${s(3,'px')};font-size:${s(17,'px')}}.preview-section{margin-top:${s(18,'px')};padding:${s(13,'px')} ${s(15,'px')};border:1px solid #dfe6ea;border-radius:8px;break-inside:avoid;page-break-inside:avoid}.preview-section h4{margin:0 0 ${s(7,'px')};font-size:${s(10,'px')}}.preview-section p,.preview-section li{font-size:${s(9,'px')};line-height:1.55;white-space:pre-line}.preview-footer{margin-top:${s(24,'px')};padding-top:${s(12,'px')};border-top:1px solid #e0e7eb;display:flex;justify-content:space-between;gap:${s(20,'px')};color:#88949c;font-size:${s(8,'px')}}.preview-service-proposal{margin:${s(18,'px')} 0;display:grid;gap:${s(12,'px')}}.preview-service-proposal-intro{padding:${s(12,'px')} ${s(14,'px')};border:1px solid #e5eaf0;border-radius:8px;background:#fbfcfd;break-inside:avoid}.preview-service-proposal-intro h4{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(11,'px')}}.preview-service-proposal-intro p,.preview-service-proposal-note p{margin:0;white-space:pre-line;color:#445066;font-size:${s(8.5,'px')};line-height:1.5}.preview-service-proposal-grid{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')}}.preview-service-proposal-section{border:1px solid #dfe5eb;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-section h5{margin:0;padding:${s(7,'px')} ${s(9,'px')};background:#f6f8fa;color:#26354a;font-size:${s(9,'px')}}.preview-service-proposal-section ul{margin:0;padding:${s(7,'px')} ${s(9,'px')} ${s(8,'px')} ${s(22,'px')}}.preview-service-proposal-section li{margin:0 0 ${s(2,'px')};color:#3e4a5f;font-size:${s(8,'px')};line-height:1.35}.preview-service-proposal-values{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dfe6ed;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-value{padding:${s(9,'px')} ${s(10,'px')};border-right:1px solid #e3e9ef}.preview-service-proposal-value:last-child{border-right:0}.preview-service-proposal-value span,.preview-service-proposal-value strong{display:block}.preview-service-proposal-value span{color:#78869a;font-size:${s(7,'px')};text-transform:uppercase}.preview-service-proposal-value strong{margin-top:${s(3,'px')};color:#1d2a3d;font-size:${s(10,'px')}}.preview-service-proposal-note{padding:${s(10,'px')} ${s(12,'px')};border-left:3px solid var(--preview-color);background:#fafcfd;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-note h5{margin:0 0 ${s(4,'px')};font-size:${s(8.5,'px')}}@page{size:A4 portrait;margin:10mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
  }

  async function sendWhatsApp(id) {
    try {
      const budget = state.currentId === id && state.current ? state.current : await api(`${API}/${id}`);
      let phone = String(budget.cliente_whatsapp || state.selectedClient?.whatsapp || '').replace(/\D/g, '');
      if (!phone) { toast('O cliente não possui WhatsApp cadastrado.', 'error'); return; }
      if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
      const message = [`Olá, ${budget.cliente_nome || 'tudo bem'}!`, '', `Segue o ${budget.nome_documento || 'orçamento'} ${budget.codigo}.`, budget.titulo, `Valor total: ${formatMoney(budget.total)}`, budget.data_validade ? `Validade: ${localDate(budget.data_validade)}` : '', '', 'Fico à disposição para esclarecer qualquer dúvida.'].filter(Boolean).join('\n');
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      if (budget.status === 'rascunho') {
        await api(`${API}/${id}/status`, { method: 'POST', body: JSON.stringify({ status: 'enviado', observacao: 'Orçamento compartilhado pelo WhatsApp.' }) });
        await loadBudgets();
      }
    } catch (error) { toast(error.message, 'error'); }
  }

  // Kits de produtos no orçamento
