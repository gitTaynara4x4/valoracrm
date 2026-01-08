// /frontend/js/pages/produtos.js
// V4: API opcional + fallback + sem alert/confirm/prompt do navegador (toast + confirm + input custom)
// + campos de LISTA com "Adicionar…"

const DEBUG = false;

const API_BASE = '/api';
const API_PRODUTOS = `${API_BASE}/produtos`;

const STORAGE_KEY = 'orcapro_produtos_v4';
const LISTS_KEY = 'orcapro_listas_produtos_v1';

function logWarn(...a) { if (DEBUG) console.warn(...a); }
function logErr(...a) { if (DEBUG) console.error(...a); }

/* =========================
   UI (Toast + Confirm + Prompt)
========================= */

function ensureInlineUIStyles() {
  if (document.getElementById('orca-ui-inline-style')) return;

  const style = document.createElement('style');
  style.id = 'orca-ui-inline-style';
  style.textContent = `
    /* ===== MOVIMENTAÇÃO ===== */
.orca-mov-list{ display:flex; flex-direction:column; gap:10px; }
.orca-mov-item{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid #3a3a3a; border-radius:14px; background:#262626; }
.orca-mov-item__title{ font-size: 14px; }
.orca-mov-item__sub{ font-size: 12px; color:#b0b0b0; margin-top:4px; }
.orca-mov-empty{ color:#b0b0b0; font-size:13px; padding:6px 0; }
/* ===== TOAST ===== */
    .orca-toast-wrap{
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: min(420px, calc(100vw - 28px));
      pointer-events: none;
    }
    .orca-toast{
      pointer-events: auto;
      background: #181818;
      border: 1px solid #333;
      color: #f5f5f5;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,.75);
      padding: 10px 12px;
      display:flex;
      gap:10px;
      align-items:flex-start;
    }
    .orca-toast__icon{
      width: 26px;
      height: 26px;
      border-radius: 999px;
      display:flex;
      align-items:center;
      justify-content:center;
      border: 1px solid rgba(148,163,184,.25);
      background: rgba(148,163,184,.08);
      flex: 0 0 auto;
      margin-top: 1px;
    }
    .orca-toast--ok .orca-toast__icon{
      border-color: rgba(16,163,127,.45);
      background: rgba(16,163,127,.12);
    }
    .orca-toast--warn .orca-toast__icon{
      border-color: rgba(245,158,11,.45);
      background: rgba(245,158,11,.12);
    }
    .orca-toast--err .orca-toast__icon{
      border-color: rgba(239,68,68,.45);
      background: rgba(239,68,68,.12);
    }
    .orca-toast__body{ flex: 1 1 auto; min-width:0; }
    .orca-toast__title{ margin:0; font-weight:700; font-size:.85rem; }
    .orca-toast__msg{ margin:2px 0 0; color:#cbd5e1; font-size:.85rem; line-height:1.25; }
    .orca-toast__close{
      border:1px solid #4b5563;
      background: transparent;
      color:#9ca3af;
      width:26px; height:26px;
      border-radius:999px;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      transition: background .12s ease, color .12s ease, border-color .12s ease;
      flex: 0 0 auto;
    }
    .orca-toast__close:hover{
      background:#303030;
      color:#e5e7eb;
      border-color:#9ca3af;
    }

    /* ===== CONFIRM / PROMPT ===== */
    .orca-confirm-backdrop{
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.72);
      z-index: 9998;
      display:flex;
      align-items:center;
      justify-content:center;
      padding: 14px;
    }
    .orca-confirm{
      width: 560px;
      max-width: 96vw;
      background:#181818;
      border:1px solid #3a3a3a;
      border-radius:18px;
      box-shadow: 0 20px 50px rgba(0,0,0,.82);
      padding: 14px 14px 12px;
    }
    .orca-confirm__head{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding-bottom:10px;
      border-bottom: 1px solid #333;
    }
    .orca-confirm__title{
      margin:0;
      font-size: 1rem;
      font-weight: 700;
      color:#f5f5f5;
    }
    .orca-confirm__close{
      width:28px; height:28px;
      border-radius:999px;
      border:1px solid #4b5563;
      background:transparent;
      color:#9ca3af;
      cursor:pointer;
      display:flex;
      align-items:center;
      justify-content:center;
    }
    .orca-confirm__close:hover{ background:#303030; color:#e5e7eb; border-color:#9ca3af; }

    .orca-confirm__msg{
      margin: 12px 0 0;
      color:#cbd5e1;
      font-size:.92rem;
      line-height:1.35;
    }

    .orca-confirm__input{
      margin-top: 10px;
      width: 100%;
      border-radius: 14px;
      border: 1px solid #333;
      background: #1f1f1f;
      color: #f5f5f5;
      padding: 10px 12px;
      outline: none;
      font-size: .95rem;
    }
    .orca-confirm__input:focus{
      border-color: rgba(16,163,127,.65);
      box-shadow: 0 0 0 3px rgba(16,163,127,.15);
    }

    .orca-confirm__foot{
      display:flex;
      justify-content:flex-end;
      gap:8px;
      padding-top: 12px;
      margin-top: 12px;
      border-top: 1px solid #333;
    }

    @media (max-width: 520px){
      .orca-confirm__foot{ flex-direction: column; }
      .orca-confirm__foot .btn-primary,
      .orca-confirm__foot .btn-secondary{ width:100%; justify-content:center; }
    }
    /* ===== MULTI (SEGMENTOS) ===== */
    .orca-multi{
      display:flex;
      flex-direction:column;
      gap:10px;
      padding:12px;
      border:1px solid #333;
      border-radius:14px;
      background: rgba(0,0,0,.08);
    }
    .orca-multi__row{
      display:flex;
      gap:10px;
      align-items:center;
    }
    .orca-multi__chips{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      min-height:40px;
      align-items:center;
    }
    .orca-chip{
      display:inline-flex;
      align-items:center;
      gap:10px;
      padding:6px 10px;
      border-radius:999px;
      border:1px solid #333;
      background:#181818;
      color:#f5f5f5;
      font-size:13px;
    }
    .orca-chip--empty{
      opacity:.75;
      background:transparent;
      border:1px dashed #3a3a3a;
    }
    .orca-chip__x{
      border:none;
      background:transparent;
      color:#cfcfcf;
      cursor:pointer;
      font-size:18px;
      line-height:1;
      padding:0;
      margin:0;
    }
    .orca-chip__x:hover{ color:#fff; }

    /* ===== GERENCIAR LISTA (SEGMENTOS) ===== */
    .orca-manage-list{
      display:flex;
      flex-direction:column;
      gap:8px;
      padding:10px 4px;
      max-height:52vh;
      overflow:auto;
      border-top:1px solid rgba(255,255,255,.08);
      border-bottom:1px solid rgba(255,255,255,.08);
      margin:10px 0;
    }
    .orca-manage-row{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:10px;
      padding:10px 12px;
      border:1px solid rgba(255,255,255,.08);
      border-radius:12px;
      background: rgba(0,0,0,.14);
    }
    .orca-manage-label{ color:#f5f5f5; }
    .orca-manage-empty{
      padding:14px 10px;
      color:#b0b0b0;
    }

  `;
  document.head.appendChild(style);
}

function ensureToastWrap() {
  ensureInlineUIStyles();
  let wrap = document.getElementById('orca-toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'orca-toast-wrap';
    wrap.className = 'orca-toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

function toast(msg, type = 'ok', title = null, timeoutMs = 2800) {
  const wrap = ensureToastWrap();

  const t = document.createElement('div');
  t.className = `orca-toast orca-toast--${type}`;

  const icon = document.createElement('div');
  icon.className = 'orca-toast__icon';
  icon.innerHTML =
    type === 'ok' ? '<i class="fa-solid fa-check"></i>' :
    type === 'warn' ? '<i class="fa-solid fa-triangle-exclamation"></i>' :
    '<i class="fa-solid fa-circle-xmark"></i>';

  const body = document.createElement('div');
  body.className = 'orca-toast__body';

  const h = document.createElement('p');
  h.className = 'orca-toast__title';
  h.textContent = title || (type === 'warn' ? 'Atenção' : type === 'err' ? 'Erro' : 'OK');

  const p = document.createElement('p');
  p.className = 'orca-toast__msg';
  p.textContent = msg;

  const close = document.createElement('button');
  close.className = 'orca-toast__close';
  close.type = 'button';
  close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  body.appendChild(h);
  body.appendChild(p);

  t.appendChild(icon);
  t.appendChild(body);
  t.appendChild(close);

  wrap.appendChild(t);

  const remove = () => { if (t.isConnected) t.remove(); };
  close.addEventListener('click', remove);
  if (timeoutMs > 0) setTimeout(remove, timeoutMs);
}

function confirmOrca(message, {
  title = 'Confirmar',
  okText = 'Confirmar',
  cancelText = 'Cancelar'
} = {}) {
  ensureInlineUIStyles();

  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'orca-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'orca-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'orca-confirm__head';

    const h = document.createElement('h3');
    h.className = 'orca-confirm__title';
    h.textContent = title;

    const x = document.createElement('button');
    x.className = 'orca-confirm__close';
    x.type = 'button';
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    head.appendChild(h);
    head.appendChild(x);

    const msg = document.createElement('p');
    msg.className = 'orca-confirm__msg';
    msg.textContent = message;

    const foot = document.createElement('div');
    foot.className = 'orca-confirm__foot';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = cancelText;

    const btnOk = document.createElement('button');
    btnOk.className = 'btn-primary';
    btnOk.type = 'button';
    btnOk.textContent = okText;

    foot.appendChild(btnCancel);
    foot.appendChild(btnOk);

    modal.appendChild(head);
    modal.appendChild(msg);
    modal.appendChild(foot);

    bd.appendChild(modal);
    document.body.appendChild(bd);
    document.body.classList.add('modal-open');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      bd.remove();
      document.removeEventListener('keydown', onKey);
    };

    const done = (v) => { cleanup(); resolve(v); };

    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);

    bd.addEventListener('click', (e) => { if (e.target === bd) done(false); });
    x.addEventListener('click', () => done(false));
    btnCancel.addEventListener('click', () => done(false));
    btnOk.addEventListener('click', () => done(true));

    setTimeout(() => btnOk.focus(), 0);
  });
}

