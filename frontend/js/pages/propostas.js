let propostas = [];
let clientesCache = [];
let camposConfiguraveis = [];

const API_PROPOSTAS = '/api/propostas';
const API_CLIENTES = '/api/clientes';
const API_CAMPOS_PROPOSTAS = '/api/campos-propostas';

let propostaId = null;
let itens = [];
let camposExtrasConfig = [];

let campoConfigId = null;
let campoSlugTouched = false;

function qs(id){ return document.getElementById(id); }

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

function onlyDigits(v){
  return String(v ?? '').replace(/\D+/g, '');
}

function slugify(text){
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();
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

function tipoCampoLabel(tipo){
  const map = {
    texto: 'Texto',
    textarea: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    select: 'Lista',
    checkbox: 'Checkbox',
  };
  return map[String(tipo || '').toLowerCase()] || tipo || '-';
}

function parseOpcoesTextarea(raw){
  return String(raw || '')
    .split(/\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizarNumeroWhatsApp(raw){
  let digits = onlyDigits(raw);

  if(!digits) return '';
  digits = digits.replace(/^00/, '');

  if(digits.length === 10 || digits.length === 11){
    digits = `55${digits}`;
  }

  if((digits.length === 12 || digits.length === 13) && digits.startsWith('55')){
    return digits;
  }

  if(digits.length >= 12){
    return digits;
  }

  return '';
}

function formatarValorBRL(valor){
  if(valor == null || valor === '') return '0,00';

  if(typeof valor === 'number' && Number.isFinite(valor)){
    return valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const texto = String(valor).trim();
  if(!texto) return '0,00';

  if(texto.includes(',')) return texto;

  const numero = Number(texto);
  if(Number.isFinite(numero)){
    return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  return texto;
}

function formatarValidadeTexto(validadeDias){
  const n = Number(validadeDias);
  if(!Number.isFinite(n) || n <= 0) return '';
  return n === 1 ? '1 dia' : `${n} dias`;
}

function isModalOpen(id){
  const el = qs(id);
  return !!(el && el.classList.contains('show'));
}

// ==========================================
// TOAST / CONFIRM
// ==========================================
function toast(msg, error=false, ms=2600){
  const el = qs('valora-toast');
  if(!el) return;

  el.textContent = msg || '';

  if(error){
    el.classList.add('is-error');
  }else{
    el.classList.remove('is-error');
  }

  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

window.showToast = function(msg, type){
  toast(msg, type === 'error');
};

let _confirmResolver = null;

function confirmDialog({ title='Confirmar', message='Tem certeza?', confirmText='OK', cancelText='Cancelar' } = {}){
  const backdrop = qs('Valora-confirm-backdrop');
  if(!backdrop) return Promise.resolve(false);

  qs('Valora-confirm-title').textContent = title;
  qs('Valora-confirm-message').textContent = message;
  qs('Valora-confirm-ok').textContent = confirmText;
  qs('Valora-confirm-cancel').textContent = cancelText;

  backdrop.classList.add('show');
  return new Promise((resolve) => { _confirmResolver = resolve; });
}

function closeConfirm(result=false){
  const backdrop = qs('Valora-confirm-backdrop');
  if(backdrop) backdrop.classList.remove('show');

  if(typeof _confirmResolver === 'function'){
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

// ==========================================
// API
// ==========================================
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
    toast('Sessão expirada. Faça login.', true);
    throw new Error('Sessão expirada');
  }

  if(resp.status === 204) return null;

  const text = await resp.text();

  if(!resp.ok){
    throw new Error(text || 'Erro na requisição.');
  }

  if(!text) return null;

  try{
    return JSON.parse(text);
  }catch{
    return text;
  }
}

// ==========================================
// CLIENTES - BUSCA / AUTOCOMPLETE
// ==========================================
async function carregarClientes(){
  try{
    const data = await apiJson(API_CLIENTES);
    clientesCache = Array.isArray(data) ? data : [];
  }catch(err){
    console.error('[propostas] erro ao carregar clientes:', err);
    clientesCache = [];
  }
}

function clienteLabel(cliente){
  return cliente?.nome || `Cliente #${cliente?.id || '-'}`;
}

function clienteMeta(cliente){
  const partes = [];
  if(cliente?.whatsapp) partes.push(cliente.whatsapp);
  if(cliente?.email) partes.push(cliente.email);
  return partes.join(' • ');
}

function filtrarClientes(termo = ''){
  const q = String(termo || '').trim().toLowerCase();
  const qDigits = onlyDigits(q);

  const lista = clientesCache.filter((cliente) => {
    if(!q) return true;

    const nome = String(cliente?.nome || '').toLowerCase();
    const email = String(cliente?.email || '').toLowerCase();
    const whatsapp = String(cliente?.whatsapp || '').toLowerCase();
    const whatsappDigits = onlyDigits(cliente?.whatsapp || '');
    const idTxt = String(cliente?.id || '');

    return (
      nome.includes(q) ||
      email.includes(q) ||
      whatsapp.includes(q) ||
      idTxt.includes(q) ||
      (qDigits && whatsappDigits.includes(qDigits))
    );
  });

  return lista.slice(0, 8);
}

function abrirResultadosClientes(){
  const box = qs('proposta-cliente-resultados');
  if(box) box.style.display = '';
}

function fecharResultadosClientes(){
  const box = qs('proposta-cliente-resultados');
  if(box) box.style.display = 'none';
}

function limparClienteSelecionado(manterTexto = true){
  const hidden = qs('proposta-cliente-id');
  const busca = qs('proposta-cliente-busca');

  if(hidden) hidden.value = '';
  if(busca && !manterTexto) busca.value = '';

  updateWhatsAppModalButton();
}

function selecionarCliente(cliente){
  if(!cliente) return;

  const hidden = qs('proposta-cliente-id');
  const busca = qs('proposta-cliente-busca');

  if(hidden) hidden.value = cliente.id || '';
  if(busca) busca.value = clienteLabel(cliente);

  fecharResultadosClientes();
  updateWhatsAppModalButton();
}

function renderResultadosClientes(termo = ''){
  const box = qs('proposta-cliente-resultados');
  if(!box) return;

  const clientes = filtrarClientes(termo);
  box.innerHTML = '';

  if(!clientes.length){
    box.innerHTML = `<div class="autocomplete-empty">Nenhum cliente encontrado.</div>`;
    abrirResultadosClientes();
    return;
  }

  clientes.forEach((cliente) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'autocomplete-item';
    item.dataset.id = cliente.id;

    item.innerHTML = `
      <div class="autocomplete-title">${escapeHtml(clienteLabel(cliente))}</div>
      <div class="autocomplete-sub">${escapeHtml(clienteMeta(cliente) || `ID: ${cliente.id}`)}</div>
    `;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selecionarCliente(cliente);
    });

    box.appendChild(item);
  });

  abrirResultadosClientes();
}

async function preencherClienteSelecionado(clienteId, fallbackNome = ''){
  const hidden = qs('proposta-cliente-id');
  const busca = qs('proposta-cliente-busca');

  if(!clienteId){
    if(hidden) hidden.value = '';
    if(busca) busca.value = '';
    updateWhatsAppModalButton();
    return;
  }

  let cliente = clientesCache.find((c) => Number(c.id) === Number(clienteId));

  if(!cliente){
    try{
      cliente = await apiJson(`${API_CLIENTES}/${clienteId}`);
    }catch(err){
      console.error('[propostas] erro ao buscar cliente específico:', err);
    }
  }

  if(hidden) hidden.value = clienteId;

  if(busca){
    busca.value = cliente?.nome || fallbackNome || `Cliente #${clienteId}`;
  }

  updateWhatsAppModalButton();
}

// ==========================================
// WHATSAPP
// ==========================================
function montarMensagemWhatsApp(proposta, cliente){
  const nomeCliente = cliente?.nome || proposta?.cliente_nome || 'cliente';
  const codigo = proposta?.codigo || '-';
  const titulo = proposta?.titulo || 'Proposta comercial';
  const total = formatarValorBRL(proposta?.total || '0,00');
  const validade = formatarValidadeTexto(proposta?.validade_dias);
  const observacoes = String(proposta?.observacoes || '').trim();

  const linhas = [
    `Olá, ${nomeCliente}!`,
    '',
    `Segue sua proposta ${codigo}${titulo ? ` - ${titulo}` : ''}.`,
    `Valor total: R$ ${total}`,
  ];

  if(validade){
    linhas.push(`Validade: ${validade}`);
  }

  if(observacoes){
    linhas.push('', `Observações: ${observacoes}`);
  }

  linhas.push('', 'Qualquer dúvida, fico à disposição.');

  return linhas.join('\n');
}

async function obterClienteDaProposta(proposta){
  const clienteId = Number(proposta?.cliente_id || 0);
  if(!clienteId) return null;
  return apiJson(`${API_CLIENTES}/${clienteId}`);
}

function buildPropostaAtualParaWhatsApp(){
  return {
    id: propostaId || null,
    codigo: qs('proposta-codigo')?.value?.trim() || '',
    cliente_id: qs('proposta-cliente-id')?.value ? Number(qs('proposta-cliente-id').value) : null,
    titulo: qs('proposta-titulo')?.value?.trim() || '',
    status: qs('proposta-status')?.value || 'rascunho',
    observacoes: qs('proposta-observacoes')?.value?.trim() || '',
    validade_dias: qs('proposta-validade')?.value?.trim() || '',
    subtotal: qs('proposta-subtotal')?.value?.trim() || '',
    desconto: qs('proposta-desconto')?.value?.trim() || '',
    total: qs('proposta-total')?.value?.trim() || '',
  };
}

function updateWhatsAppModalButton(){
  const btn = qs('btn-whatsapp-proposta');
  if(!btn) return;

  const clienteId = Number(qs('proposta-cliente-id')?.value || 0);
  btn.style.display = clienteId ? '' : 'none';
}

async function abrirWhatsAppDaProposta(proposta){
  if(!proposta){
    toast('Proposta não encontrada.', true);
    return;
  }

  if(!proposta.cliente_id){
    toast('Selecione um cliente na proposta antes de enviar no WhatsApp.', true);
    return;
  }

  const cliente = await obterClienteDaProposta(proposta);

  if(!cliente){
    toast('Cliente da proposta não encontrado.', true);
    return;
  }

  const numero = normalizarNumeroWhatsApp(cliente.whatsapp);

  if(!numero){
    toast('Cliente sem WhatsApp válido cadastrado.', true);
    return;
  }

  const mensagem = montarMensagemWhatsApp(proposta, cliente);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const link = isMobile
    ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`
    : `https://web.whatsapp.com/send?phone=${numero}&text=${encodeURIComponent(mensagem)}`;

  window.open(link, '_blank', 'noopener,noreferrer');
  toast('WhatsApp aberto com a mensagem pronta.');
}

async function enviarPropostaNoWhatsApp(id){
  try{
    const propostaLista = propostas.find((p) => Number(p.id) === Number(id));
    const proposta = propostaLista?.cliente_id ? propostaLista : await apiJson(`${API_PROPOSTAS}/${id}`);
    await abrirWhatsAppDaProposta(proposta);
  }catch(err){
    console.error('[propostas] erro ao enviar no WhatsApp:', err);
    toast('Erro ao abrir WhatsApp da proposta.', true);
  }
}

async function enviarPropostaAtualNoWhatsApp(){
  try{
    const propostaAtual = propostaId
      ? await apiJson(`${API_PROPOSTAS}/${propostaId}`)
      : buildPropostaAtualParaWhatsApp();

    await abrirWhatsAppDaProposta(propostaAtual);
  }catch(err){
    console.error('[propostas] erro ao abrir WhatsApp da proposta atual:', err);
    toast('Erro ao abrir WhatsApp da proposta.', true);
  }
}

// ==========================================
// PROPOSTAS - LISTA
// ==========================================
async function carregarPropostas(){
  try{
    const data = await apiJson(API_PROPOSTAS);
    propostas = Array.isArray(data) ? data : [];
  }catch(err){
    console.error('[propostas] erro ao carregar propostas:', err);
    propostas = [];
  }
  renderTabela();
}

function renderTabela(){
  const tbody = qs('tbody-propostas');
  const count = qs('contagem-propostas');
  const busca = (qs('busca-propostas')?.value || '').toLowerCase().trim();

  if(!tbody) return;

  const filtradas = propostas.filter((p) => {
    const texto = [p.codigo, p.titulo, p.cliente_nome, p.status, p.total]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return !busca || texto.includes(busca);
  });

  tbody.innerHTML = '';

  if(!filtradas.length){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align: center; border:none; padding: 40px 20px;">
      <i class="fa-brands fa-whatsapp" style="font-size: 32px; color: #25d366; margin-bottom: 12px; display: block;"></i>
      <strong style="display: block; color: var(--text); font-size: 16px; margin-bottom: 4px;">Nenhuma proposta encontrada</strong>
      <span style="color: var(--muted); font-size: 14px;">Crie sua primeira proposta e envie para o cliente com 1 clique.</span>
    </td></tr>`;
  }else{
    filtradas.forEach((p) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-codigo">${escapeHtml(p.codigo || '-')}</span></td>
        <td style="font-weight: 500; color: var(--text);">${escapeHtml(p.titulo || '-')}</td>
        <td>${escapeHtml(p.cliente_nome || '-')}</td>
        <td><span class="proposal-status-chip">${escapeHtml(capitalizeStatus(p.status || '-'))}</span></td>
        <td>R$ ${escapeHtml(formatarValorBRL(p.total || '0,00'))}</td>
        <td style="text-align:right;">
          <div class="row-actions">
            <button class="btn-icon" data-action="whatsapp" data-id="${p.id}" title="Enviar no WhatsApp">
              <i class="fa-brands fa-whatsapp"></i>
            </button>
            <button class="btn-icon" data-action="abrir" data-id="${p.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-icon danger" data-action="excluir" data-id="${p.id}" title="Excluir">
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

// ==========================================
// PROPOSTAS - MODAL
// ==========================================
function openModal(){
  qs('proposal-modal')?.classList.add('show');
  updateWhatsAppModalButton();
}

function closeModal(){
  qs('proposal-modal')?.classList.remove('show');
  fecharResultadosClientes();
}

function updateStatusChip(){
  const chip = qs('proposal-chip-status');
  if(!chip) return;
  chip.textContent = capitalizeStatus(qs('proposta-status')?.value || 'rascunho');
}

async function carregarConfiguracaoCamposExtras(){
  try{
    const data = await apiJson(`${API_CAMPOS_PROPOSTAS}?somente_ativos=true`);
    camposExtrasConfig = Array.isArray(data) ? data : [];
  }catch(err){
    console.error('[propostas] erro ao carregar campos extras:', err);
    camposExtrasConfig = [];
  }
}

function renderCamposExtras(camposValores = []){
  const card = qs('proposal-card-campos-extras');
  const wrap = qs('proposal-campos-extras');

  if(!card || !wrap) return;

  if(!camposExtrasConfig.length){
    card.style.display = 'none';
    wrap.innerHTML = '';
    return;
  }

  const valoresMap = new Map(
    (camposValores || []).map((c) => [Number(c.campo_id), c.valor ?? ''])
  );

  wrap.innerHTML = '';
  card.style.display = '';

  camposExtrasConfig.forEach((campo) => {
    const valor = valoresMap.get(Number(campo.id)) ?? '';
    const obrigatorioMark = campo.obrigatorio ? ' *' : '';
    const full = campo.tipo === 'textarea' ? ' is-full' : '';

    const div = document.createElement('div');
    div.className = `proposal-extra-field${full}`;

    let html = `<label for="campo-extra-${campo.id}">${escapeHtml(campo.nome)}${obrigatorioMark}</label>`;

    if(campo.tipo === 'texto'){
      html += `<input id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}" type="text" value="${escapeAttr(valor)}">`;
    }else if(campo.tipo === 'numero'){
      html += `<input id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}" type="number" value="${escapeAttr(valor)}">`;
    }else if(campo.tipo === 'data'){
      html += `<input id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}" type="date" value="${escapeAttr(valor)}">`;
    }else if(campo.tipo === 'textarea'){
      html += `<textarea id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}" rows="3">${escapeHtml(valor)}</textarea>`;
    }else if(campo.tipo === 'checkbox'){
      const checked = String(valor).toLowerCase() === 'true' ? 'checked' : '';
      html += `
        <label class="checkbox-inline">
          <input id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}" type="checkbox" ${checked}>
          <span>Marcar</span>
        </label>
      `;
    }else if(campo.tipo === 'select'){
      const opcoes = Array.isArray(campo.opcoes) ? campo.opcoes : [];
      html += `<select id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="${campo.tipo}">`;
      html += `<option value="">Selecione</option>`;
      opcoes.forEach((op) => {
        const selected = String(op) === String(valor) ? 'selected' : '';
        html += `<option value="${escapeAttr(op)}" ${selected}>${escapeHtml(op)}</option>`;
      });
      html += `</select>`;
    }else{
      html += `<input id="campo-extra-${campo.id}" data-campo-id="${campo.id}" data-campo-tipo="texto" type="text" value="${escapeAttr(valor)}">`;
    }

    wrap.appendChild(div);
    div.innerHTML = html;
  });
}

