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
const STORE_URL   = 'https://sophornung575-jpg.github.io/Goad-Kids/goat_kids_v3_multistore.html';
const CONDITION   = 'new';
const MAIN_STORE  = 'GOAT-1979';

// ── Helpers ──────────────────────────────────────────────────────────────────
function escXML(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function makeSlug(name) {
    return (name || '').trim().toLowerCase().replace(/\s+/g, '_');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Initialising Firebase...');
    const app = initializeApp(firebaseConfig);
    const db  = getFirestore(app);

    // Load all branch store IDs
    const stores = [{ id: MAIN_STORE, name: 'Main Store' }];
    try {
        const bSnap = await getDoc(doc(db, '_admin_', 'branches'));
        if (bSnap.exists()) {
            (bSnap.data().list || []).forEach(b => stores.push({ id: b.id, name: b.name }));
        }
    } catch (e) {
        console.warn('Could not load branches:', e.message);
    }
    console.log(`Loading products from ${stores.length} store(s):`, stores.map(s => s.name).join(', '));

    // Fetch and merge products across all stores by slug/name
    const bySlug = {};
    for (const store of stores) {
        try {
            const snap = await getDocs(collection(db, 'stores', store.id, 'products'));
            snap.forEach(docSnap => {
                const p = { id: docSnap.id, ...docSnap.data() };
                const slug = p.slug || makeSlug(p.name);
                if (!slug || !p.name) return;

                if (!bySlug[slug]) {
                    bySlug[slug] = {
                        id: p.id,
                        name: p.name,
                        slug,
                        price: parseFloat(p.price) || 0,
                        category: p.category || '',
                        images: p.images || [],
                        sizes: p.sizes ? JSON.parse(JSON.stringify(p.sizes)) : null,
                        stock: 0,
                        description: p.description || p.name
                    };
                } else {
                    // Prefer version with images
                    if ((!bySlug[slug].images || !bySlug[slug].images.length) && p.images && p.images.length) {
                        bySlug[slug].images = p.images;
                    }
                }

                // Merge sizes
                if (p.sizes && p.sizes.length) {
                    if (!bySlug[slug].sizes || !bySlug[slug].sizes.length) {
                        bySlug[slug].sizes = p.sizes.map(s => ({ ...s }));
                    } else {
                        p.sizes.forEach(sz => {
                            const existing = bySlug[slug].sizes.find(x => x.name === sz.name);
                            if (existing) existing.qty = (existing.qty || 0) + (sz.qty || 0);
                            else bySlug[slug].sizes.push({ ...sz });
                        });
                    }
                }

                const stk = (p.sizes && p.sizes.length)
                    ? p.sizes.reduce((a, s) => a + (s.qty || 0), 0)
                    : (p.stock || 0);
                bySlug[slug].stock += stk;
            });
        } catch (e) {
            console.warn(`Failed to load products for ${store.id}:`, e.message);
        }
    }

    // Filter: only in-stock, priced products
    const products = Object.values(bySlug).filter(p => p.stock > 0 && p.price > 0);
    console.log(`Found ${products.length} in-stock product(s) across all stores.`);

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

        if (p.sizes && p.sizes.length > 0) {
            for (const sz of p.sizes) {
                if ((sz.qty || 0) <= 0) continue;
                const variantId = p.id + '_' + sz.name.replace(/\s+/g, '_');
                lines.push('  <item>');
                lines.push(`    <g:id>${escXML(variantId)}</g:id>`);
                lines.push(`    <g:item_group_id>${escXML(p.id)}</g:item_group_id>`);
                lines.push(`    <title>${escXML(p.name + ' - Size ' + sz.name)}</title>`);
                lines.push(`    <description>${escXML(p.description || p.name)}</description>`);
                lines.push(`    <link>${escXML(productLink)}</link>`);
                if (image) lines.push(`    <g:image_link>${escXML(image)}</g:image_link>`);
                lines.push('    <g:availability>in stock</g:availability>');
                lines.push(`    <g:price>${escXML(price)}</g:price>`);
                lines.push(`    <g:brand>${escXML(BRAND_NAME)}</g:brand>`);
                lines.push(`    <g:condition>${CONDITION}</g:condition>`);
                lines.push('    <g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Baby &amp; Toddler Clothing</g:google_product_category>');
                if (p.category) lines.push(`    <g:product_type>${escXML(p.category)}</g:product_type>`);
                lines.push(`    <g:size>${escXML(sz.name)}</g:size>`);
                lines.push('    <g:gender>unisex</g:gender>');
                lines.push('    <g:age_group>kids</g:age_group>');
                lines.push(`    <g:quantity_to_sell_on_facebook>${sz.qty || 0}</g:quantity_to_sell_on_facebook>`);
                lines.push('  </item>');
                lines.push('');
            }
        } else {
            lines.push('  <item>');
            lines.push(`    <g:id>${escXML(p.id)}</g:id>`);
            lines.push(`    <title>${escXML(p.name)}</title>`);
            lines.push(`    <description>${escXML(p.description || p.name)}</description>`);
            lines.push(`    <link>${escXML(productLink)}</link>`);
            if (image) lines.push(`    <g:image_link>${escXML(image)}</g:image_link>`);
            lines.push('    <g:availability>in stock</g:availability>');
            lines.push(`    <g:price>${escXML(price)}</g:price>`);
            lines.push(`    <g:brand>${escXML(BRAND_NAME)}</g:brand>`);
            lines.push(`    <g:condition>${CONDITION}</g:condition>`);
            lines.push('    <g:google_product_category>Apparel &amp; Accessories &gt; Clothing &gt; Baby &amp; Toddler Clothing</g:google_product_category>');
            if (p.category) lines.push(`    <g:product_type>${escXML(p.category)}</g:product_type>`);
            lines.push('    <g:gender>unisex</g:gender>');
            lines.push('    <g:age_group>kids</g:age_group>');
            lines.push(`    <g:quantity_to_sell_on_facebook>${p.stock || 0}</g:quantity_to_sell_on_facebook>`);
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
