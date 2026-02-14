# 🚜 Sakkaram - Agriculture Vehicle Booking App

A mobile application for farmers to book agricultural vehicles (tractors, harvesters, etc.) from vehicle owners.

## 📱 Tech Stack

### Mobile App (Frontend)
- React Native (Expo)
- Redux Toolkit (State Management)
- React Navigation
- Axios (API calls)

### Backend (API)
- Node.js + Express.js
- PostgreSQL (Railway.app)
- JWT Authentication
- Phone + OTP Login

## 🚀 Features

### Completed (Day 1-2)
- ✅ Phone + OTP Authentication
- ✅ User Signup/Login
- ✅ JWT Token System
- ✅ Database Schema (11 tables)
- ✅ Session Management

### Coming Soon
- 🔄 Vehicle Management
- 🔄 Booking System
- 🔄 Payment Integration (Razorpay)
- 🔄 Wallet System
- 🔄 Real-time Chat
- 🔄 Push Notifications

## 📂 Project Structure
```
Claude-MobileApp/
├── backend/                 # Backend API (Node.js + Express)
│   ├── src/
│   │   ├── config/         # Database, Logger configs
│   │   ├── controllers/    # API Controllers
│   │   ├── middlewares/    # Auth, Validation middlewares
│   │   ├── routes/         # API Routes
│   │   ├── services/       # Business Logic
│   │   ├── app.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
│
├── react/                   # Mobile App (React Native Expo)
│   └── TestApp/            # Test Expo app
│
└── node-v20.20.0-win-x64/  # Portable Node.js (not pushed to git)
```

## 🛠️ Setup Instructions

### Backend Setup

1. Navigate to backend folder:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
cp .env.example .env
# Edit .env with your credentials
```

4. Run migrations:
```bash
node src/config/runMigration.js
node src/config/runUpdate.js
```

5. Start server:
```bash
npm start
```

Server will run on: `http://localhost:5000`

### Mobile App Setup

1. Navigate to react folder:
```bash
cd react/TestApp
```

2. Install dependencies:
```bash
npm install
```

3. Start Expo:
```bash
npx expo start --tunnel
```

4. Scan QR code with Expo Go app on your phone

## 🔐 Environment Variables

Create `.env` file in backend folder:
```env
NODE_ENV=development
PORT=5000

DATABASE_URL=your_postgresql_url
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret

USE_MOCK_OTP=true
MOCK_OTP_CODE=123456

SMS_PROVIDER=msg91
MSG91_AUTH_KEY=your_msg91_key
```

## 📡 API Endpoints

### Authentication
- `POST /api/auth/send-otp` - Send OTP to phone
- `POST /api/auth/verify-otp` - Verify OTP & Login/Signup
- `POST /api/auth/refresh-token` - Refresh access token
- `POST /api/auth/logout` - Logout user

### Coming Soon
- Vehicle Management APIs
- Booking APIs
- Payment APIs
- Wallet APIs

## 👨‍💻 Development Status

**Current Progress:** Day 2 Complete (8% done)

- [x] Day 1: Setup & Environment
- [x] Day 2: Backend Authentication
- [ ] Day 3: Vehicle APIs
- [ ] Day 4-10: More Backend APIs
- [ ] Day 11-20: Mobile App Development
- [ ] Day 21-22: Testing
- [ ] Day 23-25: Deployment

## 📝 License

This project is for learning purposes.

## 🤝 Contributing

This is a personal learning project.

---

**Built with ❤️ for Indian Farmers**