# 🔍 SAKKARAM PROJECT SNAPSHOT
Generated: 2026-02-16T04:29:34.515Z
Progress: Day 5 Complete (20%)

---

## 📊 DATABASE SCHEMA

Total Tables: 11
Total Records: 41

### Tables Overview:

#### audit_logs
- Columns: 10
- Records: 0
- Indexes: 4

**Columns:**
- `id` (uuid) - NOT NULL
- `user_id` (uuid) 
- `action` (character varying) - NOT NULL
- `entity_type` (character varying) 
- `entity_id` (uuid) 
- `old_values` (jsonb) 
- `new_values` (jsonb) 
- `ip_address` (inet) 
- `user_agent` (text) 
- `created_at` (timestamp without time zone) 

#### bookings
- Columns: 54
- Records: 3
- Indexes: 11

**Columns:**
- `id` (uuid) - NOT NULL
- `booking_number` (character varying) - NOT NULL
- `farmer_id` (uuid) 
- `vehicle_id` (uuid) 
- `owner_id` (uuid) 
- `start_date` (date) 
- `end_date` (date) 
- `start_time` (time without time zone) 
- `end_time` (time without time zone) 
- `duration_hours` (integer) 
- `total_amount` (numeric) 
- `service_location` (jsonb) 
- `service_type` (character varying) 
- `status` (character varying) 
- `payment_status` (character varying) 
- `payment_method` (character varying) 
- `advance_paid` (numeric) 
- `started_at` (timestamp without time zone) 
- `completed_at` (timestamp without time zone) 
- `cancelled_at` (timestamp without time zone) 
- `cancellation_reason` (text) 
- `farmer_notes` (text) 
- `owner_notes` (text) 
- `created_at` (timestamp without time zone) 
- `updated_at` (timestamp without time zone) 
- `service_category` (character varying) 
- `pricing_type` (character varying) 
- `hourly_rate` (numeric) 
- `per_acre_rate` (numeric) 
- `fixed_price` (numeric) 
- `land_size_acres` (numeric) 
- `estimated_hours` (integer) 
- `actual_hours` (numeric) 
- `base_amount` (numeric) 
- `farmer_service_fee` (numeric) 
- `owner_commission` (numeric) 
- `platform_earning` (numeric) 
- `total_farmer_pays` (numeric) 
- `total_owner_receives` (numeric) 
- `farmer_location_lat` (numeric) 
- `farmer_location_lng` (numeric) 
- `farmer_location_address` (text) 
- `distance_km` (numeric) 
- `work_started_at` (timestamp without time zone) 
- `work_completed_at` (timestamp without time zone) 
- `completion_notes` (text) 
- `farmer_service_fee_paid` (boolean) 
- `farmer_payment_screenshot` (text) 
- `owner_commission_deducted` (boolean) 
- `scheduled_date` (date) 
- `scheduled_time` (time without time zone) 
- `cancelled_by` (character varying) 
- `notes` (text) 
- `deleted_at` (timestamp without time zone) 

#### earnings
- Columns: 9
- Records: 0
- Indexes: 4

**Columns:**
- `id` (uuid) - NOT NULL
- `owner_id` (uuid) 
- `booking_id` (uuid) 
- `amount` (numeric) - NOT NULL
- `platform_fee` (numeric) 
- `net_amount` (numeric) - NOT NULL
- `status` (character varying) 
- `settled_at` (timestamp without time zone) 
- `created_at` (timestamp without time zone) 

#### notifications
- Columns: 10
- Records: 0
- Indexes: 4

**Columns:**
- `id` (uuid) - NOT NULL
- `user_id` (uuid) 
- `title` (character varying) - NOT NULL
- `message` (text) - NOT NULL
- `type` (character varying) 
- `is_read` (boolean) 
- `read_at` (timestamp without time zone) 
- `reference_type` (character varying) 
- `reference_id` (uuid) 
- `created_at` (timestamp without time zone) 

