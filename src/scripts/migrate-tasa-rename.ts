import { connectDB, describeDB, disconnectDB } from '../lib/db';
import { closeQueues } from '../lib/queue';
import { redis } from '../lib/redis';
import { AdminModel } from '../modules/admins/models/admin.model';
import { CouponModel } from '../modules/coupons/models/coupon.model';
import { QuoteModel } from '../modules/quotes/models/quote.model';
import { TransactionModel } from '../modules/transactions/models/transaction.model';

/**
 * One-off, after Tela became Tasa: coupons, giveaways and promos paid for by the company were
 * marked `fundedBy: 'tela'`; it's `'tasa'` now. The ledger account a discount is booked to
 * depends on it, so every stored copy changes together. The development staff accounts
 * (`@tela.dev`) become `@tasa.dev`, as `seed-dev-admins` and the back office's login now name
 * them. Safe to run twice.
 */
async function migrate() {
  await connectDB();
  console.log(`Renaming fundedBy 'tela' → 'tasa' in ${describeDB()}`);
  const coupons = await CouponModel.collection.updateMany({ fundedBy: 'tela' }, { $set: { fundedBy: 'tasa' } });
  const transactions = await TransactionModel.collection.updateMany({ 'coupon.fundedBy': 'tela' }, { $set: { 'coupon.fundedBy': 'tasa' } });
  const quotes = await QuoteModel.collection.updateMany({ 'coupon.fundedBy': 'tela' }, { $set: { 'coupon.fundedBy': 'tasa' } });
  console.log(`✓ coupons ${coupons.modifiedCount} · transactions ${transactions.modifiedCount} · quotes ${quotes.modifiedCount}`);

  let admins = 0;
  for (const admin of await AdminModel.find({ email: /@tela\.dev$/ }).select('email')) {
    const email = admin.email.replace(/@tela\.dev$/, '@tasa.dev');
    // Already there (the dev seed ran since): leave the old one for staff to remove.
    if (await AdminModel.exists({ email })) continue;
    await AdminModel.updateOne({ _id: admin._id }, { email });
    admins += 1;
  }
  console.log(`✓ dev staff accounts renamed to @tasa.dev: ${admins}`);
}

migrate()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeQueues();
    await disconnectDB();
    redis.disconnect();
    process.exit();
  });
