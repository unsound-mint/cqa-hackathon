/** Minimal RFC 4180 CSV. Excel in RU/KZ locales saves with ';', so the delimiter is detected from the header. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => header.split(d).length - 1;
  const best = ([',', ';', '\t'] as const).map((d) => [d, count(d)] as const).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export const toCsv = (rows: string[][]): string =>
  rows.map((r) => r.map((c) => (/[",;\n\r\t]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';
