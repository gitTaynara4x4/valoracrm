(() => {
  'use strict';

  const MODAL_OPEN_CLASS = 'show';
  const BODY_LOCK_CLASS = 'modal-open';

  function qs(id) {
    return document.getElementById(id);
  }

  function getModal(modalOrId) {
    if (!modalOrId) return null;

    if (typeof modalOrId === 'string') {
      return qs(modalOrId);
    }

    if (modalOrId instanceof HTMLElement) {
      return modalOrId;
    }

    return null;
  }

  function open(modalOrId) {
    const modal = getModal(modalOrId);
    if (!modal) {
      console.warn('[ValoraModal] Modal não encontrado:', modalOrId);
      return;
    }

    modal.hidden = false;
    modal.style.display = 'flex';

    document.body.classList.add(BODY_LOCK_CLASS);

    requestAnimationFrame(() => {
      modal.classList.add(MODAL_OPEN_CLASS);

      const firstInput = modal.querySelector(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      );

      if (firstInput) {
        setTimeout(() => {
          try {
            firstInput.focus({ preventScroll: true });
          } catch (_) {
            firstInput.focus();
          }
        }, 80);
      }
    });
  }

  function close(modalOrId) {
    const modal = getModal(modalOrId);
    if (!modal) return;

    modal.classList.remove(MODAL_OPEN_CLASS);

    setTimeout(() => {
      modal.hidden = true;
      modal.style.display = 'none';

      const algumAberto = document.querySelector('.modal-overlay.show');
      if (!algumAberto) {
        document.body.classList.remove(BODY_LOCK_CLASS);
      }
    }, 160);
  }

  function closeAll() {
    document.querySelectorAll('.modal-overlay.show').forEach((modal) => {
      close(modal);
    });
  }

  function bindGlobalEvents() {
    document.addEventListener('click', (event) => {
      const closeBtn = event.target.closest('[data-modal-close], [data-close-modal]');

      if (closeBtn) {
        event.preventDefault();

        const target =
          closeBtn.dataset.modalClose ||
          closeBtn.dataset.closeModal ||
          closeBtn.closest('.modal-overlay')?.id;

        if (target) {
          close(target);
        }

        return;
      }

      const overlay = event.target.closest('.modal-overlay');

      if (overlay && event.target === overlay) {
        const bloqueado = overlay.dataset.closeTarget === 'false';

        if (!bloqueado) {
          close(overlay);
        }
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const modais = Array.from(document.querySelectorAll('.modal-overlay.show'));
        const ultimo = modais.at(-1);

        if (ultimo) {
          close(ultimo);
        }
      }
    });
  }

  window.ValoraModal = {
    open,
    close,
    closeAll,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindGlobalEvents);
  } else {
    bindGlobalEvents();
  }
})();