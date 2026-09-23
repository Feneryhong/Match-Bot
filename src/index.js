require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const {
  Client, GatewayIntentBits, PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder
} = require('discord.js');

const env = process.env;
const TOKEN = env.DISCORD_TOKEN;
const CLIENT_ID = env.CLIENT_ID;
const GUILD_ID = env.GUILD_ID;
const STAFF_CHANNEL_ID = env.STAFF_CHANNEL_ID || '';
const ALLOWED_USER_IDS = (env.ALLOWED_USER_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const ROSTER_CHANNEL_ID = env.ROSTER_CHANNEL_ID || '';
const MATCH_THREAD_PARENT_ID = env.MATCH_THREAD_PARENT_ID || '';
const STAFF_BOARD_CHANNEL_ID = env.STAFF_BOARD_CHANNEL_ID || '';
const DB_PATH = env.DB_PATH || '/data/rov-csv-bot.json';
const MATCH_CSV_PATH = env.MATCH_CSV_PATH || path.join(__dirname, '..', 'data', 'round512.csv');
const OPENID_CSV_PATH = env.OPENID_CSV_PATH || path.join(__dirname, '..', 'data', 'approved-teams-openid-cleaned.csv');
const CATEGORY_PREFIX = env.CATEGORY_PREFIX_A || 'CA';
const TOURNAMENT_NAME = env.TOURNAMENT_A_NAME || 'Challonge A';
const BUILD_ID = 'v3.3.10-R512-TEAM-NAME-NORMALIZE';
const THREAD_AUTO_ARCHIVE_MINUTES = Number(env.THREAD_AUTO_ARCHIVE_MINUTES || 10080);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) throw new Error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID');
if (!ROSTER_CHANNEL_ID) throw new Error('Missing ROSTER_CHANNEL_ID');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const pending = new Map();

const WELCOME = env.THREAD_WELCOME_MESSAGE ||
`🚨 **กฎสำคัญก่อนเริ่มการแข่งขัน**\n\n` +
`📖 **กฎการแข่งขันฉบับเต็ม**\nอ่านรายละเอียดทั้งหมดได้ที่:\nhttps://docs.google.com/document/d/1ScktekJaUwQfPqSAcE1i1A-JQzzdgR83IgD8w58TS2Q/edit?tab=t.0\n\n` +
`🕖 **1. เวลาแข่งขัน**\n• ให้ยึดเวลาที่ทีมงานกำหนดเป็นหลัก\n• หากมาช้ากว่าเวลาที่กำหนดเกิน 15 นาที ปรับแพ้ทันที\n• กรุณาเข้าห้องแข่งขันและเตรียมตัวให้พร้อมก่อนเวลา\n\n` +
`🪪 **2. การยืนยันตัวตน / Open ID**\n• ทั้งสองทีมต้องตรวจสอบ Open ID ของผู้เล่นทีมคู่แข่ง\n• ตรวจสอบว่า Open ID ตรงกับข้อมูลที่ลงทะเบียนไว้\n• หากพบข้อมูลไม่ตรงหรือมีข้อสงสัย ให้เก็บหลักฐานและแจ้ง Staff ก่อนแข่ง\n\n` +
`🎮 **3. รูปแบบการแข่งขัน**\n• รอบออนไลน์แข่งขันแบบ BO3\n• ใช้โหมด Normal Ban Pick\n• ใช้เซิร์ฟเวอร์หลัก (Live Server) เท่านั้น\n\n` +
`🚫 **4. สิ่งที่ห้ามทำ**\n• ห้ามใช้โปรแกรมช่วยเหลือหรือโปรแกรมภายนอกที่ไม่ได้รับอนุญาต\n• ห้ามใช้บั๊กเพื่อให้ได้เปรียบ\n• ห้าม Intentional Disconnect หรือจงใจโยนเกม\n\n` +
`⚠️ **5. สำคัญ**\n• หากมีปัญหา ให้หยุดการแข่งขันและเรียก Staff ก่อนดำเนินการต่อ\n\n` +
`Match: {MATCH}\nRound: {ROUND}`;

function ensureDbDir() { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); }
function defaultDb() {
  return {
    version: 2,
    matches: {},
    roster: {},
    threads: {},
    boards: {},
    vcs: {},
    announcements: {},
    batches: {},
    updatedAt: null
  };
}
function loadDb() {
  ensureDbDir();
  if (!fs.existsSync(DB_PATH)) return defaultDb();
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return { ...defaultDb(), ...parsed, matches: parsed.matches || {}, roster: parsed.roster || {}, threads: parsed.threads || {}, boards: parsed.boards || {}, vcs: parsed.vcs || {}, announcements: parsed.announcements || {}, batches: parsed.batches || {} };
  } catch (e) {
    console.error('DB read failed:', e);
    return defaultDb();
  }
}
let db = loadDb();
function saveDb() {
  ensureDbDir();
  db.updatedAt = new Date().toISOString();
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function norm(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[“”‘’'`]/g, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Team-name matching key: keep letters/numbers (including Thai and Latin Unicode),
// but ignore emoji, gender symbols, variation selectors, ZWJ, punctuation and spacing.
// This prevents names such as `FairyFury ?‍♀️` from failing roster/VC/thread matching
// because of invisible Unicode/emoji sequences while preserving the real display name.
function normTeam(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF\uFE0E\uFE0F]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}
function compact(value) { return norm(value).replace(/[^a-z0-9ก-๙]+/g, ''); }
function isTbd(value) { return norm(value) === 'tbd' || !String(value || '').trim(); }
function discordUrl(guildId, channelId, messageId = '') {
  return `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`;
}
function linkChannel(guildId, channelId, label) { return channelId ? `[${label || 'เปิดห้อง'}](${discordUrl(guildId, channelId)})` : '—'; }
// Use Discord channel mentions in Link Match output to avoid rich Discord VC/channel cards.
function mentionChannel(channelId) { return channelId ? `<#${channelId}>` : '—'; }
function linkMessage(guildId, channelId, messageId, label) { return messageId ? `[${label || 'เปิดข้อความล่าสุด'}](${discordUrl(guildId, channelId, messageId)})` : '—'; }

function staff(interaction) {
  if (!interaction.inGuild()) return false;
  return ALLOWED_USER_IDS.includes(String(interaction.user.id));
}
function staffGuard(interaction) {
  if (!staff(interaction)) return '❌ คุณไม่มีสิทธิ์ใช้งาน Panel นี้';
  if (STAFF_CHANNEL_ID && interaction.channelId !== STAFF_CHANNEL_ID) return `❌ ใช้ Panel ได้เฉพาะ <#${STAFF_CHANNEL_ID}>`;
  return null;
}
function publicDenied(interaction, message) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content: message, components: [] }).catch(() => {});
  return interaction.reply({ content: message });
}
async function getChannel(guild, id) { return guild.channels.cache.get(id) || await guild.channels.fetch(id).catch(() => null); }

function normalizeHeader(value) { return compact(value); }
function findColumn(row, aliases) {
  const keys = Object.keys(row || {});
  const map = new Map(keys.map(k => [normalizeHeader(k), k]));
  for (const alias of aliases) {
    const hit = map.get(normalizeHeader(alias));
    if (hit) return hit;
  }
  return null;
}
function readCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`ไม่พบ Match CSV: ${file}`);
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('ไม่พบ Sheet ใน Match CSV');
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) throw new Error('Match CSV ไม่มีข้อมูล');
  const sample = rows[0];
  const roundCol = findColumn(sample, ['round']);
  const pairCol = findColumn(sample, ['pair']);
  const team1Col = findColumn(sample, ['team1', 'team 1', 'team_a', 'team a', 'Team A']);
  const team2Col = findColumn(sample, ['team2', 'team 2', 'team_b', 'team b', 'Team B']);
  const idCol = findColumn(sample, ['challonge_match_id', 'match id', 'match_id']);
  const timeCol = findColumn(sample, ['time', 'เวลา']);
  if (!roundCol || !pairCol || !team1Col || !team2Col) throw new Error('CSV ต้องมี round,pair,team1,team2 (หรือ team_a/team_b)');
  const result = rows.map(row => ({
    round: String(row[roundCol] || '').trim(),
    pair: Number(row[pairCol]),
    team1: String(row[team1Col] || 'TBD').trim() || 'TBD',
    team2: String(row[team2Col] || 'TBD').trim() || 'TBD',
    challongeMatchId: String(idCol ? row[idCol] || '' : '').trim(),
    time: String(timeCol ? row[timeCol] || '' : '').trim()
  })).filter(x => x.round && Number.isInteger(x.pair));
  return result;
}
function getMatches(round, start, end) {
  return readCsv(MATCH_CSV_PATH)
    .filter(m => String(m.round) === String(round) && m.pair >= start && m.pair <= end)
    .sort((a, b) => a.pair - b.pair);
}

