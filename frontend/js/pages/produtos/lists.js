// /frontend/js/pages/produtos/lists.js
// Listas (selects) + Adicionar… + Chips (Segmentos/Fornecedores) + Gerenciar/Apagar itens

import { state, getEl, escapeHTML } from './base.js';
import { toast, confirmValora, promptValora } from './ui.js';

const LISTS_KEY = 'Valorapro_listas_produtos_v1';

// garante os campos no state (mesmo que o base.js esteja “menor”)
state.LISTS_STATE ??= null;
state.BOUND_SELECTS ??= [];

state.SELECTED_SEGMENTOS ??= [];
state.SELECTED_FORNECEDORES ??= [];

/* =========================
   Default Lists
========================= */

export const LISTS_DEFAULT = {
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

  // você estava usando isso como “padrao” nos 3 selects (ICMS/PIS/COFINS)
  // (sim, é esquisito, mas mantive igual seu original)
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

/* =========================
   Helpers
========================= */

function dedupeKeepOrder(arr) {
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

/* =========================
   Load / Save Lists
========================= */

export function loadLists() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(LISTS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }

  const merged = { ...LISTS_DEFAULT, ...saved };

  // dedupe nos arrays de string
  for (const k of Object.keys(merged)) {
    if (Array.isArray(merged[k]) && merged[k].length && typeof merged[k][0] === 'string') {
      merged[k] = dedupeKeepOrder(merged[k]);
    }
  }

  return merged;
}

export function saveLists() {
  try {
    localStorage.setItem(LISTS_KEY, JSON.stringify(state.LISTS_STATE || {}));
  } catch {}
}

/* =========================
   Selects: render + bind + add option
========================= */

export function renderSelectOptions(selectEl, listKey, { placeholder = '—', allowAdd = true } = {}) {
  const list = state.LISTS_STATE?.[listKey] || [];
  const current = selectEl.value;

  const opts = [];
  opts.push(`<option value="">${escapeHTML(placeholder)}</option>`);

  list.forEach(item => {
    if (typeof item === 'string') {
      const v = item;
      opts.push(`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`);
      return;
    }

    if (item && typeof item === 'object') {
      const v = String(item.value ?? '').trim();
      const l = String(item.label ?? '').trim() || v;
      if (v) opts.push(`<option value="${escapeHTML(v)}">${escapeHTML(l)}</option>`);
    }
  });

  if (allowAdd) {
    opts.push(`<option value="__add__">➕ Adicionar…</option>`);
  }

  selectEl.innerHTML = opts.join('');
  selectEl.value = current;
}

export function refreshAllSelectsOf(listKey) {
  (state.BOUND_SELECTS || []).forEach(b => {
    if (b.listKey === listKey) renderSelectOptions(b.el, b.listKey, b.cfg);
  });
}

export function bindSelectList(selectId, listKey, cfg = {}) {
  const el = getEl(selectId);
  if (!el) return;

  renderSelectOptions(el, listKey, cfg);
  el.dataset._prev = el.value || '';

  state.BOUND_SELECTS.push({ el, listKey, cfg });

  el.addEventListener('change', async () => {
    // se não é add, só atualiza o prev
    if (el.value !== '__add__') {
      el.dataset._prev = el.value || '';
      return;
    }

    // volta pro valor anterior antes de abrir prompt
    const prev = el.dataset._prev || '';
    el.value = prev;

    const novo = await promptValora('Digite a nova opção para esta lista:', {
      title: 'Adicionar opção',
      okText: 'Adicionar',
      cancelText: 'Cancelar',
      placeholder: 'Ex: Novo item'
    });

    if (!novo) return;

    if (!Array.isArray(state.LISTS_STATE[listKey])) state.LISTS_STATE[listKey] = [];
    const list = state.LISTS_STATE[listKey];

    // lista de objetos (value/label)
    if (list.length && typeof list[0] === 'object') {
      list.push({ value: novo, label: novo });
    } else {
      list.push(novo);
      state.LISTS_STATE[listKey] = dedupeKeepOrder(list);
    }

    saveLists();
    refreshAllSelectsOf(listKey);

    el.value = novo;
    el.dataset._prev = novo;

    toast('Opção adicionada na lista.', 'ok');
  });
}

/* =========================
   Segmentos (chips)
========================= */

function normalizeMultiValue(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
  const s = String(v || '').trim();
  return s ? [s] : [];
}

export function setSegmentosSelection(v) {
  state.SELECTED_SEGMENTOS = dedupeKeepOrder(normalizeMultiValue(v));
  renderSegmentosChips();
}

export function getSelectedSegmentos() {
  return (state.SELECTED_SEGMENTOS || []).slice();
}

function addSegmentoToSelection(v) {
  const s = String(v || '').trim();
  if (!s) return;
  if (!state.SELECTED_SEGMENTOS.includes(s)) state.SELECTED_SEGMENTOS.push(s);
  state.SELECTED_SEGMENTOS = dedupeKeepOrder(state.SELECTED_SEGMENTOS);
  renderSegmentosChips();
}

function removeSegmentoFromSelection(v) {
  const s = String(v || '').trim();
  if (!s) return;
  state.SELECTED_SEGMENTOS = (state.SELECTED_SEGMENTOS || []).filter(x => x !== s);
  renderSegmentosChips();
}

export function renderSegmentosChips() {
  const wrap = getEl('chips-segmentos');
  if (!wrap) return;

  wrap.innerHTML = '';

  if (!state.SELECTED_SEGMENTOS.length) {
    const empty = document.createElement('div');
    empty.className = 'Valora-chip Valora-chip--empty';
    empty.textContent = 'Nenhum segmento selecionado';
    wrap.appendChild(empty);
    return;
  }

  state.SELECTED_SEGMENTOS.forEach(seg => {
    const chip = document.createElement('div');
    chip.className = 'Valora-chip';
    chip.innerHTML = `
      <span>${escapeHTML(seg)}</span>
      <button type="button" class="Valora-chip__x" title="Remover">✕</button>
    `;

    chip.querySelector('.Valora-chip__x')?.addEventListener('click', () => removeSegmentoFromSelection(seg));
    wrap.appendChild(chip);
  });
}

export function wireSegmentosSelect() {
  const sel = getEl('campo-segmentos-add');
  if (!sel) return;

  sel.value = '';

  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    if (!v || v === '__add__') return;

    addSegmentoToSelection(v);
    sel.value = '';
  });
}

