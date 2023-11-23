FROM node:12.22

WORKDIR /app

COPY dist .

RUN yarn global add sequelize-cli@5

RUN yarn install --production=true

CMD ["./docker-entry.sh"]

EXPOSE 5000