function readOpenId() {
  if (!fs.existsSync(OPENID_CSV_PATH)) return new Map();
  const wb = XLSX.read(fs.readFileSync(OPENID_CSV_PATH), { type: 'buffer', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return new Map();
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  if (!rows.length) return new Map();
  const teamCol = findColumn(rows[0], ['Team', 'Team Name', 'ชื่อทีม', 'ทีม']);
  const playerCol = findColumn(rows[0], ['In-game Name', 'In game Name', 'IGN', 'Player', 'Player Name', 'ชื่อผู้เล่น', 'ผู้เล่น', 'Name']);
  const oidCol = findColumn(rows[0], ['Open ID', 'OpenID', 'Open_ID', 'เลขไอดี', 'ไอดี']);
  if (!teamCol || !oidCol) return new Map();
  const map = new Map();
  for (const row of rows) {
    const team = String(row[teamCol] || '').trim();
    const player = String(playerCol ? row[playerCol] || '' : '').trim();
    const openId = String(row[oidCol] || '').trim();
    if (!team || !openId) continue;
    const key = normTeam(team);
    if (!map.has(key)) map.set(key, { teamName: team, players: [] });
    map.get(key).players.push({ playerName: player || 'ผู้เล่น', openId });
  }
  return map;
}
const openIds = readOpenId();
function splitDiscordText(blocks, max = 1900) {
  const out = []; let current = '';
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= max) current = candidate;
    else { if (current) out.push(current); current = block.length <= max ? block : block.slice(0, max); }
  }
  if (current) out.push(current);
  return out;
}
function openIdChunks(teamNames) {
  const blocks = ['🪪 **ข้อมูลผู้เข้าแข่งขัน**'];
  for (const team of [...new Set(teamNames.filter(Boolean))]) {
    if (isTbd(team)) { blocks.push('**TBD**\n⚠️ ยังไม่มีข้อมูลทีม'); continue; }
    const data = openIds.get(normTeam(team));
    if (!data) { blocks.push(`⚠️ **ไม่พบข้อมูล Open ID ของ ${team} ใน CSV**`); continue; }
    blocks.push(`**${data.teamName}**\n${data.players.map(p => `${p.playerName} — \`${p.openId}\``).join('\n')}`);
  }
  blocks.push('⚠️ ทั้งสองทีมต้องตรวจสอบ Open ID ของคู่แข่งก่อนเริ่มการแข่งขัน');
  return splitDiscordText(blocks);
}

function parseRosterMessage(message) {
  const content = String(message.content || '');
  const match = content.match(/^\s*Team\s*:\s*(.*?)\s*$/im);
  if (!match) return null;
  const rawTeam = match[1].trim();
  if (!rawTeam) return { format: 'invalid', reason: 'พบ `Team :` แต่ไม่มีชื่อทีม' };
  const mentionedUserIds = [...message.mentions.users.keys()];
  return {
    format: 'valid',
    teamName: rawTeam,
    teamKey: norm(rawTeam),
    messageId: message.id,
    channelId: message.channelId,
    createdTimestamp: message.createdTimestamp,
    authorId: message.author?.id || null,
    authorTag: message.author?.tag || message.author?.username || message.author?.id || 'Unknown',
    mentionedUserIds,
    content
  };
}
async function fetchAllMessages(channel) {
  const result = []; let before;
  for (let page = 0; page < 1000; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    result.push(...batch.values());
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return result;
}

async function buildRosterAudit(guild, requestedTeams, preloadedMessages = null) {
  const channel = await getChannel(guild, ROSTER_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('ไม่พบ Team Roster Channel หรือ Channel ไม่ใช่ Text Channel');
  const messages = preloadedMessages || await fetchAllMessages(channel);
  const all = messages.map(parseRosterMessage).filter(Boolean);
  const valid = all.filter(x => x.format === 'valid');

  const result = new Map();
  for (const team of requestedTeams) {
    if (isTbd(team)) { result.set(normTeam(team), { status: 'tbd', teamName: team }); continue; }
    const teamKey = normTeam(team);

    // IMPORTANT: choose the latest message mentioning this team BEFORE deciding format.
    // This prevents an old valid message from being used when the newest message is malformed.
    const matchingMessages = messages
      .filter(m => {
        const parsed = parseRosterMessage(m);
        if (parsed?.format === 'valid' && normTeam(parsed.teamName) === teamKey) return true;
        const content = String(m.content || '');
        const compactContent = compact(content);
        const compactTeam = compact(team);
        if (compactTeam.length < 3 || !compactContent.includes(compactTeam)) return false;
        const lines = content.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
        return /\bteam\b/i.test(content) || lines.some(line => compact(line) === compactTeam);
      })
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    const latestRaw = matchingMessages[0] || null;
    const latestParsed = latestRaw ? parseRosterMessage(latestRaw) : null;

    const exactValid = valid
      .filter(x => normTeam(x.teamName) === teamKey)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    if (latestRaw && latestParsed?.format === 'valid' && norm(latestParsed.teamName) === teamKey) {
      const item = { status: 'found', teamName: team, roster: latestParsed };
      if (exactValid.length > 1) item.duplicateHistory = exactValid;
      if (!latestParsed.mentionedUserIds.length) item.formatIssue = 'ไม่พบ @mention สมาชิกในข้อความล่าสุด';
      result.set(teamKey, item);
      continue;
    }

    if (latestRaw) {
      result.set(teamKey, {
        status: 'format_invalid',
        teamName: team,
        latestRaw: {
          messageId: latestRaw.id,
          channelId: latestRaw.channelId,
          createdTimestamp: latestRaw.createdTimestamp,
          authorId: latestRaw.author?.id || null,
          content: String(latestRaw.content || '')
        },
        oldValid: exactValid[0] || null
      });
      continue;
    }

    const candidates = valid.filter(x => compact(x.teamName).includes(compact(team)) || compact(team).includes(compact(x.teamName)));
    if (candidates.length === 1) result.set(teamKey, { status: 'similar', teamName: team, roster: candidates[0], candidates });
    else if (candidates.length > 1) result.set(teamKey, { status: 'ambiguous', teamName: team, candidates });
    else result.set(teamKey, { status: 'missing', teamName: team });
  }

  return { channel, result, messageCount: messages.length, messages };
}
function rosterMemberIds(roster) {
  if (!roster) return [];
  return [...new Set([roster.authorId, ...(roster.mentionedUserIds || [])].filter(Boolean).map(String))];
}
function rosterMessageUrl(guild, roster) { return roster ? discordUrl(guild.id, roster.channelId, roster.messageId) : null; }

async function getCategory(guild, pair) {
  const start = Math.floor((pair - 1) / 25) * 25 + 1;
  const end = start + 24;
  const name = `${CATEGORY_PREFIX} คู่ ${start}-${end}`;
  let category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === name);
  if (!category) category = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'CSV tournament pipeline' });
  return category;
}
function privateOverwrites(guild, memberIds) {
  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] }];
  for (const id of [...new Set(memberIds.map(String))]) overwrites.push({ id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] });
  return overwrites;
}
function vcBaseName(pair, team) { return `#${pair} ${team}`.slice(0, 100); }
function stripVcDecorations(channelName) {
  return norm(channelName).replace(/^#\d+\s+/u, '').replace(/\s+#\d+$/u, '').trim();
}
function vcNameMatches(team, channelName, pair) {
  const target = norm(vcBaseName(pair, team));
  const actual = norm(channelName);
  if (actual === target) return { kind: 'exact', score: 100 };
  const withoutSuffix = actual.replace(/\s+#\d+$/u, '');
  const targetWithout = target.replace(/\s+#\d+$/u, '');
  if (withoutSuffix === targetWithout) return { kind: 'suffix', score: 90 };
  return null;
}
function vcTeamNameMatches(team, channelName) {
  return normTeam(stripVcDecorations(channelName)) === normTeam(team);
}
async function allVoiceChannels(guild) {
  await guild.channels.fetch();
  return [...guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildVoice);
}
function isPrivateTeamVc(channel) {
  const ow = channel.permissionOverwrites?.cache?.get(channel.guild.roles.everyone.id);
  return !!ow && ow.deny.has(PermissionsBitField.Flags.ViewChannel) && ow.deny.has(PermissionsBitField.Flags.Connect);
}
function findVcCandidates(voiceChannels, team, pair) {
  return voiceChannels.filter(c => isPrivateTeamVc(c) && vcNameMatches(team, c.name, pair));
}
function findRelatedVcCandidates(voiceChannels, team) {
  return voiceChannels.filter(c => isPrivateTeamVc(c) && vcTeamNameMatches(team, c.name));
}
async function findDbVc(guild, matchKey, slot) {
  const mapping = db.matches[matchKey];
  const id = mapping?.[slot];
  if (!id) return null;
  return await guild.channels.fetch(id).catch(() => null);
}

async function auditVcRange(guild, round, start, end) {
  const matchRows = getMatches(round, start, end);
  if (!matchRows.length) throw new Error(`ไม่พบคู่ใน Round ${round}, Range ${start}-${end}`);
  const requestedTeams = matchRows.flatMap(m => [m.team1, m.team2]);
  const rosterAudit = await buildRosterAudit(guild, requestedTeams);
  const voices = await allVoiceChannels(guild);
  const categories = new Map();
  const entries = [];
  for (const match of matchRows) {
    for (const slot of ['team1', 'team2']) {
      const team = match[slot];
      const key = normTeam(team);
      const roster = rosterAudit.result.get(key);
      const entry = { round, pair: match.pair, team, slot, roster, vcCandidates: [], relatedVcCandidates: [], dbVc: null, status: null };
      if (isTbd(team)) { entry.status = 'tbd'; entries.push(entry); continue; }
      entry.vcCandidates = findVcCandidates(voices, team, match.pair);
      entry.relatedVcCandidates = findRelatedVcCandidates(voices, team);
      entry.dbVc = await findDbVc(guild, `${round}:${match.pair}`, slot === 'team1' ? 'vc1Id' : 'vc2Id');
      if (roster?.status === 'format_invalid') entry.status = 'format_invalid';
      else if (roster?.status === 'missing') entry.status = 'missing_roster';
      else if (roster?.status === 'similar') entry.status = 'similar_roster';
      else if (roster?.status === 'ambiguous') entry.status = 'ambiguous_roster';
      else if (roster?.status === 'found' && roster.duplicateHistory?.length > 1) entry.status = 'duplicate_roster';
      else if (entry.relatedVcCandidates.length > 1) entry.status = 'duplicate_vc';
      else if (entry.relatedVcCandidates.length === 1 && entry.vcCandidates.length === 0) entry.status = 'vc_format_invalid';
      else if (entry.vcCandidates.length > 1) entry.status = 'duplicate_vc';
      else if (entry.vcCandidates.length === 1) entry.status = 'vc_found';
      else if (entry.dbVc) entry.status = 'db_points_missing_discord';
      else entry.status = 'ready';
      entries.push(entry);
    }
  }
  return { matchRows, rosterAudit, voices, entries };
}

function auditBucket(entry) {
  return {
    ready: '🟢 พร้อมสร้าง',
    vc_found: '🔵 มี VC อยู่แล้ว',
    duplicate_roster: '🟠 พบทีมซ้ำใน Roster',
    format_invalid: '🟡 พบทีม แต่ Format ไม่ถูกต้อง',
    duplicate_vc: '🟠 พบ VC ซ้ำ',
    vc_format_invalid: '🟡 พบ VC ของทีม แต่ชื่อ/Format ห้องไม่ตรง',
    similar_roster: '🟠 พบชื่อใกล้เคียง',
    ambiguous_roster: '🟠 พบชื่อใกล้เคียงหลายรายการ',
    missing_roster: '🔴 ไม่พบทีมใน Roster',
    db_points_missing_discord: '🟡 DB มี Mapping แต่ Discord ไม่พบ VC',
    tbd: '⚪ TBD'
  }[entry.status] || '🔴 ตรวจสอบไม่ได้';
}
function auditEntryText(guild, entry) {
  const lines = [`• **${entry.team}** — คู่ ${entry.pair}`];
  if (entry.roster?.roster) {
    const r = entry.roster.roster;
    lines.push(`  Roster ล่าสุด: ${r.content.split('\n').find(x => /team\s*:/i.test(x))?.trim() || r.teamName}`);
    lines.push(`  ผู้พิมพ์: <@${r.authorId}>`);
    lines.push(`  เวลา: <t:${Math.floor(r.createdTimestamp / 1000)}:F>`);
    lines.push(`  🔗 ${linkMessage(guild.id, r.channelId, r.messageId, 'เปิดข้อความล่าสุด')}`);
  }
  if (entry.roster?.status === 'format_invalid') {
    const r = entry.roster.latestRaw;
    lines.push('  ⚠️ พบชื่อทีมในข้อความล่าสุด แต่ Format ไม่ถูกต้อง');
    lines.push(`  ข้อความล่าสุด: ${r.content || '(ว่าง)'}`);
    lines.push(`  ผู้พิมพ์: ${r.authorId ? `<@${r.authorId}>` : 'ไม่พบ User'}`);
    lines.push(`  เวลา: <t:${Math.floor(r.createdTimestamp / 1000)}:F>`);
    lines.push(`  🔗 ${linkMessage(guild.id, r.channelId, r.messageId, 'เปิดข้อความล่าสุด')}`);
    if (entry.roster.oldValid) lines.push(`  ℹ️ มีข้อความเก่าที่ Format ถูก แต่ระบบจะ **ไม่ใช้ข้อความเก่า**`);
  }
  if (entry.roster?.status === 'missing') lines.push('  ❌ ไม่พบข้อความ `Team : ชื่อทีม` ล่าสุดสำหรับทีมนี้');
  if (entry.roster?.status === 'similar') {
    lines.push(`  CSV: ${entry.team}`);
    lines.push(`  Roster ที่พบ: ${entry.roster.roster.teamName}`);
    lines.push(`  🔗 ${linkMessage(guild.id, entry.roster.roster.channelId, entry.roster.roster.messageId, 'เปิดข้อความที่พบ')}`);
    lines.push('  ⚠️ ไม่ถือว่า Match โดยอัตโนมัติ');
  }
  if (entry.roster?.status === 'ambiguous') {
    lines.push('  ⚠️ พบชื่อที่ใกล้เคียงหลายรายการ:');
    for (const c of entry.roster.candidates) lines.push(`  - ${c.teamName} — ${linkMessage(guild.id, c.channelId, c.messageId, 'เปิดข้อความ')}`);
  }
  if (entry.roster?.formatIssue) lines.push(`  🟡 ${entry.roster.formatIssue}`);
  if (entry.roster?.duplicateHistory?.length > 1) {
    lines.push(`  ⚠️ พบข้อความของทีมนี้ ${entry.roster.duplicateHistory.length} ครั้ง — ใช้เฉพาะข้อความล่าสุด`);
    const latest = entry.roster.duplicateHistory[0];
    lines.push(`  ล่าสุด: ${linkMessage(guild.id, latest.channelId, latest.messageId, 'เปิดข้อความล่าสุด')}`);
  }
  if (entry.vcCandidates.length) {
    lines.push(`  VC ที่ตรง Format: ${entry.vcCandidates.length} ห้อง`);
    for (const c of entry.vcCandidates) lines.push(`  - 🔊 ${c.name} — ${linkChannel(guild.id, c.id, 'เปิด VC')}`);
  }
  if (entry.status === 'vc_format_invalid') {
    lines.push('  ⚠️ พบ VC ของทีม แต่ชื่อห้องไม่ตรง Format ที่ระบบคาดไว้');
    lines.push(`  Format ที่คาด: **${vcBaseName(entry.pair, entry.team)}**`);
    for (const c of entry.relatedVcCandidates) lines.push(`  - 🔊 ${c.name} — ${linkChannel(guild.id, c.id, 'เปิด VC')}`);
  }
  if (entry.status === 'duplicate_vc' && entry.relatedVcCandidates.length) {
    lines.push(`  ⚠️ พบ VC ที่อาจเป็นของทีมนี้ ${entry.relatedVcCandidates.length} ห้อง`);
    for (const c of entry.relatedVcCandidates) lines.push(`  - 🔊 ${c.name} — ${linkChannel(guild.id, c.id, 'เปิด VC')}`);
  }
  if (entry.dbVc && !entry.vcCandidates.some(c => c.id === entry.dbVc.id)) lines.push(`  DB VC เดิม: ${linkChannel(guild.id, entry.dbVc.id, entry.dbVc.name)} — ⚠️ Discord ตรวจจากชื่อไม่พบ`);
  if (entry.status === 'ready' && entry.roster?.roster) lines.push(`  พร้อมสร้าง และจะเพิ่มผู้พิมพ์ล่าสุด <@${entry.roster.roster.authorId}> เข้า VC`);
  return lines.join('\n');
}
function buildAuditMessages(guild, audit) {
  const groups = new Map();
  for (const e of audit.entries) { const k = auditBucket(e); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const header = `🔎 **ตรวจสอบ Team VC — Round ${audit.matchRows[0].round}**\nช่วงคู่: **${audit.matchRows[0].pair}-${audit.matchRows[audit.matchRows.length - 1].pair}**\nทีมที่ควรมี: **${audit.entries.length}**\n\n⚠️ **การตรวจสอบนี้เป็น Read-only: ไม่มีการสร้าง แก้ไข หรือลบห้อง**\n\n`;
  const blocks = [header];
  for (const [title, list] of groups) {
    blocks.push(`━━━━━━━━━━━━━━━━━━\n${title} (${list.length})\n\n${list.map(e => auditEntryText(guild, e)).join('\n\n')}`);
  }
  const counts = [...groups.entries()].map(([k, v]) => `${k}: ${v.length}`).join('\n');
  blocks.push(`━━━━━━━━━━━━━━━━━━\n📊 **สรุป**\n${counts}\n\nทั้งหมด **${audit.entries.length} ทีม**`);
  return splitDiscordText(blocks, 1900);
}

function matchKey(round, pair) { return `${round}:${pair}`; }
function threadName(match) { return `${match.team1} VS ${match.team2}`.slice(0, 100); }
function threadFindKey(name) { return normTeam(name); }
async function findExistingThread(parent, match) {
  if (!parent?.threads) return null;
  const active = await parent.threads.fetchActive().catch(() => null);
  const all = [];
  if (active?.threads) all.push(...active.threads.values());
  let before;
  for (let page = 0; page < 20; page++) {
    const archived = await parent.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!archived?.threads?.size) break;
    all.push(...archived.threads.values());
    const last = archived.threads.last();
    if (!last || archived.threads.size < 100) break;
    before = last.id;
  }
  return all.find(t => threadFindKey(t.name) === threadFindKey(threadName(match))) || null;
}

async function resolveThread(guild, match, parentId) {
  const key = matchKey(match.round, match.pair);
  const stored = db.matches[key];
  if (stored?.threadId) {
    const existing = await guild.channels.fetch(stored.threadId).catch(() => null);
    if (existing?.isThread?.()) return existing;
  }
  const parent = await getChannel(guild, parentId || MATCH_THREAD_PARENT_ID);
  if (!parent || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(parent.type)) throw new Error(`Match Thread Parent ไม่ถูกต้องสำหรับคู่ ${match.pair}`);
  return await findExistingThread(parent, match);
}

async function createOrGetVc(guild, match, team, slot, rosterInfo, voiceChannels = null) {
  if (isTbd(team)) return { channel: null, created: false, status: 'tbd' };
  const key = matchKey(match.round, match.pair);
  const field = slot === 'team1' ? 'vc1Id' : 'vc2Id';
  const storedId = db.matches[key]?.[field];
  if (storedId) {
    const stored = await guild.channels.fetch(storedId).catch(() => null);
    if (stored?.type === ChannelType.GuildVoice) {
      const ids = rosterMemberIds(rosterInfo?.roster);
      if (ids.length) await stored.permissionOverwrites.set(privateOverwrites(guild, ids), 'Sync Team VC roster permissions');
      return { channel: stored, created: false, status: 'existing_db' };
    }
  }
  const voices = voiceChannels || await allVoiceChannels(guild);
  const candidates = findVcCandidates(voices, team, match.pair);
  const related = findRelatedVcCandidates(voices, team);
  if (related.length > 1) throw new Error(`พบ VC ซ้ำสำหรับ ${team}: ${related.map(c => c.name).join(', ')}`);
  if (candidates.length === 1 && related.length === 1) {
    const vc = candidates[0];
    const ids = rosterMemberIds(rosterInfo?.roster);
    if (ids.length) await vc.permissionOverwrites.set(privateOverwrites(guild, ids), 'Sync Team VC roster permissions');
    return { channel: vc, created: false, status: 'existing_discord' };
  }
  if (related.length === 1 && candidates.length === 0) throw new Error(`พบ VC ของ ${team} แต่ชื่อ/Format ห้องไม่ตรง: ${related[0].name}`);
  if (!rosterInfo || rosterInfo.status !== 'found' || rosterInfo.formatIssue || !rosterInfo.roster) throw new Error(`Roster ของ ${team} ยังไม่ผ่านการตรวจสอบ`);
  const ids = rosterMemberIds(rosterInfo.roster);
  if (!ids.length) throw new Error(`Roster ของ ${team} ไม่มีผู้พิมพ์/สมาชิกที่เพิ่มเข้า VC ได้`);
  const category = await getCategory(guild, match.pair);
  const name = vcBaseName(match.pair, team);
  const vc = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: privateOverwrites(guild, ids), reason: `CSV Match ${match.round}-${match.pair} Team VC` });
  return { channel: vc, created: true, status: 'created' };
}
async function ensureThread(guild, match, parentId, vc1, vc2) {
  const key = matchKey(match.round, match.pair);
  let thread = await resolveThread(guild, match, parentId);
  let created = false;
  if (!thread) {
    const parent = await getChannel(guild, parentId || MATCH_THREAD_PARENT_ID);
    if (!parent || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(parent.type)) throw new Error(`Match Thread Parent ไม่ถูกต้องสำหรับคู่ ${match.pair}`);
    thread = await parent.threads.create({ name: threadName(match), autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES, reason: `CSV Match ${match.round}-${match.pair}` });
    created = true;
  }
  const welcome = WELCOME.replaceAll('{MATCH}', `${match.team1} VS ${match.team2}`).replaceAll('{ROUND}', String(match.round));
  if (created || !db.matches[key]?.welcomePosted) await thread.send({ content: welcome });

  const vcBlocks = [
    '🔊 **ห้องเสียงของทีม**',
    isTbd(match.team1) ? `• ${match.team1}: ยังไม่มี VC` : `• **${match.team1}** — ${vc1 ? linkChannel(guild.id, vc1.id, 'เข้าห้อง VC') : 'ยังไม่พบ VC'}`,
    isTbd(match.team2) ? `• ${match.team2}: ยังไม่มี VC` : `• **${match.team2}** — ${vc2 ? linkChannel(guild.id, vc2.id, 'เข้าห้อง VC') : 'ยังไม่พบ VC'}`
  ].join('\n');
  if (created || !db.matches[key]?.vcLinksPosted || db.matches[key]?.lastVc1Id !== (vc1?.id || null) || db.matches[key]?.lastVc2Id !== (vc2?.id || null)) {
    await thread.send({ content: vcBlocks });
  }

  if (created || !db.matches[key]?.openIdPosted) {
    for (const content of openIdChunks([match.team1, match.team2])) await thread.send({ content });
  }
  return { thread, created };
}
function staffBoardContent(guild, match, mapping) {
  const completed = mapping.completedAt;
  const vc1 = mapping.vc1Id ? linkChannel(guild.id, mapping.vc1Id, 'เปิด VC') : '—';
  const vc2 = mapping.vc2Id ? linkChannel(guild.id, mapping.vc2Id, 'เปิด VC') : '—';
  const thread = mapping.threadId ? linkChannel(guild.id, mapping.threadId, 'เปิด Match Thread') : '—';
  return [
    '━━━━━━━━━━━━━━━━━━━━',
    `🏆 **Round ${match.round} — คู่ ${match.pair}**`,
    `🕐 เวลา: **${match.time || 'ไม่ระบุ'}**`,
    '',
    `**${match.team1} VS ${match.team2}**`,
    '',
    `🔊 **${match.team1}** — ${vc1}`,
    `🔊 **${match.team2}** — ${vc2}`,
    '',
    `🧵 **Match Thread** — ${thread}`,
    '',
    completed ? `🔒 **แข่งเสร็จแล้ว** — <@${mapping.completedBy}>\n🕐 <t:${Math.floor(new Date(completed).getTime() / 1000)}:F>` : '🟡 **รอดำเนินการ**',
    '━━━━━━━━━━━━━━━━━━━━'
  ].join('\n');
}
function completeButton(key, disabled = false) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`staff_complete:${key}`).setLabel(disabled ? 'แข่งเสร็จแล้ว' : 'แข่งเสร็จแล้ว').setEmoji('✅').setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(disabled));
}

