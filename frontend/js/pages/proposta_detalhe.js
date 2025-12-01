// /frontend/js/pages/proposta_detalhe.js

// ======================================================
// MODELOS DE ORÇAMENTO (baseado no manual que você mandou)
// ======================================================

const MODELOS = {
  alarme: {
    chave: 'alarme',
    nome: 'Alarme monitorado / proteção interna',
    observacao: 'Média de 15m de cabo por ponto, 1 dia de M.O a cada 8 pontos e 1 kit miscelânea a cada 8 pontos.',
    campos: [
      {
        id: 'pontos',
        label: 'Qtd. pontos / sensores',
        type: 'number',
        min: 1,
        step: 1,
        defaultValue: 8,
      },
      {
        id: 'temSemiExterno',
        label: 'Inclui áreas semi externas?',
        type: 'checkbox',
        defaultValue: true,
      },
    ],
    gerar: (params) => {
      const pontos = Math.max(1, Number(params.pontos || 0));
      const metragemCabo = pontos * 15; // manual: 15m por sensor
      const diasMO = Math.max(1, Math.ceil(pontos / 8)); // 1 dia p/ cada 8 pontos
      const kitsMiscelanea = Math.max(1, Math.ceil(pontos / 8));
      const temSemiExterno = !!params.temSemiExterno;

      const itens = [
        {
          codigo: '000050',
          descricao: 'Painel de alarme Active 20 Bus (JFL)',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Definir modelo final conforme projeto (08/20/32/100 bus).',
        },
        {
          codigo: '003127',
          descricao: 'Bateria 12V 7Ah',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: '',
        },
        {
          codigo: '000087',
          descricao: 'Sirene piezoelétrica 115 dB',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Definir cor (preta ou branca).',
        },
        {
          codigo: '003131',
          descricao: 'Cabo 4x40 para sensores',
          unid: 'm',
          qtd: metragemCabo,
          origem: 'modelo',
          obs: 'Média 15m por ponto.',
        },
        {
          codigo: '000817',
          descricao: 'Kit miscelânea alarme',
          unid: 'kit',
          qtd: kitsMiscelanea,
          origem: 'modelo',
          obs: '1 kit para cada 8 pontos de instalação.',
        },
        {
          codigo: '000605',
          descricao: 'Mão de obra de instalação – Alarme',
          unid: 'dia',
          qtd: diasMO,
          origem: 'modelo',
          obs: 'Média de 1 dia para cada 8 pontos.',
        },
      ];

      if (temSemiExterno) {
        itens.push({
          codigo: '000106',
          descricao: 'Detectores de movimento – semi externos',
          unid: 'un',
          qtd: Math.max(1, Math.round(pontos * 0.3)),
          origem: 'modelo',
          obs: 'Ajustar conforme projeto.',
        });
      }

      return {
        itens,
        resumo: {
          diasMaoObra: diasMO,
          metrosCabo: metragemCabo,
        },
      };
    },
  },

  cerca: {
    chave: 'cerca',
    nome: 'Cerca elétrica perimetral',
    observacao: 'Usa cálculo por metragem linear, cantos e tipo de haste (4 ou 6 isoladores).',
    campos: [
      {
        id: 'metragem',
        label: 'Metragem linear (m)',
        type: 'number',
        min: 10,
        step: 1,
        defaultValue: 50,
      },
      {
        id: 'cantos',
        label: 'Qtd. de cantos / mudanças de direção',
        type: 'number',
        min: 0,
        step: 1,
        defaultValue: 4,
      },
      {
        id: 'tipoHaste',
        label: 'Tipo de haste',
        type: 'select',
        options: [
          { value: '4', label: '4 isoladores' },
          { value: '6', label: '6 isoladores' },
        ],
        defaultValue: '4',
      },
    ],
    gerar: (params) => {
      const metragem = Math.max(1, Number(params.metragem || 0));
      const cantos = Math.max(0, Number(params.cantos || 0));
      const tipoHaste = params.tipoHaste === '6' ? '6' : '4';

      const qtdHastesRetas = Math.ceil(metragem / 2); // manual
      const qtdHastesCantos = cantos * 2;
      const qtdHastesTotal = qtdHastesRetas + qtdHastesCantos;

      const fiosPorHaste = tipoHaste === '6' ? 6 : 4;
      const qtdArame = metragem * fiosPorHaste;

      const qtdPlacas = Math.max(1, Math.ceil(metragem / 5));
      const qtdKitsMiscelanea = Math.max(1, Math.ceil(metragem / 50));
      const qtdParafusosBuchas = qtdHastesTotal * 2; // 2 de cada por haste
      const qtdCaboAltaIsolacao = Math.ceil(metragem / 30) * 25; // manual: 25m a cada 30m
      const diasMO = Math.max(1, Math.ceil(metragem / 30)); // 1 dia p/ cada 30m

      const itens = [
        {
          codigo: '003117',
          descricao: 'Eletrificador JFL ECR 18 Plus',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Definir modelo exato conforme perímetro e recursos.',
        },
        {
          codigo: '002975',
          descricao: 'Bateria 12V 7Ah – cerca elétrica',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: '',
        },
        {
          codigo: '000093',
          descricao: 'Kit haste de aterramento',
          unid: 'kit',
          qtd: 1,
          origem: 'modelo',
          obs: '',
        },
        {
          codigo: '000470',
          descricao: 'Cabo alta isolação 4mm',
          unid: 'm',
          qtd: qtdCaboAltaIsolacao,
          origem: 'modelo',
          obs: 'Cerca elétrica – média 25m a cada 30m de perímetro.',
        },
        {
          codigo: 'PLAC-AVISO',
          descricao: 'Placas de advertência cerca elétrica',
          unid: 'un',
          qtd: qtdPlacas,
          origem: 'modelo',
          obs: '1 placa a cada 5m.',
        },
        {
          codigo: 'HASTE-CERCA',
          descricao: `Hastes perimetrais tipo ${tipoHaste} isoladores`,
          unid: 'un',
          qtd: qtdHastesTotal,
          origem: 'modelo',
          obs: 'Inclui cantos.',
        },
        {
          codigo: 'ARAME-CERCA',
          descricao: 'Arame de aço para cerca elétrica',
          unid: 'm',
          qtd: qtdArame,
          origem: 'modelo',
          obs: `Qtd. de fios conforme haste (${fiosPorHaste} fios).`,
        },
        {
          codigo: 'PARAF-BUCHA',
          descricao: 'Parafusos / buchas fixação hastes',
          unid: 'un',
          qtd: qtdParafusosBuchas,
          origem: 'modelo',
          obs: '2 parafusos + 2 buchas por haste.',
        },
        {
          codigo: '000818',
          descricao: 'Kit miscelânea cerca elétrica',
          unid: 'kit',
          qtd: qtdKitsMiscelanea,
          origem: 'modelo',
          obs: '1 kit a cada 50m de cerca.',
        },
        {
          codigo: '000607',
          descricao: 'Mão de obra de instalação – Cerca elétrica',
          unid: 'dia',
          qtd: diasMO,
          origem: 'modelo',
          obs: '1 dia a cada 30m de perímetro.',
        },
      ];

      return {
        itens,
        resumo: {
          diasMaoObra: diasMO,
          metrosCabo: qtdCaboAltaIsolacao,
        },
      };
    },
  },

  concertina: {
    chave: 'concertina',
    nome: 'Concertina perimetral',
    observacao: 'Calcula suportes, arame pantaneiro, placas, grampos e mão de obra pela metragem.',
    campos: [
      {
        id: 'metragem',
        label: 'Metragem linear (m)',
        type: 'number',
        min: 10,
        step: 1,
        defaultValue: 50,
      },
      {
        id: 'cantos',
        label: 'Qtd. de cantos / mudanças de direção',
        type: 'number',
        min: 0,
        step: 1,
        defaultValue: 4,
      },
      {
        id: 'altura',
        label: 'Altura da concertina',
        type: 'select',
        options: [
          { value: '30', label: '30 cm' },
          { value: '45', label: '45 cm' },
          { value: '60', label: '60 cm' },
          { value: '90', label: '90 cm' },
        ],
        defaultValue: '45',
      },
    ],
    gerar: (params) => {
      const metragem = Math.max(1, Number(params.metragem || 0));
      const cantos = Math.max(0, Number(params.cantos || 0));
      const altura = params.altura || '45';

      const qtdSuportes = Math.ceil(metragem / 2) + 1; // manual
      const qtdAramePantaneiro = metragem * 2; // manual
      const qtdPlacas = Math.max(1, Math.ceil(metragem / 5));
      const qtdKitsMiscelanea = Math.max(1, Math.ceil(metragem / 50));
      const qtdGrampos = metragem * 8; // 8 grampos por metro
      const qtdParafusosBuchas = qtdSuportes * 4; // 4 por suporte
      const diasMO = Math.max(1, Math.ceil(metragem / 30)); // 1 dia p/ 30m

      const itens = [
        {
          codigo: `CONC-${altura}`,
          descricao: `Concertina ${altura} cm (galvanizada / inox)`,
          unid: 'm',
          qtd: metragem,
          origem: 'modelo',
          obs: 'Definir material (galvanizada ou inox).',
        },
        {
          codigo: 'SUP-CONC',
          descricao: 'Suportes / hastes para concertina',
          unid: 'un',
          qtd: qtdSuportes,
          origem: 'modelo',
          obs: 'Divisão da metragem por 2 + 1.',
        },
        {
          codigo: 'ARAME-PANT',
          descricao: 'Arame pantaneiro',
          unid: 'm',
          qtd: qtdAramePantaneiro,
          origem: 'modelo',
          obs: '2x a metragem linear.',
        },
        {
          codigo: 'PLAC-AVISO-CONC',
          descricao: 'Placas de advertência',
          unid: 'un',
          qtd: qtdPlacas,
          origem: 'modelo',
          obs: '1 placa a cada 5m de cerca.',
        },
        {
          codigo: 'KIT-MISC-CONC',
          descricao: 'Kit miscelânea concertina',
          unid: 'kit',
          qtd: qtdKitsMiscelanea,
          origem: 'modelo',
          obs: '1 kit a cada 50m.',
        },
        {
          codigo: 'GRAMPO-CONC',
          descricao: 'Grampos de amarração',
          unid: 'un',
          qtd: qtdGrampos,
          origem: 'modelo',
          obs: '8 grampos por metro linear.',
        },
        {
          codigo: 'PARAF-BUCHA-CONC',
          descricao: 'Parafusos / buchas fixação concertina',
          unid: 'un',
          qtd: qtdParafusosBuchas,
          origem: 'modelo',
          obs: '4 por suporte.',
        },
        {
          codigo: 'MO-CONC',
          descricao: 'Mão de obra instalação – Concertina',
          unid: 'dia',
          qtd: diasMO,
          origem: 'modelo',
          obs: '1 dia a cada 30m.',
        },
      ];

      return {
        itens,
        resumo: {
          diasMaoObra: diasMO,
          metrosCabo: qtdAramePantaneiro,
        },
      };
    },
  },

  cftv: {
    chave: 'cftv',
    nome: 'CFTV – Sistema de câmeras',
    observacao: 'Estimativa de rack, DVR, HD, cabeamento, kit miscelânea e mão de obra por quantidade de câmeras.',
    campos: [
      {
        id: 'qtdCameras',
        label: 'Qtd. de câmeras',
        type: 'number',
        min: 1,
        step: 1,
        defaultValue: 8,
      },
      {
        id: 'metragemPorCamera',
        label: 'Média de cabeamento por câmera (m)',
        type: 'number',
        min: 5,
        step: 1,
        defaultValue: 20,
      },
      {
        id: 'resolucao',
        label: 'Resolução',
        type: 'select',
        options: [
          { value: '720p', label: 'HD 720p' },
          { value: '1080p', label: 'Full HD 1080p' },
          { value: '4M', label: '4 MP' },
          { value: '4K', label: '4K / Ultra HD' },
        ],
        defaultValue: '1080p',
      },
    ],
    gerar: (params) => {
      const qtdCameras = Math.max(1, Number(params.qtdCameras || 0));
      const metragemPorCamera = Math.max(1, Number(params.metragemPorCamera || 0));
      const resolucao = params.resolucao || '1080p';

      const metrosTotal = qtdCameras * metragemPorCamera;
      const qtdKitsMiscelanea = Math.max(1, Math.ceil(qtdCameras / 4));
      const diasMOInstalacao = Math.max(1, Math.ceil(qtdCameras / 4)); // 1 dia a cada 4 pontos
      const horasConfigRede = 1; // 1 hora por sistema

      let dvrDescricao = 'DVR 16 canais';
      if (qtdCameras <= 4) dvrDescricao = 'DVR 4 canais';
      else if (qtdCameras <= 8) dvrDescricao = 'DVR 8 canais';

      let hdDescricao = 'HD 1TB Purple';
      if (qtdCameras > 12) {
        hdDescricao = 'HD 2TB Purple';
      }
      if (qtdCameras > 20) {
        hdDescricao = 'HD 4TB Purple';
      }

      const itens = [
        {
          codigo: 'RACK-CFTV',
          descricao: 'Rack / gabinete para CFTV',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Modelo conforme tamanho do DVR.',
        },
        {
          codigo: 'DVR-CFTV',
          descricao: dvrDescricao,
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Linha combate / inteligência conforme necessidade.',
        },
        {
          codigo: 'HD-CFTV',
          descricao: hdDescricao,
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Dimensionado por número de câmeras e dias de gravação.',
        },
        {
          codigo: 'FONTE-CFTV',
          descricao: 'Fonte 12V câmeras (5–20A)',
          unid: 'un',
          qtd: 1,
          origem: 'modelo',
          obs: 'Corrente de acordo com quantidade de câmeras.',
        },
        {
          codigo: 'CABO-CFTV',
          descricao: 'Cabeamento CFTV (coaxial ou UTP + balun)',
          unid: 'm',
          qtd: metrosTotal,
          origem: 'modelo',
          obs: `Média de ${metragemPorCamera}m por câmera.`,
        },
        {
          codigo: 'KIT-MISC-CFTV',
          descricao: 'Kit miscelânea CFTV (conectores, caixas, etc.)',
          unid: 'kit',
          qtd: qtdKitsMiscelanea,
          origem: 'modelo',
          obs: '1 kit para cada 4 câmeras.',
        },
        {
          codigo: 'CAM-CFTV',
          descricao: `Câmeras ${resolucao}`,
          unid: 'un',
          qtd: qtdCameras,
          origem: 'modelo',
          obs: 'Definir modelos interno / externo, lente e IR.',
        },
        {
          codigo: 'MO-CFTV-INST',
          descricao: 'Mão de obra instalação – CFTV',
          unid: 'dia',
          qtd: diasMOInstalacao,
          origem: 'modelo',
          obs: '1 dia a cada 4 pontos.',
        },
        {
          codigo: 'MO-CFTV-REDE',
          descricao: 'Mão de obra – configuração de rede',
          unid: 'hora',
          qtd: horasConfigRede,
          origem: 'modelo',
          obs: 'Ajustar se projeto for mais complexo.',
        },
      ];

      return {
        itens,
        resumo: {
          diasMaoObra: diasMOInstalacao,
          metrosCabo: metrosTotal,
        },
      };
    },
  },
};

