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


# ---------- Models ----------

class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime


class SessionCreate(BaseModel):
    session_token: str


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


class MessageCreate(BaseModel):
    type: Literal["text", "image", "video"] = "text"
    text: Optional[str] = None
    media_base64: Optional[str] = None  # data URL or raw base64
    media_mime: Optional[str] = None


class Message(BaseModel):
    message_id: str
    conversation_id: str
    sender_id: str
    type: Literal["text", "image", "video"]
    text: Optional[str] = None
    media_base64: Optional[str] = None
    media_mime: Optional[str] = None
    created_at: datetime


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
    if q.strip():
        # Case-insensitive prefix/contains search on name and email
        query["$or"] = [
            {"name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    cursor = db.users.find(query, {"_id": 0}).limit(50)
    users = await cursor.to_list(50)
    return [User(**u) for u in users]


# ---------- Conversations ----------

async def build_conversation_view(convo: dict, me_id: str) -> Optional[ConversationView]:
    peer_id = next((p for p in convo["participants"] if p != me_id), None)
    if not peer_id:
        return None
    peer_doc = await db.users.find_one({"user_id": peer_id}, {"_id": 0})
    if not peer_doc:
        return None
    return ConversationView(
        conversation_id=convo["conversation_id"],
        peer=User(**peer_doc),
        last_message=convo.get("last_message"),
        last_message_type=convo.get("last_message_type"),
        last_sender_id=convo.get("last_sender_id"),
        updated_at=convo["updated_at"],
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
        preview = "📷 Photo" if payload.type == "image" else "🎥 Video"

    msg_doc = {
        "message_id": make_id("msg"),
        "conversation_id": conversation_id,
        "sender_id": me.user_id,
        "type": payload.type,
        "text": payload.text.strip() if payload.text else None,
        "media_base64": payload.media_base64,
        "media_mime": payload.media_mime,
        "created_at": now_utc(),
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
            # Keep connection alive; accept pings from client
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                if payload.get("event") == "ping":
                    await websocket.send_json({"event": "pong"})
            except Exception:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(user.user_id, websocket)
    except Exception:
        ws_manager.disconnect(user.user_id, websocket)


# ---------- Health ----------

@api_router.get("/")
async def root():
    return {"message": "SageChat API", "ok": True}


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
