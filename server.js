const WebSocket = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const TICK_RATE  = 50; // ms, 20 ticks/sec

const MIME = {
    '.html':'text/html; charset=utf-8', '.js':'application/javascript',
    '.css':'text/css', '.png':'image/png', '.jpg':'image/jpeg',
    '.jpeg':'image/jpeg', '.gif':'image/gif', '.ico':'image/x-icon',
    '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.wav':'audio/wav',
};

// ─────────────────────────────────────────────────────────────
// HTTP
// ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            fs.readFile(path.join(PUBLIC_DIR,'index.html'), (e2,d2) => {
                if (e2) { res.writeHead(500); res.end('Error'); return; }
                res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(d2);
            }); return;
        }
        const ct = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200,{'Content-Type':ct}); res.end(data);
    });
});

// ─────────────────────────────────────────────────────────────
// WORLD STATE (авторитарный мир на сервере)
// ─────────────────────────────────────────────────────────────
const GROUND_Y   = 500;   // абстрактное значение, клиент пересчитывает сам
const WORLD_BOUNDS = { left: -2000, right: 6000 };
let nextEid = 1; // entity id counter

function mkEnemy(x, type='enemy') {
    const stats = {
        enemy:        { w:60, h:80, hp:4,   maxHp:4,   speed:1.5 },
        zombie:       { w:60, h:80, hp:6,   maxHp:6,   speed:1.0 },
        skeleton:     { w:60, h:80, hp:3,   maxHp:3,   speed:2.5 },
        dark_servant: { w:60, h:80, hp:8,   maxHp:8,   speed:1.2 },
        dark_torch:   { w:55, h:70, hp:4,   maxHp:4,   speed:2.8 },
        rat:          { w:50, h:50, hp:3,   maxHp:3,   speed:2.5 },
    };
    const s = stats[type] || stats.enemy;
    return { id: nextEid++, x, type, vx:0, attackCtr:0, superJumping:false,
             superLanded:false, superVy:0, superX:0,
             ...s };
}

function mkBoss(x, type='boss1') {
    if (type==='boss1') return { id:nextEid++, x, type:'boss1', w:200, h:200, hp:150, maxHp:150, vx:0, attackTimer:0, active:true, name:'ДЕМОН' };
    if (type==='boss3') return { id:nextEid++, x, type:'boss3', w:220, h:220, hp:200, maxHp:200, vx:0, attackTimer:0, active:true, name:'ДЕМОН' };
    if (type==='boss5') return { id:nextEid++, x, type:'boss5', w:220, h:220, hp:280, maxHp:280, vx:0, attackTimer:0, active:true, name:'ПАЛАЧ' };
    if (type==='blackMan') return { id:nextEid++, x, type:'blackMan', w:100, h:130, hp:180, maxHp:180, vx:0, attackTimer:0, superJumping:false, superLanded:false, superVy:0, active:true, name:'ТЁМНЫЙ' };
}

// ─── Мировое состояние ───
const world = {
    scene: 'world',       // 'world' | 'corridor' | 'inside_house' | 'sewer'
    floor: 1,
    enemies: [],          // worldEnemies
    boss: null,           // floor boss
    blackMan: null,
    drops: [],            // { id, type, x, vx, vy, subType? }
    cages: [],            // { id, x, floorN, open }
    keys: [],             // { id, x }
    ladders: [],          // { id, floorN, x }
    waveIndex: 0,
    waveActive: false,
    enemySpawnTimer: 0,
    sewerRats: [],
    sewerExitOpen: false,
    sewerSection: 0,
    castleCleared: false,
    floorBossDead: [false,false,false,false,false,false], // index=floor
    floorWaveDone: [false,false,false,false,false,false],
    chest: { x:500, open:false },
    merchant: { x:1235, active:false },
    houseBlackManDefeated: false,
};

const FLOOR_WAVE_POS = {
    1: [[300,600,900],[200,500,800,1100]],
    3: [[300,700,1100],[200,500,800,1000],[250,450,650,850,1050]],
};

