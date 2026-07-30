"""Iteration 3 tests: username, display_name, complete-profile, search-by-@username.

Extends existing suite. Uses fixtures from conftest.py but note: conftest seeds
users WITHOUT username/display_name (fresh-signup state) — perfect for these tests.
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}


# ---------- /auth/me returns new fields ----------
class TestAuthMeNewFields:
    def test_me_returns_null_username_and_display_name_for_fresh_user(self, api, base_url, user_alice):
        r = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"]))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "username" in data
        assert "display_name" in data
        assert data["username"] is None
        assert data["display_name"] is None


# ---------- /auth/username-available ----------
class TestUsernameAvailable:
    def test_requires_auth(self, api, base_url):
        r = api.get(f"{base_url}/api/auth/username-available", params={"u": "alice"})
        assert r.status_code == 401

    def test_valid_unused_returns_available_true_and_normalized(self, api, base_url, user_alice):
        uniq = f"newuser_{uuid.uuid4().hex[:6]}"
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": uniq},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["available"] is True
        assert body["username"] == uniq.lower()

    def test_uppercase_input_is_normalized_lowercase(self, api, base_url, user_alice):
        # Per spec: "Alice" (uppercase) should be normalized to lowercase and accepted.
        uniq = f"MixedCase_{uuid.uuid4().hex[:5]}"
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": uniq},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is True
        # Returned username should be normalized lowercase
        assert body["username"] == uniq.lower()

    def test_taken_username_returns_available_false(self, api, base_url, user_alice, user_bob):
        uname = f"taken_{uuid.uuid4().hex[:6]}"
        # Bob claims it
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob B", "username": uname},
            headers=auth(user_bob["token"]),
        )
        assert r.status_code == 200
        # Alice checks — should be unavailable
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": uname},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        assert r.json()["available"] is False

    def test_invalid_short_returns_false_with_reason(self, api, base_url, user_alice):
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": "ab"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        assert isinstance(body.get("reason"), str) and body["reason"]

    def test_invalid_long_returns_false_with_reason(self, api, base_url, user_alice):
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": "toolongusername12345678901"},  # 25 chars
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        assert isinstance(body.get("reason"), str) and body["reason"]

    def test_invalid_symbol_returns_false_with_reason(self, api, base_url, user_alice):
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": "alice!"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        assert isinstance(body.get("reason"), str) and body["reason"]

    def test_reserved_username_returns_false_with_reason(self, api, base_url, user_alice):
        for reserved in ["admin", "omega"]:
            r = api.get(
                f"{base_url}/api/auth/username-available",
                params={"u": reserved},
                headers=auth(user_alice["token"]),
            )
            assert r.status_code == 200
            body = r.json()
            assert body["available"] is False, f"{reserved} should be reserved"
            assert body.get("reason")

    def test_own_current_username_reports_available_true(self, api, base_url, user_alice):
        uname = f"selfown_{uuid.uuid4().hex[:6]}"
        # Alice claims it
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice A", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        # Alice checks her own currently-claimed username → available=true
        r = api.get(
            f"{base_url}/api/auth/username-available",
            params={"u": uname},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is True
        assert body["username"] == uname


# ---------- POST /auth/complete-profile ----------
class TestCompleteProfile:
    def test_requires_auth(self, api, base_url):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "X", "username": "someuser"},
        )
        assert r.status_code == 401

    def test_success_returns_updated_user(self, api, base_url, user_alice):
        uname = f"alice_{uuid.uuid4().hex[:6]}"
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "  Alice Wonderland  ", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["display_name"] == "Alice Wonderland"  # trimmed
        assert u["username"] == uname
        assert u["user_id"] == user_alice["user_id"]
        assert "_id" not in u

        # verify persisted via /me
        r = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        assert r.json()["username"] == uname
        assert r.json()["display_name"] == "Alice Wonderland"

    def test_uppercase_username_is_normalized_lowercase(self, api, base_url, user_alice):
        # Input "Alice_UPPER" should be normalized to lowercase
        raw = f"Alice_{uuid.uuid4().hex[:5].upper()}"
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "AliceU", "username": raw},
            headers=auth(user_alice["token"]),
        )
        # server-side: current validate_username lowercases FIRST, then regex-checks.
        # If it accepts, stored value should be lowercase; if not accepted, 400.
        # Per spec: "Alice" → normalized and accepted.
        assert r.status_code == 200, r.text
        assert r.json()["username"] == raw.lower()

    def test_display_name_too_short_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "   ", "username": f"ok_{uuid.uuid4().hex[:6]}"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_display_name_too_long_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "x" * 41, "username": f"ok_{uuid.uuid4().hex[:6]}"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_username_too_short_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": "ab"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_username_too_long_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": "toolongusername12345678901"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_username_invalid_symbol_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": "alice!"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_reserved_username_rejected(self, api, base_url, user_alice):
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": "admin"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400

    def test_username_conflict_409(self, api, base_url, user_alice, user_bob):
        uname = f"clash_{uuid.uuid4().hex[:6]}"
        r1 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r1.status_code == 200
        # Bob tries same
        r2 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob", "username": uname},
            headers=auth(user_bob["token"]),
        )
        assert r2.status_code == 409

    def test_username_conflict_case_insensitive_409(self, api, base_url, user_alice, user_bob):
        uname = f"lower_{uuid.uuid4().hex[:6]}"
        r1 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r1.status_code == 200
        # Bob tries same but UPPER
        r2 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob", "username": uname.upper()},
            headers=auth(user_bob["token"]),
        )
        assert r2.status_code == 409

    def test_update_own_profile_change_display_name(self, api, base_url, user_alice):
        uname = f"aupd_{uuid.uuid4().hex[:6]}"
        r1 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "First", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r1.status_code == 200
        # Change display_name, keep username same
        r2 = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Second Name", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["display_name"] == "Second Name"
        assert r2.json()["username"] == uname

    def test_update_own_profile_change_username(self, api, base_url, user_alice):
        uname1 = f"initial_{uuid.uuid4().hex[:6]}"
        uname2 = f"changed_{uuid.uuid4().hex[:6]}"
        api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": uname1},
            headers=auth(user_alice["token"]),
        )
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Alice", "username": uname2},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        assert r.json()["username"] == uname2
        # verify via /me
        me = api.get(f"{base_url}/api/auth/me", headers=auth(user_alice["token"])).json()
        assert me["username"] == uname2


# ---------- Search by @username ----------
class TestSearchByUsername:
    def test_search_at_prefix_matches_username(self, api, base_url, user_alice, user_bob):
        uname = f"alice_{uuid.uuid4().hex[:6]}"
        # Bob claims it (so Alice can search & find Bob)
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob-Alice", "username": uname},
            headers=auth(user_bob["token"]),
        )
        assert r.status_code == 200
        # Search with @<prefix>
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": f"@{uname[:5]}"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        ids = [u["user_id"] for u in r.json()]
        assert user_bob["user_id"] in ids
        assert user_alice["user_id"] not in ids

    def test_search_at_prefix_case_insensitive(self, api, base_url, user_alice, user_bob):
        uname = f"charlie_{uuid.uuid4().hex[:6]}"
        api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob C", "username": uname},
            headers=auth(user_bob["token"]),
        )
        # Search using UPPER
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": f"@{uname[:5].upper()}"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        ids = [u["user_id"] for u in r.json()]
        assert user_bob["user_id"] in ids

    def test_search_by_display_name_partial(self, api, base_url, user_alice, user_bob):
        # Bob sets display_name = "Bobby McTest <suffix>"
        dn = f"Bobby McTest {uuid.uuid4().hex[:5]}"
        api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": dn, "username": f"bmt_{uuid.uuid4().hex[:5]}"},
            headers=auth(user_bob["token"]),
        )
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": "bobby mctest"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        ids = [u["user_id"] for u in r.json()]
        assert user_bob["user_id"] in ids

    def test_search_by_username_partial_no_at_prefix(self, api, base_url, user_alice, user_bob):
        uname = f"partable_{uuid.uuid4().hex[:5]}"
        api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Bob", "username": uname},
            headers=auth(user_bob["token"]),
        )
        # search without @ — should still match on username
        r = api.get(
            f"{base_url}/api/users/search",
            params={"q": "partable"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        ids = [u["user_id"] for u in r.json()]
        assert user_bob["user_id"] in ids


# ---------- Sparse unique index behavior ----------
class TestSparseUniqueIndex:
    def test_two_users_can_have_null_username(self, api, base_url, user_alice, user_bob, mongo_db):
        # Both freshly seeded fixtures have no username (None/missing).
        # Confirm both are present in DB with username None.
        a = mongo_db.users.find_one({"user_id": user_alice["user_id"]})
        b = mongo_db.users.find_one({"user_id": user_bob["user_id"]})
        assert a is not None and b is not None
        assert a.get("username") in (None,) and b.get("username") in (None,)

        # And one can still claim a username without affecting the other.
        uname = f"claimer_{uuid.uuid4().hex[:6]}"
        r = api.post(
            f"{base_url}/api/auth/complete-profile",
            json={"display_name": "Claimer", "username": uname},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200
        # Bob remains username-less
        b2 = mongo_db.users.find_one({"user_id": user_bob["user_id"]})
        assert b2.get("username") in (None,)

    def test_partial_index_allows_multiple_stub_null_users(self, mongo_db):
        # Directly create 2 stub users w/o username; ensure both exist (no dup-key error).
        now = datetime.now(timezone.utc)
        ids = []
        try:
            for i in range(2):
                uid = f"user_TEST_sparse_{uuid.uuid4().hex[:8]}"
                mongo_db.users.insert_one({
                    "user_id": uid,
                    "email": f"TEST_sparse_{uuid.uuid4().hex[:6]}@example.com",
                    "name": f"TEST sparse {i}",
                    "picture": None,
                    "created_at": now,
                })
                ids.append(uid)
            assert mongo_db.users.count_documents({"user_id": {"$in": ids}}) == 2
        finally:
            mongo_db.users.delete_many({"user_id": {"$in": ids}})
