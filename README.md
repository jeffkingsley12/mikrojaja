# Airtel Money → WiFi Voucher System

Production-grade pipeline that converts Airtel Money SMS payments into
MikroTik hotspot vouchers — fully automated, no manual intervention required.

```
Customer pays (*185#)
        ↓
Airtel sends SMS to gateway SIM
        ↓
Android SMS Receiver (parses + enqueues)
        ↓
WorkManager (delivers with retry + backoff)
        ↓
Backend API (validates, deduplicates, generates voucher)
        ↓
MikroTik RouterOS (provisions hotspot user)
        ↓
Africa's Talking (sends voucher SMS to customer)
```

---

## Project Structure

```
airtel-voucher/
├── backend/                    # Node.js/Express API server
│   ├── config/index.js         # All config in one place (env-driven)
│   ├── db/database.js          # SQLite via better-sqlite3 (WAL mode)
│   ├── middleware/
│   │   ├── auth.js             # HMAC device auth + admin Bearer auth
│   │   └── validate.js         # Joi input validation
│   ├── routes/
│   │   ├── payment.js          # POST /api/payment/airtel (core endpoint)
│   │   ├── admin.js            # GET /admin/stats, POST /admin/voucher
│   │   └── health.js           # GET /health
│   ├── services/
│   │   ├── voucher.js          # MikroTik user provisioning
│   │   └── sms.js              # Africa's Talking SMS delivery
│   ├── utils/
│   │   ├── crypto.js           # HMAC, SHA-256, timing-safe compare
│   │   └── logger.js           # Pino structured logging
│   ├── .env.example
│   ├── package.json
│   ├── server.js               # Express app + graceful shutdown
│   └── setup.sh                # First-time setup script
│
└── android/                    # Android SMS gateway app (Java)
    ├── config/AppConfig.java   # Centralized constants (from BuildConfig)
    ├── db/
    │   ├── AppDatabase.java    # Room singleton
    │   └── PendingPaymentDao.java
    ├── model/
    │   ├── ParsedSms.java      # Immutable parse result
    │   └── PendingPayment.java # Room entity (offline queue)
    ├── network/ApiService.java # OkHttp client with HMAC signing
    ├── parser/SmsParser.java   # Multi-pattern SMS parser (static patterns)
    ├── receiver/SmsReceiver.java # BroadcastReceiver (10s budget, no network)
    ├── util/HmacUtil.java      # HMAC-SHA256 signing
    ├── worker/PaymentWorker.java # WorkManager job (retry, persistence)
    ├── AndroidManifest.xml
    ├── build.gradle
    ├── proguard-rules.pro
    └── network_security_config.xml
```

---

## Backend Setup

### Requirements
- Node.js 18+
- MikroTik router accessible on local network
- Africa's Talking account (for SMS delivery)

### Installation

```bash
cd backend
bash setup.sh          # installs deps, generates .env with random secrets
```

Edit `.env` and fill in:

```env
MIKROTIK_HOST=192.168.88.1
MIKROTIK_USER=admin
MIKROTIK_PASS=your_router_password

AT_API_KEY=your_africas_talking_key
AT_USERNAME=your_at_username
```

### Run

```bash
npm start              # production
npm run dev            # development (auto-reload)
```

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/payment/airtel` | HMAC | Receive parsed SMS from Android |
| `GET` | `/health` | none | Health check |
| `GET` | `/admin/stats` | Bearer | Revenue summary |
| `GET` | `/admin/payments` | Bearer | Payment history |
| `POST` | `/admin/voucher` | Bearer | Manually issue voucher |

### Pricing (edit `config/index.js`)

```js
pricingMap: {
  500:  60,      // UGX 500  → 1 hour
  1000: 180,     // UGX 1000 → 3 hours
  2000: 1440,    // UGX 2000 → 24 hours
  5000: 4320,    // UGX 5000 → 3 days
  10000: 10080,  // UGX 10k  → 7 days
}
```

---

## Android Setup

### Requirements
- Android Studio
- Cheap Android phone (min Android 5.0) with Airtel SIM
- Always plugged in + WiFi/data connected

### Configuration

In `local.properties` (never commit to git):
```properties
API_BASE_URL=https://your-server.com
API_SECRET=<copy from backend .env>
```

The `build.gradle` injects these into `BuildConfig` at compile time.

### Build

```bash
./gradlew assembleRelease
```

Install APK on the gateway phone. Grant SMS permissions when prompted.

---

## Security Model

| Threat | Mitigation |
|--------|-----------|
| Fake payment injection | HMAC-SHA256 request signing with shared secret |
| Replay attacks | 5-minute timestamp window on every request |
| Double voucher issuance | DB-level `UNIQUE` constraint on `dedup_key` |
| Oversized request body | Express 16kb body limit |
| API flooding | express-rate-limit (30 req/min per IP) |
| HTTP interception | HTTPS enforced via network_security_config |
| Cleartext secrets | BuildConfig injection from local.properties |
| Admin endpoint abuse | Bearer token authentication |

---

## MikroTik Router Setup

1. Create a hotspot server named `hotspot1` (or configure `MIKROTIK_HOTSPOT_SERVER`)
2. Ensure API port 8728 is open to the backend server IP
3. Create a dedicated API user with only `api` and `hotspot` permissions:

```routeros
/user add name=voucherapi group=api password=strongpassword
```

---

## Production Deployment

### With PM2 (recommended)

```bash
npm install -g pm2
pm2 start server.js --name voucher-api
pm2 startup
pm2 save
```

### With systemd

```ini
[Unit]
Description=Airtel Voucher API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/airtel-voucher/backend
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
EnvironmentFile=/opt/airtel-voucher/backend/.env

[Install]
WantedBy=multi-user.target
```

### Reverse proxy (Nginx/Caddy)

Put the server behind Nginx or Caddy for HTTPS termination.
The backend should only listen on `127.0.0.1:3000`, not public internet.

---

## Monitoring

```bash
# Live logs (PM2)
pm2 logs voucher-api

# Admin stats
curl -H "Authorization: Bearer $ADMIN_TOKEN" https://your-server.com/admin/stats

# Health check
curl https://your-server.com/health
```

---

## Known Limitations

- Single Android gateway device = single point of failure for SMS ingestion.
  Run a second device with a different SIM for redundancy.
- MikroTik provisioning failure does not block voucher delivery — the voucher
  is stored in DB and can be manually pushed to MikroTik via admin endpoint.
- Africa's Talking sandbox does not deliver real SMS — switch `AT_USERNAME`
  to your production username before going live.
