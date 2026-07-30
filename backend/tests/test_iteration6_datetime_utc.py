"""Iteration 6 — Datetime UTC serialization bug fix tests.

USER-REPORTED BUG: '15 minutes earlier message is shown as 6 hours ago' in Indian
timezone. Root cause: MongoDB returned naive datetimes; Pydantic emitted ISO
strings WITHOUT a timezone marker. JavaScript `new Date()` then parses those as
LOCAL time, so users in UTC+5:30 saw a ~5-6h offset.

Fix: added Pydantic `field_validator(mode='before')` on all datetime fields in
`User`, `Conversation`, `ConversationView`, `Message` to coerce naive datetimes
to UTC-aware.

These tests assert every datetime-bearing API response includes a UTC marker
(either 'Z' or '+00:00'), and that WS `message` + `read` events do too.
"""
import asyncio
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import pytest
import websockets
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# Matches an ISO 8601 datetime that ENDS with either 'Z' or a numeric offset
# like '+00:00' / '+05:30'. This is what JavaScript `new Date(str)` requires
# to parse as an absolute instant instead of local wall clock.
UTC_MARKER_RE = re.compile(r"(Z|[+-]\d{2}:?\d{2})$")


def _auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _ws_url(token: str) -> str:
    if BASE_URL.startswith("https://"):
        base = "wss://" + BASE_URL[len("https://"):]
    elif BASE_URL.startswith("http://"):
        base = "ws://" + BASE_URL[len("http://"):]
    else:
        base = BASE_URL
    return f"{base}/api/ws?token={token}"


def assert_has_utc_marker(ts, field_name: str = "datetime"):
    """Fail if the string is missing a Z / ±HH:MM offset — the whole point of the fix."""
    assert isinstance(ts, str), f"{field_name} must be an ISO string, got {type(ts).__name__}"
    assert UTC_MARKER_RE.search(ts), (
        f"{field_name}={ts!r} is missing UTC/offset marker (Z or ±HH:MM). "
        f"JavaScript would parse this as LOCAL time — this is the reported bug."
    )
    # Also confirm python parses it as tz-aware
    parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None, f"{field_name} parsed as naive: {ts!r}"


# ---------- /api/auth/me ----------

class TestAuthMeDatetime:
    def test_auth_me_created_at_has_utc_marker(self, api, base_url, user_alice):
        r = api.get(f"{base_url}/api/auth/me", headers=_auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        assert_has_utc_marker(r.json()["created_at"], "auth/me.created_at")


# ---------- /api/users/search + /api/users/discover ----------

class TestUsersDatetime:
    def test_users_search_created_at_has_utc_marker(self, api, base_url, user_alice, user_bob):
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": "TEST"},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        users = r.json()
        assert len(users) >= 1
        for u in users:
            assert_has_utc_marker(u["created_at"], f"search.{u.get('user_id')}.created_at")

    def test_users_discover_created_at_has_utc_marker(self, api, base_url, user_alice, user_bob, user_charlie):
        r = api.get(f"{base_url}/api/users/discover", headers=_auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        for u in r.json():
            assert_has_utc_marker(u["created_at"], f"discover.{u.get('user_id')}.created_at")


# ---------- /api/conversations ----------

class TestConversationsDatetime:
    def test_create_conversation_updated_at_has_utc_marker(self, api, base_url, user_alice, user_bob):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert_has_utc_marker(body["updated_at"], "conversations.POST.updated_at")
        assert_has_utc_marker(body["peer"]["created_at"], "conversations.POST.peer.created_at")

    def test_list_conversations_updated_at_has_utc_marker(self, api, base_url, user_alice, user_bob):
        # Create one first
        api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        r = api.get(f"{base_url}/api/conversations", headers=_auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        convos = r.json()
        assert len(convos) >= 1
        for c in convos:
            assert_has_utc_marker(c["updated_at"], "conversations.GET.updated_at")
            assert_has_utc_marker(c["peer"]["created_at"], "conversations.GET.peer.created_at")


# ---------- Messages: POST + GET + roundtrip freshness ----------

class TestMessageDatetime:
    def _mk_convo(self, api, base_url, u1, u2):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": u2["user_id"]},
            headers=_auth(u1["token"]),
        )
        assert r.status_code == 200, r.text
        return r.json()["conversation_id"]

    def test_send_message_returns_utc_created_at(self, api, base_url, user_alice, user_bob):
        cid = self._mk_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "TEST hello"},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert_has_utc_marker(body["created_at"], "message.POST.created_at")
        assert body["read_at"] is None

    def test_send_message_created_at_is_fresh_within_5s(self, api, base_url, user_alice, user_bob):
        """PRIMARY BUG PROOF: roundtripped created_at must be within a few seconds
        of now — not ~5.5 hours off as before the fix."""
        cid = self._mk_convo(api, base_url, user_alice, user_bob)
        before = datetime.now(timezone.utc)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "TEST freshness"},
            headers=_auth(user_alice["token"]),
        )
        after = datetime.now(timezone.utc)
        assert r.status_code == 200, r.text
        ts = r.json()["created_at"]
        assert_has_utc_marker(ts, "message.created_at")
        parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        # Must be tz-aware and lie within [before-1s, after+1s]
        assert parsed.tzinfo is not None
        delta_before = (parsed - before).total_seconds()
        delta_after = (after - parsed).total_seconds()
        assert -1.0 <= delta_before <= 5.0, (
            f"created_at={ts} vs before={before.isoformat()} → delta={delta_before}s "
            f"(reproduces the ~5h TZ bug if large)"
        )
        assert -1.0 <= delta_after <= 5.0, (
            f"created_at={ts} vs after={after.isoformat()} → delta={delta_after}s"
        )

    def test_get_messages_created_at_has_utc_marker(self, api, base_url, user_alice, user_bob):
        cid = self._mk_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "TEST get1"},
            headers=_auth(user_alice["token"]),
        )
        r = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        msgs = r.json()
        assert len(msgs) >= 1
        for m in msgs:
            assert_has_utc_marker(m["created_at"], "messages.GET.created_at")
            if m["read_at"] is not None:
                assert_has_utc_marker(m["read_at"], "messages.GET.read_at")

    def test_read_at_has_utc_marker_after_mark_read(self, api, base_url, user_alice, user_bob):
        cid = self._mk_convo(api, base_url, user_alice, user_bob)
        # Alice sends → Bob reads
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "TEST mark-read"},
            headers=_auth(user_alice["token"]),
        )
        r = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=_auth(user_bob["token"]),
        )
        assert r.status_code == 200
        assert r.json()["updated"] >= 1

        r2 = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=_auth(user_bob["token"]),
        )
        assert r2.status_code == 200
        msgs = r2.json()
        read_msgs = [m for m in msgs if m["read_at"] is not None]
        assert len(read_msgs) >= 1, "expected at least one message with read_at set"
        for m in read_msgs:
            assert_has_utc_marker(m["read_at"], "messages.GET.read_at")


