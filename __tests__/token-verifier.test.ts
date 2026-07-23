import {expect, test, describe, vi, beforeEach} from "vitest";

import {
    parseBearerToken,
    resolveAuthenticationConfiguration,
    createTokenVerifier,
    validateToken,
    ResolvedAuthenticationConfiguration
} from "../src/data-access/auth/tokenVerifier";
import type {EntraAuthenticationOptions} from "../src/options/serviceOptions";
import type {User} from "../src/models/user";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const LEGACY_ISSUER = `https://sts.windows.net/${TENANT_ID}/`;
const AUDIENCE = "audience-api-app-id";
const LEGACY_AUDIENCE = `api://${AUDIENCE}`;

const METADATA_URL = `https://login.microsoftonline.com/${TENANT_ID}/v2.0/.well-known/openid-configuration`;
const LEGACY_METADATA_URL = `https://login.microsoftonline.com/${TENANT_ID}/.well-known/openid-configuration`;

const IDENTITY_ID = "5b1a0f5e-0000-4000-8000-000000000001";

function makeOptions(overrides: Partial<EntraAuthenticationOptions> = {}): EntraAuthenticationOptions {
    return {
        apiAppId: "",
        tenantId: "",
        ...overrides
    };
}

// Mirrors Entra, which serves the v1.0 issuer from the tenant document and the v2.0 issuer from the /v2.0 document.
function metadataForUrl(url: string) {
    return url === LEGACY_METADATA_URL
        ? {issuer: LEGACY_ISSUER, jwks_uri: "https://common/keys"}
        : {issuer: ISSUER, jwks_uri: "https://tenant/keys"};
}

const bothDocuments = async (url: string) => metadataForUrl(url);

describe("parseBearerToken", () => {
    test("returns null for missing or blank values", () => {
        expect(parseBearerToken(null as any)).toBeNull();
        expect(parseBearerToken(undefined as any)).toBeNull();
        expect(parseBearerToken("")).toBeNull();
        expect(parseBearerToken("   ")).toBeNull();
    });

    test("extracts the token from a Bearer header", () => {
        expect(parseBearerToken("Bearer header.payload.signature")).toBe("header.payload.signature");
    });

    test("is case insensitive and tolerates surrounding whitespace", () => {
        expect(parseBearerToken("  bearer   header.payload.signature  ")).toBe("header.payload.signature");
        expect(parseBearerToken("BEARER header.payload.signature")).toBe("header.payload.signature");
    });

    test("returns null for a Bearer prefix with no token", () => {
        expect(parseBearerToken("Bearer")).toBeNull();
        expect(parseBearerToken("Bearer ")).toBeNull();
        expect(parseBearerToken("Bearer    ")).toBeNull();
    });

    test("leaves any non-Bearer value for the API key path", () => {
        // Only the Bearer scheme is a token; everything else is passed to API key auth, which compares it exactly.
        expect(parseBearerToken("header.payload.signature")).toBeNull();
        expect(parseBearerToken("a-raw-api-key-value")).toBeNull();
        expect(parseBearerToken("f191e8b3-8fb9-4151-a48c-432c1a2382cd")).toBeNull();
    });
});

