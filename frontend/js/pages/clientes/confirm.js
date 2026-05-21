import { $ } from './utils.js';

let _confirmResolver = null;

export function confirmDialog({
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

  backdrop.hidden = false;
  requestAnimationFrame(() => backdrop.classList.add('show'));

  return new Promise((resolve) => {
    _confirmResolver = resolve;
  });
}

export function closeConfirm(result = false) {
  const backdrop = $('Valora-confirm-backdrop');
  if (backdrop) {
    backdrop.classList.remove('show');
    setTimeout(() => {
      backdrop.hidden = true;
    }, 180);
  }

  if (typeof _confirmResolver === 'function') {
    const fn = _confirmResolver;
    _confirmResolver = null;
    fn(!!result);
  }
}

export function bindConfirmDialog() {
  $('Valora-confirm-cancel')?.addEventListener('click', () => closeConfirm(false));
  $('Valora-confirm-ok')?.addEventListener('click', () => closeConfirm(true));

  $('Valora-confirm-backdrop')?.addEventListener('click', (e) => {
    if (e.target === $('Valora-confirm-backdrop')) {
      closeConfirm(false);
    }
  });
}