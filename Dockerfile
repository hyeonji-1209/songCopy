# songCopy 단일 컨테이너: web 빌드 + API 서버(정적 서빙 겸함)
FROM node:24-alpine

WORKDIR /app

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web ./web
RUN cd web && npm run build

COPY server ./server

ENV PORT=3001
EXPOSE 3001

# DB 영속화: -v songcopy-data:/app/server/data
VOLUME /app/server/data

CMD ["node", "server/src/index.ts"]
