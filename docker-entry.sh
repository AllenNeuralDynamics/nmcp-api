#!/usr/bin/env bash

logName=$(date '+%Y-%m-%d_%H-%M-%S');

mkdir -p /var/log/nmcp

./migrate.sh &> /var/log/nmcp/nmcp-api-${logName}.log

wait

export DEBUG=mnb:*,nmcp:*

node --max-old-space-size=8192 --optimize-for-size app.js >> /var/log/nmcp/nmcp-api-${logName}.log 2>&1