function promptOrca(message, {
  title = 'Adicionar',
  okText = 'Adicionar',
  cancelText = 'Cancelar',
  placeholder = 'Digite...'
} = {}) {
  ensureInlineUIStyles();

  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'orca-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'orca-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'orca-confirm__head';

    const h = document.createElement('h3');
    h.className = 'orca-confirm__title';
    h.textContent = title;

    const x = document.createElement('button');
    x.className = 'orca-confirm__close';
    x.type = 'button';
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    head.appendChild(h);
    head.appendChild(x);

    const msg = document.createElement('p');
    msg.className = 'orca-confirm__msg';
    msg.textContent = message;

    const input = document.createElement('input');
    input.className = 'orca-confirm__input';
    input.type = 'text';
    input.placeholder = placeholder;

    const foot = document.createElement('div');
    foot.className = 'orca-confirm__foot';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = cancelText;

    const btnOk = document.createElement('button');
    btnOk.className = 'btn-primary';
    btnOk.type = 'button';
    btnOk.textContent = okText;

    foot.appendChild(btnCancel);
    foot.appendChild(btnOk);

    modal.appendChild(head);
    modal.appendChild(msg);
    modal.appendChild(input);
    modal.appendChild(foot);

    bd.appendChild(modal);
    document.body.appendChild(bd);
    document.body.classList.add('modal-open');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      bd.remove();
      document.removeEventListener('keydown', onKey);
    };

    const done = (v) => { cleanup(); resolve(v); };

    const onKey = (e) => {
      if (e.key === 'Escape') done(null);
      if (e.key === 'Enter') {
        const val = (input.value || '').trim();
        done(val || null);
      }
    };
    document.addEventListener('keydown', onKey);

    bd.addEventListener('click', (e) => { if (e.target === bd) done(null); });
    x.addEventListener('click', () => done(null));
    btnCancel.addEventListener('click', () => done(null));
    btnOk.addEventListener('click', () => {
      const val = (input.value || '').trim();
      done(val || null);
    });

    setTimeout(() => input.focus(), 0);
  });
}

/* =========================
   Helpers
========================= */

function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function getEl(id) { return document.getElementById(id); }

function isSim(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'sim' || s === 'true' || s === '1';
}

function updateProdutoControladoUI() {
  const v = getEl('campo-prod-controlado')?.value;
  const show = isSim(v);

  const ids = [
    'sec-prod-controlado-extra',
    'wrap-tipo-fiscalizacao',
    'wrap-dados-identificacao-controlado',
    'wrap-observacoes-controlado',
  ];

  ids.forEach(id => {
    const el = getEl(id);
    if (el) el.hidden = !show;
  });

  if (!show) {
    const tf = getEl('campo-tipo-fiscalizacao');
    const di = getEl('campo-dados-identificacao-controlado');
    const ob = getEl('campo-observacoes-controlado');
    if (tf) tf.value = '';
    if (di) di.value = '';
    if (ob) ob.value = '';
  }
}

/* =========================
   Movimentação (Entrada/Saída)
========================= */

function resetMovForm() {
  setVal('campo-mov-data', '');
  setVal('campo-mov-tipo', '');

  // Entrada
  setVal('campo-mov-entrada-tipo', '');
  setVal('campo-mov-qtd', '');
  setVal('campo-mov-fornecedor', '');
  setVal('campo-mov-doc-tipo', '');
  setVal('campo-mov-doc-numero', '');
  setVal('campo-mov-nfe-chave', '');

  // Saída
  setVal('campo-mov-saida-tipo', '');
  setVal('campo-mov-qtd-saida', '');
  setVal('campo-destino', '');
  setVal('campo-mov-cliente', '');
  setVal('campo-mov-departamento', '');
  setVal('campo-mov-doc-tipo-saida', '');
  setVal('campo-mov-doc-numero-saida', '');
  setVal('campo-mov-nfe-chave-saida', '');

  const anexos = getEl('campo-mov-anexos');
  if (anexos) anexos.value = '';

  updateMovUI();
}

function updateMovUI() {
  const tipo = (getEl('campo-mov-tipo')?.value || '').trim();

  const blocoEntrada = getEl('bloco-mov-entrada');
  const blocoSaida = getEl('bloco-mov-saida');

  if (blocoEntrada) blocoEntrada.hidden = tipo !== 'Entrada';
  if (blocoSaida) blocoSaida.hidden = tipo !== 'Saida';

  // NF-e: mostra chave quando doc = Nota Fiscal
  const docEntrada = (getEl('campo-mov-doc-tipo')?.value || '').trim();
  const nfeEntrada = getEl('bloco-mov-nfe-entrada');
  if (nfeEntrada) nfeEntrada.hidden = docEntrada !== 'Nota Fiscal';

  const docSaida = (getEl('campo-mov-doc-tipo-saida')?.value || '').trim();
  const nfeSaida = getEl('bloco-mov-nfe-saida');
  if (nfeSaida) nfeSaida.hidden = docSaida !== 'Nota Fiscal';

  // Saída: destino condiciona cliente / departamento / docs
  const destino = (getEl('campo-destino')?.value || '').trim();

  const bCli = getEl('bloco-mov-saida-cliente');
  const bDep = getEl('bloco-mov-saida-dep');
  const bDocs = getEl('bloco-mov-saida-docs');

  const precisaCliente = destino === 'Venda' || destino === 'Patrimônio/Comodato';
  const precisaDep = destino === 'Uso Interno';
  const precisaDocs = destino === 'Baixa/Descarte' || destino === 'Doação';

  if (bCli) bCli.hidden = !precisaCliente;
  if (bDep) bDep.hidden = !precisaDep;
  if (bDocs) bDocs.hidden = !precisaDocs;
}

function _formatMovItem(m, idx) {
  const dt = m.data_mov ? formatDateBR(m.data_mov) : '-';
  const tipo = m.tipo_mov || '-';
  const qtd = (m.quantidade != null && m.quantidade !== '') ? String(m.quantidade) : '-';

  let extra = '';
  if (tipo === 'Entrada') {
    extra = [m.fornecedor, m.tipo_entrada].filter(Boolean).join(' • ');
  } else if (tipo === 'Saida') {
    extra = [m.destino, m.tipo_saida].filter(Boolean).join(' • ');
    if (m.cliente) extra += ` • Cliente: ${m.cliente}`;
    if (m.departamento) extra += ` • Dep: ${m.departamento}`;
  }

  const doc = [m.tipo_documento, m.numero_doc].filter(Boolean).join(' ');
  const docTxt = doc ? ` • Doc: ${doc}` : '';

  return `
    <div class="orca-mov-item">
      <div class="orca-mov-item__main">
        <div class="orca-mov-item__title">${dt} • <b>${tipo}</b> • Qtd: ${qtd}${docTxt}</div>
        <div class="orca-mov-item__sub">${escapeHtml(extra || '')}</div>
      </div>
      <button type="button" class="orca-btn orca-btn--ghost orca-btn--icon" data-mov-del="${idx}" title="Apagar movimentação">✕</button>
    </div>
  `;
}

function renderMovimentacoes() {
  const wrap = getEl('lista-movimentacoes');
  if (!wrap) return;

  if (!Array.isArray(MOVIMENTACOES_ATUAIS) || MOVIMENTACOES_ATUAIS.length === 0) {
    wrap.innerHTML = '<div class="orca-mov-empty">Sem movimentações registradas.</div>';
    return;
  }

  wrap.innerHTML = MOVIMENTACOES_ATUAIS
    .map((m, idx) => _formatMovItem(m, idx))
    .join('');

  // bind delete
  wrap.querySelectorAll('[data-mov-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.getAttribute('data-mov-del'));
      if (Number.isNaN(i)) return;
      MOVIMENTACOES_ATUAIS.splice(i, 1);
      renderMovimentacoes();
    });
  });
}

function _loadClientesToDatalist() {
  const dl = getEl('datalist-clientes');
  if (!dl) return;

  const keys = [
    'orcapro_clientes_v2',
    'orcapro_clientes_v1',
    'orcapro_clientes',
    'orcapro_clientes_v0'
  ];

  let arr = [];
  for (const k of keys) {
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) { arr = parsed; break; }
      if (parsed && Array.isArray(parsed.items)) { arr = parsed.items; break; }
    } catch (_e) {}
  }

  const nomes = [];
  (arr || []).forEach(c => {
    if (!c || typeof c !== 'object') return;
    const n = (c.razao_social || c.nome_fantasia || c.nome || c.nome_cliente || '').toString().trim();
    if (n) nomes.push(n);
  });

  const uniq = Array.from(new Set(nomes.map(n => n.trim()))).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  dl.innerHTML = uniq.map(n => `<option value="${escapeHtml(n)}"></option>`).join('');
}

