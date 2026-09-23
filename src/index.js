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
const ALLOWED_ROLE_IDS = (env.ALLOWED_ROLE_IDS || '').split(',').map(x=>x.trim()).filter(Boolean);
const ROSTER_CHANNEL_ID = env.ROSTER_CHANNEL_ID || '';
const ANNOUNCEMENT_CHANNEL_ID = env.ANNOUNCEMENT_CHANNEL_ID || '';
const MATCH_THREAD_PARENT_ID = env.MATCH_THREAD_PARENT_ID || '';
const DEFAULT_STAFF_BOARD_CHANNEL_ID = env.STAFF_BOARD_CHANNEL_ID || '';
const DB_PATH = env.DB_PATH || '/data/rov-csv-bot.json';
const MATCH_CSV_PATH = env.MATCH_CSV_PATH || path.join(__dirname,'..','data','round512.csv');
const OPENID_CSV_PATH = env.OPENID_CSV_PATH || path.join(__dirname,'..','data','approved-teams-openid-cleaned.csv');
const AUTO_ARCHIVE = Number(env.THREAD_AUTO_ARCHIVE_MINUTES || 10080);
const TOURNAMENTS = {
  A: { name: env.TOURNAMENT_A_NAME || 'Challonge A', url: env.TOURNAMENT_A_URL || '', prefix: env.CATEGORY_PREFIX_A || 'CA' },
  B: { name: env.TOURNAMENT_B_NAME || 'Challonge B', url: env.TOURNAMENT_B_URL || '', prefix: env.CATEGORY_PREFIX_B || 'CB' }
};

if (!TOKEN || !CLIENT_ID || !GUILD_ID) throw new Error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID');
if (!ROSTER_CHANNEL_ID) throw new Error('Missing ROSTER_CHANNEL_ID');
if (!ANNOUNCEMENT_CHANNEL_ID) throw new Error('Missing ANNOUNCEMENT_CHANNEL_ID');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const pending = new Map();

const WELCOME = env.THREAD_WELCOME_MESSAGE ||
`🚨 **กฎสำคัญก่อนเริ่มการแข่งขัน**\n\n`+
`📖 **กฎการแข่งขันฉบับเต็ม**\n`+
`อ่านรายละเอียดทั้งหมดได้ที่:\nhttps://docs.google.com/document/d/1ScktekJaUwQfPqSAcE1i1A-JQzzdgR83IgD8w58TS2Q/edit?tab=t.0\n\n`+
`🕖 **1. เวลาแข่งขัน**\n• ให้ยึดเวลาที่ทีมงานกำหนดเป็นหลัก\n• หากมาช้ากว่าเวลาที่กำหนดเกิน 15 นาที ปรับแพ้ทันที\n• กรุณาเข้าห้องแข่งขันและเตรียมตัวให้พร้อมก่อนเวลา\n\n`+
`🪪 **2. การยืนยันตัวตน / Open ID**\n• ทั้งสองทีมต้องตรวจสอบ Open ID ของผู้เล่นทีมคู่แข่ง\n• ตรวจสอบว่า Open ID ตรงกับข้อมูลที่ลงทะเบียนไว้\n• หากพบข้อมูลไม่ตรงหรือมีข้อสงสัย ให้เก็บหลักฐานและแจ้ง Staff ก่อนแข่ง\n\n`+
`🎮 **3. รูปแบบการแข่งขัน**\n• รอบออนไลน์แข่งขันแบบ BO3\n• ใช้โหมด Normal Ban Pick\n• ใช้เซิร์ฟเวอร์หลัก (Live Server) เท่านั้น\n\n`+
`🚫 **4. สิ่งที่ห้ามทำ**\n• ห้ามใช้โปรแกรมช่วยเหลือหรือโปรแกรมภายนอกที่ไม่ได้รับอนุญาต\n• ห้ามใช้บั๊กเพื่อให้ได้เปรียบ\n• ห้าม Intentional Disconnect หรือจงใจโยนเกม\n\n`+
`⚠️ **5. สำคัญ**\n• หากมีปัญหา ให้หยุดการแข่งขันและเรียก Staff ก่อนดำเนินการต่อ\n\n`+
`Match: {MATCH}\nRound: {ROUND}`;

