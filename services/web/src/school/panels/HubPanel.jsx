import { ago, pct } from '../../lib.js';
import { Card, Problem, Ring, Wait } from './parts.jsx';
import { Chooser, Numbers } from './GatePanel.jsx';

/** The course every student takes, from the active course package. */
function Course({ pkg, error, onGo }) {
  return (
    <Card span={4} title={pkg?.domain || 'The course'} fix="tape">
      {error && <Problem what="The course" error={error} />}
      {!pkg && !error && <Wait rows={5} />}
      {pkg && (
        <>
          <ol className="hub-lessons">{(pkg.modules || []).map((lesson) => <li key={lesson.id}>{lesson.title}</li>)}</ol>
          <div className="s-actions">
            <button type="button" className="s-link" onClick={() => onGo('library')}>Open the library</button>
            <code className="s-meta">{pkg.packageId} v{pkg.version}</code>
          </div>
        </>
      )}
    </Card>
  );
}

/** The newest diploma on record. A diploma exists only for a passed exam. */
function Latest({ credentials, error, onGo }) {
  const latest = credentials?.[0];
  return (
    <Card span={3} title="Latest result" fix="binder">
      {error && <Problem what="The diploma list" error={error} />}
      {!credentials && !error && <Wait />}
      {credentials && !latest && <p className="s-lead">No student has graduated yet. Enrol one to see a result here.</p>}
      {latest && (
        <>
          <p className="hub-score"><Ring tone="pass"><strong>{pct(latest.overallPercent)}</strong></Ring></p>
          <p className="s-lead"><code>{latest.agentLearnerKey}</code> passed {ago(latest.issuedAt)}</p>
          <button type="button" className="s-link" onClick={() => onGo('hall')}>See the diploma</button>
        </>
      )}
    </Card>
  );
}

/** The campus: choose a student to start a real run, and see where the school stands. */
export default function HubPanel({ run, data, status, onGo }) {
  return (
    <>
      <Chooser liveModel={status.liveModel} last={run.scenario} span={5} />
      <Course pkg={data.pkg} error={data.pkgError} onGo={onGo} />
      <Latest credentials={data.credentials} error={data.credentialsError} onGo={onGo} />
      <Numbers data={data} span={12} />
    </>
  );
}
