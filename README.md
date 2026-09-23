# RoV CSV Pipeline Discord Bot — v3.1

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

Announcement channel is fixed by `ANNOUNCEMENT_CHANNEL_ID`.

Batch announcements are grouped by the CSV match time (for example 19:00, 20:00, 21:00, 22:00) and include Match Thread links.

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
ANNOUNCEMENT_CHANNEL_ID=...
TOURNAMENT_A_URL=https://challonge.com/1gv5vasi
```

Optional:

```text
STAFF_CHANNEL_ID=...
ALLOWED_ROLE_IDS=roleId1,roleId2
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
