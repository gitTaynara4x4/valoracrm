(() => {
  'use strict';

  const MODULES = {
    clientes: {
      label: 'clientes',
      singular: 'cliente',
      tbody: 'tbody-clientes',
      filters: {
        busca: 'filtro-busca',
        tipo_pessoa: 'filtro-tipo',
        situacao: 'filtro-situacao',
        cidade: 'filtro-cidade',
      },
      dynamic: 'localizar-personalizado-clientes',
      counter: 'contagem-clientes',
    },
    produtos: {
      label: 'produtos',
      singular: 'produto',
      tbody: 'tbody-produtos',
      filters: {
        busca: 'busca-produtos',
        categoria: 'filtro-categoria-produtos',
        ativo: 'filtro-ativo-produtos',
      },
      dynamic: 'localizar-personalizado-produtos',
      counter: 'contagem-produtos',
    },
    fornecedores: {
      label: 'fornecedores',
      singular: 'fornecedor',
      tbody: 'tbody-fornecedores',
      filters: {
        busca: 'filtro-busca',
        tipo: 'filtro-tipo',
        situacao: 'filtro-situacao',
        cidade: 'filtro-cidade',
      },
      dynamic: 'localizar-personalizado-fornecedores',
      counter: 'contagem-fornecedores',
    },
    patrimonio: {
      label: 'patrimônios',
      singular: 'patrimônio',
      tbody: 'patrimonio-tbody',
      filters: {
        busca: 'patrimonio-busca',
        status: 'patrimonio-status-filter',
      },
      counter: 'patrimonio-contador',
    },
    cotacoes: {
      label: 'cotações',
      singular: 'cotação',
      tbody: 'tbody-cotacoes',
      filters: {
        busca: 'busca-cotacoes',
        status: 'filtro-status-cotacoes',
      },
      counter: 'contagem-cotacoes',
    },
  };

  const FORMATS = [
    { value: 'pdf', label: 'PDF', detail: 'Relatório completo', icon: 'fa-file-pdf' },
    { value: 'xlsx', label: 'Excel', detail: 'Planilha .xlsx', icon: 'fa-file-excel' },
    { value: 'csv', label: 'CSV', detail: 'Tabela universal', icon: 'fa-file-csv' },
    { value: 'json', label: 'JSON', detail: 'Dados estruturados', icon: 'fa-file-code' },
    { value: 'txt', label: 'Texto', detail: 'Relatório .txt', icon: 'fa-file-lines' },
  ];

  let activeModule = null;
  let exporting = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toast(message, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type === 'error' ? 'error' : 'success');
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function createModal() {
    if (document.getElementById('valora-export-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'valora-export-overlay';
    overlay.className = 'valora-export-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="valora-export-modal" role="dialog" aria-modal="true" aria-labelledby="valora-export-title">
        <header class="valora-export-head">
          <div class="valora-export-heading">
            <span class="valora-export-heading-icon"><i class="fa-solid fa-file-export"></i></span>
            <div>
              <span class="valora-export-eyebrow">Exportação completa</span>
              <h2 class="valora-export-title" id="valora-export-title">Exportar cadastros</h2>
              <p class="valora-export-subtitle" id="valora-export-subtitle">Escolha o formato e o alcance do arquivo.</p>
            </div>
          </div>
          <button class="valora-export-close" type="button" data-export-close aria-label="Fechar">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </header>

        <div class="valora-export-body">
          <section class="valora-export-section">
            <div class="valora-export-section-title">
              <strong>Formato do arquivo</strong>
              <span>Selecione uma opção</span>
            </div>
            <div class="valora-export-formats">
              ${FORMATS.map((format, index) => `
                <label class="valora-export-format">
                  <input type="radio" name="valora-export-format" value="${format.value}" ${index === 0 ? 'checked' : ''} />
                  <span class="valora-export-format-card">
                    <span class="valora-export-format-icon"><i class="fa-solid ${format.icon}"></i></span>
                    <strong>${format.label}</strong>
                    <small>${format.detail}</small>
                  </span>
                </label>
              `).join('')}
            </div>
          </section>

          <section class="valora-export-section">
            <div class="valora-export-section-title">
              <strong>O que exportar</strong>
              <span id="valora-export-counter"></span>
            </div>
            <div class="valora-export-scopes">
              <label class="valora-export-scope">
                <input type="radio" name="valora-export-scope" value="filtered" checked />
                <span class="valora-export-scope-card">
                  <i class="fa-solid fa-filter"></i>
                  <span>
                    <strong>Todos os resultados filtrados</strong>
                    <span>Respeita a busca, situação, categoria e campos personalizados usados na tela.</span>
                  </span>
                </span>
              </label>

              <label class="valora-export-scope">
                <input type="radio" name="valora-export-scope" value="page" />
                <span class="valora-export-scope-card">
                  <i class="fa-solid fa-table-list"></i>
                  <span>
                    <strong>Somente esta página</strong>
                    <span id="valora-export-page-detail">Exporta apenas os registros que estão aparecendo agora.</span>
                  </span>
                </span>
              </label>
            </div>
          </section>

          <div class="valora-export-note">
            <i class="fa-solid fa-circle-info"></i>
            <span>O arquivo inclui todos os campos que possuem valor, inclusive campos personalizados. No Excel, listas relacionadas também são organizadas em abas separadas.</span>
          </div>
        </div>

        <footer class="valora-export-footer">
          <span class="valora-export-status" id="valora-export-status">Pronto para exportar.</span>
          <div class="valora-export-actions">
            <button class="btn btn-secondary" type="button" data-export-close>Cancelar</button>
            <button class="btn btn-primary valora-export-download" type="button" id="valora-export-download">
              <i class="fa-solid fa-download"></i>
              <span>Baixar arquivo</span>
            </button>
          </div>
        </footer>
      </section>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-export-close]')) {
        closeModal();
      }
    });

    overlay.querySelector('#valora-export-download')?.addEventListener('click', exportCurrent);
  }

  function getPageIds(config) {
    const tbody = document.getElementById(config.tbody);
    if (!tbody) return [];

    const values = new Set();
    tbody.querySelectorAll('[data-id]').forEach((element) => {
      const raw = String(element.dataset.id || '').trim();
      if (/^\d+$/.test(raw)) values.add(raw);
    });
    return [...values];
  }

  function getCounterText(config) {
    return String(document.getElementById(config.counter)?.textContent || '').trim();
  }

  function updateModalInfo() {
    const config = MODULES[activeModule];
    const overlay = document.getElementById('valora-export-overlay');
    if (!config || !overlay) return;

    const ids = getPageIds(config);
    const countText = getCounterText(config);
    overlay.querySelector('#valora-export-title').textContent = `Exportar ${config.label}`;
    overlay.querySelector('#valora-export-subtitle').textContent = `Gere um relatório completo de ${config.label}, com campos nativos e personalizados.`;
    overlay.querySelector('#valora-export-counter').textContent = countText || `${ids.length} nesta página`;
    overlay.querySelector('#valora-export-page-detail').textContent = ids.length
      ? `Exporta os ${ids.length} registros que estão aparecendo agora.`
      : 'Nenhum registro foi identificado na página atual.';
  }

  function openModal(module) {
    if (!MODULES[module]) return;
    createModal();
    activeModule = module;
    updateModalInfo();

    const overlay = document.getElementById('valora-export-overlay');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');

    requestAnimationFrame(() => {
      overlay.querySelector('input[name="valora-export-format"]:checked')?.focus({ preventScroll: true });
    });
  }

  function closeModal() {
    if (exporting) return;
    const overlay = document.getElementById('valora-export-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-overlay.show, .valora-export-overlay.is-open')) {
      document.body.classList.remove('modal-open');
    }
  }

  function setStatus(message, type = 'normal') {
    const el = document.getElementById('valora-export-status');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('is-error', type === 'error');
  }

  function collectParams(module, scope) {
    const config = MODULES[module];
    const params = new URLSearchParams();
    params.set('somente_preenchidos', 'true');

    Object.entries(config.filters || {}).forEach(([param, id]) => {
      const element = document.getElementById(id);
      const value = String(element?.value ?? '').trim();
      if (value) params.set(param, value);
    });

    if (config.dynamic) {
      document.getElementById(config.dynamic)?.querySelectorAll('[data-localizar-personalizado="true"]')
        .forEach((element) => {
          const param = String(element.dataset.param || '').trim();
          const value = String(element.value ?? '').trim();
          if (param && value) params.set(param, value);
        });
    }

    if (scope === 'page') {
      const ids = getPageIds(config);
      if (!ids.length) throw new Error('Não há registros visíveis para exportar nesta página.');
      params.set('ids', ids.join(','));
    }

    return params;
  }

  function filenameFromDisposition(disposition, fallback) {
    const raw = String(disposition || '');
    const utf = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf) {
      try { return decodeURIComponent(utf[1].trim()); } catch (_) {}
    }
    const plain = raw.match(/filename="?([^";]+)"?/i);
    return plain?.[1]?.trim() || fallback;
  }

  async function readError(response) {
    try {
      const data = await response.json();
      return data?.detail || data?.message || `Erro ${response.status}`;
    } catch (_) {
      try { return await response.text(); } catch (_) { return `Erro ${response.status}`; }
    }
  }

  async function exportCurrent() {
    if (exporting || !activeModule) return;

    const overlay = document.getElementById('valora-export-overlay');
    const format = overlay?.querySelector('input[name="valora-export-format"]:checked')?.value || 'pdf';
    const scope = overlay?.querySelector('input[name="valora-export-scope"]:checked')?.value || 'filtered';
    const button = document.getElementById('valora-export-download');

    let params;
    try {
      params = collectParams(activeModule, scope);
    } catch (error) {
      setStatus(error.message || 'Não foi possível preparar a exportação.', 'error');
      return;
    }

    exporting = true;
    setStatus(format === 'pdf'
      ? 'Montando o relatório completo. Em bases grandes isso pode levar alguns segundos...'
      : 'Preparando o arquivo com todos os campos preenchidos...');

    button?.classList.add('is-loading');
    button?.setAttribute('disabled', 'disabled');
    const icon = button?.querySelector('i');
    const text = button?.querySelector('span');
    if (icon) icon.className = 'fa-solid fa-spinner';
    if (text) text.textContent = 'Preparando...';

    try {
      const response = await fetch(`/api/exportacoes/${activeModule}/${format}?${params.toString()}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: '*/*' },
      });

      if (!response.ok) throw new Error(await readError(response));

      const blob = await response.blob();
      const fallback = `${activeModule}.${format}`;
      const filename = filenameFromDisposition(response.headers.get('content-disposition'), fallback);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);

      const count = response.headers.get('x-valora-export-count');
      setStatus(`${count || 'Arquivo'} registro(s) exportado(s) com sucesso.`);
      toast('Arquivo exportado com sucesso.');

      setTimeout(() => {
        exporting = false;
        closeModal();
      }, 650);
    } catch (error) {
      exporting = false;
      setStatus(error.message || 'Erro ao exportar os dados.', 'error');
      toast(error.message || 'Erro ao exportar os dados.', 'error');
    } finally {
      button?.classList.remove('is-loading');
      button?.removeAttribute('disabled');
      if (icon) icon.className = 'fa-solid fa-download';
      if (text) text.textContent = 'Baixar arquivo';
    }
  }

  function bind() {
    createModal();

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-export-open]');
      if (!button) return;
      event.preventDefault();
      openModal(String(button.dataset.exportOpen || '').trim());
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById('valora-export-overlay')?.classList.contains('is-open')) {
        closeModal();
      }
    });
  }

  window.ValoraExportacoes = { open: openModal, close: closeModal };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
