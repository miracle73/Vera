FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build && npx tsc scripts/seed.ts --outDir dist/scripts --esModuleInterop --skipLibCheck

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/db/migrations/ ./dist/db/migrations/
COPY public/ ./public/

RUN addgroup -g 1001 vera && \
    adduser -S -u 1001 -G vera vera
USER vera

EXPOSE 3000
ENV NODE_ENV=production

# Apply migrations, seed an empty database, then start
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/scripts/seed.js --if-empty && node dist/index.js"]
