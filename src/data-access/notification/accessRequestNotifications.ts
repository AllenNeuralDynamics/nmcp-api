import {CoreServiceOptions} from "../../options/coreServicesOptions";
import {INotificationChannel, NotificationMessage} from "./notificationChannel";
import {SnsNotificationChannel} from "./snsNotificationChannel";
import {failureText} from "../../util/phaseFailure";
import {AccessRequestKind} from "../../models/accessRequestKind";

const debug = require("debug")("nmcp:nmcp-api:access-request-notifications");

const channels: INotificationChannel[] = [];

export function registerChannel(channel: INotificationChannel): void {
    channels.push(channel);
    debug(`channel registered: ${channel.name}`);
}

export function clearChannels(): void {
    channels.length = 0;
}

type CreatedMessageWording = {
    subject: string;
    announcement: string;
    reviewPrompt: string;
    reviewTab: string;
}

const createdMessageWording: Record<AccessRequestKind, CreatedMessageWording> = {
    [AccessRequestKind.Access]: {
        subject: "New NMCP Access Request",
        announcement: "There is a new NMCP portal access request.",
        reviewPrompt: "You can review access request here:",
        reviewTab: "accessrequests"
    },
    [AccessRequestKind.Feedback]: {
        subject: "New NMCP Message",
        announcement: "There is a new NMCP portal message.",
        reviewPrompt: "You can review the message here:",
        reviewTab: "feedback"
    }
};

/**
 * Through URL rather than string concatenation so a configured URL that already carries a query or a fragment still
 * comes out well formed.  This runs on the request path after the commit, so an unparseable URL must not throw: it is
 * linked unchanged, which is what was sent before the tab existed.
 */
function reviewUrlForTab(reviewUrl: string, tab: string): string {
    try {
        const url = new URL(reviewUrl);

        url.searchParams.set("tab", tab);

        return url.toString();
    } catch {
        return reviewUrl;
    }
}

export function accessRequestCreatedMessage(reviewUrl: string, requestKind: AccessRequestKind): NotificationMessage {
    const wording = createdMessageWording[requestKind];

    if (!reviewUrl) {
        return {subject: wording.subject, body: wording.announcement};
    }

    return {
        subject: wording.subject,
        body: `${wording.announcement}  ${wording.reviewPrompt} ${reviewUrlForTab(reviewUrl, wording.reviewTab)}`
    };
}

export function notifyAccessRequestCreated(requestKind: AccessRequestKind): void {
    notify(accessRequestCreatedMessage(CoreServiceOptions.notification.accessRequest.reviewUrl, requestKind));
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
