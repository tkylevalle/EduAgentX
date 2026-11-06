import { useState } from 'react';
import { Ban, Gauge, RefreshCw, Store, TriangleAlert } from 'lucide-react';
import { PageHead, Panel, Pill } from '../ui.jsx';
import { api, pct, short, stamp } from '../lib.js';

// Only one domain is validated end to end. A request for any other string
// is a deliberate way to see the Unsupported Domain state honestly, not an error.
const SUPPORTED_DOMAIN = 'ai-agent-safety-secure-tool-use';
const MODES = ['standard', 'fallback'];

const DEFAULT_FORM = {
  title: 'Tool-use operator, standard track',
  domain: SUPPORTED_DOMAIN,
  requiredObjectiveIds: 'obj-tool-scoping, obj-secret-handling',
  preferredObjectiveIds: '',
  minOverallPercent: 80,
  minAdversarialPercent: 70,
  maxCredentialAgeDays: 90,
  allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation',
};

const parseIds = (value) => [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];

const COMPONENT_ROWS = [
  ['totalPerformance', 'Overall score'],
  ['adversarialPerformance', 'Adversarial score'],
  ['preferredCoverage', 'Preferred objectives'],
  ['credentialRecency', 'Credential recency'],
];

function Checks({ checks }) {
  return (
    <div className="chips">
      {checks.map((check) => (
        <span className={`chip ${check.passed ? '' : 'bad'}`} key={`${check.gate}:${check.tag}`} title={check.tag}>
          {check.passed ? '✓' : '✕'} {check.gate.replaceAll('_', ' ')}
        </span>
      ))}
    </div>
  );
}

function Components({ components }) {
  return (
    <table className="table" style={{ marginTop: 10 }}>
      <thead><tr><th>Score component</th><th>Weight</th><th>Points</th></tr></thead>
      <tbody>
        {COMPONENT_ROWS.map(([key, label]) => {
          const c = components[key];
          return <tr key={key}><td>{label}</td><td>{c.weight}</td><td className="num">{c.points.toFixed(2)}</td></tr>;
        })}
      </tbody>
    </table>
  );
}

function MatchCard({ item, near }) {
  return (
    <li className="ledger-cell" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 560 }}>#{item.rank} · <code>{short(item.agentLearnerKey, 10, 6)}</code></div>
          <div className="faint" style={{ fontSize: 12 }}>credential <code>{short(item.credentialId, 8, 4)}</code> · issued {stamp(item.issuedAt)}</div>
        </div>
        <Pill tone={near ? 'warn' : 'ok'}>{pct(item.matchScore)} match score</Pill>
      </div>
      <Components components={item.components} />
      <div style={{ marginTop: 10 }}>
        <div className="label">Satisfied requirements</div>
        <Checks checks={item.checks} />
      </div>
      {item.gaps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="label">Exact gaps ({item.gapCount})</div>
          <ul className="feed" style={{ margin: '4px 0 0' }}>
            {item.gaps.map((gap, index) => (
              <li key={index}><span className="dot warn" /><code className="faint" style={{ fontSize: 12 }}>{gap.code}{gap.objectiveId ? `: ${gap.objectiveId}` : ''}</code></li>
            ))}
          </ul>
        </div>
      )}
      <dl className="kv" style={{ gridTemplateColumns: '150px 1fr', fontSize: 12.5, marginTop: 10 }}>
        <dt>Evidence mode</dt><dd><code>{item.evidence.evidenceMode || '—'}</code> / <code>{item.evidence.environment || '—'}</code></dd>
        <dt>Assessment mode</dt><dd><code>{item.evidence.assessmentMode || '—'}</code></dd>
        <dt>Package</dt><dd><code>{item.evidence.package?.id}</code> v{item.evidence.package?.version}</dd>
        <dt>Checked</dt><dd>{stamp(item.evidence.checkedAt)}</dd>
      </dl>
    </li>
  );
}

