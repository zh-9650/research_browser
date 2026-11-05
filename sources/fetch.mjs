import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';

// Download only fixed-SHA files recorded by the audit; never silently follow main.
const manifests = process.argv.slice(2);
for (const manifest of manifests.length ? manifests : ['sources/versions.json']) {
  const entries = JSON.parse(await readFile(manifest, 'utf8'));
  for (const repo of entries) for (const file of repo.files) {
    const base = resolve('sources/vendor', repo.directory || repo.repo.split('/').at(-1));
    const dest = resolve(base, file.path);
    if (!dest.startsWith(base + sep)) throw Error('Invalid source path');
    const r = await fetch(file.url);
    if (!r.ok) throw Error(`${r.status} ${file.url}`);
    const raw = Buffer.from(await r.arrayBuffer());
    const bytes = file.encoding === 'base64' ? Buffer.from(raw.toString('utf8').trim(), 'base64') : raw;
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw Error(`Hash mismatch: ${file.url}`);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
  console.log(`已按 SHA-256 校验并下载 ${entries.reduce((n, x) => n + x.files.length, 0)} 个原始文件`);
}
