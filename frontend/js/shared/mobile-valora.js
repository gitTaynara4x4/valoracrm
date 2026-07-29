(() => {
  'use strict';

  const MOBILE_QUERY = window.matchMedia('(max-width: 920px)');
  const CARD_QUERY = window.matchMedia('(max-width: 760px)');
  const FILTER_SELECTORS = [
    '.clientes-filter-card',
    '.fornecedores-filter-card',
    '.produtos-filter-card',
    '.patrimonio-filter-card',
    '.cotacoes-filter-card',
    '.monitoramento-filter-card',
    '.budget-toolbar',
    'main > .search-row'
  ];
  const SCROLL_TABLE_SELECTORS = [
    '.fornecedores-cotados-table'
  ];
  const TITLE_LABELS = /^(nome(?: \/ raz[aã]o social)?|raz[aã]o social|cliente|fornecedor|produto|descri[cç][aã]o|t[ií]tulo|conta)(?:$|\s|\/)/i;
  const META_LABELS = /^(c[oó]digo|tipo|n[uú]mero|documento|data|vencimento|compet[eê]ncia)(?:$|\s|\/)/i;
  const HIGHLIGHT_LABELS = /^(valor|valor total|pre[cç]o|total|saldo)(?:$|\s|\/)/i;
  const STATUS_LABELS = /^(status|situa[cç][aã]o)(?:$|\s|\/)/i;
  const ACTION_LABELS = /^a[cç][oõ]es?$/i;
  let observer = null;
  let scheduled = false;

  function pageKey() {
    const file = String(location.pathname || '').split('/').filter(Boolean).pop() || 'dashboard';
    return file.replace(/\.html$/i, '') || 'dashboard';
  }

  function ensureViewport() {
    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.name = 'viewport';
      document.head.appendChild(viewport);
    }
    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function isEmptyCell(cell) {
    if (cell.querySelector('input, select, textarea, button, a, img, svg, [role="button"]')) return false;
    return !normalizeText(cell.textContent) || normalizeText(cell.textContent) === '-';
  }

  function rowHasEditor(row) {
    return !!row.querySelector('input:not([type="hidden"]), select, textarea, [contenteditable="true"]');
  }

  function getHeaders(table) {
    const rows = Array.from(table.tHead?.rows || []);
    if (!rows.length) return [];
    const finalRow = rows.at(-1);
    return Array.from(finalRow?.cells || []).map((cell) => normalizeText(cell.textContent));
  }

  function classifyTable(table) {
    if (!(table instanceof HTMLTableElement)) return;

    const shouldScroll = SCROLL_TABLE_SELECTORS.some((selector) => table.matches(selector));
    table.classList.toggle('valora-mobile-scroll-table', shouldScroll);
    table.classList.toggle('valora-mobile-card-table', !shouldScroll);

    const wrapper = table.parentElement;
    if (shouldScroll && wrapper) wrapper.classList.add('valora-mobile-scroll-wrap');
    if (!shouldScroll && wrapper) wrapper.classList.remove('valora-mobile-scroll-wrap');

    if (rowHasEditor(table)) table.classList.add('valora-mobile-edit-table');
  }

  function prepareRow(table, row, headers) {
    if (!(row instanceof HTMLTableRowElement)) return;
    row.classList.remove('valora-mobile-card-has-status');
    const allCells = Array.from(row.cells || []);
    const toggleCell = row.querySelector('td.valora-mobile-row-toggle-cell');
    const cells = allCells.filter((cell) => !cell.classList.contains('valora-mobile-row-toggle-cell'));
    if (!cells.length) return;

    const colspanCell = cells.find((cell) => Number(cell.colSpan || 1) > 1);
    if (colspanCell) {
      toggleCell?.remove();
      return;
    }

    cells.forEach((cell, index) => {
      cell.dataset.label = headers[index] || cell.dataset.label || '';
      cell.classList.toggle('valora-mobile-empty-cell', isEmptyCell(cell));
      cell.classList.remove(
        'valora-mobile-secondary-cell',
        'valora-mobile-card-title',
        'valora-mobile-card-meta',
        'valora-mobile-card-highlight',
        'valora-mobile-card-status',
        'valora-mobile-card-actions'
      );
    });

    if (rowHasEditor(row) || table.classList.contains('valora-mobile-scroll-table')) {
      toggleCell?.remove();
      return;
    }

    const meaningful = cells.filter((cell) => !cell.classList.contains('valora-mobile-empty-cell'));
    const actionCells = meaningful.filter((cell) => ACTION_LABELS.test(normalizeText(cell.dataset.label)));
    const dataCells = meaningful.filter((cell) => !actionCells.includes(cell));
    const titleCell = dataCells.find((cell) => TITLE_LABELS.test(normalizeText(cell.dataset.label))) || dataCells[0] || null;
    const statusCells = dataCells.filter((cell) => STATUS_LABELS.test(normalizeText(cell.dataset.label)));
    const metaCells = dataCells.filter((cell) => META_LABELS.test(normalizeText(cell.dataset.label)) && cell !== titleCell);
    const highlightCells = dataCells.filter((cell) => HIGHLIGHT_LABELS.test(normalizeText(cell.dataset.label)) && cell !== titleCell);
    const keep = new Set();

    if (titleCell) {
      titleCell.classList.add('valora-mobile-card-title');
      keep.add(titleCell);
    }

    metaCells.slice(0, 2).forEach((cell) => {
      cell.classList.add('valora-mobile-card-meta');
      keep.add(cell);
    });

    highlightCells.slice(0, 1).forEach((cell) => {
      cell.classList.add('valora-mobile-card-highlight');
      keep.add(cell);
    });

    statusCells.slice(0, 1).forEach((cell) => {
      cell.classList.add('valora-mobile-card-status');
      keep.add(cell);
    });

    dataCells.forEach((cell) => {
      if (keep.size < 4) keep.add(cell);
    });

    actionCells.forEach((cell) => {
      cell.classList.add('valora-mobile-card-actions');
      keep.add(cell);
    });

    row.classList.toggle('valora-mobile-card-has-status', statusCells.length > 0);

    const hidden = dataCells.filter((cell) => !keep.has(cell));
    hidden.forEach((cell) => cell.classList.add('valora-mobile-secondary-cell'));

    let toggleHost = row.querySelector('td.valora-mobile-row-toggle-cell');
    let toggle = toggleHost?.querySelector('.valora-mobile-row-toggle');
    if (!hidden.length) {
      toggleHost?.remove();
      row.classList.remove('valora-mobile-row-expanded');
      return;
    }

    if (!toggle) {
      toggleHost = document.createElement('td');
      toggleHost.className = 'valora-mobile-row-toggle-cell';
      toggleHost.dataset.label = '';
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'valora-mobile-row-toggle';
      toggle.innerHTML = '<span>Detalhes</span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
      toggleHost.appendChild(toggle);
      row.appendChild(toggleHost);
    }

    const expanded = row.classList.contains('valora-mobile-row-expanded');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const copy = toggle.querySelector('span');
    if (copy) copy.textContent = expanded ? 'Menos' : 'Detalhes';
  }

  function enhanceTables(root = document) {
    const tables = root instanceof HTMLTableElement ? [root] : Array.from(root.querySelectorAll?.('table') || []);
    tables.forEach((table) => {
      classifyTable(table);
      const headers = getHeaders(table);
      Array.from(table.tBodies || []).forEach((tbody) => {
        Array.from(tbody.rows || []).forEach((row) => prepareRow(table, row, headers));
      });
    });
  }

  function makeFilterToggle(panel, index) {
    if (!(panel instanceof HTMLElement) || panel.dataset.valoraMobileFilterReady === 'true') return;
    if (panel.closest('.modal-overlay, .financeiro-modal-backdrop')) return;

    panel.dataset.valoraMobileFilterReady = 'true';
    panel.classList.add('valora-mobile-collapsible-filter');
    if (!panel.id) panel.id = `valora-mobile-filter-${index + 1}`;

    const title = normalizeText(panel.querySelector('.panel-head h3, h3, h2')?.textContent) || 'Buscar e filtrar';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'valora-mobile-filter-toggle';
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = `
      <span class="toggle-copy"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>${title}</span></span>
      <i class="fa-solid fa-chevron-down toggle-chevron" aria-hidden="true"></i>
    `;
    panel.parentNode?.insertBefore(button, panel);
  }

  function enhancePagination(root = document) {
    const wraps = root instanceof HTMLElement && root.matches?.('.table-pagination, .pagination-actions')
      ? [root]
      : Array.from(root.querySelectorAll?.('.table-pagination, .pagination-actions') || []);

    wraps.forEach((wrap) => {
      wrap.classList.add('valora-mobile-pagination');
      Array.from(wrap.querySelectorAll('button')).forEach((button) => {
        const label = normalizeText(button.textContent);
        if (label && !button.getAttribute('aria-label')) button.setAttribute('aria-label', label);
        if (label && !button.title) button.title = label;
      });
    });
  }

  function enhanceFilters() {
    const panels = FILTER_SELECTORS.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    [...new Set(panels)].forEach(makeFilterToggle);
  }

  function updateMobileState() {
    document.documentElement.classList.toggle('valora-is-mobile', MOBILE_QUERY.matches);
    document.documentElement.classList.toggle('valora-is-phone', CARD_QUERY.matches);
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceTables(document);
      enhanceFilters();
      enhancePagination(document);
    });
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const filterButton = event.target.closest('.valora-mobile-filter-toggle');
      if (filterButton) {
        const panel = document.getElementById(filterButton.getAttribute('aria-controls'));
        if (!panel) return;
        const open = !panel.classList.contains('is-mobile-open');
        panel.classList.toggle('is-mobile-open', open);
        filterButton.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
          setTimeout(() => panel.querySelector('input:not([type="hidden"]), select')?.focus({ preventScroll: true }), 180);
        }
        return;
      }

      const rowButton = event.target.closest('.valora-mobile-row-toggle');
      if (rowButton) {
        event.preventDefault();
        event.stopPropagation();
        const row = rowButton.closest('tr');
        if (!row) return;
        const expanded = !row.classList.contains('valora-mobile-row-expanded');
        row.classList.toggle('valora-mobile-row-expanded', expanded);
        rowButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const copy = rowButton.querySelector('span');
        if (copy) copy.textContent = expanded ? 'Menos' : 'Detalhes';
      }
    });

    const mediaChange = () => {
      updateMobileState();
      scheduleEnhance();
    };
    MOBILE_QUERY.addEventListener?.('change', mediaChange);
    CARD_QUERY.addEventListener?.('change', mediaChange);
  }

  function startObserver() {
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length) {
          scheduleEnhance();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function init() {
    ensureViewport();
    document.body.dataset.valoraPage = pageKey();
    updateMobileState();
    enhanceTables(document);
    enhanceFilters();
    enhancePagination(document);
    bindEvents();
    startObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
