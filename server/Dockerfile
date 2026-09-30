FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
USER node
EXPOSE 8787
CMD ["node", "index.mjs"]
