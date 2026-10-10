// generate-feed.js — runs in GitHub Actions to produce feed.xml from Firebase
// Reads FIREBASE_API_KEY from environment (stored as GitHub Secret)

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');
const fs = require('fs');

// ── Firebase Config ──────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: "goat-kids-store.firebaseapp.com",
    projectId: "goat-kids-store",
    storageBucket: "goat-kids-store.firebasestorage.app"
};

const BRAND_NAME  = 'Goat Kids';
const CURRENCY    = 'USD';
const STORE_URL   = 'https://goat-kids-store.web.app/';   // live store (old github.io page is no longer updated)
const CONDITION   = 'new';
const MAIN_STORE  = 'GOAT-1979';
// Used only if the branch list can't be read, so branch stock is never silently left out.
const FALLBACK_BRANCHES = [
    { id: 'GOAT-GOAT-KIDS-271-0889', name: 'Goat Kids 271' },
    { id: 'GOAT-GOAT-KIDS-PH-6012', name: 'Goat Kids PH' }
];

// Deleted products keep a record (active:false) — they must never count as stock.
function isDeleted(d) {
    d = d || {};
    return d.active === false || (!!d.deletedAt && !String(d.name || '').trim());
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function escXML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Live-selling code shown in front of the title, e.g. "[1258] Cutie Dresses_107 - Size 120".
// Codes come from the Live Desk tool (collection live_codes, one doc per product id).
function withCode(code, title) {
    return code ? `[${code}] ${title}` : title;
}

function makeSlug(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Initialising Firebase...');
    const app = initializeApp(firebaseConfig);
    const db  = getFirestore(app);

    // Load live-selling codes (written by the Live Desk tool). Matched by product id, then by name.
    const codeById = {}, codeByName = {};
    let showCodes = false;   // switched on/off with the Show/Hide buttons in the Live Desk
    try {
        const cSnap = await getDocs(collection(db, 'live_codes'));
        cSnap.forEach(d => {
            const x = d.data() || {};
            if (d.id === '_settings') { showCodes = x.showOnFacebook === true; return; }
            if (!x.code) return;
            const code = String(x.code);
            codeById[d.id] = code;
            if (x.productId) codeById[String(x.productId)] = code;
            if (x.name) codeByName[String(x.name).trim().toLowerCase()] = code;
        });
        console.log(`Loaded ${Object.keys(codeById).length} live code key(s). Codes on Facebook: ${showCodes ? 'SHOWN' : 'hidden'}.`);
    } catch (e) {
        console.warn('⚠️ Could not load live codes — titles will have no code:', e.message);
    }

    // Load all branch store IDs
    const stores = [{ id: MAIN_STORE, name: 'Main Store' }];
    try {
        const bSnap = await getDoc(doc(db, '_admin_', 'branches'));
        if (bSnap.exists()) {
            (bSnap.data().list || []).forEach(b => { if (b && b.id && b.id !== MAIN_STORE) stores.push({ id: b.id, name: b.name }); });
        }
    } catch (e) {
        console.warn('⚠️ Could not load branch list:', e.message);
    }
    if (stores.length === 1) {
        console.warn('⚠️ Branch list empty/unreadable — using the known branches instead.');
        FALLBACK_BRANCHES.forEach(b => stores.push(b));
    }
    console.log(`Loading products from ${stores.length} store(s):`, stores.map(s => s.name).join(', '));

    // Fetch and merge products across all stores by slug/name
    const bySlug = {};
    for (const store of stores) {
        try {
            const snap = await getDocs(collection(db, 'stores', store.id, 'products'));
            snap.forEach(docSnap => {
                const data = docSnap.data() || {};
                if (isDeleted(data)) return;                       // deleted items never count
                const p = { ...data, id: docSnap.id };            // the real doc id wins over a stray "id" field
                const liveKeys = [data.id, docSnap.id].filter(Boolean).map(String);
                const slug = p.slug || makeSlug(p.name);
                if (!slug || !String(p.name || '').trim()) return;

                if (!bySlug[slug]) {
                    bySlug[slug] = {
                        id: p.id,
                        name: p.name,
                        slug,
                        price: parseFloat(p.price) || 0,
                        category: p.category || '',
                        images: p.images || [],
                        sizes: [],                                // filled by the merge below (once)
                        stock: 0,
                        description: p.description || p.name,
                        liveKeys: []
                    };
                } else {
                    // Same product in another store. Keep the Main Store's id + price so variant ids stay stable.
                    if (store.id === MAIN_STORE) {
                        bySlug[slug].id = p.id;
                        if (parseFloat(p.price) > 0) bySlug[slug].price = parseFloat(p.price);
                    }
                    if ((!bySlug[slug].images || !bySlug[slug].images.length) && p.images && p.images.length) {
                        bySlug[slug].images = p.images;
                    }
                }

                liveKeys.forEach(k => { if (!bySlug[slug].liveKeys.includes(k)) bySlug[slug].liveKeys.push(k); });

                // Merge sizes — each store's quantities are added exactly once
                (Array.isArray(p.sizes) ? p.sizes : []).forEach(sz => {
                    if (!sz || !String(sz.name || '').trim()) return;
                    const existing = bySlug[slug].sizes.find(x => x.name === sz.name);
                    if (existing) existing.qty = (existing.qty || 0) + (Number(sz.qty) || 0);
                    else bySlug[slug].sizes.push({ name: sz.name, qty: Number(sz.qty) || 0 });
                });

                const stk = (p.sizes && p.sizes.length)
                    ? p.sizes.reduce((a, s) => a + (Number(s && s.qty) || 0), 0)
                    : (p.stock || 0);
                bySlug[slug].stock += stk;
            });
        } catch (e) {
            console.warn(`Failed to load products for ${store.id}:`, e.message);
        }
    }

    // Filter: only in-stock, priced products
    // Only AVAILABLE products go to Facebook (same as before): sold-out products are
    // left out completely, and for products with sizes only the sizes still in stock are listed.
    const priced = Object.values(bySlug).filter(p => p.price > 0);
    const products = [];
    for (const p of priced) {
        if (p.sizes && p.sizes.length > 0) {
            const inStockSizes = p.sizes.filter(sz => (sz.qty || 0) > 0);
            if (inStockSizes.length) products.push(Object.assign({}, p, { sizes: inStockSizes }));
        } else if ((p.stock || 0) > 0) {
            products.push(p);
        }
    }
    console.log(`Found ${priced.length} priced product(s); ${products.length} available and sent to Facebook across ${stores.length} store(s).`);

    // ── Build XML ─────────────────────────────────────────────────────────────
    const now = new Date().toISOString();
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push(`<!-- Generated: ${now} | Products: ${products.length} | ${BRAND_NAME} -->`);
    lines.push('<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">');
    lines.push('<channel>');
    lines.push(`  <title>${escXML(BRAND_NAME)}</title>`);
    lines.push(`  <link>${escXML(STORE_URL)}</link>`);
    lines.push(`  <description>Children's clothing — ${escXML(BRAND_NAME)}</description>`);
    lines.push('');

    for (const p of products) {
        const image = (p.images && p.images[0]) || '';
        const price = p.price.toFixed(2) + ' ' + CURRENCY;
        const productLink = STORE_URL + '#' + encodeURIComponent(p.name);
        const liveCode = !showCodes ? '' : ((p.liveKeys || []).map(k => codeById[k]).find(Boolean)
                      || codeByName[String(p.name).trim().toLowerCase()] || '');

        if (p.sizes && p.sizes.length > 0) {
            for (const sz of p.sizes) {
                const qty = Math.max(0, sz.qty || 0);
                const variantId = p.id + '_' + sz.name.replace(/\s+/g, '_');
                lines.push('  <item>');
                lines.push(`    <g:id>${escXML(variantId)}</g:id>`);
                lines.push(`    <g:item_group_id>${escXML(p.id)}</g:item_group_id>`);
                lines.push(`    <title>${escXML(withCode(liveCode, p.name + ' - Size ' + sz.name))}</title>`);
                lines.push(`    <description>${escXML(p.description || p.name)}</description>`);
                lines.push(`    <link>${escXML(productLink)}</link>`);
                if (image) lines.push(`    <g:image_link>${escXML(image)}</g:image_link>`);
                lines.push(`    <g:availability>${qty > 0 ? 'in stock' : 'out of stock'}</g:availability>`);
                lines.push(`    <g:price>${escXML(price)}</g:price>`);
                lines.push(`    <g:brand>${escXML(BRAND_NAME)}</g:brand>`);
                lines.push(`    <g:condition>${CONDITION}</g:condition>`);
                lines.push('    <g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Baby &amp; Toddler Clothing</g:google_product_category>');
                if (p.category) lines.push(`    <g:product_type>${escXML(p.category)}</g:product_type>`);
                lines.push(`    <g:size>${escXML(sz.name)}</g:size>`);
                lines.push('    <g:gender>unisex</g:gender>');
                lines.push('    <g:age_group>kids</g:age_group>');
                lines.push(`    <g:quantity_to_sell_on_facebook>${qty}</g:quantity_to_sell_on_facebook>`);
                lines.push('  </item>');
                lines.push('');
            }
        } else {
            lines.push('  <item>');
            lines.push(`    <g:id>${escXML(p.id)}</g:id>`);
            lines.push(`    <title>${escXML(withCode(liveCode, p.name))}</title>`);
            lines.push(`    <description>${escXML(p.description || p.name)}</description>`);
            lines.push(`    <link>${escXML(productLink)}</link>`);
            if (image) lines.push(`    <g:image_link>${escXML(image)}</g:image_link>`);
            lines.push(`    <g:availability>${(p.stock || 0) > 0 ? 'in stock' : 'out of stock'}</g:availability>`);
            lines.push(`    <g:price>${escXML(price)}</g:price>`);
            lines.push(`    <g:brand>${escXML(BRAND_NAME)}</g:brand>`);
            lines.push(`    <g:condition>${CONDITION}</g:condition>`);
            lines.push('    <g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Baby &amp; Toddler Clothing</g:google_product_category>');
            if (p.category) lines.push(`    <g:product_type>${escXML(p.category)}</g:product_type>`);
            lines.push('    <g:gender>unisex</g:gender>');
            lines.push('    <g:age_group>kids</g:age_group>');
            lines.push(`    <g:quantity_to_sell_on_facebook>${Math.max(0, p.stock || 0)}</g:quantity_to_sell_on_facebook>`);
            lines.push('  </item>');
            lines.push('');
        }
    }

    lines.push('</channel>');
    lines.push('</rss>');

    const xml = lines.join('\n');
    fs.writeFileSync('feed.xml', xml, 'utf8');
    console.log(`✅ feed.xml written — ${products.length} product(s), ${xml.length} bytes`);
}

main().catch(err => {
    console.error('❌ Feed generation failed:', err);
    process.exit(1);
});
