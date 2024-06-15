# Neuron Morphology Community Toolbox API
Backend service for sample, neuron, and reconstruction management and search.

## Applicable Environment Variables
In most production deployments the service-specific variables should be used (e.g.,`SAMPLE_DB_HOST` vs. `CORE_SERVICES_HOST`).
The more general variables are typically useful for development and testing environments to simplify configuring the
required variables where most or all of the services are running on the same machine or in a single container.

Note that these names are for the actual service environment.  The names used in deployment schemes (e.g., `docker-compose`)
may map other names to these.  For example, `CCF_30_ONTOLOGY_PATH` for this service is set by `NMCP_ONTOLOGY_PATH`
on the host machine being mapped to `CCF_30_ONTOLOGY_PATH` for the api service instance in the `nmcp-deploy`
`docker-compose` deployment repository.

In addition, some variables have `SAMPLE_` as the prefix for historical reasons.  Those should be considered equivalent to
a generic `NCMP_` prefix.

### End Points

#### API Service
* `SAMPLE_API_PORT` (default `5000`)
* `SAMPLE_API_ENDPOINT` (default `/graphql`) which supersedes `CORE_SERVICES_ENDPOINT`

#### Additional Services
* `SAMPLE_DB_HOST` (default `5432`) which supersedes `DATABASE_HOST` which supersedes `CORE_SERVICES_HOST`
* `SAMPLE_DB_PORT` (default `sample-db`) which supersedes `DATABASE_PORT`
* `STATIC_API_PORT` (default `5000`)
* `STATIC_API_ENDPOINT` (default `graphql`) which supersedes `CORE_SERVICES_ENDPOINT`

### Settings

#### General
* `CCF_30_ONTOLOGY_PATH` - full path and file name for the CCF Ontology NRRD file
* `NMCP_SEED_USER_ITEMS` - (default `false`) - convenience for development that will seed the database with a small number of samples and neurons

#### Authentication
* `DATABASE_UN` - (default `postgres`) - user name for postgres database
* `DATABASE_PW` - (default `pgsecret`) - password for postgres database
* `NMCP_AUTH_REQUIRED` (default `true`) - configurable to `false` only for development convenience
* `SERVER_AUTHENTICATION_KEY` - (optional, default `null`) - private key that will grant full API access for internal services, etc
