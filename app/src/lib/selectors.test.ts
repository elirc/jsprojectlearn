/** Step keys, step links and roadmap completion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress } from './progress.ts';
import { moduleCompletion, nextStep, stepHref } from './selectors.ts';
import type { Module, Roadmap, Step } from './types.ts';
import { stepKey } from './types.ts';

const build: Step = { kind: 'build', project: 'js/01-fizzbuzz', title: 'FizzBuzz', minutes: 30 };
const guide: Step = { kind: 'guide', guide: 'http-fundamentals', title: 'HTTP', minutes: 20 };
const read: Step = { kind: 'read', doc: 'HANDBOOK.md', anchor: '#1-values-and-types', title: 'Values', minutes: 15 };
const drill: Step = { kind: 'drill', deck: 'js-fundamentals', count: 10, title: 'Drill' };
const tagged: Step = { ...drill, tags: ['strings', 'loops'] };

test('stepKey is module/kind:target for every kind, anchors and tags included', () => {
  assert.equal(stepKey('m-values', build), 'm-values/build:js/01-fizzbuzz');
  assert.equal(stepKey('m-http', guide), 'm-http/guide:http-fundamentals');
  assert.equal(stepKey('m-values', read), 'm-values/read:HANDBOOK.md#1-values-and-types');
  assert.equal(stepKey('m-values', { ...read, anchor: undefined }), 'm-values/read:HANDBOOK.md');
  assert.equal(stepKey('m-values', drill), 'm-values/drill:js-fundamentals');
  assert.equal(stepKey('m-values', tagged), 'm-values/drill:js-fundamentals|strings,loops');
});

test('stepHref returns router paths; ?step= is encoded and a read anchor stays last', () => {
  assert.equal(stepHref(build), '/project/js/01-fizzbuzz');
  assert.equal(stepHref(drill), '/drill/js-fundamentals?count=10');
  const key = stepKey('m-values', read);
  const href = stepHref(read, key);
  assert.equal(href, `/doc/HANDBOOK.md?step=${encodeURIComponent(key)}#1-values-and-types`);
  assert.ok(!href.slice(0, href.lastIndexOf('#')).includes('#'), 'the key\'s own # must be encoded');
  assert.equal(
    new URLSearchParams(href.slice(href.indexOf('?'), href.lastIndexOf('#'))).get('step'),
    key,
  );
});

test('stepHref for a tagged drill carries the tags and the step', () => {
  const key = stepKey('m-strings', tagged);
  const href = stepHref(tagged, key);
  const params = new URLSearchParams(href.slice(href.indexOf('?')));
  assert.ok(href.startsWith('/drill/js-fundamentals?'));
  assert.equal(params.get('count'), '10');
  assert.equal(params.get('tags'), 'strings,loops');
  assert.equal(params.get('step'), 'm-strings/drill:js-fundamentals|strings,loops');
});

test('moduleCompletion with no steps is 0, and ticks are found by key', () => {
  const empty: Module = { id: 'm-empty', title: 'Empty', why: '', steps: [] };
  assert.deepEqual(moduleCompletion(empty, emptyProgress()), { done: 0, total: 0, ratio: 0 });

  const mod: Module = { id: 'm-values', title: 'Values', why: '', steps: [read, build] };
  const progress = emptyProgress();
  progress.steps[stepKey('m-values', build)] = 1;
  assert.deepEqual(moduleCompletion(mod, progress), { done: 1, total: 2, ratio: 0.5 });

  const roadmap = {
    stages: [{ id: 's0', level: 0, title: 'S0', tagline: '', goal: '', outcome: '', hours: 1, modules: [mod] }],
  } as unknown as Roadmap;
  const next = nextStep(roadmap, progress);
  assert.equal(next?.key, 'm-values/read:HANDBOOK.md#1-values-and-types');
  assert.equal(next?.index, 0);
});

test('every migrated v1 tick lands on a real step of the current roadmap', async () => {
  // Reads the generated roadmap: run `npm run content` first.
  const { readFile } = await import('node:fs/promises');
  const legacy: Record<string, string> = JSON.parse(
    await readFile(new URL('./legacy-step-keys.json', import.meta.url), 'utf8'),
  );
  const roadmap: Roadmap = JSON.parse(
    await readFile(new URL('../../public/content/roadmap.json', import.meta.url), 'utf8'),
  );
  const keys = new Set(roadmap.stages.flatMap((s) => s.modules.flatMap((m) => m.steps.map((st) => stepKey(m.id, st)))));
  const missing = [...new Set(Object.values(legacy))].filter((key) => !keys.has(key)).sort();
  assert.deepEqual(missing, [], `legacy keys with no step on the roadmap:\n  ${missing.join('\n  ')}`);
});
