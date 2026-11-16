import { useEffect, useRef } from 'react';

// Quill, the student. One SVG rig. A pose is a set of joint angles, an eye
// shape, a mouth and one looping motion, so every state shares the same body
// and moves between poses with the same easing.
//
// al / ar: left and right arm angle in degrees (0 hangs down; a positive left
// arm and a negative right arm swing outwards). hr / hy: head tilt and drop.
// look: where the eyes point; without it they follow the pointer.
const POSES = {
  idle: { al: 6, ar: -6, eyes: 'open', mouth: 'smile', anim: 'idle' },
  walk: { al: 0, ar: 0, eyes: 'open', mouth: 'smile', anim: 'walk', look: [5, 0] },
  read: { al: 8, ar: -8, hr: 6, eyes: 'open', mouth: 'smile', anim: 'still', look: [8, -5] },
  enrol: { al: 34, ar: -34, eyes: 'wide', mouth: 'open', anim: 'boot', look: [0, 0] },
  study: { al: -34, ar: 26, hr: -4, hy: 3, eyes: 'open', mouth: 'flat', anim: 'scan', look: [-7, 6] },
  exam: { al: -18, ar: 26, hr: 5, hy: 5, eyes: 'focus', mouth: 'flat', anim: 'write', look: [6, 8] },
  cheer: { al: 150, ar: -150, eyes: 'happy', mouth: 'open', anim: 'hop', look: [0, -2] },
  report: { al: 148, ar: -28, hr: -5, eyes: 'happy', mouth: 'open', anim: 'sway', look: [-7, -5] },
  glum: { al: 16, ar: -4, hr: 4, hy: 9, eyes: 'sad', mouth: 'frown', anim: 'still', look: [0, 7] },
  wait: { al: -30, ar: 30, eyes: 'wide', mouth: 'o', anim: 'bounce', look: [0, -6] },
  graduate: { al: 150, ar: -150, eyes: 'happy', mouth: 'open', anim: 'hop', look: [0, -3] },
  present: { al: 76, ar: -8, hr: -6, eyes: 'open', mouth: 'smile', anim: 'still', look: [-8, 0] },
  worried: { al: 76, ar: 38, hr: -3, eyes: 'wide', mouth: 'o', anim: 'shake', look: [-8, 1] },
  wave: { al: -26, ar: -150, eyes: 'happy', mouth: 'open', anim: 'wave', look: [0, -1] },
  proud: { al: -26, ar: -8, eyes: 'happy', mouth: 'smile', anim: 'sway', look: [0, -1] },
  resolve: { al: 16, ar: -146, eyes: 'focus', mouth: 'flat', anim: 'still', look: [0, 0] },
  confused: { al: 10, ar: -128, hr: 9, eyes: 'uneven', mouth: 'wavy', anim: 'scratch', look: [4, -3] },
};
export const POSE_NAMES = Object.keys(POSES);

// The eyes turn at most this far towards the pointer (SVG units).
const LOOK_X = 7;
const LOOK_Y = 5;
// Pointer distance, in pixels, at which the eyes reach full turn.
const LOOK_RANGE = 420;

function useFollowPointer(ref) {
  useEffect(() => {
    let frame = 0;
    const onMove = (event) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const node = ref.current;
        if (!node) return;
        const box = node.getBoundingClientRect();
        const dx = (event.clientX - (box.left + box.width / 2)) / LOOK_RANGE;
        const dy = (event.clientY - (box.top + box.height * 0.3)) / LOOK_RANGE;
        node.style.setProperty('--lx', (Math.max(-1, Math.min(1, dx)) * LOOK_X).toFixed(2));
        node.style.setProperty('--ly', (Math.max(-1, Math.min(1, dy)) * LOOK_Y).toFixed(2));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); cancelAnimationFrame(frame); };
  }, [ref]);
}

function Eye({ x }) {
  return (
    <g transform={`translate(${x} -56)`}>
      <g className="bot-eye">
        <rect className="eye-open" x="-8" y="-12" width="16" height="24" rx="8" />
        <path className="eye-arc" d="M-10 5 Q0 -11 10 5" />
      </g>
    </g>
  );
}

/**
 * @param {{ pose: string, tone?: string, hold?: 'book'|'card'|'diploma'|null, cap?: boolean,
 *   badge?: boolean, sit?: boolean, suspended?: boolean, facing?: number }} props
 */
