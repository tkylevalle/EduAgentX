"""Controlled faults in an invocation-owned Compose project; observations use the public API."""
import json
import time


def verify(*, dc, config, write_config, http, token, message, client, secret, require, wait_health):
    agent_token = token(client, secret)
    gateway = config['services']['api-gateway']['environment']
    admin = token(gateway['ADMIN_CLIENT_ID'], gateway['ADMIN_CLIENT_SECRET'])
    registry_env = config['services']['agent-registry']['environment']
    stream = 'agent-registry.assurance'
    group = 'registry-audit-v1'

    def redis(*args):
        return json.loads(dc('exec', '-T', 'redis', 'redis-cli', '--json', *args).stdout)

    def delivery():
        status, data, _ = http('/v1/admin/event-delivery', token=admin)
        require(status == 200, 'Delivery evidence unavailable')
        return data['delivery']

    def await_delivery(predicate, description):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = delivery()
            if predicate(state):
                return state
            time.sleep(.3)
        raise RuntimeError(description)

    def submit(ident):
        body = message(client, ident)
        body['payload']['model']['version'] = ident
        status, result, _ = http('/v1/agent-learner/registrations', body, agent_token, ident)
        require(status == 200, 'Configuration change rejected')
        return body, result

    before = await_delivery(lambda s: s['pending'] == 0 and s['waiting'] == 0 and s['applied'] == s['total'], 'Initial delivery did not drain')
    # Reapplying the upgrade path to populated storage must preserve its records.
    dc('exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/002_registry_role.sh')
    require(delivery() == before, 'Role migration changed existing delivery evidence')
    # Pause only consumption. Registrations and outbox publication remain live.
    registry_env['REGISTRY_CONSUMER_ENABLED'] = 'false'
    write_config()
    dc('up', '-d', '--no-deps', '--force-recreate', '--wait', 'agent-registry')
    first_message, first = submit('stream-order-first')
    _, second = submit('stream-order-second')
    ids = {first['assurance']['eventId'], second['assurance']['eventId']}
    entries = redis('XRANGE', stream, '-', '+')
    selected = []
    for stream_id, fields in entries:
        fields = dict(zip(fields[::2], fields[1::2]))
        envelope = json.loads(fields['envelope'])
        if envelope['eventId'] in ids:
            selected.append((stream_id, envelope))
    require(len(selected) == 2, 'Versioned outbox events missing')
    selected.sort(key=lambda item: item[1]['sequence'])
    require(selected[1][1]['sequence'] == selected[0][1]['sequence'] + 1, 'Non-contiguous event sequence')
    require(all(e['schemaVersion'] == '1.0.0' and e['aggregateId'] == first['registration']['agentLearnerId']
                and e['causationId'] and e['correlationId'] for _, e in selected), 'Missing event envelope identity')
    # Remove only this test's two stream entries, then deliver the successor first.
    redis('XDEL', stream, *[item[0] for item in selected])
    redis('XADD', stream, '*', 'envelope', json.dumps(selected[1][1]))
    registry_env['REGISTRY_CONSUMER_ENABLED'] = 'true'
    write_config()
    dc('up', '-d', '--no-deps', '--force-recreate', '--wait', 'agent-registry')
    gap = await_delivery(lambda s: s['waiting'] == 1, 'Out-of-order successor was not held')
    require(gap['applied'] == before['applied'], 'Sequence gap changed the projection')
    # Another identity can still progress while the first aggregate has a gap.
    gateway['AGENT_CLIENT_ID'] = 'unrelated-recovery-agent'
    write_config()
    dc('up', '-d', '--no-deps', '--force-recreate', '--wait', 'api-gateway')
    wait_health()
    other_token = token('unrelated-recovery-agent', secret)
    other = message('unrelated-recovery-agent', 'unrelated-during-gap')
    require(http('/v1/agent-learner/registrations', other, other_token, other['correlationId'])[0] == 201,
            'Unrelated registration blocked by sequence gap')
    await_delivery(lambda s: s['waiting'] == 1 and s['applied'] == before['applied'] + 1,
                   'Unrelated aggregate blocked by sequence gap')
    gateway['AGENT_CLIENT_ID'] = client
    write_config()

    # Leave entries in the PEL owned by a dead consumer. Restart must reclaim,
    # apply the missing predecessor and successor once, and quarantine poison.
    dc('stop', 'agent-registry')
    for _ in range(2):
        redis('XADD', stream, '*', 'envelope', json.dumps(selected[0][1]))
    redis('XADD', stream, '*', 'envelope', '{"eventId":"------------------------------------"}')
    claimed = redis('XREADGROUP', 'GROUP', group, 'interrupted-test-consumer', 'COUNT', '10', 'STREAMS', stream, '>')
    require(bool(claimed), 'No pending work was created for interruption')
    started = time.monotonic()
    dc('start', 'agent-registry')
    wait_health()
    recovered = await_delivery(lambda s: s['waiting'] == 0 and s['applied'] == before['applied'] + 3
                               and s['quarantined'] == before['quarantined'] + 1, 'Consumer recovery lost or duplicated effects')
    recovery_ms = (time.monotonic() - started) * 1000
    while redis('XPENDING', stream, group)[0] != 0 and time.monotonic() - started < 120:
        time.sleep(.1)
    require(redis('XPENDING', stream, group)[0] == 0, 'Pending Redis work was not acknowledged')
    recovery_ms = (time.monotonic() - started) * 1000
    require(recovery_ms <= 120000, 'Consumer recovery exceeded 120 seconds')
    # The first request now refers to an older configuration. A restarted
    # gateway must replay it without reverting the newer authoritative state.
    dc('restart', 'api-gateway')
    wait_health()
    altered = json.loads(json.dumps(first_message))
    altered['payload']['model']['version'] = 'conflicting-content'
    require(http('/v1/agent-learner/registrations', altered, agent_token, altered['correlationId'])[0] == 409,
            'Durable idempotency conflict accepted after restart')
    status, replay, _ = http('/v1/agent-learner/registrations', first_message, agent_token, first_message['correlationId'])
    require(status == 200 and replay == first, 'Old request replay changed after restart')
    _, current, _ = http('/v1/registrations?agentLearnerKey=' + client, token=agent_token)
    require(current['registration']['configurationVersion'] == second['registration']['configurationVersion'],
            'Old request replay reverted a later configuration')
    require(http('/v1/agent-learner/registrations', altered, agent_token, altered['correlationId'])[0] == 409,
            'Durable idempotency conflict accepted')
    require(http('/v1/agent-learner/registrations', first_message, agent_token, first_message['correlationId'])[1] == first,
            'Conflict poisoned the original request key')

    # Outbox retry is independent of the client's retry. Redis loss must not
    # drop a committed registration event, even after a Registry restart.
    baseline = delivery()
    dc('stop', 'redis')
    try:
        _, queued = submit('redis-outbox-recovery')
        require(queued['assurance']['publicationStatus'] == 'queued', 'Redis outage lost durable queue evidence')
    finally:
        dc('start', 'redis')
    dc('restart', 'agent-registry')
    wait_health()
    await_delivery(lambda s: s['pending'] == 0 and s['applied'] == baseline['applied'] + 1,
                   'Outbox did not recover a committed event')

    # Actual runtime credentials must be unable to create in another service schema.
    dc('exec', '-T', 'agent-registry', 'node', '-e', """
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{const c=await pool.connect();try {
 await c.query('BEGIN');
 const role=(await c.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user')).rows[0];
 if(role.rolsuper) throw Error('Registry uses superuser');
 try {await c.query('CREATE TABLE monitoring_service.forbidden_probe (id integer)'); throw Error('Cross-service write allowed');}
 catch(error){if(error.code!=='42501') throw error;}
 console.log('Restricted role rejects cross-service writes');
}finally{await c.query('ROLLBACK');c.release();await pool.end();}})().catch(()=>process.exit(1));
"""
    )
    return {'before': before, 'recovered': recovered, 'recovery_ms': recovery_ms,
            'consumer_recovery': True, 'poison_out_of_order': True, 'durable_idempotency': True,
            'outbox_recovery': True, 'service_owned_permissions': True}
