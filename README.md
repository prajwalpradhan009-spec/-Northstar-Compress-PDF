# Northstar Compress PDF

A browser-based PDF merger and image compression studio with a React frontend, Express backend, MongoDB storage, and optional Python desktop utility.

## Run locally

Start MongoDB first, then open two terminals.

### 1. Start the backend

```powershell
cd backend
npm install
npm start
```

The backend runs at `http://localhost:4000`.

### 2. Start the frontend

```powershell
cd frontend
npm install
npm run dev
```

Vite prints the browser address in the terminal. Open the displayed link, usually:
`http://localhost:5173`

If port `5173` is already being used, Vite may show `http://localhost:5174/` instead. Open the exact URL shown by Vite.

## Environment variables

For local development, copy `backend/.env.example` to `backend/.env` and set the values:

```env
MONGODB_URI=mongodb://localhost:27017/file_studio
JWT_SECRET=replace-with-a-long-random-secret
PORT=4000
```

The `backend/.env` file is ignored by Git. Never commit database passwords or JWT secrets.

## Deploy with Render and MongoDB Atlas

The repository includes the frontend production files in `backend/public`, so one Render web service can serve the website and API.

Create a Render Web Service connected to this repository with:

- **Root Directory:** leave blank
- **Build Command:** `npm run build`
- **Start Command:** `npm start`

Add these Render environment variables:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/DATABASE_NAME
JWT_SECRET=your-long-random-secret
```

Do not include `MONGODB_URI=` inside the value field. In MongoDB Atlas, add the Render connection to the project's Network Access list. For initial testing, `0.0.0.0/0` allows connections from Render, but a restricted network policy is preferred when possible.

After deployment, the Render logs should contain `Connected to MongoDB`. The live application is then available at the Render service URL.

## Database and authentication

User accounts are stored in MongoDB Atlas in the `users` collection. Passwords are hashed with bcrypt. Sign up or log in from the top-right corner of the app. Sessions use JWT tokens and are checked against the database when the site is reopened.

## Features

- Merge PDF files in the browser
- Export PDF pages as JPG or PNG
- Compress and convert images
- Sign up and log in with MongoDB-backed accounts
- Light and dark themes with animated interactions

## Python desktop utility

```powershell
python main_ui.py
```

## Tech stack

- React and Vite frontend
- Express and Node.js backend
- MongoDB and Mongoose database
- Python desktop utility
