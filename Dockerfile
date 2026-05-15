FROM node:18-alpine
WORKDIR /app
COPY crm-completo/package.json .
RUN npm install
COPY crm-completo/ .
EXPOSE 3000
CMD ["node", "server.js"]
