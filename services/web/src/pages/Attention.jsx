import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Empty, PageHead, Panel, Pill, Skeleton } from '../ui.jsx';
import { api, stamp } from '../lib.js';

// Attention Queue (target design 7.3; audit E9, E10): every service's
// incidents in one append-only log. Acknowledging or resolving adds an update
// with a note; nothing is edited or deleted.

const SEVERITY_TONE = { critical: 'bad', high: 'warn', medium: 'info' };
const VIEWS = [['open', 'Open'], ['all', 'All']];

function Update({ incident, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const send = async (status) => {
    try { await api(`/api/incidents/${incident.incidentId}/updates`, { method: 'POST', body: { status, note } }); setNote(''); onDone(); }
    catch (reason) { setError(reason.message); }
  };
  return (
    <div className="stack" style={{ gap: 8, marginTop: 10 }}>
      <input value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="What was done, or why it is safe to close" />
      <div className="row" style={{ gap: 8 }}>
        {incident.status === 'open' && <button className="btn" disabled={!note.trim()} onClick={() => send('acknowledged')}>Acknowledge</button>}
        <button className="btn btn-primary" disabled={!note.trim()} onClick={() => send('resolved')}>Resolve</button>
      </div>
      {error && <div className="notice bad">{error}</div>}
    </div>
  );
}

export default function Attention() {
  const [view, setView] = useState('open');
  const [incidents, setIncidents] = useState(undefined);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const load = () => api(`/api/incidents?status=${view}`).then((data) => { setIncidents(data.incidents); setError(null); })
    .catch((reason) => { setError(reason.message); setIncidents([]); });
  useEffect(() => { setIncidents(undefined); load(); }, [view]);
  const count = (severity) => (incidents || []).filter((incident) => incident.severity === severity && incident.status !== 'resolved').length;

  return (
    <main className="page">
      <PageHead index="10" title="Attention Queue" sub="Runtime violations, blocked releases and delivery failures from every service, in one append-only log."
        readouts={[['Critical', incidents ? count('critical') : null], ['High', incidents ? count('high') : null], ['Shown', incidents ? incidents.length : null]]}
        action={<div className="seg" style={{ gridTemplateColumns: `repeat(${VIEWS.length}, minmax(0, 1fr))` }}>{VIEWS.map(([id, label]) => (
          <button key={id} className="seg-option" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>))}</div>} />
      {error && <div className="notice bad" style={{ marginBottom: 18 }}>Incidents unavailable: {error}</div>}
      {incidents === undefined ? <Skeleton height={240} /> : !incidents.length ? (
        <Panel><Empty title={view === 'open' ? 'Nothing needs attention' : 'No incidents recorded'}>
          Incidents appear here when the Runtime Monitor sees a critical action, the Release Gate blocks a release, or a service cannot deliver an event.
        </Empty></Panel>
      ) : (
        <Panel title="Incidents" note="Newest first" flush>
          <ul className="feed">{incidents.map((incident) => (
            <li key={incident.incidentId} style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === incident.incidentId ? null : incident.incidentId)}>
              <BellRing size={15} color={incident.severity === 'critical' ? 'var(--danger)' : 'var(--text-3)'} style={{ marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <Pill tone={SEVERITY_TONE[incident.severity]}>{incident.severity}</Pill><Pill tone="info">{incident.status}</Pill>
                  <code>{incident.kind}</code><span className="faint" style={{ fontSize: 12 }}>{incident.source} · {stamp(incident.occurredAt)}</span>
                </div>
                <div style={{ marginTop: 6 }}>{incident.summary}</div>
                {expanded === incident.incidentId && <div onClick={(event) => event.stopPropagation()}>
                  {Object.keys(incident.subject || {}).length > 0 && <div className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>
                    {Object.entries(incident.subject).map(([key, value]) => `${key} ${value}`).join(' · ')}</div>}
                  {(incident.updates || []).map((update, index) => (
                    <div key={index} className="faint" style={{ fontSize: 12.5, marginTop: 6 }}>{update.status} by <code>{update.actor}</code> · {stamp(update.recordedAt)}: {update.note}</div>))}
                  {incident.status !== 'resolved' && <Update incident={incident} onDone={load} />}
                </div>}
              </div>
            </li>
          ))}</ul>
        </Panel>
      )}
    </main>
  );
}
