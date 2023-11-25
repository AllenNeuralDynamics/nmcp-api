#!/usr/bin/env bash

logName=$(date '+%Y-%m-%d_%H-%M-%S');

mkdir -p /var/log/nmcp

./migrate.sh &> /var/log/nmcp/sample-api-${logName}.log

wait

export DEBUG=mnb*

node app.js >> /var/log/nmcp/sample-api-${logName}.log 2>&1
