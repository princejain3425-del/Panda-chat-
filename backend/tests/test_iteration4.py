"""Iteration 4 tests: document message type (send arbitrary files: PDF, docs, etc.)

Extends the existing suite. Covers:
- Sending a `document` message with filename/filesize/media_mime/media_base64
- Conversation last_message preview becomes `📎 <filename>` and last_message_type=='document'
- GET messages returns full document fields
- Missing media_base64 → 400
- Unknown type (e.g. 'audio', 'sticker') → 422 pydantic Literal validation
- Regression: text/image/video previews still correct
- Regression: read receipts still work — filename/filesize preserved through mark-read
"""
import base64
import uuid

import pytest


def auth(token: str):
    return {"Authorization": f"Bearer {token}"}


def _open_convo(api, base_url, from_user, to_user):
    r = api.post(
        f"{base_url}/api/conversations",
        json={"peer_user_id": to_user["user_id"]},
        headers=auth(from_user["token"]),
    )
    assert r.status_code == 200, r.text
    return r.json()["conversation_id"]


B64_PDF = base64.b64encode(b"%PDF-1.4\n%mock pdf bytes for testing\n").decode()


# ---------- Send a document message ----------
class TestSendDocument:
    def test_send_document_returns_full_message(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        payload = {
            "type": "document",
            "media_base64": B64_PDF,
            "media_mime": "application/pdf",
            "filename": "report.pdf",
            "filesize": 12345,
        }
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json=payload,
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        m = r.json()
        # all echoed fields
        assert m["type"] == "document"
        assert m["media_base64"] == B64_PDF
        assert m["media_mime"] == "application/pdf"
        assert m["filename"] == "report.pdf"
        assert m["filesize"] == 12345
        # plus standard fields
        assert m["conversation_id"] == cid
        assert m["sender_id"] == user_alice["user_id"]
        assert "message_id" in m and m["message_id"]
        assert "created_at" in m and m["created_at"]
        assert m["read_at"] is None
        assert "_id" not in m

    def test_send_document_updates_last_message_preview(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "media_base64": B64_PDF,
                "media_mime": "application/pdf",
                "filename": "invoice_q4.pdf",
                "filesize": 4567,
            },
            headers=auth(user_alice["token"]),
        ).raise_for_status()

        r = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        assert r.status_code == 200
        convos = r.json()
        my_c = next((c for c in convos if c["conversation_id"] == cid), None)
        assert my_c is not None
        assert my_c["last_message"] == "📎 invoice_q4.pdf"
        assert my_c["last_message_type"] == "document"
        assert my_c["last_sender_id"] == user_alice["user_id"]

    def test_get_messages_returns_document_fields_intact(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "media_base64": B64_PDF,
                "media_mime": "application/pdf",
                "filename": "spec.pdf",
                "filesize": 999,
            },
            headers=auth(user_alice["token"]),
        ).raise_for_status()

        r = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=auth(user_bob["token"]),
        )
        assert r.status_code == 200
        msgs = r.json()
        doc_msg = next((m for m in msgs if m["type"] == "document"), None)
        assert doc_msg is not None
        assert doc_msg["filename"] == "spec.pdf"
        assert doc_msg["filesize"] == 999
        assert doc_msg["media_mime"] == "application/pdf"
        assert doc_msg["media_base64"] == B64_PDF

    def test_send_document_missing_media_returns_400(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "filename": "no_media.pdf",
                "filesize": 100,
                "media_mime": "application/pdf",
            },
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400, r.text
        assert "media" in r.text.lower()

    def test_send_document_without_filename_still_previews(self, api, base_url, user_alice, user_bob):
        # Edge case: filename omitted → preview should fall back to "📎 File"
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "media_base64": B64_PDF,
                "media_mime": "application/octet-stream",
            },
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["filename"] is None

        r2 = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        my_c = next(c for c in r2.json() if c["conversation_id"] == cid)
        assert my_c["last_message"] == "📎 File"
        assert my_c["last_message_type"] == "document"


