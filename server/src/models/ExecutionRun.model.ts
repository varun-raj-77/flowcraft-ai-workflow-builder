import mongoose, { type Document, Schema } from 'mongoose';

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
}

export interface IExecutionRunDocument extends Document {
  workflowId: mongoose.Types.ObjectId;
  userId: string;
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
  },
  { _id: false },
);

const executionRunSchema = new Schema<IExecutionRunDocument>(
  {
    workflowId: {
      type: Schema.Types.ObjectId,
      ref: 'Workflow',
      required: true,
    },
    userId: {
      type: String,
      required: true,
    },
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
        ret._id = ret._id.toString();
        ret.workflowId = ret.workflowId.toString();
        delete ret.__v;
        return ret;
      },
    },
  },
);

// "Show execution history for this workflow, newest first"
executionRunSchema.index({ workflowId: 1, createdAt: -1 });
executionRunSchema.index({ userId: 1 });

export const ExecutionRun = mongoose.model<IExecutionRunDocument>(
  'ExecutionRun',
  executionRunSchema,
);
