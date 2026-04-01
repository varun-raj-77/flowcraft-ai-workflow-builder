import { User, type IUserDocument } from '../models/User.model';
import { AppError } from '../middleware/errorHandler.middleware';
import { hashPassword, comparePassword } from '../utils/password';
import { signToken } from '../utils/jwt';
import type { RegisterInput, LoginInput } from '../validators/auth.validator';

interface AuthResult {
  user: IUserDocument;
  token: string;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  // Check for duplicate email
  const existing = await User.findOne({ email: input.email.toLowerCase() });
  if (existing) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    email: input.email.toLowerCase(),
    passwordHash,
    displayName: input.displayName,
  });

  const token = signToken({ userId: user._id.toString() });

  return { user, token };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  // +passwordHash to include the field excluded by select:false
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');

  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const isValid = await comparePassword(input.password, user.passwordHash);
  if (!isValid) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const token = signToken({ userId: user._id.toString() });

  return { user, token };
}

export async function getMe(userId: string): Promise<IUserDocument> {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }
  return user;
}
