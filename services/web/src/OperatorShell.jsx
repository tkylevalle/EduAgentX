import { useEffect, useRef, useState } from 'react';
import { Activity, BadgeCheck, BellRing, BookOpenCheck, FileCheck2, FlaskConical, Gavel, LayoutDashboard, Network, ScanLine, Store, Tags } from 'lucide-react';
import { BrandMark } from './ui.jsx';
import { api, ago, clock, EVENT_COPY } from './lib.js';
import { healthSummary } from './status.js';
import ModeSwitch from './ModeSwitch.jsx';
import Overview from './pages/Overview.jsx';
import Lab from './pages/Lab.jsx';
import Credentials from './pages/Credentials.jsx';
import Verify from './pages/Verify.jsx';
import Curriculum from './pages/Curriculum.jsx';
import System from './pages/System.jsx';
import Marketplace from './pages/Marketplace.jsx';
import Evidence from './pages/Evidence.jsx';
import Governance from './pages/Governance.jsx';
import Attention from './pages/Attention.jsx';
import Labelling from './pages/Labelling.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, component: Overview },
  { id: 'lab', label: 'Lifecycle Lab', icon: FlaskConical, component: Lab },
  { id: 'credentials', label: 'Credentials', icon: BadgeCheck, component: Credentials },
  { id: 'verify', label: 'Verify', icon: ScanLine, component: Verify },
  { id: 'curriculum', label: 'Curriculum', icon: BookOpenCheck, component: Curriculum },
  { id: 'governance', label: 'Governance', icon: Gavel, component: Governance },
  { id: 'labelling', label: 'Labelling', icon: Tags, component: Labelling },
  { id: 'attention', label: 'Attention', icon: BellRing, component: Attention },
  { id: 'system', label: 'System', icon: Network, component: System },
  { id: 'marketplace', label: 'Marketplace', icon: Store, component: Marketplace },
  { id: 'evidence', label: 'Evidence', icon: FileCheck2, component: Evidence },
];
const LIGHT_TARGETS = '.panel, .ledger-cell, .seg-option';
const TICKER_POLL_MS = 8000;

// The newest domain event, shown in the top bar; it flashes when it changes.
function useLatestEvent() {
  const [event, setEvent] = useState(null);
  const [fresh, setFresh] = useState(false);
  const last = useRef(null);
  useEffect(() => {
    let alive = true;
    const load = () => api('/api/overview').then((data) => {
      const latest = data.events?.[0] || null;
      if (!alive || !latest) return;
      const key = `${latest.type}:${latest.receivedAt}`;
      if (last.current && last.current !== key) { setFresh(true); setTimeout(() => alive && setFresh(false), 1300); }
      last.current = key;
      setEvent(latest);
    }).catch(() => {});
    load();
    const timer = setInterval(load, TICKER_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return [event, fresh];
}

/**
 * Operator Mode: the technical console, every page of it.
 * @param {{ pageId: string, status: ReturnType<import('./status.js').useStatus>, onSwitch: () => void }} props
 */
export default function OperatorShell({ pageId, status, onSwitch }) {
  const page = PAGES.find((entry) => entry.id === pageId) || PAGES[0];
  const { health, critical, liveModel } = status;
  const [now, setNow] = useState(() => new Date());
  const [event, fresh] = useLatestEvent();

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    // Pointer light: each surface lights up where the pointer is.
    const onMove = (moveEvent) => {
      const target = moveEvent.target.closest?.(LIGHT_TARGETS);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${moveEvent.clientX - rect.left}px`);
      target.style.setProperty('--my', `${moveEvent.clientY - rect.top}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); clearInterval(tick); };
  }, []);

  useEffect(() => { document.title = `${page.label} · EduAgentX`; }, [page]);

  const { up, total, tone } = healthSummary(health);
  const [eventCopy, eventTone] = EVENT_COPY[event?.type] || [event?.type, ''];
  const Page = page.component;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">EduAgentX</div>
            <div className="brand-sub">Agent assurance</div>
          </div>
        </div>
        {PAGES.map(({ id, label, icon: Icon }, index) => (
          <button key={id} className="nav-item" aria-current={page.id === id ? 'page' : undefined} title={label}
            onClick={() => { window.location.hash = `/${id}`; }}>
            <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
            <Icon size={16} strokeWidth={2} /><span>{label}</span>
          </button>
        ))}
        <div className="rail-foot">
          Local Compose<br />
          {liveModel.available ? 'Simulation + live evidence' : 'Simulation evidence'}
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="crumb">EduAgentX / <strong>{page.label}</strong></span>
          <span className="spacer" />
          {event && (
            <span className={`ticker ${fresh ? 'flash' : ''}`} aria-live="polite">
              <span className={`dot ${eventTone} live`} />
              <span className="ticker-text">{eventCopy} · <code>{event.agentId}</code> · {ago(event.receivedAt)}</span>
            </span>
          )}
          <span className="env-chip hide-sm"><Activity size={12} /> {liveModel.available ? 'Synthetic + live learner' : 'Synthetic learner'}</span>
          <button className="env-chip" style={{ background: 'none', cursor: 'pointer' }} onClick={() => { window.location.hash = '/system'; }}>
            <span className={`dot ${tone} ${tone === 'ok' ? 'live' : ''}`} />{health ? `${up}/${total} up` : 'Checking'}
          </button>
          <span className="data faint hide-sm">{clock(now)}</span>
          <ModeSwitch mode="operator" onSwitch={onSwitch} />
        </header>
        {critical === null && (
          <div className="notice warn" role="status" style={{ margin: '12px 24px 0' }}>
            <BellRing size={14} /> Incident log unreachable: whether a critical incident is open is UNKNOWN.
          </div>
        )}
        {critical > 0 && page.id !== 'attention' && (
          <button className="notice bad" role="alert" style={{ margin: '12px 24px 0', textAlign: 'left', cursor: 'pointer' }}
            onClick={() => { window.location.hash = '/attention'; }}>
            <BellRing size={14} /> {critical} open critical incident{critical > 1 ? 's' : ''}: a runtime violation or a failed suspension needs a person. Open the Attention Queue.
          </button>
        )}
        <Page key={page.id} health={health} />
      </div>
    </div>
  );
}
