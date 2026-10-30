FROM node:24-alpine
WORKDIR /app/services/skill-gap-service
COPY services/skill-gap-service/package.json services/skill-gap-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY packages /app/packages
COPY services/skill-gap-service ./
EXPOSE 4013
CMD ["node", "index.js"]
