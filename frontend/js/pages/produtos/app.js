// /frontend/js/pages/produtos/app.js
import {
  state,
  API_PRODUTOS,
  STORAGE_KEY,
  getEl,
  setVal,
  getVal,
  escapeHTML,
  escapeHtml,
  splitMultiText,
  isSim,
  numOrNull,
  intOrNull,
  toISODateTime,
  ymdFromBackendDateTime,
  formatDateBR,
  formatDateOnlyBR,
  logWarn
} from './base.js';

import { toast, confirmValora } from './ui.js';

import {
  initSelects,
  wireSegmentosSelect,
  wireFornecedoresSelect,
  renderSegmentosChips,
  renderFornecedoresChips,
  openManageListModal,
  getSelectedSegmentos,
  getSelectedFornecedores,
  setSegmentosSelection,
  setFornecedoresSelection
} from './lists.js';

/* =========================
   Dropdown helpers (Export/Import)
========================= */

function closeDropdown(menuEl) {
  if (!menuEl) return;
  menuEl.hidden = true;
}

function openDropdown(menuEl) {
  if (!menuEl) return;
  menuEl.hidden = false;
}

function toggleDropdown(menuEl) {
  if (!menuEl) return;
  menuEl.hidden = !menuEl.hidden;
}

function isClickInside(el, target) {
  if (!el || !target) return false;
  return el === target || el.contains(target);
}

/* =========================
   Seleção (Exportar selecionados)
========================= */

const SELECTED_PROD_KEYS = new Set();

function produtoKey(p) {
  if (!p) return '';

  const id = p?.id;
  if (id !== undefined && id !== null && String(id).trim() !== '') {
    return `id:${String(id).trim()}`;
  }

  const ref = p?.cod_ref_id;
  if (ref) return `ref:${String(ref).trim()}`;

  const barras = p?.codigo_barras;
  if (barras) return `bar:${String(barras).trim()}`;

  return '';
}

function syncSelectedKeysWithState() {
  const all = Array.isArray(state.produtos) ? state.produtos : [];
  const valid = new Set(all.map(produtoKey).filter(Boolean));
  for (const k of Array.from(SELECTED_PROD_KEYS)) {
    if (!valid.has(k)) SELECTED_PROD_KEYS.delete(k);
  }
}

function getProdutosFiltrados() {
  const busca = (getEl('busca-produtos')?.value || '').toLowerCase().trim();
  const filtroOrigem = (getEl('filtro-origem-produto')?.value || '').trim();

  return (state.produtos || []).filter(p => {
    const okBusca = matchesBuscaProduto(p, busca);
    const okOrigem = !filtroOrigem || String(p?.origem || '').trim() === filtroOrigem;
    return okBusca && okOrigem;
  });
}

function getProdutosParaExportar() {
  const all = Array.isArray(state.produtos) ? state.produtos : [];
  const selected = all.filter(p => SELECTED_PROD_KEYS.has(produtoKey(p)));

  // ✅ Se tiver algo selecionado, exporta só os selecionados
  if (selected.length) return selected;

  // ✅ Caso contrário, exporta o que está na tela (busca + filtro)
  return getProdutosFiltrados();
}

function updateMasterCheckbox() {
  const chkAll = getEl('chk-all-produtos');
  const tbody = getEl('tbody-produtos');
  if (!chkAll || !tbody) return;

  const cbs = Array.from(tbody.querySelectorAll('input.Valora-row-check'));
  const total = cbs.length;
  const sel = cbs.filter(cb => cb.checked).length;

  chkAll.indeterminate = sel > 0 && sel < total;
  chkAll.checked = total > 0 && sel === total;
}


/* =========================
   Produto Controlado UI
========================= */

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

  setVal('campo-mov-entrada-tipo', '');
  setVal('campo-mov-qtd', '');
  setVal('campo-mov-fornecedor', '');
  setVal('campo-mov-doc-tipo', '');
  setVal('campo-mov-doc-numero', '');
  setVal('campo-mov-nfe-chave', '');

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

  const docEntrada = (getEl('campo-mov-doc-tipo')?.value || '').trim();
  const nfeEntrada = getEl('bloco-mov-nfe-entrada');
  if (nfeEntrada) nfeEntrada.hidden = docEntrada !== 'Nota Fiscal';

  const docSaida = (getEl('campo-mov-doc-tipo-saida')?.value || '').trim();
  const nfeSaida = getEl('bloco-mov-nfe-saida');
  if (nfeSaida) nfeSaida.hidden = docSaida !== 'Nota Fiscal';

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
    <div class="Valora-mov-item">
      <div class="Valora-mov-item__main">
        <div class="Valora-mov-item__title">${escapeHTML(dt)} • <b>${escapeHTML(tipo)}</b> • Qtd: ${escapeHTML(qtd)}${escapeHTML(docTxt)}</div>
        <div class="Valora-mov-item__sub">${escapeHtml(extra || '')}</div>
      </div>
      <button type="button" class="Valora-btn Valora-btn--ghost Valora-btn--icon" data-mov-del="${idx}" title="Apagar movimentação">✕</button>
    </div>
  `;
}

function renderMovimentacoes() {
  const wrap = getEl('lista-movimentacoes');
  if (!wrap) return;

  if (!Array.isArray(state.MOVIMENTACOES_ATUAIS) || state.MOVIMENTACOES_ATUAIS.length === 0) {
    wrap.innerHTML = '<div class="Valora-mov-empty">Sem movimentações registradas.</div>';
    return;
  }

  wrap.innerHTML = state.MOVIMENTACOES_ATUAIS
    .map((m, idx) => _formatMovItem(m, idx))
    .join('');

  wrap.querySelectorAll('[data-mov-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.getAttribute('data-mov-del'));
      if (Number.isNaN(i)) return;
      state.MOVIMENTACOES_ATUAIS.splice(i, 1);
      renderMovimentacoes();
    });
  });
}

function _loadClientesToDatalist() {
  const dl = getEl('datalist-clientes');
  if (!dl) return;

  const keys = [
    'Valorapro_clientes_v2',
    'Valorapro_clientes_v1',
    'Valorapro_clientes',
    'Valorapro_clientes_v0'
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

  const uniq = Array.from(new Set(nomes.map(n => n.trim())))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

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
  if (initMovimentacaoUI._bound) {
    updateMovUI();
    _loadClientesToDatalist();
    return;
  }
  initMovimentacaoUI._bound = true;

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

    state.MOVIMENTACOES_ATUAIS.push(mov);
    renderMovimentacoes();

    if (mov.tipo_mov === 'Entrada' && mov.fornecedor) {
      setVal('campo-ultimo-fornecedor', mov.fornecedor);
      try {
        const d = new Date(mov.data_mov);
        if (!Number.isNaN(d.getTime())) {
          setVal('campo-ultima-compra', d.toISOString().slice(0, 10));
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

/* =========================
   Produtos: API + Local fallback
========================= */

function normalizeProdutosResponse(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function loadProdutosFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.items)) return parsed.items;
    return [];
  } catch (_e) {
    return [];
  }
}

function saveProdutosToStorage(arr) {
  try {
    const payload = {
      version: 4,
      saved_at: toISODateTime(),
      items: Array.isArray(arr) ? arr : []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (_e) {}
}

async function probeAPIProdutos() {
  if (state.API_OK !== null) return state.API_OK;

  try {
    const r = await fetch(API_PRODUTOS);
    state.API_OK = !!r.ok;
    return state.API_OK;
  } catch (_e) {
    state.API_OK = false;
    return false;
  }
}

async function carregarProdutos() {
  const ok = await probeAPIProdutos();

  if (ok) {
    try {
      let resp = await fetch(`${API_PRODUTOS}?limit=2000&offset=0`);
      if (!resp.ok) resp = await fetch(API_PRODUTOS);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      state.produtos = normalizeProdutosResponse(data);
      if (!Array.isArray(state.produtos)) state.produtos = [];
      saveProdutosToStorage(state.produtos);
      syncSelectedKeysWithState();
  renderTabelaProdutos();
      return;
    } catch (err) {
      logWarn('Falha API produtos, caindo para localStorage:', err);
    }
  }

  state.produtos = loadProdutosFromStorage();
  if (!Array.isArray(state.produtos)) state.produtos = [];
  renderTabelaProdutos();
}

async function obterProdutoNoServidor(id) {
  const resp = await fetch(`${API_PRODUTOS}/${id}`);
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json();
}

async function salvarProdutoNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_PRODUTOS : `${API_PRODUTOS}/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || 'Erro ao salvar produto.');
  }
  return resp.json();
}

