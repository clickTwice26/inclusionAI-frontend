FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Dev server with hot-reload — friendliest for demoing and editing.
CMD ["npm", "run", "dev"]
