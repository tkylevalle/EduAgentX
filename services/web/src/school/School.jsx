import { useEffect, useMemo, useState } from 'react';
import { BellRing, Check, X } from 'lucide-react';
import { BrandMark } from '../ui.jsx';
import { healthSummary } from '../status.js';
import ModeSwitch from '../ModeSwitch.jsx';
import { useRun } from '../run/store.js';
import { stepOf } from '../run/reducer.mjs';
import { accessories, beat, journey, passedChecks, PLACES } from './director.mjs';
import { usePaced } from './usePaced.js';
import { useSchoolData } from './data.js';
import { studentKind, studentOf } from './students.js';
import Stage from './Stage.jsx';
import PlacePanel from './panels/index.jsx';
import './stage.css';
import './school.css';

// The office pinboard has room for this many report cards.
const PINBOARD_SLOTS = 6;
const isPlace = (id) => PLACES.some((entry) => entry.id === id);

// Development only: ?pose=cheer&cap&diploma shows one pose, to check the art.
// A production build has no such switch; there the robot follows real runs only.
const ART = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
const ART_POSE = ART?.get('pose') || null;

/** What the rooms display, taken from the run on screen and the platform's records. */
function stageFacts(seen, look, credentials) {
  const train = stepOf(seen, 'train');
  const verify = stepOf(seen, 'verify');
  return {
    doneModules: train.status === 'passed' ? train.detail?.modules || [] : [],
    sitting: stepOf(seen, 'examine').status === 'running',
    cards: Math.min(PINBOARD_SLOTS, credentials?.length || 0),
    checks: verify.status === 'passed' ? passedChecks(verify.detail) : 0,
    party: look.cap,
  };
}

function Journey({ place, states, locked, onGo }) {
  const onKey = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || locked) return;
    const next = PLACES[PLACES.findIndex((entry) => entry.id === place) + step];
    if (!next) return;
    event.preventDefault();
    onGo(next.id);
    event.currentTarget.querySelector(`[data-place="${next.id}"]`)?.focus();
  };
  return (
    <nav className="s-journey" aria-label="Rooms of the school" onKeyDown={onKey}>
      {PLACES.map((entry, index) => {
        const state = states[entry.id];
        return (
          <button key={entry.id} type="button" className="s-stop" data-place={entry.id} data-state={state}
            aria-current={entry.id === place ? 'step' : undefined} aria-disabled={(locked && entry.id !== place) || undefined}
            tabIndex={entry.id === place ? 0 : -1} onClick={() => !locked && onGo(entry.id)}>
            <span className="s-stop-mark">{state === 'done' ? <Check size={13} strokeWidth={3.2} /> : state === 'failed' ? <X size={13} strokeWidth={3.2} /> : index + 1}</span>
            <span className="s-stop-name">{entry.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function StatusChips({ status }) {
  const { up, total, tone } = healthSummary(status.health);
  const down = total - up;
  const alerts = `${status.critical} safety alert${status.critical > 1 ? 's' : ''}`;
  const health = !status.health ? 'Checking' : total === 0 ? 'Platform unreachable' : down === 0 ? 'All systems up' : `${down} service${down > 1 ? 's' : ''} down`;
  return (
    <>
      {status.critical > 0 && (
        <button type="button" className="env-chip s-alert" aria-label={alerts} onClick={() => { window.location.hash = '/attention'; }}>
          <BellRing size={12} /> {status.critical}<span className="hide-sm"> {alerts.slice(alerts.indexOf(' ') + 1)}</span>
        </button>
      )}
      {status.critical === null && <span className="env-chip s-unknown"><BellRing size={12} /> Alerts unknown</span>}
      <button type="button" className="env-chip s-health" aria-label={health} onClick={() => { window.location.hash = '/system'; }}>
        <span className={`dot ${tone} ${tone === 'ok' ? 'live' : ''}`} />
        <span className="hide-sm">{health}</span>
      </button>
    </>
  );
}

/**
 * Experience Mode: the same lifecycle run, shown as a robot going to school.
 * @param {{ place: string, status: ReturnType<import('../status.js').useStatus>, onSwitch: () => void }} props
 */
export default function School({ place: hashPlace, status, onSwitch }) {
  const run = useRun();
  const { seen, playing } = usePaced(run);
  const scene = useMemo(() => beat(seen), [seen]);
  const look = useMemo(() => accessories(seen), [seen]);
  const states = useMemo(() => journey(seen), [seen]);
  // The lists are read again after each stage that ends, so a new diploma or a
  // changed standing is on screen by the time the robot gets there.
  const settled = run.steps.filter((entry) => entry.status === 'passed' || entry.status === 'failed').length;
  const data = useSchoolData(`${run.id}:${settled}:${run.running}`);

  const [view, setView] = useState(() => (isPlace(hashPlace) ? hashPlace : scene?.place || PLACES[0].id));
  useEffect(() => { if (isPlace(hashPlace)) setView(hashPlace); }, [hashPlace]);
  // While a run plays, the school follows it; afterwards the visitor walks freely.
  const place = playing && scene ? scene.place : view;
  useEffect(() => {
    setView(place);
    const hash = `#/school/${place}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
    document.title = `${PLACES.find((entry) => entry.id === place).label} · EduAgentX School`;
  }, [place]);

  const inScene = scene?.place === place;
  const pose = ART_POSE || (inScene ? scene.pose : 'idle');
  const tone = inScene ? scene.tone : '';
  const shownLook = ART_POSE ? { ...look, cap: ART.has('cap'), diploma: ART.has('diploma'), badge: ART.has('badge') } : look;
  const facts = useMemo(() => stageFacts(seen, shownLook, data.credentials), [seen, shownLook.cap, data.credentials]);
  const student = studentOf(seen.scenario);

  return (
    <div className="school">
      <header className="s-bar">
        <span className="s-brand"><BrandMark size={26} /> EduAgent X</span>
        <span className="spacer" />
        <StatusChips status={status} />
        <ModeSwitch mode="school" onSwitch={onSwitch} />
      </header>
      <section className="s-stage" aria-label="The school">
        <Stage place={place} pose={pose} tone={tone} look={shownLook} pkg={data.pkg} facts={facts} />
        {student && (
          <div className="s-student">
            <strong>{student.name}</strong><span className="s-tag" data-live={student.live || undefined}>{studentKind(student, status.liveModel)}</span>
          </div>
        )}
        {ART_POSE && <div className="s-student s-art">Art check · not a run</div>}
        <div className="s-caption-slot" aria-live="polite">
          {inScene && !ART_POSE && <p key={scene.caption} className="s-caption" data-tone={scene.tone || undefined}>{scene.caption}</p>}
        </div>
      </section>
      <Journey place={place} states={states} locked={playing} onGo={setView} />
      <main className="s-panel">
        <PlacePanel place={place} run={run} seen={seen} playing={playing} data={data} status={status} onGo={setView} />
      </main>
    </div>
  );
}
