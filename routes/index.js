import express from "express";
const router = express.Router();

import { requireAuth, requireRole } from "../middleware/auth.js";
import { loginRateLimit } from "../middleware/rateLimit.js";

// ─── Scheduled jobs (authenticated with CRON_SECRET) ─────────────────────────
import { updateScheduledEventStatuses } from "../controllers/cronController.js";

router.get("/api/cron/event-status", updateScheduledEventStatuses);

// ─── Public routes ────────────────────────────────────────────────────────────
import { homePage } from "../controllers/homeController.js";
import {
  loginPage, registerPage, forgotPasswordPage,
  loginUser, registerUser, forgotPassword, logoutUser,
  setupPage, setupAdmin,
} from "../controllers/authController.js";

router.get( "/",                homePage);
router.get( "/login",           loginPage);
router.post("/login",           loginRateLimit, loginUser);
router.get( "/register",        registerPage);
router.post("/register",        registerUser);
router.get( "/forgot-password", forgotPasswordPage);
router.post("/forgot-password", forgotPassword);
router.get( "/logout",          logoutUser);
router.post("/logout",          logoutUser);

// Offline scoring standalone page (served from public, works without auth)
router.get("/offline-scoring", (req, res) => {
  res.sendFile("offline-scoring.html", { root: "./public" });
});

// One-time admin setup (works only when zero users exist)
router.get( "/setup",           setupPage);
router.post("/setup",           setupAdmin);

// Emergency role fixer removed for security

// ─── Dashboard ────────────────────────────────────────────────────────────────
import { dashboardPage } from "../controllers/dashboardController.js";

router.get("/dashboard", requireAuth, dashboardPage);

// ─── Users (admin only) ──────────────────────────────────────────────────────
import {
  listUsers, updateUserRole, deleteUser, approveUser, rejectUser, createUser,
} from "../controllers/userController.js";

router.get(  "/users",                requireAuth, requireRole("admin"), listUsers);
router.post( "/users",                requireAuth, requireRole("admin"), createUser);
router.post( "/users/:id/role",       requireAuth, requireRole("admin"), updateUserRole);
router.post( "/users/:id/approve",    requireAuth, requireRole("admin"), approveUser);
router.post( "/users/:id/reject",     requireAuth, requireRole("admin"), rejectUser);
router.post( "/users/:id/delete",     requireAuth, requireRole("admin"), deleteUser);

// ─── Admin Backup ─────────────────────────────────────────────────────────────
import { backupData } from "../controllers/backupController.js";

router.get("/admin/backup", requireAuth, requireRole("admin"), backupData);

// ─── Events (admin + organizer for mutations, all auth for reads) ─────────────
import {
  listEvents, createEventPage, storeEvent,
  showEvent, editEventPage, updateEvent, deleteEvent, updateEventStatus,
  assignJudge, removeJudge,
} from "../controllers/eventController.js";

router.get( "/events",                requireAuth,                                      listEvents);
router.get( "/events/create",         requireAuth, requireRole("admin","organizer"),     createEventPage);
router.post("/events",                requireAuth, requireRole("admin","organizer"),     storeEvent);
router.get( "/events/:id",            requireAuth,                                      showEvent);
router.get( "/events/:id/edit",       requireAuth, requireRole("admin","organizer"),     editEventPage);
router.post("/events/:id/update",     requireAuth, requireRole("admin","organizer"),     updateEvent);
router.post("/events/:id/status",     requireAuth, requireRole("admin","organizer"),     updateEventStatus);
router.post("/events/:id/delete",     requireAuth, requireRole("admin","organizer"),     deleteEvent);
router.post("/events/:id/judges/assign",          requireAuth, requireRole("admin","organizer"), assignJudge);
router.post("/events/:id/judges/:judgeId/remove", requireAuth, requireRole("admin","organizer"), removeJudge);

// ─── Contestants (admin, organizer & encoder can mutate) ──────────────────────
import {
  addContestantPage, storeContestant,
  editContestantPage, updateContestant, deleteContestant,
  selfRegisterPage, selfRegister,
} from "../controllers/contestantController.js";

router.get( "/events/:eventId/contestants/add",              requireAuth, requireRole("admin","organizer","encoder"), addContestantPage);
router.post("/events/:eventId/contestants",                  requireAuth, requireRole("admin","organizer","encoder"), storeContestant);
router.get( "/events/:eventId/contestants/:id/edit",         requireAuth, requireRole("admin","organizer","encoder"), editContestantPage);
router.post("/events/:eventId/contestants/:id/update",       requireAuth, requireRole("admin","organizer","encoder"), updateContestant);
router.post("/events/:eventId/contestants/:id/delete",       requireAuth, requireRole("admin","organizer"),           deleteContestant);
// Public self-registration (no login)
router.get( "/events/:eventId/self-register",  selfRegisterPage);
router.post("/events/:eventId/self-register",  selfRegister);

// ─── Criteria (admin & organizer) ────────────────────────────────────────────
import {
  addCriteriaPage, storeCriteria, deleteCriteria,
} from "../controllers/criteriaController.js";

