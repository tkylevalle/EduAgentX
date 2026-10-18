import { useEffect, useState } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';
import { Empty, Panel, Pill, ScoreBars, Skeleton } from '../ui.jsx';
import { api, ago, EVENT_COPY, pct, short } from '../lib.js';

const POSTURE_TONE = { VERIFIED: 'ok', SUSPENDED: 'warn', REVOKED: 'bad', UNVERIFIED: 'info', INDETERMINATE: '' };

export default function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => api('/api/overview').then((next) => { if (alive) { setData(next); setError(null); } })
      .catch((reason) => alive && setError(reason.message));
    load();
    const timer = setInterval(load, 10000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const credentials = Array.isArray(data?.certifications) ? data.certifications : [];
  const latest = credentials[0];
  const agents = new Set(credentials.map((credential) => credential.agentLearnerKey));
  const healthy = data?.services?.filter((service) => service.healthy).length;
  const kpi = data?.issuanceKpi;
  const pkg = data?.package;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Assurance, <em>with evidence</em></h1>
          <p className="page-lede">Every number on this page is read live from the platform: certification decisions, credential status,
            training completion and service health. Nothing here is illustrative.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => { window.location.hash = '/lab'; }}>
          <FlaskConical size={17} /> Run a lifecycle
        </button>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: 18 }}>Overview unavailable: {error}. The page retries every 10 seconds.</div>}

      <div className="ledger" aria-label="Platform facts">
        <Fact label="Certified agents" value={data ? agents.size : null} foot={`${credentials.length} credential${credentials.length === 1 ? '' : 's'} issued`} />
        <Fact label="Issuance latency p95" value={kpi?.sampleCount ? kpi.p95Ms : data ? '—' : null} unit={kpi?.sampleCount ? 'ms' : ''}
          foot={kpi?.sampleCount ? `Target ${kpi.targetMs} ms · ${kpi.targetMet ? 'met' : 'not met'}` : 'No samples yet'} />
        <Fact label="Training completion" value={data?.training?.completionRate != null ? pct(data.training.completionRate * 100) : data ? '—' : null}
          foot={data?.training?.counts ? `${data.training.counts.completed} of ${data.training.sessions} sessions` : ' '} />
        <Fact label="Active package" value={pkg ? `v${pkg.version}` : data ? 'None' : null}
          foot={pkg ? `${pkg.modules.length} modules · ${pkg.gates.filter((gate) => gate.passed).length}/6 gates` : 'Run a lifecycle to activate'} />
        <Fact label="Services healthy" value={data ? `${healthy}/${data.services.length}` : null} foot="Probed every 10 s" />
      </div>

      <div className="grid cols-main">
        <div className="stack">
          <Panel title="Latest certification" note={latest ? `Decided ${ago(latest.decision?.decidedAt)}` : 'Certification Decisions come only from a passed, graded examination'}
            action={latest && <Pill tone="ok" dot>certified</Pill>}>
            {!data ? <Skeleton height={140} /> : !latest ? (
              <Empty title="No credential yet">Run the Lifecycle Lab to take an agent from registration to a signed credential.</Empty>
            ) : (
              <div className="grid cols-2" style={{ gap: 28 }}>
                <dl className="kv" style={{ gridTemplateColumns: '108px 1fr' }}>
                  <dt>Agent</dt><dd><code>{latest.agentLearnerKey}</code></dd>
                  <dt>Credential</dt><dd><code>{short(latest.credentialId, 13, 6)}</code></dd>
                  <dt>Examination</dt><dd><code>{short(latest.examinationId, 13, 6)}</code></dd>
                  <dt>Package</dt><dd><code>{latest.packageId}</code></dd>
                  <dt>Mode</dt><dd>{latest.mode === 'fallback' ? 'Deterministic fallback' : 'Standard examination'}</dd>
                </dl>
                <ScoreBars tierPercents={latest.tierPercents} overallPercent={latest.overallPercent}
                  overallPass={pkg?.exam?.overallPassPercent ?? 80} adversarialPass={pkg?.exam?.adversarialPassPercent ?? 70} />
              </div>
            )}
          </Panel>

          <Panel title="Credentials" note="Signed by certification-service, checked by credential-verification" flush
            action={<button className="btn btn-ghost" onClick={() => { window.location.hash = '/credentials'; }}>All credentials <ArrowRight size={15} /></button>}>
            {!data ? <div className="panel-body"><Skeleton height={90} /></div> : credentials.length === 0 ? (
              <Empty title="Nothing issued yet">Credentials appear here as soon as the certification sweep issues them.</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>Credential</th><th>Agent</th><th className="hide-sm">Overall</th><th className="hide-sm">Adversarial</th><th>Issued</th></tr></thead>
                <tbody>
                  {credentials.slice(0, 6).map((credential) => (
                    <tr key={credential.credentialId} className="clickable" onClick={() => { window.location.hash = `/credentials/${credential.credentialId}`; }}>
                      <td><code>{short(credential.credentialId, 8, 4)}</code></td>
                      <td>{credential.agentLearnerKey}</td>
                      <td className="hide-sm data">{pct(credential.overallPercent)}</td>
                      <td className="hide-sm data">{pct(credential.tierPercents?.adversarial)}</td>
                      <td className="faint">{ago(credential.issuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Assurance posture" note="Monitoring projection, per Agent Learner" flush>
            {!data ? <div className="panel-body"><Skeleton height={60} /></div> : !Array.isArray(data.posture) || data.posture.length === 0 ? (
              <Empty title="No agents observed">Posture appears after an agent starts training.</Empty>
            ) : (
              <ul className="feed">
                {data.posture.map((agent) => (
                  <li key={agent.agentId}>
                    <span className={`dot ${POSTURE_TONE[agent.assurancePosture] || ''}`} />
                    <div><code>{agent.agentId}</code><div className="faint" style={{ fontSize: 12 }}>{EVENT_COPY[agent.lastEvent?.type]?.[0] || agent.lastEvent?.type}</div></div>
                    <Pill tone={POSTURE_TONE[agent.assurancePosture]}>{agent.assurancePosture.toLowerCase()}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity" note="Domain events received by monitoring-service" flush>
            {!data ? <div className="panel-body"><Skeleton height={160} /></div> : data.events.length === 0 ? (
              <Empty title="Quiet so far">Events stream in as agents train and credentials change status.</Empty>
            ) : (
              <ul className="feed" style={{ maxHeight: 420, overflow: 'auto' }}>
                {data.events.map((event, index) => {
                  const [copy, tone] = EVENT_COPY[event.type] || [event.type, ''];
                  return (
                    <li key={`${event.receivedAt}-${index}`}>
                      <span className={`dot ${tone}`} />
                      <div>
                        <div>{copy}</div>
                        <div className="faint" style={{ fontSize: 12 }}>{event.agentId} · {event.source || 'platform'}</div>
                      </div>
                      <span className="faint" style={{ fontSize: 12 }}>{ago(event.receivedAt)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}

function Fact({ label, value, unit, foot }) {
  return (
    <div className="ledger-cell">
      <div className="label">{label}</div>
      <div className="ledger-value">{value === null ? <Skeleton height={30} width="60%" /> : <>{value}{unit && <small>{unit}</small>}</>}</div>
      <div className="ledger-foot">{foot}</div>
    </div>
  );
}
