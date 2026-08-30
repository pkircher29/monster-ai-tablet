import dgram from 'node:dgram';

// Minimal mDNS responder: answers A queries for a set of `.local` names with our LAN IPv4.
// Zero dependencies. Makes `agentos.local` resolvable by any mDNS client on the LAN
// (macOS, Linux avahi, Windows, iOS/Android). Multicast group 224.0.0.251:5353.

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;

function encodeName(name) {
  const parts = name.split('.').filter(Boolean);
  const bufs = parts.map(p => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

function readName(buf, offset) {
  const labels = [];
  let o = offset, jumped = false, safety = 0;
  while (safety++ < 128) {
    const len = buf[o];
    if (len === 0) { o++; break; }
    if ((len & 0xc0) === 0xc0) { // compression pointer
      const ptr = ((len & 0x3f) << 8) | buf[o + 1];
      if (!jumped) offset = o + 2;
      o = ptr; jumped = true; continue;
    }
    labels.push(buf.toString('utf8', o + 1, o + 1 + len));
    o += 1 + len;
  }
  return { name: labels.join('.'), next: jumped ? offset : o };
}

function buildAnswer(name, ipv4) {
  const nameBuf = encodeName(name);
  const rd = Buffer.from(ipv4.split('.').map(Number));
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(1, 0);        // TYPE A
  rr.writeUInt16BE(0x8001, 2);   // CLASS IN + cache-flush bit
  rr.writeUInt32BE(120, 4);      // TTL
  rr.writeUInt16BE(4, 8);        // RDLENGTH
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);        // ID
  header.writeUInt16BE(0x8400, 2);   // flags: response, authoritative
  header.writeUInt16BE(0, 4);        // QDCOUNT
  header.writeUInt16BE(1, 6);        // ANCOUNT
  return Buffer.concat([header, nameBuf, rr, rd]);
}

export function startMdns({ names, ipv4, onLog = () => {} }) {
  if (!ipv4) { onLog('mdns: no LAN IPv4, responder not started'); return null; }
  const want = new Set(names.map(n => n.toLowerCase()));
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('error', (e) => onLog('mdns error: ' + e.message));
  sock.on('message', (msg, rinfo) => {
    try {
      if (msg.length < 12) return;
      const qd = msg.readUInt16BE(4);
      if (qd < 1) return;
      let o = 12;
      for (let i = 0; i < qd; i++) {
        const { name, next } = readName(msg, o);
        const qtype = msg.readUInt16BE(next);
        o = next + 4;
        if ((qtype === 1 || qtype === 255) && want.has(name.toLowerCase())) {
          const resp = buildAnswer(name, ipv4);
          sock.send(resp, 0, resp.length, MDNS_PORT, MDNS_ADDR);
        }
      }
    } catch {}
  });

  sock.bind(MDNS_PORT, () => {
    try {
      sock.addMembership(MDNS_ADDR);
      sock.setMulticastTTL(255);
      onLog(`mdns: advertising ${[...want].join(', ')} -> ${ipv4}`);
    } catch (e) { onLog('mdns membership failed: ' + e.message); }
  });

  return sock;
}
