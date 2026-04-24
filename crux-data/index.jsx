const { useState, useEffect, useRef } = React;

const ORIGIN = "https://www.mywebsite.com";
const TEST_URL = "https://www.mywebsite.com/full-relative-path";

const METRIC_LABELS = { largest_contentful_paint: "LCP", interaction_to_next_paint: "INP", cumulative_layout_shift: "CLS", LARGEST_CONTENTFUL_PAINT: "LCP", INTERACTION_TO_NEXT_PAINT: "INP", CUMULATIVE_LAYOUT_SHIFT: "CLS" };
const METRIC_UNITS = { largest_contentful_paint: "ms", interaction_to_next_paint: "ms", cumulative_layout_shift: "", LARGEST_CONTENTFUL_PAINT: "ms", INTERACTION_TO_NEXT_PAINT: "ms", CUMULATIVE_LAYOUT_SHIFT: "" };
const METRIC_THRESHOLDS = {
  largest_contentful_paint: { good: 2500, poor: 4000 }, interaction_to_next_paint: { good: 200, poor: 500 }, cumulative_layout_shift: { good: 0.1, poor: 0.25 },
  LARGEST_CONTENTFUL_PAINT: { good: 2500, poor: 4000 }, INTERACTION_TO_NEXT_PAINT: { good: 200, poor: 500 }, CUMULATIVE_LAYOUT_SHIFT: { good: 0.1, poor: 0.25 },
};

const psiCurl = (url, strategy) => `# PageSpeed Insights — origin + URL field data (no API key needed)
curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url || "https://example.com")}&strategy=${strategy || "mobile"}&category=performance" > psi_result.json

echo "Saved to psi_result.json — paste contents into the dashboard"`;

function generateBqSql(origin, testUrl, months, device) {
  const yyyymmList = months.map(m => m.year * 100 + (m.month + 1));
  const inClause = yyyymmList.join(", ");
  const monthLabels = months.map(m => {
    const d = new Date(m.year, m.month);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  });
  const deviceFilter = device === "all" ? "" : `\n  AND device = '${device}'`;
  const deviceLabel = device === "all" ? "all devices" : device;
  return `-- CrUX BigQuery: ${origin} CWV — ${monthLabels[0]}–${monthLabels[monthLabels.length - 1]} (${deviceLabel})
-- Run at: https://console.cloud.google.com/bigquery
-- Note: The most recent month's table may not exist yet
-- (CrUX monthly tables release on the 2nd Tuesday after month ends)

SELECT
  yyyymm, device, origin,
  p75_lcp, p75_inp, p75_cls,
  ROUND(fast_lcp / (fast_lcp + avg_lcp + slow_lcp), 3) AS pct_good_lcp,
  ROUND(fast_inp / (fast_inp + avg_inp + slow_inp), 3) AS pct_good_inp,
  ROUND(small_cls / (small_cls + medium_cls + large_cls), 3) AS pct_good_cls,
  ROUND(slow_inp / (fast_inp + avg_inp + slow_inp), 3) AS pct_poor_inp
FROM \`chrome-ux-report.materialized.device_summary\`
WHERE origin = '${origin}'${deviceFilter}
  AND yyyymm IN (${inClause})
ORDER BY yyyymm;


-- BONUS: Compare specific article URL vs origin
SELECT
  yyyymm,
  IF(url = origin, 'ORIGIN', 'ARTICLE') AS scope,
  url,
  p75_lcp, p75_inp, p75_cls
FROM \`chrome-ux-report.materialized.device_summary\`
WHERE (
    origin = '${origin}'
    OR url = '${testUrl}'
  )${deviceFilter}
  AND yyyymm IN (${inClause})
ORDER BY yyyymm, scope;`;
}

const BQ_DEVICES = [
  { value: "phone", label: "Phone" },
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "all", label: "All" },
];

function fmt(metric, value) {
  const v = parseFloat(value);
  if (metric.toLowerCase().includes("layout_shift") || metric.toLowerCase().includes("cls")) return v.toFixed(2);
  return Math.round(v).toLocaleString();
}

function status(metric, p75) {
  const t = METRIC_THRESHOLDS[metric];
  if (!t) return "unknown";
  const v = parseFloat(p75);
  if (v <= t.good) return "good";
  if (v <= t.poor) return "ni";
  return "poor";
}

