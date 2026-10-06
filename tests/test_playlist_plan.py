import importlib.util
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'))
from apply_playlist_plan import apply_plan

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
