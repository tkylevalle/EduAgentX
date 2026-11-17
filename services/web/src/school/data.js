import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib.js';

// What the school reads from the platform. Every value on screen comes from
// one of these calls or from the run stream; a call that fails shows as failed.

/**
 * @template T
 * @param {string|null} path null: nothing to load
 * @param {unknown} [refresh] the request repeats when this changes
 * @returns {{ data: T|null, error: string|null, loading: boolean }}
 */
export function useApi(path, refresh) {
  const [state, setState] = useState({ path, data: null, error: null, loading: Boolean(path) });
  useEffect(() => {
    if (!path) { setState({ path, data: null, error: null, loading: false }); return undefined; }
    let alive = true;
    setState((now) => (now.path === path ? { ...now, loading: true } : { path, data: null, error: null, loading: true }));
    api(path)
      .then((data) => alive && setState({ path, data, error: null, loading: false }))
      .catch((error) => alive && setState({ path, data: null, error: error.message, loading: false }));
    return () => { alive = false; };
  }, [path, refresh]);
  return state.path === path ? state : { data: null, error: null, loading: Boolean(path) };
}

/**
 * The course, the graduates, the open incidents and the school's counters.
 * `refresh` changes when a run ends or the number of safety alerts changes.
 */
export function useSchoolData(refresh) {
  const [noted, setNoted] = useState(0);
  const course = useApi('/api/package');
  const graduates = useApi('/api/credentials', refresh);
  const overview = useApi('/api/overview', refresh);
  const incidents = useApi('/api/incidents?status=open', `${refresh}:${noted}`);
  return {
    pkg: course.data?.package || null, pkgError: course.error,
    credentials: graduates.data?.credentials || null, credentialsError: graduates.error,
    overview: overview.data, overviewError: overview.error,
    incidents: incidents.data?.incidents || null, incidentsError: incidents.error,
    // Called after a note is added to an incident, so the staff room's board follows.
    reloadIncidents: useCallback(() => setNoted((count) => count + 1), []),
  };
}
