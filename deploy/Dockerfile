# The relay image. Build from the repository root: docker compose -f deploy/compose.yml build
FROM rust:1.99-slim-bookworm AS build
WORKDIR /src
COPY . .
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked -p isbell-relay \
    && cp target/release/isbell-relay /isbell-relay

FROM debian:bookworm-slim
COPY --from=build /isbell-relay /usr/local/bin/isbell-relay
USER nobody
EXPOSE 8787
ENTRYPOINT ["isbell-relay"]
