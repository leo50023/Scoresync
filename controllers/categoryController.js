import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  addDoc, deleteDoc, updateDoc, serverTimestamp, orderBy, query,
} from "firebase/firestore";
import { sanitizeText } from "../utils/sanitize.js";

// ─── List categories for an event ────────────────────────────────────────────
export const categoriesPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");

    const catSnap = await getDocs(
      query(collection(db, "events", eventId, "categories"), orderBy("order", "asc"))
    );
    const categories = await Promise.all(
      catSnap.docs.map(async d => {
        const cat = { id: d.id, ...d.data() };
        const crSnap = await getDocs(
          collection(db, "events", eventId, "categories", d.id, "criteria")
        );
        cat.criteria = crSnap.docs.map(c => ({ id: c.id, ...c.data() }));
        cat.totalWeight = cat.criteria.reduce((s, c) => s + Number(c.weight || 0), 0);
        return cat;
      })
    );

    res.render("categories/index", {
      title:       "Event Categories",
      event:       { id: eSnap.id, ...eSnap.data() },
      categories,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load categories.");
    res.redirect(`/events/${eventId}`);
  }
};

// ─── Add a new category ───────────────────────────────────────────────────────
export const storeCategory = async (req, res) => {
  const { eventId } = req.params;
  const name  = sanitizeText(req.body.name, 100);
  const order = Number(req.body.order) || 99;

  if (!name) {
    req.flash("error_msg", "Category name is required.");
    return res.redirect(`/events/${eventId}/categories`);
  }
  try {
    await addDoc(collection(db, "events", eventId, "categories"), {
      name,
      order,
      createdAt: serverTimestamp(),
    });
    req.flash("success_msg", `Category "${name}" added.`);
    res.redirect(`/events/${eventId}/categories`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add category.");
    res.redirect(`/events/${eventId}/categories`);
  }
};

// ─── Delete a category (and all its criteria) ────────────────────────────────
export const deleteCategory = async (req, res) => {
  const { eventId, categoryId } = req.params;
  try {
    // Delete all criteria inside category first
    const crSnap = await getDocs(
      collection(db, "events", eventId, "categories", categoryId, "criteria")
    );
    await Promise.all(crSnap.docs.map(d => deleteDoc(d.ref)));
    // Delete the category itself
    await deleteDoc(doc(db, "events", eventId, "categories", categoryId));
    req.flash("success_msg", "Category and its criteria removed.");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to delete category.");
  }
  res.redirect(`/events/${eventId}/categories`);
};

// ─── Add criteria to a category ──────────────────────────────────────────────
export const storeCategorycriterion = async (req, res) => {
  const { eventId, categoryId } = req.params;
  const name        = sanitizeText(req.body.name, 100);
  const description = sanitizeText(req.body.description || "", 300);
  const weight      = Number(req.body.weight) || 0;
  const maxScore    = Number(req.body.maxScore) || 100;

  try {
    // Validate total weight within this category won't exceed 100
    const existing = await getDocs(
      collection(db, "events", eventId, "categories", categoryId, "criteria")
    );
    const usedWeight = existing.docs.reduce((sum, d) => sum + Number(d.data().weight || 0), 0);
    if (usedWeight + weight > 100) {
      req.flash("error_msg", `Total weight would exceed 100% for this category. Used: ${usedWeight}%.`);
      return res.redirect(`/events/${eventId}/categories`);
    }

    await addDoc(
      collection(db, "events", eventId, "categories", categoryId, "criteria"),
      { name, description, weight, maxScore, createdAt: serverTimestamp() }
    );
    req.flash("success_msg", `Criterion "${name}" added.`);
    res.redirect(`/events/${eventId}/categories`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add criterion.");
    res.redirect(`/events/${eventId}/categories`);
  }
};

// ─── Delete a criterion from a category ──────────────────────────────────────
export const deleteCategorycriterion = async (req, res) => {
  const { eventId, categoryId, criterionId } = req.params;
  try {
    await deleteDoc(
      doc(db, "events", eventId, "categories", categoryId, "criteria", criterionId)
    );
    req.flash("success_msg", "Criterion removed.");
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to remove criterion.");
  }
  res.redirect(`/events/${eventId}/categories`);
};
