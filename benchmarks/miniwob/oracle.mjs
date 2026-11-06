/** Grade only the upstream episode result for the trusted task manifest. */
export function gradeMiniwobOracle(oracle, { id, task, seed, episodeMaxTime = 10000 }) {
  const unknown = reason => ({ status: 'unknown', taskCompleted: null, reason });
  if (!oracle) return unknown('ORACLE_UNAVAILABLE');
  if (!id || oracle.id !== id || oracle.task !== task || oracle.seed !== seed) return unknown('ORACLE_IDENTITY_MISMATCH');
  if (!Array.isArray(oracle.results) || oracle.results.length !== 1) return unknown('ORACLE_EPISODE_COUNT_INVALID');
  const [episode] = oracle.results;
  if (!episode || episode.done !== true || episode.episodeMaxTime !== episodeMaxTime
      || !Number.isFinite(episode.rawReward) || episode.rawReward < -1 || episode.rawReward > 1
      || !Number.isFinite(episode.elapsedMs) || episode.elapsedMs < 0) return unknown('ORACLE_EPISODE_INVALID');
  const taskCompleted = episode.rawReward === 1;
  return { status: taskCompleted ? 'verified' : 'failed', taskCompleted, rawReward: episode.rawReward };
}
