// /frontend/js/pages/produtos/base.js

/* =========================
   Estado / Constantes
========================= */

export const state = {
  produtos: [],
  produtoEditandoId: null,

  // movimentações temporárias do modal
  MOVIMENTACOES_ATUAIS: [],

  // Detecta se a API está funcionando
  API_OK: null
};

// Ajuste aqui se seu backend tiver outro path
export const API_PRODUTOS = '/api/produtos';

// Chave localStorage usada nessa tela
export const STORAGE_KEY = 'Valorapro_produtos_v4';

/* =========================
   DOM helpers
========================= */

export function getEl(id) {
  return document.getElementById(id);
}

export function setVal(id, v) {
  const el = getEl(id);
  if (!el) return;
  el.value = v ?? '';
}

export function getVal(id) {
  const el = getEl(id);
  if (!el) return '';
  return (el.value ?? '').toString().trim();
}

/* =========================
   Texto / Segurança
========================= */

export function escapeHTML(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// alias (pra não quebrar quando eu usei escapeHtml em um lugar)
export const escapeHtml = escapeHTML;

export function splitMultiText(v) {
  const s = String(v ?? '').trim();
  if (!s) return [];

  // aceita: "a|b|c" OU "a, b, c" OU "a; b; c"
  const parts = s.split(/[\|\;,]+/g).map(x => x.trim()).filter(Boolean);
  return parts;
}

/* =========================
   Boolean / Sim-Não
========================= */

export function isSim(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'sim' || s === 's' || s === 'true' || s === '1' || s === 'yes';
}

/* =========================
   Numbers helpers
========================= */

export function numOrNull(v) {
  if (v == null) return null;

  const s = String(v).trim();
  if (!s) return null;

  // aceita "1.234,56" e "1234.56"
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);

  if (Number.isNaN(n)) return null;
  return n;
}

export function intOrNull(v) {
  if (v == null) return null;

  const s = String(v).trim();
  if (!s) return null;

  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return null;
  return n;
}

/* =========================
   Datas
========================= */

export function toISODateTime() {
  // "2026-01-19T01:23:45"
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) +
    ':' + pad(d.getMinutes()) +
    ':' + pad(d.getSeconds())
  );
}

// recebe: "2026-01-19T03:00:00" OU "2026-01-19 03:00:00" e devolve "2026-01-19"
export function ymdFromBackendDateTime(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  // corta no "T" ou no espaço
  const p = s.split(/[T ]/g)[0];
  // valida simples YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  return '';
}

export function formatDateOnlyBR(ymd) {
  // "YYYY-MM-DD" -> "DD/MM/YYYY"
  const s = String(ymd ?? '').trim();
  if (!s) return '';
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

export function formatDateBR(v) {
  // tenta ler ISO, se não der, devolve o original
  const s = String(v ?? '').trim();
  if (!s) return '';

  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  } catch (_e) {}

  // fallback: se for "YYYY-MM-DD" devolve sem hora
  const ymd = ymdFromBackendDateTime(s);
  if (ymd) return `${formatDateOnlyBR(ymd)} 00:00`;

  return s;
}

/* =========================
   Debug
========================= */

export function logWarn(...args) {
  console.warn('[produtos]', ...args);
}
