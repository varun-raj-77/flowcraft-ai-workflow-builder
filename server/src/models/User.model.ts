import mongoose, { type HydratedDocument, Schema } from 'mongoose';

export interface IUser {
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IUserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false, // Never returned in queries unless explicitly requested
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        return {
          ...ret,
          _id: ret._id.toString(),
          passwordHash: undefined,
          __v: undefined,
        };
      },
    },
  },
);

export const User = mongoose.model<IUser>('User', userSchema);
