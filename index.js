import express from "express";
import path from "path";
import cookieSession from "cookie-session";
import router from "./routes/index.js";
import fs from "fs";
import hbs from "hbs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { injectUser } from "./middleware/auth.js";
import { csrfMiddleware, csrfProtect } from "./middleware/csrf.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Body / Static ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// ─── Static files with aggressive cache headers ───────────────────────────────
// NOTE: Vercel handles gzip/brotli at the CDN edge — no manual compression needed
const staticOpts = {
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
};
app.use(express.static(path.join(__dirname, "public"), staticOpts));
app.use(express.static(path.join(process.cwd(), "public"), staticOpts));

// ─── Session (cookie-based — survives Vercel cold starts, no server store) ───
app.use(cookieSession({
  name:     "ss_sid",
  keys:     [process.env.SESSION_SECRET || "change-this-in-production",
             "scoresync-fallback-key-9x7z"],
  maxAge:   1000 * 60 * 60 * 8, // 8 hours
  secure:   false,   // Vercel handles HTTPS at edge — cookie must work over proxy
  sameSite: "lax",
  httpOnly: true,
  overwrite: true,
}));

// ─── Custom flash (replaces connect-flash — works natively with cookie-session)
app.use((req, res, next) => {
  // Read and clear flash from session — guard against null session (after logout)
  const msgs = req.session?._flash || {};
  if (req.session) req.session._flash = {};

  req.flash = (type, msg) => {
    if (type && msg) {
      // Write flash
      if (!req.session) return;
      if (!req.session._flash) req.session._flash = {};
      if (!req.session._flash[type]) req.session._flash[type] = [];
      req.session._flash[type].push(msg);
    } else if (type) {
      // Read flash for this type
      return msgs[type] || [];
    }
  };

  res.locals.success_msg = (msgs.success_msg || [])[0] || "";
  res.locals.error_msg   = (msgs.error_msg   || [])[0] || "";
  res.locals.success_html = (msgs.success_msg || [])[0] || ""; // allows HTML in success
  next();
});
app.use(injectUser);
app.use(csrfMiddleware);  // generates + exposes csrfToken to all views
app.use(csrfProtect);     // validates token on every POST/PUT/DELETE

// ─── Handlebars helpers ───────────────────────────────────────────────────────
hbs.registerHelper("eq",  (a, b) => a === b);
hbs.registerHelper("gt",  (a, b) => Number(a) > Number(b));
hbs.registerHelper("gte", (a, b) => Number(a) >= Number(b));
hbs.registerHelper("lt",  (a, b) => Number(a) < Number(b));
hbs.registerHelper("lte", (a, b) => Number(a) <= Number(b));
hbs.registerHelper("not", (a)    => !a);
hbs.registerHelper("includes", (items, value) => Array.isArray(items) && items.includes(value));
hbs.registerHelper("add1",(a)    => Number(a) + 1);
hbs.registerHelper("sub1",(a)    => Number(a) - 1);

// Theme → gradient mapping for event cards
const THEME_GRADIENTS = {
  blue:   "linear-gradient(135deg,#1e3a8a,#2563eb)",
  purple: "linear-gradient(135deg,#4c1d95,#7c3aed)",
  green:  "linear-gradient(135deg,#064e3b,#059669)",
  gold:   "linear-gradient(135deg,#92400e,#d97706)",
  rose:   "linear-gradient(135deg,#881337,#e11d48)",
  slate:  "linear-gradient(135deg,#1e293b,#475569)",
};
hbs.registerHelper("themeGradient", (theme) =>
  THEME_GRADIENTS[theme] || THEME_GRADIENTS.blue
);

// Criteria colour by index (used in scoring pages)
const CRITERIA_COLORS = ["#2563eb","#7c3aed","#059669","#dc2626","#d97706","#0891b2","#be185d","#65a30d"];
hbs.registerHelper("criteriaColor", (idx) => CRITERIA_COLORS[Number(idx) % CRITERIA_COLORS.length]);
hbs.registerHelper("lookup", (obj, key) => (obj && obj[key] !== undefined) ? obj[key] : 0);

// ─── .xian engine (wraps hbs) ────────────────────────────────────────────────
app.engine("xian", (filePath, options, callback) => {
  hbs.__express(filePath, options, (err, html) => {
    if (err) {
      console.error("Template rendering error on file:", filePath, err);
      return callback(err);
    }
    callback(null, html);
  });
});

app.set("views",       path.join(__dirname, "views"));
app.set("view engine", "xian");

// ─── Auto-register all partials recursively ───────────────────────────────────
function registerPartials(dir) {
  try {
    if (!fs.existsSync(dir)) {
      console.warn("Partials dir not found:", dir);
      return;
    }
    fs.readdirSync(dir).forEach(file => {
      try {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          registerPartials(fullPath);
        } else if (file.endsWith(".xian")) {
          const name    = file.replace(".xian", "");
          const content = fs.readFileSync(fullPath, "utf8");
          hbs.registerPartial(name, content);
        }
      } catch (fileErr) {
        console.error("Failed to register partial:", file, fileErr.message);
      }
    });
  } catch (err) {
    console.error("registerPartials error:", dir, err.message);
  }
}
// Try both __dirname and process.cwd() for Vercel compatibility
const partialsPath = path.join(__dirname, "views", "partials");
const altPartialsPath = path.join(process.cwd(), "views", "partials");
console.log("Registering partials from:", partialsPath, "exists:", fs.existsSync(partialsPath));
registerPartials(fs.existsSync(partialsPath) ? partialsPath : altPartialsPath);

// ─── Routes ───────────────────────────────────────────────────────────────────
// Set sensible cache headers on all HTML responses
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
});
app.use("/", router);

// ─── Health / keep-warm ping (hit this every 25s from client to avoid cold starts) ──
app.get("/_health", (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ status: "ok", ts: Date.now(), env: process.env.NODE_ENV || "production", vercel: !!process.env.VERCEL });
});

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <div style="font-family:sans-serif;text-align:center;padding:80px;background:#0a0f1e;color:#e2e8f0;min-height:100vh">
      <h1 style="font-size:4rem;color:#2563eb">404</h1>
      <p>Page not found.</p>
      <a href="/" style="color:#2563eb">Go Home</a>
    </div>
  `);
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Global error:", err.message, err.stack);
  res.status(500).send(`
    <div style="font-family:sans-serif;text-align:center;padding:80px;background:#0a0f1e;color:#e2e8f0;min-height:100vh">
      <h1 style="font-size:3rem;color:#ef4444">500 — Server Error</h1>
      <p style="color:#64748b">${process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong. Please try again.'}</p>
      <a href="/" style="color:#2563eb">Go Home</a>
    </div>
  `);
});

export default app;

function startServer(port, attempt = 1) {
  const server = app.listen(port, () => {
    process.env.PORT = String(port);
    console.log(`🏆 ScoreSync running at http://localhost:${port}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const nextPort = port + 1;
      const maxAttempts = 20;

      if (attempt < maxAttempts) {
        console.warn(`Port ${port} is already in use. Retrying on ${nextPort}...`);
        startServer(nextPort, attempt + 1);
        return;
      }

      console.error(`Unable to start ScoreSync: ports ${port} through ${nextPort - 1} are all occupied.`);
      process.exit(1);
    }

    console.error("Failed to start ScoreSync server:", err);
    process.exit(1);
  });
}

// Only start the HTTP server when NOT running on Vercel (Vercel uses the export)
if (!process.env.ELECTRON && !process.env.VERCEL) {
  startServer(PORT);
}
