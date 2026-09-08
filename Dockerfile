# Build context must be the project root (set in docker-compose.yml)
# so that the database/ folder is accessible for the seed script.

# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ── Production stage ──────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN mkdir -p /uploads/avatars

ENV NODE_ENV=production
ENV UPLOADS_DIR=/uploads/avatars
ENV TZ=Europe/Rome

COPY backend/package*.json ./
RUN npm install --omit=dev

# Compiled JS
COPY --from=builder /app/dist ./dist

# seed.js resolves schema.sql via path.join(__dirname, '../../../database/schema.sql')
# __dirname = /app/dist/scripts  →  ../../../ = /  →  path = /database/schema.sql
COPY database /database

EXPOSE 3001

CMD ["node", "dist/index.js"]
