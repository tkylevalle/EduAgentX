#!/usr/bin/env python3
"""Sprint 1 evidence gate: one command, one isolated Docker Compose project.

The run never touches the developer's own Compose project, production data or
the database directly. Every observation goes through the public Gateway API or
a service container. Evidence is written to evidence/runs/<project>/ and the
gate result (sprint1_gate.evaluate) is printed at the end.

Exit codes: 0 PASS (or technical PASS with --technical-only), 2 BLOCKED, 1 FAIL.
"""
import argparse
import hashlib
import json
import math
import os
import platform
import re
import secrets as secret_generator
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sprint1_gate import MAX_P95_MS, MIN_LATENCY_SAMPLES, evaluate
from sprint1_persistence_checks import verify as verify_persistence

ROOT = Path(__file__).resolve().parents[1]


def discover_components():
    """Same rule as scripts/components.js: shared packages first, then services."""
    return {d.name: d for group in ['packages', 'services'] for d in sorted((ROOT / group).iterdir())
            if (d / 'package.json').is_file()}


COMPONENTS = discover_components()

# The source fingerprint covers everything that can change the result.
SOURCE_DIRECTORIES = ['packages', 'services', 'scripts', 'db', 'docs', 'monitoring', 'courses', '.github']
SOURCE_FILES = ['docker-compose.yml', '.env.example', 'Makefile', '.dockerignore', '.gitattributes']
# Fresh random values for each run; they must never appear in any log.
GENERATED_SECRETS = ['POSTGRES_PASSWORD', 'REGISTRY_DB_PASSWORD', 'CURRICULUM_DB_PASSWORD',
                     'CURRICULUM_INTERNAL_KEY', 'TRAINING_DB_PASSWORD', 'TRAINING_INTERNAL_KEY',
                     'AGENT_CLIENT_SECRET', 'ADMIN_CLIENT_SECRET',
                     'GRAFANA_ADMIN_PASSWORD']
PERSISTENCE_CHECKS = ['consumer_recovery', 'poison_out_of_order', 'durable_idempotency',
                      'outbox_recovery', 'service_owned_permissions']

REGISTRATIONS = '/v1/agent-learner/registrations'
TARGET_P95_MS = 2000  # Sprint 1 target; MAX_P95_MS is the acceptance limit
MAX_RECOVERY_MS = 120_000
HEALTH_WAIT_SECONDS = 45
COMMAND_TIMEOUT_SECONDS = 600

# Runs inside the registry container so it can reach internal service names.
SYNTHETIC_CONSOLE_SCRIPT = """
(async()=>{
 const response=await fetch('http://synthetic-agent-learner:4200/v1/runs',{
  method:'POST',headers:{'content-type':'application/json','x-correlation-id':'integrated-synthetic'},
  body:JSON.stringify({profileId:'competent'})});
 const synthetic=await response.json();
 if(!response.ok || synthetic.credentialIssued!==false || !JSON.stringify(synthetic).includes('SIMULATION: Synthetic Agent Learner')) throw Error('Synthetic workflow failed');
 const trace=await (await fetch('http://assurance-console:4100/api/registration-trace')).json();
 if(trace.status!=='available' || !JSON.stringify(trace).includes('integrated-synthetic')) throw Error('Console trace missing');
 console.log(JSON.stringify({synthetic,trace}));
})().catch(()=>process.exit(1));
"""

# EXPECTED_TARGETS is replaced by the /health URLs listed in prometheus.yml, so
# adding a service to monitoring also adds it to this check.
MONITORING_SCRIPT = """
(async()=>{
 const expected=EXPECTED_TARGETS;
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  const data=await (await fetch('http://prometheus:9090/api/v1/query?query=probe_success')).json();
  const up=new Set((data.data?.result||[]).filter(x=>x.value[1]==='1').map(x=>x.metric.instance));
  if(expected.length && expected.every(target=>up.has(target))){
   if(!(await fetch('http://grafana:3000/api/health')).ok) throw Error('Grafana unhealthy');
   console.log(JSON.stringify(data));return;
  }
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Missing or failing service health probes');
})().catch(()=>process.exit(1));
"""


def health_targets():
    """The service /health URLs that Prometheus probes (monitoring/prometheus.yml)."""
    text = (ROOT / 'monitoring' / 'prometheus.yml').read_text()
    return re.findall(r'^\s*-\s*(http://\S+/health)\s*$', text, re.M)


