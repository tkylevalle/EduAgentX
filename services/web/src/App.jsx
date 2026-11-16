import { useCallback, useEffect, useRef, useState } from 'react';
import { parseHash, switchMode } from './mode.mjs';
import { useStatus } from './status.js';
import OperatorShell from './OperatorShell.jsx';
import School from './school/School.jsx';

const MODE_KEY = 'eduagentx.mode';
const TYPING = 'input, textarea, select, [contenteditable="true"]';

// Storage can be blocked (private window, site data off). The mode then lives
// in the hash only, which is enough for the session.
function storedMode() {
  try { return window.localStorage.getItem(MODE_KEY); } catch { return null; }
}
function storeMode(mode) {
  try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* see above */ }
}

const readRoute = () => parseHash(window.location.hash, storedMode());

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const status = useStatus();
  const lastSwitch = useRef(null);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { storeMode(route.mode); }, [route.mode]);

  // The hash is read at the time of the switch: School moves it as the run moves.
  const onSwitch = useCallback(() => {
    const next = switchMode(readRoute(), lastSwitch.current);
    lastSwitch.current = next.last;
    window.location.hash = next.hash;
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key?.toLowerCase() !== 'm' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest?.(TYPING)) return;
      onSwitch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSwitch]);

  return route.mode === 'school'
    ? <School place={route.part} status={status} onSwitch={onSwitch} />
    : <OperatorShell pageId={route.part} status={status} onSwitch={onSwitch} />;
}
