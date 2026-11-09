#!/usr/bin/env python3
"""Run Issue 34 against a fresh isolated stack and retain sanitized evidence."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import socket
import secrets
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sprint1_runner', ROOT / 'scripts/run-sprint1.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--keep-stack', action='store_true', help='Keep this isolated stack for diagnosis')
    args = parser.parse_args()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    run = module.EvidenceRun(argparse.Namespace(port=port, samples=20))
    print('Evidence directory: ' + str(run.out), flush=True)
    run.command(['node', 'scripts/setup-dev.js'], 'key-setup.txt')
    run.record_versions()
    (ROOT / 'tmp').mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='hero-stack-', dir=ROOT / 'tmp') as temporary:
        try:
            run.prepare_compose_project(temporary)
            # Explicit platform-controlled simulation identities for comparing several real candidates.
            principals = [{'subject': 'synthetic-executor-dev', 'evidenceMode': 'synthetic',
                           'sources': ['synthetic:competent:safe-escalation']}]
            for slot, subject in [('LIVE_AGENT', 'hero-near-match-a-dev'), ('REPLAY_AGENT', 'hero-near-match-b-dev')]:
                password = secrets.token_hex(32)
                run.secrets.append(password)
                run.gateway_env[slot + '_CLIENT_ID'] = subject
                run.gateway_env[slot + '_CLIENT_SECRET'] = password
                principals.append({'subject': subject, 'evidenceMode': 'synthetic',
                                   'sources': ['synthetic:competent:safe-escalation']})
            for name in ['api-gateway', 'training-service']:
                run.config['services'][name]['environment']['EXECUTION_PRINCIPALS'] = json.dumps(principals)
            exposed = {'synthetic-agent-learner': 4200, 'validation-activation': 4010,
                       'certification-service': 4011, 'training-service': 4004}
            for service, target in exposed.items():
                run.config['services'][service]['ports'] = [
                    {'target': target, 'published': '0', 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
            run.write_config()
            (run.out / 'environment.json').write_text(json.dumps({
                'project': run.project, 'gitCommit': run.report['git_commit'],
                'versions': run.report['versions'], 'sourceSha256': module.source_hash(),
                'configurationSha256': run.report['compose_configuration_sha256'],
                'simulationPrincipals': principals,
                'issuer': run.config['services']['certification-service']['environment']['CERTIFICATION_ISSUER'],
                'keyId': run.config['services']['certification-service']['environment']['CERTIFICATION_KEY_ID'],
                'isolation': 'Fresh Compose project, volumes and random loopback ports',
                'credentialMaterial': 'Private temporary configuration and ignored checkout-local test keys'
            }, indent=2), encoding='utf-8')
            services = ['api-gateway', 'synthetic-agent-learner', 'validation-activation', 'training-service',
                        'examination-engine', 'certification-service', 'marketplace-service',
                        'credential-verification', 'monitoring-service', 'skill-gap-service', 'grading-service']
            print('Building and starting isolated lifecycle stack...', flush=True)
            run.command(run.compose + ['up', '-d', '--build', '--wait', '--wait-timeout', '180'] + services,
                        'compose-build.txt')
            urls = {'gatewayUrl': run.base}
            names = {'synthetic-agent-learner': 'syntheticUrl', 'validation-activation': 'validationUrl',
                     'certification-service': 'certificationUrl', 'training-service': 'trainingUrl'}
            for service, target in exposed.items():
                address = run.dc('port', service, str(target)).stdout.strip().splitlines()[-1]
                urls[names[service]] = 'http://' + address
            private = Path(temporary) / 'runner.json'
            private.write_text(json.dumps({'urls': urls, 'environment': run.config['services']['api-gateway']['environment'],
                'compose': run.compose, 'project': run.project, 'out': str(run.out),
                'issuerKeyId': run.config['services']['certification-service']['environment']['CERTIFICATION_KEY_ID'],
                'gitCommit': run.report['git_commit'], 'sourceSha256': module.source_hash()}), encoding='utf-8')
            os.chmod(private, 0o600)
            print('Executing hero scenarios...', flush=True)
            result = run.command(['node', 'scripts/hero-stack.js', str(private)], 'hero-run.txt', check=False)
            print(run.redact(result.stdout), flush=True)
            if result.returncode and not (run.out / 'summary.json').exists():
                raise RuntimeError('Hero runner failed; see hero-run.txt')
        except Exception as error:
            (run.out / 'execution-error.json').write_text(json.dumps({'error': run.redact(str(error))}), encoding='utf-8')
            raise
        finally:
            if run.compose:
                logs = run.dc('logs', '--no-color', check=False)
                (run.out / 'compose-logs.txt').write_text(run.redact(logs.stdout + logs.stderr), encoding='utf-8')
                (run.out / 'images.json').write_text(run.dc('images', '--format', 'json', check=False).stdout, encoding='utf-8')
                if not args.keep_stack:
                    result = run.dc('down', '--volumes', '--remove-orphans', check=False)
                    (run.out / 'cleanup.json').write_text(json.dumps({'project': run.project, 'exitCode': result.returncode}), encoding='utf-8')


if __name__ == '__main__':
    main()
