import { ArrowRight, OctagonX } from 'lucide-react';
import { RULE_COPY } from '../../lib.js';
import { stepOf } from '../../run/reducer.mjs';
import { paperOf } from '../report.mjs';
import { Card, Fact, Problem, Wait } from './parts.jsx';

const CRITERION_NAME = { factual_accuracy: 'Facts', source_traceability: 'Sources', safety: 'Safety', learner_clarity: 'Clarity' };

/** The run's own sitting: only what the platform reported. */
function Sitting({ exam, onGo }) {
  if (exam.status === 'pending') return null;
  if (exam.status === 'running') return <Card tone="live"><p className="s-now">Sitting the exam now</p></Card>;
  const detail = exam.detail || {};
  if (!detail.attemptId) return null;
  const live = detail.live;
  return (
    <Card tone={exam.status === 'passed' ? 'ok' : 'bad'} title={exam.status === 'passed' ? 'Exam passed' : 'Exam failed'}
      aside={<button type="button" className="s-link" onClick={() => onGo('office')}>Report card <ArrowRight size={15} strokeWidth={2.6} /></button>}>
      <div className="s-facts s-facts-row">
        <Fact value={detail.overallPercent} decimals={detail.overallPercent % 1 ? 1 : 0} unit="%" name="overall" />
        <Fact value={detail.itemsAnswered} name="questions answered" />
        {live && <Fact value={live.calls} name={`calls to ${live.model}`} />}
        {live && <Fact value={live.promptTokens + live.completionTokens} name="tokens used" />}
      </div>
    </Card>
  );
}

/** Exam: the paper every student sits, from the active course package. */
export default function ExamPanel({ seen, data, onGo }) {
  const { pkg, pkgError } = data;
  if (pkgError) return <Card><Problem what="The exam paper" error={pkgError} /></Card>;
  if (!pkg) return <Card><Wait rows={5} /></Card>;
  const paper = paperOf(pkg);
  const criteria = pkg.rubric?.criteria || [];
  return (
    <>
      <Sitting exam={stepOf(seen, 'examine')} onGo={onGo} />
      <Card span={7} title="The paper">
        <div className="s-paper-tiers">
          {paper.map((tier) => (
            <div className="s-tier" key={tier.id} data-tier={tier.id}>
              <strong>{tier.slots}</strong>
              <span className="s-tier-name">{tier.name}</span>
              <span className="s-slots">{Array.from({ length: tier.slots }, (_, index) => <i key={index} />)}</span>
            </div>
          ))}
        </div>
        <div className="s-facts s-facts-row">
          <Fact value={pkg.exam?.overallPassPercent ?? null} unit="%" name="needed overall" />
          <Fact value={pkg.exam?.adversarialPassPercent ?? null} unit="%" name="needed under attack" />
        </div>
      </Card>
      <Card span={5} title="Instant fail" tone="bad">
        <ul className="s-rules">
          {Object.entries(RULE_COPY).map(([id, text]) => <li key={id}><OctagonX size={16} /> {text}</li>)}
        </ul>
        {criteria.length > 0 && (
          <>
            <h3 className="s-h3">Each answer is marked on</h3>
            <div className="s-weights">
              {criteria.map((criterion) => (
                <span key={criterion.id} style={{ flexGrow: criterion.weight }}>
                  <strong>{criterion.weight}</strong>{CRITERION_NAME[criterion.id] || criterion.id.replaceAll('_', ' ')}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
