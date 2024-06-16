FROM node:20.10

WORKDIR /app

COPY dist .

RUN npm -g add sequelize-cli@5

RUN npm install --production=true

CMD ["./docker-entry.sh"]

EXPOSE 5000
