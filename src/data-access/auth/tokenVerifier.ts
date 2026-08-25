import {ServiceOptions, EntraAuthenticationOptions} from "../../options/serviceOptions";
import {User} from "../../models/user";

const debug = require("debug")("nmcp:nmcp-api:token-verifier");

// Deployment clock skew only.  Anything larger starts to undermine the expiration claim.
const ClockToleranceSeconds = 30;

const BearerPrefix = "bearer ";

const AppIdUriPrefix = "api://";

export type ResolvedAuthenticationConfiguration = {
    issuers: string[];
    jwksUri: string;
    audiences: string[];
}

export type VerifiedIdentity = {
    identityId: string;
    firstName: string;
    lastName: string;
    email: string;
    scopes: string[];
}

export interface TokenVerifier {
    verify(token: string): Promise<VerifiedIdentity>;
}

export type TokenOutput = [scopes: string[], user: User];

export type UserResolver = (identity: VerifiedIdentity) => Promise<User>;

const defaultUserResolver: UserResolver = (identity: VerifiedIdentity): Promise<User> => {
    return User.findOrCreateUser(identity.identityId, identity.firstName, identity.lastName, identity.email);
};

type MetadataDocument = {
    issuer?: string;
    jwks_uri?: string;
}

export type MetadataFetch = (url: string) => Promise<MetadataDocument>;

/**
 * Extracts a candidate JWT from a "Bearer <jwt>" Authorization header.  Returns null for anything that is not a
 * bearer credential, in which case the caller leaves the original header value for API key authentication, which
 * compares the header exactly.
 */
export function parseBearerToken(authorizationHeader: string): string {
    if (!authorizationHeader) {
        return null;
    }

    const trimmed = authorizationHeader.trim();

    if (!trimmed.toLowerCase().startsWith(BearerPrefix)) {
        return null;
    }

    const token = trimmed.slice(BearerPrefix.length).trim();

    return token.length > 0 ? token : null;
}

const defaultMetadataFetch: MetadataFetch = async (url: string): Promise<MetadataDocument> => {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`metadata request to ${url} failed with status ${response.status}`);
    }

    return await response.json() as MetadataDocument;
};

/**
 * Determines the issuer, signing key location, and audience to verify against.  Throws when authentication is not
 * configured well enough to verify anything, so that the caller fails closed rather than accepting tokens.
 */
export async function resolveAuthenticationConfiguration(
    options: EntraAuthenticationOptions = ServiceOptions.entraAuthenticationOptions,
    metadataFetch: MetadataFetch = defaultMetadataFetch): Promise<ResolvedAuthenticationConfiguration> {

    // This service's own application id is the audience the token must be issued for, not that of the calling client.
    // It has no default, so an unset value fails closed.
    const audience = nonEmpty(options?.apiAppId);

    if (!audience) {
        throw new Error("no authentication api app id is configured");
    }

    // The tenant id pins the issuer to a single directory.  It has no default, so an unset value fails closed.
    const tenantId = nonEmpty(options?.tenantId);

    if (!tenantId) {
        throw new Error("no authentication tenant id is configured");
    }

    // The issuer and signing keys are discovered from the tenant's standard Entra OIDC metadata document.  If a
    // deployment ever needs a non-standard metadata location or issuer, this is where an explicit metadata URL, or an
    // explicit issuer and JWKS URI, would be introduced instead of self-constructing the URL here.
    const metadataUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;

    // An app registration left at the default accessTokenAcceptedVersion issues v1.0 tokens, whose issuer is the
    // legacy sts.windows.net form rather than the one the v2.0 metadata document advertises.  Both are accepted so
    // that registrations can be moved to version 2 one environment at a time.  Once every environment is on version
    // 2, this second document and the api:// audience form below can be dropped.
    const legacyMetadataUrl = `https://login.microsoftonline.com/${tenantId}/.well-known/openid-configuration`;

    return await configurationFromMetadata(metadataUrl, legacyMetadataUrl, audience, metadataFetch);
}

async function configurationFromMetadata(
    metadataUrl: string,
    legacyMetadataUrl: string,
    audience: string,
    metadataFetch: MetadataFetch): Promise<ResolvedAuthenticationConfiguration> {

    const metadata = await metadataFetch(metadataUrl);

    const issuer = nonEmpty(metadata?.issuer);
    const jwksUri = nonEmpty(metadata?.jwks_uri);

    if (!issuer || !jwksUri) {
        throw new Error(`metadata document at ${metadataUrl} did not supply both an issuer and a jwks uri`);
    }

    const issuers = [issuer];

    // Both documents describe the same tenant and the v2.0 key set covers v1.0 tokens, so only the legacy issuer is
    // taken from here.  A failure is not fatal: it costs v1.0 support rather than all authentication.
    try {
        const legacyIssuer = nonEmpty((await metadataFetch(legacyMetadataUrl))?.issuer);

        if (legacyIssuer && legacyIssuer !== issuer) {
            issuers.push(legacyIssuer);
        }
    } catch (err) {
        debug(`legacy issuer discovery failed, v1.0 tokens will be rejected: ${err?.message}`);
    }

    return {issuers, jwksUri, audiences: audienceForms(audience)};
}

