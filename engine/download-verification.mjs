import { createHash } from 'node:crypto';

/** Trusted host supplies the expected artifact digest from independent business data. */
export async function verifyDownload(download, { expectedSha256, maxBytes, timeoutMs = 15000 }) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedSha256)
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw Error('INVALID_DOWNLOAD_VERIFICATION_POLICY');
  }
  const filename = download.suggestedFilename();
  const timeout = { status: 'unknown', reason: 'DOWNLOAD_VERIFICATION_TIMEOUT', filename };
  let timer, stream, expired = false;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => {
      expired = true;
      resolve(timeout);
      stream?.destroy();
      // Browser cancellation is requested without extending the verification deadline.
      void Promise.resolve().then(() => download.cancel()).catch(() => {});
    }, timeoutMs);
  });
  try {
    return await Promise.race([deadline, verifyContent()]);
  } finally {
    clearTimeout(timer);
  }

  async function verifyContent() {
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      stream = await download.createReadStream();
      if (expired) {
        stream.destroy();
        return timeout;
      }
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > maxBytes) return { status: 'failed', reason: 'DOWNLOAD_SIZE_LIMIT', filename, bytes };
        hash.update(chunk);
      }
    } catch {
      return { status: 'unknown', reason: 'DOWNLOAD_CONTENT_UNAVAILABLE', filename };
    }
    const sha256 = hash.digest('hex');
    return sha256 === expectedSha256
      ? { status: 'verified', filename, bytes, sha256 }
      : { status: 'failed', reason: 'DOWNLOAD_DIGEST_MISMATCH', filename, bytes, sha256 };
  }
}
