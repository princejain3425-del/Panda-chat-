# SageChat — 1-on-1 Mobile Chat App PRD

## Overview
SageChat is a calm, iOS-native inspired mobile chat app that lets users have real-time 1-on-1 conversations after signing in with Google. Built with Expo (React Native) + FastAPI + MongoDB.

## Core Features
- **Google Sign-In** via Emergent-managed OAuth (mobile deep-link + web fallback).
- **Chat List**: Inbox of ongoing conversations with peer avatar, last message preview, and relative timestamp. Pull-to-refresh + FAB to start a new chat.
- **1-on-1 Messaging**: Real-time messaging over WebSocket. Sent/received bubbles, timestamps, and empty state.
- **Media Sharing**: Attach photos and videos from device gallery. Media stored as base64 in MongoDB for reliable delivery.
- **User Search**: Find any registered user by name or email to start a chat.
- **Profile**: Shows user info, settings placeholders, sign out.

## Tech Stack
- Frontend: Expo SDK 54, Expo Router, react-native-reanimated, expo-blur, expo-haptics, expo-image-picker, expo-secure-store.
- Backend: FastAPI + Motor (MongoDB async), httpx for OAuth verification.
- Realtime: Native WebSocket at `/api/ws?token=...`.
- Storage: MongoDB collections — `users`, `user_sessions`, `conversations`, `messages`.

## Design
- Personality: iOS-Native Clean — Sage green (`#5B7454`) + warm sand (`#FDFBF7`).
- No blue/purple/indigo. Bubbles: sent = brand sage; received = warm tertiary.
- Glass tab bar (expo-blur), haptics on primary actions.

## API Endpoints
- `POST /api/auth/session` — exchange Emergent session_token for app session
- `GET /api/auth/me` — current user
- `POST /api/auth/logout`
- `GET /api/users/search?q=` — search users
- `GET /api/conversations` — list conversations
- `POST /api/conversations` — get-or-create 1-on-1 conversation
- `GET /api/conversations/{id}/messages`
- `POST /api/conversations/{id}/messages` — send text/image/video
- `WS  /api/ws?token=` — realtime message stream

## Non-Goals (v1)
- Group chats, read receipts, typing indicators, message editing/deletion, e2e encryption, push notifications.
