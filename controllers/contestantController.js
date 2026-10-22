import { db } from "../models/firebaseConfig.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, serverTimestamp,
} from "firebase/firestore";
import { autoCreateRegistrationRecord, autoDeleteRegistrationRecord } from "./inventoryController.js";
import { sanitizeText } from "../utils/sanitize.js";

// Contestants are sub-collections under events: events/{eventId}/contestants

// ─── Add contestant form ──────────────────────────────────────────────────────
export const addContestantPage = async (req, res) => {
  try {
    const eSnap = await getDoc(doc(db, "events", req.params.eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const ev = eSnap.data();
    const maxContestants = Number(ev.maxContestants) || 0;

    // Check limit before showing the form
    if (maxContestants > 0) {
      const cSnap = await getDocs(collection(db, "events", req.params.eventId, "contestants"));
      if (cSnap.size >= maxContestants) {
        req.flash("error_msg", `Contestant limit reached. This event allows a maximum of ${maxContestants} contestants.`);
        return res.redirect(`/events/${req.params.eventId}`);
      }
    }

    const PAYMENT_TYPES = ['talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    res.render("contestants/create", {
      title: "Add Contestant",
      event: { id: eSnap.id, ...ev },
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
      isPaymentType: PAYMENT_TYPES.includes(ev.type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load event.");
    res.redirect("/events");
  }
};

// ─── Store contestant ─────────────────────────────────────────────────────────
export const storeContestant = async (req, res) => {
  const name            = sanitizeText(req.body.name, 100);
  const number          = sanitizeText(req.body.number, 10);
  const barangay        = sanitizeText(req.body.barangay, 100);
  const age             = sanitizeText(req.body.age, 5);
  const gender          = sanitizeText(req.body.gender, 20);
  const description     = sanitizeText(req.body.description, 500);
  const photo           = req.body.photo  || "";
  const photo2          = req.body.photo2 || "";
  const platform        = sanitizeText(req.body.platform, 500);
  const registrationFee = req.body.registrationFee || "";
  const { eventId } = req.params;
  try {
    // ── Enforce maxContestants limit ─────────────────────────────────────────
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (eSnap.exists()) {
      const maxContestants = Number(eSnap.data().maxContestants) || 0;
      if (maxContestants > 0) {
        const cSnap = await getDocs(collection(db, "events", eventId, "contestants"));
        if (cSnap.size >= maxContestants) {
          req.flash("error_msg", `Cannot add more contestants. The limit for this event is ${maxContestants}.`);
          return res.redirect(`/events/${eventId}`);
        }
      }
    }

    const docRef = await addDoc(collection(db, "events", eventId, "contestants"), {
      name,
      number:          number          || "",
      barangay:        barangay        || "",
      age:             age             || "",
      gender:          gender          || "",
      description:     description     || "",
      platform:        platform        || "",
      photo:           photo           || "",
      photo2:          photo2          || "",
      registrationFee: Number(registrationFee) || 0,
      createdAt:       serverTimestamp(),
    });

    // Auto-create a ticket/income record for the registration fee
    await autoCreateRegistrationRecord(eventId, name, docRef.id, registrationFee, req.session.userId);

    req.flash("success_msg", `Contestant "${name}" added.`);
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add contestant.");
    res.redirect(`/events/${eventId}/contestants/add`);
  }
};

// ─── Edit contestant form ─────────────────────────────────────────────────────
export const editContestantPage = async (req, res) => {
  const { eventId, id } = req.params;
  try {
    const [eSnap, cSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDoc(doc(db, "events", eventId, "contestants", id)),
    ]);
    if (!eSnap.exists() || !cSnap.exists()) return res.redirect(`/events/${eventId}`);
    const PAYMENT_TYPES = ['talent','cultural','choral','dance','culinary','booth','sports','academic','other'];
    res.render("contestants/edit", {
      title: "Edit Contestant",
      event:      { id: eSnap.id, ...eSnap.data() },
      contestant: { id: cSnap.id, ...cSnap.data() },
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
      isPaymentType: PAYMENT_TYPES.includes(eSnap.data().type),
    });
  } catch (err) {
    req.flash("error_msg", "Could not load contestant.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Update contestant ────────────────────────────────────────────────────────
export const updateContestant = async (req, res) => {
  const { eventId, id } = req.params;
  const name        = sanitizeText(req.body.name, 100);
  const number      = sanitizeText(req.body.number, 10);
  const barangay    = sanitizeText(req.body.barangay, 100);
  const age         = sanitizeText(req.body.age, 5);
  const gender      = sanitizeText(req.body.gender, 20);
  const description = sanitizeText(req.body.description, 500);
  const photo       = req.body.photo  || "";
  const photo2      = req.body.photo2 || "";
  const platform    = sanitizeText(req.body.platform, 500);
  try {
    await updateDoc(doc(db, "events", eventId, "contestants", id), {
      name,
      number:      number      || "",
      barangay:    barangay    || "",
      age:         age         || "",
      gender:      gender      || "",
      description: description || "",
      platform:    platform    || "",
      photo:       photo       || "",
      photo2:      photo2      || "",
    });
    req.flash("success_msg", "Contestant updated.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    req.flash("error_msg", "Failed to update contestant.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Delete contestant ────────────────────────────────────────────────────────
export const deleteContestant = async (req, res) => {
  const { eventId, id } = req.params;
  try {
    await deleteDoc(doc(db, "events", eventId, "contestants", id));
    // Auto-delete the linked registration fee ticket record
    await autoDeleteRegistrationRecord(eventId, id);
    req.flash("success_msg", "Contestant removed.");
  } catch (err) {
    req.flash("error_msg", "Failed to remove contestant.");
  }
  res.redirect(`/events/${eventId}`);
};

// ─── Public self-registration page ───────────────────────────────────────────
export const selfRegisterPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.status(404).send("Event not found.");
    const ev = eSnap.data();
    if (ev.status === 'completed' || ev.status === 'cancelled') {
      return res.send(`<div style="font-family:sans-serif;text-align:center;padding:80px;background:#060e1a;color:#e2e8f0;min-height:100vh"><h2>Registration Closed</h2><p>This event is no longer accepting contestants.</p></div>`);
    }
    const flash = req.session._flash || {};
    req.session._flash = {};
    res.render("contestants/register", {
      title:     `Register — ${ev.name}`,
      event:     { id: eSnap.id, ...ev },
      success_msg: (flash.success_msg || [])[0] || "",
      error_msg:   (flash.error_msg   || [])[0] || "",
    });
  } catch (err) {
    res.status(500).send("Could not load registration form.");
  }
};

export const selfRegister = async (req, res) => {
  const { eventId } = req.params;
  const { name, barangay, age, platform, contact } = req.body;
  try {
    if (!name || !name.trim()) {
      if (!req.session._flash) req.session._flash = {};
      req.session._flash.error_msg = ["Full name is required."];
      return res.redirect(`/events/${eventId}/self-register`);
    }

    // Check max contestants
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (eSnap.exists()) {
      const maxContestants = Number(eSnap.data().maxContestants) || 0;
      if (maxContestants > 0) {
        const cSnap = await getDocs(collection(db, "events", eventId, "contestants"));
        if (cSnap.size >= maxContestants) {
          if (!req.session._flash) req.session._flash = {};
          req.session._flash.error_msg = [`Registration is full. This event only allows ${maxContestants} contestants.`];
          return res.redirect(`/events/${eventId}/self-register`);
        }
      }
    }

    await addDoc(collection(db, "events", eventId, "contestants"), {
      name:        name.trim(),
      barangay:    barangay  || "",
      age:         age       || "",
      platform:    platform  || "",
      contact:     contact   || "",
      photo:       "",
      number:      "",
      status:      "pending_approval", // needs admin approval
      selfRegistered: true,
      createdAt:   serverTimestamp(),
    });

    if (!req.session._flash) req.session._flash = {};
    req.session._flash.success_msg = [`Thank you, ${name.trim()}! Your registration has been submitted and is pending approval.`];
    res.redirect(`/events/${eventId}/self-register`);
  } catch (err) {
    console.error(err);
    if (!req.session._flash) req.session._flash = {};
    req.session._flash.error_msg = ["Failed to submit registration. Please try again."];
    res.redirect(`/events/${eventId}/self-register`);
  }
};
