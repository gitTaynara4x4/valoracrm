import { state } from './state.js?v=20260710-integridade-clientes-v1';
import {
  salvarClienteNoServidor,
  carregarClientes,
  verificarDuplicidadeCliente,
  obterClienteNoServidor,
} from './api.js?v=20260710-integridade-clientes-v1';
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
    cpf_cnpj: String(obj.cpf_cnpj || obj.documento || '').trim(),
    telefone: String(obj.telefone || '').trim(),
    whatsapp: String(obj.whatsapp || '').trim(),
    email: String(obj.email || '').trim(),
  };

  const custom_fields = {};
  for (const campo of state.camposClientes) {
    const slug = String(campo.slug || '').trim();
    if (!slug) continue;

    const value = obj[slug];
    if (value !== undefined && value !== null) {
      custom_fields[slug] = value;
    }
  }

  if (Object.keys(custom_fields).length) {
    base.custom_fields = custom_fields;
  }

  return base;
}

function mergeClienteExistenteComImportacao(existente, payload) {
  return {
    ...existente,
    ...payload,
    codigo: existente?.codigo || payload.codigo || '',
    nome: payload.nome || existente?.nome || '',
    enderecos: Array.isArray(existente?.enderecos) ? existente.enderecos : [],
    referencias_comerciais: Array.isArray(existente?.referencias_comerciais)
      ? existente.referencias_comerciais
      : [],
    referencias_bancarias: Array.isArray(existente?.referencias_bancarias)
      ? existente.referencias_bancarias
      : [],
    socios: Array.isArray(existente?.socios) ? existente.socios : [],
    ocorrencias: Array.isArray(existente?.ocorrencias) ? existente.ocorrencias : [],
    custom_fields: {
      ...(existente?.custom_fields || {}),
      ...(payload.custom_fields || {}),
    },
  };
}

async function localizarClienteExistenteNoServidor(payload) {
  const result = await verificarDuplicidadeCliente(payload);
  return result?.duplicado && result?.cliente?.id
    ? Number(result.cliente.id)
    : null;
}

async function importarClientesFromItems(items) {
  if (!Array.isArray(items) || !items.length) {
    toast('Arquivo vazio ou inválido.', 'error');
    return;
  }

  const ok = await confirmDialog({
    title: 'Importar clientes',
    message:
      `Importar ${items.length} cliente(s)? ` +
      'O sistema localizará existentes no banco inteiro por código, documento, e-mail ou telefone antes de criar.',
    confirmText: 'Importar',
    cancelText: 'Cancelar',
  });
  if (!ok) return;

  toast('Importando clientes...', 'success');

  let okCount = 0;
  let updatedCount = 0;
  let createdCount = 0;
  let failCount = 0;

  for (const raw of items) {
    try {
      const payload = mapImportToPayload(raw);
      if (!payload.nome) {
        failCount += 1;
        continue;
      }

      const existingId = await localizarClienteExistenteNoServidor(payload);

      if (existingId) {
        const existente = await obterClienteNoServidor(existingId);
        const merged = mergeClienteExistenteComImportacao(existente, payload);
        await salvarClienteNoServidor(merged, existingId);
        updatedCount += 1;
      } else {
        await salvarClienteNoServidor(payload, null);
        createdCount += 1;
      }

      okCount += 1;
    } catch (err) {
      console.error('[Clientes] falha na importação:', err);
      failCount += 1;
    }
  }

  try {
    await carregarClientes({ offset: 0 });
    await _afterImport();
  } catch (err) {
    console.warn('[Clientes] falha ao atualizar lista após importação:', err);
  }

  const resumo = `${createdCount} criado(s) • ${updatedCount} atualizado(s)`;
  if (failCount === 0) {
    toast(`Importação concluída: ${resumo}.`, 'success');
  } else {
    toast(`Importação: ${resumo} • ${failCount} falha(s).`, 'error');
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