async function excluirProdutoNoServidor(id) {
  const resp = await fetch(`${API_PRODUTOS}/${id}`, { method: 'DELETE' });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(txt || 'Erro ao excluir produto.');
  }
}

/* =========================
   Render Tabela
========================= */

function produtoFornecedorResumo(p) {
  const arr = Array.isArray(p?.fornecedores) ? p.fornecedores : splitMultiText(p?.fornecedores || p?.fornecedor || '');
  if (arr.length) return arr[0];
  return p?.ultimo_fornecedor || p?.ultimo_fornecedor_produto || '-';
}

function matchesBuscaProduto(p, q) {
  if (!q) return true;
  const alvo = [
    p?.cod_ref_id,
    p?.codigo_barras,
    p?.nome_produto,
    p?.nome_generico,
    p?.fabricante,
    p?.categorias,
    p?.subcategoria,
    p?.modelo,
    p?.origem,
    p?.cod_ref_fabric,
    produtoFornecedorResumo(p),
    ...(Array.isArray(p?.segmentos) ? p.segmentos : splitMultiText(p?.segmentos))
  ].filter(Boolean).join(' ').toLowerCase();

  return alvo.includes(q);
}

function renderTabelaProdutos() {
  const tbody = getEl('tbody-produtos');
  const spanCount = getEl('contagem-produtos');
  const busca = (getEl('busca-produtos')?.value || '').toLowerCase().trim();
  const filtroOrigem = (getEl('filtro-origem-produto')?.value || '').trim();

  if (!tbody) return;

  const filtrados = (state.produtos || []).filter(p => {
    const okBusca = matchesBuscaProduto(p, busca);
    const okOrigem = !filtroOrigem || String(p?.origem || '').trim() === filtroOrigem;
    return okBusca && okOrigem;
  });

  tbody.innerHTML = '';

  filtrados.forEach(p => {
    const tr = document.createElement('tr');

    const ultimaCompra = p?.ultima_compra || p?.ultima_compra_data || p?.ultimaCompra || '';
    const ultimaCompraBR = ultimaCompra ? formatDateOnlyBR(String(ultimaCompra).slice(0, 10)) : '-';

    const key = produtoKey(p);
    const checked = key && SELECTED_PROD_KEYS.has(key) ? 'checked' : '';

    tr.innerHTML = `
      <td class="Valora-col-check" data-label="Sel">
        <input type="checkbox" class="Valora-row-check" data-key="${escapeHTML(key)}" ${checked} />
      </td>
      <td data-label="Cód. Ref"><span>${escapeHTML(p?.cod_ref_id || '-')}</span></td>
      <td data-label="Cód. Barras"><span>${escapeHTML(p?.codigo_barras || '-')}</span></td>
      <td data-label="Produto"><span>${escapeHTML(p?.nome_produto || '-')}</span></td>
      <td data-label="Nome genérico"><span>${escapeHTML(p?.nome_generico || '-')}</span></td>
      <td data-label="Fabricante"><span>${escapeHTML(p?.fabricante || '-')}</span></td>
      <td data-label="Modelo"><span>${escapeHTML(p?.modelo || '-')}</span></td>
      <td data-label="Cód. Fabric."><span>${escapeHTML(p?.cod_ref_fabric || '-')}</span></td>
      <td data-label="Origem"><span>${escapeHTML(p?.origem || '-')}</span></td>

      <td data-label="Status Atual"><span>${escapeHTML(p?.status_atual || '-')}</span></td>
      <td data-label="Tipo Mercado"><span>${escapeHTML(p?.tipo_mercado || '-')}</span></td>
      <td data-label="Utilização"><span>${escapeHTML(p?.utilizacao || '-')}</span></td>
      <td data-label="Tipo Material"><span>${escapeHTML(p?.tipo_material || '-')}</span></td>

      <td data-label="Fornecedor"><span>${escapeHTML(produtoFornecedorResumo(p))}</span></td>
      <td data-label="Última Compra"><span>${escapeHTML(ultimaCompraBR)}</span></td>

      <td data-label="Ações">
        <div class="Valora-table-actions">
          <button class="Valora-icon-btn" data-action="editar" data-id="${escapeHTML(p?.id ?? '')}" title="Editar produto">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="Valora-icon-btn" data-action="excluir" data-id="${escapeHTML(p?.id ?? '')}" title="Excluir produto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (spanCount) {
    const qtd = filtrados.length;
    const sel = (Array.isArray(state.produtos) ? state.produtos.filter(p => SELECTED_PROD_KEYS.has(produtoKey(p))).length : 0);
    spanCount.textContent = qtd === 1 ? '1 item' : `${qtd} itens`;
    if (sel) spanCount.textContent += ` • ${sel} selecionados`;
  }

  updateMasterCheckbox();
}

/* =========================
   Modal Produto
========================= */

function abrirModalProduto() {
  const bd = getEl('modal-produto-backdrop');
  if (!bd) return;
  bd.hidden = false;
  document.body.classList.add('modal-open');
}

function fecharModalProduto() {
  const bd = getEl('modal-produto-backdrop');
  if (bd) bd.hidden = true;
  document.body.classList.remove('modal-open');
  state.produtoEditandoId = null;
}

function setInfoDataCadastro(v) {
  const info = getEl('info-data-cadastro');
  if (!info) return;
  const txt = String(v || '').trim();
  if (!txt) {
    info.hidden = true;
    info.textContent = '';
    return;
  }
  info.hidden = false;
  info.textContent = `Data cadastro: ${txt}`;
}

function resetFormProduto() {
  setInfoDataCadastro('');

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
  setVal('campo-prod-controlado', 'Não');
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
  setVal('campo-possui-validade', 'Não');
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
  state.MOVIMENTACOES_ATUAIS = [];
  resetMovForm();
  renderMovimentacoes();

  updateProdutoControladoUI();
}

function lerFormProduto() {
  const payload = {
    cod_ref_id: getVal('campo-cod-ref-id') || null,
    codigo_barras: getVal('campo-codigo-barras') || null,
    nome_generico: getVal('campo-nome-generico') || null,
    nome_produto: getVal('campo-nome-produto') || null,
    fabricante: getVal('campo-fabricante') || null,
    modelo: getVal('campo-modelo') || null,
    cod_ref_fabric: getVal('campo-cod-ref-fabric') || null,
    origem: getVal('campo-origem') || null,

    status_atual: getVal('campo-status-atual') || null,
    tipo_mercado: getVal('campo-tipo-mercado') || null,
    utilizacao: getVal('campo-utilizacao') || null,
    tipo_material: getVal('campo-tipo-material') || null,

    prod_controlado: getVal('campo-prod-controlado') || null,
    tipo_fiscalizacao: getVal('campo-tipo-fiscalizacao') || null,
    dados_identificacao_controlado: getVal('campo-dados-identificacao-controlado') || null,
    observacoes_controlado: getVal('campo-observacoes-controlado') || null,

    segmentos: getSelectedSegmentos(),
    tipo_sistema: getVal('campo-tipo-sistema') || null,
    classe: getVal('campo-classe') || null,
    categorias: getVal('campo-categorias') || null,
    subcategoria: getVal('campo-subcategoria') || null,

    fornecedores: getSelectedFornecedores(),
    ultima_compra: getVal('campo-ultima-compra') || null,
    ultimo_fornecedor: getVal('campo-ultimo-fornecedor') || null,

    tipo_armaz: getVal('campo-tipo-armaz') || null,
    armaz_localiz: getVal('campo-armaz-localiz') || null,
    armaz_predio: getVal('campo-armaz-predio') || null,
    armaz_corredor: getVal('campo-armaz-corredor') || null,
    armaz_prateleira: getVal('campo-armaz-prateleira') || null,
    tipo_logistico: getVal('campo-tipo-logistico') || null,

    peso_logistico: numOrNull(getVal('campo-peso-logistico')),
    peso_logistico_unidade: getVal('campo-peso-logistico-unidade') || null,
    tamanho_logistico: getVal('campo-tamanho-logistico') || null,

    embalagem_compra: getVal('campo-embalagem-compra') || null,
    embalagem_armazem: getVal('campo-embalagem-armazem') || null,
    embalagem_saida: getVal('campo-embalagem-saida') || null,

    estoque_minimo: intOrNull(getVal('campo-estoque-minimo')),
    estoque_maximo: intOrNull(getVal('campo-estoque-maximo')),
    quantidade_atual: intOrNull(getVal('campo-quantidade-atual')),

    possui_validade: getVal('campo-possui-validade') || null,
    tipo_tecnico: getVal('campo-tipo-tecnico') || null,
    cores_disponiveis: getVal('campo-cores-disponiveis') || null,

    imagens_produto: getVal('campo-imagens-produto') || null,
    videos_produto: getVal('campo-videos-produto') || null,
    fichas_tecnica: getVal('campo-fichas-tecnica') || null,
    manuais_instalacao: getVal('campo-manuais-instalacao') || null,
    manuais_programacao: getVal('campo-manuais-programacao') || null,
    manuais_usuario: getVal('campo-manuais-usuario') || null,

    classif_ncm_bbm: getVal('campo-classif-ncm-bbm') || null,
    aliq_ipi_entrada: numOrNull(getVal('campo-aliq-ipi-entrada')),
    aliq_iva: numOrNull(getVal('campo-aliq-iva')),

    cst_icms: getVal('campo-cst-icms') || null,
    cst_pis: getVal('campo-cst-pis') || null,
    cst_cofins: getVal('campo-cst-cofins') || null,

    valor_custo: numOrNull(getVal('campo-valor-custo')),
    mark_up: numOrNull(getVal('campo-mark-up')),
    custo_efetivo: numOrNull(getVal('campo-custo-efetivo')),
    mc_lucro: numOrNull(getVal('campo-mc-lucro')),

    imp_importacao: numOrNull(getVal('campo-imp-importacao')),
    ipi: numOrNull(getVal('campo-ipi')),
    icms: numOrNull(getVal('campo-icms')),
    simples: numOrNull(getVal('campo-simples')),
    luc_presumido: numOrNull(getVal('campo-luc-presumido')),

    movimentacoes: Array.isArray(state.MOVIMENTACOES_ATUAIS) ? state.MOVIMENTACOES_ATUAIS.slice() : []
  };

  return payload;
}

function preencherFormProduto(p) {
  setInfoDataCadastro(p?.data_cadastro ? String(p.data_cadastro) : '');

  setVal('campo-cod-ref-id', p?.cod_ref_id ?? '');
  setVal('campo-codigo-barras', p?.codigo_barras ?? '');
  setVal('campo-nome-generico', p?.nome_generico ?? '');
  setVal('campo-nome-produto', p?.nome_produto ?? '');
  setVal('campo-fabricante', p?.fabricante ?? '');
  setVal('campo-modelo', p?.modelo ?? '');
  setVal('campo-cod-ref-fabric', p?.cod_ref_fabric ?? '');
  setVal('campo-origem', p?.origem ?? '');

  setVal('campo-status-atual', p?.status_atual ?? '');
  setVal('campo-tipo-mercado', p?.tipo_mercado ?? '');
  setVal('campo-utilizacao', p?.utilizacao ?? '');
  setVal('campo-tipo-material', p?.tipo_material ?? '');

  const pc = p?.prod_controlado ?? p?.produto_controlado ?? '';
  setVal('campo-prod-controlado', (pc === true ? 'Sim' : pc === false ? 'Não' : (pc ?? 'Não')));
  setVal('campo-tipo-fiscalizacao', p?.tipo_fiscalizacao ?? '');
  setVal('campo-dados-identificacao-controlado', p?.dados_identificacao_controlado ?? '');
  setVal('campo-observacoes-controlado', p?.observacoes_controlado ?? '');

  setSegmentosSelection(p?.segmentos ?? []);
  setVal('campo-tipo-sistema', p?.tipo_sistema ?? '');
  setVal('campo-classe', p?.classe ?? '');
  setVal('campo-categorias', p?.categorias ?? '');
  setVal('campo-subcategoria', p?.subcategoria ?? '');

  setFornecedoresSelection(p?.fornecedores ?? p?.fornecedor ?? []);
  setVal('campo-ultima-compra', ymdFromBackendDateTime(p?.ultima_compra) || (p?.ultima_compra ?? '') || '');
  setVal('campo-ultimo-fornecedor', p?.ultimo_fornecedor ?? '');

  setVal('campo-tipo-armaz', p?.tipo_armaz ?? '');
  setVal('campo-armaz-localiz', p?.armaz_localiz ?? '');
  setVal('campo-armaz-predio', p?.armaz_predio ?? '');
  setVal('campo-armaz-corredor', p?.armaz_corredor ?? '');
  setVal('campo-armaz-prateleira', p?.armaz_prateleira ?? '');
  setVal('campo-tipo-logistico', p?.tipo_logistico ?? '');

  setVal('campo-peso-logistico', p?.peso_logistico ?? '');
  setVal('campo-peso-logistico-unidade', p?.peso_logistico_unidade ?? '');

  setVal('campo-tamanho-logistico', p?.tamanho_logistico ?? '');
  setVal('campo-embalagem-compra', p?.embalagem_compra ?? '');
  setVal('campo-embalagem-armazem', p?.embalagem_armazem ?? '');
  setVal('campo-embalagem-saida', p?.embalagem_saida ?? '');

  setVal('campo-estoque-minimo', p?.estoque_minimo ?? '');
  setVal('campo-estoque-maximo', p?.estoque_maximo ?? '');
  setVal('campo-quantidade-atual', p?.quantidade_atual ?? '');

  const pv = p?.possui_validade ?? '';
  setVal('campo-possui-validade', (pv === true ? 'Sim' : pv === false ? 'Não' : (pv ?? 'Não')));

  setVal('campo-tipo-tecnico', p?.tipo_tecnico ?? '');
  setVal('campo-cores-disponiveis', p?.cores_disponiveis ?? '');

  setVal('campo-imagens-produto', p?.imagens_produto ?? '');
  setVal('campo-videos-produto', p?.videos_produto ?? '');
  setVal('campo-fichas-tecnica', p?.fichas_tecnica ?? '');
  setVal('campo-manuais-instalacao', p?.manuais_instalacao ?? '');
  setVal('campo-manuais-programacao', p?.manuais_programacao ?? '');
  setVal('campo-manuais_usuario', p?.manuais_usuario ?? '');

  setVal('campo-classif-ncm-bbm', p?.classif_ncm_bbm ?? '');
  setVal('campo-aliq-ipi-entrada', p?.aliq_ipi_entrada ?? '');
  setVal('campo-aliq-iva', p?.aliq_iva ?? '');

  setVal('campo-cst-icms', p?.cst_icms ?? '');
  setVal('campo-cst-pis', p?.cst_pis ?? '');
  setVal('campo-cst-cofins', p?.cst_cofins ?? '');

  setVal('campo-valor-custo', p?.valor_custo ?? '');
  setVal('campo-mark-up', p?.mark_up ?? '');
  setVal('campo-custo-efetivo', p?.custo_efetivo ?? '');
  setVal('campo-mc-lucro', p?.mc_lucro ?? '');
  setVal('campo-imp-importacao', p?.imp_importacao ?? '');
  setVal('campo-ipi', p?.ipi ?? '');
  setVal('campo-icms', p?.icms ?? '');
  setVal('campo-simples', p?.simples ?? '');
  setVal('campo-luc_presumido', p?.luc_presumido ?? '');

  state.MOVIMENTACOES_ATUAIS = Array.isArray(p?.movimentacoes) ? p.movimentacoes.slice() : [];
  resetMovForm();
  renderMovimentacoes();

  updateProdutoControladoUI();
}

/* =========================
   Modal Novo/Editar/Salvar
========================= */

async function abrirModalProdutoNovo() {
  state.produtoEditandoId = null;
  const ttl = getEl('modal-produto-titulo');
  if (ttl) ttl.textContent = 'Novo produto';

  resetFormProduto();
  setInfoDataCadastro(toISODateTime());

  abrirModalProduto();
  setTimeout(() => getEl('campo-nome-produto')?.focus(), 0);
}

async function abrirModalProdutoEditar(p) {
  state.produtoEditandoId = p?.id ?? null;
  const ttl = getEl('modal-produto-titulo');
  if (ttl) ttl.textContent = 'Editar produto';

  resetFormProduto();
  preencherFormProduto(p);

  abrirModalProduto();
}

async function salvarProduto() {
  const payload = lerFormProduto();

  if (!payload.nome_produto && !payload.nome_generico) {
    toast('Preencha pelo menos Produto ou Nome Genérico.', 'warn', 'Validação');
    return;
  }

  try {
    const ok = await probeAPIProdutos();

    if (ok) {
      await salvarProdutoNoServidor(payload, state.produtoEditandoId);
      toast('Produto salvo no servidor.', 'success', 'OK');
      await carregarProdutos();
      fecharModalProduto();
      return;
    }

    if (!Array.isArray(state.produtos)) state.produtos = [];

    if (state.produtoEditandoId == null) {
      const maxId = state.produtos.length ? Math.max(...state.produtos.map(x => Number(x?.id) || 0)) : 0;
      const newId = maxId + 1;

      const item = {
        id: newId,
        data_cadastro: toISODateTime(),
        ...payload
      };
      state.produtos.push(item);
      toast('Produto salvo (local).', 'success', 'OK');
    } else {
      const idx = state.produtos.findIndex(x => Number(x?.id) === Number(state.produtoEditandoId));
      if (idx >= 0) {
        state.produtos[idx] = { ...state.produtos[idx], ...payload };
        toast('Produto atualizado (local).', 'success', 'OK');
      } else {
        state.produtos.push({ id: Number(state.produtoEditandoId), data_cadastro: toISODateTime(), ...payload });
        toast('Produto salvo (local).', 'success', 'OK');
      }
    }

    saveProdutosToStorage(state.produtos);
    renderTabelaProdutos();
    fecharModalProduto();
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Erro ao salvar produto.', 'err', 'Erro');
  }
}

/* =========================
   Export / Import / Limpar
========================= */

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 600);
}

function csvEscape(v) {
  const s = String(v ?? '');
  const needs = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return needs ? `"${out}"` : out;
}

function produtosToCSV(items) {
  const cols = [
    'id',
    'cod_ref_id',
    'codigo_barras',
    'nome_produto',
    'nome_generico',
    'fabricante',
    'modelo',
    'cod_ref_fabric',
    'origem',
    'status_atual',
    'tipo_mercado',
    'utilizacao',
    'tipo_material',
    'fornecedores',
    'ultimo_fornecedor',
    'ultima_compra',
    'segmentos'
  ];

  const header = cols.join(';');
  const rows = (items || []).map(p => {
    const fornecedores = Array.isArray(p?.fornecedores) ? p.fornecedores.join('|') : (p?.fornecedores || '');
    const segmentos = Array.isArray(p?.segmentos) ? p.segmentos.join('|') : (p?.segmentos || '');

    const map = {
      id: p?.id ?? '',
      cod_ref_id: p?.cod_ref_id ?? '',
      codigo_barras: p?.codigo_barras ?? '',
      nome_produto: p?.nome_produto ?? '',
      nome_generico: p?.nome_generico ?? '',
      fabricante: p?.fabricante ?? '',
      modelo: p?.modelo ?? '',
      cod_ref_fabric: p?.cod_ref_fabric ?? '',
      origem: p?.origem ?? '',
      status_atual: p?.status_atual ?? '',
      tipo_mercado: p?.tipo_mercado ?? '',
      utilizacao: p?.utilizacao ?? '',
      tipo_material: p?.tipo_material ?? '',
      fornecedores: fornecedores,
      ultimo_fornecedor: p?.ultimo_fornecedor ?? '',
      ultima_compra: (p?.ultima_compra ? String(p.ultima_compra).slice(0, 10) : ''),
      segmentos: segmentos
    };

    return cols.map(c => csvEscape(map[c])).join(';');
  });

  return '\uFEFF' + [header, ...rows].join('\n');
}

function produtosToTXT(items) {
  const lines = [];
  lines.push('4X Valora – Exportação de Produtos');
  lines.push(`Gerado em: ${toISODateTime()}`);
  lines.push('--------------------------------------------');
  (items || []).forEach(p => {
    const id = p?.id ?? '';
    const ref = p?.cod_ref_id ?? '';
    const barras = p?.codigo_barras ?? '';
    const nome = p?.nome_produto ?? '';
    const fab = p?.fabricante ?? '';
    const mod = p?.modelo ?? '';
    const orig = p?.origem ?? '';
    const forn = Array.isArray(p?.fornecedores) ? p.fornecedores.join(', ') : (p?.fornecedores ?? '');
    lines.push(`ID: ${id}`);
    lines.push(`Ref: ${ref}`);
    lines.push(`Barras: ${barras}`);
    lines.push(`Produto: ${nome}`);
    if (fab) lines.push(`Fabricante: ${fab}`);
    if (mod) lines.push(`Modelo: ${mod}`);
    if (orig) lines.push(`Origem: ${orig}`);
    if (forn) lines.push(`Fornecedores: ${forn}`);
    lines.push('--------------------------------------------');
  });
  return lines.join('\n');
}

async function exportarProdutosCSV() {
  await carregarProdutos();
  syncSelectedKeysWithState();
  const items = getProdutosParaExportar();
  const dt = new Date().toISOString().slice(0, 10);
  const csv = produtosToCSV(items);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(`Valorapro_produtos_${dt}.csv`, blob);
  toast('Exportado CSV.', 'success', 'OK');
}

async function exportarProdutosJSON() {
  await carregarProdutos();
  syncSelectedKeysWithState();
  const items = getProdutosParaExportar();
  const dt = new Date().toISOString().slice(0, 10);

  const payload = {
    version: 1,
    exported_at: toISODateTime(),
    type: 'produtos',
    items
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(`Valorapro_produtos_${dt}.json`, blob);
  toast('Exportado JSON.', 'success', 'OK');
}

async function exportarProdutosTXT() {
  await carregarProdutos();
  syncSelectedKeysWithState();
  const items = getProdutosParaExportar();
  const dt = new Date().toISOString().slice(0, 10);

  const txt = produtosToTXT(items);
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  downloadBlob(`Valorapro_produtos_${dt}.txt`, blob);
  toast('Exportado TXT.', 'success', 'OK');
}

async function exportarProdutosXLSX() {
  await carregarProdutos();
  syncSelectedKeysWithState();
  const items = getProdutosParaExportar();
  const dt = new Date().toISOString().slice(0, 10);

  if (!window.XLSX) {
    toast('Biblioteca XLSX não carregou. Exportando CSV no lugar.', 'warn', 'XLSX');
    await exportarProdutosCSV();
    return;
  }

  const rows = (items || []).map(p => {
    const fornecedores = Array.isArray(p?.fornecedores) ? p.fornecedores.join(', ') : (p?.fornecedores ?? '');
    const segmentos = Array.isArray(p?.segmentos) ? p.segmentos.join(', ') : (p?.segmentos ?? '');
    return {
      id: p?.id ?? '',
      cod_ref_id: p?.cod_ref_id ?? '',
      codigo_barras: p?.codigo_barras ?? '',
      nome_produto: p?.nome_produto ?? '',
      nome_generico: p?.nome_generico ?? '',
      fabricante: p?.fabricante ?? '',
      modelo: p?.modelo ?? '',
      cod_ref_fabric: p?.cod_ref_fabric ?? '',
      origem: p?.origem ?? '',
      status_atual: p?.status_atual ?? '',
      tipo_mercado: p?.tipo_mercado ?? '',
      utilizacao: p?.utilizacao ?? '',
      tipo_material: p?.tipo_material ?? '',
      fornecedores: fornecedores,
      ultimo_fornecedor: p?.ultimo_fornecedor ?? '',
      ultima_compra: (p?.ultima_compra ? String(p.ultima_compra).slice(0, 10) : ''),
      segmentos: segmentos
    };
  });

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(rows);
  window.XLSX.utils.book_append_sheet(wb, ws, 'Produtos');

  const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  downloadBlob(`Valorapro_produtos_${dt}.xlsx`, blob);
  toast('Exportado XLSX.', 'success', 'OK');
}

async function exportarProdutosPDF() {
  await carregarProdutos();
  syncSelectedKeysWithState();
  const items = getProdutosParaExportar();
  const dt = new Date().toISOString().slice(0, 10);

  const jsPDF = window?.jspdf?.jsPDF || window?.jsPDF;

  if (!jsPDF) {
    toast('PDF indisponível (jsPDF não carregou).', 'warn', 'PDF');
    return;
  }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('4X Valora – Produtos', 40, 34);

  doc.setFontSize(10);
  doc.text(`Gerado em: ${toISODateTime()}`, 40, 52);

  const head = [[
    'ID', 'Ref', 'Barras', 'Produto', 'Fabricante', 'Modelo', 'Origem', 'Status'
  ]];

  const body = (items || []).map(p => ([
    p?.id ?? '',
    p?.cod_ref_id ?? '',
    p?.codigo_barras ?? '',
    p?.nome_produto ?? '',
    p?.fabricante ?? '',
    p?.modelo ?? '',
    p?.origem ?? '',
    p?.status_atual ?? ''
  ]));

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head,
      body,
      startY: 68,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fontStyle: 'bold' },
      theme: 'grid',
      margin: { left: 40, right: 40 }
    });

    const blob = doc.output('blob');
    downloadBlob(`Valorapro_produtos_${dt}.pdf`, blob);
    toast('Exportado PDF.', 'success', 'OK');
    return;
  }

  // fallback simples (sem autotable)
  const lines = (items || []).slice(0, 45).map(p => {
    const ref = p?.cod_ref_id ?? '';
    const nome = p?.nome_produto ?? '';
    return `${ref}  —  ${nome}`;
  });

  doc.text(lines.join('\n'), 40, 90);
  const blob = doc.output('blob');
  downloadBlob(`Valorapro_produtos_${dt}.pdf`, blob);
  toast('Exportado PDF.', 'success', 'OK');
}

function normalizeImportItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w]+/g, '_');
}

function parseCSV(text) {
  const lines = String(text || '').split(/\r?\n/g).filter(l => l.trim().length);
  if (!lines.length) return [];

  const sep = (lines[0].includes(';') ? ';' : ',');

  const splitLine = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; }
        inQ = !inQ;
        continue;
      }
      if (!inQ && ch === sep) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map(x => String(x || '').trim());
  };

  const headers = splitLine(lines[0]).map(normalizeHeader);
  const items = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? '';
    });
    items.push(obj);
  }

  return items;
}

async function parseXLSXFile(file) {
  if (!window.XLSX) throw new Error('Biblioteca XLSX não carregada');
  const ab = await file.arrayBuffer();
  const wb = window.XLSX.read(ab, { type: 'array' });

  const first = wb.SheetNames?.[0];
  if (!first) return [];

  const ws = wb.Sheets[first];
  if (!ws) return [];

  // vira array de objetos usando a 1ª linha como cabeçalho
  const rawRows = window.XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

  // normaliza as chaves pra combinar com o import (cod_ref_id, codigo_barras, etc.)
  return rawRows.map(row => {
    const obj = {};
    for (const [k, v] of Object.entries(row || {})) {
      obj[normalizeHeader(k)] = v ?? '';
    }
    return obj;
  });
}

function mapImportProdutoToPayload(p) {
  const fornecedores = p?.fornecedores ?? p?.fornecedor ?? '';
  const segmentos = p?.segmentos ?? '';

  return {
    cod_ref_id: p?.cod_ref_id ?? p?.cod_ref ?? p?.cod_refid ?? '',
    codigo_barras: p?.codigo_barras ?? p?.cod_barras ?? '',
    nome_produto: p?.nome_produto ?? p?.produto ?? '',
    nome_generico: p?.nome_generico ?? '',
    fabricante: p?.fabricante ?? '',
    modelo: p?.modelo ?? '',
    cod_ref_fabric: p?.cod_ref_fabric ?? p?.cod_fabric ?? '',
    origem: p?.origem ?? '',
    status_atual: p?.status_atual ?? '',
    tipo_mercado: p?.tipo_mercado ?? '',
    utilizacao: p?.utilizacao ?? '',
    tipo_material: p?.tipo_material ?? '',

    fornecedores: Array.isArray(fornecedores) ? fornecedores : splitMultiText(fornecedores),
    ultimo_fornecedor: p?.ultimo_fornecedor ?? '',
    ultima_compra: (p?.ultima_compra ? String(p.ultima_compra).slice(0, 10) : ''),

    segmentos: Array.isArray(segmentos) ? segmentos : splitMultiText(segmentos),

    ...p
  };
}

async function importarProdutosFromFile(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', 'warn', 'Importar');
    return;
  }

  try {
    let items = [];
    const name = String(file.name || '').toLowerCase();

    if (name.endsWith('.csv')) {
      const txt = await file.text();
      items = parseCSV(txt);
    } else if (name.endsWith('.xlsx')) {
      items = await parseXLSXFile(file);
    } else {
      const txt = await file.text();
      const parsed = JSON.parse(txt);
      items = normalizeImportItems(parsed);
    }

    if (!items.length) {
      toast('Arquivo vazio ou inválido (sem itens).', 'warn', 'Importar');
      return;
    }

    const ok = await confirmValora(`Importar ${items.length} produto(s)?`, {
      title: 'Importar produtos',
      okText: 'Importar',
      cancelText: 'Cancelar'
    });
    if (!ok) return;

    const apiOk = await probeAPIProdutos();

    let okCount = 0;
    let failCount = 0;
    let updCount = 0;

    if (apiOk) {
      for (const raw of items) {
        const payload = mapImportProdutoToPayload(raw);

        if (!payload.nome_produto && !payload.nome_generico) {
          failCount++;
          continue;
        }

        try {
          await salvarProdutoNoServidor(payload, null);
          okCount++;
        } catch (_e) {
          failCount++;
        }
      }

      await carregarProdutos();
      toast(`Importação finalizada. ✅ ${okCount} / ❌ ${failCount}`, 'success', 'Importar');
      return;
    }

    if (!Array.isArray(state.produtos)) state.produtos = [];

    const findExisting = (pl) => {
      const ref = String(pl?.cod_ref_id || '').trim();
      const bar = String(pl?.codigo_barras || '').trim();

      if (ref) {
        const i = state.produtos.findIndex(x => String(x?.cod_ref_id || '').trim() === ref);
        if (i >= 0) return i;
      }
      if (bar) {
        const i = state.produtos.findIndex(x => String(x?.codigo_barras || '').trim() === bar);
        if (i >= 0) return i;
      }
      return -1;
    };

    for (const raw of items) {
      const payload = mapImportProdutoToPayload(raw);

      if (!payload.nome_produto && !payload.nome_generico) {
        failCount++;
        continue;
      }

      const idx = findExisting(payload);

      if (idx >= 0) {
        state.produtos[idx] = { ...state.produtos[idx], ...payload };
        updCount++;
      } else {
        const maxId = state.produtos.length ? Math.max(...state.produtos.map(x => Number(x?.id) || 0)) : 0;
        const newId = maxId + 1;
        state.produtos.push({ id: newId, data_cadastro: toISODateTime(), ...payload });
        okCount++;
      }
    }

    saveProdutosToStorage(state.produtos);
    renderTabelaProdutos();

    toast(`Importado: ${okCount} | Atualizados: ${updCount} | Falhas: ${failCount}`, 'success', 'Importar');
  } catch (err) {
    console.error(err);
    toast('Arquivo inválido (JSON/CSV) ou corrompido.', 'err', 'Importar');
  }
}

/* =========================
   Inicialização / Eventos
========================= */

async function onReady() {
  // garante modal fechado no load
  const modalBd = getEl('modal-produto-backdrop');
  if (modalBd) modalBd.setAttribute('hidden', '');

  initSelects();

  wireSegmentosSelect();
  wireFornecedoresSelect();
  renderSegmentosChips();
  renderFornecedoresChips();

  getEl('btn-gerenciar-segmentos')?.addEventListener('click', async () => {
    await openManageListModal('segmentos', 'Gerenciar Segmentos');
  });

  getEl('btn-gerenciar-fornecedores')?.addEventListener('click', async () => {
    await openManageListModal('fornecedor', 'Gerenciar Fornecedores');
  });

  getEl('campo-prod-controlado')?.addEventListener('change', updateProdutoControladoUI);
  updateProdutoControladoUI();

  initMovimentacaoUI();
  renderMovimentacoes();

  // ===== EXPORT MENU =====
  const btnExp = getEl('btn-exportar-produtos');
  const menuExp = getEl('menu-exportar-produtos');
  const btnExpXLSX = getEl('btn-exportar-xlsx');
  const btnExpCSV = getEl('btn-exportar-csv');
  const btnExpPDF = getEl('btn-exportar-pdf');
  const btnExpJSON = getEl('btn-exportar-json');

  // fallback: se não existir menu, usa confirm antigo
  if (btnExp && menuExp) {
    btnExp.addEventListener('click', (e) => {
      e.preventDefault();
      toggleDropdown(menuExp);
      // fecha o outro menu (import) se aberto
      closeDropdown(getEl('menu-importar-produtos'));
    });

    
    btnExpXLSX?.addEventListener('click', async () => {
      closeDropdown(menuExp);
      await exportarProdutosXLSX();
    });

    btnExpCSV?.addEventListener('click', async () => {
      closeDropdown(menuExp);
      await exportarProdutosCSV();
    });

    btnExpPDF?.addEventListener('click', async () => {
      closeDropdown(menuExp);
      await exportarProdutosPDF();
    });

    btnExpJSON?.addEventListener('click', async () => {
      closeDropdown(menuExp);
      await exportarProdutosJSON();
    });
  } else {
    // compatibilidade antiga (caso algum HTML antigo)
    getEl('btn-exportar-produtos')?.addEventListener('click', async () => {
      syncSelectedKeysWithState();
      const items = getProdutosParaExportar();
      const asCSV = await confirmValora(
        'Deseja exportar em CSV (Excel) ou JSON?',
        { title: 'Exportar produtos', okText: 'CSV (Excel)', cancelText: 'JSON' }
      );

      const dt = new Date().toISOString().slice(0, 10);

      if (asCSV) {
        const csv = produtosToCSV(items);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        downloadBlob(`Valorapro_produtos_${dt}.csv`, blob);
        toast('Exportado CSV.', 'success', 'OK');
        return;
      }

      const payload = {
        version: 1,
        exported_at: toISODateTime(),
        type: 'produtos',
        items
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      downloadBlob(`Valorapro_produtos_${dt}.json`, blob);
      toast('Exportado JSON.', 'success', 'OK');
    });
  }

  // ===== IMPORT MENU =====
  const btnImp = getEl('btn-importar-produtos');
  const menuImp = getEl('menu-importar-produtos');
  const btnImpXLSX = getEl('btn-importar-xlsx');
  const btnImpCSV = getEl('btn-importar-csv');
  const btnImpJSON = getEl('btn-importar-json');

  const fileInput = getEl('file-import-produtos');

  function triggerImport(acceptStr) {
    if (!fileInput) return;
    if (acceptStr) fileInput.setAttribute('accept', acceptStr);
    fileInput.click();
  }

  if (btnImp && menuImp) {
    btnImp.addEventListener('click', (e) => {
      e.preventDefault();
      toggleDropdown(menuImp);
      // fecha o outro menu (export) se aberto
      closeDropdown(getEl('menu-exportar-produtos'));
    });

    
    btnImpXLSX?.addEventListener('click', () => {
      closeDropdown(menuImp);
      triggerImport('.xlsx');
    });

    btnImpCSV?.addEventListener('click', () => {
      closeDropdown(menuImp);
      triggerImport('.csv');
    });

    btnImpJSON?.addEventListener('click', () => {
      closeDropdown(menuImp);
      triggerImport('.json');
    });
  } else {
    // fallback: botão direto
    getEl('btn-importar-produtos')?.addEventListener('click', () => triggerImport('.json,.csv'));
  }

  fileInput?.addEventListener('change', async () => {
    const f = fileInput.files?.[0] || null;
    fileInput.value = '';
    await importarProdutosFromFile(f);
  });

  getEl('btn-novo-produto')?.addEventListener('click', abrirModalProdutoNovo);

  getEl('busca-produtos')?.addEventListener('input', renderTabelaProdutos);
  getEl('filtro-origem-produto')?.addEventListener('change', renderTabelaProdutos);

  /* Seleção: listeners */
  const chkAll = getEl('chk-all-produtos');
  chkAll?.addEventListener('change', () => {
    const tbody = getEl('tbody-produtos');
    if (!tbody) return;

    const cbs = Array.from(tbody.querySelectorAll('input.Valora-row-check'));
    const checked = !!chkAll.checked;

    // marca/desmarca todos visíveis
    cbs.forEach(cb => { cb.checked = checked; });

    // atualiza Set
    const filtrados = getProdutosFiltrados();
    filtrados.forEach(p => {
      const key = produtoKey(p);
      if (!key) return;
      if (checked) SELECTED_PROD_KEYS.add(key);
      else SELECTED_PROD_KEYS.delete(key);
    });

    updateMasterCheckbox();
    renderTabelaProdutos();
  });

  getEl('tbody-produtos')?.addEventListener('change', (e) => {
    const cb = e.target?.closest?.('input.Valora-row-check');
    if (!cb) return;

    const key = String(cb.getAttribute('data-key') || '').trim();
    if (!key) return;

    if (cb.checked) SELECTED_PROD_KEYS.add(key);
    else SELECTED_PROD_KEYS.delete(key);

    updateMasterCheckbox();

    // atualiza contador sem re-render pesado
    const spanCount = getEl('contagem-produtos');
    const filtrados = getProdutosFiltrados();
    if (spanCount) {
      const qtd = filtrados.length;
      const sel = (Array.isArray(state.produtos) ? state.produtos.filter(p => SELECTED_PROD_KEYS.has(produtoKey(p))).length : 0);
      spanCount.textContent = qtd === 1 ? '1 item' : `${qtd} itens`;
      if (sel) spanCount.textContent += ` • ${sel} selecionados`;
    }
  });

  getEl('btn-fechar-modal-produto')?.addEventListener('click', fecharModalProduto);
  getEl('btn-cancelar-produto')?.addEventListener('click', fecharModalProduto);
  getEl('btn-salvar-produto')?.addEventListener('click', salvarProduto);

  const bd = getEl('modal-produto-backdrop');
  bd?.addEventListener('click', (e) => { if (e.target === bd) fecharModalProduto(); });

  getEl('tbody-produtos')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.Valora-icon-btn');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!id || Number.isNaN(id)) return;

    if (action === 'editar') {
      try {
        const apiOk = await probeAPIProdutos();
        let full = null;

        if (apiOk) full = await obterProdutoNoServidor(id);
        else full = (state.produtos || []).find(x => Number(x?.id) === id);

        if (!full) {
          toast('Produto não encontrado.', 'warn', 'Editar');
          return;
        }

        await abrirModalProdutoEditar(full);
      } catch (err) {
        console.error(err);
        toast(err?.message || 'Não foi possível abrir para editar.', 'err', 'Erro');
      }
      return;
    }

    if (action === 'excluir') {
      const ok = await confirmValora('Deseja realmente excluir este produto?', {
        title: 'Confirmar',
        okText: 'Excluir',
        cancelText: 'Cancelar'
      });

      if (!ok) return;

      try {
        const apiOk = await probeAPIProdutos();
        if (apiOk) {
          await excluirProdutoNoServidor(id);
          toast('Produto excluído no servidor.', 'success', 'OK');
          await carregarProdutos();
        } else {
          state.produtos = (state.produtos || []).filter(x => Number(x?.id) !== id);
          saveProdutosToStorage(state.produtos);
          renderTabelaProdutos();
          toast('Produto excluído (local).', 'success', 'OK');
        }
      } catch (err) {
        console.error(err);
        toast(err?.message || 'Erro ao excluir produto.', 'err', 'Erro');
      }
    }
  });

  // fecha dropdown clicando fora
  document.addEventListener('click', (e) => {
    const target = e.target;

    const expWrap = btnExp?.closest('.Valora-dd');
    const impWrap = btnImp?.closest('.Valora-dd');

    if (menuExp && expWrap && !isClickInside(expWrap, target)) closeDropdown(menuExp);
    if (menuImp && impWrap && !isClickInside(impWrap, target)) closeDropdown(menuImp);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    const modalOpen = bd && !bd.hidden;
    if (modalOpen) fecharModalProduto();

    closeDropdown(menuExp);
    closeDropdown(menuImp);
  });

  try {
    await carregarProdutos();
  } catch (e) {
    console.error(e);
    toast(e?.message || 'Erro ao carregar produtos.', 'err', 'Erro');
  }
}

/* =========================
   Export principal (bootstrap)
========================= */

export function initProdutosPage() {
  document.addEventListener('DOMContentLoaded', () => {
    onReady().catch(err => {
      console.error(err);
      toast(err?.message || 'Erro ao inicializar página de produtos.', 'err', 'Erro');
    });
  });
}
