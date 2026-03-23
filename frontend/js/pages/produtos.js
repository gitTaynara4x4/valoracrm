let produtos = [];
let camposProdutos = [];
let produtoEditandoId = null;
let campoEditandoId = null;

const API_PRODUTOS = '/api/produtos';
const API_CAMPOS = '/api/produtos/campos';

function slugify(value){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function escapeHtml(v){
  return String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTipoCampo(tipo){
  const map = {
    texto: 'Texto curto',
    textarea: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    select: 'Lista de opções',
    checkbox: 'Caixa de seleção',
  };
  return map[tipo] || tipo || '-';
}

function toast(msg, { error=false, ms=2600 } = {}){
  const el = document.getElementById('valora-toast');
  if(!el) return;
  el.textContent = msg || '';
  if(error) {
      el.classList.add('is-error');
  } else {
      el.classList.remove('is-error');
  }
  el.classList.add('show');
  
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.classList.remove('show'); }, ms);
}

let _confirmResolver = null;

function confirmDialog({
  title='Confirmar',
  message='Tem certeza?',
  confirmText='OK',
  cancelText='Cancelar',
  danger=false,
} = {}){
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  const t = document.getElementById('Valora-confirm-title');
  const m = document.getElementById('Valora-confirm-message');
  const btnOk = document.getElementById('Valora-confirm-ok');
  const btnCancel = document.getElementById('Valora-confirm-cancel');

  if(!backdrop || !btnOk || !btnCancel) return Promise.resolve(false);

  t.textContent = title || 'Confirmar';
  m.textContent = message || 'Tem certeza?';
  btnOk.textContent = confirmText || 'OK';
  btnCancel.textContent = cancelText || 'Cancelar';

  if(danger){
      btnOk.style.background = '#ef4444';
      btnOk.style.borderColor = '#ef4444';
  } else {
      btnOk.style.background = '';
      btnOk.style.borderColor = '';
  }

  backdrop.classList.add('show');

  return new Promise((resolve)=>{
    _confirmResolver = resolve;
    setTimeout(()=>{ try{ btnCancel.focus(); }catch{} }, 0);
  });
}

function closeConfirm(result=false){
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  if(backdrop) backdrop.classList.remove('show');

  if(typeof _confirmResolver === 'function'){
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

async function apiJson(url, options = {}){
  const resp = await fetch(url, options);
  if(!resp.ok){
    const txt = await resp.text();
    throw new Error(txt || 'Erro na requisição.');
  }
  if(resp.status === 204) return null;
  return resp.json();
}

async function carregarProdutos(){
  const data = await apiJson(API_PRODUTOS);
  produtos = Array.isArray(data) ? data : [];
  renderTabelaProdutos();
}

async function obterProdutoNoServidor(id){
  return apiJson(`${API_PRODUTOS}/${id}`);
}

async function salvarProdutoNoServidor(payload, editandoId){
  const url = editandoId == null ? API_PRODUTOS : `${API_PRODUTOS}/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  return apiJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function excluirProdutoNoServidor(id){
  return apiJson(`${API_PRODUTOS}/${id}`, { method:'DELETE' });
}

async function carregarCamposProdutos(){
  const data = await apiJson(`${API_CAMPOS}/lista`);
  camposProdutos = Array.isArray(data) ? data : [];
  camposProdutos.sort((a, b) => (Number(a.ordem || 0) - Number(b.ordem || 0)) || String(a.nome || '').localeCompare(String(b.nome || '')));
  renderListaCamposProdutos();
}

async function obterCampoProduto(id){
  return apiJson(`${API_CAMPOS}/${id}`);
}

async function salvarCampoProduto(payload, editandoId){
  const url = editandoId == null ? API_CAMPOS : `${API_CAMPOS}/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  return apiJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function excluirCampoProduto(id){
  return apiJson(`${API_CAMPOS}/${id}`, { method:'DELETE' });
}

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

function normalizeCustomFieldsForExport(cf){
  return cf && typeof cf === 'object' ? cf : {};
}

function pickProdutosForExport(){
  return (produtos || []).map(p => ({
    id: p.id ?? null,
    codigo: p.codigo ?? '',
    nome: p.nome ?? '',
    descricao: p.descricao ?? '',
    categoria: p.categoria ?? '',
    unidade: p.unidade ?? '',
    preco_venda: p.preco_venda ?? '',
    custo: p.custo ?? '',
    estoque_atual: p.estoque_atual ?? '',
    ativo: p.ativo ?? true,
    custom_fields: normalizeCustomFieldsForExport(p.custom_fields),
  }));
}

function exportarProdutosJSON(){
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const payload = {
    exported_at: dt.toISOString(),
    total: (produtos || []).length,
    items: pickProdutosForExport(),
  };

  downloadFile(`produtos_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('Exportado JSON.', { ms: 1800 });
}

function csvEscape(v){
  const s = String(v ?? '');
  const must = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return must ? `"${out}"` : out;
}

function produtosToCSV(items){
  const baseCols = ['codigo', 'nome', 'descricao', 'categoria', 'unidade', 'preco_venda', 'custo', 'estoque_atual', 'ativo'];
  const customCols = camposProdutos.map(c => c.slug);
  const cols = [...baseCols, ...customCols];

  const lines = [cols.join(';')];

  (items || []).forEach(p=>{
    const custom = normalizeCustomFieldsForExport(p.custom_fields);
    lines.push(cols.map(k => {
      if (baseCols.includes(k)) return csvEscape(p?.[k] ?? '');
      return csvEscape(custom?.[k] ?? '');
    }).join(';'));
  });

  return '\ufeff' + lines.join('\n');
}

function exportarProdutosCSV(){
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const csv = produtosToCSV(pickProdutosForExport());
  downloadFile(`produtos_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
  toast('Exportado CSV.', { ms: 1800 });
}

function readFileAsText(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(String(fr.result || ''));
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsText(file);
  });
}

function readFileAsArrayBuffer(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsArrayBuffer(file);
  });
}