def source_hash():
    digest = hashlib.sha256()
    paths = [ROOT / name for name in SOURCE_FILES]
    for directory in SOURCE_DIRECTORIES:
        paths += [p for p in (ROOT / directory).rglob('*')
                  if not {'node_modules', '__pycache__'} & set(p.parts) and p.suffix not in ['.pem', '.pyc']]
    for path in sorted(p for p in paths if p.is_file()):
        content = path.read_bytes().replace(b'\r\n', b'\n')
        digest.update(path.relative_to(ROOT).as_posix().encode() + b'\0' + content + b'\0')
    return digest.hexdigest()


def require(condition, description):
    if not condition:
        raise RuntimeError(description)


def p95(values):
    return sorted(values)[math.ceil(.95 * len(values)) - 1]


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--port', type=int, default=18080)
    parser.add_argument('--samples', type=int, default=MIN_LATENCY_SAMPLES)
    parser.add_argument('--prerequisites', type=Path)
    parser.add_argument('--review', type=Path)
    parser.add_argument('--technical-only', action='store_true',
                        help='CI exit code follows technical checks; release status still records BLOCKED without approval')
    args = parser.parse_args()
    require(args.samples >= MIN_LATENCY_SAMPLES, f'At least {MIN_LATENCY_SAMPLES} samples required')
    return args


