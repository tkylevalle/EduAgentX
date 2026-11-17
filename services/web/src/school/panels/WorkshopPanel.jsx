import { useState } from 'react';
import { api, short, stamp } from '../../lib.js';
import { healthSummary } from '../../status.js';
import { LAYERS } from '../../pages/System.jsx';
import { SECTIONS } from '../../pages/Evidence.jsx';
import { Card, Fact, Problem, Wait } from './parts.jsx';

// The health probe's latency bar is full at this many milliseconds, as on the Operator system map.
const SLOW_MS = 50;
const itemCount = (value) => (Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0);

/** Every service, grouped by the layer it belongs to, with its health check and how long the check took. */
function Services({ health }) {
  const { up, total } = healthSummary(health);
  return (
    <Card span={7} title="The building's services" fix="clip" aside={health && <strong className="shop-count">{up} of {total} up</strong>}>
      {!health && <Wait rows={6} />}
      {health?.length === 0 && <Problem what="The service list" error="the platform did not answer" />}
      {health && LAYERS.map(([id, name]) => {
        const services = health.filter((service) => service.layer === id);
        if (!services.length) return null;
        return (
          <div className="shop-layer" key={id}>
            <h3 className="s-h3">{name}</h3>
            <ul>
              {services.map((service) => (
                <li key={service.id} data-up={service.healthy}>
                  <i className="shop-lamp" />
                  <strong>{service.name}</strong>
                  <span className="shop-bar"><i style={{ width: `${Math.min(100, ((service.latencyMs || 0) / SLOW_MS) * 100)}%` }} /></span>
                  <span className="shop-ms">{service.healthy ? (service.latencyMs != null ? `${service.latencyMs} ms` : 'up') : 'no answer'}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </Card>
  );
}

/** The evidence bundle: a redacted, fingerprinted export of what the platform can back with live records. */
function Evidence({ health }) {
  const [state, setState] = useState({ bundle: null, busy: false, error: null });
  const serviceUp = health?.find((service) => service.id === 'evidence-bundle')?.healthy;
  const generate = async () => {
    setState((now) => ({ ...now, busy: true, error: null }));
    try { setState({ bundle: await api('/api/evidence/bundle', { method: 'POST', body: {} }), busy: false, error: null }); }
    catch (error) { setState({ bundle: null, busy: false, error: error.message }); }
  };
  const { bundle } = state;
  return (
    <Card span={5} title="Evidence box" fix="tape">
      {serviceUp === false && <Problem what="The evidence service" error="it is not answering. Diplomas are not affected; only this export must wait" />}
      <p className="s-lead">A redacted export of what the platform can prove right now. Every section has its own fingerprint.</p>
      <div className="s-actions">
        <button type="button" className="s-link" onClick={generate} disabled={state.busy}>{state.busy ? 'Packing the box' : bundle ? 'Pack the box again' : 'Pack the box'}</button>
        <a className="s-link" data-quiet href="/api/evidence/bundle.html" target="_blank" rel="noreferrer">Open as a page</a>
      </div>
      {state.error && <Problem what="The evidence box" error={state.error} />}
      {bundle && (
        <>
          <dl className="s-rows shop-bundle">
            <dt>Packed</dt><dd>{stamp(bundle.generatedAt)}</dd>
            <dt>Fingerprint</dt><dd><code>{short(bundle.bundleDigest, 16, 8)}</code></dd>
            <dt>Kept for</dt><dd>raw records {bundle.retention.raw}, summaries {bundle.retention.aggregate}</dd>
          </dl>
          <ul className="shop-sections">
            {SECTIONS.map(([key, label]) => {
              const items = itemCount(bundle.sections[key]);
              return <li key={key} data-empty={items === 0 || undefined}><strong>{items}</strong>{label}<code>{short(bundle.digests[key], 8, 4)}</code></li>;
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Caretaker's workshop: is the building running, and what can it prove. */
export default function WorkshopPanel({ status }) {
  const { health } = status;
  const slowest = health?.length ? Math.max(...health.map((service) => service.latencyMs || 0)) : null;
  return (
    <>
      <Services health={health} />
      <div className="s-col" data-span={5}>
        <Evidence health={health} />
        <Card kind="manila">
          <div className="s-facts s-facts-row">
            <Fact value={slowest} unit="ms" name="slowest health check" />
          </div>
        </Card>
      </div>
    </>
  );
}
