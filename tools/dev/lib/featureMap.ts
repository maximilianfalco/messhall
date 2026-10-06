import { bad, dim, formatTable, ok } from './print.js';

export const FEATURE_STATUSES = ['planned', 'building', 'built', 'cut'] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

export interface FeatureRow {
  code: string[];
  feature: string;
  section: string;
  status: FeatureStatus;
}

const CODE_PATH = /`([^`]+)`/g;

const isStatus = (value: string): value is FeatureStatus => (FEATURE_STATUSES as readonly string[]).includes(value);

/** Reads every feature row out of the map. A row is a table line whose Status cell is a known status. */
export function parseFeatureMap(markdown: string) {
  let section = '';
  return markdown.split('\n').flatMap(line => {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      return [];
    }
    if (!line.startsWith('|')) return [];
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    const feature = cells[0];
    const status = cells[4];
    if (!feature || !status || !isStatus(status)) return [];
    const paths = Array.from((cells[3] ?? '').matchAll(CODE_PATH), match => match[1]!);
    const row: FeatureRow = { code: paths, feature, section, status };
    return [row];
  });
}

/** Rows marked built or building whose code paths are not on disk. */
export function findDrift(rows: FeatureRow[], exists: (path: string) => boolean) {
  return rows
    .filter(row => row.status === 'built' || row.status === 'building')
    .map(row => ({ feature: row.feature, missing: row.code.filter(path => !exists(path)) }))
    .filter(drift => drift.missing.length > 0);
}

/** Counts rows by status and lists drift. With `check`, drift is exit code 1. */
export function featureMapReport({
  check,
  exists,
  markdown,
}: {
  check: boolean;
  exists: (path: string) => boolean;
  markdown: string;
}) {
  const rows = parseFeatureMap(markdown);
  const counts: Record<FeatureStatus, number> = { building: 0, built: 0, cut: 0, planned: 0 };
  rows.forEach(row => {
    counts[row.status] += 1;
  });
  const summary = formatTable(
    ['status', 'features'],
    FEATURE_STATUSES.map(status => [status, String(counts[status])]),
  );
  const drift = findDrift(rows, exists);
  if (drift.length === 0) {
    return {
      code: 0,
      counts,
      report: `${summary}\n\n${ok('feature map matches the code')} ${dim(`(${rows.length} rows)`)}`,
    };
  }
  const lines = drift.map(item => `  ${item.feature}: ${item.missing.join(', ')}`);
  return {
    code: check ? 1 : 0,
    counts,
    report: [summary, '', bad(`${drift.length} rows point at code that does not exist`), ...lines].join('\n'),
  };
}
