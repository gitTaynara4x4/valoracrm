// /frontend/js/shared/validacao.js
// Validação global profissional do Valora CRM.
// - Asterisco padronizado nos obrigatórios
// - Erro inline por campo
// - Resumo no topo do formulário/modal
// - Foco e scroll automático no primeiro erro
// - Funciona com campos do sistema e campos personalizados (data-required="true")
(function initValoraRequired(global) {
  'use strict';

  const FIELD_SELECTOR = [
    'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="hidden"])',
    'select',
    'textarea',
  ].join(',');

  const SAVE_BUTTON_SELECTOR = [
    '[data-valora-submit]',
    '#btn-salvar-cliente',
    '#btn-salvar-fornecedor',
    '#btn-salvar-produto',
    '#btn-salvar-proposta',
    '#btn-salvar-dados',
    '#btn-salvar-contato',
    '#btn-salvar-usuario',
    '#btn-enviar-bug',
    '#btnSalvarEmpresa',
    '#btnSalvarPerfil',
    '#btnSalvarSenha',
    '#btn-cadastrar',
    '#btn-login',
  ].join(',');

  function qsa(root, selector) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function isElementVisible(el) {
    if (!el || el.hidden) return false;
    if (el.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;

    const style = global.getComputedStyle ? global.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function isDisabled(el) {
    return !!(
      !el ||
      el.disabled ||
      el.readOnly ||
      el.closest('fieldset[disabled]') ||
      el.getAttribute('aria-disabled') === 'true'
    );
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function getFieldWrapper(el) {
    return (
      el.closest('.form-group, .input-group, .custom-field-item, .field-group, .form-field, .valora-field-wrapper') ||
      el.closest('label.check-card, label.custom-checkbox') ||
      el.parentElement
    );
  }

  function labelHasRequiredStar(label) {
    if (!label) return false;
    const text = String(label.textContent || '').replace(/\s+/g, ' ').trim();
    return /\*$/.test(text) || label.querySelector('.valora-required-mark');
  }

  function getLabelForField(el) {
    if (!el) return null;

    const id = el.id;
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit) return explicit;
    }

    const wrapper = getFieldWrapper(el);
    return wrapper?.querySelector(':scope > label, label') || el.closest('label') || null;
  }

  function getFieldLabelText(el) {
    const dataLabel = el.getAttribute('data-custom-label') || el.getAttribute('data-label') || el.getAttribute('aria-label');
    if (dataLabel) return String(dataLabel).trim();

    const label = getLabelForField(el);
    if (label) {
      const clone = label.cloneNode(true);
      clone.querySelectorAll('.valora-required-mark, .valora-field-error').forEach((x) => x.remove());
      const text = String(clone.textContent || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
      if (text) return text;
    }

    return el.name || el.id || 'Campo obrigatório';
  }

  function inferRequiredFromLabel(el) {
    const label = getLabelForField(el);
    return labelHasRequiredStar(label);
  }

  function isRequiredField(el) {
    if (!el || isDisabled(el)) return false;

    return (
      el.required ||
      el.getAttribute('aria-required') === 'true' ||
      el.getAttribute('data-required') === 'true' ||
      el.getAttribute('data-valora-required') === 'true' ||
      inferRequiredFromLabel(el)
    );
  }

  function isEmptyField(el) {
    if (!el) return false;

    const type = String(el.type || '').toLowerCase();

    if (type === 'checkbox' || type === 'radio') {
      if (type === 'radio' && el.name) {
        const form = el.form || document;
        return !form.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`);
      }
      return !el.checked;
    }

    if (el.tagName === 'SELECT') {
      return String(el.value ?? '').trim() === '';
    }

    return String(el.value ?? '').trim() === '';
  }

  function ensureRequiredMarker(el) {
    if (!isRequiredField(el)) return;

    const wrapper = getFieldWrapper(el);
    if (wrapper) wrapper.classList.add('is-required');

    const label = getLabelForField(el);
    if (!label) return;

    label.classList.add('valora-required-label');

    if (label.querySelector('.valora-required-mark')) return;

    // Remove apenas asterisco textual final para trocar pelo marcador padronizado.
    for (const node of Array.from(label.childNodes).reverse()) {
      if (node.nodeType === Node.TEXT_NODE && /\*\s*$/.test(node.textContent || '')) {
        node.textContent = String(node.textContent || '').replace(/\s*\*\s*$/, '');
        break;
      }
    }

    const mark = document.createElement('span');
    mark.className = 'valora-required-mark';
    mark.textContent = '*';

    const targetStrong = label.querySelector('strong');
    if (targetStrong) {
      targetStrong.appendChild(document.createTextNode(' '));
      targetStrong.appendChild(mark);
    } else {
      label.appendChild(document.createTextNode(' '));
      label.appendChild(mark);
    }
  }

  function getErrorContainer(el) {
    const wrapper = getFieldWrapper(el);
    if (!wrapper) return el.parentElement || el;

    if (wrapper.matches('label.check-card, label.custom-checkbox')) {
      return wrapper.parentElement || wrapper;
    }

    return wrapper;
  }

  function clearFieldError(el) {
    if (!el) return;

    el.classList.remove('valora-field-invalid', 'valora-field-shake', 'valora-first-invalid-field');
    el.removeAttribute('aria-invalid');

    const wrapper = getFieldWrapper(el);
    wrapper?.classList.remove('is-invalid', 'valora-field-shake', 'valora-first-invalid');

    const label = el.closest('label.check-card, label.custom-checkbox');
    label?.classList.remove('is-invalid', 'valora-first-invalid');

    const container = getErrorContainer(el);
    container?.querySelectorAll(':scope > .valora-field-error').forEach((x) => x.remove());
  }

  function markFieldError(el, message = 'Este campo é obrigatório.') {
    if (!el) return;

    ensureRequiredMarker(el);
    clearFieldError(el);

    const wrapper = getFieldWrapper(el);
    const label = el.closest('label.check-card, label.custom-checkbox');

    el.classList.add('valora-field-invalid');
    el.setAttribute('aria-invalid', 'true');

    wrapper?.classList.add('is-invalid', 'valora-field-shake');
    label?.classList.add('is-invalid');

    const container = getErrorContainer(el);
    if (container) {
      const error = document.createElement('div');
      error.className = 'valora-field-error';
      error.setAttribute('role', 'alert');
      error.textContent = message;
      container.appendChild(error);
    }

    setTimeout(() => wrapper?.classList.remove('valora-field-shake'), 280);
  }

  function highlightFirstInvalidField(el) {
    if (!el) return;

    const wrapper = getFieldWrapper(el);
    const label = el.closest('label.check-card, label.custom-checkbox');

    qsa(document, '.valora-first-invalid').forEach((node) => node.classList.remove('valora-first-invalid'));
    qsa(document, '.valora-first-invalid-field').forEach((node) => node.classList.remove('valora-first-invalid-field'));

    wrapper?.classList.add('valora-first-invalid');
    label?.classList.add('valora-first-invalid');
    el.classList.add('valora-first-invalid-field');
  }

  function clearSummary(root) {
    const container = getSummaryHost(root);
    container?.querySelectorAll(':scope > .valora-validation-summary').forEach((x) => x.remove());
  }

  function getSummaryHost(root) {
    if (!root) return null;
    if (root.tagName === 'FORM') return root;

    const form = root.querySelector('form');
    if (form) return form;

    return root.querySelector('.modal-body, .panel-card, main') || root;
  }

  function showSummary(root, count) {
    const host = getSummaryHost(root);
    if (!host) return;

    clearSummary(root);

    const summary = document.createElement('div');
    summary.className = 'valora-validation-summary';
    summary.setAttribute('role', 'alert');
    summary.innerHTML = `
      <span class="valora-summary-icon" aria-hidden="true">!</span>
      <div>
        <strong>Preencha os campos obrigatórios para continuar.</strong>
        <span>${count === 1 ? 'Encontramos 1 campo obrigatório pendente.' : `Encontramos ${count} campos obrigatórios pendentes.`}</span>
      </div>
    `;

    host.insertBefore(summary, host.firstElementChild || null);
  }

  function collectRequiredFields(root = document, { visibleOnly = true } = {}) {
    return qsa(root, FIELD_SELECTOR).filter((el) => {
      if (isDisabled(el)) return false;
      if (visibleOnly && !isElementVisible(el)) return false;
      return isRequiredField(el);
    });
  }

  function refresh(root = document) {
    collectRequiredFields(root, { visibleOnly: false }).forEach(ensureRequiredMarker);
  }

  function validate(root = document, options = {}) {
    const opts = {
      visibleOnly: true,
      showSummary: true,
      focus: true,
      scroll: true,
      ...options,
    };

    const target = root || document;
    const fields = collectRequiredFields(target, { visibleOnly: opts.visibleOnly });
    const invalids = [];

    clearSummary(target);

    fields.forEach((el) => {
      clearFieldError(el);
      ensureRequiredMarker(el);

      if (isEmptyField(el)) {
        const label = getFieldLabelText(el);
        invalids.push(el);
        markFieldError(el, `Informe ${label}.`);
      }
    });

    if (!invalids.length) return { ok: true, invalids: [] };

    if (opts.showSummary) showSummary(target, invalids.length);

    const first = invalids[0];
    highlightFirstInvalidField(first);

    if (opts.scroll) {
      const wrapper = getFieldWrapper(first) || first;
      try {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {
        wrapper.scrollIntoView();
      }
    }

    if (opts.focus) {
      setTimeout(() => {
        try { first.focus({ preventScroll: true }); } catch (_) { try { first.focus(); } catch (__) {} }
      }, 180);
    }

    return { ok: false, invalids };
  }

  function findRootForButton(button) {
    if (!button) return null;

    const formId = button.getAttribute('form');
    if (formId) {
      const form = document.getElementById(formId);
      if (form) return form;
    }

    const directForm = button.closest('form');
    if (directForm) return directForm;

    const modal = button.closest('.modal-content, .modal, .modal-overlay, .drawer, .panel-card, main');
    if (modal) {
      const form = modal.querySelector('form');
      if (form) return form;
      return modal;
    }

    return document;
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!form || form.dataset?.skipValoraValidation === 'true') return;
    if (!(form instanceof HTMLFormElement)) return;

    refresh(form);
    const result = validate(form);

    if (!result.ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleClick(event) {
    const button = event.target?.closest?.(SAVE_BUTTON_SELECTOR);
    if (!button || button.dataset?.skipValoraValidation === 'true') return;

    const root = findRootForButton(button);
    if (!root) return;

    refresh(root);
    const result = validate(root);

    if (!result.ok) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function handleInput(event) {
    const el = event.target;
    if (!el || !el.matches?.(FIELD_SELECTOR)) return;
    if (!isRequiredField(el)) return;

    ensureRequiredMarker(el);

    if (!isEmptyField(el)) {
      clearFieldError(el);
      const root = el.closest('form, .modal-content, main') || document;
      const stillInvalid = qsa(root, '.is-invalid, .valora-field-invalid').length;
      if (!stillInvalid) clearSummary(root);
    }
  }

  function observeDynamicFields() {
    if (!global.MutationObserver) return;

    const observer = new MutationObserver((mutations) => {
      let shouldRefresh = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes && mutation.addedNodes.length) {
          shouldRefresh = true;
          break;
        }
      }
      if (shouldRefresh) refresh(document);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    document.querySelectorAll('form').forEach((form) => {
      if (form.dataset.skipValoraValidation !== 'true') form.setAttribute('novalidate', 'novalidate');
    });

    refresh(document);
    observeDynamicFields();

    document.addEventListener('submit', handleSubmit, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleInput, true);
  }

  global.ValoraRequired = {
    init,
    refresh,
    validate,
    validateContainer: validate,
    clearFieldError,
    markFieldError,
    collectRequiredFields,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
