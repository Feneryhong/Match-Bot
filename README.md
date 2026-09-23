# v3.3.4 — Unified Round 512 Range Fix

- Range input now accepts normal pair ranges such as `87-107`.
- Supports `1-1`, `32-32`, `87-107`, etc.
- Round 512 range is validated as `1-256`.
- Accepts normal hyphen and copied en/em/minus dashes.
- No A/B selector is used for range input.

# RoV CSV Pipeline Discord Bot — v3.2

This build is the CSV-first pipeline agreed for the RoV tournament. It uses **Challonge A only** and does **not** call the Challonge API.

## Source of truth

```text
CSV
  -> Match/Pairs
  -> latest Roster message
  -> DB mapping
  -> Discord state
```

A Pair means **two teams in one match**. It does NOT mean Tournament side A vs Tournament side B.

CSV accepts:

```text
round,pair,team1,team2,challonge_match_id,time
```

For compatibility, `team_a/team_b` are also accepted. `challonge_match_id` is backend-only and is never used as the visible Pair number. `TBD` is supported.

## Current tournament

- Challonge A only
- Tournament URL: `https://challonge.com/1gv5vasi`
- CSV: `data/round512.csv`
- Open ID: `data/approved-teams-openid-cleaned.csv`

## Panel

- 🚀 สร้าง Match Batch
- 🧵 สร้างเฉพาะ Match Threads
- 🔊 สร้างเฉพาะ Team VC
- 🔍 ตรวจสอบ Team VC
- 🔄 อัปเดต Match Threads
- 🗑️ ลบ Threads ตามช่วง
- 🗑️ ลบ VC + Category ตามช่วง
- 📊 ตรวจสอบสถานะ
- ♻️ รีเฟรช Panel

There is no Staff Assign system in this build.

## Range format

Every range input uses:

- `1-32` = pairs 1 through 32
- `1-1` = pair 1 only
- `32-32` = pair 32 only

Invalid input returns an explicit message explaining the required format.

## Shared Match Logic

Batch, Thread-only, and VC-only use the same match/DB/Roster/Discord detection logic. They differ only in which outputs they are allowed to create/update.

### Batch

Creates/repairs:

1. Category (when a new VC is actually needed)
2. Two Team VCs
3. Match Thread
4. Welcome message
5. VC links inside the Thread
6. Open ID data inside the Thread
7. Staff Board entry
8. Grouped announcement by match time

### Thread-only

Creates or repairs only the Match Thread. It does **not** create VC, Category, Staff Board, or Announcement.

It still reads the DB + Discord state and posts the current VC links when those VCs already exist. If a VC is missing, it explicitly says so in the Thread.

### VC-only

Creates/repairs only Team VCs. It does not create Threads, Staff Board entries, or Announcements.

## Roster rules

`ROSTER_CHANNEL_ID` is fixed.

The bot reads the **latest message for each team**. It never falls back to an older valid message when the latest message is malformed.

Expected format:

```text
Team : TEAM NAME
```

The message author is added to the Team VC, together with mentioned users in that latest roster message.

Audit distinguishes:

- team found and format valid
- team found but latest format invalid
- missing team
- similar/ambiguous team name
- duplicate roster history (latest message is still the one used)
- missing mentions
- TBD

## VC safety / audit

`🔍 ตรวจสอบ Team VC` is strictly read-only. It creates, edits, and deletes nothing.

It compares:

- CSV expected teams
- latest Roster message
- DB mapping
- actual Discord Voice Channels

It reports exact team names, Pair numbers, latest roster author/time, message links, VC links, DB mismatches, duplicate VC names, `#2/#3` suffix cases, similar names, and missing/invalid data.

If a case is ambiguous, the create operation does not guess.

## DB safety

The bot checks both DB and Discord before creating objects.

- DB + Discord exists -> reuse
- DB says it exists but Discord is missing -> repair path
- Discord exists but DB has no mapping -> do not blindly create another VC
- Duplicate VC candidates -> stop that team and report them

The DB stores IDs for VC, Thread, Staff Board message, roster source message, roster author, completion status, and timestamps.

## Match Thread

Visible Thread name:

```text
TEAM 1 VS TEAM 2
```

No Challonge Match ID or internal Pair number is added to the visible Thread name.

Thread content includes:

1. Welcome/rules
2. Team VC links for both teams
3. Open ID data

If a Thread already exists and a VC link changes, the bot can post an updated VC-link block rather than creating a second Thread.

## Staff Board

Batch creates a Board entry containing:

- Round / Pair
- Time
- Team 1 VS Team 2
- Team 1 VC link
- Team 2 VC link
- Match Thread link **below the VC links**
- Challonge link
- `✅ แข่งเสร็จแล้ว`

When the button is pressed:

1. Always ask for confirmation.
2. On confirmation, archive the Match Thread.
3. Record who pressed it and when.
4. Disable the button permanently.
5. Keep VC and Category.

Pressing it again reports who already completed the Match.

## Announcements

Announcement is a separate operation. Each time Staff presses `📢 ประกาศ Match Threads`, the bot asks for the Round, Range, and the Discord channel to announce into. It never creates a Thread/VC as part of the standalone announcement operation.

Announcements are grouped by the CSV match time (for example 19:00, 20:00, 21:00, 22:00) and include existing Match Thread links. If a requested pair has no resolvable Thread, it is reported and skipped rather than created.