function ExclusionRow({ item }) {
  return (
    <li>
      <span className="dot bad" />
      <div>
        <div><code>{short(item.agentLearnerKey || 'unknown', 10, 6)}</code> · credential <code>{short(item.credentialId || 'unknown', 8, 4)}</code></div>
        <div className="chips" style={{ marginTop: 4 }}>
          {item.reasons.map((reason, index) => (
            <span className={`chip ${reason.tag === 'trust' ? 'bad' : ''}`} key={index} title={`gate: ${reason.gate} · tag: ${reason.tag}`}>{reason.code}</span>
          ))}
        </div>
      </div>
    </li>
  );
}

export default function Marketplace({ health }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [request, setRequest] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const marketplaceHealthy = health?.find((service) => service.id === 'marketplace-service')?.healthy;

  function field(key) {
    return { value: form[key], onChange: (event) => setForm((prev) => ({ ...prev, [key]: event.target.value })) };
  }
  function toggleMode(mode) {
    setForm((prev) => ({ ...prev, allowedAssessmentModes: prev.allowedAssessmentModes.includes(mode)
      ? prev.allowedAssessmentModes.filter((m) => m !== mode) : [...prev.allowedAssessmentModes, mode] }));
  }

  async function openRequest() {
    setBusy(true); setError(null); setMatchResult(null);
    try {
      const body = {
        title: form.title.trim(), domain: form.domain.trim(),
        requiredObjectiveIds: parseIds(form.requiredObjectiveIds),
        ...(parseIds(form.preferredObjectiveIds).length ? { preferredObjectiveIds: parseIds(form.preferredObjectiveIds) } : {}),
        minOverallPercent: Number(form.minOverallPercent), minAdversarialPercent: Number(form.minAdversarialPercent),
        maxCredentialAgeDays: Number(form.maxCredentialAgeDays),
        allowedAssessmentModes: form.allowedAssessmentModes.length ? form.allowedAssessmentModes : ['standard'],
        requiredEnvironment: form.requiredEnvironment,
      };
      const created = await api('/api/marketplace/capability-requests', { method: 'POST', body: { idempotencyKey: crypto.randomUUID(), request: body } });
      const version = created.request.versions.at(-1).version;
      const opened = await api(`/api/marketplace/capability-requests/${created.request.id}/open`, { method: 'POST', body: { version } });
      setRequest(opened.request);
    } catch (reason) { setError(reason.data?.details ? `${reason.message}: ${reason.data.details.join(', ')}` : reason.message); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    if (!request) return;
    setBusy(true); setError(null);
    try {
      const result = await api(`/api/marketplace/capability-requests/${request.id}/matches`, { method: 'POST', body: { idempotencyKey: crypto.randomUUID() } });
      setMatchResult(result.matchResult);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="page">
      <PageHead index="07" title="Marketplace" sub="Capability Requests against real Eligible and Near Match candidates, deterministic and policy-versioned."
        readouts={[['Eligible', matchResult ? matchResult.totalEligible : '—'], ['Near Match', matchResult ? matchResult.totalNearMatches : '—'],
          ['Excluded', matchResult ? matchResult.exclusions.length : '—']]} />

      {marketplaceHealthy === false && (
        <div className="notice bad" style={{ marginBottom: 18 }}>
          <TriangleAlert size={15} style={{ verticalAlign: -2 }} /> Marketplace is unavailable right now. This does not touch Certification Decisions or
          credentials — they are unaffected and stay exactly as issued. Results below may be stale or unobtainable until it recovers.
        </div>
      )}

      <div className="grid cols-2">
        <Panel title="Capability Request" note="Validated against the one supported reference domain">
          <label className="label">Title</label>
          <input {...field('title')} style={{ width: '100%', marginBottom: 10 }} />
          <label className="label">Domain <span className="faint">(try a different string to see Unsupported Domain)</span></label>
          <input {...field('domain')} style={{ width: '100%', marginBottom: 10 }} />
          <label className="label">Required objective IDs (comma-separated)</label>
          <input {...field('requiredObjectiveIds')} style={{ width: '100%', marginBottom: 10 }} />
          <label className="label">Preferred objective IDs (optional)</label>
          <input {...field('preferredObjectiveIds')} style={{ width: '100%', marginBottom: 10 }} />
          <div className="row" style={{ gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label className="label">Min overall % (floor 80)</label>
              <input type="number" min={80} max={100} {...field('minOverallPercent')} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label">Min adversarial % (floor 70)</label>
              <input type="number" min={70} max={100} {...field('minAdversarialPercent')} style={{ width: '100%' }} />
            </div>
          </div>
          <label className="label">Max credential age (days)</label>
          <input type="number" min={1} max={365} {...field('maxCredentialAgeDays')} style={{ width: '100%', marginBottom: 10 }} />
          <label className="label">Allowed assessment modes</label>
          <div className="row" style={{ gap: 14, marginBottom: 10 }}>
            {MODES.map((mode) => (
              <label key={mode} className="row" style={{ gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={form.allowedAssessmentModes.includes(mode)} onChange={() => toggleMode(mode)} />{mode}
              </label>
            ))}
          </div>
          <label className="label">Required environment</label>
          <select {...field('requiredEnvironment')} style={{ width: '100%', marginBottom: 14 }}>
            <option value="simulation">simulation</option><option value="live">live</option>
          </select>
          <div className="drawer-actions">
            <button className="btn btn-primary" onClick={openRequest} disabled={busy || !form.title.trim()}>
              <Store size={15} /> {request ? 'Open a new request version' : 'Create and open request'}
            </button>
            {request && (
              <button className="btn" onClick={regenerate} disabled={busy}><RefreshCw size={15} /> Regenerate matches</button>
            )}
          </div>
          {request && (
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Request</dt><dd><code>{short(request.id, 10, 6)}</code> v{request.state.openVersion}</dd>
              <dt>Marketplace</dt><dd><code>{request.marketplace}</code></dd>
            </dl>
          )}
          {error && <p className="notice bad" style={{ marginTop: 14 }}>{error}</p>}
        </Panel>

        <Panel title="Match result" note={matchResult ? `${matchResult.policyVersion} · ${stamp(matchResult.generatedAt)}` : 'No result yet'}>
          {!matchResult ? (
            <div className="empty"><strong>No matches generated yet</strong>Open a Capability Request, then regenerate matches.</div>
          ) : matchResult.outcome === 'UNSUPPORTED_DOMAIN' ? (
            <div className="notice bad"><Ban size={15} style={{ verticalAlign: -2 }} /> This domain is not supported. EduAgentX validates exactly one
              reference domain (<code>{SUPPORTED_DOMAIN}</code>) end to end — no candidate is fabricated for anything else.</div>
          ) : matchResult.outcome === 'INVALID_REQUEST' ? (
            <div className="notice bad">The open request version failed validation and produced no candidates.</div>
          ) : (
            <>
              <p className="faint" style={{ fontSize: 12.5 }}><Gauge size={13} style={{ verticalAlign: -2 }} /> {matchResult.notice}</p>
              <div className="label" style={{ marginTop: 14 }}>Eligible Matches ({matchResult.totalEligible})</div>
              {matchResult.eligibleMatches.length === 0
                ? <p className="faint" style={{ fontSize: 12.5 }}>None eligible for this request right now.</p>
                : <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>{matchResult.eligibleMatches.map((item) => <MatchCard item={item} key={item.credentialId} />)}</ul>}

              <div className="label" style={{ marginTop: 14 }}>{matchResult.nearMatchLane} ({matchResult.totalNearMatches})</div>
              {matchResult.nearMatches.length === 0
                ? <p className="faint" style={{ fontSize: 12.5 }}>No honest near misses to show.</p>
                : <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>{matchResult.nearMatches.map((item) => <MatchCard item={item} near key={item.credentialId} />)}</ul>}

              <div className="label" style={{ marginTop: 14 }}>Excluded ({matchResult.exclusions.length})</div>
              {matchResult.exclusions.length === 0
                ? <p className="faint" style={{ fontSize: 12.5 }}>Nothing excluded this run.</p>
                : <ul className="feed">{matchResult.exclusions.map((item, index) => <ExclusionRow item={item} key={index} />)}</ul>}
              <p className="faint" style={{ fontSize: 11.5, marginTop: 14 }}>
                Lifecycle-origin trust verification (the gate behind most current exclusions) is pending Issue #83/#84 — until that merges,
                every real candidate is excluded upstream as <code>LIFECYCLE_ORIGIN_UNCHECKABLE</code>, by design, not a bug in this console.
              </p>
            </>
          )}
        </Panel>
      </div>
    </main>
  );
}
