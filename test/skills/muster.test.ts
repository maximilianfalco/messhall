import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INSTRUCTIONS_MAX_CHARS } from '../../contracts/room.ts';
import { REPO_ROOT } from '../../tools/dev/lib/paths.js';

const MUSTER = path.join(REPO_ROOT, '.claude', 'skills', 'muster');
const skill = readFileSync(path.join(MUSTER, 'SKILL.md'), 'utf8');
const template = readFileSync(path.join(MUSTER, 'plan-template.md'), 'utf8');
const briefs = readFileSync(path.join(MUSTER, 'crew-briefs.md'), 'utf8');
const body = skill.replace(/^---\n[\s\S]*?\n---\n/, '');

describe('muster skill', () => {
  it('is named muster', () => {
    expect(skill).toMatch(/^---\nname: muster\n/);
  });

  it('credits its inspiration in one comment at the top of the body', () => {
    expect(body.trimStart().split('\n')[0]).toBe(
      "<!-- inspired by Matt Pocock's wayfinder and grilling skills (github.com/mattpocock/skills, MIT) -->",
    );
  });

  it('loads no other skill, so it runs on its own', () => {
    expect(skill).not.toMatch(/\.claude\/skills\/(?!muster\/)/);
    expect(skill).not.toMatch(/Skill tool/);
  });

  it('stays shorter than the wayfinder skill it borrows from', () => {
    expect(skill.split(/\s+/).length).toBeLessThan(2000);
  });

  it('spawns nobody before the human approves the build plan', () => {
    expect(skill).toContain('Nothing is spawned before the human approves the build plan.');
  });

  it('asks the human for the orchestrator role, which an agent cannot give itself', () => {
    expect(skill).toContain('`messhall role <room> <your name> orchestrator`');
  });

  it('never answers for the human or speaks as them', () => {
    expect(skill).toContain('Never answer a quiz for the human');
    expect(skill).toContain('no `messhall say`, no human key');
  });

  it('keeps the plan in the messhall data dir, not in a repo', () => {
    expect(skill).toContain('MESSHALL_HOME:-$HOME/Library/Application Support/messhall}/plans/<room>.md');
    expect(skill).toContain('Never put the plan in a repo.');
  });

  it('hands one untrusted repo to the human and keeps spawning the rest', () => {
    expect(skill).toContain('**Folder not trusted?**');
    expect(skill).toContain('carry on with the other seats');
  });

  it('caps the crew at 4 workers', () => {
    expect(skill).toContain('at most 4 workers at once');
  });
});

describe('muster plan template', () => {
  it('has the plan sections in order', () => {
    const headings = template.split('\n').filter(line => line.startsWith('## '));

    expect(headings).toStrictEqual([
      '## Done looks like',
      '## Settled',
      '## Questions',
      '## Still foggy',
      '## Not this time',
      '## Build plan',
    ]);
  });
});

describe('muster crew briefs', () => {
  const sections = briefs.split(/^## /m).slice(1);

  it('has a worker and a reviewer brief', () => {
    expect(sections.map(section => section.split('\n')[0])).toStrictEqual(['Worker', 'Reviewer']);
  });

  it.each(sections.map(section => [section.split('\n')[0], section]))(
    'the %s brief fits in spawn instructions with room to fill in',
    (_, section) => {
      expect(section.length).toBeLessThan(INSTRUCTIONS_MAX_CHARS / 2);
    },
  );

  it('merges a worker PR only after approval or a human go', () => {
    expect(briefs).toContain('Merge only after `approved @<you> <PR url>` or a `human` line that says go.');
  });
});
