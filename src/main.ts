import { parseArgs } from 'node:util';
import { readFile, cp, rm, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const isAvaSnapshot = (filePath: string) => filePath.endsWith('.md');
const isVitestSnapshot = (filePath: string) => filePath.endsWith('.snap');

const computeAvaEntries = async (filePath: string) => {
  const fileContents = await readFile(filePath, 'utf-8');
  const entries: Record<string, string[]> = {};
  let currentTestName = '';
  let currentSnapshotContent = '';
  let inSnapshot = false;
  let inSnapshotContent = false;
  let snapshotIndent = 0;

  for (const line of fileContents.split('\n')) {
    if (line.startsWith('## ')) {
      // test name
      inSnapshot = false;
      snapshotIndent = 0;
      currentTestName = line.slice(3).trim();
    } else if (line.startsWith('> Snapshot ')) {
      // snapshot start
      inSnapshot = true;
      currentSnapshotContent = '';
    } else if (inSnapshot && !inSnapshotContent) {
      // snapshot content start
      if (line.trim().startsWith('`')) {
        snapshotIndent = line.indexOf('`');
        inSnapshotContent = true;
        currentSnapshotContent += '\n';
      }
    } else if (inSnapshotContent) {
      if (line.trim().endsWith('`')) {
        // snapshot content end
        const entriesForSnapshot = entries[currentTestName] ?? [];
        currentSnapshotContent += line
          .slice(snapshotIndent, line.lastIndexOf('`'))
          .replace(/␊/g, '');
        entriesForSnapshot.push(currentSnapshotContent);
        entries[currentTestName] = entriesForSnapshot;
        inSnapshotContent = false;
      } else {
        // snapshot content line
        currentSnapshotContent +=
          line.slice(snapshotIndent).replace(/␊/g, '') + '\n';
      }
    }
  }

  const normalizedEntries: Record<string, string> = {};
  for (const [key, entriesForKey] of Object.entries(entries)) {
    for (let i = 0; i < entriesForKey.length; i++) {
      normalizedEntries[`${key} ${i + 1}`] = entriesForKey[i]!;
    }
  }
  return normalizedEntries;
};

const computeVitestEntries = async (filePath: string) => {
  const { default: entries } = await import(filePath);
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

export async function runCLI() {
  const args = parseArgs({
    allowPositionals: true,
  });

  const [a, b] = args.positionals;

  if (typeof a !== 'string' || typeof b !== 'string') {
    console.error('Usage: node src/main.ts <a> <b>');
    process.exit(1);
  }

  if (isAvaSnapshot(a) && isAvaSnapshot(b)) {
    console.log(
      'Both files are AVA snapshots. There should be exactly one of each (a vitest snapshot, and an AVA snapshot).',
    );
    process.exit(1);
  } else if (isVitestSnapshot(a) && isVitestSnapshot(b)) {
    console.log(
      'Both files are Vitest snapshots. There should be exactly one of each (a vitest snapshot, and an AVA snapshot).',
    );
    process.exit(1);
  }

  const [snapshotA, snapshotB] = isAvaSnapshot(a) ? [a, b] : [b, a];
  console.log(
    `Comparing AVA snapshot "${snapshotA}" with Vitest snapshot "${snapshotB}"...`,
  );

  const messages = await analyze(snapshotA, snapshotB);

  if (messages.length === 0) {
    console.log('Snapshots are equivalent!');
  } else {
    console.log('Snapshots differ:');
    for (const message of messages) {
      console.log(message);
    }
  }
}

export async function analyze(
  avaSnapshot: string,
  vitestSnapshot: string,
): Promise<string[]> {
  const messages: string[] = [];

  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), 'ava-vitest-snapshot-diff-'),
  );
  const tempSnapshotBPath = path.join(
    tempDir,
    `${path.basename(vitestSnapshot, '.snap')}.cjs`,
  );
  await cp(path.resolve(vitestSnapshot), tempSnapshotBPath);

  try {
    const snapshotBEntries = await computeVitestEntries(tempSnapshotBPath);
    const snapshotAEntries = await computeAvaEntries(avaSnapshot);

    const allKeys = new Set([
      ...Object.keys(snapshotAEntries),
      ...Object.keys(snapshotBEntries),
    ]);

    for (const key of allKeys) {
      const aEntry = snapshotAEntries[key];
      const bEntry = snapshotBEntries[key];

      if (aEntry === undefined) {
        messages.push(`Key "${key}" is missing in AVA snapshot.`);
      } else if (bEntry === undefined) {
        messages.push(`Key "${key}" is missing in Vitest snapshot.`);
      } else if (aEntry !== bEntry) {
        messages.push(`Key "${key}" differs between snapshots.`);
        const aLines = aEntry.split('\n');
        const bLines = bEntry.split('\n');
        for (let i = 0; i < Math.max(aLines.length, bLines.length); i++) {
          const aLine = aLines[i];
          const bLine = bLines[i];
          if (aLine !== bLine) {
            messages.push(`  Line ${i + 1} differs:
  AVA:   ${JSON.stringify(aLine)}
  Vitest: ${JSON.stringify(bLine)}`);
          }
        }
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return messages;
}
