import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc,
  setDoc, updateDoc, addDoc, serverTimestamp, orderBy, query,
} from "firebase/firestore";
import { sanitizeText } from "../utils/sanitize.js";
import { applyAutoStatus } from "../utils/autoStatus.js";
import { sortContestantsByNumber } from "../utils/contestantOrder.js";

const CRITERIA_COLORS = [
  "#2563eb","#7c3aed","#059669","#dc2626",
  "#d97706","#0891b2","#be185d","#65a30d",
];

// ── Helper: load criteria for an event (flat or multi-category) ──────────────
async function loadCriteria(eventId) {
  const crSnap = await getDocs(collection(db, "events", eventId, "criteria"));
  let criteria = crSnap.docs.map((d, i) => ({
    id: d.id, ...d.data(),
    color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
  }));
  if (criteria.length === 0) {
    try {
      const catSnap = await getDocs(collection(db, "events", eventId, "categories"));
      const cats = catSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.order||0)-(b.order||0));
      let ci = 0;
      for (const cat of cats) {
        const cs = await getDocs(collection(db, "events", eventId, "categories", cat.id, "criteria"));
        cs.docs.forEach(d => {
          criteria.push({
            id: d.id, ...d.data(),
            categoryId:   cat.id,
            categoryName: cat.name,
            color: CRITERIA_COLORS[ci++ % CRITERIA_COLORS.length],
          });
        });
      }
    } catch (_) {}
  }
  return criteria;
}

