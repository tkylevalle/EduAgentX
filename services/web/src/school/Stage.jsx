import { useEffect, useState } from 'react';
import Robot from './Robot.jsx';
import { PLACES, placeIndex } from './director.mjs';

// The school in cross-section, five rooms side by side in one SVG world. The
// camera and the lights follow the robot. A room is lit only while the run or
// the visitor is in it.

const ROOM_W = 1000;
const WORLD_H = 560;
const FLOOR_Y = 440;
// Time to cross one room on foot, and the extra time per further room.
const WALK_MS = 1300;
const WALK_EXTRA_MS = 260;
const SEATED = new Set(['study', 'exam']);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Room({ index, id, lit, lamp = true, children }) {
  return (
    <g className={`room room-${id}`} data-lit={lit || undefined} transform={`translate(${index * ROOM_W} 0)`}>
      <rect className="room-wall" x="0" y="40" width={ROOM_W} height="400" />
      <rect className="room-wall-shade" x="0" y="40" width={ROOM_W} height="400" fill="url(#wall-shade)" />
      <rect className="room-floor" x="0" y={FLOOR_Y} width={ROOM_W} height={WORLD_H - FLOOR_Y} />
      <g className="room-planks">{[466, 496, 530].map((y) => <path key={y} d={`M0 ${y} H${ROOM_W}`} />)}</g>
      <rect className="room-skirt" x="0" y="428" width={ROOM_W} height="12" />
      {children}
      {lamp && (
        <g className="lamp">
          <path className="lamp-cone" d="M468 108 L250 440 H750 L532 108Z" fill="url(#cone)" />
          <ellipse className="lamp-pool" cx="500" cy="452" rx="290" ry="26" fill="url(#pool)" />
          <path className="lamp-cord" d="M500 40 V86" />
          <path className="lamp-shade" d="M462 108 q38 -44 76 0z" />
          <ellipse className="lamp-bulb" cx="500" cy="108" rx="24" ry="5" />
        </g>
      )}
    </g>
  );
}

function Gate({ pkg }) {
  const approved = pkg?.state === 'Active';
  return (
    <>
      <rect x="-3000" y="0" width={ROOM_W + 3000} height="440" fill="url(#sky)" />
      <rect className="room-floor" x="-3000" y={FLOOR_Y} width="3000" height={WORLD_H - FLOOR_Y} />
      <g className="stars">{[[90, 70], [210, 38], [330, 96], [455, 44], [610, 80], [700, 30], [930, 62], [150, 150], [960, 170], [40, 210]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 ? 1.6 : 2.4} style={{ animationDelay: `${i * 0.7}s` }} />))}</g>
      <circle className="moon" cx="900" cy="66" r="32" /><circle className="moon-mark" cx="889" cy="57" r="6" /><circle className="moon-mark" cx="911" cy="77" r="4" />
      <path className="facade-roof" d="M96 132 L500 34 L904 132Z" />
      <rect className="facade" x="130" y="132" width="740" height="308" />
      <rect className="facade-frieze" x="130" y="132" width="740" height="44" />
      <text className="facade-name" x="500" y="163" textAnchor="middle">EDUAGENT X</text>
      <circle className="facade-clock" cx="500" cy="92" r="20" /><path className="facade-clock-hand" d="M500 92 V79 M500 92 h9" />
      {[190, 300, 640, 750].map((x, i) => (
        <g key={x} className="window" data-on={i === 1 || i === 2 || undefined}><rect x={x} y="226" width="62" height="104" rx="31" /><path d={`M${x + 31} 226 V330 M${x} 280 H${x + 62}`} /></g>))}
      <path className="door-glow" d="M396 440 V304 a104 104 0 0 1 208 0 V440Z" fill="url(#door)" />
      <path className="door-frame" d="M396 440 V304 a104 104 0 0 1 208 0 V440" />
      <path className="path" d="M396 440 H604 L720 560 H280Z" />
      <g className="lamppost"><path d="M168 440 V250" /><circle className="lamppost-glow" cx="168" cy="238" r="60" fill="url(#glow)" /><circle className="lamppost-bulb" cx="168" cy="238" r="12" /></g>
      <g className="notice" data-approved={approved || undefined}>
        <path className="notice-post" d="M712 440 V372 M828 440 V372" />
        <rect className="notice-frame" x="690" y="262" width="160" height="112" rx="5" />
        <rect className="notice-sheet" x="706" y="276" width="128" height="84" rx="2" />
        <text className="notice-title" x="718" y="296">COURSE</text>
        <path className="notice-lines" d="M718 308 h92 M718 320 h104 M718 332 h70" />
        <g className="notice-stamp" transform="rotate(-9 786 344)"><rect x="744" y="333" width="84" height="22" rx="3" /><text x="786" y="349" textAnchor="middle">APPROVED</text></g>
      </g>
    </>
  );
}