function lerMovForm() {
  const data_mov = getEl('campo-mov-data')?.value || '';
  const tipo_mov = (getEl('campo-mov-tipo')?.value || '').trim();

  if (!data_mov || !tipo_mov) {
    toast('Preencha Data e Tipo de Movimento.', 'warn', 'Movimentação');
    return null;
  }

  if (tipo_mov === 'Entrada') {
    const tipo_entrada = (getEl('campo-mov-entrada-tipo')?.value || '').trim();
    const quantidade = intOrNull(getEl('campo-mov-qtd')?.value);
    const fornecedor = (getEl('campo-mov-fornecedor')?.value || '').trim();
    const tipo_documento = (getEl('campo-mov-doc-tipo')?.value || '').trim();
    const numero_doc = (getEl('campo-mov-doc-numero')?.value || '').trim();
    const chave_nfe = (getEl('campo-mov-nfe-chave')?.value || '').trim();

    if (!quantidade || quantidade <= 0) {
      toast('Informe a Quantidade (Entrada).', 'warn', 'Movimentação');
      return null;
    }

    return {
      data_mov,
      tipo_mov,
      tipo_entrada,
      quantidade,
      fornecedor,
      tipo_documento,
      numero_doc,
      chave_nfe
    };
  }

  // Saída
  const tipo_saida = (getEl('campo-mov-saida-tipo')?.value || '').trim();
  const quantidade = intOrNull(getEl('campo-mov-qtd-saida')?.value);
  const destino = (getEl('campo-destino')?.value || '').trim();

  const cliente = (getEl('campo-mov-cliente')?.value || '').trim();
  const departamento = (getEl('campo-mov-departamento')?.value || '').trim();

  const tipo_documento = (getEl('campo-mov-doc-tipo-saida')?.value || '').trim();
  const numero_doc = (getEl('campo-mov-doc-numero-saida')?.value || '').trim();
  const chave_nfe = (getEl('campo-mov-nfe-chave-saida')?.value || '').trim();

  const anexosEl = getEl('campo-mov-anexos');
  const anexos = anexosEl && anexosEl.files ? Array.from(anexosEl.files).map(f => f.name) : [];

  if (!quantidade || quantidade <= 0) {
    toast('Informe a Quantidade (Saída).', 'warn', 'Movimentação');
    return null;
  }

  return {
    data_mov,
    tipo_mov,
    tipo_saida,
    quantidade,
    destino,
    cliente,
    departamento,
    tipo_documento,
    numero_doc,
    chave_nfe,
    anexos
  };
}

function initMovimentacaoUI() {
  const selTipo = getEl('campo-mov-tipo');
  const docEntrada = getEl('campo-mov-doc-tipo');
  const docSaida = getEl('campo-mov-doc-tipo-saida');
  const destino = getEl('campo-destino');

  if (selTipo) selTipo.addEventListener('change', updateMovUI);
  if (docEntrada) docEntrada.addEventListener('change', updateMovUI);
  if (docSaida) docSaida.addEventListener('change', updateMovUI);
  if (destino) destino.addEventListener('change', updateMovUI);

  const btnAdd = getEl('btn-add-mov');
  const btnLimpar = getEl('btn-limpar-mov');
  if (btnAdd) btnAdd.addEventListener('click', () => {
    const mov = lerMovForm();
    if (!mov) return;

    MOVIMENTACOES_ATUAIS.push(mov);
    renderMovimentacoes();

    // Atualiza "Último Fornecedor" e "Última Compra" automaticamente na Entrada
    if (mov.tipo_mov === 'Entrada' && mov.fornecedor) {
      setVal('campo-ultimo-fornecedor', mov.fornecedor);
      // data_ultima_compra = data_mov (data)
      try {
        const d = new Date(mov.data_mov);
        if (!Number.isNaN(d.getTime())) {
          const isoDate = d.toISOString().slice(0,10);
          setVal('campo-ultima-compra', isoDate);
        }
      } catch (_e) {}
    }

    resetMovForm();
    toast('Movimentação adicionada.', 'success', 'OK');
  });

  if (btnLimpar) btnLimpar.addEventListener('click', resetMovForm);

  const btnDanfeE = getEl('btn-buscar-danfe-entrada');
  const btnDanfeS = getEl('btn-buscar-danfe-saida');
  if (btnDanfeE) btnDanfeE.addEventListener('click', () => {
    toast('Consulta DANFE é manual por enquanto (módulo futuro).', 'info', 'Em breve');
    window.open('https://www.nfe.fazenda.gov.br/portal/principal.aspx', '_blank');
  });
  if (btnDanfeS) btnDanfeS.addEventListener('click', () => {
    toast('Consulta DANFE é manual por enquanto (módulo futuro).', 'info', 'Em breve');
    window.open('https://www.nfe.fazenda.gov.br/portal/principal.aspx', '_blank');
  });

  const btnUltPedido = getEl('btn-buscar-ultimo-pedido');
  const btnUltNF = getEl('btn-buscar-ultima-nf');
  if (btnUltPedido) btnUltPedido.addEventListener('click', () => toast('Módulo de Pedido de Compras ainda não implementado.', 'info', 'Uso futuro'));
  if (btnUltNF) btnUltNF.addEventListener('click', () => toast('Módulo de Pedido de Compras ainda não implementado.', 'info', 'Uso futuro'));

  updateMovUI();
  _loadClientesToDatalist();
}




function numOrNull(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v) {
  const n = numOrNull(v);
  return n == null ? null : Math.trunc(n);
}

function formatDateOnlyBR(yyyyMMdd) {
  const s = String(yyyyMMdd || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s ? s : '-';
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function formatDateBR(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

/* =========================
   Listas (SELECT) + Adicionar…
========================= */

const LISTS_DEFAULT = {
  origem: ['Nacional', 'Importado'],

  status_atual: ['Ativo', 'Inativo', 'Fora de Linha', 'Suspenso'],
  tipo_mercado: ['Mercado Continuo', 'Mercado Sazional'],
  utilizacao: ['Revenda', 'Consumo Próprio', 'Patrimonio', 'Armazenamento p/ Terceiros'],
  tipo_material: ['Pronta Utilização (Acabado)', 'Semi Acabado', 'Materia Prima'],
  tipo_fiscalizacao: ['Exército', 'Polícia Federal', 'ANATEL', 'ANVISA', 'Ibama', 'CNEN'],


  sim_nao: ['Sim', 'Não'],

  segmentos: [
    'Segurança Predial',
    'Prevenção Incendio',
    'Controle de Acesso',
    'Automação (IOT)',
    'Automatização',
    'Prevenção Perdas',
    'Proteção Individual',
    'Telemetria / Supervisão Remota',
    'Segurança Veicular',
    'Soluções PET',
    'Soluções AgroNegocios',
    'Monitoramento Patriminial 24hs',
    'Tele Assistencia Pessoal',
    'Portaria Remota',
    'Rastreamento Veicular',
    'Acompanhamento e Localização PET',
    'Chegada /Saida Assistida Pessoal',
    'Acompanhamento Proteção Individual'
  ],

  classe: [
    'Centrais de Comando',
    'Sensores',
    'Atudores',
    'Acumuladores de Energia',
    'Sinalizadores',
    'Cabeamento',
    'Terminais / Conexões',
    'Tubulações',
    'Transmissão Remota'
  ],

  fornecedor: [
    'Distribuidora Só Portões - Taubaté',
    'Distribuidora Só Portões - SJC',
    'Distribuidora BJ Taubaté',
    'Distribuidora BJ SJC',
    'Distribuidora Route 66 - SJC',
    'Distribuidora Farias',
    'Distribuidora Houter'
  ],

  tipo_armaz: [
    'Fisico Local',
    'Fisico Remoto',
    'Dropshipping (Fornecedor)',
    'Virtual'
  ],

  cores_disponiveis: ['Variadas', 'Cinza', 'Preto', 'Branco', 'Creme'],

  unidade_peso: ['kg', 'g', 'L', 'm³', 'mL', 'm', 'cm', 'mm'],

  cst_padrao: [
    { value: '00', label: 'Tributada Integralmente' },
    { value: '10', label: 'Tributada com ICMS por Substituição' },
    { value: '20', label: 'Tributada com Redução Base Calc.' },
    { value: '30', label: 'Isenta Tribut. c/Base ICMS Subist.' },
    { value: '40', label: 'Isenta de Tributação' },
    { value: '41', label: 'Não Tributada' },
    { value: '50', label: 'Tributação Suspensa' }
  ],

  destino: ['Venda', 'Patrimônio/Comodato', 'Uso Interno', 'Baixa/Descarte', 'Doação'],

  departamentos: ['Administrativo', 'Operações', 'Financeiro', 'Comercial', 'TI']

};

let LISTS_STATE = null;
let MOVIMENTACOES_ATUAIS = []; // lista de movimentações do produto (no modal)

const BOUND_SELECTS = []; // { el, listKey, cfg }

function _dedupeKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  (arr || []).forEach(x => {
    const s = String(x ?? '').trim();
    if (!s) return;
    const k = s.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  });
  return out;
}

function loadLists() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LISTS_KEY) || '{}') || {}; } catch { saved = {}; }

  const merged = { ...LISTS_DEFAULT, ...saved };

  for (const k of Object.keys(merged)) {
    if (Array.isArray(merged[k]) && merged[k].length && typeof merged[k][0] === 'string') {
      merged[k] = _dedupeKeepOrder(merged[k]);
    }
  }
  return merged;
}

function saveLists() {
  try { localStorage.setItem(LISTS_KEY, JSON.stringify(LISTS_STATE || {})); } catch {}
}

