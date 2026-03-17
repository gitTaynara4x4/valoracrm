// /frontend/js/pages/clientes.js
let clientes = [];
let camposClientes = [];
let clienteEditandoId = null;
let campoEditandoId = null;

const API_CLIENTES = '/api/clientes';
const API_CAMPOS = '/api/campos-clientes';

function onlyDigits(s) { return String(s || '').replace(/\D+/g, ''); }

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function formatTipoCampo(tipo) {
  const map = {
    texto: 'Texto curto', textarea: 'Texto longo', numero: 'Número',
    data: 'Data', select: 'Lista de opções', checkbox: 'Caixa de seleção',
  };
  return map[tipo] || tipo || '-';
}

/* ========================
 * CONFIRM DIALOG
 * ======================= */
let _confirmResolver = null;

function confirmDialog({ title='Confirmar', message='Tem certeza?', confirmText='OK', cancelText='Cancelar', danger=false } = {}) {
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  const t = document.getElementById('Valora-confirm-title');
  const m = document.getElementById('Valora-confirm-message');
  const btnOk = document.getElementById('Valora-confirm-ok');
  const btnCancel = document.getElementById('Valora-confirm-cancel');

  if(!backdrop) return Promise.resolve(false);

  t.textContent = title;
  m.textContent = message;
  btnOk.textContent = confirmText;
  btnCancel.textContent = cancelText;

  backdrop.hidden = false;
  setTimeout(() => backdrop.classList.add('show'), 10);

  return new Promise((resolve) => {
    _confirmResolver = resolve;
  });
}

function closeConfirm(result=false) {
  const backdrop = document.getElementById('Valora-confirm-backdrop');
  if(backdrop) {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.hidden = true, 200);
  }
  if(typeof _confirmResolver === 'function') {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

/* ========================
 * API BASE
 * ======================= */
async function apiJson(url, options = {}) {
  const resp = await fetch(url, options);
  if(!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || 'Erro na requisição.');
  }
  if(resp.status === 204) return null;
  return resp.json();
}

async function carregarClientes() {
  const data = await apiJson(API_CLIENTES);
  clientes = Array.isArray(data) ? data : [];
  renderTabelaClientes();
}

async function obterClienteNoServidor(id) { return apiJson(`${API_CLIENTES}/${id}`); }

async function salvarClienteNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_CLIENTES : `${API_CLIENTES}/${editandoId}`;
  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function excluirClienteNoServidor(id) { return apiJson(`${API_CLIENTES}/${id}`, { method:'DELETE' }); }

async function carregarCamposClientes() {
  const data = await apiJson(API_CAMPOS);
  camposClientes = Array.isArray(data) ? data : [];
  camposClientes.sort((a, b) => (Number(a.ordem || 0) - Number(b.ordem || 0)) || String(a.nome || '').localeCompare(String(b.nome || '')));
  renderListaCamposClientes();
}

async function obterCampoCliente(id) { return apiJson(`${API_CAMPOS}/${id}`); }