Batch still uses the same announcement logic, but asks for the announcement channel as the final channel selection.

## Thread Link Generator

`🔗 สร้าง Link Match` is read-only. It scans existing Discord private Team VCs whose names follow `#คู่ ชื่อทีม` (with `#2/#3` suffixes tolerated), groups them by pair number, derives `TEAM 1 VS TEAM 2`, and searches existing public Match Threads for that exact name in either order. It outputs clickable Discord links.

It does not create, edit, or delete anything. Duplicate VC/team cases and duplicate Threads are reported instead of guessing.

## Discord Developer Portal requirements

Enable these privileged intents for the bot:

- Message Content Intent

Recommended bot permissions for the target server:

- View Channels
- Send Messages
- Send Messages in Threads
- Create Public Threads
- Manage Threads
- Manage Channels
- Manage Messages (for Staff Board message updates)
- Mention Everyone (for `@everyone` announcements)
- Connect / Speak are not required as a bot voice client; the bot only manages VC permissions.

OAuth scopes:

- `bot`
- `applications.commands`

## Railway deployment

### 1. GitHub

Create a private GitHub repository and put the contents of this folder at the repository root. `package.json` must be in the repository root.

Do not commit `.env` or the persistent DB.

### 2. Railway

Railway -> New Project -> Deploy from GitHub Repo -> select the repository.

The start command is already in `package.json`:

```text
npm start
```

### 3. Variables

In Railway -> Service -> Variables, set at least:

```text
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
ROSTER_CHANNEL_ID=...
ALLOWED_USER_IDS=123456789012345678,987654321098765432
```

Optional:

```text
STAFF_CHANNEL_ID=...
MATCH_THREAD_PARENT_ID=...
STAFF_BOARD_CHANNEL_ID=...
```

The CSV and Open ID files are already inside the repository under `data/`.

### 4. Railway Volume — important

The DB path defaults to:

```text
/data/rov-csv-bot.json
```

Create a Railway Volume and mount it at `/data`. Without a persistent volume, the DB can be lost when the service is recreated/redeployed.

### 5. Deploy

Deploy and check logs for:

```text
✅ Logged in as ...
📦 Match CSV: ...
🪪 Open ID: ...
📋 Roster: ...
📢 Announcement: ...
🚫 Challonge API calls: DISABLED
```

### 6. First test

Do NOT start with 1-256.

Recommended:

```text
🔍 ตรวจสอบ Team VC
Round: 512
Range: 1-1
```

Fix every reported Roster/VC problem first.

Then test:

```text
🔊 สร้างเฉพาะ Team VC -> 1-1
🧵 สร้างเฉพาะ Match Threads -> 1-1
```

Verify the Thread contains both VC links and Open ID data.

Finally test:

```text
🚀 สร้าง Match Batch -> 1-1
```

Check Category, both VC permissions, Thread, VC links, Open ID, Staff Board, and Announcement before expanding the range.


## v3.3 changes

- Panel and operational responses are public (not ephemeral).
- Panel access is controlled by `ALLOWED_USER_IDS` (Discord User IDs), checked on every interaction.
- `📢 ประกาศ Match Threads` now previews missing Threads and requires confirmation; only existing Threads are announced.
- `🔗 สร้าง Link Match` first selects a Source Room, scans only Threads that exist there, then selects a Destination Room.
- Link Thread parser accepts only the exact visible format `XXX vs XXX` using lowercase `vs` with one separator. Invalid names are reported and never guessed. Duplicate matching Threads are reported and not auto-selected.
- Thread link output includes Thread link and VC links for both teams; missing or multiple VCs are explicitly reported.
- No Challonge API is used.

### Railway deploy/update

1. Replace the project files with this version and push to the GitHub repository connected to Railway.
2. Keep the existing Railway service and existing Volume mounted at `/data`.
3. In Railway Variables set: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`, `ROSTER_CHANNEL_ID`, and `ALLOWED_USER_IDS`.
4. Keep `MATCH_CSV_PATH=./data/round512.csv`, `OPENID_CSV_PATH=./data/approved-teams-openid-cleaned.csv`, and `DB_PATH=/data/rov-csv-bot.json` unless your deployment uses different paths.
5. `ALLOWED_ROLE_IDS` is no longer used. Remove it if present.
6. Commit/push. Railway will redeploy with `npm start`.
7. After deploy, run `/panel` in the configured Staff channel (if `STAFF_CHANNEL_ID` is set). Everyone can see the Panel, but only listed User IDs can operate it.

Recommended Discord permissions: View Channels, Send Messages, Read Message History, Use Application Commands, Manage Channels, Create Public Threads, Send Messages in Threads, Manage Threads, Manage Messages, Mention Everyone. Enable Message Content Intent.

Test in this order: `VC Audit 1-1` → `VC-only 1-1` → `Thread-only 1-1` → `Batch 1-1` → Announcement preview/confirm → Link Threads source/destination → expand to `1-5` → then larger ranges.


## v3.3.1 Link Match fix
- The Panel button is `🔗 สร้าง Link Match`.
- The Source → Destination flow no longer depends on an in-memory 10-minute pending state.
- The destination select stores the Source Room ID in its custom ID and rescans the Source when sending, so the flow does not show the old “รายการหมดอายุแล้ว” message just because the pending map expired or the bot restarted between steps.
- The old `thread_links` custom ID is still accepted for compatibility with an already-posted Panel message.
