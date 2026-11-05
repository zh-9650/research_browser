import { createHash } from 'node:crypto';
import { Journal } from './executor.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Trusted-host task ledger, not an LLM judge. Persist constraints rather than summarize them.
 * Host must only supply verification evidence it actually obtained; page prose is not proof.
 */
export class TaskState {
  constructor(path, definition) {
    this.journal = new Journal(path);
    try {
      const stored = this.journal.records.find(r => r.event === 'task_definition');
      if (!stored && !definition) throw Error('TASK_DEFINITION_REQUIRED');
      if (stored && definition && stored.digest !== digest(definition)) throw Error('TASK_CONSTRAINTS_CHANGED');
      this._definition = structuredClone(stored?.definition || definition);
      const ids = new Set(this.definition.subgoals.map(s => s.id));
      if (ids.size !== this.definition.subgoals.length || !ids.size || typeof this.definition.goal !== 'string' || !Array.isArray(this.definition.constraints)) throw Error('INVALID_TASK_DEFINITION');
      for (const subgoal of this.definition.subgoals) {
        if (typeof subgoal.id !== 'string' || !subgoal.id || (subgoal.dependsOn || []).some(id => !ids.has(id) || id === subgoal.id)) throw Error('INVALID_DEPENDENCY');
      }
      // Reject cycles before persisting a task that can never become ready.
      const remaining = [...this.definition.subgoals];
      const visited = new Set();
      while (remaining.length) {
        const index = remaining.findIndex(s => (s.dependsOn || []).every(id => visited.has(id)));
        if (index < 0) throw Error('CYCLIC_DEPENDENCY');
        visited.add(remaining.splice(index, 1)[0].id);
      }
      if (!stored) this.journal.append({ event: 'task_definition', digest: digest(this.definition), definition: this.definition });
    } catch (error) { this.journal.close(); throw error; }
  }
  get definition() { return structuredClone(this._definition); }
  descendants(id) {
    const ids = new Set([id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const s of this._definition.subgoals) {
        if (!ids.has(s.id) && (s.dependsOn || []).some(dep => ids.has(dep))) { ids.add(s.id); changed = true; }
      }
    }
    ids.delete(id);
    return [...ids];
  }
  projection() {
    const states = new Map();
    for (const event of this.journal.records) {
      const results = event.event === 'subgoal_transaction' ? event.results : event.event === 'subgoal_result' ? [event] : [];
      for (const result of results) {
        const previous = states.get(result.id);
        // Derive invalidation on replay too: this also safely reads legacy ledgers
        // interrupted between the old separate parent/descendant appends.
        if (result.status === 'unknown' || previous?.status === 'verified' && previous.evidence !== result.evidence) {
          for (const id of this.descendants(result.id)) states.set(id, { status: 'unknown', evidence: `dependency-invalidated:${result.id}` });
        }
        states.set(result.id, { status: result.status, evidence: result.evidence });
      }
    }
    return states;
  }
  status(id) {
    if (!this.definition.subgoals.some(s => s.id === id)) throw Error('UNKNOWN_SUBGOAL');
    return this.projection().get(id)?.status || 'pending';
  }
  next() {
    return this.definition.subgoals.filter(s => this.status(s.id) !== 'verified' && (s.dependsOn || []).every(id => this.status(id) === 'verified')).map(s => structuredClone(s));
  }
  record(id, { status, evidence }) {
    const subgoal = this.definition.subgoals.find(s => s.id === id);
    if (!subgoal) throw Error('UNKNOWN_SUBGOAL');
    if (!['verified', 'unknown'].includes(status) || typeof evidence !== 'string' || !evidence.trim()) throw Error('EVIDENCE_REQUIRED');
    if ((subgoal.dependsOn || []).some(dep => this.status(dep) !== 'verified')) throw Error('DEPENDENCY_UNMET');
    const previous = this.projection().get(id);
    const results = [{ id, status, evidence }];
    if (status === 'unknown' || previous?.status === 'verified' && previous.evidence !== evidence) {
      for (const child of this.descendants(id)) results.push({ id: child, status: 'unknown', evidence: `dependency-invalidated:${id}` });
    }
    this.journal.append({ event: 'subgoal_transaction', results });
  }
  get outcome() { return this.definition.subgoals.every(s => this.status(s.id) === 'verified') ? 'verified' : 'unknown'; }
  close() { this.journal.close(); }
}
