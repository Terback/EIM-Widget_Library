// ── Appwrite client ───────────────────────────────────────
const C = window.APPWRITE_CONFIG;
const aw = new Appwrite.Client().setEndpoint(C.endpoint).setProject(C.projectId);
const account   = new Appwrite.Account(aw);
const databases = new Appwrite.Databases(aw);
const storage   = new Appwrite.Storage(aw);
const { ID, Query } = Appwrite;

// State
let role = 'visitor';
let widgets = [];
let categories = [];
let deleteTarget = null;

// DOM refs
const $ = id => document.getElementById(id);
const loginBtn   = $('loginBtn');
const logoutBtn  = $('logoutBtn');
const uploadBtn  = $('uploadBtn');
const roleTag    = $('roleTag');
const search     = $('search');
const catFilter  = $('categoryFilter');
const grid       = $('widgetGrid');
const emptyState = $('emptyState');
const heroCount  = $('heroCount');

// ── Category helpers ──────────────────────────────────────
const FIXED_CAT_CLASSES = { dc:'dc', ac:'ac', mcu:'mcu', uncategorized:'uncategorized' };
const FALLBACK_PALETTE_SIZE = 6;

function catClass(cat) {
    if (!cat) return 'uncategorized';
    const k = cat.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (FIXED_CAT_CLASSES[k]) return FIXED_CAT_CLASSES[k];
    let h = 0;
    for (const ch of cat) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
    return 'c' + (Math.abs(h) % FALLBACK_PALETTE_SIZE);
}

function buildCatSelect(selectEl, newInputEl, currentValue) {
    const opts = [...categories];
    if (currentValue && !opts.includes(currentValue)) opts.unshift(currentValue);
    selectEl.innerHTML = opts.map(c =>
        `<option value="${esc(c)}"${c === currentValue ? ' selected' : ''}>${esc(c)}</option>`
    ).join('') + '<option value="__new__">+ Add new category…</option>';
    newInputEl.value = '';

    const syncInput = () => {
        if (selectEl.value === '__new__') {
            newInputEl.classList.remove('hidden');
        } else {
            newInputEl.classList.add('hidden');
            newInputEl.value = '';
        }
    };

    selectEl.onchange = syncInput;
    syncInput();   // Run once so the input shows immediately if __new__ is the default
}

function readCatValue(selectEl, newInputEl) {
    if (selectEl.value === '__new__') return newInputEl.value.trim();
    return selectEl.value;
}

// Strip `.html` and a leading "m2.1 " / "m12.34 " style chapter prefix.
// "m2.1 Energy Transformation.html" → "Energy Transformation"
function inferTitle(filename) {
    return filename
        .replace(/\.html?$/i, '')
        .replace(/^m\d+(?:\.\d+)*\s+/i, '')
        .trim();
}

