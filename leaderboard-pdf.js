import { canonical, isHeld, league, validateState } from './core.js';

const green = '#1a5e1a', pale = '#edf5ed', ink = '#1a2e1a';
const title = "Men's Winter League 2026/2027";
const text = value => String(value).replace(/[\u2013\u2014]/gu, ':');
const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const reviewed = team => team.players.length < 3 || team.notes || team.heldPlayers?.length;
const teamLabel = team => `${text(team.name)}${reviewed(team) ? ' *' : ''}`;
// Soft breaks prevent a long unspaced name forcing a whole table beyond the page.
const cell = (value, extra = {}) => ({ text: text(value).replace(/(\S{16})(?=\S)/gu, '$1\u200b'), ...extra });
const heading = value => cell(value, { bold: true, color: 'white', fillColor: green });
const layout = {
  hLineWidth: () => 0.4, vLineWidth: () => 0,
  hLineColor: () => '#d8e6d8',
  fillColor: row => row > 0 && row % 2 === 0 ? '#f5f8f5' : null,
  paddingLeft: () => 5, paddingRight: () => 5,
  paddingTop: () => 2, paddingBottom: () => 2
};
function table(headers, rows, widths) {
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true,
      widths, body: [headers.map(heading), ...rows] },
    layout
  };
}
function section(value, pageBreak) {
  return { text: value, fontSize: 14, bold: true, color: green,
    margin: [0, 0, 0, 8], ...(pageBreak ? { pageBreak: 'before' } : {}) };
}

// Use the same engine and active-player rule as the visible team leaderboard.
export function leaderboardPDFModel(state, { mode = 'published', saved = true } = {}) {
  validateState(state);
  if (!state.teams.length) throw new Error('Register a team before exporting the leaderboard.');
  if (!['published', 'draft'].includes(mode)) throw new Error('Unknown leaderboard source.');
  const result = league(state);
  const active = new Set(state.teams.flatMap(team =>
    team.players.filter(player => !isHeld(team, player)).map(canonical)));
  const hasResults = result.rounds.some(round => round.cards.some(card => active.has(canonical(card.player))));
  const through = result.rounds.filter(round => round.cards.length).at(-1)?.date || null;
  const rounds = [...state.rounds].sort((a, b) => a.date.localeCompare(b.date));
  const source = mode === 'published' ? 'PUBLISHED' : saved ? 'DRAFT: saved on this device, not published' : 'DRAFT: not saved, not published';
  const status = `${source} | ${state.settings.complete ? 'Qualification complete' : 'Provisional: qualification in progress'}`;
  const unmatched = rounds.reduce((count, round) =>
    count + round.cards.filter(card => !active.has(canonical(card.player))).length, 0);
  const sourceName = mode === 'draft' ? 'draft' : 'published';
  const filename = `blainroe-winter-league-2026-2027-${sourceName}-${hasResults ? through : 'awaiting-results'}.pdf`;
  return { result, rounds, hasResults, through, status, unmatched, filename };
}

