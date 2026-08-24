const mongoose = require('mongoose');
const { Schema } = mongoose;

const FileSchema = new Schema({
  originalName: { type: String, required: true },
  mimeType: String,
  size: Number,
  path: String,
  metadata: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('File', FileSchema);