/* =========================
   Fornecedores (chips)
========================= */

export function setFornecedoresSelection(v) {
  state.SELECTED_FORNECEDORES = dedupeKeepOrder(normalizeMultiValue(v));
  renderFornecedoresChips();
}

export function getSelectedFornecedores() {
  return (state.SELECTED_FORNECEDORES || []).slice();
}

function addFornecedorToSelection(v) {
  const s = String(v || '').trim();
  if (!s) return;
  if (!state.SELECTED_FORNECEDORES.includes(s)) state.SELECTED_FORNECEDORES.push(s);
  state.SELECTED_FORNECEDORES = dedupeKeepOrder(state.SELECTED_FORNECEDORES);
  renderFornecedoresChips();
}

function removeFornecedorFromSelection(v) {
  const s = String(v || '').trim();
  if (!s) return;
  state.SELECTED_FORNECEDORES = (state.SELECTED_FORNECEDORES || []).filter(x => x !== s);
  renderFornecedoresChips();
}

export function renderFornecedoresChips() {
  const wrap = getEl('chips-fornecedores');
  if (!wrap) return;

  wrap.innerHTML = '';

  if (!state.SELECTED_FORNECEDORES.length) {
    const empty = document.createElement('div');
    empty.className = 'Valora-chip Valora-chip--empty';
    empty.textContent = 'Nenhum fornecedor selecionado';
    wrap.appendChild(empty);
    return;
  }

  state.SELECTED_FORNECEDORES.forEach(nome => {
    const chip = document.createElement('div');
    chip.className = 'Valora-chip';
    chip.innerHTML = `
      <span>${escapeHTML(nome)}</span>
      <button type="button" class="Valora-chip__x" title="Remover">✕</button>
    `;

    chip.querySelector('.Valora-chip__x')?.addEventListener('click', () => removeFornecedorFromSelection(nome));
    wrap.appendChild(chip);
  });
}

export function wireFornecedoresSelect() {
  const sel = getEl('campo-fornecedores-add');
  if (!sel) return;

  sel.value = '';

  sel.addEventListener('change', () => {
    const v = String(sel.value || '').trim();
    if (!v || v === '__add__') return;

    addFornecedorToSelection(v);
    sel.value = '';
  });
}

/* =========================
   Gerenciar lista (Apagar itens)
========================= */

