import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    server: {
      host: true,
      port: 8080,
      watch: {
        usePolling: true,
      },
      hmr: {
        overlay: true,
      },
      // Forward unhandled /api/* calls to production Vercel.
      // The local-email-middleware below intercepts /api/send-email first;
      // any other /api/* request (e.g. /api/owner-insights AI route) falls
      // through to this proxy so the local dev server doesn't 404.
      proxy: {
        "/api": {
          target: "https://owner.edullent.com",
          changeOrigin: true,
          secure: true,
        },
      },
    },
    clearScreen: false,
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "favicon.ico",
          "favicon-32x32.png",
          "robots.txt",
          "og-image.png",
          "offline.html",
          ".well-known/assetlinks.json",
          "icons/icon.svg",
          "icons/apple-touch-icon.png",
          "icons/icon-72x72.png",
          "icons/icon-96x96.png",
          "icons/icon-128x128.png",
          "icons/icon-144x144.png",
          "icons/icon-152x152.png",
          "icons/icon-192x192.png",
          "icons/icon-384x384.png",
          "icons/icon-512x512.png",
          "icons/icon-192-maskable.png",
          "icons/icon-512-maskable.png",
          // iOS splash screens — NOT precached (device-specific, only one
          // matches; precaching all 12 would waste bandwidth). They get
          // cached on demand via the runtime images cache rule.
        ],
        manifest: {
          id: "/",
          name: "Edullent — Owner",
          short_name: "Edullent",
          description: "Multi-branch school analytics, finance, academics and operations.",
          theme_color: "#1e3a8a",
          background_color: "#EEF4FF",
          display: "standalone",
          display_override: ["standalone", "minimal-ui"],
          orientation: "any",
          start_url: "/?source=pwa",
          scope: "/",
          lang: "en",
          dir: "ltr",
          categories: ["education", "productivity", "business"],
          prefer_related_applications: false,
          icons: [
            { src: "icons/icon-72x72.png",          sizes: "72x72",   type: "image/png" },
            { src: "icons/icon-96x96.png",          sizes: "96x96",   type: "image/png" },
            { src: "icons/icon-128x128.png",        sizes: "128x128", type: "image/png" },
            { src: "icons/icon-144x144.png",        sizes: "144x144", type: "image/png" },
            { src: "icons/icon-152x152.png",        sizes: "152x152", type: "image/png" },
            { src: "icons/icon-192x192.png",        sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-384x384.png",        sizes: "384x384", type: "image/png" },
            { src: "icons/icon-512x512.png",        sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "icons/icon-192-maskable.png",   sizes: "192x192", type: "image/png", purpose: "maskable" },
            { src: "icons/icon-512-maskable.png",   sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
          shortcuts: [
            { name: "Dashboard",  short_name: "Home",     description: "Go to overview",          url: "/?source=shortcut",          icons: [{ src: "icons/icon-96x96.png", sizes: "96x96" }] },
            { name: "Branches",   short_name: "Branches", description: "Compare branches",        url: "/branches?source=shortcut",  icons: [{ src: "icons/icon-96x96.png", sizes: "96x96" }] },
            { name: "Finance",    short_name: "Finance",  description: "Fee + revenue",            url: "/finance?source=shortcut",   icons: [{ src: "icons/icon-96x96.png", sizes: "96x96" }] },
          ],
          // Screenshots — promote on Chrome's rich install prompt + Play Store
          // PWA listing. Replace placeholder PNGs with real captures before
          // submission via DevTools Device Mode (see scripts/generate-screenshots.py).
          screenshots: [
            { src: "screenshots/desktop-dashboard.png", sizes: "1280x800",  type: "image/png", form_factor: "wide",   label: "Owner Dashboard — Multi-branch overview" },
            { src: "screenshots/desktop-finance.png",   sizes: "1280x800",  type: "image/png", form_factor: "wide",   label: "Finance — Fee + revenue across branches" },
            { src: "screenshots/mobile-dashboard.png",  sizes: "750x1334",  type: "image/png", form_factor: "narrow", label: "Mobile dashboard" },
            { src: "screenshots/mobile-students.png",   sizes: "750x1334",  type: "image/png", form_factor: "narrow", label: "Student intelligence" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,woff2}"],
          // Lazy-loaded chunks should NOT be precached — they're imported
          // on-demand via dynamic import() inside Export handlers. Precaching
          // them defeats the bundle savings (~1.2MB) we got from lazy-loading.
          // They still get runtime-cached on first use via StaleWhileRevalidate.
          globIgnores: [
            "**/assets/xlsx-*.js",
            "**/assets/jspdf*.js",
            "**/assets/html2canvas*.js",
            "**/assets/index.es-*.js",            // jspdf-autotable's internal entry
            "**/assets/purify.es-*.js",            // pulled in by jspdf
            // iOS launch splashes are device-specific. Only ONE matches per
            // user; precaching all 12 wastes ~430KB. They cache on-demand
            // via the runtime "images" rule (StaleWhileRevalidate, 30d).
            "**/splash/*.png",
          ],
          navigateFallback: "/index.html",
          // When SW can't reach network AND index.html isn't in cache yet,
          // workbox needs a fallback. The SPA shell handles 99% of navigations;
          // offline.html only matters on cold-cache offline launches.
          navigateFallbackDenylist: [/^\/api\//, /^\/parent-portal/, /^\/\.well-known\//, /^\/offline\.html$/],
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts-css", expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-webfonts",
                expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,
              handler: "NetworkFirst",
              options: {
                cacheName: "firestore-cache",
                networkTimeoutSeconds: 5,
                expiration: { maxAgeSeconds: 60 * 5, maxEntries: 80 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: /^https:\/\/identitytoolkit\.googleapis\.com\/.*/i,
              handler: "NetworkOnly",
            },
            {
              urlPattern: /^https:\/\/securetoken\.googleapis\.com\/.*/i,
              handler: "NetworkOnly",
            },
            {
              urlPattern: ({ request }) => request.destination === "image",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "images",
                expiration: { maxAgeSeconds: 60 * 60 * 24 * 30, maxEntries: 60 },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: "module",
        },
      }),
      {
        name: 'local-email-middleware',
        configureServer: (server: any) => {
          server.middlewares.use(async (req: any, res: any, next: any) => {
            if (req.url?.startsWith("/api/send-email") && req.method === "POST") {
              try {
                let body = "";
                req.on("data", (chunk: any) => { body += chunk.toString(); });
                req.on("end", async () => {
                  try {
                    const payload = JSON.parse(body);
                    const { type, to, name, branch, schoolName, subject, reportId } = payload;
                    const apiKey = env.VITE_RESEND_API_KEY;

                    if (!apiKey || apiKey === "re_123456789") {
                      res.setHeader("Content-Type", "application/json");
                      res.statusCode = 500;
                      res.end(JSON.stringify({ success: false, error: "VITE_RESEND_API_KEY is missing or invalid in .env" }));
                      return;
                    }

                    if (!to) {
                      res.setHeader("Content-Type", "application/json");
                      res.statusCode = 400;
                      res.end(JSON.stringify({ success: false, error: "Missing recipient email (to)" }));
                      return;
                    }

                    let emailPayload: any;

                    if (type === "report") {
                      // Report sharing email
                      const safeBody = (payload.body || "").replace(/\n/g, "<br>");
                      emailPayload = {
                        from: "Edullent Reports <noreply@edulent.dgion.com>",
                        to: [to],
                        subject: subject || "[Edullent] Report",
                        html: `
                          <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                            <div style="background:#1e3a8a;padding:24px 28px;">
                              <h1 style="color:#fff;margin:0;font-size:20px;">EDULLENT</h1>
                              <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Reports Center</p>
                            </div>
                            <div style="padding:28px;background:#fff;">
                              <h2 style="color:#1e293b;font-size:17px;margin:0 0 8px;">${(subject || "").replace(/^\[EDULLENT\]\s*/, "")}</h2>
                              ${reportId ? `<p style="color:#64748b;font-size:12px;margin:0 0 20px;">Report ID: <strong>${reportId}</strong></p>` : ""}
                              <div style="background:#f8fafc;border-left:3px solid #1e3a8a;padding:16px 18px;border-radius:0 8px 8px 0;color:#334155;font-size:14px;line-height:1.6;">
                                ${safeBody}
                              </div>
                            </div>
                            <div style="background:#f1f5f9;padding:14px 28px;text-align:center;">
                              <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by Edullent Cloud Architecture</p>
                            </div>
                          </div>
                        `,
                      };
                    } else {
                      // Principal invitation email (default)
                      emailPayload = {
                        from: "Edullent <invite@edulent.dgion.com>",
                        to: [to],
                        subject: `Welcome to ${schoolName || "Edullent"} – Principal Dashboard Access`,
                        html: `
                          <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                            <div style="background:#1e3a8a;padding:24px 28px;">
                              <h1 style="color:#fff;margin:0;font-size:20px;">EDULLENT</h1>
                              <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Principal Dashboard Invitation</p>
                            </div>
                            <div style="padding:28px;background:#fff;">
                              <h2 style="color:#1e293b;margin:0 0 12px;">Welcome, ${name}!</h2>
                              <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 16px;">
                                You have been invited as the <strong>Principal</strong> for the
                                <strong>${branch || "Main"}</strong> branch of
                                <strong>${schoolName || "your school"}</strong>.
                              </p>
                              <p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 24px;">
                                Your dashboard is now ready. Log in with the email address this was sent to.
                              </p>
                              <div style="text-align:center;margin:24px 0;">
                                <a href="https://principal-dashboard-seven.vercel.app/"
                                   style="background:#1e3a8a;color:#fff;padding:13px 30px;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px;display:inline-block;">
                                  Open Principal Dashboard
                                </a>
                              </div>
                            </div>
                            <div style="background:#f1f5f9;padding:14px 28px;text-align:center;">
                              <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by Edullent Cloud Architecture</p>
                            </div>
                          </div>
                        `,
                      };
                    }

                    console.log(`[Local API] type=${type || "invitation"} → ${to}`);
                    const response = await fetch("https://api.resend.com/emails", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                      },
                      body: JSON.stringify(emailPayload),
                    });

                    const result = await response.json();
                    console.log("[Local API] Resend Response:", response.status, result);

                    res.setHeader("Content-Type", "application/json");
                    res.statusCode = response.status || 200;
                    if (response.ok) {
                      res.end(JSON.stringify({ success: true, data: result }));
                    } else {
                      const msg = result.message || "Failed to send email";
                      res.end(JSON.stringify({ success: false, error: result, message: msg }));
                    }
                  } catch (parseErr: any) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: "Invalid JSON body: " + parseErr.message }));
                  }
                });
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ success: false, error: err.message }));
              }
            } else {
              next();
            }
          });
        }
      }
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
