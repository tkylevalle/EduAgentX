FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
EXPOSE 4010
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4010/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
