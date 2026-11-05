import { Buffer } from 'node:buffer';

export const SHARED_CONTEXT_ENCODING = 'shared-context-v1';
const invalid = () => { throw Error('INVALID_OBSERVATION_ENCODING'); };

// Presentation only: shared text does NOT mean shared node/frame/business identity.
// No text is summarized, dropped, normalized or promoted to trusted instructions.
export function encodeObservation(observation, { mode = 'auto' } = {}) {
  if (!['raw', 'auto', SHARED_CONTEXT_ENCODING].includes(mode)) return invalid();
  if (mode === 'raw') return structuredClone(observation);
  if (observation.encoding !== undefined || observation.contexts !== undefined || !Array.isArray(observation.targets)) return invalid();
  const contexts = [], indices = new Map();
  const targets = observation.targets.map(target => {
    if (typeof target.context !== 'string' || Object.hasOwn(target, 'contextIndex')) return invalid();
    const { context, ...rest } = target;
    if (!indices.has(context)) { indices.set(context, contexts.length); contexts.push(context); }
    return { ...rest, contextIndex: indices.get(context) };
  });
  const packed = { ...structuredClone(observation), encoding: SHARED_CONTEXT_ENCODING, contexts, targets: structuredClone(targets) };
  if (mode === 'auto' && Buffer.byteLength(JSON.stringify(packed)) >= Buffer.byteLength(JSON.stringify(observation))) return structuredClone(observation);
  return packed;
}

export function targetContext(observation, target) {
  if (observation.encoding === undefined) {
    if (typeof target.context !== 'string') return invalid();
    return target.context;
  }
  if (observation.encoding !== SHARED_CONTEXT_ENCODING || !Array.isArray(observation.contexts)
    || !Number.isSafeInteger(target.contextIndex) || target.contextIndex < 0 || typeof observation.contexts[target.contextIndex] !== 'string'
    || Object.hasOwn(target, 'context')) return invalid();
  return observation.contexts[target.contextIndex];
}

export function decodeObservation(observation) {
  if (observation.encoding === undefined) return structuredClone(observation);
  if (observation.encoding !== SHARED_CONTEXT_ENCODING || !Array.isArray(observation.targets)) return invalid();
  const { encoding, contexts, ...raw } = structuredClone(observation);
  raw.targets = observation.targets.map(target => {
    const { contextIndex, ...rest } = structuredClone(target);
    return { ...rest, context: targetContext(observation, target) };
  });
  return raw;
}