export function openManageListModal(listKey, title = 'Gerenciar') {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'Valora-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'Valora-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    modal.innerHTML = `
      <div class="Valora-confirm__head">
        <h3 class="Valora-confirm__title">${escapeHTML(title)}</h3>
        <button class="Valora-confirm__close" type="button" aria-label="Fechar">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <p class="Valora-confirm__msg">
        Aqui você pode apagar itens cadastrados errado. (Isso remove das listas salvas.)
      </p>

      <div class="Valora-manage-list" id="Valora-manage-list"></div>

      <div class="Valora-confirm__foot">
        <button class="btn-secondary" type="button" id="Valora-manage-close">Fechar</button>
      </div>
    `;

    bd.appendChild(modal);
    document.body.appendChild(bd);
    document.body.classList.add('modal-open');

    const listEl = modal.querySelector('#Valora-manage-list');
    const btnClose = modal.querySelector('#Valora-manage-close');
    const btnX = modal.querySelector('.Valora-confirm__close');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      if (bd.isConnected) bd.remove();
      document.removeEventListener('keydown', onKey);
    };

    const done = () => {
      cleanup();
      resolve(true);
    };

    const onKey = (e) => { if (e.key === 'Escape') done(); };
    document.addEventListener('keydown', onKey);

    bd.addEventListener('click', (e) => { if (e.target === bd) done(); });
    btnClose?.addEventListener('click', done);
    btnX?.addEventListener('click', done);

    const render = () => {
      const list = (state.LISTS_STATE?.[listKey] || []);
      listEl.innerHTML = '';

      const plain = list
        .map(x => (typeof x === 'object' ? String(x.value ?? '') : String(x ?? '')))
        .filter(Boolean);

      if (!plain.length) {
        const emp = document.createElement('div');
        emp.className = 'Valora-manage-empty';
        emp.textContent = 'Lista vazia.';
        listEl.appendChild(emp);
        return;
      }

      plain.forEach((label) => {
        const row = document.createElement('div');
        row.className = 'Valora-manage-row';

        row.innerHTML = `
          <div class="Valora-manage-label">${escapeHTML(label)}</div>
          <button type="button" class="Valora-btn Valora-btn--danger Valora-btn--icon" title="Apagar">✕</button>
        `;

        row.querySelector('button')?.addEventListener('click', async () => {
          const ok = await confirmValora(`Apagar "${label}" desta lista?`, {
            title: 'Apagar item',
            okText: 'Apagar',
            cancelText: 'Cancelar'
          });
          if (!ok) return;

          const cur = state.LISTS_STATE?.[listKey] || [];
          let next = [];

          if (cur.length && typeof cur[0] === 'object') {
            next = cur.filter(o => String(o?.value ?? '').trim() !== label);
          } else {
            next = cur.filter(s => String(s ?? '').trim() !== label);
          }

          state.LISTS_STATE[listKey] = next;
          saveLists();
          refreshAllSelectsOf(listKey);

          // remove dos chips se existir
          if (listKey === 'segmentos') {
            state.SELECTED_SEGMENTOS = (state.SELECTED_SEGMENTOS || []).filter(x => x !== label);
            renderSegmentosChips();
          }

          if (listKey === 'fornecedor') {
            state.SELECTED_FORNECEDORES = (state.SELECTED_FORNECEDORES || []).filter(x => x !== label);
            renderFornecedoresChips();
          }

          toast('Item apagado.', 'success');
          render();
        });

        listEl.appendChild(row);
      });
    };

    render();
  });
}

/* =========================
   Init Selects da página Produtos
========================= */

export function initSelects() {
  state.LISTS_STATE = loadLists();

  bindSelectList('filtro-origem-produto', 'origem', { placeholder: 'Todos', allowAdd: false });

  bindSelectList('campo-origem', 'origem', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-status-atual', 'status_atual', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-tipo-mercado', 'tipo_mercado', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-utilizacao', 'utilizacao', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-tipo-material', 'tipo_material', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-prod-controlado', 'sim_nao', { placeholder: '—', allowAdd: false });
  bindSelectList('campo-tipo-fiscalizacao', 'tipo_fiscalizacao', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-segmentos-add', 'segmentos', { placeholder: 'Selecionar...', allowAdd: true });
  bindSelectList('campo-classe', 'classe', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-fornecedores-add', 'fornecedor', { placeholder: 'Selecionar...', allowAdd: true });
  bindSelectList('campo-ultimo-fornecedor', 'fornecedor', { placeholder: '—', allowAdd: false });

  bindSelectList('campo-tipo-armaz', 'tipo_armaz', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-peso-logistico-unidade', 'unidade_peso', { placeholder: '—', allowAdd: false });

  bindSelectList('campo-possui-validade', 'sim_nao', { placeholder: '—', allowAdd: false });
  bindSelectList('campo-cores-disponiveis', 'cores_disponiveis', { placeholder: '—', allowAdd: true });

  bindSelectList('campo-cst-icms', 'cst_padrao', { placeholder: '—', allowAdd: false });
  bindSelectList('campo-cst-pis', 'cst_padrao', { placeholder: '—', allowAdd: false });
  bindSelectList('campo-cst-cofins', 'cst_padrao', { placeholder: '—', allowAdd: false });

  bindSelectList('campo-destino', 'destino', { placeholder: '—', allowAdd: false });
  bindSelectList('campo-mov-departamento', 'departamentos', { placeholder: '—', allowAdd: true });
  bindSelectList('campo-mov-fornecedor', 'fornecedor', { placeholder: '—', allowAdd: false });

  saveLists();
}
