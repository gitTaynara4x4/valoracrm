(function (global) {
  'use strict';

  const VERSION = '20260614-global-inline';
  const TEXT_INPUT_SELECTOR = [
    'input:not([type])',
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    'input[type="url"]',
    'input[type="search"]'
  ].join(',');
  const TEXTAREA_SELECTOR = 'textarea';
  const FIELD_SELECTOR = `${TEXT_INPUT_SELECTOR}, ${TEXTAREA_SELECTOR}`;
  const cssEscape = global.CSS && typeof global.CSS.escape === 'function'
    ? global.CSS.escape
    : (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const IGNORE_SELECTOR = [
    '.valora-campo-longo-editor',
    '[data-no-long-field="true"]',
    '[data-campo-longo-ignore="true"]'
  ].join(',');

  function isElementVisible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const style = global.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) !== 0;
  }

  function getValue(el) {
    return String(el && el.value != null ? el.value : '').trim();
  }

  function isIgnored(el) {
    if (!el || !el.matches) return true;
    if (el.matches(IGNORE_SELECTOR)) return true;
    const type = String(el.getAttribute('type') || '').toLowerCase();
    return ['hidden', 'password', 'file', 'checkbox', 'radio', 'date', 'datetime-local', 'time', 'month', 'week', 'color', 'range'].includes(type);
  }

  function isTextInput(el) {
    return !!el && el.matches && el.matches(TEXT_INPUT_SELECTOR) && !isIgnored(el);
  }

  function isTextarea(el) {
    return !!el && el.tagName === 'TEXTAREA' && !isIgnored(el);
  }

  function getWrapper(el) {
    return (
      el.closest?.('.form-group, .custom-field-item, .input-group, .field, .produto-field, .proposal-field, .config-field, .usuario-field, .empresa-field') ||
      el.parentElement ||
      null
    );
  }

  function isLongEnough(el) {
    if (!el || !isElementVisible(el)) return false;
    const value = getValue(el);
    if (!value) return false;

    if (isTextarea(el)) {
      return value.length > 110 || el.scrollHeight > el.clientHeight + 8;
    }

    if (isTextInput(el)) {
      return value.length > 26 || el.scrollWidth > el.clientWidth + 8;
    }

    return false;
  }

  function autoHeightTextarea(el, maxHeight = 260) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    const base = Number(el.dataset.campoLongoBaseHeight || 0) || el.offsetHeight || 42;
    const next = Math.min(Math.max(el.scrollHeight + 4, base, 74), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight + 4 > maxHeight ? 'auto' : 'hidden';
  }

  function expandTextarea(el) {
    if (!isTextarea(el) || !isLongEnough(el)) return false;
    if (!el.dataset.campoLongoBaseHeight) {
      el.dataset.campoLongoBaseHeight = String(el.offsetHeight || el.clientHeight || 42);
    }
    const wrapper = getWrapper(el);
    if (wrapper) wrapper.classList.add('valora-campo-longo-wrap', 'is-campo-longo-aberto');
    el.classList.add('valora-campo-longo-expandido');
    autoHeightTextarea(el);
    return true;
  }

  function collapseTextarea(el) {
    if (!isTextarea(el)) return;
    const wrapper = getWrapper(el);
    if (wrapper) wrapper.classList.remove('is-campo-longo-aberto');
    el.classList.remove('valora-campo-longo-expandido');
    el.style.height = '';
    el.style.overflowY = '';
  }

  function copyInputVisualStyle(input, editor) {
    const computed = global.getComputedStyle(input);
    const props = [
      'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'color',
      'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
      'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'boxSizing', 'boxShadow'
    ];

    props.forEach((prop) => {
      editor.style[prop] = computed[prop];
    });
  }

  function syncEditorToInput(editor) {
    const inputId = editor.dataset.campoLongoInputId;
    if (!inputId) return;
    const input = document.querySelector(`[data-campo-longo-id="${cssEscape(inputId)}"]`);
    if (!input) return;

    input.value = editor.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    autoHeightTextarea(editor, 240);
  }

  function closeInputEditor(input, { force = false } = {}) {
    if (!input || !input.dataset.campoLongoEditorId) return;
    const editor = document.querySelector(`[data-campo-longo-editor-for="${cssEscape(input.dataset.campoLongoEditorId)}"]`);
    if (!editor) return;

    const wrapper = getWrapper(input);
    const editorFocused = document.activeElement === editor;
    const editorHovered = editor.matches(':hover');

    if (!force && (editorFocused || editorHovered)) return;

    input.value = editor.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    editor.remove();
    input.classList.remove('valora-campo-original-oculto');
    input.removeAttribute('aria-hidden');
    input.required = input.dataset.campoLongoWasRequired === 'true';
    delete input.dataset.campoLongoEditorId;
    delete input.dataset.campoLongoWasRequired;

    if (wrapper) wrapper.classList.remove('valora-campo-longo-wrap', 'is-campo-longo-aberto');
  }

  function createInputEditor(input, { focus = false } = {}) {
    if (!isTextInput(input) || !isLongEnough(input)) return false;

    const existingId = input.dataset.campoLongoEditorId;
    if (existingId) {
      const existing = document.querySelector(`[data-campo-longo-editor-for="${cssEscape(existingId)}"]`);
      if (existing) {
        existing.value = input.value;
        autoHeightTextarea(existing, 240);
        if (focus && !input.disabled && !input.readOnly) {
          existing.readOnly = false;
          setTimeout(() => {
            existing.focus({ preventScroll: true });
            existing.setSelectionRange(existing.value.length, existing.value.length);
          }, 0);
        }
        return true;
      }
    }

    const wrapper = getWrapper(input);
    if (wrapper) wrapper.classList.add('valora-campo-longo-wrap', 'is-campo-longo-aberto');

    const id = `campo-longo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    input.dataset.campoLongoEditorId = id;
    input.dataset.campoLongoId = id;
    input.dataset.campoLongoWasRequired = input.required ? 'true' : 'false';

    const editor = document.createElement('textarea');
    editor.className = 'valora-campo-longo-editor';
    editor.dataset.campoLongoEditorFor = id;
    editor.dataset.campoLongoInputId = id;
    editor.value = input.value;
    editor.rows = 2;
    editor.spellcheck = input.spellcheck;
    editor.placeholder = input.placeholder || '';
    editor.readOnly = !!input.readOnly || !!input.disabled || !focus;
    editor.disabled = !!input.disabled;
    editor.required = !!input.required;
    editor.setAttribute('aria-label', input.getAttribute('aria-label') || input.getAttribute('name') || input.id || 'Campo expandido');

    copyInputVisualStyle(input, editor);
    input.insertAdjacentElement('afterend', editor);
    input.classList.add('valora-campo-original-oculto');
    input.setAttribute('aria-hidden', 'true');
    if (input.required) input.required = false;
    autoHeightTextarea(editor, 240);

    editor.addEventListener('input', () => syncEditorToInput(editor));
    editor.addEventListener('focus', () => {
      if (!input.readOnly && !input.disabled) editor.readOnly = false;
      autoHeightTextarea(editor, 240);
    });
    editor.addEventListener('blur', () => {
      syncEditorToInput(editor);
      window.setTimeout(() => closeInputEditor(input, { force: true }), 90);
    });
    editor.addEventListener('mouseenter', () => autoHeightTextarea(editor, 240));
    editor.addEventListener('mouseleave', () => {
      window.setTimeout(() => {
        if (document.activeElement !== editor) closeInputEditor(input, { force: true });
      }, 70);
    });
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeInputEditor(input, { force: true });
        input.focus({ preventScroll: true });
      }
    });

    if (focus && !input.disabled && !input.readOnly) {
      editor.readOnly = false;
      setTimeout(() => {
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(editor.value.length, editor.value.length);
      }, 0);
    }

    return true;
  }

  function expandField(el, { focus = false } = {}) {
    if (!el || isIgnored(el) || !isLongEnough(el)) return false;
    if (isTextarea(el)) return expandTextarea(el);
    if (isTextInput(el)) return createInputEditor(el, { focus });
    return false;
  }

  function collapseField(el, { force = false } = {}) {
    if (!el || isIgnored(el)) return;
    if (isTextarea(el)) {
      if (force || document.activeElement !== el) collapseTextarea(el);
      return;
    }
    if (isTextInput(el)) closeInputEditor(el, { force });
  }

  function getTargetField(event) {
    const target = event.target;
    if (!target || !target.closest) return null;
    const editor = target.closest('.valora-campo-longo-editor');
    if (editor) return null;
    return target.closest(FIELD_SELECTOR);
  }

  function enhance(root = document) {
    const base = root && root.querySelectorAll ? root : document;
    base.querySelectorAll(FIELD_SELECTOR).forEach((field) => {
      if (!isIgnored(field) && isLongEnough(field)) {
        const wrapper = getWrapper(field);
        if (wrapper) wrapper.classList.add('valora-campo-longo-wrap', 'has-campo-longo');
        field.classList.add('has-campo-longo-value');
        field.setAttribute('title', getValue(field));
      }
    });
  }

  function init() {
    if (global.__valoraCamposLongosReady) return;
    global.__valoraCamposLongosReady = true;

    document.addEventListener('mouseenter', (event) => {
      const field = getTargetField(event);
      if (!field) return;
      expandField(field, { focus: false });
    }, true);

    document.addEventListener('mouseleave', (event) => {
      const field = getTargetField(event);
      if (!field) return;
      window.setTimeout(() => collapseField(field, { force: false }), 80);
    }, true);

    document.addEventListener('focusin', (event) => {
      const field = getTargetField(event);
      if (!field) return;
      expandField(field, { focus: true });
    });

    document.addEventListener('focusout', (event) => {
      const field = getTargetField(event);
      if (!field) return;
      window.setTimeout(() => collapseField(field, { force: true }), 100);
    });

    document.addEventListener('input', (event) => {
      const field = getTargetField(event);
      if (!field) return;
      enhance(field.parentElement || document);
      if (isTextarea(field) && field.classList.contains('valora-campo-longo-expandido')) autoHeightTextarea(field);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const active = document.activeElement;
      if (active && active.matches && active.matches(FIELD_SELECTOR)) collapseField(active, { force: true });
    });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === 1) enhance(node);
        }
      }
    });

    const startObserver = () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
      enhance(document);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserver, { once: true });
    } else {
      startObserver();
    }
  }

  global.ValoraCamposLongos = {
    VERSION,
    enhance,
    sync: (el, options = {}) => expandField(el, { focus: !!options.expand }),
    expand: expandField,
    collapse: collapseField,
  };

  init();
})(window);
