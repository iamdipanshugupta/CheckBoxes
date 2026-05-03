# ☑️ 1 Million Checkboxes

A real-time collaborative checkbox web application where multiple users can toggle checkboxes and see each other's changes **instantly** — powered by WebSockets, Redis Pub/Sub, and Google OAuth (OIDC).

---

## 🌐 Live Demo

> [Add your deployed link here]

## 🎥 Demo Video

> [Add your YouTube unlisted video link here]

---

## 📌 Project Overview

This project is inspired by the "1 Million Checkboxes" concept. Users can log in with their Google account and toggle checkboxes in a shared grid. All changes are broadcast in real-time to every connected user using **Socket.IO** and **Redis Pub/Sub**.

Key highlights:
- Real-time sync across multiple browser windows/users
- Google OAuth 2.0 (OIDC) based authentication
- Anonymous users get read-only access
- Custom rate limiting built from scratch using Redis
- Checkbox state persisted in Redis

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Node.js, Express.js |
| Real-time | Socket.IO (WebSockets) |
| Database / State | Redis (ioredis) |
| Broadcasting | Redis Pub/Sub |
| Authentication | Google OAuth 2.0 / OIDC via Passport.js |
| Session | express-session + JWT |

---

## ✅ Features Implemented

- ☑️ Checkbox grid — rendered and usable
- 🔁 Real-time updates via WebSocket (Socket.IO)
- 💾 Checkbox state stored and retrieved from Redis
- 📡 Redis Pub/Sub for broadcasting across server instances
- 🔐 Google OAuth 2.0 / OIDC login flow
- 👤 Logged-in users can toggle checkboxes
- 🚫 Anonymous users are restricted (read-only)
- ⏱️ Custom rate limiting — no external packages used
- 🔄 State restored correctly on page refresh
- 🔌 Socket connect/disconnect handling
- 🧹 Clean project structure with separated concerns

---

## 📁 Project Structure

```
CheckBoxes/
├── index.js              # Main Express + Socket.IO server
├── redis-connection.js   # Redis client setup (3 connections)
├── public/
│   └── index.html        # Frontend — grid, auth UI, socket client
├── docker-compose.yml    # Redis via Docker
├── package.json
├── .env.example          # Environment variable template
└── README.md
```

---

## ⚙️ How to Run Locally

### 1. Clone the repository

```bash
git clone https://github.com/your-username/checkboxes.git
cd checkboxes
```

### 2. Install dependencies

```bash
npm install
```

### 3. Setup environment variables

```bash
cp .env.example .env
```

Fill in your values in `.env` (see Environment Variables section below).

### 4. Start Redis

Using Docker (recommended):

```bash
docker-compose up -d
```

Or if Redis is installed locally:

```bash
redis-server
```

### 5. Start the server

```bash
node index.js
```

### 6. Open in browser

```
http://localhost:8000
```

---

## 🔑 Environment Variables

Create a `.env` file in the root directory:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
SESSION_SECRET=any_random_string_for_sessions
JWT_SECRET=another_random_string_for_jwt
PORT=8000
```

### How to get Google OAuth credentials:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project
3. Go to **APIs & Services → Credentials**
4. Click **Create Credentials → OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized JavaScript origins: `http://localhost:8000`
7. Authorized redirect URIs: `http://localhost:8000/auth/google/callback`
8. Copy the **Client ID** and **Client Secret** into your `.env`

---

## 🔴 Redis Setup

This project uses **3 separate Redis connections**:

| Connection | Purpose |
|---|---|
| `redis` | Read/write checkbox state |
| `publisher` | Publish checkbox change events |
| `subscriber` | Subscribe to checkbox change events |

Three connections are needed because in `ioredis`, a connection in subscriber mode **cannot** send regular commands — so separate clients are required.

**Redis key used:**

```
checkboxes        → Stores the full array of checkbox states (JSON)
rate-limiting:<socketId> → Stores timestamp of last toggle per user
```

**Start Redis with Docker:**

```bash
docker-compose up -d
```

`docker-compose.yml`:

