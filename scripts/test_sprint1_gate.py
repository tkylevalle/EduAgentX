import copy
import unittest
import tempfile
import hashlib
from pathlib import Path
from sprint1_gate import evaluate

class GateTests(unittest.TestCase):
    def setUp(self):
        names = ['component_tests','fresh_rejection_no_partial','fresh_registration','idempotent_retry',
            'rejection_unchanged','restart_identity_preserved','postgres_health_failure','redis_health_failure',
            'dependency_recovery','redaction','correlation','latency','cleanup']
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root/'test.txt').write_text('fixture')
        self.report = {'source_sha256':'a'*64, 'checks':dict.fromkeys(names, True), 'latency_ms':[20.] * 20,
            'measurement':{'requested_samples':20}, 'source_unchanged':True,
            'artifacts':{'test.txt':hashlib.sha256(b'fixture').hexdigest()}}
    def test_external_evidence_missing_blocks(self):
        self.assertEqual(evaluate(self.report, evidence_directory=self.root)['status'], 'BLOCKED')
    def test_each_required_check_fails_closed(self):
        for key in self.report['checks']:
            r=copy.deepcopy(self.report); del r['checks'][key]
            self.assertEqual(evaluate(r, evidence_directory=self.root)['status'], 'FAIL')
    def test_invalid_and_slow_measurements(self):
        for values in [[], [1]*19, [float('nan')]*20, [float('inf')]*20, [4000]*20]:
            r=copy.deepcopy(self.report);r['latency_ms']=values
            self.assertEqual(evaluate(r, evidence_directory=self.root)['status'], 'FAIL')
    def test_complete_matching_records(self):
        base={'source_sha256':'a'*64,'reviewer':'test-reviewer','evidence_reference':'test-only'}
        p={**base, **dict.fromkeys(['postgres_redis_integration','durable_idempotency','consumer_recovery','poison_out_of_order','service_owned_permissions'],True)}
        r={**base, **dict.fromkeys(['clean_checkout_reproduced','independent_reproduction','backup_handoff','accepted'],True)}
        self.assertEqual(evaluate(self.report,p,r,self.root)['status'],'PASS')
        p['source_sha256']='different'
        self.assertEqual(evaluate(self.report,p,r,self.root)['status'],'BLOCKED')
    def test_missing_or_changed_artifact_fails(self):
        (self.root/'test.txt').write_text('changed')
        self.assertEqual(evaluate(self.report,evidence_directory=self.root)['status'],'FAIL')
        (self.root/'test.txt').unlink()
        self.assertEqual(evaluate(self.report,evidence_directory=self.root)['status'],'FAIL')

if __name__ == '__main__': unittest.main()