async function ensureBoard(guild, match, boardChannelId, mapping) {
  const channel = await getChannel(guild, boardChannelId || STAFF_BOARD_CHANNEL_ID);
  if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Staff Board channel ไม่ถูกต้อง');
  const key = matchKey(match.round, match.pair);
  const existingId = db.matches[key]?.boardMessageId;
  let message = existingId ? await channel.messages.fetch(existingId).catch(() => null) : null;
  const payload = { content: staffBoardContent(guild, match, mapping), components: [completeButton(key, !!mapping.completedAt)] };
  if (message) await message.edit(payload); else { message = await channel.send(payload); }
  mapping.boardChannelId = channel.id; mapping.boardMessageId = message.id;
  return message;
}

async function runRange(guild, round, start, end, options = {}) {
  const rows = getMatches(round, start, end);
  if (!rows.length) throw new Error(`ไม่พบคู่ใน Round ${round}, Range ${start}-${end}`);
  const results = [];
  const voices = options.createVc ? await allVoiceChannels(guild) : null;
  const rosterAudit = (options.createVc || options.createBoard) ? await buildRosterAudit(guild, [...new Set(rows.flatMap(m => [m.team1, m.team2]).filter(t => !isTbd(t)))]) : null;
  for (const match of rows) {
    const key = matchKey(match.round, match.pair);
    const mapping = db.matches[key] || (db.matches[key] = {
      round: String(match.round), pair: match.pair, team1: match.team1, team2: match.team2, time: match.time || '',
      vc1Id: null, vc2Id: null, threadId: null, boardMessageId: null, completedAt: null, completedBy: null
    });
    mapping.round = String(match.round); mapping.pair = match.pair; mapping.team1 = match.team1; mapping.team2 = match.team2; mapping.time = match.time || '';
    try {
      let vc1 = mapping.vc1Id ? await guild.channels.fetch(mapping.vc1Id).catch(() => null) : null;
      let vc2 = mapping.vc2Id ? await guild.channels.fetch(mapping.vc2Id).catch(() => null) : null;
      const r1 = rosterAudit?.result.get(normTeam(match.team1));
      const r2 = rosterAudit?.result.get(normTeam(match.team2));
      if (options.createVc) {
        const a = await createOrGetVc(guild, match, match.team1, 'team1', r1, voices);
        const b = await createOrGetVc(guild, match, match.team2, 'team2', r2, voices);
        vc1 = a.channel; vc2 = b.channel;
        if (vc1) mapping.vc1Id = vc1.id;
        if (vc2) mapping.vc2Id = vc2.id;
      }
      if (options.createThread) {
        const th = await ensureThread(guild, match, options.threadParentId || MATCH_THREAD_PARENT_ID, vc1, vc2);
        mapping.threadId = th.thread.id;
        mapping.threadParentId = th.thread.parentId;
        mapping.welcomePosted = true; mapping.vcLinksPosted = true; mapping.openIdPosted = true;
      }
      if (options.createBoard) await ensureBoard(guild, match, options.boardChannelId || STAFF_BOARD_CHANNEL_ID, mapping);
      results.push({ match, status: 'ok', vc1, vc2, threadId: mapping.threadId });
    } catch (error) {
      results.push({ match, status: 'failed', error: String(error.message || error) });
    }
  }
  saveDb();
  return results;
}
function resultSummary(results, title) {
  const ok = results.filter(x => x.status === 'ok');
  const failed = results.filter(x => x.status !== 'ok');
  const lines = [title, '', `🟢 สำเร็จ: **${ok.length}**`, `🔴 มีปัญหา: **${failed.length}**`];
  for (const r of failed.slice(0, 20)) lines.push(`• คู่ ${r.match.pair} — ${r.match.team1} VS ${r.match.team2}\n  ${r.error}`);
  if (failed.length > 20) lines.push(`…และอีก ${failed.length - 20} รายการ`);
  return lines.join('\n');
}

