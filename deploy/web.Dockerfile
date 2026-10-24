# The web app, served as static files. Build from the repository root:
#   docker compose -f deploy/compose.yml build web
FROM node:24-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
    && pnpm build

FROM caddy:2-alpine
COPY deploy/web.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/packages/desk/dist /srv