router.get( "/events/:eventId/criteria",            requireAuth, requireRole("admin","organizer"), addCriteriaPage);
router.post("/events/:eventId/criteria",            requireAuth, requireRole("admin","organizer"), storeCriteria);
router.post("/events/:eventId/criteria/:id/delete", requireAuth, requireRole("admin","organizer"), deleteCriteria);

// ─── Audience Voting ──────────────────────────────────────────────────────────
import {
  audienceVotingQrPage, votingPage, submitVote, voteResults, toggleVoting,
  saveOrganizerMoreMenu, voteCounts,
} from "../controllers/votingController.js";

router.get( "/events/:eventId/vote/qr",   requireAuth, requireRole("admin","organizer"), audienceVotingQrPage);
router.post("/events/:eventId/organizer-menu", requireAuth, requireRole("admin"), saveOrganizerMoreMenu);
router.get( "/events/:eventId/vote",         votingPage);
router.post("/events/:eventId/vote",         submitVote);
router.get( "/events/:eventId/vote/results", requireAuth,                                  voteResults);
router.post("/events/:eventId/vote/toggle",  requireAuth, requireRole("admin","organizer"), toggleVoting);
router.get( "/events/:eventId/vote/counts",  voteCounts);

// ─── Scoring (judges can enter scores; all auth can view results) ─────────────
import {
  scoringPage, submitScores, resultsPage, scoresJson, announcePage,
  displayBoard, publicResults, toggleScoreLock,
  exportResults, getScoringProgress, reportPage, confirmSignature,
  tabulatorScoringPage, tabulatorUpdateScore,
} from "../controllers/scoringController.js";

router.get( "/events/:eventId/scoring",          requireAuth, requireRole("admin","judge","organizer","tabulator"), scoringPage);
router.post("/events/:eventId/scoring",          requireAuth, requireRole("admin","judge","organizer","tabulator"), submitScores);
router.get( "/events/:eventId/results",          requireAuth,                               resultsPage);
router.get( "/events/:eventId/announce",         requireAuth,                               announcePage);
router.get( "/events/:eventId/scores-json",      requireAuth,                               scoresJson);
router.get( "/events/:eventId/results/export",   requireAuth,                               exportResults);
router.get( "/events/:eventId/scoring-progress", requireAuth,                               getScoringProgress);
// Public routes — no login required
router.get( "/events/:eventId/display",  displayBoard);
router.get( "/events/:eventId/public",   publicResults);
// Score lock
router.post("/events/:eventId/lock",     requireAuth, requireRole("admin","organizer"), toggleScoreLock);
// Report & signatures
router.get( "/events/:eventId/report",      requireAuth, reportPage);
router.post("/events/:eventId/report/sign", requireAuth, confirmSignature);

// ─── Tabulator Score Review & Edit ────────────────────────────────────────────
router.get( "/events/:eventId/tabulator",        requireAuth, requireRole("admin","tabulator"), tabulatorScoringPage);
router.post("/events/:eventId/tabulator/update", requireAuth, requireRole("admin","tabulator"), tabulatorUpdateScore);

// ─── AI Score Analytics (admin only) ──────────────────────────────────────────
import {
  analyticsDashboard, runAIAnalytics, updateFlagStatus, exportAnalyticsCSV,
} from "../controllers/analyticsController.js";

router.get( "/analytics",                     requireAuth, requireRole("admin"), analyticsDashboard);
router.get( "/analytics/export",              requireAuth, requireRole("admin"), exportAnalyticsCSV);
router.post("/analytics/run",                 requireAuth, requireRole("admin"), runAIAnalytics);
router.post("/analytics/flags/:flagId/status",requireAuth, requireRole("admin"), updateFlagStatus);

// ─── Inventory (admin & organizer) ────────────────────────────────────────────
import {
  listInventory, storeInventoryItem, updateInventoryItem, deleteInventoryItem, exportInventoryCSV,
} from "../controllers/inventoryController.js";

router.get( "/inventory",              requireAuth, requireRole("admin","organizer"), listInventory);
router.get( "/inventory/export",       requireAuth, requireRole("admin","organizer"), exportInventoryCSV);
router.post("/inventory",              requireAuth, requireRole("admin","organizer"), storeInventoryItem);
router.post("/inventory/:id/update",   requireAuth, requireRole("admin","organizer"), updateInventoryItem);
router.post("/inventory/:id/delete",   requireAuth, requireRole("admin","organizer"), deleteInventoryItem);

// ─── Event Finance (admin & organizer) ────────────────────────────────────────
import { storeFinanceEntry, deleteFinanceEntry } from "../controllers/financeController.js";

router.post("/events/:eventId/finance",                 requireAuth, requireRole("admin","organizer"), storeFinanceEntry);
router.post("/events/:eventId/finance/:entryId/delete", requireAuth, requireRole("admin","organizer"), deleteFinanceEntry);

// ─── Settings ─────────────────────────────────────────────────────────────────
import { settingsPage, updateSettings, suggestFeature } from "../controllers/settingsController.js";

router.get( "/settings",                requireAuth, settingsPage);
router.post("/settings/update",         requireAuth, updateSettings);
router.post("/settings/suggest-feature", requireAuth, suggestFeature);

export default router;
