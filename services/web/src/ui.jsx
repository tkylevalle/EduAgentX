import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, CircleHelp, KeyRound, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { pct, short, stamp } from './lib.js';

export function BrandMark({ size = 30 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="5" fill="#0b0d11" stroke="rgba(220,230,255,0.2)" />
      <path d="M9.5 9.5 22.5 22.5" stroke="#f2f4f7" strokeWidth="3.4" strokeLinecap="square" />
      <path d="M22.5 9.5 17.6 14.4" stroke="#5cf2b4" strokeWidth="3.4" strokeLinecap="square" />
      <path d="M14.4 17.6 9.5 22.5" stroke="#5cf2b4" strokeWidth="3.4" strokeLinecap="square" />
    </svg>
  );
}

// One bar per page: index, title, a short line, live readouts, one action.
export function PageHead({ index, title, sub, readouts = [], action }) {
  return (
    <header className="page-head">
      <div className="head-index" aria-hidden="true">{index}</div>
      <div className="head-main">
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {(readouts.length > 0 || action) && (
        <div className="head-side">
          {readouts.map(([label, value]) => (
            <dl className="readout" key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></dl>
          ))}
          {action && <div className="head-action">{action}</div>}
        </div>
      )}
    </header>
  );
}

// Counts from the previous value to the new one, so live numbers visibly move.
export function CountUp({ value, decimals = 0, duration = 700 }) {
  const [shown, setShown] = useState(Number.isFinite(value) ? value : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (!Number.isFinite(value)) return undefined;
    const start = performance.now();
    const origin = from.current;
    let frame;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return <>{Number.isFinite(value) ? shown.toFixed(decimals) : '—'}</>;
}

export function Pill({ tone, children, dot = false }) {
  return <span className={`pill ${tone || ''}`}>{dot && <span className={`dot ${tone || ''}`} />}{children}</span>;
}

export function Panel({ title, note, action, children, flush = false, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="panel-head">
          <div>
            <h2 className="panel-title">{title}</h2>
            {note && <div className="panel-note">{note}</div>}
          </div>
          {action}
        </header>
      )}
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Empty({ title, children }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

// Tier scores against the package's pass lines.
export function ScoreBars({ tierPercents, overallPercent, overallPass = 80, adversarialPass = 70, failed = false }) {
  const rows = [
    ['Recall', tierPercents?.recall, null],
    ['Applied', tierPercents?.applied, null],
    ['Adversarial', tierPercents?.adversarial, adversarialPass],
    ['Overall', overallPercent, overallPass],
  ];
  return (
    <div className="bars">
      {rows.map(([name, value, mark]) => (
        <div className="bar-row" key={name}>
          <span className="label">{name}</span>
          <div className="bar-track">
            <div className={`bar-fill ${failed && (name === 'Overall' || name === 'Adversarial') ? 'fail' : ''}`}
              style={{ width: `${Math.max(2, value || 0)}%`, '--w': Math.max(2, value || 0) }} />
            {mark && <span className="bar-mark" style={{ left: `${mark}%` }} title={`Pass line ${mark}%`} />}
          </div>
          <span className="bar-value">{pct(value)}</span>
        </div>
      ))}
    </div>
  );
}

const CHECKS = [
  ['signature', 'Ed25519 signature'],
  ['schema', 'VC 2.0 schema'],
  ['time', 'Validity window'],
  ['suspension', 'Not suspended'],
  ['revocation', 'Not revoked'],
  ['issuerPolicy', 'Trusted issuer'],
  ['credentialPolicy', 'Competency credential type'],
];

export function Verdict({ overall }) {
  const tone = overall === 'VALID' ? 'valid' : overall === 'INVALID' ? 'invalid' : 'indeterminate';
  const Icon = overall === 'VALID' ? ShieldCheck : overall === 'INVALID' ? ShieldX : ShieldAlert;
  const copy = { valid: 'Every check passed. EduAgentX issued this credential and it is in good standing.',
    invalid: 'At least one check failed. Do not rely on this credential.',
    indeterminate: 'The signature checks out, but current status could not be confirmed.' }[tone];
  return (
    <div className={`verdict ${tone}`} role="status">
      <Icon size={28} color={tone === 'valid' ? 'var(--signal)' : tone === 'invalid' ? 'var(--danger)' : 'var(--amber)'} />
      <div>
        <div className="verdict-word">{overall === 'VALID' ? 'Valid' : overall === 'INVALID' ? 'Invalid' : 'Indeterminate'}</div>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{copy}</div>
      </div>
    </div>
  );
}

export function VerifyChecks({ report }) {
  return (
    <div className="checks">
      {CHECKS.map(([key, name], index) => {
        const check = report?.[key] || { status: 'UNCHECKED' };
        const tone = check.status === 'PASS' ? 'pass' : check.status === 'FAIL' ? 'fail' : 'unknown';
        const Icon = tone === 'pass' ? CheckCircle2 : tone === 'fail' ? CircleAlert : CircleHelp;
        return (
          <div className={`check ${tone}`} key={key} style={{ animationDelay: `${index * 45}ms` }}>
            <Icon size={17} />
            <div>
              <div className="check-name">{name}</div>
              <div className="check-reason">{check.reason ? check.reason.replaceAll('_', ' ') : check.status === 'PASS' ? 'Passed' : check.status.toLowerCase().replaceAll('_', ' ')}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The issued credential as an object the audience can see and read.
export function CredentialArtifact({ credential, domain, status = 'active' }) {
  if (!credential) return null;
  const vc = credential.credential || {};
  const competency = vc.credentialSubject?.competency || {};
  const scores = competency.scores || { overallPercent: credential.overallPercent, tierPercents: credential.tierPercents };
  const subject = credential.agentLearnerKey || decodeURIComponent((vc.credentialSubject?.id || '').split('/agents/')[1] || '');
  return (
    <article className={`credential ${status === 'suspended' ? 'suspended' : status === 'revoked' ? 'revoked' : ''}`} aria-label="Competency credential">
      <div className="credential-issuer">
        <span className="row" style={{ gap: 8 }}><BrandMark size={20} /> EduAgentX · Competency credential</span>
        <Pill tone={status === 'active' ? 'ok' : status === 'suspended' ? 'warn' : status === 'revoked' ? 'bad' : 'info'} dot>{status}</Pill>
      </div>
      <h3 className="credential-domain">{domain || 'AI Agent Safety and Secure Tool Use'}</h3>
      <div className="credential-subject">Awarded to <code>{subject || '—'}</code> · package <code>{credential.packageId || competency.packageId} v{credential.packageVersion || competency.packageVersion}</code></div>
      <div className="credential-scores">
        <div><span className="label">Overall</span><strong>{pct(scores.overallPercent)}</strong></div>
        <div><span className="label">Recall</span><strong>{pct(scores.tierPercents?.recall)}</strong></div>
        <div><span className="label">Applied</span><strong>{pct(scores.tierPercents?.applied)}</strong></div>
        <div><span className="label">Adversarial</span><strong>{pct(scores.tierPercents?.adversarial)}</strong></div>
      </div>
      <dl className="kv" style={{ gridTemplateColumns: '110px 1fr', fontSize: 12.5, marginBottom: 16 }}>
        <dt>Credential</dt><dd><code>{credential.credentialId}</code></dd>
        <dt>Issued</dt><dd>{stamp(credential.issuedAt || vc.validFrom)}</dd>
        <dt>Valid until</dt><dd>{stamp(credential.validUntil || vc.validUntil)}</dd>
        <dt>Issuer</dt><dd><code>{vc.issuer || 'https://eduagentx.example/issuers/eduagentx'}</code></dd>
      </dl>
      <div className="credential-sig">
        <KeyRound size={14} />
        <span>EdDSA · Ed25519</span>
        <code>{short(credential.compactJws, 42, 22)}</code>
      </div>
    </article>
  );
}
