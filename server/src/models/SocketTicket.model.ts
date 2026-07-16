import mongoose, { type Document, Schema } from 'mongoose';

export interface ISocketTicketDocument extends Document {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

const socketTicketSchema = new Schema<ISocketTicketDocument>({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

export const SocketTicket = mongoose.model<ISocketTicketDocument>('SocketTicket', socketTicketSchema);
