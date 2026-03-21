// /frontend/js/pages/propostas.js

let propostas = [];
const API_PROPOSTAS = '/api/propostas';
let propostaId = null;
let itens = [];

// ==========================================
// LÓGICA MÁGICA DA SUA EQUIPE MANTIDA INTACTA!
// ==========================================
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

function qs(id){ return document.getElementById(id); }

function escapeHtml(v){
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function escapeAttr(v){
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

let _confirmResolver = null;
function confirmDialog({ title='Confirmar', message='Tem certeza?', confirmText='OK', cancelText='Cancelar' } = {}){
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  document.getElementById('Valora-confirm-title').textContent = title;
  document.getElementById('Valora-confirm-message').textContent = message;
  document.getElementById('Valora-confirm-ok').textContent = confirmText;
  document.getElementById('Valora-confirm-cancel').textContent = cancelText;

  if(!backdrop) return Promise.resolve(false);
  backdrop.hidden = false;
  setTimeout(() => backdrop.classList.add('show'), 10);
  return new Promise((resolve)=>{ _confirmResolver = resolve; });
}

function closeConfirm(result=false){
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  if(backdrop){
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.hidden = true, 200);
  }
  if(typeof _confirmResolver === 'function'){
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

async function apiJson(url, options = {}){
  const resp = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
  });

  if(resp.status === 401) {
     window.showToast("Sessão expirada. Faça login.", "error");
     throw new Error("Sessão expirada");
  }
  if(resp.status === 204) return null;

  const text = await resp.text();
  if(!resp.ok) throw new Error(text || 'Erro na requisição.');
  if(!text) return null;
  try{ return JSON.parse(text); }catch{ return text; }
}

function capitalizeStatus(status){
  const map = { rascunho: 'Rascunho', enviada: 'Enviada', aprovada: 'Aprovada', rejeitada: 'Rejeitada' };
  return map[String(status || '').toLowerCase()] || status || '-';
}

async function carregarPropostas(){
  try {
    const data = await apiJson(API_PROPOSTAS);
    propostas = Array.isArray(data) ? data : [];
  } catch { propostas = []; }
  renderTabela();
}

function renderTabela(){
  const tbody = qs('tbody-propostas');
  const count = qs('contagem-propostas');
  const busca = (qs('busca-propostas')?.value || '').toLowerCase().trim();

  if(!tbody) return;

  const filtradas = propostas.filter((p) => {
    const texto = [p.codigo, p.titulo, p.cliente_nome, p.status, p.total].filter(Boolean).join(' ').toLowerCase();
    return !busca || texto.includes(busca);
  });

  tbody.innerHTML = '';

  if(!filtradas.length){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align: center; border:none;">Nenhuma proposta encontrada.</td></tr>`;
  } else {
    filtradas.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-codigo" style="font-family: monospace; background: var(--panel-hover); padding: 4px 8px; border-radius: 6px; font-size: 12px;">${escapeHtml(p.codigo || '-')}</span></td>
        <td style="font-weight: 500; color: var(--text);">${escapeHtml(p.titulo || '-')}</td>
        <td>${escapeHtml(p.cliente_nome || '-')}</td>
        <td><span class="proposal-status-chip">${escapeHtml(capitalizeStatus(p.status || '-'))}</span></td>
        <td>R$ ${escapeHtml(p.total || '0,00')}</td>
        <td style="text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn-icon" data-action="abrir" data-id="${p.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon danger" data-action="excluir" data-id="${p.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
  if(count) count.textContent = filtradas.length === 1 ? '1 proposta' : `${filtradas.length} propostas`;
}

function openModal(){
  const modal = document.getElementById('proposal-modal');
  modal.hidden = false;
  setTimeout(()=>modal.classList.add('show'), 10);
}

function closeModal(){
  const modal = document.getElementById('proposal-modal');
  modal.classList.remove('show');
  setTimeout(() => modal.hidden = true, 200);
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

  try{
    await carregarProposta(id);
  }catch(err){
    closeModal();
    window.showToast("Erro ao carregar proposta.", "error");
  }
}

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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align: center; border:none;">Nenhum item adicionado.</td></tr>`;
    return;
  }

  itens.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-field="descricao" value="${escapeAttr(item.descricao || '')}"></td>
      <td><input type="text" style="width: 60px; text-align: center;" data-field="quantidade" value="${escapeAttr(item.quantidade || '')}"></td>
      <td><input type="text" style="width: 60px; text-align: center;" data-field="unidade" value="${escapeAttr(item.unidade || '')}"></td>
      <td><input type="text" data-field="valor_unitario" placeholder="R$" value="${escapeAttr(item.valor_unitario || '')}"></td>
      <td><input type="text" data-field="valor_total" placeholder="R$" value="${escapeAttr(item.valor_total || '')}"></td>
      <td style="text-align: center; vertical-align: middle;"><button type="button" class="btn-icon-danger" data-remove="${index}"><i class="fa-solid fa-trash"></i></button></td>
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
    itens: collectItensFromDOM(),
  };
}

