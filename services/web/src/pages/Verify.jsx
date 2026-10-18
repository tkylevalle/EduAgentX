import { useState } from 'react';
import { FileWarning, ScanLine, Wand2 } from 'lucide-react';
import { Panel, Verdict, VerifyChecks } from '../ui.jsx';
import { api, pct, stamp } from '../lib.js';

// Edits one score inside the signed payload and keeps the original
// signature: exactly what a forger would try.
function tamper(jws) {
  const [header, payload, signature] = jws.split('.');
  const credential = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  const competency = credential.credentialSubject?.competency;
  if (competency?.scores) competency.scores.overallPercent = 100;
  const encoded = btoa(JSON.stringify(credential)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${encoded}.${signature}`;
}

export default function Verify() {
  const [jws, setJws] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tampered, setTampered] = useState(false);

  async function check(value = jws) {
    setBusy(true); setError(null);
    try { setResult(await api('/api/verify', { method: 'POST', body: { jws: value } })); }
    catch (reason) { setResult(null); setError(reason.message === 'jws_required' ? 'Paste a compact JWS credential first.' : `Verification unavailable: ${reason.message}`); }
    finally { setBusy(false); }
  }

  async function loadLatest() {
    setError(null);
    try {
      const { credentials } = await api('/api/credentials');
      if (!credentials.length) { setError('No credential has been issued yet. Run the Lifecycle Lab first.'); return; }
      setJws(credentials[0].compactJws); setTampered(false);
      await check(credentials[0].compactJws);
    } catch (reason) { setError(reason.message); }
  }

  async function forge() {
    try {
      const forged = tamper(jws.trim());
      setJws(forged); setTampered(true);
      await check(forged);
    } catch { setError('That does not look like a compact JWS (header.payload.signature).'); }
  }

  const vc = result?.credential;
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Verify a <em>credential</em></h1>
          <p className="page-lede">Anyone holding an EduAgentX credential can check it here. The verifier recomputes the Ed25519 signature,
            checks the schema and validity window, asks the status registry, and applies issuer and credential policy. Each check reports on its own.</p>
        </div>
      </div>
      <div className="grid cols-2">
        <Panel title="Credential" note="Compact JWS: header.payload.signature">
          <textarea value={jws} onChange={(event) => { setJws(event.target.value); setTampered(false); }} rows={9}
            placeholder="eyJhbGciOiJFZERTQSIsImtpZCI6…" aria-label="Compact JWS credential" spellCheck={false} />
          <div className="drawer-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => check()} disabled={busy || !jws.trim()}><ScanLine size={15} /> Verify</button>
            <button className="btn" onClick={loadLatest} disabled={busy}><Wand2 size={15} /> Load latest credential</button>
            <button className="btn btn-danger" onClick={forge} disabled={busy || !jws.trim() || tampered} title="Raise the overall score to 100% without re-signing">
              <FileWarning size={15} /> Tamper with score
            </button>
          </div>
          {tampered && <p className="notice" style={{ marginTop: 14 }}>The payload now claims a 100% score, but the signature is the original one.</p>}
          {error && <p className="notice bad" style={{ marginTop: 14 }}>{error}</p>}
          {vc && (
            <dl className="kv" style={{ marginTop: 18 }}>
              <dt>Subject</dt><dd><code>{decodeURIComponent((vc.credentialSubject?.id || '').split('/agents/')[1] || vc.credentialSubject?.id || '—')}</code></dd>
              <dt>Domain package</dt><dd><code>{vc.credentialSubject?.competency?.packageId}</code></dd>
              <dt>Claimed overall</dt><dd className="num">{pct(vc.credentialSubject?.competency?.scores?.overallPercent)}</dd>
              <dt>Valid from</dt><dd>{stamp(vc.validFrom)}</dd>
              <dt>Valid until</dt><dd>{stamp(vc.validUntil)}</dd>
              <dt>Terms</dt><dd className="faint">{vc.termsOfUse?.scope}</dd>
            </dl>
          )}
        </Panel>
        <Panel title="Verification report" note="From credential-verification, through the Gateway">
          {!result ? (
            <div className="empty"><strong>No credential checked yet</strong>Load the latest credential, then try tampering with it.</div>
          ) : (
            <><Verdict overall={result.report.overall} /><VerifyChecks report={result.report} />
              {result.report.reasonCodes?.length > 0 && <p className="faint" style={{ fontSize: 12.5, margin: '14px 0 0' }}>Reason codes: <code>{result.report.reasonCodes.join(', ')}</code></p>}</>
          )}
        </Panel>
      </div>
    </main>
  );
}