function detectCSVDelimiter(firstLine){
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  return semi >= comma ? ';' : ',';
}

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
        if(inQ && next === '"'){
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

function parseXLSX(arrayBuffer){
  if(typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregou.');
  const wb = XLSX.read(arrayBuffer, { type:'array' });

  for(const sheetName of wb.SheetNames){
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    const rows = (aoa || []).filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== ''));

    if(!rows.length) continue;

    const first = rows[0].map(v => String(v ?? '').trim().toLowerCase());
    const looksHeader = first.includes('codigo') || first.includes('nome') || first.includes('categoria');

    if(looksHeader){
      const headers = rows[0].map(v => String(v ?? '').trim());
      return rows.slice(1).map(r=>{
        const obj = {};
        headers.forEach((h, i)=> obj[h] = r[i] ?? '');
        return obj;
      }).filter(obj => Object.values(obj).some(v => String(v ?? '').trim() !== ''));
    }

    const cols = ['codigo', 'nome', 'descricao', 'categoria', 'unidade', 'preco_venda', 'custo', 'estoque_atual'];
    return rows.map(r=>{
      const obj = {};
      cols.forEach((k, i)=> obj[k] = r[i] ?? '');
      return obj;
    }).filter(obj => String(obj.nome || obj.codigo || '').trim() !== '');
  }
  return [];
}

function mapImportToPayload(obj){
  const base = {
    codigo: String(obj.codigo || '').trim(),
    nome: String(obj.nome || '').trim(),
    descricao: String(obj.descricao || '').trim(),
    categoria: String(obj.categoria || '').trim(),
    unidade: String(obj.unidade || '').trim(),
    preco_venda: String(obj.preco_venda || '').trim(),
    custo: String(obj.custo || '').trim(),
    estoque_atual: String(obj.estoque_atual || '').trim(),
    ativo: String(obj.ativo || 'true').toLowerCase() !== 'false',
  };

  const custom_fields = {};
  for(const campo of camposProdutos){
    const slug = String(campo.slug || '').trim();
    if(!slug) continue;
    const value = obj[slug];
    if(value !== undefined && value !== null && String(value).trim() !== ''){
      custom_fields[slug] = value;
    }
  }

  if(Object.keys(custom_fields).length) base.custom_fields = custom_fields;
  return base;
}

function findExistingProdutoIdByCodigo(payload){
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  if(!codigo) return null;
  const found = (produtos || []).find(p => String(p.codigo || '').trim().toLowerCase() === codigo);
  return found?.id || null;
}

