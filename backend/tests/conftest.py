"""Shared fixtures for SageChat backend tests.

Inserts stub users and sessions directly into MongoDB per test_credentials.md.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

# Load backend .env to get MONGO_URL / DB_NAME
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get("EXPO_PUBLIC_BACKEND_URL") else None
if BASE_URL is None:
    # Fall back to frontend .env
    load_dotenv(Path("/app/frontend/.env"))
    BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def _now():
    return datetime.now(timezone.utc)


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo_db():
    cli = MongoClient(MONGO_URL)
    db = cli[DB_NAME]
    yield db
    cli.close()


def _make_user(db, tag: str):
    uid = f"user_TEST_{uuid.uuid4().hex[:10]}"
    email = f"TEST_{tag}_{uuid.uuid4().hex[:6]}@example.com"
    name = f"TEST {tag.title()} User"
    db.users.insert_one({
        "user_id": uid,
        "email": email,
        "name": name,
        "picture": None,
        "created_at": _now(),
    })
    token = f"TEST_tok_{uuid.uuid4().hex}"
    db.user_sessions.insert_one({
        "session_token": token,
        "user_id": uid,
        "expires_at": _now() + timedelta(days=1),
        "created_at": _now(),
    })
    return {"user_id": uid, "email": email, "name": name, "token": token}


@pytest.fixture(scope="function")
def user_alice(mongo_db):
    u = _make_user(mongo_db, "alice")
    yield u
    # cleanup: user, sessions, conversations, messages
    mongo_db.users.delete_one({"user_id": u["user_id"]})
    mongo_db.user_sessions.delete_many({"user_id": u["user_id"]})
    convs = list(mongo_db.conversations.find({"participants": u["user_id"]}, {"conversation_id": 1}))
    for c in convs:
        mongo_db.messages.delete_many({"conversation_id": c["conversation_id"]})
        mongo_db.conversations.delete_one({"conversation_id": c["conversation_id"]})


@pytest.fixture(scope="function")
def user_bob(mongo_db):
    u = _make_user(mongo_db, "bob")
    yield u
    mongo_db.users.delete_one({"user_id": u["user_id"]})
    mongo_db.user_sessions.delete_many({"user_id": u["user_id"]})


@pytest.fixture(scope="function")
def user_charlie(mongo_db):
    u = _make_user(mongo_db, "charlie")
    yield u
    mongo_db.users.delete_one({"user_id": u["user_id"]})
    mongo_db.user_sessions.delete_many({"user_id": u["user_id"]})


@pytest.fixture(scope="function")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}
