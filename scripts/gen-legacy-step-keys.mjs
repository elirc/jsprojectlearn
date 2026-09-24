#!/usr/bin/env node
/**
 * One-off generator for app/src/lib/legacy-step-keys.json.
 *
 * Progress v1 keyed every step tick by array position ("stage/module/index").
 * v2 keys by what the step points at ("module/kind:target"), so inserting or
 * reordering steps no longer moves ticks. This script maps each v1 key to its
 * v2 key using the roadmap AS IT WAS when v1 shipped, then applies the nine
 * re-homings decided for the roadmap re-sequencing (04 review §4).
 *
 * The output is DATA and is frozen. It must never be regenerated after the
 * roadmap changes — a regenerated map would describe the new roadmap, not the
 * one old progress files were written against. That is why this script is not
 * wired into any npm lifecycle and refuses to overwrite without --force.
 *
 * Usage: node scripts/gen-legacy-step-keys.mjs [--roadmap <path>] [--force]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The app's own key function, so the map cannot drift from what progress uses.
import { stepKey } from '../app/src/lib/types.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'src', 'lib', 'legacy-step-keys.json');

const args = process.argv.slice(2);
const force = args.includes('--force');
const roadmapArg = args[args.indexOf('--roadmap') + 1];
const roadmapPath = args.includes('--roadmap') && roadmapArg
  ? path.resolve(roadmapArg)
  : path.join(ROOT, 'content', 'roadmap.json');

/** Steps that move module (or change target) in the re-sequenced roadmap. */
const OVERRIDES = {
  's6-node-backend/m-rest-api/1': 'm-node-crud/build:js/65-rest-api',
  's6-node-backend/m-sql/2': 'm-node-crud/build:js/55-json-db',
  's6-node-backend/m-auth/1': 'm-node-crud/build:js/66-auth',
  's7-dotnet/m-cs-oop/3': 'm-cs-async/build:csharp/14-async-await-basics',
  's7-dotnet/m-aspnet/3': 'm-dotnet-di/build:csharp/18-dependency-injection',
  's7-dotnet/m-dotnet-prod/3': 'm-dotnet-testing/build:csharp/35-integration-testing',
  's7-dotnet/m-dotnet-prod/2': 'm-background-work/build:csharp/32-background-work-queue',
  's2-browser/m-modules-tooling/3': 'm-modules-tooling/drill:js-modern',
  's7-dotnet/m-dotnet-data/4': 'm-dotnet-data/drill:dotnet-data',
};

if (existsSync(OUT) && !force) {
  console.error(`${path.relative(ROOT, OUT)} exists and is frozen. Pass --force only if you mean it.`);
  process.exit(1);
}

const roadmap = JSON.parse(await readFile(roadmapPath, 'utf8'));
const map = {};
for (const stage of roadmap.stages) {
  for (const mod of stage.modules) {
    mod.steps.forEach((step, index) => {
      if (!['build', 'guide', 'drill', 'read'].includes(step.kind)) throw new Error(`unknown step kind ${step.kind}`);
      map[`${stage.id}/${mod.id}/${index}`] = stepKey(mod.id, step);
    });
  }
}

for (const [oldKey, newKey] of Object.entries(OVERRIDES)) {
  const mechanical = map[oldKey];
  if (!mechanical) throw new Error(`override ${oldKey} does not exist in this roadmap`);
  const oldKind = mechanical.split('/')[1]?.split(':')[0];
  const newKind = newKey.split('/')[1]?.split(':')[0];
  if (oldKind !== newKind) throw new Error(`override ${oldKey}: ${oldKind} step cannot become ${newKind}`);
  map[oldKey] = newKey;
}

const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n');
console.log(`wrote ${Object.keys(sorted).length} legacy step keys to ${path.relative(ROOT, OUT)}`);
