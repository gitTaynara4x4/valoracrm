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
 * UI helpers (PF/PJ + avançado)
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
 * MODAL
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

function limparAvancado(){
  // contato
  setVal('campo-pessoa-contato','');
  setVal('campo-email-principal','');
  setVal('campo-whatsapp-principal','');

  // extra
  setVal('campo-end-pais','BR');

  // pj
  setVal('campo-razao-social','');
  setVal('campo-cnpj','');
  setVal('campo-inscricao-estadual','');
  setVal('campo-inscricao-municipal','');
  setVal('campo-cpf-resp-admin','');

  // pf
  setVal('campo-rg','');
  setVal('campo-data-nascimento','');
  setVal('campo-estado-civil','');
  setVal('campo-profissao','');

  // cobrança
  setVal('campo-cep-cobranca','');

  // web
  setVal('campo-home-page','');
  redesToInputs(null);
}

function abrirModalClienteNovo(){
  const titulo = document.getElementById('modal-cliente-titulo');
  if(titulo) titulo.textContent = 'Novo cliente';

  clienteEditandoId = null;

  // básico
  const proximoId = clientes.length > 0 ? Math.max(...clientes.map(c=>Number(c.id)||0)) + 1 : 1;
  setVal('campo-codigo-cliente', `CLI-${String(proximoId).padStart(4,'0')}`);
  setVal('campo-data-cadastro', todayISODate());
  setVal('campo-tipo-cliente', 'pf');
  setVal('campo-nome-cliente', '');
  setVal('campo-whatsapp-cliente', '');

  // endereço
  setVal('campo-cep','');
  setVal('campo-logradouro','');
  setVal('campo-numero','');
  setVal('campo-bairro','');
  setVal('campo-cidade','');
  setVal('campo-uf','');
  setCepHelp('');

  // perfil
  setVal('campo-tipo-imovel','');
  setVal('campo-onde-conheceu','');
  setVal('campo-onde-outro','');
  syncOndeConheceuOutro();

  // avançado: escondido no NOVO
  setHidden('orca-advanced-fields', true);
  limparAvancado();
  syncTipoSections();

  abrirModal();
  setTimeout(()=>{ try{ document.getElementById('campo-nome-cliente')?.focus(); }catch{} },0);
}

function abrirModalClienteEditar(clienteFull){
  const titulo = document.getElementById('modal-cliente-titulo');
  if(titulo) titulo.textContent = 'Editar cliente';

  clienteEditandoId = clienteFull.id;

  // básico
  setVal('campo-codigo-cliente', clienteFull.codigo || '');
  // data_cadastro vem datetime -> converte pra YYYY-MM-DD
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

  // endereço
  setVal('campo-cep', clienteFull.cep || '');
  setVal('campo-logradouro', clienteFull.endereco_logradouro || '');
  setVal('campo-numero', clienteFull.endereco_numero || '');
  setVal('campo-bairro', clienteFull.endereco_bairro || '');
  setVal('campo-cidade', clienteFull.cidade || '');
  setVal('campo-uf', (clienteFull.uf || '').toUpperCase());
  setCepHelp('');

  // perfil
  setVal('campo-tipo-imovel', clienteFull.tipo_imovel || '');
  setVal('campo-onde-conheceu', clienteFull.onde_conheceu || '');
  setVal('campo-onde-outro', clienteFull.onde_conheceu_outro || '');
  syncOndeConheceuOutro();

  // avançado: aparece no EDITAR
  setHidden('orca-advanced-fields', false);

  // contato extra
  setVal('campo-pessoa-contato', clienteFull.pessoa_contato || '');
  setVal('campo-email-principal', clienteFull.email_principal || '');
  setVal('campo-whatsapp-principal', clienteFull.whatsapp_principal || '');

  // endereço extra
  setVal('campo-end-pais', clienteFull.end_pais || 'BR');

  // PJ
  setVal('campo-razao-social', clienteFull.razao_social || '');
  setVal('campo-cnpj', clienteFull.cnpj || '');
  setVal('campo-inscricao-estadual', clienteFull.inscricao_estadual || '');
  setVal('campo-inscricao-municipal', clienteFull.inscricao_municipal || '');
  setVal('campo-cpf-resp-admin', clienteFull.cpf_responsavel_administrador || '');

  // PF
  setVal('campo-rg', clienteFull.rg || '');
  setVal('campo-data-nascimento', clienteFull.data_nascimento || '');
  setVal('campo-estado-civil', clienteFull.estado_civil || '');
  setVal('campo-profissao', clienteFull.profissao || '');

  // cobrança / web
  setVal('campo-cep-cobranca', clienteFull.cep_cobranca || '');
  setVal('campo-home-page', clienteFull.home_page || '');
  redesToInputs(clienteFull.redes_sociais || null);

  syncTipoSections();

  abrirModal();
}

