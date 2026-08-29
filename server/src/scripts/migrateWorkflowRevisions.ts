import mongoose from 'mongoose';
import { migrateWorkflowRevisions } from '../services/workflow.service';
import { redactText } from '../utils/redact';
import { migrationExitCode } from './maintenanceExitCode';

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
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run migrate:workflow-revisions -- [--dry-run] [--batch-size=100]');
    console.log('Dry run validates and reports with zero writes. Real migration requires transaction-capable MongoDB.');
    console.log('After migration: npm run verify:workflow-revisions');
    console.log('Legacy execution runs remain unpinned; the migration never fabricates historical provenance.');
    return;
  }
  const dryRun = args.includes('--dry-run');
  const { connectDatabase } = await import('../config/database');
  await connectDatabase();
  const summary = await migrateWorkflowRevisions((event) => {
    console.log(JSON.stringify({ event: 'workflow_revision_migration', ...event }));
  }, { dryRun, batchSize: parseBatchSize(args) });
  console.log(JSON.stringify({ event: 'workflow_revision_migration_complete', ...summary }));
  process.exitCode = migrationExitCode(summary);
}

main()
  .catch((error) => {
    console.error(JSON.stringify({
      event: 'workflow_revision_migration_fatal',
      message: redactText(error instanceof Error ? error.message : String(error)),
    }));
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
