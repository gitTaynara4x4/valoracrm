// /frontend/js/pages/produtos.js

// Dados fake, só pra V1 visual
const produtosFake = [
  {
    id: 1,
    codigo: 'ALM-001',
    descricao: 'Central de alarme 8 setores',
    fabricante: 'Intelbras',
    tipo: 'equipamento',
    custo: 350.0,
    venda: 650.0
  },
  {
    id: 2,
    codigo: 'CFTV-CAM-2MP',
    descricao: 'Câmera Bullet 2MP IR 20m',
    fabricante: 'Hikvision',
    tipo: 'equipamento',
    custo: 180.0,
    venda: 390.0
  },
  {
    id: 3,
    codigo: 'SERV-MO-DIA',
    descricao: 'Mão de obra diária (equipe)',
    fabricante: '4X OrçaPro',
    tipo: 'servico',
    custo: 220.0,
    venda: 450.0
  },
  {
    id: 4,
    codigo: 'KIT-ALM-RES-8P',
    descricao: 'Kit Alarme Residencial até 8 pontos',
    fabricante: '4X OrçaPro',
    tipo: 'kit',
    custo: 1100.0,
    venda: 1950.0
  }
];

let produtos = [...produtosFake];
let produtoEditandoId = null;

function formatMoney(v) {
  if (v == null || isNaN(v)) return '-';
  return v.toFixed(2).replace('.', ',');
}

function calcMargem(custo, venda) {
  if (!custo || !venda) return null;
  const margem = ((venda - custo) / venda) * 100;
  return margem;
}

function renderTabela() {
  const tbody = document.getElementById('tbody-produtos');
  const spanCount = document.getElementById('contagem-produtos');
  const busca = (document.getElementById('busca-produtos')?.value || '').toLowerCase();
  const tipo = document.getElementById('filtro-tipo')?.value || '';

  if (!tbody) return;

  let filtrados = produtos.filter(p => {
    const matchBusca =
      !busca ||
      p.codigo.toLowerCase().includes(busca) ||
      p.descricao.toLowerCase().includes(busca) ||
      (p.fabricante || '').toLowerCase().includes(busca);

    const matchTipo = !tipo || p.tipo === tipo;
    return matchBusca && matchTipo;
  });

  tbody.innerHTML = '';

  filtrados.forEach(p => {
    const tr = document.createElement('tr');

    const margem = calcMargem(p.custo, p.venda);

    let tipoClass = 'orca-pill-tipo';
    if (p.tipo === 'equipamento') tipoClass += ' orca-pill-tipo--equipamento';
    else if (p.tipo === 'servico') tipoClass += ' orca-pill-tipo--servico';
    else if (p.tipo === 'kit') tipoClass += ' orca-pill-tipo--kit';

    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td>${p.fabricante || '-'}</td>
      <td><span class="${tipoClass}">${p.tipo}</span></td>
      <td>R$ ${formatMoney(Number(p.custo))}</td>
      <td>R$ ${formatMoney(Number(p.venda))}</td>
      <td>${margem == null ? '-' : formatMoney(margem) + '%'}</td>
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
    spanCount.textContent =
      filtrados.length === 1 ? '1 produto' : `${filtrados.length} produtos`;
  }
}

/* ===== MODAL ===== */

function abrirModal(novo = true, produto = null) {
  const backdrop = document.getElementById('modal-produto-backdrop');
  const titulo = document.getElementById('modal-produto-titulo');

  if (!backdrop || !titulo) return;

  backdrop.hidden = false;

  if (novo) {
    produtoEditandoId = null;
    titulo.textContent = 'Novo produto';
    document.getElementById('campo-codigo').value = '';
    document.getElementById('campo-descricao').value = '';
    document.getElementById('campo-fabricante').value = '';
    document.getElementById('campo-tipo').value = 'equipamento';
    document.getElementById('campo-custo').value = '';
    document.getElementById('campo-venda').value = '';
  } else if (produto) {
    produtoEditandoId = produto.id;
    titulo.textContent = 'Editar produto';
    document.getElementById('campo-codigo').value = produto.codigo || '';
    document.getElementById('campo-descricao').value = produto.descricao || '';
    document.getElementById('campo-fabricante').value = produto.fabricante || '';
    document.getElementById('campo-tipo').value = produto.tipo || 'equipamento';
    document.getElementById('campo-custo').value = produto.custo ?? '';
    document.getElementById('campo-venda').value = produto.venda ?? '';
  }
}

function fecharModal() {
  const backdrop = document.getElementById('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;
  produtoEditandoId = null;
}

function salvarProduto() {
  const codigo = document.getElementById('campo-codigo').value.trim();
  const descricao = document.getElementById('campo-descricao').value.trim();
  const fabricante = document.getElementById('campo-fabricante').value.trim();
  const tipo = document.getElementById('campo-tipo').value;
  const custo = Number(document.getElementById('campo-custo').value || 0);
  const venda = Number(document.getElementById('campo-venda').value || 0);

  if (!codigo || !descricao) {
    alert('Preencha pelo menos Código e Descrição.');
    return;
  }

  if (produtoEditandoId == null) {
    const novoId =
      produtos.length > 0 ? Math.max(...produtos.map(p => p.id)) + 1 : 1;
    produtos.push({
      id: novoId,
      codigo,
      descricao,
      fabricante,
      tipo,
      custo,
      venda
    });
  } else {
    produtos = produtos.map(p =>
      p.id === produtoEditandoId
        ? { ...p, codigo, descricao, fabricante, tipo, custo, venda }
        : p
    );
  }

  fecharModal();
  renderTabela();
}

/* ===== INIT ===== */

document.addEventListener('DOMContentLoaded', () => {
  // Garante que o modal começa fechado
  const backdrop = document.getElementById('modal-produto-backdrop');
  if (backdrop) backdrop.hidden = true;

  // Render inicial da tabela
  renderTabela();

  // Busca / filtro
  const inputBusca = document.getElementById('busca-produtos');
  const selectTipo = document.getElementById('filtro-tipo');

  if (inputBusca) {
    inputBusca.addEventListener('input', () => renderTabela());
  }
  if (selectTipo) {
    selectTipo.addEventListener('change', () => renderTabela());
  }

  // Novo produto
  const btnNovo = document.getElementById('btn-novo-produto');
  if (btnNovo) {
    btnNovo.addEventListener('click', () => abrirModal(true, null));
  }

  // Fechar modal
  const btnFechar = document.getElementById('btn-fechar-modal');
  const btnCancelar = document.getElementById('btn-cancelar-produto');
  if (btnFechar) btnFechar.addEventListener('click', fecharModal);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModal);

  // Clique fora do modal fecha
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) fecharModal();
    });
  }

  // Ações na tabela (editar / excluir)
  const tbody = document.getElementById('tbody-produtos');
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
          renderTabela();
        }
      }
    });
  }
});
