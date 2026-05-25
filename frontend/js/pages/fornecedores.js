// /frontend/js/pages/fornecedores.js
// Fornecedores - versão completa corrigida
// Corrige: abas do modal, modal fino, filtros e organização dos campos.

let fornecedores = [];
let camposFornecedores = [];
let fornecedorEditandoId = null;
let campoEditandoId = null;

const API_FORNECEDORES = '/api/fornecedores';
const API_CAMPOS = '/api/fornecedores/campos';

function $(id) {
  return document.getElementById(id);
}

function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatTipoCampo(tipo) {
  const map = {
    texto: 'Texto curto',
    textarea: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    select: 'Lista de opções',
    checkbox: 'Caixa de seleção',
  };
  return map[tipo] || tipo || '-';
}

function toast(message, type = 'success', ms = 2600) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }

  const el = $('valora-toast');
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message || '';
  el.classList.remove('is-error');
  if (type === 'error') el.classList.add('is-error');

  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), ms);
}

function setButtonLoading(btn, loading, textWhenLoading = 'Salvando...', textWhenNormal = '') {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalHtml = btn.innerHTML;
    btn.innerHTML = textWhenLoading;
    btn.disabled = true;
    return;
  }

  btn.disabled = false;
  btn.innerHTML = textWhenNormal || btn.dataset.originalHtml || btn.innerHTML;
}

let _confirmResolver = null;

function confirmDialog({
  title = 'Confirmar',
  message = 'Tem certeza?',
  confirmText = 'OK',
  cancelText = 'Cancelar',
} = {}) {
  const backdrop = $('Valora-confirm-backdrop');
  if (!backdrop) return Promise.resolve(false);

  $('Valora-confirm-title').textContent = title;
  $('Valora-confirm-message').textContent = message;
  $('Valora-confirm-ok').textContent = confirmText;
  $('Valora-confirm-cancel').textContent = cancelText;

  openModal('Valora-confirm-backdrop');

  return new Promise((resolve) => {
    _confirmResolver = resolve;
  });
}

function closeConfirm(result = false) {
  closeModal('Valora-confirm-backdrop');

  if (typeof _confirmResolver === 'function') {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

async function apiJson(url, options = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!resp.ok) {
    const txt = await resp.text();
    let message = txt || 'Erro na requisição.';
    try {
      const parsed = JSON.parse(txt);
      message = parsed.detail || parsed.message || txt;
    } catch {}
    throw new Error(typeof message === 'string' ? message : 'Erro na requisição.');
  }

  if (resp.status === 204) return null;
  return resp.json();
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = false;
  requestAnimationFrame(() => modal.classList.add('show'));
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => {
    modal.hidden = true;
  }, 180);
}

function setValue(id, value) {
  const el = $(id);
  if (!el) return;
  el.value = value ?? '';
}

function getValue(id) {
  return $(id)?.value ?? '';
}

function normalizeSituacao(value) {
  const s = String(value || 'ativo').trim().toLowerCase();
  return ['ativo', 'inativo', 'bloqueado'].includes(s) ? s : 'ativo';
}

function defaultFornecedor() {
  return {
    codigo: '',
    tipo_fornecedor: '',
    tipo: '',
    situacao: 'ativo',
    nome: '',
    nome_fantasia: '',
    cpf_cnpj: '',
    inscricao_estadual: '',
    inscricao_municipal: '',
    ie: '',
    im: '',
    contato: '',
    telefone: '',
    whatsapp: '',
    fax: '',
    email: '',
    site: '',
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
    pais: 'Brasil',
    codigo_ibge_cidade: '',
    codigo_ibge_uf: '',
    ibge_cidade: '',
    ibge_uf: '',
    limite_compras: '',
    classificacao: '',
    plano_contas: '',
    observacoes: '',
    custom_fields: {},
  };
}

function generateNextFornecedorCode() {
  const proximoId = fornecedores.length > 0
    ? Math.max(...fornecedores.map((f) => Number(f.id) || 0)) + 1
    : 1;

  return `FOR-${String(proximoId).padStart(4, '0')}`;
}

function pick(obj, keys, fallback = '') {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
}

function getTipoFornecedor(fornecedor) {
  return pick(fornecedor, ['tipo_fornecedor', 'tipo'], '');
}

function getDocumentoFornecedor(fornecedor) {
  return pick(fornecedor, ['cpf_cnpj', 'cnpj_cpf', 'documento'], '');
}

