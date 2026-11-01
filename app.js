import { MAX_BYTES, emptyState, canonical, validateState, parseJSON, parseTeams, parseScores, parseFinal, importRound, weekendDate, league, singles, finalTable, csvCell, reportHTML } from './core.js';
import { readDraft, saveDraft, STORAGE_KEY } from './storage.js';

const $ = id => document.getElementById(id);
let published = emptyState(), publishedReady = false, draft = null, mode = 'published', pending = null, storageBlocked = false;
const singlesSelection = { published: null, draft: null };
let storage;
try { storage = window.localStorage; } catch { storage = null; }
const restored = readDraft(storage);
draft = restored.state;
storageBlocked = Boolean(restored.error);
$('storage-notice').textContent = restored.error || (draft ? 'Saved local draft available. Public view is shown by default.' : 'No local draft saved yet.');
function message(value, error = false) {
  $('status').textContent = value;
  $('status').classList.toggle('error', error);
}
function safely(action) {
  return async event => {
    event?.preventDefault();
    try { await action(event); } catch (error) { message(error.message, true); }
  };
}
function current() { return mode === 'draft' && draft ? draft : published; }
function working() {
  if (!draft) {
    if (storageBlocked) throw new Error('Unreadable draft preserved. Explicitly replace it with published data or delete it before importing.');
    if (!publishedReady) throw new Error('Published data is unavailable. Refresh it first, or restore a validated JSON backup.');
    draft = structuredClone(published);
  }
  return draft;
}
function persist(state, success) {
  validateState(state);
  if (storageBlocked) throw new Error('Unreadable storage preserved. Explicitly replace or delete the local draft first.');
  draft = structuredClone(state);
  mode = 'draft';
  const error = saveDraft(storage, draft);
  $('storage-notice').textContent = error || 'Local draft saved on this browser. Back up regularly.';
  render();
  message(error ? `${success} ${error}` : `${success} Browser-only draft; public data unchanged.`, Boolean(error));
}
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function table(id, caption, columns, rows, emptyMessage = 'No data yet. The owner will publish reviewed registration and results.') {
  const host = $(id);
  host.replaceChildren();
  if (!rows.length) { host.append(element('p', emptyMessage)); return; }
  const wrapper = element('div', undefined, 'table-wrap');
  wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', `${caption}, horizontally scrollable`);
  const tbl = element('table');
  tbl.append(element('caption', caption));
  const head = element('thead'), header = element('tr');
  columns.forEach((column, index) => {
    const th = element('th'); th.scope = 'col';
    if (id === 'league-table' && index >= 6) {
      th.className = 'weekend-column';
      th.setAttribute('aria-label', column); th.title = column;
      th.append(element('span', column.slice(0, 10), 'weekend-date'), element('span', column.slice(12), 'weekend-heading'));
    } else th.textContent = column;
    header.append(th);
  });
  head.append(header); tbl.append(head);
  const body = element('tbody');
  rows.forEach(values => { const row = element('tr'); values.forEach((value, i) => {
    const cell = element(i === 1 ? 'th' : 'td', String(value));
    if (i === 1) cell.scope = 'row';
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
    : 'No imported weekends in this view. The owner can preview and apply net Stableford scores in Administration, then publish reviewed results.';
  table('singles-table', `${mode === 'draft' ? 'Local draft' : 'Published'} singles: ${result.round?.date || 'no weekend'} (${result.status || 'no results'})`,
    ['Position', 'Player', 'Net Stableford points', 'Team membership'], result.rows.map(row => [row.rank, row.player, row.score, row.team]),
    result.round ? 'No submitted individual cards for this weekend. No absent players or scores have been invented.' : 'Import weekend scores to see individual results, even before teams are registered.');
}
function render() {
  const state = current(), result = league(state);
  $('view-label').textContent = mode === 'draft' ? 'Browser-only draft results' : publishedReady ? 'Published club results' : 'Published data unavailable';
  $('draft-banner').hidden = mode !== 'draft';
  $('published-view').disabled = mode === 'published';
  $('league-summary').textContent = `${state.settings.complete ? 'Qualification complete' : 'Provisional league, no discards applied'}: ${result.rounds.length} of at most ${state.settings.maxRounds} qualifying weekends. ${result.discardCount} discarded per team; ${result.rounds.length - result.discardCount} retained. ${state.teams.length} registered teams.`;
  const warnings = [];
  if (result.firstUnresolved) warnings.push('First place remains tied after the configured tie hierarchy.');
  if (result.cutoffUnresolved) warnings.push('Top 16 cutoff is unresolved. No teams are confirmed qualified and final imports are blocked.');
  $('tie-warning').hidden = !warnings.length;
  $('tie-warning').textContent = warnings.join(' ');
  table('league-table', `${mode === 'draft' ? 'Local draft' : 'Published'} league standings`, ['Rank', 'Team', 'Raw', 'Retained', 'Discarded total', 'Status', ...result.rounds.map(r => `${r.date}: ${r.name}`)], result.rows.map(r => [
    r.rank, r.team.name, r.raw, r.retained, r.raw - r.retained,
    result.cutoffUnresolved ? (r.rank <= 16 ? 'Cutoff unresolved' : 'Outside top 16') : result.eligible.includes(r.team.name) ? (state.settings.complete ? 'Final eligible' : 'Provisional top 16') : 'Outside top 16',
    ...r.scores.map(s => `${s.total}${s.discarded ? ' (discarded)' : ''}; ${s.missed} missed`)
  ]));
  renderSingles(state);
  table('teams-table', 'Registered teams (3 players each)', ['Number', 'Team', 'Player 1', 'Player 2', 'Player 3'], state.teams.map((t, i) => [i + 1, t.name, ...t.players]));
  table('rounds-table', 'All imported weekends', ['Weekend', 'Round', 'Status', 'Cards'], [...state.rounds].sort((a, b) => a.date.localeCompare(b.date)).map(r => [r.date, r.name, r.canceled ? 'Canceled for everyone' : r.qualifying ? 'Qualifying' : 'Excluded / nonqualifying', r.cards.length]));
  const assigned = new Map(state.teams.flatMap(t => t.players.map(player => [canonical(player), t.name])));
  table('cards-table', 'All individual weekend cards', ['Weekend', 'Player', 'Team', 'Net Stableford', 'Playing handicap (metadata)'], state.rounds.flatMap(r => r.cards.map(c => [r.date, c.player, assigned.get(canonical(c.player)) || 'Unassigned', c.score, c.handicap ?? 'Not supplied'])));
  table('unassigned-table', 'Unassigned raw cards', ['Weekend', 'Player', 'Net Stableford', 'Playing handicap (metadata)'], state.rounds.flatMap(r => r.cards.filter(c => !assigned.has(canonical(c.player))).map(c => [r.date, c.player, c.score, c.handicap ?? 'Not supplied'])));
  const finals = finalTable(state);
  $('final-summary').textContent = !state.settings.complete ? 'Final locked: qualification is not complete.' : result.cutoffUnresolved ? 'Final locked: unresolved top 16 cutoff.' : `Final open for ${result.eligible.length} eligible teams. Team total: ${state.settings.finalScoring === 'best2' ? 'best 2 cards (committee assumption)' : 'all 3 cards (committee-selected interpretation)'}. Countback: all 3 cards. Date: ${state.final?.date || 'awaiting confirmation'}.`;
  table('final-table', 'Final standings, no league carryover', ['Rank', 'Team', 'Cards / 3', 'Final total', 'Back 9', 'Back 6', 'Back 3', 'Back 1'], finals.map(r => [r.rank ?? 'Unranked (missing cards)', r.team.name, r.cards, r.cards === 3 ? r.total : 'Pending', ...r.countback]));
  $('final-template').disabled = !state.settings.complete || result.cutoffUnresolved || !result.eligible.length;
  const settings = draft?.settings || state.settings;
  $('max-rounds').value = settings.maxRounds;
  $('discard-count').value = settings.discardCount;
  $('complete').checked = settings.complete;
  $('final-scoring').value = settings.finalScoring;
  renderRoundEditors();
}
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
async function refresh() {
  try {
    const response = await fetch('./data/published.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.text();
    published = parseJSON(source); publishedReady = true;
    render(); message('Published results loaded. Local imports never change these results.');
  } catch (error) {
    render();
    message(`Could not refresh published results: ${error.message}. ${publishedReady ? 'Keeping the last validated published data.' : 'No published result is available. Use a local HTTP server, not file://, for local viewing.'}`, true);
  }
}
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(index, focus = false) {
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
$('start-draft').addEventListener('click', safely(() => { persist(working(), 'Local draft opened.'); }));
$('reset-draft').addEventListener('click', safely(() => {
  if (!publishedReady) throw new Error('Published data is unavailable; refresh first.');
  if (!confirm('Replace the entire local draft with current published data? Download a backup first.')) return;
  storageBlocked = false; persist(published, 'Draft replaced with published data.');
}));
$('delete-draft').addEventListener('click', safely(() => {
  if (!confirm('Delete the saved local draft and in-memory draft? Public data remains unchanged.')) return;
  try { storage?.removeItem(STORAGE_KEY); } catch { throw new Error('Browser refused to delete storage. Use browser site-data controls.'); }
  draft = null; storageBlocked = false; mode = 'published'; pending = null; $('preview').hidden = true;
  $('storage-notice').textContent = 'Local draft deleted.'; render(); message('Local draft deleted. Public data unchanged.');
}));
$('demo').addEventListener('click', safely(() => {
  if (!confirm('Replace your local draft with explicitly synthetic demonstration data? This does not publish anything.')) return;
  const demo = emptyState();
  demo.teams = ['A', 'B', 'C'].map(letter => ({ name: `DEMO Team ${letter}`, players: [1, 2, 3].map(i => `Player ${letter}${i}`) }));
  demo.rounds = [{ date: '2026-11-07', name: 'SYNTHETIC demonstration only', qualifying: true, canceled: false, cards: demo.teams.flatMap((t, j) => t.players.map((player, i) => ({ player, score: 30 + j + i }))) }];
  storageBlocked = false; persist(demo, 'Synthetic DEMO loaded; not official results.');
}));
function clearPreview() { pending = null; $('preview').hidden = true; }
$('import-type').addEventListener('change', clearPreview);
$('cancel-preview').addEventListener('click', clearPreview);
$('import-form').addEventListener('submit', safely(async () => {
  clearPreview();
  const kind = $('import-type').value, files = [...$('import-files').files];
  if (!files.length) throw new Error('Choose a file.');
  if (kind !== 'scores' && files.length !== 1) throw new Error('Choose exactly one file for this import type.');
  if (files.length > 20) throw new Error('Choose at most 20 score files per preview.');
  for (const file of files) if (file.size > MAX_BYTES) throw new Error(`${file.name} exceeds the 2 MB file limit.`);
  const sources = await Promise.all(files.map(file => file.text()));
  let data, rows, columns, omissions = '';
  if (kind === 'teams') {
    data = parseTeams(sources[0]); rows = data.map(t => [t.name, ...t.players]); columns = ['Team', 'Player 1', 'Player 2', 'Player 3'];
  } else if (kind === 'scores') {
    const parsed = sources.map(parseScores), cards = new Map();
    const noReturn = parsed.reduce((sum, entry) => sum + (entry.omitted?.noReturn || 0), 0);
    const disqualified = parsed.reduce((sum, entry) => sum + (entry.omitted?.disqualified || 0), 0);
    if (noReturn || disqualified) omissions = ` Omitted ${noReturn + disqualified} non-scoring result rows (${noReturn} no return/withdrawn; ${disqualified} disqualified). These rows contribute no scores.`;
    const weekendKeys = parsed.map(p => {
      if (!p.playedOn) return null;
      const day = new Date(`${p.playedOn}T12:00:00Z`).getUTCDay();
      return [0, 6].includes(day) ? weekendDate(p.playedOn) : null;
    });
    const dates = [...new Set(weekendKeys.filter(Boolean))];
    if (dates.length > 1) throw new Error('Files contain different weekends. Import each weekend separately.');
    for (const entry of parsed) for (const card of entry.cards) {
      const key = canonical(card.player), previous = cards.get(key);
      if (previous && previous.score !== card.score) throw new Error(`Conflicting uploaded cards for ${card.player}. Choose the correct card and prepare a corrected CSV; no duplicate is counted.`);
      if (!previous) cards.set(key, card);
    }
    data = [...cards.values()];
    $('weekend-date').value = weekendKeys.every(Boolean) ? dates[0] : '';
    $('round-name').value = dates[0] ? draft?.rounds.find(r => r.date === dates[0])?.name || '' : '';
    $('qualifying').checked = dates[0] ? draft?.rounds.find(r => r.date === dates[0])?.qualifying ?? true : true;
    $('net-confirm').checked = false; $('import-mode').value = 'merge';
    const registered = new Set(working().teams.flatMap(t => t.players.map(canonical)));
    rows = data.map(c => [c.player, c.score, c.handicap ?? '', registered.has(canonical(c.player)) ? 'Registered' : 'Unassigned']);
    columns = ['Player', 'Net points', 'Handicap (metadata)', 'Assignment'];
  } else if (kind === 'restore') {
    data = parseJSON(sources[0]); rows = [[data.teams.length, data.rounds.length, data.final?.cards.length || 0]]; columns = ['Teams', 'Weekends', 'Final cards'];
  } else {
    data = parseFinal(sources[0], working(), $('final-date').value || null);
    rows = data.cards.map(c => [c.team, c.player, c.total, c.back9, c.back6, c.back3, c.back1]); columns = ['Team', 'Player', 'Total', 'Back9', 'Back6', 'Back3', 'Back1'];
  }
  pending = { kind, data };
  $('preview-summary').textContent = `${files.map(f => f.name).join(', ')}: ${rows.length} preview rows. Review all names and values. Nothing has been saved.${omissions}${kind === 'scores' && !$('weekend-date').value ? ' A file has no usable weekend date: explicitly assign the committee weekend below.' : ''}`;
  table('preview-table', 'Pending import', columns, rows);
  $('score-metadata').hidden = kind !== 'scores'; $('final-metadata').hidden = kind !== 'final';
  $('preview').hidden = false; message('Preview ready. Review metadata, then explicitly apply to the browser draft.');
}));
$('weekend-date').addEventListener('change', safely(() => {
  const existing = draft?.rounds.find(r => r.date === weekendDate($('weekend-date').value));
  if (existing) { $('round-name').value = existing.name; $('qualifying').checked = existing.qualifying; }
}));
$('apply-form').addEventListener('submit', safely(() => {
  if (!pending) throw new Error('Read a file and preview it first.');
  let next;
  if (pending.kind === 'restore') {
    if (!confirm('Replace the entire local draft with this validated JSON? Download a backup first.')) return;
    storageBlocked = false; next = pending.data;
  } else {
    next = structuredClone(working());
    if (pending.kind === 'teams') {
      if (!confirm('Replace all draft registrations with the previewed teams? Raw scores remain and will recalculate.')) return;
      next.teams = pending.data;
    } else if (pending.kind === 'scores') {
      if (!$('net-confirm').checked) throw new Error('Confirm net Stableford points before importing.');
      const date = weekendDate($('weekend-date').value), existing = next.rounds.find(r => r.date === date);
      if ($('import-mode').value === 'replace' && existing && !confirm(`Replace EVERY card in ${date} with this preview? Omitted players will have zero. This cannot be undone without a backup.`)) return;
      next = importRound(next, { date, name: $('round-name').value.trim(), qualifying: $('qualifying').checked, canceled: existing?.canceled || false, cards: pending.data }, $('import-mode').value);
    } else {
      if (!confirm('Replace ALL draft final cards with this preview? Teams with fewer than 3 cards remain unranked.')) return;
      next.final = { ...pending.data, date: $('final-date').value || null };
    }
  }
  persist(next, 'Import applied.'); clearPreview();
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
$('backup').addEventListener('click', safely(() => { download('blainroe-draft-backup.json', JSON.stringify(validateState(working()), null, 2) + '\n', 'application/json'); }));
$('publication').addEventListener('click', safely(() => {
  const state = validateState(working());
  if (!confirm('Export this draft for owner publication? Names will become publicly readable if the owner commits this file. Confirm consent and verify all results first.')) return;
  download('published.json', JSON.stringify(state, null, 2) + '\n', 'application/json');
}));
$('report').addEventListener('click', safely(() => {
  if (mode === 'published' && !publishedReady) throw new Error('Cannot export a published report until validated published data has loaded.');
  download('blainroe-winter-league-report.html', reportHTML(current(), mode === 'draft' ? 'Browser-only draft, NOT official results' : 'Owner-published data'), 'text/html;charset=utf-8');
}));
$('team-template').addEventListener('click', () => csvDownload('team-template.csv', ['Team Name', 'Player1', 'Player2', 'Player3'], []));
$('score-template').addEventListener('click', () => csvDownload('net-stableford-template.csv', ['Player', 'Score', 'Handicap'], current().teams.flatMap(t => t.players.map(p => [p, '', '']))));
$('final-template').addEventListener('click', safely(() => {
  const state = current(), eligible = league(state).eligible;
  if (!state.settings.complete || league(state).cutoffUnresolved) throw new Error('Final template locked until qualification is complete and cutoff is resolved.');
  csvDownload('final-template.csv', ['Team', 'Player', 'Total', 'Back9', 'Back6', 'Back3', 'Back1'], state.teams.filter(t => eligible.includes(t.name)).flatMap(t => t.players.map(p => [t.name, p, '', '', '', '', ''])));
}));
render();
refresh();