// ── Render ────────────────────────────────────────────────
function renderGrid() {
    const q   = search.value.toLowerCase().trim();
    const cat = catFilter.value;

    const filtered = widgets.filter(w => {
        const matchQ   = !q || w.title.toLowerCase().includes(q) || (w.description||'').toLowerCase().includes(q);
        const matchCat = !cat || w.category === cat;
        return matchQ && matchCat;
    });

    grid.innerHTML = '';
    emptyState.classList.toggle('hidden', filtered.length > 0);

    filtered.forEach(w => {
        const cc = catClass(w.category);
        const card = document.createElement('div');
        card.className = 'widget-card';
        card.innerHTML = `
            <div class="card-stripe stripe-${cc}"></div>
            <div class="card-preview" data-id="${w.id}" data-fileid="${esc(w.fileId)}">
                <iframe class="preview-frame" sandbox="allow-scripts"></iframe>
                <div class="preview-placeholder">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M3 9h18M9 3v18"/>
                    </svg>
                    <span>Hover to preview</span>
                </div>
            </div>
            <div class="card-body">
                <div class="card-title">${esc(w.title)}</div>
                <div class="card-desc">${esc(w.description || 'Click to open this interactive widget.')}</div>
                <div class="card-meta">
                    <span class="category-badge cat-${cc}">${esc(w.category)}</span>
                    <span class="card-date">${w.addedAt || ''}</span>
                </div>
            </div>
            <div class="card-footer">
                <button class="btn btn-primary btn-sm open-btn" data-id="${w.id}">Open Widget</button>
                ${role === 'admin' ? `
                <div class="admin-actions">
                    <button class="btn-icon edit-btn" title="Edit" data-id="${w.id}">✎</button>
                    <button class="btn-icon danger delete-btn" title="Delete" data-id="${w.id}">🗑</button>
                </div>` : ''}
            </div>`;
        grid.appendChild(card);
    });

    grid.querySelectorAll('.open-btn').forEach(btn =>
        btn.addEventListener('click', () => openViewer(btn.dataset.id)));
    grid.querySelectorAll('.card-preview').forEach(el =>
        el.addEventListener('click', () => openViewer(el.dataset.id)));
    grid.querySelectorAll('.edit-btn').forEach(btn =>
        btn.addEventListener('click', () => openEdit(btn.dataset.id)));
    grid.querySelectorAll('.delete-btn').forEach(btn =>
        btn.addEventListener('click', () => openDelete(btn.dataset.id)));

    setupPreviews();
}

// ── Live widget previews (loaded on hover) ────────────────
const _previewCache = new Map();   // fileId -> html string
const HOVER_DELAY_MS = 250;        // grace period to avoid loading on accidental hover

function setupPreviews() {
    grid.querySelectorAll('.widget-card').forEach(card => {
        const wrap = card.querySelector('.card-preview');
        if (!wrap) return;
        scalePreview(wrap);

        let timer = null;
        card.addEventListener('mouseenter', () => {
            // Re-scale because the card just grew (scale(1.06) bumps width)
            requestAnimationFrame(() => scalePreview(wrap));
            if (wrap.dataset.loaded) return;
            timer = setTimeout(() => loadPreview(wrap), HOVER_DELAY_MS);
        });
        card.addEventListener('mouseleave', () => {
            clearTimeout(timer);
            requestAnimationFrame(() => scalePreview(wrap));
        });
    });
}

async function loadPreview(wrap) {
    if (wrap.dataset.loaded) return;
    wrap.dataset.loaded = '1';

    const fileId = wrap.dataset.fileid;
    const iframe = wrap.querySelector('.preview-frame');
    const ph     = wrap.querySelector('.preview-placeholder');
    try {
        let html = _previewCache.get(fileId);
        if (!html) {
            const res = await fetch(fileUrl(fileId));
            html = await res.text();
            _previewCache.set(fileId, html);
        }
        iframe.srcdoc = html;
        iframe.addEventListener('load', () => ph && ph.remove(), { once: true });
    } catch (err) {
        if (ph) ph.querySelector('span').textContent = 'Preview unavailable';
        console.warn('Preview load failed for', fileId, err);
    }
}

function scalePreview(wrap) {
    const iframe = wrap.querySelector('.preview-frame');
    if (!iframe) return;
    const scale = wrap.clientWidth / 1280;
    iframe.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', () => {
    document.querySelectorAll('.card-preview').forEach(scalePreview);
});