function renderSelectOptions(selectEl, listKey, { placeholder = '—', allowAdd = true } = {}) {
  const list = LISTS_STATE?.[listKey] || [];
  const current = selectEl.value;

  const opts = [];
  opts.push(`<option value="">${escapeHTML(placeholder)}</option>`);

  list.forEach(item => {
    if (typeof item === 'string') {
      const v = item;
      opts.push(`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`);
    } else if (item && typeof item === 'object') {
      const v = String(item.value ?? '').trim();
      const l = String(item.label ?? '').trim() || v;
      if (v) opts.push(`<option value="${escapeHTML(v)}">${escapeHTML(l)}</option>`);
    }
  });

  if (allowAdd) opts.push(`<option value="__add__">➕ Adicionar…</option>`);

  selectEl.innerHTML = opts.join('');
  selectEl.value = current;
}

function refreshAllSelectsOf(listKey) {
  BOUND_SELECTS.forEach(b => {
    if (b.listKey === listKey) renderSelectOptions(b.el, b.listKey, b.cfg);
  });
}

function bindSelectList(selectId, listKey, cfg = {}) {
  const el = getEl(selectId);
  if (!el) return;

  renderSelectOptions(el, listKey, cfg);
  el.dataset._prev = el.value || '';

  BOUND_SELECTS.push({ el, listKey, cfg });

  el.addEventListener('change', async () => {
    if (el.value !== '__add__') {
      el.dataset._prev = el.value || '';
      return;
    }

    const prev = el.dataset._prev || '';
    el.value = prev; // volta já

    const novo = await promptOrca('Digite a nova opção para esta lista:', {
      title: 'Adicionar opção',
      okText: 'Adicionar',
      cancelText: 'Cancelar',
      placeholder: 'Ex: Talvez'
    });

    if (!novo) return;

    if (!Array.isArray(LISTS_STATE[listKey])) LISTS_STATE[listKey] = [];
    const list = LISTS_STATE[listKey];

    if (list.length && typeof list[0] === 'object') {
      list.push({ value: novo, label: novo });
    } else {
      list.push(novo);
      LISTS_STATE[listKey] = _dedupeKeepOrder(list);
    }

    saveLists();
    refreshAllSelectsOf(listKey);

    el.value = novo;
    el.dataset._prev = novo;
    toast('Opção adicionada na lista.', 'ok');
  });
}

/* =========================
   Segmentos (multi + criar + apagar)
========================= */

let SELECTED_SEGMENTOS = [];

function normalizeSegmentosValue(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map(x => String(x || '').trim()).filter(Boolean);
  }
  const s = String(v || '').trim();
  return s ? [s] : [];
}

function setSegmentosSelection(v) {
  SELECTED_SEGMENTOS = _dedupeKeepOrder(normalizeSegmentosValue(v));
  renderSegmentosChips();
}

function getSelectedSegmentos() {
  return (SELECTED_SEGMENTOS || []).slice();
}

function addSegmentoToSelection(v) {
  const s = String(v || '').trim();
  if (!s) return;
  if (!SELECTED_SEGMENTOS.includes(s)) SELECTED_SEGMENTOS.push(s);
  SELECTED_SEGMENTOS = _dedupeKeepOrder(SELECTED_SEGMENTOS);
  renderSegmentosChips();
}

function renderSegmentosChips() {
  const wrap = getEl('chips-segmentos');
  if (!wrap) return;

  wrap.innerHTML = '';

  if (!SELECTED_SEGMENTOS.length) {
    const empty = document.createElement('div');
    empty.className = 'orca-chip orca-chip--empty';
    empty.textContent = 'Nenhum segmento selecionado';
    wrap.appendChild(empty);
    return;
  }

  SELECTED_SEGMENTOS.forEach(seg => {
    const chip = document.createElement('span');
    chip.className = 'orca-chip';
    chip.innerHTML = `
      <span class="orca-chip__txt">${escapeHTML(seg)}</span>
      <button type="button" class="orca-chip__x" title="Remover">×</button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      SELECTED_SEGMENTOS = SELECTED_SEGMENTOS.filter(x => x !== seg);
      renderSegmentosChips();
    });
    wrap.appendChild(chip);
  });
}

function setupSegmentosMulti() {
  const sel = getEl('campo-segmentos-add');
  if (!sel) return;

  ensureInlineUIStyles();

  const cfg = { placeholder: 'Selecione...', allowAdd: true };
  renderSelectOptions(sel, 'segmentos', cfg);

  // permite atualizar este select quando a lista mudar
  BOUND_SELECTS.push({ el: sel, listKey: 'segmentos', cfg });

  sel.value = '';

  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (!v) return;

    if (v === '__add__') {
      sel.value = '';
      const novo = await promptOrca('Digite o novo segmento:', {
        title: 'Novo segmento',
        okText: 'Criar',
        cancelText: 'Cancelar',
        placeholder: 'Ex: Segurança Predial'
      });

      if (!novo) return;

      if (!Array.isArray(LISTS_STATE.segmentos)) LISTS_STATE.segmentos = [];
      const list = LISTS_STATE.segmentos;

      if (list.length && typeof list[0] === 'object') {
        list.push({ value: novo, label: novo });
      } else {
        list.push(novo);
        LISTS_STATE.segmentos = _dedupeKeepOrder(list);
      }

      saveLists(LISTS_STATE);
      refreshAllSelectsOf('segmentos');

      addSegmentoToSelection(novo);
      toast('Segmento criado.', 'ok');
      return;
    }

    addSegmentoToSelection(v);
    sel.value = '';
  });

  const btn = getEl('btn-gerenciar-segmentos');
  if (btn && !btn.dataset._bound) {
    btn.dataset._bound = '1';
    btn.addEventListener('click', () => openManageSegmentosModal());
  }

  renderSegmentosChips();
}

async function openManageSegmentosModal() {
  ensureInlineUIStyles();

  const listKey = 'segmentos';

  const bd = document.createElement('div');
  bd.className = 'orca-confirm-backdrop';

  const modal = document.createElement('div');
  modal.className = 'orca-confirm-modal';
  modal.style.maxWidth = '560px';

  modal.innerHTML = `
    <div class="orca-confirm-head">
      <div class="orca-confirm-title">Gerenciar segmentos</div>
      <div class="orca-confirm-sub">
        Apague os segmentos cadastrados errado. Isso também remove do produto atual.
      </div>
    </div>

    <div class="orca-manage-list" id="orca-manage-seg-list"></div>

    <div class="orca-confirm-actions">
      <button class="orca-btn orca-btn--ghost" data-act="fechar">Fechar</button>
    </div>
  `;

  bd.appendChild(modal);
  document.body.appendChild(bd);

  const close = () => { if (bd.isConnected) bd.remove(); };
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  modal.querySelector('[data-act="fechar"]').addEventListener('click', close);

  const listEl = modal.querySelector('#orca-manage-seg-list');

  const getRawList = () => (Array.isArray(LISTS_STATE?.[listKey]) ? LISTS_STATE[listKey] : []);
  const toValue = (x) => (typeof x === 'object' ? (x.value || x.label || '') : String(x || '')).trim();
  const toLabel = (x) => (typeof x === 'object' ? (x.label || x.value || '') : String(x || '')).trim();

  const render = () => {
    const raw = getRawList();
    const items = raw.map(x => ({ value: toValue(x), label: toLabel(x) })).filter(x => x.value);

    listEl.innerHTML = '';

    if (!items.length) {
      listEl.innerHTML = `<div class="orca-manage-empty">Nenhum segmento cadastrado.</div>`;
      return;
    }

    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'orca-manage-row';
      row.innerHTML = `
        <div class="orca-manage-label">${escapeHTML(it.label)}</div>
        <button type="button" class="orca-icon-btn" title="Apagar">
          <i class="fa-solid fa-trash"></i>
        </button>
      `;

      row.querySelector('button').addEventListener('click', async () => {
        const ok = await confirmOrca(`Apagar o segmento "${it.label}"?`, {
          title: 'Apagar segmento',
          okText: 'Apagar',
          cancelText: 'Cancelar'
        });
        if (!ok) return;

        // remove do catálogo
        const rawNow = getRawList();
        LISTS_STATE[listKey] = rawNow.filter(x => String(toValue(x)) !== String(it.value));
        saveLists(LISTS_STATE);
        refreshAllSelectsOf(listKey);

        // remove do produto atual
        SELECTED_SEGMENTOS = SELECTED_SEGMENTOS.filter(s => String(s) !== String(it.value));
        renderSegmentosChips();

        // remove do localStorage (se existir)
        removeSegmentoFromProdutosLocal(String(it.value));

        toast('Segmento apagado.', 'ok');
        render();
      });

      listEl.appendChild(row);
    });
  };

  render();
}

function removeSegmentoFromProdutosLocal(seg) {
  const alvo = String(seg || '').trim();
  if (!alvo) return;

  // memória (tela)
  try {
    if (Array.isArray(produtos)) {
      let changed = false;
      produtos = produtos.map(p => {
        const arr = normalizeSegmentosValue(p.segmentos);
        if (!arr.includes(alvo)) return p;
        changed = true;
        return { ...p, segmentos: arr.filter(x => x !== alvo) };
      });
      if (changed) renderTabela();
    }
  } catch { /* ignore */ }

  // localStorage
  const local = loadLocal();
  if (Array.isArray(local)) {
    let changed = false;
    const out = local.map(p => {
      const arr = normalizeSegmentosValue(p.segmentos);
      if (!arr.includes(alvo)) return p;
      changed = true;
      return { ...p, segmentos: arr.filter(x => x !== alvo) };
    });
    if (changed) saveLocal(out);
  }
}


/* =========================
   Fornecedores (multi + criar + apagar)
========================= */

let SELECTED_FORNECEDORES = [];

function normalizeFornecedoresValue(v) {
  if (v == null) return [];
  if (Array.isArray(v)) {
    return v.map(x => String(x || '').trim()).filter(Boolean);
  }
  const s = String(v || '').trim();
  return s ? [s] : [];
}

function setFornecedoresSelection(v) {
  SELECTED_FORNECEDORES = _dedupeKeepOrder(normalizeFornecedoresValue(v));
  renderFornecedoresChips();
}

function getSelectedFornecedores() {
  return _dedupeKeepOrder(SELECTED_FORNECEDORES || []);
}

function addFornecedorToSelection(v) {
  const val = String(v || '').trim();
  if (!val) return;
  const cur = getSelectedFornecedores();
  if (!cur.includes(val)) cur.push(val);
  SELECTED_FORNECEDORES = cur;
  renderFornecedoresChips();
}

function renderFornecedoresChips() {
  const wrap = getEl('chips-fornecedores');
  if (!wrap) return;

  wrap.innerHTML = '';
  const list = getSelectedFornecedores();

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'orca-multi__empty';
    empty.textContent = 'Nenhum fornecedor selecionado.';
    wrap.appendChild(empty);
    return;
  }

  list.forEach(nome => {
    const chip = document.createElement('span');
    chip.className = 'orca-chip';
    chip.innerHTML = `
      <span class="orca-chip__text">${escapeHTML(nome)}</span>
      <button type="button" class="orca-chip__x" title="Remover">×</button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      SELECTED_FORNECEDORES = SELECTED_FORNECEDORES.filter(x => x !== nome);
      renderFornecedoresChips();
    });
    wrap.appendChild(chip);
  });
}

