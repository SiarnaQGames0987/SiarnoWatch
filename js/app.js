const state = { users: [], posts: [] };

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
}

function getLocalPosts() {
  try { return JSON.parse(localStorage.getItem('sw_local_posts') || '[]'); }
  catch { return []; }
}

function getLikedIds() {
  try { return new Set(JSON.parse(localStorage.getItem('sw_likes') || '[]')); }
  catch { return new Set(); }
}

function saveLikedIds(set) { localStorage.setItem('sw_likes', JSON.stringify([...set])); }

async function loadData() {
  const [usersRes, postsRes] = await Promise.all([
    fetch('data/users.json'),
    fetch('data/posts.json')
  ]);
  state.users = await usersRes.json();
  const basePosts = await postsRes.json();
  state.posts = [...getLocalPosts(), ...basePosts];
}

function userFor(username) {
  return state.users.find(u => u.username.toLowerCase() === String(username).toLowerCase()) || {
    username, displayName: username, bio: '', avatarText: String(username).slice(0,2).toUpperCase(), followers: 0, following: 0
  };
}

function relativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function postHTML(post) {
  const u = userFor(post.author);
  const liked = getLikedIds().has(post.id);
  const likes = Number(post.likes || 0) + (liked ? 1 : 0);
  return `
    <article class="post" data-id="${esc(post.id)}">
      <a href="profile.html?u=${encodeURIComponent(u.username)}" class="avatar">${esc(u.avatarText)}</a>
      <div class="post-main">
        <div class="post-head">
          <a class="post-name" href="profile.html?u=${encodeURIComponent(u.username)}">${esc(u.displayName)}</a>
          <span class="post-handle">@${esc(u.username)}</span>
          <span class="post-time">· ${relativeTime(post.timestamp)}</span>
        </div>
        <div class="post-content">${esc(post.content)}</div>
        <div class="post-actions">
          <button class="post-action" data-open-post="${esc(post.id)}">💬 ${Number(post.comments || 0)}</button>
          <button class="post-action ${liked ? 'liked' : ''}" data-like="${esc(post.id)}">♥ ${likes}</button>
          <button class="post-action" data-share="${esc(post.id)}">↗ Share</button>
        </div>
      </div>
    </article>`;
}

function bindPostActions(root = document) {
  root.querySelectorAll('[data-like]').forEach(btn => btn.addEventListener('click', () => {
    const likes = getLikedIds();
    const id = btn.dataset.like;
    likes.has(id) ? likes.delete(id) : likes.add(id);
    saveLikedIds(likes);
    renderCurrentPage();
  }));

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

function renderFeed(posts, target) {
  target.innerHTML = posts.length ? posts.map(postHTML).join('') : '<div class="empty">No posts yet. Very mini. 😭</div>';
  bindPostActions(target);
}

function renderHome() {
  renderFeed(state.posts, document.querySelector('#feed'));
}

function renderProfile() {
  const params = new URLSearchParams(location.search);
  const username = params.get('u') || 'SiarnaQ';
  const u = userFor(username);
  const posts = state.posts.filter(p => p.author.toLowerCase() === u.username.toLowerCase());
  document.title = `${u.displayName} (@${u.username}) · SiarnoWatch`;
  document.querySelector('#profileTitle').textContent = u.displayName;
  document.querySelector('#profileCount').textContent = `${posts.length} posts`;
  document.querySelector('#profileAvatar').textContent = u.avatarText;
  document.querySelector('#profileName').textContent = u.displayName;
  document.querySelector('#profileHandle').textContent = `@${u.username}`;
  document.querySelector('#profileBio').textContent = u.bio;
  document.querySelector('#followingCount').textContent = u.following;
  document.querySelector('#followerCount').textContent = u.followers;
  renderFeed(posts, document.querySelector('#profileFeed'));

  const followButton = document.querySelector('#followButton');
  const key = `sw_follow_${u.username}`;
  const refresh = () => { followButton.textContent = localStorage.getItem(key) === '1' ? 'Following' : 'Follow'; };
  refresh();
  followButton.addEventListener('click', () => { localStorage.setItem(key, localStorage.getItem(key) === '1' ? '0' : '1'); refresh(); });
}

function renderSinglePost() {
  const id = new URLSearchParams(location.search).get('id');
  const post = state.posts.find(p => p.id === id);
  const target = document.querySelector('#singlePost');
  if (!post) { target.innerHTML = '<div class="empty">Post not found 😭</div>'; return; }
  renderFeed([post], target);
}

function renderCurrentPage() {
  const page = document.body.dataset.page;
  if (page === 'home') renderHome();
  if (page === 'profile') renderProfile();
  if (page === 'post') renderSinglePost();
}

function setupComposer() {
  const dialog = document.querySelector('#composerDialog');
  if (!dialog) return;
  const form = document.querySelector('#composerForm');
  const text = document.querySelector('#postText');
  const count = document.querySelector('#charCount');

  document.querySelectorAll('.compose-open').forEach(btn => btn.addEventListener('click', () => { dialog.showModal(); text.focus(); }));
  text.addEventListener('input', () => count.textContent = `${text.value.length} / 280`);
  form.addEventListener('submit', e => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const content = text.value.trim();
    if (!content) return;
    const post = {
      id: `local_${Date.now()}`,
      author: 'SiarnaQ',
      content,
      timestamp: new Date().toISOString(),
      likes: 0,
      comments: 0
    };
    const local = getLocalPosts();
    local.unshift(post);
    localStorage.setItem('sw_local_posts', JSON.stringify(local));
    state.posts.unshift(post);
    text.value = '';
    count.textContent = '0 / 280';
    dialog.close();
    renderHome();
  });
}

function setupSimpleDialogs() {
  const dialog = document.querySelector('#simpleDialog');
  if (!dialog) return;
  const title = document.querySelector('#simpleDialogTitle');
  const body = document.querySelector('#simpleDialogBody');
  const open = (t, html) => { title.textContent = t; body.innerHTML = html; dialog.showModal(); };
  document.querySelector('#simpleDialogClose').addEventListener('click', () => dialog.close());
  document.querySelector('#searchButton')?.addEventListener('click', () => open('Search', 'Search is coming in the next Mini build. 🔎'));
  document.querySelector('#notificationsButton')?.addEventListener('click', () => open('Notifications', 'No new chaos. Yet. 😭'));
}

(async function init() {
  try {
    await loadData();
    renderCurrentPage();
    setupComposer();
    setupSimpleDialogs();
  } catch (err) {
    console.error(err);
    const feed = document.querySelector('#feed, #profileFeed, #singlePost');
    if (feed) feed.innerHTML = '<div class="empty">Could not load SiarnoWatch data.</div>';
  }
})();
