// /frontend/js/pages/fornecedores.js

let fornecedores = [];
let camposFornecedores = [];
let fornecedorEditandoId = null;
let campoEditandoId = null;

const API_FORNECEDORES = '/api/fornecedores';
const API_CAMPOS = '/api/fornecedores/campos';

function onlyDigits(s){ return String(s || '').replace(/\D+/g, ''); }

function slugify(value){
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

function escapeHtml(v){
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function formatTipoCampo(tipo){
  const map = { texto: 'Texto curto', textarea: 'Texto longo', numero: 'Número', data: 'Data', select: 'Lista de opções', checkbox: 'Caixa de seleção' };
  return map[tipo] || tipo || '-';
}

function toast(msg, { error=false, ms=2600 } = {}){
  if (window.showToast) {
    window.showToast(msg, error ? 'error' : 'success');
  } else {
    alert(msg);
  }
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
  
  return new Promise((resolve)=>{
    _confirmResolver = resolve;
  });
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
  const resp = await fetch(url, options);
  if(!resp.ok){
    const txt = await resp.text();
    throw new Error(txt || 'Erro na requisição.');
  }
  if(resp.status === 204) return null;
  return resp.json();
}

async function carregarFornecedores(){
  try {
    const data = await apiJson(API_FORNECEDORES);
    fornecedores = Array.isArray(data) ? data : [];
  } catch { fornecedores = []; }
  renderTabelaFornecedores();
}

async function carregarCamposFornecedores(){
  try {
    const data = await apiJson(`${API_CAMPOS}/lista`);
    camposFornecedores = Array.isArray(data) ? data : [];
    camposFornecedores.sort((a, b) => (Number(a.ordem || 0) - Number(b.ordem || 0)));
  } catch { camposFornecedores = []; }
  renderListaCamposFornecedores();
}

function parseCampoOpcoes(campo){
  if(!campo || !campo.opcoes_json) return [];
  try{ const parsed = JSON.parse(campo.opcoes_json); return Array.isArray(parsed) ? parsed : []; }catch{ return []; }
}

function renderTabelaFornecedores(){
  const tbody = document.getElementById('tbody-fornecedores');
  const spanCount = document.getElementById('contagem-fornecedores');
  const busca = (document.getElementById('busca-fornecedores')?.value || '').toLowerCase();

  if(!tbody) return;

  const filtrados = fornecedores.filter(f=>{
    const texto = [f.codigo, f.nome, f.whatsapp, f.email].filter(Boolean).join(' ').toLowerCase();
    return !busca || texto.includes(busca);
  });

  if(!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="border:none; text-align:center;">Nenhum fornecedor encontrado.</td></tr>`;
  } else {
    tbody.innerHTML = filtrados.map(f => `
      <tr>
        <td><span class="badge-codigo">${escapeHtml(f.codigo || '-')}</span></td>
        <td style="font-weight: 500; color: var(--text);">${escapeHtml(f.nome || '-')}</td>
        <td>${escapeHtml(f.whatsapp || '-')}</td>
        <td>${escapeHtml(f.email || '-')}</td>
        <td style="text-align: right; display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn-icon" data-action="editar" data-id="${f.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon danger" data-action="excluir" data-id="${f.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join('');
  }

  if(spanCount) spanCount.textContent = filtrados.length === 1 ? '1 fornecedor' : `${filtrados.length} fornecedores`;
}

function renderListaCamposFornecedores(){
  const wrap = document.getElementById('lista-campos-fornecedores');
  if(!wrap) return;

  if(!camposFornecedores.length){
    wrap.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">Nenhum campo personalizado criado.</div>`;
    return;
  }

  wrap.innerHTML = camposFornecedores.map(campo=>{
    const bObrig = campo.obrigatorio ? `<span class="badge-tag brand">Obrigatório</span>` : '';
    const bOculto = campo.ativo === false ? `<span class="badge-tag">Oculto</span>` : '';
    return `
      <div class="campo-card">
        <div class="campo-card-header">
          <div>
            <strong>${escapeHtml(campo.nome || '')}</strong>
            <span class="campo-meta">${escapeHtml(formatTipoCampo(campo.tipo))} • Ordem ${Number(campo.ordem || 0)}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-icon" data-campo-action="editar" data-id="${campo.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-icon danger" data-campo-action="excluir" data-id="${campo.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </div>
        <div class="campo-badges">${bObrig} ${bOculto}</div>
      </div>
    `;
  }).join('');
}

function renderCustomFieldsInputs(values = {}){
  const container = document.getElementById('custom-fields-container');
  if(!container) return;

  if(!camposFornecedores.length){
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Nenhum campo personalizado.</div>`; return;
  }
  const ativos = camposFornecedores.filter(c => c.ativo !== false);
  if(!ativos.length){
    container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Todos os campos estão ocultos.</div>`; return;
  }

  container.innerHTML = '';
  ativos.forEach(campo=>{
    const slug = String(campo.slug || '').trim();
    const id = `custom-field-${slug}`;
    const valor = values?.[slug] ?? '';
    const field = document.createElement('div');
    field.className = 'form-group';

    let html = `<label for="${id}">${escapeHtml(campo.nome || slug)}${campo.obrigatorio ? ' *' : ''}</label>`;

    if(campo.tipo === 'textarea') html += `<textarea id="${id}" data-custom-field="${escapeHtml(slug)}" rows="3">${escapeHtml(valor)}</textarea>`;
    else if(campo.tipo === 'numero') html += `<input type="number" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    else if(campo.tipo === 'data') html += `<input type="date" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    else if(campo.tipo === 'checkbox'){
      const checked = String(valor).toLowerCase() === 'true' || valor === true ? 'checked' : '';
      html = `<label class="custom-checkbox" style="margin-top:8px;"><input type="checkbox" id="${id}" data-custom-field="${escapeHtml(slug)}" ${checked} /> <span>Sim</span></label>`;
    } else if(campo.tipo === 'select'){
      const opcoes = parseCampoOpcoes(campo);
      html += `<select id="${id}" data-custom-field="${escapeHtml(slug)}"><option value="">Selecione</option>${opcoes.map(opt => `<option value="${escapeHtml(opt)}" ${String(valor) === String(opt) ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}</select>`;
    } else html += `<input type="text" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;

    field.innerHTML = html;
    container.appendChild(field);
  });
}

function abrirModalFornecedorNovo(){
  document.getElementById('modal-fornecedor-titulo').textContent = 'Novo fornecedor';
  fornecedorEditandoId = null;
  document.getElementById('formFornecedor').reset();
  renderCustomFieldsInputs({});
  
  const proximoId = fornecedores.length > 0 ? Math.max(...fornecedores.map(c=>Number(c.id) || 0)) + 1 : 1;
  document.getElementById('campo-codigo-fornecedor').value = `FOR-${String(proximoId).padStart(4,'0')}`;
  
  const modal = document.getElementById('modal-fornecedor-backdrop');
  modal.hidden = false; setTimeout(()=>modal.classList.add('show'), 10);
}

function fecharModalFornecedor(){
  const modal = document.getElementById('modal-fornecedor-backdrop');
  modal.classList.remove('show'); setTimeout(() => modal.hidden = true, 200);
}

function abrirModalCampoNovo(){
  document.getElementById('modal-campo-titulo').textContent = 'Novo campo';
  campoEditandoId = null;
  document.getElementById('campo-custom-nome').value = '';
  document.getElementById('campo-custom-tipo').value = 'texto';
  document.getElementById('campo-custom-ordem').value = '0';
  document.getElementById('campo-custom-opcoes').value = '';
  document.getElementById('campo-custom-obrigatorio').checked = false;
  document.getElementById('campo-custom-ativo').checked = true;
  document.getElementById('wrap-custom-opcoes').hidden = true;
  
  const modal = document.getElementById('modal-campo-backdrop');
  modal.hidden = false; setTimeout(()=>modal.classList.add('show'), 10);
}

function fecharModalCampo(){
  const modal = document.getElementById('modal-campo-backdrop');
  modal.classList.remove('show'); setTimeout(() => modal.hidden = true, 200);
}

// LOGICA DE EXCEL/JSON DA EQUIPE MANTIDA INTACTA
function downloadFile(filename, content, mime='application/octet-stream'){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

function exportarFornecedoresJSON(){
  const dt = new Date(); const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const items = fornecedores.map(f => ({ id: f.id, codigo: f.codigo, nome: f.nome, whatsapp: f.whatsapp, email: f.email, custom_fields: f.custom_fields||{} }));
  downloadFile(`fornecedores_${stamp}.json`, JSON.stringify({ exported_at: dt.toISOString(), total: items.length, items }, null, 2), 'application/json;charset=utf-8');
  toast('Exportado JSON.');
}

function exportarFornecedoresCSV(){
  const dt = new Date(); const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const baseCols = ['codigo', 'nome', 'whatsapp', 'email'];
  const customCols = camposFornecedores.map(c => c.slug);
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  fornecedores.forEach(f => {
    const custom = f.custom_fields || {};
    lines.push(cols.map(k => {
      let val = baseCols.includes(k) ? f[k] : custom[k];
      let s = String(val ?? '');
      return /[;\n\r"]/g.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    }).join(';'));
  });

  downloadFile(`fornecedores_${stamp}.csv`, '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8');
  toast('Exportado CSV.');
}

document.addEventListener('DOMContentLoaded', async () => {
  
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => { if(e.target === el) { fecharModalFornecedor(); fecharModalCampo(); closeConfirm(false); } });
  });

  document.getElementById('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  document.getElementById('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  await carregarCamposFornecedores();
  await carregarFornecedores();

  document.getElementById('busca-fornecedores')?.addEventListener('input', renderTabelaFornecedores);
  
  document.getElementById('campo-custom-tipo')?.addEventListener('change', (e) => {
    document.getElementById('wrap-custom-opcoes').hidden = (e.target.value !== 'select');
  });

  document.getElementById('btn-novo-fornecedor')?.addEventListener('click', abrirModalFornecedorNovo);
  document.getElementById('btn-fechar-modal-fornecedor')?.addEventListener('click', fecharModalFornecedor);
  document.getElementById('btn-cancelar-fornecedor')?.addEventListener('click', fecharModalFornecedor);

  document.getElementById('btn-salvar-fornecedor')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('campo-nome-fornecedor').value.trim();
    if(!nome) { toast('Preencha o nome.', {error:true}); return; }

    const custom_fields = {};
    document.querySelectorAll('[data-custom-field]').forEach(el => {
      const slug = el.getAttribute('data-custom-field');
      let val = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value.trim();
      if(val !== '') custom_fields[slug] = val;
    });

    const payload = {
      codigo: document.getElementById('campo-codigo-fornecedor').value,
      nome: nome,
      whatsapp: document.getElementById('campo-whatsapp-fornecedor').value,
      email: document.getElementById('campo-email-fornecedor').value,
      custom_fields
    };

    const btn = document.getElementById('btn-salvar-fornecedor');
    btn.innerHTML = 'Salvando...'; btn.disabled = true;

    try {
      await apiJson(fornecedorEditandoId ? `${API_FORNECEDORES}/${fornecedorEditandoId}` : API_FORNECEDORES, {
        method: fornecedorEditandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await carregarFornecedores();
      fecharModalFornecedor();
      toast('Fornecedor salvo!');
    } catch(err) { toast('Erro ao salvar.', {error:true}); } 
    finally { btn.innerHTML = 'Salvar Fornecedor'; btn.disabled = false; }
  });

  document.getElementById('btn-novo-campo')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-novo-campo-inline')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-fechar-modal-campo')?.addEventListener('click', fecharModalCampo);
  document.getElementById('btn-cancelar-campo')?.addEventListener('click', fecharModalCampo);

  document.getElementById('btn-salvar-campo')?.addEventListener('click', async () => {
    const nome = document.getElementById('campo-custom-nome').value.trim();
    if(!nome) { toast('Nome é obrigatório.', {error:true}); return; }

    const tipo = document.getElementById('campo-custom-tipo').value;
    let opcoes_json = null;
    if(tipo === 'select') {
      const linhas = document.getElementById('campo-custom-opcoes').value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(!linhas.length) { toast('Adicione opções para a lista.', {error:true}); return; }
      opcoes_json = JSON.stringify(linhas);
    }

    const payload = {
      nome, slug: slugify(nome), tipo,
      ordem: Number(document.getElementById('campo-custom-ordem').value) || 0,
      obrigatorio: document.getElementById('campo-custom-obrigatorio').checked,
      ativo: document.getElementById('campo-custom-ativo').checked,
      opcoes_json
    };

    const btn = document.getElementById('btn-salvar-campo');
    btn.innerHTML = 'Salvando...'; btn.disabled = true;

    try {
      await apiJson(campoEditandoId ? `${API_CAMPOS}/${campoEditandoId}` : API_CAMPOS, {
        method: campoEditandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      await carregarCamposFornecedores();
      fecharModalCampo();
      toast('Campo salvo!');
    } catch(err) { toast('Erro ao salvar campo.', {error:true}); } 
    finally { btn.innerHTML = 'Salvar Campo'; btn.disabled = false; }
  });

  document.getElementById('btn-exportar-fornecedores-json')?.addEventListener('click', exportarFornecedoresJSON);
  document.getElementById('btn-exportar-fornecedores-csv')?.addEventListener('click', exportarFornecedoresCSV);

  // Delegação de cliques para Editar e Excluir
  document.getElementById('tbody-fornecedores')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    
    if(action === 'editar') {
      const full = await apiJson(`${API_FORNECEDORES}/${id}`);
      document.getElementById('modal-fornecedor-titulo').textContent = 'Editar fornecedor';
      fornecedorEditandoId = full.id;
      document.getElementById('campo-codigo-fornecedor').value = full.codigo || '';
      document.getElementById('campo-nome-fornecedor').value = full.nome || '';
      document.getElementById('campo-whatsapp-fornecedor').value = full.whatsapp || '';
      document.getElementById('campo-email-fornecedor').value = full.email || '';
      renderCustomFieldsInputs(full.custom_fields || {});
      const modal = document.getElementById('modal-fornecedor-backdrop');
      modal.hidden = false; setTimeout(()=>modal.classList.add('show'), 10);
    } else if(action === 'excluir') {
      if(await confirmDialog({title:'Excluir fornecedor', message:'Deseja mesmo excluir?'})) {
        await apiJson(`${API_FORNECEDORES}/${id}`, {method:'DELETE'});
        await carregarFornecedores();
        toast('Fornecedor excluído.');
      }
    }
  });

  document.getElementById('lista-campos-fornecedores')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;
    const action = btn.dataset.campoAction;
    const id = btn.dataset.id;
    
    if(action === 'editar') {
      const campo = await apiJson(`${API_CAMPOS}/${id}`);
      document.getElementById('modal-campo-titulo').textContent = 'Editar campo';
      campoEditandoId = campo.id;
      document.getElementById('campo-custom-nome').value = campo.nome || '';
      document.getElementById('campo-custom-tipo').value = campo.tipo || 'texto';
      document.getElementById('campo-custom-ordem').value = campo.ordem || 0;
      document.getElementById('campo-custom-opcoes').value = parseCampoOpcoes(campo).join('\n');
      document.getElementById('campo-custom-obrigatorio').checked = !!campo.obrigatorio;
      document.getElementById('campo-custom-ativo').checked = campo.ativo !== false;
      document.getElementById('wrap-custom-opcoes').hidden = (campo.tipo !== 'select');
      const modal = document.getElementById('modal-campo-backdrop');
      modal.hidden = false; setTimeout(()=>modal.classList.add('show'), 10);
    } else if(action === 'excluir') {
      if(await confirmDialog({title:'Excluir campo', message:'Deseja mesmo excluir?'})) {
        await apiJson(`${API_CAMPOS}/${id}`, {method:'DELETE'});
        await carregarCamposFornecedores();
        toast('Campo excluído.');
      }
    }
  });
});