function Classroom({ pkg, doneModules }) {
  const modules = pkg?.modules || [];
  const clip = (text) => (text.length > 31 ? `${text.slice(0, 30)}…` : text);
  return (
    <>
      <rect className="wainscot" x="0" y="330" width={ROOM_W} height="98" />
      <rect className="board-frame" x="64" y="84" width="392" height="226" rx="6" />
      <rect className="board" x="76" y="96" width="368" height="202" rx="2" />
      <text className="chalk chalk-head" x="94" y="126">LESSONS</text>
      {modules.slice(0, 5).map((module, i) => (
        <g key={module.id} className="chalk-row" style={{ '--i': i }} data-done={doneModules.includes(module.id) || undefined}>
          <text className="chalk" x="118" y={156 + i * 28}>{clip(module.title)}</text>
          <path className="chalk-box" d={`M94 ${144 + i * 28} h13 v13 h-13z`} />
          <path className="chalk-tick" d={`M95 ${151 + i * 28} l5 6 l10 -14`} />
        </g>))}
      <rect className="board-tray" x="64" y="306" width="392" height="9" rx="2" /><rect className="chalk-stick" x="330" y="301" width="22" height="5" rx="2" /><rect className="eraser" x="372" y="297" width="34" height="9" rx="2" />
      <g className="shelf">
        <rect className="shelf-body" x="668" y="150" width="262" height="290" rx="4" />
        {[0, 1, 2, 3].map((row) => (
          <g key={row}>
            <rect className="shelf-gap" x="680" y={162 + row * 68} width="238" height="56" />
            {[14, 20, 12, 24, 16, 22, 13, 18, 21, 15].map((w, i, all) => {
              const x = 684 + all.slice(0, i).reduce((sum, value) => sum + value + 4, 0);
              const h = 34 + ((i * 7 + row * 5) % 16);
              return x + w < 916 && (i + row) % 5 !== 4 ? <rect key={i} className={`book book-${(i + row * 2) % 5}`} x={x} y={218 + row * 68 - h} width={w} height={h} rx="1.5" /> : null;
            })}
          </g>))}
        <circle className="globe" cx="800" cy="118" r="24" /><path className="globe-line" d="M776 118 h48 M800 94 q-16 24 0 48 M800 94 q16 24 0 48" /><path className="globe-stand" d="M786 150 h28 M800 142 v8" />
      </g>
    </>
  );
}

function WallClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(timer); }, []);
  const seconds = now.getSeconds(), minutes = now.getMinutes() + seconds / 60, hours = (now.getHours() % 12) + minutes / 60;
  return (
    <g className="clock" transform="translate(236 176)">
      <circle className="clock-rim" r="72" /><circle className="clock-face" r="62" />
      {Array.from({ length: 12 }, (_, i) => <path key={i} className="clock-mark" d="M0 -54 V-46" transform={`rotate(${i * 30})`} />)}
      <path className="clock-hour" d="M0 6 V-30" transform={`rotate(${hours * 30})`} />
      <path className="clock-minute" d="M0 8 V-46" transform={`rotate(${minutes * 6})`} />
      <path className="clock-second" d="M0 12 V-50" transform={`rotate(${seconds * 6})`} />
      <circle className="clock-pin" r="4" />
    </g>
  );
}

