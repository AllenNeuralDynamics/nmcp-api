#!/usr/bin/env bash

migrateDatabase()
{
    SUCCESS=1

    while [ ${SUCCESS} -ne 0 ]; do
        echo "Migrate postgres service"

        sequelize db:migrate
        SUCCESS=$?

        if [ ${SUCCESS} -ne 0 ]; then
            echo "Migration failed - waiting 5 seconds"
            sleep 5s
        fi
    done

    echo "Migrate postgres service complete"
}

migrateDatabase

exit 0
