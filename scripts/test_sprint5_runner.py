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
        self.assertEqual(runner.requested_phases('formal'), ['faults', 'formal', 'golden'])
        with self.assertRaises(ValueError):
            runner.requested_phases('formal', 'canary')

    def test_phase2_faults_are_separate_from_formal_and_cannot_select_developer_stops(self):
        self.assertEqual(runner.requested_phases('phase2'), ['default-duration', 'stress', 'faults'])
        self.assertEqual(runner.response_deadline('phase2', 1), 1)
        with self.assertRaises(ValueError):
            runner.requested_phases('phase2', 'canary')

    def test_narrow_phase2_selection_cannot_launch_formal_or_other_services(self):
        self.assertEqual(runner.requested_phases('phase2', phase2_case='faults'), ['faults'])
        for mode in ['developer', 'formal']:
            with self.assertRaises(ValueError):
                runner.requested_phases(mode, phase2_case='faults')
        with self.assertRaises(ValueError):
            runner.requested_phases('phase2', phase2_case='formal')

    def test_private_provenance_preload_is_read_only_and_not_a_production_setting(self):
        original = self.original()
        original['services']['training-service'] = {'environment': {'EXECUTION_PRINCIPALS': 'original'}}
        config = runner.private_config(original, 'private', 18080, Path('/keys'), Path('/clients'),
                                       principals=Path('/private/principals.json'))
        for name in ['api-gateway', 'training-service']:
            service = config['services'][name]
            self.assertEqual(service['environment']['EXECUTION_PRINCIPALS'], '[]')
            self.assertEqual(service['command'][0:2], ['node', '--require'])
            self.assertTrue(any(v['target'] == '/evaluation/principals.json' and v['read_only'] for v in service['volumes']))
        self.assertEqual(original['services']['training-service']['environment']['EXECUTION_PRINCIPALS'], 'original')

    def test_golden_smoke_and_full_cohort_are_explicitly_separate(self):
        self.assertEqual(runner.requested_phases('golden-developer'), ['golden-developer'])
        self.assertEqual(runner.requested_phases('golden'), ['golden'])
        with self.assertRaises(ValueError):
            runner.requested_phases('golden', 'canary')

    def test_db_init_diagnostics_discard_log_bodies_and_secrets(self):
        self.assertEqual(runner.init_error_codes('password authentication failed; PRIVATE_DATA'), ['db_authentication'])
        self.assertEqual(runner.init_error_codes('PRIVATE_DATA SQL arbitrary failure'), [])
        self.assertEqual(runner.init_error_codes('could not translate host name; tuple concurrently updated'),
                         ['db_dns', 'db_grant_race'])

    def test_only_private_postgres_health_requires_the_final_tcp_server(self):
        original = self.original()
        original['services']['postgres']['healthcheck'] = {'test': ['CMD-SHELL', 'pg_isready']}
        config = runner.private_config(original, 'private', 18080, Path('/keys'), Path('/clients'))
        self.assertEqual(config['services']['postgres']['healthcheck']['test'][0:4],
                         ['CMD', 'pg_isready', '-h', '127.0.0.1'])
        self.assertEqual(original['services']['postgres']['healthcheck']['test'], ['CMD-SHELL', 'pg_isready'])


    def test_long_formal_stage_budget_is_bounded_without_changing_business_deadlines(self):
        self.assertEqual(runner.execution_timeout('formal'), 43200)
        self.assertEqual(runner.execution_timeout('golden'), 43200)
        self.assertEqual(runner.execution_timeout('rehearsal'), 21600)
        self.assertEqual(runner.response_deadline('formal', 1), 60)
        self.assertEqual(runner.response_deadline('rehearsal', 1), 60)

    def lifecycle_report(self, count=1000, exact=900):
        # Pure orchestration fixture, never deployment or acceptance evidence.
        return {'executed':count,'dataset':{'selected':count},
                'counts':{'CONFORMANT':exact,'MISMATCH':count-exact,'BLOCKED':0,'UNMEASURED':0,'HARNESS_ERROR':0},
                'technicalChecks':'BLOCKED','runErrors':[],'knownBlockers':[],
                'invariants':{'groups':{'REGISTRATION':{'failed':0,'unmeasured':0}}},
                'measurementCompleteness':{k:True for k in ['duplicates','finalReconciliation','mandatorySafety','provenance']},
                'duplicates':{k:{'count':0} for k in ['examinations','credentials','matches','laneAppearances']},
                'mandatorySafetyCases':20,'mandatorySafetyMeasured':20,'mandatorySafetyFalsePasses':0,
                'results':[{'oracle':{'status':'CONFORMANT'},'checks':[]} for _ in range(count)],
                'environment':{'responseDeadlineMinutes':60}}

    def test_formal_orchestration_respects_the_floor_and_independent_measurements(self):
        report=self.lifecycle_report()
        self.assertTrue(runner.measured_lifecycle_ready(report,1000))
        report['counts']['CONFORMANT']=899;report['counts']['MISMATCH']=101
        self.assertFalse(runner.measured_lifecycle_ready(report,1000))
        report=self.lifecycle_report();report['duplicates']['credentials']['count']=1
        self.assertFalse(runner.measured_lifecycle_ready(report,1000))
        report=self.lifecycle_report();report['mandatorySafetyFalsePasses']=1
        self.assertFalse(runner.measured_lifecycle_ready(report,1000))
        report=self.lifecycle_report();report['invariants']['groups']['REGISTRATION']['failed']=1
        self.assertFalse(runner.measured_lifecycle_ready(report,1000))
        report=self.lifecycle_report();report['measurementCompleteness']['finalReconciliation']=False
        self.assertFalse(runner.measured_lifecycle_ready(report,1000))

    def test_rehearsal_uses_real_duration_and_cannot_hide_incomplete_measurements(self):
        report=self.lifecycle_report(100,95)
        self.assertTrue(runner.measured_lifecycle_ready(report,100))
        report['environment']['responseDeadlineMinutes']=1
        self.assertFalse(runner.measured_lifecycle_ready(report,100))
        report=self.lifecycle_report(100,95);report['results'][0]['oracle']['status']='UNMEASURED'
        self.assertFalse(runner.measured_lifecycle_ready(report,100))


if __name__ == '__main__':
    unittest.main()
