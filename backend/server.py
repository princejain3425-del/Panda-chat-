from fastapi import FastAPI, APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Literal, Dict, Set, Any
from datetime import datetime, timezone, timedelta
import httpx
import asyncio

ROOT_DIR = Path(__file__).parent
load_dotenv(str(ROOT_DIR / ".env"))

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME")
if not MONGO_URL or not DB_NAME:
    raise RuntimeError("MONGO_URL and DB_NAME must be set in environment or in a .env file")

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ---------- Utility ----------

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def make_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _serialize_for_ws(obj: Any) -> Any:
    """Recursively convert datetimes to ISO strings so websocket payloads are JSON-safe."""
    if obj is None:
        return None
    if isinstance(obj, datetime):
        return obj.astimezone(timezone.utc).isoformat()
    if isinstance(obj, dict):
        return {k: _serialize_for_ws(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_for_ws(v) for v in obj]
    return obj


USERNAME_RE = __import__("re").compile(r"^[a-z0-9_]{3,20}$")
RESERVED_USERNAMES = {
    "admin", "administrator", "root", "system", "support", "help",
    "omega", "omegachat", "me", "you", "user", "users", "api", "auth",
    "search", "chat", "chats", "new", "official", "team",
}


def validate_username(u: str) -> str:
    u = (u or "").strip().lower()
    if not USERNAME_RE.match(u):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–20 chars, lowercase letters, numbers or underscore.",
        )
    if u in RESERVED_USERNAMES:
        raise HTTPException(status_code=400, detail="This username is reserved.")
    return u


def validate_display_name(n: str) -> str:
    n = (n or "").strip()
    if not (1 <= len(n) <= 40):
        raise HTTPException(status_code=400, detail="Display name must be 1–40 characters.")
    return n


# ---------- Models ----------


def _coerce_utc(v):
    """Naive datetimes coming from MongoDB are treated as UTC (that's how we stored them)."""
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=timezone.utc)
    return v


class User(BaseModel):
    user_id: str
    email: str
    name: str
    display_name: Optional[str] = None
    username: Optional[str] = None
    picture: Optional[str] = None
    created_at: datetime
    push_tokens: Optional[List[str]] = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _fix_created_at(cls, v):
        return _coerce_utc(v)


class SessionCreate(BaseModel):
    session_token: str


class ProfileUpdate(BaseModel):
    display_name: str
    username: str


class AuthResponse(BaseModel):
    user: User
    session_token: str


class ConversationCreate(BaseModel):
    peer_user_id: str


class Conversation(BaseModel):
    conversation_id: str
    participants: List[str]
    created_at: datetime
    updated_at: datetime
    last_message: Optional[str] = None
    last_message_type: Optional[str] = None
    last_sender_id: Optional[str] = None

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _fix_dt(cls, v):
        return _coerce_utc(v)


class ConversationView(BaseModel):
    conversation_id: str
    peer: User
    last_message: Optional[str] = None
    last_message_type: Optional[str] = None
    last_sender_id: Optional[str] = None
    updated_at: datetime
    unread_count: int = 0

    @field_validator("updated_at", mode="before")
    @classmethod
    def _fix_updated_at(cls, v):
        return _coerce_utc(v)


class MessageCreate(BaseModel):
    type: Literal["text", "image", "video", "document"] = "text"
    text: Optional[str] = None
    media_base64: Optional[str] = None  # data URL or raw base64
    media_mime: Optional[str] = None
    filename: Optional[str] = None
    filesize: Optional[int] = None


class Message(BaseModel):
    message_id: str
    conversation_id: str
    sender_id: str
    type: Literal["text", "image", "video", "document"]
    text: Optional[str] = None
    media_base64: Optional[str] = None
    media_mime: Optional[str] = None
    filename: Optional[str] = None
    filesize: Optional[int] = None
    created_at: datetime
    read_at: Optional[datetime] = None

    @field_validator("created_at", "read_at", mode="before")
    @classmethod
    def _fix_dt(cls, v):
        return _coerce_utc(v)


# ---------- Auth helpers ----------

async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization[len("Bearer "):].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    if ensure_aware(session["expires_at"]) < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**user_doc)