function populateCategories() {
    const present = new Set(widgets.map(w => w.category).filter(Boolean));
    categories.forEach(c => present.add(c));
    const merged = [...present].sort((a, b) => a.localeCompare(b));
    catFilter.innerHTML = '<option value="">All Categories</option>' +
        merged.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

function updateHero() {
    heroCount.textContent = widgets.length === 1
        ? '1 widget available'
        : `${widgets.length} widgets available`;
}

// ── Data layer (Appwrite) ─────────────────────────────────
function rowToWidget(r) {
    return {
        id:          r.$id,
        title:       r.title,
        description: r.description || '',
        category:    r.category || 'Uncategorized',
        filename:    r.filename,
        fileId:      r.fileId,
        addedAt:     r.addedAt || ''
    };
}

function fileUrl(fileId) {
    return `${C.endpoint}/storage/buckets/${C.widgetsBucketId}/files/${fileId}/view?project=${C.projectId}`;
}

async function loadCategories() {
    try {
        const res = await databases.listDocuments(C.databaseId, C.categoriesTableId, [Query.limit(100)]);
        categories = res.documents.map(d => d.name).sort((a, b) => a.localeCompare(b));
    } catch (e) {
        console.error('Failed to load categories', e);
        categories = [];
    }
}

async function loadWidgets() {
    try {
        const [, wRes] = await Promise.all([
            loadCategories(),
            databases.listDocuments(C.databaseId, C.widgetsTableId, [Query.limit(200), Query.orderDesc('$createdAt')])
        ]);
        widgets = wRes.documents.map(rowToWidget);
    } catch (e) {
        console.error('Failed to load widgets', e);
        widgets = [];
    }
    populateCategories();
    updateHero();
    renderGrid();
}

async function ensureCategory(name) {
    if (!name) return;
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) return;
    try {
        await databases.createDocument(C.databaseId, C.categoriesTableId, ID.unique(), { name });
        categories.push(name);
    } catch (e) {
        console.warn('Category insert skipped:', e.message);
    }
}

// ── Session ───────────────────────────────────────────────
async function checkSession() {
    try {
        await account.get();
        applyRole('admin');
    } catch {
        applyRole('visitor');
    }
}

function applyRole(r) {
    role = r;
    loginBtn.classList.toggle('hidden', role === 'admin');
    logoutBtn.classList.toggle('hidden', role !== 'admin');
    uploadBtn.classList.toggle('hidden', role !== 'admin');
    roleTag.classList.toggle('hidden', role !== 'admin');
    if (role === 'admin') roleTag.textContent = 'Admin';
    renderGrid();
}

// ── Viewer ────────────────────────────────────────────────
async function openViewer(id) {
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    $('viewerTitle').textContent = w.title;
    const src = fileUrl(w.fileId);
    $('viewerNewTab').href = src;
    $('widgetFrame').removeAttribute('src');
    $('widgetFrame').srcdoc = '<p style="font-family:sans-serif;padding:20px;color:#888">Loading…</p>';
    $('viewerModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Appwrite Storage serves HTML as text/plain for safety, so the browser
    // won't render the iframe via `src=`. Workaround: fetch the bytes and inject
    // via `srcdoc` (which is always parsed as HTML, regardless of MIME).
    try {
        const res  = await fetch(src);
        const html = await res.text();
        $('widgetFrame').srcdoc = html;
    } catch (err) {
        console.error('Widget load failed', err);
        $('widgetFrame').srcdoc =
            '<p style="font-family:sans-serif;padding:20px;color:#c00">Failed to load widget.</p>';
    }
}

function closeViewer() {
    $('widgetFrame').removeAttribute('srcdoc');
    $('widgetFrame').src = 'about:blank';
    $('viewerModal').classList.add('hidden');
    document.body.style.overflow = '';
}

$('viewerClose').addEventListener('click', closeViewer);
$('viewerModal').addEventListener('click', e => {
    if (e.target === $('viewerModal')) closeViewer();
});

// ── Login ─────────────────────────────────────────────────
loginBtn.addEventListener('click', () => showModal('loginModal'));

$('loginSubmit').addEventListener('click', async () => {
    const pw = $('passwordInput').value;
    $('loginError').classList.add('hidden');
    try {
        // Some SDK versions expose createEmailPasswordSession, others createEmailSession.
        const fn = account.createEmailPasswordSession || account.createEmailSession;
        await fn.call(account, C.adminEmail, pw);
        hideModal('loginModal');
        $('passwordInput').value = '';
        applyRole('admin');
        await loadWidgets();
    } catch (e) {
        $('loginError').textContent = 'Incorrect password.';
        $('loginError').classList.remove('hidden');
    }
});

$('passwordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('loginSubmit').click();
});

logoutBtn.addEventListener('click', async () => {
    try { await account.deleteSession('current'); } catch {}
    applyRole('visitor');
    await loadWidgets();
});

