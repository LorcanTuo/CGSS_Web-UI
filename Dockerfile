FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server ./server
COPY src ./src
COPY index.html ./index.html

ENV PORT=8080
ENV DATA_FILE=/data/scoreboard.json

VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "server/index.js"]
