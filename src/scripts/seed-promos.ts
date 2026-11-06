import { env } from '../config/env';
import { connectDB, describeDB, disconnectDB } from '../lib/db';
import { closeQueues } from '../lib/queue';
import { redis } from '../lib/redis';
import { CreatePromoSchema } from '../modules/coupons/coupons.schema';
import { CouponsService } from '../modules/coupons/coupons.service';
import { CouponModel } from '../modules/coupons/models/coupon.model';

const NAIRA = 100;
const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();

/** Demo promos for development. Amounts are kobo, as the API takes them. */
const PROMOS = [
  {
    code: 'WELCOME50',
    title: 'Welcome to Tela',
    description: 'Half off your first bill.',
    valueType: 'percent',
    value: 50,
    maxDiscount: 1_000 * NAIRA,
    minSpend: 1_000 * NAIRA,
    budget: 500_000 * NAIRA,
    audience: 'first_bill',
  },
  {
    code: 'LIGHTUP10',
    title: 'Light up for less',
    description: '10% off electricity.',
    valueType: 'percent',
    value: 10,
    maxDiscount: 500 * NAIRA,
    minSpend: 2_000 * NAIRA,
    budget: 200_000 * NAIRA,
    usesPerUser: 3,
    services: ['electricity'],
  },
  {
    code: 'STAYONLINE5',
    title: 'Stay online',
    description: '5% off airtime and data.',
    valueType: 'percent',
    value: 5,
    maxDiscount: 200 * NAIRA,
    minSpend: 500 * NAIRA,
    budget: 100_000 * NAIRA,
    usesPerUser: 3,
    services: ['airtime'],
  },
  {
    code: 'TVNOFEE',
    title: 'No service charge on TV',
    description: 'We cover the service charge on your next TV renewal.',
    valueType: 'percent',
    value: 100,
    maxDiscount: 50 * NAIRA,
    minSpend: 1_000 * NAIRA,
    appliesTo: 'fee',
    budget: 50_000 * NAIRA,
    services: ['tv'],
  },
  {
    code: 'VERIFIED300',
    title: 'Thanks for verifying',
    description: '₦300 off for customers with a verified BVN.',
    valueType: 'fixed',
    value: 300 * NAIRA,
    minSpend: 1_000 * NAIRA,
    budget: 100_000 * NAIRA,
    audience: 'bvn_on_file',
  },
  {
    // Not listed: works when typed, never shows as a banner.
    code: 'PARTNER200',
    title: 'Partner offer',
    valueType: 'fixed',
    value: 200 * NAIRA,
    minSpend: 2_000 * NAIRA,
    budget: 50_000 * NAIRA,
    listed: false,
  },
];

/** Idempotent: codes that already exist are left as they are. */
async function seed() {
  if (env.NODE_ENV === 'production') throw new Error('Demo promos spend real money: not in production');
  await connectDB();
  console.log(`Seeding promos into ${describeDB()}`);

  for (const promo of PROMOS) {
    if (await CouponModel.exists({ code: promo.code })) {
      console.log(`· ${promo.code} exists`);
      continue;
    }
    const { warnings } = await CouponsService.createPromo(CreatePromoSchema.parse({ ...promo, expiresAt }));
    console.log(`✓ ${promo.code}: ${promo.title}`);
    warnings.forEach((warning) => console.log(`  ! ${warning}`));
  }
}

seed()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await disconnectDB();
    redis.disconnect();
    // lib/queue holds a shared Redis connection open for the life of the process.
    process.exit();
  });
