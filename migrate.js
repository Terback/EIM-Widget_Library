/**
 * One-time migration: push existing widgets + categories from local
 * data/ + widgets/ folders up to Appwrite.
 *
 * Setup:
 *   1. npm install node-appwrite
 *   2. Get a server API key:
 *      Appwrite Console → your project → Overview → Integrations → API Keys
 *      → Create API Key → scopes: documents.read, documents.write,
 *      files.read, files.write
 *   3. Fill in PROJECT_ID and API_KEY below
 *   4. node migrate.js
 *
 * Safe to re-run: skips items that already exist (by filename / category name).
 */

const { Client, Databases, Storage, ID, Query } = require('node-appwrite');
const { InputFile } = require('node-appwrite/file');
const fs   = require('fs');
const path = require('path');

const CONFIG = {
    endpoint:          'https://appwrite-ihub.eimtechnology.com/v1',
    projectId:         'REPLACE_WITH_PROJECT_ID',
    apiKey:            'REPLACE_WITH_API_KEY',
    databaseId:        'main',
    widgetsTableId:    'widgets',
    categoriesTableId: 'categories',
    widgetsBucketId:   'widgets',
};

const client = new Client()
    .setEndpoint(CONFIG.endpoint)
    .setProject(CONFIG.projectId)
    .setKey(CONFIG.apiKey);

const databases = new Databases(client);
const storage   = new Storage(client);

async function main() {
    console.log('→ Migrating categories…');
    const cats = JSON.parse(fs.readFileSync('data/categories.json', 'utf8'));
    // Pull existing so we can dedupe
    const existingCats = await databases.listDocuments(CONFIG.databaseId, CONFIG.categoriesTableId, [Query.limit(100)]);
    const haveCat = new Set(existingCats.documents.map(d => d.name.toLowerCase()));
    for (const name of cats) {
        if (haveCat.has(name.toLowerCase())) { console.log('  skip (exists):', name); continue; }
        await databases.createDocument(CONFIG.databaseId, CONFIG.categoriesTableId, ID.unique(), { name });
        console.log('  added:', name);
    }

    console.log('\n→ Migrating widgets…');
    const widgets = JSON.parse(fs.readFileSync('data/widgets.json', 'utf8'));
    const existingWidgets = await databases.listDocuments(CONFIG.databaseId, CONFIG.widgetsTableId, [Query.limit(500)]);
    const haveWidget = new Set(existingWidgets.documents.map(d => d.filename));

    for (const w of widgets) {
        if (haveWidget.has(w.filename)) { console.log('  skip (exists):', w.filename); continue; }
        const filePath = path.join('widgets', w.filename);
        if (!fs.existsSync(filePath)) { console.warn('  missing file:', filePath); continue; }
        try {
            const uploaded = await storage.createFile(
                CONFIG.widgetsBucketId,
                ID.unique(),
                InputFile.fromPath(filePath, w.filename)
            );
            await databases.createDocument(CONFIG.databaseId, CONFIG.widgetsTableId, ID.unique(), {
                title:       w.title,
                description: w.description || '',
                category:    w.category || 'Uncategorized',
                filename:    w.filename,
                fileId:      uploaded.$id,
                addedAt:     w.addedAt || new Date().toISOString().split('T')[0],
            });
            console.log('  uploaded:', w.title);
        } catch (e) {
            console.error('  failed:', w.title, '—', e.message);
        }
    }

    console.log('\n✓ Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
