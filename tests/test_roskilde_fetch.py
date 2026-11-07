import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / 'lib/ingestion/adapters/roskilde-fetch.py'
spec = importlib.util.spec_from_file_location('roskilde_fetch', path)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class RoskildeFetchTests(unittest.TestCase):
    def test_only_official_bounded_paths(self):
        for path in ['/', '/program', '/nyheder/rf27-first-wave', '/billetter']:
            self.assertTrue(helper.allowed(helper.ORIGIN + path))
        for url in ['http://www.roskilde-festival.dk/', 'https://example.test/',
                    'https://www.roskilde-festival.dk.evil.test/',
                    'https://user:pass@www.roskilde-festival.dk/',
                    helper.ORIGIN + '/program?q=evil', helper.ORIGIN + '/program#fragment',
                    helper.ORIGIN + '/admin', helper.ORIGIN + '/nyheder/../../admin']:
            self.assertFalse(helper.allowed(url), url)

    def test_foreign_redirect_rejected_before_follow(self):
        with self.assertRaises(ValueError):
            helper.SameOriginRedirect().redirect_request(None, None, 302, '', {}, 'https://example.test/')

    def test_browser_ua_and_byte_limit_used(self):
        class Response(io.BytesIO):
            url = helper.ORIGIN + '/'
            headers = {'Content-Type': 'text/html; charset=utf-8'}
        class Opener:
            def open(self, req, timeout):
                self.req, self.timeout = req, timeout
                return Response(b'<h1>Official</h1>')
        opener = Opener()
        self.assertEqual(helper.document('/', opener)['html'], '<h1>Official</h1>')
        self.assertIn('Chrome/142', opener.req.get_header('User-agent'))
        self.assertEqual(opener.timeout, 15)
        with patch.object(helper, 'MAX_BYTES', 3):
            with self.assertRaises(ValueError):
                helper.document('/', opener)

    def test_discovery_only_home_linked_current_year_with_cap(self):
        fetched = []
        def document(path, opener):
            fetched.append(path)
            return {'url': helper.ORIGIN + path, 'html': ''.join('<a href="/nyheder/rf27-wave-%d">Wave</a>' % i for i in range(10)) + '<a href="/nyheder/rf26-old">Old</a><a href="https://example.test/nyheder/rf27-evil">No</a>'}
        with patch.object(helper, 'document', document), patch.object(helper.sys, 'argv', ['helper', '2027']), patch('sys.stdout', new_callable=io.StringIO) as output:
            helper.main()
            data = json.loads(output.getvalue())
        self.assertEqual(len(data['documents']), 5)
        self.assertEqual(fetched, ['/', '/program', '/nyheder/rf27-wave-0', '/nyheder/rf27-wave-1', '/nyheder/rf27-wave-2'])
