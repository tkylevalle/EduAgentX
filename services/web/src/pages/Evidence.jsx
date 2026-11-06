import { useState } from 'react';
import { FileCheck2, FileDown, RefreshCw, TriangleAlert } from 'lucide-react';
import { PageHead, Panel } from '../ui.jsx';
import { api, short, stamp } from '../lib.js';

// Sections the bundle always carries, in the fixed order the evidence-bundle
// service reports digests for. Each is labelled with the issue honestly
// backing it right now; a section nobody backs yet says so instead of
// pretending it was checked.
const SECTIONS = [
  ['buildEnv', 'Build & environment', 'Service health and runtime, read live from this app'],
  ['packages', 'Packages', 'The active Domain Assurance Package (Issue #9)'],
  ['kpis', 'KPIs', 'Certification issuance KPIs (Issue #23)'],
  ['contracts', 'Contracts', 'Not yet sourced from a live service'],
  ['policies', 'Policies', 'Not yet sourced from a live service'],
  ['datasets', 'Datasets', 'Not yet sourced from a live service'],
  ['incidents', 'Incidents', 'Not yet sourced from a live service'],
  ['demonstrations', 'Demonstrations', 'Pending Issue #33 (e2e suite) and #34 (hero scenarios)'],
  ['costs', 'Costs', 'Not yet sourced from a live service'],
  ['limitations', 'Limitations', 'Declared by this bundle run'],
];

const count = (value) => (Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0);

export default function Evidence({ health }) {
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const evidenceHealthy = health?.find((service) => service.id === 'evidence-bundle')?.healthy;

  async function regenerate() {
    setBusy(true); setError(null);
    try { setBundle(await api('/api/evidence/bundle', { method: 'POST', body: {} })); }
    catch (reason) { setBundle(null); setError(reason.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="page">
      <PageHead index="08" title="Evidence Bundle" sub="A sanitized, digested export of what the platform can currently back with live data."
        readouts={[['Version', bundle?.bundleVersion || '—'], ['Generated', bundle ? stamp(bundle.generatedAt) : '—']]} />

      {evidenceHealthy === false && (
        <div className="notice bad" style={{ marginBottom: 18 }}>
          <TriangleAlert size={15} style={{ verticalAlign: -2 }} /> The evidence-bundle service is unavailable right now.
          Certifications and credentials are unaffected; only this export cannot be regenerated until it recovers.
        </div>
      )}

      <Panel title="Regenerate" note="Every section is redacted and digested before it reaches the browser">
        <div className="drawer-actions">
          <button className="btn btn-primary" onClick={regenerate} disabled={busy}>
            <RefreshCw size={15} /> {bundle ? 'Regenerate bundle' : 'Generate bundle'}
          </button>
          <a className="btn" href="/api/evidence/bundle.html" target="_blank" rel="noreferrer">
            <FileDown size={15} /> Export as HTML
          </a>
        </div>
        {error && <p className="notice bad" style={{ marginTop: 14 }}>{error}</p>}
        {bundle && (
          <dl className="kv" style={{ marginTop: 14 }}>
            <dt>Bundle digest</dt><dd><code>{short(bundle.bundleDigest, 16, 8)}</code></dd>
            <dt>Retention</dt><dd className="faint">raw {bundle.retention.raw} · aggregate {bundle.retention.aggregate}</dd>
          </dl>
        )}
      </Panel>

      <Panel title="Sections" note={bundle ? `${Object.keys(bundle.sections).length} sections, each content-digested` : 'Generate a bundle to see sections'} flush>
        {!bundle ? (
          <div className="empty"><strong>No bundle generated yet</strong>Click Generate bundle to pull what is currently available live.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Section</th><th>Source</th><th>Items</th><th>Digest</th></tr></thead>
            <tbody>
              {SECTIONS.map(([key, label, note]) => {
                const value = bundle.sections[key];
                const n = count(value);
                return (
                  <tr key={key}>
                    <td><FileCheck2 size={13} style={{ verticalAlign: -2, marginRight: 6, opacity: n ? 1 : 0.35 }} />{label}</td>
                    <td className="faint" style={{ fontSize: 12.5 }}>{note}</td>
                    <td className="num">{n}</td>
                    <td><code className="faint" style={{ fontSize: 12 }}>{short(bundle.digests[key], 10, 4)}</code></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </main>
  );
}
