import mongoose from 'mongoose';
import { verifyWorkflowRevisions } from '../services/workflowRevisionMaintenance';
import { redactText } from '../utils/redact';
import { verificationExitCode } from './maintenanceExitCode';

function parseBatchSize(args: string[]): number | undefined {
  const argument = args.find((value) => value.startsWith('--batch-size='));
  if (!argument) return undefined;
  const value = Number(argument.slice('--batch-size='.length));
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error('--batch-size must be an integer between 1 and 1000');
  }
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    console.log('Usage: npm run verify:workflow-revisions -- [--batch-size=100]');
    console.log('Read-only: verifies revision pointers, ownership, lineage, and canonical hashes; performs no writes.');
    return;
  }
  const { connectDatabase } = await import('../config/database');
  await connectDatabase();
  const summary = await verifyWorkflowRevisions({ batchSize: parseBatchSize(process.argv.slice(2)) });
  console.log(JSON.stringify({ event: 'workflow_revision_verification_complete', ...summary }));
  process.exitCode = verificationExitCode(summary);
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: 'workflow_revision_verification_fatal',
      message: redactText(error instanceof Error ? error.message : String(error)),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
