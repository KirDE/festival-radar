import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistFailure, dispatchedPlaylistFailure} from '../lib/catalog/playlist-failure.ts';

test('dispatcher preserves provider stage and exact allowlisted diagnostic, not raw stderr', () => {
  const error={stderr:'private request body\nyoutube_reconciliation_required\nyoutube_insert_readback_failed\n',message:'private URL'};
  const line=playlistFailure('youtube_apply',error);
  assert.equal(line,'playlist_worker_failed stage=youtube_apply reason=youtube_insert_readback_failed');
  assert.equal(dispatchedPlaylistFailure({stderr:`private token\n${line}\nprivate details`}),line);
  for(const stderr of [line+' extra-secret',line.replace('youtube_apply','arbitrary'),line.replace('youtube_insert_readback_failed','unknown'),null]) {
    assert.equal(dispatchedPlaylistFailure({stderr}),'playlist_dispatch_failed');
  }
  assert.equal(playlistFailure('spotify_apply',new Error('Spotify plan superseded')),'playlist_worker_failed stage=spotify_apply reason=spotify_plan_superseded');
  assert.equal(playlistFailure('setup',null),'playlist_worker_failed stage=setup reason=unclassified');
});
