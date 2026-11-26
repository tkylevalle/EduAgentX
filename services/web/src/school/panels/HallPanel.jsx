import { useEffect, useState } from 'react';
import { OctagonX } from 'lucide-react';
import { ago, pct, RULE_COPY } from '../../lib.js';
import { stepOf } from '../../run/reducer.mjs';
import { studentOf } from '../students.js';
import { Card, Problem, Wait } from './parts.jsx';
import Diploma from './Diploma.jsx';

const STATUS_TONE = { active: 'ok', suspended: 'warn', revoked: 'bad' };

function Wall({ credentials, chosen, runCredentialId, onPick }) {
  return (
    <Card span={4} title="Graduates" kind="manila" aside={<code className="s-meta">{credentials.length}</code>}>
      <ul className="s-files">
        {credentials.map((entry) => (
          <li key={entry.credentialId}><button type="button" aria-pressed={chosen === entry.credentialId} onClick={() => onPick(entry.credentialId)}>
            <span className="s-dot" data-tone={STATUS_TONE[entry.status] || 'warn'} title={entry.status} />
            <code>{entry.credentialId === runCredentialId ? 'This run' : entry.agentLearnerKey}</code>
            <strong>{pct(entry.overallPercent)}</strong><span>{ago(entry.issuedAt)}</span>
          </button></li>
        ))}
      </ul>
    </Card>
  );
}

/** What the suspension drill of this run reported: the check refuses a diploma on hold. */
function Drill({ detail }) {
  return (
    <Card tone="ok" title="Suspension drill">
      <p className="s-lead">
        On hold, the check answered <strong>{detail.whileSuspended?.overall}</strong>. Restored, it answered <strong>{detail.afterReinstate?.overall}</strong>.
      </p>
    </Card>
  );
}

/** The run's exam failed, so the hall has no diploma to give. The broken rules come from the exam record. */
function Refused({ student, rules, onGo }) {
  return (
    <Card tone="bad" title={`No diploma for ${student || 'this student'}`}
      aside={<button type="button" className="s-link" onClick={() => onGo('office')}>Open the report card</button>}>
      {rules.length > 0 && (
        <ul className="s-rules">{rules.map((rule) => <li key={rule}><OctagonX size={16} /> {RULE_COPY[rule] || rule}</li>)}</ul>
      )}
    </Card>
  );
}

/** Graduation: the diploma, the live check, and every graduate's standing. */
export default function HallPanel({ seen, data, onGo }) {
  const certify = stepOf(seen, 'certify');
  const exam = stepOf(seen, 'examine');
  const verify = stepOf(seen, 'verify');
  const drill = stepOf(seen, 'status');
  const runCredentialId = certify.status === 'passed' ? certify.detail.credentialId : null;
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [runCredentialId]);

  if (data.credentialsError) return <Card><Problem what="The list of diplomas" error={data.credentialsError} /></Card>;
  if (!data.credentials) return <Card><Wait rows={6} /></Card>;
  const noDiploma = exam.status === 'failed' && Boolean(exam.detail?.attemptId);
  // After a failed exam no diploma opens by itself. An earlier graduate's diploma
  // under this student's name would read as a pass.
  const chosenId = picked || runCredentialId || (noDiploma ? null : data.credentials[0]?.credentialId) || null;
  const credential = data.credentials.find((entry) => entry.credentialId === chosenId) || null;
  const ofRun = Boolean(chosenId) && chosenId === runCredentialId;

  return (
    <>
      {ofRun && drill.status === 'passed' && <Drill detail={drill.detail} />}
      <div className="s-col" data-span={8}>
        {noDiploma && <Refused student={studentOf(seen.scenario)?.name} rules={exam.detail.criticalViolationRuleIds || []} onGo={onGo} />}
        {credential && <Diploma credential={credential} runReport={ofRun && verify.status === 'passed' ? verify.detail : null} />}
        {!credential && chosenId && <Card><Wait rows={6} /></Card>}
        {!chosenId && !noDiploma && (
          <Card><p className="s-lead">No student has graduated yet</p>
            <button type="button" className="s-link" onClick={() => onGo('gate')}>Enrol a student</button></Card>
        )}
      </div>
      <Wall credentials={data.credentials} chosen={chosenId} runCredentialId={runCredentialId} onPick={setPicked} />
    </>
  );
}
