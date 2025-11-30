// /frontend/js/pages/propostas.js

// Dados fake, só pra V1 visual
const propostasFake = [
  {
    id: 1,
    numero: 'PROP-0001',
    cliente: 'Padaria do Centro',
    tipo: 'Alarme monitorado + Sensores',
    valorTotal: 3250.0,
    status: 'rascunho',
    data: '2025-11-20',
    observacoes: 'Proposta inicial, aguardando retorno do cliente.'
  },
  {
    id: 2,
    numero: 'PROP-0002',
    cliente: 'Condomínio Residencial Jardins',
    tipo: 'CFTV 16 câmeras + NVR',
    valorTotal: 14890.0,
    status: 'enviada',
    data: '2025-11-18',
    observacoes: 'Enviada por e-mail para o síndico.'
  },
  {
    id: 3,
    numero: 'PROP-0003',
    cliente: 'João da Silva',
    tipo: 'Kit alarme residencial',
    valorTotal: 1890.0,
    status: 'aprovada',
    data: '2025-11-10',
    observacoes: 'Instalação agendada após aprovação.'
  },
  {
    id: 4,
    numero: 'PROP-0004',
    cliente: 'Auto Peças Avenida',
    tipo: 'CFTV 8 câmeras',
    valorTotal: 7590.0,
    status: 'recusada',
    data: '2025-11-05',
    observacoes: 'Cliente adiou investimento para 2026.'
  }
];

let propostas = [...propostasFake];
let propostaEditandoId = null;

function formatStatus(status) {
  switch (status) {
    case 'rascunho': return 'Rascunho';
    case 'enviada':  return 'Enviada';
    case 'aprovada': return 'Aprovada';
    case 'recusada': return 'Recusada';
    default:         return '-';
  }
}

function formatMoney(v) {
  if (v == null || isNaN(v)) return '-';
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

function formatDataISOParaBR(iso) {
  if (!iso) return '-';
  // se vier "YYYY-MM-DD"
  const partes = iso.split('-');
  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }
  return iso;
}