// ── Upload ────────────────────────────────────────────────
uploadBtn.addEventListener('click', () => {
    $('uploadForm').reset();
    $('uploadError').classList.add('hidden');
    $('uploadSuccess').classList.add('hidden');
    buildCatSelect($('widgetCategory'), $('widgetCategoryNew'), categories[0] || '');
    showModal('uploadModal');
});

// Auto-fill Title when a file is picked, unless the user already typed something
$('widgetFile').addEventListener('change', () => {
    const f = $('widgetFile').files[0];
    if (!f) return;
    const titleInput = $('widgetTitle');
    if (!titleInput.value.trim()) titleInput.value = inferTitle(f.name);
});

$('uploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('uploadError').classList.add('hidden');
    $('uploadSuccess').classList.add('hidden');

    const file = $('widgetFile').files[0];
    if (!file) return;

    const title       = $('widgetTitle').value.trim() || inferTitle(file.name);
    const category    = readCatValue($('widgetCategory'), $('widgetCategoryNew')) || 'Uncategorized';
    const description = $('widgetDesc').value.trim();

    try {
        const created = await storage.createFile(C.widgetsBucketId, ID.unique(), file);
        await databases.createDocument(C.databaseId, C.widgetsTableId, ID.unique(), {
            title, description, category,
            filename: file.name,
            fileId:   created.$id,
            addedAt:  new Date().toISOString().split('T')[0]
        });
        await ensureCategory(category);
        $('uploadSuccess').classList.remove('hidden');
        await loadWidgets();
        setTimeout(() => hideModal('uploadModal'), 900);
    } catch (err) {
        console.error(err);
        $('uploadError').textContent = err.message || 'Upload failed.';
        $('uploadError').classList.remove('hidden');
    }
});

// ── Edit ──────────────────────────────────────────────────
function openEdit(id) {
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    $('editId').value    = w.id;
    $('editTitle').value = w.title;
    $('editDesc').value  = w.description || '';
    buildCatSelect($('editCategory'), $('editCategoryNew'), w.category);
    $('editError').classList.add('hidden');
    showModal('editModal');
}

$('editForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('editError').classList.add('hidden');
    const id          = $('editId').value;
    const title       = $('editTitle').value.trim();
    const category    = readCatValue($('editCategory'), $('editCategoryNew')) || 'Uncategorized';
    const description = $('editDesc').value.trim();
    try {
        await databases.updateDocument(C.databaseId, C.widgetsTableId, id, { title, category, description });
        await ensureCategory(category);
        hideModal('editModal');
        await loadWidgets();
    } catch (err) {
        $('editError').textContent = err.message || 'Save failed.';
        $('editError').classList.remove('hidden');
    }
});

// ── Delete ────────────────────────────────────────────────
function openDelete(id) {
    const w = widgets.find(x => x.id === id);
    if (!w) return;
    deleteTarget = id;
    $('deleteTitle').textContent = w.title;
    showModal('deleteModal');
}

$('deleteConfirm').addEventListener('click', async () => {
    if (!deleteTarget) return;
    const w = widgets.find(x => x.id === deleteTarget);
    try {
        await databases.deleteDocument(C.databaseId, C.widgetsTableId, deleteTarget);
        if (w && w.fileId) {
            await storage.deleteFile(C.widgetsBucketId, w.fileId).catch(() => {});
        }
        hideModal('deleteModal');
        deleteTarget = null;
        await loadWidgets();
    } catch (err) {
        console.error('Delete failed', err);
    }
});

// ── Modal helpers ─────────────────────────────────────────
function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => hideModal(btn.dataset.close));
});

['loginModal','uploadModal','editModal','deleteModal'].forEach(id => {
    $(id).addEventListener('click', e => {
        if (e.target === $(id)) hideModal(id);
    });
});

// ── Search / filter ───────────────────────────────────────
search.addEventListener('input', renderGrid);
catFilter.addEventListener('change', renderGrid);

// ── Util ──────────────────────────────────────────────────
function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────
checkSession().then(loadWidgets);