function setupFornecedoresMulti() {
  const sel = getEl('campo-fornecedores-add');
  if (!sel) return;

  ensureInlineUIStyles();

  const listKey = 'fornecedor';
  const cfg = { placeholder: '—', allowAdd: true };

  renderSelectOptions(sel, listKey, cfg);

  // permite atualizar este select quando a lista mudar
  BOUND_SELECTS.push({ el: sel, listKey, cfg });

  sel.value = '';

  sel.addEventListener('change', async () => {
    const v = sel.value;
    if (!v) return;

    if (v === '__add__') {
      sel.value = '';
      const novo = await promptOrca('Digite o nome do fornecedor:', { title: 'Novo fornecedor' });
      const val = String(novo || '').trim();
      if (!val) return;

      const cur = Array.isArray(LISTS_STATE?.[listKey]) ? LISTS_STATE[listKey].slice() : [];
      if (!cur.includes(val)) cur.push(val);
      LISTS_STATE[listKey] = _dedupeKeepOrder(cur);
      saveLists();
      refreshAllSelectsOf(listKey);

      addFornecedorToSelection(val);
      toast('Fornecedor adicionado na lista.', 'ok');
      return;
    }

    addFornecedorToSelection(v);
    sel.value = '';
  });

  const btn = getEl('btn-gerenciar-fornecedores');
  if (btn && !btn.dataset._bound) {
    btn.dataset._bound = '1';
    btn.addEventListener('click', () => openManageFornecedoresModal());
  }

  renderFornecedoresChips();
}

async function openManageFornecedoresModal() {
  ensureInlineUIStyles();

  const listKey = 'fornecedor';

  const bd = document.createElement('div');
  bd.className = 'orca-confirm-backdrop';

  const modal = document.createElement('div');
  modal.className = 'orca-confirm';
  modal.innerHTML = `
    <div class="orca-confirm-head">
      <div class="orca-confirm-title">Gerenciar fornecedores</div>
      <div class="orca-confirm-sub">
        Apague fornecedores cadastrados errado. Isso também remove do produto atual.
      </div>
    </div>

    <div class="orca-manage-list" id="orca-manage-forn-list"></div>

    <div class="orca-confirm-actions">
      <button class="orca-btn orca-btn--ghost" data-act="fechar">Fechar</button>
    </div>
  `;

  bd.appendChild(modal);
  document.body.appendChild(bd);

  const close = () => { if (bd.isConnected) bd.remove(); };
  bd.addEventListener('click', e => { if (e.target === bd) close(); });
  modal.querySelector('[data-act="fechar"]').addEventListener('click', close);

  const listEl = modal.querySelector('#orca-manage-forn-list');

  const getRawList = () => (Array.isArray(LISTS_STATE?.[listKey]) ? LISTS_STATE[listKey] : []);
  const toValue = (x) => (typeof x === 'object' ? (x.value || x.label || '') : String(x || '')).trim();
  const toLabel = (x) => (typeof x === 'object' ? (x.label || x.value || '') : String(x || '')).trim();

  const render = () => {
    const raw = getRawList();
    const items = raw.map(x => ({ value: toValue(x), label: toLabel(x) })).filter(x => x.value);

    if (!items.length) {
      listEl.innerHTML = `<div class="orca-multi__empty">Nenhum fornecedor cadastrado.</div>`;
      return;
    }

    listEl.innerHTML = '';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'orca-manage-row';
      row.innerHTML = `
        <div class="orca-manage-label">${escapeHTML(it.label || it.value)}</div>
        <button class="orca-btn orca-btn--danger" type="button">Apagar</button>
      `;

      row.querySelector('button').addEventListener('click', async () => {
        const ok = await confirmOrca(`Apagar o fornecedor “${it.label || it.value}”?`, {
          title: 'Confirmar exclusão',
          okText: 'Apagar',
          cancelText: 'Cancelar'
        });
        if (!ok) return;

        // remove do catálogo
        LISTS_STATE[listKey] = getRawList().filter(x => toValue(x) !== it.value);
        saveLists();
        refreshAllSelectsOf(listKey);

        // remove do produto atual (seleção)
        SELECTED_FORNECEDORES = getSelectedFornecedores().filter(x => x !== String(it.value));

        // remove de todos os produtos do localStorage (se existir)
        removeFornecedorFromProdutosLocal(String(it.value));

        toast('Fornecedor apagado.', 'ok');
        render();
        renderFornecedoresChips();
      });

      listEl.appendChild(row);
    });
  };

  render();
}

function removeFornecedorFromProdutosLocal(nome) {
  const alvo = String(nome || '').trim();
  if (!alvo) return;

  // memória (tela)
  try {
    if (Array.isArray(produtos)) {
      let changed = false;
      produtos = produtos.map(p => {
        const arr = normalizeFornecedoresValue(p.fornecedores ?? p.fornecedor);
        if (!arr.includes(alvo)) return p;
        changed = true;
        const outArr = arr.filter(x => x !== alvo);
        return { ...p, fornecedores: outArr, fornecedor: (outArr[0] || '') };
      });
      if (changed) renderTabela();
    }
  } catch { /* ignore */ }

  // localStorage
  const local = loadLocal();
  if (Array.isArray(local)) {
    let changed = false;
    const out = local.map(p => {
      const arr = normalizeFornecedoresValue(p.fornecedores ?? p.fornecedor);
      if (!arr.includes(alvo)) return p;
      changed = true;
      const outArr = arr.filter(x => x !== alvo);
      return { ...p, fornecedores: outArr, fornecedor: (outArr[0] || '') };
    });
    if (changed) saveLocal(out);
  }
}

function formatFornecedoresDisplay(p) {
  const arr = normalizeFornecedoresValue(p?.fornecedores ?? p?.fornecedor);
  return arr.length ? arr.join(', ') : '-';
}



function setupProdutoLists() {
  LISTS_STATE = loadLists();

  // filtros
  bindSelectList('filtro-origem-produto', 'origem', { placeholder: 'Todas', allowAdd: true });

  // modal
  bindSelectList('campo-origem', 'origem', { placeholder: '—', allowAdd: true });

  // Último fornecedor / movimentação
  bindSelectList('campo-ultimo-fornecedor', 'fornecedores', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-mov-fornecedor', 'fornecedores', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-mov-departamento', 'departamentos', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-status-atual', 'status_atual', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-tipo-mercado', 'tipo_mercado', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-utilizacao', 'utilizacao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-tipo-material', 'tipo_material', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-prod-controlado', 'sim_nao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-tipo-fiscalizacao', 'tipo_fiscalizacao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-possui-validade', 'sim_nao', { placeholder: '—', allowAdd: true });

  setupSegmentosMulti();

  bindSelectList('campo-classe', 'classe', { placeholder: '—', allowAdd: true });
  setupFornecedoresMulti();
  bindSelectList('campo-tipo-armaz', 'tipo_armaz', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-cores-disponiveis', 'cores_disponiveis', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-peso-logistico-unidade', 'unidade_peso', { placeholder: 'Selecione', allowAdd: true });
bindSelectList('campo-cst-icms', 'cst_padrao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-cst-pis', 'cst_padrao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-cst-cofins', 'cst_padrao', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-destino', 'destino', { placeholder: '—', allowAdd: true });
}

/* =========================
   Dados (seed)
========================= */

const produtosFake = [
  {
    id: 1,
    data_cadastro: '2026-01-05T10:12:00Z',
    cod_ref_id: 'ALM-001',
    codigo_barras: '7890000000001',
    nome_generico: 'Central de alarme',
    nome_produto: 'Central de alarme 8 setores',
    fabricante: 'Intelbras',
    modelo: 'AMT 2018 E',
    cod_ref_fabric: 'INT-2018E',
    origem: 'Nacional',

    status_atual: 'Ativo',
    tipo_mercado: 'Mercado Continuo',
    utilizacao: 'Revenda',
    tipo_material: 'Pronta Utilização (Acabado)',

    prod_controlado: 'Não',
    tipo_fiscalizacao: '',
    dados_identificacao_controlado: '',
    observacoes_controlado: '',
    segmentos: ['Segurança Predial'],
    tipo_sistema: 'Alarme',
    classe: 'Centrais de Comando',
    categorias: 'Central',
    subcategoria: '8 setores',

    fornecedor: 'Distribuidora Houter',
    ultima_compra: '2026-01-03',

    tipo_armaz: 'Fisico Local',
    armaz_localiz: 'Corredor A / Prat. 3',
    tipo_logistico: 'Normal',
    peso_logistico: 1.25,
    peso_logistico_unidade: 'kg',
    tamanho_logistico: '20x15x10',
    embalagem_compra: 'Caixa 1 un',
    embalagem_armazem: 'Caixa',
    embalagem_saida: 'Unidade',
    estoque_minimo: 2,
    estoque_maximo: 20,
    quantidade_atual: 7,

    possui_validade: 'Não',
    tipo_tecnico: 'Eletrônico',
    peso_tecnico: 1.2,
    peso_tecnico_unidade: 'kg',
    tamanho_tecnico: '20x15x10',
    cores_disponiveis: 'Branco',
    imagens_produto: 'https://exemplo.com/img1\nhttps://exemplo.com/img2',
    videos_produto: '',
    fichas_tecnica: '',
    manuais_instalacao: '',
    manuais_programacao: '',
    manuais_usuario: '',

    classif_ncm_bbm: '8531.10.90',
    aliq_ipi_entrada: 0.0,
    aliq_iva: 0.0,
    cst_icms: '00',
    cst_pis: '01',
    cst_cofins: '01',

    valor_custo: 450.0,
    mark_up: 1.8,
    custo_efetivo: 480.0,
    mc_lucro: 120.0,
    imp_importacao: 0.0,
    ipi: 0.0,
    icms: 0.0,
    simples: 0.0,
    luc_presumido: 0.0,

    entrada_estoque: 10,
    saida_estoque: 3,
    destino: 'Cliente'
  }
];

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}
function saveLocal(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || [])); } catch {}
}

