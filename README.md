# Sample API
Backend service for sample, neuron, and compartment management.

## Applicable Environment Variables
In most production deployments the service-specific variables should be used (e.g.,`SWC_API_HOST` vs. `CORE_SERVICES_HOST`).
The more general variables are typically useful for development and testing environments to simplify configuring the
required variables where most or all of the services are running on the same machine or in a single container.


#### Sample Service
* `SAMPLE_API_PORT`
* `SAMPLE_API_ENDPOINT` which supersedes `CORE_SERVICES_ENDPOINT`

#### Core Services
* `SAMPLE_DB_HOST` which supersedes `DATABASE_HOST` which supersedes `CORE_SERVICES_HOST` 
* `SAMPLE_DB_PORT` which supersedes `DATABASE_PORT`


* `SWC_API_HOST` which supersedes `CORE_SERVICES_HOST`
* `SWC_API_PORT`
* `SWC_API_ENDPOINT` which supersedes `CORE_SERVICES_ENDPOINT`


* `TRANSFORM_API_HOST` which supersedes `CORE_SERVICES_HOST`
* `TRANSFORM_API_PORT`
* `TRANSFORM_API_ENDPOINT` which supersedes `CORE_SERVICES_ENDPOINT`
