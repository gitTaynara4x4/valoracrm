// /frontend/js/pages/clientes.js
// V1.0 — Clientes
// - CRUD via /api/clientes
// - Export JSON / CSV
// - Import JSON / CSV / XLSX
// - XLSX aceita com ou sem cabeçalho (por posição)
// - ViaCEP auto preenchimento
// - Confirm modal + Toast

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
 * TOAST
 * =======================*/
function toast(msg, { error=false, ms=2600 } = {}){
  const el = document.getElementById('orca-toast');
  if(!el) return;

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
 * EXPORTAR / IMPORTAR
 * =======================*/
function downloadFile(filename, content, mime='application/octet-stream'){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

function pickClientesForExport(){
  return (clientes || []).map(c => ({
    id: c.id ?? null,
    codigo: c.codigo ?? '',
    tipo: c.tipo ?? '',
    nome: c.nome ?? '',
    whatsapp: c.whatsapp ?? '',
    data_cadastro: c.data_cadastro ?? null,

    pessoa_contato: c.pessoa_contato ?? '',
    email_principal: c.email_principal ?? '',

    cep: c.cep ?? '',
    endereco_logradouro: c.endereco_logradouro ?? '',
    endereco_numero: c.endereco_numero ?? '',
    endereco_bairro: c.endereco_bairro ?? '',
    cidade: c.cidade ?? '',
    uf: c.uf ?? '',

    tipo_imovel: c.tipo_imovel ?? '',
    onde_conheceu: c.onde_conheceu ?? '',
    onde_conheceu_outro: c.onde_conheceu_outro ?? '',

    whatsapp_principal: c.whatsapp_principal ?? '',
    end_pais: c.end_pais ?? 'BR',

    razao_social: c.razao_social ?? '',
    cnpj: c.cnpj ?? '',
    inscricao_estadual: c.inscricao_estadual ?? '',
    inscricao_municipal: c.inscricao_municipal ?? '',
    responsavel_contratante: c.responsavel_contratante ?? '',
    cpf_responsavel_administrador: c.cpf_responsavel_administrador ?? '',

    rg: c.rg ?? '',
    data_nascimento: c.data_nascimento ?? null,
    estado_civil: c.estado_civil ?? '',
    profissao: c.profissao ?? '',

    cep_cobranca: c.cep_cobranca ?? '',
    home_page: c.home_page ?? '',

    redes_sociais: c.redes_sociais ?? null
  }));
}

function exportarClientesJSON(){
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const payload = {
    exported_at: dt.toISOString(),
    total: (clientes || []).length,
    items: pickClientesForExport()
  };
  const content = JSON.stringify(payload, null, 2);
  downloadFile(`clientes_${stamp}.json`, content, 'application/json;charset=utf-8');
  toast('Exportado JSON.', { ms: 1800 });
}

function csvEscape(v){
  const s = String(v ?? '');
  const must = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return must ? `"${out}"` : out;
}

function clientesToCSV(items){
  const cols = [
    'codigo','tipo','nome','whatsapp','cidade','uf','cep',
    'endereco_logradouro','endereco_numero','endereco_bairro',
    'data_cadastro','email_principal','pessoa_contato',
    'tipo_imovel','onde_conheceu','onde_conheceu_outro',
    'whatsapp_principal','end_pais',
    'razao_social','cnpj','inscricao_estadual','inscricao_municipal',
    'responsavel_contratante','cpf_responsavel_administrador',
    'rg','data_nascimento','estado_civil','profissao',
    'cep_cobranca','home_page',
    'redes_sociais.instagram','redes_sociais.facebook','redes_sociais.linkedin'
  ];

  const header = cols.join(';');
  const lines = [header];

  (items || []).forEach(c=>{
    const redes = c.redes_sociais || {};
    const row = cols.map(k=>{
      if(k.startsWith('redes_sociais.')){
        const key = k.split('.')[1];
        return csvEscape(redes?.[key] || '');
      }
      return csvEscape(c?.[k] ?? '');
    }).join(';');
    lines.push(row);
  });

  return '\ufeff' + lines.join('\n'); // BOM pro Excel
}

function exportarClientesCSV(){
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const csv = clientesToCSV(pickClientesForExport());
  downloadFile(`clientes_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  toast('Exportado CSV (Excel).', { ms: 1800 });
}

function readFileAsText(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(String(fr.result || ''));
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsText(file);
  });
}

/* ✅ XLSX */
function readFileAsArrayBuffer(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsArrayBuffer(file);
  });
}

/**
 * ✅ parseXLSX "inteligente"
 * - aceita XLSX com cabeçalho (linha 1 com nomes tipo "codigo", "nome"...)
 * - aceita XLSX SEM cabeçalho (linha 1 já é dado) => mapeia por POSIÇÃO
 */
function parseXLSX(arrayBuffer){
  if(typeof XLSX === 'undefined'){
    throw new Error('Biblioteca XLSX não carregou (cdn).');
  }

  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  for(const sheetName of wb.SheetNames){
    const ws = wb.Sheets[sheetName];

    // pega como "array de arrays" (não depende de cabeçalho)
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const rows = (aoa || []).filter(r =>
      Array.isArray(r) && r.some(v => String(v ?? '').trim() !== '')
    );

    if(!rows.length) continue;

    // detecta se a primeira linha parece cabeçalho
    const first = rows[0].map(v => String(v ?? '').trim().toLowerCase());
    const looksHeader =
      first.includes('codigo') ||
      first.includes('nome') ||
      first.includes('tipo') ||
      first.includes('whatsapp') ||
      first.includes('cidade') ||
      first.includes('uf');

    // ✅ se tiver cabeçalho: transforma em objetos com chaves
    if(looksHeader){
      const headers = rows[0].map(v => String(v ?? '').trim());
      return rows.slice(1).map(r=>{
        const obj = {};
        headers.forEach((h, i)=> obj[h] = r[i] ?? '');
        return obj;
      }).filter(obj => Object.values(obj).some(v => String(v ?? '').trim() !== ''));
    }

    // ✅ se NÃO tiver cabeçalho: importa por posição (A, B, C...)
    // AJUSTE A ORDEM conforme sua planilha
    const COLS = [
      'codigo',                // A
      'tipo',                  // B
      'nome',                  // C
      'whatsapp',              // D
      'cidade',                // E
      'uf',                    // F
      'cep',                   // G
      'endereco_logradouro',   // H
      'endereco_numero',       // I
      'endereco_bairro',       // J
      'data_cadastro',         // K
      'email_principal',       // L (opcional)
      'pessoa_contato',        // M (opcional)
    ];

    return rows.map(r=>{
      const obj = {};
      COLS.forEach((k, i)=> obj[k] = r[i] ?? '');
      return obj;
    }).filter(obj => String(obj.nome || obj.codigo || '').trim() !== '');
  }

  return [];
}

function detectCSVDelimiter(firstLine){
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

/**
 * Parser CSV simples (aceita aspas "...") - suficiente pra Excel comum
 */
function parseCSV(text){
  const raw = String(text || '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = raw.split('\n').filter(l => l.trim().length);
  if(!lines.length) return [];

  const delim = detectCSVDelimiter(lines[0]);

  function parseLine(line){
    const out = [];
    let cur = '';
    let inQ = false;

    for(let i=0;i<line.length;i++){
      const ch = line[i];

      if(ch === '"'){
        const next = line[i+1];
        if(inQ && next === '"'){ // escape ""
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
        continue;
      }

      if(!inQ && ch === delim){
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    out.push(cur);
    return out.map(s => String(s ?? '').trim());
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
  const out = [];

  for(let i=1;i<lines.length;i++){
    const parts = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx)=>{ obj[h] = parts[idx] ?? ''; });
    out.push(obj);
  }

  return out;
}

function normalizeTipoImport(v){
  const s = String(v||'').trim().toLowerCase();
  if(s === 'pf' || s === 'física' || s === 'fisica') return 'pf';
  if(s === 'pj' || s === 'jurídica' || s === 'juridica') return 'pj';
  return '';
}

function mapImportToPayload(obj){
  const redes = {
    instagram: obj['redes_sociais.instagram'] || obj.instagram || '',
    facebook: obj['redes_sociais.facebook'] || obj.facebook || '',
    linkedin: obj['redes_sociais.linkedin'] || obj.linkedin || '',
  };
  const redesFinal = {};
  if(redes.instagram) redesFinal.instagram = redes.instagram;
  if(redes.facebook) redesFinal.facebook = redes.facebook;
  if(redes.linkedin) redesFinal.linkedin = redes.linkedin;

  const tipo = normalizeTipoImport(obj.tipo) || 'pf';

  return {
    codigo: String(obj.codigo || '').trim(),
    tipo,
    nome: String(obj.nome || '').trim(),
    whatsapp: String(obj.whatsapp || '').trim(),
    data_cadastro: String(obj.data_cadastro || '').trim() || null,

    pessoa_contato: String(obj.pessoa_contato || '').trim(),
    email_principal: String(obj.email_principal || '').trim(),

    cep: String(obj.cep || '').trim(),
    endereco_logradouro: String(obj.endereco_logradouro || '').trim(),
    endereco_numero: String(obj.endereco_numero || '').trim(),
    endereco_bairro: String(obj.endereco_bairro || '').trim(),
    cidade: String(obj.cidade || '').trim(),
    uf: String(obj.uf || '').trim(),

    tipo_imovel: String(obj.tipo_imovel || '').trim(),
    onde_conheceu: String(obj.onde_conheceu || '').trim(),
    onde_conheceu_outro: String(obj.onde_conheceu_outro || '').trim(),

    whatsapp_principal: String(obj.whatsapp_principal || '').trim(),
    end_pais: String(obj.end_pais || '').trim() || 'BR',

    razao_social: String(obj.razao_social || '').trim(),
    cnpj: String(obj.cnpj || '').trim(),
    inscricao_estadual: String(obj.inscricao_estadual || '').trim(),
    inscricao_municipal: String(obj.inscricao_municipal || '').trim(),
    responsavel_contratante: String(obj.responsavel_contratante || '').trim(),
    cpf_responsavel_administrador: String(obj.cpf_responsavel_administrador || '').trim(),

    rg: String(obj.rg || '').trim(),
    data_nascimento: String(obj.data_nascimento || '').trim() || null,
    estado_civil: String(obj.estado_civil || '').trim(),
    profissao: String(obj.profissao || '').trim(),

    cep_cobranca: String(obj.cep_cobranca || '').trim(),
    home_page: String(obj.home_page || '').trim(),
    redes_sociais: Object.keys(redesFinal).length ? redesFinal : null,
  };
}

function findExistingClienteIdByCodigoOrWhats(payload){
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  const wpp = onlyDigits(payload?.whatsapp || '');
  let found = null;

  if(codigo){
    found = (clientes || []).find(c => String(c.codigo || '').trim().toLowerCase() === codigo);
    if(found?.id) return found.id;
  }

  if(wpp){
    found = (clientes || []).find(c => onlyDigits(c.whatsapp || '') === wpp);
    if(found?.id) return found.id;
  }

  return null;
}

async function importarClientesFromItems(items){
  if(!Array.isArray(items) || !items.length){
    toast('Arquivo vazio ou inválido.', { error:true, ms: 4000 });
    return;
  }

  const ok = await confirmDialog({
    title: 'Importar clientes',
    message: `Importar ${items.length} cliente(s)? (vai CRIAR ou ATUALIZAR pelo Código/WhatsApp)`,
    confirmText: 'Importar',
    cancelText: 'Cancelar',
    danger: true,
  });

  if(!ok) return;

  toast('Importando... aguarde.', { ms: 2200 });

  let okCount = 0;
  let failCount = 0;

  try{ await carregarClientes(); }catch{}

  for(const raw of items){
    try{
      const payload = mapImportToPayload(raw);
      if(!payload.nome){
        failCount++;
        continue;
      }

      const existingId = findExistingClienteIdByCodigoOrWhats(payload);
      await salvarClienteNoServidor(payload, existingId);
      okCount++;
    }catch(err){
      console.error('[Clientes] import item erro:', err);
      failCount++;
    }
  }

  try{ await carregarClientes(); }catch{}

  if(failCount === 0){
    toast(`Importação concluída: ${okCount} OK.`, { ms: 2200 });
  } else {
    toast(`Importado: ${okCount} OK • ${failCount} falharam`, { error:true, ms: 5200 });
  }
}

async function importarClientesArquivo(file){
  if(!file){
    toast('Selecione um arquivo para importar.', { error:true });
    return;
  }

  const name = String(file.name || '').toLowerCase();

  try{
    // JSON
    if(name.endsWith('.json')){
      const text = await readFileAsText(file);
      const data = JSON.parse(text || '{}');
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      await importarClientesFromItems(items);
      return;
    }

    // CSV
    if(name.endsWith('.csv') || name.endsWith('.txt')){
      const text = await readFileAsText(file);
      const rows = parseCSV(text);
      await importarClientesFromItems(rows);
      return;
    }

    // XLSX
    if(name.endsWith('.xlsx')){
      const buf = await readFileAsArrayBuffer(file);
      const rows = parseXLSX(buf);
      await importarClientesFromItems(rows);
      return;
    }

    toast('Formato inválido. Use .JSON, .CSV ou .XLSX', { error:true, ms: 4200 });
  }catch(err){
    console.error('[Clientes] importar arquivo erro:', err);
    toast('Erro ao importar arquivo.', { error:true, ms: 5000 });
  }
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

  // ✅ CORRIGIDO: não usar new Date() (timezone pode voltar 1 dia)
  const iso = String(clienteFull.data_cadastro || '');
  setVal('campo-data-cadastro', iso ? iso.slice(0,10) : todayISODate());

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
      if(confirmBackdrop && !confirmBackdrop.hidden) closeConfirm(false);
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

  // ✅ EXPORT / IMPORT binds
  document.getElementById('btn-exportar-clientes-json')?.addEventListener('click', exportarClientesJSON);
  document.getElementById('btn-exportar-clientes-csv')?.addEventListener('click', exportarClientesCSV);

  const btnImport = document.getElementById('btn-importar-clientes');
  const inputImport = document.getElementById('input-importar-clientes');

  btnImport?.addEventListener('click', ()=>{
    if(inputImport) inputImport.click();
    else toast('Faltou o input file: #input-importar-clientes', { error:true, ms: 4200 });
  });

  inputImport?.addEventListener('change', async ()=>{
    const file = inputImport.files && inputImport.files[0] ? inputImport.files[0] : null;
    await importarClientesArquivo(file);
    inputImport.value = '';
  });

  // ações da tabela
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
