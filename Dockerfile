# syntax=docker/dockerfile:1
FROM node:25-trixie-slim@sha256:aabbe39553d15ede8a97cc60c9e1a97034ff772afcf696ea42b94e7f5f2ec71b AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
COPY shared ./shared
RUN npm run build \
    && npm prune --omit=dev \
    && mkdir -p /app/data && chown 1000:1000 /app/data

# Runtime has no shell, package manager or unused operating-system utilities.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e AS runtime
LABEL org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3210 DATA_DIR=/app/data PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin
WORKDIR /app
COPY --from=build --chown=1000:1000 /app/data ./data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json ./
COPY LICENSE ./LICENSE
COPY server ./server
COPY mcp ./mcp
COPY shared ./shared
# Preserve ownership of existing workshop volumes (the prior node user is UID1000).
USER 1000:1000
EXPOSE 3210
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["server/index.mjs"]