// ======================================================
// Helpers
// ======================================================

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function formatNumero(n) {
  if (n == null || isNaN(n)) return '–';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace('.', ',');
}

// ======================================================
// Render de parâmetros do modelo
// ======================================================

function renderCamposModelo(modelKey) {
  const modelo = MODELOS[modelKey];
  const container = $('#modelo-parametros');
  if (!modelo || !container) return;

  container.innerHTML = '';

  modelo.campos.forEach((campo) => {
    const wrap = document.createElement('div');
    wrap.className = 'orca-field';

    const label = document.createElement('label');
    label.textContent = campo.label;
    label.htmlFor = `param-${campo.id}`;
    wrap.appendChild(label);

    let input;

    if (campo.type === 'select') {
      input = document.createElement('select');
      (campo.options || []).forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        input.appendChild(o);
      });
      if (campo.defaultValue != null) {
        input.value = campo.defaultValue;
      }
    } else if (campo.type === 'checkbox') {
      // checkbox separado do label visual
      input = document.createElement('input');
      input.type = 'checkbox';
      if (campo.defaultValue) {
        input.checked = true;
      }
    } else {
      // number / text
      input = document.createElement('input');
      input.type = campo.type || 'text';
      if (campo.min != null) input.min = String(campo.min);
      if (campo.step != null) input.step = String(campo.step);
      if (campo.defaultValue != null) input.value = campo.defaultValue;
    }

    input.id = `param-${campo.id}`;

    // sempre recalcula quando o usuário mexer
    if (campo.type === 'checkbox') {
      input.addEventListener('change', recalcularModeloAtual);
    } else {
      input.addEventListener('input', recalcularModeloAtual);
    }

    wrap.appendChild(input);
    container.appendChild(wrap);
  });

  // primeiro cálculo
  recalcularModeloAtual();
}

