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

/* =========================================
   ÍCONES DAS SEÇÕES
   Regra profissional:
   1. Usa secao.icone salvo no banco
   2. Se não tiver, usa fallback pelo título
   ========================================= */

const ICONES_NATIVOS_CLIENTE = {
  cadastro: 'fa-id-card',
  dados: 'fa-id-card',
  principal: 'fa-id-card',
  basico: 'fa-id-card',
  contato: 'fa-address-book',
  contatos: 'fa-address-book',
  endereco: 'fa-house',
  enderecos: 'fa-house',
  comercial: 'fa-briefcase',
  personalizado: 'fa-sliders',
  personalizados: 'fa-sliders',
  campos: 'fa-sliders',
  adicionais: 'fa-folder-open',
  ocorrencias: 'fa-clipboard-list',
  ocorrencia: 'fa-clipboard-list',
  anexos: 'fa-paperclip',
  anexo: 'fa-paperclip',
  historico: 'fa-clock-rotate-left',
};

function normalizarTextoIcone(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarIconeSecao(icone) {
  let value = String(icone || '').trim();

  if (!value) return '';

  value = value
    .replaceAll('fa-solid', '')
    .replaceAll('fas', '')
    .replaceAll('far', '')
    .replaceAll('fa-regular', '')
    .replaceAll('fa-light', '')
    .replaceAll('fa-duotone', '')
    .trim();

  if (!value.startsWith('fa-')) return '';

  const valido = /^[a-zA-Z0-9_-]+$/.test(value) && value.length <= 80;

  return valido ? value : '';
}

function getSectionIconByTitle(titulo = '') {
  const t = normalizarTextoIcone(titulo);

  if (!t) return 'fa-layer-group';

  if (
    t.includes('dados basicos') ||
    t.includes('basico') ||
    t.includes('identificacao') ||
    t.includes('cadastro') ||
    t.includes('principal')
  ) {
    return 'fa-id-card';
  }

  if (
    t.includes('imovel') ||
    t.includes('endereco') ||
    t.includes('residencia') ||
    t.includes('casa') ||
    t.includes('local')
  ) {
    return 'fa-house';
  }

  if (
    t.includes('titular responsavel') ||
    t.includes('responsavel legal') ||
    t.includes('responsavel') ||
    t.includes('titular')
  ) {
    return 'fa-user-shield';
  }

  if (
    t.includes('pessoa juridica') ||
    t.includes('cnpj') ||
    t.includes('empresa') ||
    t.includes('juridica')
  ) {
    return 'fa-building';
  }

  if (
    t.includes('administrativo') ||
    t.includes('gerencia') ||
    t.includes('gerente') ||
    t.includes('administracao')
  ) {
    return 'fa-user-gear';
  }

  if (
    t.includes('financeiro') ||
    t.includes('cobranca') ||
    t.includes('pagamento') ||
    t.includes('boleto') ||
    t.includes('pix') ||
    t.includes('cartao')
  ) {
    return 'fa-wallet';
  }

  if (
    t.includes('redes sociais') ||
    t.includes('rede social') ||
    t.includes('social') ||
    t.includes('instagram') ||
    t.includes('facebook') ||
    t.includes('linkedin') ||
    t.includes('site')
  ) {
    return 'fa-share-nodes';
  }

  if (
    t.includes('contrato') ||
    t.includes('contratos') ||
    t.includes('emissao') ||
    t.includes('assinatura')
  ) {
    return 'fa-file-signature';
  }

  if (
    t.includes('legal') ||
    t.includes('legais') ||
    t.includes('juridico') ||
    t.includes('lgpd') ||
    t.includes('documento')
  ) {
    return 'fa-scale-balanced';
  }

  if (
    t.includes('classificacao') ||
    t.includes('categoria') ||
    t.includes('segmento') ||
    t.includes('tipo')
  ) {
    return 'fa-tags';
  }

  if (
    t.includes('comercial') ||
    t.includes('venda') ||
    t.includes('negociacao')
  ) {
    return 'fa-briefcase';
  }

  if (
    t.includes('contato') ||
    t.includes('telefone') ||
    t.includes('whatsapp') ||
    t.includes('email')
  ) {
    return 'fa-address-book';
  }

  if (
    t.includes('ocorrencia') ||
    t.includes('historico') ||
    t.includes('registro')
  ) {
    return 'fa-clipboard-list';
  }

  if (
    t.includes('anexo') ||
    t.includes('arquivo')
  ) {
    return 'fa-paperclip';
  }

  if (
    t.includes('campo') ||
    t.includes('personalizado')
  ) {
    return 'fa-sliders';
  }

  return 'fa-layer-group';
}

function getSectionIcon(secaoOuTitulo = '') {
  if (typeof secaoOuTitulo === 'object' && secaoOuTitulo !== null) {
    const iconBanco = normalizarIconeSecao(secaoOuTitulo.icone);

    if (iconBanco) return iconBanco;

    return getSectionIconByTitle(secaoOuTitulo.titulo || secaoOuTitulo.nome || '');
  }

  return getSectionIconByTitle(secaoOuTitulo);
}

function montarMapaIconesFormulario(formulario) {
  const mapa = new Map();

  const secoes = Array.isArray(formulario?.secoes) ? formulario.secoes : [];

  secoes.forEach((secao) => {
    const titulo = secao?.titulo || '';
    const key = normalizarTextoIcone(titulo);
    const icon = getSectionIcon(secao);

    if (key) mapa.set(key, icon);

    if (secao?.id != null) {
      mapa.set(`id:${secao.id}`, icon);
    }
  });

  return mapa;
}

function getIconePorTextoOuMapa(texto, mapa = new Map()) {
  const key = normalizarTextoIcone(texto);

  if (!key) return 'fa-layer-group';

  if (mapa.has(key)) return mapa.get(key);

  for (const [mapKey, icon] of mapa.entries()) {
    if (mapKey.startsWith('id:')) continue;

    if (key.includes(mapKey) || mapKey.includes(key)) {
      return icon;
    }
  }

  const primeiraPalavra = key.split(' ')[0];

  if (ICONES_NATIVOS_CLIENTE[primeiraPalavra]) {
    return ICONES_NATIVOS_CLIENTE[primeiraPalavra];
  }

  return getSectionIconByTitle(texto);
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
        icone: getSectionIcon(secao),
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
      icone: 'fa-layer-group',
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
      icone: 'fa-sliders',
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
  const titulo = secao.titulo || 'Seção';
  const icon = getSectionIcon(secao);
  const sectionId = secao.id != null ? String(secao.id) : '';

  return `
    <article
      class="custom-section-card"
      data-custom-section-id="${escapeHtml(sectionId)}"
      data-custom-section-title="${escapeHtml(titulo)}"
      data-custom-section-icon="${escapeHtml(icon)}"
    >
      <div class="custom-section-head">
        <div class="custom-section-title">
          <span class="custom-section-icon">
            <i class="fa-solid ${escapeHtml(icon)}"></i>
          </span>

          <div>
            <h4>${escapeHtml(titulo)}</h4>
            ${secao.descricao ? `<p>${escapeHtml(secao.descricao)}</p>` : ''}
          </div>
        </div>
      </div>

      <div class="custom-fields-grid">
        ${(secao.campos || []).map((campo) => renderInputCampo(campo, values)).join('')}
      </div>
    </article>
  `;
}

function aplicarIconesNasSecoesRenderizadas(container, formulario = null) {
  if (!container) return;

  const mapa = montarMapaIconesFormulario(formulario);
  const cards = container.querySelectorAll('.custom-section-card');

  cards.forEach((card) => {
    const titleEl = card.querySelector('h4');
    const title = titleEl?.textContent || card.dataset.customSectionTitle || '';
    const id = card.dataset.customSectionId || '';
    const iconData = normalizarIconeSecao(card.dataset.customSectionIcon);

    const icon =
      iconData ||
      (id && mapa.get(`id:${id}`)) ||
      getIconePorTextoOuMapa(title, mapa);

    let iconWrap = card.querySelector('.custom-section-icon');

    const head = card.querySelector('.custom-section-head');
    const titleWrap = card.querySelector('.custom-section-title');

    if (!iconWrap) {
      iconWrap = document.createElement('span');
      iconWrap.className = 'custom-section-icon';

      if (titleWrap) {
        titleWrap.prepend(iconWrap);
      } else if (head) {
        const newWrap = document.createElement('div');
        newWrap.className = 'custom-section-title';

        while (head.firstChild) {
          newWrap.appendChild(head.firstChild);
        }

        head.appendChild(newWrap);
        newWrap.prepend(iconWrap);
      }
    }

    if (iconWrap) {
      iconWrap.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    }

    card.dataset.customSectionIcon = icon;
  });

  const heads = container.querySelectorAll('.custom-section-head');

  heads.forEach((head) => {
    const card = head.closest('.custom-section-card');
    if (card) return;

    const titleEl = head.querySelector('h4');
    if (!titleEl) return;

    const title = titleEl.textContent || '';
    const icon = getIconePorTextoOuMapa(title, mapa);

    let iconWrap = head.querySelector('.custom-section-icon');

    if (!iconWrap) {
      iconWrap = document.createElement('span');
      iconWrap.className = 'custom-section-icon';

      const titleContainer = head.querySelector('.custom-section-title');

      if (titleContainer) {
        titleContainer.prepend(iconWrap);
      } else {
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-section-title';

        while (head.firstChild) {
          wrapper.appendChild(head.firstChild);
        }

        head.appendChild(wrapper);
        wrapper.prepend(iconWrap);
      }
    }

    iconWrap.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  });
}

function aplicarIconesSidebarFichaPrincipal(formulario = null) {
  const mapa = montarMapaIconesFormulario(formulario);

  const navs = document.querySelectorAll(
    '.cliente-sidebar-nav, .cliente-tabs-sidebar, .ficha-principal-sidebar, .cliente-modal-sidebar'
  );

  navs.forEach((nav) => {
    const buttons = nav.querySelectorAll(
      '.cliente-tab-btn, [data-tab], [data-cliente-tab], button'
    );

    buttons.forEach((btn) => {
      if (btn.classList.contains('icon-btn')) return;
      if (btn.dataset.iconReady === 'true') return;

      const rawTab =
        btn.dataset.tab ||
        btn.dataset.clienteTab ||
        btn.dataset.target ||
        btn.getAttribute('aria-controls') ||
        '';

      const text = String(btn.textContent || '').trim();

      const keyTab = normalizarTextoIcone(rawTab);
      const keyText = normalizarTextoIcone(text);

      let icon = '';

      if (keyTab && ICONES_NATIVOS_CLIENTE[keyTab]) {
        icon = ICONES_NATIVOS_CLIENTE[keyTab];
      }

      if (!icon && keyText && ICONES_NATIVOS_CLIENTE[keyText]) {
        icon = ICONES_NATIVOS_CLIENTE[keyText];
      }

      if (!icon) {
        icon = getIconePorTextoOuMapa(text || rawTab, mapa);
      }

      let iconWrap = btn.querySelector('.cliente-tab-icon');

      if (!iconWrap) {
        iconWrap = document.createElement('span');
        iconWrap.className = 'cliente-tab-icon';
        iconWrap.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        btn.prepend(iconWrap);
      } else {
        iconWrap.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      }

      btn.dataset.iconReady = 'true';
    });
  });
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

      aplicarIconesNasSecoesRenderizadas(container, formulario);
      aplicarIconesSidebarFichaPrincipal(formulario);

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

      aplicarIconesSidebarFichaPrincipal(formulario);

      return formulario;
    }

    container.innerHTML = secoes.map((secao) => renderSecao(secao, values)).join('');

    aplicarIconesNasSecoesRenderizadas(container, formulario);
    aplicarIconesSidebarFichaPrincipal(formulario);

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

    aplicarIconesNasSecoesRenderizadas(container, null);
    aplicarIconesSidebarFichaPrincipal(null);

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