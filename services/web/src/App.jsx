import { useEffect, useState } from 'react';
import { Activity, BadgeCheck, BookOpenCheck, FlaskConical, LayoutDashboard, Network, ScanLine } from 'lucide-react';
import { BrandMark } from './ui.jsx';
import { api, clock } from './lib.js';
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

const pageFromHash = () => PAGES.find((page) => page.id === window.location.hash.slice(2).split('/')[0]) || PAGES[0];

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [now, setNow] = useState(() => new Date());
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => { window.removeEventListener('hashchange', onHash); clearInterval(tick); };
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
  const Page = page.component;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">EduAgentX</div>
            <div className="brand-sub">Agent competency assurance</div>
          </div>
        </div>
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button key={id} className="nav-item" aria-current={page.id === id ? 'page' : undefined}
            onClick={() => { window.location.hash = `/${id}`; }}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
          </button>
        ))}
        <div className="rail-foot">
          Local Compose environment<br />
          Simulation evidence only
        </div>
      </nav>
      <div className="main">
        <header className="topbar">
          <span className="crumb">Assurance / <strong>{page.label}</strong></span>
          <span className="spacer" />
          <span className="env-chip hide-sm"><Activity size={13} /> Synthetic Agent Learner</span>
          <button className="env-chip" style={{ background: 'none', cursor: 'pointer' }} onClick={() => { window.location.hash = '/system'; }}>
            <span className={`dot ${tone}`} />{health ? `${healthy}/${total} services` : 'Checking services'}
          </button>
          <span className="data faint hide-sm">{clock(now)}</span>
        </header>
        <Page key={page.id} health={health} />
      </div>
    </div>
  );
}
