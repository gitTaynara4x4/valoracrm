let produtos = [];
let produtosPage = { offset: 0, limit: 50, total: 0, hasMore: false };
let produtoEditandoId = null;

let formularioProdutos = null;
let camposFormularioProdutos = [];
let usarFichaPrincipalProdutos = false;

const API_PRODUTOS = '/api/produtos';
const API_FORMULARIOS = '/api/formularios';

function $(id) {
  return document.getElementById(id);
}

function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
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

function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '').trim();
}

function getCodigoProdutoSistema() {
  return onlyDigits($('campo-codigo-ficha-principal-produto')?.value || '');
}

function setCodigoProdutoSistema(value) {
  const codigo = onlyDigits(value);
  const el = $('campo-codigo-ficha-principal-produto');
  if (el) el.value = codigo;
  return codigo;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toast(message, { error = false, ms = 2600 } = {}) {
  const el = $('valora-toast');
  if (!el) return;

  el.textContent = message || '';
  el.classList.toggle('is-error', !!error);
  el.classList.add('show');

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    el.classList.remove('show');
  }, ms);
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

  const text = await resp.text();

  if (!resp.ok) {
    let message = text || 'Erro na requisição.';

    try {
      const parsed = JSON.parse(text);
      message = parsed.detail || parsed.message || message;
    } catch (_) {}

    throw new Error(typeof message === 'string' ? message : 'Erro na requisição.');
  }

  if (!text || resp.status === 204) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.hidden = false;

  requestAnimationFrame(() => {
    modal.classList.add('show');
  });
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.classList.remove('show');

  setTimeout(() => {
    modal.hidden = true;
  }, 180);
}

function normalizeCustomFieldsForExport(value) {
  if (!value) return {};

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  return {};
}

function parseOpcoesCampo(campo) {
  const raw =
    campo?.opcoes ??
    campo?.opcoes_json ??
    campo?.options ??
    campo?.opcoesJson ??
    null;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((item) => String(item ?? '').trim()).filter(Boolean);
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
      }
    } catch (_) {}

    return raw
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function ordenarCampos(campos = []) {
  return [...campos].sort((a, b) => {
    return Number(a.ordem || 0) - Number(b.ordem || 0) ||
      Number(a.id || 0) - Number(b.id || 0);
  });
}

function ordenarSecoes(secoes = []) {
  return [...secoes].sort((a, b) => {
    return Number(a.ordem || 0) - Number(b.ordem || 0) ||
      Number(a.id || 0) - Number(b.id || 0);
  });
}

function isVisualCampo(campo) {
  return campo?.origem === 'visual' || !!campo?.tipo_visual;
}

function tipoCampo(campo) {
  return campo?.tipo_campo || campo?.tipo || 'texto';
}

function labelCampo(campo) {
  return campo?.label || campo?.nome || campo?.campo_sistema || 'Campo';
}

function campoKey(campo) {
  return String(
    campo?.slug ||
    campo?.campo_personalizado_slug ||
    campo?.campo_sistema ||
    slugify(labelCampo(campo))
  ).trim();
}

function larguraCampo(campo) {
  const largura = String(campo?.largura || '').trim();
  if (!largura) return '50';

  return largura.replace('%', '');
}

function campoSpanClass(campo) {
  const tipo = tipoCampo(campo);
  const largura = larguraCampo(campo);

  if (tipo === 'textarea') return 'span-all';
  if (largura === '100') return 'span-all';

  return '';
}

function flattenCamposFormulario(data) {
  const campos = [];
  const secoes = Array.isArray(data?.secoes) ? ordenarSecoes(data.secoes) : [];

  secoes.forEach((secao) => {
    ordenarCampos(secao.campos || []).forEach((campo) => {
      if (campo?.ativo === false) return;
      if (isVisualCampo(campo)) return;

      campos.push({
        ...campo,
        secao_titulo: secao.titulo,
      });
    });
  });

  const semSecao = Array.isArray(data?.campos_sem_secao) ? data.campos_sem_secao : [];

  ordenarCampos(semSecao).forEach((campo) => {
    if (campo?.ativo === false) return;
    if (isVisualCampo(campo)) return;

    campos.push({
      ...campo,
      secao_titulo: 'Outros campos',
    });
  });

  return campos;
}

/* =========================================================
   FORMULÁRIO DE PRODUTOS
========================================================= */

