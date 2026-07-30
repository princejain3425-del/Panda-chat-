# Omega Chat — 1-on-1 Mobile Chat App PRD

## Overview
Omega Chat (formerly SageChat) is a modern, playful mobile chat app with a **white + pink** aesthetic. Real-time 1-on-1 conversations after signing in with Google. Built with Expo (React Native) + FastAPI + MongoDB.

## Core Features
- **Google Sign-In** via Emergent-managed OAuth.
- **Onboarding — Pick your handle** — after first Google sign-in, user chooses a **display name** and a **unique @username** (3–20 chars, `[a-z0-9_]`, one-per-user, reserved names blocked). Live availability check as they type.
- **Chat List** — pull-to-refresh, unread badges, live typing preview, and a horizontal **"People you may know"** row of recent users.
- **1-on-1 Messaging** — real-time over WebSocket, sent/received bubbles with timestamps, **read receipts** (✓ / ✓✓ + "Read" label), and **live typing indicator** ("typing…" + animated dots in-thread).
- **Media Sharing** — photos & videos from gallery stored as base64.
- **User Search** — by name, display name, email, or `@username` (prefix match).
- **Profile & Settings** — theme selector (System / Light / Dark), sign out.
- **Dark Mode** — full palette with pink accents; toggled per-user and persisted in local storage.

## Tech Stack
- Frontend: Expo SDK 54, Expo Router, react-native-reanimated, expo-blur, expo-haptics, expo-image-picker, expo-secure-store.
- Backend: FastAPI + Motor (MongoDB async), httpx for OAuth verification.
- Realtime: Native WebSocket at `/api/ws?token=...` — events: `connected`, `message`, `read`, `typing`, `pong`.

## Design System
- White + Pink accent palette in Light & Dark modes.
- Rounded pill buttons, playful headings, soft shadows in brand color.
- Bubbles: sent = pink brand; received = light pink tertiary; dark mode inverts.

## API Endpoints
- `POST /api/auth/session`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/auth/username-available?u=`, `POST /api/auth/complete-profile`
- `GET /api/users/search?q=`, `GET /api/users/discover`
- `GET /api/conversations`, `POST /api/conversations`
- `GET /api/conversations/{id}/messages`, `POST /api/conversations/{id}/messages`
- `POST /api/conversations/{id}/read` — mark as read + broadcast
- `WS  /api/ws?token=` — realtime (message | read | typing)

## Testing
- Backend: **36/36 pytest cases passing** (iter-1: 21, iter-2: +15 covering unread count, mark-read, discover, WS read/typing broadcasts).

## Non-Goals (still deferred)
- Group chats, push notifications, e2e encryption, Cloudinary/S3 media storage.
