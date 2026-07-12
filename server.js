/* Lumina — local store server (no dependencies, plain Node).
   Run with: npm start  (or: node server.js)
   Serves the static site plus a small JSON API backed by data/db.json:
     - products (live stock, add/edit, photo upload)
     - orders (placed via the test-mode checkout)
     - newsletter subscribers (shown in the admin, never emailed)
   Admin endpoints require the x-admin-token header from /api/admin/login. */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.LUMINA_ADMIN_PASSWORD || "lumina-admin";

/* ---- Database (a JSON file; fine for a single local shop) ---- */

const SEED = {
    products: [
        {
            id: "midnight-amber",
            name: "Midnight Amber",
            price: 42,
            stock: 12,
            status: "active",
            categories: ["glass", "scented"],
            tag: "Wooden Wick",
            image: "assets/img/photo-03.png",
            alt: "A close-up shot of a minimalist artisanal glass candle with a wooden wick resting on a light cream surface."
        },
        {
            id: "ivory-silhouette",
            name: "Ivory Silhouette",
            price: 38,
            stock: 8,
            status: "active",
            categories: ["pillar"],
            tag: "Hand-Poured",
            image: "assets/img/photo-05.png",
            alt: "A tall, elegant pillar candle in a creamy off-white shade, standing against a soft, light background."
        },
        {
            id: "wild-fig-cedar",
            name: "Wild Fig & Cedar",
            price: 45,
            stock: 15,
            status: "active",
            categories: ["glass", "scented"],
            tag: "Essential Oils",
            image: "assets/img/photo-18.png",
            alt: "A low, wide glass container holding a scented soy candle on toasted almond colored linen fabric."
        },
        {
            id: "architectural-set",
            name: "The Architectural Set",
            price: 65,
            stock: 5,
            status: "active",
            categories: ["pillar"],
            tag: "Hand-Poured",
            image: "assets/img/photo-01.png",
            alt: "A set of two minimalist pillar candles of varying heights against a warm, light cream background."
        },
        {
            id: "smoked-vetiver",
            name: "Smoked Vetiver",
            price: 48,
            stock: 20,
            status: "active",
            categories: ["glass", "scented"],
            tag: "Wooden Wick",
            image: "assets/img/photo-10.png",
            alt: "A close-up view of an amber-tinted glass candle emitting a soft, warm glow from its wooden wick."
        }
    ],
    orders: [],
    subscribers: [],
    counters: { order: 1000 }
};

function loadDb() {
    try {
        return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } catch (e) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(SEED, null, 2));
        return JSON.parse(JSON.stringify(SEED));
    }
}

const db = loadDb();

let saveTimer = null;
function saveDb() {
    /* debounce writes a touch so bursts of edits don't thrash the disk */
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    }, 50);
}

/* ---- Helpers ---- */

const adminTokens = new Set();

function json(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(text);
}

