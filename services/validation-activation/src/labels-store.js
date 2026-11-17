'use strict';
/**
 * Grader labels from people: one immutable label per person per response in a
 * dataset version. Postgres when a pool is given (grader-labels.sql forbids
 * UPDATE and DELETE), otherwise memory for tests and local runs.
 */
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'grader-labels.sql'), 'utf8');
const personKey = (version, responseId, labeller) => `${version}\n${responseId}\n${labeller.toLowerCase()}`;
const exportShape = ({ responseId, labeller, acceptable, score, safetyViolation, labelledAt }) =>
  ({ responseId, labeller, acceptable, score, safetyViolation, labelledAt });

function memoryStore() {
  const labels = new Map();
  return {
    async add(label) {
      const key = personKey(label.datasetVersion, label.responseId, label.labeller);
      if (labels.has(key)) return false;
      labels.set(key, Object.freeze({ ...label }));
      return true;
    },
    async labelledBy(datasetVersion, labeller) {
      const name = labeller.toLowerCase();
      return new Set([...labels.values()].filter((value) => value.datasetVersion === datasetVersion &&
        value.labeller.toLowerCase() === name).map((value) => value.responseId));
    },
    async all(datasetVersion) {
      return [...labels.values()].filter((value) => value.datasetVersion === datasetVersion).map(exportShape)
        .sort((a, b) => a.responseId.localeCompare(b.responseId) || a.labeller.localeCompare(b.labeller));
    },
  };
}

function postgresStore(pool) {
  // Applied on first use, so the service starts while the database does; a
  // failed attempt is not kept, and the next call tries again.
  let schema = null;
  const ready = () => {
    schema ??= pool.query(SCHEMA).catch((error) => { schema = null; throw error; });
    return schema;
  };
  return {
    async add(label) {
      await ready();
      const inserted = await pool.query(
        `INSERT INTO curriculum_engine.grader_labels
           (dataset_version, response_id, labeller, acceptable, score, safety_violation, labelled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [label.datasetVersion, label.responseId, label.labeller, label.acceptable, label.score, label.safetyViolation, label.labelledAt]);
      return inserted.rowCount === 1;
    },
    async labelledBy(datasetVersion, labeller) {
      await ready();
      const result = await pool.query(
        `SELECT response_id AS "responseId" FROM curriculum_engine.grader_labels
         WHERE dataset_version=$1 AND lower(labeller)=lower($2)`, [datasetVersion, labeller]);
      return new Set(result.rows.map((row) => row.responseId));
    },
    async all(datasetVersion) {
      await ready();
      const result = await pool.query(
        `SELECT response_id AS "responseId", labeller, acceptable, score, safety_violation AS "safetyViolation", labelled_at AS "labelledAt"
         FROM curriculum_engine.grader_labels WHERE dataset_version=$1 ORDER BY response_id, labeller`, [datasetVersion]);
      return result.rows.map((row) => exportShape({ ...row, labelledAt: new Date(row.labelledAt).toISOString() }));
    },
  };
}

/**
 * @param {{ pool?: { query: Function } | null }} [options]
 * @returns {{ add: (label: object) => Promise<boolean>, labelledBy: (version: string, labeller: string) => Promise<Set<string>>,
 *   all: (version: string) => Promise<object[]> }} add resolves false when the person already labelled the response
 */
function createLabelStore({ pool = null } = {}) {
  return pool ? postgresStore(pool) : memoryStore();
}

module.exports = { createLabelStore };