async function carregarFormularioProdutos({ forceRefresh = false, loadingContainer = null } = {}) {
  try {
    let completo = null;

    if (window.ValoraFichaPrincipal?.carregarFormularioModulo) {
      completo = await window.ValoraFichaPrincipal.carregarFormularioModulo('produtos', {
        apiJsonImpl: apiJson,
        ativo: true,
        forceRefresh,
        loadingContainer,
      });
    } else {
      const modelos = await apiJson(`${API_FORMULARIOS}/modelos?modulo=produtos&ativo=true`);
      const lista = Array.isArray(modelos) ? modelos : [];

      if (lista.length) {
        const modelo =
          lista.find((item) => item.usar_como_ficha_principal) ||
          lista.find((item) => item.padrao) ||
          lista[0];

        completo = await apiJson(`${API_FORMULARIOS}/modelos/${modelo.id}`);
      }
    }

    if (!completo?.modelo) {
      formularioProdutos = null;
      camposFormularioProdutos = [];
      usarFichaPrincipalProdutos = false;
      syncFichaPrincipalProdutoUi();
      renderFormularioCabecalho();
      renderCustomFieldsInputs({});
      return;
    }

    formularioProdutos = completo;
    camposFormularioProdutos = flattenCamposFormulario(completo);
    usarFichaPrincipalProdutos = !!completo?.modelo?.usar_como_ficha_principal;

    syncFichaPrincipalProdutoUi();
    renderFormularioCabecalho();
    renderCustomFieldsInputs({});
  } catch (err) {
    console.error('[Produtos] erro ao carregar formulário:', err);

    formularioProdutos = null;
    camposFormularioProdutos = [];
    usarFichaPrincipalProdutos = false;

    syncFichaPrincipalProdutoUi();
    renderFormularioCabecalho();
    renderCustomFieldsInputs({});

    toast(err.message || 'Erro ao carregar ficha de produtos.', {
      error: true,
      ms: 5200,
    });
  }
}

function syncFichaPrincipalProdutoUi(codigo = '') {
  const toggle = $('toggle-ficha-principal-produto');
  const codeCard = $('produto-ficha-principal-code');
  const form = $('formProduto');

  if (toggle) toggle.checked = !!usarFichaPrincipalProdutos;
  if (codeCard) codeCard.hidden = !usarFichaPrincipalProdutos;
  if (form) form.classList.toggle('is-ficha-principal', !!usarFichaPrincipalProdutos);

  if (codigo) {
    setProdutoFichaCode(onlyDigits(codigo));
  }
}

function setProdutoFichaCode(codigo) {
  return setCodigoProdutoSistema(codigo);
}

async function salvarToggleFichaPrincipalProduto(event) {
  const checked = !!event.target.checked;

  try {
    if (!window.ValoraFichaPrincipal) {
      throw new Error('Componente de ficha principal não carregado.');
    }

    if (!formularioProdutos?.modelo?.id) {
      await carregarFormularioProdutos({ loadingContainer: '#custom-fields-container' });
    }

    const modelo = formularioProdutos?.modelo;

    if (!modelo?.id) {
      event.target.checked = false;
      toast('Nenhum formulário de Produtos encontrado para ativar como ficha principal.', {
        error: true,
        ms: 4200,
      });
      return;
    }

    event.target.disabled = true;
    window.ValoraFichaPrincipal?.showLoading?.(
      '#custom-fields-container',
      checked ? 'Montando ficha principal...' : 'Voltando para o cadastro padrão...'
    );

    const atualizado = await window.ValoraFichaPrincipal.atualizarFichaPrincipalModelo(modelo, checked, {
      apiJsonImpl: apiJson,
      moduloFallback: 'produtos',
    });

    usarFichaPrincipalProdutos = checked;
    formularioProdutos = {
      ...formularioProdutos,
      modelo: {
        ...modelo,
        ...(atualizado || {}),
        usar_como_ficha_principal: checked,
      },
    };

    const valoresAtuais = collectCustomFieldsValues();
    syncFichaPrincipalProdutoUi($('campo-codigo-ficha-principal-produto')?.value || '');
    renderCustomFieldsInputs(valoresAtuais);

    toast(
      checked
        ? 'Ficha principal ativada para Produtos.'
        : 'Ficha principal desativada para Produtos.',
      { ms: 2200 }
    );
  } catch (err) {
    event.target.checked = !checked;
    toast(err.message || 'Erro ao alterar ficha principal.', {
      error: true,
      ms: 4500,
    });
  } finally {
    event.target.disabled = false;
  }
}

function renderFormularioCabecalho() {
  const nomeEl = $('produto-formulario-nome');
  const descEl = $('produto-formulario-descricao');

  const modelo = formularioProdutos?.modelo || null;

  if (!modelo) {
    if (nomeEl) nomeEl.textContent = 'Ficha do produto';
    if (descEl) descEl.textContent = 'Nenhum formulário de produtos carregado.';
    return;
  }

  if (nomeEl) {
    nomeEl.textContent = modelo.nome || 'Ficha do produto';
  }

  if (descEl) {
    descEl.textContent =
      modelo.descricao ||
      'Cadastro completo do produto organizado por seções.';
  }
}

function getValorCampo(values, campo) {
  const custom = normalizeCustomFieldsForExport(values);
  const key = campoKey(campo);
  const labelSlug = slugify(labelCampo(campo));

  const aliases = [
    key,
    labelSlug,
    labelSlug.replace(/_do_|_da_|_de_/g, '_'),
    labelSlug.replace(/_produto$/g, ''),
  ].filter(Boolean);

  for (const alias of aliases) {
    if (custom[alias] !== undefined && custom[alias] !== null) {
      return custom[alias];
    }
  }

  return '';
}

