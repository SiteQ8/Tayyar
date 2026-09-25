// A small WebSocket server (RFC 6455) for one-way broadcasting. Tayyar only
// sends; from clients it reads pings, pongs and close frames. Each message is
// framed once and the same bytes are written to every subscriber.

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OP_TEXT = 0x1;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

export function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export function encodeFrame(opcode, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data], header.length + len);
}

export function closeFrame(code, reason = '') {
  const r = Buffer.from(reason);
  const payload = Buffer.alloc(2 + r.length);
  payload.writeUInt16BE(code, 0);
  r.copy(payload, 2);
  return encodeFrame(OP_CLOSE, payload);
}

// Reassembles client frames from TCP chunks. Clients must mask their frames;
// anything larger than `maxPayload` is refused, since Tayyar expects only
// control frames from clients.
export class FrameParser {
  constructor(maxPayload = 64 * 1024) {
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let o = 2;
      if (len === 126) {
        if (this.buf.length < 4) break;
        len = this.buf.readUInt16BE(2);
        o = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) break;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) throw new RangeError('frame too large');
        len = Number(big);
        o = 10;
      }
      if (len > this.maxPayload) throw new RangeError('frame too large');
      if (!masked) throw new TypeError('client frames must be masked');
      if (this.buf.length < o + 4 + len) break;
      const mask = this.buf.subarray(o, o + 4);
      const payload = Buffer.from(this.buf.subarray(o + 4, o + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload });
      this.buf = this.buf.subarray(o + 4 + len);
    }
    return frames;
  }
}

export class WebSocketHub {
  constructor({ maxClients = 1000, maxPerIp = 20, softBufferBytes = 4 * 1024 * 1024, hardBufferBytes = 16 * 1024 * 1024, pingMs = 30000, trustProxy = false } = {}) {
    this.maxClients = maxClients;
    this.maxPerIp = maxPerIp;
    this.softBufferBytes = softBufferBytes;
    this.hardBufferBytes = hardBufferBytes;
    this.trustProxy = trustProxy;
    this.channels = new Map();
    this.perIp = new Map();
    this.total = 0;
    this.dropped = 0;
    this.pingTimer = setInterval(() => this.keepalive(), pingMs);
    this.pingTimer.unref();
  }

  count(channel) {
    return this.channels.get(channel)?.size || 0;
  }

  clientIp(req) {
    if (this.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
  }

  static refuse(socket, status, text) {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`);
  }

  handleUpgrade(req, socket, head, channel) {
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (req.method !== 'GET' || upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
      WebSocketHub.refuse(socket, 400, 'Bad Request');
      return;
    }
    const ip = this.clientIp(req);
    if (this.total >= this.maxClients) {
      WebSocketHub.refuse(socket, 503, 'Service Unavailable');
      return;
    }
    if ((this.perIp.get(ip) || 0) >= this.maxPerIp) {
      WebSocketHub.refuse(socket, 429, 'Too Many Requests');
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);
    const client = { socket, ip, channel, alive: true, parser: new FrameParser(), connectedAt: Date.now(), sent: 0, dropped: 0 };
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel).add(client);
    this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    this.total += 1;

    const onData = (chunk) => {
      let frames;
      try {
        frames = client.parser.push(chunk);
      } catch {
        this.terminate(client, 1002);
        return;
      }
      for (const f of frames) {
        client.alive = true;
        if (f.opcode === OP_PING) socket.write(encodeFrame(OP_PONG, f.payload));
        else if (f.opcode === OP_CLOSE) this.terminate(client, 1000);
      }
    };
    socket.on('data', onData);
    socket.once('close', () => this.remove(client));
    socket.on('error', () => this.remove(client));
    if (head && head.length) onData(head);
  }

  remove(client) {
    const set = this.channels.get(client.channel);
    if (!set || !set.delete(client)) return;
    this.total -= 1;
    const n = (this.perIp.get(client.ip) || 1) - 1;
    if (n <= 0) this.perIp.delete(client.ip);
    else this.perIp.set(client.ip, n);
  }

  terminate(client, code) {
    this.remove(client);
    if (!client.socket.destroyed) {
      client.socket.end(closeFrame(code));
      setTimeout(() => client.socket.destroy(), 1000).unref();
    }
  }

  // Sends one pre-framed message to every client on a channel. A client that
  // cannot keep up misses messages rather than slowing everyone else, and is
  // disconnected if it falls far behind.
  broadcast(channel, frame) {
    const set = this.channels.get(channel);
    if (!set) return;
    for (const client of set) {
      const pending = client.socket.writableLength;
      if (pending > this.hardBufferBytes) {
        this.terminate(client, 1008);
        continue;
      }
      if (pending > this.softBufferBytes) {
        client.dropped += 1;
        this.dropped += 1;
        continue;
      }
      client.socket.write(frame);
      client.sent += 1;
    }
  }

  broadcastAll(frame) {
    for (const channel of this.channels.keys()) this.broadcast(channel, frame);
  }

  keepalive() {
    const ping = encodeFrame(OP_PING, Buffer.alloc(0));
    for (const set of this.channels.values()) {
      for (const client of set) {
        if (!client.alive) {
          this.remove(client);
          client.socket.destroy();
          continue;
        }
        client.alive = false;
        client.socket.write(ping);
      }
    }
  }

  close() {
    clearInterval(this.pingTimer);
    for (const set of this.channels.values()) {
      for (const client of [...set]) this.terminate(client, 1001);
    }
  }
}
