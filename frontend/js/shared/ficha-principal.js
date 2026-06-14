// /frontend/js/shared/ficha-principal.js
// Componente universal da Ficha Principal do Valora CRM.
// Funciona com scripts tradicionais e também com páginas modularizadas via window.ValoraFichaPrincipal.
(function initValoraFichaPrincipal(global) {
  'use strict';

  const API_FORMULARIOS = '/api/formularios';

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

    if (!text || resp.status === 204) return null;

    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }





  const CACHE_PREFIX = 'valora:ficha-principal:v2';
  const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 24;

  function getCacheKey(modulo) {
    return `${CACHE_PREFIX}:${slugify(modulo)}`;
  }

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function readFormularioCache(modulo) {
    try {
      const raw = global.localStorage?.getItem(getCacheKey(modulo));
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.formulario?.modelo || !parsed.version) return null;

      const age = nowMs() - Number(parsed.savedAt || 0);
      if (Number.isFinite(age) && age > CACHE_MAX_AGE_MS) {
        global.localStorage?.removeItem(getCacheKey(modulo));
        return null;
      }

      return parsed;
    } catch (_) {
      return null;
    }
  }

  function writeFormularioCache(modulo, formulario, versionInfo = null) {
    try {
      const info = versionInfo || formulario?.cache_version || null;
      const modeloId = info?.modelo_id || formulario?.modelo?.id || null;
      const version = info?.version || formulario?.cache_version?.version || formulario?.modelo?.atualizado_em || null;

      if (!formulario?.modelo || !modeloId || !version) return;

      const payload = {
        modulo: slugify(modulo),
        modelo_id: Number(modeloId),
        version: String(version),
        versionInfo: info,
        formulario,
        savedAt: nowMs(),
      };

      global.localStorage?.setItem(getCacheKey(modulo), JSON.stringify(payload));
    } catch (_) {}
  }

  function clearFormularioCache(modulo = '') {
    try {
      if (modulo) {
        global.localStorage?.removeItem(getCacheKey(modulo));
        return;
      }

      const keys = [];
      for (let i = 0; i < (global.localStorage?.length || 0); i += 1) {
        const key = global.localStorage.key(i);
        if (key && key.startsWith(`${CACHE_PREFIX}:`)) keys.push(key);
      }
      keys.forEach((key) => global.localStorage.removeItem(key));
    } catch (_) {}
  }

  function sameVersion(cache, versionInfo) {
    if (!cache || !versionInfo || versionInfo.empty) return false;
    return (
      Number(cache.modelo_id) === Number(versionInfo.modelo_id) &&
      String(cache.version || '') === String(versionInfo.version || '')
    );
  }

  function attachCacheVersion(formulario, versionInfo) {
    if (!formulario || !versionInfo) return formulario;

    return {
      ...formulario,
      cache_version: versionInfo,
      modelo: {
        ...(formulario.modelo || {}),
        usar_como_ficha_principal:
          versionInfo.usar_como_ficha_principal ?? formulario.modelo?.usar_como_ficha_principal,
        padrao: versionInfo.padrao ?? formulario.modelo?.padrao,
      },
    };
  }


  function getElement(target) {
    return typeof target === 'string' ? document.querySelector(target) : target;
  }

  function showLoading(container, message = 'Carregando campos personalizados...', detail = 'Organizando as seções da ficha...') {
    const el = getElement(container);
    if (!el) return;

    el.classList.add('custom-form-sections', 'is-loading');
    el.classList.remove('form-row', 'is-ready');

    el.innerHTML = `
      <div class="ficha-loading-card" role="status" aria-live="polite">
        <div class="ficha-loading-head">
          <span class="ficha-loading-spinner" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(message)}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
        </div>

        <div class="ficha-loading-skeleton" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;
  }

  function showFichaStatus(container, message, detail) {
    if (!container) return;
    showLoading(container, message, detail);
  }

  function animateRenderedSections(container) {
    const el = getElement(container);
    if (!el) return;

    el.classList.remove('is-loading');
    el.classList.add('is-ready');

    const cards = Array.from(el.querySelectorAll('.custom-section-card'));
    cards.forEach((card, index) => {
      card.style.setProperty('--ficha-delay', `${Math.min(index * 55, 330)}ms`);
      card.classList.remove('is-mounted', 'is-section-active');
      void card.offsetWidth;
      card.classList.add('is-mounted');
    });

    const fields = Array.from(el.querySelectorAll('.custom-field-item, .custom-fields-grid > .form-group, .custom-fields-grid > .check-card'));
    fields.forEach((field, index) => {
      field.style.setProperty('--field-delay', `${Math.min(index * 22, 280)}ms`);
      field.classList.remove('is-field-mounted');
      void field.offsetWidth;
      field.classList.add('is-field-mounted');
    });
  }

  function parseCampoOpcoes(campo) {
    if (!campo) return [];

    const raw = campo.opcoes ?? campo.opcoes_json ?? campo.options ?? campo.opcoesJson ?? null;

    if (!raw) return [];

    if (Array.isArray(raw)) {
      return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
    }

    if (typeof raw === 'string') {
      const text = raw.trim();
      if (!text) return [];

      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
        }
      } catch (_) {}

      return text
        .split(/\n|,|;/)
        .map((x) => x.trim())
        .filter(Boolean);
    }

    return [];
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
      tel: 'telefone',
      moeda: 'moeda',
      money: 'moeda',
      percentual: 'percentual',
      percent: 'percentual',
    };

    return map[t] || 'texto';
  }

  function isVisualCampo(campo) {
    return String(campo?.origem || '').toLowerCase() === 'visual' || !!campo?.tipo_visual;
  }

  function ordenarPorOrdemId(items = []) {
    return [...items].sort((a, b) =>
      Number(a?.ordem || 0) - Number(b?.ordem || 0) ||
      Number(a?.id || 0) - Number(b?.id || 0)
    );
  }

  function getCampoSlug(campo) {
    return String(
      campo?.slug ||
      campo?.campo_personalizado_slug ||
      campo?.campo_sistema ||
      slugify(campo?.nome || campo?.label || '')
    ).trim();
  }

  function indexarCamposAvulsos(camposAvulsos = []) {
    const byId = new Map();
    const bySlug = new Map();
    const byNome = new Map();

    (camposAvulsos || []).forEach((campo) => {
      const id = campo?.id != null ? Number(campo.id) : null;
      const slug = getCampoSlug(campo);
      const nome = slugify(campo?.nome || campo?.label || '');

      if (id) byId.set(id, campo);
      if (slug) bySlug.set(slug, campo);
      if (nome) byNome.set(nome, campo);
    });

    return { byId, bySlug, byNome };
  }

  function montarCampoFinal(campoAvulso, campoFormulario = null) {
    const nome =
      campoAvulso?.nome ||
      campoFormulario?.label ||
      campoFormulario?.nome ||
      campoFormulario?.campo_sistema ||
      '';

    const slug =
      campoAvulso?.slug ||
      campoFormulario?.campo_personalizado_slug ||
      campoFormulario?.campo_sistema ||
      slugify(nome);

    if (!slug) return null;

    return {
      id: campoAvulso?.id || campoFormulario?.campo_personalizado_id || campoFormulario?.id || null,
      nome,
      slug,
      tipo: normalizarTipo(campoAvulso?.tipo || campoFormulario?.tipo_campo || campoFormulario?.tipo || 'texto'),
      obrigatorio: campoAvulso?.obrigatorio ?? campoFormulario?.obrigatorio ?? false,
      ativo: campoAvulso?.ativo ?? campoFormulario?.ativo ?? true,
      somente_leitura: campoAvulso?.somente_leitura ?? campoFormulario?.somente_leitura ?? false,
      opcoes_json: campoAvulso?.opcoes_json ?? campoFormulario?.opcoes_json ?? campoFormulario?.opcoes ?? null,
      ordem: Number(campoAvulso?.ordem ?? campoFormulario?.ordem ?? 0),
      largura: campoFormulario?.largura || campoAvulso?.largura || '50',
      ajuda: campoFormulario?.ajuda || campoAvulso?.ajuda || '',
      placeholder: campoFormulario?.placeholder || campoAvulso?.placeholder || '',
    };
  }

  function montarSecoesDoFormulario(formulario, camposAvulsos = [], { usarFichaPrincipal = false } = {}) {
    const index = indexarCamposAvulsos(camposAvulsos);
    const usados = new Set();
    const secoes = [];

    const formSecoes = Array.isArray(formulario?.secoes) ? ordenarPorOrdemId(formulario.secoes) : [];

    formSecoes.forEach((secao) => {
      if (secao?.ativo === false) return;

      const campos = [];
      const camposFormulario = Array.isArray(secao.campos) ? secao.campos : [];

      ordenarPorOrdemId(camposFormulario)
        .filter((campo) => campo?.ativo !== false)
        .filter((campo) => !isVisualCampo(campo))
        .forEach((campoFormulario) => {
          const label = campoFormulario?.label || campoFormulario?.nome || campoFormulario?.campo_sistema || '';
          const slug = campoFormulario?.campo_personalizado_slug || campoFormulario?.campo_sistema || slugify(label);
          const personalizadoId = campoFormulario?.campo_personalizado_id ? Number(campoFormulario.campo_personalizado_id) : null;

          const campoAvulso =
            (personalizadoId ? index.byId.get(personalizadoId) : null) ||
            index.bySlug.get(slug) ||
            index.byNome.get(slug) ||
            null;

          const campoFinal = montarCampoFinal(campoAvulso, campoFormulario);
          if (!campoFinal || campoFinal.ativo === false) return;

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

    const semSecao = Array.isArray(formulario?.campos_sem_secao) ? formulario.campos_sem_secao : [];
    const camposSemSecao = ordenarPorOrdemId(semSecao)
      .filter((campo) => campo?.ativo !== false)
      .filter((campo) => !isVisualCampo(campo))
      .map((campoFormulario) => montarCampoFinal(null, campoFormulario))
      .filter(Boolean)
      .filter((campo) => {
        if (usados.has(campo.slug)) return false;
        usados.add(campo.slug);
        return true;
      });

    if (camposSemSecao.length) {
      secoes.push({
        id: 'sem_secao',
        titulo: 'Outros campos',
        descricao: 'Campos sem seção definida no formulário.',
        ordem: 9998,
        campos: camposSemSecao,
      });
    }

    const extras = (camposAvulsos || [])
      .filter((campo) => campo?.ativo !== false)
      .map((campo) => montarCampoFinal(campo, null))
      .filter(Boolean)
      .filter((campo) => !usados.has(campo.slug))
      .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

    if (extras.length && !usarFichaPrincipal) {
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

  function montarSecoesFlat(camposAvulsos = [], { titulo = 'Campos personalizados', descricao = '' } = {}) {
    const campos = (camposAvulsos || [])
      .filter((campo) => campo?.ativo !== false)
      .map((campo) => montarCampoFinal(campo, null))
      .filter(Boolean)
      .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));

    if (!campos.length) return [];

    return [
      {
        id: 'flat',
        titulo,
        descricao,
        ordem: 1,
        campos,
      },
    ];
  }

  function getCampoClass(campo) {
    const largura = String(campo?.largura || '').replace('%', '').trim().toLowerCase();
    const tipo = normalizarTipo(campo?.tipo);
    const nome = slugify(campo?.nome || campo?.label || campo?.slug || '');

    // Layout estilo Bitrix: campos personalizados entram no mesmo grid dos campos do sistema.
    // Regra principal: todo campo comum mantém o mesmo tamanho. Só campos naturalmente longos
    // (textarea/observações/descrições) ocupam a linha inteira.
    const nomesLongos = ['observacao', 'observacoes', 'descricao', 'comentario', 'comentarios', 'detalhes', 'anotacoes'];
    const isNomeLongo = nomesLongos.some((item) => nome === item || nome.includes(item));

    if (tipo === 'textarea' || isNomeLongo) return 'span-all bitrix-field-full';

    // Mantém compatibilidade caso no futuro o construtor tenha tamanho explícito.
    // Porém, valores antigos como 100% não forçam mais todos os campos a ficarem gigantes.
    if (largura === 'full' || largura === 'linha' || largura === 'linha_inteira' || largura === 'inteiro') {
      return 'span-all bitrix-field-full';
    }

    if (largura === '2' || largura === 'half' || largura === 'metade') return 'span-2 bitrix-field-half';

    return 'bitrix-field-normal';
  }

  function getValorCampo(values = {}, campo) {
    const slug = campo?.slug;
    if (!slug) return '';

    if (values[slug] !== undefined && values[slug] !== null) return values[slug];

    const labelSlug = slugify(campo?.nome || '');
    if (labelSlug && values[labelSlug] !== undefined && values[labelSlug] !== null) return values[labelSlug];

    return '';
  }

  function renderInputCampo(campo, values = {}) {
    const slug = campo.slug;
    const id = `custom-field-${slug}`;
    const label = campo.nome || slug;
    const tipo = normalizarTipo(campo.tipo);
    const valor = getValorCampo(values, campo);
    const required = campo.obrigatorio ? ' *' : '';
    const placeholder = campo.placeholder || '';
    const disabled = campo.somente_leitura ? 'disabled' : '';
    const fieldClass = getCampoClass(campo);

    if (tipo === 'checkbox') {
      const checked =
        String(valor).toLowerCase() === 'true' ||
        String(valor).toLowerCase() === 'sim' ||
        valor === true
          ? 'checked'
          : '';

      return `
        <div class="form-group custom-field-item ${fieldClass}">
          <label class="custom-checkbox check-card">
            <input
              type="checkbox"
              id="${id}"
              data-custom-field="${escapeHtml(slug)}"
              data-custom-label="${escapeHtml(label)}"
              data-required="${campo.obrigatorio ? 'true' : 'false'}"
              ${checked}
              ${disabled}
            />
            <span>
              <strong>${escapeHtml(label)}${required}</strong>
              <small>${escapeHtml(campo.ajuda || 'Campo da ficha.')}</small>
            </span>
          </label>
        </div>
      `;
    }

    let html = `<div class="form-group custom-field-item ${fieldClass}">`;
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

    if (campo.ajuda && tipo !== 'checkbox') {
      html += `<small class="field-hint field-help">${escapeHtml(campo.ajuda)}</small>`;
    }

    html += '</div>';
    return html;
  }

  function renderSecao(secao, values = {}) {
    return `
      <article class="custom-section-card custom-section-card-bitrix">
        <div class="custom-section-head">
          <div class="custom-section-title">
            <span class="custom-section-icon"><i class="fa-solid fa-layer-group"></i></span>
            <div>
              <h4>${escapeHtml(secao.titulo || 'Seção')}</h4>
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

  async function carregarFormularioModulo(
    modulo,
    {
      apiJsonImpl = apiJson,
      ativo = true,
      useCache = true,
      forceRefresh = false,
      loadingContainer = null,
    } = {}
  ) {
    const moduloNorm = slugify(modulo);
    const ativoQuery = ativo ? 'true' : 'false';
    const cache = useCache && !forceRefresh ? readFormularioCache(moduloNorm) : null;

    showFichaStatus(
      loadingContainer,
      'Verificando ficha principal...',
      'Conferindo se os campos personalizados foram alterados.'
    );

    try {
      const versionInfo = await apiJsonImpl(
        `${API_FORMULARIOS}/modelos/principal/${encodeURIComponent(moduloNorm)}/versao?ativo=${ativoQuery}`
      );

      if (!versionInfo || versionInfo.empty || !versionInfo.modelo_id) {
        clearFormularioCache(moduloNorm);
        return null;
      }

      if (useCache && !forceRefresh && sameVersion(cache, versionInfo)) {
        showFichaStatus(
          loadingContainer,
          'Carregando ficha salva...',
          'A estrutura não mudou. Usando cache local para abrir mais rápido.'
        );
        return attachCacheVersion(cache.formulario, versionInfo);
      }

      showFichaStatus(
        loadingContainer,
        'Buscando campos personalizados no banco de dados...',
        'Atualizando a estrutura da ficha principal.'
      );

      const formulario = await apiJsonImpl(
        `${API_FORMULARIOS}/modelos/principal/${encodeURIComponent(moduloNorm)}?ativo=${ativoQuery}`
      );
      const completo = attachCacheVersion(formulario, formulario?.cache_version || versionInfo);
      writeFormularioCache(moduloNorm, completo, completo?.cache_version || versionInfo);
      return completo;
    } catch (err) {
      // Fallback seguro para instalações que ainda não têm as novas rotas.
      if (cache?.formulario?.modelo) {
        showFichaStatus(
          loadingContainer,
          'Carregando ficha salva...',
          'A API de versão não respondeu. Usando a última ficha salva no navegador.'
        );
        return cache.formulario;
      }

      showFichaStatus(
        loadingContainer,
        'Buscando campos personalizados no banco de dados...',
        'Carregando pela rota padrão de formulários.'
      );

      const query = `${API_FORMULARIOS}/modelos?modulo=${encodeURIComponent(moduloNorm)}${ativo ? '&ativo=true' : ''}`;
      const modelos = await apiJsonImpl(query);
      const lista = Array.isArray(modelos) ? modelos : [];

      if (!lista.length) return null;

      const modeloResumo =
        lista.find((modelo) => modelo.usar_como_ficha_principal) ||
        lista.find((modelo) => modelo.padrao) ||
        lista[0];

      if (!modeloResumo?.id) return null;

      const formulario = await apiJsonImpl(`${API_FORMULARIOS}/modelos/${modeloResumo.id}`);
      writeFormularioCache(moduloNorm, formulario, {
        modelo_id: formulario?.modelo?.id,
        version: formulario?.modelo?.atualizado_em || String(nowMs()),
        modulo: moduloNorm,
      });
      return formulario;
    }
  }

  async function atualizarFichaPrincipalModelo(modelo, enabled, { apiJsonImpl = apiJson, moduloFallback = '' } = {}) {
    if (!modelo?.id) {
      throw new Error('Nenhum formulário foi encontrado para alterar a ficha principal.');
    }

    const modulo = modelo.modulo || moduloFallback;
    const payload = {
      modulo,
      nome: modelo.nome,
      descricao: modelo.descricao || null,
      ativo: modelo.ativo !== false,
      padrao: !!modelo.padrao,
      usar_como_ficha_principal: !!enabled,
    };

    const atualizado = await apiJsonImpl(`${API_FORMULARIOS}/modelos/${modelo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    clearFormularioCache(modulo);
    return atualizado;
  }



  const LONG_FIELD_SELECTOR = 'textarea, input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="search"]';

  function isVisibleElement(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /*
   * Campos longos agora são tratados pelo componente global:
   * frontend/js/shared/campos-longos.js
   *
   * Mantemos estas funções aqui apenas para compatibilidade com os módulos
   * que chamam ValoraFichaPrincipal.enhanceLongFields() após renderizar campos.
   */
  function enhanceLongFields(root = document) {
    if (global.ValoraCamposLongos && typeof global.ValoraCamposLongos.enhance === 'function') {
      global.ValoraCamposLongos.enhance(root);
    }
  }

  function syncLongFieldUi(el, { showPreview = false } = {}) {
    if (global.ValoraCamposLongos && typeof global.ValoraCamposLongos.sync === 'function') {
      return global.ValoraCamposLongos.sync(el, { expand: !!showPreview });
    }
    return false;
  }

  function initLongFieldEvents() {
    // Eventos reais ficam no componente global campos-longos.js.
  }

  function renderCustomFormSections({
    container,
    formulario = null,
    camposAvulsos = [],
    values = {},
    usarFichaPrincipal = false,
    flatTitle = 'Campos personalizados',
    flatDescription = 'Campos extras do cadastro.',
    emptyMessage = 'Nenhum campo configurado para este formulário.',
  } = {}) {
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) return [];

    el.classList.add('custom-form-sections');
    el.classList.remove('form-row', 'is-loading');

    let secoes = [];

    if (formulario?.modelo) {
      secoes = montarSecoesDoFormulario(formulario, camposAvulsos, { usarFichaPrincipal });
    }

    if (!secoes.length && !usarFichaPrincipal) {
      secoes = montarSecoesFlat(camposAvulsos, {
        titulo: flatTitle,
        descricao: flatDescription,
      });
    }

    el.dataset.customSectionsCount = String(secoes.length || 0);

    if (!secoes.length) {
      el.innerHTML = `
        <div class="empty-state" style="grid-column:1 / -1;">
          ${escapeHtml(emptyMessage)}
        </div>
      `;
      animateRenderedSections(el);
      return [];
    }

    el.innerHTML = secoes.map((secao) => renderSecao(secao, values)).join('');
    animateRenderedSections(el);
    enhanceLongFields(el);
    if (global.ValoraRequired && typeof global.ValoraRequired.refresh === 'function') {
      global.ValoraRequired.refresh(el);
    }
    return secoes;
  }

  function collectCustomFieldsValues(root = document) {
    const out = {};

    root.querySelectorAll('[data-custom-field]').forEach((el) => {
      const slug = String(el.getAttribute('data-custom-field') || '').trim();
      if (!slug) return;

      if (el.type === 'checkbox') {
        out[slug] = el.checked ? 'true' : 'false';
        return;
      }

      const value = String(el.value ?? '').trim();
      if (value !== '') out[slug] = value;
    });

    return out;
  }

  function validateRequiredRenderedFields({ root = document, toast = null, switchToCustomTab = null } = {}) {
    const required = Array.from(root.querySelectorAll('[data-custom-field][data-required="true"]'));

    for (const el of required) {
      const label = el.dataset.customLabel || el.dataset.customField || 'Campo obrigatório';
      const invalid = el.type === 'checkbox' ? !el.checked : String(el.value ?? '').trim() === '';

      if (!invalid) continue;

      if (typeof switchToCustomTab === 'function') switchToCustomTab();
      if (typeof toast === 'function') toast(`Preencha o campo obrigatório: ${label}`, 'error');
      try { el.focus(); } catch (_) {}
      return false;
    }

    return true;
  }

  function getSectionTitleFromCard(card, index) {
    const raw =
      card.querySelector('.custom-section-head h4')?.textContent ||
      card.querySelector('h4')?.textContent ||
      `Seção ${index + 1}`;

    return String(raw).replace(/\s+/g, ' ').trim();
  }

  function createTabFichaController({
    formSelector,
    tabsSelector,
    tabButtonSelector,
    tabPanelSelector,
    customTabId,
    customContainerSelector,
    codeCardSelector,
    toggleSelector,
    normalTabId,
    modeClass = 'is-ficha-principal',
    sectionButtonClass = 'ficha-section-tab-btn',
    buttonClass = '',
    onSectionChange = null,
  } = {}) {
    let originalTabsHtml = '';

    const q = (selector) => selector ? document.querySelector(selector) : null;
    const qa = (selector) => selector ? Array.from(document.querySelectorAll(selector)) : [];

    function showOnlyCustomTab() {
      qa(tabPanelSelector).forEach((tab) => {
        const isCustom = tab.id === customTabId;
        tab.classList.toggle('active', isCustom);
        tab.style.display = isCustom ? 'block' : 'none';
      });
    }

    function showAllTabs() {
      qa(tabPanelSelector).forEach((tab) => {
        tab.style.display = '';
      });
    }

    function showAllSections() {
      const container = q(customContainerSelector);
      if (!container) return;

      container.querySelectorAll('.custom-section-card').forEach((card) => {
        card.style.display = '';
      });
    }

    function activateSection(index = 0) {
      const container = q(customContainerSelector);
      if (!container) return;

      const cards = Array.from(container.querySelectorAll('.custom-section-card'));
      const buttons = qa(`${tabsSelector} [data-ficha-section]`);

      if (!cards.length) return;

      cards.forEach((card, cardIndex) => {
        const active = cardIndex === Number(index);
        card.classList.remove('is-section-active');
        card.style.display = active ? 'block' : 'none';

        if (active) {
          void card.offsetWidth;
          card.classList.add('is-section-active');
        }
      });

      buttons.forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.fichaSection) === Number(index));
      });

      if (typeof onSectionChange === 'function') onSectionChange(Number(index));
    }

    function mountSectionTabs() {
      const tabs = q(tabsSelector);
      const container = q(customContainerSelector);
      if (!tabs || !container) return;

      tabs.style.display = '';
      const cards = Array.from(container.querySelectorAll('.custom-section-card'));

      if (!cards.length) {
        tabs.innerHTML = `
          <button type="button" class="${escapeHtml(buttonClass || sectionButtonClass)} active" data-ficha-section="0">
            Campos do formulário
          </button>
        `;
        return;
      }

      tabs.innerHTML = cards
        .map((card, index) => `
          <button
            type="button"
            class="${escapeHtml(buttonClass || sectionButtonClass)} ${index === 0 ? 'active' : ''}"
            data-ficha-section="${index}"
          >
            ${escapeHtml(getSectionTitleFromCard(card, index))}
          </button>
        `)
        .join('');
    }

    function switchTab(targetId) {
      qa(tabButtonSelector).forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === targetId);
      });

      qa(tabPanelSelector).forEach((tab) => {
        tab.classList.toggle('active', tab.id === targetId);
      });
    }

    function setMode(enabled) {
      const form = q(formSelector);
      const tabs = q(tabsSelector);
      const codeCard = q(codeCardSelector);
      const toggle = q(toggleSelector);

      if (form) {
        form.classList.toggle(modeClass, !!enabled);
        form.classList.remove('is-ficha-entering', 'is-ficha-leaving');
        void form.offsetWidth;
        form.classList.add(enabled ? 'is-ficha-entering' : 'is-ficha-leaving');
        window.setTimeout(() => {
          form.classList.remove('is-ficha-entering', 'is-ficha-leaving');
        }, 420);
      }
      if (codeCard) codeCard.hidden = !enabled;
      if (toggle) toggle.checked = !!enabled;

      if (!tabs) return;

      if (!originalTabsHtml) {
        originalTabsHtml = tabs.innerHTML;
      }

      if (enabled) {
        showOnlyCustomTab();
        mountSectionTabs();
        activateSection(0);
        return;
      }

      tabs.innerHTML = originalTabsHtml;
      tabs.style.display = '';
      showAllTabs();
      showAllSections();
      switchTab(normalTabId);
    }

    function bindSectionClicks() {
      document.addEventListener('click', (event) => {
        const btn = event.target.closest(`${tabsSelector} [data-ficha-section]`);
        if (!btn) return;
        activateSection(btn.dataset.fichaSection);
      });
    }

    return {
      setMode,
      switchTab,
      activateSection,
      mountSectionTabs,
      bindSectionClicks,
    };
  }

  global.ValoraFichaPrincipal = {
    API_FORMULARIOS,
    slugify,
    escapeHtml,
    apiJson,
    parseCampoOpcoes,
    normalizarTipo,
    carregarFormularioModulo,
    clearFormularioCache,
    readFormularioCache,
    writeFormularioCache,
    atualizarFichaPrincipalModelo,
    renderCustomFormSections,
    collectCustomFieldsValues,
    validateRequiredRenderedFields,
    showLoading,
    animateRenderedSections,
    createTabFichaController,
    enhanceLongFields,
    syncLongFieldUi,
  };

  initLongFieldEvents();
})(window);
