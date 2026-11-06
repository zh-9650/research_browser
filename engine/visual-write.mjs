import { createHash } from 'node:crypto';
import { Journal } from './executor.mjs';

/** Only the trusted host supplies the expected object and the backend grant check.
 * The check must confirm that the destination enforces that object at write time.
 */
export async function dispatchVisualWrite(page, coordinate, {
  url, objectId, screenshotSha256, checkBackendGrant, operationId, journalPath,
}) {
  const denied = reason => ({ dispatch: 'not_sent', reason });
  const { x, y } = coordinate;
  const viewport = page.viewportSize();
  if (!viewport || !Number.isInteger(x) || !Number.isInteger(y)
      || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return denied('INVALID_COORDINATE');
  if (!objectId || typeof checkBackendGrant !== 'function') return denied('OBJECT_CONSTRAINT_REQUIRED');
  if (typeof journalPath !== 'string' || !journalPath || typeof operationId !== 'string' || !/^[\w-]{1,100}$/.test(operationId)) {
    return denied('ACTION_JOURNAL_REQUIRED');
  }
  try {
    if (await checkBackendGrant({ url, objectId }) !== true) return denied('OBJECT_CONSTRAINT_REQUIRED');
  } catch {
    return denied('OBJECT_CONSTRAINT_UNVERIFIED');
  }
  let journal;
  try {
    journal = new Journal(journalPath);
  } catch (error) {
    return denied(error.code === 'EEXIST' ? 'ACTION_JOURNAL_BUSY' : 'ACTION_JOURNAL_UNAVAILABLE');
  }
  try {
    if (journal.records.some(record => record.operationId === operationId && record.event === 'dispatch_intent')) {
      return denied('OPERATION_ALREADY_ATTEMPTED');
    }
    try {
      if (page.url() !== url) return denied('VISUAL_OBSERVATION_STALE');
      const pixels = await page.screenshot({ scale: 'css', timeout: 3000 });
      if (page.url() !== url || createHash('sha256').update(pixels).digest('hex') !== screenshotSha256) {
        return denied('VISUAL_OBSERVATION_STALE');
      }
    } catch {
      return denied('VISUAL_OBSERVATION_UNAVAILABLE');
    }
    try {
      journal.append({ event: 'dispatch_intent', kind: 'visual_click', operationId, objectId, screenshotSha256, x, y });
    } catch {
      return denied('ACTION_JOURNAL_UNAVAILABLE');
    }
    let receipt;
    try {
      await page.mouse.click(x, y);
      receipt = { dispatch: 'sent', taskGoal: 'unknown' };
    } catch {
      receipt = { dispatch: 'unknown', reason: 'ACTION_RESULT_UNKNOWN' };
    }
    try {
      journal.append({ event: 'receipt', operationId, ...receipt });
      return receipt;
    } catch {
      return { dispatch: 'unknown', reason: 'ACTION_RECEIPT_NOT_PERSISTED' };
    }
  } finally {
    journal.close();
  }
}
