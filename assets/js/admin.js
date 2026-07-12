/* Lumina — admin dashboard: overview stats, orders, live inventory, product
   management (add / edit / photo change), and newsletter subscribers.
   Talks to the store API in server.js; sign in with the admin password. */
(function () {
    "use strict";

    var TOKEN_KEY = "lumina-admin-token";
    var state = { products: [], orders: [], subscribers: [], revenue: 0, reviews: [] };
    var activeTab = "overview";
    var pollTimer = null;

    var loginView = document.getElementById("login-view");
    var adminView = document.getElementById("admin-view");

    /* ---- helpers ---- */

    function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }

    function escapeHtml(text) {
        return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function money(n) { return "$" + Number(n || 0).toFixed(2); }

    function formatDate(iso) {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
            " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }

    var toastTimer;
    function showToast(message) {
        var toast = document.getElementById("toast");
        if (!toast) {
            toast = document.createElement("div");
            toast.id = "toast";
            toast.setAttribute("role", "status");
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        requestAnimationFrame(function () { toast.classList.add("show"); });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toast.classList.remove("show"); }, 2600);
    }

    function api(path, options) {
        options = options || {};
        options.headers = Object.assign({ "Content-Type": "application/json", "x-admin-token": token() }, options.headers || {});
        return fetch(path, options).then(function (res) {
            return res.json().then(function (data) {
                if (res.status === 401 && path !== "/api/admin/login") {
                    logout();
                    throw new Error("Session expired — sign in again.");
                }
                if (!res.ok) throw new Error(data.error || "Request failed");
                return data;
            });
        });
    }

    /* ---- auth ---- */

    var loginForm = document.getElementById("login-form");
    loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var errorEl = document.getElementById("login-error");
        errorEl.classList.add("hidden");
        api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({ password: document.getElementById("admin-password").value })
        }).then(function (data) {
            sessionStorage.setItem(TOKEN_KEY, data.token);
            enter();
        }).catch(function (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove("hidden");
        });
    });

    document.getElementById("logout-btn").addEventListener("click", logout);

    function logout() {
        sessionStorage.removeItem(TOKEN_KEY);
        clearInterval(pollTimer);
        adminView.classList.add("hidden");
        loginView.classList.remove("hidden");
    }

    function enter() {
        loginView.classList.add("hidden");
        adminView.classList.remove("hidden");
        refresh(true);
        clearInterval(pollTimer);
        /* live updates — new orders and subscribers appear without a reload */
        pollTimer = setInterval(function () { refresh(false); }, 10000);
    }

    function refresh(renderProductsToo) {
        return Promise.all([
            api("/api/admin/summary"),
            api("/api/admin/reviews")
        ]).then(function (results) {
            state = Object.assign({}, results[0], { reviews: results[1].reviews || [] });
            renderBadges();
            if (activeTab === "products" && !renderProductsToo) return; /* don't wipe in-progress edits */
            renderTab(activeTab);
        }).catch(function (err) {
            if (err.message) showToast(err.message);
        });
    }

    /* ---- tabs ---- */

    document.querySelectorAll("[data-tab-btn]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll("[data-tab-btn]").forEach(function (b) { b.classList.remove("tab-active"); });
            btn.classList.add("tab-active");
            activeTab = btn.getAttribute("data-tab-btn");
            document.querySelectorAll("[data-tab]").forEach(function (section) {
                section.classList.toggle("hidden", section.getAttribute("data-tab") !== activeTab);
            });
            renderTab(activeTab);
        });
    });

    function renderBadges() {
        var pendingReviews = state.reviews.filter(function (r) { return r.status === "pending"; }).length;
        var badges = { orders: state.orders.length, newsletter: state.subscribers.length, reviews: pendingReviews };
        Object.keys(badges).forEach(function (key) {
            var el = document.querySelector('[data-badge="' + key + '"]');
            if (el) {
                el.textContent = "(" + badges[key] + ")";
                el.classList.remove("hidden");
            }
        });
    }

    function section(name) {
        return document.querySelector('[data-tab="' + name + '"]');
    }

    function renderTab(name) {
        if (name === "overview") renderOverview();
        if (name === "orders") renderOrders();
        if (name === "products") renderProducts();
        if (name === "newsletter") renderNewsletter();
        if (name === "reviews") renderReviews();
    }

    /* ---- overview ---- */

    function renderOverview() {
        var lowStock = state.products.filter(function (p) { return p.status === "active" && p.stock <= 5; });
        var el = section("overview");
        el.innerHTML =
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-8">Overview</h2>' +
            '<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">' +
            statCard("receipt_long", state.orders.length, "Orders placed") +
            statCard("payments", money(state.revenue), "Revenue (test mode)") +
            statCard("mail", state.subscribers.length, "Newsletter subscribers") +
            statCard("inventory_2", lowStock.length, "Low stock alerts") +
            "</div>" +
            (lowStock.length ?
                '<div class="mb-10 border border-copper-bronze/30 bg-toasted-almond/30 px-6 py-4">' +
                '<p class="font-body-md text-body-md text-deep-charcoal"><strong>Running low:</strong> ' +
                lowStock.map(function (p) { return escapeHtml(p.name) + " (" + p.stock + " left)"; }).join(", ") +
                ' — update stock in the Products tab.</p></div>' : "") +
            '<h3 class="font-headline-md text-[24px] text-deep-charcoal mb-4">Sales by product</h3>' +
            '<div class="overflow-x-auto border border-copper-bronze/20 bg-light-cream">' +
            '<table class="w-full text-left font-body-md text-body-md">' +
            '<thead><tr class="border-b border-copper-bronze/20">' +
            th("Product") + th("Price") + th("Units sold") + th("Revenue") + th("In stock") + th("Status") +
            "</tr></thead><tbody>" +
            state.products.map(function (p) {
                return '<tr class="border-b border-copper-bronze/10">' +
                    td('<span class="text-deep-charcoal">' + escapeHtml(p.name) + "</span>") +
                    td(money(p.price)) +
                    td(String(p.unitsSold)) +
                    td(money(p.unitsSold * p.price)) +
                    td(p.stock <= 0 ? '<span class="text-error font-bold">0 — sold out</span>' : (p.stock <= 5 ? '<span class="text-copper-bronze font-bold">' + p.stock + "</span>" : String(p.stock))) +
                    td(statusPill(p.status)) +
                    "</tr>";
            }).join("") +
            "</tbody></table></div>";
    }

    function statCard(icon, value, label) {
        return '<div class="bg-light-cream border border-copper-bronze/20 px-6 py-5">' +
            '<span class="material-symbols-outlined text-copper-bronze mb-2">' + icon + "</span>" +
            '<p class="font-headline-md text-[28px] text-deep-charcoal leading-tight">' + value + "</p>" +
            '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mt-1">' + label + "</p></div>";
    }

    function th(text) { return '<th class="px-4 py-3 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">' + text + "</th>"; }
    function td(html) { return '<td class="px-4 py-3 text-on-surface-variant align-middle">' + html + "</td>"; }

    function statusPill(status) {
        return status === "active"
            ? '<span class="inline-block bg-sage-green text-white font-label-caps text-[10px] px-3 py-1 rounded-full uppercase tracking-widest">Live</span>'
            : '<span class="inline-block bg-deep-charcoal/70 text-white font-label-caps text-[10px] px-3 py-1 rounded-full uppercase tracking-widest">Hidden</span>';
    }

    /* ---- orders ---- */

    var ORDER_STATUSES = ["new", "packed", "shipped", "delivered", "cancelled"];

    function renderOrders() {
        var el = section("orders");
        if (!state.orders.length) {
            el.innerHTML = '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-8">Orders</h2>' +
                '<p class="font-body-md text-body-md text-on-surface-variant py-12 text-center border border-copper-bronze/20 bg-light-cream">No orders yet. Orders placed through the shop checkout will appear here instantly.</p>';
            return;
        }
        el.innerHTML =
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-8">Orders <span class="text-on-surface-variant text-[20px]">(' + state.orders.length + ")</span></h2>" +
            '<div class="flex flex-col gap-4">' +
            state.orders.map(function (order) {
                return '<div class="bg-light-cream border border-copper-bronze/20 px-6 py-5">' +
                    '<div class="flex flex-wrap items-start justify-between gap-4 mb-4">' +
                    '<div><p class="font-headline-md text-[20px] text-deep-charcoal">' + escapeHtml(order.id) +
                    ' <span class="font-body-md text-sm text-on-surface-variant font-normal">· ' + formatDate(order.date) + "</span></p>" +
                    '<p class="font-body-md text-body-md text-copper-bronze font-bold mt-1">' + money(order.total) + "</p></div>" +
                    '<label class="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Status ' +
                    '<select class="border border-copper-bronze/40 bg-background text-deep-charcoal font-body-md text-sm py-1 pl-2 pr-8 focus:ring-0 focus:border-copper-bronze" data-order-status="' + escapeHtml(order.id) + '">' +
                    ORDER_STATUSES.map(function (s) {
                        return '<option value="' + s + '"' + (order.status === s ? " selected" : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</option>";
                    }).join("") +
                    "</select></label></div>" +
                    '<div class="grid md:grid-cols-2 gap-4">' +
                    '<div class="border border-copper-bronze/10 bg-background px-4 py-3">' +
                    '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-2">Customer</p>' +
                    '<p class="text-deep-charcoal">' + escapeHtml(order.customer.name) + "</p>" +
                    '<p class="text-on-surface-variant"><span class="material-symbols-outlined text-sm align-middle">call</span> ' + escapeHtml(order.customer.phone) + "</p>" +
                    (order.customer.email ? '<p class="text-on-surface-variant"><span class="material-symbols-outlined text-sm align-middle">mail</span> ' + escapeHtml(order.customer.email) + "</p>" : "") +
                    (order.customer.address ? '<p class="text-on-surface-variant"><span class="material-symbols-outlined text-sm align-middle">home</span> ' + escapeHtml(order.customer.address) + "</p>" : "") +
                    "</div>" +
                    '<div class="border border-copper-bronze/10 bg-background px-4 py-3">' +
                    '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-2">Items &amp; payment</p>' +
                    order.items.map(function (item) {
                        return '<p class="text-on-surface-variant">' + escapeHtml(item.name) + " × " + item.qty + ' <span class="text-deep-charcoal">' + money(item.price * item.qty) + "</span></p>";
                    }).join("") +
                    '<p class="font-label-caps text-[10px] text-on-surface-variant/80 uppercase tracking-widest mt-2">' +
                    escapeHtml(order.payment.mode) + " · card ····" + escapeHtml(order.payment.last4) + " · " + escapeHtml(order.payment.authorization) + "</p>" +
                    "</div></div></div>";
            }).join("") + "</div>";

        el.querySelectorAll("[data-order-status]").forEach(function (select) {
            select.addEventListener("change", function () {
                api("/api/admin/orders/" + select.getAttribute("data-order-status"), {
                    method: "PUT",
                    body: JSON.stringify({ status: select.value })
                }).then(function () {
                    showToast("Order " + select.getAttribute("data-order-status") + " marked " + select.value);
                }).catch(function (err) { showToast(err.message); });
            });
        });
    }

    /* ---- products ---- */

    var CATEGORIES = ["pillar", "glass", "scented"];

    function renderProducts() {
        var el = section("products");
        el.innerHTML =
            '<div class="flex flex-wrap items-center justify-between gap-4 mb-8">' +
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal">Products</h2>' +
            '<button class="btn-sheen px-6 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" data-add-product="">+ Add New Product</button></div>' +
            '<div class="hidden mb-8" data-add-form-wrap=""></div>' +
            '<p class="font-body-md text-sm text-on-surface-variant mb-6">Changes save instantly and the shop updates live. "Hidden" products stay in your catalog but are not shown to customers.</p>' +
            '<div class="flex flex-col gap-4" data-product-list="">' +
            state.products.map(productRowHtml).join("") +
            "</div>";

        el.querySelector("[data-add-product]").addEventListener("click", function () {
            var wrap = el.querySelector("[data-add-form-wrap]");
            if (wrap.classList.contains("hidden")) {
                wrap.innerHTML = addFormHtml();
                wrap.classList.remove("hidden");
                bindAddForm(wrap);
            } else {
                wrap.classList.add("hidden");
                wrap.innerHTML = "";
            }
        });

        state.products.forEach(function (p) { bindProductRow(el, p); });
    }

    function productRowHtml(p) {
        var images = Array.isArray(p.images) && p.images.length ? p.images : (p.image ? [p.image] : []);
        var colors = Array.isArray(p.colors) ? p.colors : [];
        return '<div class="bg-light-cream border border-copper-bronze/20 px-5 py-5 flex flex-col md:flex-row gap-5" data-product-row="' + escapeHtml(p.id) + '" data-images=\'' + escapeHtml(JSON.stringify(images)) + '\' data-colors=\'' + escapeHtml(JSON.stringify(colors)) + '\'>' +
            /* photos + add */
            '<div class="flex flex-col items-center gap-2 shrink-0">' +
            '<div class="flex flex-wrap gap-2 w-28" data-photo-list="">' +
            images.map(function (img, i) {
                return '<div class="relative w-12 h-14 bg-surface-container-low border border-copper-bronze/10" style="background-image:url(\'' + escapeHtml(img) + '\');background-size:cover;background-position:center">' +
                    '<button class="absolute -top-1 -right-1 w-4 h-4 bg-deep-charcoal text-white text-[10px] leading-none rounded-full" data-remove-photo="' + i + '" aria-label="Remove photo">×</button></div>';
            }).join("") + "</div>" +
            '<label class="cursor-pointer font-label-caps text-[10px] text-copper-bronze uppercase tracking-widest hover:underline">Add photos' +
            '<input accept="image/*" class="hidden" data-photo-input="" multiple="" type="file"/></label></div>' +
            /* fields */
            '<div class="flex-grow grid sm:grid-cols-2 gap-4">' +
            fieldHtml("Name", '<input class="admin-field" data-field="name" type="text" value="' + escapeHtml(p.name) + '"/>') +
            fieldHtml("Price ($)", '<input class="admin-field" data-field="price" type="number" min="0" step="0.01" value="' + p.price + '"/>') +
            fieldHtml("Tag (badge on card)", '<input class="admin-field" data-field="tag" type="text" value="' + escapeHtml(p.tag || "") + '"/>') +
            fieldHtml("Categories", '<div class="flex gap-4 pt-2">' + CATEGORIES.map(function (c) {
                return '<label class="flex items-center gap-1 font-body-md text-sm text-on-surface-variant"><input class="rounded border-copper-bronze/50 text-copper-bronze focus:ring-copper-bronze" data-category-box="' + c + '" type="checkbox"' + (p.categories.indexOf(c) !== -1 ? " checked" : "") + "/>" + c + "</label>";
            }).join("") + "</div>") +
            '<div class="sm:col-span-2">' +
            '<label class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Colors</label>' +
            '<div class="flex flex-wrap gap-3 pt-2" data-color-list=""></div>' +
            '<button class="mt-2 font-label-caps text-[10px] text-copper-bronze uppercase tracking-widest hover:underline" data-add-color="" type="button">+ Add color</button>' +
            "</div>" +
            "</div>" +
            /* stock + status + actions */
            '<div class="flex md:flex-col items-center md:items-end justify-between gap-4 shrink-0">' +
            '<div class="text-center md:text-right">' +
            '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-2">Stock left</p>' +
            '<div class="flex items-center gap-2">' +
            '<button aria-label="Decrease stock" class="w-8 h-8 border border-copper-bronze/40 text-copper-bronze hover:bg-copper-bronze hover:text-white transition-colors" data-stock-minus="">−</button>' +
            '<input class="w-16 text-center border border-copper-bronze/40 bg-background text-deep-charcoal font-body-md py-1 focus:ring-0 focus:border-copper-bronze" data-field="stock" min="0" type="number" value="' + p.stock + '"/>' +
            '<button aria-label="Increase stock" class="w-8 h-8 border border-copper-bronze/40 text-copper-bronze hover:bg-copper-bronze hover:text-white transition-colors" data-stock-plus="">+</button></div>' +
            (p.stock <= 5 ? '<p class="font-label-caps text-[10px] text-error uppercase tracking-widest mt-1">' + (p.stock <= 0 ? "Sold out" : "Running low") + "</p>" : "") +
            "</div>" +
            '<div class="flex md:flex-col items-center md:items-end gap-3">' +
            '<button data-status-toggle="">' + statusPill(p.status) + "</button>" +
            '<div class="flex gap-2">' +
            '<button class="btn-sheen px-5 py-2 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" data-save-product="">Save</button>' +
            '<button aria-label="Delete product" class="px-2 py-2 text-on-surface-variant hover:text-error transition-colors" data-delete-product=""><span class="material-symbols-outlined">delete</span></button>' +
            "</div></div></div></div>";
    }

    function colorRowHtml(color, index) {
        color = color || {};
        return '<div class="flex items-center gap-2 border border-copper-bronze/20 bg-background px-2 py-1" data-color-row="' + index + '">' +
            '<input class="w-8 h-8 border-0 p-0 cursor-pointer" data-color-hex="" type="color" value="' + escapeHtml(color.hex || "#a8763e") + '"/>' +
            '<input class="admin-field w-24 text-sm" data-color-name="" placeholder="Ivory" type="text" value="' + escapeHtml(color.name || "") + '"/>' +
            '<label class="cursor-pointer font-label-caps text-[9px] text-copper-bronze uppercase tracking-widest hover:underline">Photo' +
            '<input accept="image/*" class="hidden" data-color-photo-input="" type="file"/></label>' +
            '<button class="text-on-surface-variant hover:text-error text-sm" data-remove-color="" type="button" aria-label="Remove color">×</button>' +
            '</div>';
    }

    function renderColorList(row, colors) {
        row.setAttribute("data-colors", JSON.stringify(colors));
        var list = row.querySelector("[data-color-list]");
        list.innerHTML = colors.map(colorRowHtml).join("");
        list.querySelectorAll("[data-color-row]").forEach(function (colorRow) {
            var idx = parseInt(colorRow.getAttribute("data-color-row"), 10);
            colorRow.querySelector("[data-remove-color]").addEventListener("click", function () {
                colors.splice(idx, 1);
                renderColorList(row, colors);
            });
            colorRow.querySelector("[data-color-photo-input]").addEventListener("change", function (event) {
                var file = event.target.files[0];
                if (!file) return;
                uploadImage(file, (colors[idx].name || "color")).then(function (path) {
                    colors[idx].image = path;
                    row.setAttribute("data-colors", JSON.stringify(colors));
                    showToast("Color photo attached — click Save to apply");
                }).catch(function (err) { showToast(err.message); });
            });
        });
    }

    function fieldHtml(label, control) {
        return '<div><label class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">' + label + "</label>" + control + "</div>";
    }

    function rowValues(row) {
        var categories = CATEGORIES.filter(function (c) {
            return row.querySelector('[data-category-box="' + c + '"]').checked;
        });
        return {
            name: row.querySelector('[data-field="name"]').value,
            price: parseFloat(row.querySelector('[data-field="price"]').value) || 0,
            tag: row.querySelector('[data-field="tag"]').value,
            stock: Math.max(0, parseInt(row.querySelector('[data-field="stock"]').value, 10) || 0),
            categories: categories.length ? categories : ["glass"],
            images: rowImages(row),
            colors: rowColors(row)
        };
    }

    function rowImages(row) { return JSON.parse(row.getAttribute("data-images") || "[]"); }

    function rowColors(row) {
        var stored = JSON.parse(row.getAttribute("data-colors") || "[]");
        var rows = row.querySelectorAll("[data-color-row]");
        if (!rows.length) return stored;
        return Array.prototype.map.call(rows, function (colorRow) {
            var idx = parseInt(colorRow.getAttribute("data-color-row"), 10);
            return {
                name: colorRow.querySelector("[data-color-name]").value.trim(),
                hex: colorRow.querySelector("[data-color-hex]").value,
                image: (stored[idx] || {}).image
            };
        }).filter(function (c) { return c.name; });
    }

    function renderPhotoList(row, images) {
        var list = row.querySelector("[data-photo-list]");
        list.innerHTML = images.map(function (img, i) {
            return '<div class="relative w-12 h-14 bg-surface-container-low border border-copper-bronze/10" style="background-image:url(\'' + img + '\');background-size:cover;background-position:center">' +
                '<button class="absolute -top-1 -right-1 w-4 h-4 bg-deep-charcoal text-white text-[10px] leading-none rounded-full" data-remove-photo="' + i + '" aria-label="Remove photo">×</button></div>';
        }).join("");
        list.querySelectorAll("[data-remove-photo]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                images.splice(parseInt(btn.getAttribute("data-remove-photo"), 10), 1);
                row.setAttribute("data-images", JSON.stringify(images));
                renderPhotoList(row, images);
            });
        });
    }

    function bindProductRow(el, product) {
        var row = el.querySelector('[data-product-row="' + product.id + '"]');
        if (!row) return;
        var stockInput = row.querySelector('[data-field="stock"]');
        var colors = rowColors(row);
        renderColorList(row, colors);

        row.querySelector("[data-add-color]").addEventListener("click", function () {
            colors.push({ name: "", hex: "#a8763e" });
            renderColorList(row, colors);
        });

        renderPhotoList(row, rowImages(row));

        row.querySelector("[data-stock-minus]").addEventListener("click", function () {
            stockInput.value = Math.max(0, (parseInt(stockInput.value, 10) || 0) - 1);
            saveRow();
        });
        row.querySelector("[data-stock-plus]").addEventListener("click", function () {
            stockInput.value = (parseInt(stockInput.value, 10) || 0) + 1;
            saveRow();
        });
        stockInput.addEventListener("change", saveRow);
        row.querySelector("[data-save-product]").addEventListener("click", saveRow);

        row.querySelector("[data-status-toggle]").addEventListener("click", function () {
            var next = product.status === "active" ? "hidden" : "active";
            api("/api/admin/products/" + product.id, { method: "PUT", body: JSON.stringify({ status: next }) })
                .then(function () {
                    showToast(product.name + (next === "active" ? " is now live on the shop" : " hidden from the shop"));
                    refresh(true);
                }).catch(function (err) { showToast(err.message); });
        });

        row.querySelector("[data-delete-product]").addEventListener("click", function () {
            if (!confirm('Delete "' + product.name + '" permanently? (Tip: use Hidden to take it off the shop without deleting.)')) return;
            api("/api/admin/products/" + product.id, { method: "DELETE" })
                .then(function () {
                    showToast(product.name + " deleted");
                    refresh(true);
                }).catch(function (err) { showToast(err.message); });
        });

        row.querySelector("[data-photo-input]").addEventListener("change", function (event) {
            var files = Array.prototype.slice.call(event.target.files);
            if (!files.length) return;
            Promise.all(files.map(function (file) { return uploadImage(file, product.name); }))
                .then(function (paths) {
                    var images = rowImages(row).concat(paths);
                    row.setAttribute("data-images", JSON.stringify(images));
                    renderPhotoList(row, images);
                    return api("/api/admin/products/" + product.id, { method: "PUT", body: JSON.stringify({ images: images }) });
                })
                .then(function () { showToast("Photos updated — live on the shop"); })
                .catch(function (err) { showToast(err.message); });
        });

        function saveRow() {
            api("/api/admin/products/" + product.id, { method: "PUT", body: JSON.stringify(rowValues(row)) })
                .then(function (data) {
                    Object.assign(product, data.product);
                    showToast(product.name + " updated — shop reflects it live");
                }).catch(function (err) { showToast(err.message); });
        }
    }

    function uploadImage(file, name) {
        return new Promise(function (resolve, reject) {
            if (file.size > 8 * 1024 * 1024) return reject(new Error("Image is too large (max 8 MB)."));
            var reader = new FileReader();
            reader.onload = function () {
                api("/api/admin/upload", { method: "POST", body: JSON.stringify({ name: name, dataUrl: reader.result }) })
                    .then(function (data) { resolve(data.path); })
                    .catch(reject);
            };
            reader.onerror = function () { reject(new Error("Could not read that file.")); };
            reader.readAsDataURL(file);
        });
    }

    function addFormHtml() {
        return '<form class="bg-light-cream border border-copper-bronze/30 px-6 py-6" data-new-product="">' +
            '<h3 class="font-headline-md text-[24px] text-deep-charcoal mb-4">New product</h3>' +
            '<div class="grid sm:grid-cols-2 gap-4 mb-4">' +
            fieldHtml("Name *", '<input class="admin-field" name="name" required type="text" placeholder="Golden Hour"/>') +
            fieldHtml("Price ($) *", '<input class="admin-field" name="price" required type="number" min="0" step="0.01" placeholder="40.00"/>') +
            fieldHtml("Starting stock", '<input class="admin-field" name="stock" type="number" min="0" value="10"/>') +
            fieldHtml("Tag (badge on card)", '<input class="admin-field" name="tag" type="text" placeholder="Hand-Poured"/>') +
            fieldHtml("Categories", '<div class="flex gap-4 pt-2">' + CATEGORIES.map(function (c) {
                return '<label class="flex items-center gap-1 font-body-md text-sm text-on-surface-variant"><input class="rounded border-copper-bronze/50 text-copper-bronze focus:ring-copper-bronze" name="cat-' + c + '" type="checkbox"' + (c === "glass" ? " checked" : "") + "/>" + c + "</label>";
            }).join("") + "</div>") +
            fieldHtml("Photos", '<input accept="image/*" class="block pt-2 font-body-md text-sm text-on-surface-variant" multiple="" name="photos" type="file"/>') +
            '<div class="sm:col-span-2">' +
            '<label class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest">Colors</label>' +
            '<div class="flex flex-wrap gap-3 pt-2" data-new-color-list=""></div>' +
            '<button class="mt-2 font-label-caps text-[10px] text-copper-bronze uppercase tracking-widest hover:underline" data-add-new-color="" type="button">+ Add color</button>' +
            "</div>" +
            "</div>" +
            '<button class="btn-sheen px-8 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" type="submit">Create Product</button></form>';
    }

    function bindAddForm(wrap) {
        var form = wrap.querySelector("[data-new-product]");
        var newColors = [];

        function renderNewColorList() {
            var list = form.querySelector("[data-new-color-list]");
            list.innerHTML = newColors.map(colorRowHtml).join("");
            list.querySelectorAll("[data-color-row]").forEach(function (colorRow) {
                var idx = parseInt(colorRow.getAttribute("data-color-row"), 10);
                colorRow.querySelector("[data-remove-color]").addEventListener("click", function () {
                    newColors.splice(idx, 1);
                    renderNewColorList();
                });
                colorRow.querySelector("[data-color-photo-input]").addEventListener("change", function (event) {
                    var file = event.target.files[0];
                    if (!file) return;
                    uploadImage(file, (newColors[idx].name || "color")).then(function (path) {
                        newColors[idx].image = path;
                        showToast("Color photo attached");
                    }).catch(function (err) { showToast(err.message); });
                });
            });
        }
        form.querySelector("[data-add-new-color]").addEventListener("click", function () {
            newColors.push({ name: "", hex: "#a8763e" });
            renderNewColorList();
        });

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;
            var categories = CATEGORIES.filter(function (c) { return form["cat-" + c].checked; });
            var files = Array.prototype.slice.call(form.photos.files);
            var colors = newColors
                .map(function (c, i) {
                    var row = form.querySelectorAll("[data-color-row]")[i];
                    return { name: row.querySelector("[data-color-name]").value.trim(), hex: row.querySelector("[data-color-hex]").value, image: c.image };
                })
                .filter(function (c) { return c.name; });
            var imagesPromise = files.length ? Promise.all(files.map(function (f) { return uploadImage(f, form.name.value); })) : Promise.resolve([]);
            imagesPromise.then(function (images) {
                return api("/api/admin/products", {
                    method: "POST",
                    body: JSON.stringify({
                        name: form.name.value,
                        price: form.price.value,
                        stock: form.stock.value,
                        tag: form.tag.value,
                        categories: categories,
                        images: images,
                        colors: colors
                    })
                });
            }).then(function (data) {
                showToast(data.product.name + " added — live on the shop");
                refresh(true);
            }).catch(function (err) { showToast(err.message); });
        });
    }

    /* ---- newsletter ---- */

    function renderNewsletter() {
        var el = section("newsletter");
        el.innerHTML =
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-2">Newsletter</h2>' +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-8">Everyone who clicked Subscribe on the site lands here — no emails are sent to them.</p>' +
            (!state.subscribers.length
                ? '<p class="font-body-md text-body-md text-on-surface-variant py-12 text-center border border-copper-bronze/20 bg-light-cream">No subscribers yet. Signups from the footer form on any page appear here instantly.</p>'
                : '<div class="overflow-x-auto border border-copper-bronze/20 bg-light-cream">' +
                '<table class="w-full text-left font-body-md text-body-md">' +
                '<thead><tr class="border-b border-copper-bronze/20">' + th("#") + th("Email") + th("Signed up from") + th("Date") + "</tr></thead><tbody>" +
                state.subscribers.slice().reverse().map(function (s, i) {
                    return '<tr class="border-b border-copper-bronze/10">' +
                        td(String(state.subscribers.length - i)) +
                        td('<span class="text-deep-charcoal">' + escapeHtml(s.email) + "</span>") +
                        td(escapeHtml(s.source || "site")) +
                        td(formatDate(s.date)) + "</tr>";
                }).join("") +
                "</tbody></table></div>");
    }

    /* ---- reviews ---- */

    function renderReviews() {
        var el = section("reviews");
        var sorted = state.reviews.slice().sort(function (a, b) {
            if (a.status === b.status) return new Date(b.created_at) - new Date(a.created_at);
            return a.status === "pending" ? -1 : 1;
        });
        el.innerHTML =
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-2">Reviews</h2>' +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-8">Approve reviews to publish them on the product page. Pending reviews are hidden from customers.</p>' +
            (!sorted.length
                ? '<p class="font-body-md text-body-md text-on-surface-variant py-12 text-center border border-copper-bronze/20 bg-light-cream">No reviews yet.</p>'
                : '<div class="flex flex-col gap-4">' + sorted.map(reviewRowHtml).join("") + "</div>");

        sorted.forEach(function (r) { bindReviewRow(el, r); });
    }

    function reviewRowHtml(r) {
        var product = state.products.filter(function (p) { return p.id === r.product_id; })[0];
        var starsHtml = "";
        for (var i = 1; i <= 5; i++) {
            starsHtml += '<span class="material-symbols-outlined text-base text-copper-bronze" style="font-variation-settings:\'FILL\' ' + (i <= r.rating ? 1 : 0) + '">star</span>';
        }
        return '<div class="bg-light-cream border border-copper-bronze/20 px-6 py-5" data-review-row="' + escapeHtml(r.id) + '">' +
            '<div class="flex flex-wrap items-start justify-between gap-4 mb-3">' +
            '<div><p class="font-headline-md text-[18px] text-deep-charcoal">' + escapeHtml(product ? product.name : r.product_id) + "</p>" +
            '<div class="flex items-center gap-1 mt-1">' + starsHtml + "</div></div>" +
            (r.status === "approved"
                ? '<span class="inline-block bg-sage-green text-white font-label-caps text-[10px] px-3 py-1 rounded-full uppercase tracking-widest">Approved</span>'
                : '<span class="inline-block bg-copper-bronze text-white font-label-caps text-[10px] px-3 py-1 rounded-full uppercase tracking-widest">Pending</span>') +
            "</div>" +
            (r.title ? '<p class="font-headline-md text-[16px] text-deep-charcoal mb-1">' + escapeHtml(r.title) + "</p>" : "") +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-3">' + escapeHtml(r.body) + "</p>" +
            '<p class="font-label-caps text-[10px] text-on-surface-variant/70 uppercase tracking-widest mb-4">' + escapeHtml(r.name) + " · Order " + escapeHtml(r.order_id) + " · " + formatDate(r.created_at) + "</p>" +
            '<div class="flex gap-2">' +
            (r.status !== "approved" ? '<button class="btn-sheen px-5 py-2 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" data-approve-review="">Approve</button>' : '<button class="px-5 py-2 border border-copper-bronze/40 text-on-surface-variant font-label-caps text-label-caps uppercase tracking-widest hover:border-copper-bronze" data-unapprove-review="">Unpublish</button>') +
            '<button class="px-2 py-2 text-on-surface-variant hover:text-error transition-colors" aria-label="Delete review" data-delete-review=""><span class="material-symbols-outlined">delete</span></button>' +
            "</div></div>";
    }

    function bindReviewRow(el, r) {
        var row = el.querySelector('[data-review-row="' + r.id + '"]');
        if (!row) return;
        var approveBtn = row.querySelector("[data-approve-review]");
        if (approveBtn) approveBtn.addEventListener("click", function () {
            api("/api/admin/reviews/" + r.id, { method: "PUT", body: JSON.stringify({ status: "approved" }) })
                .then(function () { showToast("Review approved — now live"); refresh(true); })
                .catch(function (err) { showToast(err.message); });
        });
        var unapproveBtn = row.querySelector("[data-unapprove-review]");
        if (unapproveBtn) unapproveBtn.addEventListener("click", function () {
            api("/api/admin/reviews/" + r.id, { method: "PUT", body: JSON.stringify({ status: "pending" }) })
                .then(function () { showToast("Review unpublished"); refresh(true); })
                .catch(function (err) { showToast(err.message); });
        });
        row.querySelector("[data-delete-review]").addEventListener("click", function () {
            if (!confirm("Delete this review permanently?")) return;
            api("/api/admin/reviews/" + r.id, { method: "DELETE" })
                .then(function () { showToast("Review deleted"); refresh(true); })
                .catch(function (err) { showToast(err.message); });
        });
    }

    /* ---- shared input styling (applied via a tiny stylesheet so the strings above stay readable) ---- */
    var style = document.createElement("style");
    style.textContent = ".admin-field{width:100%;background:transparent;border:0;border-bottom:1px solid rgba(168,118,62,.5);padding:.4rem 0;color:#333;outline:none;font-size:16px}.admin-field:focus{border-color:#A8763E;box-shadow:none}";
    document.head.appendChild(style);

    /* auto-enter if a token from this browser session is still valid */
    if (token()) {
        api("/api/admin/summary").then(function () { enter(); }).catch(function () { /* stay on login */ });
    }
})();
