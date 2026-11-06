import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { connectDB, disconnectDB } from '../lib/db';
import { redis } from '../lib/redis';
import { AdminModel } from '../modules/admins/models/admin.model';
import { ChargesService } from '../modules/charges/charges.service';

/** Idempotent: default charges on an empty DB, and the first super admin from env. */
async function seed() {
  await connectDB();
  await ChargesService.ensureDefaults();
  console.log('✓ charge rules');

  if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    if (!(await AdminModel.exists({ email }))) {
      await AdminModel.create({ name: 'Tela Admin', email, role: 'super_admin', passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, 12) });
      console.log(`✓ super admin ${email}`);
    } else console.log(`· admin ${email} exists`);
  } else console.log('· SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — no admin created');

  await disconnectDB();
  redis.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
