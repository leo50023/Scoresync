import { db } from "../models/firebaseConfig.js";
import {
  collection, getDocs, getDoc, doc, setDoc, addDoc, updateDoc,
  query, where, serverTimestamp, orderBy
} from "firebase/firestore";
// ─── Lazy Gemini import — prevents startup crash if package fails to load ──────
let _GoogleGenAI = null;
let _Type = null;
async function getGeminiClient() {
  if (!_GoogleGenAI) {
    try {
      const mod = await import("@google/genai");
      _GoogleGenAI = mod.GoogleGenAI;
      _Type = mod.Type;
    } catch (e) {
      console.error("Failed to load @google/genai:", e.message);
      return null;
    }
  }
  if (!process.env.GEMINI_API_KEY) return null;
  return new _GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
}

// Helper: Calculate standard deviation and mean
function calcStats(numbers) {
  if (!numbers || numbers.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0 };
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / numbers.length;
  const variance = numbers.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / numbers.length;
  return {
    mean: parseFloat(mean.toFixed(2)),
    stdDev: parseFloat(Math.sqrt(variance).toFixed(2)),
    min: Math.min(...numbers),
    max: Math.max(...numbers)
  };
}

// ─── Score Analytics Dashboard View ───────────────────────────────────────────
export const analyticsDashboard = async (req, res) => {
  try {
    const eventsSnap = await getDocs(collection(db, "events"));
    const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Fetch existing flags and latest report
    let flags = [];
    let latestReport = null;

    try {
      const flagsSnap = await getDocs(collection(db, "analytics_flags"));
      flags = flagsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.log("No existing analytics_flags collection yet.");
    }

    try {
      const reportsSnap = await getDocs(collection(db, "analytics_reports"));
      const reports = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      reports.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      latestReport = reports[0] || null;
      if (latestReport) {
        latestReport.insights = Array.isArray(latestReport.insights) ? latestReport.insights : [];
        latestReport.anomalies = Array.isArray(latestReport.anomalies) ? latestReport.anomalies : [];
        latestReport.healthScore = latestReport.healthScore ?? 100;
        latestReport.riskLevel = latestReport.riskLevel || "LOW";
        latestReport.summaryText = latestReport.summaryText || "Audit completed.";
        latestReport.totalScoresAudited = latestReport.totalScoresAudited ?? 0;
        latestReport.judgingConsensusRate = latestReport.judgingConsensusRate ?? 100;
      }
    } catch (e) {
      console.log("No existing analytics_reports collection yet.");
    }

    // Selected event filter if passed
    const selectedEventId = req.query.eventId || (events[0] ? events[0].id : null);

    res.render("analytics/index", {
      title: "AI Score Analytics — Audit & Anomaly Detection",
      events,
      selectedEventId,
      flags,
      latestReport,
      userName: req.session.userName,
      userRole: req.session.userRole,
      userInitial: (req.session.userName || "U")[0].toUpperCase(),
      isAdmin: req.session.userRole === "admin",
      isJudge: req.session.userRole === "judge",
      isEncoder: req.session.userRole === "encoder",
      isOrganizer: req.session.userRole === "organizer",
      isTabulator: req.session.userRole === "tabulator",
    });
  } catch (err) {
    console.error("Analytics dashboard error:", err);
    req.flash("error_msg", "Could not load Score Analytics.");
    res.redirect("/dashboard");
  }
};

