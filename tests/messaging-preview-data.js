import { messageId } from "../messaging-utils.js";
// Isolated fictional data for browser QA. Never copied to a production deployment.
const ME = "a1000000-0000-0000-0000-000000000001",
  OTHER = "a2000000-0000-0000-0000-000000000002",
  CHAT = "d1000000-0000-0000-0000-000000000001";
const now = new Date().toISOString();
let people = [
  {
    user_id: ME,
    display_name: "Jordan Williams",
    approved: true,
    directory_visible: true,
    photo_visible: false,
    church_id: "demo",
    bio: "Outreach volunteer",
  },
  {
    user_id: OTHER,
    display_name: "Morgan Taylor",
    approved: true,
    directory_visible: true,
    photo_visible: false,
    church_id: "demo",
    bio: "Choir member",
  },
];
let chats = [
  {
    id: CHAT,
    kind: "group",
    title: "Choir Ministry",
    label: "Choir Ministry",
    can_manage: true,
    owner_id: ME,
    muted: false,
    preview: "See you at rehearsal!",
    last_at: now,
    archived: false,
    announcement_only: false,
  },
];
let rows = [
  {
    id: "e1000000-0000-0000-0000-000000000001",
    conversation_id: CHAT,
    sender_id: OTHER,
    body: "Good evening, choir! Rehearsal is Thursday at 7 PM. Please bring your music folder.",
    created_at: new Date(Date.now() - 3600000).toISOString(),
    pinned: true,
  },
  {
    id: "e2000000-0000-0000-0000-000000000002",
    conversation_id: CHAT,
    sender_id: ME,
    body: "Thank you! I will be there. 🙏",
    created_at: new Date(Date.now() - 1800000).toISOString(),
  },
  {
    id: "e3000000-0000-0000-0000-000000000003",
    conversation_id: CHAT,
    sender_id: OTHER,
    body: "See you at rehearsal!",
    created_at: now,
  },
];
let marks = [];
const tables = {
  member_profiles: people,
  messages: rows,
  conversation_read_states: [],
  cc_messaging_settings: [],
  cc_message_marks: marks,
  member_sms_preferences: [],
  ministries: [],
  ministry_members: [],
  member_updates: [
    {
      title: "Welcome to Church Connect",
      body: "Fictional preview data. Explore the complete app navigation.",
      created_at: now,
    },
  ],
  church_events: [
    {
      id: "f1000000-0000-0000-0000-000000000001",
      title: "Sunday Worship",
      starts_at: new Date(Date.now() + 86400000 * 2).toISOString(),
      published: true,
      description: "Join us this Sunday.",
      location: "Main sanctuary",
      recurrence: "none",
    },
  ],
};
class Q {
  constructor(t) {
    this.t = t;
    this.filters = [];
    this.mode = null;
    this.op = "select";
    this.sorts = [];
  }
  select() {
    return this;
  }
  eq(k, v) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  gte(k, v) {
    this.filters.push((r) => r[k] >= v);
    return this;
  }
  in(k, v) {
    this.filters.push((r) => v.includes(r[k]));
    return this;
  }
  not(k, o, v) {
    this.filters.push((r) => r[k] != v);
    return this;
  }
  ilike(k, v) {
    const s = v.replaceAll("%", "").toLowerCase();
    this.filters.push((r) => String(r[k]).toLowerCase().includes(s));
    return this;
  }
  order(k, o = {}) {
    this.sorts.push([k, o.ascending !== false]);
    return this;
  }
  limit(n) {
    this.n = n;
    return this;
  }
  maybeSingle() {
    this.mode = "single";
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  upsert(p) {
    this.op = "upsert";
    this.p = p;
    return this;
  }
  insert(p) {
    this.op = "insert";
    this.p = p;
    return this;
  }
  update(p) {
    this.op = "update";
    this.p = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  then(resolve) {
    let table = (tables[this.t] ??= []);
    let data = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert" || this.op === "upsert") {
      table.push(this.p);
      data = [this.p];
    }
    if (this.op === "update") data.forEach((r) => Object.assign(r, this.p));
    if (this.sorts.length)
      data.sort((a, b) => {
        for (const [k, asc] of this.sorts) {
          if (a[k] < b[k]) return asc ? -1 : 1;
          if (a[k] > b[k]) return asc ? 1 : -1;
        }
        return 0;
      });
    if (this.n) data = data.slice(0, this.n);
    return Promise.resolve({
      data: this.mode ? data[0] || null : data,
      error: null,
    }).then(resolve);
  }
}
export const db = {
  from: (t) => new Q(t),
  auth: {
    getUser: async () => ({ data: { user: { id: ME } } }),
    getSession: async () => ({ data: { session: { user: { id: ME } } } }),
    signOut: async () => ({ error: null }),
  },
  storage: {
    from: () => ({
      createSignedUrls: async () => ({ data: [] }),
      createSignedUrl: async () => ({ data: { signedUrl: "#" } }),
      upload: async () => ({ error: null }),
    }),
  },
  channel: () => ({
    on() {
      return this;
    },
    subscribe() {
      return this;
    },
  }),
  removeChannel: async () => {},
  rpc: async (name, p = {}) => {
    let data = [];
    if (name === "cc_chat_list") data = chats;
    if (name === "cc_chat_people") data = people;
    if (name === "cc_message_activity")
      data = rows.map((m) => ({
        message_id: m.id,
        reactions: {},
        votes: {},
        acknowledged: 0,
        mine: marks.find((x) => x.message_id === m.id),
      }));
    if (name === "my_conversation_unread_counts")
      data = [{ conversation_id: CHAT, unread_count: 1 }];
    if (name === "cc_can_broadcast" || name === "cc_is_platform_admin")
      data = false;
    if (name === "cc_chat_action") {
      const c = chats.find((c) => c.id === p.c);
      const m = rows.find((m) => m.id === p.p.message_id);
      if (p.a === "send") {
        if (p.p.body === "FAIL TEST")
          return { error: { message: "Test connection failure" } };
        const row = {
          ...p.p,
          id: messageId(),
          conversation_id: p.c,
          sender_id: ME,
          created_at: new Date().toISOString(),
        };
        rows.push(row);
        c.preview = row.body;
        c.last_at = row.created_at;
        data = { id: row.id };
      }
      if (p.a === "mark") {
        let mark = marks.find((m) => m.message_id === p.p.message_id);
        if (!mark) {
          mark = { message_id: p.p.message_id, user_id: ME };
          marks.push(mark);
        }
        Object.assign(mark, p.p);
      }
      if (p.a === "preferences") Object.assign(c, p.p);
      if (p.a === "manage") Object.assign(c, p.p);
      if (p.a === "edit") m.body = p.p.body;
      if (p.a === "delete") {
        m.body = "Message deleted";
        m.deleted_at = now;
      }
      if (p.a === "pin") m.pinned = !m.pinned;
      if (p.a === "create") {
        const id = messageId();
        chats.push({
          id,
          label: p.p.title,
          kind: "group",
          title: p.p.title,
          can_manage: true,
          owner_id: ME,
          parent_id: p.p.parent_id,
        });
        data = { id };
      }
      if (p.a === "settings")
        tables.cc_messaging_settings = [{ ...p.p, user_id: ME }];
    }
    return { data, error: null };
  },
};
export const configured = true;
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (d) => new Date(d).toLocaleString();
export const occurrences = (events) =>
  events.map((e) => ({ ...e, occurs_at: e.starts_at }));
export const readPublic = async () => ({
  events: tables.church_events,
  announcements: [],
});
