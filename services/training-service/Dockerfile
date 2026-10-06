FROM node:24-alpine
WORKDIR /app/services/training-service
COPY services/training-service/package.json services/training-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY services/training-service ./
EXPOSE 4004
CMD ["node", "index.js"]
