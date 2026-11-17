import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { pct } from '../lib.js';
import { healthSummary } from '../status.js';
import ModeSwitch from '../ModeSwitch.jsx';
import { useRun } from '../run/store.js';
import { stepOf } from '../run/reducer.mjs';
import { HUB, isView, roomOf, ROOMS } from './campus.mjs';
import { accessories, ambient, beat, journey, passedChecks } from './director.mjs';
import { schoolNumbers } from './report.mjs';
import { usePaced } from './usePaced.js';
import { useSchoolData } from './data.js';
import { STUDENTS, studentKind, studentOf } from './students.js';
import Stage from './stage/Stage.jsx';
import { art } from './stage/geometry.js';
import RoomPanel from './panels/index.jsx';
import './school.css';

const FIRST_ROOM = ROOMS[0].id;
const VIEWS = [{ id: HUB, tab: 'Campus' }, ...ROOMS];
const LIFECYCLE = ROOMS.filter((room) => room.floor === 0);

// Development only: ?pose=cheer&cap shows one pose, to check the art.
// A production build has no such switch; there the robot follows real runs only.
const ART = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const ART_POSE = ART?.get('pose') || null;

/** What the rooms display, taken from the run on screen and the platform's records. */
function stageFacts(seen, look) {
  const train = stepOf(seen, 'train');
  const verify = stepOf(seen, 'verify');
  return {
    doneModules: train.status === 'passed' ? train.detail?.modules || [] : [],
    sitting: stepOf(seen, 'examine').status === 'running',
    checks: verify.status === 'passed' ? passedChecks(verify.detail) : 0,
    party: look.cap,
  };
}

/** One short live fact for each room's door tag on the campus. Null: the record did not load. */
function doorTags(data, status) {
  const numbers = schoolNumbers(data.overview, data.credentials);
  const { up, total } = healthSummary(status.health);
  const latest = data.credentials?.[0];
  const known = (value, text) => (value === null || value === undefined ? null : text);
  return {
    gate: `${STUDENTS.length} students`,
    classroom: known(numbers.classes, `${numbers.classes} classes`),
    exam: known(data.pkg?.exam?.slots, `${data.pkg?.exam?.slots?.length} questions`),
    office: known(latest, `latest ${pct(latest?.overallPercent)}`),
    hall: known(numbers.diplomas, `${numbers.diplomas} diplomas`),
    library: known(data.pkg?.sources, `${data.pkg?.sources?.length} sources`),
    staff: status.critical === null ? 'alerts unknown' : status.critical > 0 ? `${status.critical} urgent` : 'all clear',
    workshop: known(status.health, `${up} of ${total} up`),
    careers: known(numbers.inGoodStanding, `${numbers.inGoodStanding} in good standing`),
  };
}

