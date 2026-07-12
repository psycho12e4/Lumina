/* Lumina — shared behavior: header, mobile nav, cart, checkout (test mode), forms, reveal, shop filters */
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

    /* addToCart({id, name, price, maxStock}) — maxStock caps the quantity when known */
    function addToCart(product) {
        var items = getCart();
        var existing = items.filter(function (item) { return item.name === product.name; })[0];
        if (existing) {
            if (typeof product.maxStock === "number" && existing.qty >= product.maxStock) {
                showToast("Only " + product.maxStock + " of " + product.name + " available");
                return false;
            }
            existing.qty += 1;
            if (product.id) existing.id = product.id;
        } else {
            if (typeof product.maxStock === "number" && product.maxStock < 1) {
                showToast(product.name + " is sold out");
                return false;
            }
            items.push({ id: product.id, name: product.name, price: product.price, qty: 1 });
        }
        saveCart(items);
        renderCount(true);
        renderDrawer();
        showToast(product.name + " added to your bag");
        return true;
    }

    /* Static product cards (dynamic grids bind their own buttons in shop.js) */
    var grid = document.querySelector("[data-product-grid]");
    var gridIsDynamic = grid && grid.hasAttribute("data-dynamic");
    if (!gridIsDynamic) {
        document.querySelectorAll("[data-add-to-cart]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var card = btn.closest("[data-category]");
                var name = card && card.querySelector("h3") ? card.querySelector("h3").textContent.trim() : "Item";
                var price = card ? parseFloat(card.getAttribute("data-price")) || 0 : 0;
                addToCart({ name: name, price: price });
            });
        });
    }

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
            '<button class="btn-sheen block w-full text-center px-4 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed" data-checkout-open="">' +
            'Checkout</button>' +
            '<p class="mt-3 text-center font-label-caps text-[10px] text-on-surface-variant/70 uppercase tracking-widest">Test mode — no real payment is taken</p></div>';
        document.body.appendChild(overlay);
        document.body.appendChild(drawer);
        drawer.querySelector("[data-cart-close]").addEventListener("click", function () { toggleDrawer(false); });
        drawer.querySelector("[data-checkout-open]").addEventListener("click", function () {
            if (!getCart().length) {
                showToast("Your bag is empty");
                return;
            }
            toggleDrawer(false);
            openCheckout();
        });
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
        var checkoutBtn = drawer.querySelector("[data-checkout-open]");
        if (checkoutBtn) checkoutBtn.disabled = !items.length;
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
        if (event.key === "Escape") {
            if (checkoutModal && !checkoutModal.classList.contains("hidden")) closeCheckout();
            else if (drawer && !drawer.classList.contains("translate-x-full")) toggleDrawer(false);
        }
    });

    /* ---- Checkout (details → fake payment authorization → order saved to the store API) ---- */
    var checkoutModal;
    var fieldClass = "w-full bg-transparent border-0 border-b border-copper-bronze/50 focus:ring-0 focus:border-copper-bronze px-0 py-2 text-deep-charcoal placeholder-on-surface-variant/50 outline-none";
    var labelClass = "font-label-caps text-label-caps text-on-surface-variant uppercase tracking-widest";

    function buildCheckout() {
        checkoutModal = document.createElement("div");
        checkoutModal.className = "fixed inset-0 z-[80] hidden items-center justify-center p-4 bg-deep-charcoal/60";
        checkoutModal.innerHTML =
            '<div class="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-light-cream border border-copper-bronze/30 shadow-xl" role="dialog" aria-modal="true" aria-label="Checkout">' +
            '<div class="flex items-center justify-between px-6 py-4 border-b border-copper-bronze/20">' +
            '<h2 class="font-headline-md text-2xl text-copper-bronze">Checkout</h2>' +
            '<button aria-label="Close checkout" class="p-2 text-copper-bronze hover:opacity-70" data-checkout-close="">' +
            '<span class="material-symbols-outlined text-2xl">close</span></button></div>' +
            '<div class="px-6 py-5" data-checkout-body=""></div></div>';
        document.body.appendChild(checkoutModal);
        checkoutModal.addEventListener("click", function (event) {
            if (event.target === checkoutModal) closeCheckout();
        });
        checkoutModal.querySelector("[data-checkout-close]").addEventListener("click", closeCheckout);
    }

    function summaryHtml() {
        var items = getCart();
        var total = items.reduce(function (sum, item) { return sum + item.price * item.qty; }, 0);
        return '<div class="mb-6 border border-copper-bronze/20 p-4 bg-background">' +
            items.map(function (item) {
                return '<div class="flex justify-between font-body-md text-body-md text-on-surface-variant py-1">' +
                    '<span>' + item.name + ' × ' + item.qty + '</span><span>$' + (item.price * item.qty).toFixed(2) + '</span></div>';
            }).join("") +
            '<div class="flex justify-between font-body-md text-body-md text-deep-charcoal font-bold border-t border-copper-bronze/20 mt-2 pt-2">' +
            '<span>Total</span><span>$' + total.toFixed(2) + '</span></div></div>';
    }

    function renderDetailsStep() {
        var body = checkoutModal.querySelector("[data-checkout-body]");
        body.innerHTML = summaryHtml() +
            '<form class="flex flex-col gap-4" data-checkout-details="">' +
            '<div><label class="' + labelClass + '" for="co-name">Full name *</label>' +
            '<input class="' + fieldClass + '" id="co-name" name="name" required type="text" autocomplete="name" placeholder="Aarav Sharma"/></div>' +
            '<div><label class="' + labelClass + '" for="co-phone">Mobile number *</label>' +
            '<input class="' + fieldClass + '" id="co-phone" name="phone" required type="tel" autocomplete="tel" pattern="[0-9+()\\- ]{7,15}" placeholder="+91 98765 43210"/></div>' +
            '<div><label class="' + labelClass + '" for="co-email">Email</label>' +
            '<input class="' + fieldClass + '" id="co-email" name="email" type="email" autocomplete="email" placeholder="you@example.com"/></div>' +
            '<div><label class="' + labelClass + '" for="co-address">Delivery address</label>' +
            '<textarea class="' + fieldClass + '" id="co-address" name="address" rows="2" autocomplete="street-address" placeholder="House, street, city, PIN"></textarea></div>' +
            '<p class="font-body-md text-sm text-error hidden" data-details-error=""></p>' +
            '<button class="btn-sheen w-full px-4 py-3 mt-2 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300 disabled:opacity-50" data-details-btn="" type="submit">Send OTP &amp; Continue</button></form>';
        body.querySelector("[data-checkout-details]").addEventListener("submit", function (event) {
            event.preventDefault();
            var form = event.target;
            if (!form.reportValidity()) return;
            var customer = {
                name: form.name.value.trim(),
                phone: form.phone.value.trim(),
                email: form.email.value.trim(),
                address: form.address.value.trim()
            };
            var btn = form.querySelector("[data-details-btn]");
            var errorEl = form.querySelector("[data-details-error]");
            errorEl.classList.add("hidden");
            btn.disabled = true;
            btn.textContent = "Sending OTP…";
            fetch("/api/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: customer.phone })
            }).then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            }).then(function (result) {
                if (!result.ok) throw new Error(result.data.error || "Could not send OTP.");
                renderOtpStep(customer, result.data.testMode);
            }).catch(function (err) {
                errorEl.textContent = err.message || "Could not send OTP — please try again.";
                errorEl.classList.remove("hidden");
                btn.disabled = false;
                btn.innerHTML = "Send OTP &amp; Continue";
            });
        });
    }

    function renderOtpStep(customer, testMode) {
        var body = checkoutModal.querySelector("[data-checkout-body]");
        body.innerHTML =
            '<div class="mb-5 px-4 py-3 bg-toasted-almond/40 border border-copper-bronze/30 font-body-md text-sm text-deep-charcoal">' +
            (testMode
                ? '<strong>TEST MODE</strong> — no SMS sent. Check the server console for your 6-digit code.'
                : 'A 6-digit code was sent to <strong>' + customer.phone + '</strong>. It expires in 10 minutes.') +
            '</div>' +
            '<form class="flex flex-col gap-4" data-checkout-otp="">' +
            '<div><label class="' + labelClass + '" for="co-otp">Verification code *</label>' +
            '<input class="' + fieldClass + ' text-center tracking-[0.4em] text-xl" id="co-otp" name="otp" required ' +
            'inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" autocomplete="one-time-code"/></div>' +
            '<p class="font-body-md text-sm text-error hidden" data-otp-error=""></p>' +
            '<button class="btn-sheen w-full px-4 py-3 mt-2 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300 disabled:opacity-50" data-otp-btn="" type="submit">Verify &amp; Continue</button>' +
            '<button class="w-full text-center font-label-caps text-label-caps text-on-surface-variant hover:text-copper-bronze uppercase tracking-widest" data-resend-btn="" type="button">Resend code</button>' +
            '<button class="w-full text-center font-label-caps text-label-caps text-on-surface-variant hover:text-copper-bronze uppercase tracking-widest" data-back-details-btn="" type="button">Back to details</button>' +
            '</form>';

        body.querySelector("[data-back-details-btn]").addEventListener("click", renderDetailsStep);

        body.querySelector("[data-resend-btn]").addEventListener("click", function () {
            var resendBtn = body.querySelector("[data-resend-btn]");
            resendBtn.disabled = true;
            resendBtn.textContent = "Sending…";
            fetch("/api/otp/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: customer.phone })
            }).then(function (res) { return res.json(); }).then(function (data) {
                resendBtn.disabled = false;
                resendBtn.textContent = "Resend code";
                showToast(data.ok ? "New code sent!" : (data.error || "Could not resend."));
            }).catch(function () {
                resendBtn.disabled = false;
                resendBtn.textContent = "Resend code";
                showToast("Could not resend — please try again.");
            });
        });

        body.querySelector("[data-checkout-otp]").addEventListener("submit", function (event) {
            event.preventDefault();
            var form = event.target;
            var otpBtn = form.querySelector("[data-otp-btn]");
            var errorEl = form.querySelector("[data-otp-error]");
            errorEl.classList.add("hidden");
            otpBtn.disabled = true;
            otpBtn.textContent = "Verifying…";
            fetch("/api/otp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone: customer.phone, code: form.otp.value.trim() })
            }).then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            }).then(function (result) {
                if (!result.ok) throw new Error(result.data.error || "Verification failed.");
                renderPaymentStep(customer, result.data.verificationToken);
            }).catch(function (err) {
                errorEl.textContent = err.message || "Verification failed — please try again.";
                errorEl.classList.remove("hidden");
                otpBtn.disabled = false;
                otpBtn.innerHTML = "Verify &amp; Continue";
            });
        });
    }

    function renderPaymentStep(customer, verificationToken) {
        var body = checkoutModal.querySelector("[data-checkout-body]");
        body.innerHTML = summaryHtml() +
            '<div class="mb-4 px-4 py-3 bg-toasted-almond/40 border border-copper-bronze/30 font-body-md text-sm text-deep-charcoal">' +
            '<strong>TEST MODE</strong> — this is a simulated payment. No money moves; any 12+ digit card number is accepted (try 4242 4242 4242 4242).</div>' +
            '<form class="flex flex-col gap-4" data-checkout-payment="">' +
            '<div><label class="' + labelClass + '" for="co-card">Card number *</label>' +
            '<input class="' + fieldClass + '" id="co-card" name="card" required inputmode="numeric" pattern="[0-9 ]{12,23}" placeholder="4242 4242 4242 4242"/></div>' +
            '<div class="grid grid-cols-2 gap-4">' +
            '<div><label class="' + labelClass + '" for="co-exp">Expiry *</label>' +
            '<input class="' + fieldClass + '" id="co-exp" name="expiry" required pattern="(0[1-9]|1[0-2])\\/?[0-9]{2}" placeholder="MM/YY"/></div>' +
            '<div><label class="' + labelClass + '" for="co-cvv">CVV *</label>' +
            '<input class="' + fieldClass + '" id="co-cvv" name="cvv" required inputmode="numeric" pattern="[0-9]{3,4}" placeholder="123"/></div></div>' +
            '<p class="font-body-md text-sm text-error hidden" data-payment-error=""></p>' +
            '<button class="btn-sheen w-full px-4 py-3 mt-2 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300 disabled:opacity-50" data-pay-btn="" type="submit">Authorize &amp; Pay</button>' +
            '<button class="w-full text-center font-label-caps text-label-caps text-on-surface-variant hover:text-copper-bronze uppercase tracking-widest" data-back-btn="" type="button">Back to details</button></form>';
        body.querySelector("[data-back-btn]").addEventListener("click", function () { renderOtpStep(customer, false); });
        body.querySelector("[data-checkout-payment]").addEventListener("submit", function (event) {
            event.preventDefault();
            var form = event.target;
            if (!form.reportValidity()) return;
            var payBtn = form.querySelector("[data-pay-btn]");
            var errorEl = form.querySelector("[data-payment-error]");
            errorEl.classList.add("hidden");
            payBtn.disabled = true;
            payBtn.textContent = "Authorizing…";
            /* brief pause to mimic a payment gateway round-trip */
            setTimeout(function () {
                fetch("/api/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        customer: customer,
                        items: getCart(),
                        payment: { card: form.card.value },
                        verificationToken: verificationToken
                    })
                }).then(function (res) {
                    return res.json().then(function (data) { return { ok: res.ok, data: data }; });
                }).then(function (result) {
                    if (!result.ok) throw new Error(result.data.error || "Payment failed.");
                    saveCart([]);
                    renderCount(false);
                    renderDrawer();
                    renderSuccessStep(result.data.order);
                }).catch(function (err) {
                    errorEl.textContent = err.message || "Something went wrong — please try again.";
                    errorEl.classList.remove("hidden");
                    payBtn.disabled = false;
                    payBtn.innerHTML = "Authorize &amp; Pay";
                });
            }, 1200);
        });
    }

    function renderSuccessStep(order) {
        var body = checkoutModal.querySelector("[data-checkout-body]");
        body.innerHTML =
            '<div class="text-center py-6">' +
            '<span class="material-symbols-outlined text-5xl text-sage-green mb-4">check_circle</span>' +
            '<h3 class="font-headline-md text-[26px] text-deep-charcoal mb-2">Order placed</h3>' +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-6">Thank you — your candles are being prepared with intention.</p>' +
            '<div class="inline-block text-left border border-copper-bronze/20 bg-background px-6 py-4 mb-6">' +
            '<p class="font-body-md text-body-md text-deep-charcoal">Order <strong>' + order.id + '</strong></p>' +
            '<p class="font-body-md text-body-md text-on-surface-variant">Total $' + order.total.toFixed(2) + '</p>' +
            '<p class="font-label-caps text-label-caps text-on-surface-variant mt-2">Test authorization: ' + order.authorization + '</p></div>' +
            '<button class="btn-sheen block w-full px-4 py-3 bg-copper-bronze text-white font-label-caps text-label-caps uppercase tracking-widest hover:bg-toasted-almond hover:text-deep-charcoal transition-colors duration-300" data-done-btn="">Continue Browsing</button></div>';
        body.querySelector("[data-done-btn]").addEventListener("click", closeCheckout);
        if (typeof window.luminaRefreshProducts === "function") window.luminaRefreshProducts();
    }

    function openCheckout() {
        if (!checkoutModal) buildCheckout();
        renderDetailsStep();
        checkoutModal.classList.remove("hidden");
        checkoutModal.classList.add("flex");
        document.body.style.overflow = "hidden";
    }
    function closeCheckout() {
        if (!checkoutModal) return;
        checkoutModal.classList.add("hidden");
        checkoutModal.classList.remove("flex");
        document.body.style.overflow = "";
    }

    /* ---- Forms ----
       Newsletter forms (footer, marked by #newsletter-email) save the address to
       the store API so it shows up in the admin's Newsletter tab — no email is sent.
       Other data-forms (contact page) keep the original toast-only behavior. */
    document.querySelectorAll("form[data-form]").forEach(function (form) {
        var isNewsletter = !!form.querySelector("#newsletter-email");
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            if (!form.reportValidity()) return;
            if (!isNewsletter) {
                form.reset();
                showToast(form.getAttribute("data-success") || "Thank you!");
                return;
            }
            var email = form.querySelector("#newsletter-email").value;
            fetch("/api/newsletter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: email, source: location.pathname.replace(/^\//, "") || "index.html" })
            }).then(function (res) {
                return res.json().then(function (data) { return { ok: res.ok, data: data }; });
            }).then(function (result) {
                if (!result.ok) throw new Error(result.data.error);
                form.reset();
                showToast(result.data.alreadySubscribed ? "You are already on the list — thank you!" : (form.getAttribute("data-success") || "Subscribed!"));
            }).catch(function (err) {
                showToast(err.message || "Could not subscribe right now — please try again.");
            });
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

    /* ---- Shop: category filter + price sort (static grids only —
            dynamic grids re-render, so shop.js owns their filtering) ---- */
    if (grid && !gridIsDynamic) {
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

    /* Shared helpers for shop.js */
    window.Lumina = {
        showToast: showToast,
        getCart: getCart,
        saveCart: saveCart,
        addToCart: addToCart,
        renderCount: renderCount
    };
})();
