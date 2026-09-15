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

  function openBudgetExportDialog(budgetId = state.currentId) {
    state.exportBudgetId = Number(budgetId || state.currentId || 0) || null;
    state.exportLastFormat = null;
    state.exportMissingAttachments = [];
    const backdrop = $('budget-export-backdrop');
    if (!backdrop) {
      toast('Não foi possível abrir as opções de download.', 'error');
      return;
    }
    hideBudgetExportRepair();
    const status = $('budget-export-status');
    if (status) status.textContent = 'Selecione um formato para iniciar o download.';
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => backdrop.classList.add('show'));
  }

  function closeBudgetExportDialog({ force = false } = {}) {
    if (state.exportBusy && !force) return;
    const backdrop = $('budget-export-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      backdrop.hidden = true;
      if (!state.exportBusy) {
        state.exportBudgetId = null;
        state.exportLastFormat = null;
        state.exportMissingAttachments = [];
        hideBudgetExportRepair();
      }
    }, 160);
  }

  function setBudgetExportBusy(busy, message = '') {
    state.exportBusy = Boolean(busy);
    const backdrop = $('budget-export-backdrop');
    backdrop?.classList.toggle('is-busy', Boolean(busy));
    $$('#budget-export-options [data-budget-export-format]').forEach((button) => {
      button.disabled = Boolean(busy);
    });
    const close = $('btn-close-budget-export');
    if (close) close.disabled = Boolean(busy);
    const repair = $('btn-budget-export-repair');
    if (repair) repair.disabled = Boolean(busy);
    const status = $('budget-export-status');
    if (status && message) status.textContent = message;
  }

  function hideBudgetExportRepair() {
    const panel = $('budget-export-repair');
    if (panel) panel.hidden = true;
  }

  function showBudgetExportRepair(skippedAttachments = []) {
    const missing = Array.isArray(skippedAttachments) ? skippedAttachments.filter(Boolean) : [];
    state.exportMissingAttachments = missing.slice();
    const panel = $('budget-export-repair');
    const title = $('budget-export-repair-title');
    const text = $('budget-export-repair-text');
    if (!panel) return;
    const count = missing.length;
    if (title) title.textContent = count === 1 ? '1 anexo antigo precisa ser recuperado' : `${count} anexos antigos precisam ser recuperados`;
    if (text) text.textContent = 'Selecione os arquivos originais uma vez. O Valora salva no banco e corrige todas as referências antigas automaticamente.';
    panel.hidden = count <= 0;
  }

  async function tryMigrateLegacyAttachments() {
    try {
      return await api('/api/arquivos-tecnicos/legados/migrar', { method: 'POST' });
    } catch (error) {
      console.warn('[orcamentos] Não foi possível executar o autorreparo de anexos:', error);
      return null;
    }
  }

  async function repairBudgetLegacyAttachments(fileList) {
    if (state.exportBusy) return;
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append('arquivos', file, file.name));
    const input = $('input-budget-export-repair');
    setBudgetExportBusy(true, `Recuperando ${files.length} arquivo(s) antigo(s)…`);
    try {
      const result = await api('/api/arquivos-tecnicos/legados/reparar', { method: 'POST', body: form });
      const repaired = Number(result?.registros_reparados || 0);
      if (repaired <= 0) {
        setBudgetExportBusy(false, 'Os arquivos selecionados não correspondem aos anexos antigos deste orçamento.');
        return;
      }
      hideBudgetExportRepair();
      setBudgetExportBusy(false, `${repaired} registro(s) recuperado(s). Gerando novamente…`);
      const lastFormat = state.exportLastFormat || 'pdf';
      await downloadBudgetExport(lastFormat, { skipMigration: true });
    } catch (error) {
      console.error('[orcamentos] Falha ao recuperar anexos antigos:', error);
      setBudgetExportBusy(false, 'Não foi possível recuperar os arquivos selecionados.');
      toast(error.message || 'Não foi possível recuperar os arquivos selecionados.', 'error', 5000);
    } finally {
      if (input) input.value = '';
    }
  }

  function safeExportFilename(value, fallback = 'documento') {
    const clean = String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 110);
    return clean || fallback;
  }

  function currentExportFilename() {
    const code = $('orcamento-codigo')?.value?.trim() || state.current?.codigo || 'orcamento';
    const documentName = state.current?.nome_documento || $('orcamento-titulo')?.value?.trim() || 'Orçamento';
    return safeExportFilename(`${documentName} - ${code}`, 'orcamento');
  }

  function downloadBlobFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler imagem.'));
      reader.readAsDataURL(blob);
    });
  }

  async function buildDownloadDocument() {
    const previewHtml = buildPreviewHtml();
    state.attachmentExportSkipped = [];
    const attachmentsHtml = await buildAttachmentPrintHtml(state.attachments);
    const skippedAttachments = Array.isArray(state.attachmentExportSkipped)
      ? state.attachmentExportSkipped.slice()
      : [];
    const title = escapeHtml($('orcamento-codigo')?.value || 'Orçamento');
    const styles = `${printStyles()}${attachmentPrintStyles()}
.budget-print-attachment-label,.budget-print-attachment-tile-label{display:none!important}`;
    const content = `<div class="document-preview">${previewHtml}</div>${attachmentsHtml}`;

    // Mantemos o CSS também dentro da raiz exportada para que o documento
    // renderizado no iframe tenha exatamente as regras do DAV, sem herdar o
    // layout da tela principal do Valora.
    const exportRoot = `<div class="budget-export-root"><style data-budget-export-style>${styles}</style>${content}</div>`;
    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><base href="${escapeHtml(`${window.location.origin}/`)}"><title>${title}</title><style>${styles}</style></head><body>${exportRoot}</body></html>`;
    return { html, title, filename: currentExportFilename(), skippedAttachments };
  }

  function waitForFrameDocument(frame) {
    return new Promise((resolve) => {
      const doc = frame.contentDocument;
      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        try {
          const images = Array.from(doc?.images || []);
          await Promise.all(images.map((img) => img.complete
            ? Promise.resolve()
            : new Promise((done) => {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
              })));
          if (doc?.fonts?.ready) await doc.fonts.ready;
        } catch (_) {}
        resolve();
      };
      if (doc?.readyState === 'complete') finish();
      else frame.addEventListener('load', finish, { once: true });
      setTimeout(finish, 3500);
    });
  }

  function frameLibraryScriptSource(kind) {
    const patterns = {
      html2canvas: /html2canvas(?:\.min)?\.js/i,
      jspdf: /jspdf(?:\.umd)?(?:\.min)?\.js/i,
    };
    const fallbacks = {
      html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    };
    const pattern = patterns[kind];
    const loadedScript = Array.from(document.scripts || []).find((script) => pattern?.test(script.src || ''));
    return loadedScript?.src || fallbacks[kind];
  }

  function loadFrameScript(doc, src, label) {
    return new Promise((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Não foi possível carregar ${label}.`));
      doc.head.appendChild(script);
    });
  }

  async function ensureFramePdfLibraries(frame) {
    const win = frame?.contentWindow;
    const doc = frame?.contentDocument;
    if (!win || !doc) throw new Error('Não foi possível preparar o gerador de PDF.');

    if (typeof win.html2canvas !== 'function') {
      await loadFrameScript(doc, frameLibraryScriptSource('html2canvas'), 'o renderizador do PDF');
    }
    if (!(win.jspdf?.jsPDF || win.jsPDF)) {
      await loadFrameScript(doc, frameLibraryScriptSource('jspdf'), 'o gerador do PDF');
    }

    const html2canvas = win.html2canvas;
    const jsPDF = win.jspdf?.jsPDF || win.jsPDF;
    if (typeof html2canvas !== 'function' || typeof jsPDF !== 'function') {
      throw new Error('O gerador de PDF não ficou disponível. Atualize a página e tente novamente.');
    }
    return { html2canvas, jsPDF };
  }

  function stabilizeDavPdfLayout(doc) {
    const root = doc?.querySelector('.budget-export-root');
    const preview = doc?.querySelector('.document-preview');
    const dav = doc?.querySelector('.dav-document');
    if (!root || !preview || !dav) return root || doc?.body;

    // 194 mm = 210 mm do A4 - 8 mm de margem de cada lado.
    // Mantemos a árvore em largura física fixa. O PDF V39 não usa mais o
    // Worker do html2pdf; ele renderiza o canvas e pagina manualmente com jsPDF.
    const width = '194mm';
    [doc.documentElement, doc.body, root, preview, dav].forEach((element) => {
      if (!element) return;
      element.style.boxSizing = 'border-box';
      element.style.marginLeft = '0';
      element.style.marginRight = '0';
      element.style.maxWidth = 'none';
      element.style.transform = 'none';
      element.style.zoom = '1';
    });

    doc.documentElement.style.width = width;
    doc.documentElement.style.minWidth = width;
    doc.body.style.width = width;
    doc.body.style.minWidth = width;
    doc.body.style.overflow = 'visible';

    root.style.width = width;
    root.style.minWidth = width;
    root.style.padding = '0';
    root.style.overflow = 'visible';

    preview.style.width = width;
    preview.style.minWidth = width;
    preview.style.padding = '0';
    preview.style.overflow = 'visible';

    dav.style.width = width;
    dav.style.minWidth = width;
    dav.style.height = 'auto';
    dav.style.minHeight = '0';
    dav.style.padding = '0';
    dav.style.position = 'static';
    dav.style.left = 'auto';
    dav.style.top = 'auto';
    dav.style.overflow = 'visible';

    return root;
  }

  function collectPdfBreakRanges(target, canvas) {
    const targetRect = target.getBoundingClientRect();
    const cssHeight = Math.max(1, target.scrollHeight || target.offsetHeight || targetRect.height || 1);
    const scaleY = canvas.height / cssHeight;
    const ranges = [];
    const hardBreaks = [];

    const addRange = (element) => {
      const rect = element.getBoundingClientRect();
      const topCss = rect.top - targetRect.top + (target.scrollTop || 0);
      const bottomCss = rect.bottom - targetRect.top + (target.scrollTop || 0);
      const top = Math.max(0, Math.round(topCss * scaleY));
      const bottom = Math.min(canvas.height, Math.round(bottomCss * scaleY));
      if (bottom > top) ranges.push({ top, bottom });
    };

    target.querySelectorAll('.dav-items-table tbody tr,.dav-totals-table,.dav-observations,.dav-footer').forEach(addRange);
    target.querySelectorAll('.budget-print-attachment').forEach((element) => {
      addRange(element);
      const rect = element.getBoundingClientRect();
      const topCss = rect.top - targetRect.top + (target.scrollTop || 0);
      const top = Math.max(0, Math.round(topCss * scaleY));
      if (top > 0) hardBreaks.push(top);
    });

    return {
      ranges: ranges.sort((a, b) => a.top - b.top),
      hardBreaks: hardBreaks.sort((a, b) => a - b),
    };
  }

  function choosePdfSliceEnd(start, naturalEnd, pageHeightPx, breakData, canvasHeight) {
    let end = Math.min(naturalEnd, canvasHeight);
    if (end >= canvasHeight) return canvasHeight;

    // Anexos sempre começam em página nova quando o início deles estiver
    // dentro da página atual.
    const hardBreak = breakData.hardBreaks.find((point) => point > start + 8 && point < end - 8);
    if (hardBreak) end = hardBreak;

    // Evita partir linhas/totais/observações exatamente na quebra de página.
    const containing = breakData.ranges.find((range) => range.top < end && range.bottom > end);
    if (containing) {
      const minimumUsefulHeight = pageHeightPx * 0.28;
      if (containing.top - start >= minimumUsefulHeight) end = containing.top;
    }

    // Segurança contra loop infinito em elementos maiores que uma página.
    if (end <= start + 8) end = Math.min(start + pageHeightPx, canvasHeight);
    return end;
  }

  function downloadGeneratedBlob(blob, filename) {
    if (!blob || typeof blob.size !== 'number' || blob.size <= 0) {
      throw new Error('O PDF foi gerado vazio e o download foi cancelado.');
    }

    // IMPORTANTE: o jsPDF é carregado dentro do iframe de renderização, mas o
    // download precisa ser disparado pela janela principal. pdf.save() tentava
    // clicar a partir do iframe oculto e, em Chrome/Opera, podia simplesmente
    // não iniciar download nenhum apesar de não lançar erro.
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);

    try {
      anchor.click();
    } finally {
      anchor.remove();
      // Não revoga imediatamente: alguns navegadores só começam a consumir a
      // URL depois que a pilha atual termina.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 15000);
    }
  }

  async function saveCanvasAsA4Pdf({ canvas, target, doc, jsPDF, filename, marginMm }) {
    const pageWidthMm = 210;
    const pageHeightMm = 297;
    const contentWidthMm = pageWidthMm - (marginMm * 2);
    const contentHeightMm = pageHeightMm - (marginMm * 2);
    const pxPerMm = canvas.width / contentWidthMm;
    const naturalPageHeightPx = Math.max(1, Math.floor(contentHeightMm * pxPerMm));
    const breakData = collectPdfBreakRanges(target, canvas);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });

    let start = 0;
    let pageIndex = 0;
    while (start < canvas.height) {
      const naturalEnd = Math.min(start + naturalPageHeightPx, canvas.height);
      const end = choosePdfSliceEnd(start, naturalEnd, naturalPageHeightPx, breakData, canvas.height);
      const sliceHeight = Math.max(1, end - start);
      const slice = doc.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sliceHeight;
      const context = slice.getContext('2d', { alpha: false });
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(canvas, 0, start, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

      if (pageIndex > 0) pdf.addPage('a4', 'portrait');
      const sliceHeightMm = sliceHeight / pxPerMm;
      pdf.addImage(slice.toDataURL('image/jpeg', 0.985), 'JPEG', marginMm, marginMm, contentWidthMm, sliceHeightMm, undefined, 'FAST');

      // Libera a memória do canvas temporário antes da próxima página.
      slice.width = 1;
      slice.height = 1;
      start = end;
      pageIndex += 1;
    }

    const safeFilename = `${String(filename || 'documento').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento'}.pdf`;
    const blob = pdf.output('blob');
    downloadGeneratedBlob(blob, safeFilename);
    return { filename: safeFilename, size: blob.size };
  }

  async function exportCurrentAsPdf(documentData) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-12000px',
      top: '0',
      width: usesDavDocument() ? '194mm' : '794px',
      height: '1123px',
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
      background: '#fff',
    });
    document.body.appendChild(frame);

    try {
      const doc = frame.contentDocument;
      doc.open();
      doc.write(documentData.html);
      doc.close();
      await waitForFrameDocument(frame);

      const { html2canvas, jsPDF } = await ensureFramePdfLibraries(frame);
      const davMode = usesDavDocument();
      const marginMm = davMode ? 8 : 10;
      const target = davMode
        ? stabilizeDavPdfLayout(doc)
        : (doc.querySelector('.budget-export-root') || doc.body);

      await new Promise((resolve) => frame.contentWindow.requestAnimationFrame(() => frame.contentWindow.requestAnimationFrame(resolve)));

      const rect = target.getBoundingClientRect();
      const renderWidth = Math.max(
        1,
        Math.ceil(target.scrollWidth || 0),
        Math.ceil(target.offsetWidth || 0),
        Math.ceil(rect.width || 0),
      );
      const renderHeight = Math.max(
        1,
        Math.ceil(target.scrollHeight || 0),
        Math.ceil(target.offsetHeight || 0),
        Math.ceil(rect.height || 0),
      );

      // V40: renderização direta + download disparado pela janela principal. O
      // Worker do html2pdf não participa do fluxo e o iframe não tenta baixar o arquivo.
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        scrollX: 0,
        scrollY: 0,
        width: renderWidth,
        height: renderHeight,
        windowWidth: renderWidth,
        windowHeight: Math.max(renderHeight, 1123),
      });

      await saveCanvasAsA4Pdf({
        canvas,
        target,
        doc,
        jsPDF,
        filename: documentData.filename,
        marginMm,
      });

      canvas.width = 1;
      canvas.height = 1;
    } finally {
      frame.remove();
    }
  }

  async function exportCurrentAsWord(documentData) {
    const parsed = new DOMParser().parseFromString(documentData.html, 'text/html');
    const images = Array.from(parsed.images || []);
    await Promise.all(images.map(async (img) => {
      const source = img.getAttribute('src');
      if (!source || source.startsWith('data:')) return;
      try {
        const absoluteUrl = new URL(source, window.location.origin).href;
        const response = await fetch(absoluteUrl, { credentials: 'same-origin', cache: 'no-cache' });
        if (!response.ok) return;
        img.src = await blobToDataUrl(await response.blob());
      } catch (_) {}
    }));

    parsed.querySelectorAll('.budget-print-attachment-label,.budget-print-attachment-tile-label').forEach((element) => element.remove());
    // O CSS duplicado dentro da raiz garante que a exportação isolada mantenha
    // Word mantemos apenas a cópia do <head>, evitando uma folha de estilo
    // repetida dentro do corpo do documento.
    parsed.querySelectorAll('style[data-budget-export-style]').forEach((element) => element.remove());
    const wordHtml = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><meta name="ProgId" content="Word.Document"><title>${escapeHtml(documentData.title)}</title>${parsed.head.querySelector('style')?.outerHTML || ''}<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>90</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml></head><body>${parsed.body.innerHTML}</body></html>`;
    const blob = new Blob(['\ufeff', wordHtml], { type: 'application/msword;charset=utf-8' });
    downloadBlobFile(blob, `${documentData.filename}.doc`);
  }

  async function withBudgetExportContext(budgetId, callback) {
    const id = Number(budgetId || state.currentId || 0);
    if (!id || (state.currentId === id && state.current)) return callback();

    const budget = await api(`${API}/${id}`);
    const previous = {
      currentId: state.currentId,
      current: state.current,
      items: state.items,
      payments: state.payments,
      attachments: state.attachments,
      attachmentSelection: state.attachmentSelection,
      attachmentImageLayout: state.attachmentImageLayout,
      client: state.selectedClient,
      serviceProposalModel: state.serviceProposalModel,
      serviceProposalData: state.serviceProposalData,
    };

    state.currentId = id;
    state.current = budget;
    state.items = (budget.itens || []).map(normalizeItem);
    state.payments = (budget.pagamentos || []).map(normalizePayment);
    state.attachments = Array.isArray(budget.anexos) ? budget.anexos.map((item) => ({ ...item })) : [];
    state.attachmentSelection = state.attachments.map((item) => Number(item.id)).filter(Boolean);
    state.attachmentImageLayout = [1, 2, 4, 6].includes(Number(budget.anexos_imagens_por_pagina))
      ? Number(budget.anexos_imagens_por_pagina)
      : 1;
    state.selectedClient = null;
    fillBudgetForm(budget);

    try {
      return await callback();
    } finally {
      Object.assign(state, {
        currentId: previous.currentId,
        current: previous.current,
        items: previous.items,
        payments: previous.payments,
        attachments: previous.attachments,
        attachmentSelection: previous.attachmentSelection,
        attachmentImageLayout: previous.attachmentImageLayout,
        selectedClient: previous.client,
        serviceProposalModel: previous.serviceProposalModel,
        serviceProposalData: previous.serviceProposalData,
      });
      renderBudgetAttachments();
    }
  }

  async function downloadBudgetExport(format, { skipMigration = false } = {}) {
    if (state.exportBusy) return;
    const normalized = String(format || '').toLowerCase();
    if (!['pdf', 'word'].includes(normalized)) return;

    const targetId = state.exportBudgetId || state.currentId;
    state.exportLastFormat = normalized;
    let skippedAttachments = [];
    setBudgetExportBusy(true, normalized === 'pdf' ? 'Gerando PDF…' : 'Preparando arquivo do Word…');
    try {
      // Antes de renderizar, tenta recuperar tudo que ainda exista no storage
      // antigo ou em outra cópia já salva no banco.
      if (!skipMigration) await tryMigrateLegacyAttachments();

      await withBudgetExportContext(targetId, async () => {
        const documentData = await buildDownloadDocument();
        skippedAttachments = Array.isArray(documentData.skippedAttachments)
          ? documentData.skippedAttachments.slice()
          : [];
        if (normalized === 'pdf') await exportCurrentAsPdf(documentData);
        else await exportCurrentAsWord(documentData);
      });

      const formatLabel = normalized === 'pdf' ? 'PDF' : 'Documento do Word';
      const skippedCount = skippedAttachments.length;
      if (skippedCount > 0) {
        // Não joga mais um toast vermelho enorme nem fecha o modal. O download
        // continua, e o próprio modal oferece o reparo definitivo em um clique.
        setBudgetExportBusy(false, `${formatLabel} baixado. Recupere os ${skippedCount} anexo(s) antigo(s) abaixo para gerar a versão completa.`);
        showBudgetExportRepair(skippedAttachments);
        return;
      }

      state.exportMissingAttachments = [];
      hideBudgetExportRepair();
      setBudgetExportBusy(false, 'Download iniciado.');
      setTimeout(() => closeBudgetExportDialog({ force: true }), 350);
      toast(`${formatLabel} baixado.`, 'success');
    } catch (error) {
      console.error('[orcamentos] Falha ao exportar documento:', error);
      setBudgetExportBusy(false, 'Não foi possível gerar o arquivo.');
      toast(error.message || 'Não foi possível gerar o arquivo.', 'error', 5000);
    }
  }


  async function printCurrent() {
    openBudgetExportDialog(state.currentId);
  }

  async function printBudget(id) {
    openBudgetExportDialog(id);
  }

  function printStyles() {
    const scale = currentDocumentScale();
    const s = (base, unit = 'pt') => scaledCssValue(base, unit, scale);
    if (usesDavDocument()) {
      return `*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:auto!important;min-width:0!important;max-width:none!important;background:#fff!important;font-family:Arial,sans-serif;color:#000;overflow:visible!important}.budget-export-root{width:100%!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}.document-preview{width:100%!important;min-width:0!important;max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;background:#fff!important;box-shadow:none!important;overflow:visible!important}.dav-document{width:100%!important;min-width:0!important;max-width:none!important;min-height:0!important;height:auto!important;margin:0!important;padding:0!important;display:block!important;flex:none!important;background:#fff;color:#000;font-family:Arial,sans-serif;font-size:${s(9.5)}}.dav-header{position:relative;min-height:${s(18,'mm')};padding:0 31mm ${s(2,'mm')} 0;border-bottom:1px solid #000}.dav-company-title{text-align:center}.dav-company-title>strong{display:inline-block;padding:0 ${s(2,'mm')};border-bottom:1px solid #000;font-size:${s(13)};font-weight:600}.dav-company-title>span{display:block;margin-top:${s(1,'mm')};font-size:${s(9)}}.dav-company-title h1{margin:${s(3,'mm')} 0 0;font-size:${s(16)};line-height:1.1}.dav-document-meta{position:absolute;top:0;right:0;width:30mm;font-size:${s(8.5)}}.dav-document-meta div{display:grid;grid-template-columns:12mm 1fr;gap:${s(1,'mm')};min-height:${s(4,'mm')};align-items:center}.dav-document-meta b,.dav-document-meta span{text-align:right}.dav-client-table,.dav-items-table,.dav-totals-table{width:100%;border-collapse:collapse;table-layout:fixed}.dav-client-table td{height:auto!important;min-height:${s(8,'mm')};padding:${s(1,'mm')} ${s(1.2,'mm')};border:1px solid #000;vertical-align:top}.dav-client-table label{display:block;font-size:${s(8)};font-weight:700;line-height:1.15}.dav-client-table strong{display:block;margin-top:${s(.6,'mm')};font-size:${s(9)};font-weight:400;line-height:1.25;overflow-wrap:anywhere}.dav-reference-line{height:auto!important;min-height:${s(7,'mm')};padding:${s(1.5,'mm')} ${s(1,'mm')};border:1px solid #000;border-top:0;font-size:${s(9)};overflow-wrap:anywhere;white-space:normal!important;text-overflow:clip!important}.dav-items-table thead{display:table-header-group}.dav-items-table tr{break-inside:avoid;page-break-inside:avoid}.dav-items-table th{height:auto!important;padding:${s(1.2,'mm')} ${s(.7,'mm')};border-bottom:1px solid #000;font-size:${s(8)};line-height:1.15;text-align:center;vertical-align:bottom}.dav-items-table .dav-col-code{width:8%}.dav-items-table .dav-col-description{width:39%}.dav-items-table .dav-col-unit{width:5.5%}.dav-items-table .dav-col-quantity{width:6.5%}.dav-items-table .dav-col-unit-value{width:10.5%}.dav-items-table .dav-col-discount{width:9%}.dav-items-table .dav-col-net-value{width:10.5%}.dav-items-table .dav-col-total{width:11%}.dav-items-table th:nth-child(2){text-align:left}.dav-items-table td{height:auto!important;min-width:0;padding:${s(1.5,'mm')} ${s(.8,'mm')};overflow:hidden;border-bottom:.25mm solid #aaa;font-size:${s(8.6)};line-height:1.25;vertical-align:top}.dav-description{min-width:0;white-space:normal;overflow-wrap:anywhere;word-break:normal}.dav-description strong,.dav-description small{display:block;max-width:100%;white-space:normal;overflow-wrap:anywhere;word-break:normal}.dav-description strong{font-weight:400}.dav-description small{margin-top:${s(.5,'mm')};font-size:${s(7.6)}}.dav-code,.dav-center,.dav-number{overflow:hidden}.dav-center{text-align:center;white-space:nowrap}.dav-number{text-align:right;white-space:nowrap}.dav-empty{text-align:center}.dav-totals-table,.dav-observations,.dav-footer{break-inside:avoid;page-break-inside:avoid}.dav-totals-table td{min-height:${s(15,'mm')};border:1px solid #000;vertical-align:middle}.dav-total-spacer{width:13%}.dav-order-total{width:50%;white-space:normal!important;padding:${s(1.5,'mm')} ${s(2,'mm')}}.dav-order-total>div{width:48%;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:${s(1,'mm')};vertical-align:middle}.dav-order-total b,.dav-note-total b{font-size:${s(8.5)}}.dav-order-total strong,.dav-note-total strong{font-size:${s(9.5)}}.dav-order-total span{font-size:${s(8)}}.dav-total-middle{width:15%}.dav-note-total{width:22%;padding:${s(1,'mm')} ${s(2,'mm')}}.dav-note-total div{display:flex;justify-content:space-between;gap:${s(2,'mm')};padding:${s(.7,'mm')} 0}.dav-observations{min-height:${s(35,'mm')};height:auto!important;flex:none!important;padding:${s(2.5,'mm')} ${s(2,'mm')};border:1px solid #000;border-top:0}.dav-observations h2{margin:0 0 ${s(4,'mm')};font-size:${s(9)}}.dav-observation-lines{font-size:${s(9)};line-height:1.45}.dav-footer{min-height:${s(5,'mm')};padding:${s(1,'mm')};border:1px solid #000;border-top:0;background:#edf7fc;text-align:center;font-size:${s(8)}}@page{size:A4 portrait;margin:8mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
    }
    return `*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:auto!important;min-width:0!important;max-width:none!important;background:#fff!important;font-family:Arial,sans-serif;color:#263746;overflow:visible!important}.budget-export-root{width:100%!important;min-width:0!important;max-width:none!important;margin:0!important;padding:0!important;background:#fff!important;overflow:visible!important}.document-preview{width:100%!important;min-width:0!important;max-width:none!important;min-height:0!important;margin:0!important;padding:0!important;background:#fff!important;box-shadow:none!important;overflow:visible!important}.preview-cover{min-height:265mm;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always}.preview-cover-brand,.preview-doc-brand{display:flex;align-items:center;gap:${s(16,'px')}}.preview-cover-brand img{width:${s(76,'px')};max-height:${s(76,'px')};object-fit:contain}.preview-cover-title{margin:auto 0}.preview-cover-title h1{margin:0 0 ${s(14,'px')};color:var(--preview-color);font-size:${s(42,'px')}}.preview-cover-title p{color:#667783;font-size:${s(18,'px')}}.preview-cover-client{padding-top:${s(24,'px')};border-top:2px solid var(--preview-color)}.preview-doc-header{display:flex;justify-content:space-between;gap:${s(20,'px')};padding-bottom:${s(20,'px')};border-bottom:3px solid var(--preview-color)}.preview-doc-brand img{width:${s(58,'px')};max-height:${s(58,'px')};object-fit:contain}.preview-doc-brand h2{margin:0 0 ${s(4,'px')};font-size:${s(18,'px')}}.preview-doc-brand p,.preview-doc-meta p{margin:${s(2,'px')} 0;color:#687884;font-size:${s(10,'px')}}.preview-doc-meta{text-align:right}.preview-doc-meta h1{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(22,'px')}}.preview-title{margin:${s(22,'px')} 0 ${s(15,'px')}}.preview-title h3{margin:0 0 ${s(4,'px')};font-size:${s(17,'px')}}.preview-title p{margin:0;color:#71808b;font-size:${s(10,'px')}}.preview-client-box{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')} ${s(24,'px')};margin-bottom:${s(18,'px')};padding:${s(14,'px')} ${s(16,'px')};border:1px solid #dfe6ea;border-radius:8px;background:#f8fafb}.preview-field label{display:block;color:#82909a;font-size:${s(8,'px')};text-transform:uppercase}.preview-field strong,.preview-field span{font-size:${s(10,'px')}}.preview-items{width:100%;border-collapse:collapse}.preview-items thead{display:table-header-group}.preview-items tr{break-inside:avoid;page-break-inside:avoid}.preview-items th{padding:${s(8,'px')} ${s(7,'px')};color:#fff;background:#365465;font-size:${s(8,'px')};text-align:left}.preview-items td{padding:${s(9,'px')} ${s(7,'px')};border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')};vertical-align:top}.preview-items td small{display:block;margin-top:${s(3,'px')};color:#84919a}.preview-summary{width:310px;margin:${s(18,'px')} 0 0 auto}.preview-summary-row{display:flex;justify-content:space-between;padding:${s(7,'px')} 0;border-bottom:1px solid #e2e8eb;font-size:${s(9,'px')}}.preview-summary-total{margin-top:${s(8,'px')};padding:${s(12,'px')} ${s(14,'px')};border-radius:7px;color:#fff;background:var(--preview-color)}.preview-summary-total span{font-size:${s(8,'px')}}.preview-summary-total strong{display:block;margin-top:${s(3,'px')};font-size:${s(17,'px')}}.preview-section{margin-top:${s(18,'px')};padding:${s(13,'px')} ${s(15,'px')};border:1px solid #dfe6ea;border-radius:8px;break-inside:avoid;page-break-inside:avoid}.preview-section h4{margin:0 0 ${s(7,'px')};font-size:${s(10,'px')}}.preview-section p,.preview-section li{font-size:${s(9,'px')};line-height:1.55;white-space:pre-line}.preview-footer{margin-top:${s(24,'px')};padding-top:${s(12,'px')};border-top:1px solid #e0e7eb;display:flex;justify-content:space-between;gap:${s(20,'px')};color:#88949c;font-size:${s(8,'px')}}.preview-service-proposal{margin:${s(18,'px')} 0;display:grid;gap:${s(12,'px')}}.preview-service-proposal-intro{padding:${s(12,'px')} ${s(14,'px')};border:1px solid #e5eaf0;border-radius:8px;background:#fbfcfd;break-inside:avoid}.preview-service-proposal-intro h4{margin:0 0 ${s(6,'px')};color:var(--preview-color);font-size:${s(11,'px')}}.preview-service-proposal-intro p,.preview-service-proposal-note p{margin:0;white-space:pre-line;color:#445066;font-size:${s(8.5,'px')};line-height:1.5}.preview-service-proposal-grid{display:grid;grid-template-columns:1fr 1fr;gap:${s(8,'px')}}.preview-service-proposal-section{border:1px solid #dfe5eb;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-section h5{margin:0;padding:${s(7,'px')} ${s(9,'px')};background:#f6f8fa;color:#26354a;font-size:${s(9,'px')}}.preview-service-proposal-section ul{margin:0;padding:${s(7,'px')} ${s(9,'px')} ${s(8,'px')} ${s(22,'px')}}.preview-service-proposal-section li{margin:0 0 ${s(2,'px')};color:#3e4a5f;font-size:${s(8,'px')};line-height:1.35}.preview-service-proposal-values{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dfe6ed;border-radius:8px;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-value{padding:${s(9,'px')} ${s(10,'px')};border-right:1px solid #e3e9ef}.preview-service-proposal-value:last-child{border-right:0}.preview-service-proposal-value span,.preview-service-proposal-value strong{display:block}.preview-service-proposal-value span{color:#78869a;font-size:${s(7,'px')};text-transform:uppercase}.preview-service-proposal-value strong{margin-top:${s(3,'px')};color:#1d2a3d;font-size:${s(10,'px')}}.preview-service-proposal-note{padding:${s(10,'px')} ${s(12,'px')};border-left:3px solid var(--preview-color);background:#fafcfd;break-inside:avoid;page-break-inside:avoid}.preview-service-proposal-note h5{margin:0 0 ${s(4,'px')};font-size:${s(8.5,'px')}}@page{size:A4 portrait;margin:10mm}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
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
