#!/usr/bin/env node
'use strict';

const { SCENARIOS, validateCatalog } = require('../src');

const result = validateCatalog(SCENARIOS);
for (const scenario of SCENARIOS) {
  const fault = scenario.injectedFault ? scenario.injectedFault.safeState.state : '-';
  console.log(`${String(scenario.number).padStart(2)}  ${scenario.id.padEnd(32)} ${scenario.kind.padEnd(8)} ${scenario.evidenceMode.padEnd(10)} safe state: ${fault}`);
}
if (!result.valid) {
  console.error(`\n${result.errors.length} problem(s):`);
  result.errors.forEach((message) => console.error(`  - ${message}`));
  process.exit(1);
}
console.log('\nCatalog valid: 9 demonstrations, 6 with declared faults.');
