import {expect, test, vi, describe, afterEach} from "vitest";
import {format} from "util";

// require() rather than import: the .ts sources are compiled to .js in place, and an ESM import yields a
// different module instance than the CJS one the model methods call into, so the spies would not apply.
const createDebug = require("debug");
const {PublishCommand} = require("@aws-sdk/client-sns");
const {SnsNotificationChannel, createSnsClient, regionFromTopicArn} = require("../src/data-access/notification/snsNotificationChannel");

const topicArn = "arn:aws:sns:us-west-2:123456789012:nmcp-access-requests";

const message = {subject: "New NMCP Access Request", body: "There is a new NMCP portal access request."};

function fakeClient() {
    const send = vi.fn().mockResolvedValue({MessageId: "message-1"});

    return {send: send, factory: vi.fn(() => ({send: send}))};
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("regionFromTopicArn", () => {
    test("reads the region of a topic ARN", () => {
        expect(regionFromTopicArn(topicArn)).toBe("us-west-2");
    });

    test("accepts partitions other than aws", () => {
        expect(regionFromTopicArn("arn:aws-us-gov:sns:us-gov-west-1:123456789012:topic")).toBe("us-gov-west-1");
    });

    test.each([
        {label: "an empty value", value: ""},
        {label: "an absent value", value: undefined},
        {label: "a null value", value: null},
        {label: "something that is not an ARN", value: "not-an-arn"},
        {label: "another service's ARN", value: "arn:aws:sqs:us-west-2:123456789012:queue"},
        {label: "a missing region", value: "arn:aws:sns::123456789012:topic"},
        {label: "a missing topic name", value: "arn:aws:sns:us-west-2:123456789012"},
        {label: "a subscription ARN", value: `${topicArn}:0b6a1c2e-1111-2222-3333-444455556666`}
    ])("refuses $label", ({value}) => {
        expect(regionFromTopicArn(value)).toBeNull();
    });
});

describe("SnsNotificationChannel.send", () => {
    test("publishes the subject and body to the topic through a client for the ARN's region", async () => {
        const client = fakeClient();

        await new SnsNotificationChannel(topicArn, client.factory).send(message);

        expect(client.factory).toHaveBeenCalledTimes(1);
        expect(client.factory).toHaveBeenCalledWith("us-west-2");
        expect(client.send).toHaveBeenCalledTimes(1);

        const command = client.send.mock.calls[0][0];

        expect(command).toBeInstanceOf(PublishCommand);
        expect(command.input).toEqual({TopicArn: topicArn, Subject: message.subject, Message: message.body});
    });

    test("reuses one client across sends", async () => {
        const client = fakeClient();
        const channel = new SnsNotificationChannel(topicArn, client.factory);

        await channel.send(message);
        await channel.send(message);

        expect(client.factory).toHaveBeenCalledTimes(1);
        expect(client.send).toHaveBeenCalledTimes(2);
    });

    test.each([
        {label: "an empty", value: ""},
        {label: "an absent", value: undefined},
        {label: "an invalid", value: "not-an-arn"}
    ])("does nothing for $label topic ARN", async ({value}) => {
        const client = fakeClient();

        await expect(new SnsNotificationChannel(value, client.factory).send(message)).resolves.toBeUndefined();

        expect(client.factory).not.toHaveBeenCalled();
    });

    test("resolves rather than rejecting when the publish fails", async () => {
        const client = fakeClient();

        client.send.mockRejectedValue(Object.assign(new Error("not authorized"), {name: "AuthorizationErrorException"}));

        await expect(new SnsNotificationChannel(topicArn, client.factory).send(message)).resolves.toBeUndefined();
    });

    test("resolves rather than rejecting when the client cannot be built", async () => {
        const factory = vi.fn(() => {
            throw new Error("no client");
        });

        await expect(new SnsNotificationChannel(topicArn, factory).send(message)).resolves.toBeUndefined();
    });
});

describe("the default client", () => {
    // The environment is set to prove the value in code wins over it, which is the reason it is set in code at all.
    test("makes exactly one attempt whatever AWS_MAX_ATTEMPTS says", async () => {
        vi.stubEnv("AWS_MAX_ATTEMPTS", "5");

        expect(await createSnsClient("us-west-2").config.maxAttempts()).toBe(1);
    });
});

describe("SnsNotificationChannel logging", () => {
    let lines: string[];
    let originalLog: any;
    let previousNamespaces: string;

    function captureLog() {
        lines = [];
        originalLog = createDebug.log;
        previousNamespaces = createDebug.disable();

        createDebug.enable("nmcp:nmcp-api:sns-notification-channel");
        createDebug.log = (...args: any[]) => lines.push(format(...args));
    }

    afterEach(() => {
        createDebug.log = originalLog;
        createDebug.enable(previousNamespaces);
    });

    test("logs the message id of a successful publish", async () => {
        captureLog();

        await new SnsNotificationChannel(topicArn, fakeClient().factory).send(message);

        expect(lines.some(line => line.includes("message-1"))).toBe(true);
    });

    test("logs a failed publish", async () => {
        captureLog();

        const client = fakeClient();

        client.send.mockRejectedValue(new Error("not authorized"));

        await new SnsNotificationChannel(topicArn, client.factory).send(message);

        expect(lines.some(line => line.includes("not authorized"))).toBe(true);
    });

    test("logs a skipped publish when no topic is configured", async () => {
        captureLog();

        await new SnsNotificationChannel("", fakeClient().factory).send(message);

        expect(lines.some(line => line.includes("not publishing"))).toBe(true);
    });

    test("logs the offending value when the topic ARN does not parse", async () => {
        captureLog();

        await new SnsNotificationChannel("not-an-arn", fakeClient().factory).send(message);

        expect(lines.some(line => line.includes("not-an-arn") && line.includes("not publishing"))).toBe(true);
    });
});
