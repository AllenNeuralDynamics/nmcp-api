export type NotificationMessage = {
    subject: string;
    body: string;
}

export interface INotificationChannel {
    readonly name: string;

    /**
     * Resolves once the attempt is over, whether or not it succeeded - a channel logs its own outcome.
     */
    send(message: NotificationMessage): Promise<void>;
}