function ensureDbDir(){ fs.mkdirSync(path.dirname(DB_PATH),{recursive:true}); }
function defaultDb(){ return {version:1, matches:{}, threads:{}, boards:{}, vcs:{}, batches:{}, updatedAt:null}; }
function loadDb(){
  ensureDbDir(); if(!fs.existsSync(DB_PATH)) return defaultDb();
  try{return {...defaultDb(),...JSON.parse(fs.readFileSync(DB_PATH,'utf8'))};}catch(e){console.error('DB read failed',e);return defaultDb();}
}
let db=loadDb();
function saveDb(){ensureDbDir();const tmp=DB_PATH+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DB_PATH);}

function norm(v){return String(v??'').normalize('NFKC').toLowerCase().replace(/[“”‘’'`]/g,'').replace(/[._-]+/g,' ').replace(/\s+/g,' ').trim();}
function staff(i){
  if(!i.inGuild()) return false;
  if(i.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  if(!ALLOWED_ROLE_IDS.length) return !!i.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
  return !!i.member?.roles?.cache && ALLOWED_ROLE_IDS.some(id=>i.member.roles.cache.has(id));
}
function staffGuard(i){if(!staff(i)) return '❌ ไม่มีสิทธิ์ Staff'; if(STAFF_CHANNEL_ID && i.channelId!==STAFF_CHANNEL_ID) return `❌ ใช้ Panel ได้เฉพาะ <#${STAFF_CHANNEL_ID}>`; return null;}
async function channel(guild,id){return guild.channels.cache.get(id)||await guild.channels.fetch(id).catch(()=>null);}

function readCsv(file){
  if(!fs.existsSync(file)) throw new Error(`ไม่พบ Match CSV: ${file}`);
  const wb=XLSX.read(fs.readFileSync(file),{type:'buffer',raw:false});
  const ws=wb.Sheets[wb.SheetNames[0]]; if(!ws) throw new Error('ไม่พบ Sheet');
  const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
  const find=(r,aliases)=>{const keys=Object.keys(r);const map=new Map(keys.map(k=>[norm(k).replace(/[^a-z0-9ก-๙]+/g,''),k]));for(const a of aliases){const k=map.get(norm(a).replace(/[^a-z0-9ก-๙]+/g,''));if(k)return k;}return null;};
  if(!rows.length) throw new Error('CSV ไม่มีข้อมูล');
  const r0=rows[0]; const rc=find(r0,['round']);const pc=find(r0,['pair']);const ac=find(r0,['team_a','team a','Team A']);const bc=find(r0,['team_b','team b','Team B']);const idc=find(r0,['challonge_match_id','match id']);const tc=find(r0,['time']);
  if(!rc||!pc||!ac||!bc) throw new Error('CSV ต้องมี round,pair,team_a,team_b');
  return rows.map(r=>({round:String(r[rc]||'').trim(),pair:Number(r[pc]),teamA:String(r[ac]||'TBD').trim()||'TBD',teamB:String(r[bc]||'TBD').trim()||'TBD',challongeMatchId:String(idc?r[idc]||'':'').trim(),time:String(tc?r[tc]||'':'').trim()})).filter(x=>x.round&&Number.isInteger(x.pair));
}
function matches(){return readCsv(MATCH_CSV_PATH);}
function getMatch(round,pair){return matches().find(m=>String(m.round)===String(round)&&m.pair===Number(pair));}

function readOpenId(){
  if(!fs.existsSync(OPENID_CSV_PATH)) return new Map();
  const wb=XLSX.read(fs.readFileSync(OPENID_CSV_PATH),{type:'buffer',raw:false});const ws=wb.Sheets[wb.SheetNames[0]];const rows=XLSX.utils.sheet_to_json(ws,{defval:''});if(!rows.length)return new Map();
  const keys=Object.keys(rows[0]); const find=(aliases)=>{for(const k of keys){if(aliases.some(a=>norm(k).replace(/[^a-z0-9ก-๙]+/g,'')===norm(a).replace(/[^a-z0-9ก-๙]+/g,'')))return k;}return null;};
  const team=find(['Team','Team Name','ชื่อทีม','ทีม']);const player=find(['In-game Name','In game Name','IGN','Player','Player Name','ชื่อผู้เล่น','ผู้เล่น','Name']);const oid=find(['Open ID','OpenID','Open_ID','เลขไอดี','ไอดี']);const map=new Map();if(!team||!oid)return map;
  for(const r of rows){const t=String(r[team]||'').trim(),p=String(player?r[player]||'':'').trim(),o=String(r[oid]||'').trim();if(!t||!o)continue;const k=norm(t);if(!map.has(k))map.set(k,{teamName:t,players:[]});map.get(k).players.push({playerName:p||'ผู้เล่น',openId:o});}return map;
}
const openIds=readOpenId();
function openIdChunks(teamNames){
  const blocks=['🪪 **ข้อมูลผู้เข้าแข่งขัน**'];
  for(const t of [...new Set(teamNames.filter(Boolean))]){
    if(norm(t)==='tbd'){blocks.push('**TBD**\n⚠️ ยังไม่มีข้อมูลทีม');continue;}
    const d=openIds.get(norm(t));if(!d){blocks.push(`⚠️ **ไม่พบข้อมูล Open ID ของ ${t} ใน CSV**`);continue;}
    blocks.push(`**${d.teamName}**\n`+d.players.map(p=>`${p.playerName} — \`${p.openId}\``).join('\n'));
  }
  blocks.push('⚠️ ทั้งสองทีมต้องตรวจสอบ Open ID ของคู่แข่งก่อนเริ่มการแข่งขัน');
  const out=[];let cur='';for(const b of blocks){const c=cur?cur+'\n\n'+b:b;if(c.length<=2000)cur=c;else{if(cur)out.push(cur);cur=b;}}if(cur)out.push(cur);return out;
}

async function rosterMap(guild){
  const ch=await channel(guild,ROSTER_CHANNEL_ID);if(!ch||ch.type!==ChannelType.GuildText)throw new Error('ไม่พบ Team Roster Channel');
  const map=new Map();let before;for(let page=0;page<1000;page++){
    const msgs=await ch.messages.fetch({limit:100,...(before?{before}:{})});if(!msgs.size)break;
    for(const m of msgs.values()){
      const hit=String(m.content||'').match(/^\s*Team\s*:\s*(.+?)\s*$/im);if(!hit)continue;const team=hit[1].trim();const ids=[...m.mentions.users.keys()];if(!team||!ids.length)continue;const k=norm(team);const old=map.get(k);if(!old||m.createdTimestamp>old.createdTimestamp)map.set(k,{teamName:team,memberIds:ids,createdTimestamp:m.createdTimestamp,messageId:m.id});
    }
    before=msgs.last()?.id;if(msgs.size<100)break;
  }
  return map;
}
function fuzzyRoster(map,team){
  const key=norm(team);if(key==='tbd')return null;const exact=map.get(key);if(exact)return exact;
  const candidates=[];for(const [k,v] of map){if(k.includes(key)||key.includes(k))candidates.push(v);}return candidates.length===1?candidates[0]:null;
}
function overwrites(guild,ids){const o=[{id:guild.roles.everyone.id,deny:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect]}];for(const id of new Set(ids.map(String)))o.push({id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.Connect,PermissionsBitField.Flags.Speak]});return o;}
async function getCategory(guild,tournament,pair){const start=Math.floor((pair-1)/25)*25+1,end=start+24;const name=`${TOURNAMENTS[tournament].prefix} คู่ ${start}-${end}`;let c=guild.channels.cache.find(x=>x.type===ChannelType.GuildCategory&&x.name===name);if(!c)c=await guild.channels.create({name,type:ChannelType.GuildCategory,reason:'CSV tournament pipeline'});return c;}
async function teamVc(guild,category,match,prefix,team,roster){
  if(norm(team)==='tbd')return null;const r=fuzzyRoster(roster,team);const name=`${prefix}${match.pair} ${team}`.slice(0,100);let vc=guild.channels.cache.find(c=>c.type===ChannelType.GuildVoice&&c.parentId===category.id&&norm(c.name)===norm(name));if(vc){await vc.permissionOverwrites.set(overwrites(guild,r?.memberIds||[]));return vc;}
  vc=await guild.channels.create({name,type:ChannelType.GuildVoice,parent:category.id,permissionOverwrites:overwrites(guild,r?.memberIds||[]),reason:`Match ${match.pair} Team VC`});return vc;
}
function threadName(m){return `${m.teamA} VS ${m.teamB}`.slice(0,100);}
function welcomeText(m,vcA,vcB){return WELCOME.replaceAll('{MATCH}',`${m.teamA} VS ${m.teamB}`).replaceAll('{ROUND}',m.round).replaceAll('{PLAYER1}',m.teamA).replaceAll('{PLAYER2}',m.teamB).replaceAll('{PLAYER1_VC}',vcA?`<#${vcA.id}>`:'—').replaceAll('{PLAYER2_VC}',vcB?`<#${vcB.id}>`:'—').replaceAll('{MATCH_ID}',m.challongeMatchId||'—');}
async function findThread(parent,m){const active=await parent.threads.fetchActive().catch(()=>null);const archived=await parent.threads.fetchArchived().catch(()=>null);const all=[...(active?.threads.values()||[]),...(archived?.threads.values()||[])];return all.find(t=>norm(t.name)===norm(threadName(m)))||null;}
async function makeThread(parent,m,vcA,vcB){let t=await findThread(parent,m);if(!t){const starter=await parent.send({content:`🎮 **${m.teamA} VS ${m.teamB}**\n🕖 เวลา: **${m.time||'ไม่ระบุ'}**`});t=await starter.startThread({name:threadName(m),autoArchiveDuration:Math.min(AUTO_ARCHIVE,10080),reason:`Match ${m.pair}`});}else if(t.archived)await t.setArchived(false).catch(()=>{});
  if(!db.threads[`${m.round}:${m.pair}`]?.welcomePosted){for(const c of welcomeText(m,vcA,vcB).split(/\n{2,}/)){if(c.trim())await t.send(c);}for(const c of openIdChunks([m.teamA,m.teamB]))await t.send(c);db.threads[`${m.round}:${m.pair}`]={threadId:t.id,welcomePosted:true};saveDb();}
  const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`staff_complete:${m.round}:${m.pair}`).setLabel('✅ แข่งเสร็จแล้ว').setStyle(ButtonStyle.Success));
  await t.send({content:'🛠️ **Staff** เมื่อการแข่งขันจบแล้วกดปุ่มนี้เพื่อ Archive Thread',components:[row]}).catch(()=>{});
  return t;
}
function challongeLink(tournament,m){return TOURNAMENTS[tournament].url||'—';}
async function staffBoard(guild,ch,m,tournament,vcA,vcB,thread){if(!ch)return null;const key=`${m.round}:${m.pair}`;const old=db.boards[key];if(old?.messageId){const msg=await ch.messages.fetch(old.messageId).catch(()=>null);if(msg){await msg.edit({content:boardText(m,tournament,vcA,vcB,thread),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`staff_complete:${m.round}:${m.pair}`).setLabel('✅ แข่งเสร็จแล้ว').setStyle(ButtonStyle.Success))]});return msg;}}const msg=await ch.send({content:boardText(m,tournament,vcA,vcB,thread),components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`staff_complete:${m.round}:${m.pair}`).setLabel('✅ แข่งเสร็จแล้ว').setStyle(ButtonStyle.Success))]});db.boards[key]={messageId:msg.id,channelId:ch.id};saveDb();return msg;}
function boardText(m,tournament,a,b,thread){return `🎮 **รอบ ${m.round} — คู่ ${m.pair}**\n**${m.teamA} VS ${m.teamB}**\n🕖 เวลา: **${m.time||'ไม่ระบุ'}**\n🔗 Challonge: ${challongeLink(tournament,m)}\n🎙️ ${m.teamA}: ${a?`<#${a.id}>`:'TBD'}\n🎙️ ${m.teamB}: ${b?`<#${b.id}>`:'TBD'}\n🧵 Match Thread: ${thread?`https://discord.com/channels/${GUILD_ID}/${thread.id}`:'TBD'}`;}
async function announce(guild,items){const ch=await channel(guild,ANNOUNCEMENT_CHANNEL_ID);if(!ch)throw new Error('ไม่พบ Announcement Channel');const groups=new Map();for(const x of items){const time=x.match.time||'ไม่ระบุ';if(!groups.has(time))groups.set(time,[]);groups.get(time).push(x);}for(const [time,list] of groups){const lines=list.map(x=>`🎮 **${x.match.teamA} VS ${x.match.teamB}** — <#${x.thread.id}>`).join('\n');await ch.send(`@everyone\n🕖 **รอบเวลา ${time}**\n${lines}`);}}

async function ensureOne(guild,tournament,m,threadId,boardId,{announceIt=false}={}){
  const parent=await channel(guild,threadId); const board=await channel(guild,boardId||DEFAULT_STAFF_BOARD_CHANNEL_ID);
  if(!parent||![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(parent.type)) throw new Error('Match Thread channel ไม่ถูกต้อง');
  if(!board||board.type!==ChannelType.GuildText) throw new Error('Staff Board channel ไม่ถูกต้อง');
  const roster=await rosterMap(guild); const cat=await getCategory(guild,tournament,m.pair);
  const a=await teamVc(guild,cat,m,'A',m.teamA,roster); const b=await teamVc(guild,cat,m,'B',m.teamB,roster);
  const th=await makeThread(parent,m,a,b); await staffBoard(guild,board,m,tournament,a,b,th);
  db.matches[`${m.round}:${m.pair}`]={...m,tournament,vcA:a?.id||null,vcB:b?.id||null,threadId:th.id,parentChannelId:parent.id,boardChannelId:board.id,createdAt:db.matches[`${m.round}:${m.pair}`]?.createdAt||new Date().toISOString()};
  saveDb();
  if(announceIt) await announce(guild,[{match:m,thread:th,vcA:a,vcB:b}]);
  return {match:m,thread:th,vcA:a,vcB:b};
}

async function repairRange(guild,tournament,round,start,end){
  const all=matches().filter(m=>String(m.round)===String(round)&&m.pair>=start&&m.pair<=end).sort((a,b)=>a.pair-b.pair); const done=[];
  for(const m of all){const d=db.matches[`${round}:${m.pair}`]||{};const parentId=d.parentChannelId||MATCH_THREAD_PARENT_ID;const boardId=d.boardChannelId||DEFAULT_STAFF_BOARD_CHANNEL_ID;if(!parentId||!boardId) throw new Error(`คู่ ${m.pair}: ไม่มีห้อง Thread/Staff Board ใน DB`);done.push(await ensureOne(guild,tournament,m,parentId,boardId));}
  return done;
}
async function updateThreadsRange(guild,round,start,end){
  const all=matches().filter(m=>String(m.round)===String(round)&&m.pair>=start&&m.pair<=end).sort((a,b)=>a.pair-b.pair); let n=0;
  for(const m of all){const d=db.matches[`${round}:${m.pair}`];if(!d?.threadId) continue;const t=await guild.channels.fetch(d.threadId).catch(()=>null);if(!t?.isThread())continue;await t.setName(threadName(m)).catch(()=>{});n++;}
  saveDb(); return n;
}

async function createBatch(guild,tournament,round,start,end,threadId,boardId){const all=matches().filter(m=>String(m.round)===String(round)&&m.pair>=start&&m.pair<=end).sort((a,b)=>a.pair-b.pair);if(!all.length)throw new Error('ไม่พบ Match ในช่วงที่เลือก');const parent=await channel(guild,threadId);const board=await channel(guild,boardId||DEFAULT_STAFF_BOARD_CHANNEL_ID);if(!parent||![ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(parent.type))throw new Error('Match Thread channel ไม่ถูกต้อง');if(!board||board.type!==ChannelType.GuildText)throw new Error('Staff Board channel ไม่ถูกต้อง');const made=[];for(const m of all){made.push(await ensureOne(guild,tournament,m,threadId,boardId));}await announce(guild,made);db.updatedAt=new Date().toISOString();saveDb();return made;}

function panel(){
  return {
    content:'🏆 **RoV Tournament CSV Pipeline**\nเลือก Challonge A/B ก่อน แล้วเลือกการทำงาน\n\n**แหล่งข้อมูลหลัก:** CSV\n**Challonge API:** ปิดการใช้งาน\n**Roster:** ห้องที่กำหนดใน ENV\n**Announcement:** ห้องที่กำหนดใน ENV',
    components:[
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('tournament_select').setPlaceholder('🏆 เลือก Challonge A/B').addOptions(
          Object.entries(TOURNAMENTS).map(([k,v])=>({label:v.name,value:k,description:'ใช้เป็น metadata/link เท่านั้น ไม่ยิง API'}))
        )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('batch').setLabel('🚀 สร้าง Match Batch').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('repair').setLabel('🔧 ซ่อม Match').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('update_threads').setLabel('🔄 อัปเดต Match Threads').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('delete_threads').setLabel('🗑️ ลบ Threads ตามช่วง').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('delete_vc').setLabel('🗑️ ลบ VC + Category ตามช่วง').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('status').setLabel('📊 ตรวจสอบสถานะ').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('refresh').setLabel('♻️ รีเฟรช Panel').setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}
function batchModal(i,tournament){const modal=new ModalBuilder().setCustomId(`batch_modal:${tournament}`).setTitle('สร้าง Match Batch');modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('round').setLabel('รอบ เช่น 512').setStyle(TextInputStyle.Short).setValue('512').setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('range').setLabel('คู่ เช่น 1-32 หรือ 1,2,3').setStyle(TextInputStyle.Short).setValue('1-32').setRequired(true)));return modal;}
function rangeModal(id,title){const modal=new ModalBuilder().setCustomId(id).setTitle(title);modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('round').setLabel('รอบ').setStyle(TextInputStyle.Short).setValue('512').setRequired(true)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('range').setLabel('ช่วงคู่ เช่น 1-32').setStyle(TextInputStyle.Short).setRequired(true)));return modal;}
function parseRange(s){const m=String(s).trim().match(/^(\d+)\s*-\s*(\d+)$/);if(!m)throw new Error('ช่วงต้องเป็น 1-32 เช่นนี้');const a=Number(m[1]),b=Number(m[2]);if(a<1||b<a||b-a+1>200)throw new Error('ช่วงไม่ถูกต้อง');return[a,b];}

client.once('ready',async()=>{console.log(`✅ Logged in as ${client.user.tag}`);const guild=await client.guilds.fetch(GUILD_ID);const cmds=[new SlashCommandBuilder().setName('panel').setDescription('เปิด Staff Panel')];await guild.commands.set(cmds);console.log(`📦 CSV: ${MATCH_CSV_PATH}`);console.log(`🪪 Open ID: ${OPENID_CSV_PATH} (${openIds.size} teams)`);console.log('🚫 Challonge API calls: DISABLED');});

client.on('interactionCreate',async i=>{
 try{
  if(i.isChatInputCommand()&&i.commandName==='panel'){const e=staffGuard(i);if(e)return i.reply({content:e,ephemeral:true});return i.reply({...panel(),ephemeral:true});}
  if(!i.inGuild())return;
  if(i.isStringSelectMenu()&&i.customId==='tournament_select'){pending.set(i.user.id,{tournament:i.values[0]});return i.update({...panel(),content:`🏆 เลือกแล้ว: **${TOURNAMENTS[i.values[0]].name}**\nเลือกการทำงานต่อได้เลย`});}
  const st=pending.get(i.user.id)||{};
  if(i.isButton()){
    const e=staffGuard(i);if(e)return i.reply({content:e,ephemeral:true});
    if(i.customId==='refresh')return i.update(panel());
    if(i.customId==='status'){const rows=matches();const existing=Object.keys(db.matches).length;return i.reply({content:`📊 CSV มี **${rows.length} คู่**\nDB มี mapping **${existing} คู่**\nOpen ID มี **${openIds.size} ทีม**\nChallonge API: **ปิด**`,ephemeral:true});}
    if(!st.tournament)return i.reply({content:'❗ เลือก Challonge A/B ก่อน',ephemeral:true});
    if(i.customId==='batch')return i.showModal(batchModal(i,st.tournament));
    if(i.customId==='repair')return i.showModal(rangeModal('repair_modal:'+st.tournament,'ซ่อม Match'));
    if(i.customId==='update_threads')return i.showModal(rangeModal('update_modal:'+st.tournament,'อัปเดต Match Threads'));
    if(i.customId==='delete_threads')return i.showModal(rangeModal('delete_threads_modal:'+st.tournament,'ลบ Threads'));
    if(i.customId==='delete_vc')return i.showModal(rangeModal('delete_vc_modal:'+st.tournament,'ลบ VC + Category'));
  }
  if(i.isModalSubmit()){
    const [kind,tournament]=i.customId.split(':');const round=i.fields.getTextInputValue('round').trim();const range=i.fields.getTextInputValue('range').trim();
    if(kind==='batch_modal'){const [a,b]=parseRange(range);pending.set(i.user.id,{tournament,round,start:a,end:b,step:'batch_channels'});return i.reply({content:`🚀 Batch: รอบ ${round}, คู่ ${a}-${b}\nเลือกห้อง Match Thread และ Staff Board ต่อ`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_thread_channel').setPlaceholder('1/2 Match Threads').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement)),new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_board_channel').setPlaceholder('2/2 Staff Board').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText))],ephemeral:true});}
    const [a,b]=parseRange(range);pending.set(i.user.id,{tournament,round,start:a,end:b,action:kind});
    if(kind==='repair_modal'){await i.deferReply({ephemeral:true});const done=await repairRange(i.guild,tournament,round,a,b);return i.editReply({content:`🔧 ซ่อมเสร็จ ${done.length} คู่ — สร้างเฉพาะสิ่งที่ขาด/อัปเดต mapping โดยไม่เรียก Challonge API`});}
    if(kind==='update_modal'){await i.deferReply({ephemeral:true});const n=await updateThreadsRange(i.guild,round,a,b);return i.editReply({content:`🔄 อัปเดตชื่อ Match Thread แล้ว ${n} คู่`});}
    if(kind==='delete_threads_modal'||kind==='delete_vc_modal')return i.reply({content:`⚠️ ยืนยันการลบ รอบ ${round} คู่ ${a}-${b} ?`,components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`confirm:${kind}:${tournament}:${round}:${a}:${b}`).setLabel('ยืนยัน').setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId('cancel').setLabel('ยกเลิก').setStyle(ButtonStyle.Secondary))],ephemeral:true});
  }
  if(i.isChannelSelectMenu()){
    const p=pending.get(i.user.id)||{};if(i.customId==='batch_thread_channel'){p.threadId=i.values[0];pending.set(i.user.id,p);return i.update({content:`Match Thread: <#${p.threadId}>\nเลือก Staff Board`,components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId('batch_board_channel').setPlaceholder('2/2 Staff Board').setMinValues(1).setMaxValues(1).setChannelTypes(ChannelType.GuildText))],ephemeral:true});}
    if(i.customId==='batch_board_channel'){p.boardId=i.values[0];pending.set(i.user.id,p);await i.update({content:`⏳ กำลังสร้าง รอบ ${p.round} คู่ ${p.start}-${p.end}...`,components:[],ephemeral:true});const made=await createBatch(i.guild,p.tournament,p.round,p.start,p.end,p.threadId,p.boardId);return i.editReply({content:`✅ สร้าง/ซ่อมเสร็จ **${made.length} คู่**\nRoster: <#${ROSTER_CHANNEL_ID}>\nAnnouncement: <#${ANNOUNCEMENT_CHANNEL_ID}>\nไม่มีการเรียก Challonge API`,components:[]});}
  }
  if(i.isButton()&&i.customId==='cancel')return i.update({content:'ยกเลิกแล้ว',components:[]});
  if(i.isButton()&&i.customId.startsWith('confirm:')){
    const [,kind,tournament,round,a,b]=i.customId.split(':');if(kind==='delete_threads_modal'){const all=matches().filter(m=>String(m.round)===round&&m.pair>=+a&&m.pair<=+b);let n=0;for(const m of all){const d=db.matches[`${round}:${m.pair}`];const parent=await channel(i.guild,d?.parentChannelId||MATCH_THREAD_PARENT_ID);let t=d?.threadId?await i.guild.channels.fetch(d.threadId).catch(()=>null):null;if(!t&&parent)t=await findThread(parent,m);if(t){await t.delete().catch(()=>{});n++;}delete db.threads[`${round}:${m.pair}`];delete db.matches[`${round}:${m.pair}`].threadId;}saveDb();return i.update({content:`🗑️ ลบ Threads แล้ว ${n} คู่`,components:[]});}
    const all=matches().filter(m=>String(m.round)===round&&m.pair>=+a&&m.pair<=+b);let n=0;for(const m of all){const d=db.matches[`${round}:${m.pair}`];for(const id of [d?.vcA,d?.vcB]){if(id){const c=await i.guild.channels.fetch(id).catch(()=>null);if(c)await c.delete().catch(()=>{});}}delete db.matches[`${round}:${m.pair}`];n++;}saveDb();return i.update({content:`🗑️ ลบ VC ของ ${n} คู่แล้ว (Thread/Staff Board ไม่แตะ)`,components:[]});
  }
  if(i.isButton()&&i.customId.startsWith('staff_complete:')){if(!staff(i))return i.reply({content:'❌ Staff เท่านั้น',ephemeral:true});const [,round,pair]=i.customId.split(':');const t=await i.channel?.fetch().catch(()=>null);if(t?.isThread())await t.setArchived(true).catch(()=>{});return i.reply({content:'✅ แข่งเสร็จแล้ว — Thread ถูก Archive แล้ว',ephemeral:true});}
 }catch(e){console.error(e);if(!i.replied&&!i.deferred)return i.reply({content:`❌ ${e.message||e}`,ephemeral:true}).catch(()=>{});}
});

client.login(TOKEN);
