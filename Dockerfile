# Production image for crypto-pulse-api (Solana x402)
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4021
# Default to mainnet in the image; override with NETWORK=devnet for testing
ENV NETWORK=mainnet

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY README.md DEPLOY.md ./

USER node
EXPOSE 4021
CMD ["node", "src/server.js"]