describe("resolveAuthenticationConfiguration", () => {
    test("derives the metadata urls from the tenant id and reads both documents", async () => {
        const metadataFetch = vi.fn(bothDocuments);

        const configuration = await resolveAuthenticationConfiguration(
            makeOptions({apiAppId: AUDIENCE, tenantId: TENANT_ID}),
            metadataFetch);

        expect(metadataFetch).toHaveBeenCalledWith(METADATA_URL);
        expect(metadataFetch).toHaveBeenCalledWith(LEGACY_METADATA_URL);
        expect(configuration.issuers).toEqual([ISSUER, LEGACY_ISSUER]);
        expect(configuration.jwksUri).toBe("https://tenant/keys");
        expect(configuration.audiences).toEqual([AUDIENCE, LEGACY_AUDIENCE]);
    });

    test("accepts both audience forms when the app id uri is configured", async () => {
        const configuration = await resolveAuthenticationConfiguration(
            makeOptions({apiAppId: LEGACY_AUDIENCE, tenantId: TENANT_ID}),
            bothDocuments);

        expect(configuration.audiences).toEqual([AUDIENCE, LEGACY_AUDIENCE]);
    });

    test("keeps verifying v2.0 tokens when the legacy document is unavailable", async () => {
        const metadataFetch = vi.fn(async (url: string) => {
            if (url === LEGACY_METADATA_URL) {
                throw new Error("not found");
            }

            return metadataForUrl(url);
        });

        const configuration = await resolveAuthenticationConfiguration(
            makeOptions({apiAppId: AUDIENCE, tenantId: TENANT_ID}),
            metadataFetch);

        expect(configuration.issuers).toEqual([ISSUER]);
        expect(configuration.jwksUri).toBe("https://tenant/keys");
    });

    test("does not duplicate the issuer when both documents agree", async () => {
        const configuration = await resolveAuthenticationConfiguration(
            makeOptions({apiAppId: AUDIENCE, tenantId: TENANT_ID}),
            async () => ({issuer: ISSUER, jwks_uri: "https://tenant/keys"}));

        expect(configuration.issuers).toEqual([ISSUER]);
    });

    test("fails when the api app id is missing", async () => {
        await expect(resolveAuthenticationConfiguration(
            makeOptions({tenantId: TENANT_ID}),
            bothDocuments)).rejects.toThrow(/api app id/);
    });

    test("fails when the tenant id is missing", async () => {
        await expect(resolveAuthenticationConfiguration(
            makeOptions({apiAppId: AUDIENCE}),
            bothDocuments)).rejects.toThrow(/tenant id/);
    });

    test("fails when the metadata document is incomplete", async () => {
        await expect(resolveAuthenticationConfiguration(
            makeOptions({apiAppId: AUDIENCE, tenantId: TENANT_ID}),
            async () => ({issuer: ISSUER}))).rejects.toThrow(/issuer and a jwks uri/);
    });
});

