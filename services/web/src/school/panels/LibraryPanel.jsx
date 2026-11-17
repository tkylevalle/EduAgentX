import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { short } from '../../lib.js';
import { useApi } from '../data.js';
import { Card, Fact, Problem, Wait } from './parts.jsx';

const STATE_COPY = { Active: ['In use', 'ok'], AwaitingReview: ['Awaiting review', 'warn'] };
const flat = (text) => String(text || '').replace(/\s+/g, ' ');
const versionKey = (pkg) => `${pkg.packageId}@${pkg.version}`;
const versionPath = (pkg) => `/api/governance/packages/${encodeURIComponent(pkg.packageId)}/${encodeURIComponent(pkg.version)}`;

/** The course package as a library record: its state, its six automatic checks, its fingerprint. */
function Record({ pkg }) {
  const [state, tone] = STATE_COPY[pkg.state] || [pkg.state, 'warn'];
  const passed = pkg.gates.filter((gate) => gate.passed).length;
  return (
    <Card span={5} title={pkg.domain || 'The course'} fix="clip" aside={<span className="rubber" data-tone={tone}>{state}</span>}>
      <div className="s-facts s-facts-row">
        <Fact value={passed} unit={`of ${pkg.gates.length}`} name="automatic checks passed" />
        <Fact value={pkg.quarantinedScopes.length} name="parts set aside for correction" />
      </div>
      <ul className="lib-gates">
        {pkg.gates.map((gate) => (
          <li key={gate.name} data-passed={gate.passed}>
            {gate.passed ? <Check size={15} strokeWidth={3.2} /> : <X size={15} strokeWidth={3.2} />}
            {gate.name.replaceAll('_', ' ')}{!gate.passed && gate.reason ? `: ${gate.reason}` : ''}
          </li>
        ))}
      </ul>
      <dl className="s-rows">
        <dt>Package</dt><dd><code>{pkg.packageId}</code> v{pkg.version}</dd>
        <dt>Fingerprint</dt><dd><code>{short(pkg.digest, 18, 8)}</code></dd>
      </dl>
    </Card>
  );
}

function Shelf({ sources }) {
  return (
    <Card span={7} title="On the shelf" fix="tape">
      <ul className="lib-sources">
        {sources.map((source) => (
          <li key={source.id}>
            <span className="lib-spine" />
            <div><strong>{source.title}</strong><span>{source.issuer}, edition {source.edition}</span></div>
            {source.canonicalUrl && <a className="s-link" data-quiet href={source.canonicalUrl} target="_blank" rel="noreferrer">Read the source</a>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One claim of a lesson beside the source text it quotes. A quote that is not in the stored text is marked. */
function Claim({ claim, section }) {
  const text = flat(section?.text);
  const quote = flat(claim.quote);
  const at = section ? text.indexOf(quote) : -1;
  return (
    <li data-found={at >= 0}>
      <span className="lib-mark">{at >= 0 ? <Check size={15} strokeWidth={3.2} /> : <X size={15} strokeWidth={3.2} />}</span>
      <div>
        <strong>{claim.text}</strong>
        <span className="s-meta">{section?.locator || 'The source section is not stored'}</span>
        {at >= 0 ? <p>{text.slice(Math.max(0, at - 90), at)}<mark>{quote}</mark>{text.slice(at + quote.length, at + quote.length + 90)}</p>
          : <p className="lib-missing">The quote is not in the stored source text.</p>}
      </div>
    </li>
  );
}

function Claims({ detail, loading, error }) {
  const sections = new Map((detail?.sections || []).map((section) => [section.id, section]));
  const claims = (detail?.modules || []).flatMap((lesson) => lesson.claims.map((claim, index) => ({ key: `${lesson.id}-${index}`, claim })));
  return (
    <Card span={8} title="Every claim, beside its source" fix="pin">
      {error && <Problem what="The claims of this version" error={error} />}
      {loading && !detail && <Wait rows={6} />}
      {detail && <ul className="lib-claims">{claims.map(({ key, claim }) => <Claim key={key} claim={claim} section={sections.get(claim.sectionId)} />)}</ul>}
    </Card>
  );
}

function Versions({ list, error, chosen, onPick }) {
  return (
    <Card span={4} title="Versions" kind="manila">
      {error && <Problem what="The list of versions" error={error} />}
      {!list && !error && <Wait />}
      <ul className="s-files">
        {(list || []).map((entry) => (
          <li key={versionKey(entry)}><button type="button" aria-pressed={versionKey(entry) === chosen} onClick={() => onPick(versionKey(entry))}>
            <span className="s-dot" data-tone={entry.state === 'Active' ? 'ok' : 'warn'} title={entry.state} />
            <code>{entry.packageId} v{entry.version}</code>
            <strong>{Number.isInteger(entry.approvals) && Number.isInteger(entry.required) ? `${entry.approvals}/${entry.required}` : ''}</strong>
            <span>{(STATE_COPY[entry.state] || [entry.state])[0]}</span>
          </button></li>
        ))}
      </ul>
      <p className="s-lead">Two reviewers sign each version with their own accounts.</p>
      <button type="button" className="s-link" onClick={() => { window.location.hash = '/governance'; }}>Sign a review in Operator Mode</button>
    </Card>
  );
}

/** Library: the course's sources, its checks, and every claim beside the text it quotes. */
export default function LibraryPanel({ data }) {
  const versions = useApi('/api/governance/packages');
  const list = versions.data?.packages || null;
  const [picked, setPicked] = useState(null);
  // The library opens on the course the school teaches now; the visitor can pick another version.
  const taught = data.pkg ? versionKey(data.pkg) : null;
  const chosen = list?.find((entry) => versionKey(entry) === picked) || list?.find((entry) => versionKey(entry) === taught)
    || list?.find((entry) => entry.state === 'Active') || list?.[0] || null;
  const detail = useApi(chosen ? versionPath(chosen) : null);
  if (data.pkgError) return <Card><Problem what="The course" error={data.pkgError} /></Card>;
  if (!data.pkg) return <Card><Wait rows={6} /></Card>;
  return (
    <>
      <Record pkg={data.pkg} />
      <Shelf sources={data.pkg.sources || []} />
      <Claims detail={detail.data?.package || null} loading={detail.loading || versions.loading} error={detail.error} />
      <Versions list={list} error={versions.error} chosen={chosen ? versionKey(chosen) : null} onPick={setPicked} />
    </>
  );
}
