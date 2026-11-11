const http = require('node:http');
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');

const port = Number(process.env.PORT) || 3000;
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf8'));
const categoryById = new Map(catalog.categories.map(category => [category.id, category]));
const imagePattern = /^\/images\/[a-z0-9-]+\.(webp|jpg|svg)$/;
const pages = [
  { slug: 'home', title: 'A.N. Inter Fashions — Garment Manufacturer & Exporter, Karachi' },
  { slug: 'about', title: 'About Us', sectionId: 'about' },
  { slug: 'products', title: 'Core Collection', sectionId: 'products' },
  { slug: 'facility', title: 'Our Facility', sectionId: 'facility' },
  { slug: 'export', title: 'Export Markets', sectionId: 'export' },
  { slug: 'contact', title: 'Contact Us', sectionId: 'contact' }
];
const pageBySlug = new Map(pages.map(page => [page.slug, page]));
const siteHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const imageAssets = new Map([
  ['/hero-bedroom.jpg', 'hero-bedroom.jpg']
]);

function getSectionMarkup(sectionId) {
  const start = siteHtml.indexOf(`<section id="${sectionId}"`);
  if (start === -1) throw new Error(`Section not found: ${sectionId}`);

  const tokens = /<\/?section\b[^>]*>/gi;
  tokens.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tokens.exec(siteHtml))) {
    if (/^<section\b/i.test(match[0])) depth++;
    else depth--;
    if (depth === 0) return siteHtml.slice(start, tokens.lastIndex);
  }
  throw new Error(`Unclosed section: ${sectionId}`);
}

function getHomeMarkup() {
  const navEnd = siteHtml.indexOf('</nav>');
  const contentStart = siteHtml.indexOf('<main id="routeContent"', navEnd);
  const contentEnd = siteHtml.indexOf('</main>', contentStart);
  const footerStart = siteHtml.indexOf('<footer>', contentEnd);
  if ([navEnd, contentStart, contentEnd, footerStart].some(position => position < 0)) {
    throw new Error('Unable to build homepage content from index.html');
  }
  return siteHtml.slice(contentEnd + '</main>'.length, footerStart);
}

function buildPageShell() {
  const bodyStart = siteHtml.indexOf('<body>');
  const navEnd = siteHtml.indexOf('</nav>', bodyStart);
  const contentStart = siteHtml.indexOf('<main id="routeContent"', navEnd);
  const contentEnd = siteHtml.indexOf('</main>', contentStart);
  const footerStart = siteHtml.indexOf('<footer>', contentEnd);
  const footerEnd = siteHtml.indexOf('</footer>', footerStart);
  const scriptStart = siteHtml.indexOf('<script>', footerEnd);
  if ([bodyStart, navEnd, contentStart, contentEnd, footerStart, footerEnd, scriptStart].some(position => position < 0)) {
    throw new Error('Unable to build page shell from index.html');
  }

  return siteHtml.slice(0, navEnd + '</nav>'.length)
    + siteHtml.slice(contentStart, contentEnd + '</main>'.length)
    + siteHtml.slice(footerStart, footerEnd + '</footer>'.length)
    + siteHtml.slice(scriptStart);
}

const pageShell = buildPageShell();

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN'
};

// Sends text, gzip-compressed when the client supports it.
function sendText(request, response, status, contentType, body, extraHeaders = {}) {
  const headers = { 'Content-Type': contentType, Vary: 'Accept-Encoding', ...securityHeaders, ...extraHeaders };
  const payload = Buffer.from(body, 'utf8');
  const acceptsGzip = /\bgzip\b/.test(request.headers['accept-encoding'] || '');
  if (acceptsGzip && payload.length > 1024) {
    headers['Content-Encoding'] = 'gzip';
    response.writeHead(status, headers);
    return request.method === 'HEAD' ? response.end() : response.end(zlib.gzipSync(payload));
  }
  response.writeHead(status, headers);
  return request.method === 'HEAD' ? response.end() : response.end(payload);
}

function sendJson(request, response, status, data) {
  return sendText(request, response, status, 'application/json; charset=utf-8', JSON.stringify(data), {
    'Cache-Control': 'no-store'
  });
}

function sendImage(request, response, file, contentType, cacheControl) {
  if (!fs.existsSync(file)) return sendJson(request, response, 404, { error: 'Image not found' });
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl, ...securityHeaders });
  if (request.method === 'HEAD') return response.end();
  return response.end(fs.readFileSync(file));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return sendJson(request, response, 405, { error: 'Method not allowed' });
    }

    if (url.pathname === '/api/categories') {
      return sendJson(request, response, 200, catalog.categories);
    }

    if (url.pathname === '/api/pages') {
      return sendJson(request, response, 200, pages.map(({ slug, title }) => ({ slug, title })));
    }

    const pageMatch = url.pathname.match(/^\/api\/pages\/([a-z-]+)$/);
    if (pageMatch) {
      const page = pageBySlug.get(pageMatch[1]);
      if (!page) return sendJson(request, response, 404, { error: 'Page not found' });
      return sendJson(request, response, 200, {
        slug: page.slug,
        title: page.title,
        html: page.slug === 'home' ? getHomeMarkup() : getSectionMarkup(page.sectionId)
      });
    }

    if (url.pathname === '/api/products') {
      const category = url.searchParams.get('category') || 'all';
      const sub = url.searchParams.get('sub') || 'all';
      if (category !== 'all' && !categoryById.has(category)) {
        return sendJson(request, response, 400, { error: `Unknown product category: ${category}` });
      }
      if (sub !== 'all') {
        const known = categoryById.get(category)?.subcategories.some(item => item.id === sub);
        if (!known) return sendJson(request, response, 400, { error: `Unknown sub-category: ${sub}` });
      }

      const products = catalog.products.filter(product =>
        (category === 'all' || product.category === category) &&
        (sub === 'all' || product.subcategory === sub));
      return sendJson(request, response, 200, products);
    }

    return sendJson(request, response, 404, { error: 'API endpoint not found' });
  }

  const isAsset = imagePattern.test(url.pathname) || imageAssets.has(url.pathname);
  if (isAsset) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      return sendJson(request, response, 405, { error: 'Method not allowed' });
    }
    if (imageAssets.has(url.pathname)) {
      return sendImage(request, response, path.join(__dirname, imageAssets.get(url.pathname)), 'image/jpeg', 'public, max-age=86400');
    }
    const file = path.join(__dirname, url.pathname);
    if (url.pathname.endsWith('.svg')) {
      if (!fs.existsSync(file)) return sendJson(request, response, 404, { error: 'Image not found' });
      return sendText(request, response, 200, 'image/svg+xml', fs.readFileSync(file, 'utf8'), { 'Cache-Control': 'public, max-age=604800' });
    }
    return sendImage(request, response, file, url.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/webp', 'public, max-age=604800');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return sendJson(request, response, 405, { error: 'Method not allowed' });
  }

  if (url.pathname.replace(/\/$/, '') === '/capabilities') {
    response.writeHead(301, { Location: '/facility' });
    return response.end();
  }

  const pageSlug = url.pathname.replace(/^\/|\/$/g, '');
  if (url.pathname !== '/' && url.pathname !== '/index.html' && !pageBySlug.has(pageSlug)) {
    return sendJson(request, response, 404, { error: 'Page not found' });
  }

  sendText(
    request,
    response,
    200,
    'text/html; charset=utf-8',
    pageSlug === '' || pageBySlug.has(pageSlug) ? pageShell : siteHtml
  );
});

server.listen(port, () => {
  console.log(`A.N. Inter Fashions running at http://localhost:${port}`);
});
