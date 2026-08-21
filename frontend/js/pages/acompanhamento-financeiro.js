(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { data: null };

  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);

  const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateBR = (value) => {
    if (!value) return '-';
    const raw = String(value).slice(0, 10);
    const [y, m, d] = raw.split('-');
    return y && m && d ? `${d}/${m}/${y}` : raw;
  };
  const todayISO = () => {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };
  const monthStartISO = () => `${todayISO().slice(0, 8)}01`;

  async function request(url) {
    const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    let payload = null;
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(payload?.detail || payload?.message || `Erro ${response.status}`);
    return payload;
  }

  function toast(message, type = 'ok') {
    const el = $('#acomp-toast');
    if (!el) return;
    el.textContent = message;
    el.className = `financeiro-toast is-${type}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 4200);
  }

  function queryString() {
    const q = new URLSearchParams();
    q.set('data_inicio', $('#acomp-data-inicio').value || monthStartISO());
    q.set('data_fim', $('#acomp-data-fim').value || todayISO());
    q.set('projecao_dias', $('#acomp-projecao-dias').value || '90');
    return q.toString();
  }

  function setMoney(id, value, { signed = false } = {}) {
    const el = $(id);
    if (!el) return;
    const number = Number(value || 0);
    el.textContent = money(number);
    if (signed) {
      el.classList.toggle('is-negative', number < 0);
      el.classList.toggle('is-positive', number > 0);
    }
  }

  function tipoBadge(tipo) {
    return tipo === 'pagar'
      ? '<span class="acomp-type is-pagar"><i class="fa-solid fa-arrow-up"></i> Pagar</span>'
      : '<span class="acomp-type is-receber"><i class="fa-solid fa-arrow-down"></i> Receber</span>';
  }

  function renderResumo(data) {
    const r = data.resumo || {};
    setMoney('#acomp-kpi-saldo-atual', r.saldo_atual, { signed: true });
    setMoney('#acomp-kpi-saldo-projetado', r.saldo_projetado_horizonte, { signed: true });
    setMoney('#acomp-kpi-recebido', r.recebido_periodo);
    setMoney('#acomp-kpi-pago', r.pago_periodo);
    setMoney('#acomp-kpi-receber-vencido', r.receber_vencido);
    setMoney('#acomp-kpi-receber-vencer', r.receber_a_vencer);
    setMoney('#acomp-kpi-pagar-vencido', r.pagar_vencido);
    setMoney('#acomp-kpi-pagar-vencer', r.pagar_a_vencer);
    setMoney('#acomp-resultado-realizado', r.resultado_realizado_periodo, { signed: true });
    setMoney('#acomp-total-receber', r.receber_aberto);
    setMoney('#acomp-total-pagar', r.pagar_aberto);
    $('#acomp-inadimplentes').textContent = Number(r.clientes_inadimplentes || 0).toLocaleString('pt-BR');
    $('#acomp-kpi-receber-vencido-meta').textContent = `${Number(r.qtd_receber_vencido || 0)} título(s)`;
    $('#acomp-kpi-pagar-vencido-meta').textContent = `${Number(r.qtd_pagar_vencido || 0)} título(s)`;
    $('#acomp-projecao-label').textContent = `Próximos ${data.periodo?.projecao_dias || 90} dias + vencidos`;
  }

  function renderProjecao(items) {
    const tbody = $('#acomp-tbody-projecao');
    if (!items?.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="5">Nenhum título aberto dentro do horizonte selecionado.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const final = Number(item.saldo_final || 0);
      return `<tr class="${item.competencia === 'vencidos' ? 'is-overdue-row' : ''}">
        <td><strong>${esc(item.label || item.competencia || '-')}</strong></td>
        <td class="financeiro-amount">${money(item.saldo_inicial)}</td>
        <td class="financeiro-amount acomp-money-in">${money(item.entradas)}</td>
        <td class="financeiro-amount acomp-money-out">${money(item.saidas)}</td>
        <td class="financeiro-amount"><strong class="${final < 0 ? 'acomp-negative' : ''}">${money(final)}</strong></td>
      </tr>`;
    }).join('');
  }

  function renderContas(items) {
    const tbody = $('#acomp-tbody-contas');
    if (!items?.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="5">Nenhuma conta corrente cadastrada.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const saldo = Number(item.saldo_atual || 0);
      const identificacao = [item.agencia, item.conta].filter(Boolean).join(' / ') || '-';
      return `<tr>
        <td><strong>${esc(item.nome || '-')}</strong></td>
        <td>${esc(item.banco || '-')}</td>
        <td>${esc(identificacao)}</td>
        <td><span class="acomp-status-pill ${item.ativo === false ? 'is-off' : ''}">${item.ativo === false ? 'Inativa' : 'Ativa'}</span></td>
        <td class="financeiro-amount"><strong class="${saldo < 0 ? 'acomp-negative' : ''}">${money(saldo)}</strong></td>
      </tr>`;
    }).join('');
  }

  function renderVencidos(items) {
    const tbody = $('#acomp-tbody-vencidos');
    $('#acomp-vencidos-count').textContent = String(items?.length || 0);
    if (!items?.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="6">Nenhum título vencido. A posição está em dia.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => `<tr>
      <td>${tipoBadge(item.tipo)}</td>
      <td><strong>${esc(item.parceiro || '-')}</strong><small>${esc(item.descricao || '')}</small></td>
      <td>${esc(item.documento || '-')}</td>
      <td>${dateBR(item.data_vencimento)}</td>
      <td><span class="acomp-delay">${Number(item.dias_atraso || 0)} dia(s)</span></td>
      <td class="financeiro-amount"><strong>${money(item.saldo_aberto)}</strong></td>
    </tr>`).join('');
  }

  function renderAVencer(items) {
    const tbody = $('#acomp-tbody-vencer');
    $('#acomp-vencer-count').textContent = String(items?.length || 0);
    if (!items?.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="6">Nenhum vencimento no horizonte selecionado.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const dias = Number(item.dias_para_vencer || 0);
      const prazo = dias === 0 ? 'Hoje' : `${dias} dia(s)`;
      return `<tr>
        <td>${tipoBadge(item.tipo)}</td>
        <td><strong>${esc(item.parceiro || '-')}</strong><small>${esc(item.descricao || '')}</small></td>
        <td>${esc(item.documento || '-')}</td>
        <td>${dateBR(item.data_vencimento)}</td>
        <td><span class="acomp-due ${dias <= 7 ? 'is-soon' : ''}">${prazo}</span></td>
        <td class="financeiro-amount"><strong>${money(item.saldo_aberto)}</strong></td>
      </tr>`;
    }).join('');
  }

  function movimentoMeta(item) {
    const estorno = item.tipo_movimentacao !== 'baixa';
    if (item.tipo === 'pagar') return estorno ? ['Estorno de pagamento', 'is-estorno'] : ['Pagamento', 'is-pagar'];
    return estorno ? ['Estorno de recebimento', 'is-estorno'] : ['Recebimento', 'is-receber'];
  }

  function renderMovimentos(items) {
    const tbody = $('#acomp-tbody-movimentos');
    if (!items?.length) {
      tbody.innerHTML = '<tr><td class="financeiro-empty" colspan="6">Nenhuma baixa ou estorno no período selecionado.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((item) => {
      const [label, klass] = movimentoMeta(item);
      return `<tr>
        <td>${dateBR(item.data_movimentacao)}</td>
        <td><span class="acomp-movement ${klass}">${esc(label)}</span></td>
        <td><strong>${esc(item.parceiro || '-')}</strong><small>${esc(item.descricao || '')}</small></td>
        <td>${esc(item.documento || '-')}</td>
        <td>${esc(item.conta_banco_nome || '-')}</td>
        <td class="financeiro-amount"><strong>${money(item.valor)}</strong></td>
      </tr>`;
    }).join('');
  }

  function render(data) {
    renderResumo(data);
    renderProjecao(data.projecao || []);
    renderContas(data.contas || []);
    renderVencidos(data.vencidos || []);
    renderAVencer(data.a_vencer || []);
    renderMovimentos(data.movimentos_periodo || []);
    const periodo = data.periodo || {};
    $('#acomp-periodo-label').textContent = `${dateBR(periodo.data_inicio)} a ${dateBR(periodo.data_fim)}`;
    $('#acomp-status').textContent = `Posição em ${dateBR(periodo.hoje)} • projeção até ${dateBR(periodo.projecao_ate)}`;
  }

  async function carregar() {
    const btn = $('#acomp-btn-atualizar');
    btn?.classList.add('is-loading');
    $('#acomp-status').textContent = 'Atualizando posição financeira...';
    try {
      const data = await request(`/api/financeiro/acompanhamento?${queryString()}`);
      state.data = data;
      render(data);
    } catch (error) {
      $('#acomp-status').textContent = 'Falha ao carregar';
      toast(`Erro ao carregar acompanhamento: ${error.message}`, 'danger');
      throw error;
    } finally {
      btn?.classList.remove('is-loading');
    }
  }

  function exportarCSV() {
    if (!state.data) return toast('Atualize os dados antes de exportar.', 'danger');
    const data = state.data;
    const rows = [
      ['ACOMPANHAMENTO FINANCEIRO'],
      ['Período realizado', `${dateBR(data.periodo?.data_inicio)} a ${dateBR(data.periodo?.data_fim)}`],
      ['Saldo atual', Number(data.resumo?.saldo_atual || 0).toFixed(2)],
      ['Saldo projetado', Number(data.resumo?.saldo_projetado_horizonte || 0).toFixed(2)],
      ['Recebido', Number(data.resumo?.recebido_periodo || 0).toFixed(2)],
      ['Pago', Number(data.resumo?.pago_periodo || 0).toFixed(2)],
      [],
      ['PROJEÇÃO'],
      ['Competência', 'Saldo inicial', 'Entradas', 'Saídas', 'Saldo projetado'],
      ...(data.projecao || []).map((i) => [i.label, i.saldo_inicial, i.entradas, i.saidas, i.saldo_final]),
      [],
      ['TÍTULOS VENCIDOS'],
      ['Tipo', 'Parceiro', 'Documento', 'Vencimento', 'Dias em atraso', 'Saldo'],
      ...(data.vencidos || []).map((i) => [i.tipo, i.parceiro, i.documento, dateBR(i.data_vencimento), i.dias_atraso, i.saldo_aberto]),
      [],
      ['PRÓXIMOS VENCIMENTOS'],
      ['Tipo', 'Parceiro', 'Documento', 'Vencimento', 'Dias para vencer', 'Saldo'],
      ...(data.a_vencer || []).map((i) => [i.tipo, i.parceiro, i.documento, dateBR(i.data_vencimento), i.dias_para_vencer, i.saldo_aberto]),
    ];
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `acompanhamento-financeiro-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function init() {
    $('#acomp-data-inicio').value = monthStartISO();
    $('#acomp-data-fim').value = todayISO();
    $('#acomp-btn-aplicar')?.addEventListener('click', () => carregar().catch(() => {}));
    $('#acomp-btn-atualizar')?.addEventListener('click', () => carregar().catch(() => {}));
    $('#acomp-btn-exportar')?.addEventListener('click', exportarCSV);
    $('#acomp-btn-imprimir')?.addEventListener('click', () => window.print());
    $('#acomp-projecao-dias')?.addEventListener('change', () => carregar().catch(() => {}));
    carregar().catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();
