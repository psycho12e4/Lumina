/* Lumina — shop page: renders the product grid live from /api/products.
   Stock, prices, photos, and new products come from the store database,
   so changes made in the admin show up here (polled every 15s). */
(function () {
    "use strict";

    var grid = document.querySelector("[data-product-grid][data-dynamic]");
    if (!grid) return;

    var products = [];
    var activeFilter = "all";
    var sortDirection = 0; /* 0 none, 1 asc, -1 desc */

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function stockLabel(product) {
        if (product.stock <= 0) return '<span class="text-error">Sold out</span>';
        if (product.stock <= 5) return '<span class="text-copper-bronze">Only ' + product.stock + " left</span>";
        return product.stock + " pieces available";
    }

    function cardHtml(product, index) {
        var soldOut = product.stock <= 0;
        return '<div class="group flex flex-col relative border border-copper-bronze/10 bg-light-cream hover:border-copper-bronze/40 hover:shadow-lg transition-all duration-500" ' +
            'data-id="' + escapeHtml(product.id) + '" data-category="' + escapeHtml(product.categories.join(" ")) + '" data-price="' + product.price + '" data-reveal="" style="--reveal-delay:' + (index % 3) * 100 + 'ms">' +
            '<div class="relative w-full aspect-[4/5] overflow-hidden p-4">' +
            (product.tag ? '<div class="absolute top-6 left-6 z-10 bg-sage-green text-white font-label-caps text-[10px] px-3 py-1 rounded-full">' + escapeHtml(product.tag) + "</div>" : "") +
            (soldOut ? '<div class="absolute top-6 right-6 z-10 bg-deep-charcoal text-white font-label-caps text-[10px] px-3 py-1 rounded-full">Sold Out</div>' : "") +
            '<div class="w-full h-full bg-surface-container-low' + (soldOut ? " opacity-50 grayscale" : "") + '" role="img" aria-label="' + escapeHtml(product.alt || product.name) + '" style="background-image: url(\'' + escapeHtml(product.image) + '\'); background-size: cover; background-position: center;"></div>' +
            '<div class="absolute inset-x-4 bottom-4 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 md:translate-y-2 md:group-hover:translate-y-0 transition-all duration-300">' +
            '<button class="btn-sheen w-full bg-copper-bronze hover:bg-toasted-almond text-white hover:text-deep-charcoal font-body-md text-body-md py-3 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-copper-bronze disabled:hover:text-white" data-add-to-cart=""' + (soldOut ? " disabled" : "") + ">" +
            (soldOut ? "Sold Out" : "Add to Cart") + "</button></div></div>" +
            '<div class="p-6 text-center border-t border-copper-bronze/10">' +
            '<h3 class="font-headline-md text-[24px] text-deep-charcoal mb-2">' + escapeHtml(product.name) + "</h3>" +
            '<p class="font-body-md text-body-md text-copper-bronze mb-3">$' + product.price.toFixed(2) + "</p>" +
            '<p class="font-label-caps text-label-caps text-on-surface-variant/70">' + stockLabel(product) + "</p></div></div>";
    }

    function visibleProducts() {
        var list = products.filter(function (p) {
            return activeFilter === "all" || p.categories.indexOf(activeFilter) !== -1;
        });
        if (sortDirection) {
            list = list.slice().sort(function (a, b) { return sortDirection * (a.price - b.price); });
        }
        return list;
    }

    function render() {
        var list = visibleProducts();
        if (!list.length) {
            grid.innerHTML = '<p class="col-span-full text-center font-body-md text-body-md text-on-surface-variant py-16">No candles in this collection right now — check back soon.</p>';
            return;
        }
        grid.innerHTML = list.map(cardHtml).join("");
        grid.querySelectorAll("[data-reveal]").forEach(function (el) {
            el.classList.add("is-visible");
        });
        grid.querySelectorAll("[data-add-to-cart]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var card = btn.closest("[data-id]");
                var product = products.filter(function (p) { return p.id === card.getAttribute("data-id"); })[0];
                if (!product || !window.Lumina) return;
                window.Lumina.addToCart({
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    maxStock: product.stock
                });
            });
        });
    }

    function refresh() {
        return fetch("/api/products", { cache: "no-store" })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                products = data.products || [];
                render();
            })
            .catch(function () {
                grid.innerHTML = '<p class="col-span-full text-center font-body-md text-body-md text-on-surface-variant py-16">' +
                    "The shop is offline. Start the store server with <code>npm start</code> and reload.</p>";
            });
    }

    document.querySelectorAll("[data-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            document.querySelectorAll("[data-filter]").forEach(function (b) { b.classList.remove("filter-active"); });
            btn.classList.add("filter-active");
            activeFilter = btn.getAttribute("data-filter");
            render();
        });
    });

    var sortBtn = document.querySelector("[data-sort]");
    if (sortBtn) {
        sortBtn.addEventListener("click", function () {
            sortDirection = sortDirection === 1 ? -1 : 1;
            var label = sortBtn.querySelector("[data-sort-label]");
            if (label) label.textContent = sortDirection === 1 ? "Price: Low to High" : "Price: High to Low";
            render();
        });
    }

    window.luminaRefreshProducts = refresh;
    refresh();
    setInterval(refresh, 15000);
})();