// ─── Run AI Analytics via Gemini API ──────────────────────────────────────────
export const runAIAnalytics = async (req, res) => {
  const { eventId } = req.body;

  try {
    // 1. Collect user data for judge names
    const usersSnap = await getDocs(collection(db, "users"));
    const userMap = {};
    usersSnap.docs.forEach(d => {
      const u = d.data();
      userMap[d.id] = u.name || u.email || "Judge";
    });

    // 2. Fetch target event or all events
    let targetEvents = [];
    if (eventId && eventId !== "all") {
      const eSnap = await getDoc(doc(db, "events", eventId));
      if (eSnap.exists()) targetEvents.push({ id: eSnap.id, ...eSnap.data() });
    } else {
      const eSnap = await getDocs(collection(db, "events"));
      targetEvents = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    if (targetEvents.length === 0) {
      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.status(400).json({ error: "No events found to analyze." });
      }
      req.flash("error_msg", "No events found to analyze.");
      return res.redirect("/analytics");
    }

    // 3. Compile entire dataset across requested events
    const auditDataset = [];
    let totalRawScores = 0;

    for (const ev of targetEvents) {
      const [cSnap, crSnap, sSnap] = await Promise.all([
        getDocs(collection(db, "events", ev.id, "contestants")),
        getDocs(collection(db, "events", ev.id, "criteria")),
        getDocs(collection(db, "events", ev.id, "scores")),
      ]);

      const contestants = cSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const criteria    = crSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const scores      = sSnap.docs.map(d => d.data());

      totalRawScores += scores.length;

      const contestantMap = {};
      contestants.forEach(c => { contestantMap[c.id] = c.name || `Contestant #${c.number || c.id}`; });

      const criteriaMap = {};
      criteria.forEach(cr => { criteriaMap[cr.id] = cr; });

      // Group scores by contestant and criteria to compute peer averages
      const scoreGroups = {}; // `${contestantId}_${criteriaId}` -> [scores]
      scores.forEach(s => {
        const key = `${s.contestantId}_${s.criteriaId}`;
        if (!scoreGroups[key]) scoreGroups[key] = [];
        scoreGroups[key].push({
          judgeId: s.judgeId,
          judgeName: userMap[s.judgeId] || `Judge (${s.judgeId.substring(0, 5)})`,
          score: s.score
        });
      });

      // Compute peer stats and identify score deviations
      const eventAuditData = {
        eventId: ev.id,
        eventName: ev.name,
        eventType: ev.type || "Competition",
        eventStatus: ev.status || "upcoming",
        contestantCount: contestants.length,
        judgeCount: new Set(scores.map(s => s.judgeId)).size,
        scoresList: []
      };

      for (const [key, judgeScoresList] of Object.entries(scoreGroups)) {
        const [contestantId, criteriaId] = key.split("_");
        const contestantName = contestantMap[contestantId] || contestantId;
        const cr = criteriaMap[criteriaId] || { name: "Criteria", maxScore: 100 };

        const numericScores = judgeScoresList.map(js => js.score);
        const stats = calcStats(numericScores);

        judgeScoresList.forEach(js => {
          const peerScores = numericScores.filter(sc => sc !== js.score);
          const peerMean = peerScores.length > 0 ? (peerScores.reduce((a, b) => a + b, 0) / peerScores.length) : js.score;
          const delta = js.score - peerMean;

          eventAuditData.scoresList.push({
            judgeId: js.judgeId,
            judgeName: js.judgeName,
            contestantId,
            contestantName,
            criteriaId,
            criteriaName: cr.name,
            maxScore: cr.maxScore || 100,
            recordedScore: js.score,
            peerAverage: parseFloat(peerMean.toFixed(2)),
            deltaVsPeers: parseFloat(delta.toFixed(2)),
            groupStats: stats
          });
        });
      }

      auditDataset.push(eventAuditData);
    }

    if (totalRawScores === 0) {
      const emptyReport = {
        healthScore: 100,
        riskLevel: "LOW",
        summaryText: "No submitted judge scores found for the selected event(s) yet. Please submit scores prior to running AI Audit.",
        totalScoresAudited: 0,
        judgingConsensusRate: 100,
        anomalies: [],
        insights: ["Scoring system is clean and ready. Awaiting initial judge submissions."]
      };

      if (req.xhr || req.headers.accept?.includes("json")) {
        return res.json({ success: true, report: emptyReport });
      }
      req.flash("success_msg", "AI Audit complete. No submitted scores found to evaluate.");
      return res.redirect("/analytics");
    }

    // 4. Send analysis prompt to Gemini API with fallback
    let reportData = null;

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = await getGeminiClient();
        if (!ai) throw new Error("Gemini client unavailable");

        const prompt = `
You are the Chief Tabulator and AI Scoring Auditor for LGU Municipal Festival Competitions.
Analyze the following festival competition scoring dataset for anomalous judging patterns, potential bias, extreme score variance, uniform repetitive scoring, or suspicious score inflation/deflation.

SCORING DATASET:
${JSON.stringify(auditDataset, null, 2)}

INSTRUCTIONS:
1. Examine each judge's scoring behavior across contestants and criteria.
2. Flag any judge who shows statistically significant divergence from peer judges (e.g. giving extremely low scores to a front-runner while peers give high scores, or vice versa).
3. Flag uniform scoring where a judge inputs identical numbers across all contestants or criteria without variance.
4. Flag extreme score outliers where a score deviates significantly from peer average.
5. Provide a global competition health score (0 to 100), risk level (LOW, MODERATE, HIGH, CRITICAL), summary text, consensus rate percentage, actionable anomaly items with severity, and key tabulator insights.
`;

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            systemInstruction: "You are an expert AI Tabulator and Auditor for official Philippine LGU Festival & Cultural Competitions. Detect scoring anomalies with strict objectivity, precision, and clarity.",
            responseMimeType: "application/json",
            responseSchema: {
              type: _Type.OBJECT,
              properties: {
                healthScore: { type: _Type.INTEGER, description: "Health score of judging consistency from 0 to 100" },
                riskLevel: { type: _Type.STRING, description: "LOW, MODERATE, HIGH, or CRITICAL" },
                summaryText: { type: _Type.STRING, description: "Executive summary of audit findings" },
                totalScoresAudited: { type: _Type.INTEGER, description: "Count of scores audited" },
                judgingConsensusRate: { type: _Type.NUMBER, description: "Consensus percentage among judges (0 to 100)" },
                anomalies: {
                  type: _Type.ARRAY,
                  items: {
                    type: _Type.OBJECT,
                    properties: {
                      type: { type: _Type.STRING, description: "JUDGE_BIAS, EXTREME_OUTLIER, UNIFORM_SCORING, CRITERIA_DISCREPANCY, or SUSPICIOUS_PATTERN" },
                      severity: { type: _Type.STRING, description: "LOW, MEDIUM, HIGH, or CRITICAL" },
                      eventId: { type: _Type.STRING },
                      eventName: { type: _Type.STRING },
                      judgeId: { type: _Type.STRING },
                      judgeName: { type: _Type.STRING },
                      contestantId: { type: _Type.STRING },
                      contestantName: { type: _Type.STRING },
                      criteriaName: { type: _Type.STRING },
                      recordedScore: { type: _Type.NUMBER },
                      peerAverage: { type: _Type.NUMBER },
                      delta: { type: _Type.NUMBER },
                      description: { type: _Type.STRING },
                      recommendedAction: { type: _Type.STRING }
                    },
                    required: ["type", "severity", "eventName", "judgeName", "contestantName", "recordedScore", "peerAverage", "description", "recommendedAction"]
                  }
                },
                insights: {
                  type: _Type.ARRAY,
                  items: { type: _Type.STRING }
                }
              },
              required: ["healthScore", "riskLevel", "summaryText", "totalScoresAudited", "judgingConsensusRate", "anomalies", "insights"]
            }
          }
        });

        reportData = JSON.parse(response.text);
      } catch (geminiErr) {
        console.warn("Gemini API call failed, using statistical audit engine fallback:", geminiErr);
      }
    }

    // Statistical rule-based fallback if Gemini API is missing or failed
    if (!reportData) {
      const anomalies = [];
      let totalDivergences = 0;

      for (const evData of auditDataset) {
        for (const item of evData.scoresList) {
          const absDelta = Math.abs(item.deltaVsPeers);
          if (absDelta >= 15) {
            totalDivergences++;
            const isHigh = absDelta >= 25;
            anomalies.push({
              type: isHigh ? "EXTREME_OUTLIER" : "JUDGE_BIAS",
              severity: isHigh ? "HIGH" : "MEDIUM",
              eventId: evData.eventId,
              eventName: evData.eventName,
              judgeId: item.judgeId,
              judgeName: item.judgeName,
              contestantId: item.contestantId,
              contestantName: item.contestantName,
              criteriaName: item.criteriaName,
              recordedScore: item.recordedScore,
              peerAverage: item.peerAverage,
              delta: item.deltaVsPeers,
              description: `${item.judgeName} scored ${item.recordedScore} on ${item.criteriaName} for ${item.contestantName}, which deviates by ${item.deltaVsPeers > 0 ? '+' : ''}${item.deltaVsPeers} pts from peer judge average (${item.peerAverage}).`,
              recommendedAction: isHigh ? "Request judge explanation or apply Olympic trimming (discard highest/lowest score)." : "Verify score card entry for transposition errors."
            });
          }
        }
      }

      const count = totalRawScores || 1;
      const consensusRate = Math.max(0, Math.min(100, Math.round(100 - (totalDivergences / count) * 100)));
      const healthScore = consensusRate;
      const riskLevel = healthScore >= 85 ? "LOW" : healthScore >= 70 ? "MODERATE" : "HIGH";

      reportData = {
        healthScore,
        riskLevel,
        summaryText: anomalies.length > 0
          ? `Audit completed across ${auditDataset.length} event(s) and ${totalRawScores} scores. Identified ${anomalies.length} significant score variance(s) exceeding normal threshold.`
          : `Audit completed across ${auditDataset.length} event(s) and ${totalRawScores} scores. All judges demonstrate strong peer alignment and consistency.`,
        totalScoresAudited: totalRawScores,
        judgingConsensusRate: consensusRate,
        anomalies,
        insights: [
          "Scoring variance computed against peer judge averages.",
          "Automatic flag triggered when score divergence exceeds 15 points.",
          "Ensure official signed judge sheets match digitized score records."
        ]
      };
    }

    // 5. Store report and flags in Firestore
    const reportDoc = await addDoc(collection(db, "analytics_reports"), {
      ...reportData,
      eventId: eventId || "all",
      createdAt: serverTimestamp(),
      createdByName: req.session.userName || "Admin"
    });

    // Save individual flags for administrative tracking
    if (Array.isArray(reportData.anomalies)) {
      for (const anomaly of reportData.anomalies) {
        await addDoc(collection(db, "analytics_flags"), {
          ...anomaly,
          reportId: reportDoc.id,
          status: "pending", // pending, reviewed, dismissed, action_taken
          createdAt: serverTimestamp()
        });
      }
    }

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, report: reportData, reportId: reportDoc.id });
    }

    req.flash("success_msg", `AI Audit finished! Detected ${reportData.anomalies.length} potential scoring flag(s).`);
    res.redirect("/analytics");

  } catch (err) {
    console.error("Run AI Analytics Error:", err);
    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.status(500).json({ error: "Failed to generate AI score analytics: " + err.message });
    }
    req.flash("error_msg", "Failed to run AI score analytics. Please check Gemini API configuration.");
    res.redirect("/analytics");
  }
};

