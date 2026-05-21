import { $ } from './utils.js';

export function getFiltroFornecedores() {
  return {
    busca: String($('filtro-busca')?.value || '').trim().toLowerCase(),
    tipo: String($('filtro-tipo')?.value || '').trim().toLowerCase(),
    situacao: String($('filtro-situacao')?.value || '').trim().toLowerCase(),
    cidade: String($('filtro-cidade')?.value || '').trim().toLowerCase(),
  };
}

export function filtrarFornecedores(fornecedores) {
  const filtro = getFiltroFornecedores();

  return (fornecedores || []).filter((f) => {
    const texto = [
      f.codigo,
      f.nome,
      f.nome_fantasia,
      f.cpf_cnpj,
      f.telefone,
      f.whatsapp,
      f.email,
      f.cidade,
      f.estado,
      f.tipo_fornecedor,
    ].filter(Boolean).join(' ').toLowerCase();

    const okBusca = !filtro.busca || texto.includes(filtro.busca);
    const okTipo = !filtro.tipo || String(f.tipo_fornecedor || '').toLowerCase().includes(filtro.tipo);
    const okSituacao = !filtro.situacao || String(f.situacao || '').toLowerCase() === filtro.situacao;
    const okCidade = !filtro.cidade || String(f.cidade || '').toLowerCase().includes(filtro.cidade);

    return okBusca && okTipo && okSituacao && okCidade;
  });
}

export function limparFiltrosFornecedores() {
  if ($('filtro-busca')) $('filtro-busca').value = '';
  if ($('filtro-tipo')) $('filtro-tipo').value = '';
  if ($('filtro-situacao')) $('filtro-situacao').value = '';
  if ($('filtro-cidade')) $('filtro-cidade').value = '';
}

export function initFilters(onChange) {
  ['filtro-busca', 'filtro-tipo', 'filtro-situacao', 'filtro-cidade'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(id.includes('tipo') || id.includes('situacao') ? 'change' : 'input', () => {
      if (typeof onChange === 'function') onChange();
    });
  });
}