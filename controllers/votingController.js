import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  updateDoc, runTransaction, serverTimestamp,
} from "firebase/firestore";
import crypto from "crypto";
import { sortContestantsByNumber } from "../utils/contestantOrder.js";
import { hasPeoplesChoiceCriterion } from "../utils/eventCriteria.js";

function ensureVoterId(req) {
  if (!req.session) throw new Error("Voting session is unavailable.");
  if (typeof req.session.voterId !== "string") {
    req.session.voterId = crypto.randomUUID();
  }
  return req.session.voterId;
}

// ─── Organizer QR sharing page ────────────────────────────────────────────────
export const audienceVotingQrPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, criteriaSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "criteria")),
    ]);
    if (!eSnap.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }

    const event = { id: eSnap.id, ...eSnap.data() };
    const hasChoiceCriterion = hasPeoplesChoiceCriterion(
      criteriaSnap.docs.map(d => d.data().name)
    );

    res.render("voting/qr", {
      title: `Audience Voting QR — ${event.name}`,
      event,
      votingOpen: event.votingOpen === true && hasChoiceCriterion,
      peopleChoiceCriterionMissing: !hasChoiceCriterion,
      votePath: `/events/${encodeURIComponent(eventId)}/vote`,
      eventPath: `/events/${encodeURIComponent(eventId)}`,
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load the audience voting QR code.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Public voting page ───────────────────────────────────────────────────────
export const votingPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const voterId = ensureVoterId(req);
    const [eSnap, cSnap, vSnap, criteriaSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "votes")),
      getDocs(collection(db, "events", eventId, "criteria")),
    ]);

    if (!eSnap.exists()) return res.status(404).send("Event not found.");

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const hasChoiceCriterion = hasPeoplesChoiceCriterion(
      criteriaSnap.docs.map(d => d.data().name)
    );
    const votingOpen = ev.votingOpen === true && hasChoiceCriterion;

    // Build vote count map
    const votesByContestant = {};
    vSnap.docs.forEach(d => {
      const v = d.data();
      if (v.contestantId) {
        votesByContestant[v.contestantId] = (votesByContestant[v.contestantId] || 0) + 1;
      }
    });

    const totalVotes = vSnap.docs.length;
    const maxVotes   = Math.max(0, ...Object.values(votesByContestant));

    const contestants = sortContestantsByNumber(cSnap.docs
      .map(d => {
        const c         = { id: d.id, ...d.data() };
        const voteCount = votesByContestant[c.id] || 0;
        const voteBarPct = maxVotes > 0 ? Math.round((voteCount / maxVotes) * 100) : 0;
        return { ...c, voteCount, voteBarPct };
      }));

    res.render("voting/index", {
      title:             `Vote — ${ev.name}`,
      event:             ev,
      contestants,
      votesByContestant,
      votingOpen,
      peopleChoiceCriterionMissing: !hasChoiceCriterion,
      maxVotes,
      totalVotes,
      alreadyVoted: vSnap.docs.some(d => d.id === voterId),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load voting page.");
  }
};

// ─── Submit a vote ────────────────────────────────────────────────────────────
export const submitVote = async (req, res) => {
  const { eventId } = req.params;
  try {
    // (a) Fetch event and its criteria; audience votes require a People's Choice criterion.
    const [eSnap, criteriaSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "criteria")),
    ]);
    if (!eSnap.exists()) return res.redirect(`/events/${eventId}/vote`);

    if (!hasPeoplesChoiceCriterion(criteriaSnap.docs.map(d => d.data().name))) {
      req.flash("error_msg", "Add a People's Choice criterion before accepting audience votes.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    if (!eSnap.data().votingOpen) {
      req.flash("error_msg", "Voting is currently closed.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // (b) Sanitize and validate the selected contestant
    const contestantId = String(req.body.contestantId || "").trim().slice(0, 128);
    if (!contestantId) {
      req.flash("error_msg", "Invalid contestant.");
      return res.redirect(`/events/${eventId}/vote`);
    }
    const contestantSnap = await getDoc(doc(db, "events", eventId, "contestants", contestantId));
    if (!contestantSnap.exists()) {
      req.flash("error_msg", "Invalid contestant.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // The browser's signed session ID makes duplicate submissions atomic per event.
    const voterId = ensureVoterId(req);
    const voteRef = doc(db, "events", eventId, "votes", voterId);
    const voteRecorded = await runTransaction(db, async transaction => {
      const existingVote = await transaction.get(voteRef);
      if (existingVote.exists()) return false;

      transaction.set(voteRef, {
        contestantId,
        voterId,
        votedAt: serverTimestamp(),
      });
      return true;
    });
    if (!voteRecorded) {
      req.flash("error_msg", "You have already voted.");
      return res.redirect(`/events/${eventId}/vote`);
    }

    // (c) Flash success + redirect
    req.flash("success_msg", "Your vote has been cast!");
    res.redirect(`/events/${eventId}/vote`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to submit vote. Please try again.");
    res.redirect(`/events/${eventId}/vote`);
  }
};

// ─── Vote results (redirects to voting page — results shown inline) ───────────
export const voteResults = async (req, res) => {
  const { eventId } = req.params;
  res.redirect(`/events/${eventId}/vote`);
};

// ─── Toggle voting open/closed ─────────────────────────────────────────────────
export const toggleVoting = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const isVotingOpen = eSnap.data().votingOpen === true;
    const newState = !isVotingOpen;
    if (newState) {
      const criteriaSnap = await getDocs(collection(db, "events", eventId, "criteria"));
      if (!hasPeoplesChoiceCriterion(criteriaSnap.docs.map(d => d.data().name))) {
        req.flash("error_msg", "Add a People's Choice criterion before opening audience voting.");
        return res.redirect(`/events/${eventId}`);
      }
    }

    await updateDoc(doc(db, "events", eventId), { votingOpen: newState });

    req.flash(
      "success_msg",
      newState
        ? "Voting is now OPEN. Share the link with your audience."
        : "Voting is now CLOSED."
    );
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to toggle voting.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Save organizer More menu visibility ──────────────────────────────────────
export const saveOrganizerMoreMenu = async (req, res) => {
  const { eventId } = req.params;
  try {
    const availableItems = new Set([
      "edit", "assignJudge", "criteria", "display", "publicResults",
      "registrationQr", "report", "exportCsv", "finance",
      "audienceVoting", "toggleVoting", "delete",
    ]);
    const submittedItems = req.body.hiddenItems === undefined
      ? []
      : Array.isArray(req.body.hiddenItems)
        ? req.body.hiddenItems
        : [req.body.hiddenItems];
    const hiddenItems = [...new Set(
      submittedItems.filter(item => typeof item === "string" && availableItems.has(item))
    )];

    const eventRef = doc(db, "events", eventId);
    const eventSnap = await getDoc(eventRef);
    if (!eventSnap.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }

    await updateDoc(eventRef, { hiddenOrganizerMoreItems: hiddenItems });
    req.flash("success_msg", "Organizer menu visibility saved.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to save organizer menu visibility.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Live vote counts (JSON, no auth, no cache) ───────────────────────────────
export const voteCounts = async (req, res) => {
  const { eventId } = req.params;
  try {
    const vSnap = await getDocs(collection(db, "events", eventId, "votes"));
    const votes = {};
    vSnap.docs.forEach(d => {
      const v = d.data();
      if (v.contestantId) {
        votes[v.contestantId] = (votes[v.contestantId] || 0) + 1;
      }
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ votes, total: vSnap.docs.length });
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).json({ votes: {}, total: 0 });
  }
};
