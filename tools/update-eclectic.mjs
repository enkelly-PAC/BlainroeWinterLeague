import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJSON } from '../core.js';
import { buildEclectic, eclecticStandings, validateEclectic } from '../eclectic.js';
import { readLimited, atomicPublication } from './publication-io.mjs';

export function eclecticArguments(args) {
  const options = { gross: [], net: [], apply: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') options.apply = true;
    else if (flag === '--gross-file' || flag === '--net-file') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      options[flag === '--gross-file' ? 'gross' : 'net'].push(value);
    } else throw new Error(`Unknown option ${flag}.`);
  }
  if (!options.gross.length || !options.net.length || options.gross.length + options.net.length > 60)
    throw new Error('Supply explicit --gross-file paths for both days and --net-file paths for every active weekend (at most 60 files). Preview is default.');
  return options;
}

export async function updateEclectic(args, directory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data')) {
  const options = eclecticArguments(args), publishedPath = resolve(directory, 'published.json'), target = resolve(directory, 'eclectic.json');
  const before = await readLimited(publishedPath), state = parseJSON(before);
  const existing = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const files = paths => Promise.all(paths.map(async path => ({ path, source: await readLimited(path) })));
  const data = await buildEclectic(state, await files(options.gross), await files(options.net));
  validateEclectic(data, state, data.sourceFingerprint);
  console.log(`Source fingerprint: ${data.sourceFingerprint}`);
  for (const round of data.coverage)
    console.log(`${round.date}: ${round.acceptedCards} accepted, ${round.days.reduce((sum, day) => sum + day.rawCards, 0)} raw cards; both days reconciled.`);
  for (const field of ['gross', 'net']) {
    const table = eclecticStandings(state, data, field);
    console.log(`${field}: ${table.rows.length} players, ${table.complete} complete, ${table.incomplete} incomplete. Leaders: ${table.rows.filter(row => row.rank === 1).map(row => row.player).join(', ')} (${table.rows[0].total}).`);
  }
  const output = JSON.stringify(data, null, 2) + '\n';
  if (output === existing) console.log('Unchanged: identical eclectic already loaded. No write.');
  else if (!options.apply) console.log('Preview only. Nothing written. Review, then repeat with --apply.');
  else {
    if (await readLimited(publishedPath) !== before) throw new Error('Published results changed during preview. Retry against the latest publication.');
    await atomicPublication(target, data, existing);
    console.log(`Applied locally to ${target}. Published net results unchanged. No commit, push or deployment.`);
  }
  return data;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  updateEclectic(process.argv.slice(2)).catch(error => { console.error(`Eclectic update refused: ${error.message}`); process.exitCode = 1; });
