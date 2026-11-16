import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Gavel, ShieldAlert } from 'lucide-react';
import { Empty, PageHead, Panel, Pill, Skeleton } from '../ui.jsx';
import { api, short, stamp } from '../lib.js';

// Governance (target design 3.2 step 5; assurance audit C1-C3): a reviewer
// reads each claim beside the source text it quotes, scores every rubric
// criterion and signs the review with their own credentials. Activation is
// refused until two people approve with no open disagreement.

const STEP = 0.5;
const STATE_TONE = { AwaitingReview: 'warn', Active: 'ok' };

function ClaimCheck({ claim, section }) {
  const at = section ? section.text.replace(/\s+/g, ' ').indexOf(claim.quote.replace(/\s+/g, ' ')) : -1;
  const text = section?.text.replace(/\s+/g, ' ') || '';
  return (
    <li>
      {at >= 0 ? <CheckCircle2 size={15} color="var(--signal)" style={{ marginTop: 3 }} /> : <ShieldAlert size={15} color="var(--danger)" style={{ marginTop: 3 }} />}
      <div>
        <div style={{ fontWeight: 560 }}>{claim.text}</div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          <code>{claim.sectionId}</code> · {section?.locator || 'section not stored'}{section?.url && <> · <a href={section.url} target="_blank" rel="noreferrer">page <ExternalLink size={11} /></a></>}
        </div>
        {at >= 0 && <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>
          {text.slice(0, at)}<mark>{text.slice(at, at + claim.quote.replace(/\s+/g, ' ').length)}</mark>{text.slice(at + claim.quote.replace(/\s+/g, ' ').length)}
        </div>}
      </div>
    </li>
  );
}

function ReviewForm({ pkg, onDone }) {
  const [scores, setScores] = useState(() => Object.fromEntries(pkg.criteria.map((criterion) => [criterion.id, ''])));
  const [approved, setApproved] = useState(false);
  const [comment, setComment] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [state, setState] = useState(null);
  const complete = pkg.criteria.every((criterion) => scores[criterion.id] !== '');
  const weighted = complete ? pkg.criteria.reduce((sum, c) => sum + c.weight * Number(scores[c.id]), 0) / pkg.criteria.reduce((sum, c) => sum + c.weight, 0) : null;

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true });
    try {
      const reply = await api('/api/governance/reviews', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version, approved, comment,
        criterionScores: Object.fromEntries(Object.entries(scores).map(([id, value]) => [id, Number(value)])), clientId, clientSecret } });
      setClientSecret('');
      setState({ done: `Recorded: score ${reply.score}${reply.disagreements?.length ? `, disagreement on ${reply.disagreements.map((d) => d.criterionId).join(', ')}` : ''}.` });
      onDone();
    } catch (error) { setState({ error: error.message }); }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
      <table className="table">
        <thead><tr><th>Criterion</th><th>Anchor</th><th style={{ width: 90 }}>Score 0–5</th></tr></thead>
        <tbody>{pkg.criteria.map((criterion) => (
          <tr key={criterion.id}><td><code>{criterion.id}</code><div className="faint" style={{ fontSize: 12 }}>weight {criterion.weight}</div></td>
            <td style={{ fontSize: 13 }}>{criterion.anchor}</td>
            <td><input type="number" min={0} max={5} step={STEP} required value={scores[criterion.id]} aria-label={`Score for ${criterion.id}`}
              onChange={(event) => setScores({ ...scores, [criterion.id]: event.target.value })} /></td></tr>
        ))}</tbody>
      </table>
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <span className="label">Weighted score <strong className="num">{weighted === null ? '—' : weighted.toFixed(2)}</strong> (floor 3.5)</span>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} style={{ width: 16 }} /> I approve this version</label>
      </div>
      <textarea rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)}
        placeholder="What you checked, what you would change, and any claim you could not confirm." />
      <div className="grid cols-2" style={{ gap: 10 }}>
        <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Your reviewer client id" autoComplete="username" required />
        <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Your reviewer secret" autoComplete="current-password" required />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn-primary" type="submit" disabled={!complete || state?.busy}><Gavel size={15} /> Sign and submit review</button>
        <span className="faint" style={{ fontSize: 12.5 }}>Signed as the account you enter. The author of a version cannot review it.</span>
      </div>
      {state?.done && <div className="notice ok">{state.done}</div>}
      {state?.error && <div className="notice bad">Not recorded: {state.error}</div>}
    </form>
  );
}

