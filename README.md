# Northstar Compress PDF

A browser-based PDF merger and image compression studio. Built with a React frontend, Express + MongoDB backend with JWT authentication, and an optional Python desktop utility.

## Features

- Merge multiple PDF files in the browser
- Export PDF pages as JPG or PNG
- Compress and convert images
- Sign up / log in with MongoDB-backed accounts (bcrypt hashed passwords, JWT sessions)
- Forgot-password reset flow with one-time codes
- Light and dark themes with animated interactions
- Responsive and mobile-friendly UI
- Optional Python desktop utility for offline use

## Tech stack

- **Frontend:** React 19, Vite, pdf-lib, pdfjs-dist, Tesseract.js, Framer Motion, lucide-react
- **Backend:** Node.js, Express, Mongoose, JWT, bcryptjs, Multer, MongoDB
- **Desktop utility:** Python (CustomTkinter, PyPDF2, Pillow)

## Project structure

```
.
├── frontend/        # React + Vite web app
├── backend/         # Express + MongoDB API server
│   └── public/      # Built frontend assets (served by the backend)
├── main_ui.py       # Python desktop utility
├── pdf_logic.py     # Python PDF processing logic
└── requirements.txt # Python dependencies
```

## Run locally

Start MongoDB first, then run the backend and frontend in two terminals.

### 1. Backend

```shell
cd backend
npm install
npm start
```

The backend runs at `http://localhost:4000`.

### 2. Frontend

```shell
cd frontend
npm install
npm run dev
```

Vite prints the browser address in the terminal, usually `http://localhost:5173`. If that port is taken, Vite will show the next available one (e.g. `http://localhost:5174`) — open the exact URL shown.

## Environment variables

Copy `backend/.env.example` to `backend/.env` and set the values:

```env
MONGODB_URI=mongodb://localhost:27017/file_studio
JWT_SECRET=replace-with-a-long-random-secret
PORT=4000
```

`backend/.env` is Git-ignored. Never commit database credentials or JWT secrets.

## Deploy on Render with MongoDB Atlas

The repository includes production frontend files in `backend/public`, so a single Render Web Service serves both the website and the API.

Create a Render Web Service connected to this repository with:

- **Root Directory:** leave blank
- **Build Command:** `npm run build`
- **Start Command:** `npm start`

Add these Render environment variables:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/DATABASE_NAME
JWT_SECRET=your-long-random-secret
```

Do not include `MONGODB_URI=` inside the value field. In MongoDB Atlas, add the Render service to the project's Network Access list. For quick testing, `0.0.0.0/0` allows connections from Render, but a restricted network policy is preferred.

After deploying, the Render logs should contain `Connected to MongoDB`, and the app is live at the Render service URL.

## Database and authentication

User accounts are stored in the `users` collection in MongoDB. Passwords are hashed with bcrypt. Sign up or log in from the top-right corner of the app. Sessions use JWT tokens and are re-validated against the database when the site is reopened.

## Python desktop utility

```shell
pip install -r requirements.txt
python main_ui.py
```

## License

Private project. All rights reserved.