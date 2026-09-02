const state = {
  configured: false,
  auth: null,
  db: null,
  user: null,
  me: null,
  profiles: [],
  posts: [],
  likes: [],
  follows: [],
  comments: [],
  notifications: [],
  notificationUnsub: null,
  deviceNotificationRegistration: null,
  deviceNotificationInitialSnapshot: false,
  conversations: [],
  conversationReads: [],
  activeMessages: [],
  conversationUnsub: null,
  conversationReadUnsub: null,
  messageUnsub: null,
  messageUnsubFor: null,
  messageDrafts: {},
  messageImageDrafts: {},
  callUnsub: null,
  callDocUnsub: null,
  callCandidateUnsubs: [],
  activeCall: null,
  peerConnection: null,
  localCallStream: null,
  remoteCallStream: null,
  pendingRemoteCandidates: [],
  callSounds: { incoming: null, outgoing: null, accepted: null, end: null },
  callRingTimer: null,
  lastHandledIncomingCallId: null,
  unsubs: []
};

let pendingProfileImage = '';
let pendingBannerImage = '';

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function toast(message, kind = '') {
  let el = document.querySelector('#swToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'swToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.className = 'toast', 3000);
}

function friendlyError(err) {
  const code = err?.code || '';
  const map = {
    'auth/email-already-in-use': 'That email already has an account.',
    'auth/invalid-email': 'That email address is not valid.',
    'auth/weak-password': 'Password is too weak.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'permission-denied': 'Database permission denied. Check Firestore Rules.'
  };
  return map[code] || err?.message || 'Something went wrong.';
}

function configReady() {
  const c = window.SW_FIREBASE_CONFIG || {};
  return ['apiKey','authDomain','projectId','appId'].every(k => typeof c[k] === 'string' && c[k].length > 3);
}

function tsDate(value) {
  if (!value) return new Date();
  if (typeof value.toDate === 'function') return value.toDate();
  return new Date(value);
}

function relativeTime(value) {
  const date = tsDate(value);
  const diff = Date.now() - date.getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

function profileById(uid) {
  return state.profiles.find(p => p.uid === uid) || null;
}

function profileByUsername(username) {
  return state.profiles.find(p => p.username_lower === String(username || '').toLowerCase()) || null;
}

function fallbackProfile(uid = '') {
  return { uid, username: 'unknown', username_lower: 'unknown', display_name: 'Unknown', bio: '', avatar_text: '?' };
}

function avatarInnerHTML(profile) {
  if (profile?.avatar_image) {
    return `<img class="avatar-image" src="${esc(profile.avatar_image)}" alt="">`;
  }
  return esc(profile?.avatar_text || '?');
}

function setAvatarElement(el, profile) {
  if (!el) return;
  el.innerHTML = avatarInnerHTML(profile);
}

async function imageFileToAvatar(file) {
  if (!file) return '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Use a JPG, PNG or WEBP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Profile picture must be smaller than 8 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('That image could not be opened.'));
      img.src = objectUrl;
    });

    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = Math.floor((img.naturalWidth - side) / 2);
    const sy = Math.floor((img.naturalHeight - side) / 2);

    for (const size of [256, 224, 192, 160]) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

      for (const quality of [0.84, 0.72, 0.6, 0.48]) {
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp')) {
          data = canvas.toDataURL('image/jpeg', quality);
        }
        if (data.length <= 180000) return data;
      }
    }
    throw new Error('That image is still too large after compression. Try another image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function imageFileToBanner(file) {
  if (!file) return '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Use a JPG, PNG or WEBP image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Banner image must be smaller than 12 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('That banner image could not be opened.'));
      img.src = objectUrl;
    });

    const targetRatio = 3;
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    const sourceRatio = sw / sh;

    if (sourceRatio > targetRatio) {
      sw = Math.floor(sh * targetRatio);
      sx = Math.floor((img.naturalWidth - sw) / 2);
    } else {
      sh = Math.floor(sw / targetRatio);
      sy = Math.floor((img.naturalHeight - sh) / 2);
    }

    for (const [w, h] of [[1200, 400], [960, 320], [720, 240]]) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp')) {
          data = canvas.toDataURL('image/jpeg', quality);
        }
        if (data.length <= 420000) return data;
      }
    }

    throw new Error('That banner is still too large after compression. Try another image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}


async function imageFileToMessage(file) {
  if (!file) return '';
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) throw new Error('Use a JPG, PNG or WEBP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Photo must be smaller than 8 MB.');

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('That photo could not be opened.'));
      img.src = objectUrl;
    });

    const sourceW = img.naturalWidth;
    const sourceH = img.naturalHeight;
    if (!sourceW || !sourceH) throw new Error('That photo has invalid dimensions.');

    for (const maxSide of [1280, 1080, 900, 720]) {
      const scale = Math.min(1, maxSide / Math.max(sourceW, sourceH));
      const w = Math.max(1, Math.round(sourceW * scale));
      const h = Math.max(1, Math.round(sourceH * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, sourceW, sourceH, 0, 0, w, h);

      for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
        let data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 450000) return data;
      }
    }

    throw new Error('That photo is still too large after compression. Try another one.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function messageImageMime(data = '') {
  if (data.startsWith('data:image/webp')) return 'image/webp';
  if (data.startsWith('data:image/png')) return 'image/png';
  return 'image/jpeg';
}

