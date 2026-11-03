import { db } from "../models/firebaseConfig.js";
import { collection, getDocs, getDoc, doc, query, where } from "firebase/firestore";

// ── GET /api/notifications ───────────────────────────────────────────────────
// Returns alerts for admin/organizer:
//  - Judges who haven't submitted scores on ongoing events
//  - Events ending soon with incomplete scoring
//  - Pending account requests (admin only)
export const getNotifications = async (req, res) => {
  try {
    const role   = req.session.userRole;
    const userId = req.session.userId;
    const alerts = [];

    // ── 1. Load ongoing events ──────────────────────────────────────────────
    const evSnap = await getDocs(collection(db, "events"));
    const ongoingEvents = evSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status === "ongoing");

    for (const ev of ongoingEvents) {
      // Only show alerts for events this organizer owns (or all for admin)
      if (role === "organizer" && ev.createdBy && ev.createdBy !== userId) continue;

      // ── 2. Get assigned judges ──────────────────────────────────────────
      const assignedJudgeIds = Array.isArray(ev.assignedJudges) ? ev.assignedJudges : [];
      if (assignedJudgeIds.length === 0) continue;

      // ── 3. Get scores already submitted ────────────────────────────────
      const scoresSnap = await getDocs(collection(db, "events", ev.id, "scores"));
      const contestantsSnap = await getDocs(collection(db, "events", ev.id, "contestants"));
      const totalContestants = contestantsSnap.size;

      if (totalContestants === 0) continue;

      // Per-judge: how many contestants have they scored?
      const judgeScoreCounts = {};
      scoresSnap.docs.forEach(d => {
        const { judgeId } = d.data();
        if (judgeId) judgeScoreCounts[judgeId] = (judgeScoreCounts[judgeId] || 0) + 1;
      });

      // ── 4. Check time remaining ─────────────────────────────────────────
      let timeLabel = "";
      let urgency   = "normal"; // normal | warning | critical
      if (ev.date && ev.endTime) {
        try {
          const [h, m] = ev.endTime.split(":").map(Number);
          const endDate = new Date(ev.date + "T" + ev.endTime + ":00");
          const minsLeft = Math.floor((endDate - Date.now()) / 60000);
          if (minsLeft > 0 && minsLeft <= 120) {
            timeLabel = minsLeft <= 30
              ? `ends in ${minsLeft} min`
              : `ends in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`;
            urgency = minsLeft <= 30 ? "critical" : "warning";
          }
        } catch (_) {}
      }

      // ── 5. Find judges who haven't completed scoring ────────────────────
      // Load judge names
      const judgeNames = {};
      await Promise.all(assignedJudgeIds.map(async jId => {
        try {
          const uSnap = await getDoc(doc(db, "users", jId));
          if (uSnap.exists()) judgeNames[jId] = uSnap.data().name || "Judge";
        } catch (_) {}
      }));

      assignedJudgeIds.forEach((jId, idx) => {
        const scored = judgeScoreCounts[jId] || 0;
        const alias  = `Judge ${idx + 1}`;
        if (scored < totalContestants) {
          const remaining = totalContestants - scored;
          alerts.push({
            id:       `judge-${ev.id}-${jId}`,
            type:     urgency === "critical" ? "critical" : urgency === "warning" ? "warning" : "info",
            icon:     urgency === "critical" ? "⏰" : urgency === "warning" ? "⚠️" : "📋",
            title:    `${alias} hasn't finished scoring`,
            message:  `${alias} (${judgeNames[jId] || "Judge"}) scored ${scored}/${totalContestants} contestants for "${ev.name}"${timeLabel ? " — " + timeLabel : ""}.`,
            eventId:  ev.id,
            eventName: ev.name,
            urgency,
            time: new Date().toISOString(),
          });
        }
      });
    }

    // ── 6. Pending account requests (admin only) ────────────────────────────
    if (role === "admin") {
      const usersSnap = await getDocs(collection(db, "users"));
      const pendingCount = usersSnap.docs.filter(d => d.data().status === "pending").length;
      if (pendingCount > 0) {
        alerts.push({
          id:      "pending-users",
          type:    "info",
          icon:    "👤",
          title:   `${pendingCount} pending account request${pendingCount > 1 ? "s" : ""}`,
          message: `${pendingCount} user${pendingCount > 1 ? "s" : ""} waiting for approval.`,
          link:    "/users",
          urgency: "normal",
          time:    new Date().toISOString(),
        });
      }
    }

    // Sort: critical first, then warning, then info
    const order = { critical: 0, warning: 1, normal: 2 };
    alerts.sort((a, b) => (order[a.urgency] || 2) - (order[b.urgency] || 2));

    res.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error("Notifications error:", err);
    res.json({ alerts: [], count: 0 });
  }
};
