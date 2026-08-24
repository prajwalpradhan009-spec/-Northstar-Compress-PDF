# 🌟 Northstar File Studio

> A modern, full-stack PDF compression and file management application equipped with secure user authentication and Python-powered file processing.

![Node.js](https://img.shields.io/badge/Node.js-v18+-green?style=flat-square&logo=node.js)
![React](https://img.shields.io/badge/React-Vite-blue?style=flat-square&logo=react)
![MongoDB](https://img.shields.io/badge/MongoDB-Local%2FAtlas-brightgreen?style=flat-square&logo=mongodb)
![Python](https://img.shields.io/badge/Python-3.x-yellow?style=flat-square&logo=python)

---

## ✨ Key Features

- 🔐 **Secure User Authentication:** Account creation and login modals integrated directly with a MongoDB backend.
- 📄 **PDF Compression Engine:** High-efficiency PDF file size reduction driven by custom Python processing scripts (`pdf_logic.py`).
- 🎨 **Modern UI/UX:** Clean, sleek user interface featuring interactive modal flows and responsive layouts built with React + Vite.
- ⚡ **RESTful API Architecture:** Fast Node.js & Express server handling user sessions and file workflows.

---

## 🛠️ Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | React.js (Vite), JavaScript (ES6+), HTML5, CSS3 |
| **Backend** | Node.js, Express.js |
| **Database** | MongoDB, Mongoose |
| **File Engine** | Python (`pdf_logic.py`, `requirements.txt`) |

---

## 📁 Repository Structure

```text
├── backend/            # Express REST API & MongoDB models
│   ├── src/            # Database config, auth controllers, routes
│   └── package.json
├── frontend/           # React single-page client app
│   ├── src/            # Components, modals, UI styles
│   └── package.json
├── main_ui.py          # Standalone desktop interface utility
├── pdf_logic.py        # Core PDF compression logic
├── requirements.txt    # Python library dependencies
└── .gitignore
