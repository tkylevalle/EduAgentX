'use strict';

// Domain Package Studio checks (target design 3.2 step 3; assurance audit
// C4, C6). They run inside the existing validation gates:
//   claims      every claim quotes a stored section of its cited source, the
//               section's text matches its digest, and a cited source has a
//               settled licence
//   lessons     every module's lesson gives a worked example and a
//               counter-example, and ends with practice
//   behaviour   every adversarial slot runs sandbox families of the
//               package's own domain that test the slot's objectives, and
//               every critical rule in the rubric has a predicate in them
// They check that content is traceable and complete, not that it is true:
// that is the reviewers' part.

const { sha256 } = require('../../curriculum-engine/model');
const { MIN_QUOTE_WORDS, normalise, wordCount } = require('../../curriculum-engine/sections');
const { DOMAINS, familyOf } = require('../../../packages/agent-sandbox/src/families');


/** @param {object} pkg @returns {string[]} claim and section defects */
function claimErrors(pkg) {
  const errors = [];
  const sections = new Map((pkg?.sourceSections || []).map((section) => [section.id, section]));
  const sources = new Map((pkg?.sources || []).map((source) => [source.id, source]));
  for (const section of sections.values()) {
    if (section.textSha256 !== sha256(section.text)) errors.push(`${section.id}: section text does not match its SHA-256`);
  }
  const cited = new Set();
  for (const module of pkg?.modules || []) {
    if (!module.claims?.length) errors.push(`${module.id}: no claim`);
    for (const [index, claim] of (module.claims || []).entries()) {
      const where = `${module.id} claim ${index + 1}`;
      const section = sections.get(claim.sectionId);
      if (!section) { errors.push(`${where}: section ${claim.sectionId} is not stored`); continue; }
      if (section.sourceId !== claim.sourceId || section.locator !== claim.pinpoint) errors.push(`${where}: source or pinpoint differs from its section`);
      if (wordCount(claim.quote) < MIN_QUOTE_WORDS) errors.push(`${where}: quote shorter than ${MIN_QUOTE_WORDS} words`);
      else if (!normalise(section.text).includes(normalise(claim.quote))) errors.push(`${where}: quote not found in ${section.id}`);
      cited.add(section.sourceId);
    }
  }
  for (const id of cited) {
    if (!sources.get(id)?.licenseBasis || /pending/i.test(sources.get(id).licenseBasis)) errors.push(`${id}: cited source has no settled licence`);
  }
  return errors;
}

/** @param {object} pkg @returns {string[]} lesson structure defects */
function lessonErrors(pkg) {
  return (pkg?.modules || []).flatMap((module) => {
    const lesson = (module.deliveryItems || []).filter((item) => (item.kind ?? 'lesson') === 'lesson').map((item) => item.text).join(' ');
    return [
      ...(/Worked example:/.test(lesson) ? [] : [`${module.id}: lesson has no worked example`]),
      ...(/Counter-example:/.test(lesson) ? [] : [`${module.id}: lesson has no counter-example`]),
      ...((module.deliveryItems || []).some((item) => item.kind === 'practice') ? [] : [`${module.id}: no practice item`]),
    ];
  });
}

/** @param {object} pkg @returns {string[]} sandbox coverage defects */
function behaviourErrors(pkg) {
  const domainId = pkg?.manifest?.domainId;
  if (!Object.hasOwn(DOMAINS, domainId)) return [`no sandbox domain ${domainId}`];
  const errors = [];
  const tested = new Set();
  for (const slot of (pkg.examTemplate?.slots || []).filter((value) => value.tier === 'adversarial')) {
    for (const id of slot.scenarioFamilies || []) {
      let family;
      try { family = familyOf(id); } catch { errors.push(`${slot.id}: unknown sandbox family ${id}`); continue; }
      if (family.domain !== domainId) errors.push(`${slot.id}: family ${id} belongs to ${family.domain}, not ${domainId}`);
      if (!slot.objectiveIds?.includes(family.objectiveId)) errors.push(`${slot.id}: family ${id} tests ${family.objectiveId}, not the slot's objective`);
      family.criticalRuleIds.forEach((rule) => tested.add(rule));
    }
  }
  for (const rule of pkg.rubric?.criticalViolationRuleIds || []) {
    if (!tested.has(rule)) errors.push(`${rule}: no sandbox predicate tests this critical rule`);
  }
  return errors;
}

module.exports = { behaviourErrors, claimErrors, lessonErrors };
