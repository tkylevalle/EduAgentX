#!/usr/bin/env python3
"""Issue 33 public Compose canaries and developer pilot. No shared volumes or .env.

Exit 0: complete technical acceptance; 1: measured failure; 2: blocked/partial.
Phase 1 never launches formal execution without --formal-approved.
"""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('sprint1_patterns', ROOT / 'scripts/run-sprint1.py')
sprint1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sprint1)


def private_config(original, project, port, keys, clients, image_prefix=None, deadline_minutes=None):
    """Normalize resolved Compose, retaining service topology/resource limits."""
    config = copy.deepcopy(original)
    config['name'] = project
    for group in ('volumes', 'networks'):
        for entry in config.get(group, {}).values():
            if entry.get('external'):
                raise ValueError('external_resource_refused')
            entry.pop('name', None)
    for name, service in config['services'].items():
        service.pop('container_name', None)
        service.pop('ports', None)
        if 'build' in service:
            service['image'] = f'{image_prefix or project}-{name}'
        for volume in service.get('volumes', []):
            if volume.get('type') == 'bind' and volume.get('target') in ('/app/keys', '/keys'):
                volume['source'] = str(keys)
                volume['read_only'] = True
    gateway = config['services']['api-gateway']
    gateway['ports'] = [{'target': 4000, 'published': str(port), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
    gateway['environment'].update(EVALUATION_CLIENTS_ENABLED='true', EVALUATION_CLIENTS_PATH='/evaluation/clients.json')
    gateway.setdefault('volumes', []).append({'type': 'bind', 'source': str(clients),
                                              'target': '/evaluation/clients.json', 'read_only': True})
    if deadline_minutes is not None:
        if not isinstance(deadline_minutes, int) or not 1 <= deadline_minutes <= 1440:
            raise ValueError('invalid_evaluation_deadline')
        config['services']['examination-engine']['environment']['EXAM_DURATION_MINUTES'] = str(deadline_minutes)
    return config


def core_ready(report):
    groups = report.get('invariants', {}).get('groups')
    measured = groups is not None and all(value['failed'] == 0 and value['unmeasured'] == 0
                                         for group, value in groups.items() if group != 'MARKETPLACE')
    return measured and bool(report.get('results')) and len(report['results']) == report['dataset']['selected'] and all(
        r['lifecycleStatus'] == 'CONFORMANT' and not any(c['passed'] is False for c in r['checks'])
        for r in report['results'])


def configured_operators(resolved):
    gateway_env = resolved['services']['api-gateway']['environment']
    return {key: gateway_env[key] for key in ['ADMIN_CLIENT_ID', 'ADMIN_CLIENT_SECRET',
            'REVIEWER_1_CLIENT_ID', 'REVIEWER_1_CLIENT_SECRET', 'REVIEWER_2_CLIENT_ID', 'REVIEWER_2_CLIENT_SECRET']}


def requested_phases(mode, stop_after=None):
    if mode == 'formal':
        if stop_after is not None:
            raise ValueError('formal_mode_cannot_use_developer_stop')
        return ['formal']
    if mode != 'developer':
        raise ValueError('invalid_suite_mode')
    phases = ['canary', 'categories', 'developer']
    return phases[:phases.index(stop_after) + 1] if stop_after is not None else phases


def response_deadline(mode, developer_minutes):
    if mode == 'formal':
        return 60
    if mode != 'developer' or type(developer_minutes) is not int or not 1 <= developer_minutes <= 60:
        raise ValueError('invalid_developer_deadline')
    return developer_minutes


class Pilot:
    def __init__(self, mode='developer', port=0, developer_deadline_minutes=1, stop_after=None):
        self.mode = mode
        self.requested = requested_phases(mode, stop_after)
        self.deadline_minutes = response_deadline(mode, developer_deadline_minutes)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%Sz').lower()
        self.project = f'eduagentx-issue33-{stamp}-{os.getpid()}'
        self.output = ROOT / 'artifacts/issue-33' / self.project
        self.output.mkdir(parents=True, exist_ok=False)
        self.steps = []
        self.env = os.environ.copy()
        for line in (ROOT / '.env.example').read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                self.env.pop(line.split('=', 1)[0], None)
        self.env.pop('COMPOSE_FILE', None)
        self.env.pop('COMPOSE_PROJECT_NAME', None)
        self.env.pop('EVALUATION_CLIENTS_ENABLED', None)
        self.env.pop('EVALUATION_CLIENTS_PATH', None)
        self.env.update({key: secrets.token_hex(32) for key in sprint1.GENERATED_SECRETS})
        self.env.update(NODE_USE_ENV_PROXY='0', NO_PROXY='localhost,127.0.0.1', no_proxy='localhost,127.0.0.1',
                        E2E_PROJECT=self.project, E2E_DEADLINE_MINUTES=str(self.deadline_minutes))
        if not port:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
        self.port = port

    def command(self, args, timeout=1800, check=True):
        started = time.monotonic()
        try:
            result = subprocess.run(args, cwd=ROOT, env=self.env, capture_output=True, text=True,
                                    encoding='utf8', errors='replace', timeout=timeout)
        except (OSError, subprocess.TimeoutExpired):
            self.steps.append({'command': Path(args[0]).name, 'exitCode': None, 'status': 'UNAVAILABLE'})
            raise RuntimeError('command_unavailable') from None
        # Do not retain arbitrary stdout/stderr, resolved credentials or service
        # logs. Only the suite's allowlisted reports become evidence.
        step = {'command': Path(args[0]).name, 'exitCode': result.returncode,
                'durationMs': round((time.monotonic() - started) * 1000)}
        # Build/start diagnostics only; never service logs or arbitrary Node/test
        # output. Secrets from the private environment are redacted first.
        if result.returncode and Path(args[0]).name == 'docker':
            errors = []
            for line in (result.stderr + '\n' + result.stdout).splitlines():
                if not re.search(r'(?i)(error|failed|denied|unhealthy|not found|no such|invalid|cannot)', line):
                    continue
                for key in sprint1.GENERATED_SECRETS:
                    line = line.replace(self.env[key], '[REDACTED]')
                line = re.sub(r'://[^/@\s]+:[^/@\s]+@', '://[REDACTED]@', line)
                line = re.sub(r'([?&](?:token|key|secret|password)=)[^&\s]+', r'\1[REDACTED]', line, flags=re.I)
                line = re.sub(r'(https?://[^\s?]+)\?[^\s]+', r'\1?[REDACTED]', line)
                if not re.search(r'(?i)(authorization|BEGIN .*KEY|eyJ\w+\.)', line):
                    errors.append(line[:1000])
            step['diagnostic'] = errors[-8:]
            for line in step['diagnostic']:
                print(line, flush=True)
        self.steps.append(step)
        if check and result.returncode:
            raise RuntimeError('command_failed')
        return result

    def blocked(self, code, mode):
        directory = self.output / mode
        if directory.exists():
            directory = self.output / f'blocked-{code}'
        self.env['E2E_OUTPUT_DIR'] = str(directory)
        self.command(['node', 'packages/e2e-suite/run.js', '--mode', mode, '--blocked', code], check=False)

    def run(self):
        phases = []
        active = None
        failed_mode = self.requested[0]
        try:
            self.command(['docker', 'info', '--format', '{{.ServerVersion}}'], timeout=30)
        except RuntimeError:
            self.blocked('docker_unavailable', failed_mode)
            phases = [{'mode': p, 'status': 'NOT_RUN', 'reason': 'docker_unavailable'} for p in self.requested]
            self.finish(phases)
            return 2
        with tempfile.TemporaryDirectory(prefix=self.project + '-') as temporary:
            temporary = Path(temporary)
            keys = temporary / 'keys'
            keys.mkdir()
            clients = temporary / 'clients.json'
            self.command(['node', 'packages/e2e-suite/run.js', '--provision', str(clients)])
            self.env['E2E_CLIENTS_PATH'] = str(clients)
            self.env['E2E_GATEWAY_URL'] = f'http://127.0.0.1:{self.port}'
            # Keys exist ONLY in this private temporary directory, never images.
            self.command(['node', '-e', '''const fs=require('node:fs'),c=require('node:crypto'),p=require('node:path');
const d=process.argv[1];
for(const [kind,name,options] of [['rsa','dev-jwt',{modulusLength:2048}],['ed25519','certification-ed25519',{}]]){
 const pair=c.generateKeyPairSync(kind,options);
 fs.writeFileSync(p.join(d,name+'-private.pem'),pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 fs.writeFileSync(p.join(d,name+'-public.pem'),pair.publicKey.export({type:'spki',format:'pem'}),{mode:0o644});
}''', str(keys)])
            try:
                resolved = json.loads(self.command(['docker', 'compose', '--env-file', str(ROOT / '.env.example'),
                                                     'config', '--format', 'json']).stdout)
                # Operator identities must match the resolved private Gateway,
                # not the caller's .env (which this runner deliberately ignores).
                self.env.update(configured_operators(resolved))
                requested = self.requested
                for index, mode in enumerate(requested):
                    failed_mode = mode
                    project = f'{self.project}-{mode}'
                    config = private_config(resolved, project, self.port, keys, clients, self.project, self.deadline_minutes)
                    config_path = temporary / f'{mode}.json'
                    encoded = json.dumps(config)
                    config_path.write_text(encoded)
                    config_path.chmod(0o600)
                    self.env['E2E_CONFIG_HASH'] = 'sha256:' + hashlib.sha256(encoded.encode()).hexdigest()
                    self.env['E2E_PROJECT'] = project
                    dc = ['docker', 'compose', '-p', project, '-f', str(config_path)]
                    active = dc
                    print(f'Starting isolated {mode}: {project}', flush=True)
                    self.command(dc + ['up', '-d', '--build' if index == 0 else '--no-build', '--wait', '--wait-timeout', '180'])
                    images = self.command(dc + ['images', '--format', 'json']).stdout
                    self.env['E2E_IMAGE_HASH'] = 'sha256:' + hashlib.sha256(images.encode()).hexdigest()
                    self.env['E2E_OUTPUT_DIR'] = str(self.output / mode)
                    result = self.command(['node', 'packages/e2e-suite/run.js', '--mode', mode], timeout=21600, check=False)
                    report = json.loads((self.output / mode / 'report.json').read_text())
                    ready = core_ready(report)
                    phases.append({'mode': mode, 'technicalChecks': report['technicalChecks'], 'coreReady': ready,
                                   'executed': report['executed'], 'lifecycleConformant': report['lifecycleConformant'],
                                   'runErrors': report.get('runErrors', []), 'failuresByReason': report['failuresByReason'],
                                   'exitCode': result.returncode})
                    print(json.dumps(phases[-1]), flush=True)
                    self.command(dc + ['down', '--volumes', '--remove-orphans'])
                    active = None
                    if not ready:
                        phases.extend({'mode': p, 'status': 'NOT_RUN', 'reason': 'earlier_canary_not_conformant'}
                                      for p in requested[index + 1:])
                        break
            except (RuntimeError, ValueError, KeyError, OSError):
                self.blocked('compose_build_or_execution_unavailable', failed_mode)
                phases.append({'mode': failed_mode, 'status': 'BLOCKED', 'reason': 'compose_build_or_execution_unavailable'})
            finally:
                if active:
                    self.command(active + ['down', '--volumes', '--remove-orphans'], check=False)
        self.finish(phases)
        if any(p.get('technicalChecks') == 'FAIL' for p in phases):
            return 1
        return 2  # Phase 1 cannot declare the unexecuted full golden/load gate passed.

    def finish(self, phases):
        (self.output / 'phases.json').write_text(json.dumps({'schemaVersion': '1.0.0', 'phases': phases,
                                                           'formal1000': 'NOT_RUN' if self.mode != 'formal' else 'REQUESTED'}, indent=2) + '\n')
        (self.output / 'runner-steps.json').write_text(json.dumps(self.steps, indent=2) + '\n')
        print(f'Evidence: {self.output}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['developer', 'formal'], default='developer')
    parser.add_argument('--formal-approved', action='store_true')
    parser.add_argument('--stop-after', choices=['canary', 'categories', 'developer'],
                        help='developer-only bounded validation; does not alter frozen scenarios')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--developer-deadline-minutes', type=int, default=1,
                        help='existing Examination duration setting, pilot only; formal remains 60 minutes')
    args = parser.parse_args()
    if args.mode == 'formal' and not args.formal_approved:
        parser.error('formal execution requires separate pilot review and --formal-approved')
    if args.mode == 'formal' and args.stop_after is not None:
        parser.error('--stop-after is only available in developer mode')
    if args.port and not 1024 <= args.port <= 65535:
        parser.error('port must be 1024..65535')
    if not 1 <= args.developer_deadline_minutes <= 60:
        parser.error('developer deadline must be 1..60 minutes')
    return Pilot(args.mode, args.port, args.developer_deadline_minutes, args.stop_after).run()


if __name__ == '__main__':
    sys.exit(main())
