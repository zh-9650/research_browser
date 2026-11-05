import { createHash } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeSync, fsyncSync, closeSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

const busyPages = new WeakSet();
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const editableInputTypes = new Set(['text','email','password','search','tel','url','number','date','datetime-local','time','month','week']);
const supportedActions = identity => {
  if(identity.disabled)return [];
  if(identity.tag==='SELECT')return ['select'];
  if(identity.tag==='TEXTAREA')return identity.readonly ? ['click'] : ['fill','click'];
  if(identity.tag==='INPUT') {
    if(identity.type==='file')return [];
    return editableInputTypes.has(identity.type||'text')&&!identity.readonly ? ['fill','click'] : ['click'];
  }
  return ['click'];
};

// Runs in the page. No expando identity, selectors supplied by the model, or page-owned IDs.
function describe(el) {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const container = el.closest('tr,[role=row],article,[role=group],fieldset,form');
  const form = el.form || null;
  const fieldState = el.tagName === 'SELECT'
    ? { value: el.value, options: [...el.options].map(o => ({ value: o.value, label: o.label, selected: o.selected, disabled: o.disabled })) }
    : ['INPUT', 'TEXTAREA'].includes(el.tagName)
      ? el.type === 'password' ? { sensitive: true, hasValue: !!el.value } : { value: el.value, ...(['checkbox', 'radio'].includes(el.type) ? { checked: el.checked } : {}) }
      : null;
  return {
    connected: el.isConnected,
    tag: el.tagName,
    role: el.getAttribute('role') || el.tagName.toLowerCase(),
    name: norm(el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.innerText || el.getAttribute('placeholder')),
    context: norm(container?.innerText),
    href: el.getAttribute('href'),
    type: el.getAttribute('type'),
    fieldState,
    formOwner: form ? { id: form.id, name: form.getAttribute('name'), action: form.action, method: form.method, target: form.target } : null,
    formAttribute: el.getAttribute('form'),
    submitAction: el.hasAttribute('formaction') ? el.formAction : form?.action || null,
    submitMethod: el.getAttribute('formmethod'),
    submitTarget: el.getAttribute('formtarget'),
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
    readonly: !!el.readOnly || el.getAttribute('aria-readonly') === 'true',
  };
}

export class Journal {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.path = path;
    this.records = [];
    this.lockPath = path + '.lock';
    this.lockFd = openSync(this.lockPath, 'wx');
    try {
      const data = readFileSync(path, 'utf8');
      // A torn final line is an unsafe ledger, not permission to forget a dispatch.
      this.records = data.split('\n').filter(Boolean).map(x => JSON.parse(x));
    } catch (e) { if (e.code !== 'ENOENT') { this.close(); throw e; } }
  }
  append(record) {
    const item = { timestamp: new Date().toISOString(), ...record };
    const fd = openSync(this.path, 'a');
    try {
      const bytes = Buffer.from(JSON.stringify(item) + '\n');
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
      fsyncSync(fd);
    }
    finally { closeSync(fd); }
    this.records.push(item);
    return item;
  }
  prior(operationId) {
    // Re-read under the caller's serialization boundary to see other process records.
    const rows = readFileSync(this.path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    return rows.filter(r => r.operationId === operationId);
  }
  close() {
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      this.lockFd = undefined;
      unlinkSync(this.lockPath);
    }
  }
}

/** Research execution layer. Trusted host provides grants and optional postcondition.
 * It is NOT a security boundary against hostile browser scripts or a compromised host.
 */
