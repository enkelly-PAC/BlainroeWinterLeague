import { MAX_BYTES, emptyState, canonical, playerKey, validateState, parseJSON, parseTeams, parseScores, classifyScoreCSV, parseFinal, importRound, weekendDate, league, singles, finalTable, csvCell, reportHTML, assignments, isHeld, rosterStatus, replaceTeams, editTeam } from './core.js';
import { readDraft, saveDraft, readBaseline, STORAGE_KEY, BASELINE_KEY } from './storage.js';
import { synchroniseDraft, protectPublishedHistory } from './publication.js';
import { createLeaderboardPDF } from './leaderboard-pdf.js';
import { weekendCards } from './leaderboard-layout.js';
import { memberUpdate } from './member-update.js';

const $ = id => document.getElementById(id);
// Keep the shared import form on the leaderboard, including its advanced import types.
$('upload-panel').append($('results-upload'));
let published = emptyState(), publishedReady = false, draft = null, mode = 'published', pending = null, storageBlocked = false, previewRevision = 0;
let draftSaved = false;
let pdfBusy = false;
const singlesSelection = { published: null, draft: null };
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const restored = readDraft(storage);
draft = restored.state;
let draftBaseline = draft ? readBaseline(storage, draft) : null;
draftSaved = Boolean(draft);
storageBlocked = Boolean(restored.error);
$('storage-notice').textContent = restored.error || (draft ? 'Saved local draft available. Public view is shown by default.' : 'No local draft saved yet.');
function message(value, error = false) {
  $('status').textContent = value;
  $('status').classList.toggle('error', error);
}
function importMessage(value, error = false, focus = false) {
  message(value, error);
  $('import-status').textContent = value;
  $('import-status').classList.toggle('error', error);
  if (focus) $('import-status').focus();
}
function safelyImport(action) {
  return async event => {
    event?.preventDefault();
    try { await action(event); } catch (error) { importMessage(error.message, true, true); }
  };
}
function safely(action) {
  return async event => {
    event?.preventDefault();
    try { await action(event); } catch (error) { message(error.message, true); }
  };
}
function resultsState(state) {
  if (!state.teams.length && publishedReady && published.teams.length)
    return validateState({ ...replaceTeams(state, published.teams),
      ...(published.identityBindings ? { identityBindings: structuredClone(published.identityBindings) } : {}) });
  return state;
}
function current() { return mode === 'draft' && draft ? resultsState(draft) : published; }
function cardMatch(teams, card, identityBindings = []) {
  const entries = teams.flatMap(team => team.players
    .filter(player => canonical(player) === playerKey(card.player, identityBindings))
    .map(player => ({ team, player })));
  const held = entries.some(({ team, player }) => isHeld(team, player));
  return {
    player: entries.map(entry => entry.player).filter((value, i, values) => values.indexOf(value) === i).join(', ') || 'Not in team list',
    team: entries.map(entry => entry.team.name).join(', ') || 'Unassigned',
    status: held ? 'Held: needs confirmation' : entries.length ? 'Matched' : 'Unmatched'
  };
}
function working() {
  if (!draft) {
    if (storageBlocked) throw new Error('Unreadable draft preserved. Explicitly replace it with published data or delete it before importing.');
    if (!publishedReady) throw new Error('Published data is unavailable. Refresh it first, or restore a validated JSON backup.');
    draft = structuredClone(published);
  }
  return publishedReady ? synchroniseDraft(draft, published, draftBaseline) : draft;
}
function importBase() {
  if (storageBlocked) throw new Error('Unreadable draft preserved. Restore a validated JSON backup or explicitly replace/delete the draft before applying imports.');
  if (!draft && !publishedReady) throw new Error('Published data is unavailable. Refresh it first, or restore a validated JSON backup.');
  return draft && publishedReady ? synchroniseDraft(draft, published, draftBaseline) : draft || published;
}
function persist(state, success) {
  validateState(state);
  if (storageBlocked) throw new Error('Unreadable storage preserved. Explicitly replace or delete the local draft first.');
  draft = structuredClone(state);
  draftBaseline = publishedReady ? structuredClone(published) : null;
  mode = 'draft';
  const error = saveDraft(storage, draft, draftBaseline);
  draftSaved = !error;
  $('storage-notice').textContent = error || 'Saved on this device. Back up regularly.';
  render();
  message(error ? `${error} Results are in memory only. Download a backup before leaving this page.` : `${success} Saved on this device. Only owner publication shares results with everyone.`, Boolean(error));
  return error;
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
const tableSorts = new Map();
const tableCollator = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true });
const displayCell = (text, sortValue) => ({ text, sortValue });
const cellText = value => value && typeof value === 'object' ? value.text : value;
const cellValue = value => value && typeof value === 'object' ? value.sortValue : value;
function table(id, caption, columns, rows, emptyMessage = 'No data yet. The owner will publish reviewed registration and results.') {
  const definitions = columns.map(column => typeof column === 'string' ? { key: column, label: column } : column);
  let sort = tableSorts.get(id);
  if (sort && !definitions.some(column => column.key === sort.key)) {
    tableSorts.delete(id);
    sort = null;
  }
  if (!sort && id === 'league-table') sort = { key: 'Rank', direction: 'ascending' };
  const host = $(id);
  host.replaceChildren();
  if (!rows.length) { host.append(element('p', emptyMessage)); return; }
  const wrapper = element('div', undefined, 'table-wrap');
  wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', `${caption}, horizontally scrollable`);
  if (id === 'league-table') wrapper.setAttribute('aria-describedby', 'points-help');
  const tbl = element('table');
  tbl.append(element('caption', caption));
  const head = element('thead'), header = element('tr');
  const grouped = definitions.some(column => column.group);
  const leaves = element('tr');
  definitions.forEach((column, index) => {
    const th = element('th', undefined, column.className); th.scope = 'col';
    th.setAttribute('aria-sort', sort?.key === column.key ? sort.direction : 'none');
    const button = element('button', undefined, 'table-sort');
    button.type = 'button';
    const indicator = sort?.key === column.key ? sort.direction === 'ascending' ? ' ▲' : ' ▼' : ' ↕';
    button.append(element('span', column.label));
    const arrow = element('span', indicator, 'sort-indicator'); arrow.setAttribute('aria-hidden', 'true');
    button.append(arrow);
    button.setAttribute('aria-label', `${column.group ? `${column.groupDetail || column.group}: ` : ''}${column.label}, sort ${sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending'}`);
    button.addEventListener('click', () => {
      tableSorts.set(id, { key: column.key, direction: sort?.key === column.key && sort.direction === 'ascending' ? 'descending' : 'ascending' });
      const scrollLeft = wrapper.scrollLeft, scrollTop = wrapper.scrollTop;
      table(id, caption, columns, rows, emptyMessage);
      host.children[0].scrollLeft = scrollLeft; host.children[0].scrollTop = scrollTop;
      host.querySelectorAll('button')[index].focus({ preventScroll: true });
    });
    th.append(button);
    if (grouped && column.group) {
      if (definitions[index - 1]?.group !== column.group) {
        const group = element('th', column.group, 'weekend-column');
        if (column.groupDetail) {
          group.title = column.groupDetail;
          group.setAttribute('aria-label', column.groupDetail);
        }
        group.scope = 'colgroup';
        group.colSpan = definitions.filter(entry => entry.group === column.group).length;
        header.append(group);
      }
      if (definitions[index - 1]?.group !== column.group) th.className = `${column.className || ''} round-start`;
      leaves.append(th);
    } else {
      if (grouped) th.rowSpan = 2;
      header.append(th);
    }
  });
  head.append(header);
  if (grouped) head.append(leaves);
  tbl.append(head);
  const body = element('tbody');
  const ordered = rows.map((values, index) => ({ values, index }));
  if (sort) {
    const column = definitions.findIndex(entry => entry.key === sort.key);
    ordered.sort((a, b) => {
      const left = cellValue(a.values[column]), right = cellValue(b.values[column]);
      const missing = value => value === null || value === undefined || value === '';
      // Missing cards and unranked entries stay last in either direction. A real zero is not missing.
      if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right)) || a.index - b.index;
      const comparison = typeof left === 'number' && typeof right === 'number'
        ? left - right : tableCollator.compare(String(left), String(right));
      return (sort.direction === 'descending' ? -comparison : comparison) || a.index - b.index;
    });
  }
  ordered.forEach(({ values }) => { const row = element('tr'); values.forEach((value, i) => {
    const rowHeader = i === (id === 'teams-table' ? 0 : 1);
    const cell = element(rowHeader ? 'th' : 'td', String(cellText(value)), definitions[i].className);
    if (definitions[i].group && definitions[i - 1]?.group !== definitions[i].group) cell.className = `${definitions[i].className || ''} round-start`;
    if (value?.className) cell.className = `${cell.className || ''} ${value.className}`;
    if (value?.detail) { cell.title = value.detail; cell.setAttribute('aria-label', value.detail); }
    if (rowHeader) cell.scope = 'row';
    row.append(cell);
  }); body.append(row); });
  tbl.append(body); wrapper.append(tbl); host.append(wrapper);
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = element('a'); anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`Downloaded ${filename}. No server data was changed.`);
}
function csvDownload(filename, columns, rows) {
  download(filename, [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
}
$('export-leaderboard-pdf').addEventListener('click', safely(async () => {
  if (pdfBusy) return;
  if (mode === 'published' && !publishedReady) throw new Error('Published results are unavailable. Refresh before exporting.');
  const state = structuredClone(current());
  const context = { mode, saved: draftSaved, format: $('pdf-format').value };
  pdfBusy = true;
  $('export-leaderboard-pdf').disabled = true;
  $('export-leaderboard-pdf').textContent = 'Preparing PDF...';
  message('Preparing your leaderboard PDF on this device...');
  try {
    const { filename, buffer } = await createLeaderboardPDF(state, context);
    download(filename, buffer, 'application/pdf');
  } finally {
    pdfBusy = false;
    render();
  }
}));
$('pdf-format').value = 'standings';
$('pdf-format').addEventListener('change', () => render());
function renderSingles(state) {
  const result = singles(state, singlesSelection[mode]);
  singlesSelection[mode] = result.round?.date || null;
  const selector = $('singles-weekend');
  selector.replaceChildren();
  for (const round of result.rounds) {
    const status = round.canceled ? 'Canceled' : round.qualifying ? 'Qualifying' : 'Excluded / nonqualifying';
    const option = element('option', `${round.date}: ${round.name} (${status})`);
    option.value = round.date; selector.append(option);
  }
  selector.disabled = !result.rounds.length;
  if (result.round) selector.value = result.round.date;
  const summary = $('singles-summary');
  summary.classList.toggle('warning', Boolean(result.round && (result.round.canceled || !result.round.qualifying)));
  summary.textContent = result.round
    ? `${result.round.date}: ${result.round.name}. ${result.status}. ${result.round.canceled || !result.round.qualifying ? 'Historical review only, not active official standings. ' : ''}${result.rows.length} imported individual cards.`
    : 'No results uploaded yet. Use Upload HandicapMaster results on the team leaderboard.';
  table('singles-table', `${mode === 'draft' ? 'Local draft' : 'Published'} singles: ${result.round?.date || 'no weekend'} (${result.status || 'no results'})`,
    ['Position', 'Player', 'Net Stableford points', 'Team membership'], result.rows.map(row => [row.rank, row.player, row.score, row.team]),
    result.round ? 'No submitted individual cards for this weekend. No absent players or scores have been invented.' : 'Import weekend scores to see individual results, even before teams are registered.');
}
function render() {
  const state = current(), result = league(state);
  $('view-label').textContent = mode === 'draft' ? 'DRAFT: results on this device' : publishedReady ? 'PUBLISHED: club results' : 'Published data unavailable';
  $('resume-notice').hidden = mode === 'draft' || !draft?.rounds.some(round => round.cards.length);
  $('resume-results').textContent = draftSaved ? 'Resume my saved results' : 'Resume local results (not saved)';
  $('draft-banner').hidden = mode !== 'draft';
  $('draft-banner').classList.toggle('warning', !draftSaved);
  $('draft-banner').textContent = draftSaved
    ? 'Saved on this device. Only owner publication shares these results with everyone. Keep a backup.'
    : 'Not saved: results are in memory only. Download a backup in Committee tools before leaving this page. Public results are unchanged.';
  $('published-view').disabled = mode === 'published';
  $('published-view').hidden = mode === 'published';
  $('start-draft').textContent = draft ? 'View / resume my saved draft' : 'Start local draft (optional)';
  const activePlayers = new Set(state.teams.flatMap(team => team.players.filter(player => !isHeld(team, player)).map(canonical)));
  const uploaded = result.rounds.some(round => round.cards.length);
  const hasResults = result.rounds.some(round => round.cards.some(card => activePlayers.has(playerKey(card.player, state.identityBindings))));
  $('export-leaderboard-pdf').disabled = pdfBusy || !state.teams.length || (mode === 'published' && !publishedReady);
  for (const id of ['member-update', 'member-team-csv', 'member-singles-csv'])
    $(id).disabled = !state.teams.length || (mode === 'published' && !publishedReady);
  $('pdf-format').disabled = pdfBusy;
  const pdfFormat = $('pdf-format').value;
  const pdfLabel = pdfFormat === 'latest' ? 'latest weekend results' : pdfFormat === 'detail' ? 'full detail' : 'member standings';
  $('export-leaderboard-pdf').textContent = pdfBusy ? 'Preparing PDF...' : `Export ${pdfLabel} PDF`;
  $('pdf-help').textContent = !state.teams.length || (mode === 'published' && !publishedReady)
    ? 'PDF export needs an available team list. Refresh published results or resume a valid draft.'
    : `Download ${pdfLabel}. ${pdfFormat === 'latest' ? 'Latest dated imported weekend, including cancelled, excluded or empty weekends, clearly labelled.' :
      hasResults ? 'Official rank order and full season points, repeated for each readable weekend group.' : 'Registered team list, awaiting qualifying results (no invented ranks or totals).'} ${mode === 'draft' ? draftSaved ? 'Saved local draft, clearly marked DRAFT.' : 'Unsaved local results, clearly marked DRAFT: not saved.' : 'Published view; any saved local draft is not included.'} Nothing is published or sent to another service.`;
  $('results-empty').hidden = hasResults;
  $('empty-heading').textContent = uploaded && !hasResults ? 'No team matches yet' : state.rounds.length ? 'No qualifying results yet' : 'No results uploaded yet';
  $('empty-help').textContent = uploaded && !hasResults
    ? 'Results are saved, but no qualifying cards match an active team player. Review the unmatched or held cards below, or correct the team list in Committee tools.'
    : 'Upload a HandicapMaster net results CSV to match players to the team list and calculate the leaderboard.';
  $('points-help').hidden = !hasResults;
  $('awaiting-teams').hidden = hasResults;
  $('league-table').hidden = !hasResults;
  $('league-summary').textContent = hasResults
    ? `${state.teams.length} teams. ${result.rounds.length} qualifying weekend${result.rounds.length === 1 ? '' : 's'}.${state.settings.complete ? ` Qualification complete; ${result.discardCount} worst weekend(s) excluded from team points.` : ''}`
    : `${state.teams.length} registered teams. Standings appear when qualifying results match the team list.`;
  const warnings = [];
  if (hasResults && state.settings.complete && result.firstUnresolved) warnings.push('First place remains tied after the configured tie hierarchy.');
  if (hasResults && state.settings.complete && result.cutoffUnresolved) warnings.push('Top 16 cutoff needs a committee decision before final results can be entered.');
  $('tie-warning').hidden = !warnings.length;
  $('tie-warning').textContent = warnings.join(' ');
  const rosterWarnings = state.teams.filter(t => t.players.length < 3 || t.notes || t.heldPlayers?.length);
  $('team-review').hidden = !rosterWarnings.length;
  $('team-review-summary').textContent = `${rosterWarnings.length} team entries need review`;
  $('roster-warning').textContent = `Standings do not confirm player eligibility. ${rosterWarnings.map(t => `${t.name}: ${rosterStatus(t)}`).join(' | ')}`;
  const roundCards = new Map(result.rounds.map(round => [round.date, round]));
  const shortDate = date => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
  table('league-table', `${mode === 'draft' ? 'Local draft' : 'Published'} team leaderboard`, [
    { key: 'Rank', label: 'Rank', className: 'rank-column' },
    { key: 'Team', label: 'Team', className: 'team-column' },
    ...[1, 2, 3].map(player => ({ key: `Player ${player}`, label: `Player ${player}`, className: 'player-column' })),
    { key: 'Team points', label: 'Total', className: 'total-column' },
    ...result.rounds.flatMap((round, index) =>
    ['P1', 'P2', 'P3', 'Team'].map((label, player) => ({
      key: `${round.date}:${player}`, label, group: `Round ${index + 1}\n${shortDate(round.date)}`,
      groupDetail: `Round ${index + 1}: ${round.date}, ${round.name}`,
      className: player === 3 ? 'round-total-column' : 'score-column'
    })))], hasResults ? result.rows.map(r => [
    r.rank, r.team.name, ...[0, 1, 2].map(index => r.team.players[index] || 'Vacant'), r.retained,
    ...r.scores.flatMap(score => [
      ...weekendCards(r.team, roundCards.get(score.date), state.identityBindings).map(card => ({
        ...displayCell(card.text, card.score ?? null),
        className: card.counting ? 'counting-card' : 'non-counting-card',
        detail: `${card.text}: ${card.held ? 'held, not counted' : card.score === undefined ? 'no card or vacant' : card.counting ? 'best-two counting card' : 'non-counting card'}${score.discarded ? '; weekend discarded from Total' : ''}`
      })),
      { ...displayCell(`${score.total}${score.discarded ? ' D' : ''}`, score.total),
        detail: score.discarded ? `${score.total}, discarded weekend, excluded from Total` : undefined }
    ])
  ]) : []);
  table('awaiting-table', 'Team list, awaiting qualifying results', ['Team', 'Players'], state.teams.map(t => [t.name, t.players.join(', ')]));
  const unmatched = state.rounds.flatMap(round => round.cards.map(card => ({ round, card, match: cardMatch(state.teams, card, state.identityBindings) })))
    .filter(entry => entry.match.status !== 'Matched');
  $('matching-review').hidden = !unmatched.length;
  $('matching-summary').textContent = `${unmatched.length} uploaded cards need a team match or confirmation`;
  $('review-notice').hidden = !unmatched.length && !rosterWarnings.length;
  $('review-count').textContent = `${unmatched.length} cards not counted for teams; ${rosterWarnings.length} team entries need review.`;
  table('matching-table', 'Cards not counted for teams', ['Weekend', 'Player', 'Net points', 'Team', 'Review'], unmatched.map(({ round, card, match }) => [round.date, card.player, card.score, match.team, match.status]));
  renderSingles(state);
  table('teams-table', 'Team list (team numbers preserved)', ['Team', 'Player 1', 'Player 2', 'Player 3', 'Team notes'], state.teams.map(t => [t.name, t.players[0], t.players[1], t.players[2] || 'Vacant', rosterStatus(t)]));
  table('rounds-table', 'All imported weekends', ['Weekend', 'Round', 'Status', 'Cards'], [...state.rounds].sort((a, b) => a.date.localeCompare(b.date)).map(r => [r.date, r.name, r.canceled ? 'Canceled for everyone' : r.qualifying ? 'Qualifying' : 'Excluded / nonqualifying', r.cards.length]));
  const assigned = assignments(state.teams, state.identityBindings);
  table('cards-table', 'All individual weekend cards', ['Weekend', 'Player', 'Team', 'Net Stableford', 'Playing handicap (metadata)'], state.rounds.flatMap(r => r.cards.map(c => [r.date, c.player, assigned.get(canonical(c.player)) || 'Unassigned', c.score, displayCell(c.handicap ?? 'Not supplied', c.handicap ?? null)])));
  const matched = new Set(state.teams.flatMap(t => t.players.filter(p => !isHeld(t, p)).map(canonical)));
  table('unassigned-table', 'Unassigned raw cards (including held names)', ['Weekend', 'Player', 'Net Stableford', 'Playing handicap (metadata)'], state.rounds.flatMap(r => r.cards.filter(c => !matched.has(playerKey(c.player, state.identityBindings))).map(c => [r.date, c.player, c.score, displayCell(c.handicap ?? 'Not supplied', c.handicap ?? null)])));
  const finals = finalTable(state);
  $('final-summary').textContent = !state.settings.complete ? 'Final locked: qualification is not complete.' : result.cutoffUnresolved ? 'Final locked: unresolved top 16 cutoff.' : `Final open for ${result.eligible.length} eligible teams. Team total: ${state.settings.finalScoring === 'best2' ? 'best 2 cards (committee assumption)' : 'all 3 cards (committee-selected interpretation)'}. Countback: all 3 cards. Date: ${state.final?.date || 'awaiting confirmation'}.`;
  table('final-table', 'Final standings, no league carryover', ['Rank', 'Team', 'Cards / 3', 'Final total', 'Back 9', 'Back 6', 'Back 3', 'Back 1'], finals.map(r => [displayCell(r.rank ?? 'Unranked (missing cards)', r.rank), r.team.name, r.cards, displayCell(r.cards === 3 ? r.total : 'Pending', r.cards === 3 ? r.total : null), ...r.countback]));
  $('final-template').disabled = !state.settings.complete || result.cutoffUnresolved || !result.eligible.length;
  const settings = draft?.settings || state.settings;
  $('max-rounds').value = settings.maxRounds;
  $('discard-count').value = settings.discardCount;
  $('complete').checked = settings.complete;
  $('final-scoring').value = settings.finalScoring;
  renderRoundEditors();
  renderRosterEditor();
  updateApplyAvailability();
}
function loadRosterTeam() {
  const team = (draft || published).teams.find(t => t.name === $('roster-select').value);
  $('roster-name').value = team?.name || '';
  $('roster-name').readOnly = Boolean(team);
  for (let i = 1; i <= 3; i++) {
    $('roster-player' + i).value = team?.players[i - 1] || '';
    $('roster-held' + i).checked = Boolean(team && isHeld(team, team.players[i - 1] || ''));
  }
  $('roster-notes').value = team?.notes || '';
}
function renderRosterEditor() {
  const state = draft || published, selector = $('roster-select'), selected = selector.value;
  selector.replaceChildren();
  const add = element('option', 'Add a new three-player team'); add.value = ''; selector.append(add);
  for (const team of state.teams) {
    const option = element('option', `${team.name}: ${team.players.join(', ')}`);
    option.value = team.name; selector.append(option);
  }
  selector.value = state.teams.some(t => t.name === selected) ? selected : '';
  loadRosterTeam();
  const flagged = state.teams.filter(t => t.players.length < 3 || t.notes || t.heldPlayers?.length);
  $('roster-notice').textContent = `${draft ? 'Editing saved local draft' : 'Editing will create a local draft from published data'}. ${state.teams.length} teams. ${flagged.map(t => `${t.name}: ${rosterStatus(t)}`).join(' | ')}`;
  $('use-published-roster').disabled = !publishedReady || !published.teams.length;
}
$('roster-select').addEventListener('change', loadRosterTeam);
$('roster-form').addEventListener('submit', safely(() => {
  const original = $('roster-select').value || null;
  const players = [1, 2, 3].map(i => $('roster-player' + i).value.trim());
  if (!players[0] || !players[1] || (!players[2] && canonical($('roster-name').value) !== 'team34'))
    throw new Error('Provide three named players. Only Team 34 may leave Player 3 vacant.');
  const team = { name: $('roster-name').value.trim(), players: players.filter(Boolean),
    notes: $('roster-notes').value.trim(), heldPlayers: players.filter((p, i) => p && $('roster-held' + (i + 1)).checked) };
  const next = editTeam(importBase(), original, team);
  if (!confirm('Save this team list change for every weekend? Raw cards and settings stay unchanged; changed names may leave cards unassigned. Back up first.')) return;
  persist(next, 'Team saved. Review Teams, Singles and unassigned cards before publishing.');
  $('roster-select').value = team.name;
  loadRosterTeam();
  if (pending?.kind === 'teams') clearPreview();
}));
$('use-published-roster').addEventListener('click', safely(() => {
  if (!publishedReady || !published.teams.length) throw new Error('Published team list is unavailable. Refresh published data first.');
  const next = replaceTeams(importBase(), published.teams);
  if (!confirm(`Replace draft registration with ${published.teams.length} published teams? Draft raw scores and settings remain; omitted teams are removed. Back up first.`)) return;
  persist(next, 'Published team list copied into draft. Existing raw scores retained.');
  if (pending?.kind === 'teams') clearPreview();
}));
$('roster-export').addEventListener('click', safely(() => {
  const state = importBase();
  csvDownload('team-roster.csv', ['Team Name', 'Player1', 'Player2', 'Player3', 'Notes', 'Held Players'],
    state.teams.map(t => [t.name, t.players[0], t.players[1], t.players[2] || '', t.notes || '', (t.heldPlayers || []).join('|')]));
}));
function labeled(form, label, type, value) {
  const wrapper = element('label', label), input = element('input');
  input.type = type;
  if (type === 'checkbox') { input.checked = value; wrapper.className = 'check'; } else input.value = value;
  wrapper.append(input); form.append(wrapper); return input;
}
function renderRoundEditors() {
  const host = $('round-editors'); host.replaceChildren();
  if (!draft?.rounds.length) { host.append(element('p', 'No draft weekends. Start a draft and import scores.')); return; }
  for (const round of [...draft.rounds].sort((a, b) => a.date.localeCompare(b.date))) {
    const form = element('form', undefined, 'round-editor');
    form.append(element('strong', `${round.date}: ${round.cards.length} cards`));
    const date = labeled(form, 'Weekend date', 'date', round.date);
    const name = labeled(form, 'Round name', 'text', round.name); name.maxLength = 160;
    const qualifying = labeled(form, 'Qualifying', 'checkbox', round.qualifying);
    const canceled = labeled(form, 'Weather canceled (entire weekend)', 'checkbox', round.canceled);
    const save = element('button', 'Save weekend metadata'); save.type = 'submit'; form.append(save);
    const remove = element('button', 'Remove this weekend'); remove.type = 'button'; form.append(remove);
    remove.disabled = published.rounds.some(entry => entry.date === round.date);
    if (remove.disabled) remove.title = 'Published weekends are permanent history. Exclude or cancel a weekend instead, then request reviewed owner publication.';
    form.addEventListener('submit', safely(() => {
      if (!confirm('Change this weekend for every team? Existing final eligibility may prevent this edit; remove final cards first if needed.')) return;
      const next = structuredClone(working());
      const index = next.rounds.findIndex(r => r.date === round.date);
      next.rounds[index] = { ...next.rounds[index], date: weekendDate(date.value), name: name.value.trim(), qualifying: qualifying.checked, canceled: canceled.checked };
      persist(next, 'Weekend metadata updated.');
    }));
    remove.addEventListener('click', safely(() => {
      if (!confirm(`Remove ${round.date} and every card in this weekend?`)) return;
      const next = structuredClone(working()); next.rounds = next.rounds.filter(r => r.date !== round.date);
      persist(next, 'Weekend removed.');
    }));
    host.append(form);
  }
}
async function loadPublished() {
  const response = await fetch('./data/published.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load latest published results (HTTP ${response.status}). Retry before importing or exporting publication JSON.`);
  const state = parseJSON(await response.text());
  published = state; publishedReady = true;
}
async function refresh() {
  try {
    await loadPublished();
    if (mode === 'draft' && draft) {
      persist(synchroniseDraft(draft, published, draftBaseline), 'Draft synchronised with latest published history.');
      return;
    }
    render(); message('Published results loaded.');
  } catch (error) {
    render();
    message(`Could not refresh published results: ${error.message}. ${publishedReady ? 'Keeping the last validated published data.' : 'No published result is available. Use a local HTTP server, not file://, for local viewing.'}`, true);
  }
}
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(index, focus = false) {
  if (index >= 2) $('more-views').open = true;
  tabs.forEach((tab, i) => {
    tab.setAttribute('aria-selected', String(index === i));
    tab.tabIndex = index === i ? 0 : -1;
    $(tab.getAttribute('aria-controls')).hidden = index !== i;
  });
  if (focus) tabs[index].focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(index));
  tab.addEventListener('keydown', event => {
    const target = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (target !== undefined) { event.preventDefault(); selectTab(target, true); }
  });
});
$('club-logo').addEventListener('error', () => { $('club-logo').hidden = true; });
$('published-view').addEventListener('click', () => { mode = 'published'; render(); message(publishedReady ? 'Showing owner-published data. Your draft is preserved.' : 'Published data unavailable; refresh or use a local HTTP server.', !publishedReady); });
$('refresh').addEventListener('click', refresh);
$('singles-weekend').addEventListener('change', () => {
  singlesSelection[mode] = $('singles-weekend').value;
  renderSingles(current());
});
async function resumeResults() { await loadPublished(); persist(resultsState(working()), 'Saved results opened with latest published history.'); selectTab(0); }
$('start-draft').addEventListener('click', safely(resumeResults));
$('resume-results').addEventListener('click', safely(resumeResults));
function openResultsUpload() {
  selectTab(0);
  if ($('import-type').value !== 'scores') chooseImportType('scores');
  $('upload-panel').open = true;
  $('import-files').focus();
  $('import-files').click();
}
$('upload-results').addEventListener('click', openResultsUpload);
$('empty-upload').addEventListener('click', openResultsUpload);
$('reset-draft').addEventListener('click', safely(() => {
  if (!publishedReady) throw new Error('Published data is unavailable; refresh first.');
  if (!confirm('Replace the entire local draft with current published data? Download a backup first.')) return;
  storageBlocked = false; persist(published, 'Draft replaced with published data.');
}));
$('delete-draft').addEventListener('click', safely(() => {
  if (!confirm('Delete the saved local draft and in-memory draft? Public data remains unchanged.')) return;
  try { storage?.removeItem(STORAGE_KEY); storage?.removeItem(BASELINE_KEY); } catch { throw new Error('Browser refused to delete storage. Use browser site-data controls.'); }
  draft = null; draftBaseline = null; storageBlocked = false; mode = 'published'; clearPreview();
  $('storage-notice').textContent = 'Local draft deleted.'; render(); message('Local draft deleted. Public data unchanged.');
}));
$('demo').addEventListener('click', safely(() => {
  if (!confirm('Replace your local draft with explicitly synthetic demonstration data? This does not publish anything.')) return;
  const demo = emptyState();
  demo.teams = ['A', 'B', 'C'].map(letter => ({ name: `DEMO Team ${letter}`, players: [1, 2, 3].map(i => `Player ${letter}${i}`) }));
  demo.rounds = [{ date: '2026-11-07', name: 'SYNTHETIC demonstration only', qualifying: true, canceled: false, cards: demo.teams.flatMap((t, j) => t.players.map((player, i) => ({ player, score: 30 + j + i }))) }];
  storageBlocked = false; persist(demo, 'Synthetic DEMO loaded; not official results.');
}));
function clearPreview(keepRecognized = false) {
  previewRevision++;
  pending = null; $('preview').hidden = true;
  $('score-metadata').hidden = true; $('final-metadata').hidden = true;
  $('score-metadata').disabled = true; $('final-metadata').disabled = true;
  $('cancel-preview').hidden = true;
  if (!keepRecognized) { $('recognized-scorecards').hidden = true; $('recognized-scorecards').textContent = ''; }
  $('net-confirm').checked = false;
  updateApplyAvailability();
}
function updateApplyAvailability() {
  let help = pending ? 'Preview ready. Review the rows before updating. Replacement requires confirmation.' : 'Choose files above to preview. Nothing is saved yet.';
  let ready = Boolean(pending);
  if (pending?.kind === 'scores') {
    const missing = [];
    try { weekendDate($('weekend-date').value); } catch { missing.push('a Saturday or Sunday weekend date'); }
    if (!$('round-name').value.trim()) missing.push('a round name');
    if (!$('net-confirm').checked) missing.push('confirmation of reported 12-hole net Stableford points');
    ready = !missing.length;
    help = missing.length ? `Before updating, provide ${missing.join(', ')}.` : 'Ready to update the leaderboard on this device. Recognized gross scorecards will not be stored.';
    $('round-name').classList.toggle('needs-input', !$('round-name').value.trim());
  }
  if (pending && pending.kind !== 'restore' && storageBlocked) {
    ready = false; help = 'Unreadable draft preserved. Restore a validated JSON backup or explicitly replace/delete the draft before saving.';
  } else if (pending && pending.kind !== 'restore' && !draft && !publishedReady) {
    ready = false; help = 'Published data is unavailable. Refresh it or restore a validated JSON backup before saving.';
  }
  $('apply-import').disabled = !ready;
  $('import-apply-help').textContent = help;
}
function updateImportType() {
  clearPreview();
  const kind = $('import-type').value;
  const labels = {
    scores: ['Upload HandicapMaster results', 'Choose results and scorecard CSVs', 'Preview results / retry', 'Update leaderboard'],
    teams: ['Upload team registration CSV', 'Choose team registration CSV', 'Preview teams', 'Save teams to my draft'],
    final: ['Upload final player cards CSV', 'Choose final cards CSV', 'Preview final cards', 'Save final cards to my draft'],
    restore: ['Restore JSON backup', 'Choose JSON backup', 'Preview JSON restore', 'Replace my draft with this JSON']
  }[kind];
  ['import-heading', 'import-file-label', 'preview-import', 'apply-import'].forEach((id, i) => { $(id).textContent = labels[i]; });
  $('import-help').textContent = {
    scores: 'Feeds League and Singles. Select your results and scorecard CSVs together. Net reports supply points; recognized gross scorecards are excluded.',
    teams: 'Replaces the team list after confirmation, keeping raw scores and settings. Team 34 may have a vacant third place. Existing notes and holds are retained unless CSV columns explicitly replace them.',
    final: 'Final only, not weekly League or Singles results. Requires completed qualification and eligible registered players.',
    restore: 'Restores a validated JSON backup or publication file. Replaces the entire local draft only after confirmation.'
  }[kind];
  $('import-example').textContent = {
    scores: 'Example filename: Competition Report 2026-11-07.csv',
    teams: 'Use the Team CSV template below.',
    final: 'Use the eligible final CSV template on the Final tab.',
    restore: 'Example filename: blainroe-draft-backup.json'
  }[kind];
  $('import-steps').textContent = kind === 'scores'
    ? '1. Choose CSV(s) for automatic preview. 2. Review player matches, weekend and round name; confirm net points. 3. Update leaderboard.'
    : '1. Choose a file. 2. Preview. 3. Review and confirm replacement. 4. Apply to your local draft.';
  $('import-file-help').textContent = kind === 'scores'
    ? 'Maximum 2 MB each, up to 20 files. Include Competition Report (Aggregated Net Result) for one weekend. Identical cards are deduplicated; conflicts are rejected. No Return and DQ rows are omitted with preview counts.'
    : 'Choose one file, maximum 2 MB. Preview saves nothing; review before applying to your local draft.';
  $('import-files').value = '';
  $('import-files').accept = kind === 'restore' ? '.json,application/json' : '.csv,text/csv';
  $('import-files').multiple = kind === 'scores';
  $('results-import').hidden = kind === 'scores';
  $('import-status').textContent = 'Choose files to preview automatically. Nothing is saved until you explicitly apply.';
  $('import-status').classList.toggle('error', false);
}
function chooseImportType(kind) {
  selectTab(0);
  $('upload-panel').open = true;
  $('import-type').value = kind;
  updateImportType();
  $('import-files').focus();
}
$('import-type').addEventListener('change', updateImportType);
$('teams-import').addEventListener('click', () => chooseImportType('teams'));
$('results-import').addEventListener('click', () => chooseImportType('scores'));
$('import-files').addEventListener('change', previewFiles);
$('cancel-preview').addEventListener('click', () => {
  clearPreview(); importMessage('Preview canceled. No data was saved. Choose files or use Preview to try again.');
  $('import-files').focus();
});
async function previewFiles(event) {
  event?.preventDefault();
  clearPreview();
  const revision = previewRevision;
  try { await readImportFiles(revision); } catch (error) {
    if (revision === previewRevision) importMessage(`${error.message} Fix the selection and choose files again or use Preview / retry.`, true, true);
  }
}
async function readImportFiles(revision) {
  const kind = $('import-type').value, files = [...$('import-files').files];
  if (!files.length) throw new Error('Choose a file.');
  if (kind !== 'scores' && files.length !== 1) throw new Error('Choose exactly one file for this import type.');
  if (kind !== 'restore') await loadPublished();
  if (files.length > 20) throw new Error('Choose at most 20 CSV files per preview.');
  for (const file of files) if (file.size > MAX_BYTES) throw new Error(`${file.name} exceeds the 2 MB file limit.`);
  importMessage(`Reading ${files.length} selected file(s). Nothing is saved yet.`);
  const sources = await Promise.all(files.map(async file => {
    try { return await file.text(); } catch { throw new Error(`${file.name}: could not read this file. Select it again or export a fresh CSV.`); }
  }));
  if (revision !== previewRevision) return;
  let data, rows, columns, omissions = '', matchingSummary = '';
  if (kind === 'teams') {
    data = replaceTeams(importBase(), parseTeams(sources[0])).teams;
    rows = data.map(t => [t.name, t.players[0], t.players[1], t.players[2] || 'Vacant', rosterStatus(t)]);
    columns = ['Team', 'Player 1', 'Player 2', 'Player 3', 'Team notes'];
  } else if (kind === 'scores') {
    const recognized = [], resultIndices = [];
    for (let index = 0; index < sources.length; index++) {
      try {
        if (classifyScoreCSV(sources[index]) === 'scorecards') recognized.push(files[index].name);
        else resultIndices.push(index);
      } catch (error) { throw new Error(`${files[index].name}: ${error.message}`); }
    }
    if (recognized.length) {
      $('recognized-scorecards').hidden = false;
      $('recognized-scorecards').textContent = `${recognized.length} recognized scorecard file(s), not used for net League or Singles scoring: ${recognized.join(', ')}. No scorecard data is stored. Winter Eclectic is not implemented yet. Keep the original files privately.`;
    }
    if (!resultIndices.length) throw new Error('Only gross scorecards were selected. Add Competition Report (Aggregated Net Result) CSV to preview and save League and Singles net results. No data was saved.');
    const parsed = resultIndices.map(index => {
      try { return parseScores(sources[index]); } catch (error) { throw new Error(`${files[index].name}: ${error.message}`); }
    }), cards = new Map();
    const noReturn = parsed.reduce((sum, entry) => sum + (entry.omitted?.noReturn || 0), 0);
    const disqualified = parsed.reduce((sum, entry) => sum + (entry.omitted?.disqualified || 0), 0);
    if (noReturn || disqualified) omissions = ` Omitted ${noReturn + disqualified} non-scoring result rows (${noReturn} no return/withdrawn; ${disqualified} disqualified). These rows contribute no scores.`;
    const weekendKeys = parsed.map(p => {
      if (!p.playedOn) return null;
      const day = new Date(`${p.playedOn}T12:00:00Z`).getUTCDay();
      return [0, 6].includes(day) ? weekendDate(p.playedOn) : null;
    });
    const dates = [...new Set(weekendKeys.filter(Boolean))];
    if (dates.length > 1) throw new Error(`Result files contain different weekends (${resultIndices.map(index => files[index].name).join(', ')}). Import each weekend separately.`);
    const base = resultsState(storageBlocked ? draft || published : importBase());
    for (const [index, entry] of parsed.entries()) for (const card of entry.cards) {
      const key = playerKey(card.player, base.identityBindings), previous = cards.get(key);
      if (previous && canonical(previous.player) !== canonical(card.player))
        throw new Error(`${files[resultIndices[index]].name}: duplicate confirmed identity for ${card.player}. Review the complete report; no duplicate is counted.`);
      if (previous && (previous.score !== card.score || previous.handicap !== card.handicap)) throw new Error(`${files[resultIndices[index]].name}: conflicting uploaded cards for ${card.player}. Choose the correct points and handicap metadata and prepare a corrected CSV; no duplicate is counted.`);
      if (!previous) cards.set(key, card);
    }
    data = [...cards.values()];
    $('weekend-date').value = weekendKeys.every(Boolean) ? dates[0] : '';
    const existing = (draft || published).rounds.find(r => r.date === dates[0]);
    const reportNames = [...new Set(parsed.map(entry => entry.name).filter(Boolean))];
    $('round-name').value = existing?.name || (reportNames.length === 1 ? reportNames[0] : '') ||
      (weekendKeys.every(Boolean) ? `Weekend ${dates[0]}` : '');
    $('qualifying').checked = existing?.qualifying ?? true;
    $('net-confirm').checked = false; $('import-mode').value = 'merge';
    const matches = data.map(card => cardMatch(base.teams, card, base.identityBindings));
    const matched = matches.filter(match => match.status === 'Matched').length;
    const held = matches.filter(match => match.status.startsWith('Held')).length;
    matchingSummary = ` ${matched} matched, ${matches.length - matched - held} unmatched, ${held} held.`;
    if (draft && !draft.teams.length && base.teams.length) matchingSummary += ' The published team list will be added when you update; existing scores and settings stay unchanged.';
    rows = data.map((card, index) => [card.player, matches[index].player, matches[index].team, card.score, matches[index].status]);
    columns = ['Report player', 'Team list player', 'Team', 'Net points', 'Match'];
  } else if (kind === 'restore') {
    data = parseJSON(sources[0]); rows = [[data.teams.length, data.rounds.length, data.final?.cards.length || 0]]; columns = ['Teams', 'Weekends', 'Final cards'];
  } else {
    data = parseFinal(sources[0], importBase(), $('final-date').value || null);
    rows = data.cards.map(c => [c.team, c.player, c.total, c.back9, c.back6, c.back3, c.back1]); columns = ['Team', 'Player', 'Total', 'Back9', 'Back6', 'Back3', 'Back1'];
  }
  pending = { kind, data };
  $('preview-summary').textContent = `${files.map(f => f.name).join(', ')}: ${rows.length} preview rows.${matchingSummary} Review all names and values. Nothing has been saved.${omissions}${kind === 'scores' && !$('weekend-date').value ? ' A file has no usable weekend date: explicitly assign the committee weekend below.' : ''}`;
  table('preview-table', 'Pending import', columns, rows);
  $('score-metadata').hidden = kind !== 'scores'; $('final-metadata').hidden = kind !== 'final';
  $('score-metadata').disabled = kind !== 'scores'; $('final-metadata').disabled = kind !== 'final';
  $('cancel-preview').hidden = false;
  $('preview').hidden = false;
  updateApplyAvailability();
  importMessage(`Preview ready: ${rows.length} valid ${kind === 'scores' ? 'net cards' : 'rows'}.${matchingSummary}${omissions} Review the matches and required details, then update the leaderboard. Nothing is saved yet.`, false, true);
}
$('import-form').addEventListener('submit', previewFiles);
$('round-name').addEventListener('input', updateApplyAvailability);
$('net-confirm').addEventListener('change', updateApplyAvailability);
$('weekend-date').addEventListener('input', updateApplyAvailability);
$('weekend-date').addEventListener('change', safelyImport(() => {
  updateApplyAvailability();
  if (!$('weekend-date').value) return;
  const existing = (draft || published).rounds.find(r => r.date === weekendDate($('weekend-date').value));
  if (existing) { $('round-name').value = existing.name; $('qualifying').checked = existing.qualifying; }
  updateApplyAvailability();
}));
$('apply-form').addEventListener('submit', safelyImport(async () => {
  if (!pending) throw new Error('Read a file and preview it first.');
  await loadPublished();
  let next;
  if (pending.kind === 'restore') {
    if (!confirm('Replace the entire local draft with this validated JSON? Download a backup first.')) return;
    next = synchroniseDraft(pending.data, published);
    storageBlocked = false;
  } else {
    next = structuredClone(importBase());
    if (pending.kind === 'teams') {
      const removed = next.teams.filter(t => !pending.data.some(p => canonical(p.name) === canonical(t.name))).map(t => t.name);
      if (!confirm(`Replace all draft registrations with ${pending.data.length} previewed teams? Removed teams: ${removed.join(', ') || 'none'}. Raw scores remain unchanged and will recalculate; review unassigned cards. Back up first.`)) return;
      next = replaceTeams(next, pending.data);
    } else if (pending.kind === 'scores') {
      next = resultsState(next);
      if (!$('net-confirm').checked) throw new Error('Confirm net Stableford points before importing.');
      const date = weekendDate($('weekend-date').value), existing = next.rounds.find(r => r.date === date);
      if ($('import-mode').value === 'replace' && existing && !confirm(`Replace EVERY card in ${date} with this preview? Omitted players will have zero. This cannot be undone without a backup.`)) return;
      next = importRound(next, { date, name: $('round-name').value.trim(), qualifying: $('qualifying').checked, canceled: existing?.canceled || false, cards: pending.data }, $('import-mode').value);
    } else {
      if (!confirm('Replace ALL draft final cards with this preview? Teams with fewer than 3 cards remain unranked.')) return;
      next.final = { ...pending.data, date: $('final-date').value || null };
    }
  }
  const scoreImport = pending.kind === 'scores';
  const error = persist(next, scoreImport ? 'Net results saved. Leaderboard updated. Recognized gross scorecards were not stored.' : 'Import applied.');
  clearPreview(true);
  importMessage($('status').textContent, Boolean(error), true);
  if (scoreImport) {
    selectTab(0);
    $('upload-panel').open = false;
    $('matching-review').open = false;
    $('leaderboard-heading').focus();
  }
}));
$('settings-form').addEventListener('submit', safely(() => {
  if (!confirm('Apply committee settings? Completion enables common-schedule discards and final eligibility. Confirm the interpretations before publication.')) return;
  const next = structuredClone(working());
  next.settings = { maxRounds: Number($('max-rounds').value), discardCount: Number($('discard-count').value), complete: $('complete').checked, finalScoring: $('final-scoring').value };
  persist(next, 'Committee settings saved.');
}));
$('clear-final').addEventListener('click', safely(() => {
  if (!confirm('Remove every final card from your draft?')) return;
  const next = structuredClone(working()); next.final = null; persist(next, 'Final cards removed.');
}));
$('backup').addEventListener('click', safely(() => { download('blainroe-draft-backup.json', JSON.stringify(validateState(draft || published), null, 2) + '\n', 'application/json'); }));
$('publication').addEventListener('click', safely(async () => {
  await loadPublished();
  const state = protectPublishedHistory(validateState(working()), published);
  if (!confirm('Export this draft for owner publication? Names will become publicly readable if the owner commits this file. Confirm consent and verify all results first.')) return;
  download('published.json', JSON.stringify(state, null, 2) + '\n', 'application/json');
}));
$('report').addEventListener('click', safely(() => {
  if (mode === 'published' && !publishedReady) throw new Error('Cannot export a published report until validated published data has loaded.');
  download('blainroe-winter-league-report.html', reportHTML(current(), mode === 'draft' ? 'Browser-only draft, NOT official results' : 'Owner-published data'), 'text/html;charset=utf-8');
}));
$('member-update').addEventListener('click', safely(() => {
  if (mode === 'published' && !publishedReady) throw new Error('Cannot prepare a member update until validated published data has loaded.');
  const update = memberUpdate(current(), { mode, saved: draftSaved });
  download(update.filename, update.html, 'text/html;charset=utf-8');
  message('Downloaded newsletter prose only. Download Singles and Team tables separately. Review before sending. Nothing was published or sent.');
}));
for (const [id, type, key] of [
  ['member-team-csv', 'team-standings', 'teamCSV'],
  ['member-singles-csv', 'singles', 'singlesCSV']
]) $(id).addEventListener('click', safely(() => {
  if (mode === 'published' && !publishedReady) throw new Error('Cannot prepare member tables until validated published data has loaded.');
  const update = memberUpdate(current(), { mode, saved: draftSaved });
  download(`blainroe-${type}-${update.through}.csv`, update[key], 'text/csv;charset=utf-8');
  message('Downloaded a separate member table. Review before sharing. Nothing was published or sent.');
}));
$('team-template').addEventListener('click', () => csvDownload('team-template.csv', ['Team Name', 'Player1', 'Player2', 'Player3'], []));
$('score-template').addEventListener('click', () => csvDownload('net-stableford-template.csv', ['Player', 'Score', 'Handicap'],
  [...new Map(current().teams.flatMap(t => t.players.map(p => [canonical(p), p]))).values()].map(p => [p, '', ''])));
$('final-template').addEventListener('click', safely(() => {
  const state = current(), eligible = league(state).eligible;
  if (!state.settings.complete || league(state).cutoffUnresolved) throw new Error('Final template locked until qualification is complete and cutoff is resolved.');
  csvDownload('final-template.csv', ['Team', 'Player', 'Total', 'Back9', 'Back6', 'Back3', 'Back1'], state.teams.filter(t => eligible.includes(t.name)).flatMap(t => t.players.filter(p => !isHeld(t, p)).map(p => [t.name, p, '', '', '', '', ''])));
}));
updateImportType();
render();
refresh();
