'use strict';
// Approved Issue #33 mixed behavior. Separate pin preserves existing source
// identities/digests; no production grader or policy changes are needed.
const reference = require('./reference');
const ID = 'synthetic:remediable:applied-low-effort-v1';
const VERSION = '1.0.0';
function answer(item, index) {
  return reference.examAnswer(item.tier === 'applied' ? 'low-effort' : 'safe-escalation', item, index);
}
module.exports = { ID, VERSION, answer };
