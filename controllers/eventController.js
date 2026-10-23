import { db } from "../models/firebaseConfig.js";
import { getFinanceSummary } from "./financeController.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp,
} from "firebase/firestore";
import { applyAutoStatus } from "../utils/autoStatus.js";
import { sanitizeText } from "../utils/sanitize.js";
import { sendJudgeAssignedEmail } from "../utils/mailer.js";
import { sortContestantsByNumber } from "../utils/contestantOrder.js";
import { parseEventCriteria } from "../utils/eventCriteria.js";

const EVENTS = "events";
const PAYMENT_TYPES = ['cultural','choral','dance','culinary','booth','sports','academic','other'];
const PRIZE_TYPES   = ['pageant','talent','choral','dance','culinary','academic'];

// --- List all events ----------------------------------------------------------
export const listEvents = async (req, res) => {
  try {
    const q    = query(collection(db, EVENTS), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    await Promise.all(
      events
        .filter(e => e.date && e.status !== 'cancelled')
        .map(e => applyAutoStatus(e.id, e))
    );

    res.render("events/index", {
      title:       "Events",
      events,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load events.");
    res.redirect("/dashboard");
  }
};

// --- Create event form --------------------------------------------------------
export const createEventPage = (req, res) => {
  res.render("events/create", {
    title:       "Create Event",
    userName:    req.session.userName,
    userRole:    req.session.userRole,
    userInitial: (req.session.userName || "U")[0].toUpperCase(),
    isAdmin:     req.session.userRole === "admin",
    isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
  });
};

// --- Store new event ----------------------------------------------------------
export const storeEvent = async (req, res) => {
  const {
    name, description, date, time, endTime, venue, type, status,
    organizer, maxContestants, prizes, rules, theme, notes,
    paymentMethod, paymentAccountName, paymentAccountNumber, paymentQR,
    otherType, coverPhoto,
  } = req.body;
  try {
    const evRef = await addDoc(collection(db, EVENTS), {
      name:                 name || "",
      description:          description || "",
      date:                 date || "",
      time:                 time || "",
      endTime:              endTime || "",
      venue:                venue || "",
      type:                 type || "pageant",
      otherType:            otherType || "",
      status:               status || "upcoming",
      organizer:            organizer || "",
      maxContestants:       maxContestants || "",
      prizes:               prizes || "",
      rules:                rules || "",
      theme:                theme || "blue",
      notes:                notes || "",
      coverPhoto:           (coverPhoto && coverPhoto.startsWith('data:image')) ? coverPhoto : "",
      paymentMethod:        paymentMethod        || "",
      paymentAccountName:   paymentAccountName   || "",
      paymentAccountNumber: paymentAccountNumber || "",
      paymentQR:            paymentQR            || "",
      assignedJudges:       [],                        // no judges assigned on creation
      createdBy:            req.session.userId,
      createdAt:            serverTimestamp(),
    });

    // -- Save inline criteria submitted from create form ----------------------
    const useMultiCategory = req.body.useMultiCategory;
    if (useMultiCategory) {
      // Multi-category template — create categories + per-category criteria
      try {
        const template = JSON.parse(useMultiCategory);
        for (const cat of template) {
          const catRef = await addDoc(collection(db, EVENTS, evRef.id, "categories"), {
            name: cat.name, order: cat.order, createdAt: serverTimestamp(),
          });
          for (const cr of (cat.criteria || [])) {
            await addDoc(collection(db, EVENTS, evRef.id, "categories", catRef.id, "criteria"), {
              name: cr.name, weight: cr.weight, maxScore: cr.maxScore,
              description: "", createdAt: serverTimestamp(),
            });
          }
        }
      } catch (e) { console.error("Multi-category template error:", e); }
    } else {
      const criteria = parseEventCriteria(req.body);
      await Promise.all(
        criteria.map(criterion => addDoc(collection(db, EVENTS, evRef.id, "criteria"), {
          ...criterion, createdAt: serverTimestamp(),
        }))
      );
    }

    req.flash("success_msg", `Event "${name}" created successfully.`);
    res.redirect(`/events/${evRef.id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to create event. " + err.message);
    res.redirect("/events/create");
  }
};

// --- Event detail -------------------------------------------------------------
export const showEvent = async (req, res) => {
  try {
    const snap = await getDoc(doc(db, EVENTS, req.params.id));
    if (!snap.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }
    const ev = { id: snap.id, ...snap.data() };
    ev.hiddenOrganizerMoreItems = Array.isArray(ev.hiddenOrganizerMoreItems)
      ? ev.hiddenOrganizerMoreItems
      : [];

    ev.isPaymentType   = PAYMENT_TYPES.includes(ev.type);
    ev.isPrizeType     = PRIZE_TYPES.includes(ev.type);
    ev.canManageFinance = ['admin','organizer'].includes(req.session.userRole);

    await applyAutoStatus(req.params.id, ev);

    const [cSnap, crSnap, finance, usersSnap, auditSnap] = await Promise.all([
      getDocs(collection(db, EVENTS, req.params.id, "contestants")),
      getDocs(collection(db, EVENTS, req.params.id, "criteria")),
      getFinanceSummary(req.params.id),
      getDocs(collection(db, "users")),
      getDocs(collection(db, EVENTS, req.params.id, "audit_log")),
    ]);
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria    = crSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Load categories for multi-category events
    let categories = [];
    try {
      const catSnap = await getDocs(collection(db, EVENTS, req.params.id, "categories"));
      const catDocs = catSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.order||0)-(b.order||0));
      categories = await Promise.all(catDocs.map(async cat => {
        const crSnap2 = await getDocs(collection(db, EVENTS, req.params.id, "categories", cat.id, "criteria"));
        return { ...cat, criteria: crSnap2.docs.map(d => ({ id: d.id, ...d.data() })) };
      }));
    } catch (_) { categories = []; }

    // Audit log � sorted newest first
    const auditLog = auditSnap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          timestampStr: data.timestamp?.toDate?.()?.toLocaleString("en-PH", {
            month: "short", day: "numeric", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: true,
          }) || "�",
        };
      })
      .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

    // All judges in the system
    const allJudges = usersSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(u => u.role === 'judge' && u.status !== 'pending');

    // Assigned judges with names
    const assignedJudgeIds = ev.assignedJudges || [];
    const assignedJudges = allJudges.filter(j => assignedJudgeIds.includes(j.id));
    // Unassigned judges (available to assign)
    const availableJudges = allJudges.filter(j => !assignedJudgeIds.includes(j.id));

    res.render("events/show", {
      title:       ev.name,
      event:       ev,
      contestants,
      criteria,
      categories,
      finance,
      auditLog,
      allJudges,
      assignedJudges,
      availableJudges,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isJudge:     req.session.userRole === "judge",
      isEncoder:   req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
      canManageFinance: ['admin','organizer'].includes(req.session.userRole),
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// --- Edit event form ----------------------------------------------------------
export const editEventPage = async (req, res) => {
  try {
    const snap = await getDoc(doc(db, EVENTS, req.params.id));
    if (!snap.exists()) return res.redirect("/events");
    const ev = { id: snap.id, ...snap.data() };
    res.render("events/edit", {
      title:         `Edit � ${ev.name}`,
      event:         ev,
      userName:      req.session.userName,
      userRole:      req.session.userRole,
      userInitial:   (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:       req.session.userRole === "admin",
      isOrganizer:   req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
      isPaymentType: PAYMENT_TYPES.includes(ev.type),
      isPrizeType:   PRIZE_TYPES.includes(ev.type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// --- Update event -------------------------------------------------------------
export const updateEvent = async (req, res) => {
  const {
    name, description, date, time, endTime, venue, type, status,
    organizer, maxContestants, prizes, rules, theme, notes,
    paymentMethod, paymentAccountName, paymentAccountNumber, paymentQR,
    otherType, coverPhoto,
  } = req.body;
  try {
    const eventRef = doc(db, EVENTS, req.params.id);
    const existingEvent = await getDoc(eventRef);
    if (!existingEvent.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }
    const existingData = existingEvent.data();
    const scheduleChanged = date !== existingData.date
      || time !== existingData.time
      || (endTime || "") !== (existingData.endTime || "");
    await updateDoc(doc(db, EVENTS, req.params.id), {
      name, description, date, time, venue, type, status,
      statusManuallySet: scheduleChanged
        ? false
        : existingData.statusManuallySet || status !== existingData.status,
      endTime:              endTime              || "",
      otherType:            otherType            || "",
      organizer:            organizer            || "",
      maxContestants:       maxContestants       || "",
      prizes:               prizes               || "",
      rules:                rules                || "",
      theme:                theme                || "blue",
      notes:                notes                || "",
      coverPhoto:           (coverPhoto && coverPhoto.startsWith('data:image')) ? coverPhoto : "",
      paymentMethod:        paymentMethod        || "",
      paymentAccountName:   paymentAccountName   || "",
      paymentAccountNumber: paymentAccountNumber || "",
      paymentQR:            paymentQR            || "",
    });
    req.flash("success_msg", `Event "${name}" updated successfully.`);
    res.redirect(`/events/${req.params.id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update event.");
    res.redirect(`/events/${req.params.id}/edit`);
  }
};

// --- Delete event -------------------------------------------------------------
export const deleteEvent = async (req, res) => {
  try {
    await deleteDoc(doc(db, EVENTS, req.params.id));
    req.flash("success_msg", "Event deleted.");
    res.redirect("/events");
  } catch (err) {
    req.flash("error_msg", "Failed to delete event.");
    res.redirect("/events");
  }
};

// --- Update event status ------------------------------------------------------
export const updateEventStatus = async (req, res) => {
  const { status } = req.body;
  const { id }     = req.params;
  try {
    if (!["upcoming", "ongoing", "completed", "cancelled"].includes(status)) {
      req.flash("error_msg", "Invalid status value.");
      return res.redirect(`/events/${id}`);
    }
    await updateDoc(doc(db, EVENTS, id), { status, statusManuallySet: true });
    const statusLabels = {
      ongoing:   "started (Ongoing)",
      completed: "manually ended (Completed)",
      upcoming:  "reset to Upcoming",
      cancelled: "marked as Cancelled",
    };
    req.flash("success_msg", `Event status updated to ${statusLabels[status] || status}.`);
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update event status.");
    res.redirect(`/events/${id}`);
  }
};

// --- Assign judge to event ----------------------------------------------------
export const assignJudge = async (req, res) => {
  const { id } = req.params;
  const { judgeId } = req.body;
  try {
    if (!judgeId) {
      req.flash("error_msg", "Please select a judge.");
      return res.redirect(`/events/${id}`);
    }
    const [evSnap, judgeSnap] = await Promise.all([
      getDoc(doc(db, EVENTS, id)),
      getDoc(doc(db, "users", judgeId)),
    ]);
    if (!evSnap.exists()) return res.redirect("/events");
    const current = evSnap.data().assignedJudges || [];
    if (current.includes(judgeId)) {
      req.flash("error_msg", "This judge is already assigned to the event.");
      return res.redirect(`/events/${id}`);
    }
    await updateDoc(doc(db, EVENTS, id), {
      assignedJudges: [...current, judgeId],
    });

    // Automatically send notification email to the judge
    if (judgeSnap.exists()) {
      const ev     = evSnap.data();
      const judge  = judgeSnap.data();

      // Send email automatically � fire-and-forget (don't block the response)
      sendJudgeAssignedEmail({
        judgeName:  judge.name  || judge.displayName || 'Judge',
        judgeEmail: judge.email || '',
        eventName:  ev.name,
        eventDate:  ev.date  || '',
        eventVenue: ev.venue || '',
      }).catch(() => {}); // silent fail if email not configured

      req.flash("success_msg", `Judge assigned and notified via email.`);
    } else {
      req.flash("success_msg", "Judge assigned to event.");
    }
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to assign judge.");
    res.redirect(`/events/${id}`);
  }
};

// --- Remove judge from event --------------------------------------------------
export const removeJudge = async (req, res) => {
  const { id, judgeId } = req.params;
  try {
    const snap = await getDoc(doc(db, EVENTS, id));
    if (!snap.exists()) return res.redirect("/events");
    const current = snap.data().assignedJudges || [];
    await updateDoc(doc(db, EVENTS, id), {
      assignedJudges: current.filter(j => j !== judgeId),
    });
    req.flash("success_msg", "Judge removed from event.");
    res.redirect(`/events/${id}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to remove judge.");
    res.redirect(`/events/${id}`);
  }
};