async function collectAllMatchThreads(guild) {
  const actualThreads = new Map();
  const channels = [...guild.channels.cache.values()].filter(c =>
    c && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type) && c.threads
  );

  // First pass: active threads in EVERY possible text/announcement parent.
  // This is important because Match Thread-only lets Staff choose the parent
  // dynamically; therefore MATCH_THREAD_PARENT_ID cannot be the only source.
  for (const parent of channels) {
    const active = await parent.threads.fetchActive().catch(() => null);
    if (active?.threads) {
      for (const t of active.threads.values()) {
        const key = threadFindKey(t.name);
        if (!actualThreads.has(key)) actualThreads.set(key, t);
      }
    }
  }

  // Second pass: archived threads. Keep this bounded so announcement does not
  // hammer Discord when a server has a very large history.
  for (const parent of channels) {
    let before;
    for (let page = 0; page < 5; page++) {
      const archived = await parent.threads.fetchArchived({
        type: 'public',
        limit: 100,
        ...(before ? { before } : {}),
      }).catch(() => null);
      if (!archived?.threads?.size) break;
      for (const t of archived.threads.values()) {
        const key = threadFindKey(t.name);
        if (!actualThreads.has(key)) actualThreads.set(key, t);
      }
      const last = archived.threads.last();
      if (!last || archived.threads.size < 100) break;
      before = last.id;
    }
  }
  return actualThreads;
}