function getCidadeUfFornecedor(fornecedor) {
  const cidade = String(pick(fornecedor, ['cidade'], '') || '').trim();
  const uf = String(pick(fornecedor, ['estado', 'uf'], '') || '').trim();
  return [cidade, uf].filter(Boolean).join(' / ') || '-';
}

function getContatoFornecedor(fornecedor) {
  return pick(fornecedor, ['whatsapp', 'telefone', 'email', 'contato'], '-') || '-';
}

function getFiltroFornecedores() {
  return {
    busca: String($('filtro-busca')?.value || '').trim().toLowerCase(),
    tipo: String($('filtro-tipo')?.value || '').trim().toLowerCase(),
    situacao: String($('filtro-situacao')?.value || '').trim().toLowerCase(),
    cidade: String($('filtro-cidade')?.value || '').trim().toLowerCase(),
  };
}

function filtrarFornecedores() {
  const filtro = getFiltroFornecedores();

  return (fornecedores || []).filter((f) => {
    const nome = String(f.nome || '').toLowerCase();
    const fantasia = String(f.nome_fantasia || '').toLowerCase();
    const codigo = String(f.codigo || '').toLowerCase();
    const doc = String(getDocumentoFornecedor(f) || '').toLowerCase();
    const telefone = String(f.telefone || '').toLowerCase();
    const whatsapp = String(f.whatsapp || '').toLowerCase();
    const email = String(f.email || '').toLowerCase();
    const contato = String(f.contato || '').toLowerCase();
    const cidade = String(f.cidade || '').toLowerCase();
    const estado = String(f.estado || '').toLowerCase();
    const tipo = String(getTipoFornecedor(f) || '').toLowerCase();
    const situacao = String(f.situacao || 'ativo').toLowerCase();

    const textoBusca = [
      nome,
      fantasia,
      codigo,
      doc,
      telefone,
      whatsapp,
      email,
      contato,
      cidade,
      estado,
      tipo,
    ].join(' ');

    const okBusca = !filtro.busca || textoBusca.includes(filtro.busca);
    const okTipo = !filtro.tipo || tipo.includes(filtro.tipo);
    const okSituacao = !filtro.situacao || situacao === filtro.situacao;
    const okCidade = !filtro.cidade || cidade.includes(filtro.cidade);

    return okBusca && okTipo && okSituacao && okCidade;
  });
}

function limparFiltros() {
  setValue('filtro-busca', '');
  setValue('filtro-tipo', '');
  setValue('filtro-situacao', '');
  setValue('filtro-cidade', '');
}

function renderBadgeSituacao(situacao) {
  const s = normalizeSituacao(situacao);
  return `<span class="badge-status ${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function renderBadgeTipo(tipo) {
  const t = String(tipo || '-').trim() || '-';
  return `<span class="badge-tipo">${escapeHtml(t)}</span>`;
}

function renderNomeFornecedor(fornecedor) {
  const nome = fornecedor?.nome || '-';
  const fantasia = fornecedor?.nome_fantasia || '';

  if (!fantasia) return `<strong>${escapeHtml(nome)}</strong>`;

  return `
    <div style="display:flex; flex-direction:column; gap:2px;">
      <strong>${escapeHtml(nome)}</strong>
      <span class="subtle">${escapeHtml(fantasia)}</span>
    </div>
  `;
}

function renderTabelaFornecedores() {
  const tbody = $('tbody-fornecedores');
  const spanCount = $('contagem-fornecedores');
  if (!tbody) return;

  const filtrados = filtrarFornecedores();

  if (!filtrados.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="border:none; text-align:center;">
          Nenhum fornecedor encontrado.
        </td>
      </tr>
    `;
    if (spanCount) spanCount.textContent = '0 fornecedores';
    return;
  }

  tbody.innerHTML = filtrados
    .map((f) => `
      <tr>
        <td><span class="badge-codigo">${escapeHtml(f.codigo || '-')}</span></td>
        <td>${renderBadgeTipo(getTipoFornecedor(f))}</td>
        <td>${renderNomeFornecedor(f)}</td>
        <td>${escapeHtml(getDocumentoFornecedor(f) || '-')}</td>
        <td>${escapeHtml(getCidadeUfFornecedor(f))}</td>
        <td>${escapeHtml(getContatoFornecedor(f))}</td>
        <td>${renderBadgeSituacao(f.situacao)}</td>
        <td style="text-align:right;">
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            <button class="btn-icon" data-action="editar" data-id="${f.id}" title="Editar">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="btn-icon danger" data-action="excluir" data-id="${f.id}" title="Excluir">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `)
    .join('');

  if (spanCount) {
    spanCount.textContent = filtrados.length === 1
      ? '1 fornecedor'
      : `${filtrados.length} fornecedores`;
  }
}

