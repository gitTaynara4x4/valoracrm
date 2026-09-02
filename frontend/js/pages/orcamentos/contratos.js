/*
 * ValoraCRM · Orçamentos · contratos.js
 * Contrato do cliente, geração e assinatura eletrônica.
 * Carregado por frontend/js/pages/orcamentos.js.
 */
  function renderContractClient(info = {}) {
    const generated = Boolean(info.gerado || info.status === 'gerado');
    const outdated = Boolean(info.desatualizado);
    const version = Number(info.versao || 0);
    $('contract-client-status-label').textContent = generated ? (outdated ? 'Atualização necessária' : 'Contrato gerado') : 'Pronto para gerar';
    $('contract-client-number').textContent = generated ? (info.numero || 'Contrato gerado') : 'Contrato ainda não gerado';
    $('contract-client-description').textContent = generated
      ? `Gerado ${info.gerado_em ? `em ${proposalDateTime(info.gerado_em)}` : ''}. O PDF desta versão fica preservado.`
      : 'O Valora usará exatamente a proposta aprovada e os dados concluídos pelo cliente.';
    $('contract-client-version').textContent = generated ? `Versão ${version || 1}` : 'Nova versão';
    $('contract-client-warning').classList.toggle('is-hidden', !outdated);
    $('btn-visualizar-contract-client').classList.toggle('is-hidden', !generated);
    $('btn-baixar-contract-client').classList.toggle('is-hidden', !generated);
    const generateButton = $('btn-gerar-contract-client');
    generateButton.innerHTML = generated
      ? '<i class="fa-solid fa-rotate"></i> Gerar nova versão'
      : '<i class="fa-solid fa-file-circle-check"></i> Gerar contrato';
    generateButton.dataset.regenerar = generated ? 'true' : 'false';
    if (generated) loadContractSignature().catch(() => {});
    else renderContractSignature({ status: 'nao_enviado' });
  }

  async function loadContractClient() {
    if (!state.currentId) return renderContractClient({});
    const info = await api(`${API}/${state.currentId}/contrato`);
    renderContractClient(info);
    if (state.current?.publicacao_cliente) {
      state.current.publicacao_cliente.contrato = {
        status: info.status,
        versao: info.versao,
        gerado_em: info.gerado_em,
      };
    }
    return info;
  }

  async function openContractClient() {
    if (!state.currentId || !state.current) return;
    if (state.current.publicacao_cliente?.status !== 'aprovado') {
      toast('A proposta precisa estar aprovada pelo cliente antes de gerar o contrato.', 'error');
      return;
    }
    if (state.current.publicacao_cliente?.cadastro_contrato?.status !== 'concluido') {
      toast('Aguarde o cliente concluir o Cadastro para Contrato.', 'error');
      return;
    }
    $('contract-client-budget-code').textContent = state.current.codigo || '—';
    $('contract-client-name').textContent = state.current.cliente_razao_social || state.current.cliente_nome || 'Cliente';
    $('contract-client-approved').textContent = state.current.publicacao_cliente?.aprovado_em
      ? `Aprovada em ${proposalDateTime(state.current.publicacao_cliente.aprovado_em)}`
      : 'Aprovada';
    $('contract-client-registration').textContent = state.current.publicacao_cliente?.cadastro_contrato?.concluido_em
      ? `Concluído em ${proposalDateTime(state.current.publicacao_cliente.cadastro_contrato.concluido_em)}`
      : 'Concluído';
    openOverlay('contract-client-modal');
    try {
      await loadContractClient();
    } catch (error) {
      renderContractClient({});
      toast(error.message || 'Não foi possível consultar o contrato.', 'error');
    }
  }

  async function generateContractClient() {
    if (!state.currentId) return;
    const button = $('btn-gerar-contract-client');
    const regenerar = button.dataset.regenerar === 'true';
    if (regenerar && !await budgetConfirm({
      title: 'Gerar nova versão do contrato',
      message: 'Gerar uma nova versão do contrato com os dados atuais do cliente? A versão anterior continuará registrada no histórico.',
      confirmText: 'Gerar nova versão',
      cancelText: 'Cancelar',
    })) return;
    try {
      setButtonLoading(button, true, regenerar ? 'Gerando nova versão...' : 'Gerando contrato...');
      const info = await api(`${API}/${state.currentId}/contrato/gerar`, {
        method: 'POST',
        body: JSON.stringify({ regenerar }),
      });
      renderContractClient(info);
      if (state.current?.publicacao_cliente) {
        state.current.publicacao_cliente.contrato = { status: info.status, versao: info.versao, gerado_em: info.gerado_em };
      }
      const topLabel = $('btn-gerar-contrato-cliente')?.querySelector('span');
      if (topLabel) topLabel.textContent = 'Contrato gerado';
      toast(regenerar ? `Contrato versão ${info.versao} gerado.` : 'Contrato gerado com sucesso.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível gerar o contrato.', 'error');
    } finally {
      setButtonLoading(button, false);
      const generated = button.dataset.regenerar === 'true';
      button.innerHTML = generated
        ? '<i class="fa-solid fa-rotate"></i> Gerar nova versão'
        : '<i class="fa-solid fa-file-circle-check"></i> Gerar contrato';
    }
  }

  function openContractPdf(download = false) {
    if (!state.currentId) return;
    const url = `${API}/${state.currentId}/contrato/pdf${download ? '?download=true' : ''}`;
    if (download) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function contractSignatureStatusInfo(status) {
    const map = {
      nao_enviado: ['Não enviado', 'neutral'],
      aguardando_assinatura: ['Aguardando assinatura', 'pending'],
      visualizado: ['Visualizado pelo cliente', 'viewed'],
      assinado: ['Assinado', 'signed'],
      cancelado: ['Solicitação cancelada', 'cancelled'],
    };
    return map[status] || [status || 'Não enviado', 'neutral'];
  }

  function renderContractSignature(info = {}) {
    const status = info.status || 'nao_enviado';
    const [label, cls] = contractSignatureStatusInfo(status);
    const panel = $('contract-signature-panel');
    if (panel) panel.classList.toggle('is-hidden', state.current?.publicacao_cliente?.contrato?.status !== 'gerado');
    $('contract-signature-status').textContent = label;
    $('contract-signature-chip').textContent = label;
    $('contract-signature-chip').className = `contract-signature-chip is-${cls}`;
    const desc = status === 'assinado'
      ? `Assinado ${info.assinado_em ? `em ${proposalDateTime(info.assinado_em)}` : ''}${info.assinante_nome ? ` por ${info.assinante_nome}` : ''}.`
      : status === 'visualizado'
        ? `O cliente visualizou esta versão${info.visualizado_em ? ` em ${proposalDateTime(info.visualizado_em)}` : ''}.`
        : status === 'aguardando_assinatura'
          ? `Disponível na Área do Cliente desde ${info.solicitada_em ? proposalDateTime(info.solicitada_em) : 'agora'}.`
          : status === 'cancelado'
            ? 'A solicitação anterior foi cancelada. Você pode enviar novamente esta mesma versão.'
            : 'Disponibilize esta versão na Área do Cliente para aceite eletrônico.';
    $('contract-signature-description').textContent = desc;
    const evidence = $('contract-signature-evidence');
    evidence?.classList.toggle('is-hidden', status !== 'assinado');
    $('contract-signature-id').textContent = info.assinatura_id ? `ID: ${info.assinatura_id}` : '—';
    $('contract-signature-hash').textContent = info.pdf_final_hash_sha256 || info.documento_hash_sha256 || '—';
    $('btn-enviar-assinatura-contract-client').classList.toggle('is-hidden', !info.pode_enviar);
    $('btn-cancelar-assinatura-contract-client').classList.toggle('is-hidden', !info.pode_cancelar);
    $('btn-pdf-assinado-contract-client').classList.toggle('is-hidden', !info.pdf_assinado_disponivel);
    const locked = ['aguardando_assinatura', 'visualizado', 'assinado'].includes(status);
    $('btn-gerar-contract-client').classList.toggle('is-hidden', locked);
  }

  async function loadContractSignature() {
    if (!state.currentId) return;
    const info = await api(`${API}/${state.currentId}/contrato/assinatura`);
    renderContractSignature(info);
    return info;
  }

  async function sendContractToSignature() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Enviar contrato para assinatura',
      message: 'Disponibilizar esta versão do contrato na Área do Cliente SEG para assinatura? Enquanto estiver aguardando assinatura ela ficará bloqueada para regeneração.',
      confirmText: 'Enviar para assinatura',
      cancelText: 'Cancelar',
    })) return;
    const button = $('btn-enviar-assinatura-contract-client');
    try {
      setButtonLoading(button, true, 'Enviando...');
      const info = await api(`${API}/${state.currentId}/contrato/assinatura/enviar`, { method: 'POST', body: '{}' });
      renderContractSignature(info);
      toast('Contrato disponibilizado na Área do Cliente SEG.');
      await loadBudgets();
    } catch (error) {
      toast(error.message || 'Não foi possível enviar para assinatura.', 'error');
    } finally {
      setButtonLoading(button, false);
      button.innerHTML = '<i class="fa-solid fa-signature"></i> Enviar para assinatura';
    }
  }

  async function cancelContractSignature() {
    if (!state.currentId) return;
    if (!await budgetConfirm({
      title: 'Cancelar assinatura',
      message: 'Cancelar a solicitação de assinatura desta versão?',
      confirmText: 'Cancelar solicitação',
      cancelText: 'Voltar',
      tone: 'danger',
    })) return;
    const button = $('btn-cancelar-assinatura-contract-client');
    try {
      setButtonLoading(button, true, 'Cancelando...');
      const info = await api(`${API}/${state.currentId}/contrato/assinatura/cancelar`, { method: 'POST', body: '{}' });
      renderContractSignature(info);
      toast('Solicitação de assinatura cancelada.');
    } catch (error) {
      toast(error.message || 'Não foi possível cancelar a solicitação.', 'error');
    } finally {
      setButtonLoading(button, false);
      button.innerHTML = '<i class="fa-solid fa-ban"></i> Cancelar solicitação';
    }
  }

  function openSignedContractPdf() {
    if (!state.currentId) return;
    window.open(`${API}/${state.currentId}/contrato/pdf-assinado`, '_blank', 'noopener,noreferrer');
  }

