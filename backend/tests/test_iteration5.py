"""Iteration 5 — Presence (online/offline) tests.

Covers:
  * GET /api/presence auth + response shape (bulk lookup)
  * WS presence broadcast on connect / disconnect
  * Presence NOT sent to users who don't share a conversation
  * Presence NOT echoed back to the source user
  * Two concurrent WS for same user — closing one does not emit offline
  * /api/presence reflects live WS state (online while connected, offline after close)
"""
import asyncio
import json
import os
from pathlib import Path

import pytest
import websockets
from dotenv import load_dotenv

load_dotenv(Path("/app/frontend/.env"))
BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")


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


def _create_convo(api, base_url, u1, u2):
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": u2["user_id"]},
        headers=_auth(u1["token"]),
    )
    assert r.status_code == 200, r.text
    return r.json()["conversation_id"]


async def _wait_for_event(ws, event_name: str, timeout: float = 5.0):
    """Consume messages until one with matching event is seen, or TimeoutError."""
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        remaining = deadline - asyncio.get_event_loop().time()
        if remaining <= 0:
            raise asyncio.TimeoutError()
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))
        if m.get("event") == event_name:
            return m


async def _expect_no_more(ws, timeout: float = 1.5):
    """Assert no additional (non-presence-noise) events arrive within timeout."""
    try:
        m = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        return m
    except asyncio.TimeoutError:
        return None


# ---------- REST /api/presence ----------

