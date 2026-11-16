import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, Gavel, ShieldAlert } from 'lucide-react';
import { Empty, PageHead, Panel, Pill, Skeleton } from '../ui.jsx';
import { api, short, stamp } from '../lib.js';

// Governance (target design 3.2 step 5; assurance audit C1-C3): a reviewer
// reads each claim beside the source text it quotes, confirms every cited
// source, scores every rubric criterion and signs the review with their own
// credentials. The review policy and the approval count come from the
// validation service, so this page never restates a threshold.

const STEP = 0.5;
const STATE_TONE = { AwaitingReview: 'warn', Active: 'ok' };
const flat = (text) => String(text || '').replace(/\s+/g, ' ');

function ClaimCheck({ claim, section }) {
  const text = flat(section?.text);
  const quote = flat(claim.quote);
  const at = section ? text.indexOf(quote) : -1;
  return (
    <li>
      {at >= 0 ? <CheckCircle2 size={15} color="var(--signal)" style={{ marginTop: 3 }} /> : <ShieldAlert size={15} color="var(--danger)" style={{ marginTop: 3 }} />}
      <div>
        <div style={{ fontWeight: 560 }}>{claim.text}</div>
        <div className="faint" style={{ fontSize: 12.5, marginTop: 4 }}>
          <code>{claim.sectionId}</code> · {section?.locator || 'section not stored'}{section?.url && <> · <a href={section.url} target="_blank" rel="noreferrer">page <ExternalLink size={11} /></a></>}
        </div>
        {at >= 0 && <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.5 }}>{text.slice(0, at)}<mark>{quote}</mark>{text.slice(at + quote.length)}</div>}
      </div>
    </li>
  );
}

// The reviewer's own account; the server trades it for a token and keeps nothing.
function SignIn({ value, onChange }) {
  return (
    <div className="grid cols-2" style={{ gap: 10 }}>
      <input value={value.clientId} onChange={(event) => onChange({ ...value, clientId: event.target.value })} placeholder="Your reviewer client id" autoComplete="username" required />
      <input type="password" value={value.clientSecret} onChange={(event) => onChange({ ...value, clientSecret: event.target.value })} placeholder="Your reviewer secret" autoComplete="current-password" required />
    </div>
  );
}
const NO_ACCOUNT = { clientId: '', clientSecret: '' };

function ReviewForm({ pkg, onDone }) {
  const policy = pkg.reviewPolicy;
  const [scores, setScores] = useState(() => Object.fromEntries(pkg.criteria.map((criterion) => [criterion.id, ''])));
  const [checks, setChecks] = useState(() => Object.fromEntries(pkg.citedSources.map((id) => [id, Object.fromEntries(policy.sourceChecks.map((check) => [check, false]))])));
  const [approved, setApproved] = useState(false);
  const [comment, setComment] = useState('');
  const [account, setAccount] = useState(NO_ACCOUNT);
  const [state, setState] = useState(null);
  const complete = pkg.criteria.every((criterion) => scores[criterion.id] !== '');
  const confirmed = pkg.citedSources.every((id) => policy.sourceChecks.every((check) => checks[id][check]));
  const sources = new Map(pkg.sources.map((source) => [source.id, source]));

  async function submit(event) {
    event.preventDefault();
    setState({ busy: true });
    try {
      const reply = await api('/api/governance/reviews', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version, approved, comment,
        criterionScores: Object.fromEntries(Object.entries(scores).map(([id, value]) => [id, Number(value)])), sourceChecks: checks, ...account } });
      setAccount(NO_ACCOUNT);
      setState({ done: `Recorded with score ${reply.score}. ${reply.approvals}/${reply.required} approvals${reply.disagreements?.length ? `; disagreement on ${reply.disagreements.map((d) => d.criterionId).join(', ')}` : ''}.` });
      onDone();
    } catch (error) { setState({ error: error.message }); }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 12 }}>
      <table className="table">
        <thead><tr><th>Cited source</th>{policy.sourceChecks.map((check) => <th key={check} style={{ width: 90 }}>{check} checked</th>)}</tr></thead>
        <tbody>{pkg.citedSources.map((id) => (
          <tr key={id}><td><code>{id}</code><div className="faint" style={{ fontSize: 12 }}>{sources.get(id)?.edition} · {sources.get(id)?.licence}</div></td>
            {policy.sourceChecks.map((check) => <td key={check}><input type="checkbox" style={{ width: 16 }} checked={checks[id][check]} aria-label={`${id} ${check}`}
              onChange={(event) => setChecks({ ...checks, [id]: { ...checks[id], [check]: event.target.checked } })} /></td>)}</tr>
        ))}</tbody>
      </table>
      <table className="table">
        <thead><tr><th>Criterion</th><th>Anchor</th><th style={{ width: 90 }}>Score 0–5</th></tr></thead>
        <tbody>{pkg.criteria.map((criterion) => (
          <tr key={criterion.id}><td><code>{criterion.id}</code><div className="faint" style={{ fontSize: 12 }}>weight {criterion.weight}</div></td>
            <td style={{ fontSize: 13 }}>{criterion.anchor}</td>
            <td><input type="number" min={0} max={5} step={STEP} required value={scores[criterion.id]} aria-label={`Score for ${criterion.id}`}
              onChange={(event) => setScores({ ...scores, [criterion.id]: event.target.value })} /></td></tr>
        ))}</tbody>
      </table>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={approved} disabled={!confirmed} onChange={(event) => setApproved(event.target.checked)} style={{ width: 16 }} />
        I approve this version {confirmed ? '' : '(confirm every cited source first)'}
      </label>
      <textarea rows={3} maxLength={policy.maxCommentChars} value={comment} onChange={(event) => setComment(event.target.value)}
        placeholder="What you checked, what you would change, and any claim you could not confirm." />
      <SignIn value={account} onChange={setAccount} />
      <div className="row" style={{ gap: 12 }}>
        <button className="btn btn-primary" type="submit" disabled={!complete || state?.busy}><Gavel size={15} /> Sign and submit review</button>
        <span className="faint" style={{ fontSize: 12.5 }}>The service computes the score from the rubric weights. The author of a version cannot review it.</span>
      </div>
      {state?.done && <div className="notice ok">{state.done}</div>}
      {state?.error && <div className="notice bad">Not recorded: {state.error}</div>}
    </form>
  );
}

