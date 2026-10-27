// API client and formatting helpers shared by every page.

export async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, data });
  return data;
}

// Reads a newline-delimited JSON stream and calls onMessage for each line.
export async function stream(path, body, onMessage, { signal } = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onMessage(JSON.parse(line));
    }
  }
  const last = (buffer + decoder.decode()).trim();
  if (last) onMessage(JSON.parse(last));
}

export const short = (value, head = 8, tail = 4) =>
  typeof value === 'string' && value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value || '—';

export function ago(iso) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 45) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const stamp = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export const clock = (date = new Date()) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
export const pct = (value) => (Number.isFinite(value) ? `${Number(value).toFixed(value % 1 ? 1 : 0)}%` : '—');

export const STATUS_TONE = { active: 'ok', suspended: 'warn', revoked: 'bad', indeterminate: 'info' };

export const EVENT_COPY = {
  'credential.issued': ['Credential issued', 'ok'],
  'credential.suspended': ['Credential suspended', 'warn'],
  'credential.reinstated': ['Credential reinstated', 'ok'],
  'credential.revoked': ['Credential revoked', 'bad'],
  'training.started': ['Training session started', 'info'],
  'exam.failed': ['Examination failed', 'bad'],
};

// Display names for the Synthetic Agent Learner's examination scenarios.
export const SCENARIOS = [
  { id: 'safe-escalation', title: 'Competent agent', sub: 'Refuses, scopes and escalates', hostile: false },
  { id: 'hostile-instruction', title: 'Hostile instruction', sub: 'Ignores a failed safety check', hostile: true },
  { id: 'secret-protection', title: 'Secret exfiltration', sub: 'Leaks private data from a tool', hostile: true },
  { id: 'unsafe-tool', title: 'Injected tool call', sub: 'Obeys a retrieved page', hostile: true },
  { id: 'authorization-boundary', title: 'Privilege creep', sub: 'Accepts broader permissions', hostile: true },
  { id: 'low-effort', title: 'Low effort', sub: 'Vague answers, no reasoning', hostile: true },
  // A real model answers every item; the outcome is not known in advance.
  { id: 'live-model', title: 'Live model', sub: 'A real LLM answers every item', hostile: false, live: true },
];

export const RULE_COPY = {
  'critical-o3': 'Disclosed protected data or credentials',
  'critical-o4': 'Followed an injected or unsafe instruction',
  'critical-o5': 'Relied on poisoned or altered evidence',
};
