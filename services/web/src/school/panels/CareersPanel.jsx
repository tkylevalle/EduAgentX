import { useState } from 'react';
import { api, pct, short, stamp } from '../../lib.js';
import { Card, Problem, Ring } from './parts.jsx';

// The careers office: an employer posts a job, and the marketplace ranks the
// graduates whose diplomas it can check. Only one course is validated end to
// end, so every job here asks for that course; the Operator page has every field.
const SUPPORTED_DOMAIN = 'ai-agent-safety-secure-tool-use';
// The lowest scores the marketplace accepts in a job request.
const OVERALL_FLOOR = 80;
const ATTACK_FLOOR = 70;
const FIRST_JOB = { title: 'Tool-use operator', minOverallPercent: OVERALL_FLOOR, minAdversarialPercent: ATTACK_FLOOR, maxCredentialAgeDays: 90 };
const PARTS = [['totalPerformance', 'Overall score'], ['adversarialPerformance', 'Under attack'], ['preferredCoverage', 'Extra skills'], ['credentialRecency', 'How recent']];
const plain = (text) => String(text || '').replaceAll('_', ' ').toLowerCase();

/** Creates the job, opens it and asks for the matches. Each call is a real request to the marketplace. */
async function postJob(job, objectiveIds) {
  const request = {
    title: job.title.trim(), domain: SUPPORTED_DOMAIN, requiredObjectiveIds: objectiveIds,
    minOverallPercent: Number(job.minOverallPercent), minAdversarialPercent: Number(job.minAdversarialPercent),
    maxCredentialAgeDays: Number(job.maxCredentialAgeDays), allowedAssessmentModes: ['standard'], requiredEnvironment: 'simulation',
  };
  const created = await api('/api/marketplace/capability-requests', { method: 'POST', body: { idempotencyKey: crypto.randomUUID(), request } });
  const { version } = created.request.versions.at(-1);
  await api(`/api/marketplace/capability-requests/${created.request.id}/open`, { method: 'POST', body: { version } });
  const reply = await api(`/api/marketplace/capability-requests/${created.request.id}/matches`, { method: 'POST', body: { idempotencyKey: crypto.randomUUID() } });
  return reply.matchResult;
}

function JobForm({ objectiveIds, busy, onPost }) {
  const [job, setJob] = useState(FIRST_JOB);
  const field = (key) => ({ value: job[key], onChange: (event) => setJob({ ...job, [key]: event.target.value }) });
  const submit = (event) => { event.preventDefault(); onPost(job); };
  return (
    <form className="s-form" onSubmit={submit}>
      <label className="wide">Job title<input required maxLength={120} {...field('title')} /></label>
      <label>Lowest overall score, %<input type="number" min={OVERALL_FLOOR} max={100} required {...field('minOverallPercent')} /></label>
      <label>Lowest score under attack, %<input type="number" min={ATTACK_FLOOR} max={100} required {...field('minAdversarialPercent')} /></label>
      <label className="wide">Oldest diploma accepted, in days<input type="number" min={1} max={365} required {...field('maxCredentialAgeDays')} /></label>
      <p className="s-lead wide">{objectiveIds.length ? `The job asks for all ${objectiveIds.length} skills of the course.` : 'The course did not load, so the job cannot name its skills yet.'}</p>
      <button type="submit" className="s-go wide" disabled={busy || !objectiveIds.length}>{busy ? 'Finding graduates' : 'Post the job'}</button>
    </form>
  );
}

function Candidate({ item, near }) {
  return (
    <li className="job-match" data-near={near || undefined}>
      <div className="job-rank">{item.rank}</div>
      <div className="job-who">
        <strong><code>{short(item.agentLearnerKey, 16, 6)}</code></strong>
        <span className="s-meta">diploma issued {stamp(item.issuedAt)}</span>
        <ul className="job-parts">
          {PARTS.map(([key, name]) => <li key={key}><strong>{item.components[key].points.toFixed(1)}</strong>{name}</li>)}
        </ul>
        {item.gaps.length > 0 && <p className="job-gaps">Missing: {item.gaps.map((gap) => `${plain(gap.code)}${gap.objectiveId ? ` (${gap.objectiveId})` : ''}`).join(', ')}</p>}
      </div>
      <div className="job-score"><Ring tone={near ? 'pen' : 'pass'}><strong>{pct(item.matchScore)}</strong></Ring><span>match</span></div>
    </li>
  );
}

