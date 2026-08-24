# Northstar Compress PDF

A browser-based PDF merger and image compression studio with a React frontend, Express backend, MongoDB storage, and optional Python desktop utility.

## Open the output

The application runs locally in your browser. Start MongoDB first, then open these two terminals.

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

**[Open Northstar Compress PDF](http://localhost:5173/)**

If port `5173` is already being used, Vite may show `http://localhost:5174/` instead. Open the exact URL shown by Vite.

## Database

The backend uses MongoDB at `mongodb://localhost:27017/file_studio` by default. Copy `backend/.env.example` to `backend/.env` to customize the connection.

User accounts are stored in MongoDB. Sign up or log in from the top-right corner of the app.

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

GitHub displays this README as project documentation. The application output opens through the local frontend URL after running the commands above. A public browser link requires deploying the frontend and backend to hosting.

## Tech stack

- React and Vite frontend
- Express and Node.js backend
- MongoDB and Mongoose database
- Python desktop utility
