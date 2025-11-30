// /frontend/js/pages/clientes.js

// Dados fake, só pra V1 visual
const clientesFake = [
  {
    id: 1,
    codigo: 'CLI-0001',
    tipo: 'pj',
    nome: 'Padaria do Centro',
    documento: '12.345.678/0001-99',
    telefone: '(11) 3333-4444',
    whatsapp: '(11) 98888-7777',
    cidade: 'São Paulo',
    uf: 'SP'
  },
  {
    id: 2,
    codigo: 'CLI-0002',
    tipo: 'pf',
    nome: 'João da Silva',
    documento: '123.456.789-10',
    telefone: '(11) 4002-8922',
    whatsapp: '(11) 97777-1234',
    cidade: 'Guarulhos',
    uf: 'SP'
  },
  {
    id: 3,
    codigo: 'CLI-0003',
    tipo: 'pj',
    nome: 'Condomínio Residencial Jardins',
    documento: '98.765.432/0001-55',
    telefone: '(21) 3555-1122',
    whatsapp: '(21) 98888-5566',
    cidade: 'Rio de Janeiro',
    uf: 'RJ'
  }
];

let clientes = [...clientesFake];
let clienteEditandoId = null;

function formatTipo(tipo) {
  if (tipo === 'pf') return 'Pessoa Física';
  if (tipo === 'pj') return 'Pessoa Jurídica';
  return '-';
}