const SC = { good: "#0d7c3e", ni: "#d48c00", poor: "#d4230f", unknown: "#888" };
const SB = { good: "rgba(13,124,62,0.06)", ni: "rgba(212,140,0,0.06)", poor: "rgba(212,35,15,0.06)", unknown: "#f5f5f3" };

const FORM_FACTORS_CRUX = [
  { value: "PHONE", label: "Phone" },
  { value: "DESKTOP", label: "Desktop" },
  { value: "TABLET", label: "Tablet" },
  { value: "ALL", label: "All" },
];

const FORM_FACTORS_PSI = [
  { value: "mobile", label: "Mobile" },
  { value: "desktop", label: "Desktop" },
];

function FormFactorSelect({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: 0, borderRadius: 4, overflow: "hidden", border: "1px solid #d0d0cc" }}>
      {options.map(opt => (
        <button key={opt.value} onClick={() => onChange(opt.value)} style={{
          padding: "7px 14px", fontSize: 12, fontWeight: value === opt.value ? 600 : 400,
          background: value === opt.value ? "#1a1a2e" : "#fff",
          color: value === opt.value ? "#fff" : "#888",
          border: "none", cursor: "pointer", fontFamily: "inherit",
          borderRight: "1px solid #d0d0cc",
        }}>{opt.label}</button>
      ))}
    </div>
  );
}

function StatusCard({ metric, p75, distributions }) {
  const s = status(metric, p75);
  const label = METRIC_LABELS[metric] || metric;
  const unit = METRIC_UNITS[metric] || "";
  const good = distributions?.[0]?.proportion;
  const ni = distributions?.[1]?.proportion;
  const poor = distributions?.[2]?.proportion;
  return (
    <div style={{ background: SB[s], border: `1px solid ${SC[s]}22`, borderRadius: 6, padding: "14px 16px", borderLeft: `3px solid ${SC[s]}` }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 4 }}>{label} (p75)</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: SC[s], fontFamily: "'DM Mono', monospace" }}>
        {fmt(metric, p75)}<span style={{ fontSize: 12, fontWeight: 400, marginLeft: 2 }}>{unit}</span>
      </div>
      {good != null && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${good * 100}%`, background: SC.good }} />
            <div style={{ width: `${ni * 100}%`, background: SC.ni }} />
            <div style={{ width: `${poor * 100}%`, background: SC.poor }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginTop: 4, fontFamily: "'DM Mono', monospace" }}>
            <span style={{ color: SC.good }}>{(good * 100).toFixed(0)}% good</span>
            <span style={{ color: SC.poor }}>{(poor * 100).toFixed(0)}% poor</span>
          </div>
        </div>
      )}
      <div style={{ fontSize: 10, color: SC[s], marginTop: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {s === "ni" ? "Needs Improvement" : s === "good" ? "Good" : s === "poor" ? "Poor" : "—"}
      </div>
    </div>
  );
}

function CopyBlock({ text, copied, onCopy, maxHeight = 260 }) {
  const preRef = useRef(null);
  const handleCopy = () => {
    // Try clipboard API first, fall back to selecting text
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => onCopy()).catch(() => selectFallback());
    } else {
      selectFallback();
    }
  };
  const selectFallback = () => {
    if (preRef.current) {
      const range = document.createRange();
      range.selectNodeContents(preRef.current);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    onCopy();
  };
  return (
    <div style={{ position: "relative", background: "#1a1a2e", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
      <button onClick={handleCopy} style={{ position: "absolute", top: 8, right: 8, padding: "4px 12px", background: copied ? "#0d7c3e" : "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit", zIndex: 1 }}>
        {copied ? "✓ Copied" : "Copy"}
      </button>
      <pre ref={preRef} style={{ color: "#c8d6e5", padding: "16px 20px", margin: 0, fontSize: 11, lineHeight: 1.6, overflow: "auto", maxHeight, fontFamily: "'DM Mono', monospace", userSelect: "text" }}>{text}</pre>
    </div>
  );
}

function Dashboard() {
  const [tab, setTab] = useState("urlLookup");
  const [psiJson, setPsiJson] = useState("");
  const [psiData, setPsiData] = useState(null);
  const [psiErr, setPsiErr] = useState(null);
  const [psiUrl, setPsiUrl] = useState(TEST_URL);
  const [psiFormFactor, setPsiFormFactor] = useState("mobile");
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState({});
  // BigQuery state
  const [bqDevice, setBqDevice] = useState("phone");
  const [bqOrigin, setBqOrigin] = useState(ORIGIN);
  const [bqUrl, setBqUrl] = useState(TEST_URL);
  const [bqMonths, setBqMonths] = useState(() => {
    // Default: past 6 months including current month
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), selected: true });
    }
    return months;
  });
  // URL Lookup tab state
  const [urlInput, setUrlInput] = useState(TEST_URL);
  const [urlApiKey, setUrlApiKey] = useState("");
  const [urlFormFactor, setUrlFormFactor] = useState("PHONE");
  const [urlSnapshotJson, setUrlSnapshotJson] = useState("");
  const [urlSnapshotData, setUrlSnapshotData] = useState(null);
  const [urlSnapshotErr, setUrlSnapshotErr] = useState(null);
  const [urlHistoryJson, setUrlHistoryJson] = useState("");
  const [urlHistoryData, setUrlHistoryData] = useState(null);
  const [urlHistoryErr, setUrlHistoryErr] = useState(null);
  const urlCanvasRefs = useRef({});

  const copy = (text, id) => { setCopied(p => ({ ...p, [id]: true })); setTimeout(() => setCopied(p => ({ ...p, [id]: false })), 3000); };

  const parsePsi = () => {
    setPsiErr(null);
    try {
      const d = JSON.parse(psiJson);
      if (!d.loadingExperience && !d.originLoadingExperience) throw new Error("No field data found in response. Make sure you're pasting the full PSI JSON.");
      setPsiData(d);
    } catch (e) { setPsiErr(e.message); }
  };

  const parseUrlSnapshot = () => {
    setUrlSnapshotErr(null);
    try {
      const d = JSON.parse(urlSnapshotJson);
      if (!d?.record?.metrics) throw new Error("Invalid CrUX response — missing record.metrics. If you got a NOT_FOUND error, this URL doesn't have enough traffic for CrUX.");
      setUrlSnapshotData(d);
    } catch (e) { setUrlSnapshotErr(e.message); }
  };

  const parseUrlHistory = () => {
    setUrlHistoryErr(null);
    try {
      const d = JSON.parse(urlHistoryJson);
      if (!d?.record?.metrics) throw new Error("Invalid CrUX History response — missing record.metrics. If you got a NOT_FOUND error, this URL doesn't have enough traffic for CrUX.");
      setUrlHistoryData(d);
    } catch (e) { setUrlHistoryErr(e.message); }
  };

  const urlSnapshotCurl = (u, k, ff) => {
    const ffLine = ff === "ALL" ? "" : `\n    "formFactor": "${ff}",`;
    return `# CrUX API — single URL snapshot${ff === "ALL" ? " (all form factors)" : ` (${ff.toLowerCase()})`}
curl -s -X POST \\
  'https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${k || "YOUR_API_KEY"}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "url": "${u || "https://example.com"}"${ff === "ALL" ? "" : ","}${ffLine}
  }' > crux_url_snapshot.json

