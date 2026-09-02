/*
 * ValoraCRM · Orçamentos · clientes.js
 * Busca, paginação, seleção de clientes e dados de endereço.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function clientResultMarkup(client) {
    const displayName = client.nome_fantasia || client.nome || `Cliente #${client.id}`;
    const details = [
      client.codigo ? `Cód. ${client.codigo}` : '',
      client.cpf_cnpj,
      client.whatsapp || client.telefone,
      [client.cidade, client.estado].filter(Boolean).join('/'),
    ].filter(Boolean).join(' • ');

    return `
      <button type="button" class="autocomplete-item" data-client-id="${client.id}">
        <strong>${escapeHtml(displayName)}</strong>
        <small>${escapeHtml(details || 'Cliente cadastrado')}</small>
      </button>`;
  }

  function renderClientLoadStatus() {
    const box = $('orcamento-cliente-resultados');
    box.querySelector('[data-client-load-status]')?.remove();

    if (state.clientLoading) {
      box.insertAdjacentHTML('beforeend', `
        <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
          <small><i class="fa-solid fa-spinner fa-spin"></i> Buscando mais clientes...</small>
        </div>`);
      return;
    }

    if (!state.clientResults.length) return;

    const shown = state.clientResults.length;
    const totalText = state.clientTotal ? ` de ${state.clientTotal}` : '';
    const message = state.clientHasMore
      ? `${shown}${totalText} exibidos • role para carregar mais`
      : `${shown}${totalText} clientes carregados`;

    box.insertAdjacentHTML('beforeend', `
      <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
        <small>${escapeHtml(message)}</small>
      </div>`);
  }

  function renderClientResults(clients, {
    append = false,
    emptyMessage = 'Nenhum cliente encontrado.',
  } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalized = normalizeCollection(clients);

    if (!append) box.innerHTML = '';
    else box.querySelector('[data-client-load-status]')?.remove();

    const existingIds = new Set(
      $$('[data-client-id]', box).map((item) => String(item.dataset.clientId)),
    );
    const newClients = normalized.filter((client) => !existingIds.has(String(client.id)));

    if (newClients.length) {
      box.insertAdjacentHTML('beforeend', newClients.map(clientResultMarkup).join(''));
    }

    if (!box.querySelector('[data-client-id]')) {
      box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(emptyMessage)}</small></div>`;
    } else {
      box.querySelector('.autocomplete-empty:not([data-client-load-status])')?.remove();
      renderClientLoadStatus();
    }

    box.hidden = false;
    $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
  }

  async function loadClientOptions(query = '', { append = false } = {}) {
    const box = $('orcamento-cliente-resultados');
    const normalizedQuery = String(query || '').trim();

    if (append && (state.clientLoading || !state.clientHasMore)) return;

    let version;
    let offset;

    if (append) {
      version = state.clientSearchVersion;
      offset = state.clientOffset;
      state.clientLoading = true;
      renderClientLoadStatus();
    } else {
      version = ++state.clientSearchVersion;
      offset = 0;
      state.clientQuery = normalizedQuery;
      state.clientOffset = 0;
      state.clientHasMore = false;
      state.clientTotal = 0;
      state.clientResults = [];
      state.clientLoading = true;
      box.innerHTML = '<div class="autocomplete-item autocomplete-empty"><small><i class="fa-solid fa-spinner fa-spin"></i> Carregando clientes...</small></div>';
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }

    try {
      const params = new URLSearchParams({
        paginated: 'true',
        limit: String(state.clientPageSize),
        offset: String(offset),
      });
      if (normalizedQuery) params.set('busca', normalizedQuery);

      const response = await api(`${API_CLIENTS}?${params.toString()}`);
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;

      const clients = normalizeCollection(response);
      const knownIds = new Set(state.clientResults.map((client) => String(client.id)));
      const uniqueClients = clients.filter((client) => !knownIds.has(String(client.id)));

      state.clientResults = append
        ? [...state.clientResults, ...uniqueClients]
        : clients;
      state.clientOffset = offset + clients.length;
      state.clientTotal = Number(response?.total ?? state.clientResults.length) || state.clientResults.length;
      state.clientHasMore = typeof response?.has_more === 'boolean'
        ? response.has_more
        : clients.length === state.clientPageSize;
      state.clientLoading = false;

      if (!normalizedQuery) state.clients = [...state.clientResults];

      renderClientResults(append ? uniqueClients : state.clientResults, {
        append,
        emptyMessage: normalizedQuery
          ? 'Nenhum cliente encontrado para essa busca.'
          : 'Nenhum cliente cadastrado.',
      });
    } catch (error) {
      if (version !== state.clientSearchVersion || normalizedQuery !== state.clientQuery) return;
      state.clientLoading = false;
      box.querySelector('[data-client-load-status]')?.remove();

      if (append && state.clientResults.length) {
        box.insertAdjacentHTML('beforeend', `
          <div class="autocomplete-item autocomplete-empty autocomplete-load-status" data-client-load-status>
            <small>${escapeHtml(error.message)} • role novamente para tentar</small>
          </div>`);
      } else {
        box.innerHTML = `<div class="autocomplete-item autocomplete-empty"><small>${escapeHtml(error.message)}</small></div>`;
      }
      box.hidden = false;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'true');
    }
  }

  const searchClients = debounce(() => {
    const query = $('orcamento-cliente-busca').value.trim();
    loadClientOptions(query, { append: false });
  }, 250);

  function showClientOptions() {
    const box = $('orcamento-cliente-resultados');
    const query = $('orcamento-cliente-busca').value.trim();

    if (!box.hidden && state.clientQuery === query && (state.clientResults.length || state.clientLoading)) {
      return;
    }

    loadClientOptions(query, { append: false });
  }

  function loadMoreClientsOnScroll() {
    const box = $('orcamento-cliente-resultados');
    if (box.hidden || state.clientLoading || !state.clientHasMore) return;

    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    if (distanceFromBottom <= 48) {
      loadClientOptions(state.clientQuery, { append: true });
    }
  }

  async function selectClient(id) {
    try {
      const client = await api(`${API_CLIENTS}/${id}`);
      state.selectedClient = client;
      $('orcamento-cliente-id').value = client.id;
      $('orcamento-cliente-busca').value = client.nome_fantasia || client.nome;
      $('orcamento-responsavel-cliente').value ||= client.contato || '';
      $('orcamento-contato-cliente').value ||= client.whatsapp || client.telefone || '';
      $('orcamento-cliente-resultados').hidden = true;
      $('orcamento-cliente-busca').setAttribute('aria-expanded', 'false');
      syncClientEditButton();
      fillAddressFromClient(client, false);
      updateTotals();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function fillAddressFromClient(client, force = true) {
    if (!client) return;
    const address = (client.enderecos || []).find((item) => item.principal) || (client.enderecos || [])[0] || client;
    const values = {
      'orcamento-cep': address.cep || client.cep || '',
      'orcamento-logradouro': address.endereco || address.logradouro || client.endereco || '',
      'orcamento-numero': address.numero || client.numero || '',
      'orcamento-complemento': address.complemento || client.complemento || '',
      'orcamento-bairro': address.bairro || client.bairro || '',
      'orcamento-cidade': address.cidade || client.cidade || '',
      'orcamento-estado': address.estado || client.estado || '',
    };
    Object.entries(values).forEach(([id, value]) => { if (force || !$(id).value) $(id).value = value; });
  }

