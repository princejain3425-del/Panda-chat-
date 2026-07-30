"""WebSocket tests for /api/ws."""
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
    # Convert https:// → wss:// (or http:// → ws://)
    if BASE_URL.startswith("https://"):
        base = "wss://" + BASE_URL[len("https://"):]
    elif BASE_URL.startswith("http://"):
        base = "ws://" + BASE_URL[len("http://"):]
    else:
        base = BASE_URL
    return f"{base}/api/ws?token={token}"


@pytest.mark.asyncio
async def test_ws_invalid_token_closes_4401():
    url = _ws_url("definitely-not-valid")
    try:
        async with websockets.connect(url, open_timeout=10) as ws:
            # If server accepts then closes, receive will raise
            await asyncio.wait_for(ws.recv(), timeout=5)
        pytest.fail("WS should not remain open with invalid token")
    except websockets.exceptions.InvalidStatus as e:
        # Some servers send HTTP 401/403 during handshake — either is acceptable
        assert e.response.status_code in (401, 403, 400)
    except websockets.exceptions.ConnectionClosed as e:
        assert e.code == 4401
    except Exception as e:
        # Accept any error that indicates rejection
        assert "4401" in str(e) or "closed" in str(e).lower() or "401" in str(e)


@pytest.mark.asyncio
async def test_ws_connected_and_receives_message(user_alice, user_bob, api, base_url):
    # Ensure Alice has active WS; Bob sends a message to their conversation.
    # Create conversation as Alice.
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": user_bob["user_id"]},
        headers=_auth(user_alice["token"]),
    )
    assert r.status_code == 200
    cid = r.json()["conversation_id"]

    alice_url = _ws_url(user_alice["token"])
    async with websockets.connect(alice_url, open_timeout=10) as ws:
        # First message should be "connected"
        first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert first.get("event") == "connected"
        assert first.get("user_id") == user_alice["user_id"]

        # Bob sends a text message via HTTP
        send = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "hi alice via ws"},
            headers=_auth(user_bob["token"]),
        )
        assert send.status_code == 200

        # Alice's WS should receive the message event
        received = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
        assert received.get("event") == "message"
        assert received["data"]["text"] == "hi alice via ws"
        assert received["data"]["sender_id"] == user_bob["user_id"]
        assert received["data"]["conversation_id"] == cid
        assert "_id" not in received["data"]
