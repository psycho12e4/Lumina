/* Lumina — store server backed by Supabase.
   Run with: npm start  (or: node server.js)
   Serves the static site plus a JSON API:
     - products (live stock, add/edit, photo upload)
     - orders (placed via the test-mode checkout)
     - newsletter subscribers (shown in the admin, never emailed)
   Admin endpoints require the x-admin-token header from /api/admin/login.
   Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) */

"use strict";

/* Load .env in development (ignored in production where env vars are set by the host) */
try { require("fs").readFileSync(".env", "utf8").split("\n").forEach(function (line) { var m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }); } catch (e) { /* no .env, that's fine */ }

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const ROOT = __dirname;
const UPLOAD_DIR = process.env.LUMINA_DATA_DIR
    ? path.join(process.env.LUMINA_DATA_DIR, "uploads")
    : path.join(ROOT, "assets", "img", "uploads");
const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.LUMINA_ADMIN_PASSWORD || "lumina-admin";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) env vars are required.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ---- Helpers ---- */

const adminTokens = new Set();

/* Validates a Supabase Auth JWT (sent as "Authorization: Bearer <token>") and
   returns {id, email, name} for the authenticated user, or null. */
async function getAuthUser(req) {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/);
    if (!match) return null;
    const { data, error } = await supabase.auth.getUser(match[1]);
    if (error || !data || !data.user) return null;
    const user = data.user;
    return { id: user.id, email: user.email, name: (user.user_metadata && user.user_metadata.name) || user.email };
}

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
            if (size > 10 * 1024 * 1024) { reject(new Error("Payload too large")); req.destroy(); return; }
            chunks.push(chunk);
        });
        req.on("end", function () {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
            catch (e) { reject(new Error("Invalid JSON")); }
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

function dbErr(res, err) {
    console.error("Supabase error:", err);
    return json(res, 500, { error: "Database error: " + (err.message || err) });
}

/* ---- API routes ---- */

async function handleApi(req, res, pathname) {
    const method = req.method;

    /* -- public -- */

    if (pathname === "/api/products" && method === "GET") {
        const { data, error } = await supabase
            .from("products")
            .select("*")
            .neq("status", "hidden")
            .order("created_at");
        if (error) return dbErr(res, error);
        return json(res, 200, { products: data });
    }

    const productDetailMatch = pathname.match(/^\/api\/products\/([^/]+)$/);
    if (productDetailMatch && method === "GET") {
        const { data: product, error } = await supabase
            .from("products")
            .select("*")
            .eq("id", productDetailMatch[1])
            .neq("status", "hidden")
            .maybeSingle();
        if (error) return dbErr(res, error);
        if (!product) return json(res, 404, { error: "Product not found." });

        const { data: reviews, error: revErr } = await supabase
            .from("reviews")
            .select("*")
            .eq("product_id", product.id)
            .eq("status", "approved")
            .order("created_at", { ascending: false });
        if (revErr) return dbErr(res, revErr);

        return json(res, 200, { product, reviews: reviews || [] });
    }

    if (pathname === "/api/reviews" && method === "POST") {
        const user = await getAuthUser(req);
        if (!user) return json(res, 401, { error: "Please sign in to write a review." });

        const body = await readBody(req);
        const productId = String(body.productId || "").trim();
        const title = String(body.title || "").trim();
        const reviewBody = String(body.body || "").trim();
        const rating = parseInt(body.rating, 10);

        if (!productId) return json(res, 400, { error: "Missing product." });
        if (!reviewBody) return json(res, 400, { error: "Review text is required." });
        if (!(rating >= 1 && rating <= 5)) return json(res, 400, { error: "Rating must be between 1 and 5." });

        const { data: orders, error: orderErr } = await supabase
            .from("orders")
            .select("*");
        if (orderErr) return dbErr(res, orderErr);

        const purchase = (orders || []).find(function (o) {
            return o.customer && o.customer.email === user.email &&
                Array.isArray(o.items) && o.items.some(function (i) { return i.id === productId; });
        });
        if (!purchase) return json(res, 403, { error: "We couldn't find a purchase of this product on your account." });

        const { error } = await supabase.from("reviews").insert({
            product_id: productId,
            order_id: purchase.id,
            name: user.name,
            rating,
            title,
            body: reviewBody,
            status: "pending"
        });
        if (error) return dbErr(res, error);

        return json(res, 200, { ok: true, pending: true });
    }

    if (pathname === "/api/newsletter" && method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json(res, 400, { error: "Please enter a valid email address." });
        }
        const { data: existing } = await supabase
            .from("subscribers")
            .select("id")
            .eq("email", email)
            .maybeSingle();
        if (existing) return json(res, 200, { ok: true, alreadySubscribed: true });
        const { error } = await supabase
            .from("subscribers")
            .insert({ email, source: String(body.source || "site") });
        if (error) return dbErr(res, error);
        return json(res, 200, { ok: true, alreadySubscribed: false });
    }

    if (pathname === "/api/orders" && method === "POST") {
        const user = await getAuthUser(req);
        if (!user) return json(res, 401, { error: "Please sign in to place an order." });

        const body = await readBody(req);
        const customer = body.customer || {};
        const name = String(customer.name || "").trim();
        const phone = String(customer.phone || "").trim();
        if (!name || !phone) return json(res, 400, { error: "Name and mobile number are required." });
        if (!Array.isArray(body.items) || !body.items.length) return json(res, 400, { error: "Your bag is empty." });

        /* resolve items against the catalog */
        const ids = body.items.map(function (i) { return i.id; }).filter(Boolean);
        const { data: catalog, error: catErr } = await supabase
            .from("products")
            .select("*")
            .in("id", ids);
        if (catErr) return dbErr(res, catErr);

        const resolved = [];
        for (const item of body.items) {
            const qty = Math.max(1, parseInt(item.qty, 10) || 1);
            const product = catalog.find(function (p) {
                return (item.id && p.id === item.id) || p.name === item.name;
            });
            if (!product || product.status === "hidden") {
                return json(res, 400, { error: '"' + (item.name || item.id) + '" is no longer available.' });
            }
            if (product.stock < qty) {
                return json(res, 409, { error: 'Only ' + product.stock + ' of "' + product.name + '" left in stock.' });
            }
            resolved.push({ product, qty });
        }

        /* fake payment — TEST MODE */
        const card = String((body.payment && body.payment.card) || "").replace(/\D/g, "");
        if (card.length < 12) return json(res, 402, { error: "Payment declined: enter a valid card number (test mode accepts any 12+ digits)." });

        /* decrement stock */
        for (const line of resolved) {
            const { error: stockErr } = await supabase
                .from("products")
                .update({ stock: line.product.stock - line.qty })
                .eq("id", line.product.id);
            if (stockErr) return dbErr(res, stockErr);
        }

        /* increment order counter */
        const { data: counterRow, error: cntErr } = await supabase
            .from("counters")
            .select("value")
            .eq("key", "order")
            .single();
        if (cntErr) return dbErr(res, cntErr);
        const nextNum = counterRow.value + 1;
        await supabase.from("counters").update({ value: nextNum }).eq("key", "order");

        const order = {
            id: "LUM-" + nextNum,
            date: new Date().toISOString(),
            status: "new",
            customer: {
                name,
                phone,
                email: user.email,
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

        const { error: orderErr } = await supabase.from("orders").insert(order);
        if (orderErr) return dbErr(res, orderErr);

        return json(res, 201, { ok: true, order: { id: order.id, total: order.total, authorization: order.payment.authorization } });
    }

    if (pathname === "/api/admin/login" && method === "POST") {
        const body = await readBody(req);
        if (String(body.password || "") !== ADMIN_PASSWORD) {
            return json(res, 401, { error: "Incorrect password." });
        }
        const token = crypto.randomBytes(24).toString("hex");
        adminTokens.add(token);
        return json(res, 200, { token });
    }

    /* -- admin (token required) -- */

    if (pathname.startsWith("/api/admin/")) {
        if (!isAdmin(req)) return json(res, 401, { error: "Not authorized." });

        if (pathname === "/api/admin/reviews" && method === "GET") {
            const { data, error } = await supabase.from("reviews").select("*").order("created_at", { ascending: false });
            if (error) return dbErr(res, error);
            return json(res, 200, { reviews: data || [] });
        }

        const reviewMatch = pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
        if (reviewMatch && (method === "PUT" || method === "PATCH")) {
            const body = await readBody(req);
            if (["pending", "approved"].indexOf(body.status) === -1) return json(res, 400, { error: "Invalid status." });
            const { data: updated, error } = await supabase
                .from("reviews").update({ status: body.status }).eq("id", reviewMatch[1]).select().single();
            if (error) return dbErr(res, error);
            return json(res, 200, { ok: true, review: updated });
        }

        if (reviewMatch && method === "DELETE") {
            const { error } = await supabase.from("reviews").delete().eq("id", reviewMatch[1]);
            if (error) return dbErr(res, error);
            return json(res, 200, { ok: true });
        }

        if (pathname === "/api/admin/summary" && method === "GET") {
            const [{ data: products }, { data: orders }, { data: subscribers }] = await Promise.all([
                supabase.from("products").select("*").order("created_at"),
                supabase.from("orders").select("*").order("date", { ascending: false }),
                supabase.from("subscribers").select("*").order("date", { ascending: false })
            ]);

            const unitsSold = {};
            (orders || []).forEach(function (order) {
                (order.items || []).forEach(function (item) {
                    unitsSold[item.id] = (unitsSold[item.id] || 0) + item.qty;
                });
            });

            return json(res, 200, {
                products: (products || []).map(function (p) {
                    return Object.assign({}, p, { unitsSold: unitsSold[p.id] || 0 });
                }),
                orders: orders || [],
                subscribers: subscribers || [],
                revenue: (orders || []).reduce(function (sum, o) { return sum + Number(o.total); }, 0)
            });
        }

        if (pathname === "/api/admin/products" && method === "POST") {
            const body = await readBody(req);
            const name = String(body.name || "").trim();
            const price = parseFloat(body.price);
            if (!name || !(price >= 0)) return json(res, 400, { error: "A name and a valid price are required." });

            let id = slugify(name);
            const { data: existing } = await supabase.from("products").select("id").eq("id", id).maybeSingle();
            if (existing) id += "-2";

            const images = Array.isArray(body.images) ? body.images.filter(Boolean) : [];
            const colors = Array.isArray(body.colors) ? body.colors.filter(function (c) { return c && c.name; }) : [];

            const product = {
                id,
                name,
                price,
                stock: Math.max(0, parseInt(body.stock, 10) || 0),
                status: body.status === "hidden" ? "hidden" : "active",
                categories: Array.isArray(body.categories) && body.categories.length ? body.categories : ["glass"],
                tag: String(body.tag || "Hand-Poured").trim(),
                image: String((images[0] || body.image) || "assets/img/photo-01.png"),
                images: images.length ? images : (body.image ? [String(body.image)] : []),
                colors,
                alt: String(body.alt || name + " — artisanal soy wax candle by Lumina")
            };
            const { error } = await supabase.from("products").insert(product);
            if (error) return dbErr(res, error);
            return json(res, 201, { ok: true, product });
        }

        const productMatch = pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
        if (productMatch && (method === "PUT" || method === "PATCH")) {
            const { data: product, error: findErr } = await supabase
                .from("products").select("*").eq("id", productMatch[1]).maybeSingle();
            if (findErr || !product) return json(res, 404, { error: "Product not found." });

            const body = await readBody(req);
            const updates = {};
            if (body.name !== undefined) updates.name = String(body.name).trim() || product.name;
            if (body.price !== undefined && parseFloat(body.price) >= 0) updates.price = parseFloat(body.price);
            if (body.stock !== undefined) updates.stock = Math.max(0, parseInt(body.stock, 10) || 0);
            if (body.status !== undefined) updates.status = body.status === "hidden" ? "hidden" : "active";
            if (body.tag !== undefined) updates.tag = String(body.tag).trim();
            if (body.image !== undefined) updates.image = String(body.image);
            if (body.alt !== undefined) updates.alt = String(body.alt);
            if (Array.isArray(body.categories) && body.categories.length) updates.categories = body.categories;
            if (Array.isArray(body.images)) {
                updates.images = body.images.filter(Boolean);
                if (updates.images.length) updates.image = updates.images[0];
            }
            if (Array.isArray(body.colors)) {
                updates.colors = body.colors.filter(function (c) { return c && c.name; });
            }

            const { data: updated, error: upErr } = await supabase
                .from("products").update(updates).eq("id", productMatch[1]).select().single();
            if (upErr) return dbErr(res, upErr);
            return json(res, 200, { ok: true, product: updated });
        }

        if (productMatch && method === "DELETE") {
            const { error } = await supabase.from("products").delete().eq("id", productMatch[1]);
            if (error) return dbErr(res, error);
            return json(res, 200, { ok: true });
        }

        const orderMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)$/);
        if (orderMatch && (method === "PUT" || method === "PATCH")) {
            const body = await readBody(req);
            const allowed = ["new", "packed", "shipped", "delivered", "cancelled"];
            if (allowed.indexOf(body.status) === -1) return json(res, 400, { error: "Invalid status." });
            const { data: updated, error } = await supabase
                .from("orders").update({ status: body.status }).eq("id", orderMatch[1]).select().single();
            if (error) return dbErr(res, error);
            return json(res, 200, { ok: true, order: updated });
        }

        if (pathname === "/api/admin/upload" && method === "POST") {
            const body = await readBody(req);
            const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(String(body.dataUrl || ""));
            if (!match) return json(res, 400, { error: "Send an image as a data URL (png, jpg, webp, or gif)." });
            const ext = match[1] === "jpeg" ? "jpg" : match[1];
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
            const filename = slugify(body.name || "photo") + "-" + Date.now() + "." + ext;
            fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[2], "base64"));
            return json(res, 201, { ok: true, path: "uploads/" + filename });
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
    const uploadMatch = /^\/(?:uploads|assets\/img\/uploads)\/([^/]+)$/.exec(pathname);
    if (uploadMatch) {
        const uploadPath = path.join(UPLOAD_DIR, uploadMatch[1]);
        if (!uploadPath.startsWith(UPLOAD_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
        return fs.readFile(uploadPath, function (err, content) {
            if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
            const ext = path.extname(uploadPath).toLowerCase();
            res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "max-age=60" });
            res.end(content);
        });
    }

    let filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
    if (pathname === "/" || pathname === "") filePath = path.join(ROOT, "index.html");
    fs.stat(filePath, function (err, stats) {
        if (!err && stats.isDirectory()) filePath = path.join(filePath, "index.html");
        fs.readFile(filePath, function (err, content) {
            if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
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
    console.log("Lumina store running (Supabase backend):");
    console.log("  Shop   → http://localhost:" + PORT + "/shop.html");
    console.log("  Admin  → http://localhost:" + PORT + "/admin.html  (password: " + ADMIN_PASSWORD + ")");
});
