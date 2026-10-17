FROM node:24-alpine
WORKDIR /app/services/certification-service
COPY services/certification-service/package.json services/certification-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/certification-service ./
EXPOSE 4011
CMD ["node", "index.js"]