function coletarCamposExtras(){
  return camposExtrasConfig.map((campo) => {
    const el = document.querySelector(`[data-campo-id="${campo.id}"]`);
    if(!el){
      return { campo_id: campo.id, valor: null };
    }

    let valor = null;
    if(campo.tipo === 'checkbox'){
      valor = el.checked ? 'true' : 'false';
    }else{
      valor = String(el.value ?? '').trim() || null;
    }

    return {
      campo_id: Number(campo.id),
      valor,
    };
  });
}

function snapshotCamposExtrasAtuais(){
  try{
    return coletarCamposExtras();
  }catch{
    return [];
  }
}

function resetFormulario(){
  propostaId = null;
  itens = [];

  qs('proposal-modal-title').textContent = 'Nova proposta';
  qs('proposta-codigo').value = '';
  qs('proposta-titulo').value = '';
  qs('proposta-cliente-id').value = '';
  qs('proposta-cliente-busca').value = '';
  qs('proposta-status').value = 'rascunho';
  qs('proposta-validade').value = '';
  qs('proposta-observacoes').value = '';
  qs('proposta-subtotal').value = '';
  qs('proposta-desconto').value = '';
  qs('proposta-total').value = '';

  updateStatusChip();
  renderCamposExtras([]);
  addItemRow({});
  fecharResultadosClientes();
  updateWhatsAppModalButton();
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
    console.error('[propostas] erro ao carregar proposta:', err);
    closeModal();
    toast('Erro ao carregar proposta.', true);
  }
}

