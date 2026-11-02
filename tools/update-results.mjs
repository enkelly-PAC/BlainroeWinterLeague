import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJSON, parseScores, classifyScoreCSV, importRound, weekendDate, canonical, assignments, league } from '../core.js';
import { protectPublishedHistory } from '../publication.js';
import { readLimited, atomicPublication } from './publication-io.mjs';

export function buildUpdate(published, files, options = {}) {
  const reports = [], excluded = [], groups = new Map();
  for (const file of files) {
    try {
      if (classifyScoreCSV(file.source) === 'scorecards') { excluded.push(file.path); continue; }
      const parsed = parseScores(file.source);
      if (!options.confirmNet) throw new Error('Confirm reported 12-hole net Stableford with --confirm-net. No gross conversion is performed.');
      if (!parsed.playedOn && !options.date) throw new Error('No played-on date. Supply --date YYYY-MM-DD for the committee weekend.');
      const date = weekendDate(options.date || parsed.playedOn);
      if (options.date && parsed.playedOn && weekendDate(parsed.playedOn) !== date)
        throw new Error('Explicit date disagrees with report metadata.');
      if (date < '2026-10-01' || date > '2027-04-30') throw new Error(`Weekend ${date} is outside Winter League 2026/2027. Do not import last season.`);
      const previous = published.rounds.find(round => round.date === date);
      const name = options.name || previous?.name || parsed.name || `Weekend ${date}`;
      const round = { date, name, qualifying: previous?.qualifying ?? true, canceled: previous?.canceled ?? false, cards: parsed.cards };
      if (!groups.has(date)) groups.set(date, { ...round, cards: [] });
      const group = groups.get(date);
      if (group.name !== name) throw new Error('Report names differ for one weekend. Supply one reviewed --name.');
      const cards = new Map(group.cards.map(card => [canonical(card.player), card]));
      for (const card of round.cards) {
        const old = cards.get(canonical(card.player));
        if (old && (old.score !== card.score || old.handicap !== card.handicap)) throw new Error(`Conflicting uploaded card for ${card.player}. Choose one complete corrected report.`);
        if (!old) cards.set(canonical(card.player), card);
      }
      group.cards = [...cards.values()];
      reports.push({ path: file.path, date, cards: parsed.cards.length, omitted: parsed.omitted || { noReturn: 0, disqualified: 0 } });
    } catch (error) { throw new Error(`${file.path}: ${error.message}`); }
  }
  if (!reports.length) throw new Error(`No net results selected. ${excluded.length} gross scorecard file(s) excluded, not stored.`);
  const replacements = options.replacements || [];
  for (const date of replacements)
    if (!groups.has(date) || !published.rounds.some(round => round.date === date))
      throw new Error(`--replace-weekend ${date} must name an existing weekend with selected complete corrected net results.`);
  let state = structuredClone(published);
  for (const group of groups.values()) state = importRound(state, group, replacements.includes(group.date) ? 'replace' : 'merge');
  protectPublishedHistory(state, published, replacements);
  const assigned = assignments(state.teams);
  const cards = [...groups.values()].flatMap(round => round.cards);
  const held = cards.filter(card => assigned.get(canonical(card.player))?.startsWith('Unassigned')).length;
  const unmatched = cards.filter(card => !assigned.has(canonical(card.player))).length;
  return { state, reports, excluded, matched: cards.length - held - unmatched, unmatched, held };
}

export function argumentsFor(args) {
  const options = { files: [], replacements: [], confirmNet: false, apply: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--apply') options.apply = true;
    else if (flag === '--confirm-net') options.confirmNet = true;
    else if (['--file', '--date', '--name', '--replace-weekend'].includes(flag)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      if (flag === '--file') options.files.push(value);
      else if (flag === '--replace-weekend') options.replacements.push(weekendDate(value));
      else options[flag.slice(2)] = value;
    } else throw new Error(`Unknown option ${flag}.`);
  }
  if (!options.files.length || options.files.length > 20) throw new Error('Supply 1 to 20 explicit --file paths. Preview is default; add --confirm-net and --apply after review.');
  return options;
}

export async function updateResults(args, target = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'published.json')) {
  const options = argumentsFor(args), before = await readLimited(target);
  const files = await Promise.all(options.files.map(async path => ({ path, source: await readLimited(path) })));
  const result = buildUpdate(parseJSON(before), files, options);
  for (const path of result.excluded) console.log(`Excluded gross scorecards (not stored): ${path}`);
  for (const report of result.reports) console.log(`${report.path}: weekend ${report.date}, ${report.cards} cards; omitted ${report.omitted.noReturn} NR/withdrawn and ${report.omitted.disqualified} DQ.`);
  for (const date of options.replacements) console.log(`REPLACE complete weekend ${date}: ${parseJSON(before).rounds.find(round => round.date === date).cards.length} old cards replaced by ${result.state.rounds.find(round => round.date === date).cards.length} selected cards. Omitted players will have no card.`);
  console.log(`Selected cards: ${result.matched} matched, ${result.unmatched} unmatched, ${result.held} held.`);
  const table = league(result.state);
  console.log(`Cumulative: ${result.state.teams.length} teams, ${result.state.rounds.length} weekends, ${result.state.rounds.reduce((sum, round) => sum + round.cards.length, 0)} cards. Leading team(s): ${table.rows.filter(row => row.rank === 1).map(row => row.team.name).join(', ') || 'none'}, ${table.rows[0]?.retained ?? 0} points.`);
  if (JSON.stringify(result.state) === JSON.stringify(parseJSON(before))) console.log('Unchanged: identical results already loaded. No write.');
  else if (options.apply) {
    await atomicPublication(target, result.state, before);
    console.log(`Applied locally to ${target}. No commit, push or deployment. Review the diff, then the owner publishes through GitHub.`);
  } else console.log('Preview only. Nothing written. Review, then repeat with --apply.');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateResults(process.argv.slice(2)).catch(error => { console.error(`Update refused: ${error.message}`); process.exitCode = 1; });
}
