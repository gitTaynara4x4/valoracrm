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
    spanCount.textContent = fornecedores.length === 1 ? '1 fornecedor' : `${fornecedores.length} fornecedores`;
  }
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