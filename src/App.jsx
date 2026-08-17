import { useState, useEffect, useCallback, useMemo } from "react";
import { storage } from "./storage";

const BRANDS = ["LBKK", "SB", "TRD"];
const BRAND_LABEL = { LBKK: "LBKK", SB: "SB", TRD: "TRD" };
const BRAND_COLOR = { LBKK: "#E2572B", SB: "#2FB8A6", TRD: "#C9A227" };
const DEFAULT_MASTER_PASSWORD = "admin123";
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const fmtNum = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : (0).toFixed(d));
const pad2 = (n) => String(n).padStart(2, "0");
const isWastage = (e) => !e.type || e.type === "wastage";
const isProduction = (e) => e.type === "production";
const isPurchase = (e) => e.type === "purchase";
const isSale = (e) => e.type === "sale";

// Sales are meant to be one running total per outlet per day (correctable by
// re-entering), not itemized transactions — so when several sale entries
// exist for the same date, only the most recently logged one counts.
function dedupeSalesByDate(entries) {
  const byDate = {};
  entries.filter(isSale).forEach((e) => {
    if (!byDate[e.date] || e.loggedAt > byDate[e.date].loggedAt) byDate[e.date] = e;
  });
  return Object.values(byDate);
}

function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayStr();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    cells.push({ day: d, dateStr, isFuture: dateStr > today, isToday: dateStr === today });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const last = weeks[weeks.length - 1];
  while (last.length < 7) last.push(null);
  return weeks;
}

function heatColor(value, max) {
  if (!value || value <= 0) return "#FFFFFF";
  const ratio = Math.min(1, value / (max || 1));
  const steps = [0.18, 0.4, 0.65, 1];
  const idx = steps.findIndex((s) => ratio <= s);
  const opacity = [0.28, 0.5, 0.72, 1][idx === -1 ? 3 : idx];
  return `rgba(226,87,43,${opacity})`;
}

