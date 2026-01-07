// /frontend/js/pages/produtos.js
// V1 (sem API): dados fake com os campos reais + situação + classificação

const MAP_STATUS_ATUAL = { 1: 'Ativo', 2: 'Inativo', 3: 'Fora de Linha', 4: 'Suspenso' };
const MAP_TIPO_MERCADO = { 1: 'Mercado Continuo', 2: 'Mercado Sazional' };
const MAP_UTILIZACAO = { 1: 'Revenda', 2: 'Consumo Próprio', 3: 'Patrimonio', 4: 'Armazenamento p/ Terceiros' };
const MAP_TIPO_MATERIAL = { 1: 'Pronta Utilização (Acabado)', 2: 'Semi Acabado', 3: 'Materia Prima' };

function labelOrDash(map, v) {
  if (v == null || v === '') return '-';
  return map[Number(v)] || '-';
}
function yesNoOrDash(v) {
  if (v == null || v === '') return '-';
  return v ? 'Sim' : 'Não';
}

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

    status_atual: 1,
    tipo_mercado: 1,
    utilizacao: 1,
    tipo_material: 1,

    prod_controlado: false,
    segmentos: 'Alarmes',
    tipo_sistema: 'Alarme',
    classe: 'Equipamento',
    categorias: 'Central',
    subcategoria: '8 setores'
  },
  {
    id: 2,
    data_cadastro: '2026-01-05T10:13:00Z',
    cod_ref_id: 'CFTV-CAM-2MP',
    codigo_barras: '7890000000002',
    nome_generico: 'Câmera',
    nome_produto: 'Câmera Bullet 2MP IR 20m',
    fabricante: 'Hikvision',
    modelo: 'DS-2CE16D0T-IRF',
    cod_ref_fabric: 'HIK-2MP-IR20',
    origem: 'Importado',

    status_atual: 1,
    tipo_mercado: 1,
    utilizacao: 2,
    tipo_material: 1,

    prod_controlado: false,
    segmentos: 'CFTV',
    tipo_sistema: 'CFTV',
    classe: 'Equipamento',
    categorias: 'Câmeras',
    subcategoria: 'Bullet'
  }
];

let produtos = [...produtosFake];
let produtoEditandoId = null;

function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateBR(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('pt-BR');
}

function getEl(id) {
  return document.getElementById(id);
}

