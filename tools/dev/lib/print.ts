import { stripVTControlCharacters } from 'node:util';

import pc from 'picocolors';

export const ok = (text: string) => pc.green(`✔ ${text}`);
export const bad = (text: string) => pc.red(`✖ ${text}`);
export const warn = (text: string) => pc.yellow(`! ${text}`);
export const dim = (text: string) => pc.dim(text);

// Colors add hidden codes, so widths are measured on the plain text.
const width = (text: string) => stripVTControlCharacters(text).length;

/** Formats rows as aligned columns under a bold header. */
export function formatTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map(row => width(row[index] ?? ''))));
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => cell + ' '.repeat(Math.max(0, widths[index]! - width(cell))))
      .join('  ')
      .trimEnd();
  return [pc.bold(line(headers)), ...rows.map(line)].join('\n');
}
