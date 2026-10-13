# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.1.0 --activate
WORKDIR /app

# Dependencies for the web app and its workspace packages only.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY receipt/package.json receipt/
COPY ops/package.json ops/
COPY indexer/package.json indexer/
RUN pnpm install --frozen-lockfile --filter @aria-clearing/web...

FROM deps AS build
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_CHAIN_ID
ARG NEXT_PUBLIC_CLEARING_ADDRESS
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_CHAIN_ID=$NEXT_PUBLIC_CHAIN_ID \
    NEXT_PUBLIC_CLEARING_ADDRESS=$NEXT_PUBLIC_CLEARING_ADDRESS
COPY . .
RUN test -n "$NEXT_PUBLIC_PRIVY_APP_ID" || (echo "NEXT_PUBLIC_PRIVY_APP_ID build arg is required" >&2 && exit 1)
RUN pnpm --filter @aria-clearing/web build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    ARIA_DATA_DIR=/data

# server.js runs with cwd /app/web; deployment.ts reads /app/deployments/10143.json.
COPY --from=build --chown=1000:1000 /app/web/.next/standalone ./
COPY --from=build --chown=1000:1000 /app/web/.next/static ./web/.next/static
COPY --from=build --chown=1000:1000 /app/web/public ./web/public
COPY --chown=1000:1000 deployments ./deployments
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown 1000:1000 /data

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "web/server.js"]
