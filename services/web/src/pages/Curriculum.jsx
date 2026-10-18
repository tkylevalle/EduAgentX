import { useEffect, useState } from 'react';
import { Check, ExternalLink, ShieldAlert } from 'lucide-react';
import { Empty, Panel, Pill, Skeleton } from '../ui.jsx';
import { api, short } from '../lib.js';

const TIER_COPY = { recall: 'Recall', applied: 'Applied', adversarial: 'Adversarial' };

export default function Curriculum() {
  const [pkg, setPkg] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => { api('/api/package').then((data) => setPkg(data.package)).catch((reason) => { setError(reason.message); setPkg(null); }); }, []);

  const slots = pkg?.exam?.slots || [];
  const tierCount = (tier) => slots.filter((slot) => slot.tier === tier).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Domain Assurance <em>Package</em></h1>
          <p className="page-lede">One immutable, versioned unit pins the sources, objectives, modules, examination template, rubric and fallback bank
            for a competency domain. It activates only after six automated gates and two distinct reviewers.</p>
        </div>
        {pkg && <Pill tone={pkg.certificationBlocked ? 'bad' : 'ok'} dot>{pkg.state}{pkg.certificationBlocked ? ' · certification blocked' : ''}</Pill>}
      </div>
      {error && <div className="notice bad" style={{ marginBottom: 18 }}>Package unavailable: {error}</div>}
      {pkg === undefined ? <Skeleton height={320} /> : !pkg ? (
        <Panel><Empty title="No active package">The Lifecycle Lab activates the reference AI Agent Safety package on its first run.</Empty></Panel>
      ) : (
        <div className="stack">
          <div className="ledger" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', marginBottom: 0 }}>
            <div className="ledger-cell"><div className="label">Domain</div><div style={{ marginTop: 10, fontSize: 16, fontWeight: 560 }}>AI Agent Safety and Secure Tool Use</div><div className="ledger-foot"><code>{pkg.packageId}</code> v{pkg.version}</div></div>
            <div className="ledger-cell"><div className="label">Digest</div><div className="data" style={{ marginTop: 12 }}>{short(pkg.digest, 18, 8)}</div><div className="ledger-foot">SHA-256 over the whole package</div></div>
            <div className="ledger-cell"><div className="label">Validation gates</div><div className="ledger-value">{pkg.gates.filter((gate) => gate.passed).length}/6</div><div className="ledger-foot">Automated, before human review</div></div>
            <div className="ledger-cell"><div className="label">Quarantined scopes</div><div className="ledger-value">{pkg.quarantinedScopes.length}</div><div className="ledger-foot">Critical corrections isolate content</div></div>
          </div>

          <div className="grid cols-main">
            <Panel title="Curriculum track" note={`${pkg.modules.length} modules, each claim cited to an official source`} flush>
              <table className="table">
                <thead><tr><th>Module</th><th>Title</th><th className="hide-sm">Sources</th></tr></thead>
                <tbody>{pkg.modules.map((module) => (
                  <tr key={module.id}><td><code>{module.id}</code></td><td>{module.title}</td>
                    <td className="hide-sm"><div className="chips">{module.sources.map((source) => <span className="chip" key={source}>{source}</span>)}</div></td></tr>
                ))}</tbody>
              </table>
            </Panel>
            <Panel title="Validation gates" note="Latest validation run">
              <ul className="feed" style={{ margin: '-18px -20px' }}>
                {pkg.gates.map((gate) => (
                  <li key={gate.name}><span className={`dot ${gate.passed ? 'ok' : 'bad'}`} /><div>{gate.name.replaceAll('_', ' ')}</div>
                    <span className="faint" style={{ fontSize: 12 }}>{gate.passed ? 'passed' : gate.reason}</span></li>
                ))}
              </ul>
            </Panel>
          </div>

          <Panel title="Examination blueprint" note={`${slots.length} items: ${tierCount('recall')} recall, ${tierCount('applied')} applied, ${tierCount('adversarial')} adversarial`}>
            <div className="slots" role="img" aria-label="Examination slots by tier">
              {slots.map((slot) => <div className={`slot ${slot.tier}`} key={slot.id} title={`${TIER_COPY[slot.tier]} · ${slot.id}`}>{slot.id}</div>)}
            </div>
            <div className="row" style={{ gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
              {Object.entries(TIER_COPY).map(([tier, label]) => <span className="row label" key={tier} style={{ gap: 7 }}><span className={`slot ${tier}`} style={{ width: 12, height: 12, borderRadius: 4 }} />{label}</span>)}
              <span className="label" style={{ marginLeft: 'auto' }}>Pass: {pkg.exam.overallPassPercent ?? 80}% overall and {pkg.exam.adversarialPassPercent ?? 70}% adversarial, with zero critical violations</span>
            </div>
          </Panel>

          <div className="grid cols-2">
            <Panel title="Objectives" note="Observable behaviours the examination measures" flush>
              <ul className="feed">
                {pkg.objectives.map((objective) => (
                  <li key={objective.id}>
                    {objective.safetyCritical ? <ShieldAlert size={15} color="var(--danger)" style={{ marginTop: 3 }} /> : <Check size={15} color="var(--signal)" style={{ marginTop: 3 }} />}
                    <div>{objective.statement}</div><code className="faint">{objective.id}</code>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Pinned sources" note="Exact editions and snapshots, never live pages" flush>
              <ul className="feed">
                {pkg.sources.map((source) => (
                  <li key={source.id}>
                    <span className="dot info" />
                    <div><div>{source.title}</div><div className="faint" style={{ fontSize: 12 }}>{source.issuer} · edition {source.edition}</div></div>
                    {source.canonicalUrl && <a href={source.canonicalUrl} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`}><ExternalLink size={14} /></a>}
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </main>
  );
}
