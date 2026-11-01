import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, parseJSON, league } from '../core.js';

const input = process.argv[2];
if (!input || process.argv.length !== 3) {
  console.error('Usage: npm run publish:data -- "C:\\explicit\\path\\reviewed.json"\nValidates and replaces the local data/published.json only. No commit, push or GitHub changes.');
  process.exitCode = 1;
} else {
  try {
    const source = resolve(input);
    if ((await stat(source)).size > MAX_BYTES) throw new Error('Input exceeds the 2 MB limit.');
    const state = parseJSON(await readFile(source, 'utf8'));
    const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'published.json');
    await writeFile(target, JSON.stringify(state, null, 2) + '\n', 'utf8');
    const result = league(state);
    console.log(`Validated and copied ${state.teams.length} teams and ${result.rounds.length} qualifying weekends to ${target}.`);
    console.log('Local file only. Review consent and results, then the owner must commit and publish through GitHub.');
  } catch (error) {
    console.error(`Publication refused: ${error.message}`);
    process.exitCode = 1;
  }
}
