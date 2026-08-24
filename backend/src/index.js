const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const filesRouter = require('./routes/files');
const authRouter = require('./routes/auth');

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/file_studio';
mongoose
  .connect(mongoUri)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error', err);
    process.exit(1);
  });

app.use('/api/files', filesRouter);
app.use('/api/auth', authRouter);

app.get('/api/ping', (req, res) => res.json({ ok: true, time: Date.now() }));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server listening on ${port}`));
