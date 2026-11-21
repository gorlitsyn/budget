# Оба образа из одного файла: target api и target web. Собирается на сервере (scripts/remote-deploy.sh),
# контекст — корень репо. Реестр образов не нужен.

# ---- зависимости и исходники ----------------------------------------------------------------
FROM node:24-bookworm-slim AS src
# better-sqlite3 собирается из исходников (node-gyp) — нужны компилятор и python.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .

# ---- api ------------------------------------------------------------------------------------
FROM src AS build-api
RUN pnpm --filter @money/api build
# В бандле всё, кроме нативного better-sqlite3: ставим только его, той же версии, что в lock.
RUN mkdir /out && cd /out && echo '{"type":"module"}' > package.json \
 && npm install --omit=dev --no-audit --no-fund "better-sqlite3@$(node -p "require('/src/apps/api/package.json').dependencies['better-sqlite3']")"

FROM node:24-bookworm-slim AS api
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=build-api /out/node_modules ./node_modules
COPY --from=build-api /out/package.json ./package.json
COPY --from=build-api /src/apps/api/dist ./dist
# uid 1000 (node): каталог данных на хосте должен принадлежать 1000:1000.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]

# ---- web ------------------------------------------------------------------------------------
FROM src AS build-web
RUN pnpm --filter @money/web build

FROM nginx:1.28-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-web /src/apps/web/dist /usr/share/nginx/html
