import { $ } from './utils.js';

export function getFiltroClientes() {
  return {
    busca: String($('filtro-busca')?.value || '').trim().toLowerCase(),
    tipo: String($('filtro-tipo')?.value || '').trim().toUpperCase(),
    situacao: String($('filtro-situacao')?.value || '').trim().toLowerCase(),
    cidade: String($('filtro-cidade')?.value || '').trim().toLowerCase(),
  };
}

export function filtrarClientes(clientes) {
  const filtro = getFiltroClientes();

  return (clientes || []).filter((c) => {
    const nome = String(c.nome || '').toLowerCase();
    const nomeFantasia = String(c.nome_fantasia || '').toLowerCase();
    const codigo = String(c.codigo || '').toLowerCase();
    const cpfCnpj = String(c.cpf_cnpj || '').toLowerCase();
    const telefone = String(c.telefone || '').toLowerCase();
    const whatsapp = String(c.whatsapp || '').toLowerCase();
    const email = String(c.email || '').toLowerCase();
    const cidade = String(c.cidade || '').toLowerCase();
    const estado = String(c.estado || '').toLowerCase();
    const tipoPessoa = String(c.tipo_pessoa || '').toUpperCase();
    const situacao = String(c.situacao || '').toLowerCase();

    const textoBusca = [
      nome,
      nomeFantasia,
      codigo,
      cpfCnpj,
      telefone,
      whatsapp,
      email,
      cidade,
      estado,
    ].join(' ');

    const okBusca = !filtro.busca || textoBusca.includes(filtro.busca);
    const okTipo = !filtro.tipo || tipoPessoa === filtro.tipo;
    const okSituacao = !filtro.situacao || situacao === filtro.situacao;
    const okCidade = !filtro.cidade || cidade.includes(filtro.cidade);

    return okBusca && okTipo && okSituacao && okCidade;
  });
}

export function limparFiltrosClientes() {
  if ($('filtro-busca')) $('filtro-busca').value = '';
  if ($('filtro-tipo')) $('filtro-tipo').value = '';
  if ($('filtro-situacao')) $('filtro-situacao').value = '';
  if ($('filtro-cidade')) $('filtro-cidade').value = '';
}

export function initFilters(onChange) {
  $('filtro-busca')?.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange();
  });

  $('filtro-tipo')?.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange();
  });

  $('filtro-situacao')?.addEventListener('change', () => {
    if (typeof onChange === 'function') onChange();
  });

  $('filtro-cidade')?.addEventListener('input', () => {
    if (typeof onChange === 'function') onChange();
  });
}