# ---------- WebSocket message + read event payloads ----------

async def _wait_for_event(ws, event_name: str, timeout: float = 5.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError()
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))
        if m.get("event") == event_name:
            return m


@pytest.mark.asyncio
async def test_ws_message_event_created_at_has_utc_marker(user_alice, user_bob, api, base_url):
    """WS 'message' event data.created_at must carry the UTC marker."""
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": user_bob["user_id"]},
        headers=_auth(user_alice["token"]),
    )
    assert r.status_code == 200
    cid = r.json()["conversation_id"]

    async with websockets.connect(_ws_url(user_bob["token"]), open_timeout=10) as bws:
        # drain 'connected' + any presence noise
        first = json.loads(await asyncio.wait_for(bws.recv(), timeout=5))
        assert first.get("event") == "connected"
        await asyncio.sleep(0.15)

        # Alice sends via REST
        resp = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "TEST ws-utc"},
            headers=_auth(user_alice["token"]),
        )
        assert resp.status_code == 200, resp.text

        msg = await _wait_for_event(bws, "message", timeout=5.0)
        assert_has_utc_marker(msg["data"]["created_at"], "ws.message.created_at")
        # created_at should also be fresh (proves no timezone shift on the WS path)
        parsed = datetime.fromisoformat(msg["data"]["created_at"].replace("Z", "+00:00"))
        delta = abs((datetime.now(timezone.utc) - parsed).total_seconds())
        assert delta < 10, f"ws message created_at drifted by {delta}s — likely TZ bug"


@pytest.mark.asyncio
async def test_ws_read_event_read_at_has_utc_marker(user_alice, user_bob, api, base_url):
    """WS 'read' event data.read_at must carry the UTC marker."""
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": user_bob["user_id"]},
        headers=_auth(user_alice["token"]),
    )
    assert r.status_code == 200
    cid = r.json()["conversation_id"]

    # Alice sends first (creates an unread message for Bob)
    r2 = api.post(
        f"{base_url}/api/conversations/{cid}/messages",
        json={"type": "text", "text": "TEST for-read"},
        headers=_auth(user_alice["token"]),
    )
    assert r2.status_code == 200

    async with websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        first = json.loads(await asyncio.wait_for(aws.recv(), timeout=5))
        assert first.get("event") == "connected"
        await asyncio.sleep(0.15)

        # Bob marks conversation read → Alice should get WS 'read' event
        r3 = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=_auth(user_bob["token"]),
        )
        assert r3.status_code == 200
        assert r3.json()["updated"] >= 1

        evt = await _wait_for_event(aws, "read", timeout=5.0)
        assert evt["data"]["conversation_id"] == cid
        assert evt["data"]["reader_id"] == user_bob["user_id"]
        assert_has_utc_marker(evt["data"]["read_at"], "ws.read.read_at")