// --- Judge scoring panel ------------------------------------------------------
export const scoringPage = async (req, res) => {
  const { eventId, categoryId } = req.params;
  const judgeId = req.session.userId;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");
    const ev = { id: eSnap.id, ...eSnap.data() };

    if (req.session.userRole === 'judge') { await applyAutoStatus(eventId, ev); }

    // Load categories for multi-category events
    let categories = [];
    let activeCategoryId = categoryId || null;
    let activeCategory = null;
    try {
      const catSnap = await getDocs(collection(db, "events", eventId, "categories"));
      categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.order||0)-(b.order||0));
      if (categories.length > 0) {
        if (!activeCategoryId) activeCategoryId = categories[0].id;
        activeCategory = categories.find(c => c.id === activeCategoryId) || categories[0];
        activeCategoryId = activeCategory.id;
      }
    } catch (_) {}
    const isMultiCategory = categories.length > 0;

    // Load criteria from category or flat event criteria
    let crSnap;
    if (isMultiCategory && activeCategoryId) {
      crSnap = await getDocs(collection(db, "events", eventId, "categories", activeCategoryId, "criteria"));
    } else {
      crSnap = await getDocs(collection(db, "events", eventId, "criteria"));
    }

    const [cSnap, sSnap] = await Promise.all([
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    const readOnly = (req.session.userRole === 'judge' && ev.status === 'completed')
      || (req.session.userRole === 'tabulator' && ev.scoringLocked);

    if (req.session.userRole === 'judge' && ev.status !== 'ongoing' && !readOnly) {
      req.flash("error_msg", ev.status === 'upcoming'
        ? `"${ev.name}" has not started yet.` : `"${ev.name}" is no longer available for scoring.`);
      return res.redirect("/dashboard");
    }
    if (ev.scoringLocked && req.session.userRole === 'judge' && !readOnly) {
      req.flash("error_msg", "Scoring has been locked by the administrator.");
      return res.redirect("/dashboard");
    }
    if (req.session.userRole === 'judge') {
      const assignedJudges = ev.assignedJudges || [];
      if (!assignedJudges.includes(judgeId)) {
        req.flash("error_msg", assignedJudges.length === 0
          ? `No judges have been assigned to "${ev.name}" yet.`
          : `You are not assigned to "${ev.name}".`);
        return res.redirect("/dashboard");
      }
    }

    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = crSnap.docs ? crSnap.docs.map((d,i) => ({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]})) : crSnap;

    const scoreMap = {};
    sSnap.docs.forEach(d => {
      const s = d.data();
      if (s.judgeId === judgeId) {
        if (!isMultiCategory || s.categoryId === activeCategoryId) {
          scoreMap[`${s.contestantId}|${s.criteriaId}`] = s.score;
        }
      }
    });

    const hasExistingScores = Object.keys(scoreMap).length > 0;
    const matrix = contestants.map(c => ({
      ...c,
      scores: criteria.map(cr => ({
        criteriaId: cr.id, criteriaName: cr.name,
        weight: cr.weight, maxScore: cr.maxScore, color: cr.color,
        value: scoreMap[`${c.id}|${cr.id}`] ?? "",
      })),
    }));

    const categoryProgress = categories.map(cat => {
      const catScores = sSnap.docs.filter(d => d.data().judgeId === judgeId && d.data().categoryId === cat.id);
      return { ...cat, scoreCount: catScores.length };
    });

    res.render("scoring/judge", {
      title: `Score Entry — ${ev.name}${activeCategory ? ` · ${activeCategory.name}` : ""}`,
      event: ev, contestants: matrix, criteria, judgeId,
      scoringLocked: ev.scoringLocked || false, readOnly, hasExistingScores,
      isMultiCategory, categories: categoryProgress, activeCategoryId, activeCategory,
      userName: req.session.userName, userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin", isJudge: req.session.userRole === "judge",
      isEncoder: req.session.userRole === "encoder", isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load scoring page.");
    res.redirect("/events");
  }
};
export const submitScores = async (req, res) => {
  const { eventId, categoryId } = req.params;
  const judgeId = req.session.userId;
  const { scores } = req.body;

  // Block submit if event is not ongoing (judges only)
  try {
    if (req.session.userRole === 'judge') {
      const eSnap = await getDoc(doc(db, "events", eventId));
      if (!eSnap.exists()) {
        req.flash("error_msg", "Event not found.");
        return res.redirect("/dashboard");
      }
      const event = { id: eSnap.id, ...eSnap.data() };
      await applyAutoStatus(eventId, event);
      if (event.status !== 'ongoing') {
        req.flash("error_msg", "Scoring is only allowed while the event is ongoing.");
        return res.redirect("/dashboard");
      }
    }
  } catch (err) {
    console.error("Could not verify event status before score submission:", err);
    req.flash("error_msg", "Could not verify the event status. Please try again.");
    return res.redirect(categoryId ? `/events/${eventId}/scoring/${categoryId}` : `/events/${eventId}/scoring`);
  }

  try {
    // Block scoring if locked
    const evSnap2 = await getDoc(doc(db, "events", eventId));
    if (evSnap2.exists() && evSnap2.data().scoringLocked) {
      req.flash("error_msg", "Scoring has been locked by the administrator. No more score submissions are allowed.");
      return res.redirect(categoryId ? `/events/${eventId}/scoring/${categoryId}` : `/events/${eventId}/scoring`);
    }

    // Fetch existing score docs for this judge+event to detect edits vs initial submissions
    const existingScoresSnap = await getDocs(collection(db, "events", eventId, "scores"));
    const existingScoreMap = {};
    existingScoresSnap.docs.forEach(d => {
      const s = d.data();
      if (s.judgeId === judgeId) {
        existingScoreMap[d.id] = s.score;
      }
    });

    const writes = [];
    const auditEdits = [];
    let newSubmitCount = 0;

    for (const [contestantId, criteriaMap] of Object.entries(scores || {})) {
      for (const [criteriaId, rawScore] of Object.entries(criteriaMap || {})) {
        const score = parseFloat(rawScore);
        if (isNaN(score)) continue;
        const docId = `${judgeId}_${contestantId}_${criteriaId}`;
        const isEdit = docId in existingScoreMap;
        const prevScore = isEdit ? existingScoreMap[docId] : null;

        const scoreData = {
          judgeId,
          judgeName:   req.session.userName || "Unknown",
          contestantId,
          criteriaId,
          categoryId: categoryId || null,
          score,
          submittedAt: isEdit ? (existingScoresSnap.docs.find(d => d.id === docId)?.data()?.submittedAt ?? serverTimestamp()) : serverTimestamp(),
        };
        if (isEdit) {
          scoreData.lastEditedAt = serverTimestamp();
        }

        writes.push(setDoc(doc(db, "events", eventId, "scores", docId), scoreData));

        if (isEdit && prevScore !== score) {
          auditEdits.push({ contestantId, criteriaId, previousScore: prevScore, newScore: score });
        } else if (!isEdit) {
          newSubmitCount++;
        }
      }
    }
    await Promise.all(writes);

    // Write audit log entries
    const auditWrites = [];
    if (auditEdits.length > 0) {
      for (const edit of auditEdits) {
        auditWrites.push(
          addDoc(collection(db, "events", eventId, "audit_log"), {
            action:        "score_edited",
            judgeId,
            judgeName:     req.session.userName || "Unknown",
            contestantId:  edit.contestantId,
            criteriaId:    edit.criteriaId,
            previousScore: edit.previousScore,
            newScore:      edit.newScore,
            timestamp:     serverTimestamp(),
          })
        );
      }
    }
    if (newSubmitCount > 0 || (auditEdits.length === 0 && Object.keys(scores || {}).length > 0)) {
      auditWrites.push(
        addDoc(collection(db, "events", eventId, "audit_log"), {
          action:     auditEdits.length > 0 ? "scores_updated" : "scores_submitted",
          judgeId,
          judgeName:  req.session.userName || "Unknown",
          scoreCount: Object.values(scores || {}).reduce((t, cm) => t + Object.keys(cm).length, 0),
          editCount:  auditEdits.length,
          timestamp:  serverTimestamp(),
        })
      );
    }
    await Promise.all(auditWrites);

    req.flash("success_msg", "Scores submitted successfully.");
    res.redirect(categoryId ? `/events/${eventId}/scoring/${categoryId}` : `/events/${eventId}/scoring`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to save scores.");
    res.redirect(categoryId ? `/events/${eventId}/scoring/${categoryId}` : `/events/${eventId}/scoring`);
  }
};

// --- Shared tie-breaking helper -----------------------------------------------
function applyTieBreaking(ranked, criteria) {
  // Sort criteria by weight descending for tiebreaker priority
  const criteriaByWeightDesc = [...criteria].sort((a, b) => Number(b.weight) - Number(a.weight));

  let i = 0;
  while (i < ranked.length) {
    let j = i + 1;
    while (j < ranked.length && parseFloat(ranked[j].finalScore) === parseFloat(ranked[i].finalScore)) j++;
    const group = ranked.slice(i, j);
    if (group.length > 1) {
      group.forEach(c => { c.tieDetected = true; });
      let resolved = false;
      for (const cr of criteriaByWeightDesc) {
        const vals = group.map(c => {
          const bd = c.breakdown ? c.breakdown.find(b => b.name === cr.name) : null;
          return bd ? parseFloat(bd.avg) : 0;
        });
        const maxVal = Math.max(...vals);
        const minVal = Math.min(...vals);
        if (maxVal !== minVal) {
          group.sort((a, b) => {
            const aAvg = parseFloat((a.breakdown ? (a.breakdown.find(bd => bd.name === cr.name) || {}) : {}).avg || 0);
            const bAvg = parseFloat((b.breakdown ? (b.breakdown.find(bd => bd.name === cr.name) || {}) : {}).avg || 0);
            return bAvg - aAvg;
          });
          for (let k = 0; k < group.length; k++) ranked[i + k] = group[k];
          group.forEach(c => { c.tieBroken = true; c.tiebreakCriteria = cr.name; });
          resolved = true;
          break;
        }
      }
      if (!resolved) {
        group.forEach(c => { c.tieBroken = false; });
      }
    } else {
      group[0].tieDetected = false;
      group[0].tieBroken   = false;
    }
    i = j;
  }
}

// ── Helper: compute final score (flat = sum of weighted, multi-cat = average of category scores)
function computeFinalScore(c, criteria, allScores) {
  const isMultiCat = criteria.some(cr => cr.categoryId);
  const breakdown = criteria.map((cr, i) => {
    const js = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
    const avg = js.length ? js.reduce((sum, s) => sum + s.score, 0) / js.length : 0;
    const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
    const barPct = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
    return { name: cr.name, weight: cr.weight, color: CRITERIA_COLORS[i % CRITERIA_COLORS.length],
             avg: avg.toFixed(2), weighted: weighted.toFixed(2), barPct, categoryId: cr.categoryId || null };
  });

  let finalScore;
  if (isMultiCat) {
    // Group by category, compute per-category score (0-100%), then average them
    const catMap = {};
    criteria.forEach(cr => {
      if (!cr.categoryId) return;
      if (!catMap[cr.categoryId]) catMap[cr.categoryId] = [];
      catMap[cr.categoryId].push(cr);
    });
    const catScores = Object.values(catMap).map(catCriteria => {
      let t = 0;
      catCriteria.forEach(cr => {
        const js2 = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg2 = js2.length ? js2.reduce((s, x) => s + x.score, 0) / js2.length : 0;
        t += (avg2 / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
      });
      return t;
    });
    finalScore = catScores.length ? catScores.reduce((a, b) => a + b, 0) / catScores.length : 0;
  } else {
    finalScore = breakdown.reduce((sum, b) => sum + parseFloat(b.weighted), 0);
  }
  return { breakdown, finalScore: finalScore.toFixed(4), finalScoreDisplay: finalScore.toFixed(2) };
}

// --- Results / Leaderboard ----------------------------------------------------
export const resultsPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap, vSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
      getDocs(collection(db, "events", eventId, "votes")),
    ]);

    if (!eSnap.exists()) return res.redirect("/events");

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    // ── criteria already loaded via loadCriteria (handles flat + multi-category)
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores = sSnap.docs.map(d => d.data());

    const allVotes = vSnap.docs.map(d => d.data());
    const votesByContestant = {};
    allVotes.forEach(v => {
      if (v.contestantId) votesByContestant[v.contestantId] = (votesByContestant[v.contestantId] || 0) + 1;
    });
    const totalAudienceVotes = allVotes.length;

    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });
    const judgeCount = Object.keys(judgeMap).length || 1;

    const ranked = contestants.map(c => {
      const { breakdown, finalScore, finalScoreDisplay } = computeFinalScore(c, criteria, allScores);
      return { ...c, breakdown, finalScore, finalScoreDisplay };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    // Apply tie-breaking before rank assignment
    applyTieBreaking(ranked, criteria);

    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // Attach audience vote counts and percentages to each ranked contestant
    const maxAudienceVotes = Math.max(0, ...Object.values(votesByContestant).map(Number), 1);
    ranked.forEach(c => {
      c.audienceVoteCount = votesByContestant[c.id] || 0;
      c.audienceVotePct   = totalAudienceVotes > 0
        ? Math.round((c.audienceVoteCount / maxAudienceVotes) * 100)
        : 0;
    });

    const judgeEntries   = Object.entries(judgeMap);
    const judgeBreakdown = judgeEntries.map(([jId, jName], idx) => {
      const alias = `Judge ${idx + 1}`;
      const scoredContestantIds = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      );
      const scoredCount   = scoredContestantIds.size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
      const judgeWeighted = contestants.map(c => {
        let w = 0;
        criteria.forEach(cr => {
          const s = allScores.find(s => s.judgeId === jId && s.contestantId === c.id && s.criteriaId === cr.id);
          if (s) w += (s.score / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        });
        return { contestantName: c.name, score: w.toFixed(2) };
      });
      judgeWeighted.sort((a, b) => b.score - a.score);
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias,
        initial:          String(idx + 1),
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
        topScores:        judgeWeighted.slice(0, 3),
      };
    });

    // Build judgeProgressData (same shape as getScoringProgress returns)
    const judgeProgressData = judgeEntries.map(([jId, jName], idx) => {
      const scoredCount = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      ).size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias:            `Judge ${idx + 1}`,
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
      };
    });

    res.render("scoring/results", {
      title:       `Results � ${ev.name}`,
      event:       ev,
      ranked,
      criteria,
      judgeCount,
      judgeBreakdown,
      judgeProgressData,
      votesByContestant,
      totalAudienceVotes,
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
    req.flash("error_msg", "Could not load results.");
    res.redirect(`/events/${eventId}`);
  }
};

