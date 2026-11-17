import { useState } from 'react';
import { api, stamp } from '../../lib.js';
import { useApi } from '../data.js';
import { Card, Fact, Problem, Wait } from './parts.jsx';

// The staff room: every incident the platform recorded. The log only grows.
// Acknowledging or resolving an incident adds a note; nothing is edited.

const VIEWS = [['open', 'Needs attention'], ['all', 'Every incident']];
const SEVERITY_TONE = { critical: 'bad', high: 'warn' };
const plain = (text) => String(text || '').replaceAll('_', ' ').replaceAll('.', ' ');

/** Adds a note to an incident. The note says what was done, so it is required. */
function Note({ incident, onDone }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState({ busy: false, error: null });
  const send = async (status) => {
    setState({ busy: true, error: null });
    try {
      await api(`/api/incidents/${incident.incidentId}/updates`, { method: 'POST', body: { status, note } });
      setNote('');
      setState({ busy: false, error: null });
      onDone();
    } catch (error) { setState({ busy: false, error: error.message }); }
  };
  const ready = note.trim() && !state.busy;
  return (
    <div className="staff-note">
      <label>What was done, or why it is safe to close
        <input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
      </label>
      <div className="s-actions">
        {incident.status === 'open' && <button type="button" className="s-link" data-quiet disabled={!ready} onClick={() => send('acknowledged')}>Acknowledge</button>}
        <button type="button" className="s-link" disabled={!ready} onClick={() => send('resolved')}>Resolve</button>
      </div>
      {state.error && <Problem what="The note" error={state.error} />}
    </div>
  );
}

function Incident({ incident, open, onToggle, onDone }) {
  const subject = Object.entries(incident.subject || {});
  return (
    <li data-severity={incident.severity} data-open={open || undefined}>
      <button type="button" className="staff-head" aria-expanded={open} onClick={onToggle}>
        <span className="rubber" data-tone={SEVERITY_TONE[incident.severity] || 'ok'}>{incident.severity}</span>
        <strong>{incident.summary}</strong>
        <span className="s-meta">{plain(incident.kind)}, from {incident.source}, {stamp(incident.occurredAt)}, {incident.status}</span>
      </button>
      {open && (
        <div className="staff-body">
          {subject.length > 0 && <dl className="s-rows">{subject.map(([key, value]) => <div key={key} style={{ display: 'contents' }}><dt>{key}</dt><dd><code>{String(value)}</code></dd></div>)}</dl>}
          {(incident.updates || []).map((update, index) => (
            <p key={index} className="staff-update"><strong>{update.status}</strong> by <code>{update.actor}</code>, {stamp(update.recordedAt)}: {update.note}</p>
          ))}
          {incident.status !== 'resolved' && <Note incident={incident} onDone={onDone} />}
        </div>
      )}
    </li>
  );
}

/** Staff room: safety alerts and other incidents, and the two jobs that need a reviewer's own account. */
export default function StaffPanel({ data }) {
  const [view, setView] = useState('open');
  const [expanded, setExpanded] = useState(null);
  const [changed, setChanged] = useState(0);
  const everything = useApi(view === 'all' ? '/api/incidents?status=all' : null, changed);
  const incidents = view === 'open' ? data.incidents : everything.data?.incidents || null;
  const error = view === 'open' ? data.incidentsError : everything.error;
  const count = (severity) => (data.incidents ? data.incidents.filter((incident) => incident.severity === severity).length : null);
  const onDone = () => { data.reloadIncidents(); setChanged((now) => now + 1); };

  return (
    <>
      <Card span={8} title="Incidents" fix="pin" aside={(
        <div className="seg-paper" role="group" aria-label="Which incidents">
          {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
        </div>
      )}>
        {error && <Problem what="The incident log" error={error} />}
        {!incidents && !error && <Wait rows={5} />}
        {incidents?.length === 0 && <p className="s-lead">{view === 'open' ? 'Nothing needs attention. An incident appears here when a certified agent breaks a rule at work, a release is blocked, or a service cannot deliver an event.' : 'No incident is on record.'}</p>}
        <ul className="staff-list">
          {(incidents || []).map((incident) => (
            <Incident key={incident.incidentId} incident={incident} open={expanded === incident.incidentId}
              onToggle={() => setExpanded(expanded === incident.incidentId ? null : incident.incidentId)} onDone={onDone} />
          ))}
        </ul>
      </Card>
      <div className="s-col" data-span={4}>
        <Card kind="manila" title="Open now">
          <div className="s-facts">
            <Fact value={count('critical')} name="critical" />
            <Fact value={count('high')} name="high" />
            <Fact value={data.incidents ? data.incidents.length : null} name="in total" />
          </div>
        </Card>
        <Card title="Marking and reviews" fix="tape">
          <p className="s-lead">Two people mark every answer in the grader's test set, and two reviewers sign each course version. Both jobs need the person's own reviewer account.</p>
          <div className="s-actions">
            <button type="button" className="s-link" onClick={() => { window.location.hash = '/labelling'; }}>Mark answers in Operator Mode</button>
            <button type="button" className="s-link" data-quiet onClick={() => { window.location.hash = '/governance'; }}>Review a course</button>
          </div>
        </Card>
      </div>
    </>
  );
}