export default function WastageTracker() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [config, setConfig] = useState({
    outlets: [],
    items: { LBKK: [], SB: [], TRD: [] },
    purchaseItems: { LBKK: [], SB: [], TRD: [] },
    currency: "₹",
    masterPassword: DEFAULT_MASTER_PASSWORD,
  });
  const [entriesByOutlet, setEntriesByOutlet] = useState({});

  // role is fixed for the lifetime of the session based on the link used
  const [role] = useState(() => {
    try {
      const h = window.location.hash.replace("#", "").toLowerCase();
      if (h === "outlet" || h === "management") return h;
    } catch (e) {}
    return null;
  });

  const [mode, setMode] = useState(role === "outlet" ? "entry-auth" : role === "management" ? "management-menu" : "landing");
  const [authedOutletId, setAuthedOutletId] = useState(null);
  const [range, setRange] = useState("30d");
  const [dashboardTab, setDashboardTab] = useState("wastage");
  const [customFrom, setCustomFrom] = useState(todayStr());
  const [customTo, setCustomTo] = useState(todayStr());
  const [selectedOutletId, setSelectedOutletId] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [saving, setSaving] = useState(false);

  // ---------- storage helpers ----------
  const loadConfig = useCallback(async () => {
    try {
      const res = await storage.get("config");
      if (res && res.value) {
        const parsed = JSON.parse(res.value);
        return {
          outlets: parsed.outlets || [],
          items: parsed.items || { LBKK: [], SB: [], TRD: [] },
          purchaseItems: parsed.purchaseItems || { LBKK: [], SB: [], TRD: [] },
          currency: parsed.currency || "₹",
          masterPassword: parsed.masterPassword || DEFAULT_MASTER_PASSWORD,
        };
      }
    } catch (e) {
      /* not found yet */
    }
    return {
      outlets: [],
      items: { LBKK: [], SB: [], TRD: [] },
      purchaseItems: { LBKK: [], SB: [], TRD: [] },
      currency: "₹",
      masterPassword: DEFAULT_MASTER_PASSWORD,
    };
  }, []);

  const saveConfig = useCallback(async (next) => {
    setConfig(next);
    setSaving(true);
    try {
      await storage.set("config", JSON.stringify(next));
    } catch (e) {
      setError("Couldn't save settings. Try again.");
    } finally {
      setSaving(false);
    }
  }, []);

  const loadEntries = useCallback(async (outletId) => {
    try {
      const res = await storage.get(`entries:${outletId}`);
      if (res && res.value) return JSON.parse(res.value);
    } catch (e) {
      /* none yet */
    }
    return [];
  }, []);

  const loadAllEntries = useCallback(async (outlets) => {
    const map = {};
    await Promise.all(
      outlets.map(async (o) => {
        map[o.id] = await loadEntries(o.id);
      })
    );
    setEntriesByOutlet(map);
    setLastSync(new Date());
  }, [loadEntries]);

  const refreshAll = useCallback(async () => {
    const cfg = await loadConfig();
    setConfig(cfg);
    await loadAllEntries(cfg.outlets);
    setReady(true);
  }, [loadConfig, loadAllEntries]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    if (mode !== "dashboard" && mode !== "outlet-detail") return;
    const id = setInterval(() => {
      loadAllEntries(config.outlets);
    }, 6000);
    return () => clearInterval(id);
  }, [mode, config.outlets, loadAllEntries]);

  // ---------- outlet / item mutations (nothing here ever deletes wastage history) ----------
  const addOutlet = async (name, password, brand) => {
    if (!name.trim() || !password.trim()) return;
    const next = {
      ...config,
      outlets: [...config.outlets, { id: uid(), name: name.trim(), password: password.trim(), brand: brand || "" }],
    };
    await saveConfig(next);
  };

  const removeOutlet = async (id) => {
    // Removed from the active list only. Its logged entries stay in storage permanently.
    const next = { ...config, outlets: config.outlets.filter((o) => o.id !== id) };
    await saveConfig(next);
  };

  const updateOutletPassword = async (id, password) => {
    const next = { ...config, outlets: config.outlets.map((o) => (o.id === id ? { ...o, password } : o)) };
    await saveConfig(next);
  };

  const updateOutletBrand = async (id, brand) => {
    const next = { ...config, outlets: config.outlets.map((o) => (o.id === id ? { ...o, brand } : o)) };
    await saveConfig(next);
  };

  const addItem = async (brand, item) => {
    const next = {
      ...config,
      items: { ...config.items, [brand]: [...(config.items[brand] || []), { id: uid(), ...item }] },
    };
    await saveConfig(next);
  };

  const removeItem = async (brand, id) => {
    // Removed from the master list only; any past entries keep their logged item name/value untouched.
    const next = { ...config, items: { ...config.items, [brand]: config.items[brand].filter((i) => i.id !== id) } };
    await saveConfig(next);
  };

  const updateItem = async (brand, id, patch) => {
    const next = {
      ...config,
      items: { ...config.items, [brand]: config.items[brand].map((i) => (i.id === id ? { ...i, ...patch } : i)) },
    };
    await saveConfig(next);
  };

  const addPurchaseItem = async (brand, item) => {
    const next = {
      ...config,
      purchaseItems: { ...config.purchaseItems, [brand]: [...(config.purchaseItems[brand] || []), { id: uid(), ...item }] },
    };
    await saveConfig(next);
  };

  const removePurchaseItem = async (brand, id) => {
    const next = {
      ...config,
      purchaseItems: { ...config.purchaseItems, [brand]: config.purchaseItems[brand].filter((i) => i.id !== id) },
    };
    await saveConfig(next);
  };

  const updatePurchaseItem = async (brand, id, patch) => {
    const next = {
      ...config,
      purchaseItems: { ...config.purchaseItems, [brand]: config.purchaseItems[brand].map((i) => (i.id === id ? { ...i, ...patch } : i)) },
    };
    await saveConfig(next);
  };

  const setCurrency = async (currency) => {
    await saveConfig({ ...config, currency });
  };

  const setMasterPassword = async (pw) => {
    if (!pw.trim()) return;
    await saveConfig({ ...config, masterPassword: pw.trim() });
  };

  const exportBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      config,
      entriesByOutlet,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `culex-wastage-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const logEntries = async (outletId, date, rows) => {
    const current = entriesByOutlet[outletId] || (await loadEntries(outletId));
    const newEntries = rows
      .filter((r) => r.qty && Number(r.qty) > 0)
      .map((r) => ({
        id: uid(),
        date,
        type: r.type || "wastage",
        brand: r.brand,
        itemId: r.itemId,
        itemName: r.itemName,
        unit: r.unit,
        qty: Number(r.qty),
        price: Number(r.price),
        value: Number(r.qty) * Number(r.price),
        loggedAt: new Date().toISOString(),
      }));
    if (newEntries.length === 0) return { count: 0 };
    // append-only: past entries for other dates are never touched or removed
    const updated = [...current, ...newEntries];
    setEntriesByOutlet((m) => ({ ...m, [outletId]: updated }));
    try {
      await storage.set(`entries:${outletId}`, JSON.stringify(updated));
    } catch (e) {
      setError("Couldn't save the log. Try again.");
    }
    return { count: newEntries.length };
  };

  // ---------- derived data ----------
  const rangeStart = useMemo(() => {
    if (range === "today") return todayStr();
    if (range === "7d") {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return d.toISOString().slice(0, 10);
    }
    if (range === "30d") {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return d.toISOString().slice(0, 10);
    }
    if (range === "custom") return customFrom;
    return null;
  }, [range, customFrom]);

  const rangeEnd = useMemo(() => {
    if (range === "custom") return customTo;
    return null;
  }, [range, customTo]);

  const outletStats = useMemo(() => {
    return config.outlets.map((o) => {
      const all = (entriesByOutlet[o.id] || []).filter(isWastage);
      let filtered = rangeStart ? all.filter((e) => e.date >= rangeStart) : all;
      if (rangeEnd) filtered = filtered.filter((e) => e.date <= rangeEnd);
      const totalValue = filtered.reduce((s, e) => s + e.value, 0);
      const kg = filtered.filter((e) => e.unit === "kg").reduce((s, e) => s + e.qty, 0);
      const ltr = filtered.filter((e) => e.unit === "ltr").reduce((s, e) => s + e.qty, 0);
      const itemMap = {};
      filtered.forEach((e) => {
        const key = `${e.itemName}::${e.unit}`;
        if (!itemMap[key]) itemMap[key] = { itemName: e.itemName, unit: e.unit, value: 0, qty: 0 };
        itemMap[key].value += e.value;
        itemMap[key].qty += e.qty;
      });
      const topItems = Object.values(itemMap)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
      return { outlet: o, count: filtered.length, totalValue, kg, ltr, topItems };
    });
  }, [config.outlets, entriesByOutlet, rangeStart, rangeEnd]);

  const grandTotal = outletStats.reduce((s, o) => s + o.totalValue, 0);
  const maxTotal = Math.max(1, ...outletStats.map((o) => o.totalValue));
  const worstOutlet = outletStats.slice().sort((a, b) => b.totalValue - a.totalValue)[0];
  const authedOutlet = config.outlets.find((o) => o.id === authedOutletId);
  const selectedOutlet = config.outlets.find((o) => o.id === selectedOutletId);

  const goHome = () => {
    setAuthedOutletId(null);
    if (role === "outlet") setMode("entry-auth");
    else if (role === "management") setMode("management-menu");
    else setMode("landing");
  };

  return (
    <div style={styles.app}>
      <style>{css}</style>
      <div style={styles.scanline} />
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>DAILY LOSS CONTROL{role ? ` · ${role.toUpperCase()} LINK` : ""}</div>
          <h1 style={styles.h1}>Culex Wastage</h1>
          <div style={styles.credit}>by Asif</div>
        </div>
        <div style={styles.headerRight}>
          {(mode === "dashboard" || mode === "outlet-detail") && (
            <div style={styles.liveTag}>
              <span style={styles.liveDot} className="pulse" />
              {lastSync ? `synced ${lastSync.toLocaleTimeString()}` : "syncing…"}
            </div>
          )}
          {(mode === "entry" || mode === "settings") && (
            <div style={styles.sessionTag}>
              {mode === "entry" ? `Outlet: ${authedOutlet?.name || ""}` : "Admin session"}
              {mode === "settings" && (
                <button style={styles.logoutBtn} onClick={() => setMode("dashboard")}>
                  Dashboard
                </button>
              )}
              <button style={styles.logoutBtn} onClick={goHome}>
                Log out
              </button>
            </div>
          )}
          {mode === "outlet-detail" && (
            <button style={styles.logoutBtn} onClick={() => setMode("dashboard")}>
              ← Dashboard
            </button>
          )}
          {mode === "dashboard" && (
            <button style={styles.logoutBtn} onClick={() => setMode("settings-auth")}>
              Settings
            </button>
          )}
          {(mode === "dashboard" || mode === "settings-auth") && (
            <button style={styles.logoutBtn} onClick={() => setMode("management-menu")}>
              ← Menu
            </button>
          )}
          {mode === "management-menu" && !role && (
            <button style={styles.logoutBtn} onClick={() => setMode("landing")}>
              ← Menu
            </button>
          )}
        </div>
      </header>

      {error && (
        <div style={styles.errorBar}>
          {error}
          <button onClick={() => setError("")} style={styles.errorClose}>
            ×
          </button>
        </div>
      )}

      {!ready ? (
        <div style={styles.loading}>Loading log…</div>
      ) : mode === "landing" ? (
        <Landing onPick={setMode} />
      ) : mode === "management-menu" ? (
        <ManagementMenu onPick={setMode} />
      ) : mode === "dashboard" ? (
        <Dashboard
          config={config}
          outletStats={outletStats}
          grandTotal={grandTotal}
          maxTotal={maxTotal}
          worstOutlet={worstOutlet}
          range={range}
          setRange={setRange}
          customFrom={customFrom}
          setCustomFrom={setCustomFrom}
          customTo={customTo}
          setCustomTo={setCustomTo}
          entriesByOutlet={entriesByOutlet}
          dashboardTab={dashboardTab}
          setDashboardTab={setDashboardTab}
          onRefresh={() => loadAllEntries(config.outlets)}
          onOpenOutlet={(id) => {
            setSelectedOutletId(id);
            setMode("outlet-detail");
          }}
        />
      ) : mode === "outlet-detail" ? (
        <OutletDetail
          outlet={selectedOutlet}
          entries={entriesByOutlet[selectedOutletId] || []}
          currency={config.currency}
        />
      ) : mode === "entry-auth" ? (
        <PasswordGate
          title="Outlet Entry"
          subtitle="Enter your outlet's password to log today's wastage."
          onSubmit={(pw) => {
            const match = config.outlets.find((o) => o.password === pw);
            if (match) {
              setAuthedOutletId(match.id);
              setMode("entry");
            } else {
              setError("That password doesn't match any outlet.");
            }
          }}
          showBack={!role}
          onBack={() => setMode("landing")}
        />
      ) : mode === "entry" ? (
        <EntryForm config={config} outlet={authedOutlet} onLog={logEntries} entriesByOutlet={entriesByOutlet} />
      ) : mode === "settings-auth" ? (
        <PasswordGate
          title="Settings"
          subtitle="Master password required."
          onSubmit={(pw) => {
            if (pw === config.masterPassword) {
              setMode("settings");
            } else {
              setError("Incorrect master password.");
            }
          }}
          showBack={true}
          onBack={() => setMode("management-menu")}
        />
      ) : (
        <Settings
          config={config}
          saving={saving}
          onAddOutlet={addOutlet}
          onRemoveOutlet={removeOutlet}
          onUpdateOutletPassword={updateOutletPassword}
          onUpdateOutletBrand={updateOutletBrand}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onUpdateItem={updateItem}
          onAddPurchaseItem={addPurchaseItem}
          onRemovePurchaseItem={removePurchaseItem}
          onUpdatePurchaseItem={updatePurchaseItem}
          onSetCurrency={setCurrency}
          onSetMasterPassword={setMasterPassword}
          onExportBackup={exportBackup}
          entriesByOutlet={entriesByOutlet}
        />
      )}
    </div>
  );
}

function Landing({ onPick }) {
  return (
    <div style={styles.landingGrid}>
      <button style={styles.landingCard} onClick={() => onPick("entry-auth")}>
        <div style={styles.landingEyebrow}>Outlet password</div>
        <div style={styles.landingTitle}>Log Wastage</div>
        <div style={styles.landingBody}>Outlets enter their password to log today's wastage.</div>
      </button>
      <button style={styles.landingCard} onClick={() => onPick("management-menu")}>
        <div style={styles.landingEyebrow}>Management</div>
        <div style={styles.landingTitle}>Management Access</div>
        <div style={styles.landingBody}>Dashboard and settings for admins and management only.</div>
      </button>
    </div>
  );
}

function ManagementMenu({ onPick }) {
  return (
    <div style={styles.landingGrid}>
      <button style={styles.landingCard} onClick={() => onPick("dashboard")}>
        <div style={styles.landingEyebrow}>No password</div>
        <div style={styles.landingTitle}>Dashboard</div>
        <div style={styles.landingBody}>Live wastage totals and calendar reports, per outlet.</div>
      </button>
      <button style={styles.landingCard} onClick={() => onPick("settings-auth")}>
        <div style={styles.landingEyebrow}>Master password</div>
        <div style={styles.landingTitle}>Settings</div>
        <div style={styles.landingBody}>Manage outlets, items, prices and passwords.</div>
      </button>
    </div>
  );
}

function PasswordGate({ title, subtitle, onSubmit, onBack, showBack }) {
  const [pw, setPw] = useState("");
  return (
    <div style={styles.gateWrap}>
      <div style={styles.gateBox}>
        <div style={styles.gateTitle}>{title}</div>
        <div style={styles.gateSubtitle}>{subtitle}</div>
        <input
          type="password"
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit(pw)}
          placeholder="Password"
          style={styles.gateInput}
        />
        <div style={styles.gateBtnRow}>
          {showBack && (
            <button style={styles.gateBack} onClick={onBack}>
              Back
            </button>
          )}
          <button style={styles.gateSubmit} onClick={() => onSubmit(pw)}>
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Management: Dashboard ----------------

function Dashboard({ config, outletStats, grandTotal, maxTotal, worstOutlet, range, setRange, customFrom, setCustomFrom, customTo, setCustomTo, entriesByOutlet, dashboardTab, setDashboardTab, onRefresh, onOpenOutlet }) {
  if (config.outlets.length === 0) {
    return <EmptyState title="No outlets yet" body="Outlets are added in Settings before wastage can be reported." />;
  }
  return (
    <div>
      <div style={styles.dashboardTabRow}>
        <select style={styles.dashboardTabSelect} value={dashboardTab} onChange={(e) => setDashboardTab(e.target.value)}>
          <option value="wastage">📉 Wastage report</option>
          <option value="purchase">🧾 Purchase vs Sales report</option>
        </select>
      </div>

      {dashboardTab === "purchase" ? (
        <PurchaseReport config={config} entriesByOutlet={entriesByOutlet} />
      ) : (
        <>
          <div style={styles.toolbar}>
            <div style={styles.rangeGroup}>
              {[
                ["today", "Today"],
                ["7d", "7 Days"],
                ["30d", "30 Days"],
                ["all", "All Time"],
                ["custom", "Custom"],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  style={{ ...styles.rangeBtn, ...(range === k ? styles.rangeBtnActive : {}) }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button style={styles.refreshBtn} onClick={onRefresh}>
              ⟳ Refresh
            </button>
          </div>

          {range === "custom" && (
            <div style={styles.customRangeBar}>
              <label style={styles.customRangeField}>
                From
                <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} style={styles.select} />
              </label>
              <label style={styles.customRangeField}>
                To
                <input type="date" value={customTo} min={customFrom} max={todayStr()} onChange={(e) => setCustomTo(e.target.value)} style={styles.select} />
              </label>
              <label style={styles.customRangeField}>
                Or pick a whole month
                <input
                  type="month"
                  value={customFrom.slice(0, 7)}
                  onChange={(e) => {
                    const [y, m] = e.target.value.split("-").map(Number);
                    const first = `${e.target.value}-01`;
                    const last = new Date(y, m, 0).toISOString().slice(0, 10);
                    setCustomFrom(first);
                    setCustomTo(last > todayStr() ? todayStr() : last);
                  }}
                  style={styles.select}
                />
              </label>
            </div>
          )}

          <div style={styles.summaryStrip}>
            <SummaryCell label="Total wastage value" value={`${config.currency}${fmtNum(grandTotal)}`} accent="#E2572B" />
            <SummaryCell label="Outlets reporting" value={`${outletStats.filter((o) => o.count > 0).length} / ${outletStats.length}`} />
            <SummaryCell
              label="Highest loss"
              value={worstOutlet && worstOutlet.totalValue > 0 ? worstOutlet.outlet.name : "—"}
              sub={worstOutlet && worstOutlet.totalValue > 0 ? `${config.currency}${fmtNum(worstOutlet.totalValue)}` : ""}
              accent="#C9A227"
            />
          </div>

          <div style={styles.cardGrid}>
            {outletStats
              .slice()
              .sort((a, b) => b.totalValue - a.totalValue)
              .map((s) => (
                <OutletCard key={s.outlet.id} stat={s} currency={config.currency} maxTotal={maxTotal} onOpen={() => onOpenOutlet(s.outlet.id)} />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCell({ label, value, sub, accent }) {
  return (
    <div style={styles.summaryCell}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={{ ...styles.summaryValue, color: accent || "#1B1F24" }}>{value}</div>
      {sub && <div style={styles.summarySub}>{sub}</div>}
    </div>
  );
}

function monthBounds(offsetFromCurrent) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offsetFromCurrent);
  const y = d.getFullYear();
  const m = d.getMonth();
  const first = `${y}-${pad2(m + 1)}-01`;
  const lastDayNum = new Date(y, m + 1, 0).getDate();
  const last = `${y}-${pad2(m + 1)}-${pad2(lastDayNum)}`;
  return { from: first, to: last > todayStr() ? todayStr() : last };
}

function PurchaseReport({ config, entriesByOutlet }) {
  const [periodA, setPeriodA] = useState(monthBounds(0));
  const [periodB, setPeriodB] = useState(monthBounds(-1));

  const allEntries = useMemo(() => Object.values(entriesByOutlet).flat(), [entriesByOutlet]);

  const totalsFor = (from, to) => {
    const inRange = (e) => e.date >= from && e.date <= to;
    const purchase = allEntries.filter((e) => isPurchase(e) && inRange(e)).reduce((s, e) => s + e.value, 0);
    const sales = dedupeSalesByDate(allEntries.filter(inRange)).reduce((s, e) => s + e.value, 0);
    return { purchase, sales, diff: sales - purchase };
  };

  const totalsA = totalsFor(periodA.from, periodA.to);
  const totalsB = totalsFor(periodB.from, periodB.to);
  const pctChange = (a, b) => (b === 0 ? null : ((a - b) / b) * 100);

  const outletBreakdown = useMemo(() => {
    return config.outlets.map((o) => {
      const entries = (entriesByOutlet[o.id] || []).filter((e) => e.date >= periodA.from && e.date <= periodA.to);
      const purchase = entries.filter(isPurchase).reduce((s, e) => s + e.value, 0);
      const sales = dedupeSalesByDate(entries).reduce((s, e) => s + e.value, 0);
      return { outlet: o, purchase, sales, diff: sales - purchase };
    });
  }, [config.outlets, entriesByOutlet, periodA]);

  const PeriodPicker = ({ label, period, setPeriod }) => (
    <div style={styles.periodCard}>
      <div style={styles.periodLabel}>{label}</div>
      <div style={styles.customRangeBar}>
        <label style={styles.customRangeField}>
          From
          <input type="date" value={period.from} max={period.to} onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} style={styles.select} />
        </label>
        <label style={styles.customRangeField}>
          To
          <input type="date" value={period.to} min={period.from} max={todayStr()} onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} style={styles.select} />
        </label>
        <label style={styles.customRangeField}>
          Or pick a month
          <input
            type="month"
            value={period.from.slice(0, 7)}
            onChange={(e) => {
              const [y, m] = e.target.value.split("-").map(Number);
              const last = new Date(y, m, 0).toISOString().slice(0, 10);
              setPeriod({ from: `${e.target.value}-01`, to: last > todayStr() ? todayStr() : last });
            }}
            style={styles.select}
          />
        </label>
      </div>
    </div>
  );

  return (
    <div>
      <div style={styles.periodGrid} className="periodGrid">
        <PeriodPicker label="Period A" period={periodA} setPeriod={setPeriodA} />
        <PeriodPicker label="Period B (compare against)" period={periodB} setPeriod={setPeriodB} />
      </div>

      <div style={styles.comparisonGrid} className="comparisonGrid">
        <ComparisonBlock label="Period A" period={periodA} totals={totalsA} currency={config.currency} />
        <ComparisonBlock
          label="Period B"
          period={periodB}
          totals={totalsB}
          currency={config.currency}
          changeVsA={{ purchase: pctChange(totalsA.purchase, totalsB.purchase), sales: pctChange(totalsA.sales, totalsB.sales) }}
        />
      </div>

      <div style={{ ...styles.panelTitle, marginTop: 28 }}>Per outlet — Period A ({periodA.from} to {periodA.to})</div>
      {outletBreakdown.every((o) => o.purchase === 0 && o.sales === 0) ? (
        <EmptyState title="No purchase or sales logged yet" body="Once outlets log purchases and daily sales, this breakdown fills in." small />
      ) : (
        <div style={styles.itemTotalsTable}>
          <div style={{ ...styles.itemTotalsHeadRowWide, gridTemplateColumns: "1.6fr 70px 1fr 1fr 1fr" }}>
            <span>Outlet</span>
            <span>Brand</span>
            <span style={{ textAlign: "right" }}>Purchase</span>
            <span style={{ textAlign: "right" }}>Sales</span>
            <span style={{ textAlign: "right" }}>Difference</span>
          </div>
          {outletBreakdown
            .slice()
            .sort((a, b) => b.sales - a.sales)
            .map((o) => (
              <div key={o.outlet.id} style={{ ...styles.itemTotalsRowWide, gridTemplateColumns: "1.6fr 70px 1fr 1fr 1fr" }}>
                <span>{o.outlet.name}</span>
                <span style={{ color: BRAND_COLOR[o.outlet.brand] || "#5B6472" }}>{o.outlet.brand || "—"}</span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#E2572B" }}>
                  {config.currency}
                  {fmtNum(o.purchase)}
                </span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#2FB8A6" }}>
                  {config.currency}
                  {fmtNum(o.sales)}
                </span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: o.diff >= 0 ? "#2FB8A6" : "#E2572B" }}>
                  {o.diff >= 0 ? "+" : ""}
                  {config.currency}
                  {fmtNum(o.diff)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ComparisonBlock({ label, period, totals, currency, changeVsA }) {
  return (
    <div style={styles.comparisonBlock}>
      <div style={styles.periodLabel}>
        {label} <span style={{ color: "#8B92A0", fontWeight: 400 }}>({period.from} to {period.to})</span>
      </div>
      <div style={styles.summaryStrip}>
        <SummaryCell label="Purchase amount" value={`${currency}${fmtNum(totals.purchase)}`} accent="#E2572B" sub={changeVsA ? pctLabel(changeVsA.purchase) : undefined} />
        <SummaryCell label="Sales amount" value={`${currency}${fmtNum(totals.sales)}`} accent="#2FB8A6" sub={changeVsA ? pctLabel(changeVsA.sales) : undefined} />
        <SummaryCell label="Difference" value={`${totals.diff >= 0 ? "+" : ""}${currency}${fmtNum(totals.diff)}`} accent={totals.diff >= 0 ? "#2FB8A6" : "#E2572B"} />
      </div>
    </div>
  );
}

function pctLabel(pct) {
  if (pct === null) return "vs A: n/a";
  const sign = pct >= 0 ? "+" : "";
  return `vs A: ${sign}${fmtNum(pct, 1)}%`;
}

function OutletCard({ stat, currency, maxTotal, onOpen }) {
  const { outlet, totalValue, kg, ltr, count, topItems } = stat;
  const pct = Math.min(100, (totalValue / maxTotal) * 100);
  return (
    <button style={styles.docket} onClick={onOpen}>
      <div style={styles.docketPerf} />
      <div style={styles.docketHead}>
        <div style={styles.docketName}>{outlet.name}</div>
        <div style={styles.docketCount}>{count} log{count === 1 ? "" : "s"}</div>
      </div>
      {outlet.brand && (
        <div style={styles.docketBrandTag}>
          <span style={{ ...styles.brandDot, background: BRAND_COLOR[outlet.brand] }} />
          {outlet.brand}
        </div>
      )}
      <div style={styles.docketValue}>
        {currency}
        {fmtNum(totalValue)}
      </div>
      <div style={styles.gaugeTrack}>
        <div style={{ ...styles.gaugeFill, width: `${pct}%` }} />
      </div>
      <div style={styles.docketMeta}>
        <span>{fmtNum(kg)} kg</span>
        <span>·</span>
        <span>{fmtNum(ltr)} ltr</span>
      </div>
      <div style={styles.brandRow}>
        <div style={styles.topItemsLabel}>Highest wastage items</div>
        {topItems.length === 0 ? (
          <div style={styles.mutedNote}>Nothing logged in this range.</div>
        ) : (
          topItems.map((it, i) => (
            <div key={i} style={styles.brandChip}>
              <span style={styles.topItemRank}>{i + 1}</span>
              <span style={styles.brandChipLabel}>{it.itemName}</span>
              <span style={styles.brandChipValue}>
                {currency}
                {fmtNum(it.value)}
              </span>
            </div>
          ))
        )}
      </div>
      <div style={styles.docketHint}>View calendar report →</div>
    </button>
  );
}

// ---------------- Management: Outlet detail (calendar report) ----------------

function OutletDetail({ outlet, entries, currency }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDate, setSelectedDate] = useState(null);

  if (!outlet) return <EmptyState title="Outlet not found" body="Go back and pick an outlet from the dashboard." />;

  const dayTotals = useMemo(() => {
    const map = {};
    entries.filter(isWastage).forEach((e) => {
      map[e.date] = (map[e.date] || 0) + e.value;
    });
    return map;
  }, [entries]);

  const maxDay = Math.max(1, ...Object.values(dayTotals));
  const weeks = monthMatrix(cursor.y, cursor.m);

  const monthPrefix = `${cursor.y}-${pad2(cursor.m + 1)}`;
  const monthEntries = useMemo(() => entries.filter((e) => e.date.startsWith(monthPrefix)), [entries, monthPrefix]);

  const itemTotals = useMemo(() => {
    const map = {};
    monthEntries.filter((e) => isWastage(e) || isProduction(e)).forEach((e) => {
      const key = `${e.brand}::${e.itemName}::${e.unit}`;
      if (!map[key])
        map[key] = { brand: e.brand, itemName: e.itemName, unit: e.unit, producedQty: 0, wastedQty: 0, wastedValue: 0 };
      if (isProduction(e)) map[key].producedQty += e.qty;
      else map[key].wastedQty += e.qty, (map[key].wastedValue += e.value);
    });
    return Object.values(map).sort((a, b) => b.wastedValue - a.wastedValue);
  }, [monthEntries]);

  const monthProducedValue = monthEntries.filter(isProduction).reduce((s, e) => s + e.value, 0);
  const monthWastedValue = monthEntries.filter(isWastage).reduce((s, e) => s + e.value, 0);
  const overallWastePct = monthProducedValue > 0 ? (monthWastedValue / monthProducedValue) * 100 : null;

  const dayEntries = selectedDate ? entries.filter((e) => e.date === selectedDate) : [];
  const monthTotal = weeks.flat().reduce((s, c) => s + (c ? dayTotals[c.dateStr] || 0 : 0), 0);

  return (
    <div>
      <div style={styles.detailHeadRow}>
        <div>
          <div style={styles.eyebrow}>OUTLET REPORT</div>
          <h2 style={styles.h2}>{outlet.name}</h2>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={styles.summaryCell}>
            <div style={styles.summaryLabel}>{MONTH_NAMES[cursor.m]} produced</div>
            <div style={{ ...styles.summaryValue, color: "#2FB8A6" }}>
              {currency}
              {fmtNum(monthProducedValue)}
            </div>
          </div>
          <div style={styles.summaryCell}>
            <div style={styles.summaryLabel}>{MONTH_NAMES[cursor.m]} wasted</div>
            <div style={{ ...styles.summaryValue, color: "#E2572B" }}>
              {currency}
              {fmtNum(monthTotal)}
            </div>
          </div>
          <div style={styles.summaryCell}>
            <div style={styles.summaryLabel}>Waste %</div>
            <div style={{ ...styles.summaryValue, color: "#C9A227" }}>
              {overallWastePct === null ? "—" : `${fmtNum(overallWastePct, 1)}%`}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.calendarPanel}>
        <div style={styles.calendarNav}>
          <button style={styles.calNavBtn} onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}>
            ‹
          </button>
          <div style={styles.calendarTitle}>
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
          <button style={styles.calNavBtn} onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}>
            ›
          </button>
        </div>
        <div style={styles.calGridHead}>
          {WEEKDAYS.map((w, i) => (
            <div key={i} style={styles.calWeekday}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={styles.calGridRow}>
            {week.map((cell, di) =>
              cell ? (
                <button
                  key={di}
                  onClick={() => setSelectedDate(cell.dateStr)}
                  style={{
                    ...styles.calCell,
                    background: heatColor(dayTotals[cell.dateStr], maxDay),
                    border: cell.isToday ? "1px solid #1B1F24" : selectedDate === cell.dateStr ? "1px solid #2FB8A6" : "1px solid transparent",
                  }}
                >
                  <span style={styles.calDayNum}>{cell.day}</span>
                  {dayTotals[cell.dateStr] > 0 && (
                    <span style={styles.calDayVal}>
                      {currency}
                      {fmtNum(dayTotals[cell.dateStr], 0)}
                    </span>
                  )}
                </button>
              ) : (
                <div key={di} style={styles.calCellBlank} />
              )
            )}
          </div>
        ))}
      </div>

      {selectedDate && (
        <div style={styles.dayPanel}>
          <div style={styles.todayLogHead}>
            {selectedDate} {dayEntries.length === 0 && "— nothing logged"}
          </div>
          {dayEntries.map((e) => (
            <div key={e.id} style={styles.todayLogRow}>
              <span style={{ ...styles.brandDot, background: BRAND_COLOR[e.brand] }} />
              <span style={styles.todayLogItem}>{e.itemName}</span>
              <span style={styles.todayLogQty}>
                {fmtNum(e.qty)} {e.unit}
              </span>
              <span style={styles.todayLogVal}>
                {currency}
                {fmtNum(e.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...styles.panelTitle, marginTop: 28 }}>
        Production & wastage sheet — {MONTH_NAMES[cursor.m]} {cursor.y}
      </div>
      {itemTotals.length === 0 ? (
        <EmptyState title="Nothing logged yet" body="Once this outlet logs production or wastage, the sheet appears here." small />
      ) : (
        <div style={styles.itemTotalsTable}>
          <div style={styles.itemTotalsHeadRowWide}>
            <span>Item</span>
            <span>Brand</span>
            <span style={{ textAlign: "right" }}>Produced</span>
            <span style={{ textAlign: "right" }}>Wasted</span>
            <span style={{ textAlign: "right" }}>Waste %</span>
            <span style={{ textAlign: "right" }}>Value lost</span>
          </div>
          {itemTotals.map((it, i) => {
            const pct = it.producedQty > 0 ? (it.wastedQty / it.producedQty) * 100 : null;
            return (
              <div key={i} style={styles.itemTotalsRowWide}>
                <span>{it.itemName}</span>
                <span style={{ color: BRAND_COLOR[it.brand] }}>{it.brand}</span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#2FB8A6" }}>
                  {fmtNum(it.producedQty)} {it.unit}
                </span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                  {fmtNum(it.wastedQty)} {it.unit}
                </span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: pct !== null && pct > 15 ? "#E2572B" : "#5B6472" }}>
                  {pct === null ? "—" : `${fmtNum(pct, 1)}%`}
                </span>
                <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#E2572B" }}>
                  {currency}
                  {fmtNum(it.wastedValue)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Outlet: calendar entry ----------------

function EntryForm({ config, outlet, onLog, entriesByOutlet }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [brand, setBrand] = useState(outlet?.brand || "LBKK");
  const [qtys, setQtys] = useState({});
  const [prodQtys, setProdQtys] = useState({});
  const [status, setStatus] = useState("");
  const [openCategory, setOpenCategory] = useState(null);
  const [showSheet, setShowSheet] = useState(false);
  const [entryType, setEntryType] = useState("wastage");
  const [purchaseQtys, setPurchaseQtys] = useState({});
  const [purchaseTotals, setPurchaseTotals] = useState({});
  const [saleAmount, setSaleAmount] = useState("");
  const brandLocked = Boolean(outlet?.brand);

  if (!outlet) return <EmptyState title="Session error" body="Outlet not found. Please log out and try again." />;
  if (!outlet.brand) {
    return (
      <EmptyState
        title="No brand assigned yet"
        body={`${outlet.name} isn't linked to a brand yet, so it can't log wastage. Ask an admin to assign LBKK, SB, or TRD in Settings → Outlets & passwords.`}
      />
    );
  }

  const allEntries = entriesByOutlet[outlet.id] || [];
  const dayTotals = useMemo(() => {
    const map = {};
    allEntries.filter(isWastage).forEach((e) => {
      map[e.date] = (map[e.date] || 0) + e.value;
    });
    return map;
  }, [allEntries]);
  const maxDay = Math.max(1, ...Object.values(dayTotals));
  const weeks = monthMatrix(cursor.y, cursor.m);

  const items = config.items[brand] || [];
  const categories = useMemo(() => {
    const groups = {};
    items.forEach((it) => {
      const cat = it.category?.trim() || "General";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(it);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const todaysLogs = allEntries.filter((e) => e.date === selectedDate).sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1));
  const totalPreview = items.reduce((s, it) => s + (Number(qtys[it.id]) || 0) * it.price, 0);
  const categoryQtyCount = (catItems) => catItems.filter((it) => Number(qtys[it.id]) > 0 || Number(prodQtys[it.id]) > 0).length;

  const monthPrefix = `${cursor.y}-${pad2(cursor.m + 1)}`;
  const monthEntries = useMemo(() => allEntries.filter((e) => e.date.startsWith(monthPrefix)), [allEntries, monthPrefix]);
  const monthSheet = useMemo(() => {
    const map = {};
    monthEntries.filter((e) => isWastage(e) || isProduction(e)).forEach((e) => {
      const key = `${e.itemName}::${e.unit}`;
      if (!map[key]) map[key] = { itemName: e.itemName, unit: e.unit, producedQty: 0, wastedQty: 0, wastedValue: 0 };
      if (isProduction(e)) map[key].producedQty += e.qty;
      else map[key].wastedQty += e.qty, (map[key].wastedValue += e.value);
    });
    return Object.values(map).sort((a, b) => b.wastedValue - a.wastedValue);
  }, [monthEntries]);

  const monthPurchaseTotal = monthEntries.filter(isPurchase).reduce((s, e) => s + e.value, 0);
  const monthSaleTotal = dedupeSalesByDate(monthEntries).reduce((s, e) => s + e.value, 0);

  const submit = async () => {
    const rows = [
      ...items.map((it) => ({
        type: "wastage",
        brand,
        itemId: it.id,
        itemName: it.name,
        unit: it.unit,
        qty: qtys[it.id],
        price: it.price,
      })),
      ...items.map((it) => ({
        type: "production",
        brand,
        itemId: it.id,
        itemName: it.name,
        unit: it.unit,
        qty: prodQtys[it.id],
        price: it.price,
      })),
    ];
    const res = await onLog(outlet.id, selectedDate, rows);
    if (res.count > 0) {
      setQtys({});
      setProdQtys({});
      setStatus(`Logged ${res.count} entr${res.count === 1 ? "y" : "ies"} for ${selectedDate} · ${BRAND_LABEL[brand]}`);
      setTimeout(() => setStatus(""), 3500);
    } else {
      setStatus("Enter a produced or wasted quantity for at least one item.");
      setTimeout(() => setStatus(""), 3500);
    }
  };

  const purchaseItems = config.purchaseItems?.[brand] || [];
  const todaysSaleEntry = dedupeSalesByDate(allEntries.filter((e) => e.date === selectedDate))[0];

  const submitPurchase = async () => {
    const rows = purchaseItems
      .filter((it) => Number(purchaseQtys[it.id]) > 0 && Number(purchaseTotals[it.id]) > 0)
      .map((it) => {
        const qty = Number(purchaseQtys[it.id]);
        const total = Number(purchaseTotals[it.id]);
        return {
          type: "purchase",
          brand,
          itemId: it.id,
          itemName: it.name,
          unit: it.unit,
          qty,
          price: total / qty,
        };
      });
    const res = await onLog(outlet.id, selectedDate, rows);
    if (res.count > 0) {
      setPurchaseQtys({});
      setPurchaseTotals({});
      setStatus(`Logged ${res.count} purchase${res.count === 1 ? "" : "s"} for ${selectedDate}`);
      setTimeout(() => setStatus(""), 3500);
    } else {
      setStatus("Enter both a quantity and total price for at least one item.");
      setTimeout(() => setStatus(""), 3500);
    }
  };

  const submitSale = async () => {
    const amount = Number(saleAmount);
    if (!amount || amount <= 0) {
      setStatus("Enter a sales amount greater than 0.");
      setTimeout(() => setStatus(""), 3500);
      return;
    }
    const res = await onLog(outlet.id, selectedDate, [
      { type: "sale", brand, itemId: "sale", itemName: "Daily Sales", unit: "", qty: 1, price: amount },
    ]);
    if (res.count > 0) {
      setSaleAmount("");
      setStatus(`Logged sales of ${config.currency}${fmtNum(amount)} for ${selectedDate}`);
      setTimeout(() => setStatus(""), 3500);
    }
  };

  return (
    <div>
      <div style={styles.calendarPanel}>
        <div style={styles.calendarNav}>
          <button style={styles.calNavBtn} onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}>
            ‹
          </button>
          <div style={styles.calendarTitle}>
            {MONTH_NAMES[cursor.m]} {cursor.y}
          </div>
          <button style={styles.calNavBtn} onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}>
            ›
          </button>
        </div>
        <div style={styles.calGridHead}>
          {WEEKDAYS.map((w, i) => (
            <div key={i} style={styles.calWeekday}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} style={styles.calGridRow}>
            {week.map((cell, di) =>
              cell ? (
                <button
                  key={di}
                  disabled={cell.isFuture}
                  onClick={() => setSelectedDate(cell.dateStr)}
                  style={{
                    ...styles.calCell,
                    background: heatColor(dayTotals[cell.dateStr], maxDay),
                    opacity: cell.isFuture ? 0.3 : 1,
                    cursor: cell.isFuture ? "not-allowed" : "pointer",
                    border:
                      selectedDate === cell.dateStr
                        ? "1px solid #2FB8A6"
                        : cell.isToday
                        ? "1px solid #1B1F24"
                        : "1px solid transparent",
                  }}
                >
                  <span style={styles.calDayNum}>{cell.day}</span>
                  {dayTotals[cell.dateStr] > 0 && (
                    <span style={styles.calDayVal}>
                      {config.currency}
                      {fmtNum(dayTotals[cell.dateStr], 0)}
                    </span>
                  )}
                </button>
              ) : (
                <div key={di} style={styles.calCellBlank} />
              )
            )}
          </div>
        ))}
      </div>

      <div style={styles.entryDateBanner}>
        Logging for <b>{selectedDate}</b>{selectedDate === todayStr() ? " (today)" : ""}
      </div>

      <div style={styles.entryTypeTabs}>
        {[
          ["wastage", "Wastage"],
          ["purchase", "Purchase"],
          ["sale", "Sale"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setEntryType(k)}
            style={{ ...styles.entryTypeTab, ...(entryType === k ? styles.entryTypeTabActive : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {brandLocked ? (
        <div style={styles.brandLockedTag}>
          <span style={{ ...styles.brandDot, background: BRAND_COLOR[brand] }} />
          {BRAND_LABEL[brand]}
        </div>
      ) : (
        <div style={styles.brandTabs}>
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => {
                setBrand(b);
                setOpenCategory(null);
              }}
              style={{
                ...styles.brandTab,
                borderColor: brand === b ? BRAND_COLOR[b] : "#D7DBE0",
                color: brand === b ? BRAND_COLOR[b] : "#5B6472",
              }}
            >
              {BRAND_LABEL[b]}
            </button>
          ))}
        </div>
      )}

      {entryType === "purchase" ? (
        <PurchaseEntryPanel
          purchaseItems={purchaseItems}
          purchaseQtys={purchaseQtys}
          setPurchaseQtys={setPurchaseQtys}
          purchaseTotals={purchaseTotals}
          setPurchaseTotals={setPurchaseTotals}
          currency={config.currency}
          brandLabel={BRAND_LABEL[brand]}
          selectedDate={selectedDate}
          monthLabel={MONTH_NAMES[cursor.m]}
          monthPurchaseTotal={monthPurchaseTotal}
          todaysPurchases={todaysLogs.filter(isPurchase)}
          onSubmit={submitPurchase}
        />
      ) : entryType === "sale" ? (
        <SaleEntryPanel
          saleAmount={saleAmount}
          setSaleAmount={setSaleAmount}
          currency={config.currency}
          selectedDate={selectedDate}
          monthLabel={MONTH_NAMES[cursor.m]}
          monthSaleTotal={monthSaleTotal}
          todaysSaleEntry={todaysSaleEntry}
          onSubmit={submitSale}
        />
      ) : items.length === 0 ? (
        <EmptyState title={`No items set up for ${BRAND_LABEL[brand]}`} body="Ask an admin to add wastage items in Settings → Item Master." small />
      ) : (
        <div style={styles.categoryList}>
          {categories.map(([cat, catItems]) => {
            const isOpen = openCategory === cat;
            const filledCount = categoryQtyCount(catItems);
            return (
              <div key={cat} style={styles.categoryBlock}>
                <button
                  style={{ ...styles.categoryHead, borderColor: isOpen ? "#E2572B" : "#D7DBE0" }}
                  onClick={() => setOpenCategory(isOpen ? null : cat)}
                >
                  <span style={styles.categoryHeadName}>{cat}</span>
                  <span style={styles.categoryHeadMeta}>
                    {filledCount > 0 && <span style={styles.categoryFilledTag}>{filledCount} entered</span>}
                    <span style={styles.categoryCount}>{catItems.length} item{catItems.length === 1 ? "" : "s"}</span>
                    <span style={{ ...styles.categoryChevron, transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                  </span>
                </button>
                {isOpen && (
                  <div style={styles.itemList}>
                    <div style={styles.itemHeadRow}>
                      <span></span>
                      <span style={{ textAlign: "right", color: "#2FB8A6" }}>Produced</span>
                      <span style={{ textAlign: "right" }}>Wasted</span>
                      <span style={{ textAlign: "right" }}>Value lost</span>
                    </div>
                    {catItems.map((it) => (
                      <div key={it.id} style={styles.itemRowDual}>
                        <div style={styles.itemName}>
                          {it.name}
                          <span style={styles.itemUnit}>{it.unit}</span>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={prodQtys[it.id] || ""}
                          onChange={(e) => setProdQtys((q) => ({ ...q, [it.id]: e.target.value }))}
                          style={{ ...styles.qtyInput, borderColor: "#2FB8A6" }}
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={qtys[it.id] || ""}
                          onChange={(e) => setQtys((q) => ({ ...q, [it.id]: e.target.value }))}
                          style={styles.qtyInput}
                        />
                        <div style={styles.itemValue}>
                          {config.currency}
                          {fmtNum((Number(qtys[it.id]) || 0) * it.price)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {entryType === "wastage" && items.length > 0 && (
        <div style={styles.entryFooter}>
          <div style={styles.entryTotal}>
            Wastage value entered: <b>{config.currency}{fmtNum(totalPreview)}</b>
          </div>
          <button style={styles.submitBtn} onClick={submit}>
            Log entries
          </button>
        </div>
      )}

      {status && <div style={styles.statusBar}>{status}</div>}

      {entryType === "wastage" && todaysLogs.filter((e) => isWastage(e) || isProduction(e)).length > 0 && (
        <div style={styles.todayLog}>
          <div style={styles.todayLogHead}>Already logged for {selectedDate}</div>
          {todaysLogs
            .filter((e) => isWastage(e) || isProduction(e))
            .map((e) => (
              <div key={e.id} style={styles.todayLogRow}>
                <span style={{ ...styles.brandDot, background: isProduction(e) ? "#2FB8A6" : BRAND_COLOR[e.brand] }} />
                <span style={styles.todayLogItem}>
                  {e.itemName} {isProduction(e) && <span style={styles.prodTag}>produced</span>}
                </span>
                <span style={styles.todayLogQty}>
                  {fmtNum(e.qty)} {e.unit}
                </span>
                <span style={styles.todayLogVal}>
                  {isProduction(e) ? "" : `${config.currency}${fmtNum(e.value)}`}
                </span>
              </div>
            ))}
        </div>
      )}

      {entryType === "wastage" && (
        <div style={styles.sheetToggleWrap}>
          <button style={styles.sheetToggleBtn} onClick={() => setShowSheet((s) => !s)}>
            {showSheet ? "Hide" : "View"} {MONTH_NAMES[cursor.m]} production & wastage sheet {showSheet ? "▲" : "▼"}
          </button>
          {showSheet && (
            monthSheet.length === 0 ? (
              <EmptyState title="Nothing logged this month yet" body="Once you log production or wastage, this sheet fills in." small />
            ) : (
              <div style={styles.itemTotalsTable}>
                <div style={styles.itemTotalsHeadRowWide}>
                  <span>Item</span>
                  <span style={{ textAlign: "right" }}>Produced</span>
                  <span style={{ textAlign: "right" }}>Wasted</span>
                  <span style={{ textAlign: "right" }}>Waste %</span>
                  <span style={{ textAlign: "right" }}>Value lost</span>
                </div>
                {monthSheet.map((it, i) => {
                  const pct = it.producedQty > 0 ? (it.wastedQty / it.producedQty) * 100 : null;
                  return (
                    <div key={i} style={{ ...styles.itemTotalsRowWide, gridTemplateColumns: "1.6fr 1fr 1fr 80px 1fr" }}>
                      <span>{it.itemName}</span>
                      <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#2FB8A6" }}>
                        {fmtNum(it.producedQty)} {it.unit}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>
                        {fmtNum(it.wastedQty)} {it.unit}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: pct !== null && pct > 15 ? "#E2572B" : "#5B6472" }}>
                        {pct === null ? "—" : `${fmtNum(pct, 1)}%`}
                      </span>
                      <span style={{ textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#E2572B" }}>
                        {config.currency}
                        {fmtNum(it.wastedValue)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function PurchaseEntryPanel({
  purchaseItems,
  purchaseQtys,
  setPurchaseQtys,
  purchaseTotals,
  setPurchaseTotals,
  currency,
  brandLabel,
  selectedDate,
  monthLabel,
  monthPurchaseTotal,
  todaysPurchases,
  onSubmit,
}) {
  if (purchaseItems.length === 0) {
    return (
      <EmptyState
        title={`No purchase items set up for ${brandLabel}`}
        body="Ask an admin to add purchase items in Settings → Purchase Items."
      />
    );
  }
  return (
    <div>
      <div style={styles.summaryStrip}>
        <SummaryCell label={`${monthLabel} purchases`} value={`${currency}${fmtNum(monthPurchaseTotal)}`} accent="#E2572B" />
      </div>
      <div style={styles.itemHeadRow}>
        <span></span>
        <span style={{ textAlign: "right" }}>Quantity</span>
        <span style={{ textAlign: "right", gridColumn: "span 2" }}>Total price paid</span>
      </div>
      <div style={styles.itemList}>
        {purchaseItems.map((it) => (
          <div key={it.id} style={styles.itemRowDual}>
            <div style={styles.itemName}>
              {it.name}
              <span style={styles.itemUnit}>{it.unit}</span>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={purchaseQtys[it.id] || ""}
              onChange={(e) => setPurchaseQtys((q) => ({ ...q, [it.id]: e.target.value }))}
              style={styles.qtyInput}
            />
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={purchaseTotals[it.id] || ""}
              onChange={(e) => setPurchaseTotals((q) => ({ ...q, [it.id]: e.target.value }))}
              style={{ ...styles.qtyInput, gridColumn: "span 2", borderColor: "#E2572B" }}
            />
          </div>
        ))}
      </div>
      <div style={styles.entryFooter}>
        <div style={styles.entryTotal}>Enter quantity and the total you paid for it</div>
        <button style={styles.submitBtn} onClick={onSubmit}>
          Log purchase
        </button>
      </div>
      {todaysPurchases.length > 0 && (
        <div style={styles.todayLog}>
          <div style={styles.todayLogHead}>Already logged for {selectedDate}</div>
          {todaysPurchases.map((e) => (
            <div key={e.id} style={styles.todayLogRow}>
              <span style={{ ...styles.brandDot, background: "#E2572B" }} />
              <span style={styles.todayLogItem}>{e.itemName}</span>
              <span style={styles.todayLogQty}>
                {fmtNum(e.qty)} {e.unit}
              </span>
              <span style={styles.todayLogVal}>
                {currency}
                {fmtNum(e.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SaleEntryPanel({ saleAmount, setSaleAmount, currency, selectedDate, monthLabel, monthSaleTotal, todaysSaleEntry, onSubmit }) {
  return (
    <div>
      <div style={styles.summaryStrip}>
        <SummaryCell label={`${monthLabel} sales`} value={`${currency}${fmtNum(monthSaleTotal)}`} accent="#2FB8A6" />
      </div>
      <div style={styles.salePanel}>
        <label style={styles.saleLabel}>
          Total sales for {selectedDate}
          {todaysSaleEntry && (
            <span style={styles.mutedNote}>
              {" "}
              — currently logged: {currency}
              {fmtNum(todaysSaleEntry.value)}. Submitting again replaces it.
            </span>
          )}
        </label>
        <div style={styles.saleInputRow}>
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder={todaysSaleEntry ? String(todaysSaleEntry.value) : "0.00"}
            value={saleAmount}
            onChange={(e) => setSaleAmount(e.target.value)}
            style={styles.saleInput}
          />
          <button style={styles.submitBtn} onClick={onSubmit}>
            Log sale
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Settings ----------------

function Settings({
  config,
  saving,
  onAddOutlet,
  onRemoveOutlet,
  onUpdateOutletPassword,
  onUpdateOutletBrand,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onAddPurchaseItem,
  onRemovePurchaseItem,
  onUpdatePurchaseItem,
  onSetCurrency,
  onSetMasterPassword,
  onExportBackup,
  entriesByOutlet,
}) {
  const [outletName, setOutletName] = useState("");
  const [outletPw, setOutletPw] = useState("");
  const [newOutletBrand, setNewOutletBrand] = useState("LBKK");
  const [brand, setBrand] = useState("LBKK");
  const [newItem, setNewItem] = useState({ name: "", unit: "kg", price: "", category: "" });
  const [purchaseBrand, setPurchaseBrand] = useState("LBKK");
  const [newPurchaseItem, setNewPurchaseItem] = useState({ name: "", unit: "kg" });
  const [currencyInput, setCurrencyInput] = useState(config.currency);
  const [masterPwInput, setMasterPwInput] = useState("");

  return (
    <div style={styles.settingsGrid} className="settingsGrid">
      <section style={styles.panel}>
        <div style={styles.panelTitle}>Outlets & passwords {saving && <span style={styles.savingTag}>saving…</span>}</div>
        <div style={styles.rowAdd}>
          <input
            style={styles.textInput}
            placeholder="Outlet name"
            value={outletName}
            onChange={(e) => setOutletName(e.target.value)}
          />
          <select style={{ ...styles.select, minWidth: 90 }} value={newOutletBrand} onChange={(e) => setNewOutletBrand(e.target.value)}>
            {BRANDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <input
            style={{ ...styles.textInput, maxWidth: 130 }}
            placeholder="Password"
            value={outletPw}
            onChange={(e) => setOutletPw(e.target.value)}
          />
          <button
            style={styles.addBtn}
            onClick={() => {
              if (outletName.trim() && outletPw.trim()) {
                onAddOutlet(outletName, outletPw, newOutletBrand);
                setOutletName("");
                setOutletPw("");
              }
            }}
          >
            + Add
          </button>
        </div>
        <div style={styles.listBox}>
          {config.outlets.length === 0 && <div style={styles.mutedNote}>No outlets added yet.</div>}
          {config.outlets.map((o) => (
            <OutletRow key={o.id} outlet={o} onRemove={onRemoveOutlet} onUpdatePassword={onUpdateOutletPassword} onUpdateBrand={onUpdateOutletBrand} />
          ))}
        </div>
        <div style={styles.mutedNote}>Removing an outlet only takes it off this list — its wastage history is kept forever in storage. Every outlet must be assigned exactly one brand — outlets can never see or log wastage for another brand's items.</div>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelTitle}>Currency symbol</div>
        <div style={styles.rowAdd}>
          <input
            style={{ ...styles.textInput, maxWidth: 100 }}
            value={currencyInput}
            onChange={(e) => setCurrencyInput(e.target.value)}
          />
          <button style={styles.addBtn} onClick={() => onSetCurrency(currencyInput || "₹")}>
            Save
          </button>
        </div>

        <div style={{ ...styles.panelTitle, marginTop: 18 }}>Master password</div>
        <div style={styles.mutedNote}>Used to unlock Settings. Only an admin changes this.</div>
        <div style={{ ...styles.rowAdd, marginTop: 8 }}>
          <input
            style={styles.textInput}
            placeholder="New master password"
            value={masterPwInput}
            onChange={(e) => setMasterPwInput(e.target.value)}
          />
          <button
            style={styles.addBtn}
            onClick={() => {
              if (masterPwInput.trim()) {
                onSetMasterPassword(masterPwInput);
                setMasterPwInput("");
              }
            }}
          >
            Update
          </button>
        </div>
      </section>

      <section style={styles.panel}>
        <div style={styles.panelTitle}>Backup</div>
        <div style={styles.mutedNote}>
          Downloads every outlet, item, price and logged wastage entry
          ({Object.values(entriesByOutlet || {}).reduce((s, arr) => s + arr.length, 0)} entries total) as one file
          you keep yourself. Nothing is deleted from the app — this is just a safety copy.
        </div>
        <button style={{ ...styles.addBtn, marginTop: 10 }} onClick={onExportBackup}>
          ⬇ Download all data (.json)
        </button>
      </section>

      <section style={{ ...styles.panel, gridColumn: "1 / -1" }}>
        <div style={styles.panelTitle}>Item master</div>
        <div style={styles.brandTabs}>
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => setBrand(b)}
              style={{
                ...styles.brandTab,
                borderColor: brand === b ? BRAND_COLOR[b] : "#D7DBE0",
                color: brand === b ? BRAND_COLOR[b] : "#5B6472",
              }}
            >
              {BRAND_LABEL[b]}
            </button>
          ))}
        </div>

        <div style={styles.itemAddRow}>
          <input
            style={{ ...styles.textInput, flex: 1.4 }}
            placeholder="Category (e.g. Fruits, Drinks)"
            list="category-options"
            value={newItem.category}
            onChange={(e) => setNewItem((n) => ({ ...n, category: e.target.value }))}
          />
          <datalist id="category-options">
            {[...new Set((config.items[brand] || []).map((i) => i.category?.trim()).filter(Boolean))].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <input
            style={{ ...styles.textInput, flex: 2 }}
            placeholder="Item name (e.g. Chicken Breast)"
            value={newItem.name}
            onChange={(e) => setNewItem((n) => ({ ...n, name: e.target.value }))}
          />
          <select
            style={{ ...styles.select, flex: 1 }}
            value={newItem.unit}
            onChange={(e) => setNewItem((n) => ({ ...n, unit: e.target.value }))}
          >
            <option value="kg">kg</option>
            <option value="ltr">ltr</option>
          </select>
          <input
            style={{ ...styles.textInput, flex: 1 }}
            type="number"
            min="0"
            step="0.01"
            placeholder={`Price / ${newItem.unit}`}
            value={newItem.price}
            onChange={(e) => setNewItem((n) => ({ ...n, price: e.target.value }))}
          />
          <button
            style={styles.addBtn}
            onClick={() => {
              if (newItem.name.trim() && newItem.price !== "") {
                onAddItem(brand, {
                  name: newItem.name.trim(),
                  unit: newItem.unit,
                  price: Number(newItem.price),
                  category: newItem.category.trim() || "General",
                });
                setNewItem({ name: "", unit: "kg", price: "", category: newItem.category });
              }
            }}
          >
            + Add item
          </button>
        </div>

        <div style={styles.listBox}>
          {(config.items[brand] || []).length === 0 && (
            <div style={styles.mutedNote}>No items for {BRAND_LABEL[brand]} yet.</div>
          )}
          {Object.entries(
            (config.items[brand] || []).reduce((groups, it) => {
              const cat = it.category?.trim() || "General";
              (groups[cat] = groups[cat] || []).push(it);
              return groups;
            }, {})
          )
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([cat, catItems]) => (
              <div key={cat}>
                <div style={styles.itemCategoryLabel}>{cat}</div>
                {catItems.map((it) => (
                  <div key={it.id} style={styles.itemSettingsRow}>
                    <input
                      style={styles.itemEditCategory}
                      value={it.category || ""}
                      placeholder="category"
                      onChange={(e) => onUpdateItem(brand, it.id, { category: e.target.value })}
                    />
                    <input
                      style={styles.itemEditName}
                      value={it.name}
                      onChange={(e) => onUpdateItem(brand, it.id, { name: e.target.value })}
                    />
                    <select
                      style={styles.itemEditUnit}
                      value={it.unit}
                      onChange={(e) => onUpdateItem(brand, it.id, { unit: e.target.value })}
                    >
                      <option value="kg">kg</option>
                      <option value="ltr">ltr</option>
                    </select>
                    <input
                      style={styles.itemEditPrice}
                      type="number"
                      min="0"
                      step="0.01"
                      value={it.price}
                      onChange={(e) => onUpdateItem(brand, it.id, { price: Number(e.target.value) })}
                    />
                    <button style={styles.removeBtn} onClick={() => onRemoveItem(brand, it.id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ))}
        </div>
        <div style={styles.mutedNote}>Removing an item only takes it off future entry screens — past logs keep the name, quantity and value they were recorded with.</div>
      </section>

      <section style={{ ...styles.panel, gridColumn: "1 / -1" }}>
        <div style={styles.panelTitle}>Purchase items</div>
        <div style={styles.mutedNote}>Separate from wastage items — no fixed price, since purchase cost changes every time. Outlets enter the total they paid when logging.</div>
        <div style={{ ...styles.brandTabs, marginTop: 12 }}>
          {BRANDS.map((b) => (
            <button
              key={b}
              onClick={() => setPurchaseBrand(b)}
              style={{
                ...styles.brandTab,
                borderColor: purchaseBrand === b ? BRAND_COLOR[b] : "#D7DBE0",
                color: purchaseBrand === b ? BRAND_COLOR[b] : "#5B6472",
              }}
            >
              {BRAND_LABEL[b]}
            </button>
          ))}
        </div>

        <div style={styles.itemAddRow}>
          <input
            style={{ ...styles.textInput, flex: 2 }}
            placeholder="Item name (e.g. Chicken, Flour, Packaging boxes)"
            value={newPurchaseItem.name}
            onChange={(e) => setNewPurchaseItem((n) => ({ ...n, name: e.target.value }))}
          />
          <select
            style={{ ...styles.select, flex: 1 }}
            value={newPurchaseItem.unit}
            onChange={(e) => setNewPurchaseItem((n) => ({ ...n, unit: e.target.value }))}
          >
            <option value="kg">kg</option>
            <option value="ltr">ltr</option>
            <option value="pcs">pcs</option>
          </select>
          <button
            style={styles.addBtn}
            onClick={() => {
              if (newPurchaseItem.name.trim()) {
                onAddPurchaseItem(purchaseBrand, { name: newPurchaseItem.name.trim(), unit: newPurchaseItem.unit });
                setNewPurchaseItem({ name: "", unit: newPurchaseItem.unit });
              }
            }}
          >
            + Add item
          </button>
        </div>

        <div style={styles.listBox}>
          {(config.purchaseItems?.[purchaseBrand] || []).length === 0 && (
            <div style={styles.mutedNote}>No purchase items for {BRAND_LABEL[purchaseBrand]} yet.</div>
          )}
          {(config.purchaseItems?.[purchaseBrand] || []).map((it) => (
            <div key={it.id} style={styles.purchaseItemRow}>
              <input
                style={styles.itemEditName}
                value={it.name}
                onChange={(e) => onUpdatePurchaseItem(purchaseBrand, it.id, { name: e.target.value })}
              />
              <select
                style={styles.itemEditUnit}
                value={it.unit}
                onChange={(e) => onUpdatePurchaseItem(purchaseBrand, it.id, { unit: e.target.value })}
              >
                <option value="kg">kg</option>
                <option value="ltr">ltr</option>
                <option value="pcs">pcs</option>
              </select>
              <button style={styles.removeBtn} onClick={() => onRemovePurchaseItem(purchaseBrand, it.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function OutletRow({ outlet, onRemove, onUpdatePassword, onUpdateBrand }) {
  const [pw, setPw] = useState(outlet.password || "");
  const [reveal, setReveal] = useState(false);
  return (
    <div style={styles.outletRow}>
      <span style={styles.outletRowName}>{outlet.name}</span>
      <select
        style={{ ...styles.outletRowBrand, ...(outlet.brand ? {} : { borderColor: "#E2572B", color: "#E2572B" }) }}
        value={outlet.brand || ""}
        onChange={(e) => onUpdateBrand(outlet.id, e.target.value)}
      >
        <option value="" disabled>
          ⚠ Not assigned
        </option>
        {BRANDS.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      <input
        style={styles.outletRowPw}
        type={reveal ? "text" : "password"}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onBlur={() => pw.trim() && pw !== outlet.password && onUpdatePassword(outlet.id, pw.trim())}
      />
      <button style={styles.revealBtn} onClick={() => setReveal((r) => !r)}>
        {reveal ? "Hide" : "Show"}
      </button>
      <button style={styles.removeBtn} onClick={() => onRemove(outlet.id)}>
        Remove
      </button>
    </div>
  );
}

function EmptyState({ title, body, small }) {
  return (
    <div style={small ? styles.emptySmall : styles.empty}>
      <div style={styles.emptyTitle}>{title}</div>
      <div style={styles.emptyBody}>{body}</div>
    </div>
  );
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
  * { box-sizing: border-box; }
  input, select, button { font-family: 'Inter', sans-serif; }
  input:focus, select:focus, button:focus { outline: 2px solid #E2572B; outline-offset: 1px; }
  .pulse { animation: pulseAnim 1.8s ease-in-out infinite; }
  @keyframes pulseAnim { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  @media (max-width: 700px) {
    .settingsGrid { grid-template-columns: 1fr !important; }
    .periodGrid { grid-template-columns: 1fr !important; }
    .comparisonGrid { grid-template-columns: 1fr !important; }
  }
`;

