// /frontend/js/pages/clientes.js
let clientes = [];
let clienteEditandoId = null;

const API_CLIENTES = '/api/clientes';

function onlyDigits(s){ return String(s||'').replace(/\D+/g,''); }
function todayISODate(){
  const d=new Date(); const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatTipo(tipo){
  if (tipo === 'pf') return 'Física';
  if (tipo === 'pj') return 'Jurídica';
  return '-';
}

/* ========================
 * TOAST (sem “127.0.0.1:8000 diz”)
 * =======================*/
function toast(msg, { error=false, ms=2600 } = {}){
  const el = document.getElementById('orca-toast');
  if(!el) return; // sem fallback pra alert, pra nunca aparecer o popup do browser

  el.textContent = msg || '';
  el.classList.toggle('is-error', !!error);
  el.hidden = false;

  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.hidden = true; }, ms);
}

/* ========================
 * CONFIRM (substitui confirm())
 * =======================*/
let _confirmResolver = null;

function confirmDialog({
  title='Confirmar',
  message='Tem certeza?',
  confirmText='OK',
  cancelText='Cancelar',
  danger=false,
} = {}){
  const backdrop = document.getElementById('orca-confirm-backdrop');
  const box = backdrop?.querySelector('.orca-confirm');
  const t = document.getElementById('orca-confirm-title');
  const m = document.getElementById('orca-confirm-message');
  const btnOk = document.getElementById('orca-confirm-ok');
  const btnCancel = document.getElementById('orca-confirm-cancel');

  if(!backdrop || !box || !btnOk || !btnCancel){
    // se não achar modal, confirma como false pra evitar destruir dados
    return Promise.resolve(false);
  }

  if(t) t.textContent = title;
  if(m) m.textContent = message;

  btnOk.textContent = confirmText || 'OK';
  btnCancel.textContent = cancelText || 'Cancelar';

  box.classList.toggle('is-danger', !!danger);

  backdrop.hidden = false;
  backdrop.style.display = 'flex';

  return new Promise((resolve)=>{
    _confirmResolver = resolve;
    setTimeout(()=>{ try{ btnCancel.focus(); }catch{} }, 0);
  });
}