function renderTabelaPropostas() {
  const tbody = document.getElementById('tbody-propostas');
  const spanCount = document.getElementById('contagem-propostas');
  const busca = (document.getElementById('busca-propostas')?.value || '').toLowerCase();
  const statusFiltro = document.getElementById('filtro-status-proposta')?.value || '';

  if (!tbody) return;

  let filtradas = propostas.filter(p => {
    const texto = [
      p.numero,
      p.cliente,
      p.tipo,
      p.status
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchBusca = !busca || texto.includes(busca);
    const matchStatus = !statusFiltro || p.status === statusFiltro;

    return matchBusca && matchStatus;
  });

  tbody.innerHTML = '';

  filtradas.forEach(p => {
    const tr = document.createElement('tr');

    let statusClass = 'orca-pill-status';
    if (p.status === 'rascunho') statusClass += ' orca-pill-status--rascunho';
    else if (p.status === 'enviada') statusClass += ' orca-pill-status--enviada';
    else if (p.status === 'aprovada') statusClass += ' orca-pill-status--aprovada';
    else if (p.status === 'recusada') statusClass += ' orca-pill-status--recusada';

    tr.innerHTML = `
      <td>${p.numero || '-'}</td>
      <td>${p.cliente || '-'}</td>
      <td>${p.tipo || '-'}</td>
      <td>${formatMoney(Number(p.valorTotal))}</td>
      <td><span class="${statusClass}">${formatStatus(p.status)}</span></td>
      <td>${formatDataISOParaBR(p.data)}</td>
      <td>
        <div class="orca-table-actions">
          <button class="orca-icon-btn" data-action="editar" data-id="${p.id}" title="Editar proposta">
            <i class="fa-solid fa-pen"></i>
          </button>
          <button class="orca-icon-btn" data-action="excluir" data-id="${p.id}" title="Excluir proposta">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  if (spanCount) {
    const qtd = filtradas.length;
    spanCount.textContent = qtd === 1 ? '1 proposta' : `${qtd} propostas`;
  }
}

/* ===== MODAL ===== */

function abrirModalProposta(novo = true, proposta = null) {
  const backdrop = document.getElementById('modal-proposta-backdrop');
  const titulo = document.getElementById('modal-proposta-titulo');

  if (!backdrop || !titulo) return;

  // abre de verdade
  backdrop.hidden = false;
  backdrop.style.display = 'flex';

  const campoNumero = document.getElementById('campo-numero-proposta');
  const campoCliente = document.getElementById('campo-cliente-proposta');
  const campoTipo = document.getElementById('campo-tipo-proposta');
  const campoValor = document.getElementById('campo-valor-proposta');
  const campoStatus = document.getElementById('campo-status-proposta');
  const campoData = document.getElementById('campo-data-proposta');
  const campoObs = document.getElementById('campo-observacoes-proposta');

  if (novo) {
    propostaEditandoId = null;
    titulo.textContent = 'Nova proposta';

    const proximoId = propostas.length > 0 ? Math.max(...propostas.map(p => p.id)) + 1 : 1;
    const numeroSugerido = `PROP-${String(proximoId).padStart(4, '0')}`;

    campoNumero.value = numeroSugerido;
    campoCliente.value = '';
    campoTipo.value = '';
    campoValor.value = '';
    campoStatus.value = 'rascunho';
    campoData.value = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    campoObs.value = '';
  } else if (proposta) {
    propostaEditandoId = proposta.id;
    titulo.textContent = 'Editar proposta';

    campoNumero.value = proposta.numero || '';
    campoCliente.value = proposta.cliente || '';
    campoTipo.value = proposta.tipo || '';
    campoValor.value = proposta.valorTotal ?? '';
    campoStatus.value = proposta.status || 'rascunho';

    // data deve ficar em formato yyyy-mm-dd para input date
    if (proposta.data && proposta.data.includes('-')) {
      campoData.value = proposta.data;
    } else {
      campoData.value = '';
    }

    campoObs.value = proposta.observacoes || '';
  }
}

function fecharModalProposta() {
  const backdrop = document.getElementById('modal-proposta-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
  propostaEditandoId = null;
}

function salvarProposta() {
  const campoNumero = document.getElementById('campo-numero-proposta');
  const campoCliente = document.getElementById('campo-cliente-proposta');
  const campoTipo = document.getElementById('campo-tipo-proposta');
  const campoValor = document.getElementById('campo-valor-proposta');
  const campoStatus = document.getElementById('campo-status-proposta');
  const campoData = document.getElementById('campo-data-proposta');
  const campoObs = document.getElementById('campo-observacoes-proposta');

  const numero = (campoNumero.value || '').trim();
  const cliente = (campoCliente.value || '').trim();
  const tipo = (campoTipo.value || '').trim();
  const valorTotal = Number(campoValor.value || 0);
  const status = campoStatus.value;
  const data = campoData.value || null;
  const observacoes = (campoObs.value || '').trim();

  if (!cliente) {
    alert('Informe o cliente da proposta.');
    return;
  }

  if (!tipo) {
    alert('Informe o tipo da proposta (Alarme, CFTV, etc.).');
    return;
  }

  if (!numero) {
    alert('Número da proposta inválido.');
    return;
  }

  if (propostaEditandoId == null) {
    const novoId = propostas.length > 0 ? Math.max(...propostas.map(p => p.id)) + 1 : 1;
    propostas.push({
      id: novoId,
      numero,
      cliente,
      tipo,
      valorTotal,
      status,
      data,
      observacoes
    });
  } else {
    propostas = propostas.map(p =>
      p.id === propostaEditandoId
        ? {
            ...p,
            numero,
            cliente,
            tipo,
            valorTotal,
            status,
            data,
            observacoes
          }
        : p
    );
  }

  fecharModalProposta();
  renderTabelaPropostas();
}

/* ===== INIT ===== */

document.addEventListener('DOMContentLoaded', () => {
  const backdrop = document.getElementById('modal-proposta-backdrop');
  if (backdrop) {
    // garante que SEMPRE começa fechado
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }

  // Render inicial
  renderTabelaPropostas();

  // Busca / filtro
  const inputBusca = document.getElementById('busca-propostas');
  const selectStatus = document.getElementById('filtro-status-proposta');

  if (inputBusca) {
    inputBusca.addEventListener('input', () => renderTabelaPropostas());
  }
  if (selectStatus) {
    selectStatus.addEventListener('change', () => renderTabelaPropostas());
  }

  // Nova proposta
  const btnNova = document.getElementById('btn-nova-proposta');
  if (btnNova) {
    btnNova.addEventListener('click', () => abrirModalProposta(true, null));
  }

  // Fechar modal
  const btnFechar = document.getElementById('btn-fechar-modal-proposta');
  const btnCancelar = document.getElementById('btn-cancelar-proposta');
  const btnSalvar = document.getElementById('btn-salvar-proposta');

  if (btnFechar) btnFechar.addEventListener('click', fecharModalProposta);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModalProposta);
  if (btnSalvar) btnSalvar.addEventListener('click', salvarProposta);

  // Clique fora do modal fecha
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) fecharModalProposta();
    });
  }

  // Ações na tabela (editar / excluir)
  const tbody = document.getElementById('tbody-propostas');
  if (tbody) {
    tbody.addEventListener('click', e => {
      const btn = e.target.closest('.orca-icon-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = Number(btn.dataset.id);
      const proposta = propostas.find(p => p.id === id);
      if (!proposta) return;

      if (action === 'editar') {
        abrirModalProposta(false, proposta);
      } else if (action === 'excluir') {
        if (confirm('Deseja realmente excluir esta proposta?')) {
          propostas = propostas.filter(p => p.id !== id);
          renderTabelaPropostas();
        }
      }
    });
  }
});
