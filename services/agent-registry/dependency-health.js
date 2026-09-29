const telemetry = require('./telemetry');
function bounded(fn, milliseconds = 2000) {
  let timer;
  return Promise.race([
    Promise.resolve().then(fn),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dependency timeout')), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}
async function checkDependencies(postgres, redis) {
  const outcomes = await Promise.allSettled([
    telemetry.observe('agent-registry', 'postgres', 'health', () => bounded(() => postgres.health())),
    telemetry.observe('agent-registry', 'redis', 'health', () => bounded(async () => {
      if (!redis.isReady || await redis.ping() !== 'PONG') throw new Error('redis unavailable');
    })),
  ]);
  if (outcomes.some(x => x.status !== 'fulfilled')) throw new Error('dependency unavailable');
  return { postgres: 'ok', redis: 'ok' };
}
module.exports = { bounded, checkDependencies };