// ==========================================
// ITENS
// ==========================================
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
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align: center; border:none; padding: 24px;">Nenhum item adicionado.</td></tr>`;
    return;
  }

  itens.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding: 8px 16px;">
        <input type="text" data-field="descricao" value="${escapeAttr(item.descricao || '')}">
      </td>
      <td style="padding: 8px 16px;">
        <input type="text" style="width: 60px; text-align: center;" data-field="quantidade" value="${escapeAttr(item.quantidade || '')}">
      </td>
      <td style="padding: 8px 16px;">
        <input type="text" style="width: 60px; text-align: center;" data-field="unidade" value="${escapeAttr(item.unidade || '')}">
      </td>
      <td style="padding: 8px 16px;">
        <input type="text" data-field="valor_unitario" placeholder="R$" value="${escapeAttr(item.valor_unitario || '')}">
      </td>
      <td style="padding: 8px 16px;">
        <input type="text" data-field="valor_total" placeholder="R$" value="${escapeAttr(item.valor_total || '')}">
      </td>
      <td style="padding: 8px 16px; text-align: center; vertical-align: middle;">
        <button type="button" class="btn-icon-danger" data-remove="${index}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
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

// ==========================================
// PROPOSTAS - CRUD
// ==========================================
function buildPayload(){
  return {
    codigo: qs('proposta-codigo')?.value?.trim() || '',
    cliente_id: qs('proposta-cliente-id')?.value ? Number(qs('proposta-cliente-id').value) : null,
    titulo: qs('proposta-titulo')?.value?.trim() || '',
    status: qs('proposta-status')?.value || 'rascunho',
    observacoes: qs('proposta-observacoes')?.value?.trim() || '',
    validade_dias: qs('proposta-validade')?.value?.trim() || '',
    subtotal: qs('proposta-subtotal')?.value?.trim() || '',
    desconto: qs('proposta-desconto')?.value?.trim() || '',
    total: qs('proposta-total')?.value?.trim() || '',
    itens: collectItensFromDOM(),
    campos_extras: coletarCamposExtras(),
  };
}

