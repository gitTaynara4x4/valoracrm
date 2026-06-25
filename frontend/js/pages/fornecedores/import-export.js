import { state } from './state.js';
import { salvarFornecedorNoServidor, carregarFornecedores } from './api.js';
import {
  $,
  toast,
  downloadFile,
  csvEscape,
  normalizeCustomFieldsForExport,
  readFileAsText,
  readFileAsArrayBuffer,
  parseCSV,
  parseXLSX,
} from './utils.js';
import { confirmDialog } from './confirm.js';

let _afterImport = async () => {};

function pickFornecedoresForExport() {
  return (state.fornecedores || []).map((f) => ({
    id: f.id ?? null,
    codigo: f.codigo ?? '',
    tipo_fornecedor: f.tipo_fornecedor ?? '',
    situacao: f.situacao ?? '',
    nome: f.nome ?? '',
    nome_fantasia: f.nome_fantasia ?? '',
    cpf_cnpj: f.cpf_cnpj ?? '',
    telefone: f.telefone ?? '',
    whatsapp: f.whatsapp ?? '',
    email: f.email ?? '',
    cidade: f.cidade ?? '',
    estado: f.estado ?? '',
    custom_fields: normalizeCustomFieldsForExport(f.custom_fields),
  }));
}

function fornecedoresToCSV(items) {
  const baseCols = ['codigo','tipo_fornecedor','situacao','nome','nome_fantasia','cpf_cnpj','telefone','whatsapp','email','cidade','estado'];
  const customCols = state.camposFornecedores.map((c) => c.slug);
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  (items || []).forEach((f) => {
    const custom = normalizeCustomFieldsForExport(f.custom_fields);
    lines.push(
      cols.map((k) => {
        if (baseCols.includes(k)) return csvEscape(f?.[k] ?? '');
        return csvEscape(custom?.[k] ?? '');
      }).join(';')
    );
  });

  return '\ufeff' + lines.join('\n');
}

export function exportarFornecedoresCSV() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  downloadFile(`fornecedores_${stamp}.csv`, fornecedoresToCSV(pickFornecedoresForExport()), 'text/csv;charset=utf-8');
  toast('Exportado CSV com sucesso.', 'success');
}

export function exportarFornecedoresJSON() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  const payload = {
    exported_at: dt.toISOString(),
    total: state.fornecedores.length,
    items: pickFornecedoresForExport(),
  };

  downloadFile(`fornecedores_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  toast('Exportado JSON com sucesso.', 'success');
}

function mapImportToPayload(obj) {
  const base = {
    codigo: String(obj.codigo || '').trim(),
    tipo_fornecedor: String(obj.tipo_fornecedor || '').trim(),
    situacao: String(obj.situacao || 'ativo').trim(),
    nome: String(obj.nome || '').trim(),
    nome_fantasia: String(obj.nome_fantasia || '').trim(),
    cpf_cnpj: String(obj.cpf_cnpj || '').trim(),
    telefone: String(obj.telefone || '').trim(),
    whatsapp: String(obj.whatsapp || '').trim(),
    email: String(obj.email || '').trim(),
    cidade: String(obj.cidade || '').trim(),
    estado: String(obj.estado || '').trim(),
  };

  const custom_fields = {};
  for (const campo of state.camposFornecedores) {
    const slug = String(campo.slug || '').trim();
    if (!slug) continue;
    const value = obj[slug];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      custom_fields[slug] = value;
    }
  }

  if (Object.keys(custom_fields).length) base.custom_fields = custom_fields;
  return base;
}

function findExistingFornecedorIdByCodigoOrWhats(payload) {
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  const whatsapp = String(payload?.whatsapp || '').replace(/\D+/g, '');

  let found = null;

  if (codigo) {
    found = (state.fornecedores || []).find((f) => String(f.codigo || '').trim().toLowerCase() === codigo);
    if (found?.id) return found.id;
  }

  if (whatsapp) {
    found = (state.fornecedores || []).find((f) => String(f.whatsapp || '').replace(/\D+/g, '') === whatsapp);
    if (found?.id) return found.id;
  }

  return null;
}

async function importarFornecedoresFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    toast('Arquivo vazio ou inválido.', 'error');
    return;
  }

  const ok = await confirmDialog({
    title: 'Importar fornecedores',
    message: `Importar ${items.length} fornecedor(es)? O sistema tentará atualizar por código/WhatsApp quando encontrar; novos registros recebem código automático.`,
    confirmText: 'Importar',
    cancelText: 'Cancelar',
  });
  if (!ok) return;

  toast('Importando fornecedores...', 'success');

  let okCount = 0;
  let failCount = 0;

  try { await carregarFornecedores(); } catch {}

  for (const raw of items) {
    try {
      const payload = mapImportToPayload(raw);
      if (!payload.nome) {
        failCount += 1;
        continue;
      }

      const existingId = findExistingFornecedorIdByCodigoOrWhats(payload);
      await salvarFornecedorNoServidor(payload, existingId);
      okCount += 1;
    } catch {
      failCount += 1;
    }
  }

  try {
    await carregarFornecedores();
    await _afterImport();
  } catch {}

  if (failCount === 0) {
    toast(`Importação concluída: ${okCount} fornecedores adicionados.`, 'success');
  } else {
    toast(`Importado: ${okCount} sucesso • ${failCount} falhas`, 'error');
  }
}

export async function importarFornecedoresArquivo(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', 'error');
    return;
  }

  const name = String(file.name || '').toLowerCase();

  try {
    if (name.endsWith('.json')) {
      const text = await readFileAsText(file);
      const data = JSON.parse(text || '{}');
      await importarFornecedoresFromItems(
        Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      );
      return;
    }

    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = await readFileAsText(file);
      await importarFornecedoresFromItems(parseCSV(text));
      return;
    }

    if (name.endsWith('.xlsx')) {
      const buf = await readFileAsArrayBuffer(file);
      await importarFornecedoresFromItems(parseXLSX(buf));
      return;
    }

    toast('Formato inválido. Use .JSON, .CSV ou .XLSX', 'error');
  } catch (err) {
    toast(err.message || 'Erro ao importar arquivo.', 'error');
  }
}

export function bindImportExport({ afterImport } = {}) {
  _afterImport = typeof afterImport === 'function' ? afterImport : async () => {};

  $('btn-importar-fornecedores')?.addEventListener('click', () => {
    $('input-importar-fornecedores')?.click();
  });

  $('input-importar-fornecedores')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    await importarFornecedoresArquivo(file);
    e.target.value = '';
  });

  $('btn-exportar-fornecedores-csv')?.addEventListener('click', exportarFornecedoresCSV);
  $('btn-exportar-fornecedores-json')?.addEventListener('click', exportarFornecedoresJSON);
}