async function importarProdutosFromItems(items){
  if(!Array.isArray(items) || !items.length){
    toast('Arquivo vazio ou inválido.', { error:true, ms:4000 });
    return;
  }

  const ok = await confirmDialog({
    title:'Importar produtos',
    message:`Importar ${items.length} produto(s)? O sistema vai criar ou atualizar por código.`,
    confirmText:'Importar',
    cancelText:'Cancelar',
    danger:true,
  });

  if(!ok) return;

  toast('Importando produtos...', { ms:2200 });

  let okCount = 0;
  let failCount = 0;

  try{ await carregarProdutos(); }catch{}

  for(const raw of items){
    try{
      const payload = mapImportToPayload(raw);
      if(!payload.nome){ failCount++; continue; }
      const existingId = findExistingProdutoIdByCodigo(payload);
      await salvarProdutoNoServidor(payload, existingId);
      okCount++;
    }catch(err){
      console.error('[Produtos] import item erro:', err);
      failCount++;
    }
  }

  try{ await carregarProdutos(); }catch{}

  if(failCount === 0){
    toast(`Importação concluída: ${okCount} OK.`, { ms:2200 });
  } else {
    toast(`Importado: ${okCount} OK • ${failCount} falharam`, { error:true, ms:5200 });
  }
}

async function importarProdutosArquivo(file){
  if(!file){ toast('Selecione um arquivo para importar.', { error:true }); return; }
  const name = String(file.name || '').toLowerCase();

  try{
    if(name.endsWith('.json')){
      const text = await readFileAsText(file);
      const data = JSON.parse(text || '{}');
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      await importarProdutosFromItems(items);
      return;
    }
    if(name.endsWith('.csv') || name.endsWith('.txt')){
      const text = await readFileAsText(file);
      await importarProdutosFromItems(parseCSV(text));
      return;
    }
    if(name.endsWith('.xlsx')){
      const buf = await readFileAsArrayBuffer(file);
      await importarProdutosFromItems(parseXLSX(buf));
      return;
    }
    toast('Formato inválido. Use .JSON, .CSV ou .XLSX', { error:true, ms:4200 });
  }catch(err){
    console.error('[Produtos] importar arquivo erro:', err);
    toast('Erro ao importar arquivo.', { error:true, ms:5000 });
  }
}