// --- Live Display Board (no auth required � public scoreboard) ----------------
export const displayBoard = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);
    if (!eSnap.exists()) return res.redirect("/");
    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores   = sSnap.docs.map(d => d.data());
    const judgeMap    = {};
    allScores.forEach(s => { if (s.judgeId) judgeMap[s.judgeId] = true; });
    const ranked = contestants.map(c => {
      let total = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = judgeScores.length ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        const barPct   = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
        total += weighted;
        return { name: cr.name, weight: cr.weight, color: CRITERIA_COLORS[i % CRITERIA_COLORS.length], avg: avg.toFixed(2), weighted: weighted.toFixed(2), barPct };
      });
      return { ...c, breakdown, finalScore: total.toFixed(4), finalScoreDisplay: total.toFixed(2) };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    applyTieBreaking(ranked, criteria);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => { c.rank = i + 1; c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2); });
    res.render("scoring/display", {
      title: `Live � ${ev.name}`,
      event: ev, ranked, criteria,
      judgeCount: Object.keys(judgeMap).length || 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load display board.");
  }
};

// --- Public Results (no login required) --------------------------------------
export const publicResults = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);
    if (!eSnap.exists()) return res.status(404).send("Event not found.");
    const ev = { id: eSnap.id, ...eSnap.data() };
    // Only public if completed or organizer made it public
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores   = sSnap.docs.map(d => d.data());
    const judgeMap    = {};
    allScores.forEach(s => { if (s.judgeId && !judgeMap[s.judgeId]) judgeMap[s.judgeId] = s.judgeName || "Judge"; });
    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = judgeScores.length ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        totalWeighted += weighted;
        return { name: cr.name, weight: cr.weight, avg: avg.toFixed(2), weighted: weighted.toFixed(2), color: CRITERIA_COLORS[i % CRITERIA_COLORS.length] };
      });
      return { ...c, breakdown, finalScore: totalWeighted.toFixed(4), finalScoreDisplay: totalWeighted.toFixed(2) };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    // Apply tie-breaking before rank assignment
    applyTieBreaking(ranked, criteria);
    ranked.forEach((c, i) => { c.rank = i + 1; });
    res.render("scoring/public", { title: `Results � ${ev.name}`, event: ev, ranked, criteria, judgeCount: Object.keys(judgeMap).length });
  } catch (err) {
    console.error(err);
    res.status(500).send("Could not load results.");
  }
};

