# Math Studio, hosted: Google sign-in, files per user, AI on each user's own Claude account.
# See docs/hosting.md.

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Offline handwriting model for "Ink → equation" (~118 MB). Build with --build-arg OCR_MODELS=0 to skip.
ARG OCR_MODELS=1
RUN if [ "$OCR_MODELS" = "1" ]; then npm run models; fi
# Web app -> desktop/web, server bundled into one file -> desktop/server/server.mjs
RUN node scripts/build-desktop.mjs

FROM node:22-bookworm-slim
# Claude Code CLI runs each user's AI requests with the Claude account they connect.
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force
WORKDIR /app
COPY --from=build /src/desktop/web ./web
COPY --from=build /src/desktop/server ./server
COPY --from=build /src/desktop/docs ./docs
ENV NODE_ENV=production \
	MATH_STUDIO_HOSTED=1 \
	MATH_STUDIO_STATIC=/app/web \
	MATH_STUDIO_PORT=3001 \
	DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3001
CMD ["node", "server/server.mjs"]
