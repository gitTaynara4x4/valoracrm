export function $(id) {
  return document.getElementById(id);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function formatTipoCampo(tipo) {
  const map = {
    texto: 'Texto curto',
    textarea: 'Texto longo',
    numero: 'Número',
    data: 'Data',
    select: 'Lista de opções',
    checkbox: 'Caixa de seleção',
  };
  return map[tipo] || tipo || '-';
}

export function toast(message, type = 'success', ms = 2600) {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type);
    return;
  }

  const el = $('valora-toast');
  if (!el) return;

  el.textContent = message || '';
  el.classList.remove('is-error');
  if (type === 'error') el.classList.add('is-error');

  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function openModal(id) {
  if (window.ValoraModal) return window.ValoraModal.open(id);
  const modal = $(id);
  if (!modal) return;
  modal.hidden = false;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));
}

export function closeModal(id) {
  if (window.ValoraModal) return window.ValoraModal.close(id);
  const modal = $(id);
  if (!modal) return;
  modal.classList.remove('show');
  setTimeout(() => { modal.hidden = true; modal.style.display = 'none'; }, 160);
}

export function downloadFile(filename, content, mime = 'application/octet-stream') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function csvEscape(value) {
  const s = String(value ?? '');
  const mustQuote = /[;\n\r"]/g.test(s);
  const out = s.replaceAll('"', '""');
  return mustQuote ? `"${out}"` : out;
}

export function normalizeCustomFieldsForExport(cf) {
  return cf && typeof cf === 'object' ? cf : {};
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Falha ao ler arquivo.'));
    fr.readAsArrayBuffer(file);
  });
}

export function detectCSVDelimiter(firstLine) {
  return (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
}

export function parseCSV(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n').filter((line) => line.trim().length);
  if (!lines.length) return [];

  const delim = detectCSVDelimiter(lines[0]);

  function parseLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === delim) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    out.push(cur);
    return out.map((s) => String(s ?? '').trim());
  }

  const headers = parseLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());
  const out = [];

  for (let i = 1; i < lines.length; i += 1) {
    const parts = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = parts[idx] ?? '';
    });
    out.push(obj);
  }

  return out;
}

export function parseXLSX(arrayBuffer) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Biblioteca XLSX não carregou.');
  }

  const wb = XLSX.read(arrayBuffer, { type: 'array' });

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const rows = (aoa || []).filter(
      (r) => Array.isArray(r) && r.some((v) => String(v ?? '').trim() !== '')
    );

    if (!rows.length) continue;

    const first = rows[0].map((v) => String(v ?? '').trim().toLowerCase());
    if (first.includes('codigo') || first.includes('nome') || first.includes('whatsapp') || first.includes('email')) {
      const headers = rows[0].map((v) => String(v ?? '').trim());
      return rows
        .slice(1)
        .map((r) => {
          const obj = {};
          headers.forEach((h, i) => {
            obj[h] = r[i] ?? '';
          });
          return obj;
        })
        .filter((obj) => Object.values(obj).some((v) => String(v ?? '').trim() !== ''));
    }

    const cols = ['codigo', 'nome', 'whatsapp', 'email'];
    return rows
      .map((r) => {
        const obj = {};
        cols.forEach((k, i) => {
          obj[k] = r[i] ?? '';
        });
        return obj;
      })
      .filter((obj) => String(obj.nome || obj.codigo || '').trim() !== '');
  }

  return [];
}