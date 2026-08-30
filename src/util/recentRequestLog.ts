import {User} from "../models/user";
import {UnauthorizedError} from "../graphql/secureResolvers";
import {ServiceOptions} from "../options/serviceOptions";

export type RecentRequest = {
    /** The address the request is attributed to, after the trust-proxy hop count is applied. */
    address: string;
    /** The peer on the other end of the socket - the gateway, unless the process is reached directly. */
    socketAddress: string;
    /** The forwarding chain as received, which is what determines whether the configured hop count is right. */
    forwardedFor: string;
    at: Date;
}

/**
 * A rolling window of the addresses recent requests were attributed to, held only in memory.
 *
 * It exists to answer one deployment question: whether requests are arriving with distinct client addresses or are all
 * collapsing onto the gateway.  Both the resolved and the socket address are kept because it is the difference between
 * them, together with the forwarding chain, that shows whether trustedProxyHops is set correctly.
 */
export class RecentRequestLog {
    private readonly limit: number;

    private entries: RecentRequest[] = [];

    public constructor(limit: number) {
        this.limit = Math.max(0, limit);
    }

    public record(address: string, socketAddress: string, forwardedFor: string | string[]): void {
        if (this.limit == 0) {
            return;
        }

        this.entries.push({
            address: address ?? "",
            socketAddress: socketAddress ?? "",
            // Node collapses a repeated header into an array; either way the chain is wanted as it arrived.
            forwardedFor: Array.isArray(forwardedFor) ? forwardedFor.join(", ") : forwardedFor ?? "",
            at: new Date()
        });

        if (this.entries.length > this.limit) {
            this.entries.splice(0, this.entries.length - this.limit);
        }
    }

    /**
     * Newest first.  Returns a copy so a caller iterating the result can not be disturbed by requests arriving while it
     * does so.
     */
    public recent(user: User): RecentRequest[] {
        if (!user?.canViewRequestDiagnostics()) {
            throw new UnauthorizedError();
        }

        return [...this.entries].reverse();
    }
}

export const recentRequestLog = new RecentRequestLog(ServiceOptions.recentRequestAddressLimit);