describe("token verification", () => {
    let jose: any;
    let signingKey: any;
    let localKeyResolver: any;
    let otherSigningKey: any;

    const configuration: ResolvedAuthenticationConfiguration = {
        issuers: [ISSUER, LEGACY_ISSUER],
        jwksUri: "https://tenant/keys",
        audiences: [AUDIENCE, LEGACY_AUDIENCE]
    };

    async function signToken(claims: any = {}, overrides: {key?: any, expiresIn?: string, issuedAt?: number} = {}) {
        const builder = new jose.SignJWT({
            oid: IDENTITY_ID,
            given_name: "Ada",
            family_name: "Lovelace",
            upn: "ada@example.org",
            scp: "read write",
            ...claims
        })
            .setProtectedHeader({alg: "RS256"})
            .setIssuer(claims.iss ?? ISSUER)
            .setAudience(claims.aud ?? AUDIENCE)
            .setIssuedAt(overrides.issuedAt)
            .setExpirationTime(overrides.expiresIn ?? "5m");

        return await builder.sign(overrides.key ?? signingKey);
    }

    beforeEach(async () => {
        jose = await import("jose");

        const pair = await jose.generateKeyPair("RS256", {extractable: true});
        signingKey = pair.privateKey;
        localKeyResolver = pair.publicKey;

        const otherPair = await jose.generateKeyPair("RS256", {extractable: true});
        otherSigningKey = otherPair.privateKey;
    });

    test("accepts a correctly signed token", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken());

        expect(identity).not.toBeNull();
        expect(identity.identityId).toBe(IDENTITY_ID);
        expect(identity.firstName).toBe("Ada");
        expect(identity.lastName).toBe("Lovelace");
        expect(identity.email).toBe("ada@example.org");
        expect(identity.scopes).toEqual(["read", "write"]);
    });

    test("accepts a v1.0 token, which carries the legacy issuer and app id uri audience", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken({
            iss: LEGACY_ISSUER,
            aud: LEGACY_AUDIENCE,
            ver: "1.0",
            appid: "calling-client-id"
        }));

        expect(identity).not.toBeNull();
        expect(identity.identityId).toBe(IDENTITY_ID);
    });

    test("rejects a v1.0 issuer for a different tenant", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify(await signToken({
            iss: "https://sts.windows.net/22222222-2222-4222-8222-222222222222/",
            aud: LEGACY_AUDIENCE
        }))).toBeNull();
    });

    test("rejects the legacy issuer when only the v2.0 issuer is configured", async () => {
        const verifier = await createTokenVerifier({
            issuers: [ISSUER],
            jwksUri: "https://tenant/keys",
            audiences: [AUDIENCE, LEGACY_AUDIENCE]
        }, localKeyResolver);

        expect(await verifier.verify(await signToken({iss: LEGACY_ISSUER}))).toBeNull();
    });

    test("rejects a token signed by a different key", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify(await signToken({}, {key: otherSigningKey}))).toBeNull();
    });

    test("rejects a tampered token", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const token = await signToken();
        const segments = token.split(".");
        const forgedPayload = Buffer.from(JSON.stringify({
            oid: "attacker",
            iss: ISSUER,
            aud: AUDIENCE,
            exp: Math.floor(Date.now() / 1000) + 300
        })).toString("base64url");

        expect(await verifier.verify(`${segments[0]}.${forgedPayload}.${segments[2]}`)).toBeNull();
    });

    test("rejects an unsigned token", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const unsigned = new jose.UnsecuredJWT({
            oid: IDENTITY_ID
        })
            .setIssuer(ISSUER)
            .setAudience(AUDIENCE)
            .setExpirationTime("5m")
            .encode();

        expect(await verifier.verify(unsigned)).toBeNull();
    });

    test("rejects the wrong audience", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify(await signToken({aud: "some-other-audience"}))).toBeNull();
    });

    test("rejects the wrong issuer", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify(await signToken({iss: "https://login.microsoftonline.com/22222222-2222-4222-8222-222222222222/v2.0"}))).toBeNull();
    });

    test("rejects an expired token", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const issuedAt = Math.floor(Date.now() / 1000) - 7200;

        expect(await verifier.verify(await signToken({}, {issuedAt, expiresIn: "-1h"}))).toBeNull();
    });

    test("rejects a token with no identity claim", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify(await signToken({oid: undefined, sub: undefined}))).toBeNull();
    });

    test("falls back to sub when oid is absent", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken({oid: undefined, sub: "subject-id"}));

        expect(identity.identityId).toBe("subject-id");
    });

    test("reads preferred_username when upn is absent", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken({upn: undefined, preferred_username: "ada@contoso.com"}));

        expect(identity.email).toBe("ada@contoso.com");
    });

    test("falls back to email when upn and preferred_username are absent", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken({upn: undefined, email: "guest@example.org"}));

        expect(identity.email).toBe("guest@example.org");
    });

    test("does not fail on a missing scope claim", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const identity = await verifier.verify(await signToken({scp: undefined}));

        expect(identity).not.toBeNull();
        expect(identity.scopes).toEqual([]);
    });

    test("reads scopes from scope or scopes when scp is absent", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        const fromScope = await verifier.verify(await signToken({scp: undefined, scope: "read"}));
        expect(fromScope.scopes).toEqual(["read"]);

        const fromArray = await verifier.verify(await signToken({scp: undefined, scopes: ["read", "write"]}));
        expect(fromArray.scopes).toEqual(["read", "write"]);
    });

    test("returns null rather than throwing for a malformed token", async () => {
        const verifier = await createTokenVerifier(configuration, localKeyResolver);

        expect(await verifier.verify("not-a-token")).toBeNull();
        expect(await verifier.verify("")).toBeNull();
        expect(await verifier.verify(null as any)).toBeNull();
    });

    describe("validateToken", () => {
        const verifiedUser = {id: "user-id"} as unknown as User;

        let resolveUser: any;

        beforeEach(() => {
            resolveUser = vi.fn(async () => verifiedUser);
        });

        test("maps a verified identity onto a local user", async () => {
            const verifier = await createTokenVerifier(configuration, localKeyResolver);

            const [scopes, user] = await validateToken(`Bearer ${await signToken()}`, verifier, resolveUser);

            expect(user).toBe(verifiedUser);
            expect(scopes).toEqual(["read", "write"]);
            expect(resolveUser).toHaveBeenCalledWith(expect.objectContaining({
                identityId: IDENTITY_ID,
                firstName: "Ada",
                lastName: "Lovelace",
                email: "ada@example.org"
            }));
        });

        test("does not create a user for an unverifiable token", async () => {
            const verifier = await createTokenVerifier(configuration, localKeyResolver);

            const [scopes, user] = await validateToken(`Bearer ${await signToken({}, {key: otherSigningKey})}`, verifier, resolveUser);

            expect(user).toBeNull();
            expect(scopes).toEqual([]);
            expect(resolveUser).not.toHaveBeenCalled();
        });

        test("does not create a user when no verifier was initialized", async () => {
            const [scopes, user] = await validateToken(`Bearer ${await signToken()}`, null, resolveUser);

            expect(user).toBeNull();
            expect(scopes).toEqual([]);
            expect(resolveUser).not.toHaveBeenCalled();
        });

        test("ignores an API key without attempting verification", async () => {
            const verifier = await createTokenVerifier(configuration, localKeyResolver);

            const verify = vi.spyOn(verifier, "verify");

            const [, user] = await validateToken("a-raw-api-key-value", verifier, resolveUser);

            expect(user).toBeNull();
            expect(verify).not.toHaveBeenCalled();
        });
    });
});