function readBody(req) {
    return new Promise(function (resolve, reject) {
        let size = 0;
        const chunks = [];
        req.on("data", function (chunk) {
            size += chunk.length;
            if (size > 10 * 1024 * 1024) {
                reject(new Error("Payload too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", function () {
            try {
                resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
            } catch (e) {
                reject(new Error("Invalid JSON"));
            }
        });
        req.on("error", reject);
    });
}

function isAdmin(req) {
    return adminTokens.has(req.headers["x-admin-token"] || "");
}

function slugify(name) {
    return String(name).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "product";
}

function publicProducts() {
    return db.products.filter(function (p) { return p.status !== "hidden"; });
}

/* ---- API routes ---- */

async function handleApi(req, res, pathname) {
    const method = req.method;

    /* -- public -- */

    if (pathname === "/api/products" && method === "GET") {
        return json(res, 200, { products: publicProducts() });
    }

    if (pathname === "/api/newsletter" && method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json(res, 400, { error: "Please enter a valid email address." });
        }
        const exists = db.subscribers.some(function (s) { return s.email === email; });
        if (!exists) {
            db.subscribers.push({ email: email, source: String(body.source || "site"), date: new Date().toISOString() });
            saveDb();
        }
        return json(res, 200, { ok: true, alreadySubscribed: exists });
    }

    if (pathname === "/api/orders" && method === "POST") {
        const body = await readBody(req);
        const customer = body.customer || {};
        const name = String(customer.name || "").trim();
        const phone = String(customer.phone || "").trim();
        if (!name || !phone) return json(res, 400, { error: "Name and mobile number are required." });
        if (!Array.isArray(body.items) || !body.items.length) return json(res, 400, { error: "Your bag is empty." });

        /* resolve items against the catalog (by id, falling back to name) */
        const resolved = [];
        for (const item of body.items) {
            const qty = Math.max(1, parseInt(item.qty, 10) || 1);
            const product = db.products.find(function (p) {
                return (item.id && p.id === item.id) || p.name === item.name;
            });
            if (!product || product.status === "hidden") {
                return json(res, 400, { error: '"' + (item.name || item.id) + '" is no longer available.' });
            }
            if (product.stock < qty) {
                return json(res, 409, { error: 'Only ' + product.stock + ' of "' + product.name + '" left in stock.' });
            }
            resolved.push({ product: product, qty: qty });
        }

        /* fake payment authorization — TEST MODE, nothing is charged */
        const card = String((body.payment && body.payment.card) || "").replace(/\D/g, "");
        if (card.length < 12) return json(res, 402, { error: "Payment declined: enter a valid card number (test mode accepts any 12+ digits)." });

        resolved.forEach(function (line) { line.product.stock -= line.qty; });
        db.counters.order += 1;
        const order = {
            id: "LUM-" + db.counters.order,
            date: new Date().toISOString(),
            status: "new",
            customer: {
                name: name,
                phone: phone,
                email: String(customer.email || "").trim(),
                address: String(customer.address || "").trim()
            },
            items: resolved.map(function (line) {
                return { id: line.product.id, name: line.product.name, price: line.product.price, qty: line.qty };
            }),
            total: resolved.reduce(function (sum, line) { return sum + line.product.price * line.qty; }, 0),
            payment: {
                mode: "TEST",
                method: "card",
                last4: card.slice(-4),
                authorization: "AUTH-" + crypto.randomBytes(4).toString("hex").toUpperCase()
            }
        };
        db.orders.unshift(order);
        saveDb();
        return json(res, 201, { ok: true, order: { id: order.id, total: order.total, authorization: order.payment.authorization } });
    }

    if (pathname === "/api/admin/login" && method === "POST") {
        const body = await readBody(req);
        if (String(body.password || "") !== ADMIN_PASSWORD) {
            return json(res, 401, { error: "Incorrect password." });
        }
        const token = crypto.randomBytes(24).toString("hex");
        adminTokens.add(token);
        return json(res, 200, { token: token });
    }

    /* -- admin (token required) -- */

    if (pathname.startsWith("/api/admin/")) {
        if (!isAdmin(req)) return json(res, 401, { error: "Not authorized." });

        if (pathname === "/api/admin/summary" && method === "GET") {
            const unitsSold = {};
            db.orders.forEach(function (order) {
                order.items.forEach(function (item) {
                    unitsSold[item.id] = (unitsSold[item.id] || 0) + item.qty;
                });
            });
            return json(res, 200, {
                products: db.products.map(function (p) {
                    return Object.assign({}, p, { unitsSold: unitsSold[p.id] || 0 });
                }),
                orders: db.orders,
                subscribers: db.subscribers,
                revenue: db.orders.reduce(function (sum, o) { return sum + o.total; }, 0)
            });
        }

        if (pathname === "/api/admin/products" && method === "POST") {
            const body = await readBody(req);
            const name = String(body.name || "").trim();
            const price = parseFloat(body.price);
            if (!name || !(price >= 0)) return json(res, 400, { error: "A name and a valid price are required." });
            let id = slugify(name);
            while (db.products.some(function (p) { return p.id === id; })) id += "-2";
            const product = {
                id: id,
                name: name,
                price: price,
                stock: Math.max(0, parseInt(body.stock, 10) || 0),
                status: body.status === "hidden" ? "hidden" : "active",
                categories: Array.isArray(body.categories) && body.categories.length ? body.categories : ["glass"],
                tag: String(body.tag || "Hand-Poured").trim(),
                image: String(body.image || "assets/img/photo-01.png"),
                alt: String(body.alt || name + " — artisanal soy wax candle by Lumina")
            };
            db.products.push(product);
            saveDb();
            return json(res, 201, { ok: true, product: product });
        }

        const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
        if (productMatch && (method === "PUT" || method === "PATCH")) {
            const product = db.products.find(function (p) { return p.id === productMatch[1]; });
            if (!product) return json(res, 404, { error: "Product not found." });
            const body = await readBody(req);
            if (body.name !== undefined) product.name = String(body.name).trim() || product.name;
            if (body.price !== undefined && parseFloat(body.price) >= 0) product.price = parseFloat(body.price);
            if (body.stock !== undefined) product.stock = Math.max(0, parseInt(body.stock, 10) || 0);
            if (body.status !== undefined) product.status = body.status === "hidden" ? "hidden" : "active";
            if (body.tag !== undefined) product.tag = String(body.tag).trim();
            if (body.image !== undefined) product.image = String(body.image);
            if (body.alt !== undefined) product.alt = String(body.alt);
            if (Array.isArray(body.categories) && body.categories.length) product.categories = body.categories;
            saveDb();
            return json(res, 200, { ok: true, product: product });
        }

        if (productMatch && method === "DELETE") {
            const index = db.products.findIndex(function (p) { return p.id === productMatch[1]; });
            if (index === -1) return json(res, 404, { error: "Product not found." });
            db.products.splice(index, 1);
            saveDb();
            return json(res, 200, { ok: true });
        }

        const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
        if (orderMatch && (method === "PUT" || method === "PATCH")) {
            const order = db.orders.find(function (o) { return o.id === orderMatch[1]; });
            if (!order) return json(res, 404, { error: "Order not found." });
            const body = await readBody(req);
            const allowed = ["new", "packed", "shipped", "delivered", "cancelled"];
            if (allowed.indexOf(body.status) !== -1) order.status = body.status;
            saveDb();
            return json(res, 200, { ok: true, order: order });
        }

        if (pathname === "/api/admin/upload" && method === "POST") {
            const body = await readBody(req);
            const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ""));
            if (!match) return json(res, 400, { error: "Send an image as a data URL (png, jpg, webp, or gif)." });
            const ext = match[1] === "jpeg" ? "jpg" : match[1];
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            const filename = slugify(body.name || "photo") + "-" + Date.now() + "." + ext;
            fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[2], "base64"));
            return json(res, 201, { ok: true, path: "assets/img/uploads/" + filename });
        }
    }

    return json(res, 404, { error: "Not found." });
}

/* ---- Static file serving ---- */

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

function serveStatic(req, res, pathname) {
    let filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }
    if (pathname === "/" || pathname === "") filePath = path.join(ROOT, "index.html");
    fs.stat(filePath, function (err, stats) {
        if (!err && stats.isDirectory()) filePath = path.join(filePath, "index.html");
        fs.readFile(filePath, function (err, content) {
            if (err) {
                res.writeHead(404, { "Content-Type": "text/plain" });
                return res.end("Not found");
            }
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, {
                "Content-Type": MIME[ext] || "application/octet-stream",
                "Cache-Control": ext === ".html" ? "no-cache" : "max-age=60"
            });
            res.end(content);
        });
    });
}

const server = http.createServer(function (req, res) {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
        handleApi(req, res, pathname).catch(function (err) {
            json(res, 400, { error: err.message || "Bad request" });
        });
    } else {
        serveStatic(req, res, pathname);
    }
});

server.listen(PORT, function () {
    console.log("Lumina store running:");
    console.log("  Shop   → http://localhost:" + PORT + "/shop.html");
    console.log("  Admin  → http://localhost:" + PORT + "/admin.html  (password: " + ADMIN_PASSWORD + ")");
});