function Resolve({ pkg, disagreement, onDone }) {
  const [text, setText] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    try {
      await api('/api/governance/resolutions', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version,
        criterionId: disagreement.criterionId, resolution: text, clientId, clientSecret } });
      onDone();
    } catch (reason) { setError(reason.message); }
  }
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 8 }}>
      <div><code>{disagreement.criterionId}</code> · {Object.entries(disagreement.scores).map(([who, score]) => `${who} ${score}`).join(' vs ')}</div>
      <textarea rows={2} maxLength={2000} required value={text} onChange={(event) => setText(event.target.value)} placeholder="How the reviewers resolved it." />
      <div className="grid cols-2" style={{ gap: 10 }}>
        <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Reviewer client id" required />
        <input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} placeholder="Reviewer secret" required />
      </div>
      <button className="btn" type="submit">Record resolution</button>
      {error && <div className="notice bad">{error}</div>}
    </form>
  );
}

export default function Governance() {
  const [packages, setPackages] = useState(undefined);
  const [selectedKey, setSelectedKey] = useState(null);
  const [error, setError] = useState(null);
  const [activation, setActivation] = useState(null);
  const load = () => api('/api/governance/packages').then((data) => { setPackages(data.packages); setError(null); })
    .catch((reason) => { setError(reason.message); setPackages([]); });
  useEffect(() => { load(); }, []);
  const key = (pkg) => `${pkg.packageId}@${pkg.version}`;
  const pkg = useMemo(() => packages?.find((value) => key(value) === selectedKey) || packages?.find((value) => value.state === 'AwaitingReview') || packages?.[0],
    [packages, selectedKey]);
  const sections = useMemo(() => new Map((pkg?.sections || []).map((section) => [section.id, section])), [pkg]);
  const approvals = pkg?.reviews.filter((review) => review.approved).length ?? 0;

  async function activate() {
    try { await api('/api/governance/activate', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version } }); setActivation({ ok: true }); load(); }
    catch (reason) { setActivation({ error: reason.message }); }
  }

  return (
    <main className="page">
      <PageHead index="09" title="Governance" sub="Two people outside the authoring role check every claim against its source and score the rubric. Nothing here is automated."
        readouts={[['Awaiting review', packages ? packages.filter((value) => value.state === 'AwaitingReview').length : null],
          ['Approvals', pkg ? `${approvals}/2` : null], ['Open disagreements', pkg ? pkg.openDisagreements.length : null]]} />
      {error && <div className="notice bad" style={{ marginBottom: 18 }}>Packages unavailable: {error}</div>}
      {packages === undefined ? <Skeleton height={320} /> : !pkg ? (
        <Panel><Empty title="Nothing to review">A package appears here once it passes the six validation gates.</Empty></Panel>
      ) : (
        <div className="stack">
          <Panel title="Packages" note="Validated versions awaiting review, and the active ones" flush>
            <table className="table">
              <thead><tr><th>Package</th><th>Domain</th><th>State</th><th>Approvals</th><th className="hide-sm">Digest</th></tr></thead>
              <tbody>{packages.map((value) => (
                <tr key={key(value)} onClick={() => setSelectedKey(key(value))} style={{ cursor: 'pointer', background: key(value) === key(pkg) ? 'var(--signal-dim)' : undefined }}>
                  <td><code>{value.packageId}</code> v{value.version}</td><td>{value.domain}</td>
                  <td><Pill tone={STATE_TONE[value.state] || 'info'} dot>{value.state}</Pill></td>
                  <td className="num">{value.reviews.filter((review) => review.approved).length}/2</td>
                  <td className="hide-sm data">{short(value.digest, 10, 6)}</td></tr>
              ))}</tbody>
            </table>
          </Panel>

          <div className="grid cols-main">
            <Panel title="Claims against their sources" note="Each claim's quote is highlighted inside the stored section; a red mark means the quote is not there" flush>
              <ul className="feed">{pkg.modules.flatMap((module) => module.claims.map((claim, index) => (
                <ClaimCheck key={`${module.id}-${index}`} claim={claim} section={sections.get(claim.sectionId)} />
              )))}</ul>
            </Panel>
            <Panel title="Sources" note="Licence and how each is pinned" flush>
              <ul className="feed">{pkg.sources.map((source) => (
                <li key={source.id}><span className={`dot ${/pending/i.test(source.licence) ? 'warn' : 'info'}`} />
                  <div><div>{source.title}</div><div className="faint" style={{ fontSize: 12 }}>{source.issuer} · {source.edition} · {source.kind}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{source.licence}</div></div></li>
              ))}</ul>
            </Panel>
          </div>

          <Panel title="Lessons" note="Worked example and counter-example in every module" flush>
            <table className="table">
              <thead><tr><th>Module</th><th>Lesson and practice</th></tr></thead>
              <tbody>{pkg.modules.map((module) => (
                <tr key={module.id}><td style={{ verticalAlign: 'top' }}><code>{module.id}</code><div style={{ fontWeight: 560 }}>{module.title}</div></td>
                  <td style={{ fontSize: 13, lineHeight: 1.55 }}>{module.items.map((item, index) => <p key={index} style={{ margin: index ? '8px 0 0' : 0 }}><span className="label">{item.kind}</span> {item.text}</p>)}</td></tr>
              ))}</tbody>
            </table>
          </Panel>

          <div className="grid cols-2">
            <Panel title="Reviews" note={pkg.reviews.length ? 'Recorded, immutable' : 'None yet'} flush>
              {pkg.reviews.length ? <table className="table">
                <thead><tr><th>Reviewer</th><th>Score</th><th>Decision</th><th className="hide-sm">When</th></tr></thead>
                <tbody>{pkg.reviews.map((review) => (
                  <tr key={review.reviewer}><td><code>{review.reviewer}</code>{review.comment && <div className="faint" style={{ fontSize: 12 }}>{review.comment}</div>}</td>
                    <td className="num">{review.score}</td><td><Pill tone={review.approved ? 'ok' : 'bad'}>{review.approved ? 'approved' : 'not approved'}</Pill></td>
                    <td className="hide-sm faint">{stamp(review.at)}</td></tr>
                ))}</tbody>
              </table> : <Empty title="No review yet">Two people must review this exact version before it can be activated.</Empty>}
            </Panel>
            <Panel title="Open disagreements" note="More than one point apart on a criterion">
              {pkg.openDisagreements.length ? <div className="stack" style={{ gap: 18 }}>
                {pkg.openDisagreements.map((item) => <Resolve key={item.criterionId} pkg={pkg} disagreement={item} onDone={load} />)}
              </div> : <div className="faint">None.</div>}
            </Panel>
          </div>

          {pkg.state === 'AwaitingReview' && <>
            <Panel title="Your review" note={`${pkg.packageId} v${pkg.version}, digest ${short(pkg.digest, 10, 6)}`}>
              <ReviewForm key={key(pkg)} pkg={pkg} onDone={load} />
            </Panel>
            <Panel title="Activation" note="Operator step; refused until two approvals and no open disagreement"
              action={<button className="btn" onClick={activate} disabled={approvals < 2 || pkg.openDisagreements.length > 0}>Activate this version</button>}>
              {activation?.error ? <div className="notice bad">Refused: {activation.error}</div> : <div className="faint">{approvals}/2 approvals.</div>}
            </Panel>
          </>}
        </div>
      )}
    </main>
  );
}