function Resolve({ pkg, disagreement, onDone }) {
  const [text, setText] = useState('');
  const [account, setAccount] = useState(NO_ACCOUNT);
  const [error, setError] = useState(null);
  async function submit(event) {
    event.preventDefault();
    try {
      await api('/api/governance/resolutions', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version,
        criterionId: disagreement.criterionId, resolution: text, ...account } });
      onDone();
    } catch (reason) { setError(reason.message); }
  }
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 8 }}>
      <div><code>{disagreement.criterionId}</code> · {Object.entries(disagreement.scores).map(([who, score]) => `${who} ${score}`).join(' vs ')}</div>
      <textarea rows={2} maxLength={pkg.reviewPolicy.maxResolutionChars} required value={text} onChange={(event) => setText(event.target.value)}
        placeholder="How the two reviewers resolved it. Only one of them can record this." />
      <SignIn value={account} onChange={setAccount} />
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
  const review = pkg?.reviewState;

  async function activate() {
    try { await api('/api/governance/activate', { method: 'POST', body: { packageId: pkg.packageId, version: pkg.version } }); setActivation({ ok: true }); load(); }
    catch (reason) { setActivation({ error: reason.message }); }
  }

  return (
    <main className="page">
      <PageHead index="09" title="Governance" sub="Two people outside the authoring role check every claim against its source and score the rubric. Nothing here is automated."
        readouts={[['Awaiting review', packages ? packages.filter((value) => value.state === 'AwaitingReview').length : null],
          ['Approvals', review ? `${review.approvals}/${review.required}` : null], ['Open disagreements', pkg ? pkg.openDisagreements.length : null]]} />
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
                  <td className="num">{value.reviewState ? `${value.reviewState.approvals}/${value.reviewState.required}` : '—'}</td>
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
            <Panel title="Sources" note="Licence status and how each is pinned" flush>
              <ul className="feed">{pkg.sources.map((source) => (
                <li key={source.id}><span className={`dot ${source.licenceStatus === 'settled' ? 'info' : 'warn'}`} />
                  <div><div>{source.title}{source.cited ? '' : ' (not cited)'}</div><div className="faint" style={{ fontSize: 12 }}>{source.issuer} · {source.edition} · {source.kind}</div>
                    <div className="faint" style={{ fontSize: 12 }}>{source.licenceStatus}: {source.licence}</div></div></li>
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
                <tbody>{pkg.reviews.map((item) => (
                  <tr key={item.reviewer}><td><code>{item.reviewer}</code>{item.comment && <div className="faint" style={{ fontSize: 12 }}>{item.comment}</div>}</td>
                    <td className="num">{item.score}</td><td><Pill tone={item.approved ? 'ok' : 'bad'}>{item.approved ? 'approved' : 'not approved'}</Pill></td>
                    <td className="hide-sm faint">{stamp(item.at)}</td></tr>
                ))}</tbody>
              </table> : <Empty title="No review yet">Two people must review this exact version before it can be activated.</Empty>}
            </Panel>
            <Panel title="Open disagreements" note={pkg.reviewPolicy ? `More than ${pkg.reviewPolicy.disagreementSpread} point apart on a criterion` : ''}>
              {pkg.openDisagreements.length ? <div className="stack" style={{ gap: 18 }}>
                {pkg.openDisagreements.map((item) => <Resolve key={item.criterionId} pkg={pkg} disagreement={item} onDone={load} />)}
              </div> : <div className="faint">None.</div>}
            </Panel>
          </div>

          {pkg.state === 'AwaitingReview' && pkg.reviewPolicy && <>
            <Panel title="Your review" note={`${pkg.packageId} v${pkg.version}, digest ${short(pkg.digest, 10, 6)}`}>
              <ReviewForm key={key(pkg)} pkg={pkg} onDone={load} />
            </Panel>
            <Panel title="Activation" note={`Operator step; refused until ${review.required} approvals, a mean of at least ${review.floor} and no open disagreement`}
              action={<button className="btn" onClick={activate} disabled={!review.ready}>Activate this version</button>}>
              {activation?.error ? <div className="notice bad">Refused: {activation.error}</div>
                : <div className="faint">{review.approvals}/{review.required} approvals{review.mean !== null ? `, mean ${review.mean}` : ''}.</div>}
            </Panel>
          </>}
        </div>
      )}
    </main>
  );
}
