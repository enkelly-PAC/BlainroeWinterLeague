import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseJSON } from '../core.js';
import { memberUpdate } from '../member-update.js';

const args = process.argv.slice(2);
try {
  let output, pendingDate = null;
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Each option needs a value.');
    if (args[index] === '--out' && output === undefined) output = resolve(value);
    else if (args[index] === '--pending-weekend' && pendingDate === null) pendingDate = value;
    else throw new Error(`Unknown or repeated option: ${args[index]}`);
  }
  if (!output) throw new Error('Usage: npm run prepare:members -- --out "C:\\explicit\\review-folder" [--pending-weekend YYYY-MM-DD]');
  const source = await readFile(new URL('../data/published.json', import.meta.url), 'utf8');
  const state = parseJSON(source);
  const update = memberUpdate(state, { mode: 'draft', saved: true, pendingDate });
  const files = [
    [update.filename, update.html],
    [`blainroe-team-standings-draft-${update.through || 'awaiting-results'}.csv`, update.teamCSV],
    [`blainroe-singles-draft-${update.individual.round.date}.csv`, update.singlesCSV],
    [`blainroe-comparison-baseline-${update.through}.json`, JSON.stringify({
      schemaVersion: 1, through: update.through, sourceSHA256: createHash('sha256').update(source).digest('hex'),
      state, teams: update.result.rows, singles: update.individual.rows
    }, null, 2) + '\n']
  ];
  await mkdir(output, { recursive: true });
  for (const [name, content] of files) await writeFile(resolve(output, name), content, { flag: 'wx' });
  console.log(`Prepared newsletter copy, separate Team/Singles CSVs and an internal comparison baseline in ${output}. Existing files are never overwritten.`);
  console.log('Nothing sent, published, committed or pushed. Review source completeness, roster and consent before sharing.');
} catch (error) {
  console.error(`Member update preparation failed: ${error.message}`);
  process.exitCode = 1;
}
