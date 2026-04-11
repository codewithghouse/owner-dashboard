import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

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
    },
    clearScreen: false,
    plugins: [
      react(),
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
                        from: "EduIntellect Reports <noreply@edulent.dgion.com>",
                        to: [to],
                        subject: subject || "[EduIntellect] Report",
                        html: `
                          <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                            <div style="background:#1e3a8a;padding:24px 28px;">
                              <h1 style="color:#fff;margin:0;font-size:20px;">EDUINTELLECT</h1>
                              <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Reports Center</p>
                            </div>
                            <div style="padding:28px;background:#fff;">
                              <h2 style="color:#1e293b;font-size:17px;margin:0 0 8px;">${(subject || "").replace(/^\[EDUINTELLECT\]\s*/, "")}</h2>
                              ${reportId ? `<p style="color:#64748b;font-size:12px;margin:0 0 20px;">Report ID: <strong>${reportId}</strong></p>` : ""}
                              <div style="background:#f8fafc;border-left:3px solid #1e3a8a;padding:16px 18px;border-radius:0 8px 8px 0;color:#334155;font-size:14px;line-height:1.6;">
                                ${safeBody}
                              </div>
                            </div>
                            <div style="background:#f1f5f9;padding:14px 28px;text-align:center;">
                              <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by EduIntellect Cloud Architecture</p>
                            </div>
                          </div>
                        `,
                      };
                    } else {
                      // Principal invitation email (default)
                      emailPayload = {
                        from: "EduIntellect <invite@edulent.dgion.com>",
                        to: [to],
                        subject: `Welcome to ${schoolName || "EduIntellect"} – Principal Dashboard Access`,
                        html: `
                          <div style="font-family:sans-serif;max-width:600px;margin:auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                            <div style="background:#1e3a8a;padding:24px 28px;">
                              <h1 style="color:#fff;margin:0;font-size:20px;">EDUINTELLECT</h1>
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
                              <p style="color:#94a3b8;font-size:11px;margin:0;">Powered by EduIntellect Cloud Architecture</p>
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
