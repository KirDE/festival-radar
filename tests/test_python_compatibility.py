import ast
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAYLIST_SCRIPTS = ROOT / 'scripts' / 'spotify_gmm_2026'


class PythonCompatibilityTest(unittest.TestCase):
    def test_pep604_annotations_are_deferred_for_python_39(self):
        for path in PLAYLIST_SCRIPTS.glob('*.py'):
            source = path.read_text(encoding='utf-8')
            if ' | None' not in source:
                continue

            module = ast.parse(source)
            future_imports = {
                alias.name
                for node in module.body
                if isinstance(node, ast.ImportFrom) and node.module == '__future__'
                for alias in node.names
            }
            with self.subTest(path=path.name):
                self.assertIn('annotations', future_imports)


if __name__ == '__main__':
    unittest.main()
