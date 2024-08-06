# Neuron Morphology Community Toolbox API
Backend service for sample, neuron, and reconstruction management and search.

## Applicable Environment Variables
Note that these names are for the actual service environment.  The names used in deployment schemes (e.g., `docker-compose`)
may map other names to these.  For example, `NMCP_CCF_30_ONTOLOGY_PATH` for this service is set by `NMCP_ONTOLOGY_PATH`
on the host machine being mapped to `NMCP_CCF_30_ONTOLOGY_PATH` for the api service instance in the `nmcp-deploy`
`docker-compose` deployment repository.

In addition, some variables have `SAMPLE_` as the prefix for historical reasons.  Those should be considered equivalent to
a generic `NCMP_` prefix.

### End Points

#### API Service
* `NMCP_API_PORT` (default `5000`)
* `NMCP_API_ENDPOINT` (default `/graphql`)

#### Additional Services
* `NMCP_DB_HOST` (default `5432`)
* `NMCP_DB_PORT` (default `nmcp-db`)
* `STATIC_API_PORT` (default `5000`)
* `STATIC_API_ENDPOINT` (default `graphql`)

### Settings

#### General
* `NMCP_CCF_30_ONTOLOGY_PATH` - full path and file name for the CCF Ontology NRRD file
* `NMCP_SEED_USER_ITEMS` - (default `false`) - convenience for development that will seed the database with a small number of samples and neurons

#### Authentication
* `NMCP_DATABASE_UN` - (default `postgres`) - user name for postgres database
* `NMCP_DATABASE_PW` - (default `pgsecret`) - password for postgres database
* `NMCP_AUTH_REQUIRED` (default `true`) - configurable to `false` only for development convenience
* `NMCP_AUTHENTICATION_KEY` - (optional, default `null`) - private key that will grant full API access for internal services, etc
