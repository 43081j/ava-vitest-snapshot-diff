import {parseArgs} from 'node:util';
import {readFile, cp, rm} from 'node:fs/promises';
import path from 'node:path';

const args = parseArgs({
  allowPositionals: true
});

const [a, b] = args.positionals;

if (typeof a !== 'string' || typeof b !== 'string') {
  console.error('Usage: node src/main.ts <a> <b>');
  process.exit(1);
}

const isAvaSnapshot = (filePath: string) => filePath.endsWith('.md');
const isVitestSnapshot = (filePath: string) => filePath.endsWith('.snap');

if (isAvaSnapshot(a) && isAvaSnapshot(b)) {
  console.log('Both files are AVA snapshots. There should be exactly one of each (a vitest snapshot, and an AVA snapshot).');
  process.exit(1);
} else if (isVitestSnapshot(a) && isVitestSnapshot(b)) {
  console.log('Both files are Vitest snapshots. There should be exactly one of each (a vitest snapshot, and an AVA snapshot).');
  process.exit(1);
}

const [snapshotA, snapshotB] = isAvaSnapshot(a) ? [a, b] : [b, a];

const computeAvaEntries = async (filePath: string) => {
  const fileContents = await readFile(filePath, 'utf-8');
  const entries: Record<string, string[]> = {};

  // loop through each line of the markdown
  // when encountering a ##, this is a test name
  // when encountering a `> Snapshot \d+` after that, this is a snapshot
  // So we now have the full name: `{test name} {number}`.
  // everything that follows is the snapshot content (contained within
  // backticks, but not sure how inner backticks get escaped/handled).
  let currentTestName = '';
  let currentSnapshotContent = '';
  let inSnapshot = false;
  let inSnapshotContent = false;
  let snapshotIndent = 0;

  for (const line of fileContents.split('\n')) {
    if (line.startsWith('## ')) {
      inSnapshot = false;
      snapshotIndent = 0;
      currentTestName = line.slice(3).trim();
    } else if (line.startsWith('> Snapshot ')) {
      inSnapshot = true;
      currentSnapshotContent = '';
    } else if (inSnapshot && !inSnapshotContent) {
      if (line.trim().startsWith('`')) {
        snapshotIndent = line.indexOf('`');
        inSnapshotContent = true;
        currentSnapshotContent += '\n';
      }
    } else if (inSnapshotContent) {
      if (line.trim().endsWith('`')) {
        const entriesForSnapshot = entries[currentTestName] ?? [];
        currentSnapshotContent += line.slice(snapshotIndent, line.lastIndexOf('`')).replace(/␊/g, '');
        entriesForSnapshot.push(currentSnapshotContent);
        entries[currentTestName] = entriesForSnapshot;
        inSnapshotContent = false;
      } else {
        currentSnapshotContent += line.slice(snapshotIndent).replace(/␊/g, '') + '\n';
      }
    }
  }

  const normalizedEntries: Record<string, string> = {};
  for (const [key, entriesForKey] of Object.entries(entries)) {
    for (let i = 0; i < entriesForKey.length; i++) {
      normalizedEntries[`${key} ${i + 1}`] = entriesForKey[i];
    }
  }
  return normalizedEntries;
};

const computeVitestEntries = async (filePath: string) => {
  const {default: entries} = await import(filePath);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') {
      continue;
    }

    const trimmed = value.trim();

    if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
      continue;
    }

    result[key] = trimmed.slice(1, -1);
  }
  return result;
};

console.log(`Comparing AVA snapshot "${snapshotA}" with Vitest snapshot "${snapshotB}"...`);

const tempSnapshotBPath = path.resolve(path.dirname(snapshotB), `${path.basename(snapshotB, '.snap')}.cjs`);
await cp(path.resolve(snapshotB), tempSnapshotBPath);

try {
  const snapshotBEntries = await computeVitestEntries(tempSnapshotBPath);
  const snapshotAEntries = await computeAvaEntries(snapshotA);

  const allKeys = new Set([...Object.keys(snapshotAEntries), ...Object.keys(snapshotBEntries)]);
  let seenError = false;

  for (const key of allKeys) {
    const aEntry = snapshotAEntries[key];
    const bEntry = snapshotBEntries[key];

    if (aEntry === undefined) {
      console.log(`Key "${key}" is missing in AVA snapshot.`);
      seenError = true;
    } else if (bEntry === undefined) {
      console.log(`Key "${key}" is missing in Vitest snapshot.`);
      seenError = true;
    } else if (aEntry !== bEntry) {
      console.log(`Key "${key}" differs between snapshots.`);
      seenError = true;
      const aLines = aEntry.split('\n');
      const bLines = bEntry.split('\n');
      for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
        const aLine = aLines[i];
        const bLine = bLines[i];
        if (aLine !== bLine) {
          console.log(`  Line ${i + 1} differs:`);
          console.log(`    AVA:   ${aLine}`);
          console.log(`    Vitest: ${bLine}`);
        }
      }
    }
  }

  if (!seenError) {
    console.log('Snapshots are equivalent!');
  }
} finally {
  await rm(tempSnapshotBPath);
}
