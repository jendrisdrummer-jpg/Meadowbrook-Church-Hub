FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8090 MB_DB=/data/meadowbrook.db MB_UPLOADS=/data/uploads MB_BACKUPS=/data/backups
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
COPY scripts ./scripts
VOLUME /data
EXPOSE 8090
HEALTHCHECK CMD node -e "fetch('http://localhost:8090/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
