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
  unsubs: []
};

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

function postHTML(post) {
  const u = profileById(post.author_uid) || fallbackProfile(post.author_uid);
  const liked = didILike(post.id);
  return `
    <article class="post" data-id="${esc(post.id)}">
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="avatar">${esc(u.avatar_text || '?')}</a>
      <div class="post-main">
        <div class="post-head">
          <a class="post-name" href="profile.html?u=${encodeURIComponent(u.username)}">${esc(u.display_name || u.username)}</a>
          <span class="post-handle">@${esc(u.username)}</span>
          <span class="post-time">· ${relativeTime(post.created_at)}</span>
        </div>
        <div class="post-content">${esc(post.content)}</div>
        <div class="post-actions">
          <button class="post-action" data-open-post="${esc(post.id)}">💬 ${postCommentCount(post.id)}</button>
          <button class="post-action ${liked ? 'liked' : ''}" data-like="${esc(post.id)}">♥ ${postLikeCount(post.id)}</button>
          <button class="post-action" data-share="${esc(post.id)}">↗ Share</button>
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
  document.querySelector('#profileCount').textContent = `${posts.length} posts`;
  document.querySelector('#profileAvatar').textContent = u.avatar_text || '?';
  document.querySelector('#profileName').textContent = u.display_name;
  document.querySelector('#profileHandle').textContent = `@${u.username}`;
  document.querySelector('#profileBio').textContent = u.bio || '';
  document.querySelector('#followingCount').textContent = counts.following;
  document.querySelector('#followerCount').textContent = counts.followers;
  renderFeed(posts, target);

  const followButton = document.querySelector('#followButton');
  if (!followButton) return;
  if (state.user?.uid === u.uid) {
    followButton.textContent = 'Edit profile';
    followButton.onclick = () => openEditProfileDialog(u);
  } else {
    followButton.textContent = amIFollowing(u.uid) ? 'Following' : 'Follow';
    followButton.onclick = () => toggleFollow(u.uid);
  }
}

function commentHTML(comment) {
  const u = profileById(comment.author_uid) || fallbackProfile(comment.author_uid);
  const mine = state.user?.uid === comment.author_uid;
  return `
    <article class="comment" data-comment-id="${esc(comment.id)}">
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="avatar comment-avatar">${esc(u.avatar_text || '?')}</a>
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
        await state.db.collection('comments').doc(btn.dataset.deleteComment).delete();
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
    el.textContent = state.me?.avatar_text || '?';
  });
}

async function toggleLike(postId) {
  if (!state.user) return openAuthDialog();
  const id = `${state.user.uid}_${postId}`;
  const ref = state.db.collection('likes').doc(id);
  try {
    if (didILike(postId)) await ref.delete();
    else await ref.set({ user_uid: state.user.uid, post_id: postId, created_at: firebase.firestore.FieldValue.serverTimestamp() });
  } catch (err) { toast(friendlyError(err), 'error'); }
}

async function toggleFollow(uid) {
  if (!state.user) return openAuthDialog();
  if (uid === state.user.uid) return;
  const id = `${state.user.uid}_${uid}`;
  const ref = state.db.collection('follows').doc(id);
  try {
    if (amIFollowing(uid)) await ref.delete();
    else await ref.set({ follower_uid: state.user.uid, following_uid: uid, created_at: firebase.firestore.FieldValue.serverTimestamp() });
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
      await state.db.collection('comments').add({
        post_id: postId,
        author_uid: state.user.uid,
        content,
        created_at: firebase.firestore.FieldValue.serverTimestamp()
      });
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
          <label><span>Avatar letters</span><input id="editAvatar" maxlength="3"></label>
        </div>
        <div class="dialog-actions"><span class="muted">Username stays fixed for now.</span><button class="primary" type="submit">Save</button></div>
      </form>
    </dialog>`);

  document.querySelector('#authClose').onclick = () => document.querySelector('#authDialog').close();
  document.querySelector('#editProfileClose').onclick = () => document.querySelector('#editProfileDialog').close();

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
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      });
      document.querySelector('#editProfileDialog').close();
      toast('Profile updated.');
    } catch (err) { toast(friendlyError(err), 'error'); }
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
      <div class="account-who"><div class="avatar">${esc(p.avatar_text || '?')}</div><div><strong>${esc(p.display_name || 'Account')}</strong><div class="muted">${p.username ? '@'+esc(p.username) : esc(state.user.email || '')}</div></div></div>
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
  document.querySelector('#notificationsButton')?.addEventListener('click', () => toast('Notifications are next. 😭'));
}

function replaceSnapshot(target, snapshot) {
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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
    updateAuthUI();
    renderCurrentPage();
  });
}

(async function init() {
  localStorage.removeItem('sw_local_posts');
  localStorage.removeItem('sw_likes');
  injectAuthDialog();
  setupComposer();
  setupCommentComposer();
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