function renderTabelaProdutos(){
  const tbody = document.getElementById('tbody-produtos');
  const spanCount = document.getElementById('contagem-produtos');
  const busca = (document.getElementById('busca-produtos')?.value || '').toLowerCase();

  if(!tbody) return;

  const filtrados = produtos.filter(p=>{
    const texto = [p.codigo, p.nome, p.categoria, p.descricao].filter(Boolean).join(' ').toLowerCase();
    return !busca || texto.includes(busca);
  });

  tbody.innerHTML = '';

  if(filtrados.length === 0){
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="border: none; text-align: center;">Nenhum produto encontrado.</td></tr>`;
  } else {
    filtrados.forEach(p=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-codigo">${escapeHtml(p.codigo || '-')}</span></td>
        <td><strong>${escapeHtml(p.nome || '-')}</strong></td>
        <td>${escapeHtml(p.categoria || '-')}</td>
        <td>R$ ${escapeHtml(p.preco_venda || '-')}</td>
        <td>${escapeHtml(p.estoque_atual || '-')}</td>
        <td style="text-align: right;">
          <button class="btn-icon" data-action="editar" data-id="${p.id}" title="Editar produto">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon danger" data-action="excluir" data-id="${p.id}" title="Excluir produto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  if(spanCount) spanCount.textContent = filtrados.length === 1 ? '1 produto' : `${filtrados.length} produtos`;
}

function renderListaCamposProdutos(){
  const wrap = document.getElementById('lista-campos-produtos');
  if(!wrap) return;

  if(!camposProdutos.length){
    wrap.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Nenhum campo personalizado criado ainda.</div>`;
    return;
  }

  wrap.innerHTML = camposProdutos.map(campo=>{
    const badgeObrigatorio = campo.obrigatorio ? `<span class="badge-tag brand">Obrigatório</span>` : '';
    const badgeInativo = campo.ativo === false ? `<span class="badge-tag">Oculto</span>` : '';
    return `
      <div class="campo-card">
        <div>
          <strong>${escapeHtml(campo.nome || '')}</strong>
          <span>${escapeHtml(formatTipoCampo(campo.tipo))} • ordem ${Number(campo.ordem || 0)}</span>
          <div>
            ${badgeObrigatorio}
            ${badgeInativo}
          </div>
        </div>
        <div>
          <button class="btn-icon" data-campo-action="editar" data-id="${campo.id}" title="Editar campo">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="btn-icon danger" data-campo-action="excluir" data-id="${campo.id}" title="Excluir campo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function parseCampoOpcoes(campo){
  if(!campo || !campo.opcoes_json) return [];
  try{
    const parsed = JSON.parse(campo.opcoes_json);
    return Array.isArray(parsed) ? parsed : [];
  }catch{
    return [];
  }
}

function renderCustomFieldsInputs(values = {}){
  const container = document.getElementById('custom-fields-container');
  if(!container) return;

  if(!camposProdutos.length){
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Nenhum campo personalizado cadastrado.</div>`;
    return;
  }

  const ativos = camposProdutos.filter(c => c.ativo !== false);
  if(!ativos.length){
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Todos os campos personalizados estão ocultos.</div>`;
    return;
  }

  container.innerHTML = '';

  ativos.forEach(campo=>{
    const slug = String(campo.slug || '').trim();
    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = campo.tipo || 'texto';
    const obrigatorio = !!campo.obrigatorio;
    const valor = values?.[slug] ?? '';
    
    const field = document.createElement('div');
    field.className = 'form-group';
    if(tipo === 'textarea') field.style.gridColumn = '1 / -1';

    let html = `<label for="${id}">${escapeHtml(label)}${obrigatorio ? ' *' : ''}</label>`;

    if(tipo === 'textarea'){
      html += `<textarea id="${id}" data-custom-field="${escapeHtml(slug)}" rows="3" placeholder="${escapeHtml(label)}">${escapeHtml(valor)}</textarea>`;
    } else if(tipo === 'numero'){
      html += `<input type="number" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" placeholder="${escapeHtml(label)}" />`;
    } else if(tipo === 'data'){
      html += `<input type="date" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    } else if(tipo === 'checkbox'){
      const checked = String(valor).toLowerCase() === 'true' || valor === true ? 'checked' : '';
      html = `
        <label class="custom-checkbox" style="margin-top:24px;">
          <input type="checkbox" id="${id}" data-custom-field="${escapeHtml(slug)}" ${checked} />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    } else if(tipo === 'select'){
      const opcoes = parseCampoOpcoes(campo);
      html += `<select id="${id}" data-custom-field="${escapeHtml(slug)}">
        <option value="">Selecione</option>
        ${opcoes.map(opt => {
          const sel = String(valor) === String(opt) ? 'selected' : '';
          return `<option value="${escapeHtml(opt)}" ${sel}>${escapeHtml(opt)}</option>`;
        }).join('')}
      </select>`;
    } else {
      html += `<input type="text" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" placeholder="${escapeHtml(label)}" />`;
    }

    field.innerHTML = html;
    container.appendChild(field);
  });
}

function abrirModalProduto(){
  const backdrop = document.getElementById('modal-produto-backdrop');
  if(backdrop) backdrop.classList.add('show');
}

function fecharModalProduto(){
  const backdrop = document.getElementById('modal-produto-backdrop');
  if(backdrop) backdrop.classList.remove('show');
  produtoEditandoId = null;
}

function abrirModalCampo(){
  const backdrop = document.getElementById('modal-campo-backdrop');
  if(backdrop) backdrop.classList.add('show');
}

function fecharModalCampo(){
  const backdrop = document.getElementById('modal-campo-backdrop');
  if(backdrop) backdrop.classList.remove('show');
  campoEditandoId = null;
}

function setVal(id, v){ const el = document.getElementById(id); if(el) el.value = (v ?? ''); }
function getVal(id){ const el = document.getElementById(id); return (el?.value ?? '').trim(); }
function setCheck(id, v){ const el = document.getElementById(id); if(el) el.checked = !!v; }
function getCheck(id){ const el = document.getElementById(id); return !!el?.checked; }

function limparCamposProduto(){
  setVal('campo-codigo-produto', '');
  setVal('campo-nome-produto', '');
  setVal('campo-descricao-produto', '');
  setVal('campo-categoria-produto', '');
  setVal('campo-unidade-produto', '');
  setVal('campo-preco-venda-produto', '');
  setVal('campo-custo-produto', '');
  setVal('campo-estoque-produto', '');
  setCheck('campo-ativo-produto', true);
  renderCustomFieldsInputs({});
}

