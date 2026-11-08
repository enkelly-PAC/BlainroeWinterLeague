import { canonical, isHeld, league, validateState } from './core.js';
import { weekendCards } from './leaderboard-layout.js';

const green = '#1a5e1a', pale = '#edf5ed', ink = '#1a2e1a';
const title = "Men's Winter League 2026/2027";
const groupSize = 3;
// Six compact weekend totals leave room for the team and player names.
const standingsGroupSize = 6;
const formats = { standings: 'Member standings', latest: 'Latest weekend results', detail: 'Full detail' };
const text = value => String(value).replace(/[\u2013\u2014]/gu, ':');
const dateLabel = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
// Soft breaks prevent a long unspaced name forcing a whole table beyond the page.
const cell = (value, extra = {}) => ({ text: text(value).replace(/(\S{16})(?=\S)/gu, '$1\u200b'), ...extra });
const heading = value => cell(value, { bold: true, color: 'white', fillColor: green });
const layout = {
  hLineWidth: () => 0.4, vLineWidth: () => 0,
  hLineColor: () => '#d8e6d8',
  fillColor: row => row > 0 && row % 2 === 0 ? '#f5f8f5' : null,
  paddingLeft: () => 3, paddingRight: () => 3,
  paddingTop: () => 1, paddingBottom: () => 1
};
function table(headers, rows, widths, headerRows = 1) {
  return {
    table: { headerRows, keepWithHeaderRows: 1, dontBreakRows: true,
      widths, body: [...headers, ...rows] },
    layout
  };
}
// Use the same engine and active-player rule as the visible team leaderboard.
export function leaderboardPDFModel(state, { mode = 'published', saved = true, format = 'detail', audience = 'review' } = {}) {
  validateState(state);
  if (!state.teams.length) throw new Error('Register a team before exporting the leaderboard.');
  if (!['published', 'draft'].includes(mode)) throw new Error('Unknown leaderboard source.');
  if (!Object.hasOwn(formats, format)) throw new Error('Unknown PDF format.');
  if (!['review', 'members'].includes(audience)) throw new Error('Unknown PDF audience.');
  const result = league(state);
  const active = new Set(state.teams.flatMap(team =>
    team.players.filter(player => !isHeld(team, player)).map(canonical)));
  const hasResults = result.rounds.some(round => round.cards.some(card => active.has(canonical(card.player))));
  if (audience === 'members' && !hasResults) throw new Error('Member PDF needs qualifying results matched to a team.');
  const through = result.rounds.filter(round => round.cards.length).at(-1)?.date || null;
  const rounds = [...state.rounds].sort((a, b) => a.date.localeCompare(b.date));
  const source = mode === 'published' ? 'PUBLISHED' : saved ? 'DRAFT: saved on this device, not published' : 'DRAFT: not saved, not published';
  const status = `${source} | ${state.settings.complete ? 'Qualification complete' : 'Provisional: qualification in progress'}`;
  const unmatched = rounds.reduce((count, round) =>
    count + round.cards.filter(card => !active.has(canonical(card.player))).length, 0);
  const sourceName = mode === 'draft' ? 'draft' : 'published';
  const latest = rounds.at(-1) || null;
  if (audience === 'members' && format === 'latest' && (!latest?.cards.length || latest.canceled || !latest.qualifying))
    throw new Error('Latest weekend has no active results for a member PDF.');
  const filename = `blainroe-winter-league-2026-2027-${sourceName}-${format === 'detail' ? '' : `${format}-`}${format === 'latest' ? latest?.date || 'awaiting-results' : hasResults ? through : 'awaiting-results'}.pdf`;
  return { result, rounds, hasResults, through, status, unmatched, filename, format, latest, audience };
}

function weekendTotal(row, round, hasResults) {
  const score = row.scores?.find(entry => entry.date === round.date);
  const total = round.canceled ? 'C' : !round.qualifying ? 'X' :
    hasResults && score ? `${score.total}${score.discarded ? ' D' : ''}` : 'Awaiting\nmatch';
  return cell(total, { bold: true, alignment: 'center',
    color: score?.discarded ? '#805500' : green, fillColor: pale });
}
function standingsTables(rows, model) {
  const { rounds, hasResults } = model;
  const content = [];
  for (let start = 0; start < Math.max(1, rounds.length); start += standingsGroupSize) {
    const group = rounds.slice(start, start + standingsGroupSize);
    const headers = [...(hasResults ? ['Rank'] : []), 'Team', 'Player 1', 'Player 2', 'Player 3',
      ...group.map(round => `${dateLabel(round.date).replace(/ (\d{4})$/u, '\n$1')}\n${round.canceled ? 'CANCELLED' : round.qualifying ? 'Team total' : 'EXCLUDED'}`),
      ...(hasResults ? ['Season\npoints'] : [])];
    content.push({ ...table([headers.map((label, index) => ({
      ...heading(label), ...(hasResults && index === 0 || index >= (hasResults ? 5 : 4) ? { alignment: 'center' } : {})
    }))], rows.map(row => [
      ...(hasResults ? [cell(row.rank, { bold: true, alignment: 'center' })] : []),
      cell(row.team.name, { bold: true }),
      ...[0, 1, 2].map(index => cell(row.team.players[index] || 'Vacant')),
      ...group.map(round => weekendTotal(row, round, hasResults)),
      ...(hasResults ? [cell(row.retained, { bold: true, alignment: 'center', color: green, fillColor: pale })] : [])
    ]), [...(hasResults ? [22] : []), 44, '*', '*', '*',
      ...group.map(() => 56), ...(hasResults ? [44] : [])]),
    ...(start ? { pageBreak: 'before' } : {}) });
  }
  return content;
}
function latestTable(rows, model) {
  const round = model.latest;
  if (!round) return [{ text: 'No imported weekend is available. Awaiting results.' }];
  return [
    { text: `Latest weekend results: ${dateLabel(round.date)}${round.canceled ? ' (CANCELLED)' :
      round.qualifying ? '' : ' (EXCLUDED)'}`,
    bold: true, color: green, margin: [0, 0, 0, 7] },
    table([['Team', 'Player 1', 'Player 2', 'Player 3', 'P1', 'P2', 'P3', 'Team total'].map((label, index) => ({
      ...heading(label), ...(index >= 4 ? { alignment: 'center' } : {})
    }))],
      rows.map(row => [
        cell(row.team.name, { bold: true }),
        ...[0, 1, 2].map(index => cell(row.team.players[index] || 'Vacant')),
        ...weekendCards(row.team, round).map(card => cell(model.audience === 'members' && card.held ? 'NA' : card.text, {
          alignment: 'center', bold: card.counting, color: card.counting ? ink : '#687568',
          ...(card.counting ? { fillColor: pale } : {})
        })),
        weekendTotal(row, round, model.hasResults)
      ]), [70, 110, 110, 110, 55, 55, 55, 70])
  ];
}