function initFloor(floor) {
    world.floor = floor;
    world.enemies = [];
    world.drops = [];
    world.keys = [];
    world.ladders = [];
    world.waveIndex = 0;
    world.waveActive = false;
    world.boss = null;

    if (floor === 1) {
        world.boss = mkBoss(800,'boss1');
    } else if (floor === 2) {
        const e1 = mkEnemy(400); e1.keyCage=0;
        const e2 = mkEnemy(700);
        const e3 = mkEnemy(1000); e3.keyCage=1;
        world.enemies.push(e1,e2,e3);
        world.cages = [
            {id:nextEid++, floorN:2, x:600,  open:false},
            {id:nextEid++, floorN:2, x:1200, open:false},
        ];
    } else if (floor === 3) {
        world.boss = mkBoss(800,'boss3');
    } else if (floor === 4) {
        const a=mkEnemy(300); const b=mkEnemy(600); b.keyCage=0;
        const c=mkEnemy(900); const d=mkEnemy(1200); d.keyCage=1;
        world.enemies.push(a,b,c,d);
        world.cages = [
            {id:nextEid++, floorN:4, x:500,  open:false},
            {id:nextEid++, floorN:4, x:1100, open:false},
        ];
    } else if (floor === 5) {
        world.boss = mkBoss(800,'boss5');
        world.cages = [{id:nextEid++, floorN:5, x:1300, open:false}];
    }
    broadcast({type:'world_state', world: serializeWorld()});
    broadcast({type:'hint', text: 'Этаж '+floor+' / 5'});
}

function spawnWave(floor) {
    const positions = FLOOR_WAVE_POS[floor];
    if (!positions || world.waveIndex >= positions.length) {
        world.waveActive = false;
        world.ladders.push({id:nextEid++, floorN:floor, x:768});
        broadcast({type:'world_state', world:serializeWorld()});
        broadcast({type:'hint', text:'Все волны пройдены! Поднимайся выше!'});
        return;
    }
    const pos = positions[world.waveIndex++];
    world.waveActive = true;
    pos.forEach(x => {
        const r = Math.random();
        const type = r<0.35 ? 'dark_servant' : r<0.65 ? 'dark_torch' : 'dark_servant';
        world.enemies.push(mkEnemy(x, type));
    });
    broadcast({type:'world_state', world:serializeWorld()});
    broadcast({type:'wave', index:world.waveIndex});
}

function serializeWorld() {
    return {
        scene: world.scene,
        floor: world.floor,
        enemies: world.enemies.map(e=>({id:e.id,x:e.x,type:e.type,hp:e.hp,maxHp:e.maxHp,vx:e.vx,superJumping:e.superJumping})),
        boss: world.boss ? {id:world.boss.id,x:world.boss.x,type:world.boss.type,hp:world.boss.hp,maxHp:world.boss.maxHp,active:world.boss.active,name:world.boss.name,vx:world.boss.vx} : null,
        blackMan: world.blackMan ? {id:world.blackMan.id,x:world.blackMan.x,hp:world.blackMan.hp,maxHp:world.blackMan.maxHp,active:world.blackMan.active} : null,
        drops: world.drops.map(d=>({id:d.id,x:d.x,y:d.y,type:d.type,subType:d.subType})),
        cages: world.cages.map(c=>({id:c.id,x:c.x,floorN:c.floorN,open:c.open})),
        keys: world.keys.map(k=>({id:k.id,x:k.x})),
        ladders: world.ladders.map(l=>({id:l.id,x:l.x,floorN:l.floorN})),
        sewerRats: world.sewerRats.map(r=>({id:r.id,x:r.x,hp:r.hp,maxHp:r.maxHp,vx:r.vx})),
        sewerExitOpen: world.sewerExitOpen,
        chest: world.chest,
        merchant: {x:world.merchant.x, active:world.merchant.active},
        waveActive: world.waveActive,
        waveIndex: world.waveIndex,
        castleCleared: world.castleCleared,
        houseBlackManDefeated: world.houseBlackManDefeated,
    };
}

