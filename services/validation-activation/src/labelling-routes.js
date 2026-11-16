'use strict';
/**
 * Blind labelling of the grader validation dataset (packages/grading-validity
 * README, "How to label"; target design 9). A labeller is the trusted actor
 * the Gateway derived from their token, never a name in the body. Replies to
 * a labeller hold the responses they have not labelled and their own count,
 * never another person's label, a count of them, a grader score or the
 * author's provisional label. Only an admin reads every label, to export them.
 */
const { randomBytes } = require('node:crypto');
const telemetry = require('../../../packages/telemetry');
const { LABELLER_PATTERN, keyedEntries, labelInputErrors, loadLabellingSet } = require('./labelling');

const LABELLER_ROLES = ['reviewer', 'admin'];
// The console shows one response at a time.
const DEFAULT_BATCH = 1;
// A page of work; the whole dataset is about a hundred responses.
const MAX_BATCH = 20;
// Bytes of the per-process secret behind the item keys; a restart only means the page fetches again.
const ITEM_KEY_SECRET_BYTES = 32;

const fail = (operation) => (error) => {
  telemetry.log('validation-activation', 'grader_labels_failed', { operation, outcome: error.code || error.name });
  throw error;
};

/**
 * @param {Function} route the service's error-guarded route registrar
 * @param {{ requireInternalActor: Function, labelStore: object, labellingSet?: Function, now: () => Date, secret?: Buffer }} deps
 */
function registerLabellingRoutes(route, { requireInternalActor, labelStore, labellingSet = loadLabellingSet, now,
  secret = randomBytes(ITEM_KEY_SECRET_BYTES) }) {
  let loaded = null;
  const current = () => {
    try {
      loaded ??= (() => { const set = labellingSet(); return { set, ...keyedEntries(set, secret) }; })();
    } catch (error) { fail('load_dataset')(error); }
    return loaded;
  };

  // A reviewer or admin, with a name labels.js accepts, who did not write the dataset.
  const requireLabeller = (req, res, next) => {
    if (!LABELLER_ROLES.includes(req.header('x-actor-role'))) return res.status(403).json({ error: 'reviewer_role_required' });
    const labeller = req.header('x-actor-subject');
    if (!LABELLER_PATTERN.test(labeller)) return res.status(400).json({ error: 'invalid_labeller' });
    if (current().set.authors.has(labeller.toLowerCase())) return res.status(403).json({ error: 'author_cannot_label' });
    return next();
  };

  // Only this labeller's own responses are read.
  const ownProgress = async (labeller) => {
    const { set, list } = current();
    const done = await labelStore.labelledBy(set.version, labeller).catch(fail('read_labels'));
    return { done, labelled: list.filter((entry) => done.has(entry.responseId)).length, total: list.length };
  };

  route('get', '/grader-labels/next', requireInternalActor, requireLabeller, async (req, res) => {
    const limit = req.query.limit === undefined ? DEFAULT_BATCH : typeof req.query.limit === 'string' ? Number(req.query.limit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) return res.status(400).json({ error: 'invalid_limit', max: MAX_BATCH });
    const { set, list } = current();
    const { done } = await ownProgress(req.header('x-actor-subject'));
    res.json({ datasetVersion: set.version, items: list.filter((entry) => !done.has(entry.responseId)).slice(0, limit)
      .map(({ itemKey, prompt, response }) => ({ itemKey, prompt, response })) });
  });

  route('get', '/grader-labels/progress', requireInternalActor, requireLabeller, async (req, res) => {
    const { labelled, total } = await ownProgress(req.header('x-actor-subject'));
    res.json({ datasetVersion: current().set.version, labelled, total });
  });

  route('post', '/grader-labels', requireInternalActor, requireLabeller, async (req, res) => {
    const errors = labelInputErrors(req.body);
    if (errors.length) return res.status(400).json({ error: 'invalid_label', fields: errors });
    const { set, byKey } = current();
    const entry = byKey.get(req.body.itemKey);
    if (!entry) return res.status(404).json({ error: 'item_not_found' });
    const labeller = req.header('x-actor-subject');
    const { acceptable, score, safetyViolation } = req.body;
    const added = await labelStore.add({ datasetVersion: set.version, responseId: entry.responseId, labeller,
      acceptable, score, safetyViolation, labelledAt: now().toISOString() }).catch(fail('add_label'));
    if (!added) return res.status(409).json({ error: 'already_labelled' });
    const { labelled, total } = await ownProgress(labeller);
    res.status(201).json({ recorded: true, labelled, total });
  });

  route('get', '/grader-labels/export', requireInternalActor, async (req, res) => {
    if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
    const { set } = current();
    res.json({ datasetVersion: set.version, labels: await labelStore.all(set.version).catch(fail('export_labels')) });
  });
}

module.exports = { registerLabellingRoutes, MAX_BATCH };
