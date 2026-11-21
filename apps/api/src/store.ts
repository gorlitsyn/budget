/** Доступ к таблицам пользователей, сессий, инвайтов и прав. Вся работа с SQL — здесь. */
import {
  type Grants,
  type InviteInfo,
  type InvitePreview,
  type Member,
  type PasskeyInfo,
  type Section,
  type SharedSpace,
  OWNER_GRANTS,
  SECTIONS,
  grantsSchema,
} from '@money/shared';
import type { DB } from './db/index.ts';
import { DAY, newId, sha256 } from './util.ts';

export interface UserRow {
  id: string;
  name: string;
  admin: number;
  created_at: number;
}

export interface CredentialRow {
  id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  device_type: string;
  backed_up: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface InviteRow {
  id: string;
  token_hash: string;
  owner_id: string | null;
  note: string;
  grants: string;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
}

export interface NewCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  deviceType: string;
  backedUp: boolean;
  name: string;
}

const parseGrants = (json: string): Grants => grantsSchema.parse(JSON.parse(json));

export class Store {
  constructor(readonly db: DB) {}

  // ---- пользователи -------------------------------------------------------------------------

  userCount(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n;
  }

  getUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  createUser(id: string, name: string, admin: boolean, now = Date.now()): UserRow {
    this.db.prepare('INSERT INTO users (id, name, admin, created_at) VALUES (?, ?, ?, ?)').run(id, name, admin ? 1 : 0, now);
    return this.getUser(id)!;
  }

  renameUser(id: string, name: string): void {
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  }

  // ---- passkeys -----------------------------------------------------------------------------