function renderTabelaClientes() {
  const tbody = document.getElementById('tbody-clientes');
  const spanCount = document.getElementById('contagem-clientes');
  const busca = (document.getElementById('busca-clientes')?.value || '').toLowerCase();
  const tipoFiltro = document.getElementById('filtro-tipo-cliente')?.value || '';

  if (!tbody) return;

  let filtrados = clientes.filter(c => {
    const texto = [
      c.codigo,
      c.nome,
      c.documento,
      c.telefone,
      c.whatsapp,
      c.cidade,
      c.uf
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchBusca = !busca || texto.includes(busca);
    const matchTipo = !tipoFiltro || c.tipo === tipoFiltro;

    return matchBusca && matchTipo;
  });

  tbody.innerHTML = '';

  filtrados.forEach(c => {
    const tr = document.createElement('tr');

    let tipoClass = 'orca-pill-tipo';
    if (c.tipo === 'pf') tipoClass += ' orca-pill-tipo--pf';
    else if (c.tipo === 'pj') tipoClass += ' orca-pill-tipo--pj';

    tr.innerHTML = `
      <td>${c.codigo || '-'}</td>
      <td>${c.nome || '-'}</td>
      <td><span class="${tipoClass}">${formatTipo(c.tipo)}</span></td>
      <td>${c.documento || '-'}</td>
      <td>${(c.cidade || '-') + ' / ' + (c.uf || '-')}</td>
      <td>${c.telefone || '-'}</td>
      <td>${c.whatsapp || '-'}</td>
      <td>
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

  if (spanCount) {
    const qtd = filtrados.length;
    spanCount.textContent = qtd === 1 ? '1 cliente' : `${qtd} clientes`;
  }
}

/* ===== MODAL ===== */

function abrirModalCliente(novo = true, cliente = null) {
  const backdrop = document.getElementById('modal-cliente-backdrop');
  const titulo = document.getElementById('modal-cliente-titulo');

  if (!backdrop || !titulo) return;

  // abre de verdade
  backdrop.hidden = false;
  backdrop.style.display = 'flex';

  const campoCodigo = document.getElementById('campo-codigo-cliente');
  const campoTipo = document.getElementById('campo-tipo-cliente');
  const campoNome = document.getElementById('campo-nome-cliente');
  const campoDoc = document.getElementById('campo-documento-cliente');
  const campoTel = document.getElementById('campo-telefone-cliente');
  const campoZap = document.getElementById('campo-whatsapp-cliente');
  const campoCidade = document.getElementById('campo-cidade-cliente');
  const campoUf = document.getElementById('campo-uf-cliente');

  if (novo) {
    clienteEditandoId = null;
    titulo.textContent = 'Novo cliente';

    const proximoId = clientes.length > 0 ? Math.max(...clientes.map(c => c.id)) + 1 : 1;
    const codigoSugerido = `CLI-${String(proximoId).padStart(4, '0')}`;

    campoCodigo.value = codigoSugerido;
    campoTipo.value = 'pf';
    campoNome.value = '';
    campoDoc.value = '';
    campoTel.value = '';
    campoZap.value = '';
    campoCidade.value = '';
    campoUf.value = '';
  } else if (cliente) {
    clienteEditandoId = cliente.id;
    titulo.textContent = 'Editar cliente';

    campoCodigo.value = cliente.codigo || '';
    campoTipo.value = cliente.tipo || 'pf';
    campoNome.value = cliente.nome || '';
    campoDoc.value = cliente.documento || '';
    campoTel.value = cliente.telefone || '';
    campoZap.value = cliente.whatsapp || '';
    campoCidade.value = cliente.cidade || '';
    campoUf.value = cliente.uf || '';
  }
}

function fecharModalCliente() {
  const backdrop = document.getElementById('modal-cliente-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
  clienteEditandoId = null;
}

function salvarCliente() {
  const campoCodigo = document.getElementById('campo-codigo-cliente');
  const campoTipo = document.getElementById('campo-tipo-cliente');
  const campoNome = document.getElementById('campo-nome-cliente');
  const campoDoc = document.getElementById('campo-documento-cliente');
  const campoTel = document.getElementById('campo-telefone-cliente');
  const campoZap = document.getElementById('campo-whatsapp-cliente');
  const campoCidade = document.getElementById('campo-cidade-cliente');
  const campoUf = document.getElementById('campo-uf-cliente');

  const codigo = (campoCodigo.value || '').trim();
  const tipo = campoTipo.value;
  const nome = (campoNome.value || '').trim();
  const documento = (campoDoc.value || '').trim();
  const telefone = (campoTel.value || '').trim();
  const whatsapp = (campoZap.value || '').trim();
  const cidade = (campoCidade.value || '').trim();
  const uf = (campoUf.value || '').trim().toUpperCase();

  if (!nome) {
    alert('Preencha pelo menos o Nome / Fantasia do cliente.');
    return;
  }

  if (!tipo) {
    alert('Selecione o tipo de cliente (PF ou PJ).');
    return;
  }

  if (clienteEditandoId == null) {
    const novoId = clientes.length > 0 ? Math.max(...clientes.map(c => c.id)) + 1 : 1;
    clientes.push({
      id: novoId,
      codigo: codigo || `CLI-${String(novoId).padStart(4, '0')}`,
      tipo,
      nome,
      documento,
      telefone,
      whatsapp,
      cidade,
      uf
    });
  } else {
    clientes = clientes.map(c =>
      c.id === clienteEditandoId
        ? {
            ...c,
            codigo: codigo || c.codigo,
            tipo,
            nome,
            documento,
            telefone,
            whatsapp,
            cidade,
            uf
          }
        : c
    );
  }

  fecharModalCliente();
  renderTabelaClientes();
}

/* ===== INIT ===== */

document.addEventListener('DOMContentLoaded', () => {
  const backdrop = document.getElementById('modal-cliente-backdrop');
  if (backdrop) {
    // garante que SEMPRE começa fechado
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }

  // Render inicial
  renderTabelaClientes();

  // Busca / filtro
  const inputBusca = document.getElementById('busca-clientes');
  const selectTipo = document.getElementById('filtro-tipo-cliente');

  if (inputBusca) {
    inputBusca.addEventListener('input', () => renderTabelaClientes());
  }
  if (selectTipo) {
    selectTipo.addEventListener('change', () => renderTabelaClientes());
  }

  // Novo cliente
  const btnNovo = document.getElementById('btn-novo-cliente');
  if (btnNovo) {
    btnNovo.addEventListener('click', () => abrirModalCliente(true, null));
  }

  // Fechar modal
  const btnFechar = document.getElementById('btn-fechar-modal-cliente');
  const btnCancelar = document.getElementById('btn-cancelar-cliente');
  const btnSalvar = document.getElementById('btn-salvar-cliente');

  if (btnFechar) btnFechar.addEventListener('click', fecharModalCliente);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModalCliente);
  if (btnSalvar) btnSalvar.addEventListener('click', salvarCliente);

  // Clique fora do modal fecha
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) fecharModalCliente();
    });
  }

  // Ações na tabela (editar / excluir)
  const tbody = document.getElementById('tbody-clientes');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.orca-icon-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = Number(btn.dataset.id);
      const cliente = clientes.find(c => c.id === id);
      if (!cliente) return;

      if (action === 'editar') {
        abrirModalCliente(false, cliente);
      } else if (action === 'excluir') {
        if (confirm('Deseja realmente excluir este cliente?')) {
          clientes = clientes.filter(c => c.id !== id);
          renderTabelaClientes();
        }
      }
    });
  }
});
