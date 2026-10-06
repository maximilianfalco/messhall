import { describe, expect, it } from 'vitest';

import { featureMapReport, findDrift, parseFeatureMap } from '../../tools/dev/lib/featureMap.js';

const map = `# Map

## CLI (\`messhall\`)

| Feature | Reach | Does | Code | Status | Verify |
|---|---|---|---|---|---|
| messhall version | \`messhall --version\` | prints the version | \`src/cli.ts\`, \`src/config.ts\` | built | \`pnpm dev --version\` |
| messhall start | \`messhall start\` | starts the daemon | \`src/cli/start.ts\` | planned | \`pnpm messhall-dev daemon\` |

## Daemon

| Feature | Reach | Does | Code | Status | Verify |
|---|---|---|---|---|---|
| health | \`GET /health\` | says the daemon is up | \`src/daemon/health.ts\` | building | \`pnpm messhall-dev env\` |
| notes | n/a | not a feature row | | someday | |
`;

describe('parseFeatureMap', () => {
  it('reads one row per table line with a known status and keeps its section', () => {
    const rows = parseFeatureMap(map);

    expect(rows.map(row => [row.section, row.feature, row.status])).toStrictEqual([
      ['CLI (`messhall`)', 'messhall version', 'built'],
      ['CLI (`messhall`)', 'messhall start', 'planned'],
      ['Daemon', 'health', 'building'],
    ]);
  });

  it('extracts every backticked path from the code cell', () => {
    const rows = parseFeatureMap(map);

    expect(rows[0]?.code).toStrictEqual(['src/cli.ts', 'src/config.ts']);
  });
});

describe('findDrift', () => {
  it('reports built and building rows whose code is missing, and ignores planned rows', () => {
    const onDisk = new Set(['src/cli.ts']);

    const drift = findDrift(parseFeatureMap(map), file => onDisk.has(file));

    expect(drift).toStrictEqual([
      { feature: 'messhall version', missing: ['src/config.ts'] },
      { feature: 'health', missing: ['src/daemon/health.ts'] },
    ]);
  });
});

describe('featureMapReport', () => {
  it('fails with --check when a built row points at a missing path', () => {
    const result = featureMapReport({ check: true, exists: file => file === 'src/cli.ts', markdown: map });

    expect(result.code).toBe(1);
    expect(result.report).toContain('messhall version: src/config.ts');
  });

  it('passes when only planned rows point at missing paths', () => {
    const onDisk = new Set(['src/cli.ts', 'src/config.ts', 'src/daemon/health.ts']);

    const result = featureMapReport({ check: true, exists: file => onDisk.has(file), markdown: map });

    expect(result.code).toBe(0);
    expect(result.report).toContain('feature map matches the code');
  });

  it('reports drift without failing when --check is off', () => {
    const result = featureMapReport({ check: false, exists: () => false, markdown: map });

    expect(result.code).toBe(0);
    expect(result.report).toContain('2 rows point at code that does not exist');
  });

  it('counts rows by status', () => {
    const result = featureMapReport({ check: false, exists: () => true, markdown: map });

    expect(result.counts).toStrictEqual({ building: 1, built: 1, cut: 0, planned: 1 });
  });
});
