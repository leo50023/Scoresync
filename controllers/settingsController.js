import { db } from "../models/firebaseConfig.js";
import { doc, getDoc, updateDoc, deleteField, collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from "firebase/firestore";
import { sanitizeText } from "../utils/sanitize.js";
import { setCachedUserAvatar } from "../utils/userAvatarCache.js";

export const settingsPage = async (req, res) => {
  try {
    let userData = {};
    if (req.session.userId) {
      const userRef = doc(db, "users", req.session.userId);
      const snap = await getDoc(userRef);
      if (snap.exists()) userData = snap.data();
    }

    // Only real submissions from Firestore — no fake defaults
    let suggestions = [];
    try {
      const q = query(collection(db, "feature_requests"), orderBy("createdAt", "desc"), limit(20));
      const querySnap = await getDocs(q);
      querySnap.forEach(d => suggestions.push({ id: d.id, ...d.data() }));
    } catch (e) {
      // Collection doesn't exist yet — that's fine, suggestions stays []
    }

    res.render("settings/index", {
      title: "Settings",
      userName:    req.session.userName,
      userEmail:   userData.email || "",
      userAvatar:  userData.avatar || req.session.userAvatar || "",
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality:  "Gloria, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel:       "Gemini 2.5 Flash",
      suggestions,
    });
  } catch (err) {
    console.error("Settings page error:", err);
    res.render("settings/index", {
      title:       "Settings",
      userName:    req.session.userName,
      userEmail:   "",
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      municipality:  "Gloria, Oriental Mindoro",
      systemVersion: "v2.5.0-PROD",
      aiModel:       "Gemini 2.5 Flash",
      suggestions:   [],
    });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const removeAvatar = req.body.removeAvatar === "1";
    if (req.session.userId) {
      const updates = {};

      // Sanitize name: strip HTML tags, trim whitespace
      if (name && name.trim()) {
        const cleanName = name.trim().replace(/<[^>]*>/g, "").slice(0, 100);
        if (cleanName) {
          updates.name = cleanName;
          req.session.userName = cleanName;
        }
      }

      if (removeAvatar) {
        updates.avatar = deleteField();
        updates.photoURL = deleteField();
        updates.photo = deleteField();
      } else if (avatar && typeof avatar === "string") {
        // Validate avatar: must be a valid image data URL, max 2MB
        const validMime = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(avatar);
        // Base64 string length * 0.75 ≈ actual byte size
        const approxBytes = Math.round((avatar.length * 3) / 4);
        const maxBytes = 2 * 1024 * 1024; // 2MB

        if (!validMime) {
          req.flash("error_msg", "Invalid image format. Only JPEG, PNG, WebP, or GIF allowed.");
          return res.redirect("/settings");
        }
        if (approxBytes > maxBytes) {
          req.flash("error_msg", "Profile photo must be under 2MB.");
          return res.redirect("/settings");
        }
        updates.avatar = avatar;
      }

      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, "users", req.session.userId), updates);
        if (removeAvatar) {
          req.session.userAvatar = "";
          setCachedUserAvatar(req.session.userId, "");
        } else if (Object.hasOwn(updates, "avatar")) {
          setCachedUserAvatar(req.session.userId, updates.avatar);
        }
      }
      req.flash("success_msg", "Profile updated successfully!");
    }
    res.redirect("/settings");
  } catch (err) {
    console.error("Update settings error:", err);
    req.flash("error_msg", "Failed to update settings.");
    res.redirect("/settings");
  }
};

export const suggestFeature = async (req, res) => {
  try {
    const title       = sanitizeText(req.body.title, 150);
    const category    = sanitizeText(req.body.category, 50);
    const description = sanitizeText(req.body.description, 1000);
    if (title && description) {
      await addDoc(collection(db, "feature_requests"), {
        title: title.trim(),
        category: category || "General",
        description: description.trim(),
        submittedBy: req.session.userName || "Anonymous User",
        votes: 1,
        status: "Submitted",
        createdAt: serverTimestamp()
      });
      req.flash("success_msg", "Thank you! Your feature suggestion has been submitted successfully.");
    }
    res.redirect("/settings");
  } catch (err) {
    console.error("Suggest feature error:", err);
    req.flash("error_msg", "Unable to submit feature suggestion.");
    res.redirect("/settings");
  }
};