async function salvarProposta(){
  const payload = buildPayload();
  const btn = qs('btn-salvar-proposta');

  if(!payload.titulo){ window.showToast('Preencha o título da proposta.', 'error'); return; }
  if(!payload.itens.length){ window.showToast('Adicione pelo menos um item.', 'error'); return; }

  btn.disabled = true;
  btn.innerHTML = 'Salvando...';

  try{
    if(propostaId){
      await apiJson(`${API_PROPOSTAS}/${propostaId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } else {
      const criada = await apiJson(API_PROPOSTAS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      propostaId = criada?.id || null;
    }
    await carregarPropostas();
    closeModal();
    window.showToast('Proposta salva com sucesso!', 'success');
  } catch(err) {
    window.showToast('Erro ao salvar proposta.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar';
  }
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
  if(!modelo || !MODELOS[modelo]){ window.showToast('Selecione um modelo técnico.', 'error'); return; }

  const params = {
    metragem: qs('param-metragem')?.value || 0,
    pontos: qs('param-pontos')?.value || 0,
    cameras: qs('param-cameras')?.value || 0,
    cantos: qs('param-cantos')?.value || 0,
  };

  itens = MODELOS[modelo](params).map((item, idx) => ({ ...item, ordem: idx }));
  renderItens();
  window.showToast('Itens gerados com sucesso!', 'success');
}

/* EVENTOS */
document.addEventListener('DOMContentLoaded', async () => {
  
  // Confirm Modals setup
  document.getElementById('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  document.getElementById('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  qs('busca-propostas')?.addEventListener('input', renderTabela);
  qs('btn-nova-proposta')?.addEventListener('click', openNovaProposta);
  qs('btn-fechar-modal')?.addEventListener('click', closeModal);

  qs('tbody-propostas')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'abrir') {
      await openEditarProposta(id);
    } else if(action === 'excluir') {
      if(await confirmDialog({title: 'Excluir Proposta', message: 'Deseja mesmo excluir esta proposta?'})){
        await apiJson(`${API_PROPOSTAS}/${id}`, { method: 'DELETE' });
        await carregarPropostas();
        window.showToast('Proposta excluída.', 'success');
      }
    }
  });

  qs('proposal-modal')?.addEventListener('click', (e) => {
    // Se clicou fora do modal-content, fecha.
    if(e.target === qs('proposal-modal')){ closeModal(); }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && !qs('proposal-modal')?.hidden){ closeModal(); }
  });

  qs('btn-add-item')?.addEventListener('click', () => addItemRow({}));
  qs('btn-gerar-itens')?.addEventListener('click', gerarItensDoModelo);

  qs('proposal-items-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-icon-danger');
    if(!btn) return;
    removeItemRow(Number(btn.dataset.remove));
  });

  qs('btn-salvar-proposta')?.addEventListener('click', salvarProposta);
  qs('proposta-status')?.addEventListener('change', updateStatusChip);

  await carregarPropostas();
});