function normalizeProduto(p) {
  const obj = { ...(p || {}) };

  if (!obj.id) obj.id = 0;
  if (!obj.data_cadastro) obj.data_cadastro = null;

  // Segmentos: aceita string (legado) ou array (novo)
  if (obj.segmentos == null) {
    obj.segmentos = [];
  } else if (Array.isArray(obj.segmentos)) {
    obj.segmentos = obj.segmentos.map(x => String(x || '').trim()).filter(Boolean);
  } else {
    const s = String(obj.segmentos || '').trim();
    obj.segmentos = s ? [s] : [];
  }

  return obj;
}

/* =========================
   API (fallback)
========================= */

let API_DISPONIVEL = null;

async function safeReadJson(res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  try { return await res.text(); } catch { return null; }
}

async function carregarProdutos() {
  if (API_DISPONIVEL === false) {
    const local = loadLocal();
    if (local && local.length) return local.map(normalizeProduto);
    saveLocal(produtosFake);
    return produtosFake.map(normalizeProduto);
  }

  try {
    const res = await fetch(API_PRODUTOS, { method: 'GET' });

    if (res.ok) {
      API_DISPONIVEL = true;
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      return arr.map(normalizeProduto);
    }

    if (res.status === 404) {
      API_DISPONIVEL = false;
      const local = loadLocal();
      if (local && local.length) return local.map(normalizeProduto);
      saveLocal(produtosFake);
      return produtosFake.map(normalizeProduto);
    }

    const detalhe = await safeReadJson(res);
    logWarn('Falha ao carregar via API:', res.status, detalhe);
    API_DISPONIVEL = false;

    const local = loadLocal();
    if (local && local.length) return local.map(normalizeProduto);
    saveLocal(produtosFake);
    return produtosFake.map(normalizeProduto);
  } catch (err) {
    logWarn('Erro de rede ao carregar via API:', err);
    API_DISPONIVEL = false;

    const local = loadLocal();
    if (local && local.length) return local.map(normalizeProduto);
    saveLocal(produtosFake);
    return produtosFake.map(normalizeProduto);
  }
}

