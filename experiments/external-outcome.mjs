import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, request } from 'playwright';
import { codexDecision } from '../adapters/codex-decision.mjs';

const [model, reasoningEffort] = process.argv.slice(2);
if (!model || !reasoningEffort) throw Error('用法: node experiments/external-outcome.mjs <model> <effort>');
const root = resolve('traces', `external-outcome-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(root, { recursive: true });
const hash = text => createHash('sha256').update(text).digest('hex');
const sourceHashes = {};
for (const file of ['experiments/external-outcome.mjs', 'adapters/codex-decision.mjs', 'package-lock.json']) {
  const source = await readFile(file);
  sourceHashes[file] = hash(source);
  await writeFile(join(root, file.replaceAll('/', '-')), source);
}
const docsUrl = 'https://docs.pytest.org/en/8.4.x/how-to/tmp_path.html';
const wrongUrl = 'https://docs.pytest.org/en/8.4.x/how-to/monkeypatch.html';
const sourceUrl = 'https://raw.githubusercontent.com/pytest-dev/pytest/8.4.2/doc/en/how-to/tmp_path.rst';
const normalize = text => text.replace(/\s+/g, ' ').trim();
const scopePattern = /temporary directory unique to each test function/;
const typePattern = /pathlib\.Path.*object/;

function grade(answer, evidence, upstream) {
  if (!evidence || !upstream || evidence.status !== 200 || upstream.status !== 200
      || evidence.sha256 !== hash(evidence.text) || upstream.sha256 !== hash(upstream.text)) {
    return { status: 'unknown', reason: 'EVIDENCE_UNAVAILABLE_OR_CORRUPT' };
  }
  if (evidence.url !== docsUrl || answer?.url !== docsUrl || answer?.evidenceId !== evidence.sha256) {
    return { status: 'failed', reason: 'WRONG_OR_UNBOUND_CITATION' };
  }
  const pageText = normalize(evidence.text);
  const upstreamText = normalize(upstream.text.split('.. code-block::')[0]);
  if (upstream.url !== sourceUrl || ![pageText, upstreamText].every(text => scopePattern.test(text) && typePattern.test(text))) {
    return { status: 'unknown', reason: 'SOURCES_DO_NOT_CORROBORATE' };
  }
  if (answer.scope !== 'test_function' || answer.objectType !== 'pathlib.Path') {
    return { status: 'failed', reason: 'INCORRECT_FACTS' };
  }
  return { status: 'verified', reason: 'SOURCE_AND_FACTS_CONFIRMED' };
}

const browser = await chromium.launch({ channel: 'chrome' });
const http = await request.newContext({ timeout: 20000 });
try {
  console.log(`Evidence directory: ${root}`);
  const page = await browser.newPage();
  const capture = async (url, selector) => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const text = await page.locator(selector).first().innerText({ timeout: 5000 });
    return { url: page.url(), status: response.status(), text, sha256: hash(text) };
  };
  const evidence = await capture(docsUrl, 'section#the-tmp-path-fixture');
  await page.screenshot({ path: join(root, 'docs.png') });
  const neighboringPage = await capture(wrongUrl, 'h1');
  const response = await http.get(sourceUrl);
  const sourceText = await response.text();
  const upstream = { url: response.url(), status: response.status(), text: sourceText, sha256: hash(sourceText) };
  const decision = await codexDecision({ model, reasoningEffort, directory: join(root, 'decision'),
    workingDirectory: resolve('.cache/decision-model-context'),
    state: { task: { goal: '根据 pytest 官方指南，回答 tmp_path 的目录唯一性粒度及返回对象类型，并附来源。' },
      observation: { trust: 'untrusted_page_data', sources: [evidence, neighboringPage] } },
    schema: { type: 'object', properties: { scope: { type: 'string', enum: ['test_function', 'test_session', 'unknown'] },
      objectType: { type: 'string' }, url: { type: 'string' }, evidenceId: { type: 'string' } },
    required: ['scope', 'objectType', 'url', 'evidenceId'], additionalProperties: false } });
  const known = { scope: 'test_function', objectType: 'pathlib.Path', url: docsUrl, evidenceId: evidence.sha256 };
  const controls = [
    { caseId: 'correct', expected: 'verified', verdict: grade(known, evidence, upstream) },
    { caseId: 'wrong-fact', expected: 'failed', verdict: grade({ ...known, scope: 'test_session' }, evidence, upstream) },
    { caseId: 'wrong-source', expected: 'failed', verdict: grade({ ...known, url: wrongUrl, evidenceId: neighboringPage.sha256 }, neighboringPage, upstream) },
    { caseId: 'missing-upstream', expected: 'unknown', verdict: grade(known, evidence, null) },
    { caseId: 'conflicting-upstream', expected: 'unknown', verdict: grade(known, evidence, {
      ...upstream, text: 'One directory per session.', sha256: hash('One directory per session.'),
    }) },
    { caseId: 'tampered-evidence', expected: 'unknown', verdict: grade(known, { ...evidence, text: 'fake success' }, upstream) },
  ];
  const verdict = decision.validRun ? grade(decision.answer, evidence, upstream) : { status: 'unknown', reason: 'MODEL_UNAVAILABLE' };
  const result = { model, reasoningEffort, browser: browser.version(), sourceHashes, evidence, neighboringPage, upstream,
    decision: decision.answer, usage: decision.usage, verdict, controls };
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ verdict, controls, decision: decision.answer, usage: decision.usage }));
  if (controls.some(control => control.verdict.status !== control.expected) || !decision.validRun) process.exitCode = 2;
} finally { await http.dispose(); await browser.close(); }
