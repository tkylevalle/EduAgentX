#!/usr/bin/env python3
"""Supporting PostgreSQL checks in five NEW disposable databases; not black-box evidence."""
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]


def main():
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dt%H%M%Sz').lower()
    name = f'eduagentx-issue33-pg-{stamp}-{os.getpid()}'
    out = ROOT / 'artifacts/issue-33' / name
    out.mkdir(parents=True)
    env = os.environ.copy()
    password = secrets.token_hex(32)
    env['POSTGRES_PASSWORD'] = password
    checks = []
    created = False

    def call(args, check=True, timeout=120):
        result = subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, timeout=timeout)
        if check and result.returncode:
            raise RuntimeError('postgres_verification_command_unavailable')
        return result

    try:
        call(['docker', 'info', '--format', '{{.ServerVersion}}'])
        call(['docker', 'run', '-d', '--name', name, '-e', 'POSTGRES_PASSWORD',
              '-p', '127.0.0.1::5432', 'postgres:16-alpine'], timeout=300)
        created = True
        for _ in range(60):
            if call(['docker', 'exec', name, 'pg_isready', '-U', 'postgres'], check=False).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError('postgres_readiness_timeout')
        port = call(['docker', 'port', name, '5432']).stdout.strip().rsplit(':', 1)[1]
        for service, variable, schema in [
            ('examination-engine', 'EXAMINATION_TEST_DATABASE_URL', 'examination_engine'),
            ('certification-service', 'CERTIFICATION_TEST_DATABASE_URL', 'certification_engine'),
            ('marketplace-service', 'MARKETPLACE_TEST_DATABASE_URL', 'marketplace_service'),
            ('skill-gap-service', 'SKILL_GAP_TEST_DATABASE_URL', None),
            ('training-service', 'TRAINING_TEST_DATABASE_URL', 'training_service'),
        ]:
            database = 'issue33_' + service.replace('-', '_')
            call(['docker', 'exec', name, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE DATABASE {database}'])
            if schema:
                call(['docker', 'exec', name, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE SCHEMA {schema}'])
            env[variable] = f'postgres://postgres:{password}@127.0.0.1:{port}/{database}'
            files = [f'services/{service}/integration/' + ('provenance-postgres.test.js' if service == 'training-service' else 'postgres.test.js')]
            result = call(['node', '--test', '--test-reporter=tap', *files], check=False, timeout=180)
            text = result.stdout + '\n' + result.stderr

            def count(key):
                found = re.search(r'^# ' + key + r' (\d+)$', text, re.M)
                return int(found.group(1)) if found else 0

            record = {'name': service, 'exitCode': result.returncode, 'tests': count('tests'), 'passed': count('pass'),
                      'failed': count('fail'), 'skipped': count('skipped'), 'cancelled': count('cancelled')}
            record['status'] = 'PASS' if result.returncode == 0 and count('tests') > 0 and count('pass') == count('tests') and not count('skipped') else 'FAIL'
            checks.append(record)
            # Do not retain connection strings, raw answers or assertion bodies.
            print(json.dumps(record), flush=True)
            if record['status'] == 'FAIL':
                print('\n'.join(line for line in text.splitlines() if line.startswith('not ok ')), flush=True)
    except (RuntimeError, OSError, subprocess.TimeoutExpired):
        checks.append({'name': 'infrastructure', 'status': 'NOT_RUN', 'reason': 'isolated_postgres_unavailable'})
    finally:
        cleanup = not created or call(['docker', 'rm', '-f', '-v', name], check=False).returncode == 0
    report = {'schemaVersion': 'issue-33-postgres-verification/1.0.0',
              'scope': 'Real PostgreSQL store/route checks; fixture authorities are not formal acceptance.',
              'sourceGitSha': call(['git', 'rev-parse', 'HEAD']).stdout.strip(), 'checks': checks, 'cleanup': cleanup,
              'status': 'FAIL' if not cleanup or any(c['status'] == 'FAIL' for c in checks) else
                        'PASS' if len(checks) == 5 and all(c['status'] == 'PASS' for c in checks) else 'BLOCKED'}
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'PostgreSQL verification: {report["status"]}; {out}')
    return 0 if report['status'] == 'PASS' else 1 if report['status'] == 'FAIL' else 2


if __name__ == '__main__':
    sys.exit(main())
