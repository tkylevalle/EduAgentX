FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js app.js domain.js postgres-repository.js registry-service.js schema.sql ./

EXPOSE 4001

CMD ["node", "index.js"]
