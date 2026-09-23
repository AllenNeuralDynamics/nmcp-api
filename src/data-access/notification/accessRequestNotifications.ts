import {CoreServiceOptions} from "../../options/coreServicesOptions";
import {INotificationChannel, NotificationMessage} from "./notificationChannel";
import {SnsNotificationChannel} from "./snsNotificationChannel";
import {failureText} from "../../util/phaseFailure";

const debug = require("debug")("nmcp:nmcp-api:access-request-notifications");

const channels: INotificationChannel[] = [];

export function registerChannel(channel: INotificationChannel): void {
    channels.push(channel);
    debug(`channel registered: ${channel.name}`);
}

export function clearChannels(): void {
    channels.length = 0;
}

export function accessRequestCreatedMessage(reviewUrl: string): NotificationMessage {
    const announcement = "There is a new NMCP portal access request.";

    return {
        subject: "New NMCP Access Request",
        body: reviewUrl ? `${announcement}  You can review access request here: ${reviewUrl}` : announcement
    };
}

export function notifyAccessRequestCreated(): void {
    notify(accessRequestCreatedMessage(CoreServiceOptions.notification.accessRequest.reviewUrl));
}

function notify(message: NotificationMessage): void {
    for (const channel of channels) {
        deliver(channel, message);
    }
}

// Detached from the request, so nothing may escape: Node terminates the process on an unhandled rejection.  The await
// sits inside the try so a send that throws before returning a promise is caught as well.
async function deliver(channel: INotificationChannel, message: NotificationMessage): Promise<void> {
    try {
        await channel.send(message);
    } catch (err) {
        debug(`${channel.name} channel failed: ${failureText(err)}`);
    }
}

registerChannel(new SnsNotificationChannel(CoreServiceOptions.notification.accessRequest.snsTopicArn));
