(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const state = { contas: [], planos: [], centros: [], movimentos: [], transferencias: [], tab: "extrato", transferKey: null };

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  };
  const monthStartISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
  };
  const money = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const dateBR = (v) => {
    if (!v) return "-";
    const [y,m,d] = String(v).slice(0,10).split("-");
    return y && m && d ? `${d}/${m}/${y}` : String(v);
  };
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const toNumber = (v) => {
    let s = String(v ?? "").trim().replace(/[^0-9,.-]/g, "");
    const c=s.lastIndexOf(","), p=s.lastIndexOf(".");
    if (c>=0 && p>=0) s = c>p ? s.replace(/\./g,"").replace(",",".") : s.replace(/,/g,"");
    else if (c>=0) s=s.replace(",",".");
    return Number(s || 0);
  };
  const uuid = () => window.crypto?.randomUUID?.() || `transf-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function request(url, options={}) {
    const cfg = { credentials: "include", headers: { Accept: "application/json", ...(options.headers||{}) }, ...options };
    if (cfg.body && typeof cfg.body !== "string") {
      cfg.headers["Content-Type"] = "application/json";
      cfg.body = JSON.stringify(cfg.body);
    }
    const res = await fetch(url, cfg);
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(data?.detail || data?.message || `HTTP ${res.status}`);
    return data;
  }

  function toast(msg, type="ok") {
    const el=$("#bank-toast"); if(!el) return;
    el.textContent=msg; el.className=`financeiro-toast is-${type}`; el.hidden=false;
    clearTimeout(el._t); el._t=setTimeout(()=>el.hidden=true,3500);
  }

  function setTab(name) {
    state.tab=name;
    $$('[data-bank-tab]').forEach(b=>b.classList.toggle('is-active',b.dataset.bankTab===name));
    $$('[data-bank-pane]').forEach(p=>{ const active=p.dataset.bankPane===name; p.classList.toggle('is-active',active); p.hidden=!active; });
  }

  function accountLabel(i) {
    const info=[i.banco, i.agencia ? `Ag. ${i.agencia}` : "", i.conta ? `Cc. ${i.conta}` : ""].filter(Boolean).join(" • ");
    return info ? `${i.nome} — ${info}` : i.nome;
  }

  function fillSelect(el, items, placeholder, mapLabel=accountLabel) {
    if(!el) return;
    const current=el.value;
    el.innerHTML=`<option value="">${esc(placeholder)}</option>`+items.map(i=>`<option value="${i.id}">${esc(mapLabel(i))}</option>`).join("");
    if([...el.options].some(o=>o.value===current)) el.value=current;
  }

  function preencherOpcoes() {
    fillSelect($("#bank-filtro-conta"), state.contas, "Todas as contas");
    ["conta_banco_id","conta_origem_id","conta_destino_id"].forEach(name => $$(`[name="${name}"]`).forEach(el=>fillSelect(el,state.contas,"Selecione...")));
    $$('[name="conta_contabil_id"]').forEach(el=>fillSelect(el,state.planos.filter(i=>i.ativo!==false && i.aceita_lancamento!==false),"Selecione...",i=>`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`));
    const principais=state.centros.filter(i=>!i.centro_pai_id && i.ativo!==false);
    $$('[name="centro_custo_principal_id"]').forEach(el=>fillSelect(el,principais,"Sem centro...",i=>`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`));
    atualizarCentrosSecundarios();
  }

  function atualizarCentrosSecundarios() {
    const form=$("#bank-form-lancamento"); if(!form) return;
    const pai=Number(form.elements.centro_custo_principal_id.value||0);
    const filhos=state.centros.filter(i=>Number(i.centro_pai_id||0)===pai && i.ativo!==false);
    fillSelect(form.elements.centro_custo_secundario_id, filhos, "Sem secundário...",i=>`${i.codigo ? `${i.codigo} - ` : ""}${i.nome}`);
    if(!pai) form.elements.centro_custo_secundario_id.value="";
  }

  async function carregarOpcoes() {
    const [contas, planos, centros] = await Promise.all([
      request('/api/financeiro/contas-bancos'), request('/api/financeiro/contas-contabeis'), request('/api/financeiro/centros-custo')
    ]);
    state.contas=Array.isArray(contas)?contas:[]; state.planos=Array.isArray(planos)?planos:[]; state.centros=Array.isArray(centros)?centros:[];
    preencherOpcoes();
  }

  function filtros() {
    return {
      conta_banco_id: $("#bank-filtro-conta")?.value || "",
      data_inicio: $("#bank-filtro-inicio")?.value || monthStartISO(),
      data_fim: $("#bank-filtro-fim")?.value || todayISO(),
      tipo: $("#bank-filtro-tipo")?.value || "",
    };
  }
  const query = (obj) => {
    const q=new URLSearchParams(); Object.entries(obj).forEach(([k,v])=>{if(v!==""&&v!=null)q.set(k,v)}); return q.toString()?`?${q}`:"";
  };

  function origemLabel(i) {
    if(i.origem==='titulo') return '<span class="financeiro-bank-origin is-auto"><i class="fa-solid fa-link"></i> Título</span>';
    if(i.origem==='manual') return '<span class="financeiro-bank-origin is-manual"><i class="fa-regular fa-pen-to-square"></i> Manual</span>';
    if(i.origem==='transferencia') return '<span class="financeiro-bank-origin is-transfer"><i class="fa-solid fa-right-left"></i> Transferência</span>';
    return '<span class="financeiro-bank-origin"><i class="fa-solid fa-wallet"></i> Saldo inicial</span>';
  }

  function renderExtrato(data) {
    state.movimentos=Array.isArray(data.movimentos)?data.movimentos:[];
    $("#bank-kpi-anterior").textContent=money(data.saldo_anterior);
    $("#bank-kpi-entradas").textContent=money(data.totais?.entradas);
    $("#bank-kpi-saidas").textContent=money(data.totais?.saidas);
    $("#bank-kpi-saldo").textContent=money(data.saldo_final);
    $("#bank-status-text").textContent=`${state.movimentos.length} movimento(s) • saldo ${money(data.saldo_final)}`;
    $("#bank-reconcile-text").textContent=data.conciliacao_caixa?.mensagem || 'Integrado ao Controle de Caixa.';
    const tbody=$("#bank-tbody-extrato");
    if(!state.movimentos.length){ tbody.innerHTML='<tr><td class="financeiro-empty" colspan="9">Nenhum movimento bancário no período.</td></tr>'; return; }
    tbody.innerHTML=state.movimentos.map(i=>{
      const entrada=i.tipo==='entrada';
      let action='<span class="financeiro-bank-linked"><i class="fa-solid fa-circle-check"></i> Caixa</span>';
      if(i.origem==='manual') action=`<button class="financeiro-mini-btn danger" type="button" data-cancel-manual="${i.id}"><i class="fa-solid fa-ban"></i> Cancelar</button>`;
      if(i.origem==='transferencia' && i.lado_transferencia==='origem') action=`<button class="financeiro-mini-btn danger" type="button" data-cancel-transfer="${i.transferencia_id}"><i class="fa-solid fa-ban"></i> Cancelar</button>`;
      return `<tr>
        <td>${dateBR(i.data)}</td>
        <td>${esc(i.documento||'-')}</td>
        <td><strong>${esc(i.historico||'-')}</strong><small>${esc(i.parceiro||'')}</small></td>
        <td>${esc(i.conta_banco_nome||'-')}</td>
        <td>${origemLabel(i)}</td>
        <td class="financeiro-amount financeiro-caixa-credit">${entrada?money(i.valor):'-'}</td>
        <td class="financeiro-amount financeiro-caixa-debit">${!entrada?money(i.valor):'-'}</td>
        <td class="financeiro-amount"><strong>${money(i.saldo)}</strong></td>
        <td>${action}</td>
      </tr>`;
    }).join('');
  }

  function renderTransferencias(items) {
    state.transferencias=Array.isArray(items)?items:[];
    const tbody=$("#bank-tbody-transferencias");
    if(!state.transferencias.length){tbody.innerHTML='<tr><td class="financeiro-empty" colspan="6">Nenhuma transferência no período.</td></tr>';return;}
    tbody.innerHTML=state.transferencias.map(t=>`<tr>
      <td>${dateBR(t.data_transferencia)}</td><td>${esc(t.conta_origem_nome||'-')}</td><td>${esc(t.conta_destino_nome||'-')}</td>
      <td>${esc(t.documento||'-')}</td><td class="financeiro-amount"><strong>${money(t.valor)}</strong></td>
      <td><button class="financeiro-mini-btn danger" type="button" data-cancel-transfer="${t.id}"><i class="fa-solid fa-ban"></i> Cancelar</button></td>
    </tr>`).join('');
  }

  async function carregar() {
    const f=filtros();
    const [extrato, transferencias] = await Promise.all([
      request(`/api/financeiro/movimento-bancario${query(f)}`),
      request(`/api/financeiro/transferencias${query({data_inicio:f.data_inicio,data_fim:f.data_fim,conta_banco_id:f.conta_banco_id})}`)
    ]);
    renderExtrato(extrato); renderTransferencias(transferencias);
  }

  async function salvarLancamento(ev) {
    ev.preventDefault(); const form=ev.currentTarget;
    const fd=new FormData(form);
    const body=Object.fromEntries(fd.entries());
    body.valor=toNumber(body.valor);
    body.conta_banco_id=Number(body.conta_banco_id);
    body.conta_contabil_id=Number(body.conta_contabil_id);
    body.centro_custo_principal_id=body.centro_custo_principal_id?Number(body.centro_custo_principal_id):null;
    body.centro_custo_secundario_id=body.centro_custo_secundario_id?Number(body.centro_custo_secundario_id):null;
    try{
      await request('/api/financeiro/movimento-bancario/lancamentos',{method:'POST',body});
      toast('Movimento bancário registrado e integrado ao Caixa.');
      form.reset(); form.elements.data_movimentacao.value=todayISO(); preencherOpcoes(); setTab('extrato'); await carregar();
    }catch(e){toast(e.message,'danger');}
  }

  async function salvarTransferencia(ev) {
    ev.preventDefault(); const form=ev.currentTarget; const fd=new FormData(form); const body=Object.fromEntries(fd.entries());
    body.conta_origem_id=Number(body.conta_origem_id); body.conta_destino_id=Number(body.conta_destino_id); body.valor=toNumber(body.valor);
    if(body.conta_origem_id===body.conta_destino_id) return toast('Origem e destino precisam ser contas diferentes.','danger');
    state.transferKey ||= uuid(); body.idempotency_key=state.transferKey;
    try{
      await request('/api/financeiro/transferencias',{method:'POST',body});
      state.transferKey=null; toast('Transferência realizada. Débito na origem e crédito no destino.');
      form.reset(); form.elements.data_transferencia.value=todayISO(); preencherOpcoes(); await carregar();
    }catch(e){toast(e.message,'danger');}
  }

  async function cancelarManual(id) {
    const motivo=window.prompt('Motivo do cancelamento deste movimento bancário:'); if(!motivo?.trim()) return;
    try{await request(`/api/financeiro/caixa/movimentos/${id}/cancelar`,{method:'PATCH',body:{motivo:motivo.trim()}});toast('Movimento cancelado.');await carregar();}catch(e){toast(e.message,'danger');}
  }
  async function cancelarTransfer(id) {
    const motivo=window.prompt('Motivo do cancelamento da transferência:'); if(!motivo?.trim()) return;
    try{await request(`/api/financeiro/transferencias/${id}/cancelar`,{method:'PATCH',body:{motivo:motivo.trim()}});toast('Transferência cancelada e saldos atualizados.');await carregar();}catch(e){toast(e.message,'danger');}
  }

  function exportarCSV() {
    if(!state.movimentos.length) return toast('Não há movimentos para exportar.','danger');
    const rows=[["Data","Documento","Histórico","Conta","Origem","Entrada","Saída","Saldo"]];
    state.movimentos.forEach(i=>rows.push([dateBR(i.data),i.documento||'',i.historico||'',i.conta_banco_nome||'',i.origem||'',i.tipo==='entrada'?Number(i.valor||0).toFixed(2):'',i.tipo==='saida'?Number(i.valor||0).toFixed(2):'',Number(i.saldo||0).toFixed(2)]));
    const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a');a.href=url;a.download=`movimento-bancario-${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
  }

  async function init() {
    $("#bank-filtro-inicio").value=monthStartISO(); $("#bank-filtro-fim").value=todayISO();
    $("#bank-form-lancamento").elements.data_movimentacao.value=todayISO(); $("#bank-form-transferencia").elements.data_transferencia.value=todayISO();
    $$('[data-bank-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.bankTab)));
    $$('[data-bank-tab-open]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.bankTabOpen)));
    $("#bank-btn-aplicar").addEventListener('click',()=>carregar().catch(e=>toast(e.message,'danger')));
    $("#bank-btn-limpar").addEventListener('click',()=>{$("#bank-filtro-conta").value='';$("#bank-filtro-inicio").value=monthStartISO();$("#bank-filtro-fim").value=todayISO();$("#bank-filtro-tipo").value='';carregar().catch(e=>toast(e.message,'danger'));});
    $("#bank-form-lancamento").addEventListener('submit',salvarLancamento);
    $("#bank-form-transferencia").addEventListener('submit',salvarTransferencia);
    $("#bank-form-lancamento").elements.centro_custo_principal_id.addEventListener('change',atualizarCentrosSecundarios);
    $("#btn-exportar-extrato").addEventListener('click',exportarCSV);
    document.addEventListener('click',e=>{const m=e.target.closest('[data-cancel-manual]');if(m)cancelarManual(m.dataset.cancelManual);const t=e.target.closest('[data-cancel-transfer]');if(t)cancelarTransfer(t.dataset.cancelTransfer);});
    try{await carregarOpcoes();await carregar();}catch(e){toast(`Erro ao carregar Movimento Bancário: ${e.message}`,'danger');$("#bank-status-text").textContent='Falha ao carregar';}
  }
  document.addEventListener('DOMContentLoaded',init);
})();
