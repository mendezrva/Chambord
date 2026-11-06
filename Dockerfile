# One small container: builds the browser game, then runs the game server that serves it.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["npm", "start"]
