(() => {
  'use strict';

  const API = '/api/patrimonio';
  const state = { itens: [], editando: null, buscaTimer: null };
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
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
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
  if (window.ValoraModal) return window.ValoraModal.open(id);
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));
}

  function closeModal(id) {
  if (window.ValoraModal) return window.ValoraModal.close(id);
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; modal.style.display = 'none'; }, 160);
}

  function statusLabel(status) {
    const map = {
      ativo: 'Ativo',
      manutencao: 'Em manutenção',
      baixado: 'Baixado',
      extraviado: 'Extraviado',
    };

    return map[status] || status || '-';
  }

  function setLoading() {
    const tbody = qs('patrimonio-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Carregando...</td></tr>';
    }
  }

  function render() {
    const tbody = qs('patrimonio-tbody');
    const contador = qs('patrimonio-contador');

    if (!tbody) return;

    if (contador) {
      contador.textContent = `${state.itens.length} ${state.itens.length === 1 ? 'item' : 'itens'}`;
    }

    if (!state.itens.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Nenhum patrimônio cadastrado ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = state.itens.map((item) => `
      <tr>
        <td><span class="badge-codigo">${escapeHtml(item.codigo || '-')}</span></td>
        <td>
          <strong>${escapeHtml(item.nome || '-')}</strong>
          ${item.marca || item.modelo ? `<small>${escapeHtml([item.marca, item.modelo].filter(Boolean).join(' • '))}</small>` : ''}
        </td>
        <td>${escapeHtml(item.categoria || '-')}</td>
        <td>${escapeHtml(item.numero_serie || '-')}</td>
        <td>${escapeHtml(item.localizacao || '-')}</td>
        <td>${escapeHtml(item.responsavel || '-')}</td>
        <td><span class="status-badge status-${escapeHtml(item.status || 'ativo')}">${escapeHtml(statusLabel(item.status))}</span></td>
        <td class="text-right">
          <button class="btn-icon" type="button" data-action="editar" data-id="${item.id}" title="Editar">
            <i class="fa-solid fa-pen"></i>
          </button>
        </td>
      </tr>
    `).join('');
  }

  async function carregar() {
    const busca = qs('patrimonio-busca')?.value?.trim() || '';
    const status = qs('patrimonio-status-filter')?.value || '';

    const params = new URLSearchParams();

    if (busca) params.set('busca', busca);
    if (status) params.set('status', status);

    setLoading();

    try {
      const data = await apiJson(`${API}${params.toString() ? `?${params.toString()}` : ''}`);
      state.itens = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      render();
    } catch (err) {
      console.error(err);
      state.itens = [];
      render();
      toast(err.message || 'Erro ao carregar patrimônio.', true, 5000);
    }
  }

  function resetForm(item = null) {
    state.editando = item;

    qs('modal-patrimonio-title').textContent = item ? 'Editar patrimônio' : 'Novo patrimônio';
    qs('patrimonio-id').value = item?.id || '';
    qs('patrimonio-codigo').value = item?.codigo || '';
    qs('patrimonio-nome').value = item?.nome || '';
    qs('patrimonio-descricao').value = item?.descricao || '';
    qs('patrimonio-categoria').value = item?.categoria || '';
    qs('patrimonio-marca').value = item?.marca || '';
    qs('patrimonio-modelo').value = item?.modelo || '';
    qs('patrimonio-numero-serie').value = item?.numero_serie || '';
    qs('patrimonio-localizacao').value = item?.localizacao || '';
    qs('patrimonio-responsavel').value = item?.responsavel || '';
    qs('patrimonio-status').value = item?.status || 'ativo';
    qs('patrimonio-valor-aquisicao').value = item?.valor_aquisicao || '';
    qs('patrimonio-data-aquisicao').value = item?.data_aquisicao || '';
    qs('patrimonio-observacoes').value = item?.observacoes || '';
    qs('patrimonio-ativo').checked = item ? item.ativo !== false : true;

    const btnExcluir = qs('btn-excluir-patrimonio');
    if (btnExcluir) {
      btnExcluir.style.display = item ? '' : 'none';
    }

    setTimeout(() => {
      qs('patrimonio-nome')?.focus();
    }, 80);
  }

  function onlyDigits(value) {
    return String(value || '').replace(/\D+/g, '');
  }

  function buildPayload() {
    return {
      codigo: onlyDigits(qs('patrimonio-codigo').value),
      nome: qs('patrimonio-nome').value.trim(),
      descricao: qs('patrimonio-descricao').value.trim() || null,
      categoria: qs('patrimonio-categoria').value.trim() || null,
      marca: qs('patrimonio-marca').value.trim() || null,
      modelo: qs('patrimonio-modelo').value.trim() || null,
      numero_serie: qs('patrimonio-numero-serie').value.trim() || null,
      localizacao: qs('patrimonio-localizacao').value.trim() || null,
      responsavel: qs('patrimonio-responsavel').value.trim() || null,
      status: qs('patrimonio-status').value || 'ativo',
      valor_aquisicao: qs('patrimonio-valor-aquisicao').value.trim() || null,
      data_aquisicao: qs('patrimonio-data-aquisicao').value || null,
      observacoes: qs('patrimonio-observacoes').value.trim() || null,
      ativo: qs('patrimonio-ativo').checked,
      custom_fields: {},
    };
  }

  async function salvar() {
    const payload = buildPayload();

    if (!payload.nome) {
      toast('Informe o nome do patrimônio.', true);
      qs('patrimonio-nome')?.focus();
      return;
    }

    const id = qs('patrimonio-id').value;
    const btn = qs('btn-salvar-patrimonio');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Salvando...';
    }

    try {
      await apiJson(id ? `${API}/${id}` : API, {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });

      closeModal('modal-patrimonio');
      await carregar();
      toast('Patrimônio salvo com sucesso.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao salvar patrimônio.', true, 5000);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar patrimônio';
      }
    }
  }

  async function editar(id) {
    try {
      const item = await apiJson(`${API}/${id}`);
      resetForm(item);
      openModal('modal-patrimonio');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao abrir patrimônio.', true);
    }
  }

  async function excluir() {
    const id = qs('patrimonio-id').value;

    if (!id) return;

    if (!confirm('Excluir este patrimônio?')) return;

    const btn = qs('btn-excluir-patrimonio');

    if (btn) {
      btn.disabled = true;
    }

    try {
      await apiJson(`${API}/${id}`, { method: 'DELETE' });

      closeModal('modal-patrimonio');
      await carregar();
      toast('Patrimônio excluído.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Erro ao excluir patrimônio.', true);
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  function bind() {
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
      modal.addEventListener('mousedown', (event) => {
        if (event.target === modal) {
          closeModal(modal.id);
        }
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeModal('modal-patrimonio');
      }
    });

    document.addEventListener('click', (event) => {
      const btnNovo = event.target.closest('#btn-novo-patrimonio');

      if (btnNovo) {
        event.preventDefault();
        resetForm(null);
        openModal('modal-patrimonio');
      }
    });

    qs('btn-atualizar-patrimonio')?.addEventListener('click', carregar);
    qs('btn-salvar-patrimonio')?.addEventListener('click', salvar);
    qs('btn-excluir-patrimonio')?.addEventListener('click', excluir);

    qs('patrimonio-codigo')?.addEventListener('input', (event) => {
      event.target.value = onlyDigits(event.target.value);
    });

    qs('patrimonio-busca')?.addEventListener('input', () => {
      clearTimeout(state.buscaTimer);
      state.buscaTimer = setTimeout(carregar, 300);
    });

    qs('patrimonio-status-filter')?.addEventListener('change', carregar);

    qs('patrimonio-tbody')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="editar"]');

      if (btn?.dataset?.id) {
        editar(btn.dataset.id);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    console.log('[Patrimônio] JS carregado');
    bind();
    carregar();
  });
})();