import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { acceptKey, encodeFrame, FrameParser, WebSocketHub, OP_TEXT, OP_PING } from '../src/ws.js';

function masked(opcode, payload, mask = [1, 2, 3, 4]) {
  const data = Buffer.from(payload);
  const len = data.length;
  const header = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len]) : Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255]);
  const body = Buffer.from(data.map((b, i) => b ^ mask[i & 3]));
  return Buffer.concat([header, Buffer.from(mask), body]);
}

test('computes the handshake answer from RFC 6455', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('frames payloads with each length encoding', () => {
  assert.deepEqual([...encodeFrame(OP_TEXT, Buffer.alloc(125)).subarray(0, 2)], [0x81, 125]);
  assert.deepEqual([...encodeFrame(OP_TEXT, Buffer.alloc(126)).subarray(0, 4)], [0x81, 126, 0, 126]);
  assert.deepEqual([...encodeFrame(OP_TEXT, Buffer.alloc(65535)).subarray(0, 4)], [0x81, 126, 255, 255]);
  const big = encodeFrame(OP_TEXT, Buffer.alloc(65536));
  assert.deepEqual([...big.subarray(0, 2)], [0x81, 127]);
  assert.equal(big.readBigUInt64BE(2), 65536n);
  assert.equal(big.length, 65536 + 10);
});

test('reassembles masked client frames split across reads', () => {
  const p = new FrameParser();
  const bytes = Buffer.concat([masked(OP_PING, 'hi'), masked(OP_TEXT, 'x'.repeat(300))]);
  const frames = [...p.push(bytes.subarray(0, 5)), ...p.push(bytes.subarray(5, 50)), ...p.push(bytes.subarray(50))];
  assert.equal(frames.length, 2);
  assert.equal(frames[0].opcode, OP_PING);
  assert.equal(frames[0].payload.toString(), 'hi');
  assert.equal(frames[1].payload.toString(), 'x'.repeat(300));
});

test('refuses unmasked and oversized client frames', () => {
  assert.throws(() => new FrameParser().push(Buffer.from([0x81, 0x01, 0x41])), /masked/);
  assert.throws(() => new FrameParser(10).push(masked(OP_TEXT, 'x'.repeat(50))), /too large/);
});

test('skips slow clients and disconnects clients that fall far behind', () => {
  const hub = new WebSocketHub({ softBufferBytes: 10, hardBufferBytes: 20, pingMs: 60000 });
  const fake = (pending) => {
    const s = new EventEmitter();
    s.writableLength = pending;
    s.writes = 0;
    s.destroyed = false;
    s.write = () => { s.writes += 1; };
    s.end = () => { s.ended = true; };
    s.destroy = () => { s.destroyed = true; };
    return s;
  };
  const sockets = { fast: fake(0), slow: fake(15), stuck: fake(25) };
  const clients = Object.entries(sockets).map(([name, socket]) => ({ name, socket, ip: name, channel: 'lite', alive: true, dropped: 0, sent: 0 }));
  hub.channels.set('lite', new Set(clients));
  hub.total = 3;
  hub.broadcast('lite', Buffer.from('frame'));
  assert.equal(sockets.fast.writes, 1);
  assert.equal(sockets.slow.writes, 0);
  assert.equal(hub.dropped, 1);
  assert.equal(sockets.stuck.ended, true);
  assert.equal(hub.count('lite'), 2);
  hub.close();
});
