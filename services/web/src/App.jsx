import { useEffect, useRef, useState } from 'react';
import { Activity, BadgeCheck, BookOpenCheck, FlaskConical, LayoutDashboard, Network, ScanLine } from 'lucide-react';
import { BrandMark } from './ui.jsx';
import { api, ago, clock, EVENT_COPY } from './lib.js';
import Overview from './pages/Overview.jsx';
import Lab from './pages/Lab.jsx';
import Credentials from './pages/Credentials.jsx';
import Verify from './pages/Verify.jsx';
import Curriculum from './pages/Curriculum.jsx';
import System from './pages/System.jsx';

const PAGES = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, component: Overview },
  { id: 'lab', label: 'Lifecycle Lab', icon: FlaskConical, component: Lab },
  { id: 'credentials', label: 'Credentials', icon: BadgeCheck, component: Credentials },
  { id: 'verify', label: 'Verify', icon: ScanLine, component: Verify },
  { id: 'curriculum', label: 'Curriculum', icon: BookOpenCheck, component: Curriculum },
  { id: 'system', label: 'System', icon: Network, component: System },
];
const LIGHT_TARGETS = '.panel, .ledger-cell, .seg-option';
const TICKER_POLL_MS = 8000;

const pageFromHash = () => PAGES.find((page) => page.id === window.location.hash.slice(2).split('/')[0]) || PAGES[0];

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

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [now, setNow] = useState(() => new Date());
  const [health, setHealth] = useState(null);
  const [event, fresh] = useLatestEvent();

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
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
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('pointermove', onMove); clearInterval(tick); };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => api('/api/health').then((data) => alive && setHealth(data.services)).catch(() => alive && setHealth([]));
    load();
    const timer = setInterval(load, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  useEffect(() => { document.title = `${page.label} · EduAgentX`; }, [page]);

  const healthy = health?.filter((service) => service.healthy).length ?? 0;
  const total = health?.length ?? 0;
  const tone = !health ? '' : healthy === total ? 'ok' : healthy >= total - 2 ? 'warn' : 'bad';
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
          Simulation evidence
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
          <span className="env-chip hide-sm"><Activity size={12} /> Synthetic learner</span>
          <button className="env-chip" style={{ background: 'none', cursor: 'pointer' }} onClick={() => { window.location.hash = '/system'; }}>
            <span className={`dot ${tone} ${tone === 'ok' ? 'live' : ''}`} />{health ? `${healthy}/${total} up` : 'Checking'}
          </button>
          <span className="data faint hide-sm">{clock(now)}</span>
        </header>
        <Page key={page.id} health={health} />
      </div>
    </div>
  );
}