class TestPresenceEndpoint:
    def test_presence_requires_auth(self, api, base_url, user_alice):
        r = api.get(f"{base_url}/api/presence", params={"ids": user_alice["user_id"]})
        assert r.status_code == 401

    def test_presence_empty_ids_returns_empty_object(self, api, base_url, user_alice):
        r = api.get(
            f"{base_url}/api/presence",
            params={"ids": ""},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200
        assert r.json() == {}

    def test_presence_missing_ids_param_returns_empty_object(self, api, base_url, user_alice):
        r = api.get(f"{base_url}/api/presence", headers=_auth(user_alice["token"]))
        assert r.status_code == 200
        assert r.json() == {}

    def test_presence_unknown_ids_return_false(self, api, base_url, user_alice):
        r = api.get(
            f"{base_url}/api/presence",
            params={"ids": "user_TEST_ghost_1,user_TEST_ghost_2"},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200
        data = r.json()
        assert data == {"user_TEST_ghost_1": False, "user_TEST_ghost_2": False}

    def test_presence_offline_user_returns_false(self, api, base_url, user_alice, user_bob):
        r = api.get(
            f"{base_url}/api/presence",
            params={"ids": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200
        assert r.json() == {user_bob["user_id"]: False}

    def test_presence_multiple_ids_bulk(self, api, base_url, user_alice, user_bob, user_charlie):
        ids = f"{user_alice['user_id']},{user_bob['user_id']},{user_charlie['user_id']},user_TEST_ghost"
        r = api.get(
            f"{base_url}/api/presence",
            params={"ids": ids},
            headers=_auth(user_alice["token"]),
        )
        assert r.status_code == 200
        data = r.json()
        assert set(data.keys()) == {
            user_alice["user_id"], user_bob["user_id"], user_charlie["user_id"], "user_TEST_ghost"
        }
        for v in data.values():
            assert v is False


# ---------- Live presence (REST reflects WS state) ----------

@pytest.mark.asyncio
async def test_presence_reflects_live_ws_state(user_alice, user_bob, api, base_url):
    _create_convo(api, base_url, user_alice, user_bob)

    # Before connect: bob offline
    r = api.get(
        f"{base_url}/api/presence",
        params={"ids": user_bob["user_id"]},
        headers=_auth(user_alice["token"]),
    )
    assert r.json() == {user_bob["user_id"]: False}

    async with websockets.connect(_ws_url(user_bob["token"]), open_timeout=10) as bws:
        # consume 'connected'
        first = json.loads(await asyncio.wait_for(bws.recv(), timeout=5))
        assert first.get("event") == "connected"
        await asyncio.sleep(0.2)  # allow connect handler to register

        r2 = api.get(
            f"{base_url}/api/presence",
            params={"ids": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        assert r2.status_code == 200
        assert r2.json() == {user_bob["user_id"]: True}

    # After disconnect
    await asyncio.sleep(0.4)
    r3 = api.get(
        f"{base_url}/api/presence",
        params={"ids": user_bob["user_id"]},
        headers=_auth(user_alice["token"]),
    )
    assert r3.json() == {user_bob["user_id"]: False}


# ---------- WS presence broadcast on connect ----------

@pytest.mark.asyncio
async def test_ws_presence_broadcast_on_peer_connect(user_alice, user_bob, api, base_url):
    """Alice is online. Bob connects → Alice receives presence:true for Bob."""
    _create_convo(api, base_url, user_alice, user_bob)

    async with websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        # Consume alice's 'connected'
        assert json.loads(await asyncio.wait_for(aws.recv(), timeout=5)).get("event") == "connected"

        # Bob comes online
        async with websockets.connect(_ws_url(user_bob["token"]), open_timeout=10) as bws:
            # Bob's own 'connected' packet
            assert json.loads(await asyncio.wait_for(bws.recv(), timeout=5)).get("event") == "connected"

            # Alice should receive presence event for Bob
            evt = await _wait_for_event(aws, "presence", timeout=5.0)
            assert evt["data"]["user_id"] == user_bob["user_id"]
            assert evt["data"]["is_online"] is True


@pytest.mark.asyncio
async def test_ws_presence_source_does_not_receive_own_event(user_alice, user_bob, api, base_url):
    """When Bob connects, Bob himself does NOT get his own presence:true event."""
    _create_convo(api, base_url, user_alice, user_bob)

    async with websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        assert json.loads(await asyncio.wait_for(aws.recv(), timeout=5)).get("event") == "connected"

        async with websockets.connect(_ws_url(user_bob["token"]), open_timeout=10) as bws:
            assert json.loads(await asyncio.wait_for(bws.recv(), timeout=5)).get("event") == "connected"
            # Give server time to fan out any presence
            await asyncio.sleep(0.6)
            # Bob must NOT receive his own presence:true
            leaked = await _expect_no_more(bws, timeout=1.0)
            assert leaked is None or leaked.get("event") != "presence" or \
                   leaked["data"].get("user_id") != user_bob["user_id"]


@pytest.mark.asyncio
async def test_ws_presence_no_broadcast_to_non_peer(user_alice, user_bob, user_charlie, api, base_url):
    """Charlie has NO conversation with Bob → does NOT receive Bob's presence event."""
    # Alice-Bob share a convo; Charlie is unrelated
    _create_convo(api, base_url, user_alice, user_bob)

    async with websockets.connect(_ws_url(user_charlie["token"]), open_timeout=10) as cws, \
               websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        assert json.loads(await asyncio.wait_for(cws.recv(), timeout=5)).get("event") == "connected"
        assert json.loads(await asyncio.wait_for(aws.recv(), timeout=5)).get("event") == "connected"

        # Bob connects
        async with websockets.connect(_ws_url(user_bob["token"]), open_timeout=10) as bws:
            assert json.loads(await asyncio.wait_for(bws.recv(), timeout=5)).get("event") == "connected"

            # Alice should get Bob's presence
            aevt = await _wait_for_event(aws, "presence", timeout=5.0)
            assert aevt["data"]["user_id"] == user_bob["user_id"]

            # Charlie should NOT receive any presence for Bob
            try:
                leak = await asyncio.wait_for(cws.recv(), timeout=1.5)
                m = json.loads(leak)
                pytest.fail(f"Charlie unexpectedly received event: {m}")
            except asyncio.TimeoutError:
                pass  # expected


# ---------- WS presence broadcast on disconnect ----------

@pytest.mark.asyncio
async def test_ws_presence_broadcast_on_disconnect(user_alice, user_bob, api, base_url):
    """When Bob's WS closes, Alice receives presence:false for Bob."""
    _create_convo(api, base_url, user_alice, user_bob)

    async with websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        assert json.loads(await asyncio.wait_for(aws.recv(), timeout=5)).get("event") == "connected"

        bws = await websockets.connect(_ws_url(user_bob["token"]), open_timeout=10)
        assert json.loads(await asyncio.wait_for(bws.recv(), timeout=5)).get("event") == "connected"

        # Consume Bob's online presence on Alice side
        online = await _wait_for_event(aws, "presence", timeout=5.0)
        assert online["data"]["is_online"] is True
        assert online["data"]["user_id"] == user_bob["user_id"]

        # Close Bob
        await bws.close()

        # Alice should receive presence:false for Bob
        offline = await _wait_for_event(aws, "presence", timeout=5.0)
        assert offline["data"]["user_id"] == user_bob["user_id"]
        assert offline["data"]["is_online"] is False


@pytest.mark.asyncio
async def test_ws_two_concurrent_connections_partial_close_stays_online(user_alice, user_bob, api, base_url):
    """Bob opens 2 WS. Closing one should NOT emit offline (still online via 2nd)."""
    _create_convo(api, base_url, user_alice, user_bob)

    async with websockets.connect(_ws_url(user_alice["token"]), open_timeout=10) as aws:
        assert json.loads(await asyncio.wait_for(aws.recv(), timeout=5)).get("event") == "connected"

        bws1 = await websockets.connect(_ws_url(user_bob["token"]), open_timeout=10)
        assert json.loads(await asyncio.wait_for(bws1.recv(), timeout=5)).get("event") == "connected"
        # Alice gets Bob presence:true (first connect)
        p1 = await _wait_for_event(aws, "presence", timeout=5.0)
        assert p1["data"]["is_online"] is True

        bws2 = await websockets.connect(_ws_url(user_bob["token"]), open_timeout=10)
        assert json.loads(await asyncio.wait_for(bws2.recv(), timeout=5)).get("event") == "connected"

        # Give server a moment; second connect should NOT re-broadcast (not first)
        await asyncio.sleep(0.4)

        # Close only bws1 — should NOT emit offline
        await bws1.close()
        await asyncio.sleep(0.5)

        # Presence should still be online per REST
        r = api.get(
            f"{base_url}/api/presence",
            params={"ids": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        assert r.json() == {user_bob["user_id"]: True}

        # And Alice must NOT have received any presence:false yet
        try:
            leak = await asyncio.wait_for(aws.recv(), timeout=1.2)
            m = json.loads(leak)
            if m.get("event") == "presence" and m["data"].get("is_online") is False:
                pytest.fail(f"Received premature offline presence: {m}")
        except asyncio.TimeoutError:
            pass  # expected

        # Now close last connection — offline event should fire
        await bws2.close()
        offline = await _wait_for_event(aws, "presence", timeout=5.0)
        assert offline["data"]["user_id"] == user_bob["user_id"]
        assert offline["data"]["is_online"] is False

        # REST confirms offline
        await asyncio.sleep(0.2)
        r2 = api.get(
            f"{base_url}/api/presence",
            params={"ids": user_bob["user_id"]},
            headers=_auth(user_alice["token"]),
        )
        assert r2.json() == {user_bob["user_id"]: False}
