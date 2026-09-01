import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / 'scripts' / 'refresh-youtube-music-playlists.py'
SPEC = importlib.util.spec_from_file_location('youtube_refresh', SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class Completed:
    def __init__(self, returncode=0, stderr=''):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ''


class YouTubeRefreshTests(unittest.TestCase):
    def test_scoped_report_directory_only_refreshes_selected_export(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root) / 'reports'
            output = Path(root) / 'output'
            reports.mkdir()
            (reports / '_catalog_summary.json').write_text(json.dumps({'eligible': ['summer-breeze']}))
            (reports / 'summer-breeze.json').write_text(json.dumps({
                'slug': 'summer-breeze', 'artists_count': 2, 'track_count': 4,
            }))
            with patch.object(MODULE.subprocess, 'run', return_value=Completed()) as run:
                summary = MODULE.run_all(
                    reports, output, {'summer-breeze': 'PLpersisted'}, publish=True,
                )
            self.assertEqual(summary['processed'], 1)
            self.assertEqual(summary['succeeded'], 1)
            self.assertIn('--playlist-id', run.call_args.args[0])
            self.assertIn('PLpersisted', run.call_args.args[0])

    def test_empty_and_missing_playlist_id_never_mutate(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root) / 'reports'
            output = Path(root) / 'output'
            reports.mkdir()
            (reports / 'empty.json').write_text(json.dumps({'slug': 'empty', 'artists_count': 0, 'track_count': 0}))
            (reports / 'eligible.json').write_text(json.dumps({'slug': 'eligible', 'artists_count': 2, 'track_count': 4}))
            with patch.object(MODULE.subprocess, 'run') as run:
                summary = MODULE.run_all(reports, output, {}, publish=True)
            run.assert_not_called()
            self.assertEqual(summary['skipped'], 2)
            self.assertEqual(summary['unmapped'], 1)
            self.assertEqual(summary['failed'], 0)
            self.assertEqual(summary['status'], 'failure')

    def test_unmapped_catalog_entries_do_not_fail_a_mapped_provider_refresh(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root) / 'reports'
            output = Path(root) / 'output'
            reports.mkdir()
            for slug in ('mapped', 'not-reviewed'):
                (reports / f'{slug}.json').write_text(json.dumps({
                    'slug': slug, 'artists_count': 2, 'track_count': 4,
                }))
            with patch.object(MODULE.subprocess, 'run', return_value=Completed()) as run:
                summary = MODULE.run_all(
                    reports, output, {'mapped': 'PLpersisted123'}, publish=True,
                )
            self.assertEqual(run.call_count, 1)
            self.assertEqual(summary['status'], 'success')
            self.assertEqual(summary['succeeded'], 1)
            self.assertEqual(summary['unmapped'], 1)
            self.assertEqual(summary['health']['mapping'], 'partial')

    def test_provider_failures_are_isolated_and_updates_are_resumable(self):
        with tempfile.TemporaryDirectory() as root:
            reports = Path(root) / 'reports'
            output = Path(root) / 'output'
            reports.mkdir()
            for slug in ('first', 'second'):
                (reports / f'{slug}.json').write_text(json.dumps({'slug': slug, 'artists_count': 2, 'track_count': 4}))
            with patch.object(MODULE.subprocess, 'run', side_effect=[Completed(1, 'quota failure'), Completed(0)]) as run:
                summary = MODULE.run_all(reports, output, {'first': 'PLfirst', 'second': 'PLsecond'}, publish=True)
            self.assertEqual(run.call_count, 2)
            self.assertEqual(summary['failed'], 1)
            self.assertEqual(summary['succeeded'], 1)
            for call in run.call_args_list:
                command = call.args[0]
                self.assertIn('--resume-publish', command)
                self.assertIn('--update-metadata', command)

    def test_playlist_mapping_validation(self):
        self.assertEqual(MODULE.load_mapping('{"festival":"PLpersisted123"}'), {'festival': 'PLpersisted123'})
        with self.assertRaises(ValueError):
            MODULE.load_mapping('["PL123"]')
        with self.assertRaises(ValueError):
            MODULE.load_mapping('{"festival":"not a playlist id"}')

    def test_provider_failure_categories_are_sanitized(self):
        self.assertEqual(MODULE.classify_provider_failure('HTTP 403 quotaExceeded'), 'quota')
        self.assertEqual(MODULE.classify_provider_failure('invalid_grant'), 'authentication')
        self.assertEqual(MODULE.classify_provider_failure('invalid playlist id'), 'mapping')
        self.assertEqual(MODULE.classify_provider_failure('unexpected provider response'), 'publishing')

    def test_provider_file_validation_reports_fields_without_values(self):
        with tempfile.TemporaryDirectory() as root:
            credentials = Path(root) / 'credentials.json'
            oauth = Path(root) / 'oauth.json'
            credentials.write_text(json.dumps({'client_id': 'configured', 'client_secret': 'configured'}))
            oauth.write_text(json.dumps({'access_token': 'configured'}))
            self.assertEqual(MODULE.validate_provider_files(credentials, oauth), ['oauth_fields'])


if __name__ == '__main__':
    unittest.main()
