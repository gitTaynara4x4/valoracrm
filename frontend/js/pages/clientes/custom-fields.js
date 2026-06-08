import { escapeHtml, slugify } from './utils.js';

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
    const text = await resp.text();
    throw new Error(text || 'Erro ao carregar dados.');
  }

  if (resp.status === 204) return null;
  return resp.json();
}

function parseCampoOpcoes(campo) {
  if (!campo) return [];

  if (Array.isArray(campo.opcoes)) {
    return campo.opcoes.map((x) => String(x || '').trim()).filter(Boolean);
  }

  const raw = campo.opcoes_json || campo.opcoes || '';

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map((x) => String(x || '').trim()).filter(Boolean);
  }

  const text = String(raw || '').trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    }
  } catch (_) {}

  return text
    .split(/\n|,|;/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizarTipo(tipo) {
  const t = String(tipo || 'texto').trim().toLowerCase();

  const map = {
    text: 'texto',
    texto: 'texto',
    textarea: 'textarea',
    numero: 'numero',
    number: 'numero',
    data: 'data',
    date: 'data',
    select: 'select',
    lista: 'select',
    checkbox: 'checkbox',
    email: 'email',
    telefone: 'telefone',
    phone: 'telefone',
    moeda: 'moeda',
    percentual: 'percentual',
  };

  return map[t] || 'texto';
}

function getCampoSlug(campo) {
  return String(campo?.slug || slugify(campo?.nome || campo?.label || '')).trim();
}

function montarCampoFinal(campoCliente, campoFormulario = null) {
  const nome = campoCliente?.nome || campoFormulario?.label || campoFormulario?.nome || '';
  const slug = campoCliente?.slug || slugify(nome);

  if (!slug) return null;

  return {
    id: campoCliente?.id || campoFormulario?.id || null,
    nome,
    slug,
    tipo: normalizarTipo(campoCliente?.tipo || campoFormulario?.tipo_campo || 'texto'),
    obrigatorio: campoCliente?.obrigatorio ?? campoFormulario?.obrigatorio ?? false,
    ativo: campoCliente?.ativo ?? campoFormulario?.ativo ?? true,
    opcoes_json: campoCliente?.opcoes_json || campoFormulario?.opcoes_json || campoFormulario?.opcoes || null,
    ordem: Number(campoCliente?.ordem ?? campoFormulario?.ordem ?? 0),
    largura: campoFormulario?.largura || '50',
    ajuda: campoFormulario?.ajuda || '',
    placeholder: campoFormulario?.placeholder || '',
  };
}

function indexarCamposClientes(camposClientes = []) {
  const bySlug = new Map();
  const byNome = new Map();

  (camposClientes || []).forEach((campo) => {
    const slug = getCampoSlug(campo);
    const nome = slugify(campo?.nome || '');

    if (slug) bySlug.set(slug, campo);
    if (nome) byNome.set(nome, campo);
  });

  return { bySlug, byNome };
}

async function carregarFormularioPadraoClientes() {
  const modelos = await apiJson('/api/formularios/modelos?modulo=clientes&ativo=true');

  const lista = Array.isArray(modelos) ? modelos : [];
  if (!lista.length) return null;

  const modelo = lista.find((m) => m.padrao) || lista[0];
  if (!modelo?.id) return null;

  return apiJson(`/api/formularios/modelos/${modelo.id}`);
}

function montarSecoesPeloFormulario(formulario, camposClientes = []) {
  const { bySlug, byNome } = indexarCamposClientes(camposClientes);
  const usados = new Set();

  const secoes = [];

  const formSecoes = Array.isArray(formulario?.secoes) ? formulario.secoes : [];

  formSecoes.forEach((secao) => {
    const campos = [];

    const camposFormulario = Array.isArray(secao.campos) ? secao.campos : [];

    camposFormulario
      .filter((campo) => campo?.ativo !== false)
      .filter((campo) => String(campo?.origem || 'personalizado') !== 'visual')
      .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0))
      .forEach((campoFormulario) => {
        const label = campoFormulario?.label || campoFormulario?.nome || '';
        const slug = slugify(label);

        const campoCliente =
          bySlug.get(slug) ||
          byNome.get(slug) ||
          null;

        const campoFinal = montarCampoFinal(campoCliente, campoFormulario);
        if (!campoFinal) return;

        usados.add(campoFinal.slug);
        campos.push(campoFinal);
      });

    if (campos.length) {
      secoes.push({
        id: secao.id,
        titulo: secao.titulo || 'Seção',
        descricao: secao.descricao || '',
        ordem: Number(secao.ordem || 0),
        campos,
      });
    }
  });

  const extras = (camposClientes || [])
    .filter((campo) => campo?.ativo !== false)
    .map((campo) => montarCampoFinal(campo, null))
    .filter(Boolean)
    .filter((campo) => !usados.has(campo.slug))
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

  if (extras.length) {
    secoes.push({
      id: 'extras',
      titulo: 'Outros campos',
      descricao: 'Campos personalizados que ainda não estão organizados em uma seção.',
      ordem: 9999,
      campos: extras,
    });
  }

  return secoes.sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
}

function montarSecoesFlat(camposClientes = []) {
  const campos = (camposClientes || [])
    .filter((campo) => campo?.ativo !== false)
    .map((campo) => montarCampoFinal(campo, null))
    .filter(Boolean)
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

  if (!campos.length) return [];

  return [
    {
      id: 'flat',
      titulo: 'Campos personalizados',
      descricao: 'Campos extras do cadastro do cliente.',
      ordem: 1,
      campos,
    },
  ];
}