function renderCampoFormulario(campo, values = {}) {
  const key = campoKey(campo);
  if (!key) return '';

  const id = `custom-field-${key}`;
  const label = labelCampo(campo);
  const tipo = tipoCampo(campo);
  const valor = getValorCampo(values, campo);
  const obrigatorio = !!campo.obrigatorio;
  const readonly = !!campo.somente_leitura;
  const placeholder = campo.placeholder || label;
  const ajuda = campo.ajuda || '';
  const disabled = readonly ? 'disabled' : '';
  const requiredMark = obrigatorio ? ' *' : '';
  const spanClass = campoSpanClass(campo);

  if (tipo === 'textarea') {
    return `
      <div class="form-group ${spanClass}">
        <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
        <textarea
          id="${id}"
          data-custom-field="${escapeHtml(key)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${obrigatorio ? 'true' : 'false'}"
          data-readonly="${readonly ? 'true' : 'false'}"
          rows="4"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        >${escapeHtml(valor)}</textarea>
        ${ajuda ? `<small class="field-help">${escapeHtml(ajuda)}</small>` : ''}
      </div>
    `;
  }

  if (tipo === 'numero') {
    return `
      <div class="form-group ${spanClass}">
        <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
        <input
          type="number"
          id="${id}"
          data-custom-field="${escapeHtml(key)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${obrigatorio ? 'true' : 'false'}"
          data-readonly="${readonly ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
        ${ajuda ? `<small class="field-help">${escapeHtml(ajuda)}</small>` : ''}
      </div>
    `;
  }

  if (tipo === 'data') {
    return `
      <div class="form-group ${spanClass}">
        <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
        <input
          type="date"
          id="${id}"
          data-custom-field="${escapeHtml(key)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${obrigatorio ? 'true' : 'false'}"
          data-readonly="${readonly ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          ${disabled}
        />
        ${ajuda ? `<small class="field-help">${escapeHtml(ajuda)}</small>` : ''}
      </div>
    `;
  }

  if (tipo === 'checkbox') {
    const checked = String(valor).toLowerCase() === 'true' ||
      String(valor).toLowerCase() === 'sim' ||
      valor === true
      ? 'checked'
      : '';

    return `
      <label class="check-card ${spanClass}">
        <input
          type="checkbox"
          id="${id}"
          data-custom-field="${escapeHtml(key)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${obrigatorio ? 'true' : 'false'}"
          data-readonly="${readonly ? 'true' : 'false'}"
          ${checked}
          ${disabled}
        />
        <span>
          <strong>${escapeHtml(label)}${requiredMark}</strong>
          <small>${escapeHtml(ajuda || 'Campo da ficha do produto.')}</small>
        </span>
      </label>
    `;
  }

  if (tipo === 'select') {
    const opcoes = parseOpcoesCampo(campo);

    return `
      <div class="form-group ${spanClass}">
        <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
        <select
          id="${id}"
          data-custom-field="${escapeHtml(key)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${obrigatorio ? 'true' : 'false'}"
          data-readonly="${readonly ? 'true' : 'false'}"
          ${disabled}
        >
          <option value="">Selecione</option>
          ${opcoes.map((opcao) => `
            <option value="${escapeHtml(opcao)}" ${String(valor) === String(opcao) ? 'selected' : ''}>
              ${escapeHtml(opcao)}
            </option>
          `).join('')}
        </select>
        ${ajuda ? `<small class="field-help">${escapeHtml(ajuda)}</small>` : ''}
      </div>
    `;
  }

  return `
    <div class="form-group ${spanClass}">
      <label for="${id}">${escapeHtml(label)}${requiredMark}</label>
      <input
        type="text"
        id="${id}"
        data-custom-field="${escapeHtml(key)}"
        data-custom-label="${escapeHtml(label)}"
        data-required="${obrigatorio ? 'true' : 'false'}"
        data-readonly="${readonly ? 'true' : 'false'}"
        value="${escapeHtml(valor)}"
        placeholder="${escapeHtml(placeholder)}"
        ${disabled}
      />
      ${ajuda ? `<small class="field-help">${escapeHtml(ajuda)}</small>` : ''}
    </div>
  `;
}

function renderCustomFieldsInputs(values = {}) {
  const container = $('custom-fields-container');
  if (!container) return;

  const data = formularioProdutos;

  if (!data?.modelo) {
    container.innerHTML = `
      <div class="empty-state">
        Nenhum formulário de produtos carregado. Verifique o construtor de formulários.
      </div>
    `;
    return;
  }

  const secoes = Array.isArray(data.secoes) ? ordenarSecoes(data.secoes) : [];
  const camposSemSecao = Array.isArray(data.campos_sem_secao) ? data.campos_sem_secao : [];

  let html = '';

  secoes.forEach((secao) => {
    if (secao.ativo === false) return;

    const campos = ordenarCampos(secao.campos || [])
      .filter((campo) => campo.ativo !== false)
      .filter((campo) => !isVisualCampo(campo));

    if (!campos.length) return;

    html += `
      <article class="custom-section-card">
        <div class="custom-section-head">
          <div class="custom-section-title">
            <span class="custom-section-icon">
              <i class="fa-solid fa-layer-group"></i>
            </span>

            <div>
              <h4>${escapeHtml(secao.titulo || 'Seção')}</h4>
              ${secao.descricao ? `<p>${escapeHtml(secao.descricao)}</p>` : ''}
            </div>
          </div>
        </div>

        <div class="custom-fields-grid">
          ${campos.map((campo) => renderCampoFormulario(campo, values)).join('')}
        </div>
      </article>
    `;
  });

  const camposSoltos = ordenarCampos(camposSemSecao)
    .filter((campo) => campo.ativo !== false)
    .filter((campo) => !isVisualCampo(campo));

  if (camposSoltos.length) {
    html += `
      <article class="custom-section-card">
        <div class="custom-section-head">
          <div class="custom-section-title">
            <span class="custom-section-icon">
              <i class="fa-solid fa-layer-group"></i>
            </span>

            <div>
              <h4>Outros campos</h4>
              <p>Campos sem seção definida no formulário.</p>
            </div>
          </div>
        </div>

        <div class="custom-fields-grid">
          ${camposSoltos.map((campo) => renderCampoFormulario(campo, values)).join('')}
        </div>
      </article>
    `;
  }

  container.innerHTML = html || `
    <div class="empty-state">
      O formulário de produtos não possui campos ativos.
    </div>
  `;

  window.ValoraFichaPrincipal?.animateRenderedSections?.(container);
}

