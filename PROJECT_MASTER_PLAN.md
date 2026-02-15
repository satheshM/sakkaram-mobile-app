# 🚜 SAKKARAM - PROJECT MASTER PLAN

**Last Updated:** February 15, 2026 (Day 4 Complete)

---

## 📋 PROJECT OVERVIEW

**Sakkaram** is an agriculture vehicle booking mobile application that connects farmers with vehicle owners for agricultural services.

**Business Model:** Service-based booking platform (like Ola/Uber for agriculture)
- Farmers book agricultural services
- Vehicle owners provide service with operator
- Platform earns 10% commission (5% from each party)

---

## 👥 USER ROLES

### 1. Farmer (Customer)
- Browse available agricultural services
- Book services based on location
- Track booking status
- Make payments
- Rate and review services

### 2. Vehicle Owner (Service Provider)
- Register vehicles with services offered
- Set pricing (hourly/per-acre/fixed)
- Accept/reject booking requests
- Provide service with operator
- Receive payments via wallet
- Withdraw earnings to bank

### 3. Admin (Platform)
- Manage platform
- Monitor bookings
- Handle disputes
- Earn commission

---

## 🎯 CORE BUSINESS FLOW

```
1. Farmer searches for service (e.g., "Tractor Plowing")
2. App shows nearby vehicles sorted by distance
3. Farmer selects vehicle and creates booking
4. Owner receives notification
5. Owner accepts/rejects booking
6. Owner brings vehicle to farm location
7. Owner starts work (timer begins)
8. Owner completes work (timer stops)
9. Farmer pays total amount
10. Platform auto-deducts commission
11. Owner receives payment in wallet
12. Farmer rates the service
```

---

## 💰 PRICING & COMMISSION MODEL

### Pricing Types (Owner chooses):
1. **Hourly Rate:** ₹500/hour
2. **Per Acre:** ₹1,000/acre
3. **Fixed Price:** ₹3,000 for complete service

### Commission Structure:
```
Example: ₹2,000 service

Farmer Side:
├── Base Amount: ₹2,000
├── Service Fee (5%): ₹100
└── Total Farmer Pays: ₹2,100

Owner Side:
├── Base Amount: ₹2,000
├── Commission (5%): ₹100
└── Total Owner Receives: ₹1,900

Platform Earning:
└── Total: ₹200 (₹100 + ₹100)
```

### Payment Options:
1. **Online:** Via Cashfree gateway (1.75% fee)
2. **Offline:** Cash/direct UPI (owner wallet required)

---

## 💳 WALLET SYSTEM

### Owner Wallet:
- **Initial Deposit:** ₹500 (one-time activation)
- **Minimum Balance:** ₹200 (to accept bookings)
- **Purpose:** Platform commission deduction for offline payments
- **Top-up:** Via UPI or Cashfree gateway
- **Withdrawal:** Anytime to bank account (min ₹100)

### Wallet Rules:
```
Balance ≥ ₹200: Active ✅ (can accept bookings)
Balance < ₹200: Low Balance ⚠️ (warning)
Balance < ₹100: Critical ⚠️⚠️ (1 booking limit)
Balance = ₹0: Inactive 🔴 (must top-up)
```

### Offline Payment Flow:
```
1. Work completed → Farmer pays owner ₹2,000 (cash/UPI)
2. Platform auto-deducts ₹100 from owner wallet
3. Farmer pays ₹100 service fee to platform
4. Both upload payment proof
5. Platform verifies → Booking complete
```

---

## 🛠️ TECHNOLOGY STACK

### Mobile App:
- **Framework:** Expo (React Native)
- **Platform:** iOS & Android (cross-platform)
- **UI Library:** React Native Paper / Native Base
- **Navigation:** React Navigation
- **State Management:** React Context / Redux (if needed)

### Backend:
- **Runtime:** Node.js v20.20.0 (Portable, no admin rights)
- **Framework:** Express.js
- **Database:** PostgreSQL (Railway.app with SSL)
- **Authentication:** JWT tokens (15min access, 7day refresh)
- **OTP Service:** MSG91 (mock mode for dev: 123456)

### Cloud Services:
- **Database Hosting:** Railway.app (PostgreSQL with SSL)
- **Image Storage:** Cloudinary (25GB free)
- **Payment Gateway:** Cashfree (1.75% + ₹3 per transaction)
- **Maps (Optional):** Google Maps API (distance calculation)

### Security:
- Helmet.js (HTTP headers)
- XSS-Clean (sanitization)
- Rate Limiting (100 req/15min)
- CORS enabled
- Password hashing (bcrypt)
- JWT token authentication

---

## 📁 PROJECT STRUCTURE

