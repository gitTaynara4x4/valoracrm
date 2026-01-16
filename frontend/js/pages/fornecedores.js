// /frontend/js/pages/fornecedores.js

let fornecedores = [];
let fornecedorEditandoId = null;

function onlyDigits(s){ return String(s||'').replace(/\D+/g,''); }

/* =========================
   Exportar / Importar (JSON)
   ========================= */
function downloadBlob(filename, blob){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 500);
}

function toISODateTime(){
  try{ return new Date().toISOString(); }catch{ return ''; }
}

async function exportarFornecedores(){
  try{
    // garante lista atualizada
    await carregarFornecedores();

    const payload = {
      version: 1,
      exported_at: toISODateTime(),
      type: 'fornecedores',
      items: fornecedores || []
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const name = `orcapro_fornecedores_${(new Date()).toISOString().slice(0,10)}.json`;
    downloadBlob(name, blob);
  }catch(err){
    console.error(err);
    await orcaAlert(err?.message || 'Erro ao exportar fornecedores.');
  }
}

function normalizeImportItems(parsed){
  if(Array.isArray(parsed)) return parsed;
  if(Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function mapImportFornecedorToPayload(f){
  // aceita tanto formato do backend quanto “qualquer json”
  // e monta payload compatível com sua API atual
  const tipo = String(f?.tipo || f?.tipo_fornecedor || '').trim() || 'pf';

  return {
    data_cadastro: (String(f?.data_cadastro || '').slice(0,10) || null),

    tipo,
    nome: String(f?.nome || f?.nome_identificacao || '').trim(),

    razao_social: f?.razao_social ?? '',
    cnpj: f?.cnpj ?? '',
    inscricao_estadual: f?.inscricao_estadual ?? '',
    inscricao_municipal: f?.inscricao_municipal ?? '',

    cep: f?.cep ?? f?.end_cep ?? '',
    endereco_logradouro: f?.endereco_logradouro ?? f?.end_rua ?? '',
    endereco_numero: f?.endereco_numero ?? f?.end_numero ?? '',
    endereco_bairro: f?.endereco_bairro ?? f?.end_bairro ?? '',
    cidade: f?.cidade ?? f?.end_cidade ?? '',
    uf: f?.uf ?? f?.end_estado ?? '',

    pessoa_contato: f?.pessoa_contato ?? '',

    telefone_pabx: f?.telefone_pabx ?? '',
    telefone: f?.telefone ?? '',
    whatsapp: f?.whatsapp ?? f?.whatsapp_contato ?? '',

    home_page: f?.home_page ?? '',
    email_principal: f?.email_principal ?? '',
    redes_sociais: f?.redes_sociais ?? null,

    codigo: f?.codigo ?? f?.codigo_cadastro_fornecedor ?? '',

    tipo_categoria: f?.tipo_categoria ?? '',

    contato_representante_comercial: f?.contato_representante_comercial ?? '',
    representante_telefone_whatsapp: f?.representante_telefone_whatsapp ?? '',
    representante_telefone_ramal: f?.representante_telefone_ramal ?? '',

    limite_creditos: (f?.limite_creditos ?? null),
    opcao_transportadoras_fretes: f?.opcao_transportadoras_fretes ?? '',

    linha_produtos_ids: Array.isArray(f?.linha_produtos_ids) ? f.linha_produtos_ids : undefined,

    linha_produtos: f?.linha_produtos ?? '',
    contato_rma: f?.contato_rma ?? '',
    informacoes_rma: f?.informacoes_rma ?? '',
  };
}

async function importarFornecedoresFromFile(file){
  if(!file){
    await orcaAlert('Selecione um arquivo JSON para importar.');
    return;
  }

  try{
    const txt = await file.text();
    const parsed = JSON.parse(txt);
    const items = normalizeImportItems(parsed);

    if(!items.length){
      await orcaAlert('Arquivo vazio ou inválido (sem itens).');
      return;
    }

    const ok = await orcaConfirm(`Importar ${items.length} fornecedor(es)?`, {
      title: 'Importar fornecedores',
      okText: 'Importar',
      cancelText: 'Cancelar'
    });

    if(!ok) return;

    let okCount = 0;
    let failCount = 0;

    // IMPORTA UM POR UM (POST)
    for(const f of items){
      const payload = mapImportFornecedorToPayload(f);

      // validação mínima
      if(!payload.nome){
        failCount++;
        continue;
      }
      if(!payload.tipo) payload.tipo = 'pf';

      try{
        // tenta salvar com linha_produtos_ids; se o backend não aceitar, cai no fallback (igual salvarFornecedor)
        await salvarFornecedorNoServidor(payload, null);
        okCount++;
      }catch(err){
        // fallback: remove linha_produtos_ids (se der erro)
        try{
          const msg = String(err?.message || '').toLowerCase();
          const pareceCampoDesconhecido =
            msg.includes('linha_produtos_ids') &&
            (msg.includes('extra') || msg.includes('not permitted') || msg.includes('unknown') || msg.includes('field') || msg.includes('invalid'));

          if(pareceCampoDesconhecido){
            const ids = Array.isArray(payload.linha_produtos_ids) ? payload.linha_produtos_ids : [];
            const p2 = { ...payload };
            delete p2.linha_produtos_ids;
            p2.linha_produtos = (ids || []).join(',');
            await salvarFornecedorNoServidor(p2, null);
            okCount++;
          }else{
            failCount++;
          }
        }catch(_e2){
          failCount++;
        }
      }
    }

    await carregarFornecedores();

    await orcaAlert(
      `Importação finalizada.\n\n✅ Importados: ${okCount}\n❌ Falharam: ${failCount}`,
      'Importação'
    );
  }catch(err){
    console.error(err);
    await orcaAlert('JSON inválido ou arquivo corrompido.');
  }
}

/* =========================
   Linha de Produtos (checkbox) - pega TODOS produtos cadastrados
   ========================= */
const API_PRODUTOS = '/api/produtos';

const PRODUTOS_STORAGE_KEYS = [
  'orcapro_produtos_v4',
  'orcapro_produtos_v3',
  'orcapro_produtos_v2',
  'orcapro_produtos',
];

let _cacheProdutosAll = null;
let _linhaProdutosSel = new Set(); // ids selecionados

function _loadProdutosFromLocalStorage(){
  for(const key of PRODUTOS_STORAGE_KEYS){
    try{
      const raw = localStorage.getItem(key);
      if(!raw) continue;
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed)) return parsed;
      if(Array.isArray(parsed?.items)) return parsed.items;
    }catch(_e){}
  }
  return [];
}

function _normalizeProdutosResponse(data){
  if(Array.isArray(data)) return data;
  if(Array.isArray(data?.items)) return data.items;
  return [];
}

function _produtoNome(p){
  const n = String(p?.nome_produto || p?.nome_generico || '').trim();
  return n || `Produto #${p?.id ?? ''}`.trim();
}

function _produtoMeta(p){
  const parts = [];
  if(p?.modelo) parts.push(String(p.modelo));
  if(p?.fabricante) parts.push(String(p.fabricante));
  return parts.join(' — ');
}

async function _carregarProdutosAll(){
  if(_cacheProdutosAll) return _cacheProdutosAll;

  try{
    const resp = await fetch(`${API_PRODUTOS}?limit=2000&offset=0`);
    if(resp.ok){
      const data = await resp.json();
      const arr = _normalizeProdutosResponse(data);
      _cacheProdutosAll = Array.isArray(arr) ? arr : [];
      return _cacheProdutosAll;
    }
  }catch(_e){}

  _cacheProdutosAll = _loadProdutosFromLocalStorage();
  return _cacheProdutosAll;
}

function _updateCountLinhaProdutos(){
  const el = document.getElementById('count-produtos-fornecedor');
  if(el) el.textContent = String(_linhaProdutosSel.size);
}

function _renderLinhaProdutosChecklist(produtos){
  const box = document.getElementById('lista-produtos-fornecedor');
  if(!box) return;

  box.innerHTML = '';

  if(!produtos || !produtos.length){
    box.innerHTML = `<div class="orca-checklist-empty">Nenhum produto cadastrado ainda.</div>`;
    _updateCountLinhaProdutos();
    return;
  }

  const frag = document.createDocumentFragment();

  for(const p of produtos){
    const id = Number(p?.id);
    if(!Number.isFinite(id)) continue;

    const nome = _produtoNome(p);
    const meta = _produtoMeta(p);

    const label = document.createElement('label');
    label.className = 'orca-checkitem';

    label.innerHTML = `
      <input type="checkbox" value="${id}">
      <div class="orca-checktext">
        <div class="orca-prod-nome">${nome}</div>
        ${meta ? `<div class="orca-prod-meta">${meta}</div>` : ``}
      </div>
    `;

    const chk = label.querySelector('input');
    chk.checked = _linhaProdutosSel.has(id);

    chk.addEventListener('change', ()=>{
      if(chk.checked) _linhaProdutosSel.add(id);
      else _linhaProdutosSel.delete(id);
      _updateCountLinhaProdutos();
    });

    frag.appendChild(label);
  }

  box.appendChild(frag);
  _updateCountLinhaProdutos();
}

function _wireLinhaProdutosBusca(produtosAll){
  const input = document.getElementById('busca-produtos-fornecedor');
  if(!input) return;

  input.value = '';
  input.oninput = ()=>{
    const q = String(input.value || '').toLowerCase().trim();

    if(!q){
      _renderLinhaProdutosChecklist(produtosAll);
      return;
    }

    const filtrados = produtosAll.filter(p=>{
      const alvo = `${_produtoNome(p)} ${p?.modelo||''} ${p?.fabricante||''}`.toLowerCase();
      return alvo.includes(q);
    });

    _renderLinhaProdutosChecklist(filtrados);
  };
}

function _wireLinhaProdutosBotoes(produtosAll){
  const btnAll = document.getElementById('btn-selecionar-todos-produtos');
  const btnClear = document.getElementById('btn-limpar-produtos');
  const input = document.getElementById('busca-produtos-fornecedor');

  if(btnAll){
    btnAll.onclick = ()=>{
      for(const p of produtosAll){
        const id = Number(p?.id);
        if(Number.isFinite(id)) _linhaProdutosSel.add(id);
      }
      if(input) input.value = '';
      _renderLinhaProdutosChecklist(produtosAll);
    };
  }

  if(btnClear){
    btnClear.onclick = ()=>{
      _linhaProdutosSel.clear();
      if(input) input.value = '';
      _renderLinhaProdutosChecklist(produtosAll);
    };
  }
}

// chamar ao abrir modal (novo/editar)
async function initLinhaProdutosFornecedor(idsSelecionados = []){
  _linhaProdutosSel = new Set(
    (idsSelecionados || []).map(n=>Number(n)).filter(Number.isFinite)
  );

  const produtosAll = await _carregarProdutosAll();
  _renderLinhaProdutosChecklist(produtosAll);
  _wireLinhaProdutosBusca(produtosAll);
  _wireLinhaProdutosBotoes(produtosAll);
}

// pegar ids para salvar
function coletarLinhaProdutosIds(){
  return Array.from(_linhaProdutosSel);
}

/* =========================
   Categorias do fornecedor (select + adicionar)
   ========================= */
const STORAGE_KEY_CATEGORIAS = 'orcapro_fornecedor_categorias_v1';

const DEFAULT_CATEGORIAS = [
  'Fabricante',
  'Distribuidora',
  'Importadora',
  'Prestador de Serviços',
  'Serviços Públicos',
  'Profissional Autônomo',
];

function uniqStrings(arr){
  const out = [];
  const seen = new Set();
  for(const v of (arr || [])){
    const s = String(v ?? '').trim();
    if(!s) continue;
    const key = s.toLowerCase();
    if(seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function loadCategoriasCustom(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORIAS);
    if(!raw) return [];
    const parsed = JSON.parse(raw);
    if(!Array.isArray(parsed)) return [];
    return uniqStrings(parsed);
  }catch(_e){
    return [];
  }
}

function saveCategoriasCustom(list){
  try{
    localStorage.setItem(STORAGE_KEY_CATEGORIAS, JSON.stringify(uniqStrings(list)));
  }catch(_e){}
}

function addCategoriaCustom(value){
  const v = String(value ?? '').trim();
  if(!v) return;
  const list = loadCategoriasCustom();
  list.push(v);
  saveCategoriasCustom(list);
}

function getCategoriasAll(){
  return uniqStrings([...DEFAULT_CATEGORIAS, ...loadCategoriasCustom()]);
}

// monta/recarrega o select (e já seleciona um valor se quiser)
function initCategoriaSelect(selectedValue = ''){
  const sel = document.getElementById('campo-tipo-categoria');
  if(!sel) return;

  const vSel = String(selectedValue ?? '').trim();

  // se veio valor do servidor que não existe, salva como custom
  if(vSel){
    const allLower = getCategoriasAll().map(x => x.toLowerCase());
    if(!allLower.includes(vSel.toLowerCase())){
      addCategoriaCustom(vSel);
    }
  }

  const categorias = getCategoriasAll();

  sel.innerHTML = '';

  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = 'Selecione...';
  sel.appendChild(opt0);

  for(const c of categorias){
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }

  const optAdd = document.createElement('option');
  optAdd.value = '__add__';
  optAdd.textContent = '➕ Adicionar...';
  sel.appendChild(optAdd);

  sel.value = vSel || '';
}

let _categoriaPrev = '';

function rememberCategoriaPrev(){
  const sel = document.getElementById('campo-tipo-categoria');
  if(!sel) return;
  _categoriaPrev = sel.value;
}

async function handleCategoriaChange(){
  const sel = document.getElementById('campo-tipo-categoria');
  if(!sel) return;
  if(sel.value !== '__add__') return;

  const novo = await orcaPrompt('Digite a nova categoria do fornecedor:', {
    title: 'Nova categoria',
    okText: 'Adicionar',
    cancelText: 'Cancelar',
    placeholder: 'Ex: Distribuidora'
  });

  const v = String(novo ?? '').trim();

  if(!v){
    sel.value = _categoriaPrev || '';
    return;
  }

  if(v.length > 60){
    await orcaAlert('Categoria muito longa. Use até 60 caracteres.');
    sel.value = _categoriaPrev || '';
    return;
  }

  addCategoriaCustom(v);
  initCategoriaSelect(v);
}

function todayISODate(){
  const d=new Date();
  const yyyy=d.getFullYear();
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function ymdFromBackendDateTime(v){
  if(!v) return '';
  if(typeof v === 'string' && v.length >= 10) return v.slice(0,10);
  return '';
}

function formatTipo(tipo){
  if(tipo==='pf') return 'Física';
  if(tipo==='pj') return 'Jurídica';
  return '-';
}

/* =========================
   Money helpers (R$ prefix)
   ========================= */
function parseBRMoneyToDot(v){
  if(!v) return '';
  let s = String(v);
  s = s.replace(/[^\d,.\-]/g, '');
  if(s.includes(',')){
    s = s.replace(/\./g, '').replace(',', '.');
  }
  return s;
}

function formatBRMoney(v){
  if(v == null || v === '') return '';
  const n = Number(String(v).replace(',', '.'));
  if(!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setupMoneyPrefix(inputId){
  const input = document.getElementById(inputId);
  if(!input) return;

  const wrap = input.closest('.orca-input-money');
  if(!wrap) return;

  const apply = () => {
    wrap.classList.toggle('has-value', !!String(input.value || '').trim());
  };

  input.addEventListener('input', apply);
  apply();
}

/* =========================
   Dialog/Confirm/Prompt (custom)
   ========================= */
let _dialogResolve = null;
let _confirmResolve = null;
let _promptResolve = null;

function orcaAlert(message, title='Aviso'){
  const backdrop = document.getElementById('orca-dialog-backdrop');
  const body = document.getElementById('orca-dialog-body');
  const ttl = document.getElementById('orca-dialog-title');
  if(!backdrop || !body || !ttl) return Promise.resolve();

  ttl.textContent = title;
  body.textContent = String(message ?? '');

  backdrop.hidden = false;
  return new Promise((resolve)=>{
    _dialogResolve = resolve;
    setTimeout(()=>{ document.getElementById('orca-dialog-ok')?.focus(); }, 0);
  });
}

function closeOrcaAlert(){
  const backdrop = document.getElementById('orca-dialog-backdrop');
  if(backdrop) backdrop.hidden = true;
  const r = _dialogResolve;
  _dialogResolve = null;
  if(typeof r === 'function') r();
}

function orcaConfirm(message, { title='Confirmar', okText='OK', cancelText='Cancelar' } = {}){
  const backdrop = document.getElementById('orca-confirm-backdrop');
  const body = document.getElementById('orca-confirm-body');
  const ttl = document.getElementById('orca-confirm-title');
  const okBtn = document.getElementById('orca-confirm-ok');
  const cancelBtn = document.getElementById('orca-confirm-cancel');

  if(!backdrop || !body || !ttl || !okBtn || !cancelBtn) return Promise.resolve(false);

  ttl.textContent = title;
  body.textContent = String(message ?? '');
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;

  backdrop.hidden = false;

  return new Promise((resolve)=>{
    _confirmResolve = resolve;
    setTimeout(()=>{ okBtn.focus(); }, 0);
  });
}

function closeOrcaConfirm(result){
  const backdrop = document.getElementById('orca-confirm-backdrop');
  if(backdrop) backdrop.hidden = true;
  const r = _confirmResolve;
  _confirmResolve = null;
  if(typeof r === 'function') r(!!result);
}

function orcaPrompt(message, { title='Digite', okText='OK', cancelText='Cancelar', placeholder='' } = {}){
  const bd = document.createElement('div');
  bd.id = 'orca-prompt-backdrop';
  bd.className = 'orca-confirm-backdrop';

  const modal = document.createElement('div');
  modal.className = 'orca-confirm';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  modal.innerHTML = `
    <div class="orca-confirm__head">
      <h3 class="orca-confirm__title">${String(title ?? 'Digite')}</h3>
      <button class="orca-confirm__close" type="button" aria-label="Fechar">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
    <p class="orca-confirm__msg">${String(message ?? '')}</p>
    <input class="orca-confirm__input" type="text" placeholder="${String(placeholder ?? '')}">
    <div class="orca-confirm__foot">
      <button class="btn-secondary" type="button" data-act="cancel">${String(cancelText ?? 'Cancelar')}</button>
      <button class="btn-primary" type="button" data-act="ok">${String(okText ?? 'OK')}</button>
    </div>
  `;

  bd.appendChild(modal);
  document.body.appendChild(bd);
  document.body.classList.add('modal-open');

  const input = modal.querySelector('input');
  const btnOk = modal.querySelector('[data-act="ok"]');
  const btnCancel = modal.querySelector('[data-act="cancel"]');
  const btnClose = modal.querySelector('.orca-confirm__close');

  const close = (val)=>{
    document.body.classList.remove('modal-open');
    if(bd.isConnected) bd.remove();
    document.removeEventListener('keydown', onKey);
    const r = _promptResolve;
    _promptResolve = null;
    if(typeof r === 'function') r(val);
  };

  const onKey = (e)=>{
    if(e.key === 'Escape') close(null);
    if(e.key === 'Enter'){
      const v = String(input?.value ?? '').trim();
      close(v || null);
    }
  };

  document.addEventListener('keydown', onKey);

  bd.addEventListener('click', (e)=>{
    if(e.target === bd) close(null);
  });

  btnCancel?.addEventListener('click', ()=>close(null));
  btnClose?.addEventListener('click', ()=>close(null));
  btnOk?.addEventListener('click', ()=>{
    const v = String(input?.value ?? '').trim();
    close(v || null);
  });

  return new Promise((resolve)=>{
    _promptResolve = resolve;
    setTimeout(()=>{ input?.focus(); }, 0);
  });
}

/* =========================
   API
   ========================= */
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

  if(!resp.ok){
    const txt = await resp.text();
    throw new Error(txt || 'Erro ao salvar fornecedor.');
  }
  return resp.json();
}

async function excluirFornecedorNoServidor(id){
  const resp = await fetch(`/api/fornecedores/${id}`, { method:'DELETE' });
  if(!resp.ok){
    const txt = await resp.text();
    throw new Error(txt || 'Erro ao excluir fornecedor.');
  }
}

/* =========================
   Render
   ========================= */
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

/* =========================
   CEP (ViaCEP)
   ========================= */
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

/* =========================
   Modal fornecedor
   ========================= */
function abrirModal(){
  const backdrop = document.getElementById('modal-fornecedor-backdrop');
  if(!backdrop) return;
  backdrop.hidden = false;
  document.body.classList.add('modal-open');
}

function fecharModal(){
  const backdrop = document.getElementById('modal-fornecedor-backdrop');
  if(backdrop) backdrop.hidden = true;
  document.body.classList.remove('modal-open');
  fornecedorEditandoId = null;
}

function setVal(id, v){
  const el = document.getElementById(id);
  if(el) el.value = (v ?? '');
}

function getVal(id){
  return (document.getElementById(id)?.value ?? '').trim();
}

async function abrirModalFornecedorNovo(){
  document.getElementById('modal-fornecedor-titulo').textContent = 'Novo fornecedor';
  fornecedorEditandoId = null;

  const proximoId = fornecedores.length ? (Math.max(...fornecedores.map(x=>Number(x.id)||0)) + 1) : 1;
  setVal('campo-data-cadastro', todayISODate());
  setVal('campo-tipo-fornecedor', 'pf');
  setVal('campo-nome-fornecedor', '');

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

  initCategoriaSelect('');

  setVal('campo-contato-representante','');
  setVal('campo-rep-telefone-whatsapp','');
  setVal('campo-rep-telefone-ramal','');

  setVal('campo-limite-creditos','');
  document.getElementById('campo-limite-creditos')?.dispatchEvent(new Event('input', { bubbles:true }));

  setVal('campo-opcao-transportadoras','');

  setVal('campo-linha-produtos','');
  setVal('campo-contato-rma','');
  setVal('campo-informacoes-rma','');

  await initLinhaProdutosFornecedor([]);

  abrirModal();
  setTimeout(()=>{ document.getElementById('campo-nome-fornecedor')?.focus(); }, 0);
}

async function abrirModalFornecedorEditar(full){
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

  let redesTxt = '';
  if(full.redes_sociais){
    if(typeof full.redes_sociais === 'object' && full.redes_sociais.texto) redesTxt = String(full.redes_sociais.texto);
    else redesTxt = JSON.stringify(full.redes_sociais);
  }
  setVal('campo-redes-sociais', redesTxt);

  setVal('campo-codigo-fornecedor', full.codigo || '');

  initCategoriaSelect(full.tipo_categoria || '');

  setVal('campo-contato-representante', full.contato_representante_comercial || '');
  setVal('campo-rep-telefone-whatsapp', full.representante_telefone_whatsapp || '');
  setVal('campo-rep-telefone-ramal', full.representante_telefone_ramal || '');

  setVal('campo-limite-creditos', formatBRMoney(full.limite_creditos ?? ''));
  document.getElementById('campo-limite-creditos')?.dispatchEvent(new Event('input', { bubbles:true }));

  setVal('campo-opcao-transportadoras', full.opcao_transportadoras_fretes || '');

  setVal('campo-linha-produtos', full.linha_produtos || '');
  setVal('campo-contato-rma', full.contato_rma || '');
  setVal('campo-informacoes-rma', full.informacoes_rma || '');

  await initLinhaProdutosFornecedor(full.linha_produtos_ids || []);

  abrirModal();
}

function buildPayload(){
  const redesTexto = getVal('campo-redes-sociais');
  const redes = redesTexto ? { texto: redesTexto } : null;

  const limite = getVal('campo-limite-creditos');
  const limiteNorm = parseBRMoneyToDot(limite);

  return {
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

    linha_produtos_ids: coletarLinhaProdutosIds(),

    linha_produtos: getVal('campo-linha-produtos'),
    contato_rma: getVal('campo-contato-rma'),
    informacoes_rma: getVal('campo-informacoes-rma'),
  };
}

async function salvarFornecedor(){
  let payload = buildPayload();

  if(!payload.nome){
    await orcaAlert('Preencha o nome do fornecedor.');
    return;
  }

  try{
    await salvarFornecedorNoServidor(payload, fornecedorEditandoId);
    await carregarFornecedores();
    fecharModal();
  }catch(err){
    // fallback: se backend ainda não aceita linha_produtos_ids, tenta salvar sem ele
    const msg = String(err?.message || '');
    const m = msg.toLowerCase();

    const pareceCampoDesconhecido =
      m.includes('linha_produtos_ids') &&
      (m.includes('extra') || m.includes('not permitted') || m.includes('unknown') || m.includes('field') || m.includes('invalid'));

    if(pareceCampoDesconhecido){
      try{
        const ids = Array.isArray(payload.linha_produtos_ids) ? payload.linha_produtos_ids : [];
        payload = { ...payload };
        delete payload.linha_produtos_ids;

        payload.linha_produtos = (ids || []).join(',');

        await salvarFornecedorNoServidor(payload, fornecedorEditandoId);
        await carregarFornecedores();
        fecharModal();
        return;
      }catch(err2){
        console.error(err2);
        await orcaAlert(err2?.message || 'Erro ao salvar fornecedor.');
        return;
      }
    }

    console.error(err);
    await orcaAlert(msg || 'Erro ao salvar fornecedor.');
  }
}

/* =========================
   INIT
   ========================= */
document.addEventListener('DOMContentLoaded', async ()=>{
  document.getElementById('modal-fornecedor-backdrop')?.setAttribute('hidden','');
  document.getElementById('orca-dialog-backdrop')?.setAttribute('hidden','');
  document.getElementById('orca-confirm-backdrop')?.setAttribute('hidden','');

  // Export/Import
  document.getElementById('btn-exportar-fornecedores')?.addEventListener('click', exportarFornecedores);

  const inputFile = document.getElementById('input-import-file');
  document.getElementById('btn-importar-fornecedores')?.addEventListener('click', ()=>{
    inputFile?.click();
  });

  inputFile?.addEventListener('change', async ()=>{
    const file = inputFile.files?.[0] || null;
    // limpa pra permitir selecionar o mesmo arquivo novamente
    inputFile.value = '';
    await importarFornecedoresFromFile(file);
  });

  setupMoneyPrefix('campo-limite-creditos');

  initCategoriaSelect('');
  const selCat = document.getElementById('campo-tipo-categoria');
  selCat?.addEventListener('focus', rememberCategoriaPrev);
  selCat?.addEventListener('mousedown', rememberCategoriaPrev);
  selCat?.addEventListener('change', handleCategoriaChange);

  document.getElementById('orca-dialog-ok')?.addEventListener('click', closeOrcaAlert);
  document.getElementById('orca-dialog-close')?.addEventListener('click', closeOrcaAlert);
  document.getElementById('orca-dialog-backdrop')?.addEventListener('click', (e)=>{
    if(e.target?.id === 'orca-dialog-backdrop') closeOrcaAlert();
  });

  document.getElementById('orca-confirm-ok')?.addEventListener('click', ()=>closeOrcaConfirm(true));
  document.getElementById('orca-confirm-cancel')?.addEventListener('click', ()=>closeOrcaConfirm(false));
  document.getElementById('orca-confirm-close')?.addEventListener('click', ()=>closeOrcaConfirm(false));
  document.getElementById('orca-confirm-backdrop')?.addEventListener('click', (e)=>{
    if(e.target?.id === 'orca-confirm-backdrop') closeOrcaConfirm(false);
  });

  _carregarProdutosAll().catch(()=>{});

  try{
    await carregarFornecedores();
  }catch(e){
    console.error(e);
    await orcaAlert(e?.message || 'Erro ao carregar fornecedores.');
  }

  document.getElementById('busca-fornecedores')?.addEventListener('input', renderTabelaFornecedores);
  document.getElementById('filtro-tipo-fornecedor')?.addEventListener('change', renderTabelaFornecedores);

  document.getElementById('btn-novo-fornecedor')?.addEventListener('click', abrirModalFornecedorNovo);

  document.getElementById('btn-fechar-modal-fornecedor')?.addEventListener('click', fecharModal);
  document.getElementById('btn-cancelar-fornecedor')?.addEventListener('click', fecharModal);
  document.getElementById('btn-salvar-fornecedor')?.addEventListener('click', salvarFornecedor);

  const modalBackdrop = document.getElementById('modal-fornecedor-backdrop');
  modalBackdrop?.addEventListener('click', (e)=>{ if(e.target===modalBackdrop) fecharModal(); });

  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return;

    const confirmEl = document.getElementById('orca-confirm-backdrop');
    const confirmOpen = confirmEl && !confirmEl.hidden;
    if(confirmOpen){ closeOrcaConfirm(false); return; }

    const dialogEl = document.getElementById('orca-dialog-backdrop');
    const dialogOpen = dialogEl && !dialogEl.hidden;
    if(dialogOpen){ closeOrcaAlert(); return; }

    const promptEl = document.getElementById('orca-prompt-backdrop');
    if(promptEl){
      const r = _promptResolve;
      _promptResolve = null;
      document.body.classList.remove('modal-open');
      promptEl.remove();
      if(typeof r === 'function') r(null);
      return;
    }

    const modalOpen = modalBackdrop && !modalBackdrop.hidden;
    if(modalOpen) fecharModal();
  });

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
        await abrirModalFornecedorEditar(full);
      }catch(err){
        console.error(err);
        await orcaAlert(err?.message || 'Não foi possível abrir para editar.');
      }
      return;
    }

    if(action === 'excluir'){
      const ok = await orcaConfirm('Deseja realmente excluir este fornecedor?', {
        title: 'Confirmar',
        okText: 'OK',
        cancelText: 'Cancelar'
      });

      if(ok){
        try{
          await excluirFornecedorNoServidor(id);
          await carregarFornecedores();
        }catch(err){
          console.error(err);
          await orcaAlert(err?.message || 'Erro ao excluir fornecedor.');
        }
      }
    }
  });
});
