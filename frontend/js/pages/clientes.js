async function importarClientes(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', 'error');
    return;
  }

  try {
    const lower = String(file.name || '').toLowerCase();
    let items = [];
    if (lower.endsWith('.json')) {
      const text = await file.text();
      const data = JSON.parse(text || '{}');
      items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    } else {
      const text = await file.text();
      items = parseCSV(text);
    }

    if (!Array.isArray(items) || !items.length) {
      toast('Arquivo vazio ou inválido.', 'error');
      return;
    }

    const ok = await confirmDialog({
      title: 'Importar clientes',
      message: `Importar ${items.length} registro(s)?`,
      confirmText: 'Importar',
    });
    if (!ok) return;

    let success = 0;
    let fail = 0;

    for (const item of items) {
      const codigo = normalizeText(item.codigo);
      const existing = state.clientes.find((cliente) => normalizeText(cliente.codigo) === codigo);
      const payload = {
        ...defaultCliente(),
        codigo: item.codigo || '',
        tipo_pessoa: item.tipo_pessoa || 'PF',
        situacao: item.situacao || 'ativo',
        nome: item.nome || '',
        nome_fantasia: item.nome_fantasia || '',
        cpf_cnpj: item.cpf_cnpj || '',
        telefone: item.telefone || '',
        whatsapp: item.whatsapp || '',
        email: item.email || '',
        cidade: item.cidade || '',
        estado: item.estado || '',
      };
      try {
        await apiJson(existing ? `${API_CLIENTES}/${existing.id}` : API_CLIENTES, {
          method: existing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        success += 1;
      } catch {
        fail += 1;
      }
    }

    toast(`Importação concluída: ${success} sucesso(s)${fail ? ` • ${fail} falha(s)` : ''}`, fail ? 'error' : 'success', 3800);
    await carregarClientes();
  } catch (err) {
    toast(err.message || 'Erro ao importar arquivo.', 'error');
  }
}

function bindMiniListActions() {
  document.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-remove]');
    if (!btn) return;

    const type = btn.dataset.remove;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index) || !state.currentDetail) return;

    const map = {
      endereco: 'enderecos',
      refcom: 'referencias_comerciais',
      refbanc: 'referencias_bancarias',
      socio: 'socios',
      ocorrencia: 'ocorrencias',
    };
    const key = map[type];
    if (!key || !Array.isArray(state.currentDetail[key])) return;

    state.currentDetail[key].splice(index, 1);
    preencherFormulario(state.currentDetail);
    if (key === 'enderecos') switchTab('tab-enderecos');
    if (key === 'referencias_comerciais' || key === 'referencias_bancarias' || key === 'socios') switchTab('tab-dados-adicionais');
    if (key === 'ocorrencias') switchTab('tab-ocorrencias');
  });
}

function inicializarTabs() {
  $$('.cliente-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function limparFiltros() {
  setField('filtro-busca', '');
  setField('filtro-tipo', '');
  setField('filtro-situacao', '');
  setField('filtro-cidade', '');
}

document.addEventListener('DOMContentLoaded', async () => {
  inicializarTabs();
  bindMiniListActions();

  $('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  $('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  $('btn-fechar-modal-cliente')?.addEventListener('click', fecharModalCliente);
  $('btn-cancelar-cliente')?.addEventListener('click', fecharModalCliente);
  $('formCliente')?.addEventListener('submit', salvarCliente);

  $('btn-novo-cliente')?.addEventListener('click', abrirNovoCliente);
  $('btn-filtrar-clientes')?.addEventListener('click', carregarClientes);
  $('btn-limpar-filtros')?.addEventListener('click', async () => { limparFiltros(); await carregarClientes(); });

  $('btn-exportar-clientes-json')?.addEventListener('click', exportarClientesJSON);
  $('btn-exportar-clientes-csv')?.addEventListener('click', exportarClientesCSV);

  $('btn-importar-clientes')?.addEventListener('click', () => $('input-importar-clientes')?.click());
  $('input-importar-clientes')?.addEventListener('change', async (event) => {
    await importarClientes(event.target.files?.[0]);
    event.target.value = '';
  });

  $('btn-add-endereco')?.addEventListener('click', () => {
    state.currentDetail ??= defaultCliente();
    state.currentDetail.enderecos.push(montarEnderecoVazio());
    renderEnderecos(state.currentDetail.enderecos);
  });

  $('btn-add-ref-comercial')?.addEventListener('click', () => {
    state.currentDetail ??= defaultCliente();
    state.currentDetail.referencias_comerciais.push(montarRefComercialVazia());
    renderRefsComerciais(state.currentDetail.referencias_comerciais);
  });

  $('btn-add-ref-bancaria')?.addEventListener('click', () => {
    state.currentDetail ??= defaultCliente();
    state.currentDetail.referencias_bancarias.push(montarRefBancariaVazia());
    renderRefsBancarias(state.currentDetail.referencias_bancarias);
  });

  $('btn-add-socio')?.addEventListener('click', () => {
    state.currentDetail ??= defaultCliente();
    state.currentDetail.socios.push(montarSocioVazio());
    renderSocios(state.currentDetail.socios);
  });

  $('btn-add-ocorrencia')?.addEventListener('click', () => {
    state.currentDetail ??= defaultCliente();
    state.currentDetail.ocorrencias.unshift(montarOcorrenciaVazia());
    renderOcorrencias(state.currentDetail.ocorrencias);
  });

  $('btn-escolher-anexo')?.addEventListener('click', () => $('input-anexo')?.click());
  $('input-anexo')?.addEventListener('change', subirAnexo);

  $('tbody-clientes')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id) return;

    if (action === 'editar') await abrirEditarCliente(id);
    if (action === 'excluir') await excluirCliente(id);
  });

  $('lista-anexos')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-remove-anexo]');
    if (!btn) return;
    const id = Number(btn.dataset.removeAnexo);
    if (id) await excluirAnexo(id);
  });

  $('modal-cliente-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('modal-cliente-backdrop')) fecharModalCliente();
  });
  $('Valora-confirm-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('Valora-confirm-backdrop')) closeConfirm(false);
  });

  $('filtro-busca')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await carregarClientes();
    }
  });

  try {
    await Promise.all([carregarCamposCustomizados(), carregarClientes()]);
  } catch (err) {
    toast(err.message || 'Erro ao carregar dados iniciais.', 'error', 4000);
  }
});