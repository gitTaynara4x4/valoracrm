(() => {
  'use strict';

  const API_BASE = '/api/formularios';

  const MODULOS = {
    clientes: {
      label: 'Clientes',
      icon: 'fa-user-group',
      customEndpoint: '/api/campos-clientes',
    },
    fornecedores: {
      label: 'Fornecedores',
      icon: 'fa-truck',
      customEndpoint: '/api/campos-fornecedores',
    },
    produtos: {
      label: 'Produtos',
      icon: 'fa-box-open',
      customEndpoint: '/api/produtos/campos/lista',
    },
    propostas: {
      label: 'Propostas',
      icon: 'fa-file-signature',
      customEndpoint: '/api/campos-propostas',
    },
    contratos: {
      label: 'Contratos',
      icon: 'fa-file-contract',
      customEndpoint: null,
    },
  };

  const state = {
    modulo: 'clientes',
    modelos: [],
    modeloAtual: null,
    camposSistema: [],
    camposPersonalizados: [],
    campoEditando: null,
    secaoEditando: null,
    modeloEditando: null,
  };

  const qs = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toast(message, error = false, ms = 2800) {
    const el = qs('valora-toast');
    if (!el) return;

    el.textContent = message || '';
    el.classList.toggle('is-error', !!error);
    el.classList.add('show');

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async function apiJson(url, options = {}) {
    const resp = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });

    if (resp.status === 204) return null;

    const text = await resp.text();

    if (!resp.ok) {
      let detail = text || 'Erro na requisição.';
      try {
        const json = JSON.parse(text);
        detail = json.detail || json.message || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  function openModal(id) {
    qs(id)?.classList.add('show');
  }

  function closeModal(id) {
    qs(id)?.classList.remove('show');
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.show').forEach((modal) => modal.classList.remove('show'));
  }

  function setLoadingSelect(select, text = 'Carregando...') {
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(text)}</option>`;
  }

  function moduloLabel(modulo = state.modulo) {
    return MODULOS[modulo]?.label || modulo;
  }

  function origemLabel(origem) {
    const map = {
      sistema: 'Sistema',
      personalizado: 'Personalizado',
      visual: 'Visual',
    };
    return map[origem] || origem || '-';
  }

  function tipoLabel(campo) {
    if (!campo) return '-';
    if (campo.origem === 'visual') return campo.tipo_visual || 'visual';
    return campo.tipo_campo || 'texto';
  }

  function widthLabel(width) {
    if (!width) return '100%';
    if (String(width).includes('%')) return width;
    if (/^\d+$/.test(String(width))) return `${width}%`;
    return width;
  }

  function parseOpcoes(raw) {
    return String(raw || '')
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function opcoesToInput(value) {
    if (!value) return '';

    if (Array.isArray(value)) return value.join(', ');

    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.join(', ');
      } catch (_) {}
      return value;
    }

    return '';
  }

  async function carregarModelos() {
    const data = await apiJson(`${API_BASE}/modelos?modulo=${encodeURIComponent(state.modulo)}`);
    state.modelos = Array.isArray(data) ? data : [];
    renderModelosSelect();

    if (state.modelos.length) {
      const padrao = state.modelos.find((m) => m.padrao) || state.modelos[0];
      await carregarModeloCompleto(padrao.id);
    } else {
      state.modeloAtual = null;
      renderModeloAtual();
    }
  }

  async function carregarModeloCompleto(id) {
    if (!id) {
      state.modeloAtual = null;
      renderModeloAtual();
      return;
    }

    const data = await apiJson(`${API_BASE}/modelos/${id}`);
    state.modeloAtual = data;

    const select = qs('select-modelo');
    if (select) select.value = String(id);

    renderModeloAtual();
  }

  async function carregarCamposSistema() {
    try {
      const data = await apiJson(`${API_BASE}/campos-sistema?modulo=${encodeURIComponent(state.modulo)}`);
      state.camposSistema = Array.isArray(data?.campos) ? data.campos : [];
    } catch (err) {
      console.error('[Formulários] erro ao carregar campos do sistema:', err);
      state.camposSistema = [];
    }

    renderCampoSistemaSelect();
  }

  async function carregarCamposPersonalizados() {
    const endpoint = MODULOS[state.modulo]?.customEndpoint;

    if (!endpoint) {
      state.camposPersonalizados = [];
      renderCampoPersonalizadoSelect();
      return;
    }

    try {
      const data = await apiJson(endpoint);
      state.camposPersonalizados = Array.isArray(data) ? data : [];
      state.camposPersonalizados.sort((a, b) => {
        return Number(a.ordem || 0) - Number(b.ordem || 0) ||
          String(a.nome || '').localeCompare(String(b.nome || ''));
      });
    } catch (err) {
      console.warn('[Formulários] não foi possível carregar campos personalizados:', err);
      state.camposPersonalizados = [];
    }

    renderCampoPersonalizadoSelect();
  }

  function renderModelosSelect() {
    const select = qs('select-modelo');
    if (!select) return;

    if (!state.modelos.length) {
      select.innerHTML = '<option value="">Nenhum formulário criado</option>';
      return;
    }

    select.innerHTML = state.modelos.map((modelo) => {
      const badge = modelo.padrao ? ' • padrão' : '';
      return `<option value="${modelo.id}">${escapeHtml(modelo.nome)}${badge}</option>`;
    }).join('');
  }

  function renderModeloAtual() {
    const modelo = state.modeloAtual?.modelo || null;

    qs('modulo-titulo').textContent = moduloLabel();
    qs('modelo-nome').textContent = modelo ? modelo.nome : 'Nenhum formulário selecionado';
    qs('modelo-descricao').textContent = modelo
      ? (modelo.descricao || `${moduloLabel()} • ${modelo.padrao ? 'formulário padrão' : 'formulário personalizado'}`)
      : 'Crie um formulário padrão para começar.';

    const hasModelo = !!modelo;
    qs('btn-editar-modelo').disabled = !hasModelo;
    qs('btn-nova-secao').disabled = !hasModelo;
    qs('btn-novo-campo').disabled = !hasModelo;

    const empty = qs('builder-empty');
    const wrap = qs('secoes-container');

    if (!hasModelo) {
      if (empty) empty.style.display = '';
      if (wrap) wrap.innerHTML = '';
      return;
    }

    if (empty) empty.style.display = 'none';
    renderSecoes();
    renderSecaoSelect();
  }

  function camposOrdenados(campos = []) {
    return [...campos].sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0) || Number(a.id || 0) - Number(b.id || 0));
  }

  function renderSecoes() {
    const wrap = qs('secoes-container');
    if (!wrap) return;

    const atual = state.modeloAtual;
    if (!atual?.modelo) {
      wrap.innerHTML = '';
      return;
    }

    const secoes = Array.isArray(atual.secoes) ? atual.secoes : [];
    const camposSemSecao = Array.isArray(atual.campos_sem_secao) ? atual.campos_sem_secao : [];

    let html = '';

    if (!secoes.length && !camposSemSecao.length) {
      wrap.innerHTML = `
        <div class="builder-empty panel-card">
          <i class="fa-solid fa-folder-open"></i>
          <strong>Este formulário ainda está vazio.</strong>
          <span>Adicione uma seção como “01 - Dados básicos” e depois coloque os campos dentro dela.</span>
        </div>
      `;
      return;
    }

    secoes.forEach((secao) => {
      html += renderSecaoCard(secao);
    });

    if (camposSemSecao.length) {
      html += renderSecaoCard({
        id: '',
        titulo: 'Campos sem seção',
        descricao: 'Campos adicionados sem vínculo com uma seção.',
        ativo: true,
        campos: camposSemSecao,
        semSecao: true,
      });
    }

    wrap.innerHTML = html;
  }

  function renderSecaoCard(secao) {
    const campos = camposOrdenados(secao.campos || []);
    const inactive = secao.ativo === false ? '<span class="badge off">Inativa</span>' : '';

    const actions = secao.semSecao ? '' : `
      <div class="secao-actions">
        <button class="icon-btn" type="button" data-action="editar-secao" data-id="${secao.id}" title="Editar seção">
          <i class="fa-solid fa-pen"></i>
        </button>
        <button class="icon-btn danger" type="button" data-action="excluir-secao" data-id="${secao.id}" title="Excluir seção">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;

    const camposHtml = campos.length
      ? campos.map(renderCampoCard).join('')
      : `<div class="empty-section">Nenhum campo nesta seção ainda.</div>`;

    return `
      <article class="secao-card">
        <div class="secao-head">
          <div class="secao-title-wrap">
            <h4 class="secao-title">
              <i class="fa-solid fa-layer-group"></i>
              <span>${escapeHtml(secao.titulo || 'Seção')}</span>
              ${inactive}
            </h4>
            ${secao.descricao ? `<p class="secao-desc">${escapeHtml(secao.descricao)}</p>` : ''}
          </div>
          ${actions}
        </div>
        <div class="campos-list">
          ${camposHtml}
        </div>
      </article>
    `;
  }

  function renderCampoCard(campo) {
    const origem = campo.origem || 'personalizado';
    const badgeClass = origem === 'sistema' ? 'system' : origem === 'visual' ? 'visual' : 'custom';
    const inactive = campo.ativo === false ? '<span class="badge off">Inativo</span>' : '';
    const required = campo.obrigatorio ? '<span class="badge">Obrigatório</span>' : '';
    const readonly = campo.somente_leitura ? '<span class="badge">Somente leitura</span>' : '';

    const detalhes = [
      `Origem: ${origemLabel(origem)}`,
      `Tipo: ${tipoLabel(campo)}`,
      `Largura: ${widthLabel(campo.largura)}`,
      `Ordem: ${Number(campo.ordem || 0)}`,
      campo.visibilidade && campo.visibilidade !== 'todos' ? `Visibilidade: ${campo.visibilidade}` : '',
    ].filter(Boolean);

    return `
      <div class="campo-card">
        <div class="campo-main">
          <div class="campo-title">
            <span class="badge ${badgeClass}">
              <i class="fa-solid ${origem === 'visual' ? 'fa-heading' : origem === 'sistema' ? 'fa-database' : 'fa-pen-to-square'}"></i>
              ${escapeHtml(origemLabel(origem))}
            </span>
            <strong>${escapeHtml(campo.label || '-')}</strong>
            ${required}
            ${readonly}
            ${inactive}
          </div>

          <div class="campo-meta">
            ${detalhes.map((d) => `<span>${escapeHtml(d)}</span>`).join('')}
          </div>

          ${campo.ajuda ? `<div class="campo-ajuda">${escapeHtml(campo.ajuda)}</div>` : ''}
        </div>

        <div class="campo-actions">
          <button class="icon-btn" type="button" data-action="editar-campo" data-id="${campo.id}" title="Editar campo">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="icon-btn danger" type="button" data-action="excluir-campo" data-id="${campo.id}" title="Excluir campo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }

  function renderSecaoSelect(selectedId = '') {
    const select = qs('campo-secao');
    if (!select) return;

    const secoes = Array.isArray(state.modeloAtual?.secoes) ? state.modeloAtual.secoes : [];
    select.innerHTML = '<option value="">Sem seção</option>' + secoes.map((secao) => {
      const selected = String(selectedId || '') === String(secao.id) ? 'selected' : '';
      return `<option value="${secao.id}" ${selected}>${escapeHtml(secao.titulo)}</option>`;
    }).join('');
  }

  function renderCampoSistemaSelect(selectedValue = '') {
    const select = qs('campo-sistema');
    if (!select) return;

    if (!state.camposSistema.length) {
      select.innerHTML = '<option value="">Nenhum campo do sistema encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposSistema.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.campo || '') ? 'selected' : '';
      return `<option value="${escapeHtml(campo.campo)}" data-label="${escapeHtml(campo.label)}" data-tipo="${escapeHtml(campo.tipo || 'texto')}" ${selected}>${escapeHtml(campo.label)} (${escapeHtml(campo.campo)})</option>`;
    }).join('');
  }

  function renderCampoPersonalizadoSelect(selectedValue = '') {
    const select = qs('campo-personalizado');
    if (!select) return;

    if (!state.camposPersonalizados.length) {
      select.innerHTML = '<option value="">Nenhum campo personalizado encontrado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione</option>' + state.camposPersonalizados.map((campo) => {
      const selected = String(selectedValue || '') === String(campo.id || '') ? 'selected' : '';
      return `<option value="${campo.id}" data-label="${escapeHtml(campo.nome || '')}" data-tipo="${escapeHtml(campo.tipo || 'texto')}" ${selected}>${escapeHtml(campo.nome || '-')} (${escapeHtml(campo.slug || campo.id)})</option>`;
    }).join('');
  }

  function toggleCampoOrigem() {
    const origem = qs('campo-origem')?.value || 'sistema';

    qs('row-campo-sistema').style.display = origem === 'sistema' ? '' : 'none';
    qs('row-campo-personalizado').style.display = origem === 'personalizado' ? '' : 'none';

    const rowVisual = qs('row-campo-visual');
    if (rowVisual) rowVisual.style.display = origem === 'visual' ? '' : 'none';

    const tipoCampo = qs('campo-tipo-campo');
    if (tipoCampo) {
      tipoCampo.closest('.form-group').style.display = origem === 'visual' ? 'none' : '';
    }
  }

  function preencherLabelPorSistema() {
    const opt = qs('campo-sistema')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';

    if (!qs('campo-label').value.trim()) qs('campo-label').value = label.replace(/\s*\(.+\)\s*$/, '');
    qs('campo-tipo-campo').value = tipo;
  }

  function preencherLabelPorPersonalizado() {
    const opt = qs('campo-personalizado')?.selectedOptions?.[0];
    if (!opt) return;

    const label = opt.dataset.label || opt.textContent || '';
    const tipo = opt.dataset.tipo || 'texto';

    if (!qs('campo-label').value.trim()) qs('campo-label').value = label.replace(/\s*\(.+\)\s*$/, '');
    qs('campo-tipo-campo').value = tipo;
  }

  function resetModeloForm(edit = false) {
    state.modeloEditando = edit ? state.modeloAtual?.modelo : null;

    qs('modal-modelo-title').textContent = edit ? 'Editar formulário' : 'Novo formulário';
    qs('modelo-id').value = edit && state.modeloEditando ? state.modeloEditando.id : '';
    qs('modelo-modulo').value = edit && state.modeloEditando ? state.modeloEditando.modulo : state.modulo;
    qs('modelo-nome-input').value = edit && state.modeloEditando ? state.modeloEditando.nome || '' : '';
    qs('modelo-descricao-input').value = edit && state.modeloEditando ? state.modeloEditando.descricao || '' : '';
    qs('modelo-ativo').checked = edit && state.modeloEditando ? state.modeloEditando.ativo !== false : true;
    qs('modelo-padrao').checked = edit && state.modeloEditando ? !!state.modeloEditando.padrao : false;
  }

  function resetSecaoForm(secao = null) {
    state.secaoEditando = secao;

    qs('modal-secao-title').textContent = secao ? 'Editar seção' : 'Nova seção';
    qs('secao-id').value = secao?.id || '';
    qs('secao-titulo').value = secao?.titulo || '';
    qs('secao-descricao').value = secao?.descricao || '';
    qs('secao-ordem').value = secao ? Number(secao.ordem || 0) : proximaOrdemSecao();
    qs('secao-ativo').checked = secao ? secao.ativo !== false : true;
    qs('btn-excluir-secao').style.display = secao ? '' : 'none';
  }

  function resetCampoForm(campo = null) {
    state.campoEditando = campo;

    qs('modal-campo-title').textContent = campo ? 'Editar campo' : 'Novo campo';
    qs('campo-id').value = campo?.id || '';

    renderSecaoSelect(campo?.secao_id || '');
    renderCampoSistemaSelect(campo?.campo_sistema || '');
    renderCampoPersonalizadoSelect(campo?.campo_personalizado_id || '');

    qs('campo-secao').value = campo?.secao_id || '';
    qs('campo-origem').value = campo?.origem || 'sistema';
    qs('campo-sistema').value = campo?.campo_sistema || '';
    qs('campo-personalizado').value = campo?.campo_personalizado_id || '';
    qs('campo-tipo-visual').value = campo?.tipo_visual || 'titulo';
    qs('campo-tipo-campo').value = campo?.tipo_campo || 'texto';
    qs('campo-label').value = campo?.label || '';
    qs('campo-placeholder').value = campo?.placeholder || '';
    qs('campo-ajuda').value = campo?.ajuda || '';
    qs('campo-largura').value = campo?.largura || '100';
    qs('campo-visibilidade').value = campo?.visibilidade || 'todos';
    qs('campo-ordem').value = campo ? Number(campo.ordem || 0) : proximaOrdemCampo();
    qs('campo-opcoes').value = opcoesToInput(campo?.opcoes || campo?.opcoes_json || '');
    qs('campo-obrigatorio').checked = campo ? !!campo.obrigatorio : false;
    qs('campo-somente-leitura').checked = campo ? !!campo.somente_leitura : false;
    qs('campo-ativo').checked = campo ? campo.ativo !== false : true;
    qs('btn-excluir-campo').style.display = campo ? '' : 'none';

    toggleCampoOrigem();
  }

  function proximaOrdemSecao() {
    const secoes = state.modeloAtual?.secoes || [];
    if (!secoes.length) return 1;
    return Math.max(...secoes.map((s) => Number(s.ordem || 0))) + 1;
  }

  function proximaOrdemCampo() {
    const campos = state.modeloAtual?.campos || [];
    if (!campos.length) return 1;
    return Math.max(...campos.map((c) => Number(c.ordem || 0))) + 1;
  }

  function buildModeloPayload() {
    return {
      modulo: qs('modelo-modulo').value,
      nome: qs('modelo-nome-input').value.trim(),
      descricao: qs('modelo-descricao-input').value.trim() || null,
      ativo: qs('modelo-ativo').checked,
      padrao: qs('modelo-padrao').checked,
    };
  }

  function buildSecaoPayload() {
    return {
      titulo: qs('secao-titulo').value.trim(),
      descricao: qs('secao-descricao').value.trim() || null,
      ordem: Number(qs('secao-ordem').value || 0),
      ativo: qs('secao-ativo').checked,
    };
  }

  function buildCampoPayload() {
    const origem = qs('campo-origem').value;
    const opcoes = parseOpcoes(qs('campo-opcoes').value);

    const payload = {
      secao_id: qs('campo-secao').value ? Number(qs('campo-secao').value) : null,
      origem,
      campo_sistema: null,
      campo_personalizado_id: null,
      tipo_visual: null,
      tipo_campo: qs('campo-tipo-campo').value || 'texto',
      label: qs('campo-label').value.trim(),
      placeholder: qs('campo-placeholder').value.trim() || null,
      ajuda: qs('campo-ajuda').value.trim() || null,
      opcoes: opcoes.length ? opcoes : null,
      obrigatorio: qs('campo-obrigatorio').checked,
      somente_leitura: qs('campo-somente-leitura').checked,
      ativo: qs('campo-ativo').checked,
      largura: qs('campo-largura').value || '100',
      ordem: Number(qs('campo-ordem').value || 0),
      visibilidade: qs('campo-visibilidade').value || 'todos',
      condicao: null,
    };

    if (origem === 'sistema') {
      payload.campo_sistema = qs('campo-sistema').value || null;
    } else if (origem === 'personalizado') {
      payload.campo_personalizado_id = qs('campo-personalizado').value ? Number(qs('campo-personalizado').value) : null;
    } else if (origem === 'visual') {
      payload.tipo_visual = qs('campo-tipo-visual').value || 'titulo';
      payload.tipo_campo = null;
      payload.obrigatorio = false;
      payload.somente_leitura = true;
    }

    return payload;
  }

  async function salvarModelo() {
    const payload = buildModeloPayload();

    if (!payload.nome) {
      toast('Informe o nome do formulário.', true);
      return;
    }

    const id = qs('modelo-id').value;
    const btn = qs('btn-salvar-modelo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      let salvo;

      if (id) {
        salvo = await apiJson(`${API_BASE}/modelos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        salvo = await apiJson(`${API_BASE}/modelos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      state.modulo = salvo.modulo || payload.modulo;
      marcarModuloAtivo();
      await carregarModelos();
      if (salvo?.id) await carregarModeloCompleto(salvo.id);

      closeModal('modal-modelo');
      toast('Formulário salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar formulário.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar formulário';
    }
  }

  async function salvarSecao() {
    if (!state.modeloAtual?.modelo?.id) return;

    const payload = buildSecaoPayload();

    if (!payload.titulo) {
      toast('Informe o título da seção.', true);
      return;
    }

    const id = qs('secao-id').value;
    const btn = qs('btn-salvar-secao');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        await apiJson(`${API_BASE}/secoes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson(`${API_BASE}/modelos/${state.modeloAtual.modelo.id}/secoes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(state.modeloAtual.modelo.id);
      closeModal('modal-secao');
      toast('Seção salva com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar seção.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar seção';
    }
  }

  async function salvarCampo() {
    if (!state.modeloAtual?.modelo?.id) return;

    const payload = buildCampoPayload();

    if (!payload.label) {
      toast('Informe o nome exibido do campo.', true);
      return;
    }

    if (payload.origem === 'sistema' && !payload.campo_sistema) {
      toast('Selecione o campo do sistema.', true);
      return;
    }

    if (payload.origem === 'personalizado' && !payload.campo_personalizado_id) {
      toast('Selecione o campo personalizado.', true);
      return;
    }

    const id = qs('campo-id').value;
    const btn = qs('btn-salvar-campo');

    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
      if (id) {
        await apiJson(`${API_BASE}/campos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson(`${API_BASE}/modelos/${state.modeloAtual.modelo.id}/campos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }

      await carregarModeloCompleto(state.modeloAtual.modelo.id);
      closeModal('modal-campo');
      toast('Campo salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar campo.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar campo';
    }
  }

  async function criarPadrao() {
    const btn = qs('btn-criar-padrao');
    btn.disabled = true;
    btn.textContent = 'Criando...';

    try {
      const data = await apiJson(`${API_BASE}/modelos/padrao/${state.modulo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      await carregarModelos();

      if (data?.modelo?.id) {
        await carregarModeloCompleto(data.modelo.id);
      }

      toast(`Formulário padrão de ${moduloLabel()} criado.`);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao criar formulário padrão.', true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt" style="margin-right: 6px;"></i> Criar padrão';
    }
  }

  async function excluirSecao(id) {
    if (!id || !state.modeloAtual?.modelo?.id) return;

    const ok = confirm('Excluir esta seção? Os campos serão movidos para "sem seção".');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/secoes/${id}?mover_campos_para_sem_secao=true`, { method: 'DELETE' });
      await carregarModeloCompleto(state.modeloAtual.modelo.id);
      toast('Seção excluída.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir seção.', true);
    }
  }

  async function excluirCampo(id) {
    if (!id || !state.modeloAtual?.modelo?.id) return;

    const ok = confirm('Excluir este campo do formulário?');
    if (!ok) return;

    try {
      await apiJson(`${API_BASE}/campos/${id}`, { method: 'DELETE' });
      await carregarModeloCompleto(state.modeloAtual.modelo.id);
      closeModal('modal-campo');
      toast('Campo removido do formulário.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir campo.', true);
    }
  }

  function findSecao(id) {
    const secoes = state.modeloAtual?.secoes || [];
    return secoes.find((s) => Number(s.id) === Number(id));
  }

  function findCampo(id) {
    const campos = state.modeloAtual?.campos || [];
    return campos.find((c) => Number(c.id) === Number(id));
  }

  function marcarModuloAtivo() {
    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.modulo === state.modulo);
    });

    qs('modulo-titulo').textContent = moduloLabel();
  }

  async function trocarModulo(modulo) {
    if (!MODULOS[modulo]) return;

    state.modulo = modulo;
    state.modeloAtual = null;
    state.modelos = [];
    state.camposSistema = [];
    state.camposPersonalizados = [];

    marcarModuloAtivo();
    setLoadingSelect(qs('select-modelo'), 'Carregando...');

    await Promise.all([
      carregarCamposSistema(),
      carregarCamposPersonalizados(),
    ]);

    await carregarModelos();
  }

  async function abrirNovoCampo(campo = null) {
    await Promise.all([
      carregarCamposSistema(),
      carregarCamposPersonalizados(),
    ]);

    resetCampoForm(campo);
    openModal('modal-campo');
  }

  function bindEventos() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('mousedown', (e) => {
        if (e.target === modal) modal.classList.remove('show');
      });
    });

    document.querySelectorAll('.module-card').forEach((btn) => {
      btn.addEventListener('click', () => trocarModulo(btn.dataset.modulo));
    });

    qs('select-modelo')?.addEventListener('change', (e) => carregarModeloCompleto(e.target.value));
    qs('btn-atualizar')?.addEventListener('click', () => trocarModulo(state.modulo));
    qs('btn-criar-padrao')?.addEventListener('click', criarPadrao);

    qs('btn-novo-modelo')?.addEventListener('click', () => {
      resetModeloForm(false);
      openModal('modal-modelo');
    });

    qs('btn-editar-modelo')?.addEventListener('click', () => {
      resetModeloForm(true);
      openModal('modal-modelo');
    });

    qs('btn-salvar-modelo')?.addEventListener('click', salvarModelo);

    qs('btn-nova-secao')?.addEventListener('click', () => {
      resetSecaoForm(null);
      openModal('modal-secao');
    });

    qs('btn-salvar-secao')?.addEventListener('click', salvarSecao);
    qs('btn-excluir-secao')?.addEventListener('click', () => {
      const id = qs('secao-id').value;
      closeModal('modal-secao');
      excluirSecao(id);
    });

    qs('btn-novo-campo')?.addEventListener('click', () => abrirNovoCampo(null));
    qs('btn-salvar-campo')?.addEventListener('click', salvarCampo);
    qs('btn-excluir-campo')?.addEventListener('click', () => excluirCampo(qs('campo-id').value));

    qs('campo-origem')?.addEventListener('change', toggleCampoOrigem);
    qs('campo-sistema')?.addEventListener('change', preencherLabelPorSistema);
    qs('campo-personalizado')?.addEventListener('change', preencherLabelPorPersonalizado);

    qs('secoes-container')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'editar-secao') {
        const secao = findSecao(id);
        if (secao) {
          resetSecaoForm(secao);
          openModal('modal-secao');
        }
      }

      if (action === 'excluir-secao') {
        excluirSecao(id);
      }

      if (action === 'editar-campo') {
        const campo = findCampo(id);
        if (campo) abrirNovoCampo(campo);
      }

      if (action === 'excluir-campo') {
        excluirCampo(id);
      }
    });
  }

  async function init() {
    bindEventos();

    try {
      marcarModuloAtivo();
      await Promise.all([
        carregarCamposSistema(),
        carregarCamposPersonalizados(),
      ]);
      await carregarModelos();
    } catch (err) {
      console.error('[Formulários] erro no init:', err);
      toast(err.message || 'Erro ao carregar formulários.', true, 5000);
      renderModeloAtual();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
