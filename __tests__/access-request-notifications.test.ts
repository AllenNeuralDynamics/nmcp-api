import {expect, test, vi, describe, beforeEach, afterEach} from "vitest";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const notifications = require("../src/data-access/notification/accessRequestNotifications");
const {CoreServiceOptions} = require("../src/options/coreServicesOptions");

const options = CoreServiceOptions.notification.accessRequest;

const configuredReviewUrl = options.reviewUrl;

const reviewUrl = "https://portal.example.org/admin";

function channel(name: string, send: any = vi.fn().mockResolvedValue(undefined)) {
    return {name: name, send: send};
}

// Lets a detached rejection settle, so one that escaped would be reported against the test that caused it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

// Also removes the SNS channel registered at load, so nothing here reaches the SDK.
beforeEach(() => {
    notifications.clearChannels();
});

afterEach(() => {
    options.reviewUrl = configuredReviewUrl;
    vi.restoreAllMocks();
});

describe("accessRequestCreatedMessage", () => {
    test("links the review page", () => {
        expect(notifications.accessRequestCreatedMessage(reviewUrl)).toEqual({
            subject: "New NMCP Access Request",
            body: `There is a new NMCP portal access request.  You can review access request here: ${reviewUrl}`
        });
    });

    test.each([
        {label: "an empty", value: ""},
        {label: "an absent", value: undefined}
    ])("stops after the first sentence for $label review URL", ({value}) => {
        expect(notifications.accessRequestCreatedMessage(value).body).toBe("There is a new NMCP portal access request.");
    });
});

describe("notifyAccessRequestCreated", () => {
    test("sends the message, with the review URL read at call time, to every registered channel", () => {
        const first = channel("first");
        const second = channel("second");

        notifications.registerChannel(first);
        notifications.registerChannel(second);

        options.reviewUrl = reviewUrl;

        notifications.notifyAccessRequestCreated();

        const expected = notifications.accessRequestCreatedMessage(reviewUrl);

        expect(first.send).toHaveBeenCalledTimes(1);
        expect(first.send).toHaveBeenCalledWith(expected);
        expect(second.send).toHaveBeenCalledTimes(1);
        expect(second.send).toHaveBeenCalledWith(expected);
    });

    test("does nothing with no channels registered", () => {
        expect(() => notifications.notifyAccessRequestCreated()).not.toThrow();
    });

    test("returns without waiting for a channel to settle", () => {
        const hung = channel("hung", vi.fn(() => new Promise<void>(() => {})));

        notifications.registerChannel(hung);

        expect(notifications.notifyAccessRequestCreated()).toBeUndefined();
        expect(hung.send).toHaveBeenCalledTimes(1);
    });

    // Vitest fails the run on an unhandled rejection, so this also proves the rejection is contained.
    test("contains a rejecting channel and still reaches the next one", async () => {
        const failing = channel("failing", vi.fn().mockRejectedValue(new Error("publish failed")));
        const working = channel("working");

        notifications.registerChannel(failing);
        notifications.registerChannel(working);

        notifications.notifyAccessRequestCreated();

        await settle();

        expect(failing.send).toHaveBeenCalledTimes(1);
        expect(working.send).toHaveBeenCalledTimes(1);
    });

    test("contains a channel that throws before returning a promise", async () => {
        const broken = channel("broken", vi.fn(() => {
            throw new Error("broken channel");
        }));
        const working = channel("working");

        notifications.registerChannel(broken);
        notifications.registerChannel(working);

        expect(() => notifications.notifyAccessRequestCreated()).not.toThrow();

        await settle();

        expect(working.send).toHaveBeenCalledTimes(1);
    });
});
