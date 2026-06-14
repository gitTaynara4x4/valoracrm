import { $ } from './utils.js';

export function getFiltroClientes() {
  return {
    busca: String($('filtro-busca')?.value || '').trim(),
    tipo: String($('filtro-tipo')?.value || '').trim().toUpperCase(),
    situacao: String($('filtro-situacao')?.value || '').trim().toLowerCase(),
    cidade: String($('filtro-cidade')?.value || '').trim(),
  };
}

// Agora o filtro principal é feito no servidor, para não carregar tudo no navegador.
export function filtrarClientes(clientes) {
  return clientes || [];
}

export function limparFiltrosClientes() {
  if ($('filtro-busca')) $('filtro-busca').value = '';
  if ($('filtro-tipo')) $('filtro-tipo').value = '';
  if ($('filtro-situacao')) $('filtro-situacao').value = '';
  if ($('filtro-cidade')) $('filtro-cidade').value = '';
}

export function initFilters(onChange) {
  let timer = null;

  const fire = (delay = 350) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (typeof onChange === 'function') onChange();
    }, delay);
  };

  ['filtro-busca', 'filtro-cidade'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => fire(350));
  });

  ['filtro-tipo', 'filtro-situacao'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => fire(0));
  });
}
