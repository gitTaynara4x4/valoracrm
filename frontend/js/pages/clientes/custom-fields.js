import { state } from './state.js';
import { carregarFormularioClientes } from './api.js';
import { escapeHtml, slugify } from './utils.js';

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
  return String(
    campo?.slug ||
    campo?.campo_personalizado_slug ||
    campo?.campo_sistema ||
    slugify(campo?.nome || campo?.label || '')
  ).trim();
}

function montarCampoFinal(campoCliente, campoFormulario = null) {
  const nome =
    campoCliente?.nome ||
    campoFormulario?.label ||
    campoFormulario?.nome ||
    campoFormulario?.campo_sistema ||
    '';

  const slug =
    campoCliente?.slug ||
    campoFormulario?.campo_sistema ||
    slugify(nome);

  if (!slug) return null;

  return {
    id: campoCliente?.id || campoFormulario?.id || null,
    nome,
    slug,
    tipo: normalizarTipo(campoCliente?.tipo || campoFormulario?.tipo_campo || 'texto'),
    obrigatorio: campoCliente?.obrigatorio ?? campoFormulario?.obrigatorio ?? false,
    ativo: campoCliente?.ativo ?? campoFormulario?.ativo ?? true,
    somente_leitura: campoCliente?.somente_leitura ?? campoFormulario?.somente_leitura ?? false,
    opcoes_json: campoCliente?.opcoes_json || campoFormulario?.opcoes_json || campoFormulario?.opcoes || null,
    ordem: Number(campoCliente?.ordem ?? campoFormulario?.ordem ?? 0),
    largura: campoFormulario?.largura || campoCliente?.largura || '50',
    ajuda: campoFormulario?.ajuda || campoCliente?.ajuda || '',
    placeholder: campoFormulario?.placeholder || campoCliente?.placeholder || '',
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

async function carregarFormularioPadraoClientes({ loadingContainer = null } = {}) {
  // Faz uma checagem leve de versão. Se a estrutura não mudou, vem do cache.
  // Se criou/editou campo no construtor, a versão muda e baixa a ficha nova.
  if (window.ValoraFichaPrincipal?.carregarFormularioModulo) {
    return carregarFormularioClientes({ loadingContainer });
  }

  if (state.formularioClientes?.modelo) {
    return state.formularioClientes;
  }

  return carregarFormularioClientes({ loadingContainer });
}

function montarSecoesPeloFormulario(formulario, camposClientes = []) {
  const { bySlug, byNome } = indexarCamposClientes(camposClientes);
  const usados = new Set();
  const secoes = [];

  const formSecoes = Array.isArray(formulario?.secoes) ? formulario.secoes : [];

  formSecoes.forEach((secao) => {
    if (secao?.ativo === false) return;

    const campos = [];
    const camposFormulario = Array.isArray(secao.campos) ? secao.campos : [];

    camposFormulario
      .filter((campo) => campo?.ativo !== false)
      .filter((campo) => String(campo?.origem || 'personalizado') !== 'visual')
      .sort(
        (a, b) =>
          Number(a.ordem || 0) - Number(b.ordem || 0) ||
          Number(a.id || 0) - Number(b.id || 0)
      )
      .forEach((campoFormulario) => {
        const label =
          campoFormulario?.label ||
          campoFormulario?.nome ||
          campoFormulario?.campo_sistema ||
          '';

        const slug = campoFormulario?.campo_sistema || slugify(label);

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

  if (extras.length && !state.usarFichaPrincipalClientes) {
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

function getCampoClass(campo) {
  const largura = String(campo?.largura || '50').replace('%', '');
  const tipo = normalizarTipo(campo?.tipo);

  if (tipo === 'textarea' || largura === '100') return 'span-all';
  if (largura === '50') return '';
  if (largura === '25' || largura === '33') return '';

  return '';
}

function renderInputCampo(campo, values = {}) {
  const slug = campo.slug;
  const id = `custom-field-${slug}`;
  const label = campo.nome || slug;
  const tipo = normalizarTipo(campo.tipo);
  const valor = values?.[slug] ?? '';
  const required = campo.obrigatorio ? ' *' : '';
  const placeholder = campo.placeholder || '';
  const disabled = campo.somente_leitura ? 'disabled' : '';
  const fieldClass = getCampoClass(campo);

  let html = `<div class="form-group custom-field-item ${fieldClass}">`;

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
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          ${checked}
          ${disabled}
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
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          rows="3"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        >${escapeHtml(valor)}</textarea>
      `;
    } else if (tipo === 'numero') {
      html += `
        <input
          type="number"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else if (tipo === 'data') {
      html += `
        <input
          type="date"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          ${disabled}
        />
      `;
    } else if (tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);

      html += `
        <select
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          ${disabled}
        >
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
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else if (tipo === 'telefone') {
      html += `
        <input
          type="tel"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
        />
      `;
    } else {
      html += `
        <input
          type="text"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          data-custom-label="${escapeHtml(label)}"
          data-required="${campo.obrigatorio ? 'true' : 'false'}"
          value="${escapeHtml(valor)}"
          placeholder="${escapeHtml(placeholder)}"
          ${disabled}
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

export async function renderCustomFieldsInputs(camposClientes, values = {}) {
  const container = document.getElementById('custom-fields-container');

  if (!container) return null;

  container.classList.add('custom-form-sections');
  container.classList.remove('custom-fields-grid');

  if (window.ValoraFichaPrincipal?.showLoading) {
    window.ValoraFichaPrincipal.showLoading(
      container,
      'Verificando ficha principal...',
      'Conferindo cache e banco de dados antes de montar os campos.'
    );
  } else {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        Carregando estrutura do formulário...
      </div>
    `;
  }

  try {
    const formulario = await carregarFormularioPadraoClientes({ loadingContainer: container });

    // Agora Clientes também usa o componente universal de ficha principal,
    // igual Fornecedores e Produtos. O código antigo fica só como fallback.
    if (window.ValoraFichaPrincipal?.renderCustomFormSections) {
      window.ValoraFichaPrincipal.renderCustomFormSections({
        container,
        formulario,
        camposAvulsos: camposClientes,
        values,
        usarFichaPrincipal: state.usarFichaPrincipalClientes,
        flatTitle: 'Campos personalizados',
        flatDescription: 'Campos extras do cadastro do cliente.',
        emptyMessage: formulario?.modelo
          ? 'Nenhum campo ativo neste formulário de clientes.'
          : 'Nenhum formulário de clientes encontrado. Crie um formulário em Configurações > Formulários.',
      });

      return formulario;
    }

    let secoes = [];

    if (formulario?.modelo) {
      secoes = montarSecoesPeloFormulario(formulario, camposClientes);
    }

    if (!secoes.length && !state.usarFichaPrincipalClientes) {
      secoes = montarSecoesFlat(camposClientes);
    }

    if (!secoes.length) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          Nenhum campo configurado para este formulário.
        </div>
      `;

      return formulario;
    }

    container.innerHTML = secoes.map((secao) => renderSecao(secao, values)).join('');

    return formulario;
  } catch (err) {
    console.warn('[Clientes] Não foi possível carregar seções do formulário:', err);

    state.formularioClientes = null;
    state.usarFichaPrincipalClientes = false;

    const secoes = montarSecoesFlat(camposClientes);

    container.innerHTML = secoes.length
      ? secoes.map((secao) => renderSecao(secao, values)).join('')
      : `
        <div class="empty-state" style="grid-column:1 / -1;">
          Nenhum campo personalizado cadastrado.
        </div>
      `;

    return null;
  }
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
  const domRequired = Array.from(document.querySelectorAll('[data-custom-field][data-required="true"]'));

  for (const el of domRequired) {
    const label = el.dataset.customLabel || el.dataset.customField || 'Campo obrigatório';

    if (el.type === 'checkbox') {
      if (!el.checked) {
        return {
          ok: false,
          message: `Preencha o campo obrigatório: ${label}`,
        };
      }

      continue;
    }

    if (String(el.value ?? '').trim() === '') {
      return {
        ok: false,
        message: `Preencha o campo obrigatório: ${label}`,
      };
    }
  }

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