// ─── Update Anomaly Flag Status ───────────────────────────────────────────────
export const updateFlagStatus = async (req, res) => {
  const { flagId } = req.params;
  const { status, adminNotes } = req.body;

  try {
    if (!["pending", "reviewed", "dismissed", "action_taken"].includes(status)) {
      if (req.xhr) return res.status(400).json({ error: "Invalid status" });
      req.flash("error_msg", "Invalid status value.");
      return res.redirect("/analytics");
    }

    await updateDoc(doc(db, "analytics_flags", flagId), {
      status,
      adminNotes: adminNotes || "",
      reviewedAt: serverTimestamp(),
      reviewedBy: req.session.userName || "Admin"
    });

    if (req.xhr || req.headers.accept?.includes("json")) {
      return res.json({ success: true, flagId, status });
    }

    req.flash("success_msg", `Flag status updated to '${status}'.`);
    res.redirect("/analytics");
  } catch (err) {
    console.error("Update flag error:", err);
    if (req.xhr) return res.status(500).json({ error: err.message });
    req.flash("error_msg", "Failed to update flag status.");
    res.redirect("/analytics");
  }
};

// Helper: Escape string fields for RFC-4180 CSV compliance
function escapeCSV(str) {
  if (str === null || str === undefined) return '""';
  const stringified = String(str);
  return `"${stringified.replace(/"/g, '""')}"`;
}

