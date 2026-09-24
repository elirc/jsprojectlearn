/** The roadmap checks the content build fails on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRoadmap } from './build-content.mjs';

const projects = [{ id: 'js/01-fizzbuzz' }, { id: 'js/03-rot13' }];
const q = (id, tags) => ({ id, tags });
const decks = [
  {
    id: 'js-fundamentals',
    questions: [q('a', ['strings']), q('b', ['strings']), q('c', ['loops']), q('d', [])],
  },
];
const guides = new Set(['how-to-use-devpath']);

const roadmap = (...modules) => ({ stages: [{ id: 's0', modules }] });
const mod = (id, steps) => ({ id, steps });
const build = (project) => ({ kind: 'build', project, title: 't', minutes: 1 });
const drill = (count, tags) => ({ kind: 'drill', deck: 'js-fundamentals', count, title: 't', tags });

test('a well-formed roadmap passes with no warnings', () => {
  const ok = roadmap(mod('m-a', [build('js/01-fizzbuzz'), build('js/03-rot13'), drill(2)]));
  assert.deepEqual(validateRoadmap(ok, projects, decks, guides), []);
});

test('a module id used twice fails, even across stages', () => {
  const twice = { stages: [{ id: 's0', modules: [mod('m-a', [])] }, { id: 's1', modules: [mod('m-a', [])] }] };
  assert.throws(() => validateRoadmap(twice, projects, decks, guides), /module id "m-a" is used in both s0 and s1/);
});

test('two steps with the same kind:target in one module fail', () => {
  const dup = roadmap(mod('m-a', [build('js/01-fizzbuzz'), build('js/01-fizzbuzz')]));
  assert.throws(() => validateRoadmap(dup, projects, decks, guides), /two steps are both "build:js\/01-fizzbuzz"/);
  // Same deck, different tags: different targets, so allowed.
  const tagged = roadmap(mod('m-a', [drill(1), drill(1, ['strings'])]));
  assert.doesNotThrow(() => validateRoadmap(tagged, projects, decks, guides));
});

test('a tag no question carries fails; a pool smaller than count fails; a thin pool warns', () => {
  const unknownTag = roadmap(mod('m-a', [drill(1, ['strings', 'recursion'])]));
  assert.throws(() => validateRoadmap(unknownTag, projects, decks, guides), /carries the tag "recursion"/);

  const tooFew = roadmap(mod('m-a', [drill(4, ['strings', 'loops'])]));
  assert.throws(() => validateRoadmap(tooFew, projects, decks, guides), /asks for 4 questions but only 3/);

  const thin = roadmap(mod('m-a', [drill(2, ['strings', 'loops'])]));
  const warnings = validateRoadmap(thin, projects, decks, guides);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /only 3 questions for a 2-question tagged drill/);
});

test('unknown projects, decks and guides still fail', () => {
  const bad = roadmap(
    mod('m-a', [
      build('js/99-nope'),
      { kind: 'drill', deck: 'nope', count: 1, title: 't' },
      { kind: 'guide', guide: 'nope', title: 't', minutes: 1 },
    ]),
  );
  assert.throws(
    () => validateRoadmap(bad, projects, decks, guides),
    (error) => /js\/99-nope/.test(error.message) && /deck "nope"/.test(error.message) && /nope\.md/.test(error.message),
  );
});

test('read steps: an unshipped doc fails, an anchor that is not a heading fails, a real heading passes', () => {
  const docs = new Map([['HANDBOOK.md', "# Handbook\n\n## 1. Values and types\n\n## The repo's big ideas\n"]]);
  const read = (doc, anchor) => ({ kind: 'read', doc, anchor, title: 't', minutes: 1 });

  const missing = roadmap(mod('m-a', [read('NOPE.md')]));
  assert.throws(() => validateRoadmap(missing, projects, decks, guides, docs), /"NOPE\.md", which is not a shipped doc/);

  const badAnchor = roadmap(mod('m-a', [read('HANDBOOK.md', '#no-such-heading')]));
  assert.throws(
    () => validateRoadmap(badAnchor, projects, decks, guides, docs),
    /"HANDBOOK\.md#no-such-heading" is not a heading/,
  );

  // Ids come from the app's slugger: the apostrophe is dropped, not turned into "39".
  const good = roadmap(
    mod('m-a', [read('HANDBOOK.md', '#1-values-and-types'), read('HANDBOOK.md', '#the-repos-big-ideas'), read('HANDBOOK.md')]),
  );
  assert.deepEqual(validateRoadmap(good, projects, decks, guides, docs), []);
});
