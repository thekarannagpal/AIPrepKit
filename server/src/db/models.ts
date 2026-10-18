import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
  },
  { timestamps: true }
);

const sessionSchema = new mongoose.Schema(
  {
    // Stored hashed: a database leak does not leak live sessions.
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Indexed (with TTL) by sessionSchema.index below — declaring it here too
    // would register the same index twice and warn on every boot.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);
// TTL index: Mongo removes expired sessions on its own.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const practiceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kitId: { type: mongoose.Schema.Types.ObjectId, ref: "Kit", required: true, index: true },
    cardId: { type: String, required: true },
    requirementIds: { type: [String], default: [] },
    // Leitner-style box 1..5 — box 1 = least confident.
    box: { type: Number, min: 1, max: 5, default: 1 },
    confidence: { type: Number, min: 1, max: 4, default: 1 },
    dueAt: { type: Date, default: () => new Date() },
    reviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);
practiceSchema.index({ userId: 1, kitId: 1, cardId: 1 }, { unique: true });

const kitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["queued", "running", "complete", "failed"],
      default: "queued",
      index: true,
    },
    // The input, stored so a duplicate submission can be detected.
    input: {
      jd: { type: String, required: true },
      companyUrl: { type: String, default: "" },
      days: { type: Number, required: true },
      fingerprint: { type: String, required: true, index: true },
    },
    // Generation progress for the UI (SSE streams these live).
    steps: [
      {
        key: String,
        label: String,
        status: { type: String, enum: ["pending", "started", "done", "failed"] },
        detail: String,
      },
    ],
    // The kit itself — validated before it ever lands here.
    kit: { type: Object, default: null },
    error: {
      code: { type: String },
      message: { type: String },
    },
    generatedWith: {
      provider: String,
      model: String,
      llmCalls: Number,
    },
    // Bumped on every write; lets the UI detect a stale editor.
    version: { type: Number, default: 1 },
  },
  { timestamps: true }
);
kitSchema.index({ userId: 1, createdAt: -1 });

export const UserModel = mongoose.model("User", userSchema);
export const SessionModel = mongoose.model("Session", sessionSchema);
export const KitModel = mongoose.model("Kit", kitSchema);
export const PracticeModel = mongoose.model("Practice", practiceSchema);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
}
