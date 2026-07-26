const WebSocket = require('ws');
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico':  'image/x-icon',
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
};

const server = http.createServer((req, res) => {
    let urlPath = req.url.split('?')[0];
    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

    const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(PUBLIC_DIR, safePath);

    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            // Fallback to index.html
            fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
                if (e2) { res.writeHead(500); res.end('Error'); return; }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(d2);
            });
            return;
        }
        const ct = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct });
        res.end(data);
    });
});

const wss = new WebSocket.Server({ server });

let players = {};
let nextId  = 1;

function broadcast(data, excludeId) {
    const msg = JSON.stringify(data);
    Object.values(players).forEach(p => {
        if (p.id !== excludeId && p.ws.readyState === WebSocket.OPEN)
            p.ws.send(msg);
    });
}
function sendTo(id, data) {
    const p = players[id];
    if (p && p.ws.readyState === WebSocket.OPEN)
        p.ws.send(JSON.stringify(data));
}

wss.on('connection', ws => {
    const id = nextId++;
    console.log(`Connected: id=${id}`);

    ws.on('message', raw => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }

        if (msg.type === 'join') {
            const nick = String(msg.nickname || ('Player' + id)).slice(0, 16).toUpperCase();
            players[id] = { id, ws, nick, x: 300 + Math.random()*600, y: 0, hp: 100, maxHp: 100, score: 0, dead: false };

            sendTo(id, {
                type: 'welcome', id,
                players: Object.values(players).filter(p => p.id !== id)
                    .map(p => ({ id: p.id, nick: p.nick, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, score: p.score, facingRight: true, state: 'idle' }))
            });

            broadcast({ type: 'player_joined', id, nick, x: players[id].x, y: players[id].y, hp: 100, maxHp: 100, score: 0, facingRight: true, state: 'idle' }, id);
            broadcast({ type: 'chat', system: true, text: `⚡ ${nick} вошёл в игру` });
            console.log(`${nick}(${id}) joined. Total: ${Object.keys(players).length}`);
        }

        else if (msg.type === 'move' && players[id]) {
            players[id].x = msg.x; players[id].y = msg.y;
            broadcast({ type: 'move', id, x: msg.x, y: msg.y, facingRight: msg.facingRight, state: msg.state }, id);
        }

        else if (msg.type === 'attack' && players[id]) {
            broadcast({ type: 'attack', id }, id);
        }

        else if (msg.type === 'hit' && players[id]) {
            const target = players[msg.targetId];
            if (!target || target.dead) return;
            target.hp -= (msg.damage || 25);
            if (target.hp < 0) target.hp = 0;
            broadcast({ type: 'hp', id: msg.targetId, hp: target.hp });

            if (target.hp <= 0) {
                target.dead = true;
                players[id].score++;
                broadcast({ type: 'player_died', id: msg.targetId, killedBy: players[id].nick });
                broadcast({ type: 'score',       id: id, score: players[id].score });
                broadcast({ type: 'chat', system: true, text: `💀 ${target.nick} убит игроком ${players[id].nick}` });

                setTimeout(() => {
                    if (players[msg.targetId]) {
                        players[msg.targetId].dead = false;
                        players[msg.targetId].hp   = players[msg.targetId].maxHp;
                        const rx = 200 + Math.random() * 800;
                        broadcast({ type: 'respawn', id: msg.targetId, x: rx, y: 0 });
                    }
                }, 3000);
            }
        }

        else if (msg.type === 'chat' && players[id]) {
            broadcast({ type: 'chat', system: false, nickname: players[id].nick, text: String(msg.text).slice(0, 100) });
        }
    });

    ws.on('close', () => {
        if (players[id]) {
            const nick = players[id].nick;
            delete players[id];
            broadcast({ type: 'player_left', id });
            broadcast({ type: 'chat', system: true, text: `👋 ${nick} покинул игру` });
            console.log(`${nick}(${id}) left. Total: ${Object.keys(players).length}`);
        }
    });

    ws.on('error', err => console.error('WS error:', err.message));
});

server.listen(PORT, () => {
    console.log(`Server on port ${PORT}`);
    fs.access(path.join(PUBLIC_DIR, 'index.html'), fs.constants.F_OK, err => {
        console.log(err ? 'WARNING: index.html NOT FOUND' : 'index.html OK');
    });
});
