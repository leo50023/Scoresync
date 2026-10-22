import { db, auth, firebaseConfig } from "../models/firebaseConfig.js";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import {
  collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, query, orderBy,
} from "firebase/firestore";
import { sanitizeText, sanitizeEmail, sanitizeRole } from "../utils/sanitize.js";
import { sendMail } from "../utils/mailer.js";

// ─── List all users ───────────────────────────────────────────────────────────
export const listUsers = async (req, res) => {
  try {
    const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
    const allUsers = snap.docs.map(d => {
      const data = d.data();
      const emailSubject = encodeURIComponent("ScoreSync Account Approved!");
      const emailBody = encodeURIComponent(`Hi ${data.name || 'User'},\n\nYour ScoreSync account request for the role of ${data.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in to the system at ${req.protocol}://${req.get("host")}/login\n\nBest regards,\nScoreSync Admin`);
      const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(data.email)}&su=${emailSubject}&body=${emailBody}`;
      const mailtoUrl = `mailto:${encodeURIComponent(data.email)}?subject=${emailSubject}&body=${emailBody}`;

      return {
        id: d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toLocaleDateString("en-PH") || "—",
        gmailUrl,
        mailtoUrl,
      };
    });

    const pendingUsers = allUsers.filter(u => u.status === "pending");
    const activeUsers  = allUsers.filter(u => u.status !== "pending");

    // Count by role
    const adminCount      = allUsers.filter(u => u.role === "admin"     && u.status !== "pending").length;
    const judgeCount      = allUsers.filter(u => u.role === "judge"     && u.status !== "pending").length;
    const encoderCount    = allUsers.filter(u => u.role === "encoder"   && u.status !== "pending").length;
    const tabulatorCount  = allUsers.filter(u => u.role === "tabulator" && u.status !== "pending").length;
    const organizerCount  = allUsers.filter(u => u.role === "organizer" && u.status !== "pending").length;

    const notifyEmail = req.query.notifyEmail;
    const notifyName  = req.query.notifyName;
    const notifyGmail = req.query.notifyGmail;

    res.render("users/index", {
      title:        "Users",
      users:        activeUsers,
      pendingUsers,
      pendingCount: pendingUsers.length,
      adminCount,
      judgeCount,
      encoderCount,
      tabulatorCount,
      organizerCount,
      totalUsers:   activeUsers.length,
      userName:     req.session.userName,
      userRole:     req.session.userRole,
      userInitial:  (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:      true,
      notifyEmail,
      notifyName,
      notifyGmail,
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load users.");
    res.redirect("/dashboard");
  }
};

// ─── Approve account request ──────────────────────────────────────────────────
export const approveUser = async (req, res) => {
  const { id } = req.params;
  try {
    const userDoc = await getDoc(doc(db, "users", id));
    if (!userDoc.exists()) {
      req.flash("error_msg", "User request not found.");
      return res.redirect("/users");
    }
    const userData = userDoc.data();

    await updateDoc(doc(db, "users", id), { status: "approved" });

    // Auto-send approval email
    const loginUrl = `${req.protocol}://${req.get("host")}/login`;
    sendMail({
      to:      userData.email,
      subject: "ScoreSync Account Approved!",
      text:    `Hi ${userData.name || 'User'},\n\nYour ScoreSync account request for the role of ${userData.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in at: ${loginUrl}\n\nBest regards,\nScoreSync`,
      html:    `<div style="font-family:Inter,sans-serif;max-width:520px;margin:0 auto;background:#0a0f1e;color:#e2e8f0;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#064e3b,#059669);padding:28px 32px">
          <div style="font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(110,231,183,0.8);margin-bottom:8px">ScoreSync</div>
          <h1 style="font-size:22px;font-weight:900;color:#fff;margin:0">✓ Account Approved!</h1>
        </div>
        <div style="padding:28px 32px">
          <p style="color:#94a3b8;font-size:14px;margin:0 0 16px">Dear <strong style="color:#e2e8f0">${userData.name || 'User'}</strong>,</p>
          <p style="color:#94a3b8;font-size:14px;margin:0 0 16px">Your ScoreSync account request has been <strong style="color:#6ee7b7">approved</strong> by the Administrator.</p>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:16px 20px;margin-bottom:24px">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.08em">Role</div>
            <div style="font-size:15px;font-weight:800;color:#e2e8f0;margin-top:4px;text-transform:capitalize">${userData.role || 'user'}</div>
          </div>
          <a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-weight:700;font-size:14px;padding:12px 28px;border-radius:10px;text-decoration:none">Log in to ScoreSync →</a>
          <p style="color:#475569;font-size:12px;margin-top:24px">If you did not request this account, please ignore this email.</p>
        </div>
      </div>`,
    }).catch(() => {});

    req.flash("success_msg", `Account approved and ${userData.name} notified via email.`);
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to approve account request.");
    res.redirect("/users");
  }
};

// ─── Reject account request ───────────────────────────────────────────────────
export const rejectUser = async (req, res) => {
  const { id } = req.params;
  try {
    const userDoc = await getDoc(doc(db, "users", id));
    const userData = userDoc.exists() ? userDoc.data() : {};

    await updateDoc(doc(db, "users", id), { status: "rejected" });

    req.flash("success_msg", `Account request for ${userData.name || 'user'} rejected.`);
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to reject user request.");
    res.redirect("/users");
  }
};

// ─── Edit user role ───────────────────────────────────────────────────────────
export const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const role   = sanitizeRole(req.body.role, ["judge", "encoder", "organizer", "tabulator"]);
  const allowed = ["judge", "encoder", "organizer", "tabulator"]; // admin NOT in allowed — cannot assign or change to/from admin

  if (!allowed.includes(role)) {
    req.flash("error_msg", "Invalid role selection.");
    return res.redirect("/users");
  }

  // Prevent changing own role
  if (id === req.session.userId) {
    req.flash("error_msg", "You cannot change your own role.");
    return res.redirect("/users");
  }

  try {
    // Block changing an admin account's role
    const targetDoc = await getDoc(doc(db, "users", id));
    if (targetDoc.exists() && targetDoc.data().role === "admin") {
      req.flash("error_msg", "Admin accounts are protected and cannot have their role changed.");
      return res.redirect("/users");
    }

    await updateDoc(doc(db, "users", id), { role });
    req.flash("success_msg", "User role updated.");
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update role.");
    res.redirect("/users");
  }
};