export default function Robot({ pose = 'idle', tone = '', hold = null, cap = false, badge = false, sit = false, suspended = false, facing = 1 }) {
  const ref = useRef(null);
  useFollowPointer(ref);
  const p = POSES[pose] || POSES.idle;
  const style = {
    '--al': `${p.al}deg`, '--ar': `${p.ar}deg`, '--hr': `${p.hr || 0}deg`, '--hy': `${p.hy || 0}px`,
    '--fx': p.look ? `${p.look[0]}px` : 'calc(var(--lx, 0) * 1px)',
    '--fy': p.look ? `${p.look[1]}px` : 'calc(var(--ly, 0) * 1px)',
    '--facing': facing,
  };
  return (
    <g ref={ref} className="bot" style={style} data-pose={pose} data-anim={p.anim} data-eyes={p.eyes} data-mouth={p.mouth}
      data-tone={tone || undefined} data-hold={hold || undefined} data-cap={cap || undefined} data-badge={badge || undefined}
      data-sit={sit || undefined} data-suspended={suspended || undefined}>
      <ellipse className="bot-shadow" cx="0" cy="3" rx="64" ry="9" />
      <g className="bot-all">
        <g className="bot-leg bot-leg-l"><rect x="-31" y="-40" width="19" height="34" rx="7" className="bot-joint" /><rect x="-38" y="-13" width="32" height="14" rx="7" className="bot-shell" /></g>
        <g className="bot-leg bot-leg-r"><rect x="12" y="-40" width="19" height="34" rx="7" className="bot-joint" /><rect x="6" y="-13" width="32" height="14" rx="7" className="bot-shell" /></g>
        <g className="bot-torso">
          <rect x="-10" y="-134" width="20" height="16" className="bot-joint" />
          <rect x="-49" y="-124" width="98" height="90" rx="31" className="bot-shell" />
          <path d="M-49 -70 v5 a31 31 0 0 0 31 31 h36 a31 31 0 0 0 31 -31 v-5 a31 31 0 0 1 -31 22 h-36 a31 31 0 0 1 -31 -22z" className="bot-shade" />
          <rect x="-29" y="-106" width="58" height="34" rx="11" className="bot-glass" />
          <circle cx="-13" cy="-89" r="6.5" className="bot-led bot-heart" />
          <g className="bot-bars"><rect x="2" y="-96" width="4" height="14" rx="2" /><rect x="10" y="-96" width="4" height="14" rx="2" /><rect x="18" y="-96" width="4" height="14" rx="2" /></g>
          <g className="bot-badge"><path d="M14 -72 v10" /><rect x="3" y="-63" width="24" height="17" rx="3" /><circle cx="10" cy="-54.5" r="3.5" /><path d="M16 -57 h7 M16 -52 h5" /></g>

          <g transform="translate(-51 -106)"><g className="bot-arm bot-arm-l">
            <rect x="-9" y="-6" width="18" height="54" rx="9" className="bot-joint" />
            <g transform="translate(0 50)"><g className="bot-prop-up">
              <g className="bot-prop prop-book"><rect x="-34" y="-50" width="68" height="46" rx="4" /><path d="M0 -50 v46" /><rect x="-27" y="-42" width="20" height="5" rx="2" className="prop-mark" /><path d="M-34 -6 h68" className="prop-pages" /></g>
              <g className="bot-prop prop-card"><rect x="-24" y="-66" width="48" height="62" rx="4" /><path d="M-16 -55 h20 M-16 -44 h32 M-16 -36 h32 M-16 -28 h24" /><circle cx="10" cy="-16" r="8" className="prop-stamp" /></g>
              <g className="bot-prop prop-diploma"><rect x="-36" y="-56" width="72" height="50" rx="3" /><rect x="-31" y="-51" width="62" height="40" rx="1" className="prop-rule" /><path d="M-18 -41 h36 M-22 -33 h44 M-14 -26 h28" /><circle cx="20" cy="-17" r="7" className="prop-stamp" /><path d="M16 -11 l-3 10 7 -4 7 4 -3 -10" className="prop-stamp" /></g>
            </g></g>
            <circle cx="0" cy="50" r="12.5" className="bot-shell" />
          </g></g>
          <g transform="translate(51 -106)"><g className="bot-arm bot-arm-r">
            <rect x="-9" y="-6" width="18" height="54" rx="9" className="bot-joint" />
            <g className="bot-prop prop-pencil" transform="translate(0 50) rotate(-38)"><rect x="-3.5" y="-6" width="7" height="34" rx="2" /><path d="M-3.5 28 l3.5 9 3.5 -9z" className="prop-tip" /></g>
            <circle cx="0" cy="50" r="12.5" className="bot-shell" />
          </g></g>
        </g>

        <g transform="translate(0 -128)"><g className="bot-head">
          <g transform="translate(0 -94)"><g className="bot-antenna"><path d="M0 2 V-22" /><circle cx="0" cy="-29" r="8" className="bot-led bot-bulb" /></g></g>
          <rect x="-77" y="-66" width="14" height="32" rx="6" className="bot-joint" />
          <rect x="63" y="-66" width="14" height="32" rx="6" className="bot-joint" />
          <rect x="-67" y="-98" width="134" height="96" rx="38" className="bot-shell" />
          <path d="M-67 -42 v2 a38 38 0 0 0 38 38 h58 a38 38 0 0 0 38 -38 v-2 a38 38 0 0 1 -38 28 h-58 a38 38 0 0 1 -38 -28z" className="bot-shade" />
          <rect x="-53" y="-85" width="106" height="62" rx="26" className="bot-glass" />
          <path d="M-40 -74 q8 -7 22 -7" className="bot-glint" />
          <g className="bot-face">
            <Eye x={-24} /><Eye x={24} />
            <circle cx="-41" cy="-40" r="5" className="bot-cheek" /><circle cx="41" cy="-40" r="5" className="bot-cheek" />
            <path className="bot-mouth mouth-smile" d="M-9 -37 Q0 -30 9 -37" />
            <path className="bot-mouth mouth-flat" d="M-8 -35 H8" />
            <path className="bot-mouth mouth-frown" d="M-9 -32 Q0 -39 9 -32" />
            <path className="bot-mouth mouth-wavy" d="M-11 -35 q4 -5 7 0 t7 0 t7 0" />
            <ellipse className="bot-mouth mouth-o" cx="0" cy="-35" rx="5" ry="5.5" />
            <path className="bot-mouth mouth-open" d="M-11 -39 H11 Q9 -27 0 -27 Q-9 -27 -11 -39Z" />
          </g>
          <g className="bot-cap"><path d="M-46 -98 v-12 h92 v12z" className="cap-band" /><path d="M-78 -112 L0 -134 L78 -112 L0 -92Z" /><path d="M0 -113 L58 -108 V-78" className="cap-cord" /><rect x="53" y="-80" width="10" height="16" rx="3" className="cap-tassel" /></g>
          <text className="bot-query" x="58" y="-108">?</text>
        </g></g>
      </g>
    </g>
  );
}
