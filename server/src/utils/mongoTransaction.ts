import mongoose, { type ClientSession } from 'mongoose';
import { AppError } from '../middleware/errorHandler.middleware';

interface MongoHelloResult {
  setName?: string;
  msg?: string;
  logicalSessionTimeoutMinutes?: number;
}

/** Fail conservatively before operational writes when transactions are known to be unavailable. */
export async function assertTransactionCapability(): Promise<void> {
  const database = mongoose.connection.db;
  if (!database) {
    throw new AppError(503, 'MONGODB_TRANSACTION_PREFLIGHT_FAILED', 'MongoDB connection is not ready');
  }

  let hello: MongoHelloResult;
  try {
    hello = await database.admin().command({ hello: 1 }) as MongoHelloResult;
  } catch {
    throw new AppError(
      503,
      'MONGODB_TRANSACTION_PREFLIGHT_FAILED',
      'MongoDB transaction capability could not be determined',
    );
  }

  const supportsSessions = typeof hello.logicalSessionTimeoutMinutes === 'number';
  const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!supportsSessions || !supportsTransactions) {
    throw new AppError(
      503,
      'MONGODB_TRANSACTIONS_UNSUPPORTED',
      'Workflow revision migration requires a transaction-capable MongoDB replica set or sharded cluster',
    );
  }
}

export async function runInTransaction<T>(operation: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(() => operation(session));
    if (result === undefined || result === null) {
      throw new AppError(500, 'TRANSACTION_ABORTED', 'Database transaction did not commit');
    }
    return result;
  } finally {
    await session.endSession();
  }
}
