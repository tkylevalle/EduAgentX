FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY src ./src
EXPOSE 4040
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4040/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
