// /frontend/js/pages/propostas.js

// Dados fake, só pra V1 visual
const propostasFake = [
  {
    id: 1,
    numero: 'PROP-0001',
    cliente: 'Padaria do Centro',
    telefone: '(24) 98888-0001',
    email: 'contato@padariadocentro.com',
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
    telefone: '(24) 97777-0002',
    email: 'sindico@condjardins.com',
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
    telefone: '(24) 96666-0003',
    email: 'joao@gmail.com',
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
    telefone: '(24) 95555-0004',
    email: 'contato@autopecasavenida.com',
    tipo: 'CFTV 8 câmeras',
    valorTotal: 7590.0,
    status: 'recusada',
    data: '2025-11-05',
    observacoes: 'Cliente adiou investimento para 2026.'
  }
];

let propostas = [...propostasFake];
let propostaEditandoId = null;

// Etapa atual do modal: 1 = dados do cliente, 2 = produtos
let modalStep = 1;

// Catálogo fake para busca de produtos dentro do modal
const catalogoProdutosModal = [
  {
    id: 1,
    codigo: 'ALM-001',
    descricao: 'Central de alarme 8 setores',
    preco: 650.0
  },
  {
    id: 2,
    codigo: 'CFTV-CAM-2MP',
    descricao: 'Câmera Bullet 2MP IR 20m',
    preco: 390.0
  },
  {
    id: 3,
    codigo: 'SERV-MO-DIA',
    descricao: 'Mão de obra diária (equipe)',
    preco: 450.0
  },
  {
    id: 4,
    codigo: 'KIT-ALM-RES-8P',
    descricao: 'Kit Alarme Residencial até 8 pontos',
    preco: 1950.0
  }
];

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

