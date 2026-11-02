"""Unit checks of isolation/accounting, not Compose acceptance evidence."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sprint5', Path(__file__).with_name('run-sprint5.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class IsolationTests(unittest.TestCase):
    def original(self):
        return {'name': 'developer', 'volumes': {'data': {'name': 'developer-data'}},
                'networks': {'net': {'name': 'developer-net'}}, 'services': {
                    'api-gateway': {'container_name': 'developer-gateway', 'image': 'old', 'build': {},
                                    'ports': ['8080:4000'], 'environment': {},
                                    'volumes': [{'type': 'bind', 'source': '/developer/keys', 'target': '/app/keys'}]},
                    'postgres': {'image': 'postgres:16-alpine', 'ports': ['5432:5432']}}}

    def test_normalization_keeps_topology_and_never_uses_developer_resources(self):
        original = self.original()
        config = runner.private_config(original, 'private', 18080, Path('/private/keys'), Path('/private/clients'))
        self.assertEqual(original['services']['api-gateway']['container_name'], 'developer-gateway')
        self.assertEqual(config['name'], 'private')
        self.assertNotIn('name', config['volumes']['data'])
        self.assertNotIn('name', config['networks']['net'])
        self.assertNotIn('ports', config['services']['postgres'])
        gateway = config['services']['api-gateway']
        self.assertNotIn('container_name', gateway)
        self.assertEqual(gateway['image'], 'private-api-gateway')
        self.assertEqual(gateway['ports'][0]['host_ip'], '127.0.0.1')
        self.assertEqual(gateway['volumes'][0]['source'], '/private/keys')
        self.assertTrue(all(v['read_only'] for v in gateway['volumes']))
        self.assertEqual(gateway['environment']['EVALUATION_CLIENTS_ENABLED'], 'true')

    def test_external_resource_cannot_be_silently_reused_or_deleted(self):
        original = self.original()
        original['volumes']['data']['external'] = True
        with self.assertRaisesRegex(ValueError, 'external_resource_refused'):
            runner.private_config(original, 'private', 18080, Path('/keys'), Path('/clients'))

    def test_canary_progress_ignores_only_unmeasured_downstream_and_never_failed_invariants(self):
        report = {'dataset': {'selected': 1}, 'invariants': {'groups': {'REGISTRATION': {'failed': 0, 'unmeasured': 0}}}, 'results': [{'lifecycleStatus': 'CONFORMANT',
                  'status': 'BLOCKED', 'checks': [{'passed': None}]}]}
        self.assertTrue(runner.core_ready(report))
        report['results'][0]['checks'][0]['passed'] = False
        self.assertFalse(runner.core_ready(report))
        report['results'] = []
        self.assertFalse(runner.core_ready(report))

    def test_short_developer_deadline_is_explicit_private_configuration(self):
        original = self.original()
        original['services']['examination-engine'] = {'environment': {'EXAM_DURATION_MINUTES': '60'}}
        config = runner.private_config(original, 'private', 18080, Path('/keys'), Path('/clients'), deadline_minutes=1)
        self.assertEqual(config['services']['examination-engine']['environment']['EXAM_DURATION_MINUTES'], '1')
        self.assertEqual(original['services']['examination-engine']['environment']['EXAM_DURATION_MINUTES'], '60')

    def test_child_operators_come_from_resolved_private_gateway(self):
        names = ['ADMIN_CLIENT_ID', 'ADMIN_CLIENT_SECRET', 'REVIEWER_1_CLIENT_ID', 'REVIEWER_1_CLIENT_SECRET',
                 'REVIEWER_2_CLIENT_ID', 'REVIEWER_2_CLIENT_SECRET']
        config = self.original()
        config['services']['api-gateway']['environment'] = {key: 'private-' + key for key in names}
        self.assertEqual(runner.configured_operators(config), {key: 'private-' + key for key in names})

    def test_formal_retains_sixty_minutes_and_repository_defaults_are_unchanged(self):
        original = self.original()
        original['services']['examination-engine'] = {'environment': {'EXAM_DURATION_MINUTES': '60'}}
        for mode, expected in [('developer', '1'), ('formal', '60')]:
            config = runner.private_config(original, 'private', 18080, Path('/keys'), Path('/clients'),
                                           deadline_minutes=runner.response_deadline(mode, 1))
            self.assertEqual(config['services']['examination-engine']['environment']['EXAM_DURATION_MINUTES'], expected)
        self.assertEqual(original['services']['examination-engine']['environment']['EXAM_DURATION_MINUTES'], '60')
        root = Path(__file__).resolve().parents[1]
        self.assertIn('EXAM_DURATION_MINUTES=60', (root / '.env.example').read_text())
        self.assertIn('EXAM_DURATION_MINUTES: ${EXAM_DURATION_MINUTES:-60}', (root / 'docker-compose.yml').read_text())
        self.assertNotIn('EVALUATION_CLIENTS_', (root / 'docker-compose.yml').read_text())
        self.assertNotIn('EVALUATION_CLIENTS_', (root / '.env.example').read_text())

    def test_bounded_canary_selection_never_selects_formal(self):
        self.assertEqual(runner.requested_phases('developer', 'canary'), ['canary'])
        self.assertEqual(runner.requested_phases('developer', 'categories'), ['canary', 'categories'])
        self.assertEqual(runner.requested_phases('developer'), ['canary', 'categories', 'developer'])
        self.assertEqual(runner.requested_phases('formal'), ['formal'])
        with self.assertRaises(ValueError):
            runner.requested_phases('formal', 'canary')


if __name__ == '__main__':
    unittest.main()
