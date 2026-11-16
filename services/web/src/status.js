import { useEffect, useState } from 'react';
import { api } from './lib.js';

// Platform status that both modes show: service health, open critical
// incidents, and whether a live model is configured.

const HEALTH_POLL_MS = 15000;
// The Critical banner checks the Attention Queue this often.
const CRITICAL_POLL_MS = 15000;

function usePolled(load, intervalMs) {
  useEffect(() => {
    let alive = true;
    const run = () => load(() => alive);
    run();
    const timer = setInterval(run, intervalMs);
    return () => { alive = false; clearInterval(timer); };
  }, []);
}

/**
 * @returns {{ health: Array<object>|null, critical: number|null, liveModel: { available: boolean, model?: string } }}
 * health null: not loaded yet. critical null: the incident log could not be read, so the state is unknown.
 */
export function useStatus() {
  const [health, setHealth] = useState(null);
  const [critical, setCritical] = useState(0);
  const [liveModel, setLiveModel] = useState({ available: false });

  usePolled((alive) => api('/api/health').then((data) => alive() && setHealth(data.services)).catch(() => alive() && setHealth([])), HEALTH_POLL_MS);
  usePolled((alive) => api('/api/incidents?status=open')
    .then((data) => alive() && setCritical(data.incidents.filter((incident) => incident.severity === 'critical').length))
    .catch(() => alive() && setCritical(null)), CRITICAL_POLL_MS);
  // Without a reply the live student stays unavailable, which is the safe reading.
  useEffect(() => { api('/api/live-model').then((data) => setLiveModel({ available: data.available === true, model: data.model })).catch(() => {}); }, []);

  return { health, critical, liveModel };
}

/** @returns {{ up: number, total: number, tone: ''|'ok'|'warn'|'bad' }} */
export function healthSummary(health) {
  const up = health?.filter((service) => service.healthy).length ?? 0;
  const total = health?.length ?? 0;
  const tone = !health ? '' : up === total ? 'ok' : up >= total - 2 ? 'warn' : 'bad';
  return { up, total, tone };
}
