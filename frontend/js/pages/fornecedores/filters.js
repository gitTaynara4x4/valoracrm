import { $ } from './utils.js';

export function getFiltroFornecedores() {
  return {
    busca: String($('filtro-busca')?.value || '').trim(),
    tipo: String($('filtro-tipo')?.value || '').trim(),
    situacao: String($('filtro-situacao')?.value || '').trim().toLowerCase(),
    cidade: String($('filtro-cidade')?.value || '').trim(),
  };
}

// Agora o filtro principal é feito no servidor para não carregar todos os registros.
export function filtrarFornecedores(fornecedores) {
  return fornecedores || [];
}

export function limparFiltrosFornecedores() {
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

  ['filtro-busca', 'filtro-tipo', 'filtro-cidade'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => fire(350));
  });

  const situacao = $('filtro-situacao');
  if (situacao) situacao.addEventListener('change', () => fire(0));
}
