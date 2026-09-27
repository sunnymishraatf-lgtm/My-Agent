# NEUTRON web demo — deployable Node.js image.
#
# Why not Vercel serverless: NEUTRON needs long-running processes (the
# maintain workflow runs for minutes), writable filesystem access (demo
# workspace, git checkpoints, run audit trails), and in-memory job state.
# None of that fits a stateless serverless function. Use any Node host
# with a persistent disk instead (Render, Railway, Fly.io, a VPS, ...).
#
# Build:   docker build -t neutron-demo .
# Run:     docker run -p 4096:4096 \
#            -e AGENTROUTER_API_KEY=... \
#            -v neutron-data:/data \
#            neutron-demo
# Then open http://localhost:4096/demo

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Runtime config via environment (see README "Environment Variables").
ENV PORT=4096 \
    NEUTRON_DEMO_WORKSPACE=/data/demo-workspace
VOLUME /data
EXPOSE 4096
# Serves the dashboard at / and the NEUTRON web demo at /demo.
# --hostname 0.0.0.0 is required so the port is reachable outside the container.
CMD ["node", "dist/cli-entry.js", "web", "--hostname", "0.0.0.0", "--no-open"]
