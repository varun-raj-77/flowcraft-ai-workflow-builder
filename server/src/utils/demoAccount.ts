import { env } from '../config/environment';

export function isDemoAccountEmail(email: string): boolean {
  return email.trim().toLowerCase() === env.DEMO_ACCOUNT_EMAIL;
}
