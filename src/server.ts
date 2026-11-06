import { buildApp } from './app';
import { devOtp, env } from './config/env';
import { startMaintenance } from './jobs/maintenance';
import { connectDB, describeDB, disconnectDB } from './lib/db';
import { closeQueues } from './lib/queue';
import { redis } from './lib/redis';
import { startBillsWorker } from './modules/bills/bills.worker';
import { startTicketsWorker } from './modules/tickets/tickets.worker';
import { startGroupsWorker } from './modules/groups/groups.worker';
import { registerGuest } from './modules/guest/guest.listeners';
import { startGuestWorker } from './modules/guest/guest.worker';
import { registerSplits } from './modules/splits/splits.listeners';
import { startSplitsWorker } from './modules/splits/splits.worker';
import { ChargesService } from './modules/charges/charges.service';
import { registerNotifications } from './modules/notifications/notifications.listeners';
import { startNotificationsWorker } from './modules/notifications/notifications.worker';
import { registerPoints } from './modules/points/points.listeners';
import { registerBeneficiaries } from './modules/beneficiaries/beneficiaries.listeners';
import { startStorageWorker } from './modules/users/users.worker';
import { WebhooksService } from './modules/webhooks/webhooks.service';

async function start() {
  await connectDB();
  console.log(`MongoDB connected: ${describeDB()}`);
  await ChargesService.ensureDefaults();

  // Domain event subscribers + queue workers.
  registerNotifications();
  registerPoints();
  registerBeneficiaries();
  registerSplits();
  registerGuest();
  startNotificationsWorker();
  startBillsWorker();
  startTicketsWorker();
  startGroupsWorker();
  startSplitsWorker();
  startGuestWorker();
  startStorageWorker();
  WebhooksService.startWorker();
  await startMaintenance();

  const app = await buildApp();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`API listening on http://localhost:${env.PORT}/api`);
  if (devOtp.code) app.log.warn(`Development OTP is on: every code is ${devOtp.code} and no SMS or email is sent`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closeQueues();
    await disconnectDB();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
