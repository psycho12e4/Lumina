/* Lumina — shared behavior: header, mobile nav, cart, forms, reveal, shop filters */
(function () {
    "use strict";

    /* ---- Header shadow on scroll ---- */
    var header = document.getElementById("site-header");
    if (header) {
        var onScroll = function () {
            header.classList.toggle("is-scrolled", window.scrollY > 8);
        };
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
    }

    /* ---- Mobile menu ---- */
    var toggle = document.getElementById("menu-toggle");
    var mobileNav = document.getElementById("mobile-nav");
    if (toggle && mobileNav) {
        toggle.addEventListener("click", function () {
            var open = mobileNav.classList.toggle("open");
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
            var icon = toggle.querySelector(".material-symbols-outlined");
            if (icon) icon.textContent = open ? "close" : "menu";
        });
    }

    /* ---- Toast ---- */
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
        requestAnimationFrame(function () {
            toast.classList.add("show");
        });
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove("show");
        }, 2600);
    }

    /* ---- Cart (items persisted in localStorage) ---- */
    var CART_KEY = "lumina-cart";
    var countEls = document.querySelectorAll("[data-cart-count]");
    function getCart() {
        try {
            var items = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
            return Array.isArray(items) ? items : [];
        } catch (e) {
            return [];
        }
    }
    function saveCart(items) {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(items));
        } catch (e) { /* private mode — cart just won't persist */ }
    }
    function cartCount(items) {
        return items.reduce(function (sum, item) { return sum + item.qty; }, 0);
    }
    function renderCount(animate) {
        var count = cartCount(getCart());
        countEls.forEach(function (el) {
            el.textContent = count;
            if (animate) {
                el.classList.remove("pop");
                void el.offsetWidth; /* restart the animation */
                el.classList.add("pop");
            }
        });
    }
    renderCount(false);
    document.querySelectorAll("[data-add-to-cart]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            var card = btn.closest("[data-category]");
            var name = card && card.querySelector("h3") ? card.querySelector("h3").textContent.trim() : "Item";
            var price = card ? parseFloat(card.getAttribute("data-price")) || 0 : 0;
            var items = getCart();
            var existing = items.filter(function (item) { return item.name === name; })[0];
            if (existing) {
                existing.qty += 1;
            } else {
                items.push({ name: name, price: price, qty: 1 });
            }
            saveCart(items);
            renderCount(true);
            renderDrawer();
            showToast(name + " added to your bag");
        });
    });

    /* ---- Cart drawer ---- */
    var drawer, overlay;
    function buildDrawer() {
        overlay = document.createElement("div");
        overlay.className = "fixed inset-0 bg-deep-charcoal/50 z-[60] opacity-0 pointer-events-none transition-opacity duration-300";
        overlay.addEventListener("click", function () { toggleDrawer(false); });

        drawer = document.createElement("aside");
        drawer.setAttribute("role", "dialog");
        drawer.setAttribute("aria-modal", "true");
        drawer.setAttribute("aria-label", "Shopping bag");
        drawer.className = "fixed top-0 right-0 h-full w-full max-w-sm bg-light-cream border-l border-copper-bronze/30 z-[70] flex flex-col translate-x-full transition-transform duration-300 ease-in-out shadow-xl";
        drawer.innerHTML =
            '<div class="flex items-center justify-between px-6 py-4 border-b border-copper-bronze/20">' +
            '<h2 class="font-headline-md text-2xl text-copper-bronze">Your Bag</h2>' +
            '<button aria-label="Close bag" class="p-2 text-copper-bronze hover:opacity-70 transition-opacity duration-300" data-cart-close="">' +
            '<span class="material-symbols-outlined text-2xl">close</span></button></div>' +
            '<div class="flex-grow overflow-y-auto px-6 py-4" data-cart-items=""></div>' +
            '<div class="px-6 py-4 border-t border-copper-bronze/20">' +
            '<div class="flex justify-between font-body-md text-body-md text-deep-charcoal mb-4">' +
            '<span>Total</span><span class="font-bold" data-cart-total="">$0.00</span></div>' +
            '<a class="block w-full text-center px-4 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" href="contact.html">' +
            'Contact Us to Order</a></div>';
        document.body.appendChild(overlay);
        document.body.appendChild(drawer);
        drawer.querySelector("[data-cart-close]").addEventListener("click", function () { toggleDrawer(false); });
        renderDrawer();
    }
    function renderDrawer() {
        if (!drawer) return;
        var items = getCart();
        var list = drawer.querySelector("[data-cart-items]");
        if (!items.length) {
            list.innerHTML = '<p class="font-body-md text-body-md text-on-surface-variant text-center py-12">Your bag is empty.</p>';
        } else {
            list.innerHTML = items.map(function (item, i) {
                return '<div class="flex items-center justify-between gap-3 py-4 border-b border-copper-bronze/10">' +
                    '<div><p class="font-body-md text-body-md text-deep-charcoal">' + item.name + '</p>' +
                    '<p class="font-label-caps text-label-caps text-on-surface-variant">Qty ' + item.qty +
                    ' · $' + (item.price * item.qty).toFixed(2) + '</p></div>' +
                    '<button aria-label="Remove ' + item.name + '" class="p-1 text-on-surface-variant hover:text-error transition-colors duration-300" data-remove="' + i + '">' +
                    '<span class="material-symbols-outlined text-xl">delete</span></button></div>';
            }).join("");
            list.querySelectorAll("[data-remove]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    var items = getCart();
                    var index = parseInt(btn.getAttribute("data-remove"), 10);
                    if (items[index].qty > 1) {
                        items[index].qty -= 1;
                    } else {
                        items.splice(index, 1);
                    }
                    saveCart(items);
                    renderCount(false);
                    renderDrawer();
                });
            });
        }
        var total = items.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
        drawer.querySelector("[data-cart-total]").textContent = "$" + total.toFixed(2);
    }
    function toggleDrawer(open) {
        if (!drawer) buildDrawer();
        drawer.classList.toggle("translate-x-full", !open);
        overlay.classList.toggle("opacity-0", !open);
        overlay.classList.toggle("pointer-events-none", !open);
        document.body.style.overflow = open ? "hidden" : "";
        if (open) {
            renderDrawer();
            drawer.querySelector("[data-cart-close]").focus();
        }
    }
    document.querySelectorAll("[data-cart-toggle]").forEach(function (btn) {
        btn.addEventListener("click", function () {
            toggleDrawer(drawer ? drawer.classList.contains("translate-x-full") : true);
        });
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && drawer && !drawer.classList.contains("translate-x-full")) {
            toggleDrawer(false);
        }
    });

    /* ---- Forms (newsletter, contact) ---- */
    document.querySelectorAll("form[data-form]").forEach(function (form) {
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;
            form.reset();
            showToast(form.getAttribute("data-success") || "Thank you!");
        });
    });

    /* ---- Lazy images fade in as they load ---- */
    document.querySelectorAll('img[loading="lazy"]').forEach(function (img) {
        img.classList.add("lazy-fade");
        var done = function () {
            img.classList.add("loaded");
        };
        if (img.complete && img.naturalWidth > 0) {
            done();
        } else {
            img.addEventListener("load", done);
            img.addEventListener("error", done);
        }
    });

    /* ---- Scroll reveal ---- */
    var revealEls = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
    if (revealEls.length) {
        if ("IntersectionObserver" in window) {
            var io = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        io.unobserve(entry.target);
                    }
                });
            }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });
            revealEls.forEach(function (el) {
                io.observe(el);
            });
        } else {
            revealEls.forEach(function (el) {
                el.classList.add("is-visible");
            });
        }
    }

    /* ---- Shop: category filter + price sort ---- */
    var grid = document.querySelector("[data-product-grid]");
    if (grid) {
        var cards = Array.prototype.slice.call(grid.querySelectorAll("[data-category]"));
        var filterBtns = document.querySelectorAll("[data-filter]");
        filterBtns.forEach(function (btn) {
            btn.addEventListener("click", function () {
                filterBtns.forEach(function (b) {
                    b.classList.remove("filter-active");
                });
                btn.classList.add("filter-active");
                var filter = btn.getAttribute("data-filter");
                cards.forEach(function (card) {
                    var categories = (card.getAttribute("data-category") || "").split(" ");
                    var show = filter === "all" || categories.indexOf(filter) !== -1;
                    card.classList.toggle("hidden", !show);
                    card.classList.add("is-visible");
                });
            });
        });

        var sortBtn = document.querySelector("[data-sort]");
        if (sortBtn) {
            var direction = 0;
            sortBtn.addEventListener("click", function () {
                direction = direction === 1 ? -1 : 1;
                cards
                    .slice()
                    .sort(function (a, b) {
                        return direction * (parseFloat(a.getAttribute("data-price")) - parseFloat(b.getAttribute("data-price")));
                    })
                    .forEach(function (card) {
                        grid.appendChild(card);
                    });
                var label = sortBtn.querySelector("[data-sort-label]");
                if (label) label.textContent = direction === 1 ? "Price: Low to High" : "Price: High to Low";
            });
        }
    }
})();
