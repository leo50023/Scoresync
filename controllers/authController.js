import { auth, db } from "../models/firebaseConfig.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  doc, setDoc, getDoc, getDocs,
  collection, query, limit,
} from "firebase/firestore";
import { recordFailedLogin, clearFailedLogins } from "../middleware/rateLimit.js";
import { sanitizeText, sanitizeEmail, sanitizeRole } from "../utils/sanitize.js";
import { setCachedUserAvatar } from "../utils/userAvatarCache.js";

// ─── Page renderers ───────────────────────────────────────────────────────────

export const loginPage = (req, res) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  res.render("login", { title: "Login" });
};

export const registerPage = (req, res) => {
  if (req.session?.userId) {
    if (req.session.userRole === "admin" && !req.query.role) return res.redirect("/users");
    if (req.session.userRole !== "admin") return res.redirect("/dashboard");
  }
  res.render("register", {
    title: "Register",
    preRole: req.query.role || "",
  });
};

export const forgotPasswordPage = (req, res) =>
  res.render("forgotpassword", { title: "Forgot Password" });

// ─── Setup page (one-time admin creator) ─────────────────────────────────────

export const setupPage = async (req, res) => {
  // Check if any users already exist
  const snap = await getDocs(query(collection(db, "users"), limit(1)));
  const hasUsers = !snap.empty;
  res.render("setup", { title: "Setup Admin", hasUsers });
};

export const setupAdmin = async (req, res) => {
  const name     = sanitizeText(req.body.name, 100);
  const email    = sanitizeEmail(req.body.email);
  const password = req.body.password || "";

  if (!name || !email) {
    req.flash("error_msg", "Please provide a valid name and email.");
    return res.redirect("/setup");
  }

  // Only allow if no users exist yet
  const snap = await getDocs(query(collection(db, "users"), limit(1)));
  if (!snap.empty) {
    req.flash("error_msg", "Setup already completed. An admin account exists.");
    return res.redirect("/login");
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role: "admin",           // always admin on setup
      status: "approved",
      createdAt: new Date(),
    });

    req.session.userId   = uid;
    req.session.userName = name;
    req.session.userRole = "admin";

    req.flash("success_msg", `Admin account created. Welcome, ${name}!`);
    res.redirect("/dashboard");
  } catch (err) {
    console.error("Setup error:", err.code, err.message);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/setup");
  }
};

// ─── Fix role endpoint removed for security ──────────────────────────────────

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginUser = async (req, res) => {
  const email    = sanitizeEmail(req.body.email);
  const password = req.body.password || "";
  const ip       = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";

  if (!email) {
    req.flash("error_msg", "Invalid email address.");
    return res.redirect("/login");
  }

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    const snap = await getDoc(doc(db, "users", uid));
    const profile = snap.exists() ? snap.data() : {};

    // Check account status (Admin accounts are exempt and auto-approved)
    if (profile.role !== "admin" && profile.status === "pending") {
      await signOut(auth);
      recordFailedLogin(ip);
      req.flash(
        "error_msg",
        "Your account request is still pending approval by the Admin. Please wait for Gmail confirmation."
      );
      return res.redirect("/login");
    }

    if (profile.role !== "admin" && profile.status === "rejected") {
      await signOut(auth);
      recordFailedLogin(ip);
      req.flash("error_msg", "Your account request was declined by the Admin.");
      return res.redirect("/login");
    }

    // Successful login — clear failed attempt counter
    clearFailedLogins(ip);

    setCachedUserAvatar(uid, profile.avatar || profile.photoURL || profile.photo || "");
    req.session.userId    = uid;
    req.session.userName  = profile.name  || email;
    req.session.userRole  = profile.role  || "judge";

    const allowedRoles = ["admin", "judge", "encoder", "organizer", "tabulator"];
    if (!allowedRoles.includes(req.session.userRole)) {
      req.session.userRole = "judge";
    }

    res.redirect("/dashboard");
  } catch (err) {
    recordFailedLogin(ip);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/login");
  }
};

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerUser = async (req, res) => {
  const name     = sanitizeText(req.body.name, 100);
  const email    = sanitizeEmail(req.body.email);
  const password = req.body.password || "";
  const role     = sanitizeRole(req.body.role, ["judge", "encoder", "organizer", "tabulator"]);

  if (!name || !email) {
    req.flash("error_msg", "Please provide a valid name and email address.");
    return res.redirect("/register");
  }

  if (!role) {
    req.flash("error_msg", "Invalid role selected.");
    return res.redirect("/register");
  }

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name, email, role,
      status: "pending",
      createdAt: new Date(),
    });

    // Sign out immediately so user is not logged in while request is pending
    await signOut(auth);

    console.log(`⏳ Account Request Submitted: ${email} as ${role}`);
    req.flash(
      "success_msg",
      `Your account request for ${name} (${email}) has been sent to the Admin for approval. You will receive a notification on your Gmail once confirmed!`
    );
    res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err.code, err.message);
    req.flash("error_msg", friendlyError(err.code));
    res.redirect("/register");
  }
};

// ─── Forgot password ──────────────────────────────────────────────────────────

export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    await sendPasswordResetEmail(auth, email);
    req.flash("success_msg", "Password reset email sent. Check your inbox.");
  } catch (err) {
    req.flash("error_msg", friendlyError(err.code));
  }
  res.redirect("/forgot-password");
};

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutUser = async (req, res) => {
  try { await signOut(auth); } catch (_) {}
  // Clear session keys individually instead of setting to null
  if (req.session) {
    req.session.userId   = null;
    req.session.userName = null;
    req.session.userRole = null;
    req.session._flash   = {};
  }
  // Prevent browser back-button from showing cached dashboard (bfcache)
  res.setHeader('Clear-Site-Data', '"cache"');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.redirect("/login");
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function friendlyError(code) {
  const map = {
    "auth/invalid-email":           "Invalid email address.",
    "auth/user-not-found":          "No account found with that email.",
    "auth/wrong-password":          "Incorrect password.",
    "auth/invalid-credential":      "Incorrect email or password.",
    "auth/email-already-in-use":    "That email is already registered.",
    "auth/weak-password":           "Password must be at least 6 characters.",
    "auth/too-many-requests":       "Too many attempts. Try again later.",
    "auth/network-request-failed":  "Network error. Check your internet connection.",
    "auth/operation-not-allowed":   "Email/Password sign-in is not enabled in Firebase Console.",
    "auth/configuration-not-found": "Firebase Auth not configured. Enable Email/Password in Firebase Console.",
  };
  return map[code] || `Error (${code || "unknown"}). Please try again.`;
}