#### payments
- Columns: 21
- Records: 4
- Indexes: 8

**Columns:**
- `id` (uuid) - NOT NULL
- `payment_id` (character varying) - NOT NULL
- `booking_id` (uuid) 
- `user_id` (uuid) 
- `amount` (numeric) - NOT NULL
- `currency` (character varying) 
- `payment_method` (character varying) 
- `payment_gateway` (character varying) 
- `razorpay_order_id` (character varying) 
- `razorpay_payment_id` (character varying) 
- `razorpay_signature` (character varying) 
- `status` (character varying) 
- `refund_amount` (numeric) 
- `refund_reason` (text) 
- `refunded_at` (timestamp without time zone) 
- `metadata` (jsonb) 
- `created_at` (timestamp without time zone) 
- `updated_at` (timestamp without time zone) 
- `transaction_id` (character varying) 
- `gateway_response` (jsonb) 
- `description` (text) 

#### reviews
- Columns: 8
- Records: 0
- Indexes: 5

**Columns:**
- `id` (uuid) - NOT NULL
- `booking_id` (uuid) 
- `vehicle_id` (uuid) 
- `farmer_id` (uuid) 
- `owner_id` (uuid) 
- `rating` (integer) - NOT NULL
- `comment` (text) 
- `created_at` (timestamp without time zone) 

#### sessions
- Columns: 8
- Records: 28
- Indexes: 5

**Columns:**
- `id` (uuid) - NOT NULL
- `user_id` (uuid) 
- `refresh_token` (character varying) - NOT NULL
- `device_info` (jsonb) 
- `ip_address` (inet) 
- `user_agent` (text) 
- `expires_at` (timestamp without time zone) - NOT NULL
- `created_at` (timestamp without time zone) 

#### users
- Columns: 22
- Records: 2
- Indexes: 7

**Columns:**
- `id` (uuid) - NOT NULL
- `email` (character varying) 
- `password_hash` (character varying) 
- `phone_number` (character varying) - NOT NULL
- `role` (character varying) - NOT NULL
- `full_name` (character varying) 
- `profile_image_url` (text) 
- `address` (jsonb) 
- `is_verified` (boolean) 
- `is_active` (boolean) 
- `failed_login_attempts` (integer) 
- `account_locked_until` (timestamp without time zone) 
- `last_login_at` (timestamp without time zone) 
- `created_at` (timestamp without time zone) 
- `updated_at` (timestamp without time zone) 
- `deleted_at` (timestamp without time zone) 
- `phone_verified` (boolean) 
- `email_verified` (boolean) 
- `otp_code` (character varying) 
- `otp_expires_at` (timestamp without time zone) 
- `otp_attempts` (integer) 
- `last_otp_sent_at` (timestamp without time zone) 

#### vehicles
- Columns: 27
- Records: 1
- Indexes: 7

**Columns:**
- `id` (uuid) - NOT NULL
- `owner_id` (uuid) 
- `name` (character varying) - NOT NULL
- `type` (character varying) - NOT NULL
- `model` (character varying) 
- `registration_number` (character varying) 
- `specifications` (jsonb) 
- `capacity` (character varying) 
- `hourly_rate` (numeric) 
- `location` (jsonb) 
- `service_radius_km` (integer) 
- `images` (jsonb) 
- `documents` (jsonb) 
- `is_available` (boolean) 
- `availability_schedule` (jsonb) 
- `average_rating` (numeric) 
- `total_bookings` (integer) 
- `total_reviews` (integer) 
- `created_at` (timestamp without time zone) 
- `updated_at` (timestamp without time zone) 
- `deleted_at` (timestamp without time zone) 
- `location_lat` (numeric) 
- `location_lng` (numeric) 
- `location_address` (text) 
- `services_offered` (jsonb) 
- `pricing_type` (character varying) 
- `base_price` (numeric) 

#### wallet_transactions
- Columns: 9
- Records: 1
- Indexes: 7