function abrirModalProdutoNovo(){
  const titulo = document.getElementById('modal-produto-titulo');
  if(titulo) titulo.textContent = 'Novo produto';

  produtoEditandoId = null;
  limparCamposProduto();

  const proximoId = produtos.length > 0 ? Math.max(...produtos.map(p=>Number(p.id) || 0)) + 1 : 1;
  setVal('campo-codigo-produto', `PRO-${String(proximoId).padStart(4,'0')}`);

  abrirModalProduto();
  setTimeout(()=>{ try{ document.getElementById('campo-nome-produto')?.focus(); }catch{} }, 0);
}

function abrirModalProdutoEditar(produto){
  const titulo = document.getElementById('modal-produto-titulo');
  if(titulo) titulo.textContent = 'Editar produto';

  produtoEditandoId = produto.id;

  setVal('campo-codigo-produto', produto.codigo || '');
  setVal('campo-nome-produto', produto.nome || '');
  setVal('campo-descricao-produto', produto.descricao || '');
  setVal('campo-categoria-produto', produto.categoria || '');
  setVal('campo-unidade-produto', produto.unidade || '');
  setVal('campo-preco-venda-produto', produto.preco_venda || '');
  setVal('campo-custo-produto', produto.custo || '');
  setVal('campo-estoque-produto', produto.estoque_atual || '');
  setCheck('campo-ativo-produto', produto.ativo !== false);

  renderCustomFieldsInputs(produto.custom_fields || {});
  abrirModalProduto();
}

function collectCustomFieldsValues(){
  const values = {};
  const nodes = document.querySelectorAll('[data-custom-field]');

  nodes.forEach(el=>{
    const slug = el.getAttribute('data-custom-field');
    if(!slug) return;
    let value = '';
    if(el.type === 'checkbox'){
      value = el.checked ? 'true' : 'false';
    } else {
      value = String(el.value ?? '').trim();
    }
    if(value !== '') values[slug] = value;
  });
  return values;
}

function validarCamposPersonalizados(custom_fields){
  for(const campo of camposProdutos.filter(c => c.ativo !== false && c.obrigatorio)){
    const slug = String(campo.slug || '').trim();
    const tipo = campo.tipo || 'texto';
    const valor = custom_fields?.[slug];

    if(tipo === 'checkbox'){
      if(valor !== 'true' && valor !== true) return `Preencha o campo obrigatório: ${campo.nome}`;
    } else {
      if(valor == null || String(valor).trim() === '') return `Preencha o campo obrigatório: ${campo.nome}`;
    }
  }
  return null;
}

function buildPayloadProduto(){
  return {
    codigo: getVal('campo-codigo-produto'),
    nome: getVal('campo-nome-produto'),
    descricao: getVal('campo-descricao-produto'),
    categoria: getVal('campo-categoria-produto'),
    unidade: getVal('campo-unidade-produto'),
    preco_venda: getVal('campo-preco-venda-produto'),
    custo: getVal('campo-custo-produto'),
    estoque_atual: getVal('campo-estoque-produto'),
    ativo: getCheck('campo-ativo-produto'),
    custom_fields: collectCustomFieldsValues(),
  };
}

async function salvarProduto(){
  const payload = buildPayloadProduto();

  if(!payload.nome){
    toast('Preencha o nome do produto.', { error:true });
    document.getElementById('campo-nome-produto')?.focus();
    return;
  }

  const erroCustom = validarCamposPersonalizados(payload.custom_fields);
  if(erroCustom){
    toast(erroCustom, { error:true, ms:4500 });
    return;
  }

  try{
    await salvarProdutoNoServidor(payload, produtoEditandoId);
    await carregarProdutos();
    fecharModalProduto();
    toast('Produto salvo com sucesso.', { ms:1800 });
  }catch(err){
    console.error('[Produtos] salvar erro:', err);
    toast(err?.message || 'Erro ao salvar produto.', { error:true, ms:5000 });
  }
}

function syncCampoTipo(){
  const tipo = getVal('campo-custom-tipo') || 'texto';
  const wrap = document.getElementById('wrap-custom-opcoes');
  const campoOpcoes = document.getElementById('campo-custom-opcoes');

  if(!wrap) return;

  const mostrar = tipo === 'select';
  wrap.hidden = !mostrar;
  if(!mostrar && campoOpcoes) campoOpcoes.value = '';
}

function limparCamposModalCampo(){
  setVal('campo-custom-nome', '');
  setVal('campo-custom-tipo', 'texto');
  setVal('campo-custom-ordem', '0');
  setVal('campo-custom-opcoes', '');
  setCheck('campo-custom-obrigatorio', false);
  setCheck('campo-custom-ativo', true);
  syncCampoTipo();
}

