# ---------- build stage ----------
FROM node:20-alpine AS build

WORKDIR /app

# IMPORTANT: NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time,
# so the backend URL must be supplied here — not at runtime. Set NEXT_PUBLIC_API_URL
# in the CapRover app's environment variables (CapRover forwards them as build args),
# e.g. https://inclusionai-backend.your-root-domain.com
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- run stage ----------
FROM node:20-alpine AS run

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.js ./next.config.js

# next start listens on 3000 — set CapRover's "Container HTTP Port" to 3000.
EXPOSE 3000

CMD ["npm", "start"]
