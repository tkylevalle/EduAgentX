import { OctagonX } from 'lucide-react';
import { pct, RULE_COPY, short, stamp } from '../../lib.js';
import { TIERS } from '../report.mjs';
import { Bar, Ring } from './parts.jsx';

function Goals({ title, goals, none }) {
  return (
    <section>
      <h3 className="paper-h">{title}</h3>
      {goals.length === 0 ? <p className="paper-none">{none}</p> : (
        <ul className="report-goals">
          {goals.map((goal) => <li key={goal.id}><span>{goal.statement}</span><strong>{pct(goal.percent)}</strong></li>)}
        </ul>
      )}
    </section>
  );
}

/** Every question's score, grouped by part of the exam. */
function Questions({ items }) {
  return (
    <section>
      <h3 className="paper-h">Question by question</h3>
      <div className="report-items">
        {TIERS.map((tier) => (
          <div key={tier.id} className="report-tier">
            <span>{tier.name}</span>
            {items.filter((item) => item.tier === tier.id).map((item, index) => (
              <i key={item.id} data-critical={item.critical || undefined} data-malformed={item.malformed || undefined}
                style={{ '--score': Number.isFinite(item.score) ? item.score : 0 }}
                title={`${tier.name} ${index + 1}${item.critical ? ', broke a safety rule' : item.malformed ? ', answer could not be read' : ''}`}>
                {Number.isFinite(item.score) ? Math.round(item.score) : '—'}
              </i>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Record({ attempt }) {
  const grader = attempt.assessment?.grader;
  return (
    <details className="paper-details">
      <summary>Technical record</summary>
      <dl className="s-rows">
        <dt>Attempt</dt><dd><code>{attempt.attemptId}</code></dd>
        <dt>Result</dt><dd><code>{attempt.terminalReason}</code></dd>
        {grader && <><dt>Grader</dt><dd><code>{grader.id} {grader.version}</code></dd></>}
        <dt>Setup</dt><dd><code>{short(attempt.configurationFingerprint, 18, 8)}</code></dd>
        <dt>Started</dt><dd>{stamp(attempt.startedAt)}</dd>
        <dt>Ended</dt><dd>{stamp(attempt.completedAt || attempt.failedAt || attempt.abortedAt)}</dd>
      </dl>
    </details>
  );
}

/**
 * One exam attempt, as the report card a student takes home.
 * @param {{ attempt: object, report: NonNullable<ReturnType<typeof import('../report.mjs').reportOf>> }} props
 */
export default function ReportCard({ attempt, report }) {
  return (
    <article className="paper report" data-passed={report.passed} aria-label="Report card">
      <header className="paper-head">
        <div>
          <h2 className="paper-title">Report card</h2>
          <p className="paper-who"><code>{attempt.agentLearnerKey}</code><span>{attempt.package?.id} v{attempt.package?.version}</span><span>{stamp(attempt.completedAt || attempt.failedAt)}</span></p>
        </div>
        <span className="stamp" data-tone={report.passed ? 'ok' : 'bad'}>{report.passed ? 'Passed' : 'Failed'}</span>
      </header>
      <div className="report-top">
        <div className="report-score">
          <Ring tone={report.passed ? 'pass' : 'pen'}><strong>{pct(report.overall)}</strong></Ring>
          <span>overall{Number.isFinite(report.overallLine) ? `, ${report.overallLine}% needed to pass` : ''}</span>
        </div>
        <div className="report-bars">
          {report.tiers.map((tier) => (
            <Bar key={tier.id} name={tier.name} percent={tier.percent} line={tier.line} bad={Number.isFinite(tier.line) && tier.percent < tier.line} />
          ))}
        </div>
      </div>
      {report.rules.length > 0 && (
        <ul className="report-rules">
          {report.rules.map((rule) => <li key={rule}><OctagonX size={17} /> {RULE_COPY[rule] || rule} <code>{rule}</code></li>)}
        </ul>
      )}
      {report.rules.length === 0 && report.reasons.length > 0 && (
        <ul className="report-rules">{report.reasons.map((reason) => <li key={reason}><OctagonX size={17} /> {String(reason).replaceAll('_', ' ')}</li>)}</ul>
      )}
      <div className="report-cols">
        <Goals title="Strong" goals={report.strengths} none="No objective passed" />
        <Goals title="Needs work" goals={report.weaknesses} none="Nothing below the line" />
      </div>
      <Questions items={report.items} />
      {report.sandbox && (
        <p className="report-sandbox"><strong>{report.sandbox.episodes}</strong> simulated tool tasks, <strong>{report.sandbox.violations}</strong> safety violations</p>
      )}
      {report.catchUp && (
        <section className="report-catchup">
          <h3 className="paper-h">Catch-up class assigned</h3>
          <ul>{report.catchUp.objectives.map((goal) => <li key={goal}>{goal}</li>)}</ul>
          <p>{report.catchUp.sessionId ? <>Sent to the classroom, session <code>{short(report.catchUp.sessionId, 8, 4)}</code></> : 'Waiting to be sent to the classroom'}</p>
        </section>
      )}
      <Record attempt={attempt} />
    </article>
  );
}
