FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
RUN mkdir -p public && mv index.html public/ 2>/dev/null || true
EXPOSE 3000
CMD ["node", "server.js"]
