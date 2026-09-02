/*
 * ValoraCRM · Orçamentos · documentos.js
 * Preview do orçamento, DAV, escala do documento e histórico.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function buildStandardPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const color = state.meta.configuracao?.cor_primaria || '#65ACDE';
    const documentName = $('orcamento-nome-documento').value || state.meta.configuracao?.nome_documento || 'Orçamento';
    const code = $('orcamento-codigo').value || 'Prévia';
    const title = $('orcamento-titulo').value || 'Orçamento comercial';
    const clientName = $('orcamento-cliente-busca').value || 'Cliente não selecionado';
    const logo = company.logo ? `<img src="${escapeHtml(company.logo)}" alt="Logo">` : '';
    const rows = state.items.map((item, index) => `
      <tr>
        ${state.meta.configuracao?.mostrar_codigo !== false ? `<td>${escapeHtml(item.codigo || String(index + 1).padStart(4, '0'))}</td>` : ''}
        <td><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td style="text-align:center">${inputMoney(item.quantidade)}</td>
        <td style="text-align:center">${escapeHtml(item.unidade)}</td>
        <td style="text-align:right">${formatMoney(item.valor_unitario)}</td>
        <td style="text-align:right">${formatMoney(itemTotal(item))}</td>
      </tr>`).join('');
    const payments = state.payments.map((payment) => `<li><strong>${escapeHtml(payment.nome)}</strong>: ${escapeHtml(paymentDescription(payment))}</li>`).join('');
    const itemsAndSummary = state.items.length ? `
      <table class="preview-items"><thead><tr>${state.meta.configuracao?.mostrar_codigo !== false ? '<th>Código</th>' : ''}<th>Descrição</th><th style="text-align:center">Qtd.</th><th style="text-align:center">Un.</th><th style="text-align:right">Unitário</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="preview-summary"><div class="preview-summary-row"><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong></div>${totals.discount > 0 ? `<div class="preview-summary-row"><span>Desconto</span><strong>-${formatMoney(totals.discount)}</strong></div>` : ''}${totals.freight > 0 ? `<div class="preview-summary-row"><span>Frete</span><strong>${formatMoney(totals.freight)}</strong></div>` : ''}${totals.addition > 0 ? `<div class="preview-summary-row"><span>Acréscimo</span><strong>${formatMoney(totals.addition)}</strong></div>` : ''}<div class="preview-summary-total"><span>VALOR TOTAL</span><strong>${formatMoney(totals.total)}</strong></div></div>` : '';
    const cover = $('orcamento-usar-capa').checked ? `
      <section class="preview-cover">
        <div class="preview-cover-brand">${logo}<div><strong>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</strong><p>${escapeHtml(company.endereco || companyAddress())}</p></div></div>
        <div class="preview-cover-title"><h1>${escapeHtml($('orcamento-titulo-capa').value || documentName)}</h1><p>${escapeHtml($('orcamento-subtitulo-capa').value || title)}</p></div>
        <div class="preview-cover-client"><small>Preparado para</small><h2>${escapeHtml(clientName)}</h2><p>${escapeHtml(code)} • ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p></div>
      </section>` : '';

    return `<div style="--preview-color:${escapeHtml(color)}">${cover}
      <section class="preview-document-page">
        <header class="preview-doc-header">
          <div class="preview-doc-brand">${logo}<div><h2>${escapeHtml(company.fantasia || company.razao || 'Sua empresa')}</h2>${company.cnpj ? `<p>CNPJ: ${escapeHtml(company.cnpj)}</p>` : ''}<p>${escapeHtml(company.endereco || companyAddress())}</p><p>${escapeHtml([company.telefone, company.email].filter(Boolean).join(' • '))}</p></div></div>
          <div class="preview-doc-meta"><h1>${escapeHtml(documentName)}</h1><p><strong>${escapeHtml(code)}</strong></p><p>Emissão: ${escapeHtml(localDate($('orcamento-data-emissao').value))}</p><p>Validade: ${escapeHtml(localDate($('orcamento-data-validade').value))}</p></div>
        </header>
        <div class="preview-title"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(state.categories.find((c) => String(c.id) === $('orcamento-categoria').value)?.nome || '')}</p></div>
        <div class="preview-client-box">
          <div class="preview-field"><label>Cliente</label><strong>${escapeHtml(clientName)}</strong></div>
          <div class="preview-field"><label>Responsável</label><span>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</span></div>
          <div class="preview-field"><label>Endereço/local</label><span>${escapeHtml(budgetAddress() || '—')}</span></div>
          <div class="preview-field"><label>Consultor</label><span>${escapeHtml(state.users.find((u) => String(u.id) === $('orcamento-consultor').value)?.nome || '—')}</span></div>
        </div>
        ${serviceProposalPreviewHtml()}
        ${itemsAndSummary}
        ${payments ? `<section class="preview-section"><h4>Formas de pagamento</h4><ul class="preview-payments">${payments}</ul></section>` : ''}
        ${$('orcamento-prazo-execucao').value ? `<section class="preview-section"><h4>Prazo de entrega/execução</h4><p>${escapeHtml($('orcamento-prazo-execucao').value)}</p></section>` : ''}
        ${$('orcamento-condicoes').value ? `<section class="preview-section"><h4>Condições gerais</h4><p>${escapeHtml($('orcamento-condicoes').value)}</p></section>` : ''}
        ${$('orcamento-observacoes').value ? `<section class="preview-section"><h4>Observações</h4><p>${escapeHtml($('orcamento-observacoes').value)}</p></section>` : ''}
        <footer class="preview-footer"><span>${escapeHtml(company.rodape || state.meta.configuracao?.rodape_padrao || company.fantasia || company.razao || '')}</span><span>Documento gerado pelo Valora CRM</span></footer>
      </section></div>`;
  }


  function usesDavDocument() {
    if (serviceProposalSelectedModel() !== 'padrao') return false;
    return String(state.meta.configuracao?.modelo_documento || 'padrao').toLowerCase() === 'dav';
  }

  function selectedEmitterData() {
    const selectedId = Number($('orcamento-emitente-id')?.value || state.current?.emitente_id || 0);
    return state.emitters.find((emitter) => Number(emitter.id) === selectedId) || null;
  }

  function documentCompanyData() {
    const config = state.meta.configuracao || {};
    const company = state.company || {};
    const budget = state.current || {};
    const emitter = selectedEmitterData() || {};
    const selectedId = Number($('orcamento-emitente-id')?.value || budget.emitente_id || 0);
    const useSnapshot = selectedId > 0 && Number(budget.emitente_id || 0) === selectedId;
    const snapshotAddress = useSnapshot ? budget.emitente_endereco_documento : null;
    const emitterAddress = [emitter.endereco, emitter.numero, emitter.complemento, emitter.bairro, emitter.cidade, emitter.estado, emitter.cep].filter(Boolean).join(', ');
    return {
      razao: (useSnapshot ? budget.emitente_razao_social_documento : null) || emitter.razao_social || config.cabecalho_razao_social || company.nome || 'Sua empresa',
      fantasia: (useSnapshot ? budget.emitente_nome_fantasia_documento : null) || emitter.nome_fantasia || config.cabecalho_nome_fantasia || '',
      cnpj: (useSnapshot ? budget.emitente_cnpj_documento : null) || emitter.cnpj || config.cabecalho_cnpj || company.cnpj || '',
      ie: (useSnapshot ? budget.emitente_ie_documento : null) || emitter.inscricao_estadual || '',
      email: (useSnapshot ? budget.emitente_email_documento : null) || emitter.email || config.cabecalho_email || company.email || '',
      site: (useSnapshot ? budget.emitente_site_documento : null) || emitter.site || config.cabecalho_site || '',
      telefone: (useSnapshot ? budget.emitente_telefone_documento : null) || emitter.telefone || config.cabecalho_telefone || company.telefone || '',
      endereco: snapshotAddress || emitterAddress || config.cabecalho_endereco || companyAddress(),
      logo: (useSnapshot ? budget.emitente_logo_documento : null) || emitter.logo_url || company.logo_url || '',
      rodape: (useSnapshot ? budget.emitente_rodape_documento : null) || emitter.rodape || config.cabecalho_rodape || config.rodape_padrao || company.nome || '',
      titulo: config.dav_titulo || 'DAV - Documento Auxiliar de Venda',
    };
  }


  function documentClientData() {
    const budget = state.current || {};
    const client = state.selectedClient || {};
    return {
      razao: client.nome || budget.cliente_razao_social || $('orcamento-cliente-busca').value || 'Cliente não selecionado',
      fantasia: client.nome_fantasia || budget.cliente_nome_fantasia || '',
      documento: client.cpf_cnpj || budget.cliente_documento || '',
      rgIe: client.rg_ie || budget.cliente_rg_ie_documento || '',
      telefone: client.telefone || budget.cliente_telefone_documento || $('orcamento-contato-cliente').value || '',
      whatsapp: client.whatsapp || budget.cliente_whatsapp || '',
      fax: client.fax || budget.cliente_fax_documento || '',
      emailNfe: client.email_nfe || client.email || budget.cliente_email_nfe_documento || budget.cliente_email || '',
      contato: client.contato || budget.cliente_contato_documento || '',
    };
  }

  function davTimestamp() {
    const source = state.current?.criado_em || state.current?.atualizado_em;
    const value = source ? new Date(source) : new Date();
    return Number.isNaN(value.getTime()) ? new Date() : value;
  }

  function davTextLines(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function davObservationGroups() {
    const groups = [];
    const conditions = davTextLines($('orcamento-condicoes').value);
    const notes = davTextLines($('orcamento-observacoes').value);
    const executionDeadline = $('orcamento-prazo-execucao').value.trim();

    if (conditions.length) {
      groups.push({ title: 'CONDIÇÕES GERAIS:', lines: conditions });
    }

    if (notes.length) {
      groups.push({ title: 'OBSERVAÇÕES ESPECÍFICAS:', lines: notes });
    }

    if (executionDeadline) {
      groups.push({ title: 'PRAZO DE ENTREGA/EXECUÇÃO:', lines: [executionDeadline] });
    }

    if (state.payments.length) {
      groups.push({
        title: 'FORMAS DE PAGAMENTO:',
        lines: state.payments.map((payment) => `${payment.nome}: ${paymentDescription(payment)}`),
      });
    }

    return groups;
  }

  function davObservationGroupsHtml() {
    return davObservationGroups()
      .map((group) => `<div class="dav-observation-group" style="margin-top:8px"><strong>${escapeHtml(group.title)}</strong>${group.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}</div>`)
      .join('');
  }

  function buildDavPreviewHtml() {
    const totals = calculateTotals();
    const company = documentCompanyData();
    const client = documentClientData();
    const seller = state.users.find((user) => String(user.id) === $('orcamento-consultor').value) || {};
    const timestamp = davTimestamp();
    const code = $('orcamento-codigo').value || 'PRÉVIA';
    const totalQuantity = state.items.reduce((sum, item) => sum + parseNumber(item.quantidade), 0);
    const globalDiscountPercent = $('orcamento-desconto-tipo').value === 'percentual'
      ? parseNumber($('orcamento-desconto-valor').value)
      : (totals.subtotal > 0 ? (totals.discount / totals.subtotal) * 100 : 0);

    const rows = state.items.map((item, index) => {
      const quantity = Math.max(parseNumber(item.quantidade), 0);
      const unitValue = Math.max(parseNumber(item.valor_unitario), 0);
      const lineDiscount = Math.max(parseNumber(item.desconto), 0);
      const discountUnit = quantity > 0 ? lineDiscount / quantity : 0;
      const unitAfterDiscount = Math.max(unitValue - discountUnit, 0);
      return `<tr>
        <td class="dav-code">${escapeHtml(item.codigo || String(index + 1).padStart(6, '0'))}</td>
        <td class="dav-description"><strong>${escapeHtml(item.descricao || 'Item')}</strong>${item.referencia ? `<small>${escapeHtml(item.referencia)}</small>` : ''}</td>
        <td class="dav-center">${escapeHtml(item.unidade || 'UN')}</td>
        <td class="dav-center">${formatDavQuantity(quantity)}</td>
        <td class="dav-number">${formatDavValue(unitValue)}</td>
        <td class="dav-number">${formatDavValue(discountUnit)}</td>
        <td class="dav-number">${formatDavValue(unitAfterDiscount)}</td>
        <td class="dav-number">${formatDavValue(itemTotal(item))}</td>
      </tr>`;
    }).join('');

    const observationGroups = davObservationGroupsHtml();
    const contactText = [client.contato, client.whatsapp || client.telefone].filter(Boolean).join(' ');
    const sellerText = [seller.nome || state.current?.consultor_nome, seller.telefone || state.current?.consultor_telefone].filter(Boolean).join(' ');
    const address = $('orcamento-logradouro').value || '—';
    const issueDate = localDate($('orcamento-data-emissao').value);
    const issueTime = timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    return `<section class="dav-document">
      <header class="dav-header">
        <div class="dav-company-title">
          <strong>${escapeHtml(company.razao)}</strong>
          <span>${escapeHtml([company.email ? `E-Mail: ${company.email}` : '', company.site ? `Site: ${company.site}` : ''].filter(Boolean).join(' / '))}</span>
          <h1>${escapeHtml(company.titulo)}</h1>
        </div>
        <div class="dav-document-meta">
          <div><b>Nº:</b><span>${escapeHtml(code)}</span></div>
          <div><b>Página:</b><span>1</span></div>
          <div><b>Data:</b><span>${escapeHtml(issueDate)}</span></div>
          <div><b></b><span>${escapeHtml(issueTime)}</span></div>
        </div>
      </header>

      <table class="dav-client-table">
        <tbody>
          <tr><td colspan="7"><label>NOME/RAZÃO SOCIAL:</label><strong>${escapeHtml(client.razao)}</strong></td><td colspan="2"><label>CPF/CNPJ:</label><strong>${escapeHtml(client.documento || '—')}</strong></td><td colspan="3"><label>RG/INSCRIÇÃO ESTADUAL:</label><strong>${escapeHtml(client.rgIe || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>ENDEREÇO:</label><strong>${escapeHtml(address)}</strong></td><td><label>NÚMERO:</label><strong>${escapeHtml($('orcamento-numero').value || '—')}</strong></td><td colspan="3"><label>BAIRRO:</label><strong>${escapeHtml($('orcamento-bairro').value || '—')}</strong></td><td colspan="3"><label>CEP:</label><strong>${escapeHtml($('orcamento-cep').value || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>MUNICÍPIO:</label><strong>${escapeHtml($('orcamento-cidade').value || '—')}</strong></td><td><label>UF:</label><strong>${escapeHtml($('orcamento-estado').value || '—')}</strong></td><td colspan="2"><label>FONE:</label><strong>${escapeHtml(client.telefone || '—')}</strong></td><td colspan="2"><label>FAX:</label><strong>${escapeHtml(client.fax || '—')}</strong></td><td colspan="2"><label>CONTATO:</label><strong>${escapeHtml(contactText || '—')}</strong></td></tr>
          <tr><td colspan="5"><label>VENDEDOR:</label><strong>${escapeHtml(sellerText || '—')}</strong></td><td colspan="4"><label>RESPONSÁVEL PEDIDO:</label><strong>${escapeHtml($('orcamento-responsavel-cliente').value || '—')}</strong></td><td colspan="3"><label>VALIDADE DA PROPOSTA:</label><strong>${escapeHtml(localDate($('orcamento-data-validade').value))}</strong></td></tr>
          <tr><td colspan="12"><label>E-mail (p/ envio da NF-e):</label><strong>${escapeHtml(client.emailNfe || '—')}</strong></td></tr>
        </tbody>
      </table>

      <div class="dav-reference-line">${escapeHtml($('orcamento-titulo').value || '')}${state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome ? ` • ${escapeHtml(state.categories.find((category) => String(category.id) === $('orcamento-categoria').value)?.nome)}` : ''}</div>

      <table class="dav-items-table">
        <thead><tr><th>CÓDIGO<br>PRODUTO:</th><th>DESCRIÇÃO DOS PRODUTOS:<br><span>REFERÊNCIA</span></th><th>UND.</th><th>QTDE:</th><th>VALOR(SD)<br>UNITÁRIO:</th><th>VALOR<br>DESCONTO:</th><th>VALOR(CD)<br>UNITÁRIO:</th><th>VALOR<br>TOTAL:</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" class="dav-empty">Nenhum item adicionado.</td></tr>'}</tbody>
      </table>

      <table class="dav-totals-table"><tbody><tr>
        <td class="dav-total-spacer"></td>
        <td class="dav-order-total"><div><b>Total do Pedido</b><strong>${formatDavValue(totals.total)}</strong></div><div><b>Desconto........................</b><span>${formatDavValue(globalDiscountPercent)}% &nbsp; + &nbsp; ${formatDavValue(totals.discount)} &nbsp; = &nbsp; ${formatDavValue(totals.total)}</span></div></td>
        <td class="dav-total-middle"></td>
        <td class="dav-note-total"><div><b>Total Produtos:</b><strong>${formatDavQuantity(totalQuantity)}</strong></div><div><b>Total da Nota:</b><strong>${formatDavValue(totals.total)}</strong></div></td>
      </tr></tbody></table>

      <section class="dav-observations"><h2>OBSERVAÇÕES E CONDIÇÕES:</h2><div class="dav-observation-lines">${observationGroups || '<div>—</div>'}</div></section>
      <footer class="dav-footer">${escapeHtml(company.rodape)}</footer>
    </section>`;
  }

  function buildPreviewHtml() {
    if (isNilsonServiceProposalModel()) return buildNilsonServiceProposalHtml();
    return usesDavDocument() ? buildDavPreviewHtml() : buildStandardPreviewHtml();
  }

  function applyPreviewScale(preview) {
    if (!preview) return;
    const scale = currentDocumentScale();
    const setPx = (name, base) => preview.style.setProperty(name, scaledCssValue(base, 'px', scale));
    preview.dataset.documentScale = String(scale);

    const variables = {
      '--doc-preview-padding': 44,
      '--std-cover-brand-gap': 16,
      '--std-cover-logo-size': 76,
      '--std-cover-title-gap': 14,
      '--std-cover-title-size': 42,
      '--std-cover-subtitle-size': 18,
      '--std-cover-client-padding': 24,
      '--std-header-gap': 22,
      '--std-header-padding': 20,
      '--std-brand-gap': 12,
      '--std-brand-logo-size': 58,
      '--std-brand-title-size': 18,
      '--std-meta-text-size': 10,
      '--std-meta-title-size': 22,
      '--std-title-top': 22,
      '--std-title-bottom': 15,
      '--std-title-size': 17,
      '--std-title-subtitle-size': 10,
      '--std-client-gap-row': 8,
      '--std-client-gap-column': 24,
      '--std-client-margin': 18,
      '--std-client-padding-y': 14,
      '--std-client-padding-x': 16,
      '--std-field-label-size': 8,
      '--std-field-value-size': 10,
      '--std-table-head-padding-y': 8,
      '--std-table-head-padding-x': 7,
      '--std-table-head-size': 8,
      '--std-table-cell-padding-y': 9,
      '--std-table-cell-padding-x': 7,
      '--std-table-cell-size': 9,
      '--std-table-small-gap': 3,
      '--std-summary-margin': 18,
      '--std-summary-row-padding': 7,
      '--std-summary-row-size': 9,
      '--std-summary-total-margin': 8,
      '--std-summary-total-padding-y': 12,
      '--std-summary-total-padding-x': 14,
      '--std-summary-label-size': 8,
      '--std-summary-value-size': 17,
      '--std-section-margin': 18,
      '--std-section-padding-y': 13,
      '--std-section-padding-x': 15,
      '--std-section-title-gap': 7,
      '--std-section-title-size': 10,
      '--std-section-text-size': 9,
      '--std-footer-margin': 24,
      '--std-footer-padding': 12,
      '--std-footer-gap': 20,
      '--std-footer-size': 8,
      '--dav-document-padding': 15,
      '--dav-base-font-size': 11,
      '--dav-header-min-height': 70,
      '--dav-header-padding-bottom': 6,
      '--dav-company-padding': 8,
      '--dav-company-title-size': 16,
      '--dav-company-subtitle-gap': 4,
      '--dav-company-subtitle-size': 10,
      '--dav-document-title-gap': 13,
      '--dav-document-title-size': 21,
      '--dav-meta-font-size': 9,
      '--dav-meta-row-height': 16,
      '--dav-meta-gap': 4,
      '--dav-client-padding-y': 3,
      '--dav-client-padding-x': 4,
      '--dav-client-label-size': 9,
      '--dav-client-value-gap': 2,
      '--dav-client-value-size': 10.5,
      '--dav-reference-min-height': 30,
      '--dav-reference-padding-y': 6,
      '--dav-reference-padding-x': 4,
      '--dav-reference-size': 10,
      '--dav-head-padding-y': 6,
      '--dav-head-padding-x': 3,
      '--dav-head-size': 8.8,
      '--dav-cell-min-height': 34,
      '--dav-cell-padding-y': 6,
      '--dav-cell-padding-x': 4,
      '--dav-cell-size': 10,
      '--dav-description-gap': 2,
      '--dav-description-size': 9,
      '--dav-total-height': 58,
      '--dav-total-padding-y': 4,
      '--dav-total-padding-x': 8,
      '--dav-total-gap': 4,
      '--dav-total-label-size': 9,
      '--dav-total-value-size': 10,
      '--dav-total-detail-size': 8.5,
      '--dav-note-row-padding': 3,
      '--dav-note-row-gap': 8,
      '--dav-observation-min-height': 140,
      '--dav-observation-padding-y': 10,
      '--dav-observation-padding-x': 8,
      '--dav-observation-title-gap': 18,
      '--dav-observation-title-size': 10,
      '--dav-observation-text-size': 10,
      '--dav-footer-min-height': 18,
      '--dav-footer-padding-y': 3,
      '--dav-footer-padding-x': 4,
      '--dav-footer-size': 9,
    };
    Object.entries(variables).forEach(([name, base]) => setPx(name, base));
  }

  function renderPreview() {
    const preview = $('document-preview');
    preview.classList.toggle('dav-preview-active', usesDavDocument());
    applyPreviewScale(preview);
    preview.innerHTML = buildPreviewHtml();
  }

  function renderPreviewIfVisible() {
    if (state.activeTab === 'documento') renderPreview();
  }

  function renderHistoryValue(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (_) { return String(value); }
    }
    return String(value);
  }

  function renderHistory(history) {
    $('budget-history').innerHTML = (history || []).map((item) => {
      const changes = Array.isArray(item.dados?.alteracoes) ? item.dados.alteracoes : [];
      const details = changes.length ? `<details class="history-details"><summary>${changes.length} ${changes.length === 1 ? 'alteração' : 'alterações'}</summary>${changes.map((change) => {
        const label = change.nome || change.campo_nome || change.campo || 'Informação';
        const before = change.anterior ?? change.valor_anterior;
        const after = change.novo ?? change.valor_novo;
        return `<div class="history-change"><strong>${escapeHtml(change.secao || 'Geral')} • ${escapeHtml(label)}</strong><span><del>${escapeHtml(renderHistoryValue(before))}</del><i class="fa-solid fa-arrow-right"></i><ins>${escapeHtml(renderHistoryValue(after))}</ins></span></div>`;
      }).join('')}</details>` : '';
      const parsedDate = item.criado_em ? new Date(item.criado_em) : null;
      const dateLabel = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toLocaleString('pt-BR') : '';
      return `<article class="history-item"><strong>${escapeHtml(item.usuario_nome || 'Sistema')} • ${escapeHtml((item.acao || '').replaceAll('_', ' '))}</strong><p>${escapeHtml(item.descricao || '')}</p>${details}${dateLabel ? `<small>${escapeHtml(dateLabel)}</small>` : ''}</article>`;
    }).join('') || '<div class="empty-state">O histórico será criado ao salvar o orçamento.</div>';
  }


