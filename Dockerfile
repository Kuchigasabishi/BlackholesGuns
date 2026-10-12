# syntax=docker/dockerfile:1
# Blackholes & Guns: one container serves the Socket.IO game server AND the built web client.

# ---- build stage: full install, bundle the Vite client -------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: production dependencies only -------------------------------------------
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
COPY --from=build /app/web/dist ./web/dist

# Railway injects PORT at run time; 3000 is the local default.
EXPOSE 3000
USER node
CMD ["node", "./node_modules/tsx/dist/cli.mjs", "./src/main.ts"]