const styles = {
  app: {
    fontFamily: "'Inter', sans-serif",
    background: "#F4F5F7",
    color: "#1B1F24",
    minHeight: "100vh",
    padding: "24px 20px 60px",
    position: "relative",
  },
  scanline: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: "linear-gradient(90deg, #E2572B, #C9A227, #2FB8A6)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 16,
    marginBottom: 24,
    paddingTop: 8,
  },
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "#5B6472",
    marginBottom: 4,
  },
  h1: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 32,
    fontWeight: 600,
    letterSpacing: "0.01em",
    margin: 0,
    textTransform: "uppercase",
  },
  credit: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    color: "#8B92A0",
    marginTop: 2,
    letterSpacing: "0.04em",
  },
  h2: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 24,
    fontWeight: 600,
    margin: 0,
    textTransform: "uppercase",
  },
  headerRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 },
  liveTag: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    color: "#5B6472",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: "50%", background: "#2FB8A6", display: "inline-block" },
  sessionTag: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: "#5B6472",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logoutBtn: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
  },
  errorBar: {
    background: "rgba(226,87,43,0.12)",
    border: "1px solid #E2572B",
    color: "#E2572B",
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: 16,
    display: "flex",
    justifyContent: "space-between",
    fontSize: 13,
  },
  errorClose: { background: "none", border: "none", color: "#E2572B", cursor: "pointer", fontSize: 16 },
  loading: { color: "#5B6472", fontFamily: "'JetBrains Mono', monospace", padding: "40px 0" },
  landingGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginTop: 20 },
  landingCard: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 12,
    padding: "26px 22px",
    textAlign: "left",
    cursor: "pointer",
    color: "#1B1F24",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  landingEyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10.5,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#5B6472",
  },
  landingTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 22, textTransform: "uppercase" },
  landingBody: { fontSize: 13, color: "#5B6472", lineHeight: 1.5 },
  gateWrap: { display: "flex", justifyContent: "center", padding: "40px 0" },
  gateBox: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 12,
    padding: 28,
    width: "100%",
    maxWidth: 340,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  gateTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 20, textTransform: "uppercase" },
  gateSubtitle: { fontSize: 13, color: "#5B6472", marginBottom: 6 },
  gateInput: {
    background: "#F4F5F7",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 7,
    padding: "10px 12px",
    fontSize: 14,
  },
  gateBtnRow: { display: "flex", justifyContent: "space-between", gap: 10, marginTop: 6 },
  gateBack: {
    background: "transparent",
    border: "1px solid #D7DBE0",
    color: "#5B6472",
    borderRadius: 7,
    padding: "9px 16px",
    cursor: "pointer",
    fontSize: 13,
  },
  gateSubmit: {
    background: "#E2572B",
    border: "none",
    color: "#F4F5F7",
    borderRadius: 7,
    padding: "9px 20px",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    flex: 1,
  },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  rangeGroup: { display: "flex", gap: 6 },
  customRangeBar: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 18,
  },
  customRangeField: { display: "flex", flexDirection: "column", gap: 5, fontSize: 11.5, color: "#5B6472" },
  dashboardTabRow: { marginBottom: 18 },
  dashboardTabSelect: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 14,
    fontFamily: "'Oswald', sans-serif",
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    color: "#1B1F24",
    minWidth: 260,
  },
  periodGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 },
  periodCard: { background: "#F4F5F7", border: "1px solid #D7DBE0", borderRadius: 10, padding: 14 },
  periodLabel: { fontFamily: "'Oswald', sans-serif", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.02em", marginBottom: 10, color: "#1B1F24" },
  comparisonGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 10 },
  comparisonBlock: { background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: 14 },
  rangeBtn: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#5B6472",
    padding: "7px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12.5,
  },
  rangeBtnActive: { color: "#1B1F24", borderColor: "#E2572B" },
  refreshBtn: {
    background: "transparent",
    border: "1px solid #D7DBE0",
    color: "#5B6472",
    padding: "7px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12.5,
  },
  summaryStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
    marginBottom: 24,
  },
  summaryCell: { background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: "14px 16px" },
  summaryLabel: { fontSize: 11, color: "#5B6472", letterSpacing: "0.05em", marginBottom: 6, textTransform: "uppercase" },
  summaryValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700 },
  summarySub: { fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: "#5B6472", marginTop: 2 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 },
  docket: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 10,
    padding: "16px 16px 14px",
    position: "relative",
    overflow: "hidden",
    textAlign: "left",
    cursor: "pointer",
    color: "#1B1F24",
    width: "100%",
  },
  docketPerf: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundImage: "repeating-linear-gradient(90deg, #F4F5F7 0 6px, transparent 6px 10px)",
  },
  docketHead: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 4 },
  docketName: { fontFamily: "'Oswald', sans-serif", fontSize: 16, textTransform: "uppercase", letterSpacing: "0.02em" },
  docketCount: { fontSize: 11, color: "#5B6472" },
  docketBrandTag: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
    fontFamily: "'JetBrains Mono', monospace",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#5B6472",
    marginTop: 6,
  },
  docketValue: { fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 700, marginTop: 10, color: "#E2572B" },
  gaugeTrack: { height: 4, background: "#F4F5F7", borderRadius: 2, marginTop: 10, overflow: "hidden" },
  gaugeFill: { height: "100%", background: "linear-gradient(90deg, #C9A227, #E2572B)" },
  docketMeta: { display: "flex", gap: 6, fontSize: 12, color: "#5B6472", marginTop: 8, fontFamily: "'JetBrains Mono', monospace" },
  brandRow: { display: "flex", flexDirection: "column", gap: 5, marginTop: 12, borderTop: "1px solid #D7DBE0", paddingTop: 10 },
  topItemsLabel: { fontSize: 10.5, color: "#8B92A0", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 },
  topItemRank: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "#F4F5F7",
    color: "#5B6472",
    fontSize: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: "'JetBrains Mono', monospace",
  },
  brandChip: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 },
  brandDot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", flexShrink: 0 },
  brandChipLabel: { color: "#5B6472", flex: 1 },
  brandChipValue: { fontFamily: "'JetBrains Mono', monospace", color: "#1B1F24" },
  docketHint: { fontSize: 11, color: "#8B92A0", marginTop: 12 },
  detailHeadRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12, marginBottom: 18 },
  calendarPanel: { background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: 16 },
  calendarNav: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  calNavBtn: {
    background: "#F4F5F7",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 6,
    width: 30,
    height: 30,
    cursor: "pointer",
    fontSize: 15,
  },
  calendarTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 15, textTransform: "uppercase", letterSpacing: "0.03em" },
  calGridHead: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 },
  calWeekday: { textAlign: "center", fontSize: 10.5, color: "#8B92A0", fontFamily: "'JetBrains Mono', monospace" },
  calGridRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 },
  calCell: {
    aspectRatio: "1",
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
    minHeight: 58,
  },
  calCellBlank: { minHeight: 58 },
  calDayNum: { fontSize: 11, color: "#1B1F24", fontFamily: "'JetBrains Mono', monospace" },
  calDayVal: { fontSize: 11, fontWeight: 700, color: "#1B1F24", fontFamily: "'JetBrains Mono', monospace", marginTop: 3 },
  entryDateBanner: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: "#5B6472",
    margin: "14px 0",
    padding: "8px 12px",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 7,
  },
  dayPanel: { marginTop: 16, background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: 14 },
  entryTypeTabs: { display: "flex", gap: 6, marginBottom: 16, background: "#F4F5F7", padding: 4, borderRadius: 8, border: "1px solid #D7DBE0" },
  entryTypeTab: {
    flex: 1,
    background: "transparent",
    border: "none",
    borderRadius: 6,
    padding: "9px 0",
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "#5B6472",
  },
  entryTypeTabActive: { background: "#FFFFFF", color: "#1B1F24", boxShadow: "0 1px 2px rgba(0,0,0,0.08)" },
  salePanel: { background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: 18 },
  saleLabel: { display: "block", fontSize: 13, color: "#5B6472", marginBottom: 10 },
  saleInputRow: { display: "flex", gap: 10 },
  saleInput: {
    flex: 1,
    background: "#F4F5F7",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 7,
    padding: "10px 12px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 16,
  },
  brandTabs: { display: "flex", gap: 8, marginBottom: 16 },
  brandLockedTag: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontFamily: "'Oswald', sans-serif",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    color: "#1B1F24",
    marginBottom: 16,
  },
  brandTab: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 6,
    padding: "8px 18px",
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  itemList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 },
  categoryList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 },
  categoryBlock: { display: "flex", flexDirection: "column", gap: 8 },
  categoryHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 8,
    padding: "12px 14px",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
  },
  categoryHeadName: { fontFamily: "'Oswald', sans-serif", fontSize: 15, textTransform: "uppercase", letterSpacing: "0.02em" },
  categoryHeadMeta: { display: "flex", alignItems: "center", gap: 10 },
  categoryCount: { fontSize: 11.5, color: "#5B6472", fontFamily: "'JetBrains Mono', monospace" },
  categoryFilledTag: {
    fontSize: 11,
    color: "#2FB8A6",
    background: "rgba(47,184,166,0.12)",
    border: "1px solid #2FB8A6",
    borderRadius: 20,
    padding: "2px 8px",
    fontFamily: "'JetBrains Mono', monospace",
  },
  categoryChevron: { fontSize: 16, color: "#5B6472", transition: "transform 0.15s ease" },
  itemRow: {
    display: "grid",
    gridTemplateColumns: "1fr 110px 100px",
    gap: 10,
    alignItems: "center",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 8,
    padding: "10px 12px",
  },
  itemRowDual: {
    display: "grid",
    gridTemplateColumns: "1fr 90px 90px 90px",
    gap: 10,
    alignItems: "center",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 8,
    padding: "10px 12px",
  },
  itemHeadRow: {
    display: "grid",
    gridTemplateColumns: "1fr 90px 90px 90px",
    gap: 10,
    fontSize: 10.5,
    color: "#8B92A0",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "0 12px",
  },
  prodTag: {
    fontSize: 10,
    color: "#2FB8A6",
    background: "rgba(47,184,166,0.12)",
    border: "1px solid #2FB8A6",
    borderRadius: 10,
    padding: "1px 6px",
    marginLeft: 6,
  },
  itemName: { fontSize: 13.5, display: "flex", flexDirection: "column" },
  itemUnit: { fontSize: 11, color: "#5B6472", fontFamily: "'JetBrains Mono', monospace" },
  qtyInput: {
    background: "#F4F5F7",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 6,
    padding: "7px 8px",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    textAlign: "right",
  },
  itemValue: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    textAlign: "right",
    color: "#5B6472",
  },
  entryFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 },
  entryTotal: { fontSize: 13, color: "#5B6472", fontFamily: "'JetBrains Mono', monospace" },
  submitBtn: {
    background: "#E2572B",
    border: "none",
    color: "#F4F5F7",
    padding: "11px 22px",
    borderRadius: 7,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13.5,
    letterSpacing: "0.02em",
  },
  statusBar: {
    marginTop: 14,
    background: "rgba(47,184,166,0.1)",
    border: "1px solid #2FB8A6",
    color: "#2FB8A6",
    padding: "9px 12px",
    borderRadius: 7,
    fontSize: 13,
  },
  todayLog: { marginTop: 26, borderTop: "1px solid #D7DBE0", paddingTop: 14 },
  todayLogHead: { fontSize: 11, color: "#5B6472", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 },
  todayLogRow: {
    display: "grid",
    gridTemplateColumns: "12px 1fr 90px 90px",
    gap: 10,
    alignItems: "center",
    fontSize: 12.5,
    padding: "6px 0",
    borderBottom: "1px solid #FFFFFF",
  },
  todayLogItem: { color: "#1B1F24" },
  todayLogQty: { fontFamily: "'JetBrains Mono', monospace", color: "#5B6472", textAlign: "right" },
  todayLogVal: { fontFamily: "'JetBrains Mono', monospace", color: "#E2572B", textAlign: "right" },
  sheetToggleWrap: { marginTop: 28 },
  sheetToggleBtn: {
    width: "100%",
    textAlign: "left",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 8,
    padding: "12px 14px",
    cursor: "pointer",
    fontFamily: "'Oswald', sans-serif",
    fontSize: 13.5,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    color: "#1B1F24",
    marginBottom: 10,
  },
  itemTotalsTable: { display: "flex", flexDirection: "column", gap: 4, marginTop: 10 },
  itemTotalsHeadRow: {
    display: "grid",
    gridTemplateColumns: "2fr 80px 1fr 1fr",
    gap: 10,
    fontSize: 10.5,
    color: "#8B92A0",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0 10px 6px",
  },
  itemTotalsRow: {
    display: "grid",
    gridTemplateColumns: "2fr 80px 1fr 1fr",
    gap: 10,
    alignItems: "center",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 7,
    padding: "9px 10px",
    fontSize: 13,
  },
  itemTotalsHeadRowWide: {
    display: "grid",
    gridTemplateColumns: "1.6fr 70px 1fr 1fr 80px 1fr",
    gap: 10,
    fontSize: 10.5,
    color: "#8B92A0",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    padding: "0 10px 6px",
  },
  itemTotalsRowWide: {
    display: "grid",
    gridTemplateColumns: "1.6fr 70px 1fr 1fr 80px 1fr",
    gap: 10,
    alignItems: "center",
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    borderRadius: 7,
    padding: "9px 10px",
    fontSize: 13,
  },
  settingsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  panel: { background: "#FFFFFF", border: "1px solid #D7DBE0", borderRadius: 10, padding: 18 },
  panelTitle: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 15,
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    marginBottom: 14,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  savingTag: { fontSize: 10, color: "#C9A227", fontFamily: "'JetBrains Mono', monospace" },
  rowAdd: { display: "flex", gap: 8, marginBottom: 12 },
  textInput: {
    background: "#F4F5F7",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    flex: 1,
  },
  addBtn: {
    background: "#D7DBE0",
    border: "1px solid #C3C9D0",
    color: "#1B1F24",
    borderRadius: 6,
    padding: "8px 14px",
    cursor: "pointer",
    fontSize: 12.5,
    whiteSpace: "nowrap",
  },
  listBox: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto", marginBottom: 10 },
  outletRow: {
    display: "grid",
    gridTemplateColumns: "1fr 100px 110px auto auto",
    gap: 8,
    alignItems: "center",
    background: "#F4F5F7",
    borderRadius: 6,
    padding: "8px 10px",
  },
  outletRowName: { fontSize: 13 },
  outletRowBrand: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 5,
    padding: "6px 8px",
    fontSize: 12,
  },
  outletRowPw: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 5,
    padding: "6px 8px",
    fontSize: 12,
    fontFamily: "'JetBrains Mono', monospace",
  },
  revealBtn: { background: "none", border: "none", color: "#5B6472", cursor: "pointer", fontSize: 11 },
  mutedNote: { color: "#5B6472", fontSize: 12, fontStyle: "italic" },
  removeBtn: { background: "none", border: "none", color: "#E2572B", cursor: "pointer", fontSize: 12 },
  itemAddRow: { display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  itemSettingsRow: {
    display: "grid",
    gridTemplateColumns: "1.2fr 2fr 90px 100px auto",
    gap: 8,
    alignItems: "center",
    background: "#F4F5F7",
    borderRadius: 6,
    padding: "8px 10px",
    marginTop: 4,
  },
  purchaseItemRow: {
    display: "grid",
    gridTemplateColumns: "2fr 90px auto",
    gap: 8,
    alignItems: "center",
    background: "#F4F5F7",
    borderRadius: 6,
    padding: "8px 10px",
    marginTop: 4,
  },
  itemCategoryLabel: {
    fontFamily: "'Oswald', sans-serif",
    fontSize: 12.5,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "#5B6472",
    marginTop: 12,
    marginBottom: 2,
  },
  itemEditCategory: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#5B6472",
    borderRadius: 5,
    fontSize: 12,
    padding: "5px 7px",
  },
  itemEditName: { background: "transparent", border: "none", color: "#1B1F24", fontSize: 13 },
  itemEditUnit: { background: "#FFFFFF", border: "1px solid #D7DBE0", color: "#1B1F24", borderRadius: 5, fontSize: 12, padding: "5px" },
  itemEditPrice: {
    background: "#FFFFFF",
    border: "1px solid #D7DBE0",
    color: "#1B1F24",
    borderRadius: 5,
    fontSize: 12,
    padding: "5px 7px",
    fontFamily: "'JetBrains Mono', monospace",
  },
  empty: {
    background: "#FFFFFF",
    border: "1px dashed #D7DBE0",
    borderRadius: 10,
    padding: "50px 20px",
    textAlign: "center",
  },
  emptySmall: {
    background: "#FFFFFF",
    border: "1px dashed #D7DBE0",
    borderRadius: 10,
    padding: "24px 20px",
    textAlign: "center",
  },
  emptyTitle: { fontFamily: "'Oswald', sans-serif", fontSize: 17, textTransform: "uppercase", marginBottom: 6 },
  emptyBody: { color: "#5B6472", fontSize: 13 },
  footer: { marginTop: 40, fontSize: 11, color: "#8B92A0", textAlign: "center" },
};
