import mongoose, { type ClientSession } from 'mongoose';
import { env } from '../config/env';

mongoose.set('strictQuery', true);

export async function connectDB(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 5000 });
}

export const disconnectDB = () => mongoose.disconnect();

/** Host, port and database only: the URI itself can carry a password. */
export const describeDB = () => {
  const { host, port, name } = mongoose.connection;
  return `${host}:${port}/${name}`;
};

/**
 * Runs `fn` in a Mongo transaction, retrying transient conflicts (two debits on one
 * wallet at once). Every wallet movement goes through here, so a debit, its ledger
 * lines and its transaction row commit together or not at all.
 */
export async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

export const isDuplicateKey = (err: unknown) => (err as { code?: number }).code === 11000;

/** Builds a case-insensitive regex from user input without letting it inject regex syntax. */
export const searchRegex = (term: string) => new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
