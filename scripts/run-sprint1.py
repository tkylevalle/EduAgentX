#!/usr/bin/env python3
"""One-command isolated Sprint 1 evidence runner. No production data or direct SQL writes."""
import argparse
import hashlib
import json
import math
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from sprint1_gate import evaluate

ROOT = Path(__file__).resolve().parents[1]
SERVICES = ['external-agent-protocol','agent-registry','api-gateway','assurance-console','synthetic-agent-learner']
def source_hash():
    digest=hashlib.sha256()
    paths=[]
    for directory in ['services','scripts','db','docs']:
        paths += [p for p in (ROOT/directory).rglob('*') if p.is_file()
                  and not {'node_modules','__pycache__'} & set(p.parts) and p.suffix not in ['.pem','.pyc']]
    paths += [ROOT/'docker-compose.yml', ROOT/'.env.example', ROOT/'Makefile', ROOT/'.dockerignore']
    paths = [p for p in paths if p.is_file()]
    for p in sorted(paths):
        digest.update(str(p.relative_to(ROOT)).encode()+b'\0'+p.read_bytes()+b'\0')
    return digest.hexdigest()

def require(condition, description):
    if not condition: raise RuntimeError(description)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=18080)
    parser.add_argument('--samples',type=int,default=20)
    parser.add_argument('--prerequisites',type=Path)
    parser.add_argument('--review',type=Path)
    args=parser.parse_args()
    require(args.samples>=20,'At least 20 samples required')
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    project='eduagentx-evidence-'+stamp.lower()+'-'+str(os.getpid())
    out=ROOT/'evidence'/'runs'/project
    out.mkdir(parents=True)
    report={'schemaVersion':1,'source_sha256':source_hash(),'timestamp':stamp,'project':project,
            'checks':{},'latency_ms':[], 'failure':None,
            'measurement':{'requested_samples':args.samples,'concurrency':1,'warmup':0,'percentile':'nearest_rank',
                'scope':'new registration through Gateway; restart/auth/precondition excluded',
                'environment':'simulation; Gateway recreated per sample; database remains running'}}
    checks=report['checks']
    base=f'http://127.0.0.1:{args.port}'
    canaries=['CANARY_'+stamp+'_BODY','CANARY_'+stamp+'_QUERY','CANARY_'+stamp+'_HEADER']
    correlation_ids=[]
    created_ids=set()
    secrets=[]
    config=None
    compose=None
    env=os.environ.copy()
    # Local HTTP tests must not traverse a machine-wide proxy.
    env['NODE_USE_ENV_PROXY']='0'
    env['NO_PROXY']=env['no_proxy']='localhost,127.0.0.1'
    os.environ['NO_PROXY']=os.environ['no_proxy']='localhost,127.0.0.1'
    # Ensure local shell overrides cannot affect the isolated test configuration.
    for line in (ROOT/'.env.example').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'): env.pop(line.split('=',1)[0],None)
    def command(argv, logname=None, check=True):
        result=subprocess.run(argv,cwd=ROOT,env=env,text=True,capture_output=True,timeout=600)
        if logname: (out/logname).write_text(result.stdout+result.stderr)
        if check and result.returncode:
            raise RuntimeError('Command failed: '+ ' '.join(argv[:4]) + ('; see '+logname if logname else ''))
        return result
    def dc(*argv,check=True): return command(compose+list(argv),check=check)
    def http(path, body=None, token=None, correlation='health-check', raw=None):
        headers={'Content-Type':'application/json','x-correlation-id':correlation,
                 'x-test-secret':canaries[2]}
        if token: headers['Authorization']='Bearer '+token
        data=raw if raw is not None else None if body is None else json.dumps(body).encode()
        req=Request(base+path,data=data,headers=headers)
        start=time.perf_counter()
        try:
            with urlopen(req,timeout=10) as response: status=response.status; result=json.load(response)
        except HTTPError as error:
            status=error.code;result=json.load(error);error.close()
        return status,result,(time.perf_counter()-start)*1000
    def wait_health(expected=200):
        end=time.monotonic()+45
        while time.monotonic()<end:
            try:
                status,data,_=http('/health')
                if status==expected:return data
            except (URLError,TimeoutError):pass
            time.sleep(.5)
        raise RuntimeError('Health did not reach '+str(expected))
    def token(client,secret):
        status,data,_=http('/v1/auth/tokens',{'clientId':client,'clientSecret':secret})
        require(status==200,'Token exchange failed')
        secrets.append(data['accessToken'])
        return data['accessToken']
    def message(client, ident):
        return {'protocol':'ExternalAgentLearner','protocolVersion':'1.0.0','messageType':'registration',
                'messageId':ident,'correlationId':ident,'idempotencyKey':ident,'timeoutMs':5000,
                'evidence':{'mode':'synthetic'},'payload':{'agentLearnerKey':client,
                'model':{'provider':'synthetic','version':'1.0.0'},
                'systemPromptHash':'sha256:'+canaries[0],'policyConfigurationHash':'sha256:synthetic-policy-v1',
                'adapterVersion':'synthetic-agent-learner-1.0.0','approvedToolManifest':[
                {'name':'knowledge.lookup','version':'1.0.0','permissions':['read']}]},
                'privatePrompt':canaries[0]}
    def read_registration(client,t):
        return http('/v1/registrations?agentLearnerKey='+client,token=t)
    def write_config():
        config_path.write_text(json.dumps(config))
        config_path.chmod(0o600)
    try:
        report['versions'] = {'platform': platform.platform(), 'python': platform.python_version()}
        for binary in ['docker','node','npm']:
            report['versions'][binary] = command([binary,'--version']).stdout.strip()
        report['versions']['openssl'] = command(['openssl','version']).stdout.strip()
        report['versions']['compose'] = command(['docker','compose','version']).stdout.strip()
        report['git_commit'] = command(['git','rev-parse','HEAD'], check=False).stdout.strip()
        report['versions']['api'] = 'v1'
        report['versions']['protocol'] = 'ExternalAgentLearner 1.0.0'
        command(['python3','-m','unittest','discover','-s','scripts','-p','test_sprint1_gate.py'],'gate-unit-tests.txt')
        command(['bash','scripts/generate-dev-keys.sh'],'key-setup.txt')
        for service in SERVICES:
            print('Component tests: '+service,flush=True)
            d=ROOT/'services'/service
            command(['npm','install','--ignore-scripts','--no-package-lock','--no-audit','--no-fund','--prefix',str(d)],service+'-install.txt')
            r=command(['node','--test','--test-reporter=tap',*map(str, sorted((d/'test').glob('*.test.js'))),
                       *map(str, sorted(d.glob('*.test.js')))],service+'-tests.tap')
            require(re.search(r'^# fail 0$',r.stdout,re.M) and re.search(r'^# tests [1-9][0-9]*$',r.stdout,re.M), 'Missing test summary')
            require(not re.search(r'^# (skipped|cancelled|todo) [1-9]',r.stdout,re.M),'Incomplete tests')
        checks['component_tests']=True
        report['component_versions'] = {}
        for service in SERVICES:
            result = command(['npm','ls','--json','--depth=0','--prefix',str(ROOT/'services'/service)])
            report['component_versions'][service] = json.loads(result.stdout)
        with tempfile.TemporaryDirectory(prefix=project+'-') as temporary:
            config_path=Path(temporary)/'compose.json'
            result=command(['docker','compose','--env-file',str(ROOT/'.env.example'),'config','--format','json'])
            config=json.loads(result.stdout)
            config['name']=project
            # Keep Docker's resolved paths; archive only a configuration digest, never credentials.
            report['compose_configuration_sha256'] = hashlib.sha256(result.stdout.encode()).hexdigest()
            for group in ['volumes','networks']:
                for obj in config.get(group,{}).values():obj.pop('name',None)
            for name,svc in config['services'].items():
                svc.pop('container_name',None)
                svc.pop('ports',None)
                if 'image' in svc and 'build' in svc:svc['image']=project+'-'+name
            config['services']['api-gateway']['ports']=[{'target':4000,'published':str(args.port),'host_ip':'127.0.0.1','protocol':'tcp'}]
            gateway_env=config['services']['api-gateway']['environment']
            secret=gateway_env['AGENT_CLIENT_SECRET']
            secrets.extend([secret,gateway_env['ADMIN_CLIENT_SECRET']])
            write_config()
            compose=['docker','compose','-p',project,'-f',str(config_path)]
            try:
                print('Building isolated environment (existing project is untouched)...',flush=True)
                command(compose+['up','-d','--build','--wait','--wait-timeout','120'],'compose-build.txt')
                health=wait_health()
                require(health.get('dependencies',{}).get('redis')=='ok','Redis health evidence missing')
                require(health.get('dependencies',{}).get('postgres')=='ok','Postgres health evidence missing')
                (out/'images.json').write_text(dc('images','--format','json').stdout)
                report['container_versions'] = {}
                for service in ['agent-registry','api-gateway']:
                    report['container_versions'][service] = json.loads(dc('exec','-T',service,'npm','ls','--json','--depth=0').stdout)
                demo=[]
                for i in range(args.samples):
                    print(f'New registration {i+1}/{args.samples}',flush=True)
                    client=f'evidence-{i:03d}'
                    gateway_env['AGENT_CLIENT_ID']=client
                    write_config()
                    dc('up','-d','--no-deps','--force-recreate','--wait','--wait-timeout','120','api-gateway')
                    t=token(client,secret)
                    require(read_registration(client,t)[0]==404,'Identity already exists')
                    ident=f'new-registration-{i:03d}'
                    msg=message(client,ident)
                    if i==0:
                        bad=message(client,'reject-before-create');bad['protocolVersion']='9.0.0'
                        require(http('/v1/agent-learner/registrations',bad,t,'reject-before-create')[0]==400,'Expected rejection')
                        require(read_registration(client,t)[0]==404,'Partial registration after rejection')
                        checks['fresh_rejection_no_partial']=True
                    status,data,elapsed=http('/v1/agent-learner/registrations?secret='+canaries[1],msg,t,ident)
                    reg=data.get('registration',{})
                    require(status==201 and data.get('outcome')=='registered' and reg.get('configurationVersion')==1,'Registration must create version 1')
                    require(reg.get('agentLearnerId') and reg['agentLearnerId'] not in created_ids,'Duplicate agent ID')
                    require(data.get('assurance',{}).get('publicationStatus')=='published','Stream publication missing')
                    created_ids.add(reg['agentLearnerId']);correlation_ids.append(ident)
                    report['latency_ms'].append(elapsed)
                    if i==0:
                        checks['fresh_registration']=True
                        (out/'first-registration.json').write_text(json.dumps(data,indent=2)+'\n')
                        created_state=read_registration(client,t)[1]['registration']
                        status2,replay,_=http('/v1/agent-learner/registrations',msg,t,ident)
                        require(status2==201 and replay==data,'Retry changed original result')
                        before=read_registration(client,t)[1]['registration']
                        require(before==created_state,'Retry mutated authoritative registration or history')
                        bad=message(client,'reject-after-create');bad['payload']['model']={}
                        require(http('/v1/agent-learner/registrations',bad,t,'reject-after-create')[0]==400,'Invalid request accepted')
                        after=read_registration(client,t)[1]['registration']
                        require(before==after,'State mutated after rejected request')
                        checks['idempotent_retry']=checks['rejection_unchanged']=True
                        demo=[{'scenario':'created','httpStatus':status,'agentLearnerId':reg['agentLearnerId'],'configurationVersion':1},
                              {'scenario':'retry','exact_response_equal':True}, {'scenario':'rejected','state_unchanged':True}]
                        dc('restart','agent-registry');wait_health()
                        require(read_registration(client,t)[1]['registration']==before,'Registration lost across restart')
                        checks['restart_identity_preserved']=True
                    last_t=t
                report['p95_ms']=sorted(report['latency_ms'])[math.ceil(.95*args.samples)-1]
                checks['latency']=report['p95_ms']<=3000
                report['target_met']=report['p95_ms']<=2000
                (out/'demonstration.json').write_text(json.dumps(demo,indent=2))
                # Verify dependency health failure and recovery through public Gateway only.
                for dependency in ['redis','postgres']:
                    print('Controlled dependency outage: '+dependency,flush=True)
                    dc('stop',dependency)
                    try:
                        wait_health(503)
                        checks[dependency+'_health_failure']=True
                        if dependency=='postgres':
                            fault=message(client,'postgres-outage')
                            status,_,_=http('/v1/agent-learner/registrations',fault,last_t,'postgres-outage')
                            require(status>=500,'Unavailable database must not return success')
                    finally:
                        dc('start',dependency)
                        wait_health()
                checks['dependency_recovery']=True
                require(http('/v1/agent-learner/registrations?secret='+canaries[1],token=canaries[2],raw=b'{}',correlation='bad-token')[0]==401,'Invalid auth accepted')
                require(http('/v1/agent-learner/registrations',raw=('{"privatePrompt":"'+canaries[0]+'",').encode(),correlation='bad-json')[0]==400,'Malformed JSON accepted')
                time.sleep(.5)
                logs=dc('logs','--no-color','api-gateway','agent-registry').stdout
                require(not any(value in logs for value in canaries+secrets),'Secret/canary found in logs')
                records=[]
                for line in logs.splitlines():
                    _,sep,raw=line.partition('|')
                    if sep:
                        try:records.append(json.loads(raw))
                        except ValueError:pass
                # Gateway containers are recreated for measurements: check the final sample.
                ident=correlation_ids[-1]
                for service in ['api-gateway','agent-registry']:
                    require(any(r.get('service')==service and r.get('correlationId')==ident and r.get('statusCode')==201 for r in records),'Missing correlated service trace')
                for dependency in ['postgres','redis']:
                    require(any(r.get('dependency')==dependency and r.get('correlationId')==ident for r in records),'Missing dependency telemetry')
                for ident,status in [('bad-token',401),('bad-json',400)]:
                    require(any(r.get('correlationId')==ident and r.get('statusCode')==status for r in records),'Missing rejection log')
                require(any(r.get('event')=='dependency_operation' and r.get('dependency')=='postgres' and r.get('outcome')=='error' for r in records),'Missing dependency failure telemetry')
                checks['redaction']=checks['correlation']=True
                (out/'telemetry.jsonl').write_text('\n'.join(json.dumps(r) for r in records)+'\n')
            finally:
                # This project and its volumes were created by this invocation only.
                result=dc('down','--volumes','--remove-orphans',check=False)
                checks['cleanup']=result.returncode==0
    except (Exception,KeyboardInterrupt) as error:
        report['failure']=type(error).__name__+': '+str(error)
        print('Run stopped: '+report['failure'],file=sys.stderr)
    finally:
        report['source_unchanged']=source_hash()==report['source_sha256']
        if not report['source_unchanged']:report['failure']='Source changed during run'
        report['artifacts'] = {str(p.relative_to(out)): hashlib.sha256(p.read_bytes()).hexdigest()
                               for p in out.rglob('*') if p.is_file() and p.name not in ['run.json','gate.json']}
        def record(path):return json.loads(path.read_text()) if path else None
        try: gate=evaluate(report,record(args.prerequisites),record(args.review),out)
        except Exception:gate={'status':'FAIL','errors':['Invalid review/prerequisite record']}
        (out/'run.json').write_text(json.dumps(report,indent=2)+'\n')
        (out/'gate.json').write_text(json.dumps(gate,indent=2)+'\n')
        print(json.dumps(gate,indent=2))
        print('Evidence: '+str(out))
    return 0 if gate['status']=='PASS' else 2 if gate['status']=='BLOCKED' else 1
if __name__=='__main__':sys.exit(main())
