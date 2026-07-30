# Panda Chat — 1-on-1 Mobile Chat App PRD

## Overview
Panda Chat is a warm, playful mobile chat app themed around a **white + panda green** aesthetic with a bamboo-forest illustrative background. Real-time 1-on-1 conversations after signing in with Google. Built with Expo (React Native) + FastAPI + MongoDB.

## Core Features
- **Google Sign-In** via Emergent-managed OAuth.
- **Onboarding — Pick your handle** — after first Google sign-in, user chooses a **display name** and a **unique @username** (3–20 chars, `[a-z0-9_]`, one-per-user, reserved names blocked). Live availability check as they type.
- **Chat List** — pull-to-refresh, unread badges, live typing preview, and a horizontal **"People you may know"** row of recent users. Subtle panda-bamboo watermark background.
- **1-on-1 Messaging** — real-time over WebSocket, sent/received bubbles with timestamps, **read receipts** (✓ / ✓✓ + "Read" label), and **live typing indicator** ("typing…" + animated dots in-thread). Same panda watermark background.
- **Media & File Sharing** — attachment sheet with two options:
  - **Photo or Video** — from device gallery, stored as base64.
  - **Document** — any file (PDF, docs, etc.), rendered as a file card with icon, name, and size.
- **User Search** — by name, display name, email, or `@username` (prefix match).
- **Profile & Settings** — theme selector (System / Light / Dark), sign out.
- **Dark Mode** — full green palette shift; toggled per-user and persisted in local storage.

## Design System
- **White + Panda Green** palette in Light & Dark modes (primary `#3F7E44` light / `#7FBF77` dark).
- Bamboo-panda illustration on auth screen; ultra-light panda-forest watermark on chat/home screens.
- Rounded pill buttons, playful bold headings, soft green shadows.

## Tech Stack
- Frontend: Expo SDK 54, Expo Router, react-native-reanimated, expo-blur, expo-haptics, expo-image-picker, **expo-document-picker**, expo-secure-store.
- Backend: FastAPI + Motor (MongoDB async), httpx for OAuth verification.
- Realtime: Native WebSocket at `/api/ws?token=...` — events: `connected`, `message`, `read`, `typing`, `pong`.

## API Endpoints
- `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/auth/username-available?u=`, `POST /api/auth/complete-profile`
- `GET /api/users/search?q=`, `GET /api/users/discover`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/{id}/messages`, `POST /api/conversations/{id}/messages` — types: text | image | video | **document**
- `POST /api/conversations/{id}/read`
- `WS /api/ws?token=`

## Testing
- Backend: **80/80 pytest cases passing** (iter-1: 21, iter-2: 15, iter-3: 29, iter-4: 15 for document type).

## Multi-user testing
- The Expo Go QR code and web preview URL are public. Multiple people can sign in with different Google accounts and chat with each other in real-time — the shared MongoDB backend handles all sessions.

## Known dev-preview limitations
- OAuth consent screen shows the preview subdomain host (`chat-mobile-app-44.preview.emergentagent.com`) because it's platform-managed. Will use the app's own domain / name once deployed.

## Non-Goals (still deferred)
- Group chats, push notifications, e2e encryption, cloud media storage.