export class Executor {
  constructor(page, { journal, grants, timeout = 800, maxTargets = 300, maxTextChars = 16000 } = {}) {
    this.page = page;
    this.journal = new Journal(journal);
    this.grants = structuredClone(grants || []);
    this.timeout = timeout;
    this.maxTargets = maxTargets;
    this.maxTextChars = maxTextChars;
    this.refs = new Map();
    this.rev = 0;
    this.frameEpochs = new WeakMap();
    this.onNavigated = f => this.frameEpochs.set(f, (this.frameEpochs.get(f) || 0) + 1);
    this.page.on('framenavigated', this.onNavigated);
  }
  async observe({ textOffset = 0 } = {}) {
    if (this.closed) throw Error('SESSION_CLOSED');
    if (!Number.isSafeInteger(textOffset) || textOffset < 0) throw Error('MODEL_DECISION_INVALID');
    if (busyPages.has(this.page)) throw Error('SESSION_BUSY');
    busyPages.add(this.page);
    try { return await this.observeUnlocked(textOffset); }
    finally { busyPages.delete(this.page); }
  }
  async observeUnlocked(textOffset) {
    for (const ref of this.refs.values()) await ref.handle.dispose().catch(() => {});
    this.refs.clear();
    const rev = ++this.rev;
    const targets = [];
    const documents = [];
    const gaps = ['DOM-only: canvas, closed shadow roots, CSS-generated labels and full accessibility names are not covered'];
    for (const [frameIndex, frame] of this.page.frames().entries()) {
      try {
        const content = await frame.evaluate(() => document.body?.innerText || '');
        const end = Math.min(content.length, textOffset + this.maxTextChars);
        documents.push({ frame: frameIndex, text: content.slice(textOffset, end), offset: textOffset, totalChars: content.length,
          nextOffset: end < content.length ? end : null, truncated: textOffset > 0 || end < content.length });
        if (textOffset > 0 || end < content.length) gaps.push(`frame ${frameIndex}: partial document text range ${textOffset}-${end} of ${content.length}`);
        const handles = await frame.locator('button,a[href],input,select,textarea,[role=button],[role=checkbox]').elementHandles();
        for (const handle of handles) {
          if (targets.length >= this.maxTargets) { await handle.dispose(); continue; }
          if (!await handle.isVisible()) { await handle.dispose(); continue; }
          const identity = await handle.evaluate(describe);
          const ref = `r${rev}-${targets.length + 1}`;
          const target = { ref, frame: frameIndex, ...structuredClone(identity), actions: supportedActions(identity) };
          this.refs.set(ref, { handle, frame, epoch: this.frameEpochs.get(frame) || 0, identity, rev, url: frame.url() });
          targets.push(target);
        }
        if (targets.length >= this.maxTargets) gaps.push(`frame ${frameIndex}: target budget reached (${this.maxTargets}), controls may be omitted`);
      } catch { gaps.push(`frame ${frameIndex}: observation failed`); }
    }
    const observation = { rev, url: this.page.url(), trust: 'untrusted_page_data', documents, targets, complete: false, gaps };
    this.journal.append({ event: 'observation', rev, targetCount: targets.length, digest: hash(observation) });
    return observation;
  }
  async readTarget(ref) {
    if(this.closed)return {error:'SESSION_CLOSED'};
    if(busyPages.has(this.page))return {error:'SESSION_BUSY'};
    busyPages.add(this.page);
    try {
      const entry=this.refs.get(ref);
      if(!entry)return {error:'TARGET_STALE'};
      if(entry.frame.isDetached()||(this.frameEpochs.get(entry.frame)||0)!==entry.epoch||entry.frame.url()!==entry.url)return {error:'FRAME_CHANGED'};
      const identity=await entry.handle.evaluate(describe).catch(()=>null);
      if(!identity?.connected)return {error:'TARGET_STALE'};
      const {fieldState,...structure}=identity;
      const {fieldState:oldFieldState,...oldStructure}=entry.identity;
      if(hash(structure)!==hash(oldStructure))return {error:'TARGET_STALE'};
      const result={ref,identityChecked:true,fieldState:structuredClone(fieldState),error:null};
      this.journal.append({event:'field_readback',ref,digest:hash(result)});
      return result;
    }finally{busyPages.delete(this.page);}
  }
  async act(input, { postcondition } = {}) {
    // Take an immutable private intent before any await or authorization check.
    // Callers may reuse/mutate their original object while actionability waits.
    try { input = structuredClone(input); } catch { input = null; }
    const base = { operationId: input?.operationId, dispatch: 'not_sent', target_reached: 'unknown', page_effect: 'unknown', postcondition: 'unknown', task_goal: 'unknown', retry_safety: 'reobserve' };
    const fail = error => ({ ...base, error });
    if (this.closed) return fail('SESSION_CLOSED');
    if (!input || typeof input.operationId !== 'string' || !/^[\w-]{1,100}$/.test(input.operationId) || !['click', 'fill', 'select'].includes(input.kind) || typeof input.ref !== 'string' || (input.kind !== 'click' && typeof input.value !== 'string')) return fail('MODEL_DECISION_INVALID');
    if (busyPages.has(this.page)) return fail('SESSION_BUSY');
    busyPages.add(this.page);
    try {
      // Exclusive ledger ownership also blocks a second process using this task ledger.
      // A crash leaves a lock: host must reconcile before removing it, never auto-unlock.
      const entry = this.refs.get(input.ref);
      if (!entry) return fail('TARGET_STALE');
      let identity;
      try { identity = await entry.handle.evaluate(describe); }
      catch { return fail('TARGET_STALE'); }
      if (entry.frame.isDetached() || (this.frameEpochs.get(entry.frame) || 0) !== entry.epoch || entry.frame.url() !== entry.url) return fail('FRAME_CHANGED');
      if (!identity.connected || hash(identity) !== hash(entry.identity)) return fail('TARGET_STALE');
      if(input.kind==='fill'&&!supportedActions(identity).includes('fill'))return fail('MODEL_DECISION_INVALID');
      if (input.kind === 'fill' && !['INPUT', 'TEXTAREA'].includes(identity.tag)) return fail('MODEL_DECISION_INVALID');
      if (input.kind === 'select' && identity.tag !== 'SELECT') return fail('MODEL_DECISION_INVALID');
      const origin = new URL(entry.frame.url()).origin;
      const topOrigin = new URL(this.page.url()).origin;
      if (!this.grants.some(g => g.origin === topOrigin)) return fail('POLICY_DENIED');
      // Even a click may submit a payment. Caller cannot downgrade risk in the intent.
      if (!this.grants.some(g => g.origin === origin && g.kinds.includes(input.kind) && (g.context === undefined || g.context === identity.context) && (g.name === undefined || g.name === identity.name))) return fail('POLICY_DENIED');
      // Block explicit link/form destinations outside trusted host origin grants.
      // This is a navigation preflight, not a network firewall against arbitrary JS.
      const isSubmitter = identity.tag === 'BUTTON' && (!identity.type || identity.type === 'submit') || identity.tag === 'INPUT' && ['submit', 'image'].includes(identity.type);
      const destination = input.kind === 'click' ? identity.href || (isSubmitter ? identity.submitAction : null) : null;
      if (destination) {
        let url;
        try { url = new URL(destination, entry.frame.url()); } catch { return fail('POLICY_DENIED'); }
        if (!['http:', 'https:'].includes(url.protocol) || !this.grants.some(g => g.origin === url.origin)) return fail('POLICY_DENIED');
      }
      this.journal.append({ event: 'preflight', operationId: input.operationId, kind: input.kind, targetDigest: hash(identity) });
      const prior = this.journal.prior(input.operationId).filter(r => r.event === 'dispatch_intent');
      if (prior.length) return fail('OPERATION_ALREADY_ATTEMPTED');
      if (input.kind === 'click') {
        try { await entry.handle.click({ trial: true, timeout: this.timeout }); }
        catch { return fail('TARGET_NOT_ACTIONABLE'); }
      }
      // Trial may wait while a virtualized row silently changes business identity.
      const last = await entry.handle.evaluate(describe).catch(() => null);
      if (!last || hash(last) !== hash(entry.identity)) return fail('TARGET_STALE');
      this.journal.append({ event: 'dispatch_intent', operationId: input.operationId, kind: input.kind, targetDigest: hash(last), rev: entry.rev });
      base.dispatch = 'unknown';
      base.retry_safety = 'do_not_repeat_without_reconciliation';
      try {
        const opts = { timeout: this.timeout };
        if (input.kind === 'click') await entry.handle.click(opts);
        if (input.kind === 'fill') await entry.handle.fill(input.value, opts);
        if (input.kind === 'select') await entry.handle.selectOption(input.value, opts);
        base.dispatch = 'sent';
        // Browser API completion is not proof of event-handler receipt or business success.
        if (postcondition) base.postcondition = await postcondition() ? 'met' : 'unmet';
        const receipt = { ...base, error: base.postcondition === 'unmet' ? 'POSTCONDITION_UNMET' : null };
        this.journal.append({ event: 'receipt', ...receipt });
        return receipt;
      } catch {
        const receipt = { ...base, error: 'ACTION_RESULT_UNKNOWN' };
        this.journal.append({ event: 'receipt', ...receipt });
        return receipt;
      }
    } finally { busyPages.delete(this.page); }
  }
  async close() {
    if (this.closed) return;
    if (busyPages.has(this.page)) throw Error('SESSION_BUSY');
    this.closed = true;
    this.page.off('framenavigated', this.onNavigated);
    for (const r of this.refs.values()) await r.handle.dispose().catch(() => {});
    this.refs.clear();
    this.journal.close();
  }
}
