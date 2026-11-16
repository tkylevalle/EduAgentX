# Build context is the repository root so the service can use packages/
# (the sandbox for the Studio checks, telemetry) and the curriculum model.
FROM node:24-alpine
WORKDIR /app/services/validation-activation
COPY services/validation-activation/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/validation-activation/src ./src
# Runtime imports the shared curriculum model, fallback bank and quote check from the repo tree.
RUN mkdir -p /app/services/curriculum-engine
COPY services/curriculum-engine/model.js services/curriculum-engine/fallback.js services/curriculum-engine/sections.js /app/services/curriculum-engine/
EXPOSE 4010
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4010/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