async function inspectAnnouncementRange(guild, round, start, end) {
  const rows = getMatches(round, start, end);
  if (!rows.length) throw new Error(`ไม่พบคู่ใน Round ${round}, Range ${start}-${end}`);

  const found = [], missing = [];

  // Do not assume a single fixed parent. Threads can be created in any room
  // selected by the Staff in the Thread-only/Batch flow.
  const actualThreads = await collectAllMatchThreads(guild);

  for (const match of rows) {
    const key = matchKey(match.round, match.pair);
    const mapping = db.matches[key] || {};
    let thread = mapping.threadId
      ? await guild.channels.fetch(mapping.threadId).catch(() => null)
      : null;

    // DB miss/stale mapping -> resolve from the actual Discord Thread name.
    if (!thread?.isThread?.()) {
      thread = actualThreads.get(threadFindKey(threadName(match))) || null;
    }

    if (thread?.isThread?.()) {
      // Repair the mapping so future announcement/status operations can find it directly.
      db.matches[key] = {
        ...mapping,
        round: String(match.round),
        pair: Number(match.pair),
        team1: match.team1,
        team2: match.team2,
        threadId: thread.id,
        threadParentId: thread.parentId,
      };
      found.push({ match, mapping: db.matches[key], thread });
    } else {
      missing.push(match);
    }
  }
  saveDb();
  return { rows, found, missing };
}
function announcementPreviewText(round, start, end, report, channelId) {
  const lines = [`📢 **Preview การประกาศ Match Threads**`, `Round ${round} | คู่ ${start}-${end}`, `ห้องประกาศ: <#${channelId}>`, '', `🟢 พบ Thread: **${report.found.length} คู่**`, `🔴 ไม่พบ Thread: **${report.missing.length} คู่**`];
  if (report.missing.length) {
    lines.push('', '❌ **Thread ที่หาไม่พบ**');
    for (const m of report.missing.slice(0, 30)) lines.push(`• คู่ ${m.pair} — ${m.team1} VS ${m.team2}`);
    if (report.missing.length > 30) lines.push(`…และอีก ${report.missing.length - 30} คู่`);
  }
  lines.push('', '⚠️ หากยืนยัน ระบบจะประกาศ **เฉพาะ Thread ที่พบ** และจะไม่สร้าง Thread ที่หาย');
  return lines.join('\n');
}
async function sendAnnouncementReport(guild, report, channelId, round) {
  const channel = await getChannel(guild, channelId);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Announcement Channel ไม่ถูกต้อง');
  const groups = new Map();
  for (const item of report.found) {
    const time = item.match.time || 'ไม่ระบุเวลา';
    if (!groups.has(time)) groups.set(time, []);
    groups.get(time).push(item);
  }
  const sent = [];
  for (const [time, items] of groups) {
    const lines = ['@everyone', `🏆 **Round ${round} — เวลา ${time}**`, ''];
    for (const { match, thread } of items) {
      lines.push(`**${match.team1} VS ${match.team2}**`);
      lines.push(`🧵 ${linkChannel(guild.id, thread.id, 'เปิด Thread')}`, '');
    }
    const msg = await channel.send({ content: lines.join('\n'), allowedMentions: { parse: ['everyone'] } });
    sent.push({ time, count: items.length, messageId: msg.id });
    db.announcements[`manual:${channel.id}:${round}:${time}:${items.map(x => x.match.pair).join(',')}`] = { channelId: channel.id, messageId: msg.id, time, round: String(round), pairs: items.map(x => x.match.pair), createdAt: new Date().toISOString() };
  }
  saveDb();
  return { sent, channel, missing: report.missing };
}