function ensureMessageImageViewer() {
  if (document.querySelector('#messageImageViewer')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="messageImageViewer" class="message-image-viewer hidden" role="dialog" aria-modal="true" aria-label="Message photo">
      <button id="messageImageViewerClose" class="message-image-viewer-close" type="button" aria-label="Close photo">×</button>
      <img id="messageImageViewerImg" alt="Message photo">
    </div>`);
  const viewer = document.querySelector('#messageImageViewer');
  const close = () => {
    viewer.classList.add('hidden');
    const img = document.querySelector('#messageImageViewerImg');
    if (img) img.removeAttribute('src');
  };
  document.querySelector('#messageImageViewerClose')?.addEventListener('click', close);
  viewer.addEventListener('click', e => { if (e.target === viewer) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !viewer.classList.contains('hidden')) close();
  });
}

function openMessageImage(messageId) {
  const message = state.activeMessages.find(m => m.id === messageId);
  if (!message?.image_data) return;
  ensureMessageImageViewer();
  const viewer = document.querySelector('#messageImageViewer');
  const img = document.querySelector('#messageImageViewerImg');
  img.src = message.image_data;
  viewer.classList.remove('hidden');
}


function postLikeCount(postId) {
  return state.likes.filter(x => x.post_id === postId).length;
}

function didILike(postId) {
  return !!state.user && state.likes.some(x => x.post_id === postId && x.user_uid === state.user.uid);
}

function postCommentCount(postId) {
  return state.comments.filter(x => x.post_id === postId).length;
}

function commentsForPost(postId) {
  return state.comments
    .filter(x => x.post_id === postId)
    .sort((a, b) => tsDate(a.created_at) - tsDate(b.created_at));
}

function followCounts(uid) {
  return {
    followers: state.follows.filter(x => x.following_uid === uid).length,
    following: state.follows.filter(x => x.follower_uid === uid).length
  };
}

function amIFollowing(uid) {
  return !!state.user && state.follows.some(x => x.follower_uid === state.user.uid && x.following_uid === uid);
}

function timestampMillis(value) {
  if (!value) return 0;
  try { return tsDate(value).getTime(); } catch (_) { return 0; }
}

function conversationIdFor(uidA, uidB) {
  return [String(uidA), String(uidB)].sort().join('__');
}

function conversationOtherUid(conversation) {
  if (!state.user || !Array.isArray(conversation?.member_uids)) return '';
  return conversation.member_uids.find(uid => uid !== state.user.uid) || '';
}

function conversationReadFor(conversationId) {
  if (!state.user) return null;
  return state.conversationReads.find(r => r.conversation_id === conversationId && r.user_uid === state.user.uid) || null;
}

function conversationIsUnread(conversation) {
  if (!state.user || !conversation || conversation.last_sender_uid === state.user.uid) return false;
  const read = conversationReadFor(conversation.id);
  return timestampMillis(conversation.updated_at) > timestampMillis(read?.last_read_at);
}

function unreadMessageConversationCount() {
  return state.conversations.filter(conversationIsUnread).length;
}

function myConversations() {
  if (!state.user) return [];
  return state.conversations
    .filter(c => Array.isArray(c.member_uids) && c.member_uids.includes(state.user.uid))
    .sort((a, b) => timestampMillis(b.updated_at) - timestampMillis(a.updated_at));
}

function activeMessageTarget() {
  const username = new URLSearchParams(location.search).get('u');
  if (!username) return null;
  const target = profileByUsername(username);
  if (!target || target.uid === state.user?.uid) return null;
  return target;
}

function messageHTML(message) {
  const mine = state.user?.uid === message.sender_uid;
  const photo = message.image_data
    ? `<button class="message-image-button" type="button" data-open-message-image="${esc(message.id)}" aria-label="Open message photo"><img class="message-image" src="${esc(message.image_data)}" alt="Photo message" loading="lazy"></button>`
    : '';
  const content = message.content ? `<div class="message-content">${esc(message.content)}</div>` : '';
  return `
    <div class="message-row ${mine ? 'mine' : 'theirs'}" data-message-id="${esc(message.id)}">
      <div class="message-bubble ${message.image_data ? 'has-image' : ''}">
        ${photo}
        ${content}
        <div class="message-meta">${relativeTime(message.created_at)}${mine ? ` · <button class="message-delete" data-delete-message="${esc(message.id)}">Delete</button>` : ''}</div>
      </div>
    </div>`;
}

function conversationHTML(conversation) {
  const otherUid = conversationOtherUid(conversation);
  const other = profileById(otherUid) || fallbackProfile(otherUid);
  const unread = conversationIsUnread(conversation);
  return `
    <a class="conversation-item ${unread ? 'unread' : ''}" href="messages.html?u=${encodeURIComponent(other.username)}">
      <div class="avatar conversation-avatar">${avatarInnerHTML(other)}</div>
      <div class="conversation-copy">
        <div class="conversation-line"><strong>${esc(other.display_name || other.username)}</strong><span>${relativeTime(conversation.updated_at)}</span></div>
        <div class="conversation-preview">${esc(conversation.last_message || 'Start a Mini conversation.')}</div>
      </div>
      ${unread ? '<span class="unread-dot" aria-label="Unread conversation"></span>' : ''}
    </a>`;
}

function ensureActiveMessageSubscription(conversationId, exists) {
  if (state.messageUnsubFor === conversationId && state.messageUnsub) return;
  if (state.messageUnsub) {
    try { state.messageUnsub(); } catch (_) {}
  }
  state.messageUnsub = null;
  state.messageUnsubFor = conversationId || null;
  state.activeMessages = [];

  if (!conversationId || !exists || !state.user) return;
  state.messageUnsub = state.db.collection('conversations').doc(conversationId).collection('messages')
    .onSnapshot(snapshot => {
      state.activeMessages = replaceSnapshot('messages', snapshot)
        .sort((a, b) => timestampMillis(a.created_at) - timestampMillis(b.created_at));
      renderMessages();
    }, err => toast(friendlyError(err), 'error'));
}

async function markConversationRead(conversation) {
  if (!state.user || !conversation || !conversationIsUnread(conversation)) return;
  const readId = `${conversation.id}__${state.user.uid}`;
  try {
    await state.db.collection('conversation_reads').doc(readId).set({
      conversation_id: conversation.id,
      user_uid: state.user.uid,
      last_read_at: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (err) { console.error(err); }
}

function renderMessages() {
  if (document.body.dataset.page !== 'messages') return;
  const list = document.querySelector('#conversationList');
  const pane = document.querySelector('#messagePane');
  const layout = document.querySelector('#messagesLayout');
  if (!list || !pane) return;

  if (!state.user) {
    list.innerHTML = '<div class="empty message-empty">Log in to see your messages. 📨</div>';
    pane.innerHTML = '<div class="message-placeholder"><strong>Messages</strong><span>Log in to start a Mini conversation.</span><button class="primary" type="button" data-auth-button-inline>Log in</button></div>';
    pane.querySelector('[data-auth-button-inline]')?.addEventListener('click', openAuthDialog);
    layout?.classList.remove('has-active');
    ensureActiveMessageSubscription('', false);
    return;
  }

  const conversations = myConversations();
  list.innerHTML = conversations.length
    ? conversations.map(conversationHTML).join('')
    : '<div class="empty message-empty">No conversations yet. Find someone and hit Message. 😭</div>';

  const target = activeMessageTarget();
  if (!target) {
    layout?.classList.remove('has-active');
    pane.innerHTML = '<div class="message-placeholder"><strong>Select a conversation</strong><span>Your Mini DMs will appear here.</span></div>';
    ensureActiveMessageSubscription('', false);
    return;
  }

  layout?.classList.add('has-active');
  const conversationId = conversationIdFor(state.user.uid, target.uid);
  const conversation = state.conversations.find(c => c.id === conversationId) || null;
  ensureActiveMessageSubscription(conversationId, !!conversation);
  if (conversation) setTimeout(() => markConversationRead(conversation), 0);

  const draft = state.messageDrafts[conversationId] || '';
  const imageDraft = state.messageImageDrafts[conversationId] || '';
  pane.innerHTML = `
    <header class="message-header">
      <a class="message-back" href="messages.html" aria-label="Back to conversations">←</a>
      <a class="message-person" href="profile.html?u=${encodeURIComponent(target.username)}">
        <div class="avatar message-avatar">${avatarInnerHTML(target)}</div>
        <div><strong>${esc(target.display_name || target.username)}</strong><span>@${esc(target.username)}</span></div>
      </a>
      <button id="messageCallButton" class="message-call-button" type="button">📞 Call</button>
    </header>
    <div id="messageThread" class="message-thread">
      ${state.activeMessages.length ? state.activeMessages.map(messageHTML).join('') : '<div class="message-placeholder thread-empty"><strong>Send the first Mini message. 😭</strong><span>This conversation is private between you two.</span></div>'}
    </div>
    <form id="messageForm" class="message-form">
      ${imageDraft ? `<div class="message-attachment-preview"><img src="${esc(imageDraft)}" alt="Photo ready to send"><button id="messageImageRemove" type="button" aria-label="Remove photo">×</button></div>` : ''}
      <textarea id="messageText" maxlength="1000" rows="1" placeholder="Write a message...">${esc(draft)}</textarea>
      <div class="message-compose-bottom">
        <div class="message-compose-tools">
          <label class="message-photo-button" title="Add photo">🖼️<span>Photo</span><input id="messageImageInput" type="file" accept="image/jpeg,image/png,image/webp" hidden></label>
          <span id="messageCharCount">${draft.length} / 1000</span>
        </div>
        <button class="primary" id="messageSend" type="submit">Send</button>
      </div>
    </form>`;

  const thread = pane.querySelector('#messageThread');
  if (thread) thread.scrollTop = thread.scrollHeight;
  bindMessageActions();
}

function bindMessageActions() {
  const form = document.querySelector('#messageForm');
  const text = document.querySelector('#messageText');
  const count = document.querySelector('#messageCharCount');
  const send = document.querySelector('#messageSend');
  const imageInput = document.querySelector('#messageImageInput');
  const imageRemove = document.querySelector('#messageImageRemove');
  document.querySelector('#messageCallButton')?.addEventListener('click', () => { const target = activeMessageTarget(); if (target) startCall(target); });
  if (!form || !text || !count || !send) return;

  document.querySelectorAll('[data-open-message-image]').forEach(button => {
    button.addEventListener('click', () => openMessageImage(button.dataset.openMessageImage));
  });

  imageInput?.addEventListener('change', async () => {
    const file = imageInput.files?.[0];
    const target = activeMessageTarget();
    if (!file || !state.user || !target) return;
    const conversationId = conversationIdFor(state.user.uid, target.uid);
    imageInput.disabled = true;
    try {
      state.messageDrafts[conversationId] = text.value;
      state.messageImageDrafts[conversationId] = await imageFileToMessage(file);
      toast('Photo ready to send. 📸');
      renderMessages();
    } catch (err) {
      imageInput.value = '';
      toast(friendlyError(err), 'error');
    } finally {
      imageInput.disabled = false;
    }
  });

  imageRemove?.addEventListener('click', () => {
    const target = activeMessageTarget();
    if (!state.user || !target) return;
    const conversationId = conversationIdFor(state.user.uid, target.uid);
    state.messageDrafts[conversationId] = text.value;
    delete state.messageImageDrafts[conversationId];
    renderMessages();
  });

  text.addEventListener('input', () => {
    count.textContent = `${text.value.length} / 1000`;
    const target = activeMessageTarget();
    if (state.user && target) state.messageDrafts[conversationIdFor(state.user.uid, target.uid)] = text.value;
  });
  text.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const target = activeMessageTarget();
    const content = text.value.trim();
    if (!state.user || !target) return;
    const conversationId = conversationIdFor(state.user.uid, target.uid);
    const imageData = state.messageImageDrafts[conversationId] || '';
    if (!content && !imageData) return;
    if (target.uid === state.user.uid) return;

    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      const conversationRef = state.db.collection('conversations').doc(conversationId);
      const messageRef = conversationRef.collection('messages').doc();
      const notificationRef = state.db.collection('notifications').doc(`message_${messageRef.id}`);
      const readRef = state.db.collection('conversation_reads').doc(`${conversationId}__${state.user.uid}`);
      const memberUids = [state.user.uid, target.uid].sort();
      const existing = state.conversations.find(c => c.id === conversationId);
      const batch = state.db.batch();
      const conversationPreview = content ? content.slice(0, 160) : '📷 Photo';
      const notificationPreview = content ? content.slice(0, 120) : '📷 Photo';

      if (existing) {
        batch.update(conversationRef, {
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          last_message: conversationPreview,
          last_sender_uid: state.user.uid,
          last_message_id: messageRef.id
        });
      } else {
        batch.set(conversationRef, {
          member_uids: memberUids,
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          last_message: conversationPreview,
          last_sender_uid: state.user.uid,
          last_message_id: messageRef.id
        });
      }

      const messageData = {
        sender_uid: state.user.uid,
        receiver_uid: target.uid,
        content,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (imageData) {
        messageData.image_data = imageData;
        messageData.image_mime = messageImageMime(imageData);
      }
      batch.set(messageRef, messageData);

      batch.set(readRef, {
        conversation_id: conversationId,
        user_uid: state.user.uid,
        last_read_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await batch.commit();

      // Notifications are intentionally written after the DM itself.
      // A notification rule problem must never block the actual message.
      try {
        await notificationRef.set({
          type: 'message',
          actor_uid: state.user.uid,
          target_uid: target.uid,
          post_id: '',
          comment_id: '',
          conversation_id: conversationId,
          message_id: messageRef.id,
          message_preview: notificationPreview,
          read: false,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (notificationError) {
        console.warn('Message sent, but notification could not be created:', notificationError);
      }

      state.messageDrafts[conversationId] = '';
      delete state.messageImageDrafts[conversationId];
      text.value = '';
      count.textContent = '0 / 1000';
      renderMessages();
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
      text.focus();
    }
  });

  document.querySelectorAll('[data-delete-message]').forEach(button => {
    button.addEventListener('click', async () => {
      const target = activeMessageTarget();
      if (!state.user || !target) return;
      const messageId = button.dataset.deleteMessage;
      const message = state.activeMessages.find(m => m.id === messageId);
      if (!message || message.sender_uid !== state.user.uid) return;
      const conversationId = conversationIdFor(state.user.uid, target.uid);
      const conversation = state.conversations.find(c => c.id === conversationId);
      const conversationRef = state.db.collection('conversations').doc(conversationId);
      const batch = state.db.batch();
      batch.delete(conversationRef.collection('messages').doc(messageId));
      batch.delete(state.db.collection('notifications').doc(`message_${messageId}`));
      if (conversation?.last_message_id === messageId) {
        batch.update(conversationRef, {
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          last_message: 'Message deleted.',
          last_sender_uid: state.user.uid,
          last_message_id: ''
        });
      }
      try { await batch.commit(); } catch (err) { toast(friendlyError(err), 'error'); }
    });
  });
}


const CALL_AUDIO = {
  incoming: 'assets/audio/call-incoming.mp3?v=073',
  outgoing: 'assets/audio/call-outgoing.mp3?v=073',
  accepted: 'assets/audio/call-accepted.mp3?v=073',
  end: 'assets/audio/call-end.mp3?v=073'
};

const CALL_AUDIO_IDS = {
  incoming: 'callSoundIncoming',
  outgoing: 'callSoundOutgoing',
  accepted: 'callSoundAccepted',
  end: 'callSoundEnd'
};

const CALL_TERMINAL_STATUSES = new Set(['declined', 'cancelled', 'missed', 'ended']);

function ensureCallSounds() {
  for (const kind of Object.keys(CALL_AUDIO)) {
    if (state.callSounds[kind]) continue;
    const element = document.querySelector(`#${CALL_AUDIO_IDS[kind]}`) || new Audio(CALL_AUDIO[kind]);
    element.preload = 'auto';
    element.loop = kind === 'incoming' || kind === 'outgoing';
    element.volume = 0.85;
    state.callSounds[kind] = element;
  }
}

