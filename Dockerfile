FROM node:22-alpine

RUN apk add --no-cache tzdata su-exec

ENV NODE_ENV=production \
    PORT=4444 \
    DATA_DIR=/data \
    TZ=Europe/Berlin

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server.js ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME /data
EXPOSE 4444

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
