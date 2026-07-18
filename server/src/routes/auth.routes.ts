import { Router } from 'express';
import * as controller from '../controllers/auth.controller';
import { validateBody } from '../middleware/validate.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { registerSchema, loginSchema, changePasswordSchema } from '../validators/auth.validator';
import { createRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Public
const authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * 60 * 1000, max: 10 });
const passwordChangeLimiter = createRateLimiter({ name: 'change-password', windowMs: 15 * 60 * 1000, max: 5 });

router.post('/register', authLimiter, validateBody(registerSchema), controller.register);
router.post('/login', authLimiter, validateBody(loginSchema), controller.login);

// Protected
router.post('/logout', authMiddleware, controller.logout);
router.get('/me', authMiddleware, controller.getMe);
router.post('/socket-ticket', authMiddleware, controller.createSocketTicket);
router.post('/change-password', authMiddleware, passwordChangeLimiter, validateBody(changePasswordSchema), controller.changePassword);

export default router;
