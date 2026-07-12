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
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");

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
/* email verification tokens: token → {email, expiresAt} */
const verifiedEmails = new Map();

function makeMailTransport() {
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587", 10),
            secure: process.env.SMTP_SECURE === "true",
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
    }
    /* Ethereal test account — credentials printed to console on first use */
    return null;
}
let _transport = null;
async function getTransport() {
    if (_transport) return _transport;
    if (process.env.SMTP_HOST) {
        _transport = makeMailTransport();
        return _transport;
    }
    const testAccount = await nodemailer.createTestAccount();
    _transport = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass }
    });
    console.log("[EMAIL TEST] Ethereal preview account: " + testAccount.user);
    return _transport;
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

function parseCookie(str) {
    return str.split(";").reduce(function (out, part) {
        var eq = part.indexOf("=");
        if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
        return out;
    }, {});
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
        const body = await readBody(req);
        const productId = String(body.productId || "").trim();
        const orderId = String(body.orderId || "").trim();
        const phone = String(body.phone || "").trim();
        const name = String(body.name || "").trim();
        const title = String(body.title || "").trim();
        const reviewBody = String(body.body || "").trim();
        const rating = parseInt(body.rating, 10);

        if (!productId || !orderId || !phone) return json(res, 400, { error: "Order ID and phone number are required to verify your purchase." });
        if (!name || !reviewBody) return json(res, 400, { error: "Name and review text are required." });
        if (!(rating >= 1 && rating <= 5)) return json(res, 400, { error: "Rating must be between 1 and 5." });

        const { data: order, error: orderErr } = await supabase
            .from("orders")
            .select("*")
            .eq("id", orderId)
            .maybeSingle();
        if (orderErr) return dbErr(res, orderErr);

        const purchased = order && order.customer && order.customer.phone === phone &&
            Array.isArray(order.items) && order.items.some(function (i) { return i.id === productId; });
        if (!purchased) return json(res, 403, { error: "We couldn't verify this purchase. Check your order ID and phone number." });

        const { error } = await supabase.from("reviews").insert({
            product_id: productId,
            order_id: orderId,
            name,
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
        const body = await readBody(req);
        const customer = body.customer || {};
        const name = String(customer.name || "").trim();
        const phone = String(customer.phone || "").trim();
        if (!name || !phone) return json(res, 400, { error: "Name and mobile number are required." });
        if (!Array.isArray(body.items) || !body.items.length) return json(res, 400, { error: "Your bag is empty." });

        /* Email must have been verified in the last 30 min */
        const customerEmail = String(customer.email || "").trim().toLowerCase();
        const vt = body.verificationToken ? verifiedEmails.get(body.verificationToken) : null;
        if (!vt || vt.email !== customerEmail || vt.expiresAt < Date.now()) {
            return json(res, 403, { error: "Email address not verified. Please complete email verification." });
        }
        verifiedEmails.delete(body.verificationToken); /* single-use */

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

        const { error: orderErr } = await supabase.from("orders").insert(order);
        if (orderErr) return dbErr(res, orderErr);

        return json(res, 201, { ok: true, order: { id: order.id, total: order.total, authorization: order.payment.authorization } });
    }

    if (pathname === "/api/otp/send" && method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json(res, 400, { error: "Please enter a valid email address." });
        }
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); /* 10 min */

        await supabase.from("email_verifications").delete().eq("email", email).eq("verified", false);
        const { error } = await supabase.from("email_verifications").insert({ email, code, expires_at: expiresAt });
        if (error) return dbErr(res, error);

        const transport = await getTransport();
        const info = await transport.sendMail({
            from: process.env.SMTP_FROM || '"Lumina Candles" <noreply@lumina.store>',
            to: email,
            subject: "Your Lumina verification code",
            text: "Your verification code is: " + code + "\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.",
            html: '<div style="font-family:Georgia,serif;max-width:480px;margin:0 auto;padding:32px;background:#faf8f5;border:1px solid #e8d8c4;">' +
                '<h2 style="color:#A8763E;letter-spacing:.1em;font-size:22px;margin:0 0 16px">Lumina</h2>' +
                '<p style="color:#333;font-size:16px;margin:0 0 8px">Your verification code is:</p>' +
                '<div style="font-size:40px;font-weight:bold;letter-spacing:.3em;color:#333;padding:20px 0;">' + code + '</div>' +
                '<p style="color:#888;font-size:13px;margin:16px 0 0">Expires in 10 minutes. If you didn\'t request this, ignore this email.</p></div>'
        });

        const testMode = !process.env.SMTP_HOST;
        if (testMode) {
            console.log("[EMAIL OTP] To: " + email + "  Code: " + code + "  Preview: " + nodemailer.getTestMessageUrl(info));
        }

        return json(res, 200, { ok: true, testMode });
    }

    if (pathname === "/api/otp/verify" && method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        const code = String(body.code || "").trim();
        if (!email || !code) return json(res, 400, { error: "Email and code are required." });

        const { data: row, error } = await supabase
            .from("email_verifications")
            .select("*")
            .eq("email", email)
            .eq("code", code)
            .eq("verified", false)
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) return dbErr(res, error);
        if (!row) return json(res, 400, { error: "Invalid or expired code. Please request a new one." });

        await supabase.from("email_verifications").update({ verified: true }).eq("id", row.id);

        const token = crypto.randomBytes(24).toString("hex");
        verifiedEmails.set(token, { email, expiresAt: Date.now() + 30 * 60 * 1000 });
        return json(res, 200, { ok: true, verificationToken: token });
    }

    /* -- user auth -- */

    if (pathname === "/api/auth/signup" && method === "POST") {
        const body = await readBody(req);
        const name = String(body.name || "").trim();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!name) return json(res, 400, { error: "Full name is required." });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "Please enter a valid email address." });
        if (password.length < 8) return json(res, 400, { error: "Password must be at least 8 characters." });

        const { data: existing } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
        if (existing) return json(res, 409, { error: "An account with this email already exists." });

        const password_hash = await bcrypt.hash(password, 10);
        const { data: user, error: insertErr } = await supabase
            .from("users").insert({ name, email, password_hash }).select("id,name,email").single();
        if (insertErr) return dbErr(res, insertErr);

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); /* 30 days */
        await supabase.from("user_sessions").insert({ token, user_id: user.id, expires_at: expiresAt });

        res.setHeader("Set-Cookie", "lumina_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (30 * 24 * 60 * 60));
        return json(res, 201, { ok: true, user: { id: user.id, name: user.name, email: user.email } });
    }

    if (pathname === "/api/auth/login" && method === "POST") {
        const body = await readBody(req);
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        if (!email || !password) return json(res, 400, { error: "Email and password are required." });

        const { data: user } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return json(res, 401, { error: "Incorrect email or password." });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await supabase.from("user_sessions").insert({ token, user_id: user.id, expires_at: expiresAt });

        res.setHeader("Set-Cookie", "lumina_session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (30 * 24 * 60 * 60));
        return json(res, 200, { ok: true, user: { id: user.id, name: user.name, email: user.email } });
    }

    if (pathname === "/api/auth/logout" && method === "POST") {
        const token = parseCookie(req.headers.cookie || "").lumina_session;
        if (token) await supabase.from("user_sessions").delete().eq("token", token);
        res.setHeader("Set-Cookie", "lumina_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
        return json(res, 200, { ok: true });
    }

    if (pathname === "/api/auth/me" && method === "GET") {
        const token = parseCookie(req.headers.cookie || "").lumina_session;
        if (!token) return json(res, 401, { error: "Not logged in." });
        const { data: session } = await supabase
            .from("user_sessions").select("*, users(id,name,email)").eq("token", token)
            .gt("expires_at", new Date().toISOString()).maybeSingle();
        if (!session) return json(res, 401, { error: "Session expired." });
        return json(res, 200, { user: session.users });
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
