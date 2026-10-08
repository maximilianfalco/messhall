import type { DemoCheck, DemoRole } from '../lib/demoCheck.js';
import type { Command } from 'commander';

import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

import { KEY_FILES } from '../../../src/daemon/keys.js';
import { typePrompt, untypedLine, until } from '../../../src/flock/tmux.js';
import { shellLine } from '../../../src/lib/shell.js';
import { claudeArgv, launchClaude, pane, tmux, writeMcpConfig } from '../lib/claudeTmux.js';
import {
  DEMO_ALLOWED_TOOLS,
  DEMO_ROLES,
  DEMO_ROOM,
  demoChecks,
  demoPrompt,
  readRoom,
  repoTest,
  tokenUsage,
  writeDemoRepo,
} from '../lib/demoCheck.js';
import { bad, dim, formatTable, ok } from '../lib/print.js';

import { spawnDaemon } from './daemon.js';
import { roomReport } from './room.js';

const DEFAULT_PORT = 7792;
const DEFAULT_TIMEOUT_S = 240;
const PANE_LINES = 12;
const TRANSCRIPT_LIMIT = 60;

interface DemoOptions {
  agents?: number;
  dryRun: boolean;
  home?: string;
  keep: boolean;
  launch?: typeof launchClaude;
  port: number;
  timeoutS: number;
}