export function leaderboardPDFDocument(state, context = {}, logo) {
  const model = leaderboardPDFModel(state, context);
  const { rounds, hasResults, through, status, format } = model;
  const throughLabel = through ? `Qualifying results through weekend of ${dateLabel(through)}` : 'Awaiting qualifying results';
  const generated = (context.generatedAt || new Date()).toLocaleString('en-GB', { timeZone: 'Europe/Dublin', hour12: false });
  const content = [];
  const rows = hasResults ? model.result.rows : state.teams.map(team => ({ team }));
  if (format === 'standings') content.push(...standingsTables(rows, model));
  else if (format === 'latest') content.push(...latestTable(rows, model));
  // Repeat the full named grid for bounded weekend groups, never anonymous detail.
  else for (let start = 0; start < Math.max(1, rounds.length); start += groupSize) {
    const group = rounds.slice(start, start + groupSize);
    const labels = [...(hasResults ? ['Rank'] : []), 'Team', 'Player 1', 'Player 2', 'Player 3'];
    const identityHeaders = labels.map((label, index) => ({
      ...heading(label), ...(hasResults && index === 0 ? { alignment: 'center' } : {})
    }));
    const seasonHeader = { ...heading('Season points'), alignment: 'center', noWrap: true };
    const headers = [group.length ? labels.map(() => heading('')) : identityHeaders];
    if (group.length) {
      for (const round of group) {
        headers[0].push({ ...heading(`${dateLabel(round.date)}\n${text(round.name)}\n${round.canceled ? 'CANCELLED (C)' : round.qualifying ? 'Qualifying' : 'EXCLUDED (X)'}`), colSpan: 4, alignment: 'center' }, {}, {}, {});
      }
    }
    if (hasResults) headers[0].push(group.length ? heading('') : seasonHeader);
    if (group.length) headers.push([
      ...identityHeaders,
      ...group.flatMap(() => ['P1', 'P2', 'P3', 'Team'].map(label => ({ ...heading(label), alignment: 'center' }))),
      ...(hasResults ? [seasonHeader] : [])
    ]);
    const gridRows = rows.map(row => [
      ...(hasResults ? [cell(row.rank, { bold: true, alignment: 'center' })] : []),
      cell(row.team.name, { bold: true }),
      ...[0, 1, 2].map(index => cell(row.team.players[index] || 'Vacant')),
      ...group.flatMap(round => {
        return [
          ...weekendCards(row.team, round).map(card => cell(model.audience === 'members' && card.held ? 'NA' : card.text, {
            alignment: 'center', bold: card.counting, color: card.counting ? ink : '#687568'
          })),
          weekendTotal(row, round, hasResults)
        ];
      }),
      ...(hasResults ? [cell(row.retained, { bold: true, alignment: 'center', color: green, fillColor: pale })] : [])
    ]);
    const nameWidth = group.length <= 1 ? 120 : group.length === 2 ? 92 : 76;
    const grid = table(headers, gridRows, [
      ...(hasResults ? [22] : []), 44, ...[0, 1, 2].map(() => group.length ? nameWidth : '*'),
      ...group.flatMap(() => ['*', '*', '*', '*']), ...(hasResults ? [64] : [])
    ], group.length ? 2 : 1);
    grid.layout = { ...layout,
      vLineWidth: column => group.length && column >= labels.length &&
        (column - labels.length) % 4 === 0 ? 0.5 : 0,
      vLineColor: () => '#d8e6d8'
    };
    if (start) grid.pageBreak = 'before';
    content.push(grid);
  }
  return {
    info: { title: `Blainroe ${title}: ${formats[format]}: ${hasResults ? 'Team leaderboard' : 'Awaiting results'}`,
      author: 'Blainroe Golf Club', subject: `${model.audience === 'members' ? throughLabel : `${status}. ${throughLabel}`}. Sponsored by Spirit Ford Wicklow.` },
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [30, 80, 30, 39],
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
      }]
    }),
    footer: (page, pages) => ({
      columns: [
        { text: model.audience === 'members' ? 'Blainroe Golf Club | Spirit Ford Wicklow' : `Blainroe Golf Club | Generated ${generated} (Ireland)`, width: '*', fontSize: 7.5 },
        { text: `${model.audience === 'members' ? '' : `${context.mode === 'draft' ? 'DRAFT' : 'PUBLISHED'} | ${!state.settings.complete ? 'Provisional | ' : ''}`}Page ${page} of ${pages}`, width: 'auto', fontSize: 8, bold: true, color: green }
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
