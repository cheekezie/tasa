import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { connectDB, disconnectDB } from '../lib/db';
import { redis } from '../lib/redis';
import { AdminModel, type AdminRole } from '../modules/admins/models/admin.model';

/**
 * One sample admin per role, for trying the back office locally. The password is public (it's
 * in the admin's login page in dev), so this refuses to run in production, and never touches an
 * account it didn't create.
 */
export const DEV_ADMIN_PASSWORD = 'tela-dev-admin';
export const DEV_ADMINS: { name: string; email: string; role: AdminRole }[] = [
  { name: 'Sam Super', email: 'super@tasa.dev', role: 'super_admin' },
  { name: 'Fola Finance', email: 'finance@tasa.dev', role: 'finance' },
  { name: 'Sade Support', email: 'support@tasa.dev', role: 'support' },
  { name: 'Kemi Compliance', email: 'compliance@tasa.dev', role: 'compliance' },
];

async function seedDevAdmins() {
  if (env.NODE_ENV === 'production') {
    console.error('✗ Refusing: sample admins have a public password and never belong in production.');
    process.exit(1);
  }
  await connectDB();
  const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
  for (const admin of DEV_ADMINS) {
    if (await AdminModel.exists({ email: admin.email })) {
      console.log(`· ${admin.email} exists`);
      continue;
    }
    await AdminModel.create({ ...admin, passwordHash });
    console.log(`✓ ${admin.role.padEnd(11)} ${admin.email}`);
  }
  console.log(`\nPassword for all of them: ${DEV_ADMIN_PASSWORD}`);
  await disconnectDB();
  redis.disconnect();
}

seedDevAdmins().catch((err) => {
  console.error(err);
  process.exit(1);
});
