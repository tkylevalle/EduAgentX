import { useEffect, useState } from 'react';
import { pct, short } from '../../lib.js';
import { anchor } from './geometry.js';

// What the rooms display on their boards, clocks and lamps. Every value here
// is a record of the platform or the time of day; a record that did not load
// leaves its board empty.

const TIER_ROWS = ['recall', 'applied', 'adversarial'];
// The boards have room for this many cards or notes.
const BOARD_CARDS = 6;
const STAFF_NOTES = 8;
const LAMPS = 14;

/** Clock hands that show the real time. The face is part of the rendered room. */
export function Hands({ box }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  if (!box) return null;
  const seconds = now.getSeconds();
  const minutes = now.getMinutes() + seconds / 60;
  const hours = (now.getHours() % 12) + minutes / 60;
  return (
    <svg className="hands" style={box} viewBox="-50 -50 100 100" aria-hidden="true">
      <path className="hand hand-hour" d="M0 5 V-22" transform={`rotate(${hours * 30})`} />
      <path className="hand hand-minute" d="M0 6 V-34" transform={`rotate(${minutes * 6})`} />
      <path className="hand hand-second" d="M0 9 V-37" transform={`rotate(${seconds * 6})`} />
      <circle r="3.2" />
    </svg>
  );
}

function GateBoard({ pkg }) {
  if (!pkg) return null;
  return (
    <div className="board board-notice" style={anchor('gate', 'board')}>
      <div className="notice-sheet">
        <strong>Course</strong>
        <code>{pkg.packageId}</code>
        <span>version {pkg.version}</span>
        {pkg.state === 'Active' && <em className="rubber" data-tone="ok">Approved</em>}
      </div>
    </div>
  );
}

function ClassBoard({ pkg, doneModules }) {
  return (
    <div className="board chalk" style={anchor('classroom', 'board')}>
      <ol className="chalk-lessons">
        {(pkg?.modules || []).slice(0, 5).map((lesson) => (
          <li key={lesson.id} data-done={doneModules.includes(lesson.id) || undefined}>
            <svg viewBox="0 0 30 30" aria-hidden="true"><path className="chalk-box" d="M4 5 h21 v21 h-21z" /><path className="chalk-tick" d="M7 15 l7 8 l13 -19" /></svg>
            <span>{lesson.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ExamBoard({ pkg, sitting }) {
  const slots = pkg?.exam?.slots || [];
  return (
    <div className="board chalk" style={anchor('exam', 'board')}>
      <p className="chalk-head" data-live={sitting || undefined}>{sitting ? 'Exam in progress' : 'Exam paper'}</p>
      <div className="chalk-slots">
        {TIER_ROWS.map((tier) => (
          <div key={tier} data-tier={tier}>{slots.filter((slot) => slot.tier === tier).map((slot) => <i key={slot.id} />)}</div>
        ))}
      </div>
    </div>
  );
}

/** Small cards pinned to a board: one per diploma, with its real score. */
function CardBoard({ room, credentials }) {
  return (
    <div className="board board-cards" style={anchor(room, 'board')}>
      {(credentials || []).slice(0, BOARD_CARDS).map((entry, index) => (
        <div className="mini-card" key={entry.credentialId} style={{ '--tilt': `${((index * 37) % 9) - 4}deg` }}>
          <strong>{pct(entry.overallPercent)}</strong>
          <code>{short(entry.agentLearnerKey, 10, 3)}</code>
        </div>
      ))}
    </div>
  );
}

function HallBoard({ look, checks, credentials }) {
  return (
    <div className="board board-honours" style={anchor('hall', 'board')}>
      {look.diploma ? (
        <div className="mini-diploma" data-hold={look.suspended || undefined}>
          <strong>Diploma</strong>
          <div className="mini-seals">{Array.from({ length: 7 }, (_, index) => <i key={index} data-on={index < checks || undefined} style={{ '--i': index }} />)}</div>
          {look.suspended && <em className="rubber" data-tone="bad">On hold</em>}
        </div>
      ) : credentials && (
        <div className="mini-diploma"><strong>{credentials.length}</strong><span>diplomas awarded</span></div>
      )}
    </div>
  );
}

function StaffBoard({ incidents }) {
  return (
    <div className="board board-notes" style={anchor('staff', 'board')}>
      {(incidents || []).slice(0, STAFF_NOTES).map((incident, index) => (
        <div className="mini-note" key={incident.incidentId} data-severity={incident.severity} style={{ '--tilt': `${((index * 53) % 9) - 4}deg` }}>
          {String(incident.kind || '').replaceAll('_', ' ').replaceAll('.', ' ')}
        </div>
      ))}
    </div>
  );
}

/** The caretaker's lamp panel: one lamp per service, lit by its health check. */
function Lamps({ health }) {
  return Array.from({ length: LAMPS }, (_, index) => {
    const service = health?.[index];
    const state = !service ? 'off' : service.healthy ? 'ok' : 'bad';
    return <i key={index} className="lamp-dot" data-state={state} style={anchor('workshop', `lamp${index}`)} title={service?.name} />;
  });
}

/**
 * The live parts of one room.
 * @param {{ id: string, pkg: object|null, facts: object, data: object, health: Array<object>|null, look: object }} props
 */
export default function RoomOverlays({ id, pkg, facts, data, health, look }) {
  const inGoodStanding = data.credentials?.filter((entry) => entry.status === 'active');
  switch (id) {
    case 'gate': return <GateBoard pkg={pkg} />;
    case 'classroom': return <><ClassBoard pkg={pkg} doneModules={facts.doneModules} /><Hands box={anchor('classroom', 'clock')} /></>;
    case 'exam': return <><ExamBoard pkg={pkg} sitting={facts.sitting} /><Hands box={anchor('exam', 'clock')} /></>;
    case 'office': return <CardBoard room="office" credentials={data.credentials} />;
    case 'hall': return <HallBoard look={look} checks={facts.checks} credentials={data.credentials} />;
    case 'staff': return <><StaffBoard incidents={data.incidents} /><Hands box={anchor('staff', 'clock')} /></>;
    case 'workshop': return <Lamps health={health} />;
    case 'careers': return <CardBoard room="careers" credentials={inGoodStanding} />;
    default: return null;
  }
}
