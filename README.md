# Neuron Morphology Community Toolbox API
Backend service for sample, neuron, and reconstruction management and search.

## Applicable Environment Variables
Note that these names are for the actual service environment.  The names used in deployment schemes (e.g., `docker-compose`)
may map other names to these.  For example, `NMCP_CCF_30_ONTOLOGY_PATH` for this service is set by `NMCP_ONTOLOGY_PATH`
on the host machine being mapped to `NMCP_CCF_30_ONTOLOGY_PATH` for the api service instance in the `nmcp-deploy`
`docker-compose` deployment repository.

### End Points

#### API Service
* `NMCP_API_PORT` (default `5000`) - port the GraphQL server listens on
* `NMCP_API_ENDPOINT` (default `/graphql`) - path the GraphQL server is mounted at

#### Database
* `NMCP_DB_HOST` (default `nmcp-db`) - postgres host
* `NMCP_DB_PORT` (default `5432`) - postgres port
* `NMCP_DATABASE_UN` (default `postgres`) - postgres user name
* `NMCP_DATABASE_PW` (default `pgsecret`) - postgres password

### Settings

#### General
* `NMCP_CCF_30_ONTOLOGY_PATH` - full path and file name for the CCF Ontology NRRD file
* `NMCP_SEED_USER_ITEMS` (default `false`) - convenience for development that will seed the database with a small number of samples and neurons
* `NMCP_EXPERIMENTAL_ENV` (default `false`) - when `true`, enables experimental features and GraphQL introspection
* `NODE_ENV` - when `development` (or unset), enables GraphQL introspection and resolves the fixture path relative to the source tree

#### Client Address Resolution
The address a request is attributed to drives the access-request rate limit.  When the service runs behind something
that terminates the connection — an HTTPS gateway, a load balancer, a CDN — the socket peer is that intermediary rather
than the caller, so the client address has to be recovered from the `X-Forwarded-For` header instead.

* `NMCP_TRUSTED_PROXY_HOPS` (default `1`) - number of proxies between the client and this service that append to `X-Forwarded-For`
* `NMCP_RECENT_REQUEST_ADDRESS_LIMIT` (default `50`) - how many recent request addresses to retain in memory for the `recentRequestAddresses` query; `0` disables the tracking entirely

The hop count is an operational trust boundary and must match the real request path.  The last that many entries of the
forwarding chain are treated as trustworthy, so a value **higher** than reality lets a caller on a shorter path supply
its own `X-Forwarded-For` and choose the address it is rate limited under.  A value **lower** than reality attributes
every request to an intermediary, collapsing all callers into a single rate-limit bucket.

* `0` - the service is reachable directly, with nothing in front; forwarding headers are ignored entirely
* `1` - the deployed shape of client → HTTPS gateway → service
* `2` - a CDN or a second load balancer in front of that gateway

Network address translation does not count as a hop.  Docker's published-port mapping rewrites the source address but
appends nothing to `X-Forwarded-For`, so running the service in a container does not change the setting.

`recentRequestAddresses` is an internal GraphQL query, available to the internal server key (`NMCP_SERVER_KEY`) or an
admin user, and exists to confirm the hop count is right in a given deployment.  Each entry records the resolved address
alongside the socket peer and the forwarding chain as received.  Resolved and socket addresses that are identical across
different callers mean the header is not being trusted, and a chain carrying more entries than the configured hop count
means the count is too low.  The list is held only in memory and is never persisted.

#### Authentication
Authenticated GraphQL requests are expected to carry a Microsoft Entra ID bearer token in the `Authorization` header
(`Authorization: Bearer <jwt>`).  The token signature, issuer, audience, and validity window are all verified.
Requests without a valid bearer token fall back to API-key authentication, then to the no-privilege system user.

* `NMCP_AUTH_REQUIRED` (default `true`) - when `false`, all authentication is bypassed and every request runs as the no-privilege system user; development convenience only
* `NMCP_AUTHENTICATION_API_APP_ID` - application id of this service's own app registration; the audience (`aud`) a token must be issued for.  Not the application id of the calling client, which appears in the token as `appid`/`azp` and is not checked.
* `NMCP_AUTHENTICATION_TENANT_ID` - directory (tenant) id; pins the accepted issuer to a single Entra directory
* `NMCP_SERVER_KEY` (optional, default `null`) - private key that grants full API access for internal services; checked as a fallback when no bearer token authenticates. Unrelated to directory authentication.

The issuer and signing keys are discovered from the tenant's standard Entra OIDC metadata document, whose URL is derived
from `NMCP_AUTHENTICATION_TENANT_ID` and fetched at startup.  Neither `NMCP_AUTHENTICATION_API_APP_ID` nor
`NMCP_AUTHENTICATION_TENANT_ID` has a default; if either is unset, bearer-token verification is disabled and only
API-key authentication remains.

Both v1.0 and v2.0 access tokens are accepted.  An app registration whose `accessTokenAcceptedVersion` is left at the
default issues v1.0 tokens, which carry the legacy `https://sts.windows.net/<tenant>/` issuer and the `api://<api app id>`
application ID URI as their audience; a registration set to version 2 issues the `https://login.microsoftonline.com/<tenant>/v2.0`
issuer and the bare application id.  The tenant's v1.0 metadata document is fetched at startup alongside the v2.0 one to
discover the legacy issuer, and both audience forms are derived from `NMCP_AUTHENTICATION_API_APP_ID`, so either form may
be configured.  This is transitional: each accepted v1.0 token is logged under the `mnb:nmcp-api:token-verifier` debug
namespace, and once no environment produces those entries the legacy issuer and audience can be dropped.

### External Service Dependencies

#### Metrics (InfluxDB)
* `NMCP_INFLUX_DB_HOST` (default `nmcp-influxdb`) - InfluxDB host
* `NMCP_INFLUX_DB_PORT` (default `8086`) - InfluxDB port
* `NMCP_INFLUX_DB_TOKEN` (default empty) - InfluxDB API token
* `NMCP_INFLUX_DB_ORG` (default `nmcp`) - InfluxDB organization
* `NMCP_INFLUX_DB_BUCKET` (default `nmcp_metrics`) - InfluxDB bucket
* `NMCP_METRICS_CACHE_TTL_MS` (default `3600000`) - reconstruction-metrics cache lifetime in milliseconds

#### Quality Check Service
* `NMCP_QUALITY_API_HOST` (default `quality-api`) - quality control service host
* `NMCP_QUALITY_API_PORT` (default `5000`) - quality control service port
* `NMCP_QUALITY_API_ENDPOINT` (default `/performqc`) - quality control service path

#### DOI Generation (DataCite)
* `NMCP_DOI_API_URL` (default `https://morphology.allenneuraldynamics-test.org/`) - landing-page base URL registered with the DOI
* `NMCP_DOI_API_HOST` (default `api.test.datacite.org`) - DataCite API host
* `NMCP_DOI_API_ENDPOINT` (default `/dois`) - DataCite DOI endpoint
* `NMCP_DOI_API_PREFIX` (default `10.83594`) - DataCite DOI prefix
* `NMCP_DOI_API_USER` (default empty) - DataCite API user
* `NMCP_DOI_API_PASSWORD` (default empty) - DataCite API password

### Tools
These are used by standalone import tools rather than the running service.

* `SS_API_TOKEN` - Smartsheet API token, used by the Smartsheet import tool
