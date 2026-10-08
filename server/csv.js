// Minimal RFC 4180 CSV reader/writer (quoted fields, embedded commas, quotes and newlines).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// First row is the header; returns { headers, records: [{header: value}] }.
export function csvRecords(text) {
  const [headers = [], ...rest] = parseCsv(text);
  const clean = headers.map((h) => h.trim());
  return { headers: clean, records: rest.map((r) => Object.fromEntries(clean.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function toCsv(rows) {
  return rows.map((r) => r.map((v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // stop spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}
