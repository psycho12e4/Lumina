/** Lumina — Tailwind build config (compiled to assets/css/tailwind.css via `npm run build:css`) */
module.exports = {
    content: ["./*.html", "./assets/js/*.js"],
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                // Brand palette (Design.md)
                "light-cream": "#FDFBF7",
                "copper-bronze": "#A8763E",
                "sage-green": "#8B9D83",
                "toasted-almond": "#E5D3B3",
                "deep-charcoal": "#333333",
                // Supporting surface/text tones
                "background": "#fbf9f5",
                "on-background": "#1b1c1a",
                "on-surface": "#1b1c1a",
                "on-surface-variant": "#50453a",
                "surface-variant": "#e4e2de",
                "surface-container-low": "#f5f3ef",
                "surface-tint": "#815520",
                "outline-variant": "#d5c4b5",
                "on-primary": "#ffffff",
                "tertiary-container": "#817358",
                "tertiary-fixed-dim": "#d6c4a5",
                "error": "#ba1a1a",
                "error-container": "#ffdad6",
                "on-error-container": "#93000a"
            },
            borderRadius: {
                DEFAULT: "0.125rem",
                lg: "0.25rem",
                xl: "0.5rem",
                full: "9999px"
            },
            spacing: {
                "section-padding": "6rem",
                "gutter": "2rem",
                "fine-line-weight": "1px",
                "margin-mobile": "1.25rem",
                "container-max": "1280px"
            },
            fontFamily: {
                "body-lg": ["Hanken Grotesk"],
                "headline-lg": ["Domine"],
                "label-caps": ["Hanken Grotesk"],
                "headline-md": ["Domine"],
                "subtitle-italic": ["EB Garamond"],
                "headline-lg-mobile": ["Domine"],
                "body-md": ["Hanken Grotesk"]
            },
            fontSize: {
                "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
                "headline-lg": ["48px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "700" }],
                "label-caps": ["12px", { lineHeight: "1.0", letterSpacing: "0.1em", fontWeight: "600" }],
                "headline-md": ["32px", { lineHeight: "1.3", fontWeight: "600" }],
                "subtitle-italic": ["24px", { lineHeight: "1.4", fontWeight: "400" }],
                "headline-lg-mobile": ["32px", { lineHeight: "1.2", fontWeight: "700" }],
                "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }]
            }
        }
    },
    plugins: [
        require("@tailwindcss/forms"),
        require("@tailwindcss/container-queries")
    ]
};