function renderInputCampo(campo, values = {}) {
  const slug = campo.slug;
  const id = `custom-field-${slug}`;
  const label = campo.nome || slug;
  const tipo = normalizarTipo(campo.tipo);
  const valor = values?.[slug] ?? '';
  const required = campo.obrigatorio ? ' *' : '';
  const placeholder = campo.placeholder || '';

  let html = `<div class="form-group custom-field-item">`;

  if (tipo === 'checkbox') {
    const checked =
      String(valor).toLowerCase() === 'true' ||
      String(valor).toLowerCase() === 'sim' ||
      valor === true
        ? 'checked'
        : '';

    html += `
      <label class="custom-checkbox">
        <input
          type="checkbox"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          ${checked}
        />
        <span>${escapeHtml(label)}${required}</span>
      </label>
    `;
  } else {
    html += `<label for="${id}">${escapeHtml(label)}${required}</label>`;

    if (tipo === 'textarea') {
      html += `
        <textarea
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          rows="3"
          placeholder="${escapeHtml(placeholder)}"
        >${escapeHtml(valor)}</textarea>
      `;
    } else if (tipo === 'numero') {
      html += `
        <input
          type="number"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
        />
      `;
    } else if (tipo === 'data') {
      html += `
        <input
          type="date"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
        />
      `;
    } else if (tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);

      html += `
        <select id="${id}" data-custom-field="${escapeHtml(slug)}">
          <option value="">Selecione</option>
          ${opcoes
            .map((opcao) => {
              const selected = String(opcao) === String(valor) ? 'selected' : '';
              return `<option value="${escapeHtml(opcao)}" ${selected}>${escapeHtml(opcao)}</option>`;
            })
            .join('')}
        </select>
      `;
    } else if (tipo === 'email') {
      html += `
        <input
          type="email"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
        />
      `;
    } else if (tipo === 'telefone') {
      html += `
        <input
          type="tel"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
        />
      `;
    } else {
      html += `
        <input
          type="text"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
        />
      `;
    }

    if (campo.ajuda) {
      html += `<small class="field-hint">${escapeHtml(campo.ajuda)}</small>`;
    }
  }

  html += `</div>`;

  return html;
}

function renderSecao(secao, values = {}) {
  return `
    <article class="custom-section-card">
      <div class="custom-section-head">
        <div>
          <h4>
            <i class="fa-solid fa-layer-group"></i>
            ${escapeHtml(secao.titulo || 'Seção')}
          </h4>
          ${secao.descricao ? `<p>${escapeHtml(secao.descricao)}</p>` : ''}
        </div>
      </div>

      <div class="custom-fields-grid">
        ${(secao.campos || []).map((campo) => renderInputCampo(campo, values)).join('')}
      </div>
    </article>
  `;
}

export function renderCustomFieldsInputs(camposClientes, values = {}) {
  const container = document.getElementById('custom-fields-container');
  if (!container) return;

  container.classList.add('custom-form-sections');
  container.classList.remove('custom-fields-grid');

  if (!Array.isArray(camposClientes) || !camposClientes.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        Nenhum campo personalizado cadastrado.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="empty-state" style="grid-column:1 / -1;">
      Carregando estrutura do formulário...
    </div>
  `;

  carregarFormularioPadraoClientes()
    .then((formulario) => {
      let secoes = [];

      if (formulario?.modelo) {
        secoes = montarSecoesPeloFormulario(formulario, camposClientes);
      }

      if (!secoes.length) {
        secoes = montarSecoesFlat(camposClientes);
      }

      if (!secoes.length) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column:1 / -1;">
            Todos os campos personalizados estão ocultos.
          </div>
        `;
        return;
      }

      container.innerHTML = secoes.map((secao) => renderSecao(secao, values)).join('');
    })
    .catch((err) => {
      console.warn('[Clientes] Não foi possível carregar seções do formulário:', err);

      const secoes = montarSecoesFlat(camposClientes);

      container.innerHTML = secoes.length
        ? secoes.map((secao) => renderSecao(secao, values)).join('')
        : `
          <div class="empty-state" style="grid-column:1 / -1;">
            Nenhum campo personalizado cadastrado.
          </div>
        `;
    });
}

export function normalizeCustomFieldsPayload() {
  const payload = {};

  document.querySelectorAll('[data-custom-field]').forEach((el) => {
    const slug = String(el.dataset.customField || '').trim();
    if (!slug) return;

    if (el.type === 'checkbox') {
      payload[slug] = !!el.checked;
      return;
    }

    const value = String(el.value ?? '').trim();

    if (value !== '') {
      payload[slug] = value;
    }
  });

  return payload;
}

export function validateRequiredCustomFields(camposClientes, values = {}) {
  const campos = Array.isArray(camposClientes) ? camposClientes : [];

  for (const campo of campos) {
    if (campo?.ativo === false || !campo?.obrigatorio) continue;

    const slug = getCampoSlug(campo);
    const label = campo.nome || slug;
    const value = values?.[slug];

    if (campo.tipo === 'checkbox') {
      if (value !== true && String(value).toLowerCase() !== 'true') {
        return {
          ok: false,
          message: `Preencha o campo obrigatório: ${label}`,
        };
      }

      continue;
    }

    if (value === undefined || value === null || String(value).trim() === '') {
      return {
        ok: false,
        message: `Preencha o campo obrigatório: ${label}`,
      };
    }
  }

  return {
    ok: true,
    message: '',
  };
}