// ─────────────────────────────────────────────────────────────
// PLAYERS
// ─────────────────────────────────────────────────────────────
let players = {}, nextId = 1;

function mkPlayer(id, ws, nick, x) {
    return {
        id, ws, nick,
        x: x||200, y: 0,
        vx:0, vy:0,
        hp:100, maxHp:100,
        armor:'none', swordType:'iron', hasSword:false,
        coins:0, potions:3,
        score:0, dead:false,
        facingRight:true, state:'idle',
        attackCooldown:0,
        invincible:0,
        keysHeld:0,
    };
}

function broadcast(data, excludeId) {
    const msg = JSON.stringify(data);
    Object.values(players).forEach(p => {
        if (p.id !== excludeId && p.ws.readyState === 1) p.ws.send(msg);
    });
}
function sendTo(id, data) {
    const p = players[id];
    if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(data));
}
function broadcastAll(data) { broadcast(data, -1); }

// ─────────────────────────────────────────────────────────────
// SWORD STATS (урон для PvP)
// ─────────────────────────────────────────────────────────────
const SWORD_DMG = { iron:10, gold:18, mithril:28, demon:40 };
const ARMOR_DEF = { none:0, iron:0.15, gold:0.25, mithril:0.40, demon:0.60 };

// ─────────────────────────────────────────────────────────────
// SERVER GAME TICK
// ─────────────────────────────────────────────────────────────
function getActivePlayers() {
    return Object.values(players).filter(p=>!p.dead);
}

function nearestPlayer(x) {
    let best=null, dist=Infinity;
    getActivePlayers().forEach(p=>{
        const d=Math.abs(p.x-x);
        if(d<dist){dist=d;best=p;}
    });
    return best;
}