export function leaderboardPDFDocument(state, context = {}, logo) {
  const model = leaderboardPDFModel(state, context);
  const { result, rounds, hasResults, through, status, unmatched } = model;
  const throughLabel = through ? `Qualifying results through weekend of ${dateLabel(through)}` : 'Awaiting qualifying results';
  const generated = (context.generatedAt || new Date()).toLocaleString('en-GB', { timeZone: 'Europe/Dublin', hour12: false });
  const content = [
    section(hasResults ? 'Team leaderboard' : 'Registered teams: awaiting qualifying team results'),
    { text: `${state.teams.length} teams | ${result.rounds.length} qualifying weekends | ${rounds.length} imported weekends`, color: green, bold: true, margin: [0, 0, 0, 6] },
    { text: 'Reported 12-hole net Stableford points, unchanged. Best 2 of 3 cards count each qualifying weekend. Missing, vacant and held cards contribute zero. ' +
      (state.settings.complete ? `${result.discardCount} lowest qualifying weekend(s) discarded. ` : 'No discards until qualification is complete. ') +
      'Ties compare discarded scores highest first, then share rank (committee assumption).', fontSize: 8.5, margin: [0, 0, 0, 8] }
  ];
  if (!hasResults) content.push({ text: 'No rankings or team totals are asserted. Imported cards may be awaiting a team match or belong to cancelled / excluded weekends.', margin: [0, 0, 0, 8] });
  if (state.settings.complete && hasResults && (result.firstUnresolved || result.cutoffUnresolved)) {
    content.push(cell([
      result.firstUnresolved ? 'First place remains tied.' : '',
      result.cutoffUnresolved ? 'Top 16 cutoff requires a committee decision.' : ''
    ].filter(Boolean).join(' '), { color: '#805500', margin: [0, 0, 0, 8] }));
  }
  const rows = hasResults ? result.rows : state.teams.map(team => ({ team }));
  const summaryRows = rows.map(row => [
    ...(hasResults ? [cell(row.rank, { bold: true, alignment: 'center' })] : []),
    cell(teamLabel(row.team), { bold: true }),
    ...[0, 1, 2].map(index => cell(row.team.players[index] || 'Vacant')),
    ...(hasResults ? [cell(row.retained, { bold: true, alignment: 'center', color: green, fillColor: pale })] : [])
  ]);
  content.push(table(
    [...(hasResults ? ['Rank'] : []), 'Team', 'Player 1', 'Player 2', 'Player 3', ...(hasResults ? ['Team points'] : [])],
    summaryRows, hasResults ? [26, 51, '*', '*', '*', 52] : [60, '*', '*', '*']
  ));
  const review = state.teams.filter(reviewed).map(team =>
    `${text(team.name)}: ${[
      team.players.length < 3 ? 'third place vacant' : '',
      team.heldPlayers?.length ? `score matching held for ${team.heldPlayers.map(text).join(', ')}` : '',
      team.notes ? 'committee review pending' : ''
    ].filter(Boolean).join('; ')}`);
  if (review.length || unmatched) {
    content.push(cell([
      review.length ? `* Team-list review (not eligibility approval): ${review.join('. ')}.` : '',
      unmatched ? `${unmatched} imported card(s) unmatched or held, not counted for teams.` : ''
    ].filter(Boolean).join('\n'), { fontSize: 8, color: '#805500', margin: [0, 10, 0, 0] }));
  }
  // Six weekends per group avoids shrinking a season of up to 52 qualifying weekends.
  for (let start = 0; start < rounds.length; start += 6) {
    const group = rounds.slice(start, start + 6);
    content.push(section(`Weekend breakdown: ${start + 1} to ${start + group.length} of ${rounds.length}`, true));
    content.push({ text: 'Each cell: Player 1 / Player 2 / Player 3 | weekend team total. H = held raw card (not counted); NA = no card or vacant. D = discarded. Cancelled / excluded weekends never count. Brackets show season team points, matching the summary.', fontSize: 8.5, margin: [0, 0, 0, 8] });
    const headers = [hasResults ? 'Rank / Team\n(Team points)' : 'Team', ...group.map(round =>
      `${dateLabel(round.date)}\n${text(round.name)}\n${round.canceled ? 'CANCELLED' : round.qualifying ? 'Qualifying' : 'EXCLUDED'}`)];
    const detailRows = rows.map(row => [
      cell(`${hasResults ? `${row.rank}. ` : ''}${teamLabel(row.team)}${hasResults ? ` (${row.retained})` : ''}`, { bold: true }),
      ...group.map(round => {
      const cards = new Map(round.cards.map(card => [canonical(card.player), card.score]));
      const values = [0, 1, 2].map(index => {
        const player = row.team.players[index], score = player ? cards.get(canonical(player)) : undefined;
        return score === undefined ? 'NA' : `${score}${isHeld(row.team, player) ? ' H' : ''}`;
      });
      const score = row.scores?.find(entry => entry.date === round.date);
      // Awaiting-results lists deliberately do not invent ranked zero totals.
      const total = round.canceled ? 'Cancelled' : !round.qualifying ? 'Excluded' :
        score ? `${score.total}${score.discarded ? ' D' : ''}` : 'Awaiting match';
      return { text: [
        cell(`${values.join(' / ')} | `, { fontSize: 8 }),
        cell(total, { bold: true, color: score?.discarded ? '#805500' : green })
      ], alignment: 'center' };
    })]);
    content.push(table(headers, detailRows, [100, ...group.map(() => '*')]));
  }
  return {
    info: { title: `Blainroe ${title}: ${hasResults ? 'Team leaderboard' : 'Awaiting results'}`,
      author: 'Blainroe Golf Club', subject: `${status}. ${throughLabel}. Sponsored by Spirit Ford Wicklow.` },
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [30, 106, 30, 39],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: ink, lineHeight: 1.12 },
    header: () => ({
      margin: [30, 16, 30, 0],
      stack: [{
        columns: [
          ...(logo ? [{ image: logo, width: 82, margin: [0, 0, 14, 0] }] : []),
          { width: '*', stack: [
            { text: 'BLAINROE GOLF CLUB', fontSize: 10, bold: true, color: green },
            { text: title, fontSize: 20, bold: true, color: green, margin: [0, 2, 0, 2] },
            { text: 'Proudly sponsored by Spirit Ford Wicklow', fontSize: 10 }
          ] }
        ]
      }, { text: `${status}\n${throughLabel}${rounds.length ? ` | Latest imported weekend: ${dateLabel(rounds.at(-1).date)}` : ''}`,
        fontSize: 8, bold: true, color: green, margin: [0, 8, 0, 0] }]
    }),
    footer: (page, pages) => ({
      columns: [
        { text: `Blainroe Golf Club | Generated ${generated} (Ireland)`, width: '*', fontSize: 7.5 },
        { text: `${context.mode === 'draft' ? 'DRAFT' : 'PUBLISHED'} | Page ${page} of ${pages}`, width: 'auto', fontSize: 8, bold: true, color: green }
      ], margin: [30, 12, 30, 0]
    }),
    content
  };
}

let library;
function loadScript(path) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(path, import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error('PDF tools could not load. Refresh the page and try again.')); };
    document.head.append(script);
  });
}
async function pdfTools() {
  if (!library) library = (async () => {
    await loadScript('./vendor/pdfmake.min.js');
    await loadScript('./vendor/vfs_fonts.js');
    return window.pdfMake;
  })().catch(error => { library = null; throw error; });
  return library;
}
export async function createLeaderboardPDF(state, context) {
  const model = leaderboardPDFModel(state, context);
  const pdfMake = await pdfTools();
  const response = await fetch(new URL('./blainroe-anni-logo.png', import.meta.url));
  if (!response.ok) throw new Error('Club logo could not load. Refresh the page and try again.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const logo = `data:image/png;base64,${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))}`;
  const definition = leaderboardPDFDocument(state, context, logo);
  const buffer = await new Promise((resolve, reject) => {
    // Local embedded assets need no URL resolver. The stream exposes failures
    // that pdfmake's callback-only getBuffer API otherwise leaves unhandled.
    const stream = pdfMake.createPdf(definition).getStream();
    const chunks = [];
    let length = 0;
    stream.on('data', chunk => { chunks.push(chunk); length += chunk.length; });
    stream.on('error', reject);
    stream.on('end', () => {
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    });
    stream.end();
  });
  return { filename: model.filename, buffer };
}