async def get_user_by_token(token: str) -> Optional[User]:
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        return None
    if ensure_aware(session["expires_at"]) < now_utc():
        return None
    user_doc = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user_doc:
        return None
    return User(**user_doc)


# ---------- Auth endpoints ----------

@api_router.post("/auth/session", response_model=AuthResponse)
async def create_session(payload: SessionCreate):
    """Verify Emergent session token, upsert user, store our own session."""
    async with httpx.AsyncClient(timeout=15.0) as http:
        try:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_token},
            )
            r.raise_for_status()
            data = r.json()
        except httpx.HTTPStatusError:
            raise HTTPException(status_code=401, detail="Invalid Emergent session")
        except Exception:
            logger.exception("Error verifying Emergent session")
            raise HTTPException(status_code=502, detail="Failed to verify session with auth provider")

    email = data.get("email")
    name = data.get("name") or (email.split("@")[0] if email else "User")
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Malformed session data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = make_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": now_utc(),
        })

    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": now_utc(),
        }},
        upsert=True,
    )

    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return AuthResponse(user=User(**user_doc), session_token=session_token)


@api_router.get("/auth/me", response_model=User)
async def auth_me(authorization: Optional[str] = Header(None)):
    return await get_current_user(authorization)


@api_router.get("/auth/username-available")
async def username_available(
    u: str = Query(...),
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    try:
        normalized = validate_username(u)
    except HTTPException as e:
        return {"available": False, "reason": e.detail}
    existing = await db.users.find_one(
        {"username": normalized, "user_id": {"$ne": me.user_id}},
        {"_id": 0, "user_id": 1},
    )
    return {"available": existing is None, "username": normalized}


@api_router.post("/auth/complete-profile", response_model=User)
async def complete_profile(
    payload: ProfileUpdate,
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    display_name = validate_display_name(payload.display_name)
    username = validate_username(payload.username)

    # Check uniqueness (excluding self so users can re-submit their own)
    conflict = await db.users.find_one(
        {"username": username, "user_id": {"$ne": me.user_id}},
        {"_id": 0, "user_id": 1},
    )
    if conflict:
        raise HTTPException(status_code=409, detail="Username already taken.")

    await db.users.update_one(
        {"user_id": me.user_id},
        {"$set": {"display_name": display_name, "username": username}},
    )
    updated = await db.users.find_one({"user_id": me.user_id}, {"_id": 0})
    return User(**updated)


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer "):].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# Push-token endpoints
@api_router.post("/auth/push-token")
async def register_push_token(payload: dict, authorization: Optional[str] = Header(None)):
    me = await get_current_user(authorization)
    token = (payload or {}).get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")
    await db.users.update_one({"user_id": me.user_id}, {"$addToSet": {"push_tokens": token}})
    return {"ok": True}


@api_router.post("/auth/push-token/unregister")
async def unregister_push_token(payload: dict, authorization: Optional[str] = Header(None)):
    me = await get_current_user(authorization)
    token = (payload or {}).get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Missing token")
    await db.users.update_one({"user_id": me.user_id}, {"$pull": {"push_tokens": token}})
    return {"ok": True}


# ---------- Users ----------

@api_router.get("/users/search", response_model=List[User])
async def search_users(
    q: str = Query("", min_length=0),
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    query: Dict = {"user_id": {"$ne": me.user_id}}
    q_stripped = q.strip()
    if q_stripped:
        if q_stripped.startswith("@"):
            uname = q_stripped[1:].lower()
            if uname:
                query["username"] = {"$regex": f"^{uname}", "$options": "i"}
            else:
                query["username"] = {"$ne": None}
        else:
            query["$or"] = [
                {"name": {"$regex": q_stripped, "$options": "i"}},
                {"display_name": {"$regex": q_stripped, "$options": "i"}},
                {"username": {"$regex": q_stripped.lower(), "$options": "i"}},
                {"email": {"$regex": q_stripped, "$options": "i"}},
            ]
    cursor = db.users.find(query, {"_id": 0}).limit(50)
    users = await cursor.to_list(50)
    return [User(**u) for u in users]


@api_router.get("/users/discover", response_model=List[User])
async def discover_users(authorization: Optional[str] = Header(None)):
    """People-you-may-know: newest users the current user hasn't chatted with yet."""
    me = await get_current_user(authorization)
    # Collect peer ids from existing conversations
    existing = db.conversations.find(
        {"participants": me.user_id}, {"_id": 0, "participants": 1}
    )
    known_ids = {me.user_id}
    async for c in existing:
        for p in c.get("participants", []):
            known_ids.add(p)
    cursor = db.users.find(
        {"user_id": {"$nin": list(known_ids)}}, {"_id": 0}
    ).sort("created_at", -1).limit(12)
    users = await cursor.to_list(12)
    return [User(**u) for u in users]


# Expo push helper
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

async def send_expo_push_messages(messages: List[Dict[str, Any]]):
    if not messages:
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        chunk_size = 100
        for i in range(0, len(messages), chunk_size):
            chunk = messages[i:i+chunk_size]
            try:
                r = await client.post(EXPO_PUSH_URL, json=chunk)
                r.raise_for_status()
                resp = r.json()
                logger.debug("Expo push response: %s", resp)
            except Exception:
                logger.exception("Failed to send expo push chunk")


# ---------- Conversations ----------

async def build_conversation_view(convo: dict, me_id: str) -> Optional[ConversationView]:
    peer_id = next((p for p in convo["participants"] if p != me_id), None)
    if not peer_id:
        return None
    peer_doc = await db.users.find_one({"user_id": peer_id}, {"_id": 0})
    if not peer_doc:
        return None
    unread_count = await db.messages.count_documents({
        "conversation_id": convo["conversation_id"],
        "sender_id": {"$ne": me_id},
        "read_at": None,
    })
    return ConversationView(
        conversation_id=convo["conversation_id"],
        peer=User(**peer_doc),
        last_message=convo.get("last_message"),
        last_message_type=convo.get("last_message_type"),
        last_sender_id=convo.get("last_sender_id"),
        updated_at=convo["updated_at"],
        unread_count=unread_count,
    )


@api_router.get("/conversations", response_model=List[ConversationView])
async def list_conversations(authorization: Optional[str] = Header(None)):
    me = await get_current_user(authorization)
    cursor = db.conversations.find(
        {"participants": me.user_id}, {"_id": 0}
    ).sort("updated_at", -1)
    convos = await cursor.to_list(200)
    out: List[ConversationView] = []
    for c in convos:
        view = await build_conversation_view(c, me.user_id)
        if view:
            out.append(view)
    return out


@api_router.post("/conversations", response_model=ConversationView)
async def create_or_get_conversation(
    payload: ConversationCreate,
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    if payload.peer_user_id == me.user_id:
        raise HTTPException(status_code=400, detail="Cannot chat with yourself")
    peer = await db.users.find_one({"user_id": payload.peer_user_id}, {"_id": 0})
    if not peer:
        raise HTTPException(status_code=404, detail="User not found")

    # Find existing 1-on-1 conversation
    existing = await db.conversations.find_one({
        "participants": {"$all": [me.user_id, payload.peer_user_id], "$size": 2}
    }, {"_id": 0})

    if not existing:
        convo_id = make_id("conv")
        doc = {
            "conversation_id": convo_id,
            "participants": [me.user_id, payload.peer_user_id],
            "created_at": now_utc(),
            "updated_at": now_utc(),
            "last_message": None,
            "last_message_type": None,
            "last_sender_id": None,
        }
        await db.conversations.insert_one(doc)
        existing = doc
        # Strip _id in case insert_one added it
        existing.pop("_id", None)

    view = await build_conversation_view(existing, me.user_id)
    if not view:
        raise HTTPException(status_code=500, detail="Conversation build failed")
    return view


@api_router.get("/conversations/{conversation_id}/messages", response_model=List[Message])
async def get_messages(
    conversation_id: str,
    authorization: Optional[str] = Header(None),
    limit: int = 100,
):
    me = await get_current_user(authorization)
    convo = await db.conversations.find_one(
        {"conversation_id": conversation_id, "participants": me.user_id},
        {"_id": 0},
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    cursor = db.messages.find(
        {"conversation_id": conversation_id}, {"_id": 0}
    ).sort("created_at", 1).limit(limit)
    msgs = await cursor.to_list(limit)
    return [Message(**m) for m in msgs]


@api_router.post("/conversations/{conversation_id}/messages", response_model=Message)
async def send_message(
    conversation_id: str,
    payload: MessageCreate,
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    convo = await db.conversations.find_one(
        {"conversation_id": conversation_id, "participants": me.user_id},
        {"_id": 0},
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")

    if payload.type == "text":
        if not payload.text or not payload.text.strip():
            raise HTTPException(status_code=400, detail="Empty text message")
        preview = payload.text.strip()[:120]
    else:
        if not payload.media_base64:
            raise HTTPException(status_code=400, detail="Missing media")
        if payload.type == "image":
            preview = "📷 Photo"
        elif payload.type == "video":
            preview = "🎥 Video"
        else:
            preview = f"📎 {payload.filename or 'File'}"

    msg_doc = {
        "message_id": make_id("msg"),
        "conversation_id": conversation_id,
        "sender_id": me.user_id,
        "type": payload.type,
        "text": payload.text.strip() if payload.text else None,
        "media_base64": payload.media_base64,
        "media_mime": payload.media_mime,
        "filename": payload.filename,
        "filesize": payload.filesize,
        "created_at": now_utc(),
        "read_at": None,
    }
    await db.messages.insert_one(msg_doc)
    msg_doc.pop("_id", None)

    await db.conversations.update_one(
        {"conversation_id": conversation_id},
        {"$set": {
            "last_message": preview,
            "last_message_type": payload.type,
            "last_sender_id": me.user_id,
            "updated_at": now_utc(),
        }},
    )

    message = Message(**msg_doc)
    # Broadcast to peers via WebSocket
    try:
        await ws_manager.broadcast_to_conversation(
            conversation_id,
            {"event": "message", "data": _serialize_for_ws(message.model_dump())},
            participants=convo.get("participants", []),
        )
    except Exception:
        logger.exception("Failed to broadcast message %s in convo %s", message.message_id, conversation_id)

    # Send push notifications via Expo to other participants (if they have tokens)
    try:
        recipients = [uid for uid in convo.get("participants", []) if uid != me.user_id]
        if recipients:
            cursor = db.users.find({"user_id": {"$in": recipients}}, {"_id": 0, "push_tokens": 1, "display_name": 1})
            messages_to_send: List[Dict[str, Any]] = []
            async for u in cursor:
                push_tokens = u.get("push_tokens") or []
                display_name = u.get("display_name") or "New message"
                for tk in push_tokens:
                    if not tk:
                        continue
                    messages_to_send.append({
                        "to": tk,
                        "title": f"{me.display_name or me.name}",
                        "body": message.text or "Sent an attachment",
                        "data": {"conversation_id": conversation_id, "message_id": message.message_id},
                    })
            if messages_to_send:
                await send_expo_push_messages(messages_to_send)
    except Exception:
        logger.exception("Failed preparing or sending push notifications")

    return message


@api_router.post("/conversations/{conversation_id}/read")
async def mark_conversation_read(
    conversation_id: str,
    authorization: Optional[str] = Header(None),
):
    me = await get_current_user(authorization)
    convo = await db.conversations.find_one(
        {"conversation_id": conversation_id, "participants": me.user_id},
        {"_id": 0},
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    read_at = now_utc()
    result = await db.messages.update_many(
        {
            "conversation_id": conversation_id,
            "sender_id": {"$ne": me.user_id},
            "read_at": None,
        },
        {"$set": {"read_at": read_at}},
    )
    if result.modified_count > 0:
        # Broadcast read event so sender's UI can update ticks
        await ws_manager.broadcast_to_conversation(
            conversation_id,
            {
                "event": "read",
                "data": {
                    "conversation_id": conversation_id,
                    "reader_id": me.user_id,
                    "read_at": read_at.isoformat(),
                },
            },
            participants=convo["participants"],
        )
    return {"ok": True, "updated": result.modified_count}


# ---------- WebSocket Manager ----------

class WSManager:
    def __init__(self):
        # user_id -> set of websockets
        self.connections: Dict[str, Set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def is_online(self, user_id: str) -> bool:
        async with self._lock:
            conns = self.connections.get(user_id)
            return bool(conns)

    async def online_users(self) -> List[str]:
        async with self._lock:
            return list(self.connections.keys())

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            first = user_id not in self.connections or len(self.connections[user_id]) == 0
            self.connections.setdefault(user_id, set()).add(ws)
        return first  # True if this is the first ws for this user

    async def disconnect(self, user_id: str, ws: WebSocket) -> bool:
        """Return True if the user has NO more connections after this disconnect."""
        async with self._lock:
            if user_id not in self.connections:
                return False
            self.connections[user_id].discard(ws)
            if not self.connections.get(user_id):
                # ensure removal if empty
                if user_id in self.connections:
                    del self.connections[user_id]
                return True
        return False

    async def send_to_user(self, user_id: str, message: dict):
        # copy connection list under lock to avoid holding lock while sending
        async with self._lock:
            conns = list(self.connections.get(user_id, set()))
        for ws in conns:
            try:
                await ws.send_json(message)
            except WebSocketDisconnect:
                # Clean up disconnected socket
                await self.disconnect(user_id, ws)
            except Exception:
                logger.exception("Failed to send websocket message to %s", user_id)

    async def broadcast_to_conversation(self, conversation_id: str, message: dict, participants: List[str]):
        for uid in participants or []:
            await self.send_to_user(uid, message)


ws_manager = WSManager()


async def broadcast_presence(user_id: str, is_online: bool):
    """Notify all users who share a conversation with this user."""
    peers: set = set()
    async for c in db.conversations.find(
        {"participants": user_id}, {"_id": 0, "participants": 1}
    ):
        for p in c.get("participants", []):
            if p != user_id:
                peers.add(p)
    payload = {
        "event": "presence",
        "data": {"user_id": user_id, "is_online": is_online},
    }
    for peer_id in peers:
        await ws_manager.send_to_user(peer_id, payload)


@api_router.get("/presence")
async def get_presence(
    ids: str = Query(""),
    authorization: Optional[str] = Header(None),
):
    """Return {user_id: is_online} for the requested comma-separated ids."""
    await get_current_user(authorization)
    id_list = [i.strip() for i in ids.split(",") if i.strip()]
    out = {}
    for uid in id_list:
        out[uid] = await ws_manager.is_online(uid)
    return out


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    first = await ws_manager.connect(user.user_id, websocket)
    if first:
        await broadcast_presence(user.user_id, True)
    try:
        await websocket.send_json({"event": "connected", "user_id": user.user_id})
        while True:
            try:
                data = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:
                logger.exception("Error receiving from websocket for user %s", user.user_id)
                break

            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                logger.warning("Malformed websocket payload from user %s: %r", user.user_id, data)
                continue

            event = payload.get("event")
            if event == "ping":
                await websocket.send_json({"event": "pong"})
            elif event == "typing":
                convo_id = payload.get("conversation_id")
                is_typing = bool(payload.get("is_typing"))
                if not convo_id:
                    continue
                convo = await db.conversations.find_one(
                    {"conversation_id": convo_id, "participants": user.user_id},
                    {"_id": 0, "participants": 1},
                )
                if not convo:
                    continue
                for uid in convo["participants"]:
                    if uid == user.user_id:
                        continue
                    await ws_manager.send_to_user(uid, {
                        "event": "typing",
                        "data": {
                            "conversation_id": convo_id,
                            "user_id": user.user_id,
                            "is_typing": is_typing,
                        },
                    })
    finally:
        last = await ws_manager.disconnect(user.user_id, websocket)
        if last:
            await broadcast_presence(user.user_id, False)


# ---------- Health ----------

@api_router.get("/")
async def root():
    return {"message": "Panda Chat API", "ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index(
        "username",
        unique=True,
        partialFilterExpression={"username": {"$type": "string"}},
    )
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.conversations.create_index("conversation_id", unique=True)
    await db.conversations.create_index("participants")
    await db.conversations.create_index([("updated_at", -1)])
    await db.messages.create_index("conversation_id")
    await db.messages.create_index([("conversation_id", 1), ("created_at", 1)])
    logger.info("Indexes ensured")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