function tickEnemies() {
    const scene = world.scene;
    if (scene === 'world') {
        // Спавн врагов в тёмном лесу
        world.enemySpawnTimer++;
        if (world.enemySpawnTimer > 360 && getActivePlayers().length > 0) {
            world.enemySpawnTimer = 0;
            const refX = getActivePlayers()[0].x;
            if (refX > 2000) { // правее замка
                const r = Math.random();
                const type = r<0.33?'zombie':r<0.66?'skeleton':'enemy';
                const spawnX = refX + 600 + Math.random()*300;
                world.enemies.push(mkEnemy(spawnX, type));
            }
        }
        // Обновить worldEnemies
        for (let i = world.enemies.length-1; i>=0; i--) {
            const en = world.enemies[i];
            const target = nearestPlayer(en.x);
            if (!target) continue;
            if (en.superJumping) {
                en.superVy = (en.superVy||0)+0.7;
                en.x += en.vx*0.5;
                const groundHit = true; // simplify: land immediately after jump
                if (en.superVy > 8) { en.superJumping=false; en.superLanded=true; en.superVy=0; }
                continue;
            }
            if (Math.abs(en.vx) < 0.5) en.vx = en.x < target.x ? en.speed : -en.speed;
            en.vx *= 0.9; en.x += en.vx;
            if (Math.abs(target.x - en.x) < 45 && target.invincible <= 0) {
                en.attackCtr = (en.attackCtr||0)+1;
                const dmg = 0.5 * (1-ARMOR_DEF[target.armor]);
                target.hp -= Math.max(0.05, dmg);
                target.vx = target.x < en.x ? -8 : 8;
                if (target.hp <= 0) killPlayer(target, null);
                else broadcastAll({type:'hp', id:target.id, hp:target.hp});
            }
        }
    } else if (scene === 'corridor') {
        // Boss tick
        if (world.boss && world.boss.active) {
            const b = world.boss;
            const target = nearestPlayer(b.x);
            if (target) {
                const dist = Math.abs(target.x - b.x);
                if (dist > 80) b.vx = target.x > b.x ? 2 : -2;
                else b.vx = 0;
                b.x += b.vx;
                b.attackTimer = (b.attackTimer||0)+1;
                if (dist < 120 && b.attackTimer > 60) {
                    b.attackTimer = 0;
                    const dmg = 15 * (1-ARMOR_DEF[target.armor]);
                    target.hp -= dmg; target.vx = target.x<b.x?-10:10;
                    if (target.hp<=0) killPlayer(target,null);
                    else broadcastAll({type:'hp', id:target.id, hp:target.hp});
                }
            }
        }
        // Wave enemies
        for (let i = world.enemies.length-1; i>=0; i--) {
            const en = world.enemies[i];
            const target = nearestPlayer(en.x);
            if (!target) continue;
            if (Math.abs(en.vx) < 0.5) en.vx = en.x < target.x ? en.speed : -en.speed;
            en.vx *= 0.9; en.x += en.vx;
            if (Math.abs(target.x - en.x) < 45) {
                const dmg = 0.5*(1-ARMOR_DEF[target.armor]);
                target.hp -= Math.max(0.05,dmg);
                if (target.hp<=0) killPlayer(target,null);
                else broadcastAll({type:'hp', id:target.id, hp:target.hp});
            }
        }
    } else if (scene === 'inside_house') {
        if (world.blackMan && world.blackMan.active) {
            const bm = world.blackMan;
            const target = nearestPlayer(bm.x);
            if (target) {
                const dist = Math.abs(target.x - bm.x);
                bm.vx = dist > 60 ? (target.x > bm.x ? 2 : -2) : 0;
                bm.x = Math.max(50, Math.min(1130, bm.x + bm.vx));
                bm.attackTimer = (bm.attackTimer||0)+1;
                if (dist < 80 && bm.attackTimer > 55) {
                    bm.attackTimer = 0;
                    const dmg = 12*(1-ARMOR_DEF[target.armor]);
                    target.hp -= dmg; target.vx = target.x<bm.x?-12:12;
                    if (target.hp<=0) killPlayer(target,null);
                    else broadcastAll({type:'hp',id:target.id,hp:target.hp});
                }
            }
        }
    } else if (scene === 'sewer') {
        for (let i=world.sewerRats.length-1; i>=0; i--) {
            const rat = world.sewerRats[i];
            const target = nearestPlayer(rat.x);
            if (!target) continue;
            if (Math.abs(rat.vx)<0.5) rat.vx = rat.x<target.x ? rat.speed||2.5 : -(rat.speed||2.5);
            rat.vx*=0.92; rat.x+=rat.vx;
            if (Math.abs(target.x-rat.x)<35) {
                const dmg=0.4*(1-ARMOR_DEF[target.armor]);
                target.hp-=Math.max(0.05,dmg);
                if (target.hp<=0) killPlayer(target,null);
                else broadcastAll({type:'hp',id:target.id,hp:target.hp});
            }
        }
        if (world.sewerRats.length===0 && !world.sewerExitOpen) {
            world.sewerExitOpen=true;
            broadcastAll({type:'hint',text:'Путь открыт! Дойди до выхода.'});
        }
    }
}

function killPlayer(p, killedBy) {
    p.dead = true; p.hp = 0;
    if (killedBy) killedBy.score++;
    broadcastAll({type:'player_died', id:p.id, killedBy:killedBy?killedBy.nick:null});
    if (killedBy) broadcastAll({type:'score',id:killedBy.id,score:killedBy.score});
    broadcastAll({type:'chat',system:true,text:`💀 ${p.nick} ${killedBy?'убит '+killedBy.nick:'погиб'}`});
    setTimeout(()=>{
        if (!players[p.id]) return;
        players[p.id].dead=false; players[p.id].hp=players[p.id].maxHp;
        players[p.id].x=200; players[p.id].y=0;
        broadcastAll({type:'respawn',id:p.id,x:200});
    },3000);
}