async function apiCriarProduto(payload) {
  const res = await fetch(API_PRODUTOS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw await safeReadJson(res);
  return await res.json();
}

async function apiAtualizarProduto(id, payload) {
  const res = await fetch(`${API_PRODUTOS}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw await safeReadJson(res);
  return await res.json();
}

async function apiExcluirProduto(id) {
  const res = await fetch(`${API_PRODUTOS}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw await safeReadJson(res);
  return true;
}

/* =========================
   Estado + UI
========================= */

let produtos = [];
let produtoEditandoId = null;

function renderTabela() {
  const tbody = getEl('tbody-produtos');
  const spanCount = getEl('contagem-produtos');

  const busca = (getEl('busca-produtos')?.value || '').toLowerCase().trim();
  const origemFiltro = (getEl('filtro-origem-produto')?.value || '').trim();

  if (!tbody) return;

  const filtrados = produtos.filter(p => {
    const hay = [
      p.cod_ref_id,
      p.codigo_barras,
      p.nome_generico,
      p.nome_produto,
      p.fabricante,
      p.modelo,
      p.cod_ref_fabric,
      p.origem,

      p.status_atual,
      p.tipo_mercado,
      p.utilizacao,
      p.tipo_material,

      p.prod_controlado,
      p.segmentos,
      p.tipo_sistema,
      p.classe,
      p.categorias,
      p.subcategoria,

      p.fornecedor,
      p.ultima_compra,

      p.tipo_armaz,
      p.armaz_localiz,
      p.tipo_logistico,

      String(p.estoque_minimo ?? ''),
      String(p.estoque_maximo ?? ''),
      String(p.quantidade_atual ?? ''),

      p.possui_validade,
      p.tipo_tecnico,
      p.cores_disponiveis,

      p.classif_ncm_bbm,
      p.cst_icms,
      p.cst_pis,
      p.cst_cofins,

      String(p.valor_custo ?? ''),
      String(p.custo_efetivo ?? ''),
      String(p.mc_lucro ?? ''),

      p.destino
    ].map(x => (Array.isArray(x) ? x.join(', ') : (x || '')).toString().toLowerCase()).join(' | ');

    const matchBusca = !busca || hay.includes(busca);
    const matchOrigem = !origemFiltro || (p.origem || '').trim() === origemFiltro;
    return matchBusca && matchOrigem;
  });

  tbody.innerHTML = '';

  filtrados.forEach(p => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td data-label="Cód. Ref">${escapeHTML(p.cod_ref_id || '-')}</td>
      <td data-label="Cód. Barras">${escapeHTML(p.codigo_barras || '-')}</td>
      <td data-label="Produto">${escapeHTML(p.nome_produto || '-')}</td>
      <td data-label="Nome genérico">${escapeHTML(p.nome_generico || '-')}</td>
      <td data-label="Fabricante">${escapeHTML(p.fabricante || '-')}</td>
      <td data-label="Modelo">${escapeHTML(p.modelo || '-')}</td>
      <td data-label="Cód. Fabric.">${escapeHTML(p.cod_ref_fabric || '-')}</td>
      <td data-label="Origem">${escapeHTML(p.origem || '-')}</td>

      <td data-label="Status Atual">${escapeHTML(p.status_atual || '-')}</td>
      <td data-label="Tipo Mercado">${escapeHTML(p.tipo_mercado || '-')}</td>
      <td data-label="Utilização">${escapeHTML(p.utilizacao || '-')}</td>
      <td data-label="Tipo Material">${escapeHTML(p.tipo_material || '-')}</td>

      <td data-label="Fornecedor">${escapeHTML(formatFornecedoresDisplay(p))}</td>
      <td data-label="Última Compra">${escapeHTML(formatDateOnlyBR(p.ultima_compra))}</td>

      <td data-label="Ações">
        <div class="orca-table-actions">
          <button class="orca-icon-btn" data-action="editar" data-id="${p.id}" title="Editar produto">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="orca-icon-btn" data-action="excluir" data-id="${p.id}" title="Excluir produto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (spanCount) {
    spanCount.textContent = filtrados.length === 1 ? '1 item' : `${filtrados.length} itens`;
  }
}

/* =========================
   Modal
========================= */

function setVal(id, v) {
  const el = getEl(id);
  if (el) el.value = v ?? '';
}

function abrirModal(novo = true, produto = null) {
  const backdrop = getEl('modal-produto-backdrop');
  const titulo = getEl('modal-produto-titulo');
  if (!backdrop || !titulo) return;

  backdrop.hidden = false;
  document.body.classList.add('modal-open');

  const infoData = getEl('info-data-cadastro');

  if (novo) {
    produtoEditandoId = null;
    titulo.textContent = 'Novo produto';

    if (infoData) {
      infoData.hidden = true;
      infoData.textContent = '';
    }

    // Identificação
    setVal('campo-cod-ref-id', '');
    setVal('campo-codigo-barras', '');
    setVal('campo-nome-generico', '');
    setVal('campo-nome-produto', '');
    setVal('campo-fabricante', '');
    setVal('campo-modelo', '');
    setVal('campo-cod-ref-fabric', '');
    setVal('campo-origem', '');

    // Situação
    setVal('campo-status-atual', '');
    setVal('campo-tipo-mercado', '');
    setVal('campo-utilizacao', '');
    setVal('campo-tipo-material', '');

    // Classificação
    setVal('campo-prod-controlado', '');
    setVal('campo-tipo-fiscalizacao', '');
    setVal('campo-dados-identificacao-controlado', '');
    setVal('campo-observacoes-controlado', '');
    setSegmentosSelection([]);
    setVal('campo-tipo-sistema', '');
    setVal('campo-classe', '');
    setVal('campo-categorias', '');
    setVal('campo-subcategoria', '');

    // Distribuidores
    setFornecedoresSelection([]);
    setVal('campo-ultima-compra', '');
    setVal('campo-ultimo-fornecedor', '');

    // Logístico
    setVal('campo-tipo-armaz', '');
    setVal('campo-armaz-localiz', '');
    setVal('campo-armaz-predio', '');
    setVal('campo-armaz-corredor', '');
    setVal('campo-armaz-prateleira', '');
    setVal('campo-tipo-logistico', '');
    setVal('campo-peso-logistico', '');
    setVal('campo-peso-logistico-unidade', '');
    setVal('campo-tamanho-logistico', '');
    setVal('campo-embalagem-compra', '');
    setVal('campo-embalagem-armazem', '');
    setVal('campo-embalagem-saida', '');
    setVal('campo-estoque-minimo', '');
    setVal('campo-estoque-maximo', '');
    setVal('campo-quantidade-atual', '');

    // Técnicos
    setVal('campo-possui-validade', '');
    setVal('campo-tipo-tecnico', '');
    setVal('campo-cores-disponiveis', '');
    setVal('campo-imagens-produto', '');
    setVal('campo-videos-produto', '');
    setVal('campo-fichas-tecnica', '');
    setVal('campo-manuais-instalacao', '');
    setVal('campo-manuais-programacao', '');
    setVal('campo-manuais-usuario', '');

    // Fiscais
    setVal('campo-classif-ncm-bbm', '');
    setVal('campo-aliq-ipi-entrada', '');
    setVal('campo-aliq-iva', '');
    setVal('campo-cst-icms', '');
    setVal('campo-cst-pis', '');
    setVal('campo-cst-cofins', '');

    // Preço
    setVal('campo-valor-custo', '');
    setVal('campo-mark-up', '');
    setVal('campo-custo-efetivo', '');
    setVal('campo-mc-lucro', '');
    setVal('campo-imp-importacao', '');
    setVal('campo-ipi', '');
    setVal('campo-icms', '');
    setVal('campo-simples', '');
    setVal('campo-luc-presumido', '');

    // Movimentação
    MOVIMENTACOES_ATUAIS = [];
    renderMovimentacoes();
    resetMovForm();

    updateProdutoControladoUI();
  initMovimentacaoUI();

    setTimeout(() => getEl('campo-nome-produto')?.focus(), 10);
    return;
  }

  if (!produto) return;

  produtoEditandoId = produto.id;
  titulo.textContent = 'Editar produto';

  if (infoData) {
    infoData.hidden = false;
    infoData.textContent = `Cadastrado em: ${formatDateBR(produto.data_cadastro)}`;
  }

  // Identificação
  setVal('campo-cod-ref-id', produto.cod_ref_id || '');
  setVal('campo-codigo-barras', produto.codigo_barras || '');
  setVal('campo-nome-generico', produto.nome_generico || '');
  setVal('campo-nome-produto', produto.nome_produto || '');
  setVal('campo-fabricante', produto.fabricante || '');
  setVal('campo-modelo', produto.modelo || '');
  setVal('campo-cod-ref-fabric', produto.cod_ref_fabric || '');
  setVal('campo-origem', produto.origem || '');

  // Situação
  setVal('campo-status-atual', produto.status_atual || '');
  setVal('campo-tipo-mercado', produto.tipo_mercado || '');
  setVal('campo-utilizacao', produto.utilizacao || '');
  setVal('campo-tipo-material', produto.tipo_material || '');

  // Classificação
  setVal('campo-prod-controlado', produto.prod_controlado || '');
  setVal('campo-tipo-fiscalizacao', produto.tipo_fiscalizacao || '');
  setVal('campo-dados-identificacao-controlado', produto.dados_identificacao_controlado || '');
  setVal('campo-observacoes-controlado', produto.observacoes_controlado || '');
  setSegmentosSelection(produto.segmentos);
  setVal('campo-tipo-sistema', produto.tipo_sistema || '');
  setVal('campo-classe', produto.classe || '');
  setVal('campo-categorias', produto.categorias || '');
  setVal('campo-subcategoria', produto.subcategoria || '');

  // Distribuidores
  setFornecedoresSelection(produto.fornecedores ?? produto.fornecedor);
  setVal('campo-ultima-compra', produto.ultima_compra || '');

  // Logístico
  setVal('campo-tipo-armaz', produto.tipo_armaz || '');
  setVal('campo-armaz-localiz', produto.armaz_localiz || '');
  setVal('campo-tipo-logistico', produto.tipo_logistico || '');
  setVal('campo-peso-logistico', produto.peso_logistico ?? '');
  setVal('campo-peso-logistico-unidade', produto.peso_logistico_unidade || '');
  setVal('campo-tamanho-logistico', produto.tamanho_logistico || '');
  setVal('campo-embalagem-compra', produto.embalagem_compra || '');
  setVal('campo-embalagem-armazem', produto.embalagem_armazem || '');
  setVal('campo-embalagem-saida', produto.embalagem_saida || '');
  setVal('campo-estoque-minimo', produto.estoque_minimo ?? '');
  setVal('campo-estoque-maximo', produto.estoque_maximo ?? '');
  setVal('campo-quantidade-atual', produto.quantidade_atual ?? '');

  // Técnicos
  setVal('campo-possui-validade', produto.possui_validade || '');
  setVal('campo-tipo-tecnico', produto.tipo_tecnico || '');
  setVal('campo-cores-disponiveis', produto.cores_disponiveis || '');
  setVal('campo-imagens-produto', produto.imagens_produto || '');
  setVal('campo-videos-produto', produto.videos_produto || '');
  setVal('campo-fichas-tecnica', produto.fichas_tecnica || '');
  setVal('campo-manuais-instalacao', produto.manuais_instalacao || '');
  setVal('campo-manuais-programacao', produto.manuais_programacao || '');
  setVal('campo-manuais-usuario', produto.manuais_usuario || '');

  // Fiscais
  setVal('campo-classif-ncm-bbm', produto.classif_ncm_bbm || '');
  setVal('campo-aliq-ipi-entrada', produto.aliq_ipi_entrada ?? '');
  setVal('campo-aliq-iva', produto.aliq_iva ?? '');
  setVal('campo-cst-icms', produto.cst_icms || '');
  setVal('campo-cst-pis', produto.cst_pis || '');
  setVal('campo-cst-cofins', produto.cst_cofins || '');

  // Preço
  setVal('campo-valor-custo', produto.valor_custo ?? '');
  setVal('campo-mark-up', produto.mark_up ?? '');
  setVal('campo-custo-efetivo', produto.custo_efetivo ?? '');
  setVal('campo-mc-lucro', produto.mc_lucro ?? '');
  setVal('campo-imp-importacao', produto.imp_importacao ?? '');
  setVal('campo-ipi', produto.ipi ?? '');
  setVal('campo-icms', produto.icms ?? '');
  setVal('campo-simples', produto.simples ?? '');
  setVal('campo-luc-presumido', produto.luc_presumido ?? '');

  // Movimentação
  MOVIMENTACOES_ATUAIS = Array.isArray(produto.movimentacoes) ? [...produto.movimentacoes] : [];
  renderMovimentacoes();
  resetMovForm();

  updateProdutoControladoUI();
setTimeout(() => getEl('campo-nome-produto')?.focus(), 10);
}

function fecharModal() {
  const backdrop = getEl('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove('modal-open');
  produtoEditandoId = null;
}

/* =========================
   Form / salvar / excluir
========================= */

function lerFormProduto() {
  const cod_ref_id = getEl('campo-cod-ref-id')?.value.trim() || '';
  const codigo_barras = getEl('campo-codigo-barras')?.value.trim() || '';
  const nome_generico = getEl('campo-nome-generico')?.value.trim() || '';
  const nome_produto = getEl('campo-nome-produto')?.value.trim() || '';
  const fabricante = getEl('campo-fabricante')?.value.trim() || '';
  const modelo = getEl('campo-modelo')?.value.trim() || '';
  const cod_ref_fabric = getEl('campo-cod-ref-fabric')?.value.trim() || '';
  const origem = getEl('campo-origem')?.value || '';

  const status_atual = getEl('campo-status-atual')?.value || '';
  const tipo_mercado = getEl('campo-tipo-mercado')?.value || '';
  const utilizacao = getEl('campo-utilizacao')?.value || '';
  const tipo_material = getEl('campo-tipo-material')?.value || '';

  const prod_controlado = getEl('campo-prod-controlado')?.value || '';
  const tipo_fiscalizacao = getEl('campo-tipo-fiscalizacao')?.value || '';
  const dados_identificacao_controlado = getEl('campo-dados-identificacao-controlado')?.value.trim() || '';
  const observacoes_controlado = getEl('campo-observacoes-controlado')?.value.trim() || '';

  const segmentos = getSelectedSegmentos();
  const tipo_sistema = getEl('campo-tipo-sistema')?.value.trim() || '';
  const classe = getEl('campo-classe')?.value || '';
  const categorias = getEl('campo-categorias')?.value.trim() || '';
  const subcategoria = getEl('campo-subcategoria')?.value.trim() || '';

  const fornecedores = getSelectedFornecedores();
  const fornecedor = fornecedores[0] || '';
  const ultima_compra = (getEl('campo-ultima-compra')?.value || '').trim() || null;

  const tipo_armaz = getEl('campo-tipo-armaz')?.value || '';
  const armaz_localiz = getEl('campo-armaz-localiz')?.value.trim() || '';
  const armaz_predio = getEl('campo-armaz-predio')?.value.trim() || '';
  const armaz_corredor = getEl('campo-armaz-corredor')?.value.trim() || '';
  const armaz_prateleira = getEl('campo-armaz-prateleira')?.value.trim() || '';
  const tipo_logistico = getEl('campo-tipo-logistico')?.value.trim() || '';

  const peso_logistico = numOrNull(getEl('campo-peso-logistico')?.value);
  const peso_logistico_unidade = getEl('campo-peso-logistico-unidade')?.value || '';

  const tamanho_logistico = getEl('campo-tamanho-logistico')?.value.trim() || '';
  const embalagem_compra = getEl('campo-embalagem-compra')?.value.trim() || '';
  const embalagem_armazem = getEl('campo-embalagem-armazem')?.value.trim() || '';
  const embalagem_saida = getEl('campo-embalagem-saida')?.value.trim() || '';
  const estoque_minimo = intOrNull(getEl('campo-estoque-minimo')?.value);
  const estoque_maximo = intOrNull(getEl('campo-estoque-maximo')?.value);
  const quantidade_atual = intOrNull(getEl('campo-quantidade-atual')?.value);

  const possui_validade = getEl('campo-possui-validade')?.value || '';
  const tipo_tecnico = getEl('campo-tipo-tecnico')?.value.trim() || '';
  const cores_disponiveis = getEl('campo-cores-disponiveis')?.value || '';

  const imagens_produto = getEl('campo-imagens-produto')?.value || '';
  const videos_produto = getEl('campo-videos-produto')?.value || '';
  const fichas_tecnica = getEl('campo-fichas-tecnica')?.value || '';
  const manuais_instalacao = getEl('campo-manuais-instalacao')?.value || '';
  const manuais_programacao = getEl('campo-manuais-programacao')?.value || '';
  const manuais_usuario = getEl('campo-manuais-usuario')?.value || '';

  const classif_ncm_bbm = getEl('campo-classif-ncm-bbm')?.value.trim() || '';
  const aliq_ipi_entrada = numOrNull(getEl('campo-aliq-ipi-entrada')?.value);
  const aliq_iva = numOrNull(getEl('campo-aliq-iva')?.value);
  const cst_icms = getEl('campo-cst-icms')?.value || '';
  const cst_pis = getEl('campo-cst-pis')?.value || '';
  const cst_cofins = getEl('campo-cst-cofins')?.value || '';

  const valor_custo = numOrNull(getEl('campo-valor-custo')?.value);
  const mark_up = numOrNull(getEl('campo-mark-up')?.value);
  const custo_efetivo = numOrNull(getEl('campo-custo-efetivo')?.value);
  const mc_lucro = numOrNull(getEl('campo-mc-lucro')?.value);
  const imp_importacao = numOrNull(getEl('campo-imp-importacao')?.value);
  const ipi = numOrNull(getEl('campo-ipi')?.value);
  const icms = numOrNull(getEl('campo-icms')?.value);
  const simples = numOrNull(getEl('campo-simples')?.value);
  const luc_presumido = numOrNull(getEl('campo-luc-presumido')?.value);

  if (!nome_produto) {
    toast('Preencha pelo menos o Produto.', 'warn', 'Campo obrigatório');
    getEl('campo-nome-produto')?.focus();
    return null;
  }

  return {
    cod_ref_id,
    codigo_barras,
    nome_generico,
    nome_produto,
    fabricante,
    modelo,
    cod_ref_fabric,
    origem,

    status_atual,
    tipo_mercado,
    utilizacao,
    tipo_material,

    prod_controlado,
    tipo_fiscalizacao: isSim(prod_controlado) ? (tipo_fiscalizacao || null) : null,
    dados_identificacao_controlado: isSim(prod_controlado) ? (dados_identificacao_controlado || null) : null,
    observacoes_controlado: isSim(prod_controlado) ? (observacoes_controlado || null) : null,

    segmentos,
    tipo_sistema,
    classe,
    categorias,
    subcategoria,

    fornecedores,
    fornecedor,
    ultima_compra,

    tipo_armaz,
    armaz_localiz,
    tipo_logistico,

    peso_logistico,
    peso_logistico_unidade,

    tamanho_logistico,
    embalagem_compra,
    embalagem_armazem,
    embalagem_saida,
    estoque_minimo,
    estoque_maximo,
    quantidade_atual,

    possui_validade,
    tipo_tecnico,

    peso_tecnico,
    peso_tecnico_unidade,

    tamanho_tecnico,
    cores_disponiveis,

    imagens_produto,
    videos_produto,
    fichas_tecnica,
    manuais_instalacao,
    manuais_programacao,
    manuais_usuario,

    classif_ncm_bbm,
    aliq_ipi_entrada,
    aliq_iva,
    cst_icms,
    cst_pis,
    cst_cofins,

    valor_custo,
    mark_up,
    custo_efetivo,
    mc_lucro,
    imp_importacao,
    ipi,
    icms,
    simples,
    luc_presumido,

    ultimo_fornecedor,

    armaz_predio,
    armaz_corredor,
    armaz_prateleira,

    movimentacoes: MOVIMENTACOES_ATUAIS
  };
}

function salvarLocal(payload) {
  if (produtoEditandoId == null) {
    const novoId = produtos.length > 0 ? Math.max(...produtos.map(p => Number(p.id) || 0)) + 1 : 1;
    produtos.push({ id: novoId, data_cadastro: new Date().toISOString(), ...payload });
  } else {
    produtos = produtos.map(p => (p.id === produtoEditandoId ? { ...p, ...payload } : p));
  }
  saveLocal(produtos);
  fecharModal();
  renderTabela();
}

async function salvarProduto() {
  const payload = lerFormProduto();
  if (!payload) return;

  if (API_DISPONIVEL === false) {
    salvarLocal(payload);
    toast('Salvo (local).', 'ok');
    return;
  }

  try {
    if (produtoEditandoId == null) {
      const criado = await apiCriarProduto(payload);
      API_DISPONIVEL = true;
      produtos.push(normalizeProduto(criado));
    } else {
      const atualizado = await apiAtualizarProduto(produtoEditandoId, payload);
      API_DISPONIVEL = true;
      const up = normalizeProduto(atualizado);
      produtos = produtos.map(p => (p.id === produtoEditandoId ? { ...p, ...up } : p));
    }

    fecharModal();
    renderTabela();
    toast('Produto salvo.', 'ok');
  } catch (err) {
    logWarn('Falha ao salvar via API (fallback local):', err);
    API_DISPONIVEL = false;
    salvarLocal(payload);
    toast('API indisponível. Salvei localmente.', 'warn', 'Fallback');
  }
}

async function excluirProduto(id) {
  const ok = await confirmOrca('Deseja realmente excluir este produto?', {
    title: 'Excluir produto',
    okText: 'Excluir',
    cancelText: 'Cancelar'
  });
  if (!ok) return;

  if (API_DISPONIVEL === false) {
    produtos = produtos.filter(p => p.id !== id);
    saveLocal(produtos);
    renderTabela();
    toast('Excluído (local).', 'ok');
    return;
  }

  try {
    await apiExcluirProduto(id);
    API_DISPONIVEL = true;
    produtos = produtos.filter(p => p.id !== id);
    renderTabela();
    toast('Produto excluído.', 'ok');
  } catch (err) {
    logWarn('Falha ao excluir via API (fallback local):', err);
    API_DISPONIVEL = false;
    produtos = produtos.filter(p => p.id !== id);
    saveLocal(produtos);
    renderTabela();
    toast('API indisponível. Excluí localmente.', 'warn', 'Fallback');
  }
}

/* =========================
   INIT
========================= */

async function initProdutosPage() {
  ensureInlineUIStyles();
  setupProdutoLists();
// UI condicional (Produto Controlado)
const selControlado = getEl('campo-prod-controlado');
if (selControlado) {
  selControlado.addEventListener('change', updateProdutoControladoUI);
}
updateProdutoControladoUI();


  const backdrop = getEl('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;

  produtos = await carregarProdutos();

  if (API_DISPONIVEL === false) {
    const local = loadLocal();
    if (!local) saveLocal(produtos);
  }

  renderTabela();

  const inputBusca = getEl('busca-produtos');
  const selectOrigem = getEl('filtro-origem-produto');

  if (inputBusca) inputBusca.addEventListener('input', renderTabela);
  if (selectOrigem) selectOrigem.addEventListener('change', renderTabela);

  const btnNovo = getEl('btn-novo-produto');
  if (btnNovo) btnNovo.addEventListener('click', () => abrirModal(true, null));

  const btnFechar = getEl('btn-fechar-modal-produto');
  const btnCancelar = getEl('btn-cancelar-produto');
  const btnSalvar = getEl('btn-salvar-produto');

  if (btnFechar) btnFechar.addEventListener('click', fecharModal);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);
  if (btnSalvar) btnSalvar.addEventListener('click', salvarProduto);

  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) fecharModal();
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const bd = getEl('modal-produto-backdrop');
      if (bd && !bd.hidden) fecharModal();
    }
  });

  const tbody = getEl('tbody-produtos');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.orca-icon-btn');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = Number(btn.dataset.id);
      const produto = produtos.find(p => Number(p.id) === id);
      if (!produto) return;

      if (action === 'editar') abrirModal(false, produto);
      if (action === 'excluir') excluirProduto(id);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initProdutosPage().catch(err => {
    logErr('Falha ao iniciar página de produtos:', err);
    produtos = loadLocal() || produtosFake;
    renderTabela();
    toast('Falha ao iniciar. Usei dados locais.', 'warn', 'Fallback');
  });
});
