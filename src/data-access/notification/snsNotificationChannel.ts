import {PublishCommand, SNSClient} from "@aws-sdk/client-sns";

import {INotificationChannel, NotificationMessage} from "./notificationChannel";
import {failureText} from "../../util/phaseFailure";

const debug = require("debug")("nmcp:nmcp-api:sns-notification-channel");

// Without throwOnRequestTimeout the handler only warns when requestTimeout passes and leaves the publish pending, so a
// hung publish would never be logged as a failure.
const snsConnectionTimeoutMs = 5_000;
const snsRequestTimeoutMs = 10_000;

export type SnsClientFactory = (region: string) => Pick<SNSClient, "send">;

export function createSnsClient(region: string): SNSClient {
    return new SNSClient({
        region: region,
        // One attempt: a failed publish is logged and lost, not retried.  Set in code so that AWS_MAX_ATTEMPTS or a
        // profile's max_attempts cannot bring back the SDK's default of three.
        maxAttempts: 1,
        requestHandler: {connectionTimeout: snsConnectionTimeoutMs, requestTimeout: snsRequestTimeoutMs, throwOnRequestTimeout: true}
    });
}

/**
 * arn:<partition>:sns:<region>:<account-id>:<topic-name>.  A subscription ARN has a seventh segment and is refused:
 * publishing to one fails.
 */
export function regionFromTopicArn(topicArn: string): string | null {
    const parts = topicArn ? topicArn.split(":") : [];

    if (parts.length !== 6 || parts[0] !== "arn" || parts[2] !== "sns" || parts.some(part => part.length === 0)) {
        return null;
    }

    return parts[3];
}

export class SnsNotificationChannel implements INotificationChannel {
    public readonly name = "sns";

    private readonly region: string | null;

    private client: Pick<SNSClient, "send"> = null;

    public constructor(private readonly topicArn: string, private readonly createClient: SnsClientFactory = createSnsClient) {
        this.region = regionFromTopicArn(topicArn);
    }

    public async send(message: NotificationMessage): Promise<void> {
        if (!this.topicArn) {
            debug("no topic ARN is configured; not publishing");
            return;
        }

        if (!this.region) {
            debug(`${this.topicArn} is not an SNS topic ARN; not publishing`);
            return;
        }

        try {
            this.client ??= this.createClient(this.region);

            const output = await this.client.send(new PublishCommand({
                TopicArn: this.topicArn,
                Subject: message.subject,
                Message: message.body
            }));

            debug(`published to ${this.topicArn} as message ${output.MessageId}`);
        } catch (err) {
            debug(`publish to ${this.topicArn} failed: ${failureText(err)}`);
        }
    }
}
