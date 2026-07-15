(() => {
  'use strict';

  if (window.ValoraAgenda) return;

  const API = '/api/agenda';
  const state = {
    contexts: new Map(),
    notifications: { vencidos: [], proximos: [], novos_alertas: [], total_pendentes: 0, total_vencidos: 0 },
    shownAlerts: new Set(),
    polling: null,
    notificationRequest: null,
    lastNotificationAt: 0,
    initialized: false,
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function apiJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (response.status === 204) return null;

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }

    if (!response.ok) {
      const message = data?.detail || data?.message || 'Não foi possível concluir a operação.';
      throw new Error(message);
    }
    return data;
  }

  function formatDateTime(value) {
    if (!value) return 'Sem data definida';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function formatRelative(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diffMinutes = Math.round((date.getTime() - Date.now()) / 60000);
    if (Math.abs(diffMinutes) < 1) return 'agora';
    if (diffMinutes < 0) {
      const overdue = Math.abs(diffMinutes);
      if (overdue < 60) return `atrasado há ${overdue} min`;
      if (overdue < 1440) return `atrasado há ${Math.floor(overdue / 60)} h`;
      return `atrasado há ${Math.floor(overdue / 1440)} dia(s)`;
    }
    if (diffMinutes < 60) return `em ${diffMinutes} min`;
    if (diffMinutes < 1440) return `em ${Math.floor(diffMinutes / 60)} h`;
    return `em ${Math.floor(diffMinutes / 1440)} dia(s)`;
  }

  function isOverdue(item) {
    return isScheduledType(item?.tipo)
      && isActiveStatus(item?.status)
      && item?.agendado_para
      && new Date(item.agendado_para).getTime() <= Date.now();
  }

  function showMessage(message, type = 'success') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type === 'error' ? 'error' : 'success');
      return;
    }
    const el = document.getElementById('valora-toast');
    if (el) {
      el.textContent = message;
      el.classList.add('show');
      el.classList.toggle('is-error', type === 'error');
      setTimeout(() => el.classList.remove('show'), 3200);
      return;
    }
    console[type === 'error' ? 'error' : 'log'](message);
  }

  function entityLabel(type) {
    return ({ cliente: 'Cliente', fornecedor: 'Fornecedor', produto: 'Produto' })[type] || 'Cadastro';
  }

  function modulePath(type) {
    return ({ cliente: '/clientes', fornecedor: '/fornecedores', produto: '/produtos' })[type] || '/dashboard';
  }

  const ACTIVE_AGENDA_STATUSES = new Set(['em_aberto', 'em_andamento', 'em_analise', 'parado', 'pendente']);
  const STATUS_OPTIONS = [
    ['em_aberto', 'Em Aberto'],
    ['em_andamento', 'Em Andamento'],
    ['em_analise', 'Em Análise'],
    ['parado', 'Parado'],
    ['finalizado', 'Finalizado'],
  ];
  const MOTIVE_OPTIONS = [
    ['', '--------'],
    ['Aguardando posição do cliente', 'Aguardando posição do cliente'],
    ['Aguardando serviços de terceiros', 'Aguardando serviços de terceiros'],
    ['Aguardando área financeira', 'Aguardando área financeira'],
    ['Aguardando área técnica', 'Aguardando área técnica'],
    ['Aguardando área comercial', 'Aguardando área comercial'],
    ['Aguardando aprovação', 'Aguardando aprovação'],
    ['Outro', 'Outro'],
  ];

  function isScheduledType(type) {
    return ['lembrete', 'enviar_proposta', 'abrir_ordem_servico', 'transferir_departamento'].includes(String(type || ''));
  }

  function isActiveStatus(status) {
    return ACTIVE_AGENDA_STATUSES.has(String(status || ''));
  }

  function agendaTypeText(type) {
    return ({
      registro: 'Registro de contato',
      lembrete: 'Lembrete agendado',
      enviar_proposta: 'Enviar proposta',
      abrir_ordem_servico: 'Abrir ordem de serviços',
      transferir_departamento: 'Transferir para departamento',
    })[type] || 'Agendamento';
  }

  function agendaTypeIcon(type) {
    return ({
      registro: 'fa-message',
      lembrete: 'fa-bell',
      enviar_proposta: 'fa-file-signature',
      abrir_ordem_servico: 'fa-screwdriver-wrench',
      transferir_departamento: 'fa-arrow-right-arrow-left',
    })[type] || 'fa-calendar-check';
  }

  function agendaStatusText(status, type = '') {
    if (!isScheduledType(type)) return 'Registro';
    return ({
      em_aberto: 'Em Aberto',
      em_andamento: 'Em Andamento',
      em_analise: 'Em Análise',
      parado: 'Parado',
      finalizado: 'Finalizado',
      pendente: 'Em Aberto',
      concluido: 'Finalizado',
      cancelado: 'Cancelado',
    })[status] || 'Em Aberto';
  }

  function statusOptionsHtml(selected = 'em_aberto') {
    const normalized = selected === 'pendente' ? 'em_aberto' : selected === 'concluido' ? 'finalizado' : selected;
    return STATUS_OPTIONS.map(([value, label]) => (
      `<option value="${escapeHtml(value)}" ${value === normalized ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )).join('');
  }

  function motiveOptionsHtml(selected = '') {
    return MOTIVE_OPTIONS.map(([value, label]) => (
      `<option value="${escapeHtml(value)}" ${value === String(selected || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )).join('');
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function entityItemHtml(item, { global = false, readonly = false } = {}) {
    const scheduled = isScheduledType(item.tipo);
    const overdue = isOverdue(item);
    const finalized = ['finalizado', 'concluido'].includes(item.status);
    const cancelled = item.status === 'cancelado';
    const description = item.descricao ? `<p>${escapeHtml(item.descricao)}</p>` : '';
    const freeInfo = item.informacoes_livres
      ? `<div class="agenda-item-extra"><strong>Informações:</strong><span>${escapeHtml(item.informacoes_livres)}</span></div>`
      : '';
    const reason = item.motivo_status
      ? `<div class="agenda-item-extra"><strong>Motivo:</strong><span>${escapeHtml(item.motivo_status)}</span></div>`
      : '';
    const department = item.departamento_destino
      ? `<div class="agenda-item-extra"><strong>Departamento:</strong><span>${escapeHtml(item.departamento_destino)}</span></div>`
      : '';
    const entity = global
      ? `<span class="agenda-chip"><i class="fa-solid fa-link"></i>${escapeHtml(entityLabel(item.entidade_tipo))}: ${escapeHtml(item.entidade_nome)}</span>`
      : '';
    const typeChip = `<span class="agenda-chip"><i class="fa-solid ${agendaTypeIcon(item.tipo)}"></i>${escapeHtml(agendaTypeText(item.tipo))}</span>`;
    const dateChip = scheduled
      ? `<span class="agenda-chip ${overdue ? 'overdue' : finalized ? 'completed' : ''}"><i class="fa-regular fa-clock"></i>${escapeHtml(formatDateTime(item.agendado_para))}${isActiveStatus(item.status) ? ` • ${escapeHtml(formatRelative(item.agendado_para))}` : ''}</span>`
      : `<span class="agenda-chip"><i class="fa-regular fa-calendar"></i>${escapeHtml(formatDateTime(item.criado_em))}</span>`;
    const author = item.criado_por_nome
      ? `<span class="agenda-chip"><i class="fa-regular fa-user"></i>${escapeHtml(item.criado_por_nome)}</span>`
      : '';
    const statusClass = finalized ? 'completed' : overdue || item.status === 'parado' ? 'overdue' : '';
    const statusChip = `<span class="agenda-chip ${statusClass}">${escapeHtml(agendaStatusText(item.status, item.tipo))}</span>`;

    let actions = '';
    let editor = '';
    if (!readonly) {
      const editAction = scheduled && !global
        ? `<button class="agenda-link-btn" type="button" data-agenda-action="edit" data-id="${item.id}"><i class="fa-regular fa-pen-to-square"></i> Atualizar</button>`
        : '';
      const goAction = global
        ? `<button class="agenda-link-btn" type="button" data-agenda-action="go" data-id="${item.id}" data-entity-type="${escapeHtml(item.entidade_tipo)}" data-entity-id="${item.entidade_id}"><i class="fa-solid fa-arrow-up-right-from-square"></i> Cadastro</button>`
        : '';
      const deleteAction = !global
        ? `<button class="agenda-link-btn" type="button" data-agenda-action="delete" data-id="${item.id}"><i class="fa-regular fa-trash-can"></i> Excluir</button>`
        : '';
      actions = `<div class="agenda-item-actions">${editAction}${goAction}${deleteAction}</div>`;

      if (scheduled && !global) {
        const departmentField = item.tipo === 'transferir_departamento'
          ? `<div class="agenda-field"><label>Departamento de destino *</label><input name="departamento_destino" maxlength="180" value="${escapeHtml(item.departamento_destino || '')}" /></div>`
          : '';
        editor = `
          <div class="agenda-item-editor" data-agenda-edit-form="${item.id}" hidden>
            <div class="agenda-field"><label>Status</label><select name="status">${statusOptionsHtml(item.status)}</select></div>
            <div class="agenda-field"><label>Motivo da situação</label><select name="motivo_status">${motiveOptionsHtml(item.motivo_status)}</select></div>
            <div class="agenda-field"><label>Data e horário *</label><input name="agendado_para" type="datetime-local" value="${escapeHtml(toDatetimeLocal(item.agendado_para))}" /></div>
            ${departmentField}
            <div class="agenda-field full"><label>Informações livres</label><textarea name="informacoes_livres" maxlength="12000" placeholder="Digite observações, atualizações e informações adicionais.">${escapeHtml(item.informacoes_livres || '')}</textarea></div>
            <div class="agenda-item-editor-actions">
              <button class="agenda-secondary" type="button" data-agenda-action="cancel-edit" data-id="${item.id}">Cancelar</button>
              <button class="agenda-primary" type="button" data-agenda-action="save-edit" data-id="${item.id}"><i class="fa-solid fa-floppy-disk"></i> Salvar atualização</button>
            </div>
          </div>
        `;
      }
    }

    return `
      <article class="valora-agenda-item ${overdue ? 'is-overdue' : ''} ${finalized || cancelled ? 'is-completed' : ''}" data-agenda-item="${item.id}">
        <div class="agenda-item-icon"><i class="fa-solid ${agendaTypeIcon(item.tipo)}"></i></div>
        <div class="agenda-item-main">
          <strong>${escapeHtml(item.assunto)}</strong>
          ${description}
          <div class="agenda-item-meta">${entity}${typeChip}${dateChip}${statusChip}${author}</div>
          ${reason}${department}${freeInfo}
        </div>
        ${actions}
        ${editor}
      </article>
    `;
  }

  function renderEntityShell(context) {
    const container = document.getElementById(context.containerId);
    if (!container) return;

    container._valoraAgendaAbortController?.abort?.();
    container._valoraAgendaAbortController = null;
    delete container.dataset.agendaBound;

    if (!context.entidadeId) {
      container.innerHTML = `
        <div class="valora-agenda-entity">
          <div class="agenda-unsaved">
            <i class="fa-regular fa-calendar-plus"></i><br>
            Salve este ${escapeHtml(entityLabel(context.entidadeTipo).toLowerCase())} antes de registrar contatos ou criar agendamentos.
          </div>
        </div>
      `;
      return;
    }

    const form = context.readonly ? '' : `
      <article class="valora-agenda-card">
        <div class="valora-agenda-heading">
          <div>
            <h4>Novo registro ou agendamento</h4>
            <p>Registre um contato ou crie uma tarefa com data, status e acompanhamento.</p>
          </div>
        </div>
        <div class="valora-agenda-form" data-agenda-form="${escapeHtml(context.containerId)}">
          <div class="agenda-field">
            <label>Tipo</label>
            <select name="tipo">
              <option value="registro">Registro de contato</option>
              <option value="lembrete">Lembrete agendado</option>
              <option value="enviar_proposta">Enviar proposta</option>
              <option value="abrir_ordem_servico">Abrir ordem de serviços</option>
              <option value="transferir_departamento">Transferir para departamento</option>
            </select>
          </div>
          <div class="agenda-field agenda-field-grow">
            <label>Assunto *</label>
            <input name="assunto" maxlength="180" placeholder="Ex.: Retorno sobre orçamento" required />
          </div>
          <div class="agenda-field" data-agenda-scheduled-field hidden>
            <label>Data e horário *</label>
            <input name="agendado_para" type="datetime-local" />
          </div>
          <div class="agenda-field" data-agenda-scheduled-field hidden>
            <label>Status</label>
            <select name="status">${statusOptionsHtml('em_aberto')}</select>
          </div>
          <div class="agenda-field agenda-field-grow" data-agenda-scheduled-field hidden>
            <label>Motivo da situação</label>
            <select name="motivo_status">${motiveOptionsHtml('')}</select>
          </div>
          <div class="agenda-field" data-agenda-department-field hidden>
            <label>Departamento de destino *</label>
            <input name="departamento_destino" maxlength="180" placeholder="Ex.: Financeiro, Comercial ou Técnico" />
          </div>
          <div class="agenda-field full">
            <label>Detalhes do contato ou tarefa</label>
            <textarea name="descricao" maxlength="8000" placeholder="Descreva o que foi tratado e o que precisa ser feito."></textarea>
          </div>
          <div class="agenda-field full" data-agenda-scheduled-field hidden>
            <label>Informações livres</label>
            <textarea name="informacoes_livres" maxlength="12000" placeholder="Digite observações, atualizações e demais informações do agendamento."></textarea>
          </div>
          <div class="valora-agenda-form-actions">
            <button class="agenda-primary" type="button" data-agenda-submit><i class="fa-solid fa-floppy-disk"></i> Salvar registro</button>
          </div>
        </div>
      </article>
    `;

    container.innerHTML = `
      <div class="valora-agenda-entity">
        ${form}
        <article class="valora-agenda-card">
          <div class="valora-agenda-heading">
            <div>
              <h4>Agenda e histórico</h4>
              <p>Registros, tarefas e agendamentos vinculados a ${escapeHtml(context.entidadeNome || entityLabel(context.entidadeTipo))}.</p>
            </div>
            <button class="agenda-secondary" type="button" data-agenda-refresh="${escapeHtml(context.containerId)}"><i class="fa-solid fa-rotate-right"></i> Atualizar</button>
          </div>
          <div class="valora-agenda-list" data-agenda-list="${escapeHtml(context.containerId)}">
            <div class="agenda-loading">Carregando histórico...</div>
          </div>
        </article>
      </div>
    `;

    bindEntityContainer(context);
  }

  function bindEntityContainer(context) {
    const container = document.getElementById(context.containerId);
    if (!container || container.dataset.agendaBound === 'true') return;
    container.dataset.agendaBound = 'true';
    const abortController = new AbortController();
    container._valoraAgendaAbortController = abortController;
    const listenerOptions = { signal: abortController.signal };

    const form = container.querySelector('[data-agenda-form]');
    const typeSelect = form?.querySelector('[name="tipo"]');
    const dateInput = form?.querySelector('[name="agendado_para"]');
    const statusSelect = form?.querySelector('[name="status"]');
    const motiveSelect = form?.querySelector('[name="motivo_status"]');
    const departmentInput = form?.querySelector('[name="departamento_destino"]');
    const submitButton = form?.querySelector('[data-agenda-submit]');

    const syncTypeFields = () => {
      const type = String(typeSelect?.value || 'registro');
      const scheduled = isScheduledType(type);
      form?.querySelectorAll('[data-agenda-scheduled-field]').forEach((field) => { field.hidden = !scheduled; });
      const departmentField = form?.querySelector('[data-agenda-department-field]');
      if (departmentField) departmentField.hidden = type !== 'transferir_departamento';
      if (dateInput) dateInput.required = scheduled;
      if (departmentInput) departmentInput.required = type === 'transferir_departamento';
      if (submitButton) {
        submitButton.innerHTML = scheduled
          ? '<i class="fa-solid fa-floppy-disk"></i> Salvar agendamento'
          : '<i class="fa-solid fa-floppy-disk"></i> Salvar registro';
      }
    };

    typeSelect?.addEventListener('change', syncTypeFields, listenerOptions);
    syncTypeFields();

    submitButton?.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = submitButton;
      const tipo = String(typeSelect?.value || 'registro');
      const scheduled = isScheduledType(tipo);
      const assunto = String(form?.querySelector('[name="assunto"]')?.value || '').trim();
      const descricao = String(form?.querySelector('[name="descricao"]')?.value || '').trim();
      const localDate = String(dateInput?.value || '').trim();
      const status = String(statusSelect?.value || 'em_aberto');
      const motivoStatus = String(motiveSelect?.value || '').trim();
      const informacoesLivres = String(form?.querySelector('[name="informacoes_livres"]')?.value || '').trim();
      const departamentoDestino = String(departmentInput?.value || '').trim();

      if (!assunto) {
        showMessage('Informe o assunto do registro ou agendamento.', 'error');
        return;
      }
      if (scheduled && !localDate) {
        showMessage('Informe a data e o horário do agendamento.', 'error');
        return;
      }
      if (tipo === 'transferir_departamento' && !departamentoDestino) {
        showMessage('Informe o departamento de destino.', 'error');
        return;
      }

      let agendadoPara = null;
      if (localDate) {
        const parsed = new Date(localDate);
        if (Number.isNaN(parsed.getTime())) {
          showMessage('Data e horário inválidos.', 'error');
          return;
        }
        agendadoPara = parsed.toISOString();
      }

      if (button) button.disabled = true;
      try {
        await apiJson(`${API}/itens`, {
          method: 'POST',
          body: JSON.stringify({
            entidade_tipo: context.entidadeTipo,
            entidade_id: Number(context.entidadeId),
            tipo,
            assunto,
            descricao: descricao || null,
            agendado_para: scheduled ? agendadoPara : null,
            status: scheduled ? status : null,
            motivo_status: scheduled ? (motivoStatus || null) : null,
            informacoes_livres: scheduled ? (informacoesLivres || null) : null,
            departamento_destino: tipo === 'transferir_departamento' ? departamentoDestino : null,
          }),
        });

        form?.querySelectorAll('input, textarea').forEach((input) => { input.value = ''; });
        if (typeSelect) typeSelect.value = 'registro';
        if (statusSelect) statusSelect.value = 'em_aberto';
        if (motiveSelect) motiveSelect.value = '';
        syncTypeFields();

        showMessage(scheduled ? 'Agendamento salvo com sucesso.' : 'Contato salvo no histórico.');
        await Promise.all([
          refreshEntity(context.containerId, { force: true }),
          refreshNotifications({ showAlerts: false, force: true }),
        ]);
      } catch (error) {
        showMessage(error.message, 'error');
      } finally {
        if (button) button.disabled = false;
      }
    }, listenerOptions);

    container.addEventListener('click', async (event) => {
      const refresh = event.target.closest('[data-agenda-refresh]');
      if (refresh) {
        await refreshEntity(context.containerId, { force: true });
        return;
      }

      const actionButton = event.target.closest('[data-agenda-action]');
      if (!actionButton) return;
      await handleItemAction(actionButton, context.containerId);
    }, listenerOptions);
  }

  async function refreshEntity(containerId, { force = false } = {}) {
    const context = state.contexts.get(containerId);
    const container = document.getElementById(containerId);
    const list = container?.querySelector('[data-agenda-list]');
    if (!context || !list || !context.entidadeId) return [];

    if (!force && context.loaded) return context.items || [];
    if (context.loadingPromise) return context.loadingPromise;

    const requestVersion = Number(context.requestVersion || 0) + 1;
    context.requestVersion = requestVersion;
    context.abortController?.abort?.();
    const controller = new AbortController();
    context.abortController = controller;

    list.innerHTML = '<div class="agenda-loading">Carregando histórico...</div>';

    const request = (async () => {
      try {
        const items = await apiJson(
          `${API}/entidade/${encodeURIComponent(context.entidadeTipo)}/${Number(context.entidadeId)}?limit=150`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted || state.contexts.get(containerId) !== context || context.requestVersion !== requestVersion) {
          return context.items || [];
        }

        context.items = Array.isArray(items) ? items : [];
        context.loaded = true;
        list.innerHTML = context.items.length
          ? context.items.map((item) => entityItemHtml(item, { readonly: context.readonly })).join('')
          : '<div class="agenda-empty">Nenhum registro, tarefa ou agendamento neste cadastro.</div>';
        return context.items;
      } catch (error) {
        if (error?.name === 'AbortError' || controller.signal.aborted) return context.items || [];
        context.loaded = false;
        list.innerHTML = `<div class="agenda-empty">${escapeHtml(error.message)}</div>`;
        return [];
      } finally {
        if (context.loadingPromise === request) context.loadingPromise = null;
        if (context.abortController === controller) context.abortController = null;
      }
    })();

    context.loadingPromise = request;
    return request;
  }

  async function setEntityContext(options = {}) {
    const containerId = String(options.containerId || '');
    const entidadeTipo = String(options.entidadeTipo || '');
    if (!containerId || !['cliente', 'fornecedor', 'produto'].includes(entidadeTipo)) return;

    const previous = state.contexts.get(containerId);
    previous?.abortController?.abort?.();

    const context = {
      containerId,
      entidadeTipo,
      entidadeId: Number(options.entidadeId || 0) || null,
      entidadeNome: String(options.entidadeNome || ''),
      readonly: Boolean(options.readonly),
      items: [],
      loaded: false,
      loadingPromise: null,
      abortController: null,
      requestVersion: 0,
    };

    state.contexts.set(context.containerId, context);
    renderEntityShell(context);

    // A agenda é carregada somente quando o usuário abre o corpo fixo.
    // Isso evita bloquear a abertura do cadastro com uma consulta que talvez nem seja usada.
    const agendaPanel = document.getElementById(context.containerId)?.closest('[data-ficha-fixed="true"]');
    if (options.eager === true || agendaPanel?.classList.contains('active')) {
      await refreshEntity(context.containerId);
    }
  }

  async function handleItemAction(button, containerId = null) {
    const action = button.dataset.agendaAction;
    const id = Number(button.dataset.id || 0);
    if (!id) return;

    const article = button.closest('[data-agenda-item]');
    const editor = article?.querySelector(`[data-agenda-edit-form="${id}"]`);

    if (action === 'edit') {
      if (editor) editor.hidden = !editor.hidden;
      return;
    }
    if (action === 'cancel-edit') {
      if (editor) editor.hidden = true;
      return;
    }

    button.disabled = true;
    try {
      if (action === 'save-edit') {
        if (!editor) return;
        const localDate = String(editor.querySelector('[name="agendado_para"]')?.value || '').trim();
        const departamentoDestino = String(editor.querySelector('[name="departamento_destino"]')?.value || '').trim();
        if (!localDate) {
          showMessage('Informe a data e o horário do agendamento.', 'error');
          return;
        }
        if (editor.querySelector('[name="departamento_destino"]') && !departamentoDestino) {
          showMessage('Informe o departamento de destino.', 'error');
          return;
        }
        const parsed = new Date(localDate);
        if (Number.isNaN(parsed.getTime())) {
          showMessage('Data e horário inválidos.', 'error');
          return;
        }
        await apiJson(`${API}/itens/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: String(editor.querySelector('[name="status"]')?.value || 'em_aberto'),
            motivo_status: String(editor.querySelector('[name="motivo_status"]')?.value || '').trim() || null,
            agendado_para: parsed.toISOString(),
            informacoes_livres: String(editor.querySelector('[name="informacoes_livres"]')?.value || '').trim() || null,
            departamento_destino: departamentoDestino || null,
          }),
        });
        showMessage('Agendamento atualizado.');
      } else if (action === 'complete' || action === 'reopen') {
        await apiJson(`${API}/itens/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: action === 'complete' ? 'finalizado' : 'em_aberto' }),
        });
        showMessage(action === 'complete' ? 'Agendamento finalizado.' : 'Agendamento reaberto.');
      } else if (action === 'delete') {
        const confirmed = window.confirm('Excluir este item da agenda e do histórico?');
        if (!confirmed) return;
        await apiJson(`${API}/itens/${id}`, { method: 'DELETE' });
        showMessage('Item excluído.');
      } else if (action === 'go') {
        const type = button.dataset.entityType;
        const entityId = Number(button.dataset.entityId || 0);
        try {
          localStorage.setItem('valora_agenda_open_entity', JSON.stringify({ type, entityId, createdAt: Date.now() }));
        } catch (_) {}
        window.location.href = modulePath(type);
        return;
      }

      if (containerId) await refreshEntity(containerId, { force: true });
      await refreshNotifications({ showAlerts: false, force: true });
    } catch (error) {
      showMessage(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function ensureGlobalUi() {
    if (!document.body || document.getElementById('valora-agenda-overlay')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="valora-agenda-overlay" id="valora-agenda-overlay" aria-hidden="true">
        <aside class="valora-agenda-drawer" role="dialog" aria-modal="true" aria-labelledby="valora-agenda-title">
          <div class="valora-agenda-drawer-head">
            <div>
              <h3 id="valora-agenda-title">Agenda</h3>
              <p>Retornos, propostas, ordens de serviço e tarefas programadas.</p>
            </div>
            <button class="valora-agenda-close" type="button" data-agenda-close aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="valora-agenda-drawer-summary">
            <div class="agenda-summary-box"><strong data-agenda-total-overdue>0</strong><span>vencidos</span></div>
            <div class="agenda-summary-box"><strong data-agenda-total-pending>0</strong><span>em acompanhamento</span></div>
          </div>
          <div class="valora-agenda-drawer-list" data-agenda-global-list>
            <div class="agenda-loading">Carregando agenda...</div>
          </div>
        </aside>
      </div>
      <div class="valora-agenda-alerts" id="valora-agenda-alerts" aria-live="assertive"></div>
    `);

    const overlay = document.getElementById('valora-agenda-overlay');
    overlay?.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-agenda-close]')) closePanel();
    });
    overlay?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-agenda-action]');
      if (!button) return;
      await handleItemAction(button);
      renderGlobalPanel();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && overlay?.classList.contains('is-open')) closePanel();
    });
  }

  function openPanel() {
    ensureGlobalUi();
    const overlay = document.getElementById('valora-agenda-overlay');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    refreshNotifications({ showAlerts: false, force: true });
  }

  function closePanel() {
    const overlay = document.getElementById('valora-agenda-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-overlay.show')) document.body.classList.remove('modal-open');
  }

  function renderGlobalPanel() {
    ensureGlobalUi();
    const data = state.notifications;
    const list = document.querySelector('[data-agenda-global-list]');
    const overdueEl = document.querySelector('[data-agenda-total-overdue]');
    const pendingEl = document.querySelector('[data-agenda-total-pending]');
    if (overdueEl) overdueEl.textContent = String(data.total_vencidos || 0);
    if (pendingEl) pendingEl.textContent = String(data.total_pendentes || 0);
    if (!list) return;

    const items = [...(data.vencidos || []), ...(data.proximos || [])];
    list.innerHTML = items.length
      ? items.map((item) => entityItemHtml(item, { global: true })).join('')
      : '<div class="agenda-empty">Você não possui agendamentos pendentes.</div>';
  }

  function updateSidebarBadge(count) {
    const numericCount = Math.max(0, Number(count || 0));
    document.querySelectorAll('.valora-menu-bell').forEach((button) => {
      let badge = button.querySelector('.valora-menu-agenda-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'valora-menu-agenda-badge';
        button.appendChild(badge);
      }
      badge.textContent = numericCount > 99 ? '99+' : String(numericCount);
      badge.classList.toggle('is-visible', numericCount > 0);
      button.setAttribute('aria-label', numericCount > 0 ? `Notificações: ${numericCount} vencida(s)` : 'Notificações');
    });

    document.querySelectorAll('iframe.sidebar-frame').forEach((frame) => {
      try {
        frame.contentWindow?.postMessage({ type: 'valora-agenda-count', count: numericCount }, window.location.origin);
      } catch (_) {}
    });
  }

  async function markNotified(id) {
    try {
      await apiJson(`${API}/itens/${id}/marcar-notificado`, { method: 'POST' });
    } catch (_) {}
  }

  function dismissAlert(id) {
    document.querySelector(`[data-agenda-alert="${id}"]`)?.remove();
  }

  function showReminderAlert(item) {
    const id = Number(item?.id || 0);
    if (!id || state.shownAlerts.has(id)) return;
    state.shownAlerts.add(id);
    ensureGlobalUi();
    const container = document.getElementById('valora-agenda-alerts');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', `
      <article class="valora-agenda-alert" data-agenda-alert="${id}">
        <div class="valora-agenda-alert-head">
          <div class="valora-agenda-alert-title">
            <i class="fa-solid fa-bell"></i>
            <div>
              <strong>${escapeHtml(item.assunto)}</strong>
              <p>${escapeHtml(entityLabel(item.entidade_tipo))}: ${escapeHtml(item.entidade_nome)}<br>${escapeHtml(formatDateTime(item.agendado_para))}</p>
            </div>
          </div>
          <button class="agenda-link-btn" type="button" data-alert-dismiss="${id}" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </div>
        ${item.descricao ? `<p>${escapeHtml(item.descricao)}</p>` : ''}
        <div class="valora-agenda-alert-actions">
          <button class="agenda-secondary" type="button" data-alert-panel="${id}">Ver agenda</button>
          <button class="agenda-primary" type="button" data-alert-complete="${id}"><i class="fa-solid fa-check"></i> Finalizar</button>
        </div>
      </article>
    `);

    const alert = container.querySelector(`[data-agenda-alert="${id}"]`);
    alert?.addEventListener('click', async (event) => {
      if (event.target.closest('[data-alert-dismiss]')) {
        dismissAlert(id);
        return;
      }
      if (event.target.closest('[data-alert-panel]')) {
        dismissAlert(id);
        openPanel();
        return;
      }
      const complete = event.target.closest('[data-alert-complete]');
      if (complete) {
        complete.disabled = true;
        try {
          await apiJson(`${API}/itens/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'finalizado' }) });
          dismissAlert(id);
          showMessage('Agendamento finalizado.');
          await refreshNotifications({ showAlerts: false });
        } catch (error) {
          showMessage(error.message, 'error');
          complete.disabled = false;
        }
      }
    });

    markNotified(id);
  }

  async function refreshNotifications({ showAlerts = true, force = false } = {}) {
    if (!force && document.hidden) return state.notifications;
    if (state.notificationRequest) return state.notificationRequest;

    const now = Date.now();
    if (!force && state.lastNotificationAt && now - state.lastNotificationAt < 10000) {
      return state.notifications;
    }

    const request = (async () => {
      try {
        const data = await apiJson(`${API}/notificacoes?limit=200`);
        state.notifications = data || state.notifications;
        state.lastNotificationAt = Date.now();
        updateSidebarBadge(state.notifications.total_vencidos || 0);
        renderGlobalPanel();
        if (showAlerts) {
          (state.notifications.novos_alertas || []).slice(0, 5).forEach(showReminderAlert);
        }
        return state.notifications;
      } catch (error) {
        if (error.message && !/não autenticado|sessão/i.test(error.message)) {
          console.warn('[Agenda] Falha ao carregar notificações:', error.message);
        }
        return state.notifications;
      } finally {
        if (state.notificationRequest === request) state.notificationRequest = null;
      }
    })();

    state.notificationRequest = request;
    return request;
  }

  function consumePendingNavigation() {
    try {
      const raw = localStorage.getItem('valora_agenda_open_entity');
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!value || Date.now() - Number(value.createdAt || 0) > 120000) {
        localStorage.removeItem('valora_agenda_open_entity');
        return null;
      }
      localStorage.removeItem('valora_agenda_open_entity');
      return value;
    } catch (_) {
      return null;
    }
  }

  function getFixedAgendaScope(button) {
    const selector = button?.dataset?.agendaScope;
    if (selector) {
      try {
        const scoped = document.querySelector(selector);
        if (scoped) return scoped;
      } catch (_) {}
    }
    return button?.closest('form, .modal-content, .modal-overlay') || document;
  }

  function setFixedAgendaButtonState(button, active) {
    if (!button) return;
    button.classList.toggle('is-active', !!active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function openFixedEntityAgenda(button) {
    const scope = getFixedAgendaScope(button);
    const targetId = String(button.dataset.agendaFixedOpen || '').trim();
    const panelSelector = String(button.dataset.agendaPanelSelector || '').trim();
    const tabSelector = String(button.dataset.agendaTabSelector || '').trim();
    if (!targetId || !panelSelector) return;

    const target = scope.querySelector(`#${CSS.escape(targetId)}`);
    if (!target) {
      console.warn('[Agenda] Painel fixo não encontrado:', targetId);
      return;
    }

    scope.querySelectorAll(panelSelector).forEach((panel) => {
      panel.classList.toggle('active', panel === target);
    });

    if (tabSelector) {
      scope.querySelectorAll(tabSelector).forEach((tabButton) => {
        tabButton.classList.remove('active');
      });
    }

    target.style.display = '';
    scope.querySelectorAll('[data-agenda-fixed-open]').forEach((fixedButton) => {
      setFixedAgendaButtonState(fixedButton, fixedButton === button);
    });

    const slot = target.querySelector('.agenda-entity-slot[id]');
    if (slot?.id) void refreshEntity(slot.id);
  }

  function bindFixedEntityAgendaButtons() {
    document.querySelectorAll('[data-agenda-fixed-open]').forEach((button) => {
      if (button.dataset.agendaFixedBound === 'true') return;
      button.dataset.agendaFixedBound = 'true';
      button.addEventListener('click', () => openFixedEntityAgenda(button));
      setFixedAgendaButtonState(button, false);
    });

    document.addEventListener('click', (event) => {
      const regularTab = event.target.closest('[data-tab], [data-ficha-section]');
      if (!regularTab || regularTab.closest('[data-agenda-fixed-open]')) return;

      const scope = regularTab.closest('form, .modal-content, .modal-overlay') || document;
      scope.querySelectorAll('[data-agenda-fixed-open].is-active').forEach((button) => {
        setFixedAgendaButtonState(button, false);
      });
    });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    ensureGlobalUi();
    bindFixedEntityAgendaButtons();

    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'valora-agenda-open') openPanel();
    });

    document.querySelectorAll('iframe.sidebar-frame').forEach((frame) => {
      frame.addEventListener('load', () => updateSidebarBadge(state.notifications.total_vencidos || 0));
    });

    const firstRefresh = () => refreshNotifications({ showAlerts: true, force: true });
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(firstRefresh, { timeout: 1800 });
    } else {
      window.setTimeout(firstRefresh, 700);
    }

    state.polling = window.setInterval(() => {
      if (!document.hidden) refreshNotifications({ showAlerts: true });
    }, 30000);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastNotificationAt > 15000) {
        refreshNotifications({ showAlerts: true });
      }
    });
  }

  window.ValoraAgenda = {
    setEntityContext,
    refreshEntity,
    refreshNotifications,
    openPanel,
    closePanel,
    consumePendingNavigation,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
