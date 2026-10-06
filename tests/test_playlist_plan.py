import importlib.util
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'))
from apply_playlist_plan import apply_plan, ensure_playlist


class CreationTests(unittest.TestCase):
    def setUp(self):
        self.plan = dict(playlist_url='', playlist_id='report-only', playlist_name='Festival 2027',
                         track_uris=['spotify:track:' + 'b'*22], track_count=1)
        self.state = dict(marker='festival-radar:job', sent=False, playlistId=None)
        self.remote = {}
        self.posts = 0
        self.timeout = False
        self.bind_failure = False
        self.guards = 0
        self.tracks = []
        self.track_writes = 0

    def guard(self):
        self.guards += 1

    def store(self, action, playlist_id=None):
        if action == 'reserve':
            if self.state['sent']:
                raise RuntimeError('already sent')
            self.state['sent'] = True
        elif action == 'bind':
            if self.bind_failure:
                raise RuntimeError('lease lost before persistence')
            self.state['playlistId'] = playlist_id
        return self.state.copy()

    def request(self, method, url, **kwargs):
        if url.endswith('/items'):
            if method == 'GET':
                offset = kwargs['params']['offset']
                return {'items': [{'item': {'uri': uri}} for uri in self.tracks[offset:offset+100]], 'next': offset + 100 < len(self.tracks)}
            self.track_writes += 1
            if method == 'PUT': self.tracks = kwargs['json']['uris'][:]
            else: self.tracks.extend(kwargs['json']['uris'])
            return {}
        if url.endswith('/me'):
            return {'id': 'owner'}
        if method == 'POST':
            self.assertEqual(url, 'https://api.spotify.com/v1/me/playlists')
            self.assertTrue(self.state['sent'], 'intent must be durable before POST')
            self.posts += 1
            self.remote['a'*22] = {'id': 'a'*22, 'owner': {'id': 'owner'}, **kwargs['json']}
            if self.timeout:
                self.timeout = False
                raise TimeoutError('create succeeded but response lost')
            return self.remote['a'*22]
        if url.endswith('/me/playlists'):
            return {'items': list(self.remote.values()), 'next': None}
        return self.remote[url.rsplit('/', 1)[-1]]

    def run_creation(self):
        ensure_playlist(self.plan, self.request, self.guard, self.store)

    def test_creation_is_durable_and_read_back(self):
        self.run_creation()
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.state['playlistId'], 'a'*22)
        self.assertEqual(self.plan['playlist_url'], 'https://open.spotify.com/playlist/' + 'a'*22)
        self.assertGreaterEqual(self.guards, 3)

    def test_unknown_create_success_recovers_without_second_post(self):
        self.timeout = True
        with self.assertRaises(TimeoutError): self.run_creation()
        self.assertIsNone(self.state['playlistId'])
        self.run_creation()
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.state['playlistId'], 'a'*22)

    def test_loss_before_id_persistence_recovers(self):
        self.bind_failure = True
        with self.assertRaises(RuntimeError): self.run_creation()
        self.bind_failure = False
        self.run_creation()
        self.assertEqual(self.posts, 1)

    def test_unknown_outcome_without_discovery_never_resends(self):
        self.state['sent'] = True
        for _ in range(2):
            with self.assertRaisesRegex(RuntimeError, 'reconciliation required'): self.run_creation()
        self.assertEqual(self.posts, 0)

    def test_multiple_markers_or_wrong_owner_do_not_bind(self):
        self.state['sent'] = True
        for key in ['a'*22, 'c'*22]:
            self.remote[key] = {'id': key, 'owner': {'id': 'owner'}, 'description': '[festival-radar:job]'}
        with self.assertRaises(RuntimeError): self.run_creation()
        self.remote = {'a'*22: {**self.remote['a'*22], 'owner': {'id': 'other'}}}
        with self.assertRaises(RuntimeError): self.run_creation()
        self.assertIsNone(self.state['playlistId'])
        self.assertEqual(self.posts, 0)

    def test_saved_id_is_reverified_and_no_create_occurs(self):
        self.run_creation()
        self.plan['playlist_url'] = ''  # durable input plan, as on a new attempt
        self.remote['a'*22]['description'] = 'changed remotely'
        with self.assertRaisesRegex(ValueError, 'read-back mismatch'): self.run_creation()
        self.assertEqual(self.posts, 1)

    def test_empty_tracks_and_lease_loss_prevent_create(self):
        self.plan['track_uris'] = []
        with self.assertRaises(ValueError): self.run_creation()
        self.assertEqual(self.posts, 0)
        self.plan['track_uris'] = ['spotify:track:' + 'b'*22]
        def lost(): raise RuntimeError('lease lost')
        with self.assertRaises(RuntimeError): ensure_playlist(self.plan, self.request, lost, self.store)
        self.assertFalse(self.state['sent'])

    def test_existing_playlist_skips_creation_state(self):
        self.plan['playlist_url'] = 'https://open.spotify.com/playlist/' + 'a'*22
        def forbidden(*args): raise AssertionError('creation accessed')
        ensure_playlist(self.plan, forbidden, forbidden, forbidden)

    def test_loss_after_reservation_blocks_retry_without_post(self):
        def guard():
            if self.state['sent']:
                raise RuntimeError('lease lost after reservation')
        with self.assertRaises(RuntimeError): ensure_playlist(self.plan, self.request, guard, self.store)
        self.assertTrue(self.state['sent'])
        with self.assertRaisesRegex(RuntimeError, 'reconciliation required'): self.run_creation()
        self.assertEqual(self.posts, 0)

    def test_discovery_paginates_before_binding(self):
        self.state['sent'] = True
        self.remote['a'*22] = {'id': 'a'*22, 'owner': {'id': 'owner'}, 'description': '[festival-radar:job]'}
        offsets = []
        def request(method, url, **kwargs):
            if url.endswith('/me/playlists'):
                offset = kwargs['params']['offset']
                offsets.append(offset)
                if offset == 0:
                    return {'items': [{'id': 'c'*22, 'owner': {'id': 'owner'}, 'description': 'other'}], 'next': True}
            return self.request(method, url, **kwargs)
        ensure_playlist(self.plan, request, self.guard, self.store)
        self.assertEqual(offsets, [0, 1])
        self.assertEqual(self.posts, 0)
        self.assertEqual(self.state['playlistId'], 'a'*22)

    def test_retry_after_content_success_and_lost_db_commit_is_noop(self):
        self.run_creation()
        apply_plan(self.plan, self.request, self.guard)
        self.assertEqual(self.tracks, self.plan['track_uris'])
        self.plan['playlist_url'] = ''
        self.plan['playlist_id'] = 'report-only'
        self.run_creation()
        apply_plan(self.plan, self.request, self.guard)
        self.assertEqual(self.posts, 1)
        self.assertEqual(self.track_writes, 1)

