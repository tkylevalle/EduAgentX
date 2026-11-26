FROM node:20-alpine
WORKDIR /app
COPY services/grading-service/package*.json ./
RUN npm ci --omit=dev
COPY services/grading-service/src ./src
# Real judge verdicts the repository recorded (src/recorded-verdicts.js): the
# scripted agent's answers and the grading-validity dataset grade without a key.
COPY packages/grading-validity/dataset/judge-verdicts.v1.json packages/execution-provenance/scripted-verdicts.v1.json ./recorded-verdicts/
EXPOSE 4020
HEALTHCHECK --interval=5s --timeout=5s --retries=10 \
  CMD node -e "require('http').get('http://localhost:4020/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "src/index.js"]
