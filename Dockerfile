FROM node:latest

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/bot

COPY package*.json ./

RUN npm ci

COPY . .

VOLUME /usr/src/bot/data

ENV DB_PATH=/usr/src/bot/data/bot.db

CMD ["npm", "start"]