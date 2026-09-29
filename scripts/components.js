'use strict';

// Every folder in packages/ and services/ that has a package.json is a
// component. Shared packages come first. A new service is picked up
// automatically by install, unit tests and the Sprint gate.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function listComponents() {
  return ['packages', 'services'].flatMap((group) => {
    const groupDirectory = path.join(root, group);
    return fs.readdirSync(groupDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, directory: path.join(groupDirectory, entry.name) }))
      .filter(({ directory }) => fs.existsSync(path.join(directory, 'package.json')))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

module.exports = { listComponents, root };