```
Claude-MobileApp/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js (Database connection)
│   │   │   ├── logger.js (Winston logger)
│   │   │   ├── cloudinary.js (Image storage)
│   │   │   └── schema.sql (Database schema)
│   │   │
│   │   ├── controllers/
│   │   │   ├── authController.js (7 endpoints)
│   │   │   ├── vehicleController.js (8 endpoints)
│   │   │   ├── walletController.js (5 endpoints)
│   │   │   └── bookingController.js (8 endpoints)
│   │   │
│   │   ├── middlewares/
│   │   │   └── authMiddleware.js (JWT verification, role check)
│   │   │
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── vehicleRoutes.js
│   │   │   ├── walletRoutes.js
│   │   │   └── bookingRoutes.js
│   │   │
│   │   ├── services/
│   │   │   ├── smsService.js (MSG91 OTP)
│   │   │   ├── authService.js (Token generation)
│   │   │   ├── imageService.js (Cloudinary upload)
│   │   │   └── locationService.js (Distance calculation)
│   │   │
│   │   ├── app.js (Express setup)
│   │   └── server.js (Server startup)
│   │
│   ├── .env (Environment variables - NOT in git)
│   ├── .env.example (Template for .env)
│   ├── package.json
│   └── README.md
│
├── mobile/ (Expo React Native - To be created)
│   └── (Will be created in Days 11-20)
│
├── node-v20.20.0-win-x64/ (Portable Node.js - NOT in git)
│
├── .gitignore
└── README.md
```

---

## 📅 25-DAY DEVELOPMENT ROADMAP

### ✅ COMPLETED (Days 1-4)

#### **Day 1: Development Environment Setup** ✅
- Portable Node.js v20.20.0 installation (no admin rights)
- Expo CLI setup
- Mobile app tested on physical device (tunnel mode)
- Git repository initialized

#### **Day 2: Backend Authentication System** ✅
- Railway.app PostgreSQL database setup
- 11 database tables created (users, vehicles, bookings, payments, wallets, etc.)
- Phone + OTP authentication (MSG91 integration)
- JWT token system (access + refresh tokens)
- User signup/login APIs
- Session management
- Security: Helmet, XSS-Clean, Rate Limiting
- **Deliverable:** 7 auth endpoints working

#### **Day 3: Vehicle & Wallet Systems** ✅
- Cloudinary integration for image uploads
- Location-based vehicle search (Haversine formula)
- Distance calculation (works without Google Maps billing)
- Vehicle CRUD APIs (8 endpoints)
- Service offerings with flexible pricing
- Wallet system (5 endpoints)
- Commission auto-deduction logic
- **Deliverable:** 28 total APIs working

#### **Day 4: Booking System** ✅
- Complete booking flow (create → accept → start → complete)
- Role-based booking access (farmer/owner)
- Commission calculation on completion
- Booking status management
- Work timer (start/end timestamps)
- **Deliverable:** 8 booking endpoints working

**Progress: 16% (4/25 days) - 28 APIs Working**

---

### 🔄 IN PROGRESS / UPCOMING

#### **Days 5-6: Payment Integration (2 days)**
- Cashfree payment gateway integration
- Payment processing for online bookings
- Payment verification system
- Refund handling
- Payment webhook handling
- Offline payment verification with screenshots
- Update booking payment status
- **Deliverable:** Complete payment system

#### **Days 7-8: Reviews & Ratings (2 days)**
- Rate booking endpoint
- Review submission
- Average rating calculation
- Update vehicle/owner ratings
- Prevent duplicate ratings
- Review moderation
- **Deliverable:** Rating system working

#### **Days 9-10: Notifications & Additional Features (2 days)**
- Basic notification system
- Booking status update notifications
- Email notifications (optional)
- Push notifications setup (Expo)
- Booking statistics endpoint
- Earnings dashboard for owners
- Search filters enhancement
- **Deliverable:** Notification system + dashboards

#### **Days 11-15: Mobile App - Core Screens (5 days)**
- Expo project setup
- Navigation structure
- Authentication screens (OTP login)
- Home screen (role-based)
- Vehicle listing screen
- Vehicle details screen
- Search & filters
- **Deliverable:** Basic navigation + auth working

#### **Days 16-18: Mobile App - Booking Flow (3 days)**
- Create booking screen
- Booking list screen
- Booking details screen
- Accept/reject booking (owner)
- Start/complete work (owner)
- Status tracking UI
- **Deliverable:** Complete booking flow in app

#### **Days 19-20: Mobile App - Additional Features (2 days)**
- Wallet screen
- Top-up wallet
- Transaction history
- Withdraw funds
- Profile screen
- Settings
- Reviews & ratings UI
- **Deliverable:** Complete app features

#### **Days 21-22: Testing & Bug Fixes (2 days)**
- End-to-end testing
- Fix bugs
- API error handling
- Edge case testing
- Performance optimization
- **Deliverable:** Stable app

