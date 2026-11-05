import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const repo = 'sources/vendor/miniwob-plusplus';
const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (sha !== '33c3b4ddef8c6eb67c57a29663d844b1eda7e614') throw Error('Unexpected public benchmark revision');
const paths = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', sha, 'LICENSE', 'miniwob/html/core', 'miniwob/html/common', ...['click-button', 'enter-text', 'click-checkboxes', 'choose-list'].map(task => `miniwob/html/miniwob/${task}.html`)], { encoding: 'utf8' }).trim().split('\n');
const files = paths.map(path => ({ path, sha256: createHash('sha256').update(execFileSync('git', ['-C', repo, 'show', `${sha}:${path}`])).digest('hex'), url: `https://raw.githubusercontent.com/Farama-Foundation/MiniWoB-plusplus/${sha}/${path}` }));
await writeFile('sources/miniwob-versions.json', JSON.stringify([{ repo: 'Farama-Foundation/MiniWoB-plusplus', directory: 'miniwob-plusplus', sha, license: 'MIT', files }], null, 2));
console.log(JSON.stringify({ sha, files: files.length }));
