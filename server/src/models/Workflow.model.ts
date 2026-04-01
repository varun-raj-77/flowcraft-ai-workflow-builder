import mongoose, { type Document, Schema } from 'mongoose';

// ── TypeScript interface for the document ───────────────────

export interface IWorkflowDocument extends Document {
  userId: string;
  name: string;
  description?: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    description?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    conditionBranch?: string;
    label?: string;
  }>;
  isGeneratedByAI: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ──────────────────────────────────────────────────

const workflowSchema = new Schema<IWorkflowDocument>(
  {
    userId: {
      type: String,
      required: true,
      index: true, // Dashboard queries: "find all my workflows"
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Nodes and edges are stored as Mixed arrays.
    // Validation happens at the API layer via Zod, not in Mongoose.
    // This is deliberate: Mongoose subdocument schemas can't express
    // discriminated unions (different config shapes per node type).
    nodes: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    edges: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    isGeneratedByAI: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    // Custom toJSON to rename _id and strip __v for cleaner API responses
    toJSON: {
      transform(_doc, ret) {
        ret._id = ret._id.toString();
        delete ret.__v;
        return ret;
      },
    },
  },
);

export const Workflow = mongoose.model<IWorkflowDocument>('Workflow', workflowSchema);