function Matches({ result }) {
  if (result.outcome === 'UNSUPPORTED_DOMAIN') return <Problem what="A match" error="this school teaches one course, and the job asks for another" />;
  if (result.outcome === 'INVALID_REQUEST') return <Problem what="A match" error="the marketplace refused the job as written" />;
  return (
    <>
      <h3 className="s-h3">Ready to hire: {result.totalEligible}</h3>
      {result.eligibleMatches.length === 0 && <p className="s-lead">No graduate meets every requirement of this job.</p>}
      <ul className="job-list">{result.eligibleMatches.map((item) => <Candidate key={item.credentialId} item={item} />)}</ul>
      <h3 className="s-h3">Close, with a gap: {result.totalNearMatches}</h3>
      <ul className="job-list">{result.nearMatches.map((item) => <Candidate key={item.credentialId} item={item} near />)}</ul>
      <h3 className="s-h3">Not considered: {result.exclusions.length}</h3>
      <ul className="job-out">
        {result.exclusions.map((item, index) => (
          <li key={index}><code>{short(item.agentLearnerKey || 'unknown', 14, 4)}</code>{item.reasons.map((reason) => plain(reason.code)).join(', ')}</li>
        ))}
      </ul>
      <p className="s-meta">{result.notice} Policy {result.policyVersion}, {stamp(result.generatedAt)}.</p>
    </>
  );
}

/** Careers office: post a job and see which graduates the marketplace can stand behind. */
export default function CareersPanel({ data, status }) {
  const [state, setState] = useState({ result: null, candidate: null, busy: false, error: null });
  const objectiveIds = (data.pkg?.objectives || []).map((objective) => objective.id);
  const marketUp = status.health?.find((service) => service.id === 'marketplace-service')?.healthy;
  const post = async (job) => {
    setState((now) => ({ ...now, busy: true, error: null }));
    try { const result = await postJob(job, objectiveIds); setState((now) => ({ ...now, result, busy: false })); }
    catch (error) { setState((now) => ({ ...now, busy: false, error: error.data?.details ? `${error.message}: ${error.data.details.join(', ')}` : error.message })); }
  };
  const certify = async () => {
    setState((now) => ({ ...now, busy: true, error: null }));
    try { const candidate = await api('/api/marketplace/candidate', { method: 'POST', body: {} }); setState((now) => ({ ...now, candidate, busy: false })); }
    catch (error) { setState((now) => ({ ...now, busy: false, error: error.data?.step ? `the ${error.data.step} step failed, ${error.data.reason}` : error.message })); }
  };

  return (
    <>
      <div className="s-col" data-span={5}>
        <Card title="Post a job" fix="clip">
          {marketUp === false && <Problem what="The marketplace" error="it is not answering. Diplomas are not affected" />}
          <JobForm objectiveIds={objectiveIds} busy={state.busy} onPost={post} />
        </Card>
        <Card kind="manila" title="Need a candidate?">
          <p className="s-lead">Trains, examines and lists one more scripted agent, whose work the marketplace can check.</p>
          <div className="s-actions">
            <button type="button" className="s-link" onClick={certify} disabled={state.busy}>Certify a candidate</button>
            <button type="button" className="s-link" data-quiet onClick={() => { window.location.hash = '/marketplace'; }}>Every option in Operator Mode</button>
          </div>
          {state.candidate && (
            <p className="s-lead job-new"><code>{state.candidate.agentLearnerKey}</code> was examined ({plain(state.candidate.terminalReason)}) and is {state.candidate.discoverable ? 'listed. Post the job to see the ranking' : 'not listed'}.</p>
          )}
        </Card>
      </div>
      <Card span={7} title="Matches" fix="pin">
        {state.error && <Problem what="The job" error={state.error} />}
        {!state.result && !state.error && <p className="s-lead">No job is posted yet. Post one, and the marketplace ranks the graduates it can check.</p>}
        {state.result && <Matches result={state.result} />}
      </Card>
    </>
  );
}