echo "Saved to crux_url_snapshot.json"`;
  };

  const urlHistoryCurl = (u, k, ff) => {
    const ffLine = ff === "ALL" ? "" : `\n    "formFactor": "${ff}",`;
    return `# CrUX History API — single URL${ff === "ALL" ? " (all form factors)" : ` (${ff.toLowerCase()})`}, 40 weeks
curl -s -X POST \\
  'https://chromeuxreport.googleapis.com/v1/records:queryHistoryRecord?key=${k || "YOUR_API_KEY"}' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "url": "${u || "https://example.com"}",${ffLine}
    "metrics": ["largest_contentful_paint","interaction_to_next_paint","cumulative_layout_shift"]
  }' > crux_url_history.json

echo "Saved to crux_url_history.json"`;
  };

  // Draw URL History charts
  useEffect(() => {
    if (!urlHistoryData?.record?.metrics) return;
    const metrics = urlHistoryData.record.metrics;
    const periods = urlHistoryData.record.collectionPeriods || [];
    ["interaction_to_next_paint", "largest_contentful_paint", "cumulative_layout_shift"].forEach(mk => {
      const canvas = urlCanvasRefs.current[mk];
      if (!canvas || !metrics[mk]) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      const W = rect.width, H = rect.height;
      const p75s = metrics[mk].percentilesTimeseries?.p75s || [];
      const vals = p75s.map(v => v == null ? null : parseFloat(v));
      const valid = vals.filter(v => v !== null);
      if (!valid.length) return;
      const th = METRIC_THRESHOLDS[mk];
      const max = Math.max(...valid, th.poor * 1.15);
      const pT = 32, pB = 48, pL = 56, pR = 20;
      const cW = W - pL - pR, cH = H - pT - pB;
      const y = v => pT + cH - (v / max) * cH;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.02)"; ctx.fillRect(pL, pT, cW, cH);
      ctx.fillStyle = "rgba(13,124,62,0.05)"; ctx.fillRect(pL, y(th.good), cW, y(0) - y(th.good));
      ctx.fillStyle = "rgba(212,140,0,0.05)"; ctx.fillRect(pL, y(th.poor), cW, y(th.good) - y(th.poor));
      ctx.fillStyle = "rgba(212,35,15,0.05)"; ctx.fillRect(pL, pT, cW, y(th.poor) - pT);
      [th.good, th.poor].forEach((t, i) => {
        const yy = y(t); ctx.strokeStyle = i === 0 ? "#0d7c3e" : "#d4230f"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pL, yy); ctx.lineTo(W - pR, yy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle; ctx.font = "600 10px 'DM Sans',system-ui"; ctx.textAlign = "right";
        ctx.fillText(mk.includes("layout") ? t.toFixed(2) : t.toLocaleString(), pL - 6, yy + 3);
      });
      ctx.fillStyle = "#888"; ctx.font = "10px 'DM Sans',system-ui"; ctx.textAlign = "right";
      for (let i = 0; i <= 5; i++) { const v2 = (max * i) / 5; ctx.fillText(mk.includes("layout") ? v2.toFixed(2) : Math.round(v2).toLocaleString(), pL - 6, y(v2) + 3); ctx.strokeStyle = "rgba(0,0,0,0.05)"; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(pL, y(v2)); ctx.lineTo(W - pR, y(v2)); ctx.stroke(); }
      const xS = cW / Math.max(vals.length - 1, 1);
      ctx.strokeStyle = "#1a1a2e"; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
      let started = false; const pts = [];
      vals.forEach((v2, i) => { if (v2 === null) return; const xx = pL + i * xS, yy = y(v2); pts.push({ x: xx, y: yy, v: v2, i }); if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy); });
      ctx.stroke();
      if (pts.length > 1) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.lineTo(pts[pts.length - 1].x, pT + cH); ctx.lineTo(pts[0].x, pT + cH); ctx.closePath(); const g = ctx.createLinearGradient(0, pT, 0, pT + cH); g.addColorStop(0, "rgba(26,26,46,0.12)"); g.addColorStop(1, "rgba(26,26,46,0.01)"); ctx.fillStyle = g; ctx.fill(); }
      let uIdx = -1;
      periods.forEach((p, i) => { const d = p.lastDate; if (!d) return; const dt = new Date(`${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`); if (uIdx < 0 && dt >= new Date("2026-03-27")) uIdx = i; if (dt >= new Date("2026-03-27") && dt <= new Date("2026-04-15")) { ctx.fillStyle = "rgba(212,35,15,0.06)"; ctx.fillRect(pL + i * xS - xS / 2, pT, xS, cH); } });
      pts.forEach(p => { const s2 = status(mk, p.v); if (p.i >= vals.length - 6 || p.i === 0 || p.i === uIdx) { ctx.fillStyle = SC[s2]; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill(); } });
      if (uIdx >= 0) { const xx = pL + uIdx * xS; ctx.strokeStyle = "rgba(212,35,15,0.5)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(xx, pT); ctx.lineTo(xx, pT + cH); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = "#d4230f"; ctx.font = "600 9px 'DM Sans',system-ui"; ctx.textAlign = "left"; ctx.fillText("Mar 27 Core Update", xx + 4, pT + 12); }
      ctx.fillStyle = "#888"; ctx.font = "10px 'DM Sans',system-ui"; ctx.textAlign = "center";
      const ev = Math.max(Math.floor(periods.length / 8), 1);
      periods.forEach((p, i) => { if (i % ev !== 0 && i !== periods.length - 1) return; const d = p.lastDate; if (!d) return; ctx.fillText(`${d.month}/${d.day}`, pL + i * xS, H - pB + 16); });
    });
  }, [urlHistoryData]);

  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} style={{ padding: "14px 20px", background: "none", border: "none", borderBottom: tab === id ? "2px solid #1a1a2e" : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: tab === id ? 600 : 400, color: tab === id ? "#1a1a2e" : "#888", fontFamily: "inherit" }}>{label}</button>
  );

  const originMetrics = psiData?.originLoadingExperience?.metrics || {};
  const urlMetrics = psiData?.loadingExperience?.metrics || {};
  const cwvKeys = ["INTERACTION_TO_NEXT_PAINT", "LARGEST_CONTENTFUL_PAINT", "CUMULATIVE_LAYOUT_SHIFT"];

  return (
    <div style={{ fontFamily: "'DM Sans',system-ui,sans-serif", background: "#fafaf8", minHeight: "100vh", color: "#1a1a2e" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <div style={{ background: "#1a1a2e", color: "#fff", padding: "24px 28px 20px", borderBottom: "3px solid #d4230f" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "#666", marginBottom: 4, fontWeight: 500 }}>CWV Investigation · Step 7</div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Core Web Vitals — Origin Analysis</h1>
        <div style={{ fontSize: 12, color: "#888", marginTop: 6, fontFamily: "'DM Mono',monospace" }}>{ORIGIN} · <span style={{ color: "#d48c00" }}>CWV Investigation</span></div>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid #e0e0dc", background: "#fff", overflowX: "auto" }}>
        {tabBtn("urlLookup", "① CrUX API Lookup")}
        {tabBtn("psi", "② PageSpeed Insights")}
        {tabBtn("bigquery", "③ BigQuery SQL")}
      </div>

      <div style={{ padding: "20px 28px", maxWidth: 960 }}>

        {/* ============ PSI ============ */}
        {tab === "psi" && (
          <div>
            <div style={{ background: "#fff", border: "1px solid #e0e0dc", borderRadius: 6, padding: "16px 20px", marginBottom: 16, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
              <strong>How to use:</strong> Enter a URL below, run the generated curl command in your terminal (no API key needed), then paste the JSON output into the box below.
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>URL to analyze</label>
              <input type="text" value={psiUrl} onChange={e => setPsiUrl(e.target.value)} placeholder="https://www.mywebsite.com/some-article"
                style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono',monospace", boxSizing: "border-box" }} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Form Factor</label>
              <FormFactorSelect value={psiFormFactor} onChange={setPsiFormFactor} options={FORM_FACTORS_PSI} />
            </div>

            <CopyBlock text={psiCurl(psiUrl, psiFormFactor)} copied={copied.psi} onCopy={() => copy(psiCurl(psiUrl, psiFormFactor), "psi")} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Paste psi_result.json contents here:</label>
            <textarea value={psiJson} onChange={e => setPsiJson(e.target.value)} placeholder='{"lighthouseResult":..., "loadingExperience":..., "originLoadingExperience":...}'
              style={{ width: "100%", height: 100, padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 11, fontFamily: "'DM Mono',monospace", resize: "vertical", boxSizing: "border-box" }} />
            <button onClick={parsePsi} style={{ marginTop: 8, padding: "8px 20px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>Visualize</button>

            {psiErr && <div style={{ background: "rgba(212,35,15,0.06)", border: "1px solid rgba(212,35,15,0.2)", borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "#d4230f", marginTop: 12 }}>{psiErr}</div>}

            {psiData && (
              <div style={{ marginTop: 24 }}>
                {[
                  { label: "Origin-Level Field Data (CrUX)", subtitle: `All pages on ${ORIGIN}`, metrics: originMetrics, overall: psiData?.originLoadingExperience?.overall_category },
                  { label: "URL-Level Field Data (CrUX)", subtitle: psiUrl, metrics: urlMetrics, overall: psiData?.loadingExperience?.overall_category },
                ].map((sec, si) => (
                  <div key={si} style={{ marginBottom: 24 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{sec.label}</h3>
                      {sec.overall && <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: SC[sec.overall === "FAST" ? "good" : sec.overall === "AVERAGE" ? "ni" : "poor"], background: SB[sec.overall === "FAST" ? "good" : sec.overall === "AVERAGE" ? "ni" : "poor"], padding: "3px 8px", borderRadius: 3 }}>{sec.overall}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 10, fontFamily: "'DM Mono',monospace", wordBreak: "break-all" }}>{sec.subtitle}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                      {cwvKeys.map(m => {
                        const d = sec.metrics[m];
                        if (!d) return <div key={m} style={{ background: "#f5f5f3", borderRadius: 6, padding: "14px 16px", fontSize: 12, color: "#aaa" }}>No {METRIC_LABELS[m]} data</div>;
                        return <StatusCard key={m} metric={m} p75={d.percentile} distributions={d.distributions} />;
                      })}
                    </div>
                  </div>
                ))}

                {psiData?.lighthouseResult?.categories?.performance && (() => {
                  const s = psiData.lighthouseResult.categories.performance.score;
                  const c = s >= 0.9 ? SC.good : s >= 0.5 ? SC.ni : SC.poor;
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 16, background: "#fff", border: "1px solid #e0e0dc", borderRadius: 6, padding: "14px 20px" }}>
                      <div style={{ width: 50, height: 50, borderRadius: "50%", border: `4px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: c, flexShrink: 0 }}>{Math.round(s * 100)}</div>
                      <div style={{ fontSize: 12, color: "#888" }}>Lighthouse lab score (simulated mobile). Field data above is what Search Console uses.</div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* ============ CrUX API LOOKUP ============ */}
        {tab === "urlLookup" && (
          <div>
            <div style={{ background: "#fff", border: "1px solid #e0e0dc", borderRadius: 6, padding: "16px 20px", marginBottom: 16, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
              <strong>CrUX API Lookup:</strong> Enter any URL or origin to generate curl commands for both a current snapshot and 40-week history. Only URLs with sufficient Chrome traffic will have data — if you get a NOT_FOUND error, the URL doesn't meet CrUX's inclusion threshold.
            </div>

            {/* URL + API Key inputs */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>URL to look up</label>
              <input type="text" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://www.mywebsite.com/some-article"
                style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono',monospace", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>CrUX API Key</label>
              <input type="text" value={urlApiKey} onChange={e => setUrlApiKey(e.target.value)} placeholder="AIzaSy..."
                style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono',monospace", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Form Factor</label>
              <FormFactorSelect value={urlFormFactor} onChange={setUrlFormFactor} options={FORM_FACTORS_CRUX} />
            </div>

            {/* Snapshot section */}
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "#1a1a2e", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 3, fontWeight: 600 }}>A</span>
                Current Snapshot (28-day rolling)
              </h3>

              <CopyBlock text={urlSnapshotCurl(urlInput, urlApiKey, urlFormFactor)} copied={copied.urlSnap} onCopy={() => copy(urlSnapshotCurl(urlInput, urlApiKey, urlFormFactor), "urlSnap")} />

              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Paste crux_url_snapshot.json here:</label>
              <textarea value={urlSnapshotJson} onChange={e => setUrlSnapshotJson(e.target.value)} placeholder='{"record":{"key":{"url":"..."},"metrics":...}}'
                style={{ width: "100%", height: 80, padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 11, fontFamily: "'DM Mono',monospace", resize: "vertical", boxSizing: "border-box" }} />
              <button onClick={parseUrlSnapshot} style={{ marginTop: 8, padding: "8px 20px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>Visualize Snapshot</button>

              {urlSnapshotErr && <div style={{ background: "rgba(212,35,15,0.06)", border: "1px solid rgba(212,35,15,0.2)", borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "#d4230f", marginTop: 12 }}>{urlSnapshotErr}</div>}

              {urlSnapshotData && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 10, fontFamily: "'DM Mono',monospace", wordBreak: "break-all" }}>
                    {urlSnapshotData.record?.key?.url || urlSnapshotData.record?.key?.origin || "—"}
                    {urlSnapshotData.record?.key?.formFactor && <span> · {urlSnapshotData.record.key.formFactor}</span>}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {["interaction_to_next_paint", "largest_contentful_paint", "cumulative_layout_shift"].map(m => {
                      const d = urlSnapshotData.record?.metrics?.[m];
                      if (!d) return <div key={m} style={{ background: "#f5f5f3", borderRadius: 6, padding: "14px 16px", fontSize: 12, color: "#aaa" }}>No {METRIC_LABELS[m]} data</div>;
                      const p75 = d.percentiles?.p75;
                      const hist = d.histogram || [];
                      const distributions = hist.map(h => ({ proportion: h.density }));
                      return <StatusCard key={m} metric={m} p75={p75} distributions={distributions} />;
                    })}
                  </div>
                  {urlSnapshotData.record?.collectionPeriod && (
                    <div style={{ fontSize: 11, color: "#888", marginTop: 10 }}>
                      Collection period: {(() => { const f = urlSnapshotData.record.collectionPeriod.firstDate; const l = urlSnapshotData.record.collectionPeriod.lastDate; return f && l ? `${f.month}/${f.day}/${f.year} — ${l.month}/${l.day}/${l.year}` : "—"; })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* History section */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ background: "#1a1a2e", color: "#fff", fontSize: 10, padding: "2px 8px", borderRadius: 3, fontWeight: 600 }}>B</span>
                40-Week History
              </h3>

              <CopyBlock text={urlHistoryCurl(urlInput, urlApiKey, urlFormFactor)} copied={copied.urlHist} onCopy={() => copy(urlHistoryCurl(urlInput, urlApiKey, urlFormFactor), "urlHist")} />

              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Paste crux_url_history.json here:</label>
              <textarea value={urlHistoryJson} onChange={e => setUrlHistoryJson(e.target.value)} placeholder='{"record":{"metrics":...}}'
                style={{ width: "100%", height: 80, padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 11, fontFamily: "'DM Mono',monospace", resize: "vertical", boxSizing: "border-box" }} />
              <button onClick={parseUrlHistory} style={{ marginTop: 8, padding: "8px 20px", background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>Visualize History</button>

              {urlHistoryErr && <div style={{ background: "rgba(212,35,15,0.06)", border: "1px solid rgba(212,35,15,0.2)", borderRadius: 4, padding: "10px 14px", fontSize: 12, color: "#d4230f", marginTop: 12 }}>{urlHistoryErr}</div>}

              {urlHistoryData && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: "#888", marginBottom: 10, fontFamily: "'DM Mono',monospace", wordBreak: "break-all" }}>
                    {urlHistoryData.record?.key?.url || "—"}
                  </div>
                  {["interaction_to_next_paint", "largest_contentful_paint", "cumulative_layout_shift"].map(m => {
                    if (!urlHistoryData.record.metrics[m]) return null;
                    const p75s = urlHistoryData.record.metrics[m].percentilesTimeseries?.p75s || [];
                    const latest = p75s[p75s.length - 1];
                    const s = latest != null ? status(m, parseFloat(latest)) : "unknown";
                    return (
                      <div key={m} style={{ marginBottom: 24 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{METRIC_LABELS[m]}</h3>
                          {latest != null && <span style={{ fontSize: 13, fontWeight: 700, color: SC[s], fontFamily: "'DM Mono',monospace" }}>{fmt(m, parseFloat(latest))}{METRIC_UNITS[m]}</span>}
                          <span style={{ fontSize: 10, background: "#eee", padding: "2px 8px", borderRadius: 3, color: "#666" }}>
                            Good ≤ {m.includes("layout") ? METRIC_THRESHOLDS[m].good.toFixed(1) : METRIC_THRESHOLDS[m].good}{METRIC_UNITS[m]} · Poor &gt; {m.includes("layout") ? METRIC_THRESHOLDS[m].poor.toFixed(2) : METRIC_THRESHOLDS[m].poor}{METRIC_UNITS[m]}
                          </span>
                        </div>
                        <div style={{ background: "#fff", border: "1px solid #e0e0dc", borderRadius: 6, overflow: "hidden" }}>
                          <canvas ref={el => (urlCanvasRefs.current[m] = el)} style={{ width: "100%", height: 200, display: "block" }} />
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 11, color: "#888" }}>Red zone = March 27 core update window. {urlHistoryData.record.collectionPeriods?.length} weekly periods shown.</div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 20, background: "rgba(212,140,0,0.06)", border: "1px solid rgba(212,140,0,0.2)", borderRadius: 6, padding: "12px 16px", fontSize: 12, color: "#666", lineHeight: 1.7 }}>
              <strong style={{ color: "#d48c00" }}>Note:</strong> URL-level CrUX data is only available for pages with sufficient Chrome traffic. If you get a NOT_FOUND error, fall back to the origin-level data in tabs ①–② or use lab tools (DevTools, WebPageTest) for that specific page.
            </div>
          </div>
        )}

        {/* ============ BIGQUERY ============ */}
        {tab === "bigquery" && (() => {
          const selectedMonths = bqMonths.filter(m => m.selected);
          const sql = generateBqSql(bqOrigin, bqUrl, selectedMonths, bqDevice);

          // Generate a wider range of months the user can toggle (12 months back from current)
          const allMonths = [];
          const now = new Date();
          for (let i = 0; i <= 11; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            allMonths.push({ year: d.getFullYear(), month: d.getMonth() });
          }

          const isSelected = (y, m) => bqMonths.some(b => b.year === y && b.month === m && b.selected);
          const toggleMonth = (y, m) => {
            const exists = bqMonths.find(b => b.year === y && b.month === m);
            if (exists) {
              setBqMonths(prev => prev.map(b => b.year === y && b.month === m ? { ...b, selected: !b.selected } : b));
            } else {
              setBqMonths(prev => [...prev, { year: y, month: m, selected: true }].sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month)));
            }
          };

          return (
          <div>
            <div style={{ background: "#fff", border: "1px solid #e0e0dc", borderRadius: 6, padding: "16px 20px", marginBottom: 16, fontSize: 13, color: "#555", lineHeight: 1.7 }}>
              Run in <a href="https://console.cloud.google.com/bigquery" target="_blank" rel="noopener" style={{ color: "#1a1a2e", fontWeight: 600 }}>BigQuery Console</a>. Select months and device type below — the SQL updates automatically. The most recent month's table may not be available yet.
            </div>

            {/* Origin + URL inputs */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Origin</label>
                <input type="text" value={bqOrigin} onChange={e => setBqOrigin(e.target.value)} placeholder="https://www.example.com"
                  style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono',monospace", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>URL <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(for bonus comparison query)</span></label>
                <input type="text" value={bqUrl} onChange={e => setBqUrl(e.target.value)} placeholder="https://www.example.com/page"
                  style={{ width: "100%", padding: "10px 14px", border: "1px solid #d0d0cc", borderRadius: 4, fontSize: 12, fontFamily: "'DM Mono',monospace", boxSizing: "border-box" }} />
              </div>
            </div>

            {/* Month selector */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Months to include</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {[
                  { label: "Last 3", fn: () => { const s = allMonths.slice(0, 3); setBqMonths(allMonths.map(m => ({ ...m, selected: s.some(l => l.year === m.year && l.month === m.month) }))); } },
                  { label: "Last 6", fn: () => { const s = allMonths.slice(0, 6); setBqMonths(allMonths.map(m => ({ ...m, selected: s.some(l => l.year === m.year && l.month === m.month) }))); } },
                  { label: "All 12", fn: () => setBqMonths(allMonths.map(m => ({ ...m, selected: true }))) },
                  { label: "Clear", fn: () => setBqMonths(allMonths.map(m => ({ ...m, selected: false }))) },
                ].map(preset => (
                  <button key={preset.label} onClick={preset.fn} style={{
                    padding: "5px 12px", fontSize: 11, fontWeight: 500,
                    background: "rgba(26,26,46,0.05)", color: "#1a1a2e",
                    border: "1px dashed #aaa", borderRadius: 12,
                    cursor: "pointer", fontFamily: "inherit",
                  }}>{preset.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {allMonths.map(({ year, month }) => {
                  const sel = isSelected(year, month);
                  const label = new Date(year, month).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
                  const isFuture = new Date(year, month) > now;
                  return (
                    <button key={`${year}-${month}`} onClick={() => toggleMonth(year, month)} style={{
                      padding: "6px 10px", fontSize: 11, fontWeight: sel ? 600 : 400,
                      background: sel ? "#1a1a2e" : "#fff",
                      color: sel ? "#fff" : isFuture ? "#ccc" : "#888",
                      border: `1px solid ${sel ? "#1a1a2e" : "#d0d0cc"}`,
                      borderRadius: 3, cursor: "pointer", fontFamily: "'DM Mono', monospace",
                      opacity: isFuture ? 0.5 : 1,
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>

            {/* Device selector */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", marginBottom: 6 }}>Device</label>
              <FormFactorSelect value={bqDevice} onChange={setBqDevice} options={BQ_DEVICES} />
            </div>

            {selectedMonths.length === 0 ? (
              <div style={{ background: "#f5f5f3", borderRadius: 6, padding: "32px 20px", textAlign: "center", color: "#888", fontSize: 13 }}>Select at least one month to generate the query.</div>
            ) : (
              <CopyBlock text={sql} copied={copied.bq} onCopy={() => copy(sql, "bq")} maxHeight={600} />
            )}

            <div style={{ background: "rgba(212,140,0,0.06)", border: "1px solid rgba(212,140,0,0.2)", borderRadius: 6, padding: "12px 16px", fontSize: 12, color: "#666", lineHeight: 1.7 }}>
              <strong style={{ color: "#d48c00" }}>Comparing sources:</strong> PSI = live 28-day snapshot. CrUX History = weekly over 40 weeks (best for pinpointing the regression). BigQuery = monthly (best for month-over-month + slicing by country/connection). If INP was already poor before March 27 across all sources, the issue predates the core update.
            </div>
          </div>
          );
        })()}
      </div>
    </div>
  );
}
