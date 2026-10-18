import { useCallback, useEffect, useState } from 'react';
import { Ban, PauseCircle, PlayCircle, ScanLine } from 'lucide-react';
import { CredentialArtifact, Empty, PageHead, Panel, Pill, Skeleton, Verdict, VerifyChecks } from '../ui.jsx';
import { api, ago, pct, short, stamp, STATUS_TONE } from '../lib.js';

const selectedFromHash = () => window.location.hash.split('/')[2] || null;

export default function Credentials() {
  const [credentials, setCredentials] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(selectedFromHash);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(() => api('/api/credentials').then((data) => { setCredentials(data.credentials); setError(null); })
    .catch((reason) => setError(reason.message)), []);
  useEffect(() => { load(); }, [load]);

  const selected = credentials?.find((credential) => credential.credentialId === selectedId) || credentials?.[0] || null;

  const verify = useCallback(async (credential) => {
    if (!credential) return;
    setBusy('verify');
    try { setReport((await api('/api/verify', { method: 'POST', body: { jws: credential.compactJws } })).report); }
    catch (reason) { setToast(`Verification unavailable: ${reason.message}`); }
    finally { setBusy(null); }
  }, []);

  useEffect(() => { setReport(null); setConfirmRevoke(false); setReason(''); if (selected) verify(selected); }, [selected?.credentialId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(null), 3500); return () => clearTimeout(timer); }, [toast]);

  async function change(action) {
    const text = reason.trim() || { suspend: 'Operator suspension pending review', reinstate: 'Review complete; suspension cleared', revoke: 'Credential withdrawn by operator' }[action];
    setBusy(action);
    try {
      await api(`/api/credentials/${selected.credentialId}/${action}`, { method: 'POST', body: { reason: text, agentLearnerKey: selected.agentLearnerKey } });
      setToast(`Credential ${action === 'reinstate' ? 'reinstated' : `${action}ed`}.`);
      setReason(''); setConfirmRevoke(false);
      await load();
      await verify(selected);
    } catch (reason) {
      setToast(reason.data?.error ? `Refused: ${reason.data.error}` : reason.message);
    } finally { setBusy(null); }
  }

  const select = (id) => { setSelectedId(id); window.history.replaceState(null, '', `#/credentials/${id}`); };

  return (
    <main className="page">
      <PageHead index="03" title="Credentials" sub="W3C Verifiable Credentials, Ed25519-signed at certification. Status lives apart, so a credential is never rewritten."
        readouts={[['Issued', credentials ? credentials.length : null], ['Active', credentials ? credentials.filter((c) => c.status === 'active').length : null],
          ['Suspended / revoked', credentials ? credentials.filter((c) => c.status !== 'active').length : null]]} />
      {error && <div className="notice bad" style={{ marginBottom: 18 }}>Credentials unavailable: {error}</div>}

      <div className="grid cols-main" style={{ alignItems: 'start' }}>
        <Panel title="Issued credentials" note={credentials ? `${credentials.length} on record` : 'Loading'} flush>
          {!credentials ? <div className="panel-body"><Skeleton height={120} /></div> : credentials.length === 0 ? (
            <Empty title="No credentials issued">A credential is issued only after a passed examination. Run the Lifecycle Lab to create one.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Credential</th><th>Agent</th><th className="hide-sm">Overall</th><th>Status</th><th className="hide-sm">Issued</th></tr></thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr key={credential.credentialId} className="clickable" aria-selected={selected?.credentialId === credential.credentialId}
                    onClick={() => select(credential.credentialId)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && select(credential.credentialId)}>
                    <td><code>{short(credential.credentialId, 8, 4)}</code></td>
                    <td>{credential.agentLearnerKey}</td>
                    <td className="hide-sm data">{pct(credential.overallPercent)}</td>
                    <td><Pill tone={STATUS_TONE[credential.status]} dot>{credential.status}</Pill></td>
                    <td className="hide-sm faint">{ago(credential.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="stack">
          {selected && <CredentialArtifact credential={selected} status={selected.status} />}
          {selected && (
            <Panel title="Live verification" note="Signature, schema, time, status and policy, checked independently"
              action={<button className="btn btn-ghost" onClick={() => verify(selected)} disabled={busy === 'verify'}><ScanLine size={15} /> Re-verify</button>}>
              {!report ? <Skeleton height={120} /> : <><Verdict overall={report.overall} /><VerifyChecks report={report} /></>}
            </Panel>
          )}
          {selected && (
            <Panel title="Status control" note="Admin only. Each change is recorded with its reason and actor.">
              <label className="label" htmlFor="reason">Reason</label>
              <input id="reason" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)}
                placeholder="Why is the status changing?" style={{ margin: '6px 0 12px' }} disabled={selected.status === 'revoked'} />
              <div className="drawer-actions">
                <button className="btn" onClick={() => change('suspend')} disabled={!!busy || selected.status !== 'active'}><PauseCircle size={15} /> Suspend</button>
                <button className="btn" onClick={() => change('reinstate')} disabled={!!busy || selected.status !== 'suspended'}><PlayCircle size={15} /> Reinstate</button>
                {!confirmRevoke ? (
                  <button className="btn btn-danger" onClick={() => setConfirmRevoke(true)} disabled={!!busy || selected.status === 'revoked'}><Ban size={15} /> Revoke…</button>
                ) : (
                  <button className="btn btn-danger" onClick={() => change('revoke')} disabled={!!busy}><Ban size={15} /> Confirm: revoke permanently</button>
                )}
              </div>
              {selected.status === 'revoked' && <p className="faint" style={{ fontSize: 12.5, marginBottom: 0 }}>Revocation is irreversible. The credential stays on record as evidence.</p>}
              <div className="label" style={{ margin: '18px 0 8px' }}>Status history</div>
              <ul className="feed" style={{ margin: '0 -20px -18px' }}>
                {(selected.history || []).map((entry, index) => (
                  <li key={index}>
                    <span className={`dot ${STATUS_TONE[entry.status]}`} />
                    <div><div>{entry.status}</div><div className="faint" style={{ fontSize: 12 }}>{entry.reason}</div></div>
                    <span className="faint" style={{ fontSize: 12 }}>{stamp(entry.at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
