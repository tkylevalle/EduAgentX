'use strict';

// Installs the locked dependencies of every package and service (npm ci).
const { spawnSync } = require('node:child_process');
const { listComponents } = require('./components');

for (const { name, directory } of listComponents()) {
  console.log(`Installing dependencies for ${name}...`);
  // shell: true lets Windows resolve npm.cmd; no argument is user input.
  const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: directory, stdio: 'inherit', shell: true,
  });
  if (result.status !== 0) {
    console.error(`npm ci failed for ${name}`);
    process.exit(result.status || 1);
  }
}
