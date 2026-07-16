import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import authRoutes from './auth.routes';
import workflowRoutes from './workflow.routes';
import executionRoutes from './execution.routes';
import aiRoutes from './ai.routes';
import { requireTrustedOrigin } from '../middleware/csrf.middleware';

const router = Router();

router.use(requireTrustedOrigin);

// Public routes
router.use('/auth', authRoutes);

// Protected routes — all require authentication
router.use('/workflows', authMiddleware, workflowRoutes);
router.use('/executions', authMiddleware, executionRoutes);
router.use('/ai', authMiddleware, aiRoutes);

export default router;
