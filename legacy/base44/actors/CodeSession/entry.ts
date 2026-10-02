// LEGACY BASE44 ACTOR REFERENCE - RETAINED TEMPORARILY FOR AUDIT PURPOSES
// PRODUCTION WEBSOCKET REALTIME ENGINE HAS BEEN MIGRATED TO server/realtime.js
import { Actor } from 'base44:runtime/actors';

const MAX_USERS = 50;

export default class CodeSession extends Actor {
  users = new Map();       // conn.id -> { seat, name, anonymous }
  nextSeat = 1;
  content = new Map();     // file_id -> content string (live truth)
  persistTimer = null;

  async handleStart() {
    const saved = await this.storage.get('content');
    if (saved) this.content = new Map(saved);
    const seats = await this.storage.get('seats');
    if (seats) this.users = new Map(seats);
    const live = new Set(this.getConnections().map((c) => c.id));
    for (const id of this.users.keys()) if (!live.has(id)) this.users.delete(id);
    this.nextSeat = Math.max(0, ...[...this.users.values()].map((u) => u.seat)) + 1;
  }

  async handleConnect(conn) {
    if (!this.users.has(conn.id) && this.users.size >= MAX_USERS) {
      conn.reject(4001, 'room full');
      return;
    }
    if (!this.users.has(conn.id)) {
      this.users.set(conn.id, { seat: this.nextSeat++, name: 'Guest', anonymous: true });
      await this.saveSeats();
    }
    conn.send({ type: 'sync', content: Object.fromEntries(this.content), seat: this.users.get(conn.id).seat });
    this.broadcastPresence();
  }

  async handleMessage(conn, msg) {
    if (typeof msg !== 'object' || msg === null) return;
    const u = this.users.get(conn.id);
    if (!u) return;
    if (msg.type === 'ping') {
      conn.send({ type: 'pong' });
    } else if (msg.type === 'presence' && typeof msg.name === 'string') {
      u.name = String(msg.name).slice(0, 40);
      u.anonymous = !!msg.anonymous;
      await this.saveSeats();
      this.broadcastPresence();
    } else if (msg.type === 'init' && msg.files && typeof msg.files === 'object') {
      let changed = false;
      for (const [fid, c] of Object.entries(msg.files)) {
        if (!this.content.has(fid) && typeof c === 'string') { this.content.set(fid, c); changed = true; }
      }
      if (changed) this.persistContent();
    } else if (msg.type === 'request_file' && typeof msg.file_id === 'string') {
      if (this.content.has(msg.file_id)) {
        conn.send({ type: 'sync_file', file_id: msg.file_id, content: this.content.get(msg.file_id) });
      }
    } else if (msg.type === 'edit' && typeof msg.file_id === 'string' && typeof msg.content === 'string') {
      this.content.set(msg.file_id, msg.content);
      this.persistContent();
      this.broadcast({ type: 'edit', file_id: msg.file_id, content: msg.content, seat: u.seat }, conn.id);
    }
  }

  async handleClose(conn) {
    this.users.delete(conn.id);
    await this.saveSeats();
    this.broadcastPresence();
  }

  saveSeats() { return this.storage.put('seats', [...this.users.entries()]); }
  persistContent() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.storage.put('content', [...this.content.entries()]);
      this.persistTimer = null;
    }, 1000);
  }
  broadcastPresence() {
    this.broadcast({
      type: 'presence',
      users: [...this.users.values()].map((u) => ({ name: u.name, anonymous: u.anonymous, seat: u.seat }))
    });
  }
}
