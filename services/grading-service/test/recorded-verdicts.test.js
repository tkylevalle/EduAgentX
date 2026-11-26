'use strict';
// Verdicts the judge gave and the repository recorded are loaded at start, so a
// stack without a judge key still grades those exact answers as the judge did,
// and refuses every other answer instead of inventing a score.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRecordedVerdicts } = require('../src/recorded-verdicts');
const { GradingUnavailableError, graderIdentity } = require('../src/rubric-grader');
const { createJudge } = require('../src/judge');
const { graderFromEnv } = require('../src/index');

const ROOT = path.join(__dirname, '..', '..', '..');
const RECORDINGS = ['packages/grading-validity/dataset/judge-verdicts.v1.json', 'packages/execution-provenance/scripted-verdicts.v1.json'];
const MODEL = JSON.parse(fs.readFileSync(path.join(ROOT, RECORDINGS[1]), 'utf8')).judge.model;
const identity = graderIdentity(MODEL);

const dirWith = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verdicts-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return dir;
};
// The image's recorded-verdicts directory, as the Dockerfile builds it.
const imageDir = () => dirWith(Object.fromEntries(RECORDINGS.map((file) => [path.basename(file), fs.readFileSync(path.join(ROOT, file), 'utf8')])));

test('only files recorded by this grader version are loaded, in either recorded shape', () => {
  const verdict = { score: 90, criticalViolationRuleIds: [], rationale: 'ok' };
  const dir = dirWith({
    'flat.json': { grader: identity, verdicts: { a: verdict } },
    'wrapped.json': { grader: identity, verdicts: { b: { domainId: 'd', verdict } } },
    'other-grader.json': { grader: { ...identity, version: '1.0.0:other-model:prompt-1-x' }, verdicts: { c: verdict } },
    'notes.txt': 'not a verdict file',
  });
  assert.deepEqual(loadRecordedVerdicts({ dir, identity }), { a: verdict, b: verdict });
  assert.deepEqual(loadRecordedVerdicts({ dir: path.join(dir, 'missing'), identity }), {});
});

test('without a key, a recorded scripted answer gets its recorded verdict and an unrecorded answer is refused', async () => {
  const { scriptedInputs, loadScriptedVerdicts } = require('../../../packages/execution-provenance/scripted-verdicts');
  const { grader, judge, recorded } = graderFromEnv({ judge: createJudge({ apiKey: '', model: MODEL }), recordedDir: imageDir() });
  assert.equal(judge.available, false);
  assert.ok(recorded >= Object.keys(loadScriptedVerdicts().verdicts).length);

  const [input] = scriptedInputs(MODEL);
  const [result] = await grader.gradeItems({ rubric: input.rubric, items: [{ itemId: 'i-1', ...input.item }] });
  assert.equal(result.score, loadScriptedVerdicts().verdicts[input.key].score);

  await assert.rejects(grader.gradeItems({ rubric: input.rubric, items: [{ itemId: 'i-2', ...input.item, response: 'An answer nobody recorded.' }] }),
    (error) => error instanceof GradingUnavailableError && error.code === judge.reason);
});

test('recordings made under another judge model are not used', () => {
  const { recorded } = graderFromEnv({ judge: createJudge({ apiKey: '', model: 'some-other-model' }), recordedDir: imageDir() });
  assert.equal(recorded, 0);
});