# ---------- Pydantic Literal validation ----------
class TestUnknownTypeValidation:
    @pytest.mark.parametrize("bad_type", ["audio", "sticker", "gif", "location", ""])
    def test_unknown_type_returns_422(self, api, base_url, user_alice, user_bob, bad_type):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": bad_type,
                "media_base64": B64_PDF,
                "media_mime": "application/octet-stream",
                "filename": "x",
                "filesize": 1,
            },
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 422, f"type={bad_type!r} got {r.status_code}: {r.text}"


# ---------- Regression: text/image/video still work ----------
class TestRegressionOtherTypes:
    def test_text_preview_still_correct(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "text", "text": "Hello world"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["type"] == "text" and m["text"] == "Hello world"
        assert m["filename"] is None and m["filesize"] is None

        r2 = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        my_c = next(c for c in r2.json() if c["conversation_id"] == cid)
        assert my_c["last_message"] == "Hello world"
        assert my_c["last_message_type"] == "text"

    def test_image_preview_still_correct(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "image",
                "media_base64": B64_PDF,  # any base64 will do
                "media_mime": "image/png",
            },
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["type"] == "image"
        r2 = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        my_c = next(c for c in r2.json() if c["conversation_id"] == cid)
        assert my_c["last_message"] == "📷 Photo"
        assert my_c["last_message_type"] == "image"

    def test_video_preview_still_correct(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "video",
                "media_base64": B64_PDF,
                "media_mime": "video/mp4",
            },
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 200, r.text
        r2 = api.get(f"{base_url}/api/conversations", headers=auth(user_alice["token"]))
        my_c = next(c for c in r2.json() if c["conversation_id"] == cid)
        assert my_c["last_message"] == "🎥 Video"
        assert my_c["last_message_type"] == "video"

    def test_image_missing_media_still_400(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        r = api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={"type": "image", "media_mime": "image/png"},
            headers=auth(user_alice["token"]),
        )
        assert r.status_code == 400


# ---------- Regression: read receipts preserve doc fields ----------
class TestReadReceiptsPreserveDocumentFields:
    def test_mark_read_keeps_filename_filesize_intact(self, api, base_url, user_alice, user_bob):
        cid = _open_convo(api, base_url, user_alice, user_bob)
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "media_base64": B64_PDF,
                "media_mime": "application/pdf",
                "filename": "keep_me.pdf",
                "filesize": 4242,
            },
            headers=auth(user_alice["token"]),
        ).raise_for_status()

        # Bob marks conversation as read
        r = api.post(
            f"{base_url}/api/conversations/{cid}/read",
            headers=auth(user_bob["token"]),
        )
        assert r.status_code == 200, r.text
        assert r.json()["updated"] >= 1

        # Bob refetches messages; document fields should still be intact and read_at should be set
        r = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=auth(user_bob["token"]),
        )
        assert r.status_code == 200
        doc = next(m for m in r.json() if m["type"] == "document")
        assert doc["filename"] == "keep_me.pdf"
        assert doc["filesize"] == 4242
        assert doc["media_mime"] == "application/pdf"
        assert doc["media_base64"] == B64_PDF
        assert doc["read_at"] is not None

        # Second mark-read cycle: send another doc, then read again
        api.post(
            f"{base_url}/api/conversations/{cid}/messages",
            json={
                "type": "document",
                "media_base64": B64_PDF,
                "media_mime": "application/pdf",
                "filename": "second.pdf",
                "filesize": 111,
            },
            headers=auth(user_alice["token"]),
        ).raise_for_status()
        api.post(f"{base_url}/api/conversations/{cid}/read", headers=auth(user_bob["token"]))

        r = api.get(
            f"{base_url}/api/conversations/{cid}/messages",
            headers=auth(user_bob["token"]),
        )
        docs = [m for m in r.json() if m["type"] == "document"]
        assert len(docs) == 2
        for d in docs:
            assert d["filename"] in ("keep_me.pdf", "second.pdf")
            assert d["filesize"] in (4242, 111)
            assert d["read_at"] is not None