// Main server tick
setInterval(()=>{
    if (Object.keys(players).length === 0) return;
    tickEnemies();
    // Send compact delta every tick
    broadcastAll({
        type:'tick',
        enemies: world.enemies.map(e=>({id:e.id,x:Math.round(e.x),hp:e.hp,vx:+(e.vx).toFixed(1),superJumping:e.superJumping||false})),
        boss: world.boss ? {x:Math.round(world.boss.x),hp:world.boss.hp,active:world.boss.active,vx:+(world.boss.vx||0).toFixed(1)} : null,
        blackMan: world.blackMan ? {x:Math.round(world.blackMan.x),hp:world.blackMan.hp,active:world.blackMan.active} : null,
        sewerRats: world.sewerRats.map(r=>({id:r.id,x:Math.round(r.x),hp:r.hp,vx:+(r.vx).toFixed(1)})),
    });
}, TICK_RATE);

// ─────────────────────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
    const id = nextId++;

    ws.on('message', raw => {
        let msg; try { msg=JSON.parse(raw); } catch { return; }

        // ── JOIN ──
        if (msg.type === 'join') {
            const nick = String(msg.nickname||'Player'+id).slice(0,16).toUpperCase();
            players[id] = mkPlayer(id, ws, nick, 200);
            // Send welcome: own id + all other players + full world
            sendTo(id, {
                type:'welcome', id,
                players: Object.values(players).filter(p=>p.id!==id).map(serializePlayer),
                world: serializeWorld(),
            });
            broadcast({type:'player_joined', player:serializePlayer(players[id])}, id);
            broadcastAll({type:'chat',system:true,text:`⚡ ${nick} вошёл в игру`});
            console.log(`${nick}(${id}) joined. Total:${Object.keys(players).length}`);
        }

        // ── MOVE ──
        else if (msg.type==='move' && players[id]) {
            const p=players[id];
            p.x=msg.x; p.y=msg.y; p.vx=msg.vx||0; p.vy=msg.vy||0;
            p.facingRight=msg.facingRight; p.state=msg.state;
            if (p.invincible>0) p.invincible--;
            broadcast({type:'move',id,x:msg.x,y:msg.y,facingRight:msg.facingRight,state:msg.state},id);
        }

        // ── ATTACK (hit enemy) ──
        else if (msg.type==='hit_enemy' && players[id]) {
            const p=players[id];
            const dmg = (SWORD_DMG[p.swordType]||10);
            // World enemy
            let en = world.enemies.find(e=>e.id===msg.eid);
            if (!en && world.boss && world.boss.id===msg.eid) en = world.boss;
            if (!en && world.blackMan && world.blackMan.id===msg.eid) en = world.blackMan;
            if (!en) { en = world.sewerRats.find(r=>r.id===msg.eid); }
            if (en) {
                en.hp -= dmg;
                en.vx = p.x < en.x ? 6 : -6;
                if (en.hp <= 0) killEnemy(en, p);
                else broadcastAll({type:'enemy_hp',eid:en.id,hp:en.hp});
            }
        }

        // ── ATTACK (hit player PvP) ──
        else if (msg.type==='hit_player' && players[id]) {
            const attacker=players[id];
            const target=players[msg.targetId];
            if (!target||target.dead||target.invincible>0) return;
            const dmg=(SWORD_DMG[attacker.swordType]||10)*(1-ARMOR_DEF[target.armor]);
            target.hp-=dmg; target.invincible=30;
            if (target.hp<=0) killPlayer(target, attacker);
            else broadcastAll({type:'hp',id:target.id,hp:target.hp});
        }

        // ── PICK UP drop ──
        else if (msg.type==='pickup' && players[id]) {
            const p=players[id];
            const idx=world.drops.findIndex(d=>d.id===msg.did);
            if (idx<0) return;
            const drop=world.drops.splice(idx,1)[0];
            if (drop.type==='coin') { p.coins++; sendTo(id,{type:'coins',coins:p.coins}); }
            else if (drop.type==='sword') { p.hasSword=true; p.swordType=drop.subType||'iron'; sendTo(id,{type:'equip',armor:p.armor,swordType:p.swordType,hasSword:true}); }
            else if (drop.type==='armor') { p.armor=drop.subType||'iron'; sendTo(id,{type:'equip',armor:p.armor,swordType:p.swordType,hasSword:p.hasSword}); }
            else if (drop.type==='key')   { p.keysHeld++; sendTo(id,{type:'keys',keys:p.keysHeld}); }
            broadcastAll({type:'drop_removed',did:drop.id});
        }

        // ── USE KEY on cage ──
        else if (msg.type==='use_key' && players[id]) {
            const p=players[id];
            const cage=world.cages.find(c=>c.id===msg.cid&&!c.open);
            if (!cage||p.keysHeld<=0) return;
            p.keysHeld--; cage.open=true;
            sendTo(id,{type:'keys',keys:p.keysHeld});
            broadcastAll({type:'cage_open',cid:cage.id});
            broadcastAll({type:'chat',system:true,text:`🔓 ${p.nick} открыл клетку!`});
        }

        // ── ENTER CASTLE ──
        else if (msg.type==='enter_castle' && players[id]) {
            if (world.scene!=='world') return;
            world.scene='corridor';
            initFloor(1);
            broadcastAll({type:'scene_change',scene:'corridor',floor:1});
            broadcastAll({type:'chat',system:true,text:`🏰 ${players[id].nick} вошёл в замок! Все следуют...`});
        }

        // ── GO UP ladder ──
        else if (msg.type==='go_floor' && players[id]) {
            const newFloor=msg.floor;
            if (newFloor<1||newFloor>5) return;
            if (world.scene==='corridor') {
                initFloor(newFloor);
                broadcastAll({type:'scene_change',scene:'corridor',floor:newFloor});
            }
        }

        // ── ENTER HOUSE ──
        else if (msg.type==='enter_house' && players[id]) {
            world.scene='inside_house';
            if (!world.blackMan && !world.houseBlackManDefeated) {
                world.blackMan=mkBoss(600,'blackMan');
            }
            broadcastAll({type:'scene_change',scene:'inside_house',floor:0});
            broadcastAll({type:'world_state',world:serializeWorld()});
        }

        // ── EXIT HOUSE ──
        else if (msg.type==='exit_house' && players[id]) {
            world.scene='world';
            broadcastAll({type:'scene_change',scene:'world',floor:0});
        }

        // ── ENTER SEWER ──
        else if (msg.type==='enter_sewer' && players[id]) {
            world.scene='sewer';
            world.sewerRats=[];
            world.sewerExitOpen=false;
            for(let i=0;i<4;i++) world.sewerRats.push(mkEnemy(300+i*400,'rat'));
            broadcastAll({type:'scene_change',scene:'sewer',floor:0});
            broadcastAll({type:'world_state',world:serializeWorld()});
        }

        // ── EXIT SEWER ──
        else if (msg.type==='exit_sewer' && players[id]) {
            world.scene='world';
            broadcastAll({type:'scene_change',scene:'world',floor:0});
        }

        // ── USE POTION ──
        else if (msg.type==='use_potion' && players[id]) {
            const p=players[id];
            if (p.potions<=0) return;
            p.potions--; p.hp=Math.min(p.maxHp,p.hp+15);
            sendTo(id,{type:'hp',id,hp:p.hp});
            sendTo(id,{type:'potions',potions:p.potions});
        }

        // ── OPEN CHEST ──
        else if (msg.type==='open_chest' && players[id]) {
            if (world.chest.open) return;
            world.chest.open=true;
            world.drops.push({id:nextEid++,type:'sword',subType:'iron',x:world.chest.x,y:400,vx:2,vy:-5});
            broadcastAll({type:'chest_open'});
            broadcastAll({type:'world_state',world:serializeWorld()});
        }

        // ── CHAT ──
        else if (msg.type==='chat' && players[id]) {
            broadcastAll({type:'chat',system:false,nickname:players[id].nick,text:String(msg.text).slice(0,100)});
        }

        // ── SYNC equipment from client ──
        else if (msg.type==='equip_sync' && players[id]) {
            const p=players[id];
            p.armor=msg.armor||p.armor;
            p.swordType=msg.swordType||p.swordType;
            p.hasSword=msg.hasSword!==undefined?msg.hasSword:p.hasSword;
            broadcast({type:'player_equip',id,armor:p.armor,swordType:p.swordType},id);
        }
    });

    ws.on('close', ()=>{
        if (!players[id]) return;
        const nick=players[id].nick;
        delete players[id];
        broadcast({type:'player_left',id});
        broadcastAll({type:'chat',system:true,text:`👋 ${nick} покинул игру`});
        console.log(`${nick}(${id}) left. Total:${Object.keys(players).length}`);
    });
    ws.on('error', err=>console.error('WS:',err.message));
});