async function salvarCampoCliente(payload, editandoId) {
  const url = editandoId == null ? API_CAMPOS : `${API_CAMPOS}/${editandoId}`;
  return apiJson(url, {
    method: editandoId == null ? 'POST' : 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function excluirCampoCliente(id) { return apiJson(`${API_CAMPOS}/${id}`, { method:'DELETE' }); }

/* ========================
 * EXPORT / IMPORT LÓGICA
 * ======================= */
function downloadFile(filename, content, mime='application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 3000);
}

function normalizeCustomFieldsForExport(cf) { return cf && typeof cf === 'object' ? cf : {}; }

function pickClientesForExport() {
  return (clientes || []).map(c => ({
    id: c.id ?? null, codigo: c.codigo ?? '', nome: c.nome ?? '',
    whatsapp: c.whatsapp ?? '', email: c.email ?? '',
    custom_fields: normalizeCustomFieldsForExport(c.custom_fields),
  }));
}

function exportarClientesJSON() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  const payload = { exported_at: dt.toISOString(), total: (clientes || []).length, items: pickClientesForExport() };
  downloadFile(`clientes_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  window.showToast('Exportado JSON com sucesso.', 'success');
}

function csvEscape(v) {
  const s = String(v ?? '');
  const must = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return must ? `"${out}"` : out;
}

function clientesToCSV(items) {
  const baseCols = ['codigo', 'nome', 'whatsapp', 'email'];
  const customCols = camposClientes.map(c => c.slug);
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  (items || []).forEach(c => {
    const custom = normalizeCustomFieldsForExport(c.custom_fields);
    lines.push(cols.map(k => {
      if (baseCols.includes(k)) return csvEscape(c?.[k] ?? '');
      return csvEscape(custom?.[k] ?? '');
    }).join(';'));
  });
  return '\ufeff' + lines.join('\n');
}

function exportarClientesCSV() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0,19).replaceAll(':','-');
  downloadFile(`clientes_${stamp}.csv`, clientesToCSV(pickClientesForExport()), 'text/csv;charset=utf-8');
  window.showToast('Exportado CSV com sucesso.', 'success');
}

function readFileAsText(file) {
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(String(fr.result || ''));
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>resolve(fr.result);
    fr.onerror = ()=>reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsArrayBuffer(file);
  });
}

function detectCSVDelimiter(firstLine) { return (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ','; }

function parseCSV(text) {
  const raw = String(text || '').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const lines = raw.split('\n').filter(l => l.trim().length);
  if(!lines.length) return [];
  const delim = detectCSVDelimiter(lines[0]);

  function parseLine(line) {
    const out = []; let cur = ''; let inQ = false;
    for(let i=0; i<line.length; i++) {
      const ch = line[i];
      if(ch === '"') {
        if(inQ && line[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; }
        continue;
      }
      if(!inQ && ch === delim) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map(s => String(s ?? '').trim());
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
  const out = [];
  for(let i=1; i<lines.length; i++) {
    const parts = parseLine(lines[i]); const obj = {};
    headers.forEach((h, idx)=>{ obj[h] = parts[idx] ?? ''; });
    out.push(obj);
  }
  return out;
}

function parseXLSX(arrayBuffer) {
  if(typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregou.');
  const wb = XLSX.read(arrayBuffer, { type:'array' });
  for(const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
    const rows = (aoa || []).filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== ''));
    if(!rows.length) continue;
    const first = rows[0].map(v => String(v ?? '').trim().toLowerCase());
    if(first.includes('codigo') || first.includes('nome') || first.includes('whatsapp') || first.includes('email')) {
      const headers = rows[0].map(v => String(v ?? '').trim());
      return rows.slice(1).map(r=>{
        const obj = {}; headers.forEach((h, i)=> obj[h] = r[i] ?? '');
        return obj;
      }).filter(obj => Object.values(obj).some(v => String(v ?? '').trim() !== ''));
    }
    const cols = ['codigo', 'nome', 'whatsapp', 'email'];
    return rows.map(r=>{
      const obj = {}; cols.forEach((k, i)=> obj[k] = r[i] ?? '');
      return obj;
    }).filter(obj => String(obj.nome || obj.codigo || '').trim() !== '');
  }
  return [];
}

function mapImportToPayload(obj) {
  const base = {
    codigo: String(obj.codigo || '').trim(), nome: String(obj.nome || '').trim(),
    whatsapp: String(obj.whatsapp || '').trim(), email: String(obj.email || '').trim(),
  };
  const custom_fields = {};
  for(const campo of camposClientes) {
    const slug = String(campo.slug || '').trim();
    if(!slug) continue;
    const value = obj[slug];
    if(value !== undefined && value !== null && String(value).trim() !== '') custom_fields[slug] = value;
  }
  if(Object.keys(custom_fields).length) base.custom_fields = custom_fields;
  return base;
}

function findExistingClienteIdByCodigoOrWhats(payload) {
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  const wpp = onlyDigits(payload?.whatsapp || '');
  let found = null;
  if(codigo) { found = (clientes || []).find(c => String(c.codigo || '').trim().toLowerCase() === codigo); if(found?.id) return found.id; }
  if(wpp) { found = (clientes || []).find(c => onlyDigits(c.whatsapp || '') === wpp); if(found?.id) return found.id; }
  return null;
}

async function importarClientesFromItems(items) {
  if(!Array.isArray(items) || !items.length) { window.showToast('Arquivo vazio ou inválido.', 'error'); return; }

  const ok = await confirmDialog({
    title:'Importar clientes', message:`Importar ${items.length} cliente(s)? O sistema criará ou atualizará por código/WhatsApp.`,
    confirmText:'Importar', cancelText:'Cancelar', danger:true
  });
  if(!ok) return;

  window.showToast('Importando clientes...', 'success');
  let okCount = 0; let failCount = 0;

  try { await carregarClientes(); } catch{}

  for(const raw of items) {
    try {
      const payload = mapImportToPayload(raw);
      if(!payload.nome) { failCount++; continue; }
      const existingId = findExistingClienteIdByCodigoOrWhats(payload);
      await salvarClienteNoServidor(payload, existingId);
      okCount++;
    } catch(err) { failCount++; }
  }

  try { await carregarClientes(); } catch{}
  if(failCount === 0) window.showToast(`Importação concluída: ${okCount} clientes adicionados.`, 'success');
  else window.showToast(`Importado: ${okCount} sucesso • ${failCount} falhas`, 'error');
}

async function importarClientesArquivo(file) {
  if(!file) { window.showToast('Selecione um arquivo para importar.', 'error'); return; }
  const name = String(file.name || '').toLowerCase();
  try {
    if(name.endsWith('.json')) { const text = await readFileAsText(file); const data = JSON.parse(text || '{}'); await importarClientesFromItems(Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])); return; }
    if(name.endsWith('.csv') || name.endsWith('.txt')) { const text = await readFileAsText(file); await importarClientesFromItems(parseCSV(text)); return; }
    if(name.endsWith('.xlsx')) { const buf = await readFileAsArrayBuffer(file); await importarClientesFromItems(parseXLSX(buf)); return; }
    window.showToast('Formato inválido. Use .JSON, .CSV ou .XLSX', 'error');
  } catch(err) { window.showToast('Erro ao importar arquivo.', 'error'); }
}

/* ========================
 * RENDERIZAÇÕES 
 * ======================= */
function renderTabelaClientes() {
  const tbody = document.getElementById('tbody-clientes');
  const spanCount = document.getElementById('contagem-clientes');
  const busca = (document.getElementById('busca-clientes')?.value || '').toLowerCase();

  if(!tbody) return;

  const filtrados = clientes.filter(c => {
    const texto = [c.codigo, c.nome, c.whatsapp, c.email].filter(Boolean).join(' ').toLowerCase();
    return !busca || texto.includes(busca);
  });

  if (!filtrados.length) {
     tbody.innerHTML = `<tr><td colspan="5" class="empty-state" style="border: none; text-align: center;">Nenhum cliente encontrado.</td></tr>`;
     if(spanCount) spanCount.textContent = '0 clientes';
     return;
  }

  tbody.innerHTML = filtrados.map(c => `
    <tr>
      <td><span class="badge-codigo">${escapeHtml(c.codigo || '-')}</span></td>
      <td style="font-weight: 500; color: #fff;">${escapeHtml(c.nome || '-')}</td>
      <td>${escapeHtml(c.whatsapp || '-')}</td>
      <td>${escapeHtml(c.email || '-')}</td>
      <td style="text-align: right;">
        <button class="btn-icon" data-action="editar" data-id="${c.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon danger" data-action="excluir" data-id="${c.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>
  `).join('');

  if(spanCount) spanCount.textContent = filtrados.length === 1 ? '1 cliente' : `${filtrados.length} clientes`;
}

function renderListaCamposClientes() {
  const wrap = document.getElementById('lista-campos-clientes');
  if(!wrap) return;

  if(!camposClientes.length) {
    wrap.innerHTML = `<div class="empty-state">Nenhum campo personalizado criado.</div>`;
    return;
  }

  wrap.innerHTML = camposClientes.map(campo => {
    const badgeObrigatorio = campo.obrigatorio ? `<span class="badge-tag brand">Obrigatório</span>` : '';
    const badgeInativo = campo.ativo === false ? `<span class="badge-tag">Oculto</span>` : '';
    return `
      <div class="campo-card">
        <div>
          <strong>${escapeHtml(campo.nome || '')}</strong>
          <span>${escapeHtml(formatTipoCampo(campo.tipo))} • Pos: ${Number(campo.ordem || 0)}</span>
          <br>
          ${badgeObrigatorio} ${badgeInativo}
        </div>
        <div>
          <button class="btn-icon" data-campo-action="editar" data-id="${campo.id}"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon danger" data-campo-action="excluir" data-id="${campo.id}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function parseCampoOpcoes(campo) {
  if(!campo || !campo.opcoes_json) return [];
  try{ const parsed = JSON.parse(campo.opcoes_json); return Array.isArray(parsed) ? parsed : []; } catch{ return []; }
}

function renderCustomFieldsInputs(values = {}) {
  const container = document.getElementById('custom-fields-container');
  if(!container) return;

  if(!camposClientes.length) { container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Nenhum campo personalizado cadastrado.</div>`; return; }
  const ativos = camposClientes.filter(c => c.ativo !== false);
  if(!ativos.length) { container.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">Todos os campos personalizados estão ocultos.</div>`; return; }

  container.innerHTML = '';

  ativos.forEach(campo => {
    const slug = String(campo.slug || '').trim();
    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = campo.tipo || 'texto';
    const valor = values?.[slug] ?? '';
    
    const field = document.createElement('div');
    field.className = 'form-group';
    
    let html = `<label for="${id}">${escapeHtml(label)}${campo.obrigatorio ? ' *' : ''}</label>`;

    if(tipo === 'textarea') html += `<textarea id="${id}" data-custom-field="${escapeHtml(slug)}" rows="3">${escapeHtml(valor)}</textarea>`;
    else if(tipo === 'numero') html += `<input type="number" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    else if(tipo === 'data') html += `<input type="date" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    else if(tipo === 'checkbox') {
      const checked = String(valor).toLowerCase() === 'true' || valor === true ? 'checked' : '';
      html = `<label class="custom-checkbox" style="margin-top:8px;"><input type="checkbox" id="${id}" data-custom-field="${escapeHtml(slug)}" ${checked} /> <span>Sim</span></label>`;
    } 
    else if(tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);
      html += `<select id="${id}" class="valora-form input" data-custom-field="${escapeHtml(slug)}" style="width:100%; height:42px; background:var(--bg); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); padding:0 14px;">
        <option value="">Selecione</option>
        ${opcoes.map(opt => `<option value="${escapeHtml(opt)}" ${String(valor) === String(opt) ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}
      </select>`;
    } 
    else html += `<input type="text" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;

    field.innerHTML = html;
    container.appendChild(field);
  });
}

/* ========================
 * MODAL DE CLIENTE
 * ======================= */
function abrirModalClienteNovo() {
  document.getElementById('modal-cliente-titulo').textContent = 'Novo cliente';
  clienteEditandoId = null;
  document.getElementById('formCliente').reset();
  renderCustomFieldsInputs({});
  
  const proximoId = clientes.length > 0 ? Math.max(...clientes.map(c=>Number(c.id) || 0)) + 1 : 1;
  document.getElementById('campo-codigo-cliente').value = `CLI-${String(proximoId).padStart(4,'0')}`;
  
  document.getElementById('modal-cliente-backdrop').hidden = false;
  setTimeout(()=>document.getElementById('modal-cliente-backdrop').classList.add('show'), 10);
}

function abrirModalClienteEditar(cliente) {
  document.getElementById('modal-cliente-titulo').textContent = 'Editar cliente';
  clienteEditandoId = cliente.id;
  
  document.getElementById('campo-codigo-cliente').value = cliente.codigo || '';
  document.getElementById('campo-nome-cliente').value = cliente.nome || '';
  document.getElementById('campo-whatsapp-cliente').value = cliente.whatsapp || '';
  document.getElementById('campo-email-cliente').value = cliente.email || '';
  
  renderCustomFieldsInputs(cliente.custom_fields || {});
  
  document.getElementById('modal-cliente-backdrop').hidden = false;
  setTimeout(()=>document.getElementById('modal-cliente-backdrop').classList.add('show'), 10);
}

function fecharModalCliente() {
  const modal = document.getElementById('modal-cliente-backdrop');
  modal.classList.remove('show');
  setTimeout(() => modal.hidden = true, 200);
}

/* ========================
 * MODAL DE CAMPO
 * ======================= */
function syncCampoTipo() {
  const tipo = document.getElementById('campo-custom-tipo').value || 'texto';
  const wrap = document.getElementById('wrap-custom-opcoes');
  wrap.hidden = (tipo !== 'select');
}

function abrirModalCampoNovo() {
  document.getElementById('modal-campo-titulo').textContent = 'Novo campo';
  campoEditandoId = null;
  
  document.getElementById('campo-custom-nome').value = '';
  document.getElementById('campo-custom-tipo').value = 'texto';
  document.getElementById('campo-custom-ordem').value = '0';
  document.getElementById('campo-custom-opcoes').value = '';
  document.getElementById('campo-custom-obrigatorio').checked = false;
  document.getElementById('campo-custom-ativo').checked = true;
  
  syncCampoTipo();
  document.getElementById('modal-campo-backdrop').hidden = false;
  setTimeout(()=>document.getElementById('modal-campo-backdrop').classList.add('show'), 10);
}

function fecharModalCampo() {
  const modal = document.getElementById('modal-campo-backdrop');
  modal.classList.remove('show');
  setTimeout(() => modal.hidden = true, 200);
}

/* ========================
 * EVENT LISTENERS PRINCIPAIS
 * ======================= */
document.addEventListener('DOMContentLoaded', async () => {
  // Configuração Fechar Modais
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => { if(e.target === el) { fecharModalCliente(); fecharModalCampo(); closeConfirm(false); } });
  });

  // Botões de Confirmação e Cancelamento do Confirm Global
  document.getElementById('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  document.getElementById('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  // Iniciar Telas
  try {
    await Promise.all([carregarCamposClientes(), carregarClientes()]);
  } catch(err) {
    window.showToast('Erro ao carregar dados do servidor.', 'error');
  }

  // Busca e Inputs
  document.getElementById('busca-clientes')?.addEventListener('input', renderTabelaClientes);
  document.getElementById('campo-custom-tipo')?.addEventListener('change', syncCampoTipo);

  // Botões do Modal Cliente
  document.getElementById('btn-novo-cliente')?.addEventListener('click', abrirModalClienteNovo);
  document.getElementById('btn-fechar-modal-cliente')?.addEventListener('click', fecharModalCliente);
  document.getElementById('btn-cancelar-cliente')?.addEventListener('click', fecharModalCliente);
  
  // Salvar Cliente (COM TRAVA DE OBRIGATÓRIOS)
  document.getElementById('btn-salvar-cliente')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('campo-nome-cliente').value.trim();
    if(!nome) { window.showToast('Preencha o nome do cliente.', 'error'); return; }

    const custom_fields = {};
    document.querySelectorAll('[data-custom-field]').forEach(el => {
      const slug = el.getAttribute('data-custom-field');
      let val = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value.trim();
      if(val !== '') custom_fields[slug] = val;
    });

    // TRAVA DE SEGURANÇA: Campos Obrigatórios
    for (const campo of camposClientes) {
      if (campo.ativo && campo.obrigatorio) {
        const valor = custom_fields[campo.slug];
        
        if (campo.tipo === 'checkbox') {
          if (valor !== 'true') {
            window.showToast(`O campo "${campo.nome}" é obrigatório (marque a caixa).`, 'error');
            return; 
          }
        } else {
          if (!valor || String(valor).trim() === '') {
            window.showToast(`O campo "${campo.nome}" é obrigatório.`, 'error');
            return; 
          }
        }
      }
    }

    const payload = {
      codigo: document.getElementById('campo-codigo-cliente').value,
      nome: nome,
      whatsapp: document.getElementById('campo-whatsapp-cliente').value,
      email: document.getElementById('campo-email-cliente').value,
      custom_fields
    };

    const btn = document.getElementById('btn-salvar-cliente');
    btn.innerHTML = 'Salvando...'; btn.disabled = true;

    try {
      await salvarClienteNoServidor(payload, clienteEditandoId);
      await carregarClientes();
      fecharModalCliente();
      window.showToast('Cliente salvo com sucesso!', 'success');
    } catch(err) {
      window.showToast(err.message || 'Erro ao salvar cliente', 'error');
    } finally {
      btn.innerHTML = 'Salvar Cliente'; btn.disabled = false;
    }
  });

  // Botões do Modal Campo Customizado
  document.getElementById('btn-novo-campo')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-novo-campo-inline')?.addEventListener('click', abrirModalCampoNovo);
  document.getElementById('btn-fechar-modal-campo')?.addEventListener('click', fecharModalCampo);
  document.getElementById('btn-cancelar-campo')?.addEventListener('click', fecharModalCampo);

  // Salvar Campo Customizado
  document.getElementById('btn-salvar-campo')?.addEventListener('click', async () => {
    const nome = document.getElementById('campo-custom-nome').value.trim();
    if(!nome) { window.showToast('Nome do campo é obrigatório.', 'error'); return; }

    const tipo = document.getElementById('campo-custom-tipo').value;
    let opcoes_json = null;
    
    if(tipo === 'select') {
      const linhas = document.getElementById('campo-custom-opcoes').value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(!linhas.length) { window.showToast('Adicione pelo menos uma opção para a lista.', 'error'); return; }
      opcoes_json = JSON.stringify(linhas);
    }

    const payload = {
      nome,
      slug: slugify(nome),
      tipo,
      ordem: Number(document.getElementById('campo-custom-ordem').value) || 0,
      obrigatorio: document.getElementById('campo-custom-obrigatorio').checked,
      ativo: document.getElementById('campo-custom-ativo').checked,
      opcoes_json
    };

    const btn = document.getElementById('btn-salvar-campo');
    btn.innerHTML = 'Salvando...'; btn.disabled = true;

    try {
      await salvarCampoCliente(payload, campoEditandoId);
      await carregarCamposClientes();
      fecharModalCampo();
      window.showToast('Campo personalizado salvo!', 'success');
    } catch(err) {
      window.showToast('Erro ao salvar campo.', 'error');
    } finally {
      btn.innerHTML = 'Salvar Campo'; btn.disabled = false;
    }
  });

  // Ações dentro da Tabela de Clientes (Editar / Excluir)
  document.getElementById('tbody-clientes')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if(action === 'editar') {
      try {
        const full = await obterClienteNoServidor(id);
        abrirModalClienteEditar(full);
      } catch(err) { window.showToast('Erro ao carregar cliente.', 'error'); }
    }
    
    if(action === 'excluir') {
      const ok = await confirmDialog({ title: 'Excluir Cliente', message: 'Deseja realmente excluir este cliente permanentemente?', confirmText: 'Excluir', danger: true });
      if(ok) {
        try {
          await excluirClienteNoServidor(id);
          await carregarClientes();
          window.showToast('Cliente excluído.', 'success');
        } catch(err) { window.showToast('Erro ao excluir.', 'error'); }
      }
    }
  });

  // Ações nos Cards de Campos Personalizados
  document.getElementById('lista-campos-clientes')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-icon');
    if(!btn) return;
    const action = btn.dataset.campoAction;
    const id = Number(btn.dataset.id);

    if(action === 'editar') {
      try {
        const campo = await obterCampoCliente(id);
        
        document.getElementById('modal-campo-titulo').textContent = 'Editar campo';
        campoEditandoId = campo.id;
        document.getElementById('campo-custom-nome').value = campo.nome || '';
        document.getElementById('campo-custom-tipo').value = campo.tipo || 'texto';
        document.getElementById('campo-custom-ordem').value = campo.ordem || 0;
        document.getElementById('campo-custom-opcoes').value = parseCampoOpcoes(campo).join('\n');
        document.getElementById('campo-custom-obrigatorio').checked = !!campo.obrigatorio;
        document.getElementById('campo-custom-ativo').checked = campo.ativo !== false;
        
        syncCampoTipo();
        document.getElementById('modal-campo-backdrop').hidden = false;
        setTimeout(()=>document.getElementById('modal-campo-backdrop').classList.add('show'), 10);
      } catch(err) { window.showToast('Erro ao abrir campo.', 'error'); }
    }

    if(action === 'excluir') {
      const ok = await confirmDialog({ title: 'Excluir Campo', message: 'Tem certeza? Clientes que já preencheram perderão essa informação.', confirmText: 'Excluir', danger: true });
      if(ok) {
        try {
          await excluirCampoCliente(id);
          await carregarCamposClientes();
          window.showToast('Campo excluído.', 'success');
        } catch(err) { window.showToast('Erro ao excluir campo.', 'error'); }
      }
    }
  });

  // Importação e Exportação
  document.getElementById('btn-exportar-clientes-json')?.addEventListener('click', exportarClientesJSON);
  document.getElementById('btn-exportar-clientes-csv')?.addEventListener('click', exportarClientesCSV);

  const btnImport = document.getElementById('btn-importar-clientes');
  const inputImport = document.getElementById('input-importar-clientes');
  btnImport?.addEventListener('click', () => inputImport.click());
  inputImport?.addEventListener('change', async () => {
    const file = inputImport.files && inputImport.files[0] ? inputImport.files[0] : null;
    await importarClientesArquivo(file);
    inputImport.value = '';
  });
});