async function carregarFornecedores() {
  try {
    const data = await apiJson(API_FORNECEDORES);
    fornecedores = Array.isArray(data) ? data : [];
  } catch (err) {
    fornecedores = [];
    toast(err.message || 'Erro ao carregar fornecedores.', 'error');
  }

  renderTabelaFornecedores();
}

async function carregarCamposFornecedores() {
  try {
    const data = await apiJson(API_CAMPOS);
    camposFornecedores = Array.isArray(data) ? data : [];
    camposFornecedores.sort(
      (a, b) =>
        Number(a.ordem || 0) - Number(b.ordem || 0) ||
        String(a.nome || '').localeCompare(String(b.nome || ''))
    );
  } catch (err) {
    camposFornecedores = [];
    toast(err.message || 'Erro ao carregar campos personalizados.', 'error');
  }

  renderListaCamposFornecedores();
}

function parseCampoOpcoes(campo) {
  if (!campo || !campo.opcoes_json) return [];
  try {
    const parsed = JSON.parse(campo.opcoes_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderListaCamposFornecedores() {
  const wrap = $('lista-campos-fornecedores');
  if (!wrap) return;

  if (!camposFornecedores.length) {
    wrap.innerHTML = `<div class="empty-state" style="grid-column:1 / -1;">Nenhum campo personalizado criado.</div>`;
    return;
  }

  wrap.innerHTML = camposFornecedores
    .map((campo) => {
      const bObrig = campo.obrigatorio ? `<span class="badge-tag brand">Obrigatório</span>` : '';
      const bOculto = campo.ativo === false ? `<span class="badge-tag">Oculto</span>` : '';

      return `
        <div class="campo-card">
          <div class="campo-card-header">
            <div>
              <strong>${escapeHtml(campo.nome || '')}</strong>
              <span class="campo-meta">${escapeHtml(formatTipoCampo(campo.tipo))} • Ordem ${Number(campo.ordem || 0)}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="btn-icon" data-campo-action="editar" data-id="${campo.id}" title="Editar campo">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn-icon danger" data-campo-action="excluir" data-id="${campo.id}" title="Excluir campo">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
          <div class="campo-badges">${bObrig} ${bOculto}</div>
        </div>
      `;
    })
    .join('');
}

function renderCustomFieldsInputs(values = {}) {
  const container = $('custom-fields-container');
  if (!container) return;

  if (!camposFornecedores.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        Nenhum campo personalizado cadastrado.
      </div>
    `;
    return;
  }

  const ativos = camposFornecedores.filter((c) => c.ativo !== false);

  if (!ativos.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        Todos os campos personalizados estão ocultos.
      </div>
    `;
    return;
  }

  container.innerHTML = '';

  ativos.forEach((campo) => {
    const slug = String(campo.slug || '').trim();
    if (!slug) return;

    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = campo.tipo || 'texto';
    const valor = values?.[slug] ?? '';

    const field = document.createElement('div');
    field.className = 'form-group';

    let html = `<label for="${id}">${escapeHtml(label)}${campo.obrigatorio ? ' *' : ''}</label>`;

    if (tipo === 'textarea') {
      html += `<textarea id="${id}" data-custom-field="${escapeHtml(slug)}" rows="3">${escapeHtml(valor)}</textarea>`;
    } else if (tipo === 'numero') {
      html += `<input type="number" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    } else if (tipo === 'data') {
      html += `<input type="date" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    } else if (tipo === 'checkbox') {
      const checked = String(valor).toLowerCase() === 'true' || String(valor).toLowerCase() === 'sim' || valor === true ? 'checked' : '';
      html = `
        <label class="custom-checkbox" style="margin-top:8px;">
          <input type="checkbox" id="${id}" data-custom-field="${escapeHtml(slug)}" ${checked} />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    } else if (tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);
      html += `
        <select id="${id}" data-custom-field="${escapeHtml(slug)}">
          <option value="">Selecione</option>
          ${opcoes
            .map((opt) => `
              <option value="${escapeHtml(opt)}" ${String(valor) === String(opt) ? 'selected' : ''}>
                ${escapeHtml(opt)}
              </option>
            `)
            .join('')}
        </select>
      `;
    } else {
      html += `<input type="text" id="${id}" data-custom-field="${escapeHtml(slug)}" value="${escapeHtml(valor)}" />`;
    }

    field.innerHTML = html;
    container.appendChild(field);
  });
}

function normalizeCustomFieldsPayload() {
  const out = {};

  $$('[data-custom-field]').forEach((el) => {
    const slug = String(el.getAttribute('data-custom-field') || '').trim();
    if (!slug) return;

    let value = '';
    if (el.type === 'checkbox') {
      value = el.checked ? 'true' : 'false';
    } else {
      value = String(el.value || '').trim();
    }

    if (value !== '') out[slug] = value;
  });

  return out;
}

function validateRequiredCustomFields() {
  for (const campo of camposFornecedores || []) {
    if (!campo.obrigatorio || campo.ativo === false) continue;

    const slug = String(campo.slug || '').trim();
    if (!slug) continue;

    const el = document.querySelector(`[data-custom-field="${CSS.escape(slug)}"]`);
    if (!el) continue;

    if (el.type === 'checkbox') continue;

    if (!String(el.value || '').trim()) {
      toast(`Preencha o campo personalizado: ${campo.nome || slug}.`, 'error');
      switchFornecedorTab('tab-fornecedor-campos');
      el.focus();
      return false;
    }
  }

  return true;
}

function switchFornecedorTab(targetId) {
  $$('.fornecedor-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === targetId);
  });

  $$('.fornecedor-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.id === targetId);
  });
}

function fillFornecedorForm(fornecedor = {}) {
  const data = { ...defaultFornecedor(), ...(fornecedor || {}) };

  setValue('campo-codigo-fornecedor', data.codigo || generateNextFornecedorCode());
  setValue('campo-tipo-fornecedor', pick(data, ['tipo_fornecedor', 'tipo'], ''));
  setValue('campo-situacao-fornecedor', normalizeSituacao(data.situacao));
  setValue('campo-nome-fornecedor', data.nome);
  setValue('campo-nome-fantasia-fornecedor', data.nome_fantasia);
  setValue('campo-cpf-cnpj-fornecedor', pick(data, ['cpf_cnpj', 'cnpj_cpf', 'documento'], ''));
  setValue('campo-ie-fornecedor', pick(data, ['inscricao_estadual', 'ie'], ''));
  setValue('campo-im-fornecedor', pick(data, ['inscricao_municipal', 'im'], ''));

  setValue('campo-contato-fornecedor', data.contato);
  setValue('campo-telefone-fornecedor', data.telefone);
  setValue('campo-whatsapp-fornecedor', data.whatsapp);
  setValue('campo-fax-fornecedor', data.fax);
  setValue('campo-email-fornecedor', data.email);
  setValue('campo-site-fornecedor', data.site);

  setValue('campo-cep-fornecedor', data.cep);
  setValue('campo-endereco-fornecedor', data.endereco);
  setValue('campo-numero-fornecedor', data.numero);
  setValue('campo-complemento-fornecedor', data.complemento);
  setValue('campo-bairro-fornecedor', data.bairro);
  setValue('campo-cidade-fornecedor', data.cidade);
  setValue('campo-estado-fornecedor', pick(data, ['estado', 'uf'], ''));
  setValue('campo-pais-fornecedor', data.pais || 'Brasil');
  setValue('campo-ibge-cidade-fornecedor', pick(data, ['codigo_ibge_cidade', 'ibge_cidade'], ''));
  setValue('campo-ibge-uf-fornecedor', pick(data, ['codigo_ibge_uf', 'ibge_uf'], ''));

  setValue('campo-limite-compras-fornecedor', data.limite_compras);
  setValue('campo-classificacao-fornecedor', data.classificacao);
  setValue('campo-plano-contas-fornecedor', data.plano_contas);
  setValue('campo-observacoes-fornecedor', data.observacoes);

  renderCustomFieldsInputs(data.custom_fields || {});
  switchFornecedorTab('tab-fornecedor-cadastro');
}

function buildFornecedorPayload() {
  return {
    codigo: String(getValue('campo-codigo-fornecedor') || '').trim(),
    tipo_fornecedor: String(getValue('campo-tipo-fornecedor') || '').trim(),
    tipo: String(getValue('campo-tipo-fornecedor') || '').trim(),
    situacao: normalizeSituacao(getValue('campo-situacao-fornecedor')),
    nome: String(getValue('campo-nome-fornecedor') || '').trim(),
    nome_fantasia: String(getValue('campo-nome-fantasia-fornecedor') || '').trim(),
    cpf_cnpj: String(getValue('campo-cpf-cnpj-fornecedor') || '').trim(),
    inscricao_estadual: String(getValue('campo-ie-fornecedor') || '').trim(),
    inscricao_municipal: String(getValue('campo-im-fornecedor') || '').trim(),
    ie: String(getValue('campo-ie-fornecedor') || '').trim(),
    im: String(getValue('campo-im-fornecedor') || '').trim(),
    contato: String(getValue('campo-contato-fornecedor') || '').trim(),
    telefone: String(getValue('campo-telefone-fornecedor') || '').trim(),
    whatsapp: String(getValue('campo-whatsapp-fornecedor') || '').trim(),
    fax: String(getValue('campo-fax-fornecedor') || '').trim(),
    email: String(getValue('campo-email-fornecedor') || '').trim(),
    site: String(getValue('campo-site-fornecedor') || '').trim(),
    cep: String(getValue('campo-cep-fornecedor') || '').trim(),
    endereco: String(getValue('campo-endereco-fornecedor') || '').trim(),
    numero: String(getValue('campo-numero-fornecedor') || '').trim(),
    complemento: String(getValue('campo-complemento-fornecedor') || '').trim(),
    bairro: String(getValue('campo-bairro-fornecedor') || '').trim(),
    cidade: String(getValue('campo-cidade-fornecedor') || '').trim(),
    estado: String(getValue('campo-estado-fornecedor') || '').trim(),
    pais: String(getValue('campo-pais-fornecedor') || '').trim(),
    codigo_ibge_cidade: String(getValue('campo-ibge-cidade-fornecedor') || '').trim(),
    codigo_ibge_uf: String(getValue('campo-ibge-uf-fornecedor') || '').trim(),
    ibge_cidade: String(getValue('campo-ibge-cidade-fornecedor') || '').trim(),
    ibge_uf: String(getValue('campo-ibge-uf-fornecedor') || '').trim(),
    limite_compras: String(getValue('campo-limite-compras-fornecedor') || '').trim(),
    classificacao: String(getValue('campo-classificacao-fornecedor') || '').trim(),
    plano_contas: String(getValue('campo-plano-contas-fornecedor') || '').trim(),
    observacoes: String(getValue('campo-observacoes-fornecedor') || '').trim(),
    custom_fields: normalizeCustomFieldsPayload(),
  };
}

function abrirModalFornecedorNovo() {
  fornecedorEditandoId = null;
  $('modal-fornecedor-titulo').textContent = 'Novo fornecedor';
  $('formFornecedor')?.reset();
  fillFornecedorForm(defaultFornecedor());
  setValue('campo-codigo-fornecedor', generateNextFornecedorCode());
  openModal('modal-fornecedor-backdrop');
}

function fecharModalFornecedor() {
  closeModal('modal-fornecedor-backdrop');
}

async function abrirModalFornecedorEditar(id) {
  try {
    const full = await apiJson(`${API_FORNECEDORES}/${id}`);
    fornecedorEditandoId = full.id;
    $('modal-fornecedor-titulo').textContent = 'Editar fornecedor';
    fillFornecedorForm(full);
    openModal('modal-fornecedor-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar fornecedor.', 'error');
  }
}

async function salvarFornecedor(event) {
  event?.preventDefault?.();

  const nome = String(getValue('campo-nome-fornecedor') || '').trim();
  if (!nome) {
    toast('Preencha o nome do fornecedor.', 'error');
    switchFornecedorTab('tab-fornecedor-cadastro');
    $('campo-nome-fornecedor')?.focus();
    return;
  }

  if (!validateRequiredCustomFields()) return;

  const payload = buildFornecedorPayload();
  const btn = $('btn-salvar-fornecedor');
  setButtonLoading(btn, true, 'Salvando...');

  try {
    const url = fornecedorEditandoId ? `${API_FORNECEDORES}/${fornecedorEditandoId}` : API_FORNECEDORES;
    await apiJson(url, {
      method: fornecedorEditandoId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await carregarFornecedores();
    fecharModalFornecedor();
    toast('Fornecedor salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar fornecedor.', 'error');
  } finally {
    setButtonLoading(btn, false, '', '<i class="fa-solid fa-floppy-disk"></i> Salvar fornecedor');
  }
}

async function excluirFornecedor(id) {
  const ok = await confirmDialog({
    title: 'Excluir fornecedor',
    message: 'Deseja realmente excluir este fornecedor?',
    confirmText: 'Excluir',
    cancelText: 'Cancelar',
  });

  if (!ok) return;

  try {
    await apiJson(`${API_FORNECEDORES}/${id}`, { method: 'DELETE' });
    await carregarFornecedores();
    toast('Fornecedor excluído com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir fornecedor.', 'error');
  }
}

function syncCampoTipo() {
  const tipo = $('campo-custom-tipo')?.value || 'texto';
  const wrap = $('wrap-custom-opcoes');
  if (wrap) wrap.hidden = tipo !== 'select';
}

function abrirModalCampoNovo() {
  campoEditandoId = null;
  $('modal-campo-titulo').textContent = 'Novo campo';
  setValue('campo-custom-nome', '');
  setValue('campo-custom-tipo', 'texto');
  setValue('campo-custom-ordem', '0');
  setValue('campo-custom-opcoes', '');
  $('campo-custom-obrigatorio').checked = false;
  $('campo-custom-ativo').checked = true;
  syncCampoTipo();
  openModal('modal-campo-backdrop');
}

function fecharModalCampo() {
  closeModal('modal-campo-backdrop');
}

async function abrirModalCampoEditar(id) {
  try {
    const campo = await apiJson(`${API_CAMPOS}/${id}`);
    campoEditandoId = campo.id;
    $('modal-campo-titulo').textContent = 'Editar campo';
    setValue('campo-custom-nome', campo.nome || '');
    setValue('campo-custom-tipo', campo.tipo || 'texto');
    setValue('campo-custom-ordem', String(campo.ordem ?? 0));
    setValue('campo-custom-opcoes', parseCampoOpcoes(campo).join('\n'));
    $('campo-custom-obrigatorio').checked = !!campo.obrigatorio;
    $('campo-custom-ativo').checked = campo.ativo !== false;
    syncCampoTipo();
    openModal('modal-campo-backdrop');
  } catch (err) {
    toast(err.message || 'Erro ao carregar campo.', 'error');
  }
}

async function salvarCampo() {
  const nome = String(getValue('campo-custom-nome') || '').trim();
  if (!nome) {
    toast('Nome do campo é obrigatório.', 'error');
    $('campo-custom-nome')?.focus();
    return;
  }

  const tipo = String(getValue('campo-custom-tipo') || 'texto').trim();
  let opcoes_json = null;

  if (tipo === 'select') {
    const linhas = String(getValue('campo-custom-opcoes') || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!linhas.length) {
      toast('Adicione opções para a lista.', 'error');
      $('campo-custom-opcoes')?.focus();
      return;
    }

    opcoes_json = JSON.stringify(linhas);
  }

  const payload = {
    nome,
    slug: slugify(nome),
    tipo,
    ordem: Number(getValue('campo-custom-ordem') || 0),
    obrigatorio: !!$('campo-custom-obrigatorio')?.checked,
    ativo: !!$('campo-custom-ativo')?.checked,
    opcoes_json,
  };

  const btn = $('btn-salvar-campo');
  setButtonLoading(btn, true, 'Salvando...');

  try {
    const url = campoEditandoId ? `${API_CAMPOS}/${campoEditandoId}` : API_CAMPOS;
    await apiJson(url, {
      method: campoEditandoId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    await carregarCamposFornecedores();
    fecharModalCampo();
    toast('Campo salvo com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao salvar campo.', 'error');
  } finally {
    setButtonLoading(btn, false, '', '<i class="fa-solid fa-floppy-disk"></i> Salvar campo');
  }
}

async function excluirCampo(id) {
  const ok = await confirmDialog({
    title: 'Excluir campo',
    message: 'Deseja realmente excluir este campo personalizado?',
    confirmText: 'Excluir',
    cancelText: 'Cancelar',
  });

  if (!ok) return;

  try {
    await apiJson(`${API_CAMPOS}/${id}`, { method: 'DELETE' });
    await carregarCamposFornecedores();
    toast('Campo excluído com sucesso.', 'success');
  } catch (err) {
    toast(err.message || 'Erro ao excluir campo.', 'error');
  }
}

function downloadFile(filename, content, mime = 'application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function csvEscape(value) {
  const s = String(value ?? '');
  const mustQuote = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return mustQuote ? `"${out}"` : out;
}

function detectCSVDelimiter(firstLine) {
  return (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
}

function parseCSV(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter((line) => line.trim().length);
  if (!lines.length) return [];

  const delim = detectCSVDelimiter(lines[0]);

  function parseLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === delim) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    out.push(cur);
    return out.map((v) => v.trim());
  }

  const headers = parseLine(lines[0]).map((h) => slugify(h));
  return lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] ?? '';
    });
    return obj;
  });
}

function parseXLSX(arrayBuffer) {
  if (!window.XLSX) throw new Error('Biblioteca XLSX não carregada.');
  const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function exportarFornecedoresJSON() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  const payload = {
    exported_at: dt.toISOString(),
    total: fornecedores.length,
    items: fornecedores,
  };

  downloadFile(
    `fornecedores_${stamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );

  toast('Exportado JSON com sucesso.', 'success');
}

function exportarFornecedoresCSV() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');

  const baseCols = [
    'codigo',
    'tipo_fornecedor',
    'situacao',
    'nome',
    'nome_fantasia',
    'cpf_cnpj',
    'contato',
    'telefone',
    'whatsapp',
    'email',
    'cidade',
    'estado',
    'classificacao',
  ];
  const customCols = camposFornecedores.map((c) => c.slug).filter(Boolean);
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  fornecedores.forEach((f) => {
    const custom = f.custom_fields || {};
    lines.push(
      cols
        .map((k) => {
          if (baseCols.includes(k)) return csvEscape(f?.[k] ?? '');
          return csvEscape(custom?.[k] ?? '');
        })
        .join(';')
    );
  });

  downloadFile(`fornecedores_${stamp}.csv`, '\ufeff' + lines.join('\n'), 'text/csv;charset=utf-8');
  toast('Exportado CSV com sucesso.', 'success');
}

function mapImportToPayload(obj) {
  const normalized = {};
  Object.entries(obj || {}).forEach(([key, value]) => {
    normalized[slugify(key)] = value;
  });

  const custom_fields = {};
  for (const campo of camposFornecedores || []) {
    const slug = String(campo.slug || '').trim();
    if (!slug) continue;
    const value = normalized[slug];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      custom_fields[slug] = value;
    }
  }

  return {
    codigo: String(normalized.codigo || '').trim(),
    tipo_fornecedor: String(normalized.tipo_fornecedor || normalized.tipo || '').trim(),
    tipo: String(normalized.tipo_fornecedor || normalized.tipo || '').trim(),
    situacao: normalizeSituacao(normalized.situacao || 'ativo'),
    nome: String(normalized.nome || normalized.razao_social || normalized.fornecedor || '').trim(),
    nome_fantasia: String(normalized.nome_fantasia || '').trim(),
    cpf_cnpj: String(normalized.cpf_cnpj || normalized.cnpj_cpf || normalized.documento || '').trim(),
    contato: String(normalized.contato || normalized.responsavel || '').trim(),
    telefone: String(normalized.telefone || '').trim(),
    whatsapp: String(normalized.whatsapp || '').trim(),
    email: String(normalized.email || normalized.e_mail || '').trim(),
    cidade: String(normalized.cidade || '').trim(),
    estado: String(normalized.estado || normalized.uf || '').trim(),
    classificacao: String(normalized.classificacao || '').trim(),
    custom_fields,
  };
}

function findExistingFornecedorId(payload) {
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  const doc = onlyDigits(payload?.cpf_cnpj || '');
  const whatsapp = onlyDigits(payload?.whatsapp || '');
  const email = String(payload?.email || '').trim().toLowerCase();

  if (codigo) {
    const found = fornecedores.find((f) => String(f.codigo || '').trim().toLowerCase() === codigo);
    if (found?.id) return found.id;
  }

  if (doc) {
    const found = fornecedores.find((f) => onlyDigits(getDocumentoFornecedor(f)) === doc);
    if (found?.id) return found.id;
  }

  if (whatsapp) {
    const found = fornecedores.find((f) => onlyDigits(f.whatsapp || '') === whatsapp);
    if (found?.id) return found.id;
  }

  if (email) {
    const found = fornecedores.find((f) => String(f.email || '').trim().toLowerCase() === email);
    if (found?.id) return found.id;
  }

  return null;
}

async function importarFornecedores(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', 'error');
    return;
  }

  try {
    const lower = String(file.name || '').toLowerCase();
    let items = [];

    if (lower.endsWith('.json')) {
      const text = await file.text();
      const data = JSON.parse(text || '{}');
      items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
    } else if (lower.endsWith('.xlsx')) {
      const buffer = await file.arrayBuffer();
      items = parseXLSX(buffer);
    } else {
      const text = await file.text();
      items = parseCSV(text);
    }

    if (!Array.isArray(items) || !items.length) {
      toast('Arquivo vazio ou inválido.', 'error');
      return;
    }

    const ok = await confirmDialog({
      title: 'Importar fornecedores',
      message: `Importar ${items.length} fornecedor(es)? O sistema criará ou atualizará por código, documento, WhatsApp ou e-mail.`,
      confirmText: 'Importar',
      cancelText: 'Cancelar',
    });

    if (!ok) return;

    await carregarFornecedores();

    let success = 0;
    let fail = 0;

    for (const raw of items) {
      try {
        const payload = mapImportToPayload(raw);
        if (!payload.nome) {
          fail += 1;
          continue;
        }

        const existingId = findExistingFornecedorId(payload);
        await apiJson(existingId ? `${API_FORNECEDORES}/${existingId}` : API_FORNECEDORES, {
          method: existingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        success += 1;
      } catch {
        fail += 1;
      }
    }

    await carregarFornecedores();
    toast(
      `Importação concluída: ${success} sucesso(s)${fail ? ` • ${fail} falha(s)` : ''}`,
      fail ? 'error' : 'success',
      3800
    );
  } catch (err) {
    toast(err.message || 'Erro ao importar arquivo.', 'error');
  }
}

function bindTabs() {
  $$('.fornecedor-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchFornecedorTab(btn.dataset.tab));
  });
}

function bindModalCloseOnBackdrop() {
  $$('[data-close-target]').forEach(() => {});

  $('modal-fornecedor-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('modal-fornecedor-backdrop')) fecharModalFornecedor();
  });

  $('modal-campo-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('modal-campo-backdrop')) fecharModalCampo();
  });

  $('Valora-confirm-backdrop')?.addEventListener('click', (event) => {
    if (event.target === $('Valora-confirm-backdrop')) closeConfirm(false);
  });
}

function bindFiltros() {
  $('filtro-busca')?.addEventListener('input', renderTabelaFornecedores);
  $('filtro-tipo')?.addEventListener('input', renderTabelaFornecedores);
  $('filtro-situacao')?.addEventListener('change', renderTabelaFornecedores);
  $('filtro-cidade')?.addEventListener('input', renderTabelaFornecedores);

  $('btn-filtrar-fornecedores')?.addEventListener('click', renderTabelaFornecedores);
  $('btn-limpar-filtros-fornecedores')?.addEventListener('click', () => {
    limparFiltros();
    renderTabelaFornecedores();
  });
}

function bindTabelaActions() {
  $('tbody-fornecedores')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.dataset.action === 'editar') {
      await abrirModalFornecedorEditar(id);
      return;
    }

    if (btn.dataset.action === 'excluir') {
      await excluirFornecedor(id);
    }
  });
}

