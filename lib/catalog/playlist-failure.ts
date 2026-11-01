export type PlaylistStage = 'setup' | 'spotify_discovery' | 'spotify_apply' | 'spotify_checkpoint' | 'youtube_discovery' | 'youtube_apply' | 'commit';
const reasons = ['spotify_readback_mismatch', 'spotify_plan_superseded', 'playlist_rpc_failed', 'youtube_quota_bound_reached', 'youtube_reconciliation_required', 'youtube_insert_readback_failed', 'youtube_metadata_readback_failed', 'youtube_delete_readback_failed', 'unclassified'];
const diagnostic = new RegExp(`^playlist_worker_failed stage=(setup|spotify_discovery|spotify_apply|spotify_checkpoint|youtube_discovery|youtube_apply|commit) reason=(${reasons.join('|')})$`);

/** Closed vocabulary: provider messages, URLs, bodies and secrets stay private. */
export function playlistFailure(stage: PlaylistStage, error: unknown): string {
  const failure = error as { stderr?: unknown; message?: unknown } | null;
  const lines = typeof failure?.stderr === 'string' ? failure.stderr.split('\n') : [];
  const reason = failure?.message === 'Spotify plan superseded' ? 'spotify_plan_superseded' : lines.findLast(line => reasons.includes(line)) ?? 'unclassified';
  return `playlist_worker_failed stage=${stage} reason=${reason}`;
}

export function dispatchedPlaylistFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return (typeof stderr === 'string' ? stderr.split('\n').find(line => diagnostic.test(line)) : undefined) ?? 'playlist_dispatch_failed';
}
