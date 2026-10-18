import { Panel, Skeleton } from '../ui.jsx';

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
      <div className="page-head">
        <div>
          <h1 className="page-title">System <em>map</em></h1>
          <p className="page-lede">Fourteen services, each owning its own data, joined by the API Gateway, PostgreSQL schemas per owner and Redis Streams.
            Health is probed live from inside the platform network.</p>
        </div>
      </div>
      <Panel title="Services by layer" note="Issue numbers are the GitHub work packages that built each service" flush>
        {!health ? <div className="panel-body"><Skeleton height={300} /></div> : (
          <div className="layers" style={{ gap: 0 }}>
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
                        <div className="svc-meta"><span>{service.healthy ? 'healthy' : 'unreachable'}</span><span className="data">{service.latencyMs != null ? `${service.latencyMs} ms` : '—'}</span></div>
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