function killEnemy(en, killer) {
    // Drop loot
    const drop={id:nextEid++,x:en.x,y:400,vx:(Math.random()-0.5)*3,vy:-4};
    if (en.keyCage!==undefined) {
        drop.type='key'; world.drops.push(drop);
    } else {
        drop.type='coin'; world.drops.push(drop);
    }
    // Remove from lists
    world.enemies = world.enemies.filter(e=>e.id!==en.id);
    world.sewerRats = world.sewerRats.filter(r=>r.id!==en.id);
    if (world.boss && world.boss.id===en.id) {
        world.boss.active=false;
        world.boss.hp=0;
        broadcastAll({type:'boss_dead',name:world.boss.name});
        broadcastAll({type:'hint',text:'Босс повержён! Готовься к волнам!'});
        // Award loot
        const swordDrop={id:nextEid++,x:en.x,y:400,vx:2,vy:-5,type:'sword',subType:'gold'};
        world.drops.push(swordDrop);
        // Start waves after boss
        const floor=world.floor;
        if (FLOOR_WAVE_POS[floor]) setTimeout(()=>spawnWave(floor),1500);
    }
    if (world.blackMan && world.blackMan.id===en.id) {
        world.blackMan.active=false; world.houseBlackManDefeated=true;
        broadcastAll({type:'black_man_dead'});
        const swordDrop={id:nextEid++,x:en.x,y:400,vx:2,vy:-5,type:'sword',subType:'gold'};
        world.drops.push(swordDrop);
    }
    broadcastAll({type:'enemy_dead',eid:en.id,drops:[drop]});
    // Check wave completion
    if (world.waveActive && world.enemies.length===0) {
        world.waveActive=false;
        const floor=world.floor;
        if (world.waveIndex < (FLOOR_WAVE_POS[floor]||[]).length) {
            setTimeout(()=>spawnWave(floor),1500);
        } else {
            world.ladders.push({id:nextEid++,floorN:floor,x:768});
            broadcastAll({type:'ladder_spawned',floorN:floor,x:768});
            broadcastAll({type:'hint',text:'Все волны пройдены! Поднимайся!'});
        }
    }
    if (killer) { killer.score++; broadcastAll({type:'score',id:killer.id,score:killer.score}); }
}

function serializePlayer(p) {
    return {id:p.id,nick:p.nick,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,
            armor:p.armor,swordType:p.swordType,hasSword:p.hasSword,
            coins:p.coins,score:p.score,dead:p.dead,
            facingRight:p.facingRight,state:p.state,w:60,h:80};
}

server.listen(PORT, ()=>{
    console.log(`Server on port ${PORT}`);
    fs.access(path.join(PUBLIC_DIR,'index.html'),fs.constants.F_OK,
        err=>console.log(err?'WARNING: index.html NOT FOUND':'index.html OK'));
});