**Columns:**
- `id` (uuid) - NOT NULL
- `wallet_id` (uuid) 
- `transaction_type` (character varying) - NOT NULL
- `amount` (numeric) - NOT NULL
- `balance_after` (numeric) - NOT NULL
- `reference_type` (character varying) 
- `reference_id` (uuid) 
- `description` (text) 
- `created_at` (timestamp without time zone) 

#### wallets
- Columns: 5
- Records: 2
- Indexes: 3

**Columns:**
- `id` (uuid) - NOT NULL
- `user_id` (uuid) 
- `balance` (numeric) 
- `created_at` (timestamp without time zone) 
- `updated_at` (timestamp without time zone) 

---

## 🔗 API ENDPOINTS

Total Endpoints: 29

### AUTH (4 endpoints)

- **POST** `/api/auth/send-otp`
- **POST** `/api/auth/verify-otp`
- **POST** `/api/auth/refresh-token`
- **POST** `/api/auth/logout`

### VEHICLES (6 endpoints)

- **POST** `/api/vehicles/`
- **GET** `/api/vehicles/`
- **GET** `/api/vehicles/my-vehicles`
- **GET** `/api/vehicles/:id`
- **PUT** `/api/vehicles/:id`
- **DELETE** `/api/vehicles/:id`

### WALLET (5 endpoints)

- **GET** `/api/wallet/balance`
- **POST** `/api/wallet/add-money`
- **POST** `/api/wallet/deduct`
- **GET** `/api/wallet/transactions`
- **POST** `/api/wallet/withdraw`

### BOOKINGS (8 endpoints)

- **POST** `/api/bookings/`
- **GET** `/api/bookings/`
- **GET** `/api/bookings/:id`
- **PUT** `/api/bookings/:id/accept`
- **PUT** `/api/bookings/:id/reject`
- **PUT** `/api/bookings/:id/start`
- **PUT** `/api/bookings/:id/complete`
- **PUT** `/api/bookings/:id/cancel`

### PAYMENTS (6 endpoints)

- **POST** `/api/payments/initiate`
- **GET** `/api/payments/verify/:orderId`
- **POST** `/api/payments/callback`
- **POST** `/api/payments/webhook`
- **POST** `/api/payments/refund`
- **GET** `/api/payments/booking/:bookingId`

---

## 📁 FILE STRUCTURE

Total Files: 53
JavaScript Files: 46
Total Lines of Code: 7598

### Key Directories:

```
backend/
├── src/
│   ├── config/      (15 files)
│   ├── controllers/ (5 files)
│   ├── middlewares/ (1 files)
│   ├── routes/      (5 files)
│   ├── services/    (7 files)
│   ├── app.js
│   └── server.js
├── package.json
└── .env.example
```

---

## ⚙️ ENVIRONMENT

- **Node.js:** v20.20.0
- **Platform:** win32
- **Has .env:** ✅
- **Has .env.example:** ✅

### Dependencies:

- @googlemaps/google-maps-services-js: ^3.4.2
- axios: ^1.13.5
- bcryptjs: ^2.4.3
- cloudinary: ^2.9.0
- cookie-parser: ^1.4.6
- cors: ^2.8.5
- dotenv: ^16.3.1
- express: ^4.18.2
- express-rate-limit: ^7.1.5
- express-validator: ^7.0.1
- helmet: ^7.1.0
- jsonwebtoken: ^9.0.2
- morgan: ^1.10.0
- multer: ^2.0.2
- pg: ^8.11.3
- pg-pool: ^3.6.1
- uuid: ^9.0.1
- winston: ^3.11.0
- xss-clean: ^0.1.4

---

## 📈 PROJECT STATISTICS

| Metric | Count |
|--------|-------|
| Database Tables | 11 |
| Total Records | 41 |
| API Endpoints | 29 |
| Total Files | 53 |
| JavaScript Files | 46 |
| Lines of Code | 7598 |

---

**END OF SNAPSHOT**