function bindCamposActions() {
  $('lista-campos-fornecedores')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-campo-action]');
    if (!btn) return;

    const id = Number(btn.dataset.id);
    if (!id) return;

    if (btn.dataset.campoAction === 'editar') {
      await abrirModalCampoEditar(id);
      return;
    }

    if (btn.dataset.campoAction === 'excluir') {
      await excluirCampo(id);
    }
  });
}

function bindTopActions() {
  $('btn-novo-fornecedor')?.addEventListener('click', abrirModalFornecedorNovo);
  $('btn-fechar-modal-fornecedor')?.addEventListener('click', fecharModalFornecedor);
  $('btn-cancelar-fornecedor')?.addEventListener('click', fecharModalFornecedor);
  $('formFornecedor')?.addEventListener('submit', salvarFornecedor);

  $('btn-novo-campo')?.addEventListener('click', abrirModalCampoNovo);
  $('btn-novo-campo-inline')?.addEventListener('click', abrirModalCampoNovo);
  $('btn-fechar-modal-campo')?.addEventListener('click', fecharModalCampo);
  $('btn-cancelar-campo')?.addEventListener('click', fecharModalCampo);
  $('btn-salvar-campo')?.addEventListener('click', salvarCampo);
  $('campo-custom-tipo')?.addEventListener('change', syncCampoTipo);

  $('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  $('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  $('btn-exportar-fornecedores-json')?.addEventListener('click', exportarFornecedoresJSON);
  $('btn-exportar-fornecedores-csv')?.addEventListener('click', exportarFornecedoresCSV);
  $('btn-importar-fornecedores')?.addEventListener('click', () => $('input-importar-fornecedores')?.click());
  $('input-importar-fornecedores')?.addEventListener('change', async (event) => {
    await importarFornecedores(event.target.files?.[0]);
    event.target.value = '';
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindTabs();
  bindModalCloseOnBackdrop();
  bindFiltros();
  bindTabelaActions();
  bindCamposActions();
  bindTopActions();

  await carregarCamposFornecedores();
  await carregarFornecedores();
});
