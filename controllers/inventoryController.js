import { db } from "../models/firebaseConfig.js";
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp,
} from "firebase/firestore";

const INVENTORY = "inventory";
const EVENTS    = "events";

// ─── Helper: fetch all events for the dropdown ────────────────────────────────
async function getEvents() {
  try {
    const snap = await getDocs(query(collection(db, EVENTS), orderBy("createdAt", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch {
    // Fallback without ordering if index not ready
    const snap = await getDocs(collection(db, EVENTS));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

// ─── List inventory (optionally filter by eventId) ───────────────────────────
export const listInventory = async (req, res) => {
  try {
    const { eventId } = req.query;
    const events = await getEvents();

    // Fetch ALL inventory items without compound index requirement
    // (where + orderBy requires a composite Firestore index; sort in JS instead)
    const allSnap = await getDocs(collection(db, INVENTORY));
    let items = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter by eventId in JS if provided
    if (eventId) {
      items = items.filter(item => item.eventId === eventId);
    }

    // Sort by createdAt desc in JS
    items.sort((a, b) => {
      const tA = a.createdAt?.seconds ?? 0;
      const tB = b.createdAt?.seconds ?? 0;
      return tB - tA;
    });

    // Attach event name + compute totals
    const eventMap = Object.fromEntries(events.map(e => [e.id, e.name]));
    items = items.map(item => ({
      ...item,
      eventName:  eventMap[item.eventId] || "—",
      totalValue: ((Number(item.unitPrice) || 0) * (Number(item.quantity) || 0)).toFixed(2),
    }));

    // Summary totals
    const totalValue = items.reduce((sum, i) => sum + (Number(i.unitPrice)||0) * (Number(i.quantity)||0), 0);
    const totalItems = items.reduce((sum, i) => sum + (Number(i.quantity)||0), 0);

    // Find selected event
    const selectedEvent = eventId ? events.find(e => e.id === eventId) : null;

    res.render("inventory/index", {
      title:         "Inventory",
      items,
      events,
      selectedEvent: selectedEvent || null,
      filterEventId: eventId || "",
      totalValue:    totalValue.toFixed(2),
      totalItems,
      userName:      req.session.userName,
      userRole:      req.session.userRole,
      userInitial:   (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:       req.session.userRole === "admin",
      isJudge:       req.session.userRole === "judge",
      isEncoder:     req.session.userRole === "encoder",
      isOrganizer:   req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error("Inventory error:", err);
    req.flash("error_msg", "Could not load inventory. Please try again.");
    res.redirect("/dashboard");
  }
};

// ─── Add inventory item ───────────────────────────────────────────────────────
export const storeInventoryItem = async (req, res) => {
  const { eventId, ticketType, quantity, unitPrice, notes, photo } = req.body;
  try {
    if (!eventId || !ticketType) {
      req.flash("error_msg", "Event and ticket type are required.");
      return res.redirect("/inventory");
    }
    const qty   = Number(quantity)  || 0;
    const price = Number(unitPrice) || 0;
    await addDoc(collection(db, INVENTORY), {
      eventId,
      ticketType: ticketType.trim(),
      quantity:   qty,
      unitPrice:  price,
      total:      parseFloat((qty * price).toFixed(2)),
      notes:      notes || "",
      photo:      photo || "",
      createdBy:  req.session.userId,
      createdAt:  serverTimestamp(),
    });
    req.flash("success_msg", `Ticket record "${ticketType}" added.`);
    res.redirect(`/inventory?eventId=${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to add record. " + err.message);
    res.redirect("/inventory");
  }
};

// ─── Update inventory item ────────────────────────────────────────────────────
export const updateInventoryItem = async (req, res) => {
  const { ticketType, quantity, unitPrice, notes, eventId, photo } = req.body;
  try {
    const qty   = Number(quantity)  || 0;
    const price = Number(unitPrice) || 0;
    await updateDoc(doc(db, INVENTORY, req.params.id), {
      ticketType: ticketType.trim(),
      quantity:   qty,
      unitPrice:  price,
      total:      parseFloat((qty * price).toFixed(2)),
      notes:      notes || "",
      photo:      photo || "",
    });
    req.flash("success_msg", `Record "${ticketType}" updated.`);
    res.redirect(`/inventory?eventId=${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update record.");
    res.redirect("/inventory");
  }
};

// ─── Export inventory as CSV ──────────────────────────────────────────────────
export const exportInventoryCSV = async (req, res) => {
  const { eventId } = req.query;
  try {
    const allSnap = await getDocs(collection(db, INVENTORY));
    let items = allSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (eventId) items = items.filter(i => i.eventId === eventId);

    const events = await getEvents();
    const eventMap = Object.fromEntries(events.map(e => [e.id, e.name]));

    const rows = [
      ['Ticket Type','Qty Sold','Unit Price (₱)','Total Income (₱)','Event','Notes'],
      ...items.map(i => [
        i.ticketType || i.name || '—',
        i.quantity,
        i.unitPrice || 0,
        ((Number(i.unitPrice)||0) * (Number(i.quantity)||0)).toFixed(2),
        eventMap[i.eventId] || '—',
        (i.notes || '').replace(/,/g,' '),
      ]),
    ];

    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const filename = `inventory${eventId ? '-' + eventId.slice(0,8) : ''}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed');
  }
};
export const deleteInventoryItem = async (req, res) => {
  const { eventId } = req.body;
  try {
    await deleteDoc(doc(db, INVENTORY, req.params.id));
    req.flash("success_msg", "Item removed from inventory.");
    res.redirect(`/inventory?eventId=${eventId || ""}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to delete item.");
    res.redirect("/inventory");
  }
};

// ─── Auto-create a registration fee record when a contestant is added ─────────
export async function autoCreateRegistrationRecord(eventId, contestantName, contestantId, registrationFee, createdBy) {
  if (!registrationFee || Number(registrationFee) <= 0) return; // skip if no fee
  try {
    await addDoc(collection(db, INVENTORY), {
      eventId,
      contestantId,                          // link back so we can delete it
      ticketType:  "Registration Fee",
      quantity:    1,
      unitPrice:   parseFloat(Number(registrationFee).toFixed(2)),
      total:       parseFloat(Number(registrationFee).toFixed(2)),
      notes:       `Auto-recorded — ${contestantName}`,
      photo:       "",
      auto:        true,                     // flag as auto-generated
      createdBy,
      createdAt:   serverTimestamp(),
    });
  } catch (err) {
    console.error("Auto-record creation failed:", err);
  }
}

// ─── Auto-delete linked ticket record when contestant is removed ──────────────
export async function autoDeleteRegistrationRecord(eventId, contestantId) {
  try {
    const allSnap = await getDocs(collection(db, INVENTORY));
    const linked  = allSnap.docs.filter(d => {
      const data = d.data();
      return data.eventId === eventId && data.contestantId === contestantId && data.auto === true;
    });
    await Promise.all(linked.map(d => deleteDoc(doc(db, INVENTORY, d.id))));
  } catch (err) {
    console.error("Auto-record deletion failed:", err);
  }
}
