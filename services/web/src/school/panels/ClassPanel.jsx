import { Check, ShieldAlert } from 'lucide-react';
import { stepOf } from '../../run/reducer.mjs';
import { Card, Fact, Problem, Wait } from './parts.jsx';

/** What the run's class delivered. Shown only when the platform reported it. */
function Session({ train, pkg }) {
  if (train.status === 'pending') return null;
  if (train.status === 'running') return <Card tone="live"><p className="s-now">Class in session</p></Card>;
  if (train.status === 'failed') return null;
  const detail = train.detail || {};
  const catchUp = detail.kind === 'remediation';
  const topics = (detail.remediationObjectiveIds || []).map((id) => pkg?.objectives?.find((entry) => entry.id === id)?.statement || id);
  return (
    <Card tone="ok" title={catchUp ? 'Catch-up class done' : 'Class done'}>
      <div className="s-facts s-facts-row">
        <Fact value={detail.itemsDelivered} name="lessons and practice items delivered" />
        <Fact value={(detail.modules || []).length} name="lessons covered" />
        <Fact value="None" name="changes to the model itself" />
      </div>
      {catchUp && topics.length > 0 && (
        <ul className="s-list">{topics.map((topic) => <li key={topic}>{topic}</li>)}</ul>
      )}
    </Card>
  );
}

/** Class: the course the student is taught, from the active course package. */
export default function ClassPanel({ seen, data }) {
  const { pkg, pkgError } = data;
  const train = stepOf(seen, 'train');
  const done = train.status === 'passed' ? train.detail?.modules || [] : [];
  if (pkgError) return <Card><Problem what="The course" error={pkgError} /></Card>;
  if (!pkg) return <Card><Wait rows={5} /></Card>;
  const sourceOf = (id) => pkg.sources?.find((entry) => entry.id === id);
  return (
    <>
      <Session train={train} pkg={pkg} />
      <Card span={7} title="Lessons" fix="tape" aside={<code className="s-meta">{pkg.packageId} v{pkg.version}</code>}>
        <ol className="s-lessons">
          {(pkg.modules || []).map((lesson, index) => (
            <li key={lesson.id} data-done={done.includes(lesson.id) || undefined}>
              <span className="s-lesson-mark">{done.includes(lesson.id) ? <Check size={14} strokeWidth={3.2} /> : index + 1}</span>
              <strong>{lesson.title}</strong>
              <span className="s-lesson-src">
                {(lesson.sources || []).map(sourceOf).filter(Boolean).map((source) => (
                  <a key={source.id} href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.issuer}, {source.title}</a>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card span={5} title="It must be able to" fix="pin">
        <ul className="s-goals">
          {(pkg.objectives || []).map((goal) => (
            <li key={goal.id} data-critical={goal.safetyCritical || undefined}>
              {goal.statement}
              {goal.safetyCritical && <span className="s-flag"><ShieldAlert size={12} /> Safety-critical</span>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