async function salvarProposta(){
  const payload = buildPayload();
  const btn = qs('btn-salvar-proposta');
  const clienteBusca = qs('proposta-cliente-busca')?.value?.trim() || '';

  if(!payload.titulo){
    toast('Preencha o título da proposta.', true);
    return;
  }

  if(clienteBusca && !payload.cliente_id){
    toast('Selecione um cliente da lista para vincular à proposta.', true);
    return;
  }

  if(!payload.itens.length){
    toast('Adicione pelo menos um item.', true);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Salvando...';

  try{
    if(propostaId){
      await apiJson(`${API_PROPOSTAS}/${propostaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }else{
      const criada = await apiJson(API_PROPOSTAS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      propostaId = criada?.id || null;
    }

    await carregarPropostas();
    closeModal();
    toast('Proposta salva com sucesso!');
  }catch(err){
    console.error('[propostas] erro ao salvar:', err);
    toast('Erro ao salvar proposta.', true);
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar';
    updateWhatsAppModalButton();
  }
}

async function carregarProposta(id){
  const p = await apiJson(`${API_PROPOSTAS}/${id}`);
  propostaId = id;

  qs('proposta-codigo').value = p.codigo || '';
  qs('proposta-titulo').value = p.titulo || '';
  qs('proposta-status').value = p.status || 'rascunho';
  qs('proposta-observacoes').value = p.observacoes || '';
  qs('proposta-validade').value = p.validade_dias || '';
  qs('proposta-subtotal').value = p.subtotal || '';
  qs('proposta-desconto').value = p.desconto || '';
  qs('proposta-total').value = p.total || '';

  await preencherClienteSelecionado(p.cliente_id || '', p.cliente_nome || '');

  itens = Array.isArray(p.itens) ? p.itens : [];
  renderItens();
  renderCamposExtras(p.campos_extras || []);
  updateStatusChip();
  updateWhatsAppModalButton();
}

// ==========================================
// CAMPOS CONFIGURÁVEIS - MODAL
// ==========================================
function openFieldsConfigModal(){
  qs('fields-config-modal')?.classList.add('show');
}

function closeFieldsConfigModal(){
  qs('fields-config-modal')?.classList.remove('show');
}

async function carregarCamposConfiguraveis(){
  try{
    const data = await apiJson(API_CAMPOS_PROPOSTAS);
    camposConfiguraveis = Array.isArray(data) ? data : [];
  }catch(err){
    console.error('[propostas] erro ao carregar campos configuráveis:', err);
    camposConfiguraveis = [];
  }
}

function updateCampoChipStatus(){
  const chip = qs('campo-chip-status');
  if(!chip) return;
  chip.textContent = qs('campo-ativo')?.checked ? 'Ativo' : 'Inativo';
}

function toggleCampoOpcoes(){
  const tipo = qs('campo-tipo')?.value || 'texto';
  const row = qs('campo-opcoes-row');
  if(!row) return;
  row.style.display = tipo === 'select' ? '' : 'none';
}

function resetCampoForm(){
  campoConfigId = null;
  campoSlugTouched = false;

  qs('campo-form-title').textContent = 'Novo campo';
  qs('campo-form-subtitle').textContent = 'Configure um novo campo personalizado.';
  qs('campo-nome').value = '';
  qs('campo-slug').value = '';
  qs('campo-tipo').value = 'texto';
  qs('campo-ordem').value = '0';
  qs('campo-obrigatorio').checked = false;
  qs('campo-ativo').checked = true;
  qs('campo-opcoes').value = '';
  qs('btn-excluir-campo-config').style.display = 'none';

  updateCampoChipStatus();
  toggleCampoOpcoes();
  destacarCampoSelecionado();
}

function preencherCampoForm(campo){
  campoConfigId = Number(campo.id);
  campoSlugTouched = true;

  qs('campo-form-title').textContent = 'Editar campo';
  qs('campo-form-subtitle').textContent = `Editando: ${campo.nome}`;
  qs('campo-nome').value = campo.nome || '';
  qs('campo-slug').value = campo.slug || '';
  qs('campo-tipo').value = campo.tipo || 'texto';
  qs('campo-ordem').value = String(campo.ordem ?? 0);
  qs('campo-obrigatorio').checked = !!campo.obrigatorio;
  qs('campo-ativo').checked = !!campo.ativo;
  qs('campo-opcoes').value = Array.isArray(campo.opcoes) ? campo.opcoes.join('\n') : '';
  qs('btn-excluir-campo-config').style.display = '';

  updateCampoChipStatus();
  toggleCampoOpcoes();
  destacarCampoSelecionado();
}

function buildCampoPayload(){
  const nome = qs('campo-nome')?.value?.trim() || '';
  const slug = qs('campo-slug')?.value?.trim() || '';
  const tipo = qs('campo-tipo')?.value || 'texto';
  const ordemRaw = qs('campo-ordem')?.value?.trim() || '0';

  return {
    nome,
    slug: slug || null,
    tipo,
    obrigatorio: !!qs('campo-obrigatorio')?.checked,
    ativo: !!qs('campo-ativo')?.checked,
    ordem: Number(ordemRaw || 0),
    opcoes: tipo === 'select' ? parseOpcoesTextarea(qs('campo-opcoes')?.value || '') : [],
  };
}

function destacarCampoSelecionado(){
  const rows = document.querySelectorAll('#fields-config-body tr[data-id]');
  rows.forEach((row) => {
    row.classList.toggle('is-selected', Number(row.dataset.id) === Number(campoConfigId));
  });
}

function renderTabelaCamposConfig(){
  const tbody = qs('fields-config-body');
  const busca = (qs('busca-campos-config')?.value || '').toLowerCase().trim();
  const count = qs('contagem-campos-config');

  if(!tbody) return;

  const filtrados = camposConfiguraveis.filter((campo) => {
    const texto = [
      campo.nome,
      campo.slug,
      campo.tipo,
      campo.obrigatorio ? 'obrigatorio' : '',
      campo.ativo ? 'ativo' : 'inativo',
    ].join(' ').toLowerCase();

    return !busca || texto.includes(busca);
  });

  tbody.innerHTML = '';

  if(!filtrados.length){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align:center; border:none;">Nenhum campo encontrado.</td></tr>`;
  }else{
    filtrados.forEach((campo) => {
      const tr = document.createElement('tr');
      tr.dataset.id = campo.id;
      if(Number(campo.id) === Number(campoConfigId)){
        tr.classList.add('is-selected');
      }

      tr.innerHTML = `
        <td>
          <div class="field-main-cell">
            <strong>${escapeHtml(campo.nome || '-')}</strong>
            <span class="field-sub">${escapeHtml(campo.slug || '-')}</span>
          </div>
        </td>
        <td><span class="mini-badge">${escapeHtml(tipoCampoLabel(campo.tipo))}</span></td>
        <td>${campo.obrigatorio ? '<span class="pill pill-warning">Sim</span>' : '<span class="pill">Não</span>'}</td>
        <td>${campo.ativo ? '<span class="pill pill-success">Ativo</span>' : '<span class="pill">Inativo</span>'}</td>
        <td>${Number(campo.ordem || 0)}</td>
        <td style="text-align:right;">
          <div class="row-actions">
            <button class="btn-icon" data-action="editar-campo" data-id="${campo.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-icon danger" data-action="excluir-campo" data-id="${campo.id}" title="Excluir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  if(count){
    count.textContent = filtrados.length === 1 ? '1 campo' : `${filtrados.length} campos`;
  }
}

async function sincronizarCamposExtrasAposConfig(){
  const valoresAtuais = snapshotCamposExtrasAtuais();
  await carregarConfiguracaoCamposExtras();
  renderCamposExtras(valoresAtuais);
}

async function salvarCampoConfiguravel(){
  const payload = buildCampoPayload();
  const btn = qs('btn-salvar-campo-config');

  if(!payload.nome){
    toast('Preencha o nome do campo.', true);
    return;
  }

  if(payload.tipo === 'select' && !payload.opcoes.length){
    toast('Preencha pelo menos uma opção para o campo de lista.', true);
    return;
  }

  btn.disabled = true;
  btn.innerHTML = 'Salvando...';

  try{
    if(campoConfigId){
      await apiJson(`${API_CAMPOS_PROPOSTAS}/${campoConfigId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }else{
      const criado = await apiJson(API_CAMPOS_PROPOSTAS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      campoConfigId = criado?.id || null;
    }

    await carregarCamposConfiguraveis();
    renderTabelaCamposConfig();

    const salvo = camposConfiguraveis.find((c) => Number(c.id) === Number(campoConfigId));
    if(salvo){
      preencherCampoForm(salvo);
    }else{
      resetCampoForm();
    }

    await sincronizarCamposExtrasAposConfig();
    toast('Campo salvo com sucesso!');
  }catch(err){
    console.error('[propostas] erro ao salvar campo:', err);
    toast('Erro ao salvar campo.', true);
  }finally{
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk" style="margin-right: 6px;"></i> Salvar campo';
  }
}

async function excluirCampoConfiguravelPorId(id){
  const campo = camposConfiguraveis.find((c) => Number(c.id) === Number(id));
  if(!campo) return;

  const ok = await confirmDialog({
    title: 'Excluir campo',
    message: `Deseja excluir o campo "${campo.nome}"?`,
    confirmText: 'Excluir',
  });

  if(!ok) return;

  try{
    await apiJson(`${API_CAMPOS_PROPOSTAS}/${id}`, { method: 'DELETE' });

    if(Number(campoConfigId) === Number(id)){
      resetCampoForm();
    }

    await carregarCamposConfiguraveis();
    renderTabelaCamposConfig();
    await sincronizarCamposExtrasAposConfig();
    toast('Campo excluído.');
  }catch(err){
    console.error('[propostas] erro ao excluir campo:', err);
    toast('Erro ao excluir campo.', true);
  }
}

// ==========================================
// EVENTOS
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  qs('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  qs('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  qs('busca-propostas')?.addEventListener('input', renderTabela);
  qs('btn-nova-proposta')?.addEventListener('click', openNovaProposta);
  qs('btn-fechar-modal')?.addEventListener('click', closeModal);
  qs('btn-whatsapp-proposta')?.addEventListener('click', enviarPropostaAtualNoWhatsApp);

  qs('proposta-cliente-busca')?.addEventListener('focus', async () => {
    if(!clientesCache.length){
      await carregarClientes();
    }
    renderResultadosClientes(qs('proposta-cliente-busca')?.value || '');
  });

  qs('proposta-cliente-busca')?.addEventListener('input', async (e) => {
    if(!clientesCache.length){
      await carregarClientes();
    }

    limparClienteSelecionado(true);
    renderResultadosClientes(e.target.value || '');
  });

  qs('proposta-cliente-busca')?.addEventListener('keydown', (e) => {
    if(e.key === 'Escape'){
      fecharResultadosClientes();
    }
  });

  qs('proposta-titulo')?.addEventListener('input', updateWhatsAppModalButton);

  qs('btn-configurar-campos')?.addEventListener('click', async () => {
    await carregarCamposConfiguraveis();
    renderTabelaCamposConfig();
    resetCampoForm();
    openFieldsConfigModal();
  });

  qs('btn-configurar-campos-proposta')?.addEventListener('click', async () => {
    await carregarCamposConfiguraveis();
    renderTabelaCamposConfig();
    resetCampoForm();
    openFieldsConfigModal();
  });

  qs('btn-fechar-fields-config-modal')?.addEventListener('click', closeFieldsConfigModal);
  qs('btn-novo-campo-config')?.addEventListener('click', resetCampoForm);
  qs('btn-limpar-campo-config')?.addEventListener('click', resetCampoForm);
  qs('btn-salvar-campo-config')?.addEventListener('click', salvarCampoConfiguravel);

  qs('btn-excluir-campo-config')?.addEventListener('click', async () => {
    if(!campoConfigId) return;
    await excluirCampoConfiguravelPorId(campoConfigId);
  });

  qs('busca-campos-config')?.addEventListener('input', renderTabelaCamposConfig);

  qs('campo-tipo')?.addEventListener('change', toggleCampoOpcoes);
  qs('campo-ativo')?.addEventListener('change', updateCampoChipStatus);

  qs('campo-nome')?.addEventListener('input', () => {
    if(!campoSlugTouched){
      qs('campo-slug').value = slugify(qs('campo-nome').value);
    }
  });

  qs('campo-slug')?.addEventListener('input', () => {
    campoSlugTouched = !!qs('campo-slug').value.trim();
  });

  qs('tbody-propostas')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'whatsapp'){
      await enviarPropostaNoWhatsApp(id);
      return;
    }

    if(action === 'abrir'){
      await openEditarProposta(id);
      return;
    }

    if(action === 'excluir'){
      const ok = await confirmDialog({
        title: 'Excluir Proposta',
        message: 'Deseja mesmo excluir esta proposta?',
        confirmText: 'Excluir',
      });

      if(ok){
        await apiJson(`${API_PROPOSTAS}/${id}`, { method: 'DELETE' });
        await carregarPropostas();
        toast('Proposta excluída.');
      }
    }
  });

  qs('fields-config-body')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'editar-campo'){
      const campo = camposConfiguraveis.find((c) => Number(c.id) === Number(id));
      if(campo) preencherCampoForm(campo);
      return;
    }

    if(action === 'excluir-campo'){
      await excluirCampoConfiguravelPorId(id);
    }
  });

  qs('proposal-modal')?.addEventListener('click', (e) => {
    if(e.target === qs('proposal-modal')){
      closeModal();
    }
  });

  qs('fields-config-modal')?.addEventListener('click', (e) => {
    if(e.target === qs('fields-config-modal')){
      closeFieldsConfigModal();
    }
  });

  document.addEventListener('click', (e) => {
    const picker = e.target.closest('.client-picker');
    if(!picker){
      fecharResultadosClientes();
    }
  });

  document.addEventListener('keydown', (e) => {
    if(e.key !== 'Escape') return;

    if(isModalOpen('Valora-confirm-backdrop')){
      closeConfirm(false);
      return;
    }

    if(isModalOpen('fields-config-modal')){
      closeFieldsConfigModal();
      return;
    }

    if(isModalOpen('proposal-modal')){
      closeModal();
    }
  });

  qs('btn-add-item')?.addEventListener('click', () => addItemRow({}));
  qs('btn-salvar-proposta')?.addEventListener('click', salvarProposta);
  qs('proposta-status')?.addEventListener('change', updateStatusChip);

  qs('proposal-items-body')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-icon-danger');
    if(!btn) return;
    removeItemRow(Number(btn.dataset.remove));
  });

  await carregarClientes();
  await carregarConfiguracaoCamposExtras();
  renderCamposExtras([]);
  await carregarPropostas();
  updateWhatsAppModalButton();
});