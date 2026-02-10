FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --production
COPY backend/ ./
COPY --from=frontend-build /build/dist ./public
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "src/index.js"]
