import { state } from './state.js';
import { salvarClienteNoServidor, carregarClientes } from './api.js';
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

function pickClientesForExport() {
  return (state.clientes || []).map((c) => ({
    id: c.id ?? null,
    codigo: c.codigo ?? '',
    nome: c.nome ?? '',
    whatsapp: c.whatsapp ?? '',
    email: c.email ?? '',
    custom_fields: normalizeCustomFieldsForExport(c.custom_fields),
  }));
}

function clientesToCSV(items) {
  const baseCols = ['codigo', 'nome', 'whatsapp', 'email'];
  const customCols = state.camposClientes.map((c) => c.slug);
  const cols = [...baseCols, ...customCols];
  const lines = [cols.join(';')];

  (items || []).forEach((c) => {
    const custom = normalizeCustomFieldsForExport(c.custom_fields);
    lines.push(
      cols
        .map((k) => {
          if (baseCols.includes(k)) return csvEscape(c?.[k] ?? '');
          return csvEscape(custom?.[k] ?? '');
        })
        .join(';')
    );
  });

  return '\ufeff' + lines.join('\n');
}

export function exportarClientesCSV() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  downloadFile(
    `clientes_${stamp}.csv`,
    clientesToCSV(pickClientesForExport()),
    'text/csv;charset=utf-8'
  );
  toast('Exportado CSV com sucesso.', 'success');
}

export function exportarClientesJSON() {
  const dt = new Date();
  const stamp = dt.toISOString().slice(0, 19).replaceAll(':', '-');
  const payload = {
    exported_at: dt.toISOString(),
    total: state.clientes.length,
    items: pickClientesForExport(),
  };

  downloadFile(
    `clientes_${stamp}.json`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  );
  toast('Exportado JSON com sucesso.', 'success');
}

function mapImportToPayload(obj) {
  const base = {
    codigo: String(obj.codigo || '').trim(),
    nome: String(obj.nome || '').trim(),
    whatsapp: String(obj.whatsapp || '').trim(),
    email: String(obj.email || '').trim(),
  };

  const custom_fields = {};
  for (const campo of state.camposClientes) {
    const slug = String(campo.slug || '').trim();
    if (!slug) continue;

    const value = obj[slug];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      custom_fields[slug] = value;
    }
  }

  if (Object.keys(custom_fields).length) {
    base.custom_fields = custom_fields;
  }

  return base;
}

function findExistingClienteIdByCodigoOrWhats(payload) {
  const codigo = String(payload?.codigo || '').trim().toLowerCase();
  const whatsapp = String(payload?.whatsapp || '').replace(/\D+/g, '');

  let found = null;

  if (codigo) {
    found = (state.clientes || []).find(
      (c) => String(c.codigo || '').trim().toLowerCase() === codigo
    );
    if (found?.id) return found.id;
  }

  if (whatsapp) {
    found = (state.clientes || []).find(
      (c) => String(c.whatsapp || '').replace(/\D+/g, '') === whatsapp
    );
    if (found?.id) return found.id;
  }

  return null;
}

async function importarClientesFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    toast('Arquivo vazio ou inválido.', 'error');
    return;
  }

  const ok = await confirmDialog({
    title: 'Importar clientes',
    message: `Importar ${items.length} cliente(s)? O sistema criará ou atualizará por código/WhatsApp.`,
    confirmText: 'Importar',
    cancelText: 'Cancelar',
  });
  if (!ok) return;

  toast('Importando clientes...', 'success');

  let okCount = 0;
  let failCount = 0;

  try {
    await carregarClientes();
  } catch {}

  for (const raw of items) {
    try {
      const payload = mapImportToPayload(raw);
      if (!payload.nome) {
        failCount += 1;
        continue;
      }

      const existingId = findExistingClienteIdByCodigoOrWhats(payload);
      await salvarClienteNoServidor(payload, existingId);
      okCount += 1;
    } catch {
      failCount += 1;
    }
  }

  try {
    await carregarClientes();
    await _afterImport();
  } catch {}

  if (failCount === 0) {
    toast(`Importação concluída: ${okCount} clientes adicionados.`, 'success');
  } else {
    toast(`Importado: ${okCount} sucesso • ${failCount} falhas`, 'error');
  }
}

export async function importarClientesArquivo(file) {
  if (!file) {
    toast('Selecione um arquivo para importar.', 'error');
    return;
  }

  const name = String(file.name || '').toLowerCase();

  try {
    if (name.endsWith('.json')) {
      const text = await readFileAsText(file);
      const data = JSON.parse(text || '{}');
      await importarClientesFromItems(
        Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []
      );
      return;
    }

    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      const text = await readFileAsText(file);
      await importarClientesFromItems(parseCSV(text));
      return;
    }

    if (name.endsWith('.xlsx')) {
      const buf = await readFileAsArrayBuffer(file);
      await importarClientesFromItems(parseXLSX(buf));
      return;
    }

    toast('Formato inválido. Use .JSON, .CSV ou .XLSX', 'error');
  } catch (err) {
    toast(err.message || 'Erro ao importar arquivo.', 'error');
  }
}

export function bindImportExport({ afterImport } = {}) {
  _afterImport = typeof afterImport === 'function' ? afterImport : async () => {};

  $('btn-importar-clientes')?.addEventListener('click', () => {
    $('input-importar-clientes')?.click();
  });

  $('input-importar-clientes')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    await importarClientesArquivo(file);
    e.target.value = '';
  });

  $('btn-exportar-clientes-csv')?.addEventListener('click', exportarClientesCSV);
}