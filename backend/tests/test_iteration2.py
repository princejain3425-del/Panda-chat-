"""Iteration 2 tests: unread_count, mark-read, discover, typing WS.

Extends test_api.py & test_ws.py — uses same fixtures from conftest.py.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest
import websockets
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
WS_BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _ws_url(token: str) -> str:
    if WS_BASE.startswith("https://"):
        base = "wss://" + WS_BASE[len("https://"):]
    elif WS_BASE.startswith("http://"):
        base = "ws://" + WS_BASE[len("http://"):]
    else:
        base = WS_BASE
    return f"{base}/api/ws?token={token}"


def _create_convo(api, base_url, me, peer):
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": peer["user_id"]},
        headers=auth(me["token"]),
    )
    assert r.status_code == 200, r.text
    return r.json()["conversation_id"]


# ---------- Unread count on ConversationView ----------
class TestUnreadCount:
    def test_unread_reflects_peer_messages(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        # Bob sends 3 messages to Alice
        for i in range(3):
            r = api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"peer msg {i}"},
                headers=auth(user_bob["token"]),
            )
            assert r.status_code == 200

        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["unread_count"] == 3

    def test_own_messages_dont_increment_unread(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        # Bob sends 2, Alice sends 5 (own don't count for Alice's unread)
        for i in range(2):
            api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"bob {i}"},
                headers=auth(user_bob["token"]),
            )
        for i in range(5):
            api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"alice {i}"},
                headers=auth(user_alice["token"]),
            )
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["unread_count"] == 2

    def test_unread_zero_when_no_peer_messages(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        # Only alice sends
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "just me"},
            headers=auth(user_alice["token"]),
        )
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["unread_count"] == 0


# ---------- Mark conversation as read ----------
class TestMarkRead:
    def test_mark_read_requires_auth(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        r = api.post(f"{base_url}/api/conversations/{cid}/read")
        assert r.status_code == 401

    def test_mark_read_success_updates_and_returns_count(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        # Bob sends 4, Alice sends 2 (should not be touched)
        for i in range(4):
            api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"bob {i}"},
                headers=auth(user_bob["token"]),
            )
        for i in range(2):
            api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"alice {i}"},
                headers=auth(user_alice["token"]),
            )

        r = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("updated") == 4

        # Verify unread_count is now 0
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["unread_count"] == 0

        # Verify read_at populated on peer messages, null on alice's
        msgs = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=auth(user_alice["token"]),
        ).json()
        peer_msgs = [m for m in msgs if m["sender_id"] == user_bob["user_id"]]
        own_msgs = [m for m in msgs if m["sender_id"] == user_alice["user_id"]]
        assert len(peer_msgs) == 4 and all(m["read_at"] is not None for m in peer_msgs)
        assert len(own_msgs) == 2 and all(m["read_at"] is None for m in own_msgs)

    def test_mark_read_idempotent_second_call_updates_zero(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "hi"},
            headers=auth(user_bob["token"]),
        )
        r1 = api.post(f"{base_url}/api/conversations/{cid}/read", headers=auth(user_alice["token"]))
        assert r1.status_code == 200 and r1.json()["updated"] == 1
        r2 = api.post(f"{base_url}/api/conversations/{cid}/read", headers=auth(user_alice["token"]))
        assert r2.status_code == 200 and r2.json()["updated"] == 0

    def test_mark_read_non_participant_404(self, api, base_url, user_alice, user_bob, user_charlie):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        # Charlie is not a participant
        r = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=auth(user_charlie["token"]),
        )
        assert r.status_code == 404

    def test_new_incoming_after_read_is_unread(self, api, base_url, user_alice, user_bob):
        cid = _create_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "first"},
            headers=auth(user_bob["token"]),
        )
        api.post(f"{base_url}/api/conversations/{cid}/read", headers=auth(user_alice["token"]))
        # Bob sends another one after alice read
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "second"},
            headers=auth(user_bob["token"]),
        )
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["unread_count"] == 1


# ---------- Discover endpoint ----------
class TestDiscover:
    def test_discover_requires_auth(self, api, base_url):
        r = api.get(f"{base_url}/api/users/discover")
        assert r.status_code == 401

    def test_discover_excludes_self_and_no_leak(self, api, base_url, user_alice, user_bob, user_charlie):
        r = api.get(f"{base_url}/api/users/discover", headers=auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        users = r.json()
        assert len(users) <= 12
        ids = [u["user_id"] for u in users]
        assert user_alice["user_id"] not in ids
        for u in users:
            assert "_id" not in u

    def test_discover_excludes_known_conversations(self, api, base_url, user_alice, user_bob, user_charlie):
        # Alice starts a conversation with Bob; Bob must be excluded from discover.
        _create_convo(api, base_url, user_alice, user_bob)
        r = api.get(f"{base_url}/api/users/discover", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        ids = [u["user_id"] for u in r.json()]
        assert user_bob["user_id"] not in ids
        # Charlie has no convo with Alice → should still be discoverable
        assert user_charlie["user_id"] in ids

    def test_discover_sorted_created_at_desc(self, api, base_url, user_alice, mongo_db):
        # Insert two extra ordered users; verify newer appears before older.
        older_id = f"user_TEST_disc_old_{uuid.uuid4().hex[:6]}"
        newer_id = f"user_TEST_disc_new_{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc)
        mongo_db.users.insert_one({
            "user_id": older_id,
            "email": f"TEST_old_{uuid.uuid4().hex[:6]}@example.com",
            "name": "TEST Older", "picture": None,
            "created_at": now - timedelta(days=10),
        })
        mongo_db.users.insert_one({
            "user_id": newer_id,
            "email": f"TEST_new_{uuid.uuid4().hex[:6]}@example.com",
            "name": "TEST Newer", "picture": None,
            "created_at": now + timedelta(seconds=5),
        })
        try:
            r = api.get(f"{base_url}/api/users/discover", headers=auth(user_alice["token"]))
            assert r.status_code == 200
            ids = [u["user_id"] for u in r.json()]
            assert newer_id in ids and older_id in ids
            assert ids.index(newer_id) < ids.index(older_id)
        finally:
            mongo_db.users.delete_one({"user_id": older_id})
            mongo_db.users.delete_one({"user_id": newer_id})


# ---------- WebSocket: read broadcast ----------
@pytest.mark.asyncio
async def test_ws_read_event_broadcast_to_sender(user_alice, user_bob, api, base_url):
    """When Alice marks-read, Bob (who sent messages) should receive a 'read' WS event."""
    cid = _create_convo(api, base_url, user_alice, user_bob)
    # Bob sends messages
    api.post(
        f"{base_url}/api/conversations/{cid}/messages",
        json={"type": "text", "text": "unread 1"},
        headers=auth(user_bob["token"]),
    )
    api.post(
        f"{base_url}/api/conversations/{cid}/messages",
        json={"type": "text", "text": "unread 2"},
        headers=auth(user_bob["token"]),
    )

    bob_url = _ws_url(user_bob["token"])
    async with websockets.connect(bob_url, open_timeout=10) as bob_ws:
        # Consume "connected"
        first = json.loads(await asyncio.wait_for(bob_ws.recv(), timeout=5))
        assert first.get("event") == "connected"

        # Alice marks-read via HTTP
        r = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200 and r.json()["updated"] == 2

        # Bob should receive 'read' event
        received = None
        for _ in range(5):
            evt = json.loads(await asyncio.wait_for(bob_ws.recv(), timeout=5))
            if evt.get("event") == "read":
                received = evt
                break
        assert received is not None, "Bob did not receive 'read' event"
        data = received["data"]
        assert data["conversation_id"] == cid
        assert data["reader_id"] == user_alice["user_id"]
        assert data.get("read_at") is not None


# ---------- WebSocket: typing indicator ----------
@pytest.mark.asyncio
async def test_ws_typing_broadcast_to_peer_only(user_alice, user_bob, api, base_url):
    """Alice sends typing → Bob receives; sender (Alice) does NOT get echo."""
    cid = _create_convo(api, base_url, user_alice, user_bob)

    alice_url = _ws_url(user_alice["token"])
    bob_url = _ws_url(user_bob["token"])
    async with websockets.connect(alice_url, open_timeout=10) as a_ws, \
               websockets.connect(bob_url, open_timeout=10) as b_ws:
        # consume 'connected' from both
        assert json.loads(await asyncio.wait_for(a_ws.recv(), timeout=5)).get("event") == "connected"
        assert json.loads(await asyncio.wait_for(b_ws.recv(), timeout=5)).get("event") == "connected"

        # Alice signals typing
        await a_ws.send(json.dumps({
            "event": "typing",
            "conversation_id": cid,
            "is_typing": True,
        }))

        # Bob should receive typing event
        evt = json.loads(await asyncio.wait_for(b_ws.recv(), timeout=5))
        assert evt.get("event") == "typing"
        assert evt["data"]["conversation_id"] == cid
        assert evt["data"]["user_id"] == user_alice["user_id"]
        assert evt["data"]["is_typing"] is True

        # Alice must NOT receive her own typing echo
        try:
            echo = await asyncio.wait_for(a_ws.recv(), timeout=1.5)
            pytest.fail(f"Alice received unexpected echo: {echo}")
        except asyncio.TimeoutError:
            pass  # expected

        # Now typing = False propagates too
        await a_ws.send(json.dumps({
            "event": "typing",
            "conversation_id": cid,
            "is_typing": False,
        }))
        evt2 = json.loads(await asyncio.wait_for(b_ws.recv(), timeout=5))
        assert evt2["data"]["is_typing"] is False


@pytest.mark.asyncio
async def test_ws_typing_non_participant_no_broadcast(user_alice, user_bob, user_charlie, api, base_url):
    """Charlie tries to send typing for Alice-Bob's conversation. Neither should receive it."""
    cid = _create_convo(api, base_url, user_alice, user_bob)

    a_url = _ws_url(user_alice["token"])
    b_url = _ws_url(user_bob["token"])
    c_url = _ws_url(user_charlie["token"])
    async with websockets.connect(a_url, open_timeout=10) as a_ws, \
               websockets.connect(b_url, open_timeout=10) as b_ws, \
               websockets.connect(c_url, open_timeout=10) as c_ws:
        for ws in (a_ws, b_ws, c_ws):
            first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            assert first.get("event") == "connected"

        # Charlie fakes typing on a conv he's not in
        await c_ws.send(json.dumps({
            "event": "typing",
            "conversation_id": cid,
            "is_typing": True,
        }))

        # Neither Alice nor Bob should get any typing event
        for ws, name in ((a_ws, "alice"), (b_ws, "bob")):
            try:
                leaked = await asyncio.wait_for(ws.recv(), timeout=1.5)
                pytest.fail(f"{name} received unexpected event from non-participant typing: {leaked}")
            except asyncio.TimeoutError:
                pass  # expected — no broadcast