// --- Score Lock / Unlock ------------------------------------------------------
export const toggleScoreLock = async (req, res) => {
  const { eventId } = req.params;
  try {
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) return res.redirect("/events");
    const locked = !eSnap.data().scoringLocked;
    await updateDoc(doc(db, "events", eventId), { scoringLocked: locked });
    req.flash("success_msg", locked ? "Scoring locked. Judges can no longer submit scores." : "Scoring unlocked. Judges can now submit scores.");
    res.redirect(`/events/${eventId}`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to toggle score lock.");
    res.redirect(`/events/${eventId}`);
  }
};

// --- CSV Export of Results ----------------------------------------------------
export const exportResults = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.status(404).send("Event not found.");

    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores = sSnap.docs.map(d => d.data());

    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map(cr => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        totalWeighted += weighted;
        return {
          name:    cr.name,
          avg:     avg.toFixed(2),
          weighted: weighted.toFixed(2),
        };
      });
      return {
        ...c,
        breakdown,
        finalScore:        totalWeighted.toFixed(4),
        finalScoreDisplay: totalWeighted.toFixed(2),
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    applyTieBreaking(ranked, criteria);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // Build CSV
    function q(val) {
      return `"${String(val).replace(/"/g, '""')}"`;
    }
    const headerCols = [
      "Rank", "No.", "Name", "Barangay",
      ...criteria.map(cr => sanitizeText(cr.name || "").replace(/,/g, " ")),
      "Final Score (%)", "Gap to 1st",
    ];
    const headerRow = headerCols.map(q).join(",");
    const dataRows = ranked.map(c => {
      const critCols = c.breakdown.map(bd => q(sanitizeText(String(bd.avg))));
      return [
        q(c.rank),
        q(c.number || ""),
        q(sanitizeText(c.name || "")),
        q(sanitizeText(c.barangay || "")),
        ...critCols,
        q(c.finalScoreDisplay),
        q(c.gapToFirst),
      ].join(",");
    });
    const csvContent = [headerRow, ...dataRows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="results-${eventId}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Could not export results.");
  }
};

