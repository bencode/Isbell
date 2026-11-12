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
# The app is built with isbell's version, which vite.config.ts reads from ../Cargo.toml.
COPY Cargo.toml /Cargo.toml
# The speech service voice input goes to, if any (compose.yml).
ARG VITE_VOICE_URL
RUN pnpm build

FROM caddy:2-alpine
COPY deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
COPY --from=build /src/preview /srv-preview
# Served at /install.sh, so installing and upgrading is one command.
COPY install.sh /srv/install.sh
# Served at /agent-hook.sh, so Claude Code, Codex and pi can tell the board what they are doing
# (docs/setup.md).
COPY integrations/agent-hook.sh /srv/agent-hook.sh
