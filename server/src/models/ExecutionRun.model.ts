import mongoose, { type HydratedDocument, Schema } from 'mongoose';

export interface IStepLog {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  diagnostic?: Record<string, unknown>;
}

export interface IExecutionRun {
  workflowId: mongoose.Types.ObjectId;
  workflowRevisionId?: mongoose.Types.ObjectId;
  workflowRevision?: number;
  definitionHash?: string;
  userId: string;
  /** Per-run fencing token; absent for pre-M9 historical records. */
  leaseOwner?: string;
  leaseHeartbeatAt?: Date;
  leaseExpiresAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: Date;
  completedAt?: Date;
  triggerType: 'manual' | 'ai_generated';
  error?: string;
  stepLogs: IStepLog[];
  executionOrder: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type IExecutionRunDocument = HydratedDocument<IExecutionRun>;

const stepLogSchema = new Schema<IStepLog>(
  {
    nodeId: { type: String, required: true },
    nodeType: { type: String, required: true },
    nodeLabel: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'success', 'failed', 'skipped'],
      default: 'pending',
    },
    startedAt: Date,
    completedAt: Date,
    durationMs: Number,
    input: Schema.Types.Mixed,
    output: Schema.Types.Mixed,
    error: String,
    diagnostic: Schema.Types.Mixed,
  },
  { _id: false },
);

const executionRunSchema = new Schema<IExecutionRun>(
  {
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      required: true,
    },
    workflowRevisionId: {
      type: Schema.Types.ObjectId,
      ref: 'WorkflowRevision',
    },
    workflowRevision: {
      type: Number,
      min: 1,
    },
    definitionHash: {
      type: String,
      match: /^[a-f0-9]{64}$/,
    },
    userId: {
      type: String,
      required: true,
    },
    leaseOwner: { type: String },
    leaseHeartbeatAt: Date,
    leaseExpiresAt: Date,
    status: {
      type: String,
      enum: ['running', 'completed', 'failed', 'cancelled'],
      default: 'running',
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: Date,
    triggerType: {
      type: String,
      enum: ['manual', 'ai_generated'],
      default: 'manual',
    },
    error: String,
    stepLogs: [stepLogSchema],
    executionOrder: [String],
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        return {
          ...ret,
          _id: ret._id.toString(),
          workflowId: ret.workflowId.toString(),
          workflowRevisionId: ret.workflowRevisionId?.toString(),
          // Fencing tokens are internal and must never be exposed to clients.
          leaseOwner: undefined,
          leaseHeartbeatAt: undefined,
          leaseExpiresAt: undefined,
          __v: undefined,
        };
      },
    },
  },
);

// "Show execution history for this workflow, newest first"
executionRunSchema.index({ workflowId: 1, createdAt: -1 });
executionRunSchema.index({ userId: 1 });
executionRunSchema.index({ workflowRevisionId: 1 });
// Efficient bounded scans of only M9-leased in-flight runs.
executionRunSchema.index({ status: 1, leaseExpiresAt: 1 });

export const ExecutionRun = mongoose.model<IExecutionRun>(
  'ExecutionRun',
  executionRunSchema,
);
