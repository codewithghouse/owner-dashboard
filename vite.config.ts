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
      // VITE CUSTOM PROXY/MIDDLEWARE TO HANDLE /API LOCALLY
      // This is a powerful hack to make serverless functions work in 'npm run dev'
      configureServer: (server: any) => {
        server.middlewares.use(async (req: any, res: any, next: any) => {
          if (req.url === "/api/send-email" && req.method === "POST") {
            try {
              let body = "";
              req.on("data", (chunk: any) => {
                body += chunk.toString();
              });
              req.on("end", async () => {
                const { to, name, branch, schoolName } = JSON.parse(body);
                const apiKey = env.VITE_RESEND_API_KEY;

                if (!apiKey) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: "VITE_RESEND_API_KEY is missing in .env" }));
                  return;
                }

                // Node.js doesn't have CORS, so we can call Resend safely
                const response = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: JSON.stringify({
                    from: "EduIntellect <invite@edulant.dgion.com>",
                    to: [to],
                    subject: `Welcome to ${schoolName} - Principal Dashboard Access`,
                    html: `
                      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                        <h2 style="color: #1e3a8a;">Welcome, ${name}!</h2>
                        <p>You have been invited as the <strong>Principal</strong> for the <strong>${branch}</strong> branch of <strong>${schoolName}</strong>.</p>
                        <p>Your dashboard is now ready. Use your email to login.</p>
                        <div style="margin: 30px 0; text-align: center;">
                          <a href="https://principal-dashboard-seven.vercel.app/" 
                             style="background: #1e3a8a; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                            Open Principal Dashboard
                          </a>
                        </div>
                      </div>
                    `,
                  }),
                });

                const result = await response.json();
                res.setHeader("Content-Type", "application/json");
                res.statusCode = response.status || 200;
                res.end(JSON.stringify(result));
              });
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else {
            next();
          }
        });
      },
    },
    clearScreen: false,
    plugins: [react()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
