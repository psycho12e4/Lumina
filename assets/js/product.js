/* Lumina — product detail page: image gallery, color swatches, and the
   customer review system (verified-purchase submissions, approved reviews
   shown, average rating computed client-side). */
(function () {
    "use strict";

    var root = document.querySelector("[data-product-root]");
    if (!root) return;

    var loadingEl = document.querySelector("[data-product-loading]");
    var contentEl = document.querySelector("[data-product-content]");
    var breadcrumbEl = document.querySelector("[data-breadcrumb-name]");

    var product = null;
    var reviews = [];
    var activeImage = 0;
    var selectedColor = null;

    function escapeHtml(text) {
        return String(text == null ? "" : text).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function stockLabel(p) {
        if (p.stock <= 0) return '<span class="text-error">Sold out</span>';
        if (p.stock <= 5) return '<span class="text-copper-bronze">Only ' + p.stock + " left</span>";
        return p.stock + " pieces available";
    }

    function stars(rating, size) {
        var full = Math.round(rating);
        var out = "";
        for (var i = 1; i <= 5; i++) {
            out += '<span class="material-symbols-outlined ' + (size || "text-lg") + ' text-copper-bronze" style="font-variation-settings:\'FILL\' ' + (i <= full ? 1 : 0) + '">star</span>';
        }
        return out;
    }

    function formatDate(iso) {
        var d = new Date(iso);
        return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }

    function galleryImages() {
        if (Array.isArray(product.images) && product.images.length) return product.images;
        return product.image ? [product.image] : [];
    }

    function render() {
        var images = galleryImages();
        var soldOut = product.stock <= 0;
        var avg = reviews.length ? reviews.reduce(function (s, r) { return s + r.rating; }, 0) / reviews.length : 0;

        contentEl.innerHTML =
            '<div class="grid md:grid-cols-2 gap-gutter">' +
            /* Gallery */
            '<div>' +
            '<div class="w-full aspect-square bg-surface-container-low fine-line-border mb-4" data-gallery-main="" style="background-image:url(\'' + escapeHtml(images[activeImage] || images[0] || "") + '\');background-size:cover;background-position:center"></div>' +
            (images.length > 1 ?
                '<div class="flex gap-3 flex-wrap" data-thumbs="">' +
                images.map(function (img, i) {
                    return '<button class="w-20 h-20 border-2 ' + (i === activeImage ? "thumb-active border-copper-bronze" : "border-transparent") + ' fine-line-border" data-thumb="' + i + '" style="background-image:url(\'' + escapeHtml(img) + '\');background-size:cover;background-position:center" aria-label="View photo ' + (i + 1) + '"></button>';
                }).join("") + "</div>" : "") +
            "</div>" +
            /* Details */
            '<div>' +
            (product.tag ? '<span class="inline-block bg-sage-green text-white font-label-caps text-[10px] px-3 py-1 rounded-full mb-4">' + escapeHtml(product.tag) + "</span>" : "") +
            '<h1 class="font-headline-lg text-headline-lg-mobile md:text-headline-lg text-deep-charcoal mb-2">' + escapeHtml(product.name) + "</h1>" +
            (reviews.length ? '<div class="flex items-center gap-2 mb-3">' + stars(avg) + '<span class="font-body-md text-sm text-on-surface-variant">' + avg.toFixed(1) + " (" + reviews.length + (reviews.length === 1 ? " review" : " reviews") + ")</span></div>" : "") +
            '<p class="font-headline-md text-[28px] text-copper-bronze mb-4">$' + Number(product.price).toFixed(2) + "</p>" +
            '<p class="font-label-caps text-label-caps text-on-surface-variant/70 mb-6">' + stockLabel(product) + "</p>" +
            (Array.isArray(product.colors) && product.colors.length ?
                '<div class="mb-6">' +
                '<p class="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest mb-3">Color' + (selectedColor ? ": " + escapeHtml(selectedColor.name) : "") + "</p>" +
                '<div class="flex gap-3" data-colors="">' +
                product.colors.map(function (c, i) {
                    return '<button class="w-9 h-9 rounded-full ' + (selectedColor && selectedColor.name === c.name ? "swatch-active" : "") + '" data-color="' + i + '" style="background:' + escapeHtml(c.hex || "#ccc") + '" title="' + escapeHtml(c.name) + '" aria-label="' + escapeHtml(c.name) + '"></button>';
                }).join("") + "</div></div>" : "") +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-8">' + escapeHtml(product.alt || "") + "</p>" +
            '<button class="btn-sheen w-full sm:w-auto px-10 py-4 bg-copper-bronze text-white font-body-md text-body-md hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed" data-add-to-cart=""' + (soldOut ? " disabled" : "") + ">" +
            (soldOut ? "Sold Out" : "Add to Cart") + "</button>" +
            "</div></div>" +
            /* Reviews */
            '<div class="mt-section-padding border-t border-copper-bronze/20 pt-12">' +
            '<h2 class="font-headline-md text-headline-md text-deep-charcoal mb-8">Reviews' + (reviews.length ? " (" + reviews.length + ")" : "") + "</h2>" +
            '<div class="grid md:grid-cols-2 gap-gutter">' +
            '<div data-review-list="">' +
            (!reviews.length ?
                '<p class="font-body-md text-body-md text-on-surface-variant py-8 text-center border border-copper-bronze/20 bg-light-cream">No reviews yet — be the first to share your experience.</p>' :
                reviews.map(function (r) {
                    return '<div class="border-b border-copper-bronze/10 pb-6 mb-6">' +
                        '<div class="flex items-center gap-2 mb-1">' + stars(r.rating, "text-base") + "</div>" +
                        (r.title ? '<p class="font-headline-md text-[18px] text-deep-charcoal mb-1">' + escapeHtml(r.title) + "</p>" : "") +
                        '<p class="font-body-md text-body-md text-on-surface-variant mb-2">' + escapeHtml(r.body) + "</p>" +
                        '<p class="font-label-caps text-[10px] text-on-surface-variant/70 uppercase tracking-widest">' + escapeHtml(r.name) + " · " + formatDate(r.created_at) + "</p></div>";
                }).join("")) +
            "</div>" +
            '<div>' +
            '<h3 class="font-headline-md text-[20px] text-deep-charcoal mb-4">Write a review</h3>' +
            '<p class="font-body-md text-sm text-on-surface-variant mb-4">Only verified purchasers can review — enter the order ID and phone number used at checkout.</p>' +
            '<form class="flex flex-col gap-4" data-review-form="">' +
            '<div class="grid sm:grid-cols-2 gap-4">' +
            '<input class="review-field" name="orderId" placeholder="Order ID (e.g. LUM-4)" required type="text"/>' +
            '<input class="review-field" name="phone" placeholder="Phone used at checkout" required type="text"/>' +
            "</div>" +
            '<input class="review-field" name="name" placeholder="Your name" required type="text"/>' +
            '<div class="star-input flex gap-1" data-star-input="" data-value="5">' +
            [1, 2, 3, 4, 5].map(function (i) {
                return '<span class="material-symbols-outlined text-2xl text-copper-bronze" data-star="' + i + '" style="font-variation-settings:\'FILL\' 1">star</span>';
            }).join("") + "</div>" +
            '<input class="review-field" name="title" placeholder="Review title (optional)" type="text"/>' +
            '<textarea class="review-field" name="body" placeholder="Share your experience…" required rows="4"></textarea>' +
            '<p class="font-body-md text-sm hidden" data-review-msg=""></p>' +
            '<button class="btn-sheen px-8 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" type="submit">Submit Review</button>' +
            "</form></div></div></div>";

        bindContent();
    }

    function bindContent() {
        contentEl.querySelectorAll("[data-thumb]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                activeImage = parseInt(btn.getAttribute("data-thumb"), 10);
                render();
            });
        });

        contentEl.querySelectorAll("[data-color]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var color = product.colors[parseInt(btn.getAttribute("data-color"), 10)];
                selectedColor = color;
                var images = galleryImages();
                if (color.image) {
                    var idx = images.indexOf(color.image);
                    activeImage = idx !== -1 ? idx : 0;
                    if (idx === -1) { images.unshift(color.image); activeImage = 0; }
                }
                render();
            });
        });

        var addBtn = contentEl.querySelector("[data-add-to-cart]");
        if (addBtn) {
            addBtn.addEventListener("click", function () {
                if (!window.Lumina) return;
                window.Lumina.addToCart({
                    id: product.id,
                    name: product.name + (selectedColor ? " — " + selectedColor.name : ""),
                    price: product.price,
                    maxStock: product.stock
                });
            });
        }

        var starInput = contentEl.querySelector("[data-star-input]");
        if (starInput) {
            var stars_ = starInput.querySelectorAll("[data-star]");
            function paintStars(value) {
                stars_.forEach(function (s) {
                    s.style.fontVariationSettings = "'FILL' " + (parseInt(s.getAttribute("data-star"), 10) <= value ? 1 : 0);
                });
            }
            stars_.forEach(function (s) {
                s.addEventListener("click", function () {
                    var value = parseInt(s.getAttribute("data-star"), 10);
                    starInput.setAttribute("data-value", value);
                    paintStars(value);
                });
            });
        }

        var form = contentEl.querySelector("[data-review-form]");
        if (form) {
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                var msg = form.querySelector("[data-review-msg]");
                var rating = parseInt(starInput ? starInput.getAttribute("data-value") : 5, 10);
                fetch("/api/reviews", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        productId: product.id,
                        orderId: form.orderId.value.trim(),
                        phone: form.phone.value.trim(),
                        name: form.name.value.trim(),
                        rating: rating,
                        title: form.title.value.trim(),
                        body: form.body.value.trim()
                    })
                }).then(function (res) {
                    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
                }).then(function (result) {
                    msg.classList.remove("hidden", "text-error", "text-sage-green");
                    if (!result.ok) {
                        msg.textContent = result.data.error || "Something went wrong.";
                        msg.classList.add("text-error");
                        return;
                    }
                    msg.textContent = "Thank you — your review has been submitted and is awaiting approval.";
                    msg.classList.add("text-sage-green");
                    form.reset();
                }).catch(function () {
                    msg.classList.remove("hidden");
                    msg.textContent = "Network error — please try again.";
                    msg.classList.add("text-error");
                });
            });
        }
    }

    var style = document.createElement("style");
    style.textContent = ".review-field{width:100%;background:transparent;border:0;border-bottom:1px solid rgba(168,118,62,.5);padding:.5rem 0;color:#333;outline:none;font-size:16px}.review-field:focus{border-color:#A8763E}";
    document.head.appendChild(style);

    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");

    if (!id) {
        loadingEl.textContent = "No product specified.";
        return;
    }

    fetch("/api/products/" + encodeURIComponent(id), { cache: "no-store" })
        .then(function (res) {
            if (!res.ok) throw new Error(res.status === 404 ? "Product not found." : "Could not load product.");
            return res.json();
        })
        .then(function (data) {
            product = data.product;
            reviews = data.reviews || [];
            document.title = "Lumina | " + product.name;
            if (breadcrumbEl) breadcrumbEl.textContent = "/ " + product.name;
            loadingEl.classList.add("hidden");
            contentEl.classList.remove("hidden");
            render();
        })
        .catch(function (err) {
            loadingEl.textContent = err.message || "Could not load product.";
        });
})();
