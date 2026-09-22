const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  operation: { type: String, required: true },
  fileName: { type: String, required: true },
  status: { type: String, default: 'Completed', enum: ['Completed', 'Failed'] },
  createdAt: { type: Date, default: Date.now },
});

HistorySchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('History', HistorySchema);