function ExamHall({ pkg, sitting }) {
  const slots = pkg?.exam?.slots || [];
  return (
    <>
      <rect className="wainscot" x="0" y="350" width={ROOM_W} height="78" />
      <WallClock />
      <g className="exam-sign" data-on={sitting || undefined}>
        <rect x="640" y="96" width="270" height="54" rx="8" /><text x="775" y="131" textAnchor="middle">{sitting ? 'EXAM IN PROGRESS' : 'EXAM HALL'}</text>
      </g>
      <g className="slot-chart">
        <rect className="slot-board" x="668" y="182" width="214" height="130" rx="5" />
        {slots.map((slot, i) => <rect key={slot.id} className={`slot slot-${slot.tier}`} x={686 + (i % 5) * 38} y={198 + Math.floor(i / 5) * 36} width="28" height="26" rx="4" />)}
      </g>
      {[110, 800].map((x) => (
        <g key={x} className="spare-desk"><rect x={x} y="386" width="120" height="9" rx="3" /><path d={`M${x + 12} 395 V440 M${x + 108} 395 V440`} /><rect x={x + 38} y="404" width="44" height="7" rx="3" /><path d={`M${x + 60} 411 V440`} /></g>))}
    </>
  );
}

function Office({ cards }) {
  const spots = [[104, 116, -5], [204, 108, 3], [306, 118, -2], [112, 214, 4], [212, 206, -4], [312, 214, 2]];
  return (
    <>
      <rect className="wainscot" x="0" y="340" width={ROOM_W} height="88" />
      <rect className="pinboard-frame" x="72" y="86" width="352" height="232" rx="6" /><rect className="pinboard" x="84" y="98" width="328" height="208" rx="2" />
      {spots.slice(0, cards).map(([x, y, turn], i) => (
        <g key={i} className="pinned" transform={`rotate(${turn} ${x + 36} ${y + 44})`}>
          <rect x={x} y={y} width="72" height="86" rx="3" /><path d={`M${x + 10} ${y + 24} h36 M${x + 10} ${y + 38} h52 M${x + 10} ${y + 50} h52 M${x + 10} ${y + 62} h30`} />
          <circle className="pinned-seal" cx={x + 54} cy={y + 70} r="7" /><circle className="pin" cx={x + 36} cy={y + 7} r="4" />
        </g>))}
      <g className="cabinet">
        <rect className="cabinet-body" x="690" y="214" width="196" height="226" rx="6" />
        {[0, 1, 2].map((row) => (<g key={row}><rect className="drawer" x="702" y={226 + row * 70} width="172" height="60" rx="4" /><rect className="drawer-label" x="766" y={238 + row * 70} width="44" height="14" rx="2" /><path className="drawer-pull" d={`M772 ${268 + row * 70} h32`} /></g>))}
        <path className="desk-lamp" d="M760 214 v-34 l44 -30" /><path className="desk-lamp-head" d="M792 136 l34 12 -12 22z" /><circle className="desk-lamp-glow" cx="812" cy="168" r="46" fill="url(#glow)" />
      </g>
      <g className="plant"><path d="M612 440 v-56 M612 400 q-30 -8 -34 -40 q28 4 34 40 M612 388 q30 -14 30 -48 q-26 12 -30 48 M612 376 q-8 -30 6 -52 q12 26 -6 52" /><path className="pot" d="M592 412 h40 l-6 28 h-28z" /></g>
    </>
  );
}

const CONFETTI = Array.from({ length: 30 }, (_, i) => ({ x: 130 + ((i * 97) % 740), delay: (i * 0.19) % 2.6, hue: i % 4, turn: (i * 47) % 360 }));

