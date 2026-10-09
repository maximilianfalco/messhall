import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INSTRUCTIONS_MAX_CHARS } from '../../contracts/room.ts';
import { SPAWN_RATE_MAX, SPAWN_SEAT_CAP } from '../../src/config.js';
import { keepsDyingLine } from '../../src/flock/heal.js';
import { PROFILES_DIR } from '../../src/flock/spawner.js';
import { REPO_ROOT } from '../../tools/dev/lib/paths.js';
import { DEFAULT_REVIEWER } from '../../tools/dev/lib/spawn.js';

const BRIEFS = path.join(REPO_ROOT, 'docs', 'briefs');

describe('example role briefs', () => {
  it.each(readdirSync(BRIEFS))('%s fits in assign_role instructions', file => {
    expect(readFileSync(path.join(BRIEFS, file), 'utf8').trim().length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });
});

describe('worker brief', () => {
  const worker = readFileSync(path.join(BRIEFS, 'worker.md'), 'utf8');

  it('names the default reviewer that spawn --reviewer swaps out', () => {
    expect(worker).toContain(`@${DEFAULT_REVIEWER}`);
  });

  it('idles on the doorbell for a reviewer but loops wait for a human merge, which rings nothing', () => {
    expect(worker).toContain('Waiting on a reviewer: end your turn and let the doorbell ring you.');
    expect(worker).toContain('call `wait` in a loop and run `gh pr view <n> --json state` each time it returns');
  });

  it('leaves the room last, right after the done line', () => {
    expect(worker.trim()).toMatch(
      /post with `done: true` and the PR url, then call `leave` with a one line note\. .*do it last\.$/,
    );
  });
});

describe('progress on the seat', () => {
  it.each(['worker.md', 'reviewer.md'])('%s sends progress to set_status, not the room', file => {
    const brief = readFileSync(path.join(BRIEFS, file), 'utf8');

    expect(brief).toContain('`set_status`');
    expect(brief).not.toContain('Post one short line in the room at each point');
  });
});

describe('agreements', () => {
  it('worker.md sends a cross-boundary contract through propose and confirm', () => {
    const worker = readFileSync(path.join(BRIEFS, 'worker.md'), 'utf8');

    expect(worker).toContain('goes through `propose`, and the agents it names `confirm` or `reject` it');
  });
});

describe('worktree removal', () => {
  const docs = [
    path.join(BRIEFS, 'reviewer.md'),
    path.join(REPO_ROOT, '.claude', 'skills', 'messhall-pickup-any-work', 'SKILL.md'),
  ];

  it.each(docs)('%s cleans the app build before each git worktree remove', file => {
    const removals = readFileSync(file, 'utf8')
      .split('\n')
      .filter(line => line.includes('git worktree remove'));

    expect(removals.length).toBeGreaterThan(0);
    removals.forEach(line => expect(line).toMatch(/make app-clean WORKTREE=\S+.*(&&|;) git worktree remove/));
  });
});

describe('orchestrator brief models', () => {
  const orchestrator = readFileSync(path.join(BRIEFS, 'orchestrator.md'), 'utf8');

  it('spawns menial jobs on sonnet and hard or CRITICAL.md jobs on opus', () => {
    expect(orchestrator).toContain('`model: sonnet`');
    expect(orchestrator).toContain('`model: opus`');
    expect(orchestrator).toContain('CRITICAL.md');
  });

  it('keeps reviewers on opus and haiku off by default', () => {
    expect(orchestrator).toContain('Reviewers always run on opus');
    expect(orchestrator).toContain('No haiku');
  });

  it('names the model and why in the spawn line it posts', () => {
    expect(orchestrator).toContain('model and why');
  });
});

describe('orchestrator brief run', () => {
  const orchestrator = readFileSync(path.join(BRIEFS, 'orchestrator.md'), 'utf8');

  it('plans the team from the topic and the human first line', () => {
    expect(orchestrator).toMatch(/the room's topic \(`list_rooms` shows it.*\) plus the human's first line/);
    expect(orchestrator).toContain('one reviewer for every one or two workers');
  });

  it('spawns each seat itself with a role and instructions, reviewers first', () => {
    expect(orchestrator).toContain(
      '`spawn` each seat: `name`, `role`, `instructions`, `cwd`, `model`. Reviewers first',
    );
    expect(orchestrator).not.toContain('messhall-dev spawn');
  });

  it('asks the human to start an agent in a folder spawn calls untrusted', () => {
    expect(orchestrator).toMatch(/untrusted folder.*`ask_human`/);
  });

  it('quotes the line messhall posts when a seat keeps dying', () => {
    const quoted = '@human <name> keeps dying';

    expect(orchestrator).toContain(`\`${quoted}\``);
    expect(keepsDyingLine({ name: '<name>', room: 'dev' })).toMatch(new RegExp(`^${quoted}`));
  });

  it('wraps up by kicking the seats it spawned, then posting what shipped', () => {
    expect(orchestrator).toMatch(/`kick` every seat you spawned.*then post one wrap-up line.*what shipped/s);
  });

  it('leaves after its wrap-up, since a room the human made stays open', () => {
    expect(orchestrator).toContain(
      'A room the human made stays open until the human closes it. `leave` after it either way.',
    );
    expect(orchestrator).not.toContain('Hold the seat for questions');
  });

  it('plans within the spawn seat cap and rate', () => {
    expect(orchestrator).toContain(`At most ${SPAWN_SEAT_CAP} spawned seats, reviewers counted`);
    expect(orchestrator).toContain(`at most ${SPAWN_RATE_MAX} spawns a minute`);
  });

  it('gives workers written from scratch the human rules from worker.md', () => {
    expect(orchestrator).toContain('never ask the human to approve or run a command');
    expect(orchestrator).toContain('never merge a PR on a `CRITICAL.md` tree');
  });
});

describe('role settings profiles', () => {
  const permissions = (role: string) =>
    (
      JSON.parse(readFileSync(path.join(BRIEFS, `${role}.settings.json`), 'utf8')) as {
        permissions: { allow: string[]; deny?: string[] };
      }
    ).permissions;
  const allowed = (role: string) => permissions(role).allow;

  it('gives a worker its build tools and the plan file', () => {
    expect(allowed('worker')).toStrictEqual(
      expect.arrayContaining([
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'Skill',
        'Agent',
        'TodoWrite',
        'Read(//**/personal-dev-notes.md)',
      ]),
    );
  });

  it.each(['Bash', 'Bash(*)', 'Bash(:*)'])('never allows a worker every command with %s', rule => {
    expect(allowed('worker')).not.toContain(rule);
  });

  it('allows a worker only named commands, none that end in a bare wildcard on a shell or an api call', () => {
    const bash = allowed('worker').filter(rule => rule.startsWith('Bash('));
    expect(bash).toStrictEqual(
      expect.arrayContaining(['Bash(pnpm:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(gh pr view:*)']),
    );
    expect(bash.filter(rule => /^Bash\((sh|bash|zsh|gh api|git push|curl|python3?|node):/.test(rule))).toStrictEqual(
      [],
    );
  });

  it('denies a worker gh pr merge and any force push', () => {
    expect(permissions('worker').deny).toStrictEqual(
      expect.arrayContaining(['Bash(gh pr merge:*)', 'Bash(git push --force:*)', 'Bash(git push -f:*)']),
    );
  });

  it('denies a worker a bare tmux kill-server, which inside a seat ends every agent on the real server', () => {
    expect(permissions('worker').deny).toContain('Bash(tmux kill-server:*)');
  });

  it('lets a worker ship its job branch but merge only through the veto check', () => {
    expect(allowed('worker')).toStrictEqual(
      expect.arrayContaining([
        'Bash(git push -u origin HEAD)',
        'Bash(git push)',
        'Bash(gh pr create:*)',
        'Bash(gh pr edit:*)',
        'Bash(pnpm -s messhall-dev qa-upload:*)',
        'Bash(pnpm -s messhall-dev merge:*)',
        'Bash(python3 .claude/skills/messhall-pickup-any-work/scripts/queue.py done:*)',
      ]),
    );
  });

  it('lets a worker push only its own branch, with no room for a force flag or another refspec', () => {
    expect(
      allowed('worker')
        .filter(rule => rule.startsWith('Bash(git push'))
        .filter(rule => rule.includes('*')),
    ).toStrictEqual([]);
  });

  it('never lets a worker run gh pr merge itself, which skips the veto label', () => {
    expect(allowed('worker').filter(rule => rule.includes('gh pr merge'))).toStrictEqual([]);
  });

  it('lets a reviewer post its GitHub review', () => {
    expect(allowed('reviewer')).toStrictEqual(['Bash(gh api repos/*/pulls/*/reviews:*)']);
  });

  it('sit where the spawner looks for them', () => {
    expect(PROFILES_DIR).toBe(BRIEFS);
  });
});
