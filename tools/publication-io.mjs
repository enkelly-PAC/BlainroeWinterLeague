import { readFile, open, rename, unlink, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MAX_BYTES } from '../core.js';

export async function readLimited(path) {
  if ((await stat(path)).size > MAX_BYTES) throw new Error(`${path}: exceeds the 2 MB limit.`);
  return readFile(path, 'utf8');
}
export async function atomicPublication(target, state, expected) {
  const source = JSON.stringify(state, null, 2) + '\n';
  const scratch = `${target}.${randomUUID()}.pending`;
  const lockPath = `${target}.lock`;
  let handle, lock;
  try {
    try { lock = await open(lockPath, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Another publication update holds the lock. Retry after it finishes; remove a stale .lock only after confirming no update is running.');
      throw error;
    }
    handle = await open(scratch, 'wx');
    await handle.writeFile(source, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    if (await readFile(target, 'utf8') !== expected) throw new Error('Published file changed during preview. Retry against the latest file.');
    await rename(scratch, target);
  } finally {
    await handle?.close();
    await unlink(scratch).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}
