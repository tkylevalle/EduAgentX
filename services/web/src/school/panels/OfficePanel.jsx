import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ago, pct } from '../../lib.js';
import { stepOf } from '../../run/reducer.mjs';
import { useApi } from '../data.js';
import { reportOf } from '../report.mjs';
import { Card, Problem, Wait } from './parts.jsx';
import ReportCard from './ReportCard.jsx';

/** The report cards a visitor can open: this run's exam, then every exam that earned a diploma. */
function Files({ runAttempt, credentials, error, chosen, onPick }) {
  return (
    <Card span={4} title="On file">
      {error && <Problem what="The list of past exams" error={error} />}
      {!credentials && !error && <Wait />}
      <ul className="s-files">
        {runAttempt && (
          <li><button type="button" aria-pressed={chosen === runAttempt} onClick={() => onPick(runAttempt)}>
            <strong>This run</strong>
          </button></li>
        )}
        {(credentials || []).filter((entry) => entry.examinationId !== runAttempt).map((entry) => (
          <li key={entry.credentialId}><button type="button" aria-pressed={chosen === entry.examinationId} onClick={() => onPick(entry.examinationId)}>
            <code>{entry.agentLearnerKey}</code><strong>{pct(entry.overallPercent)}</strong><span>{ago(entry.issuedAt)}</span>
          </button></li>
        ))}
      </ul>
      {credentials?.length === 0 && !runAttempt && <p className="s-lead">No exam has been sat yet</p>}
    </Card>
  );
}

/** Report card: the exam result, read from the examination record. */
export default function OfficePanel({ seen, data, onGo }) {
  const exam = stepOf(seen, 'examine');
  const runAttempt = exam.detail?.attemptId || null;
  const [picked, setPicked] = useState(null);
  // A new result from the run takes the desk.
  useEffect(() => { setPicked(null); }, [runAttempt]);
  const attemptId = picked || runAttempt || data.credentials?.[0]?.examinationId || null;
  // The catch-up class arrives a moment after a failed exam; read the record again then.
  const record = useApi(attemptId ? `/api/examinations/${attemptId}` : null, seen.remediation);
  const attempt = record.data?.attempt || null;
  const report = useMemo(() => reportOf(attempt, record.data?.remediation, data.pkg), [attempt, record.data, data.pkg]);
  const graduated = attemptId === runAttempt && stepOf(seen, 'certify').status === 'passed';

  return (
    <>
      <div className="s-col" data-span={8}>
        {record.error && <Card><Problem what="The exam record" error={record.error} /></Card>}
        {record.loading && !record.data && <Card><Wait rows={6} /></Card>}
        {record.data && !report && <Card><Problem what="The marks for this exam" error={attempt ? `status ${attempt.status}` : 'no record'} /></Card>}
        {!attemptId && !data.credentialsError && data.credentials && (
          <Card><p className="s-lead">No exam has been sat yet</p>
            <button type="button" className="s-link" onClick={() => onGo('gate')}>Enrol a student <ArrowRight size={15} strokeWidth={2.6} /></button></Card>
        )}
        {report && <ReportCard attempt={attempt} report={report} />}
        {report && graduated && (
          <button type="button" className="s-go" onClick={() => onGo('hall')}>See the diploma <ArrowRight size={20} strokeWidth={2.6} /></button>
        )}
      </div>
      <Files runAttempt={runAttempt} credentials={data.credentials} error={data.credentialsError} chosen={attemptId} onPick={setPicked} />
    </>
  );
}
