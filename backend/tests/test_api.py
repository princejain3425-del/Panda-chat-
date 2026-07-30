"""SageChat backend API tests — auth, users, conversations, messages, health.

Covers all features from the review request. WebSocket tests are in test_ws.py.
"""
import uuid
import pytest


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# ---------- Health ----------
class TestHealth:
    def test_root_ok(self, api, base_url):
        r = api.get(f"{base_url}/api/")
        assert r.status_code == 200
        data = r.json()
        assert data.get("ok") is True


# ---------- Auth guard & me ----------
class TestAuthGuards:
    def test_me_no_token(self, api, base_url):
        r = api.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid_bearer(self, api, base_url):
        r = api.get(f"{base_url}/api/auth/me", headers=auth("not-a-real-token"))
        assert r.status_code == 401

    def test_me_valid_session(self, api, base_url, user_alice):
        r = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user_id"] == user_alice["user_id"]
        assert data["email"] == user_alice["email"]
        assert "_id" not in data  # no mongo leak


# ---------- Users search ----------
class TestUsersSearch:
    def test_search_excludes_self(self, api, base_url, user_alice, user_bob):
        r = api.get(f"{base_url}/api/users/search", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        users = r.json()
        ids = [u["user_id"] for u in users]
        assert user_alice["user_id"] not in ids
        assert user_bob["user_id"] in ids
        for u in users:
            assert "_id" not in u

    def test_search_by_partial_name(self, api, base_url, user_alice, user_bob):
        # bob's name is "TEST Bob User" — search "bob" case-insensitive
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": "bOb"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        users = r.json()
        assert any(u["user_id"] == user_bob["user_id"] for u in users)

    def test_search_by_email_fragment(self, api, base_url, user_alice, user_bob):
        frag = user_bob["email"].split("@")[0][:8]
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": frag.upper()},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        users = r.json()
        assert any(u["user_id"] == user_bob["user_id"] for u in users)


# ---------- Conversations ----------
class TestConversations:
    def test_create_conversation(self, api, base_url, user_alice, user_bob):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "conversation_id" in data
        assert data["peer"]["user_id"] == user_bob["user_id"]
        assert "_id" not in data
        assert "_id" not in data["peer"]

    def test_create_conversation_idempotent(self, api, base_url, user_alice, user_bob):
        r1 = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=auth(user_alice["token"]),
        )
        r2 = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=auth(user_alice["token"]),
        )
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["conversation_id"] == r2.json()["conversation_id"]

    def test_create_conversation_with_self_400(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_alice["user_id"]},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_create_conversation_bad_peer_404(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": f"user_TEST_missing_{uuid.uuid4().hex[:6]}"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 404

    def test_list_conversations_sorted_desc(self, api, base_url, user_alice, user_bob, user_charlie):
        # Create two convos with a small message on each, differing timestamps.
        c1 = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_bob["user_id"]},
            headers=auth(user_alice["token"]),
        ).json()
        c2 = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": user_charlie["user_id"]},
            headers=auth(user_alice["token"]),
        ).json()
        # Send message on c1 first, then c2 — so c2 should sort first (latest updated_at).
        api.post(
            f"{base_url}/api/conversations/{c1['conversation_id']}/messages",
            json={"type": "text", "text": "hi bob"},
            headers=auth(user_alice["token"]),
        )
        api.post(
            f"{base_url}/api/conversations/{c2['conversation_id']}/messages",
            json={"type": "text", "text": "hi charlie"},
            headers=auth(user_alice["token"]),
        )
        r = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        convs = r.json()
        ids = [c["conversation_id"] for c in convs]
        assert c2["conversation_id"] in ids and c1["conversation_id"] in ids
        # c2 should come before c1
        assert ids.index(c2["conversation_id"]) < ids.index(c1["conversation_id"])
        for c in convs:
            assert "_id" not in c
            assert "_id" not in c.get("peer", {})


# ---------- Messages ----------
class TestMessages:
    def _create_convo(self, api, base_url, alice, bob):
        r = api.post(
            f"{base_url}/api/conversations",
            json={"peer_user_id": bob["user_id"]},
            headers=auth(alice["token"]),
        )
        assert r.status_code == 200
        return r.json()["conversation_id"]

    def test_send_text_updates_last_message(self, api, base_url, user_alice, user_bob):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "Hello Bob!"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["type"] == "text"
        assert msg["text"] == "Hello Bob!"
        assert msg["sender_id"] == user_alice["user_id"]
        assert "_id" not in msg

        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["last_message"] == "Hello Bob!"
        assert target["last_message_type"] == "text"

    def test_send_image_preview(self, api, base_url, user_alice, user_bob):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "image", "media_base64": "AAAA", "media_mime": "image/jpeg"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["type"] == "image"
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["last_message"] == "📷 Photo"
        assert target["last_message_type"] == "image"

    def test_send_video_preview(self, api, base_url, user_alice, user_bob):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "video", "media_base64": "BBBB", "media_mime": "video/mp4"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["type"] == "video"
        convs = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"])).json()
        target = next(c for c in convs if c["conversation_id"] == cid)
        assert target["last_message"] == "🎥 Video"
        assert target["last_message_type"] == "video"

    def test_send_empty_text_400(self, api, base_url, user_alice, user_bob):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "   "},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_send_non_participant_404(self, api, base_url, user_alice, user_bob, user_charlie):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        # charlie is not participant
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "sneaky"},
            headers=auth(user_charlie["token"]),
        )
        assert r.status_code == 404

    def test_list_messages_sorted_asc(self, api, base_url, user_alice, user_bob):
        cid = self._create_convo(api, base_url, user_alice, user_bob)
        for i in range(3):
            api.post(
                f"{base_url}/api/conversations/{cid}/messages",
                json={"type": "text", "text": f"m{i}"},
                headers=auth(user_alice["token"]),
            )
        r = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        msgs = r.json()
        assert [m["text"] for m in msgs] == ["m0", "m1", "m2"]
        for m in msgs:
            assert "_id" not in m


# ---------- Logout ----------
class TestLogout:
    def test_logout_invalidates_session(self, api, base_url, user_alice):
        # verify authenticated
        r = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        # logout
        r = api.post(f"{base_url}/api/auth/logout", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # subsequent /me → 401
        r = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"]))
        assert r.status_code == 401
