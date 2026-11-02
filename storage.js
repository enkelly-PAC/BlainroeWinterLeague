import { parseJSON } from './core.js';
export const STORAGE_KEY = 'blainroe-winter-league-draft-v1';
export const BASELINE_KEY = 'blainroe-winter-league-baseline-v1';
export function readBaseline(storage, draft) {
  try {
    const saved = JSON.parse(storage.getItem(BASELINE_KEY));
    if (JSON.stringify(saved?.draft) !== JSON.stringify(draft)) return null;
    return parseJSON(JSON.stringify(saved.published));
  } catch { return null; }
}
export function readDraft(storage) {
  try {
    const source = storage.getItem(STORAGE_KEY);
    return { state: source === null ? null : parseJSON(source), error: null };
  } catch (error) {
    return { state: null, error: `Local draft could not be read: ${error.message}. Stored data was not overwritten. Restore a backup or explicitly replace/delete the draft.` };
  }
}
export function saveDraft(storage, state, published = null) {
  try {
    if (published) storage.setItem(BASELINE_KEY, JSON.stringify({ draft: state, published }));
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch {
    return 'Draft is available only in memory: browser storage is unavailable or full. Download a JSON backup now; this change will not survive reload.';
  }
}