function abrirModalCampoNovo(){
  const titulo = document.getElementById('modal-campo-titulo');
  if(titulo) titulo.textContent = 'Novo campo';

  campoEditandoId = null;
  limparCamposModalCampo();
  abrirModalCampo();
  syncCampoTipo();

  setTimeout(()=>{ try{ document.getElementById('campo-custom-nome')?.focus(); }catch{} }, 0);
}

function abrirModalCampoEditar(campo){
  const titulo = document.getElementById('modal-campo-titulo');
  if(titulo) titulo.textContent = 'Editar campo';

  campoEditandoId = campo.id;

  setVal('campo-custom-nome', campo.nome || '');
  setVal('campo-custom-tipo', campo.tipo || 'texto');
  setVal('campo-custom-ordem', String(campo.ordem ?? 0));
  setVal('campo-custom-opcoes', parseCampoOpcoes(campo).join('\n'));
  setCheck('campo-custom-obrigatorio', !!campo.obrigatorio);
  setCheck('campo-custom-ativo', campo.ativo !== false);

  abrirModalCampo();
  syncCampoTipo();
}

function buildPayloadCampo(){
  const nome = getVal('campo-custom-nome');
  const tipo = getVal('campo-custom-tipo') || 'texto';
  const ordemRaw = getVal('campo-custom-ordem');
  const obrigatorio = getCheck('campo-custom-obrigatorio');
  const ativo = getCheck('campo-custom-ativo');

  const slug = slugify(nome);
  const ordem = Number.isFinite(Number(ordemRaw)) ? Number(ordemRaw) : 0;

  let opcoes_json = null;
  if(tipo === 'select'){
    const linhas = getVal('campo-custom-opcoes').split('\n').map(s => s.trim()).filter(Boolean);
    opcoes_json = JSON.stringify(linhas);
  }

  return { nome, slug, tipo, obrigatorio, ativo, ordem, opcoes_json };
}

