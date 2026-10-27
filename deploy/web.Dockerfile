# The web app, and the preview origin's two files, served as static files. Build from the repository
# root:
#   docker compose -f deploy/compose.yml build web
FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY web ./
RUN pnpm build

FROM caddy:2-alpine
COPY deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
COPY --from=build /src/preview /srv-preview
# Served at /install.sh, so installing and upgrading is one command.
COPY install.sh /srv/install.sh
