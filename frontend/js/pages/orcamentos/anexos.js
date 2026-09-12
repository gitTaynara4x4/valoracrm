/*
 * ValoraCRM · Orçamentos · anexos.js
 * Biblioteca Geral, seleção persistida, layout em mosaico e preparação dos anexos para impressão.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  const BUDGET_ATTACHMENT_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

  function normalizeAttachmentImageLayout(value) {
    const layout = Number(value || 1);
    return [1, 2, 4, 6].includes(layout) ? layout : 1;
  }

  function isImageAttachment(file) {
    const ext = String(file?.extensao || '').toLowerCase();
    return BUDGET_ATTACHMENT_IMAGE_EXTENSIONS.has(ext) || Boolean(file?.is_image);
  }

  function attachmentIcon(file) {
    const ext = String(file?.extensao || '').toLowerCase();
    if (ext === '.pdf') return 'fa-file-pdf';
    if (isImageAttachment(file)) return 'fa-file-image';
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

  function attachmentLayoutLabel(value = state.attachmentImageLayout) {
    const layout = normalizeAttachmentImageLayout(value);
    return layout === 1 ? '1 imagem por folha' : `${layout} imagens por folha`;
  }

  function selectedAttachmentImageLayoutFromPicker() {
    const checked = document.querySelector('input[name="budget-attachments-image-layout"]:checked');
    return normalizeAttachmentImageLayout(checked?.value || state.attachmentImageLayout);
  }

  function syncAttachmentImageLayoutPicker(value = state.attachmentImageLayout) {
    const layout = normalizeAttachmentImageLayout(value);
    document.querySelectorAll('input[name="budget-attachments-image-layout"]').forEach((input) => {
      input.checked = Number(input.value) === layout;
    });
  }

  function renderBudgetAttachments() {
    const host = $('budget-attachments-list');
    const button = $('btn-selecionar-anexos-orcamento');
    const help = $('budget-attachments-help');
    if (!host || !button || !help) return;

    button.disabled = !state.currentId;
    button.title = state.currentId ? 'Selecionar documentos da Biblioteca Geral' : 'Salve o orçamento primeiro';
    help.textContent = state.currentId
      ? `PDFs são impressos normalmente. Imagens: ${attachmentLayoutLabel()}.`
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

  function attachmentFolderKey(folder) {
    return String(folder || 'sem-pasta')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  }

  function isAttachmentFolderExpanded(folder, forceOpen = false) {
    if (forceOpen) return true;
    const key = attachmentFolderKey(folder);
    return Boolean(state.attachmentFolderExpanded?.[key]);
  }

  function toggleAttachmentFolder(folder) {
    const key = attachmentFolderKey(folder);
    state.attachmentFolderExpanded = { ...(state.attachmentFolderExpanded || {}), [key]: !state.attachmentFolderExpanded?.[key] };
    renderAttachmentPickerLibrary();
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

    host.innerHTML = Array.from(groups.entries()).map(([folder, group]) => {
      const forceOpen = Boolean(search);
      const open = isAttachmentFolderExpanded(folder, forceOpen);
      const folderKey = attachmentFolderKey(folder);
      return `
      <section class="budget-attachments-folder ${open ? 'is-open' : ''}" data-attachment-folder="${escapeHtml(folderKey)}">
        <button class="budget-attachments-folder-toggle" type="button" data-attachment-folder-toggle="${escapeHtml(folder)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="budget-attachments-folder-title">
            <i class="fa-solid fa-folder"></i>
            <span>${escapeHtml(folder)}</span>
          </span>
          <span class="budget-attachments-folder-meta">
            <span class="budget-attachments-folder-count">${group.length}</span>
            <i class="fa-solid fa-chevron-down budget-attachments-folder-chevron" aria-hidden="true"></i>
          </span>
        </button>
        <div class="budget-attachments-folder-panel">
          <div class="budget-attachments-folder-panel-inner">
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
          </div>
        </div>
      </section>`;
    }).join('');
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
    state.attachmentImageLayout = normalizeAttachmentImageLayout(state.attachmentImageLayout);
    syncAttachmentImageLayoutPicker();
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
    const imageLayout = selectedAttachmentImageLayoutFromPicker();
    try {
      setButtonLoading(button, true, 'Salvando...');
      const result = await api(`${API}/${state.currentId}/anexos`, {
        method: 'PUT',
        body: JSON.stringify({
          arquivo_ids: state.attachmentSelection || [],
          imagens_por_pagina: imageLayout,
        }),
      });
      state.attachments = Array.isArray(result?.items) ? result.items : [];
      state.attachmentImageLayout = normalizeAttachmentImageLayout(result?.imagens_por_pagina || imageLayout);
      if (state.current) {
        state.current.anexos = state.attachments.map((item) => ({ ...item }));
        state.current.anexos_imagens_por_pagina = state.attachmentImageLayout;
      }
      renderBudgetAttachments();
      closeOverlay('budget-attachments-modal');
      toast(`Documentos anexos atualizados • ${attachmentLayoutLabel()}.`);
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
      state.attachmentImageLayout = normalizeAttachmentImageLayout(result?.imagens_por_pagina || state.attachmentImageLayout);
      if (state.current) {
        state.current.anexos = state.attachments.map((item) => ({ ...item }));
        state.current.anexos_imagens_por_pagina = state.attachmentImageLayout;
      }
      renderBudgetAttachments();
      toast('Documento removido do orçamento.');
    } catch (error) {
      toast(error.message || 'Não foi possível remover o documento.', 'error');
    }
  }

  function renderAttachmentImagePage(files, layout) {
    const normalizedLayout = normalizeAttachmentImageLayout(layout);
    if (normalizedLayout === 1 && files.length === 1) {
      const file = files[0];
      const id = Number(file.id);
      const title = escapeHtml(file.titulo || file.arquivo_nome || 'Imagem anexa');
      const src = escapeHtml(file.url || `/api/arquivos-tecnicos/arquivos/${id}/conteudo`);
      return `<section class="budget-print-attachment"><div class="budget-print-attachment-label">${title}</div><img src="${src}" alt="${title}" /></section>`;
    }

    const rows = normalizedLayout === 2 ? 2 : (normalizedLayout === 4 ? 2 : 3);
    const columns = normalizedLayout === 2 ? 1 : 2;
    const tiles = files.map((file) => {
      const id = Number(file.id);
      const title = escapeHtml(file.titulo || file.arquivo_nome || 'Imagem anexa');
      const src = escapeHtml(file.url || `/api/arquivos-tecnicos/arquivos/${id}/conteudo`);
      return `<div class="budget-print-attachment-tile"><img src="${src}" alt="${title}" /><div class="budget-print-attachment-tile-label">${title}</div></div>`;
    }).join('');
    return `<section class="budget-print-attachment budget-print-attachment-mosaic" style="--mosaic-cols:${columns};--mosaic-rows:${rows}">${tiles}</section>`;
  }

  async function buildAttachmentPrintHtml(attachments = state.attachments, imagesPerPage = state.attachmentImageLayout) {
    const files = (Array.isArray(attachments) ? attachments : []).filter((file) => file?.imprimivel !== false);
    if (!files.length) return '';
    const pages = [];
    const skipped = [];
    const imageLayout = normalizeAttachmentImageLayout(imagesPerPage);
    let imageBatch = [];

    const flushImages = () => {
      if (!imageBatch.length) return;
      pages.push(renderAttachmentImagePage(imageBatch, imageLayout));
      imageBatch = [];
    };

    for (const file of files) {
      const id = Number(file.id);
      const ext = String(file.extensao || '').toLowerCase();
      const title = escapeHtml(file.titulo || file.arquivo_nome || 'Documento anexo');
      if (isImageAttachment(file)) {
        imageBatch.push(file);
        if (imageBatch.length >= imageLayout) flushImages();
        continue;
      }

      flushImages();
      if (ext === '.pdf' || String(file.mime_type || '').toLowerCase() === 'application/pdf') {
        let info;
        try {
          info = await api(`/api/arquivos-tecnicos/arquivos/${id}/paginas`);
        } catch (error) {
          skipped.push(file.arquivo_nome || file.titulo || 'PDF');
          continue;
        }
        const pageCount = Number(info?.paginas || 0);
        for (let page = 1; page <= pageCount; page += 1) {
          pages.push(`<section class="budget-print-attachment"><div class="budget-print-attachment-label">${title} • página ${page}/${pageCount}</div><img src="/api/arquivos-tecnicos/arquivos/${id}/paginas/${page}.png" alt="${title} — página ${page}" /></section>`);
        }
      }
    }
    flushImages();
    if (skipped.length) {
      const preview = skipped.slice(0, 3).join(', ');
      const extra = skipped.length > 3 ? ` e mais ${skipped.length - 3}` : '';
      toast(`Alguns anexos não foram encontrados no armazenamento e foram ignorados: ${preview}${extra}.`, 'warning');
    }
    return pages.join('');
  }

  function attachmentPrintStyles() {
    return `
      .budget-print-attachment{break-before:page;page-break-before:always;width:100%;height:276mm;display:flex;align-items:center;justify-content:center;position:relative;background:#fff;overflow:hidden}
      .budget-print-attachment>img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
      .budget-print-attachment-label{position:absolute;left:0;right:0;bottom:0;padding:1.5mm 2mm;background:rgba(255,255,255,.92);color:#66727b;font:7pt Inter,Arial,sans-serif;text-align:right}
      .budget-print-attachment-mosaic{display:grid;grid-template-columns:repeat(var(--mosaic-cols),minmax(0,1fr));grid-template-rows:repeat(var(--mosaic-rows),minmax(0,1fr));gap:3mm;padding:1mm;align-items:stretch;justify-items:stretch}
      .budget-print-attachment-tile{min-width:0;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;padding:2mm;border:.25mm solid #dfe5e8;border-radius:1.5mm;background:#fff;overflow:hidden}
      .budget-print-attachment-tile img{display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
      .budget-print-attachment-tile-label{position:absolute;left:1.5mm;right:1.5mm;bottom:1mm;padding:1mm 1.5mm;border-radius:1mm;background:rgba(255,255,255,.90);color:#66727b;font:6.5pt Inter,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}
      @media print{
        .budget-print-attachment{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        .budget-print-attachment-label,.budget-print-attachment-tile-label{display:none!important}
      }
    `;
  }
