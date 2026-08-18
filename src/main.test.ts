import { test, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyze } from './main.js';

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures',
);

const analyzeFixture = (name: string) =>
  analyze(
    path.join(fixtures, name, 'ava.snap'),
    path.join(fixtures, name, 'vitest.snap'),
  );

test('reports no differences for equivalent snapshots', async () => {
  expect(await analyzeFixture('basic')).toEqual([]);
});

test('reports missing and differing keys', async () => {
  expect(await analyzeFixture('mismatch')).toEqual([
    'Key "basic 1" differs between snapshots.',
    `  Line 2 differs:
  AVA:   "  world"
  Vitest: "  WORLD"`,
    'Key "multiple snapshots 2" is missing in Vitest snapshot.',
    'Key "only in vitest 1" is missing in AVA snapshot.',
  ]);
});
