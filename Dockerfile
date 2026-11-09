# Single-image deploy: builds web + API, serves both on :8787. State lives in /app/data (mount a volume).
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
EXPOSE 8787
# seed.mjs never overwrites an existing database or recording, so restarts keep reviewer edits.
CMD ["sh", "-c", "node scripts/seed.mjs && pnpm --filter @cqa/api start"]
