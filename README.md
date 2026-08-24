# 🚀 Northstar | File Studio - PDF Compressor

Northstar File Studio is a full-stack web application designed for PDF manipulation and compression. Built with a React (Vite) dynamic frontend, a Node.js/Express REST backend, MongoDB storage, and Python scripts for PDF processing.

---

## 🛠️ Tech Stack

- **Frontend:** React (Vite), HTML5, CSS3, JavaScript
- **Backend:** Node.js, Express.js
- **Database:** MongoDB
- **PDF Engine:** Python (`pdf_logic.py`)

---

## 📁 Project Structure

```text
├── backend/            # Express API & Database Connection
│   ├── src/            # Backend logic & routes
│   ├── .env.example    # Environment variable template
│   └── package.json
├── frontend/           # React + Vite Client Application
│   ├── src/            # UI components and styles
│   └── package.json
├── main_ui.py          # Desktop UI runner (if applicable)
├── pdf_logic.py        # Core Python PDF compression logic
├── requirements.txt    # Python dependencies
└── .gitignore
