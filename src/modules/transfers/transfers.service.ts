import { inTransaction } from '../../lib/db';
import { notFound, unprocessable } from '../../lib/errors';
import { bus } from '../../lib/events';
import { newReference } from '../../lib/references';
import { ChargesService } from '../charges/charges.service';
import { Accounts, LedgerService } from '../ledger/ledger.service';
import { QuotesService, toQuoteDto } from '../quotes/quotes.service';
import { TransactionModel } from '../transactions/models/transaction.model';
import { toTransactionDto } from '../transactions/transactions.mapper';
import { UserModel } from '../users/models/user.model';
import { PinService } from '../users/pin.service';
import { UsersService, publicName } from '../users/users.service';
import type { TransferQuoteInput } from './transfers.schema';

export const TransfersService = {
  async quote(userId: string, input: TransferQuoteInput) {
    const recipient = await UsersService.resolve(input.recipient);
    if (!recipient) throw notFound("We couldn't find a Tela user with those details");
    if (recipient.id === userId) throw unprocessable("You can't send money to yourself", 'SELF_TRANSFER');
    const { charges, fee } = await ChargesService.compute({ scope: 'transfer' }, input.amount);
    const quote = await QuotesService.create(userId, {
      kind: 'transfer',
      amount: input.amount,
      charges,
      fee,
      transfer: { recipient: recipient._id, username: recipient.username, name: publicName(recipient), note: input.note },
    });
    return toQuoteDto(quote);
  },

  async send(userId: string, quoteId: string, pin: string) {
    const existing = await TransactionModel.findOne({ quote: quoteId, user: userId });
    if (existing) return toTransactionDto(existing);
    await PinService.verify(userId, pin);
    const sender = await UserModel.findById(userId).select('username fullName');

    const { debit, credit } = await inTransaction(async (session) => {
      const quote = await QuotesService.consume(quoteId, userId, 'transfer', session);
      const t = quote.transfer!;
      const reference = newReference('transfer');
      const now = new Date();
      const [debit, credit] = await TransactionModel.create(
        [
          {
            reference,
            user: userId,
            kind: 'transfer_out',
            direction: 'debit',
            status: 'success',
            amount: quote.amount,
            fee: quote.fee,
            total: quote.total,
            charges: quote.charges,
            quote: quote._id,
            counterparty: { user: t.recipient, username: t.username, name: t.name },
            narration: t.note,
            completedAt: now,
            events: [{ type: 'success', at: now }],
          },
          {
            reference: `${reference}-IN`,
            user: t.recipient,
            kind: 'transfer_in',
            direction: 'credit',
            status: 'success',
            amount: quote.amount,
            total: quote.amount,
            counterparty: { user: userId, username: sender?.username, name: sender ? publicName(sender) : undefined },
            narration: t.note,
            completedAt: now,
            events: [{ type: 'success', at: now }],
          },
        ],
        { session, ordered: true },
      );
      await LedgerService.post(
        {
          key: `transfer:${reference}`,
          memo: `Transfer ${reference}`,
          transactionId: debit!._id,
          lines: [
            { account: Accounts.wallet(userId), amount: quote.total },
            { account: Accounts.wallet(t.recipient), amount: -quote.amount },
            { account: Accounts.charges('transfer'), amount: -quote.fee },
          ],
        },
        session,
      );
      return { debit: debit!, credit: credit! };
    });
    bus.emit('transfer.completed', { debitId: debit.id, creditId: credit.id });
    return toTransactionDto(debit);
  },
};
