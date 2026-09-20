FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm@12.4.2 && pnpm install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm config set fetch-timeout=60000 && npm config set fetch-retries=5

RUN pnpm run build

FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN npm install -g pnpm@12.4.2 && pnpm install --prod --frozen-lockfile

COPY --from=builder /app/.next ./.next

RUN mkdir -p public

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=80

EXPOSE 80

# The wol_spool volume is created root-owned; open it so the sidecar's non-root
# user can write its heartbeat. Harmless when no spool is mounted.
CMD ["sh", "-c", "[ -d /spool ] && chmod 777 /spool; exec pnpm start"]
