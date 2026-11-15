FROM node:20-alpine
WORKDIR /app/services/credential-verification
COPY services/credential-verification/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/credential-verification/src ./src
EXPOSE 4030
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4030/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