#### **Days 23-24: Deployment & Polish (2 days)**
- Backend deployment (Railway.app)
- Environment variables setup
- API testing on production
- Mobile app build (APK)
- Test on multiple devices
- **Deliverable:** Deployed backend + APK

#### **Day 25: Play Store Submission**
- App screenshots
- Store listing creation
- Privacy policy
- Terms of service
- Submit to Play Store
- **Deliverable:** App submitted for review

---

## 🗄️ DATABASE SCHEMA SUMMARY

**11 Tables:**
1. **users** - User accounts (farmer/owner/admin)
2. **sessions** - JWT refresh tokens
3. **vehicles** - Vehicle listings with services
4. **bookings** - Service bookings (53 columns)
5. **payments** - Payment transactions
6. **wallets** - Owner wallet balances
7. **wallet_transactions** - Wallet transaction history
8. **earnings** - Owner earnings tracking
9. **reviews** - Booking reviews & ratings
10. **notifications** - User notifications
11. **audit_logs** - System audit trail

---

## 🔐 ENVIRONMENT VARIABLES

```env
# Server
NODE_ENV=development
PORT=5000

# Database
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

# JWT
JWT_SECRET=your-super-secret-jwt-key
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# SMS (MSG91)
MSG91_AUTH_KEY=your-msg91-auth-key
MSG91_SENDER_ID=SAKARM
MSG91_ROUTE=4
USE_MOCK_OTP=true
MOCK_OTP_CODE=123456

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=sakkaram_vehicles

# Google Maps (Optional)
GOOGLE_MAPS_API_KEY=AIzaSyB...
GOOGLE_MAPS_ENABLED=false

# Cashfree (To be added)
CASHFREE_APP_ID=
CASHFREE_SECRET_KEY=
CASHFREE_ENVIRONMENT=sandbox
```

---

## 🚀 SERVICES OFFERED

### Agricultural Services:
1. **Tractor Services**
   - Plowing
   - Tilling
   - Leveling
   - Rotavation
   - Transportation

2. **Harvesting Services**
   - Combine Harvester
   - Paddy Harvester
   - Wheat Harvester

3. **Sowing/Planting**
   - Seed Drill
   - Transplanter

4. **Spraying Services**
   - Pesticide Sprayer
   - Fertilizer Sprayer

5. **Other Equipment**
   - Thresher
   - Cultivator
   - Baler
   - Loader

---

## 📊 SUCCESS METRICS (Post-Launch)

### Technical Metrics:
- ✅ API Response Time: < 500ms
- ✅ 99% Uptime
- ✅ Zero data loss
- ✅ Secure authentication

### Business Metrics:
- **Month 1:** 50-100 bookings
- **Month 3:** 500+ bookings
- **Month 6:** 2,000+ bookings
- **Revenue:** 10% commission per booking

---

## 🎯 MVP SCOPE (Day 25 Launch)

### Included in MVP:
✅ Phone + OTP authentication
✅ Vehicle listing with images
✅ Location-based search
✅ Complete booking flow
✅ Payment processing
✅ Wallet system
✅ Ratings & reviews
✅ Basic notifications

### Phase 2 (Post-Launch):
- Live GPS tracking
- In-app chat
- Multiple languages
- Video inspection
- Insurance integration
- Referral system
- Premium subscriptions
- Analytics dashboard

---

## 👤 DEVELOPER INFORMATION

**Developer:** Solo beginner developer
**Environment:** Windows without admin rights
**Location:** Coimbatore, Tamil Nadu, India
**Timeline:** 25-30 days to Play Store launch
**Development Mode:** Mock OTP (123456) for testing

---

## 📞 KEY CONTACTS

**Testing Accounts:**
- Owner: +919876543211 (Ramesh Kumar)
- Farmer: +919876543212 (Suresh Farmer)
- Mock OTP: 123456 (development mode)

---

## 🔗 IMPORTANT LINKS

- **GitHub:** https://github.com/YOUR_USERNAME/sakkaram-mobile-app
- **Backend:** http://localhost:5000
- **Database:** Railway.app PostgreSQL
- **API Docs:** See API_DOCUMENTATION.md

---

## ⚠️ KNOWN LIMITATIONS (MVP)

1. Google Maps API not fully enabled (using fallback distance calculation)
2. No real-time GPS tracking (Phase 2)
3. No in-app chat (Phase 2)
4. English only (multi-language in Phase 2)
5. Android only initially (iOS later)

---

## 🎓 LESSONS LEARNED

1. ✅ Always check database schema before coding
2. ✅ Mock services for testing (OTP, payments)
3. ✅ Use portable tools when no admin rights
4. ✅ Comprehensive error handling is essential
5. ✅ Document everything as you build
6. ✅ Test APIs thoroughly before moving forward
7. ✅ Git commit frequently

---

**END OF MASTER PLAN**
**Last Updated:** Day 4 Complete (16% Progress)
**Next Step:** Day 5 - Payment Integration
