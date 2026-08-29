import mongoose, { type HydratedDocument, Schema } from 'mongoose';

// ── TypeScript interface for the document ───────────────────

export interface IWorkflow {
  userId: string;
  name: string;
  description?: string;
  currentRevisionId?: mongoose.Types.ObjectId;
  currentRevision?: number;
  /** Legacy pre-revision data. Used only by the explicit migration command. */
  nodes?: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
    description?: string;
  }>;
  /** Legacy pre-revision data. Used only by the explicit migration command. */
  edges?: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    conditionBranch?: string;
    label?: string;
  }>;
  isGeneratedByAI: boolean;
  generationMetadata?: {
    originalPrompt: string;
    generatedAt: Date;
    provider?: string;
    model?: string;
    capabilityCoverage?: {
      requestedCapabilities: string[];
      implementedCapabilities: string[];
      missingCapabilities: string[];
      unsupportedCapabilities: string[];
      coverage: number;
      isComplete: boolean;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

export type IWorkflowDocument = HydratedDocument<IWorkflow>;

// ── Schema ──────────────────────────────────────────────────

const workflowSchema = new Schema<IWorkflow>(
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
      default: undefined,
    },
    edges: {
      type: [Schema.Types.Mixed],
      default: undefined,
    },
    isGeneratedByAI: {
      type: Boolean,
      default: false,
    },
    generationMetadata: {
      type: new Schema({
        originalPrompt: { type: String, maxlength: 2000 },
        generatedAt: { type: Date },
        provider: { type: String, maxlength: 100 },
        model: { type: String, maxlength: 100 },
        capabilityCoverage: {
          requestedCapabilities: [String],
          implementedCapabilities: [String],
          missingCapabilities: [String],
          unsupportedCapabilities: [String],
          coverage: Number,
          isComplete: Boolean,
        },
      }, { _id: false }),
      default: undefined,
    },
    currentRevisionId: {
      type: Schema.Types.ObjectId,
      ref: 'WorkflowRevision',
      index: true,
    },
    currentRevision: {
      type: Number,
      min: 1,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt automatically
    // Custom toJSON to rename _id and strip __v for cleaner API responses
    toJSON: {
      transform(_doc, ret) {
        return {
          ...ret,
          _id: String(ret._id),
          currentRevisionId: ret.currentRevisionId?.toString(),
          __v: undefined,
        };
      },
    },
  },
);

export const Workflow = mongoose.model<IWorkflow>('Workflow', workflowSchema);
