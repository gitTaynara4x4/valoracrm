// /frontend/js/pages/produtos/ui.js
// Toast + Confirm + Prompt (modal custom)
// (SEM CSS aqui - o visual fica no produtos.css)

/* =========================
   Toast
========================= */

export function ensureToastWrap() {
  let wrap = document.getElementById('Valora-toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'Valora-toast-wrap';
    wrap.className = 'Valora-toast-wrap';
    document.body.appendChild(wrap);
  }
  return wrap;
}

export function toast(msg, type = 'ok', title = null, timeoutMs = 2800) {
  const wrap = ensureToastWrap();

  const ttype = String(type || 'ok').toLowerCase();
  const norm =
    (ttype === 'success') ? 'success' :
    (ttype === 'info') ? 'info' :
    (ttype === 'warn' || ttype === 'warning') ? 'warn' :
    (ttype === 'err' || ttype === 'error') ? 'err' :
    'ok';

  const t = document.createElement('div');
  t.className = `Valora-toast Valora-toast--${norm}`;

  const icon = document.createElement('div');
  icon.className = 'Valora-toast__icon';
  icon.innerHTML =
    (norm === 'ok' || norm === 'success') ? '<i class="fa-solid fa-check"></i>' :
    (norm === 'warn') ? '<i class="fa-solid fa-triangle-exclamation"></i>' :
    (norm === 'info') ? '<i class="fa-solid fa-circle-info"></i>' :
    '<i class="fa-solid fa-circle-xmark"></i>';

  const body = document.createElement('div');
  body.className = 'Valora-toast__body';

  const h = document.createElement('p');
  h.className = 'Valora-toast__title';
  h.textContent = title || (
    norm === 'warn' ? 'Atenção' :
    norm === 'info' ? 'Info' :
    norm === 'err' ? 'Erro' :
    'OK'
  );

  const p = document.createElement('p');
  p.className = 'Valora-toast__msg';
  p.textContent = String(msg ?? '');

  const close = document.createElement('button');
  close.className = 'Valora-toast__close';
  close.type = 'button';
  close.innerHTML = '<i class="fa-solid fa-xmark"></i>';

  body.appendChild(h);
  body.appendChild(p);

  t.appendChild(icon);
  t.appendChild(body);
  t.appendChild(close);

  wrap.appendChild(t);

  const remove = () => { if (t.isConnected) t.remove(); };
  close.addEventListener('click', remove);
  if (timeoutMs > 0) setTimeout(remove, timeoutMs);
}

/* =========================
   Confirm (modal)
========================= */

export function confirmValora(message, {
  title = 'Confirmar',
  okText = 'Confirmar',
  cancelText = 'Cancelar'
} = {}) {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'Valora-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'Valora-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'Valora-confirm__head';

    const h = document.createElement('h3');
    h.className = 'Valora-confirm__title';
    h.textContent = title;

    const x = document.createElement('button');
    x.className = 'Valora-confirm__close';
    x.type = 'button';
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    head.appendChild(h);
    head.appendChild(x);

    const msg = document.createElement('p');
    msg.className = 'Valora-confirm__msg';
    msg.textContent = String(message ?? '');

    const foot = document.createElement('div');
    foot.className = 'Valora-confirm__foot';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = cancelText;

    const btnOk = document.createElement('button');
    btnOk.className = 'btn-primary';
    btnOk.type = 'button';
    btnOk.textContent = okText;

    foot.appendChild(btnCancel);
    foot.appendChild(btnOk);

    modal.appendChild(head);
    modal.appendChild(msg);
    modal.appendChild(foot);

    bd.appendChild(modal);
    document.body.appendChild(bd);
    document.body.classList.add('modal-open');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      if (bd.isConnected) bd.remove();
      document.removeEventListener('keydown', onKey);
    };

    const done = (v) => { cleanup(); resolve(v); };

    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    document.addEventListener('keydown', onKey);

    bd.addEventListener('click', (e) => { if (e.target === bd) done(false); });
    x.addEventListener('click', () => done(false));
    btnCancel.addEventListener('click', () => done(false));
    btnOk.addEventListener('click', () => done(true));

    setTimeout(() => btnOk.focus(), 0);
  });
}

/* =========================
   Prompt (input modal)
========================= */

export function promptValora(message, {
  title = 'Adicionar',
  okText = 'Adicionar',
  cancelText = 'Cancelar',
  placeholder = 'Digite...'
} = {}) {
  return new Promise(resolve => {
    const bd = document.createElement('div');
    bd.className = 'Valora-confirm-backdrop';

    const modal = document.createElement('div');
    modal.className = 'Valora-confirm';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'Valora-confirm__head';

    const h = document.createElement('h3');
    h.className = 'Valora-confirm__title';
    h.textContent = title;

    const x = document.createElement('button');
    x.className = 'Valora-confirm__close';
    x.type = 'button';
    x.innerHTML = '<i class="fa-solid fa-xmark"></i>';

    head.appendChild(h);
    head.appendChild(x);

    const msg = document.createElement('p');
    msg.className = 'Valora-confirm__msg';
    msg.textContent = String(message ?? '');

    const input = document.createElement('input');
    input.className = 'Valora-confirm__input';
    input.type = 'text';
    input.placeholder = placeholder;

    const foot = document.createElement('div');
    foot.className = 'Valora-confirm__foot';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn-secondary';
    btnCancel.type = 'button';
    btnCancel.textContent = cancelText;

    const btnOk = document.createElement('button');
    btnOk.className = 'btn-primary';
    btnOk.type = 'button';
    btnOk.textContent = okText;

    foot.appendChild(btnCancel);
    foot.appendChild(btnOk);

    modal.appendChild(head);
    modal.appendChild(msg);
    modal.appendChild(input);
    modal.appendChild(foot);

    bd.appendChild(modal);
    document.body.appendChild(bd);
    document.body.classList.add('modal-open');

    const cleanup = () => {
      document.body.classList.remove('modal-open');
      if (bd.isConnected) bd.remove();
      document.removeEventListener('keydown', onKey);
    };

    const done = (v) => { cleanup(); resolve(v); };

    const onKey = (e) => {
      if (e.key === 'Escape') return done(null);

      if (e.key === 'Enter') {
        const val = (input.value || '').trim();
        return done(val || null);
      }
    };
    document.addEventListener('keydown', onKey);

    bd.addEventListener('click', (e) => { if (e.target === bd) done(null); });
    x.addEventListener('click', () => done(null));
    btnCancel.addEventListener('click', () => done(null));
    btnOk.addEventListener('click', () => {
      const val = (input.value || '').trim();
      done(val || null);
    });

    setTimeout(() => input.focus(), 0);
  });
}
