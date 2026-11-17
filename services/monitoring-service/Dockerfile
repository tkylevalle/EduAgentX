# Build context is the repository root so the service can use packages/.
FROM node:24-alpine
WORKDIR /app/services/monitoring-service
COPY services/monitoring-service/package.json services/monitoring-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/monitoring-service ./
EXPOSE 4040
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4040/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
