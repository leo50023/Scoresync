import { db } from "../models/firebaseConfig.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { hasPeoplesChoiceCriterion } from "../utils/eventCriteria.js";

// Criteria are sub-collections under events: events/{eventId}/criteria

// ─── Add criteria form ────────────────────────────────────────────────────────
export const addCriteriaPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const crSnap = await getDocs(collection(db, "events", eventId, "criteria"));
    const criteria = crSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const totalWeight = criteria.reduce((sum, c) => sum + Number(c.weight || 0), 0);

    res.render("criteria/index", {
      title: "Scoring Criteria",
      event:    { id: eSnap.id, ...eSnap.data() },
      criteria,
      totalWeight,
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
    });
  } catch (err) {
    req.flash("error_msg", "Could not load criteria.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Store criteria ───────────────────────────────────────────────────────────
export const storeCriteria = async (req, res) => {
  const { eventId } = req.params;
  const { name, description, weight, maxScore } = req.body;
  try {
    // Validate total weight won't exceed 100
    const existing = await getDocs(collection(db, "events", eventId, "criteria"));
    const usedWeight = existing.docs.reduce((sum, d) => sum + Number(d.data().weight || 0), 0);
    if (usedWeight + Number(weight) > 100) {
      req.flash("error_msg", `Total weight would exceed 100%. Currently used: ${usedWeight}%.`);
      return res.redirect(`/events/${eventId}/criteria`);
    }

    await addDoc(collection(db, "events", eventId, "criteria"), {
      name,
      description: description || "",
      weight:   Number(weight)   || 0,
      maxScore: Number(maxScore) || 100,
      createdAt: serverTimestamp(),
    });
    req.flash("success_msg", `Criteria "${name}" added (${weight}%).`);
    res.redirect(`/events/${eventId}/criteria`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add criteria.");
    res.redirect(`/events/${eventId}/criteria`);
  }
};

// ─── Delete criteria ──────────────────────────────────────────────────────────
export const deleteCriteria = async (req, res) => {
  const { eventId, id } = req.params;
  try {
    const criterionRef = doc(db, "events", eventId, "criteria", id);
    const criterionSnap = await getDoc(criterionRef);
    const removesPeopleChoice = criterionSnap.exists()
      && hasPeoplesChoiceCriterion([criterionSnap.data().name]);
    if (removesPeopleChoice) {
      const eventRef = doc(db, "events", eventId);
      const eventSnap = await getDoc(eventRef);
      if (eventSnap.exists() && eventSnap.data().votingOpen === true) {
        await updateDoc(eventRef, { votingOpen: false });
      }
    }
    await deleteDoc(criterionRef);
    req.flash(
      "success_msg",
      removesPeopleChoice
        ? "People's Choice criterion removed. Audience voting has been closed."
        : "Criteria removed."
    );
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to remove criteria.");
  }
  res.redirect(`/events/${eventId}/criteria`);
};
