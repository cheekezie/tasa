import { startWorker } from '../../lib/queue';
import { UserModel } from '../users/models/user.model';
import { sendPush } from './channels/push';
import { email } from './channels/email';
import { sms } from './channels/sms';
import { NotificationModel } from './models/notification.model';
import { NOTIFY_QUEUE, pushAllowed } from './notifications.service';

export function startNotificationsWorker() {
  startWorker(NOTIFY_QUEUE, async (job) => {
    if (job.name === 'email') {
      const { to, subject, text, html } = job.data as { to: string; subject: string; text: string; html?: string };
      await email.send({ to, subject, text, ...(html && { html }) });
      return;
    }
    if (job.name === 'sms') {
      const { to, body } = job.data as { to: string; body: string };
      await sms.send(to, body);
      return;
    }
    if (job.name === 'push') {
      const n = await NotificationModel.findById((job.data as { notificationId: string }).notificationId);
      if (!n) return;
      const user = await UserModel.findById(n.user).select('pushTokens notificationPrefs');
      if (!user || !pushAllowed(user.notificationPrefs, n.type) || user.pushTokens.length === 0) return;
      const { invalidTokens } = await sendPush({
        to: user.pushTokens,
        title: n.title,
        body: n.body,
        data: { type: n.type, ...(n.data ? Object.fromEntries(n.data as unknown as Map<string, string>) : {}) },
      });
      if (invalidTokens.length) await UserModel.updateOne({ _id: user._id }, { $pull: { pushTokens: { $in: invalidTokens } } });
    }
  });
}
