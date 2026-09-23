# RoV CSV Pipeline Discord Bot v3.0

This version uses the exported tournament CSV as the primary match database/pipeline. It does **not** call the Challonge API.

## Pipeline
CSV -> local DB -> Discord Team VC + Match Thread + Welcome + Open ID + Staff Board + Announcement

## Fixed inputs
- `ROSTER_CHANNEL_ID`: fixed Team Roster channel. Messages are parsed from `Team : TEAM NAME` plus mentioned members.
- `ANNOUNCEMENT_CHANNEL_ID`: fixed announcement channel.
- `MATCH_CSV_PATH`: CSV exported/converted from the Challonge SVG.
- `OPENID_CSV_PATH`: Open ID database.

## CSV columns
`round,pair,team_a,team_b,challonge_match_id,time`

`pair` is the human/internal order inside a round. `challonge_match_id` is backend-only and is never shown in thread names.
`TBD` is allowed.

## Panel flow
1. Select Challonge A/B (metadata/link only; no API call)
2. 🚀 Create Match Batch
3. 🔧 Repair selected Match
4. 🔄 Update Match Threads
5. 🗑️ Delete Threads by range
6. 🗑️ Delete VC + Category by range
7. 📊 Status
8. ♻️ Refresh Panel

Batch selects:
- Round
- Pair range
- Match Thread parent channel
- Staff Board channel (optional if `STAFF_BOARD_CHANNEL_ID` is configured)

Roster and Announcement channels are fixed by env.

## Staff Board
No staff assignment system. Board entries include:
- match/team names
- time
- Challonge URL from configured A/B metadata, if present
- Team VC links
- Match Thread link
- `✅ แข่งเสร็จแล้ว` button

The complete button archives the Match Thread only. It does not delete VC/category.

## Open ID
After each Match Thread is created, the bot looks up both team names in the Open ID CSV and posts player + Open ID data in the thread. Missing teams are explicitly reported.

## Safety against duplicate Discord objects
The DB stores mapping IDs and the bot also checks Discord by names before creating objects. Re-running a batch is intended to create only missing objects.
