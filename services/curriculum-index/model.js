'use strict';

const { createHash } = require('node:crypto');

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

module.exports = { sha256, extractChunks };

// Turn one validated, Active Domain Assurance Package payload into the small
// set of retrievable text chunks that get written into the ChromaDB index.
// Pure function: no network, no filesystem, no database calls. Given the
// same package payload, it always returns the same chunks with the same
// digests — that's what makes rebuilds deterministic and verifiable.
function extractChunks(pkg) {
  const { packageId, version, domain } = pkg.manifest;
  const quarantined = pkg.quarantinedScopes || [];
  const modules = (pkg.modules || []).filter((module) => !quarantined.some((scope) => {
    if (scope.scopeType === 'module') return scope.scopeId === module.id;
    if (scope.scopeType === 'objective') return module.objectiveIds?.includes(scope.scopeId) === true;
    if (scope.scopeType === 'delivery_item') return module.deliveryItems?.some((item) => item.id === scope.scopeId) === true;
    if (scope.scopeType === 'source') return module.claims?.some((claim) => claim.sourceId === scope.scopeId) === true;
    return true;
  }));

  return modules.map((module) => {
    const text = [module.title, module.content, ...(module.deliveryItems || []).map((item) => item.text)]
      .filter(Boolean)
      .join('\n\n');

    return {
      chunkId: `${packageId}@${version}:${module.id}`,
      packageId,
      version,
      domain,
      moduleId: module.id,
      objectiveIds: module.objectiveIds || [],
      text,
      digest: sha256(text),
    };
  });
}
