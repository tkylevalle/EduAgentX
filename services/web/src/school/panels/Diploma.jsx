import { useState } from 'react';
import { Check, HelpCircle, KeyRound, X } from 'lucide-react';
import { api, pct, short } from '../../lib.js';
import { BrandMark } from '../../ui.jsx';
import { TIERS } from '../report.mjs';
import { Problem } from './parts.jsx';

// The seven checks of the verification service, in a visitor's words.
const CHECKS = [
  ['signature', 'Signature'], ['schema', 'Format'], ['time', 'In date'], ['suspension', 'Not on hold'],
  ['revocation', 'Not revoked'], ['issuerPolicy', 'Trusted school'], ['credentialPolicy', 'Right diploma'],
];
const STANDING = { active: ['In good standing', 'ok'], suspended: ['On hold', 'warn'], revoked: ['Revoked', 'bad'] };
const VERDICT = { VALID: ['Genuine', 'ok'], INVALID: ['Not valid', 'bad'] };
// A diploma is valid for a year, so its dates carry the year.
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

/** Asks the verification service about one diploma. The answer belongs to that diploma only. */
function useCheck(credential) {
  const [state, setState] = useState({ id: null, report: null, error: null, busy: false });
  const id = credential.credentialId;
  const check = () => {
    setState({ id, report: null, error: null, busy: true });
    api('/api/verify', { method: 'POST', body: { jws: credential.compactJws } })
      .then((reply) => setState({ id, report: reply.report, error: null, busy: false }))
      .catch((error) => setState({ id, report: null, error: error.message, busy: false }));
  };
  return state.id === id ? { ...state, check } : { report: null, error: null, busy: false, check };
}

function Seals({ report }) {
  const [word, tone] = VERDICT[report.overall] || ['Could not confirm', 'warn'];
  return (
    <div className="diploma-check" data-tone={tone} role="status">
      <strong className="diploma-verdict">{word}</strong>
      <ul className="seals">
        {CHECKS.map(([key, name], index) => {
          const status = report[key]?.status;
          const Icon = status === 'PASS' ? Check : status === 'FAIL' ? X : HelpCircle;
          return (
            <li key={key} data-status={status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'unknown'} style={{ '--i': index }}>
              <span className="seal"><Icon size={16} strokeWidth={3} /></span>{name}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * A competency credential, shown as the diploma it is.
 * @param {{ credential: object, runReport?: object|null }} props runReport: the check this run already made
 */
export default function Diploma({ credential, runReport = null }) {
  const live = useCheck(credential);
  const report = live.report || runReport;
  const [standing, tone] = STANDING[credential.status] || ['Status unknown', 'warn'];
  return (
    <article className="paper diploma" data-status={credential.status} aria-label="Diploma">
      <header className="paper-head">
        <div>
          <h2 className="paper-title">Diploma</h2>
          <p className="paper-who"><BrandMark size={16} /> EduAgent X · {credential.packageId} v{credential.packageVersion}</p>
        </div>
        <span className="stamp" data-tone={tone}>{standing}</span>
      </header>
      <p className="diploma-to">Awarded to <code>{credential.agentLearnerKey}</code></p>
      <div className="diploma-scores">
        <div><strong>{pct(credential.overallPercent)}</strong><span>overall</span></div>
        {TIERS.map((tier) => <div key={tier.id}><strong>{pct(credential.tierPercents?.[tier.id])}</strong><span>{tier.name}</span></div>)}
      </div>
      <dl className="s-rows">
        <dt>Issued</dt><dd>{day(credential.issuedAt)}</dd>
        <dt>Valid until</dt><dd>{day(credential.validUntil)}</dd>
        <dt>Signed</dt><dd><KeyRound size={13} /> Ed25519 · <code>{short(credential.compactJws, 22, 14)}</code></dd>
      </dl>
      {report && <Seals report={report} />}
      {live.error && <Problem what="The check" error={live.error} />}
      <button type="button" className="s-go diploma-go" onClick={live.check} disabled={live.busy}>
        {live.busy ? 'Checking' : report ? 'Check again' : 'Check this diploma'}
      </button>
    </article>
  );
}