// ─── Export Anomaly Flags & Audit Reports to CSV ──────────────────────────────
export const exportAnalyticsCSV = async (req, res) => {
  const { type } = req.query; // 'flags' or 'report'
  try {
    if (type === 'flags') {
      const flagsSnap = await getDocs(collection(db, "analytics_flags"));
      const flags = flagsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const headers = [
        "Flag ID", "Status", "Severity", "Type", "Event Name",
        "Judge Name", "Contestant Name", "Criteria Name",
        "Recorded Score", "Peer Average", "Divergence",
        "Observation / Description", "Recommended Action", "Admin Notes"
      ];

      const rows = flags.map(f => [
        escapeCSV(f.id),
        escapeCSV(f.status || "pending"),
        escapeCSV(f.severity || "MEDIUM"),
        escapeCSV(f.type || "ANOMALY"),
        escapeCSV(f.eventName || "N/A"),
        escapeCSV(f.judgeName || "N/A"),
        escapeCSV(f.contestantName || "N/A"),
        escapeCSV(f.criteriaName || "N/A"),
        escapeCSV(f.recordedScore ?? ""),
        escapeCSV(f.peerAverage ?? ""),
        escapeCSV(f.delta ?? ""),
        escapeCSV(f.description || ""),
        escapeCSV(f.recommendedAction || ""),
        escapeCSV(f.adminNotes || "")
      ]);

      const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const filename = `anomaly_logs_${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    } else {
      // Export audit reports summary & anomalies
      const reportsSnap = await getDocs(collection(db, "analytics_reports"));
      const reports = reportsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      reports.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

      const headers = [
        "Report ID", "Event ID", "Health Score", "Risk Level",
        "Consensus Rate (%)", "Total Scores Audited", "Anomalies Count",
        "Summary Text", "Audited By"
      ];

      const rows = reports.map(r => [
        escapeCSV(r.id),
        escapeCSV(r.eventId || "all"),
        escapeCSV(r.healthScore ?? ""),
        escapeCSV(r.riskLevel || ""),
        escapeCSV(r.judgingConsensusRate ?? ""),
        escapeCSV(r.totalScoresAudited ?? ""),
        escapeCSV(r.anomalies?.length || 0),
        escapeCSV(r.summaryText || ""),
        escapeCSV(r.createdByName || "Admin")
      ]);

      const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
      const filename = `audit_reports_${new Date().toISOString().slice(0, 10)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(csvContent);
    }
  } catch (err) {
    console.error("Export CSV error:", err);
    req.flash("error_msg", "Failed to export CSV: " + err.message);
    res.redirect("/analytics");
  }
};

