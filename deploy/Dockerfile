FROM node:22-bookworm-slim
RUN printf 'Acquire::http::Pipeline-Depth "0";\nAcquire::Retries "1";\nAcquire::http::Timeout "45";\n' > /etc/apt/apt.conf.d/99bounded-fetch \
    && apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY dist/src ./dist/src
RUN rm -f dist/src/cli.js dist/src/send-samples.js dist/src/digest-preview.js
COPY scripts ./scripts
COPY prompts ./prompts
COPY migrations ./migrations
USER node
CMD ["node", "dist/src/daily-run.js"]