// Converte texto "R$ 1.234,56" para número 1234.56
function parseMoneyString(str) {
  if (!str) return 0;
  let s = String(str)
    .replace(/[R$\s]/g, '') // tira R$ e espaços
    .replace(/\./g, '')     // tira pontos de milhar
    .replace(',', '.');     // vírgula -> ponto
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

function formatDataISOParaBR(iso) {
  if (!iso) return '-';
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
      <td>${formatMoney(Number(p.valorTotal || 0))}</td>
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

/* ===== CONTROLE DAS ETAPAS DO MODAL ===== */

function setModalStep(step) {
  modalStep = step;

  const stepCliente = document.getElementById('step-dados-cliente');
  const stepProdutos = document.getElementById('step-produtos');
  const label = document.getElementById('modal-etapa-label');
  const btnVoltar = document.getElementById('btn-voltar-proposta');
  const btnSalvar = document.getElementById('btn-salvar-proposta');

  if (stepCliente && stepProdutos) {
    if (step === 1) {
      stepCliente.style.display = 'grid';
      stepProdutos.style.display = 'none';
    } else {
      stepCliente.style.display = 'none';
      stepProdutos.style.display = 'grid';
    }
  }

  if (label) {
    label.textContent =
      step === 1
        ? 'Etapa 1 de 2 — Dados do cliente'
        : 'Etapa 2 de 2 — Produtos';
  }

  if (btnVoltar) {
    btnVoltar.style.display = step === 1 ? 'none' : 'inline-flex';
  }

  if (btnSalvar) {
    btnSalvar.textContent = step === 1 ? 'Avançar' : 'Salvar';
  }
}

function validarEtapaDadosCliente() {
  const campoCliente = document.getElementById('campo-cliente-proposta');
  const campoNumero = document.getElementById('campo-numero-proposta');

  const nome = (campoCliente?.value || '').trim();
  const numero = (campoNumero?.value || '').trim();

  if (!nome) {
    alert('Informe o nome do cliente.');
    if (campoCliente) campoCliente.focus();
    return false;
  }

  if (!numero) {
    alert('Número da proposta inválido.');
    if (campoNumero) campoNumero.focus();
    return false;
  }

  return true;
}

/* ===== LISTA DE PRODUTOS DENTRO DO MODAL ===== */

function renderListaProdutosModal(filtroTexto = '') {
  const lista = document.getElementById('lista-produtos-modal');
  if (!lista) return;

  const busca = (filtroTexto || '').toLowerCase().trim();

  let filtrados = catalogoProdutosModal.filter(p => {
    const texto = `${p.codigo} ${p.descricao}`.toLowerCase();
    return !busca || texto.includes(busca);
  });

  lista.innerHTML = '';

  if (filtrados.length === 0) {
    lista.innerHTML = `
      <p style="font-size:0.8rem;color:#9ca3af;margin:4px 6px;">
        Nenhum produto encontrado para essa busca.
      </p>
    `;
    return;
  }

  filtrados.forEach(prod => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.display = 'flex';
    btn.style.justifyContent = 'space-between';
    btn.style.alignItems = 'center';
    btn.style.padding = '6px 8px';
    btn.style.borderRadius = '8px';
    btn.style.border = 'none';
    btn.style.background = 'transparent';
    btn.style.color = '#e5e7eb';
    btn.style.fontSize = '0.84rem';
    btn.style.cursor = 'pointer';

    btn.innerHTML = `
      <span>
        <strong>${prod.codigo}</strong> — ${prod.descricao}
      </span>
      <span style="opacity:.75;font-size:0.78rem;">
        ${formatMoney(prod.preco)}
      </span>
    `;

    btn.addEventListener('click', () => {
      // Por enquanto só mostra um aviso.
      // Depois a gente faz o "carrinho" de itens da proposta.
      alert(`(Futuro) Adicionar produto: ${prod.codigo} — ${prod.descricao}`);
    });

    lista.appendChild(btn);
  });
}

/* ===== MODAL: ABRIR / FECHAR / SALVAR ===== */

function abrirModalProposta(novo = true, proposta = null) {
  const backdrop = document.getElementById('modal-proposta-backdrop');
  const titulo = document.getElementById('modal-proposta-titulo');

  if (!backdrop || !titulo) return;

  // abre de verdade
  backdrop.hidden = false;
  backdrop.style.display = 'flex';

  const campoNumero = document.getElementById('campo-numero-proposta');
  const campoCliente = document.getElementById('campo-cliente-proposta');
  const campoTelefone = document.getElementById('campo-telefone-cliente');
  const campoEmail = document.getElementById('campo-email-cliente');
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

    if (campoNumero) campoNumero.value = numeroSugerido;
    if (campoCliente) campoCliente.value = '';
    if (campoTelefone) campoTelefone.value = '';
    if (campoEmail) campoEmail.value = '';
    if (campoTipo) campoTipo.value = '';
    if (campoValor) campoValor.value = '';
    if (campoStatus) campoStatus.value = 'rascunho';
    if (campoData) campoData.value = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
    if (campoObs) campoObs.value = '';
  } else if (proposta) {
    propostaEditandoId = proposta.id;
    titulo.textContent = 'Editar proposta';

    if (campoNumero) campoNumero.value = proposta.numero || '';
    if (campoCliente) campoCliente.value = proposta.cliente || '';
    if (campoTelefone) campoTelefone.value = proposta.telefone || '';
    if (campoEmail) campoEmail.value = proposta.email || '';
    if (campoTipo) campoTipo.value = proposta.tipo || '';
    if (campoValor) {
      campoValor.value =
        proposta.valorTotal != null
          ? formatMoney(Number(proposta.valorTotal))
          : '';
    }
    if (campoStatus) campoStatus.value = proposta.status || 'rascunho';

    if (campoData) {
      if (proposta.data && proposta.data.includes('-')) {
        campoData.value = proposta.data;
      } else {
        campoData.value = '';
      }
    }

    if (campoObs) campoObs.value = proposta.observacoes || '';
  }

  // Sempre começa na etapa 1 ao abrir
  setModalStep(1);
}

function fecharModalProposta() {
  const backdrop = document.getElementById('modal-proposta-backdrop');
  if (backdrop) {
    backdrop.hidden = true;
    backdrop.style.display = 'none';
  }
  propostaEditandoId = null;
  modalStep = 1;
}