async function salvarCampo(){
  const payload = buildPayloadCampo();

  if(!payload.nome){
    toast('Preencha o nome do campo.', { error:true });
    document.getElementById('campo-custom-nome')?.focus();
    return;
  }
  if(!payload.slug){
    toast('Não foi possível gerar o identificador do campo.', { error:true });
    document.getElementById('campo-custom-nome')?.focus();
    return;
  }

  if(payload.tipo === 'select'){
    try{
      const parsed = JSON.parse(payload.opcoes_json || '[]');
      if(!Array.isArray(parsed) || !parsed.length){
        toast('Adicione pelo menos uma opção na lista.', { error:true, ms:4200 });
        document.getElementById('campo-custom-opcoes')?.focus();
        return;
      }
    }catch{
      toast('As opções da lista estão inválidas.', { error:true });
      return;
    }
  }

  try{
    await salvarCampoProduto(payload, campoEditandoId);
    await carregarCamposProdutos();
    fecharModalCampo();
    toast('Campo salvo com sucesso.', { ms:1800 });
  }catch(err){
    console.error('[CamposProdutos] salvar erro:', err);
    toast(err?.message || 'Erro ao salvar campo.', { error:true, ms:5000 });
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  const modalProdutoBackdrop = document.getElementById('modal-produto-backdrop');
  const modalCampoBackdrop = document.getElementById('modal-campo-backdrop');
  const confirmBackdrop = document.getElementById('Valora-confirm-backdrop');
  
  const btnX = document.getElementById('Valora-confirm-close'); // Modificado caso use X
  const btnCancel = document.getElementById('Valora-confirm-cancel');
  const btnOk = document.getElementById('Valora-confirm-ok');

  btnX?.addEventListener('click', ()=>closeConfirm(false));
  btnCancel?.addEventListener('click', ()=>closeConfirm(false));
  btnOk?.addEventListener('click', ()=>closeConfirm(true));
  confirmBackdrop?.addEventListener('click', (e)=>{ if(e.target === confirmBackdrop) closeConfirm(false); });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      if(confirmBackdrop && confirmBackdrop.classList.contains('show')) closeConfirm(false);
      if(modalProdutoBackdrop && modalProdutoBackdrop.classList.contains('show')) fecharModalProduto();
      if(modalCampoBackdrop && modalCampoBackdrop.classList.contains('show')) fecharModalCampo();
    }
  });

  try{
    await Promise.all([ carregarCamposProdutos(), carregarProdutos() ]);
  }catch(err){
    console.error('[Produtos] init erro:', err);
    toast(err?.message || 'Erro ao carregar dados.', { error:true, ms:5000 });
  }

  document.getElementById('busca-produtos')?.addEventListener('input', renderTabelaProdutos);

  document.getElementById('btn-novo-produto')?.addEventListener('click', abrirModalProdutoNovo);
  document.getElementById('btn-fechar-modal-produto')?.addEventListener('click', fecharModalProduto);
  document.getElementById('btn-cancelar-produto')?.addEventListener('click', fecharModalProduto);
  document.getElementById('btn-salvar-produto')?.addEventListener('click', salvarProduto);
  modalProdutoBackdrop?.addEventListener('click', (e)=>{ if(e.target === modalProdutoBackdrop) fecharModalProduto(); });

  document.getElementById('btn-novo-campo')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-novo-campo-inline')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-fechar-modal-campo')?.addEventListener('click', fecharModalCampo);
  document.getElementById('btn-cancelar-campo')?.addEventListener('click', fecharModalCampo);
  document.getElementById('btn-salvar-campo')?.addEventListener('click', salvarCampo);
  modalCampoBackdrop?.addEventListener('click', (e)=>{ if(e.target === modalCampoBackdrop) fecharModalCampo(); });

  document.getElementById('campo-custom-tipo')?.addEventListener('change', syncCampoTipo);

  document.getElementById('btn-exportar-produtos-json')?.addEventListener('click', exportarProdutosJSON);
  document.getElementById('btn-exportar-produtos-csv')?.addEventListener('click', exportarProdutosCSV);

  const btnImport = document.getElementById('btn-importar-produtos');
  const inputImport = document.getElementById('input-importar-produtos');

  btnImport?.addEventListener('click', ()=>{
    if(inputImport) inputImport.click();
    else toast('Faltou o input file para importação.', { error:true, ms:4200 });
  });

  inputImport?.addEventListener('change', async ()=>{
    const file = inputImport.files && inputImport.files[0] ? inputImport.files[0] : null;
    await importarProdutosArquivo(file);
    inputImport.value = '';
  });

  const tbody = document.getElementById('tbody-produtos');
  tbody?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'editar'){
      try{
        const full = await obterProdutoNoServidor(id);
        abrirModalProdutoEditar(full);
      }catch(err){
        console.error('[Produtos] obter/editar erro:', err);
        toast(err?.message || 'Não foi possível abrir o produto.', { error:true, ms:5000 });
      }
      return;
    }

    if(action === 'excluir'){
      const ok = await confirmDialog({
        title:'Excluir produto',
        message:'Deseja realmente excluir este produto?',
        confirmText:'Excluir',
        cancelText:'Cancelar',
        danger:true,
      });

      if(ok){
        excluirProdutoNoServidor(id)
          .then(()=>carregarProdutos())
          .then(()=>toast('Produto excluído.', { ms:1800 }))
          .catch(err=>{
            console.error('[Produtos] excluir erro:', err);
            toast(err?.message || 'Erro ao excluir produto.', { error:true, ms:5000 });
          });
      }
    }
  });

  const listaCampos = document.getElementById('lista-campos-produtos');
  listaCampos?.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;

    const action = btn.dataset.campoAction;
    const id = Number(btn.dataset.id);
    if(!id) return;

    if(action === 'editar'){
      try{
        const campo = await obterCampoProduto(id);
        abrirModalCampoEditar(campo);
      }catch(err){
        console.error('[CamposProdutos] editar erro:', err);
        toast(err?.message || 'Não foi possível abrir o campo.', { error:true, ms:5000 });
      }
      return;
    }

    if(action === 'excluir'){
      const ok = await confirmDialog({
        title:'Excluir campo',
        message:'Deseja realmente excluir este campo personalizado?',
        confirmText:'Excluir',
        cancelText:'Cancelar',
        danger:true,
      });

      if(ok){
        excluirCampoProduto(id)
          .then(()=>carregarCamposProdutos())
          .then(()=>toast('Campo excluído.', { ms:1800 }))
          .catch(err=>{
            console.error('[CamposProdutos] excluir erro:', err);
            toast(err?.message || 'Erro ao excluir campo.', { error:true, ms:5000 });
          });
      }
    }
  });
});