  addCredential(userId: string, c: NewCredential, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, userId, Buffer.from(c.publicKey), c.counter, JSON.stringify(c.transports), c.deviceType, c.backedUp ? 1 : 0, c.name, now);
  }

  getCredential(id: string): CredentialRow | undefined {
    return this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as CredentialRow | undefined;
  }

  userCredentials(userId: string): CredentialRow[] {
    return this.db.prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at').all(userId) as CredentialRow[];
  }

  listPasskeys(userId: string): PasskeyInfo[] {
    return this.userCredentials(userId).map((c) => ({ id: c.id, name: c.name, createdAt: c.created_at, lastUsedAt: c.last_used_at }));
  }

  touchCredential(id: string, counter: number, now = Date.now()): void {
    this.db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?').run(counter, now, id);
  }

  renameCredential(userId: string, id: string, name: string): boolean {
    return this.db.prepare('UPDATE credentials SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId).changes > 0;
  }

  /** Последний passkey не удаляется — иначе в аккаунт не войти. */
  deleteCredential(userId: string, id: string): 'ok' | 'not_found' | 'last' {
    return this.db.transaction(() => {
      const own = this.userCredentials(userId);
      if (!own.some((c) => c.id === id)) return 'not_found' as const;
      if (own.length === 1) return 'last' as const;
      this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id);
      return 'ok' as const;
    })();
  }

  // ---- сессии -------------------------------------------------------------------------------

  createSession(userId: string, days: number, now = Date.now()): string {
    const token = newId(32);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(sha256(token), userId, now, now, now + days * DAY);
    return token;
  }

  /** Скользящий срок: активная сессия продлевается, но не чаще раза в сутки. */
  sessionUser(token: string, days: number, now = Date.now()): UserRow | undefined {
    const hash = sha256(token);
    const s = this.db.prepare('SELECT user_id, last_seen_at, expires_at FROM sessions WHERE token_hash = ?').get(hash) as
      | { user_id: string; last_seen_at: number; expires_at: number }
      | undefined;
    if (!s) return undefined;
    if (s.expires_at <= now) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return undefined;
    }
    if (now - s.last_seen_at > DAY) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(now, now + days * DAY, hash);
    }
    return this.getUser(s.user_id);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }

  // ---- церемонии WebAuthn -------------------------------------------------------------------

  saveChallenge(c: { challenge: string; kind: 'register' | 'login' | 'add'; userId?: string; inviteId?: string; name?: string }, now = Date.now()): string {
    const id = newId(16);
    this.db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now);
    this.db
      .prepare('INSERT INTO challenges (id, challenge, kind, user_id, invite_id, name, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, c.challenge, c.kind, c.userId ?? null, c.inviteId ?? null, c.name ?? null, now + 5 * 60 * 1000);
    return id;
  }

  /** Одноразово: прочитанная церемония удаляется, повтор ответа не пройдёт. */
  takeChallenge(id: string, kind: 'register' | 'login' | 'add', now = Date.now()) {
    const row = this.db.prepare('DELETE FROM challenges WHERE id = ? RETURNING *').get(id) as
      | { challenge: string; kind: string; user_id: string | null; invite_id: string | null; name: string | null; expires_at: number }
      | undefined;
    if (!row || row.kind !== kind || row.expires_at <= now) return undefined;
    return row;
  }

  // ---- инвайты ------------------------------------------------------------------------------

  createInvite(ownerId: string | null, note: string, grants: Grants, days: number, now = Date.now()): { id: string; token: string } {
    const id = newId(9);
    const token = newId(24);
    this.db
      .prepare('INSERT INTO invites (id, token_hash, owner_id, note, grants, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, sha256(token), ownerId, note, JSON.stringify(grants), now, now + days * DAY);
    return { id, token };
  }

  /** Действующий инвайт по токену из ссылки: не использован и не истёк. */
  activeInvite(token: string, now = Date.now()): InviteRow | undefined {
    const row = this.db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(token)) as InviteRow | undefined;
    if (!row || row.used_by || row.used_at || row.expires_at <= now) return undefined;
    return row;
  }

  getInvite(id: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE id = ?').get(id) as InviteRow | undefined;
  }

  invitePreview(row: InviteRow): InvitePreview {
    const owner = row.owner_id ? this.getUser(row.owner_id) : undefined;
    return { ownerName: owner?.name ?? null, grants: parseGrants(row.grants), system: row.owner_id === null };
  }

  /** Мои инвайты: действующие и использованные за последний месяц. */
  listInvites(ownerId: string, now = Date.now()): InviteInfo[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by
         WHERE i.owner_id = ? AND ((i.used_at IS NULL AND i.expires_at > ?) OR i.used_at > ?)
         ORDER BY i.created_at DESC`,
      )
      .all(ownerId, now, now - 30 * DAY) as (InviteRow & { used_by_name: string | null })[];
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      grants: parseGrants(r.grants),
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      usedBy: r.used_by,
      usedByName: r.used_by_name,
    }));
  }

  revokeInvite(ownerId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM invites WHERE id = ? AND owner_id = ? AND used_at IS NULL').run(id, ownerId).changes > 0;
  }

  /**
   * Погасить инвайт и выдать права из него. Права от этого владельца заменяются целиком:
   * последний принятый инвайт = актуальный набор. Возвращает false, если инвайт уже не действует
   * (параллельный запрос успел раньше).
   */
  redeemInvite(inviteId: string, userId: string, now = Date.now()): boolean {
    return this.db.transaction(() => {
      const used = this.db
        .prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING owner_id, grants')
        .get(userId, now, inviteId, now) as { owner_id: string | null; grants: string } | undefined;
      if (!used) return false;
      if (used.owner_id && used.owner_id !== userId) this.setGrants(used.owner_id, userId, parseGrants(used.grants), now);
      return true;
    })();
  }

  // ---- права --------------------------------------------------------------------------------

  /** Права пользователя в пространстве владельца. Владелец видит своё целиком. */
  grantsIn(ownerId: string, userId: string): Grants {
    if (ownerId === userId) return { ...OWNER_GRANTS };
    const rows = this.db.prepare('SELECT section, level FROM grants WHERE owner_id = ? AND member_id = ?').all(ownerId, userId) as {
      section: Section;
      level: 'view' | 'edit';
    }[];
    return Object.fromEntries(rows.map((r) => [r.section, r.level])) as Grants;
  }

  /** Заменить права участника. Пустой набор = участник удалён. */
  setGrants(ownerId: string, memberId: string, grants: Grants, now = Date.now()): void {
    if (ownerId === memberId) throw new Error('Нельзя выдать права самому себе');
    this.db.transaction(() => {
      const old = this.grantsIn(ownerId, memberId);
      const since = this.memberSince(ownerId, memberId) ?? now;
      this.db.prepare('DELETE FROM grants WHERE owner_id = ? AND member_id = ?').run(ownerId, memberId);
      const ins = this.db.prepare('INSERT INTO grants (owner_id, member_id, section, level, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const s of SECTIONS) {
        const level = grants[s];
        if (level) ins.run(ownerId, memberId, s, level, old[s] ? since : now);
      }
    })();
  }

  private memberSince(ownerId: string, memberId: string): number | undefined {
    const r = this.db.prepare('SELECT min(created_at) AS t FROM grants WHERE owner_id = ? AND member_id = ?').get(ownerId, memberId) as {
      t: number | null;
    };
    return r.t ?? undefined;
  }

  /** Кому я дал доступ. */
  members(ownerId: string): Member[] {
    const rows = this.db
      .prepare(
        `SELECT g.member_id, u.name, g.section, g.level, g.created_at FROM grants g JOIN users u ON u.id = g.member_id
         WHERE g.owner_id = ? ORDER BY u.name, g.member_id`,
      )
      .all(ownerId) as { member_id: string; name: string; section: Section; level: 'view' | 'edit'; created_at: number }[];
    return groupBy(rows, (r) => r.member_id).map((rs) => ({
      userId: rs[0]!.member_id,
      name: rs[0]!.name,
      grants: Object.fromEntries(rs.map((r) => [r.section, r.level])) as Grants,
      since: Math.min(...rs.map((r) => r.created_at)),
    }));
  }

  /** Чужие пространства, куда меня пустили. */
  sharedSpaces(memberId: string): SharedSpace[] {
    const rows = this.db
      .prepare(
        `SELECT g.owner_id, u.name, g.section, g.level FROM grants g JOIN users u ON u.id = g.owner_id
         WHERE g.member_id = ? ORDER BY u.name, g.owner_id`,
      )
      .all(memberId) as { owner_id: string; name: string; section: Section; level: 'view' | 'edit' }[];
    return groupBy(rows, (r) => r.owner_id).map((rs) => ({
      ownerId: rs[0]!.owner_id,
      ownerName: rs[0]!.name,
      grants: Object.fromEntries(rs.map((r) => [r.section, r.level])) as Grants,
    }));
  }
}

function groupBy<T>(rows: T[], key: (r: T) => string): T[][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return [...m.values()];
}
