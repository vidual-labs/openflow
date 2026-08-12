# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend native modules
FROM node:20-alpine AS backend-build
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --production

# Stage 3: Runtime (clean, no build tools)
FROM node:20-alpine
WORKDIR /app
COPY --from=backend-build /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/ ./
COPY --from=frontend-build /build/dist ./public
RUN mkdir -p /app/data /app/backups && chown -R node:node /app
# Run as the image's built-in unprivileged user rather than root. Named
# volumes get their initial ownership from the image path they're mounted
# over, so db-data inherits this; a host-side ./backups bind mount may need
# `chown 1000:1000 ./backups` (or matching UID) if it predates this change.
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