```yaml
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

---

## 🔐 Auth Flow Explanation (OIDC / OAuth 2.0)

```
User clicks "Login with Google"
        ↓
Browser redirects to → /auth/google
        ↓
Google shows consent screen (OIDC flow)
        ↓
Google redirects back to → /auth/google/callback
        ↓
Server receives authorization code → exchanges for user profile
        ↓
Server creates a JWT token with user info (id, name, email)
        ↓
User redirected to / with token in URL → saved to localStorage
        ↓
Socket.IO connection sends token in handshake auth
        ↓
Server verifies JWT on every socket connection
        ↓
Verified user → can toggle checkboxes ✅
Anonymous user → read-only, toggle blocked ❌
```

**Key files involved:**
- `passport.use(new GoogleStrategy(...))` — OIDC strategy
- `/auth/google` — initiates OAuth flow
- `/auth/google/callback` — handles redirect, creates JWT
- `io.use((socket, next) => {...})` — socket auth middleware

---

## 🔌 WebSocket Flow Explanation

```
Client connects → Socket.IO handshake (with JWT token)
        ↓
Server middleware verifies token → attaches userId to socket
        ↓
Client toggles a checkbox → emits 'client:checkbox:change' { index, checked }
        ↓
Server receives event:
  1. Checks if user is authenticated
  2. Checks rate limit (Redis)
  3. Updates checkbox state in Redis
  4. Publishes to Redis channel 'internal-server:checkbox:change'
        ↓
Redis Pub/Sub subscriber receives the message
        ↓
Server broadcasts 'server:checkbox:change' to ALL connected clients via io.emit()
        ↓
Every browser updates that checkbox in real-time ✅
```

**Socket events:**

| Event | Direction | Description |
|---|---|---|
| `client:checkbox:change` | Client → Server | User toggled a checkbox |
| `server:checkbox:change` | Server → Client | Broadcast update to all |
| `server:error` | Server → Client | Rate limit or auth error |

---

## ⏱️ Rate Limiting Logic Explanation

Rate limiting is implemented **manually using Redis** — no external packages like `express-rate-limit` are used.

**How it works:**

```
User toggles a checkbox
        ↓
Server checks Redis key: rate-limiting:<userId>
        ↓
Key exists?
  YES → Calculate time elapsed since last toggle
        If elapsed < 5500ms → Reject with error message
        If elapsed >= 5500ms → Allow and update timestamp
  NO  → Allow and set timestamp in Redis (with 10s expiry)
```

**Code logic:**

```js
const rateLimitKey = `rate-limiting:${socket.userId}`;
const lastOperationTime = await redis.get(rateLimitKey);

if (lastOperationTime) {
    const timeLapsed = Date.now() - lastOperationTime;
    if (timeLapsed < 5500) {
        socket.emit('server:error', { error: `Please wait ${waitSec}s` });
        return;
    }
}

await redis.set(rateLimitKey, Date.now(), 'EX', 10);
```

**Why Redis for rate limiting?**
- Works across multiple server instances
- Keys auto-expire (no memory leak)
- Atomic operations prevent race conditions

---

## 🧠 System Design Decisions

**Q: How is checkbox state stored?**
State is stored as a JSON array in a single Redis key (`checkboxes`). Each index maps to a boolean value. On first load, the array is initialized with `false` values.

**Q: Why Redis Pub/Sub?**
If multiple backend server instances are running, a toggle on Server A needs to reach clients connected to Server B. Redis Pub/Sub acts as the message broker between all server instances.

**Q: What happens on page refresh?**
On load, the frontend calls `GET /checkboxes` which fetches the current state from Redis and re-renders all checkboxes with correct values.

**Q: How are anonymous users handled?**
Socket.IO middleware checks for a valid JWT token in the handshake. If no token or invalid token → `socket.isAnonymous = true`. Toggle events from anonymous sockets are rejected server-side.

---

## 📸 Screenshots

> [Add screenshots here]
![alt text](<Screenshot 2026-05-03 123631.png>)

---

## 👨‍💻 Author

**Dipanshu Gupta**
Web Dev Cohort 2026