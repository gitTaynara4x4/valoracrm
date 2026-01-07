// /frontend/js/pages/fornecedores.js

let fornecedores = [];
let fornecedorEditandoId = null;

function onlyDigits(s){ return String(s||'').replace(/\D+/g,''); }

function todayISODate(){
  const d=new Date();
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function ymdFromBackendDateTime(v){
  // backend manda datetime ISO. Para evitar bug de fuso, pega os 10 primeiros chars.
  if(!v) return '';
  if(typeof v === 'string' && v.length >= 10) return v.slice(0,10);
  return '';
}

function formatTipo(tipo){
  if(tipo==='pf') return 'Física';
  if(tipo==='pj') return 'Jurídica';
  return '-';
}

/* API */
async function carregarFornecedores(){
  const resp = await fetch('/api/fornecedores');
  if(!resp.ok) throw new Error(await resp.text());
  fornecedores = await resp.json();
  if(!Array.isArray(fornecedores)) fornecedores = [];
  renderTabelaFornecedores();
}

async function obterFornecedorNoServidor(id){
  const resp = await fetch(`/api/fornecedores/${id}`);
  if(!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function salvarFornecedorNoServidor(payload, editandoId){
  const url = editandoId == null ? '/api/fornecedores' : `/api/fornecedores/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if(!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function excluirFornecedorNoServidor(id){
  const resp = await fetch(`/api/fornecedores/${id}`, { method:'DELETE' });
  if(!resp.ok) throw new Error(await resp.text());
}

/* Render */
function renderTabelaFornecedores(){
  const tbody = document.getElementById('tbody-fornecedores');
  const spanCount = document.getElementById('contagem-fornecedores');

  const busca = (document.getElementById('busca-fornecedores')?.value || '').toLowerCase();
  const tipoFiltro = document.getElementById('filtro-tipo-fornecedor')?.value || '';

  if(!tbody) return;

  const filtrados = fornecedores.filter(f=>{
    const texto = [f.codigo, f.nome, f.whatsapp, f.cidade, f.uf].filter(Boolean).join(' ').toLowerCase();
    const matchBusca = !busca || texto.includes(busca);
    const matchTipo = !tipoFiltro || f.tipo === tipoFiltro;
    return matchBusca && matchTipo;
  });

  tbody.innerHTML = '';

  filtrados.forEach(f=>{
    let tipoClass='orca-pill-tipo';
    if(f.tipo==='pf') tipoClass += ' orca-pill-tipo--pf';
    else if(f.tipo==='pj') tipoClass += ' orca-pill-tipo--pj';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Código"><span>${f.codigo || '-'}</span></td>
      <td data-label="Fornecedor"><span>${f.nome || '-'}</span></td>
      <td data-label="Tipo"><span class="${tipoClass}">${formatTipo(f.tipo)}</span></td>
      <td data-label="Cidade / UF"><span>${(f.cidade||'-')} / ${(f.uf||'-')}</span></td>
      <td data-label="WhatsApp"><span>${f.whatsapp || '-'}</span></td>
      <td data-label="Ações">
        <div class="orca-table-actions">
          <button class="orca-icon-btn" data-action="editar" data-id="${f.id}" title="Editar fornecedor">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="orca-icon-btn" data-action="excluir" data-id="${f.id}" title="Excluir fornecedor">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if(spanCount){
    const qtd = filtrados.length;
    spanCount.textContent = qtd === 1 ? '1 fornecedor' : `${qtd} fornecedores`;
  }
}

/* CEP (ViaCEP) */
let cepFetchController=null;

function setCepHelp(msg='', isError=false){
  const help = document.getElementById('cep-help');
  if(!help) return;
  help.textContent = msg || '';
  help.classList.toggle('is-error', !!isError);
}

function fillAddressFields(data){
  const elLog = document.getElementById('campo-logradouro');
  const elBai = document.getElementById('campo-bairro');
  const elCid = document.getElementById('campo-cidade');
  const elUf  = document.getElementById('campo-uf');

  if(elLog) elLog.value = data?.logradouro || '';
  if(elBai) elBai.value = data?.bairro || '';
  if(elCid) elCid.value = data?.localidade || '';
  if(elUf)  elUf.value  = (data?.uf || '').toUpperCase();
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
    if(!resp.ok) throw new Error('Falha CEP');
    const data = await resp.json();

    if(data?.erro){
      setCepHelp('CEP não encontrado.', true);
      fillAddressFields(null);
      return;
    }

    fillAddressFields(data);
    setCepHelp('Endereço preenchido automaticamente.', false);
  }catch(err){
    if(String(err?.name)==='AbortError') return;
    setCepHelp('Não foi possível buscar o CEP agora.', true);
  }
}

/* Modal helpers */
function abrirModal(){
  const backdrop = document.getElementById('modal-fornecedor-backdrop');
  if(!backdrop) return;
  backdrop.hidden = false;
}

function fecharModal(){
  const backdrop = document.getElementById('modal-fornecedor-backdrop');
  if(backdrop) backdrop.hidden = true;
  fornecedorEditandoId = null;
}

function setVal(id, v){
  const el = document.getElementById(id);
  if(el) el.value = (v ?? '');
}

function getVal(id){
  return (document.getElementById(id)?.value ?? '').trim();
}

function abrirModalFornecedorNovo(){
  document.getElementById('modal-fornecedor-titulo').textContent = 'Novo fornecedor';
  fornecedorEditandoId = null;

  const proximoId = fornecedores.length ? (Math.max(...fornecedores.map(x=>Number(x.id)||0)) + 1) : 1;
  setVal('campo-data-cadastro', todayISODate());
  setVal('campo-tipo-fornecedor', 'pf');
  setVal('campo-nome-fornecedor', '');

  // sequência PDF
  setVal('campo-razao-social','');
  setVal('campo-cnpj','');
  setVal('campo-inscricao-estadual','');
  setVal('campo-inscricao-municipal','');

  setVal('campo-cep','');
  setVal('campo-logradouro','');
  setVal('campo-numero','');
  setVal('campo-bairro','');
  setVal('campo-cidade','');
  setVal('campo-uf','');
  setCepHelp('');

  setVal('campo-pessoa-contato','');
  setVal('campo-telefone-pabx','');
  setVal('campo-telefone','');
  setVal('campo-whatsapp-contato','');

  setVal('campo-home-page','');
  setVal('campo-email-principal','');
  setVal('campo-redes-sociais','');

  setVal('campo-codigo-fornecedor', `FOR-${String(proximoId).padStart(4,'0')}`);
  setVal('campo-tipo-categoria','');

  setVal('campo-contato-representante','');
  setVal('campo-rep-telefone-whatsapp','');
  setVal('campo-rep-telefone-ramal','');

  setVal('campo-limite-creditos','');
  setVal('campo-opcao-transportadoras','');

  setVal('campo-linha-produtos','');
  setVal('campo-contato-rma','');
  setVal('campo-informacoes-rma','');

  abrirModal();
}

function abrirModalFornecedorEditar(full){
  document.getElementById('modal-fornecedor-titulo').textContent = 'Editar fornecedor';
  fornecedorEditandoId = full.id;

  setVal('campo-data-cadastro', ymdFromBackendDateTime(full.data_cadastro) || todayISODate());
  setVal('campo-tipo-fornecedor', full.tipo || 'pf');
  setVal('campo-nome-fornecedor', full.nome || '');

  setVal('campo-razao-social', full.razao_social || '');
  setVal('campo-cnpj', full.cnpj || '');
  setVal('campo-inscricao-estadual', full.inscricao_estadual || '');
  setVal('campo-inscricao-municipal', full.inscricao_municipal || '');

  setVal('campo-cep', full.cep || '');
  setVal('campo-logradouro', full.endereco_logradouro || '');
  setVal('campo-numero', full.endereco_numero || '');
  setVal('campo-bairro', full.endereco_bairro || '');
  setVal('campo-cidade', full.cidade || '');
  setVal('campo-uf', (full.uf || '').toUpperCase());
  setCepHelp('');

  setVal('campo-pessoa-contato', full.pessoa_contato || '');
  setVal('campo-telefone-pabx', full.telefone_pabx || '');
  setVal('campo-telefone', full.telefone || '');
  setVal('campo-whatsapp-contato', full.whatsapp || '');

  setVal('campo-home-page', full.home_page || '');
  setVal('campo-email-principal', full.email_principal || '');

  // redes sociais: se vier dict, tenta texto, senão stringify
  let redesTxt = '';
  if(full.redes_sociais){
    if(typeof full.redes_sociais === 'object' && full.redes_sociais.texto) redesTxt = String(full.redes_sociais.texto);
    else redesTxt = JSON.stringify(full.redes_sociais);
  }
  setVal('campo-redes-sociais', redesTxt);

  setVal('campo-codigo-fornecedor', full.codigo || '');
  setVal('campo-tipo-categoria', full.tipo_categoria || '');

  setVal('campo-contato-representante', full.contato_representante_comercial || '');
  setVal('campo-rep-telefone-whatsapp', full.representante_telefone_whatsapp || '');
  setVal('campo-rep-telefone-ramal', full.representante_telefone_ramal || '');

  setVal('campo-limite-creditos', (full.limite_creditos ?? ''));

  setVal('campo-opcao-transportadoras', full.opcao_transportadoras_fretes || '');

  setVal('campo-linha-produtos', full.linha_produtos || '');
  setVal('campo-contato-rma', full.contato_rma || '');
  setVal('campo-informacoes-rma', full.informacoes_rma || '');

  abrirModal();
}

function buildPayload(){
  // redes sociais (PDF é campo “livre”)
  const redesTexto = getVal('campo-redes-sociais');
  const redes = redesTexto ? { texto: redesTexto } : null;

  const limite = getVal('campo-limite-creditos');
  const limiteNorm = limite ? limite.replace(',', '.') : '';

  return {
    // sequência do PDF
    data_cadastro: getVal('campo-data-cadastro') || null,
    tipo: getVal('campo-tipo-fornecedor') || 'pf',
    nome: getVal('campo-nome-fornecedor'),

    razao_social: getVal('campo-razao-social'),
    cnpj: getVal('campo-cnpj'),
    inscricao_estadual: getVal('campo-inscricao-estadual'),
    inscricao_municipal: getVal('campo-inscricao-municipal'),

    cep: getVal('campo-cep'),
    endereco_logradouro: getVal('campo-logradouro'),
    endereco_numero: getVal('campo-numero'),
    endereco_bairro: getVal('campo-bairro'),
    cidade: getVal('campo-cidade'),
    uf: getVal('campo-uf'),

    pessoa_contato: getVal('campo-pessoa-contato'),
    telefone_pabx: getVal('campo-telefone-pabx'),
    telefone: getVal('campo-telefone'),
    whatsapp: getVal('campo-whatsapp-contato'),

    home_page: getVal('campo-home-page'),
    email_principal: getVal('campo-email-principal'),
    redes_sociais: redes,

    codigo: getVal('campo-codigo-fornecedor'),

    tipo_categoria: getVal('campo-tipo-categoria'),

    contato_representante_comercial: getVal('campo-contato-representante'),
    representante_telefone_whatsapp: getVal('campo-rep-telefone-whatsapp'),
    representante_telefone_ramal: getVal('campo-rep-telefone-ramal'),

    limite_creditos: limiteNorm ? limiteNorm : null,

    opcao_transportadoras_fretes: getVal('campo-opcao-transportadoras'),

    linha_produtos: getVal('campo-linha-produtos'),
    contato_rma: getVal('campo-contato-rma'),
    informacoes_rma: getVal('campo-informacoes-rma'),
  };
}

async function salvarFornecedor(){
  const payload = buildPayload();

  if(!payload.nome){
    alert('Preencha o nome do fornecedor.');
    return;
  }

  try{
    await salvarFornecedorNoServidor(payload, fornecedorEditandoId);
    await carregarFornecedores();
    fecharModal();
  }catch(err){
    console.error(err);
    alert('Erro ao salvar fornecedor.');
  }
}

/* INIT */
document.addEventListener('DOMContentLoaded', async ()=>{
  const backdrop = document.getElementById('modal-fornecedor-backdrop');
  if(backdrop) backdrop.hidden = true;

  try{ await carregarFornecedores(); }
  catch(e){ console.error(e); }

  document.getElementById('busca-fornecedores')?.addEventListener('input', renderTabelaFornecedores);
  document.getElementById('filtro-tipo-fornecedor')?.addEventListener('change', renderTabelaFornecedores);

  document.getElementById('btn-novo-fornecedor')?.addEventListener('click', abrirModalFornecedorNovo);

  document.getElementById('btn-fechar-modal-fornecedor')?.addEventListener('click', fecharModal);
  document.getElementById('btn-cancelar-fornecedor')?.addEventListener('click', fecharModal);
  document.getElementById('btn-salvar-fornecedor')?.addEventListener('click', salvarFornecedor);

  backdrop?.addEventListener('click', (e)=>{ if(e.target===backdrop) fecharModal(); });
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') fecharModal(); });

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

  document.getElementById('tbody-fornecedores')?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.orca-icon-btn');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'editar'){
      try{
        const full = await obterFornecedorNoServidor(id);
        abrirModalFornecedorEditar(full);
      }catch(err){
        console.error(err);
        alert('Não foi possível abrir para editar.');
      }
      return;
    }

    if(action === 'excluir'){
      if(confirm('Deseja realmente excluir este fornecedor?')){
        excluirFornecedorNoServidor(id)
          .then(()=>carregarFornecedores())
          .catch(err=>{
            console.error(err);
            alert('Erro ao excluir fornecedor.');
          });
      }
    }
  });
});
