/* Lumina — auth.js
   Backed by Supabase Auth (client-side, via the CDN UMD bundle loaded
   dynamically below). Handles: session bootstrap, nav account icon,
   login/signup forms, page guard (data-require-auth), account page
   rendering, logout. Exposes window.LuminaAuth for main.js/product.js. */
(function () {
    "use strict";

    var SUPABASE_URL = "https://wovyvnazmlzhoiqcdfoc.supabase.co";
    var SUPABASE_ANON_KEY = "sb_publishable_CFdXRK0PN6SzKHxvcAPTrA_e1bXODq6";

    var PAGE = location.pathname.split("/").pop() || "index.html";
    var AUTH_PAGES = { "login.html": true, "signup.html": true };
    var REQUIRES_AUTH = document.body.hasAttribute("data-require-auth");

    /* ---- Load the Supabase JS SDK from CDN, then create one client ---- */

    var sbClient = null;
    var ready = new Promise(function (resolve) {
        if (window.supabase && window.supabase.createClient) {
            sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            resolve(sbClient);
            return;
        }
        var script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js";
        script.onload = function () {
            sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            resolve(sbClient);
        };
        document.head.appendChild(script);
    });

    /* ---- Session ---- */

    var _session = null; /* Supabase session object, or null */
    var _sessionChecked = false;
    var _onSessionCallbacks = [];

    function onSession(cb) {
        if (_sessionChecked) { cb(_session); return; }
        _onSessionCallbacks.push(cb);
    }

    function resolveSession(session) {
        _session = session;
        _sessionChecked = true;
        _onSessionCallbacks.forEach(function (cb) { cb(session); });
        _onSessionCallbacks = [];
    }

    function sessionUser(session) {
        if (!session || !session.user) return null;
        return {
            id: session.user.id,
            email: session.user.email,
            name: (session.user.user_metadata && session.user.user_metadata.name) || session.user.email
        };
    }

    ready.then(function (sb) {
        return sb.auth.getSession();
    }).then(function (result) {
        resolveSession(result.data.session);
        sbClient.auth.onAuthStateChange(function (_event, session) {
            resolveSession(session);
            renderNav(sessionUser(session));
            if (PAGE === "account.html" && session) renderAccountPage(sessionUser(session));
        });
    }).catch(function () { resolveSession(null); });

    /* ---- Redirect logic ---- */

    onSession(function (session) {
        var user = sessionUser(session);
        /* Logged-in user hits login/signup → send them to account */
        if (user && AUTH_PAGES[PAGE]) {
            var dest = new URLSearchParams(location.search).get("next") || "account.html";
            location.replace(dest);
            return;
        }
        /* Protected page, not logged in → redirect to login */
        if (!user && REQUIRES_AUTH) {
            location.replace("login.html?next=" + encodeURIComponent(PAGE));
            return;
        }
        /* Normal render */
        renderNav(user);
        if (PAGE === "account.html" && user) renderAccountPage(user);
    });

    /* ---- Nav account icon ---- */

    function renderNav(user) {
        var container = document.getElementById("nav-auth-actions");
        if (!container) return;
        var existing = container.querySelector("[data-auth-link]");
        if (existing) existing.remove();

        if (user) {
            container.insertAdjacentHTML("beforeend",
                '<a href="account.html" data-auth-link="" aria-label="My account" class="p-2 relative transition-opacity duration-300 hover:opacity-70 flex items-center gap-1">' +
                '<span class="material-symbols-outlined text-2xl">account_circle</span>' +
                '<span class="hidden md:inline font-label-caps text-label-caps text-[11px] uppercase tracking-widest">' + escHtml(user.name.split(" ")[0]) + '</span>' +
                '</a>'
            );
        } else {
            container.insertAdjacentHTML("beforeend",
                '<a href="login.html" data-auth-link="" aria-label="Sign in" class="p-2 relative transition-opacity duration-300 hover:opacity-70 flex items-center gap-1">' +
                '<span class="material-symbols-outlined text-2xl">account_circle</span>' +
                '<span class="hidden md:inline font-label-caps text-label-caps text-[11px] uppercase tracking-widest">Sign in</span>' +
                '</a>'
            );
        }
    }

    /* ---- Account page content ---- */

    function renderAccountPage(user) {
        var body = document.getElementById("account-body");
        if (!body) return;
        body.innerHTML =
            '<h1 class="font-headline-md text-[32px] text-deep-charcoal mb-1">Hello, ' + escHtml(user.name.split(" ")[0]) + '</h1>' +
            '<p class="font-body-md text-body-md text-on-surface-variant mb-10">' + escHtml(user.email) + '</p>' +

            '<div class="grid sm:grid-cols-2 gap-4 mb-10">' +
            accountCard("shopping_bag", "My Orders", "View your order history and track deliveries.", "shop.html") +
            accountCard("favorite", "Wishlist", "Candles you've saved for later.", "shop.html") +
            accountCard("mail", "Newsletter", "Manage your email preferences.", "contact.html") +
            accountCard("local_shipping", "Addresses", "Saved delivery addresses.", "#") +
            '</div>' +

            '<div class="border-t border-copper-bronze/20 pt-8">' +
            '<button id="logout-btn" class="font-label-caps text-label-caps text-on-surface-variant hover:text-error uppercase tracking-widest transition-colors duration-300 flex items-center gap-2">' +
            '<span class="material-symbols-outlined text-xl">logout</span>Sign out</button>' +
            '</div>';

        document.getElementById("logout-btn").addEventListener("click", function () {
            ready.then(function (sb) { return sb.auth.signOut(); })
                .finally(function () { location.href = "index.html"; });
        });
    }

    function accountCard(icon, title, desc, href) {
        return '<a href="' + href + '" class="block bg-light-cream border border-copper-bronze/20 px-6 py-5 hover:border-copper-bronze/50 hover:shadow-md transition-all duration-300 group">' +
            '<span class="material-symbols-outlined text-copper-bronze mb-3 text-[28px]">' + icon + '</span>' +
            '<p class="font-headline-md text-[18px] text-deep-charcoal mb-1 group-hover:text-copper-bronze transition-colors duration-300">' + title + '</p>' +
            '<p class="font-body-md text-sm text-on-surface-variant">' + desc + '</p>' +
            '</a>';
    }

    /* ---- Login form ---- */

    var loginForm = document.getElementById("login-form");
    if (loginForm) {
        var next = new URLSearchParams(location.search).get("next") || "account.html";
        var signupLink = document.getElementById("signup-link");
        if (signupLink && next !== "account.html") signupLink.href = "signup.html?next=" + encodeURIComponent(next);

        loginForm.addEventListener("submit", function (event) {
            event.preventDefault();
            var btn = document.getElementById("login-btn");
            var errorEl = document.getElementById("login-error");
            errorEl.classList.add("hidden");
            btn.disabled = true;
            btn.textContent = "Signing in…";

            ready.then(function (sb) {
                return sb.auth.signInWithPassword({
                    email: document.getElementById("login-email").value.trim(),
                    password: document.getElementById("login-password").value
                });
            }).then(function (result) {
                if (result.error) throw new Error(
                    /email.*not.*confirmed/i.test(result.error.message)
                        ? "Please confirm your email first — check your inbox for the confirmation link."
                        : (result.error.message || "Sign in failed.")
                );
                location.replace(next);
            }).catch(function (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove("hidden");
                btn.disabled = false;
                btn.textContent = "Sign In";
            });
        });
    }

    /* ---- Signup form ---- */

    var signupForm = document.getElementById("signup-form");
    if (signupForm) {
        var nextS = new URLSearchParams(location.search).get("next") || "account.html";
        var loginLink = document.getElementById("login-link");
        if (loginLink && nextS !== "account.html") loginLink.href = "login.html?next=" + encodeURIComponent(nextS);

        signupForm.addEventListener("submit", function (event) {
            event.preventDefault();
            var btn = document.getElementById("signup-btn");
            var errorEl = document.getElementById("signup-error");
            errorEl.classList.remove("text-sage-green");
            errorEl.classList.add("hidden");
            btn.disabled = true;
            btn.textContent = "Creating account…";

            var name = document.getElementById("signup-name").value.trim();
            var email = document.getElementById("signup-email").value.trim();
            var password = document.getElementById("signup-password").value;

            ready.then(function (sb) {
                return sb.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: { name: name },
                        emailRedirectTo: location.origin + "/login.html"
                    }
                });
            }).then(function (result) {
                if (result.error) throw new Error(result.error.message || "Sign up failed.");
                if (result.data.session) {
                    location.replace(nextS);
                    return;
                }
                errorEl.textContent = "Check your email — we've sent you a confirmation link to finish creating your account.";
                errorEl.classList.remove("hidden");
                errorEl.classList.add("text-sage-green");
                btn.textContent = "Check your email";
            }).catch(function (err) {
                errorEl.textContent = err.message;
                errorEl.classList.remove("hidden");
                btn.disabled = false;
                btn.textContent = "Create Account";
            });
        });
    }

    /* ---- Helpers ---- */

    function escHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    /* Expose for main.js/product.js to check session + get a bearer token */
    window.LuminaAuth = {
        ready: ready,
        onSession: function (cb) { onSession(function (session) { cb(sessionUser(session)); }); },
        getSession: function () { return ready.then(function (sb) { return sb.auth.getSession(); }).then(function (r) { return r.data.session; }); },
        signOut: function () { return ready.then(function (sb) { return sb.auth.signOut(); }); }
    };
})();