function salvarProposta() {
  const campoNumero = document.getElementById('campo-numero-proposta');
  const campoCliente = document.getElementById('campo-cliente-proposta');
  const campoTelefone = document.getElementById('campo-telefone-cliente');
  const campoEmail = document.getElementById('campo-email-cliente');
  const campoTipo = document.getElementById('campo-tipo-proposta');
  const campoValor = document.getElementById('campo-valor-proposta');
  const campoStatus = document.getElementById('campo-status-proposta');
  const campoData = document.getElementById('campo-data-proposta');
  const campoObs = document.getElementById('campo-observacoes-proposta');

  const numero = (campoNumero?.value || '').trim();
  const cliente = (campoCliente?.value || '').trim();
  const telefone = (campoTelefone?.value || '').trim();
  const email = (campoEmail?.value || '').trim();
  const tipo = (campoTipo?.value || '').trim();
  const valorTotal = parseMoneyString(campoValor?.value || '');
  const status = campoStatus?.value || 'rascunho';
  const data = campoData?.value || null;
  const observacoes = (campoObs?.value || '').trim();

  if (!cliente) {
    alert('Informe o nome do cliente.');
    if (campoCliente) campoCliente.focus();
    return;
  }

  if (!tipo) {
    alert('Informe o tipo da proposta (Alarme, CFTV, etc.).');
    if (campoTipo) campoTipo.focus();
    return;
  }

  if (!numero) {
    alert('Número da proposta inválido.');
    if (campoNumero) campoNumero.focus();
    return;
  }

  if (propostaEditandoId == null) {
    const novoId = propostas.length > 0 ? Math.max(...propostas.map(p => p.id)) + 1 : 1;
    propostas.push({
      id: novoId,
      numero,
      cliente,
      telefone,
      email,
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
            telefone,
            email,
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

/* ===== MÁSCARA DO CAMPO DE VALOR ===== */

function initMascaraValorProposta() {
  const campoValor = document.getElementById('campo-valor-proposta');
  if (!campoValor) return;

  campoValor.addEventListener('input', () => {
    const digits = campoValor.value.replace(/\D/g, '');
    if (!digits) {
      campoValor.value = '';
      return;
    }

    const num = Number(digits) / 100; // centavos -> reais
    campoValor.value = formatMoney(num);
  });
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

  // Máscara no campo de valor
  initMascaraValorProposta();

  // Busca / filtro da lista de propostas
  const inputBusca = document.getElementById('busca-propostas');
  const selectStatus = document.getElementById('filtro-status-proposta');

  if (inputBusca) {
    inputBusca.addEventListener('input', () => renderTabelaPropostas());
  }
  if (selectStatus) {
    selectStatus.addEventListener('change', () => renderTabelaPropostas());
  }

  // Nova proposta (dentro da página de Propostas)
  const btnNova = document.getElementById('btn-nova-proposta');
  if (btnNova) {
    btnNova.addEventListener('click', () => abrirModalProposta(true, null));
  }

  // Botões do modal
  const btnFechar = document.getElementById('btn-fechar-modal-proposta');
  const btnCancelar = document.getElementById('btn-cancelar-proposta');
  const btnSalvar = document.getElementById('btn-salvar-proposta');
  const btnVoltar = document.getElementById('btn-voltar-proposta');

  if (btnFechar) btnFechar.addEventListener('click', fecharModalProposta);
  if (btnCancelar) btnCancelar.addEventListener('click', fecharModalProposta);

  if (btnVoltar) {
    btnVoltar.addEventListener('click', () => {
      if (modalStep > 1) setModalStep(modalStep - 1);
    });
  }

  if (btnSalvar) {
    btnSalvar.addEventListener('click', () => {
      if (modalStep === 1) {
        if (validarEtapaDadosCliente()) {
          setModalStep(2);
        }
      } else {
        salvarProposta();
      }
    });
  }

  // Clique fora do modal fecha
  if (backdrop) {
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) fecharModalProposta();
    });
  }

  // Se veio de /inicio.html com ?nova=1, já abre o modal
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('nova') === '1') {
    abrirModalProposta(true, null);
  }

  // Busca de produtos dentro do modal (etapa 2)
  const inputBuscaProdutosModal = document.getElementById('campo-busca-produtos-modal');
  if (inputBuscaProdutosModal) {
    inputBuscaProdutosModal.addEventListener('input', () => {
      renderListaProdutosModal(inputBuscaProdutosModal.value);
    });

    // ao abrir a página, já deixa carregado
    renderListaProdutosModal('');
  }
});
