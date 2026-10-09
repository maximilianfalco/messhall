import path from 'node:path';

// Codex subcommands that are not a TUI a user types into.
const NOT_TUI = new Set([
  'a',
  'agents',
  'app',
  'app-server',
  'apply',
  'archive',
  'completion',
  'debug',
  'delete',
  'doctor',
  'e',
  'exec',
  'login',
  'logout',
  'mcp',
  'mcp-server',
  'plugin',
  'queue',
  'remote-control',
  'review',
  'sandbox',
  'update',
]);
// Any of these starts codex embedded, off the shared daemon, so no doorbell reaches it.
const EMBEDDED_FLAGS = ['-c', '--config', '--enable', '--disable', '--search', '--no-daemon'];

/** Codex TUIs in `ps -axo pid,args` output, each with the flag that made it embedded, or null. */
export function codexTuis(ps: string) {
  return ps
    .split('\n')
    .slice(1)
    .flatMap(line => {
      const [pid, bin, ...args] = line.trim().split(/\s+/);
      if (!pid || !bin || path.basename(bin) !== 'codex' || NOT_TUI.has(args[0] ?? '')) return [];
      const flag = EMBEDDED_FLAGS.find(name => args.some(arg => arg === name || arg.startsWith(`${name}=`)));
      return [{ flag: flag ?? null, pid: Number(pid) }];
    });
}
