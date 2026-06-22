FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && rm -rf /var/lib/apt/lists/*

COPY server ./server
COPY public ./public
COPY dataset ./dataset
COPY scripts ./scripts

EXPOSE 3000

CMD ["npm", "start"]
