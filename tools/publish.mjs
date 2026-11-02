import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJSON, league, weekendDate } from '../core.js';
import { protectPublishedHistory } from '../publication.js';
import { readLimited, atomicPublication } from './publication-io.mjs';

const input = process.argv[2];
if (!input || input.startsWith('--')) {
  console.error('Usage: npm run publish:data -- "C:\\explicit\\path\\reviewed.json" [--replace-weekend YYYY-MM-DD]\nValidates and preserves cumulative local data/published.json. No commit, push or GitHub changes.');
  process.exitCode = 1;
} else {
  try {
    const source = resolve(input);
    const replacements = [];
    for (let i = 3; i < process.argv.length; i += 2) {
      if (process.argv[i] !== '--replace-weekend' || !process.argv[i + 1]) throw new Error('Only --replace-weekend YYYY-MM-DD is supported after the explicit input.');
      replacements.push(weekendDate(process.argv[i + 1]));
    }
    const state = parseJSON(await readLimited(source));
    const target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'published.json');
    const before = await readLimited(target);
    protectPublishedHistory(state, parseJSON(before), replacements);
    await atomicPublication(target, state, before);
    const result = league(state);
    console.log(`Validated and copied ${state.teams.length} teams and ${result.rounds.length} qualifying weekends to ${target}.`);
    console.log('Local file only. Review consent and results, then the owner must commit and publish through GitHub.');
  } catch (error) {
    console.error(`Publication refused: ${error.message}`);
    process.exitCode = 1;
  }
}