/**
 * A v2.0 token carries the bare application id as its audience, while a v1.0 token carries the application id URI of
 * the resource it was requested for.  Both forms are accepted regardless of which one is configured.
 */
function audienceForms(audience: string): string[] {
    const apiAppId = audience.startsWith(AppIdUriPrefix) ? audience.slice(AppIdUriPrefix.length) : audience;

    return [apiAppId, `${AppIdUriPrefix}${apiAppId}`];
}

/**
 * Creates a verifier bound to a resolved configuration.  A key resolver may be supplied in place of the remote key
 * set so that verification can be exercised against locally generated keys.
 */
export async function createTokenVerifier(configuration: ResolvedAuthenticationConfiguration, keyResolver: any = null): Promise<TokenVerifier> {
    // jose is ESM only.  Loading it here keeps the module boundary at an awaited call rather than at import of this
    // file, which is what allows the CommonJS build to consume it.
    const jose = await import("jose");

    const resolveKey = keyResolver ?? jose.createRemoteJWKSet(new URL(configuration.jwksUri));

    return {
        verify: async (token: string): Promise<VerifiedIdentity> => {
            if (!token) {
                return null;
            }

            try {
                const {payload} = await jose.jwtVerify(token, resolveKey, {
                    issuer: configuration.issuers,
                    audience: configuration.audiences,
                    clockTolerance: ClockToleranceSeconds
                });

                // The signal for when the legacy issuer and audience forms can be removed.  When this stops appearing
                // for every environment, every app registration has moved to accessTokenAcceptedVersion 2.
                if (payload?.ver !== "2.0") {
                    // debug(`accepted a v${payload?.ver ?? "1.0"} token from issuer ${payload?.iss}`);
                }

                return identityFromPayload(payload);
            } catch (err) {
                debug(`token verification failed: ${err?.message}`);

                return null;
            }
        }
    };
}

function identityFromPayload(payload: any): VerifiedIdentity {
    const identityId = firstString(payload?.oid, payload?.sub);

    if (!identityId) {
        debug("token rejected for missing identity claim");

        return null;
    }

    // v1.0 tokens carry the sign-in name in upn; v2.0 tokens use preferred_username.  Guest accounts in the directory
    // will generally have email populated rather than either.
    const email = firstString(payload?.upn, payload?.preferred_username, payload?.email) ?? "";

    return {
        identityId,
        firstName: firstString(payload?.given_name) ?? "",
        lastName: firstString(payload?.family_name) ?? "",
        email,
        scopes: parseScopes(payload)
    };
}

function parseScopes(payload: any): string[] {
    const raw = payload?.scp ?? payload?.scope ?? payload?.scopes ?? "";

    if (Array.isArray(raw)) {
        return raw.map(entry => String(entry)).filter(entry => entry.length > 0);
    }

    return String(raw).split(" ").filter(entry => entry.length > 0);
}

function firstString(...values: any[]): string {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) {
            return value;
        }
    }

    return null;
}

function nonEmpty(value: string): string {
    return (typeof value === "string" && value.trim().length > 0) ? value.trim() : null;
}

let sharedTokenVerifier: TokenVerifier = null;

/**
 * Resolves configuration and builds the process wide verifier.  Called once during startup so that no request path
 * fetches metadata or constructs a remote key set.  A configuration failure leaves the verifier unset, which rejects
 * every bearer token and leaves API key authentication as the only path.
 */
export async function initializeTokenVerifier(): Promise<TokenVerifier> {
    try {
        const configuration = await resolveAuthenticationConfiguration();

        sharedTokenVerifier = await createTokenVerifier(configuration);

        debug(`token verification initialized for issuers ${configuration.issuers.join(", ")}`);
    } catch (err) {
        debug(`token verification is unavailable: ${err?.message}`);

        sharedTokenVerifier = null;
    }

    return sharedTokenVerifier;
}

export function currentTokenVerifier(): TokenVerifier {
    return sharedTokenVerifier;
}

/**
 * Verifies an Authorization header and maps the verified identity onto a local user.  No user is created or updated
 * until the token signature and claims have been verified.
 */
export async function validateToken(
    authorizationHeader: string,
    verifier: TokenVerifier | null = undefined,
    resolveUser: UserResolver = defaultUserResolver): Promise<TokenOutput> {

    const activeVerifier = verifier === undefined ? sharedTokenVerifier : verifier;

    if (!activeVerifier) {
        return [[], null];
    }

    const token = parseBearerToken(authorizationHeader);

    if (!token) {
        return [[], null];
    }

    const identity = await activeVerifier.verify(token);

    if (!identity) {
        return [[], null];
    }

    const user = await resolveUser(identity);

    if (!user) {
        return [[], null];
    }

    return [identity.scopes, user];
}
