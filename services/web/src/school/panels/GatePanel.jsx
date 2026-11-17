import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { short } from '../../lib.js';
import { startRun } from '../../run/store.js';
import { stepOf } from '../../run/reducer.mjs';
import { schoolNumbers, stopReason } from '../report.mjs';
import { STUDENTS, studentKind, studentOf } from '../students.js';
import { Card, Fact, Problem } from './parts.jsx';

const TYPING = 'input, textarea, select, [contenteditable="true"]';
const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The seven students. Keys 1 to 7 select, arrows move, Enter enrols.
 * @param {{ liveModel: { available: boolean, model?: string }, last: string|null, span?: number }} props last: the student of the previous run
 */
export function Chooser({ liveModel, last, span = 8 }) {
  const usable = (student) => !student.live || liveModel.available;
  const [picked, setPicked] = useState(() => last || STUDENTS[0].id);
  const student = studentOf(picked);
  const group = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      const chosen = STUDENTS[Number(event.key) - 1];
      if (!chosen || !usable(chosen) || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.(TYPING)) return;
      setPicked(chosen.id);
      // Focus goes with the choice, so Enter enrols the student just selected.
      group.current?.querySelector(`[data-student="${chosen.id}"]`)?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [liveModel.available]);

  const onArrow = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); startRun(picked); return; }
    if (!STEP[event.key]) return;
    event.preventDefault();
    const choices = STUDENTS.filter(usable);
    const next = choices[(choices.findIndex((entry) => entry.id === picked) + STEP[event.key] + choices.length) % choices.length];
    setPicked(next.id);
    event.currentTarget.querySelector(`[data-student="${next.id}"]`)?.focus();
  };

  return (
    <Card span={span} title="Choose a student" fix="clip">
      <div ref={group} className="s-students" role="radiogroup" aria-label="Students" onKeyDown={onArrow}>
        {STUDENTS.map((entry, index) => (
          <button key={entry.id} type="button" role="radio" className="s-pick" data-student={entry.id} data-live={entry.live || undefined}
            aria-checked={entry.id === picked} tabIndex={entry.id === picked ? 0 : -1} disabled={!usable(entry)}
            onClick={() => setPicked(entry.id)} onDoubleClick={() => startRun(entry.id)}>
            <span className="s-pick-top"><span className="kbd">{index + 1}</span><span className="s-tag" data-live={entry.live || undefined}>{studentKind(entry, liveModel)}</span></span>
            <strong className="s-pick-name">{entry.name}</strong>
            <span className="s-pick-trait">{entry.live && !liveModel.available ? 'No live model is set up on this platform' : entry.trait}</span>
          </button>
        ))}
      </div>
      <button type="button" className="s-go" onClick={() => startRun(picked)}>
        Enrol {student.name}
      </button>
    </Card>
  );
}

/** The enrolment record: only facts the run has reported so far. */
function Record({ seen, playing, liveModel, span }) {
  const student = studentOf(seen.scenario);
  const course = stepOf(seen, 'package');
  const enrolled = stepOf(seen, 'register');
  const reviewers = (course.detail?.reviews || []).map((review) => review.reviewer);
  return (
    <Card span={span} title={student?.name || seen.scenario} fix="pin"
      aside={student && <span className="s-tag" data-live={student.live || undefined}>{studentKind(student, liveModel)}</span>}>
      {student && <p className="s-lead">{student.trait}</p>}
      <dl className="s-rows">
        {course.status === 'passed' && (
          <>
            <dt>Course</dt>
            <dd><code>{course.detail.packageId}</code> v{course.detail.version}
              <span className="s-ok"><Check size={13} strokeWidth={3} /> {course.detail.reused ? 'Approved earlier' : reviewers.length ? `Approved by ${reviewers.join(' and ')}` : 'Approved'}</span></dd>
          </>
        )}
        {enrolled.status === 'passed' && (
          <>
            <dt>Student ID</dt><dd><code>{enrolled.detail.agentLearnerKey}</code></dd>
            <dt>Setup</dt><dd>Version {enrolled.detail.configurationVersion}, fingerprint <code>{short(enrolled.detail.configurationFingerprint, 14, 6)}</code></dd>
          </>
        )}
      </dl>
      {course.status === 'pending' && playing && <p className="s-lead">Arriving</p>}
    </Card>
  );
}

/** The school's counters. @param {{ data: object, span: number }} props */
export function Numbers({ data, span }) {
  const numbers = schoolNumbers(data.overview, data.credentials);
  return (
    <Card span={span} title="This school" kind="manila">
      {data.credentialsError && <Problem what="The diploma list" error={data.credentialsError} />}
      {data.overviewError && <Problem what="The school's counters" error={data.overviewError} />}
      <div className={span === 12 ? 's-facts s-facts-row' : 's-facts'}>
        <Fact value={numbers.diplomas} name="diplomas issued" />
        <Fact value={numbers.inGoodStanding} name="in good standing" />
        <Fact value={numbers.classes} name="classes completed" />
        <Fact value={numbers.catchUp} name="catch-up classes" />
        <Fact value={numbers.signingMs} unit="ms" name="to sign a diploma, 95th percentile" />
      </div>
    </Card>
  );
}

/** Enrol: choose a student and start a real run. */
export default function GatePanel({ run, seen, playing, data, status }) {
  const stopped = !playing && run.outcome?.status === 'failed' && !stepOf(run, 'examine').detail?.attemptId;
  const hasRecord = Boolean(seen.scenario);
  return (
    <>
      {stopped && <Card tone="bad"><p className="s-problem" role="alert">The run stopped: {stopReason(run.outcome.error)}</p></Card>}
      {!playing && <Chooser liveModel={status.liveModel} last={run.scenario} />}
      {hasRecord && <Record seen={seen} playing={playing} liveModel={status.liveModel} span={playing ? 8 : 4} />}
      <Numbers data={data} span={playing || !hasRecord ? 4 : 12} />
    </>
  );
}