async function fetchThreadsFromSourceRoom(parent) {
  if (!parent || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(parent.type)) throw new Error('Source Room ต้องเป็น Text Channel หรือ Announcement Channel');
  const active = await parent.threads.fetchActive().catch(() => null);
  const all = [];
  if (active?.threads) all.push(...active.threads.values());
  let before;
  for (let page = 0; page < 20; page++) {
    const archived = await parent.threads.fetchArchived({ type: 'public', limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!archived?.threads?.size) break;
    all.push(...archived.threads.values());
    const last = archived.threads.last();
    if (!last || archived.threads.size < 100) break;
    before = last.id;
  }
  return [...new Map(all.map(t => [t.id, t])).values()];
}
function parseStrictThreadName(name) {
  const raw = String(name || '').trim();
  const parts = raw.split(' vs ');
  if (parts.length !== 2) return null;
  const team1 = parts[0].trim(), team2 = parts[1].trim();
  if (!team1 || !team2) return null;
  return { team1, team2 };
}
async function scanThreadLinks(guild, sourceChannelId) {
  const source = await getChannel(guild, sourceChannelId);
  const threads = await fetchThreadsFromSourceRoom(source);
  const voices = await allVoiceChannels(guild);
  const results = [];
  const parsedGroups = new Map();
  for (const thread of threads) {
    const parsed = parseStrictThreadName(thread.name);
    if (!parsed) { results.push({ status: 'invalid_thread', thread }); continue; }
    const pairKey = `${normTeam(parsed.team1)}\u0000${normTeam(parsed.team2)}`;
    if (!parsedGroups.has(pairKey)) parsedGroups.set(pairKey, []);
    parsedGroups.get(pairKey).push(thread);
  }
  for (const [pairKey, group] of parsedGroups) {
    const parsed = parseStrictThreadName(group[0].name);
    if (group.length > 1) { results.push({ status: 'duplicate_thread', threads: group, ...parsed }); continue; }
    const thread = group[0];
    const vcResults = [];
    for (const team of [parsed.team1, parsed.team2]) {
      const candidates = findRelatedVcCandidates(voices, team);
      vcResults.push({ team, candidates });
    }
    results.push({ status: 'found', thread, ...parsed, vcResults });
  }
  return { source, results };
}
function buildThreadLinkMessages(guild, scan) {
  const blocks = [`🔗 **Link Threads**`, `Source Room: <#${scan.source.id}>`, `ตรวจพบ Threads: **${scan.results.length}**`, '', 'กติกาชื่อ Thread: `XXX vs XXX` เท่านั้น'];
  for (const r of scan.results) {
    if (r.status === 'invalid_thread') {
      blocks.push(`⚠️ **Thread Format ไม่ถูกต้อง**\nชื่อ: ${r.thread.name}\nthread : ${mentionChannel(r.thread.id)}`);
      continue;
    }
    if (r.status === 'duplicate_thread') {
      blocks.push(`⚠️ **พบ Thread ซ้ำ**\n${r.team1} vs ${r.team2}`);
      for (const t of r.threads) blocks.push(`thread : ${mentionChannel(t.id)}`);
      continue;
    }
    const lines = [`${r.team1} vs ${r.team2}`, `thread : ${mentionChannel(r.thread.id)}`];
    for (const v of r.vcResults) {
      if (v.candidates.length === 0) lines.push(`VC ${v.team} : ❌ ไม่พบ`);
      else if (v.candidates.length === 1) lines.push(`VC ${v.team} : ${mentionChannel(v.candidates[0].id)}`);
      else { lines.push(`VC ${v.team} : ⚠️ พบ ${v.candidates.length} ห้อง`); for (const c of v.candidates) lines.push(`• ${c.name} : ${mentionChannel(c.id)}`); }
    }
    blocks.push(lines.join('\n'));
  }
  return splitDiscordText(blocks, 1900);
}


function parseRange(value) {
  // Discord modal input can contain Unicode dash characters after copy/paste.
  // Normalize all common dash variants to ASCII '-' before parsing.
  const raw = String(value ?? '').trim();
  const normalized = raw
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const match = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    throw new Error(
      'รูปแบบเรนจ์ไม่ถูกต้อง\n' +
      'กรุณากำหนดเรนจ์ เช่น `1-32` หรือ `87-107`\n' +
      'หากต้องการสร้างเพียง 1 คู่ ให้ใส่ `1-1`'
    );
  }

  const start = Number(match[1]);
  const end = Number(match[2]);

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > 256) {
    throw new Error('เรนจ์ไม่ถูกต้อง: คู่ต้องอยู่ในช่วง 1-256 และจุดเริ่มต้องไม่มากกว่าจุดจบ');
  }

  return [start, end];
}
function rangeModal(customId, title) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(title);
  modal.addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('round').setLabel('รอบ เช่น 512').setStyle(TextInputStyle.Short).setValue('512').setRequired(true)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('range').setLabel('เรนจ์ เช่น 1-32 หรือ 1-1').setStyle(TextInputStyle.Short).setPlaceholder('1-32 = คู่ 1 ถึง 32 | 1-1 = คู่เดียว').setRequired(true))
  );
  return modal;
}
function batchModal() { return rangeModal('batch_modal', 'สร้าง Match Batch'); }

