import { db } from "../models/firebaseConfig.js";
import { collection, getDocs, getDoc, doc } from "firebase/firestore";

// ── GET /api/notifications ────────────────────────────────────────────────────
// Role-specific alerts for all logged-in users
export const getNotifications = async (req, res) => {
  try {
    const role   = req.session.userRole;
    const userId = req.session.userId;
    const alerts = [];

    // Load ongoing events
    const evSnap = await getDocs(collection(db, "events"));
    const ongoingEvents = evSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(e => e.status === "ongoing");

    for (const ev of ongoingEvents) {
      // Filter by role
      if (role === "organizer" && ev.createdBy && ev.createdBy !== userId) continue;
      if (role === "judge") {
        const assignedIds = Array.isArray(ev.assignedJudges) ? ev.assignedJudges : [];
        if (!assignedIds.includes(userId)) continue;
      }

      const assignedJudgeIds = Array.isArray(ev.assignedJudges) ? ev.assignedJudges : [];
      if (assignedJudgeIds.length === 0) continue;

      // Parallel fetch scores + contestants
      const [scoresSnap, contestantsSnap] = await Promise.all([
        getDocs(collection(db, "events", ev.id, "scores")),
        getDocs(collection(db, "events", ev.id, "contestants")),
      ]);
      const totalContestants = contestantsSnap.size;
      if (totalContestants === 0) continue;

      // Per-judge score counts
      const judgeScoreCounts = {};
      scoresSnap.docs.forEach(d => {
        const { judgeId } = d.data();
        if (judgeId) judgeScoreCounts[judgeId] = (judgeScoreCounts[judgeId] || 0) + 1;
      });

      // Time remaining
      let timeLabel = "";
      let urgency   = "normal";
      if (ev.date && ev.endTime) {
        try {
          const endDate  = new Date(ev.date + "T" + ev.endTime + ":00");
          const minsLeft = Math.floor((endDate - Date.now()) / 60000);
          if (minsLeft > 0 && minsLeft <= 120) {
            timeLabel = minsLeft <= 30
              ? `ends in ${minsLeft} min`
              : `ends in ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`;
            urgency = minsLeft <= 30 ? "critical" : "warning";
          }
        } catch (_) {}
      }

      // Judge sees only their own progress
      if (role === "judge") {
        const scored    = judgeScoreCounts[userId] || 0;
        const remaining = totalContestants - scored;
        if (remaining > 0) {
          alerts.push({
            id:      `judge-own-${ev.id}`,
            type:    urgency === "critical" ? "critical" : "warning",
            icon:    urgency === "critical" ? "⏰" : "📋",
            title:   `You have ${remaining} contestant${remaining > 1 ? "s" : ""} left to score`,
            message: `"${ev.name}" — ${scored}/${totalContestants} scored${timeLabel ? " — " + timeLabel : ""}.`,
            eventId: ev.id,
            urgency: urgency === "normal" ? "warning" : urgency,
          });
        }
        continue;
      }

      // Admin / organizer / tabulator — show all judges
      const judgeNames = {};
      await Promise.all(assignedJudgeIds.map(async (jId, idx) => {
        try {
          const uSnap = await getDoc(doc(db, "users", jId));
          if (uSnap.exists()) judgeNames[jId] = uSnap.data().name || `Judge ${idx + 1}`;
        } catch (_) {}
      }));

      assignedJudgeIds.forEach((jId, idx) => {
        const scored    = judgeScoreCounts[jId] || 0;
        const alias     = `Judge ${idx + 1}`;
        const remaining = totalContestants - scored;
        if (remaining > 0) {
          alerts.push({
            id:      `judge-${ev.id}-${jId}`,
            type:    urgency === "critical" ? "critical" : urgency === "warning" ? "warning" : "info",
            icon:    urgency === "critical" ? "⏰" : urgency === "warning" ? "⚠️" : "📋",
            title:   `${alias} hasn't finished scoring`,
            message: `${alias} (${judgeNames[jId] || alias}) — ${scored}/${totalContestants} for "${ev.name}"${timeLabel ? " — " + timeLabel : ""}.`,
            eventId: ev.id,
            urgency,
          });
        }
      });

      // Notify when a judge has scored all contestants
      assignedJudgeIds.forEach((jId, idx) => {
        const scored = judgeScoreCounts[jId] || 0;
        if (scored >= totalContestants) {
          alerts.push({
            id:      `judge-complete-${ev.id}-${jId}`,
            type:    'info',
            icon:    '✅',
            title:   'Judge scoring complete',
            message: `${judgeNames[jId] || ('Judge ' + (idx+1))} has submitted scores for all ${totalContestants} contestants in "${ev.name}".`,
            eventId: ev.id,
            urgency: 'normal',
          });
        }
      });
    }

    // Pending accounts (admin only)
    if (role === "admin") {
      const usersSnap    = await getDocs(collection(db, "users"));
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
        });
      }
    }

    const order = { critical: 0, warning: 1, normal: 2 };
    alerts.sort((a, b) => (order[a.urgency] || 2) - (order[b.urgency] || 2));

    res.json({ alerts, count: alerts.length });
  } catch (err) {
    console.error("Notifications error:", err);
    res.json({ alerts: [], count: 0 });
  }
};
