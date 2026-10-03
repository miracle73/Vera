FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY public/ ./public/

RUN addgroup -g 1001 vera && \
    adduser -S -u 1001 -G vera vera
USER vera

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
