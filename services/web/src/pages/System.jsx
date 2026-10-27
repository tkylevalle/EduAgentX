import { PageHead, Panel, Skeleton } from '../ui.jsx';

const LAYERS = [
  ['edge', 'Edge', 'Auth, roles, rate limits'],
  ['identity', 'Identity', 'Who the agent is'],
  ['learner', 'Learner', 'External protocol'],
  ['curriculum', 'Curriculum', 'What is taught'],
  ['training', 'Training', 'Delivery and practice'],
  ['assessment', 'Assessment', 'Exam and grading'],
  ['trust', 'Trust', 'Decisions and credentials'],
  ['operations', 'Operations', 'Observe and export'],
  ['marketplace', 'Marketplace', 'Who can be hired'],
];

export default function System({ health }) {
  return (
    <main className="page">
      <PageHead index="06" title="System map" sub="Each service owns its data. Joined by the API Gateway, a schema per owner, and Redis Streams."
        readouts={[['Services', health ? `${health.filter((s) => s.healthy).length}/${health.length} up` : null],
          ['Slowest', health?.length ? `${Math.max(...health.map((s) => s.latencyMs || 0))} ms` : null]]} />
      <Panel title="Services by layer" action={<span className="label">#n = GitHub issue that built it</span>} flush>
        {!health ? <div className="panel-body"><Skeleton height={300} /></div> : (
          <div className="layers">
            {LAYERS.map(([id, name, sub]) => {
              const services = health.filter((service) => service.layer === id);
              if (!services.length) return null;
              return (
                <div className="layer" key={id}>
                  <div className="layer-name">{name}<small>{sub}</small></div>
                  <div className="svc-row">
                    {services.map((service) => (
                      <div className={`svc ${service.healthy ? '' : 'down'}`} key={service.id}>
                        <div className="svc-head"><span className={`dot ${service.healthy ? 'ok' : 'bad'}`} />{service.name}</div>
                        <div className="svc-meta"><code>{service.id}</code><span>#{service.issue}</span></div>
                        <div className="svc-meta"><span>{service.healthy ? 'healthy' : 'unreachable'}</span><span>{service.latencyMs != null ? `${service.latencyMs} ms` : '—'}</span></div>
                        <div className="svc-latency" title="Health probe latency, 0–50 ms"><span style={{ width: `${Math.min(100, ((service.latencyMs || 0) / 50) * 100)}%`,
                          background: service.healthy ? undefined : 'var(--danger)' }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </main>
  );
}
