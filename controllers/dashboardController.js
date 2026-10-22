import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc, updateDoc, query, orderBy, limit, where,
} from "firebase/firestore";
import { applyAutoStatus } from "../utils/autoStatus.js";

export const dashboardPage = async (req, res) => {
  let role = req.session.userRole;
  // Prevent browser from caching dashboard — back button after logout must not show it
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    // Re-sync role from Firestore in case session is stale
    if (req.session.userId) {
      const freshSnap = await getDoc(doc(db, "users", req.session.userId));
      if (freshSnap.exists()) {
        const freshRole = freshSnap.data().role;
        if (freshRole && freshRole !== role) {
          req.session.userRole = freshRole;
          role = freshRole;
        }
      }
    }
    // Load all events for judges, but only recent events for other roles.
    const eventsQuery = role === "judge" || role === "tabulator"
      ? query(collection(db, "events"), orderBy("createdAt", "desc"))
      : query(collection(db, "events"), orderBy("createdAt", "desc"), limit(5));
    const snap = await getDocs(eventsQuery);
    const recentEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count totals for admin
    let totalEvents = 0, totalUsers = 0, pendingCount = 0, ongoingCount = 0;
    let pendingUsers = [];
    let ongoingEvents = [];
    let judges = [];

    if (role === "admin") {
      const [evSnap, uSnap] = await Promise.all([
        getDocs(collection(db, "events")),
        getDocs(collection(db, "users")),
      ]);
      // Run auto-status on all events first
      const allEvs = evSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      await Promise.all(
        allEvs.filter(e => e.date && e.status !== 'cancelled')
              .map(e => applyAutoStatus(e.id, e))
      );
      totalEvents  = evSnap.size;
      ongoingCount = allEvs.filter(e => e.status === 'ongoing').length;

      const allUsers = uSnap.docs.map(d => {
        const data = d.data();
        const emailSubject = encodeURIComponent("ScoreSync Account Approved!");
        const emailBody = encodeURIComponent(`Hi ${data.name || 'User'},\n\nYour ScoreSync account request for the role of ${data.role || 'user'} has been APPROVED by the Administrator.\n\nYou can now log in to the system.\n\nBest regards,\nScoreSync Admin`);
        const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(data.email)}&su=${emailSubject}&body=${emailBody}`;

        return {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toLocaleDateString("en-PH") || "—",
          gmailUrl,
        };
      });

      pendingUsers = allUsers.filter(u => u.status === "pending");
      pendingCount = pendingUsers.length;
      totalUsers  = allUsers.filter(u => u.status !== "pending").length;
    }

    // Organizer: load ongoing events + judges list
    if (role === "organizer") {
      // First: run auto-status on all events so Firestore is up-to-date
      const allEvForStatus = await getDocs(query(collection(db, "events")));
      await Promise.all(
        allEvForStatus.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(e => e.date && e.status !== 'cancelled')
          .map(e => applyAutoStatus(e.id, e))
      );

      const [ongoingSnap, allEvSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "events"), where("status", "==", "ongoing"))),
        getDocs(collection(db, "events")),
        getDocs(query(collection(db, "users"), where("role", "==", "judge"))),
      ]);
      ongoingEvents = ongoingSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(e => e.name && e.name.trim() !== ''); // skip corrupt/deleted stale docs
      ongoingCount  = ongoingEvents.length;
      totalEvents   = allEvSnap.size;
      judges = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.status === "active" || u.status === "approved" || !u.status)
        .map((u, idx) => ({
          id:      u.id,
          name:    u.name || u.displayName || u.email || "Judge",
          alias:   `Judge ${idx + 1}`,
          email:   u.email || "",
          initial: String(idx + 1),
        }));
    }

    const viewData = {
      title: "Dashboard",
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     role === "admin",
      isJudge:     role === "judge",
      isEncoder:   role === "encoder",
      isOrganizer: role === "organizer",
      isTabulator: role === "tabulator",
      recentEvents,
      totalEvents,
      totalUsers,
      ongoingCount,
      ongoingEvents,
      judges,
      pendingUsers,
      pendingCount,
    };

    if (role === "admin")     return res.render("dashboard/admin",     viewData);
    if (role === "judge" || role === "tabulator") {
      // Show all events to judges so they can find ongoing scoring assignments.
      await Promise.all(
        recentEvents
          .filter(ev => ev.date && ev.status !== "cancelled")
          .map(ev => applyAutoStatus(ev.id, ev))
      );
      const judgeEvents = await Promise.all(
        recentEvents.map(async (ev) => {
          try {
            const [cSnap, crSnap, sSnap] = await Promise.all([
              getDocs(collection(db, "events", ev.id, "contestants")),
              getDocs(collection(db, "events", ev.id, "criteria")),
              getDocs(collection(db, "events", ev.id, "scores")),
            ]);
            const myScores = sSnap.docs.filter(d => d.data().judgeId === req.session.userId);
            const scoredIds = new Set(myScores.map(d => d.data().contestantId));
            // Check if this judge is assigned to this event
            // Empty assignedJudges means no one is assigned yet — block everyone
            const assignedJudges = ev.assignedJudges || [];
            const isAssigned = role === "tabulator"
              || (assignedJudges.length > 0 && assignedJudges.includes(req.session.userId));
            return {
              ...ev,
              contestantCount: cSnap.size,
              criteriaCount:   crSnap.size,
              myScoreCount:    scoredIds.size,
              completionPct:   cSnap.size > 0 ? Math.round((scoredIds.size / cSnap.size) * 100) : 0,
              isAssigned,
            };
          } catch (_) { return ev; }
        })
      );
      const judgeOngoingCount = judgeEvents.filter(ev => ev.status === "ongoing").length;
      const readyEventCount = judgeEvents.filter(ev => ev.status === "ongoing" && ev.isAssigned).length;
      const completedEventCount = judgeEvents.filter(ev => ev.status === "completed").length;
      return res.render("dashboard/judge", {
        ...viewData,
        recentEvents: judgeEvents,
        ongoingCount: judgeOngoingCount,
        readyEventCount,
        completedEventCount,
      });
    }
    if (role === "organizer") return res.render("dashboard/organizer", viewData);
    return res.render("dashboard/encoder", viewData);
  } catch (err) {
    console.error(err);
    // Fallback: render a simple dashboard without stats
    res.render("dashboard/admin", {
      title: "Dashboard",
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     role === "admin",
      isJudge:     role === "judge",
      isEncoder:   role === "encoder",
      isOrganizer: role === "organizer",
      isTabulator: role === "tabulator",
      recentEvents: [],
      totalEvents: 0,
      totalUsers: 0,
      ongoingCount: 0,
      ongoingEvents: [],
      judges: [],
    });
  }
};