function panel() {
  return {
    content: `🏆 **RoV Tournament CSV Pipeline — ${TOURNAMENT_NAME}**\n**Build:** ${BUILD_ID}\n\n**Source:** CSV\n**Challonge API:** ปิด\n**Roster:** <#${ROSTER_CHANNEL_ID}> (ใช้ข้อความล่าสุดของแต่ละทีมเท่านั้น)\n**Announcement:** เลือกห้องทุกครั้งที่กดประกาศ
**ผู้มีสิทธิ์:** ${ALLOWED_USER_IDS.length ? ALLOWED_USER_IDS.map(id => `<@${id}>`).join(', ') : 'ยังไม่ได้กำหนด'}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('batch').setLabel('🚀 สร้าง Match Batch').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('threads_only').setLabel('🧵 สร้างเฉพาะ Match Threads').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('vc_only').setLabel('🔊 สร้างเฉพาะ Team VC').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('announce').setLabel('📢 ประกาศ Match Threads').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('audit_vc').setLabel('🔍 ตรวจสอบ Team VC').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('link_match').setLabel('🔗 สร้าง Link Match').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('update_threads').setLabel('🔄 อัปเดต Match Threads').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('delete_threads').setLabel('🗑️ ลบ Threads ตามช่วง').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('delete_vc').setLabel('🗑️ ลบ VC + Category ตามช่วง').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('status').setLabel('📊 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('refresh').setLabel('♻️ รีเฟรช Panel').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.commands.set([new SlashCommandBuilder().setName('panel').setDescription('เปิด Staff Panel')]);
  console.log(`📦 Match CSV: ${MATCH_CSV_PATH}`);
  console.log(`🪪 Open ID: ${OPENID_CSV_PATH} (${openIds.size} teams)`);
  console.log(`📋 Roster: ${ROSTER_CHANNEL_ID}`);
  console.log('📢 Announcement: เลือกห้องตอนสั่งงาน');
  console.log('🚫 Challonge API calls: DISABLED');
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
      const denied = staffGuard(interaction); if (denied) return publicDenied(interaction, denied);
      return interaction.reply(panel());
    }
    if (!interaction.inGuild()) return;

    if (interaction.isButton()) {
      const denied = staffGuard(interaction); if (denied) return publicDenied(interaction, denied);
      if (interaction.customId === 'refresh') return interaction.update(panel());
      if (interaction.customId === 'status') return interaction.reply({ content: `📊 CSV: **${readCsv(MATCH_CSV_PATH).length} คู่**\nDB: **${Object.keys(db.matches).length} mappings**\nOpen ID: **${openIds.size} ทีม**\nRoster: <#${ROSTER_CHANNEL_ID}>\nสิทธิ์ User ID: **${ALLOWED_USER_IDS.length} คน**\nChallonge API: **ปิด**` });
      if (interaction.customId === 'batch') return interaction.showModal(batchModal());
      if (interaction.customId === 'threads_only') return interaction.showModal(rangeModal('threads_modal', 'สร้างเฉพาะ Match Threads'));
      if (interaction.customId === 'vc_only') return interaction.showModal(rangeModal('vc_modal', 'สร้างเฉพาะ Team VC'));
      if (interaction.customId === 'announce') return interaction.showModal(rangeModal('announce_modal', 'ประกาศ Match Threads'));
      if (interaction.customId === 'update_threads') return interaction.showModal(rangeModal('update_threads_modal', 'อัปเดต Match Threads'));
      if (interaction.customId === 'delete_threads') return interaction.showModal(rangeModal('delete_threads_modal', 'ลบ Threads ตามช่วง'));
      if (interaction.customId === 'delete_vc') return interaction.showModal(rangeModal('delete_vc_modal', 'ลบ VC + Category ตามช่วง'));
      if (interaction.customId === 'audit_vc') return interaction.showModal(rangeModal('audit_vc_modal', 'ตรวจสอบ Team VC'));
      if (interaction.customId === 'link_match' || interaction.customId === 'thread_links') {
        return interaction.reply({ content: '🔗 **สร้าง Link Match**\nเลือก Source Room ที่มี Match Threads อยู่จริง\n\nบอทจะสแกน Thread ที่มีอยู่ → ตรวจชื่อ `Team 1 vs Team 2` → หา VC ของทั้งสองทีม → แล้วให้เลือกห้องปลายทางสำหรับส่งลิงก์', components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('link_source').setPlaceholder('เลือก Source Room').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))] });
      }
      if (interaction.customId.startsWith('staff_complete:')) {
        const key = interaction.customId.slice('staff_complete:'.length), mapping = db.matches[key];
        if (!mapping) return interaction.reply({ content: '❌ ไม่พบ Match ใน DB' });
        if (mapping.completedAt) return interaction.reply({ content: `🔒 Match นี้ปิดไปแล้วโดย <@${mapping.completedBy}> เมื่อ <t:${Math.floor(new Date(mapping.completedAt).getTime()/1000)}:F>` });
        return interaction.reply({ content: `⚠️ **ยืนยันการปิด Match**\n\n**${mapping.team1} VS ${mapping.team2}**\n\nต้องการยืนยันว่าแข่งเสร็จแล้วใช่หรือไม่?`, components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirm_complete:${key}`).setLabel('ยืนยัน').setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('cancel_complete').setLabel('ยกเลิก').setStyle(ButtonStyle.Secondary))] });
      }
      if (interaction.customId === 'cancel_complete') return interaction.update({ content: '✅ ยกเลิกแล้ว', components: [] });
      if (interaction.customId.startsWith('confirm_complete:')) {
        const key = interaction.customId.slice('confirm_complete:'.length), mapping = db.matches[key];
        if (!mapping) return interaction.update({ content: '❌ ไม่พบ Match ใน DB', components: [] });
        if (mapping.completedAt) return interaction.update({ content: `🔒 ปิดไปแล้วโดย <@${mapping.completedBy}>`, components: [] });
        mapping.completedAt = new Date().toISOString(); mapping.completedBy = interaction.user.id;
        const thread = mapping.threadId ? await interaction.guild.channels.fetch(mapping.threadId).catch(() => null) : null;
        if (thread?.isThread?.()) await thread.setArchived(true).catch(() => {});
        saveDb();
        if (mapping.boardChannelId && mapping.boardMessageId) { const board = await getChannel(interaction.guild, mapping.boardChannelId); const msg = board?.messages ? await board.messages.fetch(mapping.boardMessageId).catch(() => null) : null; if (msg) await msg.edit({ content: staffBoardContent(interaction.guild, mapping, mapping), components: [completeButton(key, true)] }).catch(() => {}); }
        return interaction.update({ content: `🔒 **แข่งขันเสร็จแล้ว**\nดำเนินการโดย <@${interaction.user.id}>\nเวลา <t:${Math.floor(new Date(mapping.completedAt).getTime()/1000)}:F>\n\n🧵 Match Thread ถูก Archive แล้ว`, components: [] });
      }
      if (interaction.customId.startsWith('confirm_announce:')) {
        const key = interaction.customId.slice('confirm_announce:'.length), p = pending.get(key);
        if (!p || Date.now() - p.createdAt > 10*60*1000) return interaction.update({ content: '⚠️ Preview หมดอายุแล้ว กรุณากดปุ่มใหม่อีกครั้ง', components: [] });
        const report = await inspectAnnouncementRange(interaction.guild, p.round, p.start, p.end);
        const sent = await sendAnnouncementReport(interaction.guild, report, p.channelId, p.round);
        pending.delete(key);
        return interaction.update({ content: `📢 **ประกาศเสร็จแล้ว**\nห้อง: <#${p.channelId}>\nส่ง: **${sent.sent.length} กลุ่มเวลา**\n🟢 ประกาศเฉพาะ ${report.found.length} คู่ที่มี Thread`, components: [] });
      }
      if (interaction.customId.startsWith('confirm_delete:')) {
        const [, mode, round, start, end] = interaction.customId.split(':');
        const rows = getMatches(round, Number(start), Number(end)); let count = 0;
        for (const m of rows) {
          const key = matchKey(round, m.pair), mapping = db.matches[key];
          if (mode === 'delete_threads') { const thread = mapping?.threadId ? await interaction.guild.channels.fetch(mapping.threadId).catch(() => null) : await resolveThread(interaction.guild, m, mapping?.parentChannelId || MATCH_THREAD_PARENT_ID); if (thread?.isThread?.()) { await thread.delete().catch(() => {}); count++; } if (mapping) { mapping.threadId=null; mapping.welcomePosted=false; mapping.vcLinksPosted=false; mapping.openIdPosted=false; } }
          else { for (const id of [mapping?.vc1Id,mapping?.vc2Id]) { if (id) { const c=await interaction.guild.channels.fetch(id).catch(()=>null); if(c){await c.delete().catch(()=>{});count++;} } } if(mapping){mapping.vc1Id=null;mapping.vc2Id=null;} const cs=Math.floor((m.pair-1)/25)*25+1, ce=cs+24, cat=interaction.guild.channels.cache.find(c=>c.type===ChannelType.GuildCategory&&c.name===`${CATEGORY_PREFIX} คู่ ${cs}-${ce}`); if(cat){const children=interaction.guild.channels.cache.filter(c=>c.parentId===cat.id&&c.type===ChannelType.GuildVoice);if(children.size===0){await cat.delete().catch(()=>{});count++;}} }
        }
        saveDb(); return interaction.update({ content: `🗑️ ดำเนินการแล้ว: **${count} ห้อง**\nDB ถูกอัปเดตแล้ว`, components: [] });
      }
      if (interaction.customId === 'cancel_delete') return interaction.update({ content: '✅ ยกเลิกแล้ว', components: [] });
    }

    if (interaction.isModalSubmit()) {
      const custom=interaction.customId, round=interaction.fields.getTextInputValue('round').trim();
      const range=interaction.fields.getTextInputValue('range').trim(); let start,end;
      try {[start,end]=parseRange(range);} catch(e){return interaction.reply({content:`❌ ${e.message}\n\n🧩 Build: **${BUILD_ID}**\n📥 ค่าที่ได้รับ: \`${range.replace(/`/g, '')}\``});}
      if(custom==='audit_vc_modal'){await interaction.deferReply();const audit=await auditVcRange(interaction.guild,round,start,end);const msgs=buildAuditMessages(interaction.guild,audit);await interaction.editReply({content:msgs[0]});for(let i=1;i<msgs.length;i++)await interaction.followUp({content:msgs[i]});return;}
      if(custom==='batch_modal'){pending.set(interaction.user.id,{createdAt:Date.now(),round,start,end,mode:'batch'});return interaction.reply({content:`🚀 **Batch** — Round ${round}, คู่ ${start}-${end}\n\nเลือกห้อง Match Threads และ Staff Board`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_thread').setPlaceholder('1/2 เลือกห้อง Match Threads').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement)),new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_board').setPlaceholder('2/2 เลือกห้อง Staff Board').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText))]});}
      const modeMap={threads_modal:'threads',vc_modal:'vc',announce_modal:'announce',update_threads_modal:'update_threads',delete_threads_modal:'delete_threads',delete_vc_modal:'delete_vc'};const mode=modeMap[custom];if(!mode)return;
      if(mode==='announce'){pending.set(interaction.user.id,{createdAt:Date.now(),round,start,end,mode:'announce'});return interaction.reply({content:`📢 **เลือกห้องประกาศ**\nRound ${round}, คู่ ${start}-${end}`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('announce_channel').setPlaceholder('เลือกห้องประกาศ').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))]});}
      if(mode==='update_threads'){await interaction.deferReply();const results=await runRange(interaction.guild,round,start,end,{createThread:true,createVc:false,createBoard:false,announce:false,threadParentId:MATCH_THREAD_PARENT_ID});return interaction.editReply({content:resultSummary(results,`🔄 อัปเดต Match Threads — Round ${round}, คู่ ${start}-${end}`)});}
      if(mode==='threads'){pending.set(interaction.user.id,{createdAt:Date.now(),round,start,end,mode:'threads'});return interaction.reply({content:`🧵 **เลือกห้องเก็บ Threads**\nRound ${round}, คู่ ${start}-${end}`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('threads_parent').setPlaceholder('เลือกห้อง Match Threads').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))]});}
      if(mode==='vc'){await interaction.deferReply();const results=await runRange(interaction.guild,round,start,end,{createThread:false,createVc:true,createBoard:false,announce:false});return interaction.editReply({content:resultSummary(results,`🔊 สร้างเฉพาะ Team VC — Round ${round}, คู่ ${start}-${end}`)});}
      if(mode==='delete_threads'||mode==='delete_vc')return interaction.reply({content:`⚠️ **ยืนยันการลบ**\nRound ${round}, คู่ ${start}-${end}\n\n${mode==='delete_threads'?'จะลบเฉพาะ Match Threads':'จะลบ VC + Category ที่เกี่ยวข้อง'}\n\nแน่ใจหรือไม่?`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirm_delete:${mode}:${round}:${start}:${end}`).setLabel('ยืนยัน').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('cancel_delete').setLabel('ยกเลิก').setStyle(ButtonStyle.Secondary))]});
    }

    if (interaction.isChannelSelectMenu()) {
      // Link Match is stateless: handle it BEFORE the generic pending/expiry guard.
      // This prevents the old 'รายการหมดอายุแล้ว' response from intercepting link_source/link_destination.
      if (interaction.customId === 'link_source') {
        const sourceId=interaction.values[0];
        const source=await getChannel(interaction.guild,sourceId);
        if(!source) return interaction.update({content:'❌ ไม่พบ Source Room',components:[]});
        const scan=await scanThreadLinks(interaction.guild,sourceId);
        return interaction.update({content:`🔎 **สแกน Source สำเร็จ**\nSource: <#${sourceId}>\nพบ Threads **${scan.results.length}** รายการ\n\nเลือก Destination Room ที่ต้องการส่งรายการ\n\n*Link Match ไม่ใช้ pending timeout — เลือกปลายทางได้แม้รอนาน*`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`link_destination:${sourceId}`).setPlaceholder('เลือก Destination Room').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))]});
      }
      if (interaction.customId.startsWith('link_destination:')) {
        const sourceId=interaction.customId.slice('link_destination:'.length);
        const source=await getChannel(interaction.guild,sourceId);
        const dest=await getChannel(interaction.guild,interaction.values[0]);
        if(!source) return interaction.update({content:'❌ Source Room ไม่พบแล้ว กรุณากด 🔗 สร้าง Link Match ใหม่',components:[]});
        if(!dest) return interaction.update({content:'❌ ไม่พบ Destination Room',components:[]});
        const scan=await scanThreadLinks(interaction.guild,sourceId);
        const msgs=buildThreadLinkMessages(interaction.guild,scan);
        for(const msg of msgs) await dest.send({content:msg});
        return interaction.update({content:`🔗 **สร้าง Link Match เรียบร้อย**\nSource: <#${source.id}>\nDestination: <#${dest.id}>\nThreads ที่ตรวจพบ: **${scan.results.length}**\nข้อความที่ส่ง: **${msgs.length}**`,components:[]});
      }

      const p=pending.get(interaction.user.id);if(!p||Date.now()-p.createdAt>10*60*1000)return interaction.update({content:'⚠️ รายการหมดอายุแล้ว กดปุ่มใหม่อีกครั้ง',components:[]});
      if(interaction.customId==='batch_thread'){p.threadParentId=interaction.values[0];pending.set(interaction.user.id,p);return interaction.update({content:`Match Thread: <#${p.threadParentId}>\n\nเลือก Staff Board`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_board').setPlaceholder('2/2 เลือกห้อง Staff Board').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText))]});}
      if(interaction.customId==='batch_board'){p.boardChannelId=interaction.values[0];await interaction.update({content:`⏳ กำลังสร้าง Round ${p.round}, คู่ ${p.start}-${p.end}...`,components:[]});const results=await runRange(interaction.guild,p.round,p.start,p.end,{createVc:true,createThread:true,createBoard:true,announce:false,threadParentId:p.threadParentId,boardChannelId:p.boardChannelId});const good=results.filter(x=>x.status==='ok').length;return interaction.editReply({content:resultSummary(results,`🚀 Match Batch — Round ${p.round}, คู่ ${p.start}-${p.end}`)+`\n\n📢 การประกาศยังไม่ถูกส่งอัตโนมัติ — ใช้ปุ่ม **📢 ประกาศ Match Threads** เพื่อ Preview และยืนยันก่อนส่ง`});}
      if(interaction.customId==='announce_channel'){
        // Global thread resolution can take longer than Discord's initial interaction window.
        // Acknowledge immediately, then do the potentially expensive Discord scan.
        await interaction.deferUpdate();
        p.channelId=interaction.values[0];
        const report=await inspectAnnouncementRange(interaction.guild,p.round,p.start,p.end);
        const key=`announce:${interaction.user.id}:${Date.now()}`;
        pending.set(key,{createdAt:Date.now(),round:p.round,start:p.start,end:p.end,channelId:p.channelId});
        pending.delete(interaction.user.id);
        return interaction.editReply({content:announcementPreviewText(p.round,p.start,p.end,report,p.channelId),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirm_announce:${key}`).setLabel('ยืนยันประกาศ').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId('cancel_delete').setLabel('ยกเลิก').setStyle(ButtonStyle.Secondary))]});
      }
      if(interaction.customId==='threads_parent'){p.threadParentId=interaction.values[0];await interaction.update({content:`⏳ กำลังสร้าง Thread อย่างเดียว Round ${p.round}, คู่ ${p.start}-${p.end}...`,components:[]});const results=await runRange(interaction.guild,p.round,p.start,p.end,{createVc:false,createThread:true,createBoard:false,announce:false,threadParentId:p.threadParentId});return interaction.editReply({content:resultSummary(results,`🧵 Match Threads — Round ${p.round}, คู่ ${p.start}-${p.end}`)});}
    }
  } catch(error){console.error(error);const content=`❌ ${error.message||error}`;if(interaction.deferred)return interaction.editReply({content}).catch(()=>{});if(interaction.replied)return interaction.followUp({content}).catch(()=>{});return interaction.reply({content});}
});
client.login(TOKEN);