function Hall({ diploma, checks, suspended, party }) {
  return (
    <>
      <g className="pennants"><path className="pennant-line" d="M150 78 Q500 132 850 78" />
        {Array.from({ length: 13 }, (_, i) => { const t = (i + 0.5) / 13; const x = 150 + t * 700; const y = 78 + 54 * 4 * t * (1 - t) * 0.5 + 2;
          return <path key={i} className={`pennant pennant-${i % 3}`} d={`M${x - 14} ${y} h28 l-14 30z`} />; })}
      </g>
      <path className="drape" d="M0 40 H170 Q150 200 120 300 Q96 380 60 440 H0Z" /><path className="drape-fold" d="M60 40 Q70 220 30 440 M118 40 Q118 220 74 400" />
      <path className="drape" d="M1000 40 H830 Q850 200 880 300 Q904 380 940 440 H1000Z" /><path className="drape-fold" d="M940 40 Q930 220 970 440 M882 40 Q882 220 926 400" />
      <path className="spot spot-l" d="M210 40 L330 440 H640Z" fill="url(#cone)" /><path className="spot spot-r" d="M790 40 L670 440 H360Z" fill="url(#cone)" />
      <rect className="platform" x="150" y="424" width="700" height="16" rx="3" /><rect className="platform-face" x="150" y="440" width="700" height="24" />
      <g className="easel" data-shown={diploma || undefined} data-suspended={suspended || undefined}>
        <path className="easel-leg" d="M262 196 L218 430 M262 196 L306 430 M262 196 V424" />
        <rect className="easel-sheet" x="196" y="214" width="132" height="96" rx="3" /><rect className="easel-rule" x="203" y="221" width="118" height="82" rx="1" />
        <path className="easel-lines" d="M228 240 h68 M218 254 h88 M236 266 h52" />
        {Array.from({ length: 7 }, (_, i) => <circle key={i} className="easel-seal" style={{ '--i': i }} data-on={i < checks || undefined} cx={217 + i * 15} cy="288" r="5" />)}
        <g className="easel-hold" transform="rotate(-8 262 262)"><rect x="212" y="250" width="100" height="24" rx="3" /><text x="262" y="267" textAnchor="middle">ON HOLD</text></g>
      </g>
      <g className="podium"><path d="M716 424 l12 -98 h68 l12 98z" /><rect x="720" y="316" width="84" height="12" rx="3" /><path className="podium-mark" d="M750 360 l24 24 M774 360 l-24 24" /></g>
      {party && <g className="confetti">{CONFETTI.map((piece, i) => (
        <rect key={i} className={`confetto confetto-${piece.hue}`} x={piece.x} y="20" width="9" height="15" rx="2" style={{ animationDelay: `${piece.delay}s`, '--turn': `${piece.turn}deg` }} />))}</g>}
    </>
  );
}

function Desk({ index, kind }) {
  return (
    <g className="desk" data-kind={kind} transform={`translate(${index * ROOM_W} 0)`}>
      <rect className="desk-top" x="352" y="398" width="296" height="14" rx="4" />
      <rect className="desk-front" x="366" y="412" width="268" height="62" rx="3" /><rect className="desk-inset" x="380" y="424" width="240" height="38" rx="2" />
      <path className="desk-leg" d="M374 474 V500 M626 474 V500" />
      {kind === 'exam'
        ? <g className="sheet"><path d="M520 398 l12 -9 h64 l-10 9z" /><path className="sheet-line" d="M540 394 h44 M544 391 h38" /></g>
        : <g className="notebook"><path d="M512 398 l10 -10 h74 l-8 10z" /><path className="sheet-line" d="M532 393 h50" /><path className="mug" d="M404 398 v-18 h22 v18z M426 384 h7 v9 h-7" /></g>}
    </g>
  );
}

/**
 * @param {{ place: string, pose: string, tone: string, look: object, pkg: object|null, facts: object }} props
 * look: what the robot carries (see director.accessories). facts: real values the rooms display.
 */
