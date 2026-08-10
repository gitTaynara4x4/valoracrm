(() => {
  'use strict';

  const API = '/api/arquivos-tecnicos';
  const state = {
    entityType: 'cliente',
    entities: [],
    page: 1,
    pages: 1,
    total: 0,
    selectedEntityId: null,
    selectedEntity: null,
    folders: [],
    selectedFolder: null,
    files: [],
    editingFolderId: null,
    loadToken: 0,
  };

  const $ = (id) => document.getElementById(id);

  const entityCopy = () => state.entityType === 'fornecedor'
    ? {
        singular: 'fornecedor',
        singularTitle: 'Fornecedor',
        plural: 'fornecedores',
        pluralTitle: 'Fornecedores',
        endpoint: 'fornecedores',
        query: 'fornecedor',
        icon: 'fa-truck-field',
      }
    : {
        singular: 'cliente',
        singularTitle: 'Cliente',
        plural: 'clientes',
        pluralTitle: 'Clientes',
        endpoint: 'clientes',
        query: 'cliente',
        icon: 'fa-user-shield',
      };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function toast(message, type = 'success', ms = 3000) {
    const el = document.createElement('div');
    el.className = `arq-toast ${type === 'error' ? 'is-error' : ''}`;
    el.style.cssText = [
      'position:fixed', 'right:20px', 'top:82px', 'z-index:1000010',
      'max-width:390px', 'padding:11px 14px', 'border-radius:11px',
      'font:500 10px Poppins,sans-serif', 'box-shadow:0 14px 34px rgba(15,23,42,.16)',
      `background:${type === 'error' ? '#fff3f3' : '#eefafa'}`,
      `border:1px solid ${type === 'error' ? '#efcaca' : '#c7e9eb'}`,
      `color:${type === 'error' ? '#a23737' : '#256977'}`,
    ].join(';');
    el.textContent = message;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), ms);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'include',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
    });
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const msg = typeof payload === 'object' ? (payload.detail || payload.message) : payload;
      throw new Error(msg || `Erro HTTP ${response.status}`);
    }
    return payload;
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(value < 10240 ? 1 : 0)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(value < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  }

  function formatDate(value) {
    if (!value) return 'Sem atualização';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sem atualização';
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function showModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.hidden = false;
    modal.classList.add('show');
    document.body.classList.add('modal-open');
  }

  function hideModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.remove('show');
    modal.hidden = true;
    if (!document.querySelector('.modal-overlay.show')) document.body.classList.remove('modal-open');
  }

  function selectedQuery() {
    const params = new URLSearchParams(window.location.search);
    for (const type of ['fornecedor', 'cliente']) {
      const id = Number(params.get(type));
      if (Number.isInteger(id) && id > 0) return { type, id };
    }
    return null;
  }

  function syncUrlEntity(id) {
    const url = new URL(window.location.href);
    url.searchParams.delete('cliente');
    url.searchParams.delete('fornecedor');
    if (id) url.searchParams.set(entityCopy().query, String(id));
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  }

  function updateEntityUi() {
    const copy = entityCopy();
    document.querySelectorAll('[data-arq-entity-type]').forEach((button) => {
      const active = button.dataset.arqEntityType === state.entityType;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if ($('arq-entity-heading')) $('arq-entity-heading').textContent = copy.pluralTitle;
    if ($('arq-entity-help')) $('arq-entity-help').textContent = 'Localize por nome, código ou endereço.';
    if ($('arq-busca-cliente')) $('arq-busca-cliente').placeholder = `Buscar ${copy.singular}...`;
    if ($('arq-only-files-label')) $('arq-only-files-label').textContent = `Mostrar somente ${copy.plural} com arquivos`;
    if ($('arq-empty-title')) $('arq-empty-title').textContent = `Selecione um ${copy.singular}`;
    if ($('arq-empty-text')) $('arq-empty-text').textContent = `Escolha um ${copy.singular} ao lado para acessar as pastas, fotos e documentos dele.`;
    if ($('stat-entidades-label')) $('stat-entidades-label').textContent = `${copy.pluralTitle} com arquivos`;
    if ($('stat-entidades-icon')) $('stat-entidades-icon').className = `fa-solid ${state.entityType === 'fornecedor' ? 'fa-truck-field' : 'fa-user-group'}`;
    if ($('arq-selected-icon')) $('arq-selected-icon').className = `fa-solid ${state.entityType === 'fornecedor' ? 'fa-truck-field' : 'fa-building-shield'}`;
  }

  async function loadSummary() {
    try {
      const data = await api(`${API}/resumo`);
      const count = state.entityType === 'fornecedor'
        ? data.fornecedores_com_arquivos
        : data.clientes_com_arquivos;
      $('stat-clientes').textContent = Number(count || 0).toLocaleString('pt-BR');
      $('stat-arquivos').textContent = Number(data.arquivos || 0).toLocaleString('pt-BR');
      $('stat-pastas').textContent = Number(data.pastas || 0).toLocaleString('pt-BR');
      $('stat-espaco').textContent = formatBytes(data.total_bytes || 0);
    } catch (error) {
      console.error('[arquivos-tecnicos] resumo:', error);
    }
  }

  function renderEntities() {
    const host = $('arq-client-list');
    if (!host) return;
    const copy = entityCopy();
    if (!state.entities.length) {
      host.innerHTML = `<div class="arq-empty-list"><div><i class="fa-regular fa-folder-open"></i><br>Nenhum ${copy.singular} encontrado.</div></div>`;
    } else {
      host.innerHTML = state.entities.map((entity) => {
        const active = Number(entity.id) === Number(state.selectedEntityId);
        const locality = entity.endereco || entity.cidade_uf || 'Endereço não informado';
        return `
          <button class="arq-client-item ${active ? 'is-active' : ''}" type="button" data-entity-id="${entity.id}">
            <span class="arq-client-icon"><i class="fa-solid ${copy.icon}"></i></span>
            <span class="arq-client-copy">
              <strong>${escapeHtml(entity.nome || copy.singularTitle)}</strong>
              <span>${escapeHtml(entity.codigo ? `#${entity.codigo} • ${locality}` : locality)}</span>
            </span>
            <span class="arq-client-badge" title="${Number(entity.arquivo_count || 0)} arquivos">${Number(entity.arquivo_count || 0)}</span>
          </button>`;
      }).join('');
    }
    $('arq-client-page').textContent = `${state.page} / ${state.pages}`;
    $('arq-client-prev').disabled = state.page <= 1;
    $('arq-client-next').disabled = state.page >= state.pages;
  }

  async function loadEntities({ page = state.page, preserveSelection = true } = {}) {
    const host = $('arq-client-list');
    const copy = entityCopy();
    const token = ++state.loadToken;
    if (host) host.innerHTML = `<div class="arq-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando ${copy.plural}...</div>`;
    const params = new URLSearchParams({
      busca: $('arq-busca-cliente')?.value?.trim() || '',
      pagina: String(page),
      por_pagina: '40',
      somente_com_arquivos: $('arq-so-com-arquivos')?.checked ? 'true' : 'false',
    });
    try {
      const data = await api(`${API}/${copy.endpoint}?${params.toString()}`);
      if (token !== state.loadToken) return;
      state.entities = Array.isArray(data.items) ? data.items : [];
      state.page = Number(data.pagina || 1);
      state.pages = Number(data.paginas || 1);
      state.total = Number(data.total || 0);
      renderEntities();
      if (!preserveSelection) clearEntitySelection({ updateUrl: false });
    } catch (error) {
      if (token !== state.loadToken) return;
      const message = error.message || `Não foi possível carregar os ${copy.plural}.`;
      if (host) host.innerHTML = `<div class="arq-empty-list">${escapeHtml(message)}</div>`;
      toast(message, 'error');
    }
  }

  function clearEntitySelection({ updateUrl = true } = {}) {
    state.selectedEntityId = null;
    state.selectedEntity = null;
    state.folders = [];
    state.selectedFolder = null;
    state.files = [];
    $('arq-empty-client').hidden = false;
    $('arq-client-content').hidden = true;
    $('arq-gallery-section').hidden = true;
    if (updateUrl) syncUrlEntity(null);
    renderEntities();
  }

  function renderFolders() {
    const host = $('arq-folder-grid');
    const copy = entityCopy();
    const count = state.folders.length;
    $('arq-folder-count').textContent = `${count} ${count === 1 ? 'pasta' : 'pastas'}`;
    if (!count) {
      host.innerHTML = `<div class="arq-empty-list" style="grid-column:1/-1"><div><i class="fa-regular fa-folder-open"></i><br><strong>Nenhuma pasta criada para este ${copy.singular}.</strong><br>Clique em “Nova pasta” para começar.</div></div>`;
      return;
    }
    host.innerHTML = state.folders.map((folder) => `
      <button class="arq-folder-card" type="button" data-folder-id="${folder.id}">
        <span class="arq-folder-icon"><i class="fa-solid ${escapeHtml(folder.icone || 'fa-folder')}"></i></span>
        <h4>${escapeHtml(folder.nome)}</h4>
        <p>${Number(folder.arquivo_count || 0)} ${Number(folder.arquivo_count || 0) === 1 ? 'arquivo' : 'arquivos'} • ${formatBytes(folder.total_bytes)}</p>
        <div class="arq-folder-footer">
          <span><i class="fa-regular fa-clock"></i> ${escapeHtml(formatDate(folder.ultima_atualizacao))}</span>
          <i class="fa-solid fa-chevron-right"></i>
        </div>
      </button>`).join('');
  }

  async function selectEntity(id, { updateUrl = true } = {}) {
    const numericId = Number(id);
    if (!numericId) return;
    const copy = entityCopy();
    state.selectedEntityId = numericId;
    renderEntities();
    $('arq-empty-client').hidden = true;
    $('arq-client-content').hidden = false;
    $('arq-folder-grid').innerHTML = '<div class="arq-loading" style="grid-column:1/-1"><i class="fa-solid fa-spinner fa-spin"></i> Carregando pastas...</div>';
    $('arq-gallery-section').hidden = true;
    try {
      const data = await api(`${API}/${copy.endpoint}/${numericId}`);
      state.selectedEntity = data[state.entityType] || null;
      state.folders = Array.isArray(data.pastas) ? data.pastas : [];
      state.selectedFolder = null;
      state.files = [];
      const entity = state.selectedEntity || {};
      $('arq-selected-code').textContent = entity.codigo
        ? `${copy.singularTitle.toUpperCase()} #${entity.codigo}`
        : `${copy.singularTitle.toUpperCase()} #${entity.id || numericId}`;
      $('arq-selected-name').textContent = entity.nome || copy.singularTitle;
      $('arq-selected-address').textContent = [entity.endereco, entity.cidade_uf, entity.cep ? `CEP ${entity.cep}` : ''].filter(Boolean).join(' • ') || 'Endereço não informado';
      renderFolders();
      if (updateUrl) syncUrlEntity(numericId);
    } catch (error) {
      toast(error.message || `Não foi possível carregar o acervo do ${copy.singular}.`, 'error');
      clearEntitySelection();
    }
  }

  function fileIcon(file) {
    const ext = String(file.extensao || '').toLowerCase();
    if (ext === '.pdf') return 'fa-file-pdf';
    if (['.doc', '.docx'].includes(ext)) return 'fa-file-word';
    if (['.xls', '.xlsx'].includes(ext)) return 'fa-file-excel';
    return 'fa-file-lines';
  }

  function renderFiles() {
    const host = $('arq-file-grid');
    if (!state.files.length) {
      host.innerHTML = '<div class="arq-empty-list" style="grid-column:1/-1"><div><i class="fa-regular fa-images"></i><br>Esta pasta ainda está vazia.<br>Envie as primeiras fotos ou documentos.</div></div>';
      return;
    }
    host.innerHTML = state.files.map((file) => {
      const preview = file.is_image
        ? `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.titulo || file.arquivo_nome)}" loading="lazy" />`
        : `<span class="arq-file-generic"><i class="fa-solid ${fileIcon(file)}"></i></span>`;
      return `
        <article class="arq-file-card" data-file-id="${file.id}">
          <button class="arq-file-preview" type="button" data-file-preview="${file.id}" aria-label="Visualizar ${escapeHtml(file.arquivo_nome)}">${preview}</button>
          <div class="arq-file-body">
            <h4 title="${escapeHtml(file.arquivo_nome)}">${escapeHtml(file.titulo || file.arquivo_nome)}</h4>
            <p>${escapeHtml(file.descricao || 'Sem descrição')}</p>
            <div class="arq-file-meta"><span>${escapeHtml(formatDate(file.criado_em))}</span><span>${formatBytes(file.tamanho_bytes)}</span></div>
          </div>
          <div class="arq-file-actions">
            <a class="arq-icon-btn" href="${escapeHtml(file.download_url)}" title="Baixar"><i class="fa-solid fa-download"></i></a>
            <button class="arq-icon-btn is-danger" type="button" data-file-delete="${file.id}" title="Excluir"><i class="fa-regular fa-trash-can"></i></button>
          </div>
        </article>`;
    }).join('');
  }

  async function openFolder(id) {
    const folder = state.folders.find((item) => Number(item.id) === Number(id));
    if (!folder) return;
    state.selectedFolder = folder;
    $('arq-gallery-section').hidden = false;
    $('arq-gallery-title').textContent = folder.nome;
    $('arq-gallery-meta').textContent = 'Carregando arquivos...';
    $('btn-editar-pasta').hidden = false;
    $('btn-excluir-pasta').hidden = false;
    $('arq-file-grid').innerHTML = '<div class="arq-loading" style="grid-column:1/-1"><i class="fa-solid fa-spinner fa-spin"></i> Carregando arquivos...</div>';
    try {
      const data = await api(`${API}/pastas/${folder.id}/arquivos`);
      state.files = Array.isArray(data.items) ? data.items : [];
      $('arq-gallery-meta').textContent = `${state.files.length} ${state.files.length === 1 ? 'arquivo' : 'arquivos'} • ${formatBytes(state.files.reduce((sum, item) => sum + Number(item.tamanho_bytes || 0), 0))}`;
      renderFiles();
      $('arq-gallery-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      toast(error.message || 'Não foi possível abrir a pasta.', 'error');
    }
  }

  async function refreshSelectedEntity({ reopenFolder = false } = {}) {
    const entityId = state.selectedEntityId;
    const folderId = reopenFolder ? state.selectedFolder?.id : null;
    if (!entityId) return;
    await selectEntity(entityId, { updateUrl: false });
    if (folderId) await openFolder(folderId);
  }

  function uploadNotice(text) {
    let el = document.querySelector('.arq-upload-progress');
    if (!el) {
      el = document.createElement('div');
      el.className = 'arq-upload-progress';
      document.body.appendChild(el);
    }
    el.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${escapeHtml(text)}`;
    return () => el.remove();
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!state.selectedFolder || !files.length) return;
    if (files.length > 30) {
      toast('Envie no máximo 30 arquivos por vez.', 'error');
      return;
    }
    const form = new FormData();
    files.forEach((file) => form.append('arquivos', file, file.name));
    const closeNotice = uploadNotice(`Enviando ${files.length} ${files.length === 1 ? 'arquivo' : 'arquivos'}...`);
    $('btn-enviar-arquivos').disabled = true;
    try {
      const result = await api(`${API}/pastas/${state.selectedFolder.id}/arquivos`, { method: 'POST', body: form });
      toast(`${Number(result.total || files.length)} arquivo(s) enviado(s) com sucesso.`);
      await refreshSelectedEntity({ reopenFolder: true });
      await Promise.all([loadSummary(), loadEntities({ page: state.page, preserveSelection: true })]);
    } catch (error) {
      toast(error.message || 'Não foi possível enviar os arquivos.', 'error', 4500);
    } finally {
      closeNotice();
      $('btn-enviar-arquivos').disabled = false;
      if ($('input-arquivos-tecnicos')) $('input-arquivos-tecnicos').value = '';
    }
  }

  async function deleteFile(id) {
    const file = state.files.find((item) => Number(item.id) === Number(id));
    if (!file) return;
    if (!window.confirm(`Excluir definitivamente “${file.arquivo_nome}”?`)) return;
    try {
      await api(`${API}/arquivos/${id}`, { method: 'DELETE' });
      toast('Arquivo excluído.');
      await refreshSelectedEntity({ reopenFolder: true });
      await Promise.all([loadSummary(), loadEntities({ page: state.page, preserveSelection: true })]);
    } catch (error) {
      toast(error.message || 'Não foi possível excluir o arquivo.', 'error');
    }
  }

  function previewFile(id) {
    const file = state.files.find((item) => Number(item.id) === Number(id));
    if (!file) return;
    $('arq-preview-title').textContent = file.titulo || file.arquivo_nome;
    $('arq-preview-meta').textContent = `${file.arquivo_nome} • ${formatBytes(file.tamanho_bytes)} • Enviado por ${file.usuario_nome || 'usuário'}`;
    $('arq-preview-download').href = file.download_url;
    const host = $('arq-preview-body');
    if (file.is_image) {
      host.innerHTML = `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.arquivo_nome)}" />`;
    } else if (String(file.extensao || '').toLowerCase() === '.pdf') {
      host.innerHTML = `<iframe src="${escapeHtml(file.url)}" title="${escapeHtml(file.arquivo_nome)}"></iframe>`;
    } else {
      host.innerHTML = `<div class="arq-empty-client"><span class="arq-empty-icon"><i class="fa-solid ${fileIcon(file)}"></i></span><h3>${escapeHtml(file.arquivo_nome)}</h3><p>Este formato não possui visualização interna. Use o botão Baixar.</p></div>`;
    }
    showModal('modal-arq-preview');
  }

  function openFolderModal(folder = null) {
    state.editingFolderId = folder?.id || null;
    $('modal-arq-pasta-title').textContent = folder ? 'Renomear pasta' : 'Nova pasta';
    $('arq-pasta-nome').value = folder?.nome || '';
    showModal('modal-arq-pasta');
    window.setTimeout(() => $('arq-pasta-nome')?.focus(), 80);
  }

  async function deleteCurrentFolder() {
    const folder = state.selectedFolder;
    if (!folder) return;
    if (!window.confirm(`Excluir a pasta “${folder.nome}”? A pasta só pode ser removida quando estiver vazia.`)) return;
    try {
      await api(`${API}/pastas/${folder.id}`, { method: 'DELETE' });
      toast('Pasta excluída.');
      state.selectedFolder = null;
      state.files = [];
      $('arq-gallery-section').hidden = true;
      await refreshSelectedEntity();
      await Promise.all([loadSummary(), loadEntities({ page: state.page, preserveSelection: true })]);
    } catch (error) {
      toast(error.message || 'Não foi possível excluir a pasta.', 'error');
    }
  }

  async function saveEntityFolder() {
    if (!state.selectedEntityId) return;
    const nome = $('arq-pasta-nome').value.trim();
    if (!nome) {
      toast('Informe o nome da pasta.', 'error');
      $('arq-pasta-nome').focus();
      return;
    }
    const button = $('btn-salvar-pasta-cliente');
    button.disabled = true;
    try {
      if (state.editingFolderId) {
        await api(`${API}/pastas/${state.editingFolderId}`, { method: 'PATCH', body: JSON.stringify({ nome }) });
        toast('Pasta renomeada.');
      } else {
        await api(`${API}/${entityCopy().endpoint}/${state.selectedEntityId}/pastas`, {
          method: 'POST',
          body: JSON.stringify({ nome, icone: 'fa-folder' }),
        });
        toast('Pasta criada.');
      }
      hideModal('modal-arq-pasta');
      await refreshSelectedEntity({ reopenFolder: false });
      await Promise.all([loadSummary(), loadEntities({ page: state.page, preserveSelection: true })]);
    } catch (error) {
      toast(error.message || 'Não foi possível salvar a pasta.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function switchEntityType(nextType) {
    if (!['cliente', 'fornecedor'].includes(nextType) || nextType === state.entityType) return;
    state.entityType = nextType;
    state.page = 1;
    state.pages = 1;
    state.entities = [];
    state.loadToken += 1;
    if ($('arq-busca-cliente')) $('arq-busca-cliente').value = '';
    if ($('arq-so-com-arquivos')) $('arq-so-com-arquivos').checked = false;
    clearEntitySelection();
    updateEntityUi();
    await Promise.all([loadSummary(), loadEntities({ page: 1, preserveSelection: false })]);
  }

  function bindEvents() {
    let searchTimer = null;

    document.querySelectorAll('[data-arq-entity-type]').forEach((button) => {
      button.addEventListener('click', () => void switchEntityType(button.dataset.arqEntityType));
    });

    $('arq-busca-cliente')?.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => loadEntities({ page: 1, preserveSelection: true }), 260);
    });
    $('arq-so-com-arquivos')?.addEventListener('change', () => loadEntities({ page: 1, preserveSelection: true }));
    $('arq-client-prev')?.addEventListener('click', () => state.page > 1 && loadEntities({ page: state.page - 1 }));
    $('arq-client-next')?.addEventListener('click', () => state.page < state.pages && loadEntities({ page: state.page + 1 }));

    $('arq-client-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-entity-id]');
      if (button) void selectEntity(button.dataset.entityId);
    });
    $('arq-folder-grid')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-folder-id]');
      if (button) void openFolder(button.dataset.folderId);
    });
    $('arq-file-grid')?.addEventListener('click', (event) => {
      const preview = event.target.closest('[data-file-preview]');
      if (preview) { previewFile(preview.dataset.filePreview); return; }
      const del = event.target.closest('[data-file-delete]');
      if (del) void deleteFile(del.dataset.fileDelete);
    });

    $('btn-atualizar-arquivos')?.addEventListener('click', async () => {
      await Promise.all([loadSummary(), loadEntities({ page: state.page })]);
      if (state.selectedEntityId) await refreshSelectedEntity({ reopenFolder: Boolean(state.selectedFolder) });
      toast('Arquivos técnicos atualizados.');
    });

    $('btn-nova-pasta-cliente')?.addEventListener('click', () => openFolderModal());
    $('btn-editar-pasta')?.addEventListener('click', () => state.selectedFolder && openFolderModal(state.selectedFolder));
    $('btn-excluir-pasta')?.addEventListener('click', deleteCurrentFolder);
    $('btn-salvar-pasta-cliente')?.addEventListener('click', saveEntityFolder);
    $('arq-pasta-nome')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); void saveEntityFolder(); }
    });

    $('btn-enviar-arquivos')?.addEventListener('click', () => $('input-arquivos-tecnicos')?.click());
    $('input-arquivos-tecnicos')?.addEventListener('change', (event) => uploadFiles(event.target.files));
    $('btn-voltar-pastas')?.addEventListener('click', () => {
      $('arq-gallery-section').hidden = true;
      state.selectedFolder = null;
      state.files = [];
    });

    const dropzone = $('arq-dropzone');
    ['dragenter', 'dragover'].forEach((name) => dropzone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    }));
    ['dragleave', 'drop'].forEach((name) => dropzone?.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
    }));
    dropzone?.addEventListener('drop', (event) => uploadFiles(event.dataTransfer?.files));

    document.querySelectorAll('[data-arq-close]').forEach((button) => {
      button.addEventListener('click', () => hideModal(button.dataset.arqClose));
    });
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) hideModal(overlay.id);
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const open = document.querySelector('.modal-overlay.show');
      if (open) hideModal(open.id);
    });
  }

  async function init() {
    const requested = selectedQuery();
    if (requested) state.entityType = requested.type;
    updateEntityUi();
    bindEvents();
    await Promise.all([loadSummary(), loadEntities({ page: 1 })]);
    if (requested) await selectEntity(requested.id, { updateUrl: false });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else void init();
})();
