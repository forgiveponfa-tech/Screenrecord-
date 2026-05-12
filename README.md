# ScreenWatch — Railway Deployment Guide

Remote screen monitoring with live streaming and cloud recording.

## Routes

| Route | Device | Purpose |
|-------|--------|---------|
| `/cast` | Child's phone | Share screen (open once, tap Start) |
| `/view` | Your phone | Watch live + replay recordings (auto-connects after first setup) |
| `/dashboard` | Any | All sessions and recordings |

---

## Deploy to Railway (Step by Step)

### 1. Upload to GitHub

1. Create a new GitHub repository (can be private)
2. Upload all these files to the repo root

### 2. Create Railway project

1. Go to [railway.app](https://railway.app) and sign in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your repository

### 3. Add PostgreSQL database

1. In your Railway project, click **+ New**
2. Select **Database** → **Add PostgreSQL**
3. Railway automatically sets `DATABASE_URL` in your environment

### 4. Set environment variables

In your Railway service settings → **Variables**, add:

```
SESSION_SECRET=some-random-string-change-this
```

`PORT` and `DATABASE_URL` are set automatically by Railway.

### 5. Deploy

Railway will automatically:
- Run `npm install`
- Run `npm run build` (builds React + Express)
- Run `npm start`

Your app will be live at a `.railway.app` URL.

---

## First-Time Setup (after deploying)

### On the device being monitored (child's phone):

1. Open your Railway URL + `/cast` (e.g. `https://yourapp.railway.app/cast`)
2. Tap **START BROADCASTING**
3. Approve the screen share prompt
4. Note the **6-character code** shown

### On your phone (viewer):

1. Open your Railway URL + `/view`
2. Enter the 6-character code once
3. The code is saved — from now on just open `/view` and it auto-connects

---

## How recordings work

- Screen is captured every **10 seconds** as a video clip
- Clips are saved to your PostgreSQL database
- View and replay any clip from `/view` or `/dashboard`
- Old clips can be deleted from `/dashboard`

---

## Important notes

**Browser screen permission**: The casting device will see a system prompt asking to allow screen sharing. This is required by all browsers (Chrome, Safari, Firefox) and cannot be removed. The child's phone browser will also show a small "Screen is being recorded" indicator.

**For better parental monitoring**: Consider using built-in OS tools alongside this app:
- Android: Google Family Link (free, invisible, OS-level)
- iOS: Apple Screen Time (free, invisible, OS-level)

**Same WiFi**: WebRTC works best on the same WiFi network. Across mobile data, the STUN servers handle routing automatically.

**Offline**: The app requires internet to connect to your Railway server for initial WebSocket signaling. Once connected, video streams peer-to-peer.

---

## Local development

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your DATABASE_URL

# Run database migrations
npm run db:push

# Start dev server (runs both client and server)
npm run dev
```

Client: http://localhost:5173  
Server: http://localhost:3000
