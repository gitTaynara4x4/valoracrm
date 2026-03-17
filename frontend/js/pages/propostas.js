let propostas = [];

const API_PROPOSTAS = '/api/propostas';

let propostaId = null;
let itens = [];

const MODELOS = {
  alarme(params){
    const pontos = Number(params.pontos || 0);
    return [
      { descricao: 'Central de alarme', quantidade: '1', unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Sensor infravermelho', quantidade: String(pontos), unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Mão de obra instalação alarme', quantidade: '1', unidade: 'SV', valor_unitario: '', valor_total: '', origem: 'modelo' },
    ];
  },
  cerca(params){
    const metragem = Number(params.metragem || 0);
    const cantos = Number(params.cantos || 0);
    return [
      { descricao: 'Central de cerca elétrica', quantidade: '1', unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Haste para cerca', quantidade: String(Math.ceil(metragem / 4)), unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Canto reforçado', quantidade: String(cantos), unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Mão de obra instalação cerca', quantidade: '1', unidade: 'SV', valor_unitario: '', valor_total: '', origem: 'modelo' },
    ];
  },
  concertina(params){
    const metragem = Number(params.metragem || 0);
    return [
      { descricao: 'Concertina', quantidade: String(metragem), unidade: 'MT', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Grampos / fixação', quantidade: String(Math.ceil(metragem / 2)), unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Mão de obra instalação concertina', quantidade: '1', unidade: 'SV', valor_unitario: '', valor_total: '', origem: 'modelo' },
    ];
  },
  cftv(params){
    const cameras = Number(params.cameras || 0);
    return [
      { descricao: 'DVR', quantidade: '1', unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Câmera', quantidade: String(cameras), unidade: 'UN', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Fonte / conectores', quantidade: '1', unidade: 'KIT', valor_unitario: '', valor_total: '', origem: 'modelo' },
      { descricao: 'Mão de obra instalação CFTV', quantidade: '1', unidade: 'SV', valor_unitario: '', valor_total: '', origem: 'modelo' },
    ];
  }
};

function qs(id){
  return document.getElementById(id);
}

function escapeHtml(v){
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(v){
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function getErrorMessage(text, fallback){
  try{
    const data = JSON.parse(text);
    if(typeof data?.detail === 'string' && data.detail.trim()) return data.detail.trim();
    if(typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  }catch{}
  return text?.trim() || fallback;
}

function redirectToLogin(){
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/inicio?next=${next}`;
}

async function apiJson(url, options = {}){
  const resp = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  if(resp.status === 401){
    redirectToLogin();
    throw new Error('Sua sessão expirou. Faça login novamente.');
  }

  if(resp.status === 204) return null;

  const text = await resp.text();

  if(!resp.ok){
    throw new Error(getErrorMessage(text, 'Erro na requisição.'));
  }

  if(!text) return null;

  try{
    return JSON.parse(text);
  }catch{
    return text;
  }
}

function capitalizeStatus(status){
  const map = {
    rascunho: 'Rascunho',
    enviada: 'Enviada',
    aprovada: 'Aprovada',
    rejeitada: 'Rejeitada',
  };
  return map[String(status || '').toLowerCase()] || status || '-';
}

async function carregarPropostas(){
  const data = await apiJson(API_PROPOSTAS);
  propostas = Array.isArray(data) ? data : [];
  renderTabela();
}

function renderTabela(){
  const tbody = qs('tbody-propostas');
  const count = qs('contagem-propostas');
  const busca = (qs('busca-propostas')?.value || '').toLowerCase().trim();

  if(!tbody) return;

  const filtradas = propostas.filter((p) => {
    const texto = [
      p.codigo,
      p.titulo,
      p.cliente_nome,
      p.status,
      p.total,
    ].filter(Boolean).join(' ').toLowerCase();

    return !busca || texto.includes(busca);
  });

  tbody.innerHTML = '';

  if(!filtradas.length){
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="Valora-empty">Nenhuma proposta encontrada.</td>
      </tr>
    `;
  } else {
    filtradas.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.codigo || '-')}</td>
        <td>${escapeHtml(p.titulo || '-')}</td>
        <td>${escapeHtml(p.cliente_nome || '-')}</td>
        <td>${escapeHtml(capitalizeStatus(p.status || '-'))}</td>
        <td>${escapeHtml(p.total || '-')}</td>
        <td>
          <div class="Valora-table-actions">
            <button class="Valora-icon-btn" data-action="abrir" data-id="${p.id}" title="Abrir proposta" type="button">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="Valora-icon-btn" data-action="excluir" data-id="${p.id}" title="Excluir proposta" type="button">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if(count){
    count.textContent = filtradas.length === 1 ? '1 proposta' : `${filtradas.length} propostas`;
  }
}

async function excluirProposta(id){
  if(!confirm('Deseja realmente excluir esta proposta?')) return;
  await apiJson(`${API_PROPOSTAS}/${id}`, { method: 'DELETE' });
  await carregarPropostas();
}

/* MODAL */

function openModal(){
  qs('proposal-modal')?.classList.add('is-open');
  qs('proposal-modal')?.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeModal(){
  qs('proposal-modal')?.classList.remove('is-open');
  qs('proposal-modal')?.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function updateStatusChip(){
  const chip = qs('proposal-chip-status');
  if(!chip) return;
  chip.textContent = capitalizeStatus(qs('proposta-status')?.value || 'rascunho');
}

function resetFormulario(){
  propostaId = null;
  itens = [];

  qs('proposal-modal-title').textContent = 'Nova proposta';
  qs('proposal-modal-subtitle').textContent = 'Preencha os dados da proposta e salve.';

  qs('proposta-codigo').value = '';
  qs('proposta-titulo').value = '';
  qs('proposta-cliente-id').value = '';
  qs('proposta-status').value = 'rascunho';
  qs('proposta-modelo').value = '';
  qs('proposta-validade').value = '';
  qs('proposta-observacoes').value = '';

  qs('param-metragem').value = '';
  qs('param-pontos').value = '';
  qs('param-cameras').value = '';
  qs('param-cantos').value = '';

  qs('proposta-subtotal').value = '';
  qs('proposta-desconto').value = '';
  qs('proposta-total').value = '';

  updateStatusChip();
  addItemRow({});
}

async function openNovaProposta(){
  resetFormulario();
  openModal();
}

async function openEditarProposta(id){
  resetFormulario();
  openModal();

  qs('proposal-modal-title').textContent = 'Editar proposta';
  qs('proposal-modal-subtitle').textContent = 'Carregando dados da proposta...';

  try{
    await carregarProposta(id);
    qs('proposal-modal-subtitle').textContent = 'Altere os dados e salve.';
  }catch(err){
    closeModal();
    throw err;
  }
}

/* ITENS */

function addItemRow(item = {}){
  itens.push({
    id: item.id || null,
    produto_id: item.produto_id || null,
    origem: item.origem || 'manual',
    codigo: item.codigo || '',
    descricao: item.descricao || '',
    unidade: item.unidade || '',
    quantidade: item.quantidade || '',
    valor_unitario: item.valor_unitario || '',
    valor_total: item.valor_total || '',
    observacao: item.observacao || '',
    ordem: Number.isFinite(item.ordem) ? item.ordem : itens.length,
  });

  renderItens();
}

function removeItemRow(index){
  itens.splice(index, 1);
  renderItens();
}

function renderItens(){
  const tbody = qs('proposal-items-body');
  if(!tbody) return;

  tbody.innerHTML = '';

  if(!itens.length){
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="Valora-empty">Nenhum item adicionado.</td>
      </tr>
    `;
    return;
  }

  itens.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-field="descricao" value="${escapeAttr(item.descricao || '')}"></td>
      <td><input type="text" data-field="quantidade" value="${escapeAttr(item.quantidade || '')}"></td>
      <td><input type="text" data-field="unidade" value="${escapeAttr(item.unidade || '')}"></td>
      <td><input type="text" data-field="valor_unitario" value="${escapeAttr(item.valor_unitario || '')}"></td>
      <td><input type="text" data-field="valor_total" value="${escapeAttr(item.valor_total || '')}"></td>
      <td><button type="button" class="btn-icon-danger" data-remove="${index}">×</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function collectItensFromDOM(){
  const body = qs('proposal-items-body');
  if(!body) return [];

  const rows = [...body.querySelectorAll('tr')];

  return rows.map((row, index) => {
    const get = (field) => row.querySelector(`[data-field="${field}"]`)?.value?.trim() || '';

    return {
      ...itens[index],
      descricao: get('descricao'),
      quantidade: get('quantidade'),
      unidade: get('unidade'),
      valor_unitario: get('valor_unitario'),
      valor_total: get('valor_total'),
      ordem: index,
    };
  }).filter((i) => i.descricao);
}

function buildPayload(){
  itens = collectItensFromDOM();

  return {
    codigo: qs('proposta-codigo')?.value?.trim() || '',
    cliente_id: qs('proposta-cliente-id')?.value ? Number(qs('proposta-cliente-id').value) : null,
    titulo: qs('proposta-titulo')?.value?.trim() || '',
    status: qs('proposta-status')?.value || 'rascunho',
    modelo: qs('proposta-modelo')?.value || null,
    observacoes: qs('proposta-observacoes')?.value?.trim() || '',
    validade_dias: qs('proposta-validade')?.value?.trim() || '',
    subtotal: qs('proposta-subtotal')?.value?.trim() || '',
    desconto: qs('proposta-desconto')?.value?.trim() || '',
    total: qs('proposta-total')?.value?.trim() || '',
    itens,
  };
}

async function salvarProposta(){
  const payload = buildPayload();

  if(!payload.titulo){
    alert('Preencha o título da proposta.');
    qs('proposta-titulo')?.focus();
    return;
  }

  if(!payload.itens.length){
    alert('Adicione pelo menos um item na proposta.');
    return;
  }

  if(propostaId){
    await apiJson(`${API_PROPOSTAS}/${propostaId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    const criada = await apiJson(API_PROPOSTAS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    propostaId = criada?.id || null;
  }

  await carregarPropostas();
  closeModal();
  alert('Proposta salva com sucesso.');
}

async function carregarProposta(id){
  const p = await apiJson(`${API_PROPOSTAS}/${id}`);
  propostaId = id;

  qs('proposta-codigo').value = p.codigo || '';
  qs('proposta-titulo').value = p.titulo || '';
  qs('proposta-cliente-id').value = p.cliente_id || '';
  qs('proposta-status').value = p.status || 'rascunho';
  qs('proposta-modelo').value = p.modelo || '';
  qs('proposta-observacoes').value = p.observacoes || '';
  qs('proposta-validade').value = p.validade_dias || '';
  qs('proposta-subtotal').value = p.subtotal || '';
  qs('proposta-desconto').value = p.desconto || '';
  qs('proposta-total').value = p.total || '';

  itens = Array.isArray(p.itens) ? p.itens : [];
  renderItens();
  updateStatusChip();
}

function gerarItensDoModelo(){
  const modelo = qs('proposta-modelo')?.value || '';

  if(!modelo || !MODELOS[modelo]){
    alert('Selecione um modelo técnico.');
    return;
  }

  const params = {
    metragem: qs('param-metragem')?.value || 0,
    pontos: qs('param-pontos')?.value || 0,
    cameras: qs('param-cameras')?.value || 0,
    cantos: qs('param-cantos')?.value || 0,
  };

  itens = MODELOS[modelo](params).map((item, idx) => ({
    ...item,
    ordem: idx,
  }));

  renderItens();
}

/* EVENTOS */

document.addEventListener('DOMContentLoaded', async () => {
  qs('busca-propostas')?.addEventListener('input', renderTabela);

  qs('btn-nova-proposta')?.addEventListener('click', async () => {
    await openNovaProposta();
  });

  qs('tbody-propostas')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.Valora-icon-btn');
    if(!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'abrir'){
      try{
        await openEditarProposta(id);
      }catch(err){
        alert(err?.message || 'Erro ao abrir proposta.');
      }
      return;
    }

    if(action === 'excluir'){
      try{
        await excluirProposta(id);
      }catch(err){
        alert(err?.message || 'Erro ao excluir proposta.');
      }
    }
  });

  qs('btn-fechar-modal')?.addEventListener('click', closeModal);

  qs('proposal-modal')?.addEventListener('click', (e) => {
    if(e.target.closest('[data-close-modal]')){
      closeModal();
    }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && qs('proposal-modal')?.classList.contains('is-open')){
      closeModal();
    }
  });

  qs('btn-add-item')?.addEventListener('click', () => addItemRow({}));
  qs('btn-gerar-itens')?.addEventListener('click', gerarItensDoModelo);

  qs('proposal-items-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if(!btn) return;
    removeItemRow(Number(btn.dataset.remove));
  });

  qs('btn-salvar-proposta')?.addEventListener('click', async () => {
    try{
      await salvarProposta();
    }catch(err){
      alert(err?.message || 'Erro ao salvar proposta.');
    }
  });

  qs('proposta-status')?.addEventListener('change', updateStatusChip);

  try{
    await carregarPropostas();
  }catch(err){
    alert(err?.message || 'Erro ao carregar propostas.');
  }
});