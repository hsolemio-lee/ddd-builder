# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
COPY server ./server
COPY mcp ./mcp
USER node
EXPOSE 3210
CMD ["node", "server/index.mjs"]