// --- Report Page --------------------------------------------------------------
export const reportPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap, sigSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
      getDocs(collection(db, "events", eventId, "report_signatures")),
    ]);

    // Fetch tabulators separately with fallback
    let tabulatorDocs = [];
    try {
      const uSnap = await getDocs(collection(db, "users"));
      tabulatorDocs = uSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => u.role === 'tabulator' && (u.status === 'approved' || u.status === 'active'));
    } catch (_) { tabulatorDocs = []; }

    if (!eSnap.exists()) return res.redirect("/events");

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores   = sSnap.docs.map(d => d.data());
    const sigMap      = {};
    sigSnap.docs.forEach(d => { sigMap[d.id] = d.data(); });

    // Build judge map
    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });

    // Build ranked results (same logic as resultsPage)
    const COLORS = ["#2563eb","#7c3aed","#059669","#dc2626","#d97706","#0891b2","#be185d","#65a30d"];
    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        totalWeighted += weighted;
        return { name: cr.name, weight: cr.weight, avg: avg.toFixed(2), weighted: weighted.toFixed(2), color: COLORS[i % 8] };
      });
      return { ...c, breakdown, finalScore: totalWeighted.toFixed(4), finalScoreDisplay: totalWeighted.toFixed(2) };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);

    applyTieBreaking(ranked, criteria);
    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // Build judge breakdown for the per-judge scores section
    const judgeEntries = Object.entries(judgeMap);
    const judgeBreakdown = judgeEntries.map(([jId, jName], idx) => {
      const scoredCount   = new Set(allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)).size;
      const completionPct = contestants.length ? Math.round((scoredCount / contestants.length) * 100) : 0;
      const sig = sigMap[jId];
      // Per-contestant per-criteria scores for this judge
      const contestantScores = ranked.map(c => ({
        name:   c.name,
        number: c.number,
        scores: criteria.map(cr => {
          const s = allScores.find(sc => sc.judgeId === jId && sc.contestantId === c.id && sc.criteriaId === cr.id);
          return { criteriaName: cr.name, value: s ? s.score : null };
        }),
        total: (() => {
          let t = 0;
          criteria.forEach(cr => {
            const s = allScores.find(sc => sc.judgeId === jId && sc.contestantId === c.id && sc.criteriaId === cr.id);
            if (s) t += (s.score / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
          });
          return t.toFixed(2);
        })(),
      }));
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias:            `Judge ${idx + 1}`,
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
        signed:           !!sig,
        signedAt:         sig ? (sig.signedAt?.toDate?.()?.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) || '') : null,
        contestantScores,
        isSelf:           jId === req.session.userId,
      };
    });

    // ── Per-category report data (for multi-category events) ─────────────────
    const isMultiCategory = criteria.some(cr => cr.categoryId);
    let categoriesReport = [];
    if (isMultiCategory) {
      // Group criteria by category
      const catMap = {};
      criteria.forEach(cr => {
        if (!cr.categoryId) return;
        if (!catMap[cr.categoryId]) catMap[cr.categoryId] = { id: cr.categoryId, name: cr.categoryName, criteria: [] };
        catMap[cr.categoryId].criteria.push(cr);
      });
      categoriesReport = Object.values(catMap);

      // For each category: build ranked contestants + per-judge sheets
      categoriesReport = categoriesReport.map(cat => {
        const catCriteria = cat.criteria;

        // Ranked within this category
        const catRanked = contestants.map(c => {
          let total = 0;
          const breakdown = catCriteria.map(cr => {
            const judgeScores = allScores.filter(s =>
              s.contestantId === c.id && s.criteriaId === cr.id
            );
            const avg = judgeScores.length
              ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length : 0;
            const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
            total += weighted;
            return { name: cr.name, weight: cr.weight, avg: avg.toFixed(2), weighted: weighted.toFixed(2) };
          });
          return { ...c, breakdown, finalScore: total.toFixed(4), finalScoreDisplay: total.toFixed(2) };
        });
        catRanked.sort((a, b) => parseFloat(b.finalScore) - parseFloat(a.finalScore));
        const catTop = catRanked.length ? parseFloat(catRanked[0].finalScore) : 0;
        catRanked.forEach((c, i) => { c.rank = i + 1; c.gapToFirst = (catTop - parseFloat(c.finalScore)).toFixed(2); });

        // Per-judge sheets for this category
        const catJudgeBreakdown = judgeEntries.map(([jId, jName], idx) => {
          const catScores = allScores.filter(s => s.judgeId === jId && (s.categoryId === cat.id || catCriteria.some(cr => cr.id === s.criteriaId)));
          const scoredCount = new Set(catScores.map(s => s.contestantId)).size;
          const contestantScores = catRanked.map(c => ({
            name: c.name, number: c.number,
            scores: catCriteria.map(cr => {
              const s = allScores.find(sc => sc.judgeId === jId && sc.contestantId === c.id && sc.criteriaId === cr.id);
              return { criteriaName: cr.name, value: s ? s.score : null };
            }),
            total: (() => {
              let t = 0;
              catCriteria.forEach(cr => {
                const s = allScores.find(sc => sc.judgeId === jId && sc.contestantId === c.id && sc.criteriaId === cr.id);
                if (s) t += (s.score / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
              });
              return t.toFixed(2);
            })(),
          }));
          return {
            judgeId: jId, judgeName: jName, alias: `Judge ${idx + 1}`,
            scoredCount, totalContestants: contestants.length,
            completionPct: contestants.length ? Math.round((scoredCount / contestants.length) * 100) : 0,
            signed: !!sigMap[jId], signedAt: sigMap[jId] ? (sigMap[jId].signedAt?.toDate?.()?.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) || '') : null,
            contestantScores, isSelf: jId === req.session.userId,
          };
        });

        return { ...cat, ranked: catRanked, judgeBreakdown: catJudgeBreakdown };
      });
    }

    // Build tabulator breakdown for signature section
    const tabulators = tabulatorDocs.map((u, idx) => {
        const sig = sigMap[u.id];
        return {
          tabulatorId:   u.id,
          tabulatorName: u.name || u.email || 'Tabulator',
          alias:         `Chief Tabulator ${idx + 1}`,
          initial:       String(idx + 1),
          signed:        !!sig,
          signedAt:      sig ? (sig.signedAt?.toDate?.()?.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true}) || '') : null,
          isSelf:        u.id === req.session.userId,
        };
      });

    res.render("scoring/report", {
      title:        `Report � ${ev.name}`,
      event:        ev,
      ranked,
      criteria,
      judgeBreakdown,
      judgeCount:   judgeEntries.length,
      generatedAt:  new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
      userName:     req.session.userName,
      userRole:     req.session.userRole,
      userInitial:  (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:      req.session.userRole === "admin",
      isJudge:      req.session.userRole === "judge",
      isOrganizer:  req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
      currentUserId: req.session.userId,
      tabulators,
      isMultiCategory,
      categoriesReport,
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load report.");
    res.redirect(`/events/${eventId}`);
  }
};

// --- Confirm Signature --------------------------------------------------------
export const confirmSignature = async (req, res) => {
  const { eventId } = req.params;
  const judgeId     = req.session.userId;
  const judgeName   = sanitizeText(req.session.userName || "Unknown");
  try {
    await setDoc(doc(db, "events", eventId, "report_signatures", judgeId), {
      judgeId,
      judgeName,
      eventId,
      signedAt: serverTimestamp(),
    });
    req.flash("success_msg", "Your signature has been recorded. Thank you.");
    res.redirect(`/events/${eventId}/report`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to save signature.");
    res.redirect(`/events/${eventId}/report`);
  }
};

// --- Scores JSON (polling endpoint for live results) -------------------------
export const scoresJson = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.status(404).json({ error: "Event not found." });

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores = sSnap.docs.map(d => d.data());

    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });
    const judgeCount = Object.keys(judgeMap).length || 1;

    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        const barPct   = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
        totalWeighted += weighted;
        return {
          name:     cr.name,
          weight:   cr.weight,
          color:    CRITERIA_COLORS[i % CRITERIA_COLORS.length],
          avg:      avg.toFixed(2),
          weighted: weighted.toFixed(2),
          barPct,
        };
      });
      return {
        id:                c.id,
        name:              c.name || "",
        barangay:          c.barangay || "",
        number:            c.number || "",
        photo:             c.photo || "",
        breakdown,
        finalScore:        totalWeighted.toFixed(4),
        finalScoreDisplay: totalWeighted.toFixed(2),
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    applyTieBreaking(ranked, criteria);

    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    return res.json({
      event: { id: ev.id, name: ev.name },
      ranked,
      criteria,
      judgeCount,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not load scores." });
  }
};

// --- Announce / Reveal Page ---------------------------------------------------
export const announcePage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.redirect("/events");

    const ev          = { id: eSnap.id, ...eSnap.data() };
    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores = sSnap.docs.map(d => d.data());

    const ranked = contestants.map(c => {
      let totalWeighted = 0;
      const breakdown = criteria.map((cr, i) => {
        const judgeScores = allScores.filter(
          s => s.contestantId === c.id && s.criteriaId === cr.id
        );
        const avg = judgeScores.length
          ? judgeScores.reduce((sum, s) => sum + s.score, 0) / judgeScores.length
          : 0;
        const weighted = (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
        const barPct   = Math.min((avg / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1);
        totalWeighted += weighted;
        return {
          name:     cr.name,
          weight:   cr.weight,
          color:    CRITERIA_COLORS[i % CRITERIA_COLORS.length],
          avg:      avg.toFixed(2),
          weighted: weighted.toFixed(2),
          barPct,
        };
      });
      return {
        ...c,
        breakdown,
        finalScore:        totalWeighted.toFixed(4),
        finalScoreDisplay: totalWeighted.toFixed(2),
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    applyTieBreaking(ranked, criteria);

    const topScore = ranked.length ? parseFloat(ranked[0].finalScore) : 0;
    ranked.forEach((c, i) => {
      c.rank       = i + 1;
      c.gapToFirst = (topScore - parseFloat(c.finalScore)).toFixed(2);
    });

    // Top 3 (or all if fewer than 3), reversed for reveal order (lowest ? champion)
    const top = ranked.slice(0, Math.min(ranked.length, 3));
    top.reverse();

    const placementsJson = JSON.stringify(top.map(c => ({
      rank:              c.rank,
      name:              c.name              || "",
      barangay:          c.barangay          || "",
      number:            c.number            || "",
      photo:             c.photo             || "",
      finalScoreDisplay: c.finalScoreDisplay,
    })));

    res.render("scoring/announce", {
      title:       `Announce � ${ev.name}`,
      event:       ev,
      placementsJson,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load announce page.");
    res.redirect(`/events/${eventId}`);
  }
};

// --- Judge Scoring Progress (JSON endpoint) -----------------------------------
export const getScoringProgress = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.status(404).json({ error: "Event not found." });

    const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const allScores   = sSnap.docs.map(d => d.data());

    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });

    const progressArray = Object.entries(judgeMap).map(([jId, jName], idx) => {
      const scoredCount = new Set(
        allScores.filter(s => s.judgeId === jId).map(s => s.contestantId)
      ).size;
      const completionPct = contestants.length
        ? Math.round((scoredCount / contestants.length) * 100)
        : 0;
      return {
        judgeId:          jId,
        judgeName:        jName,
        alias:            `Judge ${idx + 1}`,
        scoredCount,
        totalContestants: contestants.length,
        completionPct,
      };
    });

    return res.json(progressArray);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not load scoring progress." });
  }
};

// --- Tabulator: All-Scores Review Page ---------------------------------------
// Shows every judge's individual scores for every contestant & criterion.
// The tabulator can edit or override any individual score entry.
export const tabulatorScoringPage = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, cSnap, crSnap, sSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
      getDocs(collection(db, "events", eventId, "scores")),
    ]);

    if (!eSnap.exists()) return res.redirect("/events");

    const ev = { id: eSnap.id, ...eSnap.data() };
    const locked = ev.scoringLocked || false;

    const contestants = sortContestantsByNumber(cSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    const criteria = Array.isArray(crSnap) ? crSnap : crSnap.docs.map((d,i)=>({id:d.id,...d.data(),color:CRITERIA_COLORS[i%CRITERIA_COLORS.length]}));
    const allScores = sSnap.docs.map(d => ({ docId: d.id, ...d.data() }));

    // Build a map of judgeId -> judgeName (from submitted scores)
    const judgeMap = {};
    allScores.forEach(s => {
      if (s.judgeId && !judgeMap[s.judgeId]) {
        judgeMap[s.judgeId] = s.judgeName || "Judge";
      }
    });
    const judges = Object.entries(judgeMap).map(([id, name], idx) => ({
      id,
      name,
      alias: `Judge ${idx + 1}`,
      num: String(idx + 1),
    }));

    // Build matrix: contestants � criteria � judges
    // matrix[contestant][criteria] = { judgeId, value, docId }[]
    const matrix = contestants.map(c => ({
      ...c,
      criteriaScores: criteria.map(cr => {
        const judgeEntries = judges.map(j => {
          const scoreDoc = allScores.find(
            s => s.judgeId === j.id && s.contestantId === c.id && s.criteriaId === cr.id
          );
          const value = scoreDoc ? scoreDoc.score : null;
          const barPct = value !== null
            ? Math.min((value / (Number(cr.maxScore) || 100)) * 100, 100).toFixed(1)
            : "0";
          return {
            judgeId:   j.id,
            judgeName: j.name,
            alias:     j.alias,
            num:       j.num,
            docId:     scoreDoc ? scoreDoc.docId : null,
            value,
            barPct,
          };
        });
        // Average across judges for display
        const submitted = judgeEntries.filter(e => e.value !== null);
        const avg = submitted.length
          ? (submitted.reduce((sum, e) => sum + e.value, 0) / submitted.length).toFixed(2)
          : null;
        return {
          criteriaId:   cr.id,
          criteriaName: cr.name,
          weight:       cr.weight,
          maxScore:     cr.maxScore,
          color:        cr.color,
          avg,
          judgeEntries,
        };
      }),
    }));

    // Compute weighted totals per contestant for the summary header
    // Pass as array so Handlebars can access by index without lookup issues
    const totalsMap = {};
    contestants.forEach(c => {
      let total = 0;
      criteria.forEach(cr => {
        const cScores = allScores.filter(s => s.contestantId === c.id && s.criteriaId === cr.id);
        const avg = cScores.length
          ? cScores.reduce((sum, s) => sum + s.score, 0) / cScores.length
          : 0;
        total += (avg / (Number(cr.maxScore) || 100)) * (Number(cr.weight) || 0);
      });
      totalsMap[c.id] = total.toFixed(2);
    });

    // Build judge completion status
    const judgeStatus = judges.map(j => {
      const judgeScores = allScores.filter(s => s.judgeId === j.id);
      const scoredContestants = new Set(judgeScores.map(s => s.contestantId)).size;
      const completionPct = contestants.length
        ? Math.round((scoredContestants / contestants.length) * 100)
        : 0;
      return {
        ...j,
        scoredCount:  scoredContestants,
        totalCount:   contestants.length,
        completionPct,
        done:         completionPct === 100,
      };
    });

    // Embed total into each contestant so no lookup needed in template
    const matrixWithTotals = matrix.map(c => ({
      ...c,
      weightedTotal: totalsMap[c.id] || "0.00",
    }));

    res.render("scoring/tabulator", {
      title:       `Tabulator Review � ${ev.name}`,
      event:       ev,
      contestants: matrixWithTotals,
      criteria,
      judges:      judgeStatus,
      locked,
      userName:    req.session.userName,
      userRole:    req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin:     req.session.userRole === "admin",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Could not load tabulator review.");
    res.redirect("/events");
  }
};

// --- Tabulator: Update a single score entry -----------------------------------
// POST body: { judgeId, contestantId, criteriaId, score }
export const tabulatorUpdateScore = async (req, res) => {
  const { eventId } = req.params;
  const tabulatorId   = req.session.userId;
  const tabulatorName = req.session.userName || "Tabulator";
  const { judgeId, contestantId, criteriaId, score: rawScore } = req.body;

  const score = parseFloat(rawScore);
  if (!judgeId || !contestantId || !criteriaId || isNaN(score)) {
    req.flash("error_msg", "Invalid score data. Please check all fields.");
    return res.redirect(`/events/${eventId}/tabulator`);
  }

  try {
    // Block if scoring is locked
    const eSnap = await getDoc(doc(db, "events", eventId));
    if (!eSnap.exists()) {
      req.flash("error_msg", "Event not found.");
      return res.redirect("/events");
    }
    if (eSnap.data().scoringLocked) {
      req.flash("error_msg", "Scoring is locked. No edits are allowed.");
      return res.redirect(`/events/${eventId}/tabulator`);
    }

    const docId = `${judgeId}_${contestantId}_${criteriaId}`;
    const scoreRef = doc(db, "events", eventId, "scores", docId);
    const existingSnap = await getDoc(scoreRef);
    const previousScore = existingSnap.exists() ? existingSnap.data().score : null;

    // Upsert the score � preserve original judgeId/judgeName so averages stay correct
    const judgeSnap = existingSnap.exists() ? existingSnap.data() : null;
    await setDoc(scoreRef, {
      judgeId,
      judgeName:     judgeSnap?.judgeName || "Judge",
      contestantId,
      criteriaId,
      score,
      submittedAt:   judgeSnap?.submittedAt ?? serverTimestamp(),
      lastEditedAt:  serverTimestamp(),
      editedBy:      tabulatorId,
      editedByName:  tabulatorName,
    });

    // Audit log
    await addDoc(collection(db, "events", eventId, "audit_log"), {
      action:        "tabulator_score_edit",
      tabulatorId,
      tabulatorName,
      judgeId,
      contestantId,
      criteriaId,
      previousScore,
      newScore:      score,
      timestamp:     serverTimestamp(),
    });

    req.flash("success_msg", "Score updated successfully.");
    res.redirect(`/events/${eventId}/tabulator`);
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Failed to update score.");
    res.redirect(`/events/${eventId}/tabulator`);
  }
};

// ─── Export Tabulator Audit Log as CSV ───────────────────────────────────────
export const exportAuditLog = async (req, res) => {
  const { eventId } = req.params;
  try {
    const [eSnap, auditSnap, cSnap, crSnap] = await Promise.all([
      getDoc(doc(db, "events", eventId)),
      getDocs(collection(db, "events", eventId, "audit_log")),
      getDocs(collection(db, "events", eventId, "contestants")),
      loadCriteria(eventId),
    ]);
    if (!eSnap.exists()) return res.status(404).send("Event not found.");

    const ev = { id: eSnap.id, ...eSnap.data() };
    const contestantMap = {};
    cSnap.docs.forEach(d => { contestantMap[d.id] = d.data().name || d.id; });
    const criteriaMap = {};
    crSnap.forEach(d => { criteriaMap[d.id] = d.name || d.id; });

    const entries = auditSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => {
        const ta = a.timestamp?.toMillis?.() || 0;
        const tb = b.timestamp?.toMillis?.() || 0;
        return ta - tb;
      });

    function q(val) { return `"${String(val ?? "").replace(/"/g, '""')}"`; }

    const header = ["Timestamp", "Action", "Tabulator / Judge", "Contestant", "Criterion", "Previous Score", "New Score"].map(q).join(",");
    const rows = entries.map(e => {
      const ts = e.timestamp?.toDate?.()?.toLocaleString("en-PH", { timeZone: "Asia/Manila" }) || "—";
      const actor = e.tabulatorName || e.judgeName || "—";
      const contestant = e.contestantId ? (contestantMap[e.contestantId] || e.contestantId) : "—";
      const criterion  = e.criteriaId   ? (criteriaMap[e.criteriaId]    || e.criteriaId)   : "—";
      return [ts, e.action || "—", actor, contestant, criterion,
        e.previousScore !== undefined ? e.previousScore : "—",
        e.newScore      !== undefined ? e.newScore      : "—",
      ].map(q).join(",");
    });

    const csv = [header, ...rows].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${eventId}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Could not export audit log.");
  }
};
