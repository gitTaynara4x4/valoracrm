/*
 * ValoraCRM · Orçamentos · anexos.js
 * Biblioteca Geral, seleção persistida e preparação dos documentos anexos para impressão.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function attachmentIcon(file) {
    const ext = String(file?.extensao || '').toLowerCase();
    if (ext === '.pdf') return 'fa-file-pdf';
    if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) || file?.is_image) return 'fa-file-image';
    if (['.doc', '.docx'].includes(ext)) return 'fa-file-word';
    if (['.xls', '.xlsx'].includes(ext)) return 'fa-file-excel';
    return 'fa-file-lines';
  }

  function formatAttachmentBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }

  function renderBudgetAttachments() {
    const host = $('budget-attachments-list');
    const button = $('btn-selecionar-anexos-orcamento');
    const help = $('budget-attachments-help');
    if (!host || !button || !help) return;

    button.disabled = !state.currentId;
    button.title = state.currentId ? 'Selecionar documentos da Biblioteca Geral' : 'Salve o orçamento primeiro';
    help.textContent = state.currentId
      ? 'Somente PDFs e imagens podem ser impressos junto com o orçamento.'
      : 'Salve o orçamento para vincular documentos da Biblioteca Geral.';

    const items = Array.isArray(state.attachments) ? state.attachments : [];
    if (!items.length) {
      host.innerHTML = '';
      return;
    }

    host.innerHTML = items.map((file) => `
      <div class="budget-attachment-item" data-budget-attachment-id="${Number(file.id)}">
        <span class="budget-attachment-icon"><i class="fa-solid ${attachmentIcon(file)}"></i></span>
        <div class="budget-attachment-copy">
          <strong title="${escapeHtml(file.arquivo_nome || file.titulo || 'Documento')}">${escapeHtml(file.titulo || file.arquivo_nome || 'Documento')}</strong>
          <span>${escapeHtml(file.pasta_nome || 'Biblioteca geral')} • ${formatAttachmentBytes(file.tamanho_bytes)}</span>
        </div>
        <button class="budget-attachment-remove" type="button" data-remove-budget-attachment="${Number(file.id)}" title="Remover do orçamento" aria-label="Remover ${escapeHtml(file.arquivo_nome || 'documento')}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');
  }

  function attachmentSearchText(file) {
    return [file?.pasta_nome, file?.titulo, file?.arquivo_nome, file?.descricao]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function renderAttachmentPickerLibrary() {
    const host = $('budget-attachments-library');
    if (!host) return;
    const rawSearch = String($('budget-attachments-search')?.value || '').trim();
    const search = rawSearch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const selected = new Set((state.attachmentSelection || []).map(Number));
    const files = (state.attachmentLibrary || []).filter((file) => !search || attachmentSearchText(file).includes(search));

    if (!files.length) {
      host.innerHTML = `<div class="budget-attachments-empty">${search ? 'Nenhum documento encontrado para esta busca.' : 'Nenhum PDF ou imagem disponível na Biblioteca Geral.'}</div>`;
      updateAttachmentSelectionCount();
      return;
    }

    const groups = new Map();
    files.forEach((file) => {
      const key = file.pasta_nome || 'Sem pasta';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(file);
    });

    host.innerHTML = Array.from(groups.entries()).map(([folder, group]) => `
      <section class="budget-attachments-folder">
        <h4 class="budget-attachments-folder-title"><i class="fa-solid fa-folder"></i> ${escapeHtml(folder)}</h4>
        ${group.map((file) => {
          const checked = selected.has(Number(file.id));
          return `
            <label class="budget-attachment-choice ${checked ? 'is-selected' : ''}" data-attachment-choice="${Number(file.id)}">
              <input type="checkbox" value="${Number(file.id)}" ${checked ? 'checked' : ''} />
              <span class="budget-attachment-icon"><i class="fa-solid ${attachmentIcon(file)}"></i></span>
              <span class="budget-attachment-copy">
                <strong>${escapeHtml(file.titulo || file.arquivo_nome || 'Documento')}</strong>
                <span>${escapeHtml(file.arquivo_nome || '')} • ${formatAttachmentBytes(file.tamanho_bytes)}</span>
              </span>
            </label>`;
        }).join('')}
      </section>
    `).join('');
    updateAttachmentSelectionCount();
  }

  function updateAttachmentSelectionCount() {
    const el = $('budget-attachments-selection-count');
    if (!el) return;
    const count = (state.attachmentSelection || []).length;
    el.textContent = `${count} ${count === 1 ? 'selecionado' : 'selecionados'}`;
  }

  async function openBudgetAttachmentPicker() {
    if (!state.currentId) {
      toast('Salve o orçamento antes de adicionar documentos anexos.', 'error');
      return;
    }
    state.attachmentSelection = (state.attachments || []).map((item) => Number(item.id)).filter(Boolean);
    state.attachmentLibrary = [];
    if ($('budget-attachments-search')) $('budget-attachments-search').value = '';
    $('budget-attachments-library').innerHTML = '<div class="budget-attachments-empty"><i class="fa-solid fa-spinner fa-spin"></i>&nbsp; Carregando documentos...</div>';
    updateAttachmentSelectionCount();
    openOverlay('budget-attachments-modal');
    try {
      const data = await api('/api/arquivos-tecnicos/geral/arquivos?somente_imprimiveis=true');
      state.attachmentLibrary = Array.isArray(data?.items) ? data.items : [];
      renderAttachmentPickerLibrary();
    } catch (error) {
      $('budget-attachments-library').innerHTML = `<div class="budget-attachments-empty">${escapeHtml(error.message || 'Não foi possível carregar a Biblioteca Geral.')}</div>`;
      toast(error.message || 'Não foi possível carregar a Biblioteca Geral.', 'error');
    }
  }

  async function saveBudgetAttachmentSelection() {
    if (!state.currentId) return;
    const button = $('btn-salvar-anexos-orcamento');
    try {
      setButtonLoading(button, true, 'Salvando...');
      const result = await api(`${API}/${state.currentId}/anexos`, {
        method: 'PUT',
        body: JSON.stringify({ arquivo_ids: state.attachmentSelection || [] }),
      });
      state.attachments = Array.isArray(result?.items) ? result.items : [];
      if (state.current) state.current.anexos = state.attachments.map((item) => ({ ...item }));
      renderBudgetAttachments();
      closeOverlay('budget-attachments-modal');
      toast('Documentos anexos atualizados.');
    } catch (error) {
      toast(error.message || 'Não foi possível salvar os documentos anexos.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  async function removeBudgetAttachment(fileId) {
    if (!state.currentId) return;
    const id = Number(fileId);
    const next = (state.attachments || []).map((item) => Number(item.id)).filter((value) => value && value !== id);
    try {
      const result = await api(`${API}/${state.currentId}/anexos`, {
        method: 'PUT',
        body: JSON.stringify({ arquivo_ids: next }),
      });
      state.attachments = Array.isArray(result?.items) ? result.items : [];
      state.attachmentSelection = state.attachments.map((item) => Number(item.id)).filter(Boolean);
      if (state.current) state.current.anexos = state.attachments.map((item) => ({ ...item }));
      renderBudgetAttachments();
      toast('Documento removido do orçamento.');
    } catch (error) {
      toast(error.message || 'Não foi possível remover o documento.', 'error');
    }
  }

  async function buildAttachmentPrintHtml(attachments = state.attachments) {
    const files = (Array.isArray(attachments) ? attachments : []).filter((file) => file?.imprimivel !== false);
    if (!files.length) return '';
    const pages = [];

    for (const file of files) {
      const id = Number(file.id);
      const ext = String(file.extensao || '').toLowerCase();
      const title = escapeHtml(file.titulo || file.arquivo_nome || 'Documento anexo');
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        pages.push(`<section class="budget-print-attachment"><div class="budget-print-attachment-label">${title}</div><img src="${escapeHtml(file.url || `/api/arquivos-tecnicos/arquivos/${id}/conteudo`)}" alt="${title}" /></section>`);
        continue;
      }
      if (ext === '.pdf' || String(file.mime_type || '').toLowerCase() === 'application/pdf') {
        let info;
        try {
          info = await api(`/api/arquivos-tecnicos/arquivos/${id}/paginas`);
        } catch (error) {
          throw new Error(`Não foi possível preparar “${file.arquivo_nome || file.titulo || 'PDF'}” para impressão: ${error.message || 'erro no PDF'}`);
        }
        const pageCount = Number(info?.paginas || 0);
        for (let page = 1; page <= pageCount; page += 1) {
          pages.push(`<section class="budget-print-attachment"><div class="budget-print-attachment-label">${title} • página ${page}/${pageCount}</div><img src="/api/arquivos-tecnicos/arquivos/${id}/paginas/${page}.png" alt="${title} — página ${page}" /></section>`);
        }
      }
    }
    return pages.join('');
  }

  function attachmentPrintStyles() {
    return `
      .budget-print-attachment{break-before:page;page-break-before:always;width:100%;height:276mm;display:flex;align-items:center;justify-content:center;position:relative;background:#fff;overflow:hidden}
      .budget-print-attachment img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
      .budget-print-attachment-label{position:absolute;left:0;right:0;bottom:0;padding:1.5mm 2mm;background:rgba(255,255,255,.92);color:#66727b;font:7pt Inter,Arial,sans-serif;text-align:right}
      @media print{.budget-print-attachment{-webkit-print-color-adjust:exact;print-color-adjust:exact}.budget-print-attachment-label{display:none!important}}
    `;
  }
