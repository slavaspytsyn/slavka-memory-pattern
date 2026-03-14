# BUILD STAGE
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies separately for better caching
COPY package*.json ./
RUN npm ci

# Copy source and config
COPY tsconfig.json ./
COPY src/ ./src/

# Build the project
RUN npm run build

# PRODUCTION STAGE
FROM node:22-alpine

# Set node environment
ENV NODE_ENV=production

WORKDIR /app

# Create non-root user for security
RUN addgroup -S smp && adduser -S smp -G smp

# Copy built assets and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Set ownership
RUN chown -R smp:smp /app

# Use non-root user
USER smp

# Default port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

CMD ["node", "dist/index.js"]