function lerParametrosModelo(modelKey) {
  const modelo = MODELOS[modelKey];
  if (!modelo) return {};

  const params = {};
  modelo.campos.forEach((campo) => {
    const el = document.getElementById(`param-${campo.id}`);
    if (!el) return;

    if (campo.type === 'checkbox') {
      params[campo.id] = el.checked;
    } else {
      params[campo.id] = el.value;
    }
  });

  return params;
}

// ======================================================
// Render de itens sugeridos
// ======================================================

let itensAtuais = [];
let resumoAtual = {
  diasMaoObra: null,
  metrosCabo: null,
};

function renderItensTabela() {
  const tbody = $('#tbody-itens-proposta');
  if (!tbody) return;

  tbody.innerHTML = '';

  itensAtuais.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.codigo || '-'}</td>
      <td>${item.descricao || '-'}</td>
      <td>${item.unid || '-'}</td>
      <td>${formatNumero(item.qtd)}</td>
      <td>
        <span class="orcadet-origem-badge orcadet-origem-badge--modelo">
          ${item.origem === 'modelo' ? 'Modelo' : 'Manual'}
        </span>
      </td>
      <td>${item.obs || ''}</td>
    `;
    tbody.appendChild(tr);
  });

  // atualizar contadores no card resumo
  const spanItens = $('#resumo-itens');
  if (spanItens) {
    const qtd = itensAtuais.length;
    spanItens.textContent = qtd === 1 ? '1 item' : `${qtd} itens`;
  }

  const spanDias = $('#resumo-dias-mo');
  if (spanDias) {
    spanDias.textContent =
      resumoAtual.diasMaoObra == null
        ? '–'
        : `${formatNumero(resumoAtual.diasMaoObra)} dia(s)`;
  }

  const spanMetros = $('#resumo-metros-cabo');
  if (spanMetros) {
    spanMetros.textContent =
      resumoAtual.metrosCabo == null
        ? '–'
        : `${formatNumero(resumoAtual.metrosCabo)} m (aprox.)`;
  }
}

// ======================================================
// Recalcular modelo
// ======================================================

function recalcularModeloAtual() {
  const select = document.getElementById('modelo-orcamento');
  if (!select) return;

  const modelKey = select.value || 'alarme';
  const modelo = MODELOS[modelKey];
  if (!modelo) return;

  const params = lerParametrosModelo(modelKey);
  const { itens, resumo } = modelo.gerar(params);

  itensAtuais = itens || [];
  resumoAtual = resumo || { diasMaoObra: null, metrosCabo: null };

  // atualizar texto do card resumo
  const spanModelo = $('#resumo-modelo');
  if (spanModelo) {
    spanModelo.textContent = modelo.nome;
  }

  const spanObs = $('#resumo-observacao');
  if (spanObs) {
    spanObs.textContent = modelo.observacao;
  }

  renderItensTabela();
}

// ======================================================
// INIT
// ======================================================

document.addEventListener('DOMContentLoaded', () => {
  // Voltar para /frontend/propostas.html
  const btnVoltar = document.getElementById('btn-voltar-propostas');
  if (btnVoltar) {
    btnVoltar.addEventListener('click', () => {
      window.location.href = '/frontend/propostas.html';
    });
  }

  const selectModelo = document.getElementById('modelo-orcamento');
  if (selectModelo) {
    selectModelo.addEventListener('change', () => {
      renderCamposModelo(selectModelo.value || 'alarme');
    });

    // valor padrão
    if (!selectModelo.value) {
      selectModelo.value = 'alarme';
    }
    renderCamposModelo(selectModelo.value || 'alarme');
  }
});