class EvidenceRun:
    def __init__(self, args):
        self.args = args
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        self.project = f'eduagentx-evidence-{stamp.lower()}-{os.getpid()}'
        self.out = ROOT / 'evidence' / 'runs' / self.project
        self.out.mkdir(parents=True)
        self.base = f'http://127.0.0.1:{args.port}'
        # Planted in body, query and header. Finding one in a log fails the run.
        self.canary_body = f'CANARY_{stamp}_BODY'
        self.canary_query = f'CANARY_{stamp}_QUERY'
        self.canary_header = f'CANARY_{stamp}_HEADER'
        self.secrets = []
        self.correlation_ids = []
        self.compose = None
        self.config = None
        self.config_path = None
        self.report = {
            'schemaVersion': 1, 'source_sha256': source_hash(), 'timestamp': stamp, 'project': self.project,
            'checks': {}, 'latency_ms': [], 'failure': None,
            'measurement': {
                'requested_samples': args.samples, 'concurrency': 1, 'warmup': 0, 'percentile': 'nearest_rank',
                'scope': 'new registration through Gateway; restart/auth/precondition excluded',
                'environment': 'simulation; Gateway recreated per sample; database remains running'},
        }
        self.checks = self.report['checks']
        self.env = self._isolated_environment()

    def _isolated_environment(self):
        env = os.environ.copy()
        # Local HTTP tests must not traverse a machine-wide proxy.
        env['NODE_USE_ENV_PROXY'] = '0'
        env['NO_PROXY'] = env['no_proxy'] = 'localhost,127.0.0.1'
        os.environ['NO_PROXY'] = os.environ['no_proxy'] = 'localhost,127.0.0.1'
        # Local shell overrides must not leak into the isolated configuration.
        for line in (ROOT / '.env.example').read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                env.pop(line.split('=', 1)[0], None)
        for name in GENERATED_SECRETS:
            env[name] = secret_generator.token_hex(32)
            self.secrets.append(env[name])
        env['SPRINT1_RESULTS_DIR'] = str(self.out)
        env['GATEWAY_BASE_URL'] = self.base
        return env

    # --- process and HTTP helpers -------------------------------------------

    def command(self, argv, logname=None, check=True):
        argv = [shutil.which(argv[0]) or argv[0], *argv[1:]]
        result = subprocess.run(argv, cwd=ROOT, env=self.env, text=True, capture_output=True,
                                timeout=COMMAND_TIMEOUT_SECONDS)
        if logname:
            (self.out / logname).write_text(result.stdout + result.stderr)
        if check and result.returncode:
            raise RuntimeError('Command failed: ' + ' '.join(argv[:4]) + ('; see ' + logname if logname else ''))
        return result

    def dc(self, *argv, check=True):
        return self.command(self.compose + list(argv), check=check)

    def http(self, path, body=None, token=None, correlation='health-check', raw=None):
        headers = {'Content-Type': 'application/json', 'x-correlation-id': correlation,
                   'x-test-secret': self.canary_header}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        data = raw if raw is not None else None if body is None else json.dumps(body).encode()
        request = Request(self.base + path, data=data, headers=headers)
        start = time.perf_counter()
        try:
            with urlopen(request, timeout=10) as response:
                status, result = response.status, json.load(response)
        except HTTPError as error:
            status, result = error.code, json.load(error)
            error.close()
        return status, result, (time.perf_counter() - start) * 1000

    def wait_health(self, expected=200):
        deadline = time.monotonic() + HEALTH_WAIT_SECONDS
        while time.monotonic() < deadline:
            try:
                status, data, _ = self.http('/health')
                if status == expected:
                    return data
            except (URLError, TimeoutError, HTTPException, ConnectionError):
                pass
            time.sleep(.5)
        raise RuntimeError('Health did not reach ' + str(expected))

    def token(self, client, secret):
        status, data, _ = self.http('/v1/auth/tokens', {'clientId': client, 'clientSecret': secret})
        require(status == 200, 'Token exchange failed')
        self.secrets.append(data['accessToken'])
        return data['accessToken']

    def message(self, client, ident):
        return {
            'protocol': 'ExternalAgentLearner', 'protocolVersion': '1.0.0', 'messageType': 'registration',
            'messageId': ident, 'correlationId': ident, 'idempotencyKey': ident, 'timeoutMs': 5000,
            'evidence': {'mode': 'synthetic'},
            'payload': {
                'agentLearnerKey': client,
                'model': {'provider': 'synthetic', 'version': '1.0.0'},
                'systemPromptHash': 'sha256:' + self.canary_body,
                'policyConfigurationHash': 'sha256:synthetic-policy-v1',
                'adapterVersion': 'synthetic-agent-learner-1.0.0',
                'approvedToolManifest': [{'name': 'knowledge.lookup', 'version': '1.0.0', 'permissions': ['read']}]},
            'privatePrompt': self.canary_body,
        }

    def read_registration(self, client, token):
        return self.http('/v1/registrations?agentLearnerKey=' + client, token=token)

    def write_config(self):
        self.config_path.write_text(json.dumps(self.config))
        self.config_path.chmod(0o600)

    @property
    def gateway_env(self):
        return self.config['services']['api-gateway']['environment']

    def recreate_gateway_for(self, client):
        """The Gateway accepts one agent client ID; switching it needs a restart."""
        self.gateway_env['AGENT_CLIENT_ID'] = client
        self.write_config()
        self.dc('up', '-d', '--no-deps', '--force-recreate', '--wait', '--wait-timeout', '120', 'api-gateway')
        self.wait_health()

    # --- steps ---------------------------------------------------------------

    def record_versions(self):
        versions = {'platform': platform.platform(), 'python': platform.python_version()}
        for binary in ['docker', 'node', 'npm']:
            versions[binary] = self.command([binary, '--version']).stdout.strip()
        versions['compose'] = self.command(['docker', 'compose', 'version']).stdout.strip()
        versions['api'] = 'v1'
        versions['protocol'] = 'ExternalAgentLearner 1.0.0'
        self.report['versions'] = versions
        self.report['git_commit'] = self.command(['git', 'rev-parse', 'HEAD'], check=False).stdout.strip()

    def run_component_tests(self):
        self.command([sys.executable, '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_sprint1_gate.py'],
                     'gate-unit-tests.txt')
        self.command(['node', 'scripts/generate-test-keys.js'], 'key-setup.txt')
        for name, directory in COMPONENTS.items():
            print('Component tests: ' + name, flush=True)
            self.command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', str(directory)],
                         name + '-install.txt')
            tests = [str(p) for p in sorted((directory / 'test').glob('*.test.js'))]
            result = self.command(['node', '--test', '--test-reporter=tap', *tests], name + '-tests.tap')
            require(re.search(r'^# fail 0$', result.stdout, re.M)
                    and re.search(r'^# tests [1-9][0-9]*$', result.stdout, re.M), 'Missing test summary')
            require(not re.search(r'^# (skipped|cancelled|todo) [1-9]', result.stdout, re.M), 'Incomplete tests')
        self.checks['component_tests'] = True
        self.report['component_versions'] = {
            name: json.loads(self.command(['npm', 'ls', '--json', '--depth=0', '--prefix', str(directory)]).stdout)
            for name, directory in COMPONENTS.items()}

    def prepare_compose_project(self, temporary):
        """Resolve docker-compose.yml into a private, uniquely named project."""
        self.config_path = Path(temporary) / 'compose.json'
        result = self.command(['docker', 'compose', '--env-file', str(ROOT / '.env.example'),
                               'config', '--format', 'json'])
        self.config = json.loads(result.stdout)
        self.config['name'] = self.project
        # Archive only a configuration digest, never the resolved credentials.
        self.report['compose_configuration_sha256'] = hashlib.sha256(result.stdout.encode()).hexdigest()
        for group in ['volumes', 'networks']:
            for item in self.config.get(group, {}).values():
                item.pop('name', None)
        for name, service in self.config['services'].items():
            service.pop('container_name', None)
            service.pop('ports', None)
            if 'image' in service and 'build' in service:
                service['image'] = f'{self.project}-{name}'
        self.config['services']['api-gateway']['ports'] = [
            {'target': 4000, 'published': str(self.args.port), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        self.secrets.extend([self.gateway_env['AGENT_CLIENT_SECRET'], self.gateway_env['ADMIN_CLIENT_SECRET']])
        self.write_config()
        self.compose = ['docker', 'compose', '-p', self.project, '-f', str(self.config_path)]

    def start_stack(self):
        print('Building isolated environment (existing project is untouched)...', flush=True)
        self.command(self.compose + ['up', '-d', '--build', '--wait', '--wait-timeout', '120'], 'compose-build.txt')
        dependencies = self.wait_health().get('dependencies', {})
        require(dependencies.get('redis') == 'ok', 'Redis health evidence missing')
        require(dependencies.get('postgres') == 'ok', 'Postgres health evidence missing')
        (self.out / 'images.json').write_text(self.dc('images', '--format', 'json').stdout)
        self.report['container_versions'] = {
            service: json.loads(self.dc('exec', '-T', service, 'npm', 'ls', '--json', '--depth=0').stdout)
            for service in ['agent-registry', 'api-gateway']}

    def check_synthetic_console(self):
        workflow = self.dc('exec', '-T', 'agent-registry', 'node', '-e', SYNTHETIC_CONSOLE_SCRIPT)
        (self.out / 'synthetic-console.json').write_text(workflow.stdout)
        self.checks['synthetic_console'] = True

    def check_rejection_before_create(self, client, token):
        bad = self.message(client, 'reject-before-create')
        bad['protocolVersion'] = '9.0.0'
        require(self.http(REGISTRATIONS, bad, token, 'reject-before-create')[0] == 400, 'Expected rejection')
        require(self.read_registration(client, token)[0] == 404, 'Partial registration after rejection')
        self.checks['fresh_rejection_no_partial'] = True

    def check_first_registration(self, client, token, message, status, data):
        """Retry, rejection and restart must not change the first registration."""
        ident = message['messageId']
        self.checks['fresh_registration'] = True
        (self.out / 'first-registration.json').write_text(json.dumps(data, indent=2) + '\n')
        created_state = self.read_registration(client, token)[1]['registration']
        retry_status, replay, _ = self.http(REGISTRATIONS, message, token, ident)
        require(retry_status == 201 and replay == data, 'Retry changed original result')
        before = self.read_registration(client, token)[1]['registration']
        require(before == created_state, 'Retry mutated authoritative registration or history')
        bad = self.message(client, 'reject-after-create')
        bad['payload']['model'] = {}
        require(self.http(REGISTRATIONS, bad, token, 'reject-after-create')[0] == 400, 'Invalid request accepted')
        require(self.read_registration(client, token)[1]['registration'] == before, 'State mutated after rejected request')
        self.checks['idempotent_retry'] = self.checks['rejection_unchanged'] = True

        self.dc('restart', 'agent-registry', 'api-gateway')
        self.wait_health()
        require(self.read_registration(client, token)[1]['registration'] == before, 'Registration lost across restart')
        restart_status, restarted, _ = self.http(REGISTRATIONS, message, token, ident)
        require(restart_status == status and restarted == data, 'Retry after restart changed original result')
        self.checks['restart_identity_preserved'] = True
        demonstration = [
            {'scenario': 'created', 'httpStatus': status, 'agentLearnerId': data['registration']['agentLearnerId'],
             'configurationVersion': 1},
            {'scenario': 'retry', 'exact_response_equal': True},
            {'scenario': 'rejected', 'state_unchanged': True}]
        (self.out / 'demonstration.json').write_text(json.dumps(demonstration, indent=2))

    def measure_registrations(self):
        """Each sample registers a brand-new identity; the first also runs the behavior checks."""
        secret = self.gateway_env['AGENT_CLIENT_SECRET']
        created_ids = set()
        for i in range(self.args.samples):
            print(f'New registration {i + 1}/{self.args.samples}', flush=True)
            client = f'evidence-{i:03d}'
            self.recreate_gateway_for(client)
            token = self.token(client, secret)
            require(self.read_registration(client, token)[0] == 404, 'Identity already exists')
            if i == 0:
                self.check_rejection_before_create(client, token)
            ident = f'new-registration-{i:03d}'
            message = self.message(client, ident)
            status, data, elapsed = self.http(f'{REGISTRATIONS}?secret={self.canary_query}', message, token, ident)
            registration = data.get('registration', {})
            require(status == 201 and data.get('outcome') == 'registered'
                    and registration.get('configurationVersion') == 1, 'Registration must create version 1')
            require(registration.get('agentLearnerId') and registration['agentLearnerId'] not in created_ids,
                    'Duplicate agent ID')
            require(data.get('assurance', {}).get('publicationStatus') == 'queued', 'Durable stream queue missing')
            created_ids.add(registration['agentLearnerId'])
            self.correlation_ids.append(ident)
            self.report['latency_ms'].append(elapsed)
            if i == 0:
                self.check_first_registration(client, token, message, status, data)
        self.report['p95_ms'] = p95(self.report['latency_ms'])
        self.checks['latency'] = self.report['p95_ms'] <= MAX_P95_MS
        self.report['target_met'] = self.report['p95_ms'] <= TARGET_P95_MS
        return client, secret, token

    def check_dependency_outages(self, client, token):
        """Stop each dependency, expect 503 health, then expect recovery."""
        for dependency in ['redis', 'postgres']:
            print('Controlled dependency outage: ' + dependency, flush=True)
            self.dc('stop', dependency)
            try:
                self.wait_health(503)
                self.checks[dependency + '_health_failure'] = True
                if dependency == 'postgres':
                    status, _, _ = self.http(REGISTRATIONS, self.message(client, 'postgres-outage'),
                                             token, 'postgres-outage')
                    require(status >= 500, 'Unavailable database must not return success')
            finally:
                started = time.monotonic()
                self.dc('start', dependency)
                self.wait_health()
                elapsed = (time.monotonic() - started) * 1000
                self.report.setdefault('recovery_ms', {})[dependency] = elapsed
            # Outside `finally`, so a slow recovery cannot hide the original error.
            require(elapsed <= MAX_RECOVERY_MS, 'Dependency recovery exceeded 120 seconds')
        self.checks['dependency_recovery'] = True

    def run_security_suite(self, client):
        self.env['AGENT_CLIENT_ID'] = client
        self.env['ADMIN_CLIENT_ID'] = self.gateway_env['ADMIN_CLIENT_ID']
        self.command(['node', 'scripts/security-integration.js'], 'security-integration.txt')
        self.checks['security_integration'] = True

    def check_persistence(self, client, secret):
        persistence = verify_persistence(
            dc=self.dc, config=self.config, write_config=self.write_config, http=self.http, token=self.token,
            message=self.message, client=client, secret=secret, require=require, wait_health=self.wait_health)
        (self.out / 'persistence.json').write_text(json.dumps(persistence, indent=2) + '\n')
        for name in PERSISTENCE_CHECKS:
            self.checks[name] = persistence[name]

    def check_monitoring(self):
        print('Checking Prometheus probes and Grafana...', flush=True)
        script = MONITORING_SCRIPT.replace('EXPECTED_TARGETS', json.dumps(health_targets()))
        monitor = self.dc('exec', '-T', 'agent-registry', 'node', '-e', script)
        (self.out / 'monitoring.json').write_text(monitor.stdout)
        self.checks['monitoring'] = True

    def service_logs(self):
        return self.dc('logs', '--no-color', 'api-gateway', 'agent-registry').stdout

    def check_logs(self, earlier_logs):
        """No secret or canary in any log; every request and dependency call is correlated."""
        bad_token = self.http(f'{REGISTRATIONS}?secret={self.canary_query}', token=self.canary_header,
                              raw=b'{}', correlation='bad-token')
        require(bad_token[0] == 401, 'Invalid auth accepted')
        bad_json = self.http(REGISTRATIONS, raw=('{"privatePrompt":"' + self.canary_body + '",').encode(),
                             correlation='bad-json')
        require(bad_json[0] == 400, 'Malformed JSON accepted')
        time.sleep(.5)
        logs = earlier_logs + '\n' + self.service_logs()
        forbidden = [self.canary_body, self.canary_query, self.canary_header, *self.secrets]
        require(not any(value in logs for value in forbidden), 'Secret/canary found in logs')
        records = []
        for line in logs.splitlines():
            _, separator, raw = line.partition('|')
            if separator:
                try:
                    records.append(json.loads(raw))
                except ValueError:
                    pass
        # Gateway containers are recreated for measurements: check the final sample.
        ident = self.correlation_ids[-1]
        for service in ['api-gateway', 'agent-registry']:
            require(any(r.get('service') == service and r.get('correlationId') == ident and r.get('statusCode') == 201
                        for r in records), 'Missing correlated service trace')
        for dependency in ['postgres', 'redis']:
            require(any(r.get('dependency') == dependency and r.get('correlationId') == ident for r in records),
                    'Missing dependency telemetry')
        for rejected, status in [('bad-token', 401), ('bad-json', 400)]:
            require(any(r.get('correlationId') == rejected and r.get('statusCode') == status for r in records),
                    'Missing rejection log')
        require(any(r.get('event') == 'dependency_operation' and r.get('dependency') == 'postgres'
                    and r.get('outcome') == 'error' for r in records), 'Missing dependency failure telemetry')
        self.checks['redaction'] = self.checks['correlation'] = True
        (self.out / 'telemetry.jsonl').write_text('\n'.join(json.dumps(r) for r in records) + '\n')

    def redact(self, text):
        for value in self.secrets:
            text = text.replace(value, '[REDACTED]')
        return text

    def tear_down_stack(self):
        # Keep sanitized startup/failure logs before removing only this project.
        (self.out / 'compose-logs.txt').write_text(self.redact(self.dc('logs', '--no-color', check=False).stdout))
        # This project and its volumes were created by this invocation only.
        self.checks['cleanup'] = self.dc('down', '--volumes', '--remove-orphans', check=False).returncode == 0

    def run_stack_checks(self):
        with tempfile.TemporaryDirectory(prefix=self.project + '-') as temporary:
            self.prepare_compose_project(temporary)
            try:
                self.start_stack()
                self.check_synthetic_console()
                client, secret, token = self.measure_registrations()
                self.check_dependency_outages(client, token)
                self.run_security_suite(client)
                earlier_logs = self.service_logs()
                self.check_persistence(client, secret)
                self.check_monitoring()
                self.check_logs(earlier_logs)
            finally:
                self.tear_down_stack()

    def finish(self):
        self.report['source_unchanged'] = source_hash() == self.report['source_sha256']
        if not self.report['source_unchanged']:
            self.report['failure'] = 'Source changed during run'
        self.report['artifacts'] = {
            str(p.relative_to(self.out)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.out.rglob('*') if p.is_file() and p.name not in ['run.json', 'gate.json']}

        def record(path):
            return json.loads(path.read_text()) if path else None

        try:
            gate = evaluate(self.report, record(self.args.prerequisites), record(self.args.review), self.out)
        except Exception:
            gate = {'status': 'FAIL', 'errors': ['Invalid review/prerequisite record']}
        (self.out / 'run.json').write_text(json.dumps(self.report, indent=2) + '\n')
        (self.out / 'gate.json').write_text(json.dumps(gate, indent=2) + '\n')
        print(json.dumps(gate, indent=2))
        print('Evidence: ' + str(self.out))
        return gate

    def execute(self):
        try:
            self.record_versions()
            self.run_component_tests()
            self.run_stack_checks()
        except (Exception, KeyboardInterrupt) as error:
            self.report['failure'] = type(error).__name__ + ': ' + str(error)
            print('Run stopped: ' + self.report['failure'], file=sys.stderr)
            (self.out / 'failure.txt').write_text(self.redact(traceback.format_exc()))
        return self.finish()


def exit_code(gate, technical_only):
    if gate['status'] == 'PASS' or (technical_only and gate.get('technical_checks') == 'PASS'):
        return 0
    return 2 if gate['status'] == 'BLOCKED' else 1


def main():
    args = parse_args()
    gate = EvidenceRun(args).execute()
    return exit_code(gate, args.technical_only)


if __name__ == '__main__':
    sys.exit(main())
