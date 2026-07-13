import { state } from './state.js';
import { escapeHtml, formatTipoCampo } from './utils.js';

function badgeSituacao(situacao) {
  const s = String(situacao || 'ativo').toLowerCase();
  return `<span class="badge-status ${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function cidadeUf(f) {
  const cidade = f?.cidade || '';
  const uf = f?.estado || '';
  return [cidade, uf].filter(Boolean).join(' / ') || '-';
}

function contatoResumo(f) {
  return f?.whatsapp || f?.telefone || f?.email || '-';
}

function nomeResumo(f) {
  const nome = f?.nome || '-';
  const fantasia = f?.nome_fantasia || '';
  if (!fantasia) return `<strong>${escapeHtml(nome)}</strong>`;
  return `<div style="display:flex; flex-direction:column; gap:2px;"><strong>${escapeHtml(nome)}</strong><span class="subtle">${escapeHtml(fantasia)}</span></div>`;
}

export function renderTabelaFornecedores(fornecedores) {
  const tbody = document.getElementById('tbody-fornecedores');
  const spanCount = document.getElementById('contagem-fornecedores');
  if (!tbody) return;

  if (!fornecedores.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="border:none; text-align:center;">Nenhum fornecedor encontrado.</td></tr>`;
    if (spanCount) spanCount.textContent = '0 fornecedores';
    renderPaginacaoFornecedores();
    return;
  }

  tbody.innerHTML = fornecedores.map((f) => `
    <tr>
      <td><span class="badge-codigo">${escapeHtml(f.codigo || '-')}</span></td>
      <td>${escapeHtml(f.tipo_fornecedor || '-')}</td>
      <td>${nomeResumo(f)}</td>
      <td>${escapeHtml(f.cpf_cnpj || '-')}</td>
      <td>${escapeHtml(cidadeUf(f))}</td>
      <td>${escapeHtml(contatoResumo(f))}</td>
      <td>${badgeSituacao(f.situacao)}</td>
      <td style="text-align:right;">
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn-icon" data-action="editar" data-id="${f.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon danger" data-action="excluir" data-id="${f.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  if (spanCount) {
    const page = state.fornecedoresPage || {};
    const total = Number(page.total || fornecedores.length || 0);
    const ini = total ? Number(page.offset || 0) + 1 : 0;
    const fim = Math.min(Number(page.offset || 0) + fornecedores.length, total);
    spanCount.textContent = total === fornecedores.length
      ? (fornecedores.length === 1 ? '1 fornecedor' : `${fornecedores.length} fornecedores`)
      : `${ini}-${fim} de ${total} fornecedores`;
  }

  renderPaginacaoFornecedores();
}

export function renderPaginacaoFornecedores() {
  const wrap = document.getElementById('paginacao-fornecedores');
  if (!wrap) return;

  const page = state.fornecedoresPage || {};
  const offset = Number(page.offset || 0);
  const limit = Number(page.limit || 50);
  const total = Number(page.total || 0);
  const atual = total ? Math.floor(offset / limit) + 1 : 1;
  const paginas = Math.max(1, Math.ceil(total / limit));

  const lastOffset = Math.max(0, (paginas - 1) * limit);

  wrap.innerHTML = `
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="first" ${offset <= 0 ? 'disabled' : ''}>Primeira</button>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="prev" ${offset <= 0 ? 'disabled' : ''}>Anterior</button>
    <span class="pagination-info">Página ${atual} de ${paginas}</span>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="next" ${!page.hasMore ? 'disabled' : ''}>Próxima</button>
    <button class="btn btn-secondary btn-sm" type="button" data-page-action="last" data-last-offset="${lastOffset}" ${offset >= lastOffset ? 'disabled' : ''}>Última</button>
  `;
}

export function renderListaCamposFornecedores(camposFornecedores) {
  const wrap = document.getElementById('lista-campos-fornecedores');
  if (!wrap) return;

  if (!camposFornecedores.length) {
    wrap.innerHTML = `<div class="empty-state">Nenhum campo personalizado criado.</div>`;
    return;
  }

  wrap.innerHTML = camposFornecedores.map((campo) => {
    const badgeObrigatorio = campo.obrigatorio ? `<span class="badge-tag brand">Obrigatório</span>` : '';
    const badgeInativo = campo.ativo === false ? `<span class="badge-tag">Oculto</span>` : '';

    return `
      <div class="campo-card">
        <div>
          <strong>${escapeHtml(campo.nome || '')}</strong>
          <span>${escapeHtml(formatTipoCampo(campo.tipo))} • Pos: ${Number(campo.ordem || 0)}</span>
          <br>${badgeObrigatorio} ${badgeInativo}
        </div>
        <div>
          <button class="btn-icon" data-campo-action="editar" data-id="${campo.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon danger" data-campo-action="excluir" data-id="${campo.id}" title="Excluir"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');
}