function stopCallSound(kind) {
  const audio = state.callSounds?.[kind];
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch (_) {}
}

function stopAllCallSounds(except = '') {
  ensureCallSounds();
  for (const kind of Object.keys(CALL_AUDIO)) {
    if (kind !== except) stopCallSound(kind);
  }
}

function playCallSound(kind) {
  ensureCallSounds();
  const audio = state.callSounds[kind];
  if (!audio) return;

  // Every call event owns its own MP3. Stop the previous event sound,
  // then start this exact file from the beginning.
  stopAllCallSounds(kind);
  try { audio.currentTime = 0; } catch (_) {}
  audio.play().catch(err => console.warn(`${kind} call sound autoplay blocked:`, err));
}

function injectCallUI() {
  if (document.querySelector('#callOverlay')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <section id="callOverlay" class="call-overlay hidden" aria-live="assertive">
      <div class="call-card">
        <div id="callAvatar" class="avatar call-avatar">?</div>
        <h2 id="callName">SiarnoWatch Call</h2>
        <div id="callHandle" class="call-handle"></div>
        <p id="callStatus">Connecting…</p>
        <div class="call-actions">
          <button id="callAccept" class="call-circle accept hidden" type="button" aria-label="Accept call">✓</button>
          <button id="callMute" class="call-circle neutral hidden" type="button" aria-label="Mute microphone">🎙</button>
          <button id="callEnd" class="call-circle end hidden" type="button" aria-label="End call">✕</button>
        </div>
        <div id="callActionText" class="call-action-text"></div>
      </div>
    </section>
    <audio id="callSoundIncoming" preload="auto" src="assets/audio/call-incoming.mp3?v=073"></audio>
    <audio id="callSoundOutgoing" preload="auto" src="assets/audio/call-outgoing.mp3?v=073"></audio>
    <audio id="callSoundAccepted" preload="auto" src="assets/audio/call-accepted.mp3?v=073"></audio>
    <audio id="callSoundEnd" preload="auto" src="assets/audio/call-end.mp3?v=073"></audio>
    <audio id="remoteCallAudio" autoplay></audio>
  `);
  document.querySelector('#callAccept').addEventListener('click', acceptIncomingCall);
  document.querySelector('#callEnd').addEventListener('click', () => {
    if (state.activeCall?.role === 'callee' && state.activeCall?.status === 'ringing') declineIncomingCall();
    else endActiveCall();
  });
  document.querySelector('#callMute').addEventListener('click', toggleCallMute);
}

function renderCallOverlay(mode, person, statusText) {
  const overlay = document.querySelector('#callOverlay');
  if (!overlay) return;
  setAvatarElement(document.querySelector('#callAvatar'), person || fallbackProfile());
  document.querySelector('#callName').textContent = person?.display_name || person?.username || 'SiarnoWatch user';
  document.querySelector('#callHandle').textContent = person?.username ? `@${person.username}` : '';
  document.querySelector('#callStatus').textContent = statusText || 'Connecting…';
  const accept = document.querySelector('#callAccept');
  const mute = document.querySelector('#callMute');
  const end = document.querySelector('#callEnd');
  accept.classList.toggle('hidden', mode !== 'incoming');
  mute.classList.toggle('hidden', mode !== 'active');
  end.classList.remove('hidden');
  document.querySelector('#callActionText').textContent = mode === 'incoming' ? 'Accept        Decline' : mode === 'outgoing' ? 'Calling…' : 'Mute        End';
  overlay.classList.remove('hidden');
}

function hideCallOverlay() { document.querySelector('#callOverlay')?.classList.add('hidden'); }
function clearCallTimer() { if (state.callRingTimer) clearTimeout(state.callRingTimer); state.callRingTimer = null; }
function clearCallDocListener() { if (state.callDocUnsub) { try { state.callDocUnsub(); } catch (_) {} } state.callDocUnsub = null; }
function clearCallCandidateListeners() { state.callCandidateUnsubs.forEach(fn => { try { fn(); } catch (_) {} }); state.callCandidateUnsubs = []; }

function cleanupPeerConnection() {
  clearCallCandidateListeners();
  state.pendingRemoteCandidates = [];
  if (state.peerConnection) { try { state.peerConnection.close(); } catch (_) {} }
  state.peerConnection = null;
  if (state.localCallStream) state.localCallStream.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
  state.localCallStream = null;
  state.remoteCallStream = null;
  const audio = document.querySelector('#remoteCallAudio');
  if (audio) audio.srcObject = null;
}

function finishCall({ playEnd = true, message = '' } = {}) {
  // Firestore can echo our own terminal status update before the caller's
  // async update() finishes. That used to call finishCall() twice: the first
  // call started call-end.mp3, then the second call immediately stopped it.
  // If the call has already been cleaned up, leave the end sound alone.
  if (!state.activeCall) {
    if (message) toast(message);
    return;
  }

  clearCallTimer();
  clearCallDocListener();
  cleanupPeerConnection();
  stopAllCallSounds(playEnd ? 'end' : '');
  state.activeCall = null;
  hideCallOverlay();

  if (playEnd) playCallSound('end');
  if (message) toast(message);
}

async function addOrQueueRemoteCandidate(data) {
  if (!data || !state.peerConnection) return;
  const candidate = new RTCIceCandidate(data);
  if (state.peerConnection.remoteDescription) {
    try { await state.peerConnection.addIceCandidate(candidate); } catch (err) { console.warn(err); }
  } else state.pendingRemoteCandidates.push(candidate);
}

async function flushRemoteCandidates() {
  if (!state.peerConnection?.remoteDescription) return;
  const queue = [...state.pendingRemoteCandidates]; state.pendingRemoteCandidates = [];
  for (const c of queue) { try { await state.peerConnection.addIceCandidate(c); } catch (err) { console.warn(err); } }
}

async function createCallPeer(callRef, role) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Your browser does not support microphone calls.');
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.relay.metered.ca:80' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  });
  state.peerConnection = pc;
  const local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }, video:false });
  state.localCallStream = local;
  local.getTracks().forEach(track => pc.addTrack(track, local));

  const remote = new MediaStream(); state.remoteCallStream = remote;
  const audio = document.querySelector('#remoteCallAudio'); if (audio) audio.srcObject = remote;
  pc.ontrack = event => {
    event.streams[0]?.getTracks().forEach(track => { if (!remote.getTracks().some(t => t.id === track.id)) remote.addTrack(track); });
    audio?.play().catch(()=>{});
  };

  const own = role === 'caller' ? 'callerCandidates' : 'calleeCandidates';
  const other = role === 'caller' ? 'calleeCandidates' : 'callerCandidates';
  pc.onicecandidate = event => {
    if (!event.candidate) return;
    callRef.collection(own).add(event.candidate.toJSON()).catch(err => {
      console.warn('ICE candidate write failed:', err);
      if (err?.code === 'permission-denied') toast('Call ICE permission denied. Publish the latest Firestore Rules.', 'error');
    });
  };
  pc.onicecandidateerror = event => {
    console.warn('ICE candidate error:', event.errorCode, event.errorText, event.url);
  };
  pc.oniceconnectionstatechange = () => {
    console.log('ICE state:', pc.iceConnectionState);
    if (!state.activeCall) return;
    if (pc.iceConnectionState === 'checking') {
      const person = profileById(state.activeCall.other_uid) || fallbackProfile(state.activeCall.other_uid);
      renderCallOverlay('active', person, 'Connecting audio…');
    }
  };
  state.callCandidateUnsubs.push(callRef.collection(other).onSnapshot(s => {
    s.docChanges().forEach(change => { if (change.type === 'added') addOrQueueRemoteCandidate(change.doc.data()); });
  }, console.warn));

  pc.onconnectionstatechange = () => {
    if (!state.activeCall) return;
    if (pc.connectionState === 'connected') {
      const person = profileById(state.activeCall.other_uid) || fallbackProfile(state.activeCall.other_uid);
      renderCallOverlay('active', person, 'Connected');
    }
    if (pc.connectionState === 'failed') endActiveCall('Call connection failed even with relay. Try again or switch network.');
  };
  return pc;
}

function listenToActiveCall(callRef, role) {
  clearCallDocListener();
  state.callDocUnsub = callRef.onSnapshot(async snap => {
    if (!snap.exists || !state.activeCall || state.activeCall.id !== snap.id) return;
    const data = snap.data(); state.activeCall.status = data.status;
    if (role === 'caller' && data.status === 'accepted' && data.answer && state.peerConnection && !state.peerConnection.remoteDescription) {
      try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        await flushRemoteCandidates();
        clearCallTimer(); stopAllCallSounds(); playCallSound('accepted');
        renderCallOverlay('active', profileById(data.callee_uid) || fallbackProfile(data.callee_uid), 'Connected');
      } catch (err) { console.error(err); finishCall({message:'Could not connect the call.'}); }
      return;
    }
    if (data.status === 'accepted' && role === 'callee') {
      clearCallTimer();
      renderCallOverlay('active', profileById(data.caller_uid) || fallbackProfile(data.caller_uid), 'Connected');
      return;
    }
    if (CALL_TERMINAL_STATUSES.has(data.status)) {
      const msg = data.status === 'declined' ? 'Call declined.' : data.status === 'missed' ? 'No answer.' : data.status === 'cancelled' ? 'Call cancelled.' : 'Call ended.';
      finishCall({message:msg});
    }
  }, err => finishCall({message:friendlyError(err)}));
}

async function startCall(target) {
  if (!state.user) return openAuthDialog();
  if (!target || target.uid === state.user.uid) return;
  if (state.activeCall) return toast('You are already in a call.', 'error');
  injectCallUI();
  const ref = state.db.collection('calls').doc();
  state.activeCall = { id:ref.id, ref, role:'caller', other_uid:target.uid, status:'preparing' };
  renderCallOverlay('outgoing', target, 'Preparing microphone…');
  try {
    await ref.set({ caller_uid:state.user.uid, callee_uid:target.uid, member_uids:[state.user.uid,target.uid].sort(), status:'preparing', offer:null, answer:null, created_at:firebase.firestore.FieldValue.serverTimestamp(), updated_at:firebase.firestore.FieldValue.serverTimestamp() });
    const pc = await createCallPeer(ref, 'caller');
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await ref.update({ offer:{type:offer.type,sdp:offer.sdp}, status:'ringing', updated_at:firebase.firestore.FieldValue.serverTimestamp() });
    state.activeCall.status='ringing'; listenToActiveCall(ref,'caller'); playCallSound('outgoing'); renderCallOverlay('outgoing',target,'Calling…');
    clearCallTimer(); state.callRingTimer=setTimeout(async()=>{
      if (!state.activeCall || state.activeCall.id!==ref.id || state.activeCall.status!=='ringing') return;
      try { await ref.update({status:'missed',ended_by:state.user.uid,updated_at:firebase.firestore.FieldValue.serverTimestamp()}); } catch(_){}
      finishCall({message:'No answer.'});
    },45000);
  } catch(err) {
    console.error(err); try { await ref.update({status:'cancelled',ended_by:state.user.uid,updated_at:firebase.firestore.FieldValue.serverTimestamp()}); } catch(_){}
    finishCall({playEnd:false}); toast(err?.message || friendlyError(err),'error');
  }
}

function showIncomingCall(call) {
  if (!state.user || state.activeCall || !call?.offer || state.lastHandledIncomingCallId===call.id) return;
  const created=timestampMillis(call.created_at); if (created && Date.now()-created>90000) return;
  state.lastHandledIncomingCallId=call.id;
  const ref=state.db.collection('calls').doc(call.id);
  state.activeCall={id:call.id,ref,role:'callee',other_uid:call.caller_uid,status:'ringing'};
  listenToActiveCall(ref,'callee'); playCallSound('incoming');
  renderCallOverlay('incoming',profileById(call.caller_uid)||fallbackProfile(call.caller_uid),'Incoming audio call');
}

async function acceptIncomingCall() {
  const active=state.activeCall; if (!active || active.role!=='callee' || active.status!=='ringing') return;
  stopAllCallSounds(); const person=profileById(active.other_uid)||fallbackProfile(active.other_uid); renderCallOverlay('outgoing',person,'Connecting microphone…');
  try {
    const snap=await active.ref.get(); if (!snap.exists || snap.data().status!=='ringing') return finishCall({playEnd:false,message:'That call is no longer ringing.'});
    const data=snap.data(); const pc=await createCallPeer(active.ref,'callee');
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer)); await flushRemoteCandidates();
    const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
    await active.ref.update({answer:{type:answer.type,sdp:answer.sdp},status:'accepted',updated_at:firebase.firestore.FieldValue.serverTimestamp()});
    state.activeCall.status='accepted'; playCallSound('accepted'); renderCallOverlay('active',person,'Connected');
  } catch(err) { console.error(err); try { await active.ref.update({status:'ended',ended_by:state.user.uid,updated_at:firebase.firestore.FieldValue.serverTimestamp()}); } catch(_){} finishCall(); toast(err?.message||friendlyError(err),'error'); }
}

async function declineIncomingCall() {
  const active=state.activeCall; if (!active || active.role!=='callee') return;
  try { await active.ref.update({status:'declined',ended_by:state.user.uid,updated_at:firebase.firestore.FieldValue.serverTimestamp()}); } catch(err){console.warn(err);}
  finishCall();
}

async function endActiveCall(customMessage='') {
  const active=state.activeCall; if (!active) return;
  const status=active.status==='ringing' && active.role==='caller' ? 'cancelled' : 'ended';
  try { await active.ref.update({status,ended_by:state.user.uid,updated_at:firebase.firestore.FieldValue.serverTimestamp()}); } catch(err){console.warn(err);}
  finishCall({message:customMessage});
}

function toggleCallMute() {
  const tracks=state.localCallStream?.getAudioTracks()||[]; if (!tracks.length) return;
  const muting=tracks.some(t=>t.enabled); tracks.forEach(t=>t.enabled=!muting);
  const btn=document.querySelector('#callMute'); if (btn) btn.textContent=muting?'🔇':'🎙';
  const txt=document.querySelector('#callActionText'); if (txt) txt.textContent=`${muting?'Unmute':'Mute'}        End`;
}

function subscribeCalls(user) {
  if (state.callUnsub) { try { state.callUnsub(); } catch(_){} }
  state.callUnsub=null; state.lastHandledIncomingCallId=null;
  if (!user) { if (state.activeCall) finishCall({playEnd:false}); return; }
  state.callUnsub=state.db.collection('calls').where('callee_uid','==',user.uid).onSnapshot(s=>{
    if (state.activeCall) return;
    const ringing=replaceSnapshot('calls',s).filter(c=>c.status==='ringing'&&c.offer).filter(c=>{const t=timestampMillis(c.created_at);return !t||Date.now()-t<90000;}).sort((a,b)=>timestampMillis(b.created_at)-timestampMillis(a.created_at));
    if (ringing[0]) showIncomingCall(ringing[0]);
  },err=>console.warn('Incoming call listener failed:',err));
}

const DEVICE_NOTIFICATIONS_KEY = 'sw_device_notifications_enabled';
const DEVICE_NOTIFICATION_SEEN_KEY = 'sw_device_notification_seen_ids';

function deviceNotificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

function deviceNotificationsEnabled() {
  return deviceNotificationsSupported()
    && Notification.permission === 'granted'
    && localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) === '1';
}

function rememberDeviceNotification(id) {
  if (!id) return false;
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(DEVICE_NOTIFICATION_SEEN_KEY) || '[]'); } catch (_) {}
  if (!Array.isArray(ids)) ids = [];
  if (ids.includes(id)) return false;
  ids.push(id);
  if (ids.length > 120) ids = ids.slice(-120);
  localStorage.setItem(DEVICE_NOTIFICATION_SEEN_KEY, JSON.stringify(ids));
  return true;
}

async function ensureDeviceNotificationRegistration() {
  if (!deviceNotificationsSupported()) throw new Error('Device notifications are not supported in this browser.');
  if (state.deviceNotificationRegistration) return state.deviceNotificationRegistration;
  state.deviceNotificationRegistration = await navigator.serviceWorker.register('sw.js?v=080', { scope: './' });
  return state.deviceNotificationRegistration;
}

function syncDeviceNotificationCard() {
  const card = document.querySelector('#deviceNotificationCard');
  const button = document.querySelector('#deviceNotificationButton');
  const status = document.querySelector('#deviceNotificationStatus');
  if (!card || !button || !status) return;

  if (!state.user) {
    status.textContent = 'Log in to enable notifications on this device.';
    button.textContent = 'Log in first';
    button.disabled = true;
    return;
  }

  if (!deviceNotificationsSupported()) {
    status.textContent = 'This browser does not support system notifications.';
    button.textContent = 'Not supported';
    button.disabled = true;
    return;
  }

  button.disabled = false;
  if (Notification.permission === 'denied') {
    status.textContent = 'Notifications are blocked in browser settings.';
    button.textContent = 'Blocked by browser';
    button.disabled = true;
  } else if (deviceNotificationsEnabled()) {
    status.textContent = 'Likes, comments, follows and messages can appear in this device notification center.';
    button.textContent = 'Disable on this device';
  } else {
    status.textContent = 'Get SiarnoWatch activity in your Windows / Android notification center.';
    button.textContent = 'Enable device notifications';
  }
}

function injectDeviceNotificationCard() {
  if (document.body.dataset.page !== 'notifications') return;
  const list = document.querySelector('#notificationList');
  if (!list || document.querySelector('#deviceNotificationCard')) return;
  const card = document.createElement('section');
  card.id = 'deviceNotificationCard';
  card.className = 'device-notification-card';
  card.innerHTML = `
    <div class="device-notification-copy">
      <strong>🔔 Device notifications</strong>
      <span id="deviceNotificationStatus">Loading…</span>
    </div>
    <button id="deviceNotificationButton" class="secondary" type="button">Enable device notifications</button>`;
  list.before(card);
  card.querySelector('#deviceNotificationButton').addEventListener('click', toggleDeviceNotifications);
  syncDeviceNotificationCard();
}

async function toggleDeviceNotifications() {
  if (!state.user) return openAuthDialog();
  if (!deviceNotificationsSupported()) return toast('Device notifications are not supported here.', 'error');

  if (deviceNotificationsEnabled()) {
    localStorage.removeItem(DEVICE_NOTIFICATIONS_KEY);
    syncDeviceNotificationCard();
    toast('Device notifications disabled on this device.');
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      syncDeviceNotificationCard();
      return toast('Notification permission was not granted.', 'error');
    }
    await ensureDeviceNotificationRegistration();
    localStorage.setItem(DEVICE_NOTIFICATIONS_KEY, '1');
    syncDeviceNotificationCard();
    toast('Device notifications enabled. 🔔');

    const reg = state.deviceNotificationRegistration;
    await reg.showNotification('SiarnoWatch', {
      body: 'Device notifications are ready. Mini 🔥',
      icon: 'assets/swlogo.png',
      badge: 'assets/swlogo.png',
      tag: 'siarnowatch-notifications-ready',
      data: { url: new URL('notifications.html', location.href).href }
    });
  } catch (err) {
    console.error('Device notification setup failed:', err);
    toast(err?.message || 'Could not enable device notifications.', 'error');
  }
}

async function prepareDeviceNotifications(user) {
  state.deviceNotificationInitialSnapshot = false;
  if (!user || !deviceNotificationsSupported()) {
    syncDeviceNotificationCard();
    return;
  }
  if (localStorage.getItem(DEVICE_NOTIFICATIONS_KEY) === '1' && Notification.permission === 'granted') {
    try { await ensureDeviceNotificationRegistration(); } catch (err) { console.warn('Service worker registration failed:', err); }
  }
  syncDeviceNotificationCard();
}

async function showDeviceNotification(notification) {
  if (!state.user || notification?.target_uid !== state.user.uid || !deviceNotificationsEnabled()) return;
  if (!rememberDeviceNotification(notification.id)) return;

  try {
    const reg = await ensureDeviceNotificationRegistration();
    const actor = profileById(notification.actor_uid) || fallbackProfile(notification.actor_uid);
    const actorName = actor.display_name || actor.username || 'Someone';
    const action = notificationText(notification);
    const preview = notification.type === 'message' ? String(notification.message_preview || '').trim() : notificationPostPreview(notification);
    const body = `${actorName} ${action}${preview ? ` — ${preview}` : ''}`;
    const url = new URL(notificationDestination(notification), location.href).href;

    await reg.showNotification('SiarnoWatch', {
      body,
      icon: 'assets/swlogo.png',
      badge: 'assets/swlogo.png',
      tag: `siarnowatch-${notification.id}`,
      renotify: true,
      data: { url, notificationId: notification.id }
    });
  } catch (err) {
    console.warn('Could not show device notification:', err);
  }
}

function myNotifications() {
  if (!state.user) return [];
  return state.notifications
    .filter(n => n.target_uid === state.user.uid)
    .sort((a, b) => tsDate(b.created_at) - tsDate(a.created_at));
}

function unreadNotificationCount() {
  return myNotifications().filter(n => !n.read).length;
}

function notificationDestination(n) {
  if ((n.type === 'like' || n.type === 'comment') && n.post_id) {
    return `post.html?id=${encodeURIComponent(n.post_id)}`;
  }
  const actor = profileById(n.actor_uid);
  if (n.type === 'message' && actor?.username) return `messages.html?u=${encodeURIComponent(actor.username)}`;
  return actor?.username ? `profile.html?u=${encodeURIComponent(actor.username)}` : 'index.html';
}

function notificationText(n) {
  if (n.type === 'like') return 'liked your post';
  if (n.type === 'comment') return 'commented on your post';
  if (n.type === 'follow') return 'followed you';
  if (n.type === 'message') return 'sent you a message';
  return 'sent you a notification';
}

function notificationPostPreview(n) {
  if (!n.post_id) return '';
  const post = state.posts.find(p => p.id === n.post_id);
  if (!post?.content) return '';
  const text = String(post.content).replace(/\s+/g, ' ').trim();
  const clipped = text.length > 72 ? `${text.slice(0, 72).trimEnd()}…` : text;
  return clipped;
}

function notificationHTML(n) {
  const actor = profileById(n.actor_uid) || fallbackProfile(n.actor_uid);
  const icon = n.type === 'like' ? '♥' : n.type === 'comment' ? '💬' : n.type === 'message' ? '✉' : '◎';
  const preview = n.type === 'message' ? (n.message_preview || '') : notificationPostPreview(n);
  return `
    <a class="notification-item ${n.read ? '' : 'unread'}" href="${esc(notificationDestination(n))}">
      <div class="notification-icon">${icon}</div>
      <div class="avatar notification-avatar">${avatarInnerHTML(actor)}</div>
      <div class="notification-main">
        <div><strong>${esc(actor.display_name || actor.username)}</strong> ${esc(notificationText(n))}</div>
        ${preview ? `<div class="notification-preview">“${esc(preview)}”</div>` : ''}
        <div class="notification-meta">@${esc(actor.username)} · ${relativeTime(n.created_at)}</div>
      </div>
      ${n.read ? '' : '<span class="unread-dot" aria-label="Unread"></span>'}
    </a>`;
}

async function markNotificationsRead() {
  if (!state.user || document.body.dataset.page !== 'notifications') return;
  const unread = myNotifications().filter(n => !n.read);
  if (!unread.length) return;
  const batch = state.db.batch();
  unread.forEach(n => batch.update(state.db.collection('notifications').doc(n.id), { read: true }));
  try { await batch.commit(); } catch (err) { console.error(err); }
}

function renderNotifications() {
  const target = document.querySelector('#notificationList');
  if (!target) return;
  injectDeviceNotificationCard();
  syncDeviceNotificationCard();

  if (!state.user) {
    target.innerHTML = '<div class="empty">Log in to see your notifications. 🔔</div>';
    return;
  }

  const items = myNotifications();
  target.innerHTML = items.length
    ? items.map(notificationHTML).join('')
    : '<div class="empty">No notifications yet. Suspiciously peaceful. 😭</div>';

  setTimeout(markNotificationsRead, 0);
}

function postHTML(post) {
  const u = profileById(post.author_uid) || fallbackProfile(post.author_uid);
  const liked = didILike(post.id);
  return `
    <article class="post" data-id="${esc(post.id)}">
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="avatar">${avatarInnerHTML(u)}</a>
      <div class="post-main">
        <div class="post-head">
          <a class="post-name" href="profile.html?u=${encodeURIComponent(u.username)}">${esc(u.display_name || u.username)}</a>
          <span class="post-handle">@${esc(u.username)}</span>
          <span class="post-time">· ${relativeTime(post.created_at)}${post.edited_at ? ' · edited' : ''}</span>
        </div>
        <div class="post-content">${esc(post.content)}</div>
        <div class="post-actions">
          <button class="post-action" data-open-post="${esc(post.id)}">💬 ${postCommentCount(post.id)}</button>
          <button class="post-action ${liked ? 'liked' : ''}" data-like="${esc(post.id)}">♥ ${postLikeCount(post.id)}</button>
          <button class="post-action" data-share="${esc(post.id)}">↗ Share</button>
          ${state.user?.uid === post.author_uid ? `<button class="post-action" data-edit-post="${esc(post.id)}">✎ Edit</button>` : ''}
        </div>
      </div>
    </article>`;
}

function renderFeed(posts, target) {
  if (!target) return;
  if (!state.configured) {
    target.innerHTML = '<div class="empty">Firebase configuration is missing 😭</div>';
    return;
  }
  target.innerHTML = posts.length ? posts.map(postHTML).join('') : '<div class="empty">No posts yet. You can make the first real one. 😭</div>';
  bindPostActions(target);
}

function renderHome() {
  renderFeed(state.posts, document.querySelector('#feed'));
}

function renderProfile() {
  const target = document.querySelector('#profileFeed');
  if (!target) return;
  const wanted = new URLSearchParams(location.search).get('u');
  const u = wanted ? profileByUsername(wanted) : state.me;
  if (!u) {
    document.querySelector('#profileTitle').textContent = state.user ? 'Profile' : 'Log in to view your profile';
    document.querySelector('#profileCount').textContent = '0 posts';
    target.innerHTML = `<div class="empty">${state.user ? 'Profile is still loading…' : 'Log in first 😭'}</div>`;
    return;
  }
  const posts = state.posts.filter(p => p.author_uid === u.uid);
  const counts = followCounts(u.uid);
  document.title = `${u.display_name} (@${u.username}) · SiarnoWatch`;
  document.querySelector('#profileTitle').textContent = u.display_name;
  document.querySelector('#profileCount').textContent = `${posts.length} post${posts.length === 1 ? '' : 's'}`;
  setAvatarElement(document.querySelector('#profileAvatar'), u);
  const profileBanner = document.querySelector('#profileBanner');
  if (profileBanner) {
    profileBanner.style.backgroundImage = u.banner_image ? `url("${u.banner_image}")` : '';
    profileBanner.classList.toggle('has-image', !!u.banner_image);
  }
  document.querySelector('#profileName').textContent = u.display_name;
  document.querySelector('#profileHandle').textContent = `@${u.username}`;
  document.querySelector('#profileBio').textContent = u.bio || '';
  document.querySelector('#followingCount').textContent = counts.following;
  document.querySelector('#followerCount').textContent = counts.followers;
  renderFeed(posts, target);

  const followButton = document.querySelector('#followButton');
  const messageButton = document.querySelector('#messageButton');
  const callButton = document.querySelector('#callButton');
  if (!followButton) return;
  if (state.user?.uid === u.uid) {
    followButton.textContent = 'Edit profile';
    followButton.onclick = () => openEditProfileDialog(u);
    messageButton?.classList.add('hidden');
    callButton?.classList.add('hidden');
  } else {
    followButton.textContent = amIFollowing(u.uid) ? 'Following' : 'Follow';
    followButton.onclick = () => toggleFollow(u.uid);
    if (messageButton) {
      messageButton.classList.remove('hidden');
      messageButton.textContent = 'Message';
      messageButton.onclick = () => {
        if (!state.user) return openAuthDialog();
        location.href = `messages.html?u=${encodeURIComponent(u.username)}`;
      };
    }
    if (callButton) {
      callButton.classList.remove('hidden');
      callButton.textContent = 'Call';
      callButton.onclick = () => startCall(u);
    }
  }
}

function commentHTML(comment) {
  const u = profileById(comment.author_uid) || fallbackProfile(comment.author_uid);
  const mine = state.user?.uid === comment.author_uid;
  return `
    <article class="comment" data-comment-id="${esc(comment.id)}">
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="avatar comment-avatar">${avatarInnerHTML(u)}</a>
      <div class="comment-main">
        <div class="post-head">
          <a class="post-name" href="profile.html?u=${encodeURIComponent(u.username)}">${esc(u.display_name || u.username)}</a>
          <span class="post-handle">@${esc(u.username)}</span>
          <span class="post-time">· ${relativeTime(comment.created_at)}</span>
        </div>
        <div class="comment-content">${esc(comment.content)}</div>
        ${mine ? `<button class="comment-delete" data-delete-comment="${esc(comment.id)}">Delete</button>` : ''}
      </div>
    </article>`;
}

function renderComments(postId) {
  const list = document.querySelector('#commentsList');
  if (!list) return;
  const comments = commentsForPost(postId);
  list.innerHTML = comments.length
    ? comments.map(commentHTML).join('')
    : '<div class="empty comments-empty">No comments yet. Be the first Mini reply. 😭</div>';

  list.querySelectorAll('[data-delete-comment]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!state.user) return openAuthDialog();
      try {
        const batch = state.db.batch();
        batch.delete(state.db.collection('comments').doc(btn.dataset.deleteComment));
        batch.delete(state.db.collection('notifications').doc(`comment_${btn.dataset.deleteComment}`));
        await batch.commit();
        toast('Comment deleted.');
      } catch (err) {
        toast(friendlyError(err), 'error');
      }
    });
  });
}

function renderSinglePost() {
  const id = new URLSearchParams(location.search).get('id');
  const target = document.querySelector('#singlePost');
  const post = state.posts.find(p => p.id === id);
  if (!post) {
    if (target) target.innerHTML = '<div class="empty">Post not found 😭</div>';
    const list = document.querySelector('#commentsList');
    if (list) list.innerHTML = '';
    return;
  }
  renderFeed([post], target);
  renderComments(id);
  const count = document.querySelector('#commentSectionCount');
  if (count) count.textContent = `${postCommentCount(id)} comment${postCommentCount(id) === 1 ? '' : 's'}`;
}

function renderCurrentPage() {
  const page = document.body.dataset.page;
  if (page === 'home') renderHome();
  if (page === 'profile') renderProfile();
  if (page === 'post') renderSinglePost();
  if (page === 'notifications') renderNotifications();
  if (page === 'messages') renderMessages();
}

function updateAuthUI() {
  state.me = state.user ? profileById(state.user.uid) : null;
  document.querySelectorAll('[data-auth-button]').forEach(btn => {
    btn.textContent = state.me ? `@${state.me.username}` : (state.user ? 'Account' : 'Log in');
  });
  document.querySelectorAll('[data-profile-link]').forEach(link => {
    link.href = state.me ? `profile.html?u=${encodeURIComponent(state.me.username)}` : 'profile.html';
  });
  document.querySelectorAll('.avatar-current').forEach(el => {
    setAvatarElement(el, state.me);
  });

  const unread = unreadNotificationCount();
  document.querySelectorAll('[data-notification-badge]').forEach(el => {
    el.textContent = unread > 99 ? '99+' : String(unread);
    el.classList.toggle('hidden', unread === 0);
  });

  const unreadMessages = unreadMessageConversationCount();
  document.querySelectorAll('[data-message-badge]').forEach(el => {
    el.textContent = unreadMessages > 99 ? '99+' : String(unreadMessages);
    el.classList.toggle('hidden', unreadMessages === 0);
  });
}

async function toggleLike(postId) {
  if (!state.user) return openAuthDialog();
  const post = state.posts.find(p => p.id === postId);
  if (!post) return toast('That post no longer exists.', 'error');

  const id = `${state.user.uid}_${postId}`;
  const ref = state.db.collection('likes').doc(id);
  const notificationRef = state.db.collection('notifications').doc(`like_${id}`);

  try {
    const batch = state.db.batch();
    if (didILike(postId)) {
      batch.delete(ref);
      if (post.author_uid !== state.user.uid) batch.delete(notificationRef);
    } else {
      batch.set(ref, {
        user_uid: state.user.uid,
        post_id: postId,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (post.author_uid !== state.user.uid) {
        batch.set(notificationRef, {
          type: 'like',
          actor_uid: state.user.uid,
          target_uid: post.author_uid,
          post_id: postId,
          comment_id: '',
          read: false,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    }
    await batch.commit();
  } catch (err) { toast(friendlyError(err), 'error'); }
}

async function toggleFollow(uid) {
  if (!state.user) return openAuthDialog();
  if (uid === state.user.uid) return;

  const id = `${state.user.uid}_${uid}`;
  const ref = state.db.collection('follows').doc(id);
  const notificationRef = state.db.collection('notifications').doc(`follow_${id}`);

  try {
    const batch = state.db.batch();
    if (amIFollowing(uid)) {
      batch.delete(ref);
      batch.delete(notificationRef);
    } else {
      batch.set(ref, {
        follower_uid: state.user.uid,
        following_uid: uid,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      batch.set(notificationRef, {
        type: 'follow',
        actor_uid: state.user.uid,
        target_uid: uid,
        post_id: '',
        comment_id: '',
        read: false,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    await batch.commit();
  } catch (err) { toast(friendlyError(err), 'error'); }
}

function bindPostActions(root = document) {
  root.querySelectorAll('[data-like]').forEach(btn => btn.addEventListener('click', () => toggleLike(btn.dataset.like)));
  root.querySelectorAll('[data-open-post]').forEach(btn => btn.addEventListener('click', () => {
    location.href = `post.html?id=${encodeURIComponent(btn.dataset.openPost)}`;
  }));
  root.querySelectorAll('[data-share]').forEach(btn => btn.addEventListener('click', async () => {
    const url = new URL(`post.html?id=${encodeURIComponent(btn.dataset.share)}`, location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      btn.textContent = '✓ Copied';
      setTimeout(() => btn.textContent = '↗ Share', 1200);
    } catch { window.prompt('Copy this link:', url); }
  }));

  root.querySelectorAll('[data-edit-post]').forEach(btn => btn.addEventListener('click', () => {
    openEditPostDialog(btn.dataset.editPost);
  }));
}

function setupComposer() {
  const dialog = document.querySelector('#composerDialog');
  if (!dialog) return;
  const form = document.querySelector('#composerForm');
  const text = document.querySelector('#postText');
  const count = document.querySelector('#charCount');
  const publish = document.querySelector('#publishButton');

  document.querySelectorAll('.compose-open').forEach(btn => btn.addEventListener('click', () => {
    if (!state.user) return openAuthDialog();
    if (!state.me) return toast('Your profile is still loading. Try again in a second.', 'error');
    dialog.showModal();
    text.focus();
  }));

  text.addEventListener('input', () => count.textContent = `${text.value.length} / 280`);
  form.addEventListener('submit', async e => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const content = text.value.trim();
    if (!content || !state.user) return;
    publish.disabled = true;
    publish.textContent = 'Posting…';
    try {
      await state.db.collection('posts').add({
        author_uid: state.user.uid,
        content,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      text.value = '';
      count.textContent = '0 / 280';
      dialog.close();
      toast('Posted to SiarnoWatch. 🔥');
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      publish.disabled = false;
      publish.textContent = 'Post';
    }
  });
}

function setupCommentComposer() {
  const form = document.querySelector('#commentForm');
  if (!form) return;

  const text = document.querySelector('#commentText');
  const count = document.querySelector('#commentCharCount');
  const button = document.querySelector('#commentSubmit');

  text.addEventListener('focus', () => {
    if (!state.user) {
      text.blur();
      openAuthDialog();
    }
  });

  text.addEventListener('input', () => {
    count.textContent = `${text.value.length} / 280`;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.user) return openAuthDialog();
    if (!state.me) return toast('Your profile is still loading. Try again in a second.', 'error');

    const postId = new URLSearchParams(location.search).get('id');
    const post = state.posts.find(p => p.id === postId);
    const content = text.value.trim();

    if (!post) return toast('That post no longer exists.', 'error');
    if (!content) return;

    button.disabled = true;
    button.textContent = 'Replying…';
    try {
      const commentRef = state.db.collection('comments').doc();
      const batch = state.db.batch();

      batch.set(commentRef, {
        post_id: postId,
        author_uid: state.user.uid,
        content,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });

      if (post.author_uid !== state.user.uid) {
        batch.set(state.db.collection('notifications').doc(`comment_${commentRef.id}`), {
          type: 'comment',
          actor_uid: state.user.uid,
          target_uid: post.author_uid,
          post_id: postId,
          comment_id: commentRef.id,
          read: false,
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      await batch.commit();
      text.value = '';
      count.textContent = '0 / 280';
      toast('Comment posted. 💬');
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Reply';
    }
  });
}

function injectAuthDialog() {
  if (document.querySelector('#authDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="authDialog" class="dialog">
      <div class="dialog-card auth-card">
        <div class="dialog-head"><strong id="authTitle">Log in to SiarnoWatch</strong><button class="icon-button" id="authClose">×</button></div>
        <div id="accountPanel" class="account-panel hidden"></div>
        <form id="authForm">
          <div class="auth-grid">
            <label><span>Email</span><input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com"></label>
            <label><span>Password</span><input id="authPassword" type="password" autocomplete="current-password" minlength="6" required placeholder="••••••••"></label>
            <label class="signup-only"><span>Username</span><input id="authUsername" maxlength="20" placeholder="Developium-233" pattern="[A-Za-z0-9_-]{3,20}"></label>
            <label class="signup-only"><span>Display name</span><input id="authDisplayName" maxlength="40" placeholder="Developium-233"></label>
          </div>
          <div class="auth-switch"><button type="button" class="text-button" id="authModeToggle">Need an account? Sign up</button></div>
          <div class="dialog-actions auth-actions"><span id="authStatus"></span><button class="primary" id="authSubmit" type="submit">Log in</button></div>
        </form>
      </div>
    </dialog>

    <dialog id="editProfileDialog" class="dialog">
      <form class="dialog-card" id="editProfileForm">
        <div class="dialog-head"><strong>Edit profile</strong><button class="icon-button" id="editProfileClose" type="button">×</button></div>
        <div class="auth-grid">
          <label><span>Display name</span><input id="editDisplayName" maxlength="40" required></label>
          <label><span>Bio</span><input id="editBio" maxlength="160"></label>
          <label><span>Profile picture</span><input id="editPfp" type="file" accept="image/jpeg,image/png,image/webp"></label>
          <div class="pfp-editor">
            <div id="editPfpPreview" class="avatar pfp-preview">?</div>
            <button class="secondary" id="removePfpButton" type="button">Remove picture</button>
          </div>

          <label><span>Banner image</span><input id="editBanner" type="file" accept="image/jpeg,image/png,image/webp"></label>
          <div id="editBannerPreview" class="banner-preview"></div>
          <button class="secondary banner-remove" id="removeBannerButton" type="button">Remove banner</button>

          <label><span>Avatar letters (fallback)</span><input id="editAvatar" maxlength="3"></label>
        </div>
        <div class="dialog-actions"><span class="muted">Username stays fixed for now.</span><button class="primary" type="submit">Save</button></div>
      </form>
    </dialog>

    <dialog id="editPostDialog" class="dialog">
      <form class="dialog-card" id="editPostForm">
        <div class="dialog-head"><strong>Edit post</strong><button class="icon-button" id="editPostClose" type="button">×</button></div>
        <textarea id="editPostText" maxlength="280" required></textarea>
        <div class="dialog-actions">
          <span id="editPostCharCount">0 / 280</span>
          <button class="primary" id="editPostSubmit" type="submit">Save</button>
        </div>
      </form>
    </dialog>`);

  document.querySelector('#authClose').onclick = () => document.querySelector('#authDialog').close();
  document.querySelector('#editProfileClose').onclick = () => document.querySelector('#editProfileDialog').close();
  document.querySelector('#editPostClose').onclick = () => document.querySelector('#editPostDialog').close();

  const editPfpInput = document.querySelector('#editPfp');
  const editPfpPreview = document.querySelector('#editPfpPreview');
  const removePfpButton = document.querySelector('#removePfpButton');
  const editBannerInput = document.querySelector('#editBanner');
  const editBannerPreview = document.querySelector('#editBannerPreview');
  const removeBannerButton = document.querySelector('#removeBannerButton');

  editPfpInput.addEventListener('change', async () => {
    const file = editPfpInput.files?.[0];
    if (!file) return;
    editPfpInput.disabled = true;
    try {
      pendingProfileImage = await imageFileToAvatar(file);
      setAvatarElement(editPfpPreview, {
        avatar_image: pendingProfileImage,
        avatar_text: document.querySelector('#editAvatar').value || state.me?.avatar_text || '?'
      });
      toast('Profile picture ready. Save profile to apply it.');
    } catch (err) {
      editPfpInput.value = '';
      toast(friendlyError(err), 'error');
    } finally {
      editPfpInput.disabled = false;
    }
  });

  removePfpButton.addEventListener('click', () => {
    pendingProfileImage = '';
    editPfpInput.value = '';
    setAvatarElement(editPfpPreview, {
      avatar_text: document.querySelector('#editAvatar').value || state.me?.avatar_text || '?'
    });
  });

  editBannerInput.addEventListener('change', async () => {
    const file = editBannerInput.files?.[0];
    if (!file) return;
    editBannerInput.disabled = true;
    try {
      pendingBannerImage = await imageFileToBanner(file);
      editBannerPreview.style.backgroundImage = `url("${pendingBannerImage}")`;
      editBannerPreview.classList.add('has-image');
      toast('Banner ready. Save profile to apply it.');
    } catch (err) {
      editBannerInput.value = '';
      toast(friendlyError(err), 'error');
    } finally {
      editBannerInput.disabled = false;
    }
  });

  removeBannerButton.addEventListener('click', () => {
    pendingBannerImage = '';
    editBannerInput.value = '';
    editBannerPreview.style.backgroundImage = '';
    editBannerPreview.classList.remove('has-image');
  });

  document.querySelector('#editAvatar').addEventListener('input', e => {
    if (!pendingProfileImage) {
      setAvatarElement(editPfpPreview, { avatar_text: e.target.value.trim().slice(0, 3).toUpperCase() || '?' });
    }
  });

  let signupMode = false;
  const form = document.querySelector('#authForm');
  const toggle = document.querySelector('#authModeToggle');
  const submit = document.querySelector('#authSubmit');
  const title = document.querySelector('#authTitle');
  const status = document.querySelector('#authStatus');
  const username = document.querySelector('#authUsername');
  const displayName = document.querySelector('#authDisplayName');

  function syncMode() {
    document.querySelectorAll('.signup-only').forEach(el => el.classList.toggle('hidden', !signupMode));
    username.required = signupMode;
    displayName.required = signupMode;
    submit.textContent = signupMode ? 'Sign up' : 'Log in';
    title.textContent = signupMode ? 'Create SiarnoWatch account' : 'Log in to SiarnoWatch';
    toggle.textContent = signupMode ? 'Already have an account? Log in' : 'Need an account? Sign up';
    status.textContent = '';
  }

  toggle.onclick = () => { signupMode = !signupMode; syncMode(); };
  syncMode();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.textContent = 'Working…';
    submit.disabled = true;
    const email = document.querySelector('#authEmail').value.trim();
    const password = document.querySelector('#authPassword').value;
    try {
      if (signupMode) {
        const uname = username.value.trim();
        const unameLower = uname.toLowerCase();
        const dname = displayName.value.trim();
        if (!/^[A-Za-z0-9_-]{3,20}$/.test(uname)) throw new Error('Username must be 3–20 letters, numbers, _ or -.');
        if (!dname) throw new Error('Display name cannot be empty.');

        const reservation = state.db.collection('usernames').doc(unameLower);
        const existing = await reservation.get();
        if (existing.exists) throw new Error('That username is already taken.');

        const credential = await state.auth.createUserWithEmailAndPassword(email, password);
        const user = credential.user;
        try {
          const batch = state.db.batch();
          batch.set(reservation, { uid: user.uid, username: uname, created_at: firebase.firestore.FieldValue.serverTimestamp() });
          batch.set(state.db.collection('profiles').doc(user.uid), {
            uid: user.uid,
            username: uname,
            username_lower: unameLower,
            display_name: dname,
            bio: '',
            avatar_text: uname.slice(0, 2).toUpperCase(),
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
          });
          await batch.commit();
        } catch (err) {
          try { await user.delete(); } catch (_) {}
          throw err;
        }
        document.querySelector('#authDialog').close();
        toast('Welcome to SiarnoWatch! 🔥');
      } else {
        await state.auth.signInWithEmailAndPassword(email, password);
        document.querySelector('#authDialog').close();
        toast('Logged in.');
      }
    } catch (err) {
      console.error(err);
      status.textContent = friendlyError(err);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector('#editProfileForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.user || !state.me) return;
    try {
      await state.db.collection('profiles').doc(state.user.uid).update({
        display_name: document.querySelector('#editDisplayName').value.trim(),
        bio: document.querySelector('#editBio').value.trim(),
        avatar_text: document.querySelector('#editAvatar').value.trim().slice(0,3).toUpperCase() || state.me.avatar_text,
        avatar_image: pendingProfileImage,
        banner_image: pendingBannerImage,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.querySelector('#editProfileDialog').close();
      toast('Profile updated.');
    } catch (err) { toast(friendlyError(err), 'error'); }
  });
}


function openEditPostDialog(postId) {
  if (!state.user) return openAuthDialog();
  const post = state.posts.find(p => p.id === postId);
  if (!post) return toast('That post no longer exists.', 'error');
  if (post.author_uid !== state.user.uid) return toast('You can only edit your own posts.', 'error');

  const dialog = document.querySelector('#editPostDialog');
  const text = document.querySelector('#editPostText');
  const count = document.querySelector('#editPostCharCount');

  dialog.dataset.postId = postId;
  text.value = post.content || '';
  count.textContent = `${text.value.length} / 280`;
  dialog.showModal();
  text.focus();
}

function setupEditPost() {
  const form = document.querySelector('#editPostForm');
  if (!form) return;

  const dialog = document.querySelector('#editPostDialog');
  const text = document.querySelector('#editPostText');
  const count = document.querySelector('#editPostCharCount');
  const submit = document.querySelector('#editPostSubmit');

  text.addEventListener('input', () => {
    count.textContent = `${text.value.length} / 280`;
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.user) return openAuthDialog();

    const postId = dialog.dataset.postId;
    const post = state.posts.find(p => p.id === postId);
    const content = text.value.trim();

    if (!post) return toast('That post no longer exists.', 'error');
    if (post.author_uid !== state.user.uid) return toast('You can only edit your own posts.', 'error');
    if (!content) return toast('Post cannot be empty.', 'error');

    submit.disabled = true;
    submit.textContent = 'Saving…';

    try {
      await state.db.collection('posts').doc(postId).update({
        content,
        edited_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      dialog.close();
      toast('Post updated. ✎');
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Save';
    }
  });
}

function openAuthDialog() {
  const dialog = document.querySelector('#authDialog');
  const form = document.querySelector('#authForm');
  const panel = document.querySelector('#accountPanel');
  if (state.user) {
    form.classList.add('hidden');
    panel.classList.remove('hidden');
    const p = state.me || fallbackProfile(state.user.uid);
    panel.innerHTML = `
      <div class="account-who"><div class="avatar">${avatarInnerHTML(p)}</div><div><strong>${esc(p.display_name || 'Account')}</strong><div class="muted">${p.username ? '@'+esc(p.username) : esc(state.user.email || '')}</div></div></div>
      <div class="account-buttons">${p.username ? `<a class="secondary account-link" href="profile.html?u=${encodeURIComponent(p.username)}">View profile</a>` : ''}<button class="secondary" id="signOutButton">Sign out</button></div>`;
    document.querySelector('#authTitle').textContent = 'Your account';
    document.querySelector('#signOutButton').onclick = async () => {
      await state.auth.signOut();
      dialog.close();
    };
  } else {
    panel.classList.add('hidden');
    form.classList.remove('hidden');
  }
  dialog.showModal();
}

function openEditProfileDialog(u) {
  document.querySelector('#editDisplayName').value = u.display_name || '';
  document.querySelector('#editBio').value = u.bio || '';
  document.querySelector('#editAvatar').value = u.avatar_text || '';
  document.querySelector('#editPfp').value = '';
  pendingProfileImage = u.avatar_image || '';
  setAvatarElement(document.querySelector('#editPfpPreview'), u);

  document.querySelector('#editBanner').value = '';
  pendingBannerImage = u.banner_image || '';
  const bannerPreview = document.querySelector('#editBannerPreview');
  bannerPreview.style.backgroundImage = pendingBannerImage ? `url("${pendingBannerImage}")` : '';
  bannerPreview.classList.toggle('has-image', !!pendingBannerImage);

  document.querySelector('#editProfileDialog').showModal();
}

function setupGlobalActions() {
  document.querySelectorAll('[data-auth-button]').forEach(btn => btn.addEventListener('click', openAuthDialog));
  document.querySelector('#searchButton')?.addEventListener('click', () => {
    const q = prompt('Search SiarnoWatch:');
    if (!q) return;
    const needle = q.trim().toLowerCase();
    const matches = state.posts.filter(p => p.content.toLowerCase().includes(needle));
    const feed = document.querySelector('#feed');
    if (feed) renderFeed(matches, feed);
  });
}

function replaceSnapshot(target, snapshot) {
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function subscribeNotifications(user) {
  if (state.notificationUnsub) {
    try { state.notificationUnsub(); } catch (_) {}
    state.notificationUnsub = null;
  }
  state.notifications = [];
  state.deviceNotificationInitialSnapshot = false;

  if (!user) {
    updateAuthUI();
    renderCurrentPage();
    return;
  }

  state.notificationUnsub = state.db.collection('notifications')
    .where('target_uid', '==', user.uid)
    .onSnapshot(s => {
      const isInitialSnapshot = !state.deviceNotificationInitialSnapshot;
      const added = isInitialSnapshot ? [] : s.docChanges()
        .filter(change => change.type === 'added')
        .map(change => ({ id: change.doc.id, ...change.doc.data() }));

      state.notifications = replaceSnapshot('notifications', s);
      state.deviceNotificationInitialSnapshot = true;
      updateAuthUI();
      renderCurrentPage();
      added.forEach(showDeviceNotification);
    }, err => toast(friendlyError(err), 'error'));
}

function subscribeConversations(user) {
  if (state.conversationUnsub) { try { state.conversationUnsub(); } catch (_) {} }
  if (state.conversationReadUnsub) { try { state.conversationReadUnsub(); } catch (_) {} }
  if (state.messageUnsub) { try { state.messageUnsub(); } catch (_) {} }
  state.conversationUnsub = null;
  state.conversationReadUnsub = null;
  state.messageUnsub = null;
  state.messageUnsubFor = null;
  state.conversations = [];
  state.conversationReads = [];
  state.activeMessages = [];
  state.messageImageDrafts = {};

  if (!user) {
    updateAuthUI();
    renderCurrentPage();
    return;
  }

  state.conversationUnsub = state.db.collection('conversations')
    .where('member_uids', 'array-contains', user.uid)
    .onSnapshot(snapshot => {
      state.conversations = replaceSnapshot('conversations', snapshot);
      updateAuthUI();
      renderCurrentPage();
    }, err => toast(friendlyError(err), 'error'));

  state.conversationReadUnsub = state.db.collection('conversation_reads')
    .where('user_uid', '==', user.uid)
    .onSnapshot(snapshot => {
      state.conversationReads = replaceSnapshot('conversation_reads', snapshot);
      updateAuthUI();
      renderCurrentPage();
    }, err => toast(friendlyError(err), 'error'));
}

function startRealtime() {
  state.unsubs.forEach(fn => { try { fn(); } catch (_) {} });
  state.unsubs = [];

  const refresh = () => {
    updateAuthUI();
    renderCurrentPage();
  };

  state.unsubs.push(state.db.collection('profiles').onSnapshot(s => {
    state.profiles = replaceSnapshot('profiles', s);
    refresh();
  }, err => toast(friendlyError(err), 'error')));

  state.unsubs.push(state.db.collection('posts').orderBy('created_at', 'desc').limit(100).onSnapshot(s => {
    state.posts = replaceSnapshot('posts', s);
    refresh();
  }, err => toast(friendlyError(err), 'error')));

  state.unsubs.push(state.db.collection('likes').onSnapshot(s => {
    state.likes = replaceSnapshot('likes', s);
    refresh();
  }, err => toast(friendlyError(err), 'error')));

  state.unsubs.push(state.db.collection('follows').onSnapshot(s => {
    state.follows = replaceSnapshot('follows', s);
    refresh();
  }, err => toast(friendlyError(err), 'error')));

  state.unsubs.push(state.db.collection('comments').orderBy('created_at', 'asc').onSnapshot(s => {
    state.comments = replaceSnapshot('comments', s);
    refresh();
  }, err => toast(friendlyError(err), 'error')));
}

async function bootFirebase() {
  state.configured = configReady();
  if (!state.configured) {
    renderCurrentPage();
    return;
  }
  firebase.initializeApp(window.SW_FIREBASE_CONFIG);
  state.auth = firebase.auth();
  state.db = firebase.firestore();
  startRealtime();
  state.auth.onAuthStateChanged(user => {
    state.user = user;
    prepareDeviceNotifications(user);
    subscribeNotifications(user);
    subscribeConversations(user);
    subscribeCalls(user);
    updateAuthUI();
    renderCurrentPage();
  });
}

(async function init() {
  localStorage.removeItem('sw_local_posts');
  localStorage.removeItem('sw_likes');
  injectAuthDialog();
  injectCallUI();
  setupComposer();
  setupCommentComposer();
  setupEditPost();
  setupGlobalActions();
  try {
    await bootFirebase();
  } catch (err) {
    console.error(err);
    toast(`Firebase connection failed: ${friendlyError(err)}`, 'error');
    const target = document.querySelector('#feed, #profileFeed, #singlePost');
    if (target) target.innerHTML = '<div class="empty">Firebase connection failed 😭</div>';
  }
})();
