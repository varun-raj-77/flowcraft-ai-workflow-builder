export function migrationExitCode(summary: {
  invalid: number;
  integrityErrors: number;
  failed: number;
}): 0 | 1 {
  return summary.invalid > 0 || summary.integrityErrors > 0 || summary.failed > 0 ? 1 : 0;
}

export function verificationExitCode(summary: { integrityErrors: number }): 0 | 1 {
  return summary.integrityErrors > 0 ? 1 : 0;
}
