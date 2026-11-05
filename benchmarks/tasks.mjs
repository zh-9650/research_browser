// Task identities are injected per reset, never hardcoded into executor target rules.
export const tasks = [
  { id: 'S01', fault: null, expected: 'commit' },
  { id: 'S02', fault: 'reorder', expected: 'commit' },
  { id: 'S03', fault: 'recycle', expected: 'refuse' },
  { id: 'S04', fault: 'overlay', expected: 'refuse' },
  { id: 'S05', fault: 'replace', expected: 'commit' },
  { id: 'S06', fault: 'hideFirst', expected: 'refuse' },
  { id: 'S23', mode: 'lost-response', expected: 'commit', retry: true },
  { id: 'S23-transport', mode: 'transport-replay', expected: 'transport-risk', retry: false },
  { id: 'S26', expected: 'commit' },
  { id: 'S27', mode: 'reject', expected: 'business-rejected' },
  { id: 'S30', fault: 'uniqueReplacement', expected: 'refuse' },
  { id: 'S32', fault: 'injection', expected: 'commit' },
  { id: 'S34', denied: true, expected: 'refuse' },
  // Adversarial counterexamples to our own guard; not additional V1.0 coverage claims.
  { id: 'C01-hidden-handler-change', fault: 'sameVisibleIdentity', expected: 'identity-insufficient' },
  { id: 'C02-benign-status-change', fault: 'statusUpdate', expected: 'commit' },
];
