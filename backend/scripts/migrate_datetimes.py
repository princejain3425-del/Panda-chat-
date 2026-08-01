#!/usr/bin/env python3
"""
One-time migration script: make naive datetimes in MongoDB UTC-aware by adding tzinfo=UTC.
Run after backing up your database and while the service is stopped (or in maintenance mode).

Usage:
  python backend/scripts/migrate_datetimes.py --mongo-url mongodb://127.0.0.1:27017 --db panda_chat_dev

This will update the following fields when they are naive (no tzinfo):
 - messages.created_at
 - messages.read_at
 - conversations.created_at
 - conversations.updated_at
 - users.created_at
 - user_sessions.expires_at

Be cautious: test on a staging copy first.
"""

import argparse
import asyncio
from datetime import timezone
from motor.motor_asyncio import AsyncIOMotorClient


async def migrate(mongo_url: str, db_name: str, dry_run: bool = False):
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    updated_counts = {}

    # Helper to check tzinfo safely
    def is_naive(dt):
        return getattr(dt, "tzinfo", None) is None

    # messages
    cnt = 0
    async for m in db.messages.find({}, {"_id": 1, "created_at": 1, "read_at": 1}):
        upd = {}
        if "created_at" in m and m["created_at"] and is_naive(m["created_at"]):
            upd["created_at"] = m["created_at"].replace(tzinfo=timezone.utc)
        if "read_at" in m and m["read_at"] and is_naive(m["read_at"]):
            upd["read_at"] = m["read_at"].replace(tzinfo=timezone.utc)
        if upd:
            if not dry_run:
                await db.messages.update_one({"_id": m["_id"]}, {"$set": upd})
            cnt += 1
    updated_counts["messages"] = cnt

    # conversations
    cnt = 0
    async for c in db.conversations.find({}, {"_id": 1, "created_at": 1, "updated_at": 1}):
        upd = {}
        if "created_at" in c and c["created_at"] and is_naive(c["created_at"]):
            upd["created_at"] = c["created_at"].replace(tzinfo=timezone.utc)
        if "updated_at" in c and c["updated_at"] and is_naive(c["updated_at"]):
            upd["updated_at"] = c["updated_at"].replace(tzinfo=timezone.utc)
        if upd:
            if not dry_run:
                await db.conversations.update_one({"_id": c["_id"]}, {"$set": upd})
            cnt += 1
    updated_counts["conversations"] = cnt

    # users
    cnt = 0
    async for u in db.users.find({}, {"_id": 1, "created_at": 1}):
        upd = {}
        if "created_at" in u and u["created_at"] and is_naive(u["created_at"]):
            upd["created_at"] = u["created_at"].replace(tzinfo=timezone.utc)
        if upd:
            if not dry_run:
                await db.users.update_one({"_id": u["_id"]}, {"$set": upd})
            cnt += 1
    updated_counts["users"] = cnt

    # user_sessions
    cnt = 0
    async for s in db.user_sessions.find({}, {"_id": 1, "expires_at": 1, "created_at": 1}):
        upd = {}
        if "expires_at" in s and s["expires_at"] and is_naive(s["expires_at"]):
            upd["expires_at"] = s["expires_at"].replace(tzinfo=timezone.utc)
        if "created_at" in s and s["created_at"] and is_naive(s["created_at"]):
            upd["created_at"] = s["created_at"].replace(tzinfo=timezone.utc)
        if upd:
            if not dry_run:
                await db.user_sessions.update_one({"_id": s["_id"]}, {"$set": upd})
            cnt += 1
    updated_counts["user_sessions"] = cnt

    client.close()
    return updated_counts


def main():
    parser = argparse.ArgumentParser(description="Migrate naive datetimes in MongoDB to UTC-aware datetimes")
    parser.add_argument("--mongo-url", required=True, help="MongoDB connection URL")
    parser.add_argument("--db", required=True, help="Database name")
    parser.add_argument("--dry-run", action="store_true", help="Don't write changes, only report")
    args = parser.parse_args()

    print("Starting migration (dry-run=%s)" % args.dry_run)
    results = asyncio.run(migrate(args.mongo_url, args.db, dry_run=args.dry_run))
    print("Migration summary:")
    for k, v in results.items():
        print(f"  {k}: {v} documents updated")
    print("Done. If --dry-run was used, run again without it to apply changes.")


if __name__ == "__main__":
    main()