function closeConfirm(result=false){
  const backdrop = document.getElementById('orca-confirm-backdrop');
  if(backdrop){
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
  if(typeof _confirmResolver === 'function'){
    const r = _confirmResolver;
    _confirmResolver = null;
    r(!!result);
  }
}

/* ========================
 * API
 * =======================*/
async function carregarClientes(){
  const resp = await fetch(API_CLIENTES);
  if(!resp.ok) throw new Error(await resp.text());
  const data = await resp.json();
  clientes = Array.isArray(data) ? data : [];
  renderTabelaClientes();
}

async function obterClienteNoServidor(id){
  const resp = await fetch(`${API_CLIENTES}/${id}`);
  if(!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function salvarClienteNoServidor(payload, editandoId){
  const url = editandoId == null ? API_CLIENTES : `${API_CLIENTES}/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if(!resp.ok){
    const txt = await resp.text();
    const err = new Error(txt || 'Erro ao salvar');
    err.status = resp.status;
    throw err;
  }

  return resp.json();
}

async function excluirClienteNoServidor(id){
  const resp = await fetch(`${API_CLIENTES}/${id}`, { method:'DELETE' });
  if(!resp.ok) throw new Error(await resp.text());
}

/* ========================
 * RENDER
 * =======================*/
function renderTabelaClientes(){
  const tbody = document.getElementById('tbody-clientes');
  const spanCount = document.getElementById('contagem-clientes');
  const busca = (document.getElementById('busca-clientes')?.value || '').toLowerCase();
  const tipoFiltro = document.getElementById('filtro-tipo-cliente')?.value || '';

  if(!tbody) return;

  const filtrados = clientes.filter(c=>{
    const texto = [
      c.codigo, c.nome, c.whatsapp, c.cidade, c.uf
    ].filter(Boolean).join(' ').toLowerCase();

    const matchBusca = !busca || texto.includes(busca);
    const matchTipo = !tipoFiltro || c.tipo === tipoFiltro;
    return matchBusca && matchTipo;
  });

  tbody.innerHTML = '';

  filtrados.forEach(c=>{
    let tipoClass = 'orca-pill-tipo';
    if(c.tipo === 'pf') tipoClass += ' orca-pill-tipo--pf';
    else if(c.tipo === 'pj') tipoClass += ' orca-pill-tipo--pj';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Código"><span>${c.codigo || '-'}</span></td>
      <td data-label="Cliente"><span>${c.nome || '-'}</span></td>
      <td data-label="Tipo"><span class="${tipoClass}">${formatTipo(c.tipo)}</span></td>
      <td data-label="Cidade / UF"><span>${(c.cidade||'-')} / ${(c.uf||'-')}</span></td>
      <td data-label="WhatsApp"><span>${c.whatsapp || '-'}</span></td>
      <td data-label="Ações">
        <div class="orca-table-actions">
          <button class="orca-icon-btn" data-action="editar" data-id="${c.id}" title="Editar cliente">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="orca-icon-btn" data-action="excluir" data-id="${c.id}" title="Excluir cliente">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if(spanCount){
    const qtd = filtrados.length;
    spanCount.textContent = qtd === 1 ? '1 cliente' : `${qtd} clientes`;
  }
}

/* ========================
 * CEP (ViaCEP)
 * =======================*/
let cepFetchController = null;

function setCepHelp(msg='', isError=false){
  const help = document.getElementById('cep-help');
  if(!help) return;
  help.textContent = msg || '';
  help.classList.toggle('is-error', !!isError);
}

function fillAddressFields(data){
  const logradouro = document.getElementById('campo-logradouro');
  const bairro = document.getElementById('campo-bairro');
  const cidade = document.getElementById('campo-cidade');
  const uf = document.getElementById('campo-uf');

  if(logradouro) logradouro.value = data?.logradouro || '';
  if(bairro) bairro.value = data?.bairro || '';
  if(cidade) cidade.value = data?.localidade || '';
  if(uf) uf.value = (data?.uf || '').toUpperCase();
}

async function buscarCep(cepRaw){
  const cep = onlyDigits(cepRaw);
  if(cep.length !== 8){
    setCepHelp('Digite um CEP com 8 números.', true);
    fillAddressFields(null);
    return;
  }

  setCepHelp('Buscando endereço...', false);

  try{
    if(cepFetchController) cepFetchController.abort();
    cepFetchController = new AbortController();

    const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: cepFetchController.signal });
    if(!resp.ok) throw new Error('Falha ao consultar CEP.');
    const data = await resp.json();

    if(data?.erro){
      setCepHelp('CEP não encontrado.', true);
      fillAddressFields(null);
      return;
    }

    fillAddressFields(data);
    setCepHelp('Endereço preenchido automaticamente.', false);
  }catch(err){
    if(String(err?.name) === 'AbortError') return;
    console.warn('[Clientes] CEP lookup falhou:', err);
    setCepHelp('Não foi possível buscar o CEP agora.', true);
  }
}

/* ========================
 * UI helpers (PF/PJ)
 * =======================*/
function setHidden(id, hidden){
  const el = document.getElementById(id);
  if(el) el.hidden = !!hidden;
}

function syncTipoSections(){
  const tipo = document.getElementById('campo-tipo-cliente')?.value || 'pf';
  setHidden('sec-pj', tipo !== 'pj');
  setHidden('sec-pf', tipo !== 'pf');
}

function syncOndeConheceuOutro(){
  const sel = document.getElementById('campo-onde-conheceu');
  const wrap = document.getElementById('wrap-onde-outro');
  const campo = document.getElementById('campo-onde-outro');
  if(!sel || !wrap) return;
  const isOutro = sel.value === 'outro';
  wrap.hidden = !isOutro;
  if(!isOutro && campo) campo.value = '';
}

/* ========================
 * MODAL CLIENTE
 * =======================*/
function abrirModal(){
  const backdrop = document.getElementById('modal-cliente-backdrop');
  if(!backdrop) return;
  backdrop.hidden = false;
  backdrop.style.display = 'flex';
}

function fecharModal(){
  const backdrop = document.getElementById('modal-cliente-backdrop');
  if(backdrop){
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
  clienteEditandoId = null;
}

function setVal(id, v){
  const el = document.getElementById(id);
  if(el) el.value = (v ?? '');
}

function getVal(id){
  const el = document.getElementById(id);
  return (el?.value ?? '').trim();
}

function redesFromInputs(){
  const instagram = getVal('campo-instagram');
  const facebook = getVal('campo-facebook');
  const linkedin = getVal('campo-linkedin');
  const obj = {};
  if(instagram) obj.instagram = instagram;
  if(facebook) obj.facebook = facebook;
  if(linkedin) obj.linkedin = linkedin;
  return Object.keys(obj).length ? obj : null;
}

function redesToInputs(redes){
  setVal('campo-instagram', redes?.instagram || '');
  setVal('campo-facebook', redes?.facebook || '');
  setVal('campo-linkedin', redes?.linkedin || '');
}

function limparCompletos(){
  setVal('campo-whatsapp-principal','');
  setVal('campo-end-pais','BR');

  setVal('campo-razao-social','');
  setVal('campo-cnpj','');
  setVal('campo-inscricao_estadual',''); // (não existe no HTML; mantive só por segurança)
  setVal('campo-inscricao-estadual','');
  setVal('campo-inscricao-municipal','');
  setVal('campo-responsavel-contratante','');
  setVal('campo-cpf-resp-admin','');

  setVal('campo-rg','');
  setVal('campo-data-nascimento','');
  setVal('campo-estado-civil','');
  setVal('campo-profissao','');

  setVal('campo-cep-cobranca','');

  setVal('campo-home-page','');
  redesToInputs(null);
}

function abrirModalClienteNovo(){
  const titulo = document.getElementById('modal-cliente-titulo');
  if(titulo) titulo.textContent = 'Novo cliente';

  clienteEditandoId = null;

  const proximoId = clientes.length > 0 ? Math.max(...clientes.map(c=>Number(c.id)||0)) + 1 : 1;
  setVal('campo-codigo-cliente', `CLI-${String(proximoId).padStart(4,'0')}`);
  setVal('campo-data-cadastro', todayISODate());
  setVal('campo-tipo-cliente', 'pf');
  setVal('campo-nome-cliente', '');
  setVal('campo-whatsapp-cliente', '');

  setVal('campo-pessoa-contato','');
  setVal('campo-email-principal','');

  setVal('campo-cep','');
  setVal('campo-logradouro','');
  setVal('campo-numero','');
  setVal('campo-bairro','');
  setVal('campo-cidade','');
  setVal('campo-uf','');
  setCepHelp('');

  setVal('campo-tipo-imovel','');
  setVal('campo-onde-conheceu','');
  setVal('campo-onde-outro','');
  syncOndeConheceuOutro();

  limparCompletos();
  syncTipoSections();

  abrirModal();
  setTimeout(()=>{ try{ document.getElementById('campo-nome-cliente')?.focus(); }catch{} },0);
}

function abrirModalClienteEditar(clienteFull){
  const titulo = document.getElementById('modal-cliente-titulo');
  if(titulo) titulo.textContent = 'Editar cliente';

  clienteEditandoId = clienteFull.id;

  setVal('campo-codigo-cliente', clienteFull.codigo || '');

  const dt = clienteFull.data_cadastro ? new Date(clienteFull.data_cadastro) : null;
  if(dt && !isNaN(dt.getTime())){
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth()+1).padStart(2,'0');
    const dd = String(dt.getDate()).padStart(2,'0');
    setVal('campo-data-cadastro', `${yyyy}-${mm}-${dd}`);
  } else {
    setVal('campo-data-cadastro', todayISODate());
  }

  setVal('campo-tipo-cliente', clienteFull.tipo || 'pf');
  setVal('campo-nome-cliente', clienteFull.nome || '');
  setVal('campo-whatsapp-cliente', clienteFull.whatsapp || '');

  setVal('campo-pessoa-contato', clienteFull.pessoa_contato || '');
  setVal('campo-email-principal', clienteFull.email_principal || '');

  setVal('campo-cep', clienteFull.cep || '');
  setVal('campo-logradouro', clienteFull.endereco_logradouro || '');
  setVal('campo-numero', clienteFull.endereco_numero || '');
  setVal('campo-bairro', clienteFull.endereco_bairro || '');
  setVal('campo-cidade', clienteFull.cidade || '');
  setVal('campo-uf', (clienteFull.uf || '').toUpperCase());
  setCepHelp('');

  setVal('campo-tipo-imovel', clienteFull.tipo_imovel || '');
  setVal('campo-onde-conheceu', clienteFull.onde_conheceu || '');
  setVal('campo-onde-outro', clienteFull.onde_conheceu_outro || '');
  syncOndeConheceuOutro();

  setVal('campo-whatsapp-principal', clienteFull.whatsapp_principal || '');
  setVal('campo-end-pais', clienteFull.end_pais || 'BR');

  setVal('campo-razao-social', clienteFull.razao_social || '');
  setVal('campo-cnpj', clienteFull.cnpj || '');
  setVal('campo-inscricao-estadual', clienteFull.inscricao_estadual || '');
  setVal('campo-inscricao-municipal', clienteFull.inscricao_municipal || '');
  setVal('campo-responsavel-contratante', clienteFull.responsavel_contratante || '');
  setVal('campo-cpf-resp-admin', clienteFull.cpf_responsavel_administrador || '');

  setVal('campo-rg', clienteFull.rg || '');
  setVal('campo-data-nascimento', clienteFull.data_nascimento || '');
  setVal('campo-estado-civil', clienteFull.estado_civil || '');
  setVal('campo-profissao', clienteFull.profissao || '');

  setVal('campo-cep-cobranca', clienteFull.cep_cobranca || '');
  setVal('campo-home-page', clienteFull.home_page || '');
  redesToInputs(clienteFull.redes_sociais || null);

  syncTipoSections();
  abrirModal();
}

function buildPayload(){
  const tipo = getVal('campo-tipo-cliente') || 'pf';

  return {
    codigo: getVal('campo-codigo-cliente'),
    tipo,
    nome: getVal('campo-nome-cliente'),
    whatsapp: getVal('campo-whatsapp-cliente'),
    data_cadastro: getVal('campo-data-cadastro') || null,

    pessoa_contato: getVal('campo-pessoa-contato'),
    email_principal: getVal('campo-email-principal'),

    cep: getVal('campo-cep'),
    endereco_logradouro: getVal('campo-logradouro'),
    endereco_numero: getVal('campo-numero'),
    endereco_bairro: getVal('campo-bairro'),
    cidade: getVal('campo-cidade'),
    uf: getVal('campo-uf'),

    tipo_imovel: getVal('campo-tipo-imovel'),
    onde_conheceu: getVal('campo-onde-conheceu'),
    onde_conheceu_outro: getVal('campo-onde-outro'),

    whatsapp_principal: getVal('campo-whatsapp-principal'),
    end_pais: getVal('campo-end-pais') || 'BR',

    razao_social: getVal('campo-razao-social'),
    cnpj: getVal('campo-cnpj'),
    inscricao_estadual: getVal('campo-inscricao-estadual'),
    inscricao_municipal: getVal('campo-inscricao-municipal'),
    responsavel_contratante: getVal('campo-responsavel-contratante'),
    cpf_responsavel_administrador: getVal('campo-cpf-resp-admin'),

    rg: getVal('campo-rg'),
    data_nascimento: getVal('campo-data-nascimento') || null,
    estado_civil: getVal('campo-estado-civil'),
    profissao: getVal('campo-profissao'),

    cep_cobranca: getVal('campo-cep-cobranca'),
    home_page: getVal('campo-home-page'),
    redes_sociais: redesFromInputs(),
  };
}

async function salvarCliente(){
  const payload = buildPayload();

  if(!payload.nome){
    toast('Preencha o nome do cliente.', { error:true });
    document.getElementById('campo-nome-cliente')?.focus();
    return;
  }
  if(!payload.tipo){
    toast('Selecione o tipo de cliente.', { error:true });
    document.getElementById('campo-tipo-cliente')?.focus();
    return;
  }
  if(payload.onde_conheceu === 'outro' && !payload.onde_conheceu_outro){
    toast('Preencha o "Outro" em Onde conheceu.', { error:true });
    document.getElementById('campo-onde-outro')?.focus();
    return;
  }

  try{
    await salvarClienteNoServidor(payload, clienteEditandoId);
    await carregarClientes();
    fecharModal();
    toast('Cliente salvo com sucesso.', { ms: 1800 });
  }catch(err){
    console.error('[Clientes] salvar erro:', err);
    toast(err?.message || 'Erro ao salvar cliente no servidor.', { error:true, ms: 5000 });
  }
}

/* ========================
 * INIT
 * =======================*/
document.addEventListener('DOMContentLoaded', async ()=>{
  // garante cliente modal fechado
  const modalBackdrop = document.getElementById('modal-cliente-backdrop');
  if(modalBackdrop){ modalBackdrop.hidden = true; modalBackdrop.style.display='none'; }

  // setup confirm events
  const confirmBackdrop = document.getElementById('orca-confirm-backdrop');
  const btnX = document.getElementById('orca-confirm-close');
  const btnCancel = document.getElementById('orca-confirm-cancel');
  const btnOk = document.getElementById('orca-confirm-ok');

  btnX?.addEventListener('click', ()=>closeConfirm(false));
  btnCancel?.addEventListener('click', ()=>closeConfirm(false));
  btnOk?.addEventListener('click', ()=>closeConfirm(true));
  confirmBackdrop?.addEventListener('click', (e)=>{ if(e.target === confirmBackdrop) closeConfirm(false); });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      // fecha confirm se aberto
      if(confirmBackdrop && !confirmBackdrop.hidden) closeConfirm(false);
      // fecha modal cliente se aberto
      if(modalBackdrop && !modalBackdrop.hidden) fecharModal();
    }
  });

  try{
    await carregarClientes();
  }catch(err){
    console.error('[Clientes] carregar erro:', err);
    toast(err?.message || 'Erro ao carregar clientes.', { error:true, ms: 5000 });
  }

  document.getElementById('busca-clientes')?.addEventListener('input', renderTabelaClientes);
  document.getElementById('filtro-tipo-cliente')?.addEventListener('change', renderTabelaClientes);

  document.getElementById('btn-novo-cliente')?.addEventListener('click', abrirModalClienteNovo);

  document.getElementById('btn-fechar-modal-cliente')?.addEventListener('click', fecharModal);
  document.getElementById('btn-cancelar-cliente')?.addEventListener('click', fecharModal);
  document.getElementById('btn-salvar-cliente')?.addEventListener('click', salvarCliente);

  modalBackdrop?.addEventListener('click', (e)=>{ if(e.target===modalBackdrop) fecharModal(); });

  document.getElementById('campo-onde-conheceu')?.addEventListener('change', syncOndeConheceuOutro);
  document.getElementById('campo-tipo-cliente')?.addEventListener('change', syncTipoSections);

  const campoCep = document.getElementById('campo-cep');
  if(campoCep){
    campoCep.addEventListener('input', ()=>{
      const d = onlyDigits(campoCep.value).slice(0,8);
      campoCep.value = d.length >= 6 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
      setCepHelp('');
    });
    campoCep.addEventListener('blur', ()=>buscarCep(campoCep.value));
    campoCep.addEventListener('keyup', ()=>{
      const d = onlyDigits(campoCep.value);
      if(d.length === 8) buscarCep(d);
    });
  }

  const cepCob = document.getElementById('campo-cep-cobranca');
  if(cepCob){
    cepCob.addEventListener('input', ()=>{
      const d = onlyDigits(cepCob.value).slice(0,8);
      cepCob.value = d.length >= 6 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
    });
  }

  const tbody = document.getElementById('tbody-clientes');
  tbody?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.orca-icon-btn');
    if(!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'editar'){
      try{
        const full = await obterClienteNoServidor(id);
        abrirModalClienteEditar(full);
      }catch(err){
        console.error('[Clientes] obter/editar erro:', err);
        toast(err?.message || 'Não foi possível abrir o cliente para edição.', { error:true, ms: 5000 });
      }
      return;
    }

    if(action === 'excluir'){
      const ok = await confirmDialog({
        title: 'Excluir cliente',
        message: 'Deseja realmente excluir este cliente?',
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        danger: true,
      });

      if(ok){
        excluirClienteNoServidor(id)
          .then(()=>carregarClientes())
          .then(()=>toast('Cliente excluído.', { ms: 1800 }))
          .catch(err=>{
            console.error('[Clientes] excluir erro:', err);
            toast(err?.message || 'Erro ao excluir cliente.', { error:true, ms: 5000 });
          });
      }
    }
  });
});
