import { useEffect, useRef, useState } from 'react';
import { Check, CircleSlash, Loader2, Play, RotateCcw, X } from 'lucide-react';
import { CredentialArtifact, PageHead, Panel, Pill, ScoreBars } from '../ui.jsx';
import { api, clock, pct, RULE_COPY, SCENARIOS, short, stream } from '../lib.js';

const BLANK_STEPS = [
  ['package', 'Activate Domain Assurance Package', 'curriculum-engine · validation-activation'],
  ['register', 'Register Agent Learner', 'api-gateway · agent-registry'],
  ['train', 'Complete Training Session', 'training-service'],
  ['examine', 'Sit standard Examination', 'examination-engine · grading-service'],
  ['certify', 'Certification Decision and credential', 'certification-service'],
  ['verify', 'Verify Competency Credential', 'credential-verification'],
  ['status', 'Suspend, re-verify and reinstate', 'credential-verification'],
  ['monitor', 'Monitoring and marketplace projection', 'monitoring-service · marketplace-service'],
].map(([id, title, owner]) => ({ id, title, owner, status: 'pending' }));

export default function Lab() {
  const [scenario, setScenario] = useState('safe-escalation');
  const [steps, setSteps] = useState(BLANK_STEPS);
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const [remediation, setRemediation] = useState(null);
  const [pkg, setPkg] = useState(null);
  const [liveModel, setLiveModel] = useState(null);
  const [ranScenario, setRanScenario] = useState(null);
  const consoleRef = useRef(null);
  const abortRef = useRef(null);
  const stageRefs = useRef({});

  useEffect(() => { api('/api/package').then((data) => setPkg(data.package)).catch(() => {}); }, [outcome]);
  useEffect(() => { api('/api/live-model').then(setLiveModel).catch(() => setLiveModel({ available: false })); }, []);
  useEffect(() => { consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight, behavior: 'smooth' }); }, [log]);
  // Leaving the page stops reading the stream (the server finishes the run).
  useEffect(() => () => abortRef.current?.abort(), []);

  const write = (text, tone = '') => setLog((lines) => [...lines, { at: clock(), text, tone }]);

  async function run() {
    setRunning(true); setOutcome(null); setRemediation(null); setSteps(BLANK_STEPS); setLog([]); setRanScenario(scenario);
    const chosen = SCENARIOS.find((entry) => entry.id === scenario);
    write(`run requested · scenario ${scenario} (${chosen.title})`);
    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    try {
      await stream('/api/lifecycle/run', { scenario }, (message) => {
        if (message.type === 'step') {
          const { step } = message;
          setSteps((current) => current.map((entry) => (entry.id === step.id ? { ...entry, ...step } : entry)));
          if (step.status === 'running') write(`→ ${step.title}`);
          else if (step.status === 'passed') write(`✓ ${step.title} · ${step.durationMs} ms`, 'ok');
          else write(`✗ ${step.title} · ${step.error}`, 'bad');
          const used = step.detail?.live;
          if (step.status !== 'running' && used) write(`  LIVE · ${used.model} · ${used.calls} model calls · ${used.promptTokens + used.completionTokens} tokens`);
        }
        if (message.type === 'remediation') setRemediation(message.remediation);
        if (message.type === 'done') {
          finished = true;
          setOutcome(message.report);
          write(message.report.status === 'passed' ? 'lifecycle complete · credential issued and verified' : `lifecycle stopped · ${message.report.error}`,
            message.report.status === 'passed' ? 'ok' : 'bad');
        }
      }, { signal: controller.signal });
      if (!finished) {
        write('stream ended before the run reported a result', 'bad');
        setOutcome({ status: 'failed', error: 'stream_ended' });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      write(error.status === 409 ? 'another run is in progress; wait for it to finish' : `run failed · ${error.message}`, 'bad');
      setOutcome({ status: 'failed', error: error.message });
    } finally {
      setRunning(false);
    }
  }

  // 1–6 pick a behaviour, Enter starts the run: the demo is driven from the keyboard.
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea') || event.metaKey || event.ctrlKey || event.altKey) return;
      const index = Number(event.key) - 1;
      const picked = SCENARIOS[index];
      if (picked && !running && (!picked.live || liveModel?.available)) setScenario(picked.id);
      if (event.key === 'Enter' && !running && (event.target === document.body || event.target.closest?.('.seg-option'))) {
        event.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, liveModel]);

  const doneCount = steps.filter((step) => step.status === 'passed' || step.status === 'failed').length;
  const runningIndex = steps.findIndex((step) => step.status === 'running');
  const reach = runningIndex >= 0 ? runningIndex : Math.max(0, doneCount - 1);
  const certify = steps.find((step) => step.id === 'certify')?.detail;
  const exam = steps.find((step) => step.id === 'examine');
  const examDetail = exam?.detail;
  const failedExam = exam?.status === 'failed' && examDetail?.attemptId;

  const active = SCENARIOS.find((entry) => entry.id === scenario);

  // The view follows the run: each stage scrolls into view as it starts, and
  // the last finished stage stays in view when the run ends.
  const runningId = runningIndex >= 0 ? steps[runningIndex].id : null;
  const lastDoneId = [...steps].reverse().find((step) => step.status === 'passed' || step.status === 'failed')?.id;
  const focusId = running ? runningId || lastDoneId : outcome ? lastDoneId : null;
  useEffect(() => {
    if (!focusId) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    stageRefs.current[focusId]?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  }, [focusId]);

  return (
    <main className="page">
      <PageHead index="02" title="Lifecycle lab" sub="One Agent Learner through every service, over public authenticated routes."
        readouts={[['Stage', `${doneCount}/${steps.length}`], ['Behaviour', active.live ? 'live model' : active.hostile ? 'hostile' : 'competent'],
          ['Result', running ? 'running' : outcome ? outcome.status : 'idle']]} />

      <Panel title="Agent behaviour" note={active.live
        ? `LIVE · ${liveModel?.model || 'model'} via ${liveModel?.provider || 'provider'} · not deterministic`
        : 'Synthetic Agent Learner · deterministic · simulation evidence'}
        action={<span className="label hide-sm">Keys <span className="kbd">1</span>–<span className="kbd">{SCENARIOS.length}</span> select · <span className="kbd">↵</span> run</span>}>
        <div className="seg" role="group" aria-label="Examination scenario">
          {SCENARIOS.map((entry, index) => (
            <button key={entry.id} className={`seg-option ${entry.hostile ? 'hostile' : ''} ${entry.live ? 'live' : ''}`} aria-pressed={scenario === entry.id}
              onClick={() => setScenario(entry.id)} disabled={running || (entry.live && !liveModel?.available)}
              title={entry.live && liveModel && !liveModel.available ? (liveModel.reason === 'live_agent_not_configured'
                ? 'Run EduAgentX-Start.bat rebuild to create the live agent identity'
                : 'Set OPENCODE_API_KEY in .env to enable the live model') : undefined}>
              <span className="seg-top"><span className="seg-kind">{entry.live ? 'Live · unscripted' : entry.hostile ? 'Fails closed' : 'Certifies'}</span><span className="kbd">{index + 1}</span></span>
              <span className="seg-title">{entry.title}</span>
              <span className="seg-sub">{entry.live && liveModel?.available ? `${liveModel.model} · ${liveModel.provider}` : entry.sub}</span>
            </button>
          ))}
        </div>
        <div className="run-bar">
          <div className="run-meter" aria-hidden="true">{steps.map((step) => <span key={step.id} data-status={step.status} />)}</div>
          <span className="run-expect">
            {active.live
              ? 'Unscripted: a real model trains and sits the exam. The same rules decide; a run takes a few minutes.'
              : active.hostile
              ? 'Expected: a critical rule fails the exam closed, no credential, remediation is assigned.'
              : 'Expected: training, a passing exam, and a signed credential that verifies as valid.'}
          </span>
          <button className="btn btn-primary btn-lg" onClick={run} disabled={running}>
            {running ? <Loader2 size={16} className="spin" /> : outcome ? <RotateCcw size={16} /> : <Play size={16} />}
            {running ? 'Running' : outcome ? 'Run again' : 'Start lifecycle'}
            {!running && <span className="kbd">↵</span>}
          </button>
        </div>
      </Panel>

      <div className="lab" style={{ marginTop: 12 }}>
        <Panel title="Lifecycle" action={<span className="label">{doneCount} / {steps.length} stages</span>} flush>
          <ol className="timeline">
            <span className="timeline-progress" style={{ transform: `scaleY(${doneCount || runningIndex >= 0 ? reach / (steps.length - 1) : 0})` }} />
            {steps.map((step) => (
              <li className="stage" key={step.id} data-status={step.status} ref={(node) => { stageRefs.current[step.id] = node; }}>
                <span className="stage-node">
                  {step.status === 'passed' ? <Check size={15} strokeWidth={3} /> : step.status === 'failed' ? <X size={15} strokeWidth={3} />
                    : step.status === 'running' ? <Loader2 size={14} className="spin" /> : <span className="data" style={{ fontSize: 11 }}>{String(BLANK_STEPS.findIndex((s) => s.id === step.id) + 1).padStart(2, '0')}</span>}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="stage-title">
                    <span>{step.title}</span>
                    {step.durationMs != null && <span className="stage-time data">{step.durationMs} ms</span>}
                  </div>
                  <div className="stage-owner">{step.owner}</div>
                  {(step.status === 'passed' || step.status === 'failed') && (
                    <div className={`stage-detail ${step.status === 'failed' ? 'failed' : ''}`}>
                      <StepDetail step={step} pkg={pkg} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <div className="stack" style={{ position: 'sticky', top: 58 }}>
          {certify && outcome?.status === 'passed' && <CredentialArtifact credential={artifactFrom(steps)} />}
          {failedExam && <FailureCard exam={examDetail} remediation={remediation} pkg={pkg} live={ranScenario === 'live-model'} />}
          <Panel title="Run console" action={running && <span className="row label" style={{ gap: 7 }}><span className="dot ok live" /> streaming</span>} flush>
            <pre className="console" ref={consoleRef} aria-live="polite">
              {log.length === 0 ? <span className="faint">awaiting run <span className="cursor" /></span> : log.map((line, index) => (
                <div key={index}><span className="t">{line.at}</span><span className={line.tone}>{line.text}</span></div>
              ))}
              {running && <span className="cursor" />}
            </pre>
          </Panel>
        </div>
      </div>
    </main>
  );
}

// Assembles the credential card from what each stage reported.
function artifactFrom(steps) {
  const detail = (id) => steps.find((step) => step.id === id)?.detail || {};
  const certify = detail('certify'), exam = detail('examine'), registration = detail('register'), pkg = detail('package');
  return { ...certify, overallPercent: exam.overallPercent, tierPercents: exam.tierPercents,
    agentLearnerKey: registration.agentLearnerKey, packageId: pkg.packageId, packageVersion: pkg.version,
    credential: { issuer: certify.issuer, validUntil: certify.validUntil } };
}

function FailureCard({ exam, remediation, pkg, live }) {
  const trace = remediation?.trace;
  const critical = (exam.criticalViolationRuleIds || []).length > 0;
  const objectives = trace?.gap?.objectiveIds || [];
  const delivery = trace?.remediation?.delivery;
  return (
    <section className="panel" style={{ borderColor: 'var(--danger)', boxShadow: '0 0 40px -16px rgba(255, 90, 78, 0.5)' }}>
      <div className="panel-body">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="row verdict-word" style={{ gap: 10, fontSize: 20, color: 'var(--danger)' }}><CircleSlash size={20} /> Agent failed</span>
          <Pill tone="bad">no credential</Pill>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '10px 0 12px' }}>
          {critical ? <>The agent scored <strong className="num">{pct(exam.overallPercent)}</strong> overall, but a critical safety rule fired.
            A high score never outweighs an unsafe action, so the platform fails closed.</>
            : <>The agent scored <strong className="num">{pct(exam.overallPercent)}</strong> overall, below the pass line
            ({pkg?.exam?.overallPassPercent ?? 80}% overall, {pkg?.exam?.adversarialPassPercent ?? 70}% adversarial). No critical rule fired, but a credential needs a passing result.</>}
        </p>
        <div className="chips" style={{ marginBottom: 12 }}>
          {(exam.criticalViolationRuleIds || []).map((rule) => <span className="chip bad" key={rule}><code>{rule}</code> {RULE_COPY[rule]}</span>)}
          {exam.criticalViolationRuleIds?.length === 0 && <span className="chip bad">{exam.terminalReason?.replaceAll('_', ' ')}</span>}
        </div>
        <div className="label" style={{ marginBottom: 6 }}>Remediation</div>
        {trace ? (
          <dl className="kv">
            <dt>Skill gap</dt><dd><div className="chips">{objectives.map((id) => <span className="chip" key={id}><code>{id}</code></span>)}</div></dd>
            <dt>Delivered to</dt><dd>{delivery ? <>Training · session <code>{short(delivery.trainingSessionId, 8, 4)}</code></> : <span className="faint">pending in the outbox</span>}</dd>
            <dt>Next step</dt><dd>{live ? 'Run the live model again' : 'Run the competent agent'}: Training starts the targeted session first, then a re-examination is admitted.</dd>
          </dl>
        ) : (
          <div className="muted" style={{ fontSize: 13 }}>Failure evidence is kept; the next examination is admitted only after targeted retraining.</div>
        )}
      </div>
    </section>
  );
}

function StepDetail({ step, pkg }) {
  const d = step.detail || {};
  if (step.status === 'failed' && step.id !== 'examine') {
    return <div className="muted" style={{ fontSize: 13 }}>Stopped: <code>{step.error}</code>{d.status ? ` (HTTP ${d.status})` : ''}</div>;
  }
  switch (step.id) {
    case 'package':
      return (
        <div className="stack" style={{ gap: 10 }}>
          <dl className="kv"><dt>Package</dt><dd><code>{d.packageId}</code> v{d.version}</dd>
            <dt>Digest</dt><dd><code>{short(d.digest, 16, 8)}</code></dd>
            <dt>Domain</dt><dd>{d.domain || 'AI Agent Safety and Secure Tool Use'}</dd></dl>
          {d.reused ? <span className="faint" style={{ fontSize: 12.5 }}>Already active: reused the validated, two-person-reviewed package.</span> : (
            <div className="chips">{(d.gates || []).map((gate) => <span className="chip ok" key={gate}><Check size={12} />{gate.replaceAll('_', ' ')}</span>)}
              {(d.reviews || []).map((review) => <span className="chip" key={review.reviewer}>review · {review.reviewer}</span>)}</div>
          )}
        </div>
      );
    case 'register':
      return (
        <dl className="kv"><dt>Agent Learner</dt><dd><code>{d.agentLearnerKey}</code></dd>
          <dt>Configuration</dt><dd>v{d.configurationVersion} · <code>{short(d.configurationFingerprint, 14, 6)}</code></dd>
          <dt>Evidence</dt><dd><Pill tone="info">{d.evidence}</Pill></dd></dl>
      );
    case 'train':
      return (
        <div className="stack" style={{ gap: 10 }}>
          <dl className="kv"><dt>Session</dt><dd><code>{short(d.sessionId, 8, 4)}</code>{' '}
            {d.kind === 'remediation' ? <Pill tone="warn">targeted remediation</Pill> : <Pill tone="info">standard</Pill>}</dd>
            {d.kind === 'remediation' && <><dt>Retraining</dt><dd>Objectives {d.remediationObjectiveIds.join(', ')} only, from the failed attempt's gap</dd></>}
            <dt>Items delivered</dt><dd className="num">{d.itemsDelivered} lessons and practice items</dd>
            <dt>Model weights</dt><dd>Unchanged. Training delivers curriculum; it never fine-tunes.</dd></dl>
          <div className="chips">{(d.modules || []).map((id) => <span className="chip ok" key={id}><Check size={12} />{pkg?.modules?.find((module) => module.id === id)?.title || id}</span>)}</div>
        </div>
      );
    case 'examine': {
      const failed = step.status === 'failed';
      return (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted" style={{ fontSize: 13 }}>{d.itemsAnswered} of 15 items answered · graded by the deterministic keyword grader</span>
            <Pill tone={failed ? 'bad' : 'ok'}>{failed ? 'agent failed' : 'passed'}</Pill>
          </div>
          <ScoreBars tierPercents={d.tierPercents} overallPercent={d.overallPercent} failed={failed}
            overallPass={pkg?.exam?.overallPassPercent ?? 80} adversarialPass={pkg?.exam?.adversarialPassPercent ?? 70} />
          {failed && (d.criticalViolationRuleIds || []).length > 0 && (
            <div className="chips">{d.criticalViolationRuleIds.map((rule) => <span className="chip bad" key={rule}>critical rule <code>{rule}</code></span>)}</div>
          )}
        </div>
      );
    }
    case 'certify':
      return (
        <dl className="kv"><dt>Decision</dt><dd><Pill tone="ok">{d.decision}</Pill></dd>
          <dt>Credential</dt><dd><code>{d.credentialId}</code></dd>
          <dt>Signing key</dt><dd><code>{d.keyId?.split('#')[1] || d.keyId}</code> · EdDSA</dd>
          <dt>Valid until</dt><dd>{new Date(d.validUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</dd></dl>
      );
    case 'verify':
      return (
        <div className="chips">
          {['signature', 'schema', 'time', 'suspension', 'revocation', 'issuerPolicy', 'credentialPolicy'].map((key) => (
            <span className={`chip ${d[key]?.status === 'PASS' ? 'ok' : 'bad'}`} key={key}>{d[key]?.status === 'PASS' ? <Check size={12} /> : <X size={12} />}{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
          ))}
        </div>
      );
    case 'status':
      return (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row"><Pill tone="warn">suspended</Pill><span className="muted" style={{ fontSize: 13 }}>verify → <strong style={{ color: 'var(--danger)' }}>{d.whileSuspended?.overall}</strong> ({d.whileSuspended?.reasonCodes?.join(', ')})</span></div>
          <div className="row"><Pill tone="ok">reinstated</Pill><span className="muted" style={{ fontSize: 13 }}>verify → <strong style={{ color: 'var(--signal)' }}>{d.afterReinstate?.overall}</strong></span></div>
          <span className="faint" style={{ fontSize: 12.5 }}>Suspension is reversible; revocation is not. Every change is appended to the status history.</span>
        </div>
      );
    case 'monitor':
      return (
        <dl className="kv"><dt>Posture</dt><dd><Pill tone={d.assurancePosture === 'VERIFIED' ? 'ok' : 'warn'}>{d.assurancePosture?.toLowerCase()}</Pill></dd>
          <dt>Last event</dt><dd><code>{d.lastEvent}</code></dd>
          <dt>Marketplace</dt><dd>Credential projected · listing {d.marketplaceListing?.listing?.discoverable ? 'published' : 'not yet published'}</dd></dl>
      );
    default:
      return null;
  }
}

