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
RUN apk add --no-cache su-exec
WORKDIR /app
COPY --from=backend-build /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/ ./
COPY --from=frontend-build /build/dist ./public
COPY docker-entrypoint.sh /usr/local/bin/
RUN mkdir -p /app/data /app/backups && chown -R node:node /app && chmod +x /usr/local/bin/docker-entrypoint.sh
# Stays root at container start on purpose: the entrypoint fixes ownership
# of the mounted volumes (which may predate this image, or be freshly
# created by Docker as root) before dropping to the unprivileged `node`
# user to actually run the app. See docker-entrypoint.sh.
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
