const mongoose = require('mongoose');
const { Schema } = mongoose;

const FileSchema = new Schema({
  originalName: { type: String, required: true },
  mimeType: String,
  size: Number,
  path: String,
  metadata: Schema.Types.Mixed,
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  operation: String,
  status: { type: String, default: 'Completed' },
  createdAt: { type: Date, default: Date.now }
});

FileSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('File', FileSchema);
