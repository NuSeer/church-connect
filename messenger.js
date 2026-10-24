import { messageId } from "./messaging-utils.js";
// Church Connect messaging. Uses the existing approved-member session and church permissions.
import { escapeHTML as escape, fmt } from "./data.js";
export function createMessenger({ db, user, notice, openTab, unread, sms }) {
  const $ = (id) => document.getElementById(id),
    node = (tag, text, cls) => {
      const n = document.createElement(tag);
      if (text !== undefined) n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
  const button = (label, fn) => {
    const b = node("button", label, "btn secondary");
    b.type = "button";
    b.onclick = async () => {
      try {
        await fn();
      } catch (e) {
        notice(e.message);
      }
    };
    return b;
  };
  let chats = [],
    active = null,
    people = [],
    messages = [],
    activity = [],
    reply = null,
    attachment = null,
    recording = null,
    stream = null,
    search = "",
    filter = "all",
    generation = 0,
    history = 50,
    readThrough = null,
    openedRead = null,
    contentFilter = "all";
  const uid = () => user()?.id,
    key = () => `cc-draft:${uid()}:${active?.id}`;
  const storage = {
    get(k) {
      try {
        return localStorage.getItem(k) || "";
      } catch {
        return "";
      }
    },
    set(k, v) {
      try {
        v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
      } catch {}
    },
  };
  async function rpc(name, args) {
    const r = await db.rpc(name, args);
    if (r.error) throw Error(r.error.message);
    return r.data;
  }
  const action = (a, p = {}, c = active?.id) =>
    rpc("cc_chat_action", { c: c || null, a, p });
  const visible = () =>
    active && !document.hidden && !$("messages").classList.contains("hidden");
  const nearBottom = () => {
    const el = $("messageList");
    return el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };
  async function markRead() {
    if (!visible() || !nearBottom() || !readThrough) return;
    const r = await db
      .from("conversation_read_states")
      .upsert(
        {
          conversation_id: active.id,
          user_id: uid(),
          last_read_at: readThrough,
        },
        { onConflict: "conversation_id,user_id" },
      );
    if (!r.error) await unread();
  }
  function label(id) {
    return (
      people.find((x) => x.user_id === id)?.display_name ||
      (id === uid() ? "You" : "Former participant")
    );
  }
  function savedDraft() {
    if (active) storage.set(key(), $("messageBody").value);
  }
  async function load() {
    if (!uid()) return;
    try {
      chats = (await rpc("cc_chat_list", {})) || [];
      renderChats();
      return chats;
    } catch (e) {
      $("conversationList").textContent =
        "Messaging needs the latest database update. Other app sections remain available.";
      notice(e.message);
      return [];
    }
  }
  function renderChats() {
    const q = $("chatSearch").value.toLowerCase();
    const box = $("conversationList");
    box.replaceChildren();
    for (const c of [...chats].sort((a, b) => (b.whole_church ? 1 : 0) - (a.whole_church ? 1 : 0)).filter(
      (c) =>
        (filter === "archived" ? c.archived : !c.archived) &&
        (filter !== "unread" || (unread.counts?.get(c.id) || 0) > 0) &&
        `${c.label} ${c.preview || ""}`.toLowerCase().includes(q),
    )) {
      const b = button("", () => open(c.id));
      b.className = "chat-row" + (active?.id === c.id ? " selected" : "");
      const badge = node(
        "span",
        c.label.slice(0, 2).toUpperCase(),
        "chat-avatar",
      );
      const body = node("span", undefined, "chat-preview");
      body.append(node("strong", (c.parent_id ? "↳ " : "") + c.label));
      body.append(
        node(
          "span",
          (c.status === "request" ? (c.requested_by === uid() ? "Request sent · " : "Message request · ") : "") +
            (c.muted ? "Muted · " : "") +
            (c.announcement_only ? "Announcements · " : "") +
            (c.preview || "Start the conversation"),
          "muted",
        ),
      );
      const meta = node(
        "span",
        c.last_at
          ? new Date(c.last_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "",
        "small",
      );
      const n = unread.counts?.get(c.id) || 0;
      if (n) meta.append(node("b", String(n), "chat-count"));
      b.append(badge, body, meta);
      box.append(b);
    }
    if (!box.children.length)
      box.append(node("p", "No conversations in this view.", "muted"));
  }
  // "Ask me first": the person who was asked chooses what happens to a first message from someone new.
  function renderRequest(c) {
    const box = $("requestBanner");
    box.replaceChildren();
    const pending = c.status === "request";
    box.classList.toggle("hidden", !pending);
    if (!pending) return;
    const them = c.label || "This member";
    if (c.requested_by === uid()) {
      box.append(node("p", `${them} will see this as a message request. You can send one message until they accept.`));
      return;
    }
    box.append(node("p", `${them} would like to message you. Nothing is shared until you accept.`));
    const row = node("div", undefined, "actions");
    for (const [text, a] of [["Accept", "accept"], ["Decline", "decline"], ["Block", "block"]])
      row.append(
        button(text, async () => {
          if (a === "block" && !confirm("Block this member? They will no longer be able to message you.")) return;
          if (a === "decline" && !confirm("Decline this request? The conversation will be removed.")) return;
          await rpc("cc_respond_chat", { p_conversation: c.id, p_action: a });
          await load();
          if (a === "accept") await open(c.id);
          else {
            active = null;
            $("conversationTitle").textContent = "Select a conversation";
            $("messageForm").classList.add("hidden");
            $("chatTools").classList.add("hidden");
            box.classList.add("hidden");
            $("messageList").replaceChildren(node("p", "Select a conversation to begin.", "muted"));
          }
          notice(a === "accept" ? "Accepted. You can chat now." : a === "block" ? "Blocked." : "Request declined.");
        }),
      );
    box.append(row);
  }
  async function open(id) {
    if (sending)
      throw Error("Please wait for the current message to finish sending.");
    if (recording) throw Error("Stop recording before changing conversations.");
    savedDraft();
    const c = chats.find((x) => x.id === id);
    if (!c) return;
    active = c;
    generation++;
    history = 50;
    search = "";
    $("messageSearch").value = "";
    reply = null;
    attachment = null;
    readThrough = null;
    const read = await db
      .from("conversation_read_states")
      .select("last_read_at")
      .eq("conversation_id", id)
      .eq("user_id", uid())
      .maybeSingle();
    openedRead = read.data?.last_read_at || "1970-01-01";
    openTab();
    $("conversationTitle").textContent = c.label;
    $("messageForm").classList.remove("hidden");
    $("chatTools").classList.remove("hidden");
    $("composePanel").classList.add("hidden");
    $("chatDetails").classList.add("hidden");
    $("messageBody").value = storage.get(key());
    $("muteChat").textContent = c.muted ? "Unmute" : "Mute";
    $("manageChat").hidden = false;
    $("newTopic").hidden = !c.can_manage || c.kind === "direct";
    $("messageBody").disabled =
      c.archived ||
      (c.announcement_only && !c.can_manage) ||
      (c.status === "request" && c.requested_by !== uid());
    $("sendMessage").disabled = $("messageBody").disabled;
    $("chatMode").textContent = c.confidential
      ? "Confidential · only you and the people named in this conversation can see it"
      : c.archived
      ? "Archived · read only"
      : c.announcement_only
        ? "Leader announcements · members can react and acknowledge"
        : "Private to this conversation";
    renderContext();
    renderRequest(c);
    const r = await rpc("cc_chat_people", { c: id });
    if (active?.id !== id) return;
    people = r || [];
    await refresh({ bottom: true });
    renderChats();
  }
  async function refresh({ bottom = false, older = false } = {}) {
    if (!active) return;
    const id = active.id,
      gen = ++generation,
      el = $("messageList"),
      wasBottom = nearBottom(),
      oldHeight = el.scrollHeight,
      oldTop = el.scrollTop;
    let q = db
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(history);
    if (search)
      q = q.ilike("body", "%" + search.replace(/[\\%_]/g, "\\$&") + "%");
    if (filter === "saved") {
      const saved = await db
        .from("cc_message_marks")
        .select("message_id")
        .eq("saved", true)
        .eq("user_id", uid());
      if (saved.error) throw Error(saved.error.message);
      q = q.in(
        "id",
        (saved.data || []).map((x) => x.message_id),
      );
    }
    if (contentFilter === "files") q = q.not("attachment", "is", null);
    if (contentFilter === "pinned") q = q.eq("pinned", true);
    const r = await q;
    const marks = r.error
      ? []
      : await rpc("cc_message_activity", {
          c: id,
          p_ids: (r.data || []).map((x) => x.id),
        });
    if (r.error) throw Error(r.error.message);
    if (gen !== generation || active?.id !== id) return;
    messages = (r.data || []).reverse();
    activity = marks || [];
    readThrough =
      !search &&
      filter !== "saved" &&
      contentFilter === "all" &&
      messages.length
        ? messages.at(-1).created_at
        : null;
    renderMessages();
    $("loadEarlier").hidden = messages.length < history || !!search;
    if (older) el.scrollTop = oldTop + el.scrollHeight - oldHeight;
    else if (bottom || wasBottom) {
      el.scrollTop = el.scrollHeight;
      await markRead();
    } else {
      el.scrollTop = oldTop;
      $("jumpLatest").hidden = false;
    }
  }
  function renderMessages() {
    const el = $("messageList");
    el.replaceChildren();
    const filtered = messages.filter(
      (m) =>
        filter !== "saved" ||
        activity.find((a) => a.message_id === m.id)?.mine?.saved,
    );
    let divider = false;
    for (const m of filtered) {
      if (
        !divider &&
        new Date(m.created_at) > new Date(openedRead) &&
        m.sender_id !== uid()
      ) {
        el.append(node("div", "New messages", "new-message-divider"));
        divider = true;
      }
      const a = activity.find((x) => x.message_id === m.id) || {},
        mine = a.mine || {};
      const row = node(
        "article",
        undefined,
        "chat-message" +
          (m.sender_id === uid() ? " own" : "") +
          (m.pinned ? " pinned" : ""),
      );
      row.dataset.id = m.id;
      row.append(
        node(
          "div",
          `${label(m.sender_id)} · ${fmt(m.created_at)}${m.edited_at ? " · edited" : ""}${m.pinned ? " · Pinned" : ""}`,
          "message-meta",
        ),
      );
      if (m.reply_to) {
        const parent = messages.find((x) => x.id === m.reply_to);
        row.append(
          node(
            "blockquote",
            parent
              ? `${label(parent.sender_id)}: ${parent.body}`
              : "Reply to an earlier message",
          ),
        );
      }
      row.append(node("p", m.body));
      if (m.deleted_at) {
        el.append(row);
        continue;
      }
      if (m.attachment) {
        const b = button(
          "Open " + (m.attachment.name || "attachment"),
          async () => {
            const r = await db.storage
              .from("chat-files")
              .createSignedUrl(m.attachment.path, 300);
            if (r.error) throw Error(r.error.message);
            const url = r.data.signedUrl;
            if (m.attachment.type?.startsWith("audio/")) {
              const audio = node("audio");
              audio.controls = true;
              audio.src = url;
              row.append(audio);
              b.remove();
            } else if (m.attachment.type?.startsWith("image/")) {
              const img = node("img");
              img.src = url;
              img.alt = m.attachment.name;
              img.className = "chat-image";
              row.append(img);
              b.remove();
            } else {
              const link = node("a", "Download " + m.attachment.name);
              link.href = url;
              link.target = "_blank";
              link.rel = "noopener";
              row.append(link);
            }
          },
        );
        row.append(b);
        if (m.attachment.transcript)
          row.append(node("p", "Transcript (made automatically, may have mistakes): " + m.attachment.transcript, "small muted"));
      }
      if (m.poll) {
        row.append(node("strong", m.poll.question));
        m.poll.options.forEach((option, i) =>
          row.append(
            button(
              `${mine.vote === i ? "✓ " : ""}${option} · ${a.votes?.[i] || 0}`,
              async () => {
                await action("mark", { message_id: m.id, vote: i });
                await refresh();
              },
            ),
          ),
        );
      }
      const reactions = node("div", undefined, "message-reactions");
      for (const emoji of ["👍", "❤️", "🙏", "🙌", "✅"]) {
        const b = button(
          `${emoji}${a.reactions?.[emoji] ? " " + a.reactions[emoji] : ""}`,
          async () => {
            await action("mark", {
              message_id: m.id,
              reaction: mine.reaction === emoji ? null : emoji,
            });
            await refresh();
          },
        );
        b.setAttribute("aria-label", `React ${emoji}`);
        b.setAttribute("aria-pressed", String(mine.reaction === emoji));
        reactions.append(b);
      }
      row.append(reactions);
      const tools = node("div", undefined, "message-actions");
      tools.append(
        button("Reply", () => {
          reply = m;
          renderContext();
          $("messageBody").focus();
        }),
        button(mine.saved ? "Unsave" : "Save", async () => {
          await action("mark", { message_id: m.id, saved: !mine.saved });
          await refresh();
        }),
        button(
          (mine.acknowledged ? "✓ Acknowledged" : "Acknowledge") +
            ` (${a.acknowledged || 0})`,
          async () => {
            await action("mark", {
              message_id: m.id,
              acknowledged: !mine.acknowledged,
            });
            await refresh();
          },
        ),
      );
      if (m.sender_id === uid())
        tools.append(
          button("Edit", async () => {
            const body = prompt("Edit message", m.body);
            if (body?.trim()) {
              await action("edit", { message_id: m.id, body });
              await refresh();
            }
          }),
        );
      if (m.sender_id === uid() || active.can_manage)
        tools.append(
          button("Delete", async () => {
            if (confirm("Delete this message?")) {
              await action("delete", { message_id: m.id });
              await refresh();
            }
          }),
        );
      if (active.can_manage)
        tools.append(
          button(m.pinned ? "Unpin" : "Pin", async () => {
            await action("pin", { message_id: m.id });
            await refresh();
          }),
        );
      tools.append(
        button("Report", async () => {
          const reason = prompt("Why are you reporting this message?");
          if (reason?.trim()) {
            await action("report", { message_id: m.id, reason });
            notice("Report submitted to church administrators.");
          }
        }),
      );
      row.append(tools);
      el.append(row);
    }
    if (!filtered.length)
      el.append(
        node(
          "p",
          filter === "saved"
            ? "No saved messages in the loaded history."
            : "No messages yet.",
          "muted",
        ),
      );
    $("pinnedMessages").replaceChildren(
      ...messages
        .filter((m) => m.pinned && !m.deleted_at)
        .map((m) =>
          button("📌 " + m.body.slice(0, 90), () =>
            el
              .querySelector(`[data-id="${m.id}"]`)
              ?.scrollIntoView({ block: "nearest" }),
          ),
        ),
    );
  }
  function renderContext() {
    $("replyContext").replaceChildren();
    if (reply)
      $("replyContext").append(
        node(
          "span",
          "Replying to " +
            label(reply.sender_id) +
            ": " +
            reply.body.slice(0, 90),
        ),
        button("Cancel reply", () => {
          reply = null;
          renderContext();
        }),
      );
    $("attachmentContext").replaceChildren();
    if (attachment)
      $("attachmentContext").append(
        node("span", attachment.name),
        button("Remove attachment", () => {
          attachment = null;
          renderContext();
        }),
      );
  }
  let sending = false,
    requestId = null;
  async function send(ev) {
    ev.preventDefault();
    if (sending || !active) return;
    const c = active.id,
      body =
        $("messageBody").value.trim() ||
        (attachment ? "Shared " + attachment.name : "");
    if (!body) return;
    sending = true;
    const b = $("sendMessage");
    b.disabled = true;
    $("sendStatus").textContent = "Sending…";
    $("messageBody").disabled = true;
    try {
      requestId ||= messageId();
      await action(
        "send",
        {
          body,
          client_id: requestId,
          ...(reply ? { reply_to: reply.id } : {}),
          ...(attachment ? { attachment } : {}),
        },
        c,
      );
      storage.set(key(), "");
      $("messageBody").value = "";
      reply = null;
      attachment = null;
      requestId = null;
      renderContext();
      $("sendStatus").textContent = "Sent";
      try {
        await refresh({ bottom: true });
        await load();
      } catch (e) {
        notice(
          "Message sent. Refresh the conversation to see the latest messages.",
        );
      }
      if ($("alsoText").checked) {
        try {
          await sms(body, c);
        } catch (e) {
          notice("Message sent in the app. Text handoff could not open.");
        }
      }
    } catch (e) {
      $("sendStatus").textContent =
        "Not sent. Your draft is saved. Press Send to retry.";
      savedDraft();
      notice(e.message);
    } finally {
      sending = false;
      const locked =
        !!active?.archived ||
        !!(active?.announcement_only && !active?.can_manage);
      b.disabled = locked;
      $("messageBody").disabled = locked;
    }
  }
  async function upload(file) {
    if (!active || !file) return;
    if (file.size > 15 * 1024 * 1024)
      throw Error("Choose a file smaller than 15 MB.");
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain",
      "audio/webm",
      "audio/ogg",
      "audio/mp4",
      "video/mp4",
    ];
    const type = file.type.split(";")[0];
    if (!allowed.includes(type))
      throw Error("Choose a JPG, PNG, WebP, PDF, text, audio or MP4 file.");
    const conversation = active.id;
    const path = `${conversation}/${uid()}/${messageId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    $("attachmentContext").textContent = "Uploading…";
    const r = await db.storage
      .from("chat-files")
      .upload(path, file, { contentType: type });
    if (r.error) throw Error(r.error.message);
    if (active?.id !== conversation) return;
    attachment = { path, name: file.name, type, size: file.size };
    renderContext();
  }
  async function voice() {
    if (recording) {
      recording.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
      throw Error("Voice recording is unavailable in this browser.");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const parts = [];
    // A written copy of the voice note, made by the phone or browser as the person speaks. It may have mistakes, and some browsers cannot do it.
    let transcript = "", listener = null;
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Speech) {
      try {
        listener = new Speech();
        listener.continuous = true;
        listener.interimResults = false;
        listener.lang = navigator.language || "en-US";
        listener.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++)
            if (e.results[i].isFinal) transcript += e.results[i][0].transcript + " ";
        };
        listener.onerror = () => {};
        listener.start();
      } catch {
        listener = null;
      }
    }
    recording = new MediaRecorder(stream);
    const current = recording;
    current.ondataavailable = (e) => parts.push(e.data);
    current.onstop = async () => {
      clearTimeout(current.timer);
      try { listener?.stop(); } catch {}
      await new Promise((r) => setTimeout(r, 400));
      stream.getTracks().forEach((t) => t.stop());
      recording = null;
      $("recordVoice").textContent = "Voice note";
      const type = current.mimeType.split(";")[0];
      try {
        await upload(
          new File(
            parts,
            "voice-note." + (type === "audio/mp4" ? "m4a" : "webm"),
            { type },
          ),
        );
        if (attachment && transcript.trim()) {
          attachment.transcript = transcript.trim().slice(0, 4000);
          renderContext();
        }
      } catch (e) {
        notice(e.message);
      }
    };
    current.start();
    current.timer = setTimeout(
      () => current.state === "recording" && current.stop(),
      120000,
    );
    $("recordVoice").textContent = "Stop recording (max 2 min)";
  }
  async function createGroup(parent = null) {
    const title = prompt(parent ? "Topic name" : "Group name");
    if (!title) return;
    let members = [];
    if (!parent) {
      const dialog = $("chatDialog");
      dialog.replaceChildren(
        node("h2", "Choose group members"),
        node("p", "New participants can see the conversation history."),
      );
      const r = await db
        .from("member_profiles")
        .select("user_id,display_name")
        .eq("approved", true)
        .eq("directory_visible", true);
      if (r.error) throw Error(r.error.message);
      for (const person of r.data || []) {
        if (person.user_id === uid()) continue;
        const l = node("label", undefined, "checkline"),
          input = node("input");
        input.type = "checkbox";
        input.value = person.user_id;
        l.append(input, document.createTextNode(person.display_name));
        dialog.append(l);
      }
      dialog.append(
        button("Create group", async () => {
          members = [...dialog.querySelectorAll("input:checked")].map(
            (x) => x.value,
          );
          const c = await action("create", { title, members }, null);
          dialog.close();
          await load();
          await open(c.id);
        }),
        button("Cancel", () => dialog.close()),
      );
      dialog.showModal();
      return;
    }
    const c = await action("create", { title, parent_id: parent }, null);
    await load();
    await open(c.id);
  }
  async function details() {
    const box = $("chatDetails");
    box.classList.toggle("hidden");
    if (box.classList.contains("hidden")) return;
    box.replaceChildren(
      node("h3", "Participants"),
      node("p", "Participants can see the full conversation history.", "muted"),
    );
    for (const p of people) {
      const row = node("div", undefined, "list-item");
      row.append(
        node(
          "span",
          p.display_name + (active.owner_id === p.user_id ? " · Leader" : ""),
        ),
      );
      if (p.user_id !== uid()) {
        row.append(
          button("Block private messages", async () => {
            await action("block", { user_id: p.user_id, enabled: true });
            notice(
              "Private messages blocked. Shared ministry discussions remain visible.",
            );
          }),
          button("Unblock", async () => {
            await action("block", { user_id: p.user_id, enabled: false });
            notice("Private messages unblocked.");
          }),
        );
        if (active.can_manage && active.kind === "group") {
          row.append(
            button("Remove", async () => {
              if (
                confirm("Remove " + p.display_name + " from this conversation?")
              ) {
                await action("manage", { member_id: p.user_id, remove: true });
                await open(active.id);
              }
            }),
            button("Make leader", async () => {
              if (
                confirm("Transfer group leadership to " + p.display_name + "?")
              ) {
                await action("manage", { owner_id: p.user_id });
                await load();
                await open(active.id);
              }
            }),
          );
        }
      }
      box.append(row);
    }
    if (active.can_manage) {
      box.append(
        button("Rename", async () => {
          const title = prompt("Conversation name", active.label);
          if (title) {
            await action("manage", { title });
            await load();
            await open(active.id);
          }
        }),
        button(
          active.announcement_only ? "Allow member posts" : "Leaders post only",
          async () => {
            await action("manage", {
              announcement_only: !active.announcement_only,
            });
            await load();
            await open(active.id);
          },
        ),
        button(
          active.archived ? "Reopen conversation" : "Archive conversation",
          async () => {
            await action("manage", { archived: !active.archived });
            await load();
            await open(active.id);
          },
        ),
      );
      if (active.kind === "group")
        box.append(
          button("Add participant", async () => {
            const r = await db
              .from("member_profiles")
              .select("user_id,display_name")
              .eq("approved", true)
              .eq("directory_visible", true);
            const eligible = (r.data || []).filter(
              (p) => !people.some((x) => x.user_id === p.user_id),
            );
            const dialog = $("chatDialog");
            dialog.replaceChildren(
              node("h2", "Add participant"),
              node(
                "p",
                "The new participant will see the existing message history.",
              ),
            );
            for (const p of eligible)
              dialog.append(
                button(p.display_name, async () => {
                  await action("manage", {
                    member_id: p.user_id,
                    remove: false,
                  });
                  dialog.close();
                  await load();
                  await open(active.id);
                }),
              );
            dialog.append(button("Cancel", () => dialog.close()));
            dialog.showModal();
          }),
        );
    }
  }
  async function settings() {
    const r = await db
      .from("cc_messaging_settings")
      .select("*")
      .eq("user_id", uid())
      .maybeSingle();
    if (r.error) throw Error(r.error.message);
    const s = r.data || {};
    const d = $("chatDialog");
    d.innerHTML =
      '<h2>Messaging preferences</h2><form method="dialog" id="chatSettingsForm"><label>Who can start a private conversation with me<select id="chatModeSelect"><option value="open">Any approved member</option><option value="ask">Ask me first (I accept or decline)</option><option value="off">No one (I only use groups)</option></select></label><p class="small muted">Group invitations follow the same choice.</p><p>Directory visibility is separate. Blocking applies to private messages; shared ministry messages remain visible.</p><label>Quiet hours start<select id="quietStart"><option value="">Off</option></select></label><label>Quiet hours end<select id="quietEnd"><option value="">Off</option></select></label><label>Time zone<input id="quietZone" required></label><p>Quiet hours silence push notifications. Messages remain available in the app.</p><button class="btn" type="submit">Save preferences</button></form>';
    $("chatModeSelect").value = s.allow_direct === false ? "off" : s.request_first ? "ask" : "open";
    for (let i = 0; i < 24; i++) {
      for (const id of ["quietStart", "quietEnd"])
        $(id).append(new Option(String(i).padStart(2, "0") + ":00", i));
    }
    $("quietStart").value = s.quiet_start ?? "";
    $("quietEnd").value = s.quiet_end ?? "";
    $("quietZone").value =
      s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    $("chatSettingsForm").onsubmit = async (e) => {
      e.preventDefault();
      try {
        await action(
          "settings",
          {
            allow_direct: $("chatModeSelect").value !== "off",
            quiet_start:
              $("quietStart").value === ""
                ? null
                : Number($("quietStart").value),
            quiet_end:
              $("quietEnd").value === "" ? null : Number($("quietEnd").value),
            timezone: $("quietZone").value,
          },
          null,
        );
        const m = await db.rpc("cc_set_chat_mode", { p_mode: $("chatModeSelect").value });
        if (m.error && !/schema cache|Could not find/i.test(m.error.message)) throw Error(m.error.message);
        d.close();
        notice("Messaging preferences saved.");
      } catch (e) {
        notice(e.message);
      }
    };
    d.append(button("Cancel", () => d.close()));
    d.showModal();
  }
  $("mentionMember").onclick = () => {
    const d = $("chatDialog");
    d.replaceChildren(node("h2", "Mention a participant"));
    for (const p of people)
      d.append(
        button(p.display_name, () => {
          $("messageBody").value += "@" + p.display_name + " ";
          savedDraft();
          d.close();
          $("messageBody").focus();
        }),
      );
    if (active?.can_manage)
      d.append(
        button("Everyone", () => {
          $("messageBody").value += "@everyone ";
          savedDraft();
          d.close();
        }),
      );
    d.append(button("Cancel", () => d.close()));
    d.showModal();
  };
  $("messageForm").onsubmit = send;
  $("messageBody").addEventListener("input", () => {
    savedDraft();
    requestId = null;
  });
  $("chatSearch").oninput = renderChats;
  $("chatFilter").onchange = () => {
    filter = $("chatFilter").value;
    renderChats();
    if (active) refresh().catch((e) => notice(e.message));
  };
  $("messageContentFilter").onchange = () => {
    contentFilter = $("messageContentFilter").value;
    refresh().catch((e) => notice(e.message));
  };
  let timer;
  $("messageSearch").oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      search = $("messageSearch").value.trim();
      refresh().catch((e) => notice(e.message));
    }, 250);
  };
  $("loadEarlier").onclick = () => {
    history += 50;
    refresh({ older: true }).catch((e) => notice(e.message));
  };
  $("jumpLatest").onclick = () => {
    $("messageList").scrollTop = $("messageList").scrollHeight;
    $("jumpLatest").hidden = true;
    markRead();
  };
  $("messageList").addEventListener("scroll", () => {
    if (nearBottom()) {
      $("jumpLatest").hidden = true;
      markRead();
    }
  });
  $("attachFile").onchange = async (e) => {
    try {
      await upload(e.target.files[0]);
    } catch (e) {
      notice(e.message);
    }
    e.target.value = "";
  };
  $("recordVoice").onclick = () => voice().catch((e) => notice(e.message));
  $("muteChat").onclick = async () => {
    await action("preferences", { muted: !active.muted });
    await load();
    active = chats.find((c) => c.id === active.id);
    $("muteChat").textContent = active.muted ? "Unmute" : "Mute";
  };
  $("markUnread").onclick = async () => {
    await action("unread");
    await unread();
    notice("Conversation marked unread.");
    document.querySelector('[data-view="updates"]').click();
  };
  $("manageChat").onclick = () => details().catch((e) => notice(e.message));
  $("newGroup").onclick = () => createGroup().catch((e) => notice(e.message));
  $("newTopic").onclick = () =>
    createGroup(active.id).catch((e) => notice(e.message));
  $("messagingSettings").onclick = () =>
    settings().catch((e) => notice(e.message));
  $("createPoll").onclick = async () => {
    try {
      const question = prompt("Poll question");
      if (!question) return;
      const text = prompt("Options, one per line (2–10)");
      if (!text) return;
      const options = text
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean);
      await action("send", {
        body: question,
        poll: { question, options },
        client_id: messageId(),
      });
      await refresh({ bottom: true });
      await load();
    } catch (e) {
      notice(e.message);
    }
  };
  $("shareEvent").onclick = async () => {
    const r = await db
      .from("church_events")
      .select("id,title,starts_at,location")
      .eq("published", true)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(25);
    const d = $("chatDialog");
    d.replaceChildren(node("h2", "Share an upcoming church event"));
    for (const ev of r.data || [])
      d.append(
        button(ev.title + " · " + fmt(ev.starts_at), () => {
          $("messageBody").value =
            `${ev.title}\n${fmt(ev.starts_at)}\n${ev.location || ""}\n${new URL("connect.html?view=events", location.href).href}`;
          savedDraft();
          d.close();
        }),
      );
    if (!r.data?.length) d.append(node("p", "No upcoming published events."));
    d.append(button("Cancel", () => d.close()));
    d.showModal();
  };
  document.addEventListener("visibilitychange", () => {
    if (visible()) refresh().catch((e) => notice(e.message));
  });
  document
    .querySelector('[data-view="messages"]')
    .addEventListener("click", () => {
      if (active) refresh().catch((e) => notice(e.message));
    });
  window.addEventListener("pagehide", () => {
    savedDraft();
    stream?.getTracks().forEach((t) => t.stop());
  });
  return {
    load,
    open,
    renderChats,
    async changed(event) {
      await load();
      if (
        active &&
        (!event?.new?.conversation_id ||
          event.new.conversation_id === active.id)
      )
        await refresh();
    },
    get active() {
      return active;
    },
    clear() {
      try {
        for (const k of Object.keys(localStorage))
          if (k.startsWith("cc-draft:" + uid() + ":"))
            localStorage.removeItem(k);
      } catch {}
      active = null;
      chats = [];
      people = [];
      messages = [];
      stream?.getTracks().forEach((t) => t.stop());
      $("messageList").replaceChildren();
      $("messageBody").value = "";
    },
  };
}
