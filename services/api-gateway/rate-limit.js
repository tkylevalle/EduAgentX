// Local walking-skeleton limit. Multi-instance deployments need a shared counter.
function createRateLimit({ limit = 600, windowMs = 60_000, now = Date.now } = {}) {
  const clients = new Map();
  return (req, res, next) => {
    if (!req.path.startsWith('/v1/')) return next();
    const time = now();
    for (const [key, entry] of clients) if (entry.reset <= time) clients.delete(key);
    const key = req.ip;
    let entry = clients.get(key);
    if (!entry) {
      if (clients.size >= 10_000) return reject(res, req, 1);
      entry = { count: 0, reset: time + windowMs };
      clients.set(key, entry);
    }
    if (++entry.count > limit) return reject(res, req, Math.max(1, Math.ceil((entry.reset - time) / 1000)));
    return next();
  };
}
function reject(res, req, seconds) {
  res.setHeader('Retry-After', seconds);
  return res.status(429).json({ apiVersion: 'v1', error: 'rate_limited', correlationId: req.correlationId });
}
module.exports = { createRateLimit };
