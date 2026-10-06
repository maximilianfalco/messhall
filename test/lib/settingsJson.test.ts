import { describe, expect, it } from 'vitest';

import { parseSettings, readServer, withoutServer, withServer } from '../../src/lib/settingsJson.js';

const ENTRY = { httpUrl: 'http://127.0.0.1:7707/mcp' };

describe('parseSettings', () => {
  it('reads an empty file as no settings', () => {
    expect(parseSettings('  \n')).toStrictEqual({});
  });

  it.each([
    ['broken json', '{ "theme": '],
    ['json with comments', '{\n  // mine\n  "theme": "dark"\n}'],
    ['an array', '[]'],
    ['servers that are not an object', '{ "mcpServers": [] }'],
  ])('refuses %s', (_, text) => {
    expect(parseSettings(text)).toBeNull();
  });
});

describe('readServer', () => {
  it('finds the named server, or undefined', () => {
    const settings = { mcpServers: { messhall: ENTRY } };

    expect(readServer({ name: 'messhall', settings })).toStrictEqual(ENTRY);
    expect(readServer({ name: 'other', settings: {} })).toBeUndefined();
  });
});

describe('withServer', () => {
  it('adds the server next to the other keys and servers without touching the input', () => {
    const settings = { mcpServers: { other: { command: 'other' } }, theme: 'dark' };

    const text = withServer({ entry: ENTRY, name: 'messhall', settings });

    expect(JSON.parse(text)).toStrictEqual({
      mcpServers: { messhall: ENTRY, other: { command: 'other' } },
      theme: 'dark',
    });
    expect(text.endsWith('}\n')).toBe(true);
    expect(settings).toStrictEqual({ mcpServers: { other: { command: 'other' } }, theme: 'dark' });
  });
});

describe('withoutServer', () => {
  it('drops only the named server', () => {
    const settings = { mcpServers: { messhall: ENTRY, other: { command: 'other' } }, theme: 'dark' };

    const text = withoutServer({ name: 'messhall', settings });

    expect(JSON.parse(text)).toStrictEqual({ mcpServers: { other: { command: 'other' } }, theme: 'dark' });
    expect(settings.mcpServers.messhall).toStrictEqual(ENTRY);
  });
});
