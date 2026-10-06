import { describe, expect, it } from 'vitest';

import { refusal } from '../../src/daemon/guard.js';

const PORT = 7707;

describe('refusal', () => {
  it.each(['127.0.0.1', 'localhost', '127.0.0.1:7707', 'localhost:7707', 'LOCALHOST:7707'])('passes Host %s', host => {
    expect(refusal({ headers: { host }, port: PORT })).toBeUndefined();
  });

  it.each([
    'evil.example',
    'evil.example:7707',
    'localhost.evil.example',
    '127.0.0.1:8080',
    '127.0.0.2',
    '[::1]:7707',
    '0.0.0.0:7707',
    '',
  ])('refuses Host %j', host => {
    expect(refusal({ headers: { host }, port: PORT })).toBe('host');
  });

  it('refuses a request with no Host', () => {
    expect(refusal({ headers: {}, port: PORT })).toBe('host');
  });

  it.each(['https://evil.example', 'http://localhost:7707', 'null', ''])('refuses Origin %j', origin => {
    expect(refusal({ headers: { host: 'localhost:7707', origin }, port: PORT })).toBe('origin');
  });
});