function collectCustomFieldsValues() {
  const values = {};
  const nodes = $$('[data-custom-field]');

  nodes.forEach((el) => {
    const key = el.getAttribute('data-custom-field');
    if (!key) return;

    let value = '';

    if (el.type === 'checkbox') {
      value = el.checked ? 'true' : 'false';
    } else {
      value = String(el.value ?? '').trim();
    }

    if (value !== '') {
      values[key] = value;
    }
  });

  return values;
}

function getCustomValue(custom, keys, fallback = '') {
  for (const key of keys) {
    const value = custom?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return fallback;
}

function buildProdutoBaseFromCustom(customFields) {
  const custom = normalizeCustomFieldsForExport(customFields);

  const nome = getCustomValue(custom, [
    'nome_generico',
    'identificacao_do_produto',
    'identificacao_produto',
    'nome',
  ]);

  const descricao = getCustomValue(custom, [
    'descricao_do_produto',
    'descricao_produto',
    'descricao',
  ]);

  const categoria = getCustomValue(custom, [
    'categoria',
    'categorias',
    'classe',
  ]);

  const unidade = getCustomValue(custom, [
    'tipo_medida',
    'unidade',
  ]);

  const precoVenda = getCustomValue(custom, [
    'preco_final_venda_tabela_01',
    'preco_venda',
  ]);

  const custo = getCustomValue(custom, [
    'valor_de_custo',
    'custo_efetivo',
    'custo',
  ]);

  const estoqueAtual = getCustomValue(custom, [
    'quantidade_atual',
    'estoque_atual',
  ]);

  const statusAtual = String(getCustomValue(custom, ['status_atual'], '')).toLowerCase();

  const ativo = !['inativo', 'bloqueado', 'descontinuado', 'fora de linha'].includes(statusAtual);

  return {
    codigo: getCodigoProdutoSistema(),
    nome,
    descricao,
    categoria,
    unidade,
    preco_venda: precoVenda,
    custo,
    estoque_atual: estoqueAtual,
    ativo,
  };
}

function buildCustomValuesFromProduto(produto = {}) {
  const custom = normalizeCustomFieldsForExport(produto.custom_fields);

  if (produto.nome) {
    if (!custom.nome_generico) {
      custom.nome_generico = produto.nome;
    }

    if (!custom.identificacao_do_produto) {
      custom.identificacao_do_produto = produto.nome;
    }

    if (!custom.identificacao_produto) {
      custom.identificacao_produto = produto.nome;
    }
  }

  if (produto.descricao && !custom.descricao_do_produto) {
    custom.descricao_do_produto = produto.descricao;
  }

  if (produto.categoria && !custom.categoria) {
    custom.categoria = produto.categoria;
  }

  if (produto.unidade && !custom.tipo_medida) {
    custom.tipo_medida = produto.unidade;
  }

  if (produto.preco_venda && !custom.preco_final_venda_tabela_01) {
    custom.preco_final_venda_tabela_01 = produto.preco_venda;
  }

  if (produto.custo && !custom.valor_de_custo) {
    custom.valor_de_custo = produto.custo;
  }

  if (produto.estoque_atual && !custom.quantidade_atual) {
    custom.quantidade_atual = produto.estoque_atual;
  }

  return custom;
}

function buildCustomValuesNovoProduto() {
  return {
    data_cadastro: todayISO(),
  };
}

function validarCamposFormulario(customFields) {
  const custom = normalizeCustomFieldsForExport(customFields);

  for (const campo of camposFormularioProdutos) {
    if (!campo.obrigatorio) continue;
    if (campo.somente_leitura) continue;
    if (campo.ativo === false) continue;
    if (isVisualCampo(campo)) continue;

    const key = campoKey(campo);
    const label = labelCampo(campo);
    const tipo = tipoCampo(campo);
    const value = custom[key];

    if (tipo === 'checkbox') {
      if (value !== 'true' && value !== true) {
        return `Preencha o campo obrigatório: ${label}`;
      }

      continue;
    }

    if (value === undefined || value === null || String(value).trim() === '') {
      return `Preencha o campo obrigatório: ${label}`;
    }
  }

  return null;
}

/* =========================================================
   PRODUTOS API
========================================================= */

function montarUrlProdutos({ offset = produtosPage.offset || 0, limit = produtosPage.limit || 50 } = {}) {
  const params = new URLSearchParams();
  const busca = String($('busca-produtos')?.value || '').trim();

  params.set('paginated', 'true');
  params.set('limit', String(limit));
  params.set('offset', String(offset));

  if (busca) params.set('busca', busca);

  return `${API_PRODUTOS}?${params.toString()}`;
}

function setProdutosLoading(message = 'Buscando produtos no banco...') {
  const tbody = $('tbody-produtos');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="empty-state" style="border:none; text-align:center;">
        ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

async function carregarProdutos({ offset = produtosPage.offset || 0, silent = false } = {}) {
  if (!silent) setProdutosLoading();

  const data = await apiJson(montarUrlProdutos({ offset }));

  if (Array.isArray(data)) {
    produtos = data;
    produtosPage = {
      offset: 0,
      limit: data.length || 50,
      total: data.length,
      hasMore: false,
    };
  } else {
    produtos = Array.isArray(data?.items) ? data.items : [];
    produtosPage = {
      offset: Number(data?.offset || 0),
      limit: Number(data?.limit || 50),
      total: Number(data?.total || produtos.length),
      hasMore: !!data?.has_more,
    };
  }

  renderTabelaProdutos();
}

async function obterProdutoNoServidor(id) {
  return apiJson(`${API_PRODUTOS}/${id}`);
}

async function salvarProdutoNoServidor(payload, editandoId) {
  const url = editandoId == null ? API_PRODUTOS : `${API_PRODUTOS}/${editandoId}`;
  const method = editandoId == null ? 'POST' : 'PUT';

  return apiJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function excluirProdutoNoServidor(id) {
  return apiJson(`${API_PRODUTOS}/${id}`, {
    method: 'DELETE',
  });
}

/* =========================================================
   EXPORTAÇÃO / IMPORTAÇÃO
========================================================= */

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

function uniqueArray(items) {
  return [...new Set(items.filter(Boolean))];
}

function camposFormularioExportaveis() {
  return uniqueArray(camposFormularioProdutos.map((campo) => campoKey(campo)));
}

function pickProdutosForExport() {
  return (produtos || []).map((p) => ({
    id: p.id ?? null,
    codigo: p.codigo ?? '',
    nome: p.nome ?? '',
    descricao: p.descricao ?? '',
    categoria: p.categoria ?? '',
    unidade: p.unidade ?? '',
    preco_venda: p.preco_venda ?? '',
    custo: p.custo ?? '',
    estoque_atual: p.estoque_atual ?? '',
    ativo: p.ativo ?? true,
    custom_fields: normalizeCustomFieldsForExport(p.custom_fields),
  }));
}

function exportarProdutosJSON() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');

  const payload = {
    exported_at: dt.toISOString(),
    formulario: formularioProdutos?.modelo || null,
    total: (produtos || []).length,
    items: pickProdutosForExport(),
  };

  downloadFile(
    `produtos_${stamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );

  toast('Exportado JSON.', { ms: 1800 });
}

function csvEscape(value) {
  const s = String(value ?? '');
  const must = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');

  return must ? `"${out}"` : out;
}

function produtosToCSV(items) {
  const baseCols = [
    'codigo',
    'nome',
    'descricao',
    'categoria',
    'unidade',
    'preco_venda',
    'custo',
    'estoque_atual',
    'ativo',
  ];

  const customCols = camposFormularioExportaveis();
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  (items || []).forEach((produto) => {
    const custom = normalizeCustomFieldsForExport(produto.custom_fields);

    lines.push(
      cols.map((key) => {
        if (baseCols.includes(key)) {
          return csvEscape(produto?.[key] ?? '');
        }

        return csvEscape(custom?.[key] ?? '');
      }).join(';')
    );
  });

  return '\ufeff' + lines.join('\n');
}

function exportarProdutosCSV() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  const csv = produtosToCSV(pickProdutosForExport());

  downloadFile(
    `produtos_${stamp}.csv`,
    csv,
    'text/csv;charset=utf-8'
  );

  toast('Exportado CSV.', { ms: 1800 });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();

    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler arquivo.'));

    fr.readAsText(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();

    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler arquivo.'));

    fr.readAsArrayBuffer(file);
  });
}

function detectCSVDelimiter(firstLine) {
  const semi = (firstLine.match(/;/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;

  return semi >= comma ? ';' : ',';
}

function parseCSV(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter((line) => line.trim().length);

  if (!lines.length) return [];

  const delim = detectCSVDelimiter(lines[0]);

  function parseLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"') {
        const next = line[i + 1];

        if (inQ && next === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = !inQ;
        }

        continue;
      }

      if (!inQ && ch === delim) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    out.push(cur);

    return out.map((s) => String(s ?? '').trim());
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());

  return lines.slice(1).map((line) => {
    const parts = parseLine(line);
    const obj = {};

    headers.forEach((h, idx) => {
      obj[h] = parts[idx] ?? '';
    });

    return obj;
  });
}

function parseXLSX(arrayBuffer) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Biblioteca XLSX não carregou.');
  }

  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const rows = (aoa || []).filter((row) => {
      return Array.isArray(row) && row.some((value) => String(value ?? '').trim() !== '');
    });

    if (!rows.length) continue;

    const headers = rows[0].map((value) => String(value ?? '').trim());
    const normalizedHeaders = headers.map((value) => slugify(value));
    const hasHeader =
      normalizedHeaders.includes('codigo') ||
      normalizedHeaders.includes('nome') ||
      normalizedHeaders.includes('produto') ||
      normalizedHeaders.includes('categoria');

    if (hasHeader) {
      return rows.slice(1).map((row) => {
        const obj = {};

        headers.forEach((h, index) => {
          obj[h] = row[index] ?? '';
        });

        return obj;
      }).filter((obj) => {
        return Object.values(obj).some((value) => String(value ?? '').trim() !== '');
      });
    }

    const cols = [
      'codigo',
      'nome',
      'descricao',
      'categoria',
      'unidade',
      'preco_venda',
      'custo',
      'estoque_atual',
    ];

    return rows.map((row) => {
      const obj = {};

      cols.forEach((key, index) => {
        obj[key] = row[index] ?? '';
      });

      return obj;
    }).filter((obj) => {
      return String(obj.nome || obj.codigo || '').trim() !== '';
    });
  }

  return [];
}

function normalizeImportObject(obj) {
  const normalized = {};

  Object.entries(obj || {}).forEach(([key, value]) => {
    normalized[slugify(key)] = value;
  });

  return normalized;
}

function pickImport(normalized, aliases, fallback = '') {
  for (const alias of aliases) {
    const key = slugify(alias);
    const value = normalized[key];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return fallback;
}

function mapImportToPayload(obj) {
  const normalized = normalizeImportObject(obj);

  const custom = {};

  for (const campo of camposFormularioProdutos) {
    const key = campoKey(campo);
    const label = labelCampo(campo);

    const aliases = [
      key,
      label,
      slugify(label),
    ];

    for (const alias of aliases) {
      const normalizedKey = slugify(alias);
      const value = normalized[normalizedKey];

      if (value !== undefined && value !== null && String(value).trim() !== '') {
        custom[key] = value;
        break;
      }
    }
  }

  const codigo = String(pickImport(normalized, [
    'codigo',
    'código',
    'codigo_produto',
    'codigo_interno_do_produto',
  ]) || '').trim();

  const nome = String(pickImport(normalized, [
    'nome',
    'produto',
    'nome_generico',
    'identificacao_do_produto',
    'identificacao_produto',
  ]) || '').trim();

  const descricao = String(pickImport(normalized, [
    'descricao',
    'descrição',
    'descricao_do_produto',
  ]) || '').trim();

  if (nome) {
    if (!custom.nome_generico) custom.nome_generico = nome;
    if (!custom.identificacao_do_produto) custom.identificacao_do_produto = nome;
  }

  if (descricao && !custom.descricao_do_produto) {
    custom.descricao_do_produto = descricao;
  }

  const base = buildProdutoBaseFromCustom(custom);
  base.codigo = onlyDigits(codigo);
  base.custom_fields = custom;

  return base;
}

function findExistingProdutoIdByCodigo(payload) {
  const codigo = onlyDigits(payload?.codigo || '').toLowerCase();

  if (!codigo) return null;

  const found = (produtos || []).find((p) => {
    return onlyDigits(p.codigo || '').toLowerCase() === codigo;
  });

  return found?.id || null;
}

async function importarProdutosFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    toast('Arquivo vazio ou inválido.', {
      error: true,
      ms: 4000,
    });
    return;
  }

  const ok = await confirmDialog({
    title: 'Importar produtos',
    message: `Importar ${items.length} produto(s)? O sistema vai criar ou atualizar por código.`,
    confirmText: 'Importar',
    cancelText: 'Cancelar',
    danger: true,
  });

  if (!ok) return;

  toast('Importando produtos...', { ms: 2200 });

  let okCount = 0;
  let failCount = 0;

  try {
    await carregarProdutos();
  } catch (_) {}

  for (const raw of items) {
    try {
      const payload = mapImportToPayload(raw);

      if (!payload.nome) {
        failCount += 1;
        continue;
      }

      const existingId = findExistingProdutoIdByCodigo(payload);

      await salvarProdutoNoServidor(payload, existingId);

      okCount += 1;
    } catch (err) {
      console.error('[Produtos] erro ao importar item:', err);
      failCount += 1;
    }
  }

  try {
    await carregarProdutos();
  } catch (_) {}

  if (failCount === 0) {
    toast(`Importação concluída: ${okCount} OK.`, { ms: 2200 });
  } else {
    toast(`Importado: ${okCount} OK • ${failCount} falharam`, {
      error: true,
      ms: 5200,
    });
  }
}

async function importarProdutosArquivo(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', { error: true });
    return;
  }

  const name = String(file.name || '').toLowerCase();

  try {
    if (name.endsWith('.json')) {
      const text = await readFileAsText(file);
      const data = JSON.parse(text || '{}');
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);

      await importarProdutosFromItems(items);
      return;
    }

    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = await readFileAsText(file);
      await importarProdutosFromItems(parseCSV(text));
      return;
    }

    if (name.endsWith('.xlsx')) {
      const buffer = await readFileAsArrayBuffer(file);
      await importarProdutosFromItems(parseXLSX(buffer));
      return;
    }

    toast('Formato inválido. Use JSON, CSV ou XLSX.', {
      error: true,
      ms: 4200,
    });
  } catch (err) {
    console.error('[Produtos] erro ao importar arquivo:', err);

    toast(err.message || 'Erro ao importar arquivo.', {
      error: true,
      ms: 5000,
    });
  }
}

/* =========================================================
   TABELA / MODAL
========================================================= */

function textoBuscaProduto(produto) {
  const custom = normalizeCustomFieldsForExport(produto.custom_fields);

  return [
    produto.codigo,
    produto.nome,
    produto.categoria,
    produto.descricao,
    produto.unidade,
    ...Object.values(custom),
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderTabelaProdutos() {
  const tbody = $('tbody-produtos');
  const spanCount = $('contagem-produtos');
  if (!tbody) return;

  // A filtragem principal agora é feita no backend, com paginação.
  const filtrados = produtos || [];

  if (!filtrados.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="empty-state">
          Nenhum produto encontrado.
        </td>
      </tr>
    `;

    if (spanCount) {
      spanCount.textContent = '0 produtos';
    }

    renderPaginacaoProdutos();
    return;
  }

  tbody.innerHTML = filtrados.map((produto) => `
    <tr>
      <td><span class="badge-codigo">${escapeHtml(produto.codigo || '-')}</span></td>
      <td><strong>${escapeHtml(produto.nome || '-')}</strong></td>
      <td>${escapeHtml(produto.categoria || '-')}</td>
      <td>R$ ${escapeHtml(produto.preco_venda || '-')}</td>
      <td>${escapeHtml(produto.estoque_atual || '-')}</td>
      <td class="text-right">
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn-icon" data-action="editar" data-id="${produto.id}" title="Editar produto">
            <i class="fa-solid fa-pen"></i>
          </button>

          <button class="btn-icon danger" data-action="excluir" data-id="${produto.id}" title="Excluir produto">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  if (spanCount) {
    const total = Number(produtosPage.total || filtrados.length || 0);
    const ini = total ? Number(produtosPage.offset || 0) + 1 : 0;
    const fim = Math.min(Number(produtosPage.offset || 0) + filtrados.length, total);

    spanCount.textContent = total === filtrados.length
      ? (filtrados.length === 1 ? '1 produto' : `${filtrados.length} produtos`)
      : `${ini}-${fim} de ${total} produtos`;
  }

  renderPaginacaoProdutos();
}

function renderPaginacaoProdutos() {
  const wrap = $('paginacao-produtos');
  if (!wrap) return;

  const offset = Number(produtosPage.offset || 0);
  const limit = Number(produtosPage.limit || 50);
  const total = Number(produtosPage.total || 0);
  const atual = total ? Math.floor(offset / limit) + 1 : 1;
  const paginas = Math.max(1, Math.ceil(total / limit));

  wrap.innerHTML = `
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
    <span class="pagination-info">Página ${atual} de ${paginas}</span>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="next" ${!produtosPage.hasMore ? 'disabled' : ''}>Próxima</button>
  `;
}

function abrirModalProduto() {
  openModal('modal-produto-backdrop');
}

function fecharModalProduto() {
  closeModal('modal-produto-backdrop');
  produtoEditandoId = null;
}

function abrirModalProdutoNovo() {
  const titulo = $('modal-produto-titulo');

  if (titulo) {
    titulo.textContent = 'Novo produto';
  }

  produtoEditandoId = null;

  const values = buildCustomValuesNovoProduto();
  const base = buildProdutoBaseFromCustom(values);
  setProdutoFichaCode('');
  syncFichaPrincipalProdutoUi('');
  renderCustomFieldsInputs(values);

  abrirModalProduto();
}

function abrirModalProdutoEditar(produto) {
  const titulo = $('modal-produto-titulo');

  if (titulo) {
    titulo.textContent = 'Editar produto';
  }

  produtoEditandoId = produto.id;

  const values = buildCustomValuesFromProduto(produto);
  const base = buildProdutoBaseFromCustom(values);
  setProdutoFichaCode(produto.codigo || base.codigo || '');
  syncFichaPrincipalProdutoUi(produto.codigo || base.codigo || '');
  renderCustomFieldsInputs(values);

  abrirModalProduto();
}

function buildPayloadProduto() {
  const customFields = collectCustomFieldsValues();
  const base = buildProdutoBaseFromCustom(customFields);

  return {
    ...base,
    codigo: onlyDigits(base.codigo),
    custom_fields: customFields,
  };
}

async function salvarProduto() {
  const payload = buildPayloadProduto();

  const erroCustom = validarCamposFormulario(payload.custom_fields);

  if (erroCustom) {
    toast(erroCustom, {
      error: true,
      ms: 4500,
    });

    return;
  }

  if (!payload.nome) {
    toast('Preencha o nome do produto.', {
      error: true,
      ms: 4200,
    });

    return;
  }

  const btn = $('btn-salvar-produto');
  const original = btn ? btn.innerHTML : '';

  try {
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    }

    await salvarProdutoNoServidor(payload, produtoEditandoId);
    await carregarProdutos();

    fecharModalProduto();

    toast('Produto salvo com sucesso.', { ms: 1800 });
  } catch (err) {
    console.error('[Produtos] erro ao salvar:', err);

    toast(err.message || 'Erro ao salvar produto.', {
      error: true,
      ms: 5000,
    });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || '<i class="fa-solid fa-floppy-disk"></i> Salvar produto';
    }
  }
}

/* =========================================================
   CONFIRM
========================================================= */

let _confirmResolver = null;

function confirmDialog({
  title = 'Confirmar',
  message = 'Tem certeza?',
  confirmText = 'OK',
  cancelText = 'Cancelar',
  danger = false,
} = {}) {
  const backdrop = $('Valora-confirm-backdrop');
  const titleEl = $('Valora-confirm-title');
  const msgEl = $('Valora-confirm-message');
  const okBtn = $('Valora-confirm-ok');
  const cancelBtn = $('Valora-confirm-cancel');

  if (!backdrop || !okBtn || !cancelBtn) {
    return Promise.resolve(window.confirm(message));
  }

  titleEl.textContent = title || 'Confirmar';
  msgEl.textContent = message || 'Tem certeza?';
  okBtn.textContent = confirmText || 'OK';
  cancelBtn.textContent = cancelText || 'Cancelar';

  okBtn.classList.toggle('danger-action', !!danger);

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

/* =========================================================
   EVENTOS
========================================================= */

function bindEventos() {
  const modalProdutoBackdrop = $('modal-produto-backdrop');
  const confirmBackdrop = $('Valora-confirm-backdrop');

  $('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  $('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  confirmBackdrop?.addEventListener('click', (event) => {
    if (event.target === confirmBackdrop) {
      closeConfirm(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    if (confirmBackdrop?.classList.contains('show')) {
      closeConfirm(false);
      return;
    }

    if (modalProdutoBackdrop?.classList.contains('show')) {
      fecharModalProduto();
    }
  });

  let produtosBuscaTimer = null;

  $('busca-produtos')?.addEventListener('input', () => {
    clearTimeout(produtosBuscaTimer);
    produtosBuscaTimer = setTimeout(() => {
      carregarProdutos({ offset: 0, silent: true });
    }, 350);
  });

  $('paginacao-produtos')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page-action]');
    if (!btn || btn.disabled) return;

    const limit = Number(produtosPage.limit || 50);
    let offset = Number(produtosPage.offset || 0);

    if (btn.dataset.pageAction === 'prev') offset = Math.max(0, offset - limit);
    if (btn.dataset.pageAction === 'next') offset += limit;

    carregarProdutos({ offset });
  });

  $('btn-novo-produto')?.addEventListener('click', abrirModalProdutoNovo);
  $('btn-fechar-modal-produto')?.addEventListener('click', fecharModalProduto);
  $('btn-cancelar-produto')?.addEventListener('click', fecharModalProduto);
  $('btn-salvar-produto')?.addEventListener('click', salvarProduto);
  $('toggle-ficha-principal-produto')?.addEventListener('change', salvarToggleFichaPrincipalProduto);

  $('formProduto')?.addEventListener('submit', (event) => {
    event.preventDefault();
    salvarProduto();
  });

  modalProdutoBackdrop?.addEventListener('click', (event) => {
    if (event.target === modalProdutoBackdrop) {
      fecharModalProduto();
    }
  });

  $('btn-exportar-produtos-json')?.addEventListener('click', exportarProdutosJSON);
  $('btn-exportar-produtos-csv')?.addEventListener('click', exportarProdutosCSV);

  const inputImport = $('input-importar-produtos');

  $('btn-importar-produtos')?.addEventListener('click', () => {
    if (inputImport) {
      inputImport.click();
    } else {
      toast('Faltou o input de importação.', {
        error: true,
        ms: 4200,
      });
    }
  });

  inputImport?.addEventListener('change', async () => {
    const file = inputImport.files && inputImport.files[0]
      ? inputImport.files[0]
      : null;

    await importarProdutosArquivo(file);

    inputImport.value = '';
  });

  $('tbody-produtos')?.addEventListener('click', async (event) => {
    const btn = event.target.closest('.btn-icon');

    if (!btn) return;

    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);

    if (!id) return;

    if (action === 'editar') {
      try {
        const full = await obterProdutoNoServidor(id);
        abrirModalProdutoEditar(full);
      } catch (err) {
        console.error('[Produtos] erro ao abrir produto:', err);

        toast(err.message || 'Não foi possível abrir o produto.', {
          error: true,
          ms: 5000,
        });
      }

      return;
    }

    if (action === 'excluir') {
      const ok = await confirmDialog({
        title: 'Excluir produto',
        message: 'Deseja realmente excluir este produto?',
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        danger: true,
      });

      if (!ok) return;

      try {
        await excluirProdutoNoServidor(id);
        await carregarProdutos();

        toast('Produto excluído.', { ms: 1800 });
      } catch (err) {
        console.error('[Produtos] erro ao excluir:', err);

        toast(err.message || 'Erro ao excluir produto.', {
          error: true,
          ms: 5000,
        });
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEventos();

  try {
    await carregarFormularioProdutos({ loadingContainer: '#custom-fields-container' });
    await carregarProdutos();
  } catch (err) {
    console.error('[Produtos] erro ao iniciar:', err);

    toast(err.message || 'Erro ao carregar dados de produtos.', {
      error: true,
      ms: 5000,
    });
  }
});