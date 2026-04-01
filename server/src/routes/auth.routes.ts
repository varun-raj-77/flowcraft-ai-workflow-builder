import { Router } from 'express';
import * as controller from '../controllers/auth.controller';
import { validateBody } from '../middleware/validate.middleware';
import { authMiddleware } from '../middleware/auth.middleware';
import { registerSchema, loginSchema } from '../validators/auth.validator';

const router = Router();

// Public
router.post('/register', validateBody(registerSchema), controller.register);
router.post('/login', validateBody(loginSchema), controller.login);

// Protected
router.post('/logout', authMiddleware, controller.logout);
router.get('/me', authMiddleware, controller.getMe);

export default router;
