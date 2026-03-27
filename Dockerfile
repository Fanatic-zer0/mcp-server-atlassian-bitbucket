# ─── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy scripts before npm ci so hooks can find them; skip lifecycle scripts
# and invoke the build explicitly after source is present.
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# --ignore-scripts skips prepare/postinstall; dist/ comes from builder stage
COPY package*.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Run as non-root user for security
RUN addgroup -S mcpgroup && adduser -S mcpuser -G mcpgroup
USER mcpuser

# Transport: http exposes an HTTP endpoint; stdio is for piped MCP clients
ENV TRANSPORT_MODE=http
ENV PORT=3000
# Bind to all interfaces so Docker port mapping works
ENV BIND_HOST=0.0.0.0

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "dist/index.js"]