interface Step extends DemoCheck {
  ms?: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// Claude Code keeps each session's jsonl under a folder named after the cwd with every odd char as a dash.
function sessionUsage(cwd: string) {
  const dir = path.join(
    process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'),
    'projects',
    cwd.replaceAll(/[^a-zA-Z0-9]/g, '-'),
  );
  if (!existsSync(dir)) return tokenUsage('');
  const text = readdirSync(dir)
    .filter(file => file.endsWith('.jsonl'))
    .map(file => readFileSync(path.join(dir, file), 'utf8'))
    .join('\n');
  return tokenUsage(text);
}

async function timed(name: string, work: () => Promise<Omit<DemoCheck, 'name'>>): Promise<Step> {
  const started = Date.now();
  const outcome = await work();
  return { ...outcome, ms: Date.now() - started, name };
}

function formatSteps(steps: Step[]) {
  return formatTable(
    ['step', 'status', 'time', 'detail'],
    steps.map(step => [
      step.name,
      step.pass ? ok('pass') : bad('fail'),
      step.ms === undefined ? '' : seconds(step.ms),
      step.detail,
    ]),
  );
}

interface Live {
  argv: (role: DemoRole) => string[];
  debugFile: (role: DemoRole) => string;
  home: string;
  launch: typeof launchClaude;
  note: (line: string) => void;
  repo: (role: DemoRole) => string;
  session: (role: DemoRole) => string;
  timeoutS: number;
}

/** Starts both claudes, types the prompts, waits for both to join and the room to close, then runs both tests. */
async function liveRun({ argv, debugFile, home, launch, note, repo, session, timeoutS }: Live) {
  const steps: Step[] = [];
  const launched = await Promise.all(
    DEMO_ROLES.map(role =>
      timed(`claude ${role} ready`, async () => {
        const ready = await launch({
          argv: argv(role),
          cwd: repo(role),
          debugFile: debugFile(role),
          note,
          session: session(role),
        });
        return { detail: ready === 'registered' ? 'channel registered' : ready, pass: ready === 'registered' };
      }),
    ),
  );
  steps.push(...launched);
  if (launched.some(step => !step.pass)) return steps;

  const prompted = Date.now();
  const deadline = prompted + timeoutS * 1000;
  const typed = await Promise.all(
    DEMO_ROLES.map(role =>
      timed(`${role} prompt sent`, async () => {
        const outcome = await typePrompt(session(role), demoPrompt(role));
        if (outcome === 'sent') return { detail: 'input box empty', pass: true };
        return { detail: untypedLine(session(role), outcome), pass: false };
      }),
    ),
  );
  steps.push(...typed);
  if (typed.some(step => !step.pass)) return steps;
  note('both prompts typed');

  const joined = await until(deadline, () => {
    const state = readRoom({ dataDir: home, name: DEMO_ROOM });
    return DEMO_ROLES.every(role => state?.members.some(member => member.name === role)) ? true : undefined;
  });
  steps.push({
    detail: joined ? DEMO_ROLES.join(', ') : 'not both',
    ms: Date.now() - prompted,
    name: 'both joined',
    pass: Boolean(joined),
  });
  if (!joined) return steps;

  const closed = await until(deadline, () =>
    readRoom({ dataDir: home, name: DEMO_ROOM })?.room.closed ? true : undefined,
  );
  steps.push({
    detail: closed ? 'closed' : `still open after ${timeoutS} s`,
    ms: Date.now() - prompted,
    name: 'room closed',
    pass: Boolean(closed),
  });
  steps.push(
    ...(await Promise.all(
      DEMO_ROLES.map(role =>
        timed(`${role} test passes`, async () => {
          const result = await repoTest(repo(role));
          return { detail: result.code === 0 ? 'green' : 'still red', pass: result.code === 0 };
        }),
      ),
    )),
  );
  return steps;
}

/** Two real Claude Code sessions in two temp repos fix a contract change by talking in one room, then the room and repos are checked. */
export async function demoRun({
  agents = DEMO_ROLES.length,
  dryRun,
  home: homeOption,
  keep,
  launch = launchClaude,
  port,
  timeoutS,
}: DemoOptions) {
  if (agents !== DEMO_ROLES.length) {
    return { code: 1, report: bad(`only ${DEMO_ROLES.length} agents for now (${DEMO_ROLES.join(' and ')})`) };
  }
  const began = Date.now();
  const home = homeOption || mkdtempSync(path.join(tmpdir(), 'messhall-demo-'));
  const work = realpathSync(mkdtempSync(path.join(tmpdir(), 'messhall-demo-repos-')));
  const repo = (role: DemoRole) => path.join(work, role);
  const session = (role: DemoRole) => `messhall-demo-${port}-${role}`;
  const debugFile = (role: DemoRole) => path.join(home, `demo-${role}-debug.log`);
  const mcpConfig = path.join(home, 'demo-mcp.json');
  const argv = (role: DemoRole) =>
    claudeArgv({ allowedTools: DEMO_ALLOWED_TOOLS, debugFile: debugFile(role), mcpConfig });
  const steps: Step[] = [];
  const lines: string[] = [];
  const note = (line: string) => {
    lines.push(line);
    console.error(dim(line));
  };

  const daemon = await spawnDaemon({ detached: keep, home, port });
  steps.push({ detail: daemon.ok ? daemon.url : 'no daemon', name: 'daemon up', pass: daemon.ok });
  if (!daemon.ok) {
    rmSync(work, { force: true, recursive: true });
    return { code: 1, report: [formatSteps(steps), daemon.report].join('\n\n') };
  }
  const key = readFileSync(path.join(home, KEY_FILES.agent), 'utf8').trim();
  writeMcpConfig({ file: mcpConfig, key, url: daemon.url });

  steps.push(
    ...(await Promise.all(
      DEMO_ROLES.map(role =>
        timed(`${role} test fails first`, async () => {
          await writeDemoRepo({ dir: repo(role), role });
          const result = await repoTest(repo(role));
          return { detail: result.code === 0 ? 'passed, is the fixture broken?' : 'red', pass: result.code !== 0 };
        }),
      ),
    )),
  );

  note(`repos in ${work}`);

  const plan = DEMO_ROLES.flatMap(role => [
    dim(`${role}: cd ${repo(role)} && ${shellLine(argv(role))}`),
    dim(`${role} prompt: ${demoPrompt(role)}`),
  ]);
  if (dryRun) {
    lines.push(dim('dry run, no claude started. would run:'), ...plan);
  } else {
    steps.push(...(await liveRun({ argv, debugFile, home, launch, note, repo, session, timeoutS })));
  }

  const roomState = readRoom({ dataDir: home, name: DEMO_ROOM });
  const checks = roomState ? demoChecks({ ...roomState, roles: DEMO_ROLES }) : [];
  const failed = [...steps, ...checks].some(step => !step.pass);
  const report = [...lines, '', formatSteps(steps)];
  if (!dryRun) {
    report.push(
      '',
      checks.length
        ? formatTable(
            ['check', 'status', 'detail'],
            checks.map(check => [check.name, check.pass ? ok('pass') : bad('fail'), check.detail]),
          )
        : bad(`no room #${DEMO_ROOM}, nobody joined`),
      '',
      roomState ? roomReport({ dataDir: home, limit: TRANSCRIPT_LIMIT, name: DEMO_ROOM }).report : '',
      '',
      formatTable(
        ['agent', 'posts', 'model calls', 'tokens in', 'tokens out'],
        DEMO_ROLES.map(role => {
          const usage = sessionUsage(repo(role));
          const posts = roomState?.messages.filter(message => message.from === role).length ?? 0;
          return [role, String(posts), String(usage.calls), String(usage.input), String(usage.output)];
        }),
      ),
    );
    if (failed) {
      const screens = await Promise.all(DEMO_ROLES.map(role => pane(session(role))));
      screens.forEach((screen, index) => {
        const tail = screen.split('\n').filter(line => line.trim());
        report.push('', dim(`${DEMO_ROLES[index]} pane:`), ...tail.slice(-PANE_LINES));
      });
    }
  }
  report.push('', dim(`wall time ${seconds(Date.now() - began)}`));
  report.push(failed ? bad('demo failed') : ok(dryRun ? 'dry run set up' : 'demo passed'));

  if (keep) {
    report.push(
      dim(`left running: tmux attach -t ${session('api')}, daemon pid ${daemon.child.pid}, repos in ${work}`),
    );
    daemon.child.unref();
  } else {
    await Promise.all(DEMO_ROLES.map(role => tmux(['kill-session', '-t', session(role)])));
    await daemon.stop();
    rmSync(work, { force: true, recursive: true });
    if (homeOption) rmSync(mcpConfig, { force: true });
    else rmSync(home, { force: true, recursive: true });
  }
  return { code: failed ? 1 : 0, report: report.join('\n') };
}

/** Registers `demo [--agents 2] [--keep] [--dry-run] [--timeout 240]`. */
export function registerDemo(program: Command) {
  program
    .command('demo')
    .description(
      'Two real Claude Code sessions in two temp repos agree a contract change in one room, then the room and both tests are checked.',
    )
    .option('--agents <n>', 'how many agents, only 2 for now', String(DEMO_ROLES.length))
    .option('--keep', 'leave tmux, the daemon and the repos')
    .option('--dry-run', 'set up and print what would run, start no claude')
    .option('--timeout <s>', 'seconds from the prompts to the room closing', String(DEFAULT_TIMEOUT_S))
    .action(async (options: { agents: string; dryRun?: boolean; keep?: boolean; timeout: string }) => {
      const result = await demoRun({
        agents: Number(options.agents),
        dryRun: Boolean(options.dryRun),
        home: process.env.MESSHALL_HOME,
        keep: Boolean(options.keep),
        port: process.env.MESSHALL_PORT ? Number(process.env.MESSHALL_PORT) : DEFAULT_PORT,
        timeoutS: Number(options.timeout),
      });
      console.log(result.report);
      process.exitCode = result.code;
    });
}