function Rail({ view, states, locked, onGo }) {
  const onKey = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || locked) return;
    const next = VIEWS[VIEWS.findIndex((entry) => entry.id === view) + step];
    if (!next) return;
    event.preventDefault();
    onGo(next.id);
    event.currentTarget.querySelector(`[data-view="${next.id}"]`)?.focus();
  };
  return (
    <nav className="s-rail" aria-label="Rooms of the school" onKeyDown={onKey}>
      <div className="rail-run">
        {VIEWS.map((entry) => {
          const state = states[entry.id];
          const step = LIFECYCLE.indexOf(entry) + 1;
          return (
            <button key={entry.id} type="button" className="brass rail-tab" data-view={entry.id} data-state={state} data-group={entry.id === HUB ? 'hub' : step ? 'life' : 'wing'}
              aria-current={entry.id === view ? 'page' : undefined} aria-disabled={(locked && entry.id !== view) || undefined}
              tabIndex={entry.id === view ? 0 : -1} onClick={() => !locked && onGo(entry.id)}>
              {step > 0 && <span className="rail-mark">{state === 'done' ? <Check size={12} strokeWidth={3.4} /> : state === 'failed' ? <X size={12} strokeWidth={3.4} /> : step}</span>}
              {entry.tab}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StatusTags({ status, onGo }) {
  const { up, total, tone } = healthSummary(status.health);
  const down = total - up;
  const alerts = `${status.critical} safety alert${status.critical > 1 ? 's' : ''}`;
  const health = !status.health ? 'Checking' : total === 0 ? 'Platform unreachable' : down === 0 ? 'All systems up' : `${down} service${down > 1 ? 's' : ''} down`;
  return (
    <>
      {status.critical > 0 && (
        <button type="button" className="top-tag" data-tone="bad" aria-label={alerts} onClick={() => onGo('staff')}>
          <BellRing size={13} /> {status.critical}<span className="hide-sm"> {alerts.slice(alerts.indexOf(' ') + 1)}</span>
        </button>
      )}
      {status.critical === null && <span className="top-tag" data-tone="warn"><BellRing size={13} /> Alerts unknown</span>}
      <button type="button" className="top-tag" data-tone={tone || undefined} aria-label={health} onClick={() => onGo('workshop')}>
        <i className="top-lamp" /><span className="hide-sm">{health}</span>
      </button>
    </>
  );
}

/** The roughness of stamped ink, shared by every rubber stamp on the page. */
function InkFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="rough-ink" x="-5%" y="-10%" width="110%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" />
      </filter>
    </svg>
  );
}

/**
 * Experience Mode: the platform as a school. One building, nine rooms, and a
 * camera that the visitor or a real lifecycle run moves.
 * @param {{ place: string, status: ReturnType<import('../status.js').useStatus>, onSwitch: () => void }} props
 */
export default function School({ place: hashPart, status, onSwitch }) {
  const scope = useRef(null);
  const run = useRun();
  const { seen, playing } = usePaced(run);
  const scene = useMemo(() => beat(seen), [seen]);
  const look = useMemo(() => accessories(seen), [seen]);
  const states = useMemo(() => journey(seen), [seen]);
  // The lists are read again after each stage that ends, so a new diploma or a
  // changed standing is on screen by the time the robot gets there.
  const settled = run.steps.filter((entry) => entry.status === 'passed' || entry.status === 'failed').length;
  const data = useSchoolData(`${run.id}:${settled}:${run.running}:${status.critical}`);

  const [picked, setPicked] = useState(() => (isView(hashPart) ? hashPart : scene?.place || HUB));
  useEffect(() => { if (isView(hashPart)) setPicked(hashPart); }, [hashPart]);
  // While a run plays, the school follows it; afterwards the visitor walks freely.
  const view = playing && scene ? scene.place : picked;
  const room = roomOf(view);
  // The robot stays in the last room it was in while the visitor looks at the campus.
  const lastRoom = useRef(scene?.place || FIRST_ROOM);
  if (room) lastRoom.current = room.id;
  const quillRoom = lastRoom.current;
  useEffect(() => {
    setPicked(view);
    const hash = `#/school/${view}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    document.title = `${room ? room.tab : 'Campus'} | EduAgentX School`;
  }, [view]);

  const inScene = scene?.place === quillRoom;
  const { up, total } = healthSummary(status.health);
  const pose = ART_POSE || (inScene ? scene.pose : ambient(quillRoom, { critical: status.critical, up, total }));
  const shownLook = ART_POSE ? { ...look, cap: ART.has('cap') } : look;
  const facts = useMemo(() => stageFacts(seen, shownLook), [seen, shownLook.cap]);
  const tags = useMemo(() => doorTags(data, status), [data.overview, data.credentials, data.pkg, status.health, status.critical]);
  const student = studentOf(seen.scenario);
  const caption = scene && view === scene.place && !ART_POSE ? scene : null;

  return (
    <div className="school" ref={scope} data-view={room ? 'room' : 'hub'}>
      <InkFilter />
      <header className="top">
        <span className="top-brand"><img src={art('ui/crest.webp')} alt="" width="34" height="28" /> EduAgent X</span>
        <span className="spacer" />
        <StatusTags status={status} onGo={setPicked} />
        <ModeSwitch mode="school" onSwitch={onSwitch} />
      </header>
      <Stage view={view} quillRoom={quillRoom} pose={pose} look={shownLook} facts={facts} data={data} health={status.health} tags={tags}
        locked={playing} onGo={setPicked} scope={scope}>
        {student && (
          <div className="name-tag"><strong>{student.name}</strong><span data-live={student.live || undefined}>{studentKind(student, status.liveModel)}</span></div>
        )}
        {ART_POSE && <div className="name-tag name-tag-art"><strong>Art check</strong><span>not a run</span></div>}
        <div className="caption-slot" aria-live="polite">
          {caption && <p key={caption.caption} className="caption" data-tone={caption.tone || undefined}>{caption.caption}</p>}
        </div>
      </Stage>
      <Rail view={view} states={states} locked={playing} onGo={setPicked} />
      <main className="desk" key={view}>
        <RoomPanel view={view} run={run} seen={seen} playing={playing} data={data} status={status} onGo={setPicked} />
      </main>
      <div className="props" aria-hidden="true">
        <img className="prop prop-books" src={art('fg/books.webp')} alt="" />
        <img className="prop prop-lamp" src={art('fg/lamp.webp')} alt="" />
      </div>
    </div>
  );
}