class PlanTests(unittest.TestCase):
    def plan(self, count=150):
        uris = ['spotify:track:' + str(i).zfill(22) for i in range(count)]
        return dict(playlist_id='a'*22, playlist_url='https://open.spotify.com/playlist/'+'a'*22, track_uris=uris, track_count=count)

    def provider(self, existing, fail_append=False):
        state = {'uris': existing[:], 'writes': [], 'fail': fail_append}
        def request(method, url, **kwargs):
            if method == 'GET':
                offset = kwargs['params']['offset']
                page = state['uris'][offset:offset+100]
                return {'items': [{'track': {'uri': uri}} for uri in page], 'next': offset+100 < len(state['uris'])}
            state['writes'].append(method)
            if method == 'PUT': state['uris'] = kwargs['json']['uris'][:]
            else:
                state['uris'].extend(kwargs['json']['uris'])
                if state['fail']:
                    state['fail'] = False
                    raise TimeoutError('ambiguous append succeeded remotely')
            return {}
        return state, request

    def test_retry_after_ambiguous_append_is_convergent(self):
        plan = self.plan()
        state, request = self.provider([], True)
        with self.assertRaises(TimeoutError): apply_plan(plan, request, lambda: None)
        apply_plan(plan, request, lambda: None)
        self.assertEqual(state['uris'], plan['track_uris'])
        self.assertEqual(state['writes'], ['PUT', 'POST'])

    def test_partial_attempt_restarts_replacement(self):
        plan = self.plan()
        state, request = self.provider(plan['track_uris'][:100])
        apply_plan(plan, request, lambda: None)
        self.assertEqual(state['writes'], ['PUT', 'POST'])
        self.assertEqual(state['uris'], plan['track_uris'])

    def test_lease_loss_prevents_effects(self):
        state, request = self.provider([])
        def guard(): raise RuntimeError('lease lost')
        with self.assertRaises(RuntimeError): apply_plan(self.plan(), request, guard)
        self.assertEqual(state['writes'], [])

    def test_existing_content_is_noop_and_bad_ids_are_rejected(self):
        plan = self.plan()
        state, request = self.provider(plan['track_uris'])
        apply_plan(plan, request, lambda: None)
        self.assertEqual(state['writes'], [])
        plan['playlist_id'] = 'wrong'
        with self.assertRaises(ValueError): apply_plan(plan, request, lambda: None)

    def test_modern_item_readback_and_final_mismatch(self):
        plan = self.plan(1)
        def modern(method, url, **kwargs):
            self.assertTrue(url.endswith('/items'))
            return {'items': [{'item': {'uri': plan['track_uris'][0]}}], 'next': None}
        apply_plan(plan, modern, lambda: None)
        state, request = self.provider([])
        def wrong_readback(method, url, **kwargs):
            result = request(method, url, **kwargs)
            if method == 'GET': return {'items': [], 'next': None}
            return result
        with self.assertRaisesRegex(ValueError, 'read-back mismatch'): apply_plan(plan, wrong_readback, lambda: None)

    def test_loss_before_append_stops_following_effects(self):
        plan = self.plan()
        state, request = self.provider([])
        def guard():
            if state['writes']: raise RuntimeError('lease lost after replacement')
        with self.assertRaises(RuntimeError): apply_plan(plan, request, guard)
        self.assertEqual(state['writes'], ['PUT'])
