import mongoose, { type Document, Schema, type SchemaDefinitionProperty } from 'mongoose';

export type WorkflowRevisionSource = 'manual' | 'ai_generated' | 'restore';

export interface IWorkflowRevisionDocument extends Document {
  workflowId: mongoose.Types.ObjectId;
  userId: string;
  revision: number;
  parentRevisionId: mongoose.Types.ObjectId | null;
  source: WorkflowRevisionSource;
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
  definitionHash: string;
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
  restoredFromRevisionId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const workflowRevisionSchema = new Schema<IWorkflowRevisionDocument>(
  {
    workflowId: { type: Schema.Types.ObjectId, ref: 'Workflow', required: true, immutable: true },
    userId: { type: String, required: true, immutable: true },
    revision: { type: Number, required: true, min: 1, immutable: true },
    parentRevisionId: { type: Schema.Types.ObjectId, ref: 'WorkflowRevision', default: null, immutable: true },
    source: { type: String, enum: ['manual', 'ai_generated', 'restore'], required: true, immutable: true },
    nodes: { type: [Schema.Types.Mixed], required: true, immutable: true } as unknown as SchemaDefinitionProperty<IWorkflowRevisionDocument['nodes']>,
    edges: { type: [Schema.Types.Mixed], required: true, immutable: true } as unknown as SchemaDefinitionProperty<IWorkflowRevisionDocument['edges']>,
    definitionHash: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
      immutable: true,
    },
    generationMetadata: {
      type: new Schema({
        originalPrompt: { type: String, maxlength: 2000, immutable: true },
        generatedAt: { type: Date, immutable: true },
        provider: { type: String, maxlength: 100, immutable: true },
        model: { type: String, maxlength: 100, immutable: true },
        capabilityCoverage: {
          requestedCapabilities: { type: [String], immutable: true },
          implementedCapabilities: { type: [String], immutable: true },
          missingCapabilities: { type: [String], immutable: true },
          unsupportedCapabilities: { type: [String], immutable: true },
          coverage: { type: Number, immutable: true },
          isComplete: { type: Boolean, immutable: true },
        },
      }, { _id: false }),
      default: undefined,
      immutable: true,
    },
    restoredFromRevisionId: { type: Schema.Types.ObjectId, ref: 'WorkflowRevision', immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        const output = ret as unknown as Record<string, unknown>;
        output._id = String(output._id);
        output.workflowId = String(output.workflowId);
        if (output.parentRevisionId) output.parentRevisionId = String(output.parentRevisionId);
        if (output.restoredFromRevisionId) output.restoredFromRevisionId = String(output.restoredFromRevisionId);
        return output;
      },
    },
  },
);

workflowRevisionSchema.index({ workflowId: 1, revision: 1 }, { unique: true });
workflowRevisionSchema.index({ workflowId: 1, createdAt: -1 });
workflowRevisionSchema.index({ userId: 1, workflowId: 1, revision: -1 });

workflowRevisionSchema.pre('save', function preventRevisionResave(next) {
  if (!this.isNew) return next(new Error('Workflow revisions are immutable'));
  next();
});

workflowRevisionSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
  function preventRevisionUpdate() {
    throw new Error('Workflow revisions are immutable');
  },
);

export const WorkflowRevision = mongoose.model<IWorkflowRevisionDocument>(
  'WorkflowRevision',
  workflowRevisionSchema,
);