describe("request context authentication", () => {
    const verifiedUser = {id: "token-user"} as unknown as User;
    const apiKeyUser = {id: "api-key-user"} as unknown as User;

    const systemNoUser = {id: "system-no-user"} as unknown as User;

    let authenticateKey: any;
    let resolveUser: any;

    beforeEach(() => {
        resolveUser = vi.fn(async () => verifiedUser);
        authenticateKey = vi.fn(async () => apiKeyUser);
    });

    // Mirrors the context callback in app.ts.  app.ts starts the service at import time and cannot be imported here.
    async function buildContext(authorization: string, requireAuthentication: boolean, verifier: any) {
        let user = null;

        if (requireAuthentication) {
            const [scopes, tokenUser] = await validateToken(authorization, verifier, resolveUser);

            if (scopes != null) {
                user = tokenUser;
            }

            if (!user) {
                user = await authenticateKey(authorization);
            }
        }

        return user ?? systemNoUser;
    }

    test("a valid token authenticates without consulting the API key path", async () => {
        const jose: any = await import("jose");
        const {privateKey, publicKey} = await jose.generateKeyPair("RS256", {extractable: true});

        const verifier = await createTokenVerifier({
            issuers: [ISSUER],
            jwksUri: "https://tenant/keys",
            audiences: [AUDIENCE]
        }, publicKey);

        const token = await new jose.SignJWT({oid: IDENTITY_ID})
            .setProtectedHeader({alg: "RS256"})
            .setIssuer(ISSUER)
            .setAudience(AUDIENCE)
            .setExpirationTime("5m")
            .sign(privateKey);

        const user = await buildContext(`Bearer ${token}`, true, verifier);

        expect(user).toBe(verifiedUser);
        expect(authenticateKey).not.toHaveBeenCalled();
    });

    test("an invalid token falls through to API key authentication", async () => {
        const verifier = {verify: async () => null};

        const user = await buildContext("Bearer header.payload.signature", true, verifier);

        expect(user).toBe(apiKeyUser);
        expect(authenticateKey).toHaveBeenCalledWith("Bearer header.payload.signature");
    });

    test("an API key is passed through unmodified", async () => {
        const verifier = {verify: async () => null};

        const user = await buildContext("a-raw-api-key-value", true, verifier);

        expect(user).toBe(apiKeyUser);
        expect(authenticateKey).toHaveBeenCalledWith("a-raw-api-key-value");
    });

    test("disabled authentication skips both token and API key paths", async () => {
        const verifier = {verify: vi.fn(async () => null)};

        const user = await buildContext("Bearer header.payload.signature", false, verifier);

        expect(user).toBe(systemNoUser);
        expect(authenticateKey).not.toHaveBeenCalled();
        expect(verifier.verify).not.toHaveBeenCalled();
    });
});
