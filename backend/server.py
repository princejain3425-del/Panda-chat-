from fastapi import FastAPI, APIRouter, Header, HTTPException, WebSocket, WebSocketDisconnect, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict
from datetime import datetime, timezone, timedelta
import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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

class User(BaseModel):
    user_id: str
    email: str
    name: str
    display_name: Optional[str] = None
    username: Optional[str] = None
    picture: Optional[str] = None
    created_at: datetime


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


class ConversationView(BaseModel):
    conversation_id: str
    peer: User
    last_message: Optional[str] = None
    last_message_type: Optional[str] = None
    last_sender_id: Optional[str] = None
    updated_at: datetime
    unread_count: int = 0


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
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_token},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Emergent session")
    data = r.json()
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
    await ws_manager.broadcast_to_conversation(
        conversation_id,
        {"event": "message", "data": json.loads(message.model_dump_json())},
        participants=convo["participants"],
    )
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
        self.connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(user_id, []).append(ws)

    def disconnect(self, user_id: str, ws: WebSocket):
        if user_id in self.connections:
            try:
                self.connections[user_id].remove(ws)
            except ValueError:
                pass
            if not self.connections[user_id]:
                del self.connections[user_id]

    async def send_to_user(self, user_id: str, message: dict):
        for ws in list(self.connections.get(user_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(user_id, ws)

    async def broadcast_to_conversation(self, conversation_id: str, message: dict, participants: List[str]):
        for uid in participants:
            await self.send_to_user(uid, message)


ws_manager = WSManager()


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    user = await get_user_by_token(token)
    if not user:
        await websocket.close(code=4401)
        return
    await ws_manager.connect(user.user_id, websocket)
    try:
        # Send hello
        await websocket.send_json({"event": "connected", "user_id": user.user_id})
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
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
                    # Broadcast to peers only (not back to sender)
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
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(user.user_id, websocket)
    except Exception:
        ws_manager.disconnect(user.user_id, websocket)


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
