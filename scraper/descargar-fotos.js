const { chromium } = require('playwright');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PAGE_URL  = 'https://www.facebook.com/hotelecampanario1';
const OUT       = path.join(__dirname, '../img/facebook');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ─── download helper ────────────────────────────────────────────────────────
function dl(url, dest) {
  return new Promise((res, rej) => {
    const proto = url.startsWith('https') ? https : http;
    const file  = fs.createWriteStream(dest);
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      if ([301,302,303].includes(r.statusCode))
        return dl(r.headers.location, dest).then(res).catch(rej);
      r.pipe(file);
      file.on('finish', () => { file.close(); res(); });
    }).on('error', rej);
  });
}

// ─── extract big images from current page ───────────────────────────────────
async function extractImages(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const out  = [];
    document.querySelectorAll('img').forEach(img => {
      const src = img.src || img.dataset.src || '';
      // keep only FB CDN photos, skip tiny icons
      if (!src.includes('fbcdn') || src.includes('emoji') || src.includes('rsrc')) return;
      if (src.includes('s32x') || src.includes('s60x') || src.includes('p32x')) return;
      // prefer large variants — swap _s to _n (medium→original)
      const big = src.replace(/_s\.jpg/, '_n.jpg').replace(/_b\.jpg/, '_n.jpg');
      if (!seen.has(big)) { seen.add(big); out.push(big); }
    });
    return out;
  });
}

// ─── main ───────────────────────────────────────────────────────────────────
(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const ctx     = await browser.newContext({
    userAgent : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    viewport  : { width: 1280, height: 900 },
    locale    : 'es-LA',
  });
  const page = await ctx.newPage();

  // ── 1. Open main page ────────────────────────────────────────────────────
  console.log('📂 Abriendo página de Facebook…');
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // ── 2. Dismiss login wall / cookie popups ────────────────────────────────
  const dismissSelectors = [
    '[aria-label="Cerrar"]',
    '[aria-label="Close"]',
    '[data-testid="cookie-policy-manage-dialog-accept-button"]',
    'button:has-text("Permitir todas las cookies")',
    'button:has-text("Allow all cookies")',
    'button:has-text("Declinar cookies opcionales")',
    'button:has-text("Only allow essential cookies")',
    '[aria-label="Permitir todas las cookies"]',
  ];
  for (const sel of dismissSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`  ✅ Cerrado popup: ${sel}`);
        await page.waitForTimeout(1000);
      }
    } catch {}
  }

  // ── 3. If still on login page, wait for manual login (max 90s) ──────────
  let waited = 0;
  while ((page.url().includes('login') || page.url().includes('checkpoint')) && waited < 90) {
    if (waited === 0) {
      console.log('\n⚠️  Inicia sesión en la ventana del navegador.');
      console.log('   El script continuará solo cuando estés dentro…\n');
    }
    await page.waitForTimeout(2000);
    waited += 2;
  }

  const allImages = [];

  // ── 4. Scrape main page ──────────────────────────────────────────────────
  console.log('📸 Extrayendo fotos de la página principal…');
  await page.waitForTimeout(2000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(800);
  }
  allImages.push(...await extractImages(page));

  // ── 5. Go to Photos tab ──────────────────────────────────────────────────
  console.log('🖼  Abriendo pestaña Fotos…');
  await page.goto(PAGE_URL + '/photos', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, 900));
    await page.waitForTimeout(800);
  }
  allImages.push(...await extractImages(page));

  // ── 6. Also try /photos_albums ───────────────────────────────────────────
  try {
    await page.goto(PAGE_URL + '/photos_albums', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    allImages.push(...await extractImages(page));
  } catch {}

  // ── 7. Download unique images ────────────────────────────────────────────
  const unique = [...new Set(allImages)];
  console.log(`\n⬇  Descargando ${unique.length} imágenes únicas…`);

  let saved = 0;
  for (let i = 0; i < unique.length; i++) {
    const url  = unique[i];
    const ext  = url.includes('.png') ? 'png' : 'jpg';
    const name = `foto-${String(saved + 1).padStart(2, '0')}.${ext}`;
    const dest = path.join(OUT, name);
    try {
      await dl(url, dest);
      const size = fs.statSync(dest).size;
      if (size > 20_000) {
        console.log(`  ✅ ${name}  (${Math.round(size/1024)} KB)`);
        saved++;
      } else {
        fs.unlinkSync(dest); // demasiado pequeña → icono/miniatura
      }
    } catch { /* silenciar */ }
  }

  console.log(`\n🎉 ¡Listo! ${saved} fotos guardadas en img/facebook/`);
  await browser.close();
  process.exit(0);
})();