function buildPayload(){
  const tipo = getVal('campo-tipo-cliente') || 'pf';
  const payload = {
    codigo: getVal('campo-codigo-cliente'),
    tipo,
    nome: getVal('campo-nome-cliente'),
    whatsapp: getVal('campo-whatsapp-cliente'),
    data_cadastro: getVal('campo-data-cadastro') || null,

    // endereço
    cep: getVal('campo-cep'),
    endereco_logradouro: getVal('campo-logradouro'),
    endereco_numero: getVal('campo-numero'),
    endereco_bairro: getVal('campo-bairro'),
    cidade: getVal('campo-cidade'),
    uf: getVal('campo-uf'),

    // perfil
    tipo_imovel: getVal('campo-tipo-imovel'),
    onde_conheceu: getVal('campo-onde-conheceu'),
    onde_conheceu_outro: getVal('campo-onde-outro'),
  };

  // se estiver em edição, manda avançados (ou se o bloco estiver visível)
  const advVisible = !document.getElementById('orca-advanced-fields')?.hidden;

  if(advVisible){
    Object.assign(payload, {
      pessoa_contato: getVal('campo-pessoa-contato'),
      email_principal: getVal('campo-email-principal'),
      whatsapp_principal: getVal('campo-whatsapp-principal'),

      end_pais: getVal('campo-end-pais') || 'BR',

      // PJ
      razao_social: getVal('campo-razao-social'),
      cnpj: getVal('campo-cnpj'),
      inscricao_estadual: getVal('campo-inscricao-estadual'),
      inscricao_municipal: getVal('campo-inscricao-municipal'),
      cpf_responsavel_administrador: getVal('campo-cpf-resp-admin'),

      // PF
      rg: getVal('campo-rg'),
      data_nascimento: getVal('campo-data-nascimento') || null,
      estado_civil: getVal('campo-estado-civil'),
      profissao: getVal('campo-profissao'),

      // Cobrança / web
      cep_cobranca: getVal('campo-cep-cobranca'),
      home_page: getVal('campo-home-page'),
      redes_sociais: redesFromInputs(),
    });
  }

  return payload;
}

async function salvarCliente(){
  const payload = buildPayload();

  if(!payload.nome){
    alert('Preencha o nome do cliente.');
    return;
  }
  if(!payload.tipo){
    alert('Selecione o tipo de cliente.');
    return;
  }
  if(payload.onde_conheceu === 'outro' && !payload.onde_conheceu_outro){
    alert('Preencha o "Outro" em Onde conheceu.');
    return;
  }

  try{
    await salvarClienteNoServidor(payload, clienteEditandoId);
    await carregarClientes();
    fecharModal();
  }catch(err){
    console.error('[Clientes] salvar erro:', err);
    alert(err?.message || 'Erro ao salvar cliente no servidor.');
  }
}

/* ========================
 * INIT
 * =======================*/
document.addEventListener('DOMContentLoaded', async ()=>{
  const backdrop = document.getElementById('modal-cliente-backdrop');
  if(backdrop){ backdrop.hidden = true; backdrop.style.display='none'; }

  try{
    await carregarClientes();
  }catch(err){
    console.error('[Clientes] carregar erro:', err);
    alert(err?.message || 'Erro ao carregar clientes.');
  }

  document.getElementById('busca-clientes')?.addEventListener('input', renderTabelaClientes);
  document.getElementById('filtro-tipo-cliente')?.addEventListener('change', renderTabelaClientes);

  document.getElementById('btn-novo-cliente')?.addEventListener('click', abrirModalClienteNovo);

  document.getElementById('btn-fechar-modal-cliente')?.addEventListener('click', fecharModal);
  document.getElementById('btn-cancelar-cliente')?.addEventListener('click', fecharModal);
  document.getElementById('btn-salvar-cliente')?.addEventListener('click', salvarCliente);

  backdrop?.addEventListener('click', (e)=>{ if(e.target===backdrop) fecharModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') fecharModal(); });

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

  // máscara simples para CEP cobrança (só visual)
  const cepCob = document.getElementById('campo-cep-cobranca');
  if(cepCob){
    cepCob.addEventListener('input', ()=>{
      const d = onlyDigits(cepCob.value).slice(0,8);
      cepCob.value = d.length >= 6 ? `${d.slice(0,5)}-${d.slice(5)}` : d;
    });
  }

  // ações na tabela
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
        alert(err?.message || 'Não foi possível abrir o cliente para edição.');
      }
      return;
    }

    if(action === 'excluir'){
      if(confirm('Deseja realmente excluir este cliente?')){
        excluirClienteNoServidor(id)
          .then(()=>carregarClientes())
          .catch(err=>{
            console.error('[Clientes] excluir erro:', err);
            alert(err?.message || 'Erro ao excluir cliente.');
          });
      }
    }
  });
});