function preencherFiltroOrigem() {
  const sel = getEl('filtro-origem-produto');
  if (!sel) return;

  const atual = sel.value || '';

  const origens = Array.from(
    new Set(produtos.map(p => (p.origem || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  sel.innerHTML = `<option value="">Todas</option>`;
  origens.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o;
    opt.textContent = o;
    sel.appendChild(opt);
  });

  sel.value = origens.includes(atual) ? atual : '';
}

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

      labelOrDash(MAP_STATUS_ATUAL, p.status_atual),
      labelOrDash(MAP_TIPO_MERCADO, p.tipo_mercado),
      labelOrDash(MAP_UTILIZACAO, p.utilizacao),
      labelOrDash(MAP_TIPO_MATERIAL, p.tipo_material),

      yesNoOrDash(p.prod_controlado),
      p.segmentos,
      p.tipo_sistema,
      p.classe,
      p.categorias,
      p.subcategoria
    ]
      .map(x => (x || '').toString().toLowerCase())
      .join(' | ');

    const matchBusca = !busca || hay.includes(busca);
    const matchOrigem = !origemFiltro || (p.origem || '').trim() === origemFiltro;
    return matchBusca && matchOrigem;
  });

  tbody.innerHTML = '';

  filtrados.forEach(p => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${escapeHTML(p.cod_ref_id || '-')}</td>
      <td>${escapeHTML(p.codigo_barras || '-')}</td>
      <td>${escapeHTML(p.nome_produto || '-')}</td>
      <td>${escapeHTML(p.nome_generico || '-')}</td>
      <td>${escapeHTML(p.fabricante || '-')}</td>
      <td>${escapeHTML(p.modelo || '-')}</td>
      <td>${escapeHTML(p.cod_ref_fabric || '-')}</td>
      <td>${escapeHTML(p.origem || '-')}</td>

      <td>${escapeHTML(labelOrDash(MAP_STATUS_ATUAL, p.status_atual))}</td>
      <td>${escapeHTML(labelOrDash(MAP_TIPO_MERCADO, p.tipo_mercado))}</td>
      <td>${escapeHTML(labelOrDash(MAP_UTILIZACAO, p.utilizacao))}</td>
      <td>${escapeHTML(labelOrDash(MAP_TIPO_MATERIAL, p.tipo_material))}</td>

      <td>
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

/* ===== MODAL ===== */

function abrirModal(novo = true, produto = null) {
  const backdrop = getEl('modal-produto-backdrop');
  const titulo = getEl('modal-produto-titulo');
  if (!backdrop || !titulo) return;

  backdrop.hidden = false;

  const infoData = getEl('info-data-cadastro');
  const setVal = (id, v) => {
    const el = getEl(id);
    if (el) el.value = v ?? '';
  };

  if (novo) {
    produtoEditandoId = null;
    titulo.textContent = 'Novo produto';

    if (infoData) {
      infoData.hidden = true;
      infoData.textContent = '';
    }

    setVal('campo-cod-ref-id', '');
    setVal('campo-codigo-barras', '');
    setVal('campo-nome-generico', '');
    setVal('campo-nome-produto', '');
    setVal('campo-fabricante', '');
    setVal('campo-modelo', '');
    setVal('campo-cod-ref-fabric', '');
    setVal('campo-origem', '');

    setVal('campo-status-atual', '');
    setVal('campo-tipo-mercado', '');
    setVal('campo-utilizacao', '');
    setVal('campo-tipo-material', '');

    setVal('campo-prod-controlado', '');
    setVal('campo-segmentos', '');
    setVal('campo-tipo-sistema', '');
    setVal('campo-classe', '');
    setVal('campo-categorias', '');
    setVal('campo-subcategoria', '');
    return;
  }

  if (!produto) return;

  produtoEditandoId = produto.id;
  titulo.textContent = 'Editar produto';

  if (infoData) {
    infoData.hidden = false;
    infoData.textContent = `Cadastrado em: ${formatDateBR(produto.data_cadastro)}`;
  }

  setVal('campo-cod-ref-id', produto.cod_ref_id || '');
  setVal('campo-codigo-barras', produto.codigo_barras || '');
  setVal('campo-nome-generico', produto.nome_generico || '');
  setVal('campo-nome-produto', produto.nome_produto || '');
  setVal('campo-fabricante', produto.fabricante || '');
  setVal('campo-modelo', produto.modelo || '');
  setVal('campo-cod-ref-fabric', produto.cod_ref_fabric || '');
  setVal('campo-origem', produto.origem || '');

  setVal('campo-status-atual', produto.status_atual ?? '');
  setVal('campo-tipo-mercado', produto.tipo_mercado ?? '');
  setVal('campo-utilizacao', produto.utilizacao ?? '');
  setVal('campo-tipo-material', produto.tipo_material ?? '');

  // Prod. controlado no select: "1" sim, "0" não
  setVal('campo-prod-controlado', produto.prod_controlado === true ? '1' : (produto.prod_controlado === false ? '0' : ''));

  setVal('campo-segmentos', produto.segmentos || '');
  setVal('campo-tipo-sistema', produto.tipo_sistema || '');
  setVal('campo-classe', produto.classe || '');
  setVal('campo-categorias', produto.categorias || '');
  setVal('campo-subcategoria', produto.subcategoria || '');
}

function fecharModal() {
  const backdrop = getEl('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;
  produtoEditandoId = null;
}

function salvarProduto() {
  const cod_ref_id = getEl('campo-cod-ref-id')?.value.trim() || '';
  const codigo_barras = getEl('campo-codigo-barras')?.value.trim() || '';
  const nome_generico = getEl('campo-nome-generico')?.value.trim() || '';
  const nome_produto = getEl('campo-nome-produto')?.value.trim() || '';
  const fabricante = getEl('campo-fabricante')?.value.trim() || '';
  const modelo = getEl('campo-modelo')?.value.trim() || '';
  const cod_ref_fabric = getEl('campo-cod-ref-fabric')?.value.trim() || '';
  const origem = getEl('campo-origem')?.value.trim() || '';

  const status_atual = Number(getEl('campo-status-atual')?.value || 0) || null;
  const tipo_mercado = Number(getEl('campo-tipo-mercado')?.value || 0) || null;
  const utilizacao = Number(getEl('campo-utilizacao')?.value || 0) || null;
  const tipo_material = Number(getEl('campo-tipo-material')?.value || 0) || null;

  // classificação
  const pc = (getEl('campo-prod-controlado')?.value ?? '').toString();
  const prod_controlado = pc === '' ? null : (pc === '1');

  const segmentos = getEl('campo-segmentos')?.value.trim() || '';
  const tipo_sistema = getEl('campo-tipo-sistema')?.value.trim() || '';
  const classe = getEl('campo-classe')?.value.trim() || '';
  const categorias = getEl('campo-categorias')?.value.trim() || '';
  const subcategoria = getEl('campo-subcategoria')?.value.trim() || '';

  if (!nome_produto) {
    alert('Preencha pelo menos o Produto.');
    return;
  }

  if (produtoEditandoId == null) {
    const novoId = produtos.length > 0 ? Math.max(...produtos.map(p => p.id)) + 1 : 1;

    produtos.push({
      id: novoId,
      data_cadastro: new Date().toISOString(),

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
      segmentos,
      tipo_sistema,
      classe,
      categorias,
      subcategoria
    });
  } else {
    produtos = produtos.map(p =>
      p.id === produtoEditandoId
        ? {
            ...p,

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
            segmentos,
            tipo_sistema,
            classe,
            categorias,
            subcategoria
          }
        : p
    );
  }

  preencherFiltroOrigem();
  fecharModal();
  renderTabela();
}

/* ===== INIT ===== */

document.addEventListener('DOMContentLoaded', () => {
  const backdrop = getEl('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;

  preencherFiltroOrigem();
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

  const tbody = getEl('tbody-produtos');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.orca-icon-btn');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = Number(btn.dataset.id);
      const produto = produtos.find(p => p.id === id);
      if (!produto) return;

      if (action === 'editar') {
        abrirModal(false, produto);
      } else if (action === 'excluir') {
        if (confirm('Deseja realmente excluir este produto?')) {
          produtos = produtos.filter(p => p.id !== id);
          preencherFiltroOrigem();
          renderTabela();
        }
      }
    });
  }
});