// ─── Delete user ──────────────────────────────────────────────────────────────
export const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (id === req.session.userId) {
    req.flash("error_msg", "You cannot delete your own account.");
    return res.redirect("/users");
  }

  try {
    // Block deleting any admin account
    const targetDoc = await getDoc(doc(db, "users", id));
    if (targetDoc.exists() && targetDoc.data().role === "admin") {
      req.flash("error_msg", "Admin accounts are protected and cannot be deleted.");
      return res.redirect("/users");
    }

    await deleteDoc(doc(db, "users", id));
    req.flash("success_msg", "User removed from the system.");
    res.redirect("/users");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to delete user.");
    res.redirect("/users");
  }
};

// ─── Create user (admin) ──────────────────────────────────────────────────────
export const createUser = async (req, res) => {
  const name     = sanitizeText(req.body.name, 100);
  const email    = sanitizeEmail(req.body.email);
  const password = req.body.password || "";
  const role     = sanitizeRole(req.body.role, ["judge", "encoder", "organizer", "tabulator"]);
  const allowed = ["judge", "encoder", "organizer", "tabulator"]; // admin cannot be created via this form

  if (!name || !email || !password || !allowed.includes(role)) {
    req.flash("error_msg", "Please fill in all required fields and select a valid role.");
    return res.redirect("/users");
  }

  let tempApp;
  try {
    tempApp = initializeApp(firebaseConfig, "TempApp_" + Date.now());
    const tempAuth = getAuth(tempApp);

    const credential = await createUserWithEmailAndPassword(tempAuth, email, password);
    const uid = credential.user.uid;

    await setDoc(doc(db, "users", uid), {
      name,
      email,
      role,
      status: "approved",
      createdAt: new Date(),
    });

    await deleteApp(tempApp);

    req.flash("success_msg", `Successfully created ${role.toUpperCase()} account for ${name} (${email}).`);
    res.redirect("/users");
  } catch (err) {
    console.error("Create user error:", err);
    if (tempApp) try { await deleteApp(tempApp); } catch (_) {}
    
    let errMsg = "Failed to create user.";
    if (err.code === "auth/email-already-in-use") errMsg = "Email address is already registered.";
    else if (err.code === "auth/weak-password") errMsg = "Password should be at least 6 characters.";
    else if (err.message) errMsg += " " + err.message;

    req.flash("error_msg", errMsg);
    res.redirect("/users");
  }
};
