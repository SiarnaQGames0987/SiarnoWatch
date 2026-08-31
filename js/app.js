const state = {
  client: null,
  configured: false,
  session: null,
  me: null,
  profiles: [],
  posts: [],
  likes: [],
  follows: [],
  refreshTimer: null
};

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}

function configReady() {
  const cfg = window.SW_CONFIG || {};
  return /^https:\/\/.+\.supabase\.co\/?$/.test(cfg.supabaseUrl || '') &&
    typeof cfg.supabaseAnonKey === 'string' &&
    cfg.supabaseAnonKey.length > 30 &&
    !cfg.supabaseAnonKey.includes('PASTE_');
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
  el._timer = setTimeout(() => el.className = 'toast', 2600);
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

function profileById(id) {
  return state.profiles.find(p => p.id === id) || null;
}

function profileByUsername(username) {
  return state.profiles.find(p => p.username.toLowerCase() === String(username || '').toLowerCase()) || null;
}

function fallbackProfile(id = '') {
  return { id, username: 'unknown', display_name: 'Unknown', bio: '', avatar_text: '?' };
}

function postLikeCount(postId) {
  return state.likes.filter(l => l.post_id === postId).length;
}

function didILike(postId) {
  return !!state.me && state.likes.some(l => l.post_id === postId && l.user_id === state.me.id);
}

function followCounts(profileId) {
  return {
    followers: state.follows.filter(f => f.following_id === profileId).length,
    following: state.follows.filter(f => f.follower_id === profileId).length
  };
}

function amIFollowing(profileId) {
  return !!state.me && state.follows.some(f => f.follower_id === state.me.id && f.following_id === profileId);
}

function postHTML(post) {
  const u = profileById(post.author_id) || fallbackProfile(post.author_id);
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
          <button class="post-action" data-open-post="${esc(post.id)}">💬 0</button>
          <button class="post-action ${liked ? 'liked' : ''}" data-like="${esc(post.id)}">♥ ${postLikeCount(post.id)}</button>
          <button class="post-action" data-share="${esc(post.id)}">↗ Share</button>
        </div>
      </div>
    </article>`;
}

function renderFeed(posts, target) {
  if (!target) return;
  if (!state.configured) {
    target.innerHTML = `<div class="empty setup-empty"><strong>Database not connected yet.</strong><br>Connect Supabase once and SiarnoWatch becomes a shared social network. 😭🔥</div>`;
    return;
  }
  target.innerHTML = posts.length
    ? posts.map(postHTML).join('')
    : '<div class="empty">No posts yet. You can make the first real one. 😭</div>';
  bindPostActions(target);
}

async function loadData({ quiet = false } = {}) {
  if (!state.client) return;
  const [{ data: profiles, error: pErr }, { data: posts, error: postErr }, { data: likes, error: lErr }, { data: follows, error: fErr }] = await Promise.all([
    state.client.from('profiles').select('id,username,display_name,bio,avatar_text,created_at').order('created_at', { ascending: true }),
    state.client.from('posts').select('id,author_id,content,created_at').order('created_at', { ascending: false }).limit(100),
    state.client.from('likes').select('user_id,post_id'),
    state.client.from('follows').select('follower_id,following_id')
  ]);

  const err = pErr || postErr || lErr || fErr;
  if (err) {
    console.error(err);
    if (!quiet) toast(`Database error: ${err.message}`, 'error');
    throw err;
  }

  state.profiles = profiles || [];
  state.posts = posts || [];
  state.likes = likes || [];
  state.follows = follows || [];
  state.me = state.session?.user ? profileById(state.session.user.id) : null;
  updateAuthUI();
}

function renderHome() {
  renderFeed(state.posts, document.querySelector('#feed'));
}

function renderProfile() {
  const target = document.querySelector('#profileFeed');
  if (!state.configured) {
    renderFeed([], target);
    return;
  }

  const params = new URLSearchParams(location.search);
  const wanted = params.get('u');
  const u = wanted ? profileByUsername(wanted) : state.me;
  if (!u) {
    document.querySelector('#profileTitle').textContent = 'Profile';
    document.querySelector('#profileCount').textContent = '0 posts';
    target.innerHTML = '<div class="empty">Profile not found 😭</div>';
    return;
  }

  const posts = state.posts.filter(p => p.author_id === u.id);
  const counts = followCounts(u.id);
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
  if (state.me?.id === u.id) {
    followButton.textContent = 'Edit profile';
    followButton.dataset.mode = 'edit';
  } else {
    followButton.textContent = amIFollowing(u.id) ? 'Following' : 'Follow';
    followButton.dataset.mode = 'follow';
  }
  followButton.onclick = async () => {
    if (!state.me) return openAuthDialog();
    if (state.me.id === u.id) return openEditProfileDialog(u);
    await toggleFollow(u.id);
  };
}

function renderSinglePost() {
  const id = new URLSearchParams(location.search).get('id');
  const post = state.posts.find(p => p.id === id);
  const target = document.querySelector('#singlePost');
  if (!state.configured) return renderFeed([], target);
  if (!post) {
    target.innerHTML = '<div class="empty">Post not found 😭</div>';
    return;
  }
  renderFeed([post], target);
}

function renderCurrentPage() {
  const page = document.body.dataset.page;
  if (page === 'home') renderHome();
  if (page === 'profile') renderProfile();
  if (page === 'post') renderSinglePost();
}

async function toggleLike(postId) {
  if (!state.me) return openAuthDialog();
  const existing = state.likes.find(l => l.post_id === postId && l.user_id === state.me.id);
  let error;
  if (existing) {
    ({ error } = await state.client.from('likes').delete().eq('user_id', state.me.id).eq('post_id', postId));
  } else {
    ({ error } = await state.client.from('likes').insert({ user_id: state.me.id, post_id: postId }));
  }
  if (error) return toast(error.message, 'error');
  await loadData({ quiet: true });
  renderCurrentPage();
}

async function toggleFollow(profileId) {
  const existing = state.follows.find(f => f.follower_id === state.me.id && f.following_id === profileId);
  let error;
  if (existing) {
    ({ error } = await state.client.from('follows').delete().eq('follower_id', state.me.id).eq('following_id', profileId));
  } else {
    ({ error } = await state.client.from('follows').insert({ follower_id: state.me.id, following_id: profileId }));
  }
  if (error) return toast(error.message, 'error');
  await loadData({ quiet: true });
  renderProfile();
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
    } catch {
      window.prompt('Copy this link:', url);
    }
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
    if (!state.configured) return toast('Connect Supabase first.', 'error');
    if (!state.me) return openAuthDialog();
    dialog.showModal();
    text.focus();
  }));

  text.addEventListener('input', () => count.textContent = `${text.value.length} / 280`);
  form.addEventListener('submit', async e => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const content = text.value.trim();
    if (!content || !state.me) return;
    publish.disabled = true;
    publish.textContent = 'Posting…';
    const { error } = await state.client.from('posts').insert({ author_id: state.me.id, content });
    publish.disabled = false;
    publish.textContent = 'Post';
    if (error) return toast(error.message, 'error');
    text.value = '';
    count.textContent = '0 / 280';
    dialog.close();
    await loadData({ quiet: true });
    renderHome();
    toast('Posted to the real feed. 🔥');
  });
}

function injectAuthDialog() {
  if (document.querySelector('#authDialog')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="authDialog" class="dialog">
      <div class="dialog-card auth-card">
        <div class="dialog-head"><strong id="authTitle">SiarnoWatch account</strong><button class="icon-button" id="authClose">×</button></div>
        <div id="accountPanel" class="account-panel hidden"></div>
        <form id="authForm">
          <div class="auth-grid">
            <label><span>Email</span><input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com"></label>
            <label><span>Password</span><input id="authPassword" type="password" autocomplete="current-password" minlength="6" required placeholder="••••••••"></label>
            <label class="signup-only"><span>Username</span><input id="authUsername" maxlength="20" placeholder="SiarnaQ" pattern="[A-Za-z0-9_]{3,20}"></label>
            <label class="signup-only"><span>Display name</span><input id="authDisplayName" maxlength="40" placeholder="SiarnaQ"></label>
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
    let result;
    if (signupMode) {
      const uname = username.value.trim();
      const dname = displayName.value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(uname)) {
        status.textContent = 'Username: 3–20 letters, numbers or _';
        submit.disabled = false;
        return;
      }
      result = await state.client.auth.signUp({
        email,
        password,
        options: { data: { username: uname, display_name: dname } }
      });
    } else {
      result = await state.client.auth.signInWithPassword({ email, password });
    }
    submit.disabled = false;
    if (result.error) {
      status.textContent = result.error.message;
      return;
    }
    if (signupMode && !result.data.session) {
      status.textContent = 'Account created. Check your email to confirm it.';
      return;
    }
    document.querySelector('#authDialog').close();
    toast(signupMode ? 'Welcome to SiarnoWatch! 🔥' : 'Logged in.');
  });

  document.querySelector('#editProfileForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!state.me) return;
    const payload = {
      display_name: document.querySelector('#editDisplayName').value.trim(),
      bio: document.querySelector('#editBio').value.trim(),
      avatar_text: document.querySelector('#editAvatar').value.trim().slice(0, 3).toUpperCase() || state.me.avatar_text
    };
    const { error } = await state.client.from('profiles').update(payload).eq('id', state.me.id);
    if (error) return toast(error.message, 'error');
    document.querySelector('#editProfileDialog').close();
    await loadData({ quiet: true });
    renderCurrentPage();
    toast('Profile updated.');
  });
}

function openAuthDialog() {
  if (!state.configured) return toast('Connect Supabase first.', 'error');
  const dialog = document.querySelector('#authDialog');
  const form = document.querySelector('#authForm');
  const panel = document.querySelector('#accountPanel');
  if (state.me) {
    form.classList.add('hidden');
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <div class="account-who"><div class="avatar">${esc(state.me.avatar_text || '?')}</div><div><strong>${esc(state.me.display_name)}</strong><div class="muted">@${esc(state.me.username)}</div></div></div>
      <div class="account-buttons"><a class="secondary account-link" href="profile.html?u=${encodeURIComponent(state.me.username)}">View profile</a><button class="secondary" id="signOutButton">Sign out</button></div>`;
    document.querySelector('#authTitle').textContent = 'Your account';
    document.querySelector('#signOutButton').onclick = async () => {
      await state.client.auth.signOut();
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

function updateAuthUI() {
  document.querySelectorAll('[data-auth-button]').forEach(btn => {
    btn.textContent = state.me ? `@${state.me.username}` : 'Log in';
  });
  document.querySelectorAll('[data-profile-link]').forEach(link => {
    link.href = state.me ? `profile.html?u=${encodeURIComponent(state.me.username)}` : 'profile.html';
  });
  document.querySelectorAll('.avatar-current').forEach(el => {
    el.textContent = state.me?.avatar_text || '?';
  });
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

async function bootSupabase() {
  state.configured = configReady();
  if (!state.configured) {
    updateAuthUI();
    renderCurrentPage();
    return;
  }
  state.client = window.supabase.createClient(window.SW_CONFIG.supabaseUrl, window.SW_CONFIG.supabaseAnonKey);
  const { data } = await state.client.auth.getSession();
  state.session = data.session;
  await loadData();
  renderCurrentPage();

  state.client.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    await loadData({ quiet: true });
    renderCurrentPage();
  });

  state.refreshTimer = setInterval(async () => {
    try {
      await loadData({ quiet: true });
      renderCurrentPage();
    } catch (_) {}
  }, 30000);
}

(async function init() {
  // Old prototype local-only data should never leak into the real shared feed.
  localStorage.removeItem('sw_local_posts');
  localStorage.removeItem('sw_likes');

  injectAuthDialog();
  setupComposer();
  setupGlobalActions();
  try {
    await bootSupabase();
  } catch (err) {
    console.error(err);
    toast('SiarnoWatch could not connect to its database.', 'error');
    const target = document.querySelector('#feed, #profileFeed, #singlePost');
    if (target) target.innerHTML = '<div class="empty">Database connection failed 😭</div>';
  }
})();
