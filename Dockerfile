FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm", "start"]