export default function Stage({ place, pose, tone, look, pkg, facts }) {
  const target = placeIndex(place);
  // Where the robot stands now. It trails the requested room by one render, so
  // the move and its duration reach the DOM together and the walk is animated.
  const [at, setAt] = useState({ index: target, facing: 1, duration: 0, walking: false });

  useEffect(() => {
    if (at.index === target) return undefined;
    if (reducedMotion()) { setAt({ index: target, facing: 1, duration: 0, walking: false }); return undefined; }
    const duration = WALK_MS + (Math.abs(target - at.index) - 1) * WALK_EXTRA_MS;
    setAt({ index: target, facing: target > at.index ? 1 : -1, duration, walking: true });
    const timer = setTimeout(() => setAt((now) => ({ ...now, walking: false })), duration);
    return () => clearTimeout(timer);
  }, [target]);

  const { index, walking } = at;
  const shownPose = walking ? 'walk' : pose;
  const sit = !walking && SEATED.has(pose);
  const hold = walking ? null : pose === 'study' ? 'book' : ['report', 'glum', 'resolve'].includes(pose) ? 'card'
    : look.diploma && place === 'hall' ? 'diploma' : null;
  const lit = (id) => id === PLACES[index].id;

  return (
    <div className="stage" style={{ '--room': index, '--walk': `${at.duration}ms` }} data-place={PLACES[index].id}>
      <svg className="world" viewBox={`0 0 ${ROOM_W * PLACES.length} ${WORLD_H}`} role="img"
        aria-label={`Quill the robot in the ${PLACES[index].label} room of the school`}>
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0a1020" /><stop offset="0.7" stopColor="#1a2748" /><stop offset="1" stopColor="#33355c" /></linearGradient>
          <linearGradient id="wall-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0.5" /><stop offset="0.55" stopColor="#000" stopOpacity="0" /></linearGradient>
          <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe2ae" stopOpacity="0.36" /><stop offset="1" stopColor="#ffe2ae" stopOpacity="0.02" /></linearGradient>
          <linearGradient id="door" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd08a" /><stop offset="1" stopColor="#ff9f5a" /></linearGradient>
          <radialGradient id="pool"><stop offset="0" stopColor="#ffe2ae" stopOpacity="0.3" /><stop offset="1" stopColor="#ffe2ae" stopOpacity="0" /></radialGradient>
          <radialGradient id="glow"><stop offset="0" stopColor="#ffe2ae" stopOpacity="0.55" /><stop offset="1" stopColor="#ffe2ae" stopOpacity="0" /></radialGradient>
          <linearGradient id="shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fbf7ee" /><stop offset="1" stopColor="#ddd5c4" /></linearGradient>
        </defs>

        <Room index={0} id="gate" lit={lit('gate')} lamp={false}><Gate pkg={pkg} /></Room>
        <Room index={1} id="classroom" lit={lit('classroom')}><Classroom pkg={pkg} doneModules={facts.doneModules} /></Room>
        <Room index={2} id="exam" lit={lit('exam')}><ExamHall pkg={pkg} sitting={facts.sitting} /></Room>
        <Room index={3} id="office" lit={lit('office')}><Office cards={facts.cards} /></Room>
        <Room index={4} id="hall" lit={lit('hall')} lamp={false}><Hall diploma={look.diploma} checks={facts.checks} suspended={look.suspended} party={facts.party} /></Room>

        <g className="bot-pos" style={{ transform: `translate(${index * ROOM_W + 500}px, ${FLOOR_Y}px)` }}>
          <Robot pose={shownPose} tone={tone} hold={hold} cap={look.cap} badge={look.badge} sit={sit} suspended={look.suspended} facing={walking ? at.facing : 1} />
        </g>

        <Desk index={1} kind="class" /><Desk index={2} kind="exam" />
        {PLACES.map((entry, i) => <rect key={entry.id} className="room-dark" data-lit={lit(entry.id) || undefined} x={i * ROOM_W} y="0" width={ROOM_W} height={WORLD_H} />)}
        <g className="structure">
          <rect x="1000" y="0" width={ROOM_W * 4} height="40" />
          {[1, 2, 3, 4].map((i) => <g key={i}><rect x={i * ROOM_W - 15} y={i === 1 ? 0 : 40} width="30" height={i === 1 ? 216 : 176} /><rect className="lintel" x={i * ROOM_W - 22} y="210" width="44" height="10" rx="2" /></g>)}
          <rect x={ROOM_W * 5 - 15} y="0" width="30" height={WORLD_H} />
        </g>
      </svg>
    </div>
  );
}
