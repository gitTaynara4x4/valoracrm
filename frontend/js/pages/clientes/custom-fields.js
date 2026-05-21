import { escapeHtml } from './utils.js';

function parseCampoOpcoes(campo) {
  if (!campo || !campo.opcoes_json) return [];
  try {
    const parsed = JSON.parse(campo.opcoes_json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function renderCustomFieldsInputs(camposClientes, values = {}) {
  const container = document.getElementById('custom-fields-container');
  if (!container) return;

  if (!Array.isArray(camposClientes) || !camposClientes.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1;">
        Nenhum campo personalizado cadastrado.
      </div>
    `;
    return;
  }

  const ativos = camposClientes.filter((c) => c.ativo !== false);

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
    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = campo.tipo || 'texto';
    const valor = values?.[slug] ?? '';

    const field = document.createElement('div');
    field.className = 'form-group';

    let html = `<label for="${id}">${escapeHtml(label)}${campo.obrigatorio ? ' *' : ''}</label>`;

    if (tipo === 'textarea') {
      html += `
        <textarea id="${id}" data-custom-field="${escapeHtml(slug)}" rows="3">
${escapeHtml(valor)}</textarea>
      `;
    } else if (tipo === 'numero') {
      html += `
        <input
          type="number"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
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
    } else if (tipo === 'checkbox') {
      const checked =
        String(valor).toLowerCase() === 'true' ||
        String(valor).toLowerCase() === 'sim' ||
        valor === true
          ? 'checked'
          : '';

      html = `
        <label class="custom-checkbox" style="margin-top:8px;">
          <input
            type="checkbox"
            id="${id}"
            data-custom-field="${escapeHtml(slug)}"
            ${checked}
          />
          <span>${escapeHtml(label)}</span>
        </label>
      `;
    } else if (tipo === 'select') {
      const opcoes = parseCampoOpcoes(campo);

      html += `
        <select
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          style="width:100%; height:42px; background:var(--bg); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text); padding:0 14px;"
        >
          <option value="">Selecione</option>
          ${opcoes
            .map(
              (opt) => `
                <option value="${escapeHtml(opt)}" ${String(valor) === String(opt) ? 'selected' : ''}>
                  ${escapeHtml(opt)}
                </option>
              `
            )
            .join('')}
        </select>
      `;
    } else {
      html += `
        <input
          type="text"
          id="${id}"
          data-custom-field="${escapeHtml(slug)}"
          value="${escapeHtml(valor)}"
        />
      `;
    }

    field.innerHTML = html;
    container.appendChild(field);
  });
}

export function normalizeCustomFieldsPayload() {
  const customFields = {};

  document.querySelectorAll('[data-custom-field]').forEach((el) => {
    const slug = el.getAttribute('data-custom-field');
    if (!slug) return;

    let value = '';

    if (el.type === 'checkbox') {
      value = el.checked ? 'true' : 'false';
    } else {
      value = String(el.value || '').trim();
    }

    if (value !== '') {
      customFields[slug] = value;
    }
  });

  return customFields;
}

export function validateRequiredCustomFields(camposClientes, payload) {
  const ativos = Array.isArray(camposClientes)
    ? camposClientes.filter((c) => c.ativo !== false)
    : [];

  for (const campo of ativos) {
    if (!campo.obrigatorio) continue;

    const valor = payload?.[campo.slug];

    if (campo.tipo === 'checkbox') {
      if (valor !== 'true') {
        return {
          ok: false,
          message: `O campo "${campo.nome}" é obrigatório.`,
        };
      }
      continue;
    }

    if (valor == null || String(valor).trim() === '') {
      return {
        ok: false,
        message: `O campo "${campo.nome}" é obrigatório.`,
      };
    }
  }

  return { ok: true };
}