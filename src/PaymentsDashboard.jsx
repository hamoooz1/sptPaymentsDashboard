import React, { useMemo, useState, useRef } from "react";
import Papa from "papaparse";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend, BarChart, Bar } from "recharts";
import Logo from "./components/Logo";

// --- Helpers ---------------------------------------------------------------
function parseMoney(v) {
  if (v == null) return 0;
  const n = String(v).replace(/[^0-9.\-]/g, "");
  const f = parseFloat(n);
  return isNaN(f) ? 0 : f;
}

function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i] || [];
    const rowLower = row.map((c) => String(c || "").toLowerCase());
    // Check for both "payment id" (Format 1) and "paymentid" (Format 2)
    if (rowLower.some((c) => c.includes("payment id") || c.includes("paymentid"))) return i;
  }
  return 0; // fallback
}

function idxAny(header, names) {
  const lower = header.map(h => String(h || "").toLowerCase());
  const targets = names.map(n => n.toLowerCase());
  return lower.findIndex(h => targets.includes(h));
}

function toDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function splitPayer(payerName) {
  if (!payerName) return { payerCategory: null, payer: null };
  const s = String(payerName);
  if (s.includes(" - ")) {
    const parts = s.split(" - ");
    const cat = parts.shift();
    const rest = parts.join(" - ");
    return { payerCategory: (cat || "").trim(), payer: (rest || "").trim() };
  }
  return { payerCategory: null, payer: s.trim() };
}

function csvDownload(rows, filename) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// TheraOffice normalization: kill NBSPs, collapse spaces, lowercase for matching
function normalizeFacility(s) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/\s+/g, " ")    // collapse spaces
    .trim()
    .toLowerCase();
}

// --- Component -------------------------------------------------------------
export default function PaymentsDashboard() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState([]);
  const [paymentTypes, setPaymentTypes] = useState([]);
  const [facilityFilter, setFacilityFilter] = useState([]); // holds normalized facility keys
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  const [fromDate, setFromDate] = useState(""); // yyyy-mm-dd
  const [toDateFilter, setToDateFilter] = useState("");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [sortBy, setSortBy] = useState(null); // 'paymentId' | 'paymentDate' | 'dateEntered' | null
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    onUpload(file);
  };

  const onUpload = (file) => {
    Papa.parse(file, {
      complete: (result) => {
        const raw = result.data || [];
        const arrayRows = raw.map((r) => (Array.isArray(r) ? r : Object.values(r)));
        const headerRowIdx = detectHeaderRow(arrayRows);
        const header = (arrayRows[headerRowIdx] || []).map((c) => String(c || "").trim());
        const dataRows = arrayRows.slice(headerRowIdx + 1);
        const idx = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

        // Detect format: Format 2 has "payercategory" field (distinguishing feature), Format 1 has "Payer Name" (combined)
        const headerLower = header.map(h => h.toLowerCase());
        const hasPayerCategory = headerLower.some(h => h.includes("payercategory"));
        const hasPayerName = headerLower.some(h => h.includes("payer name"));
        const isFormat2 = hasPayerCategory || (!hasPayerName && headerLower.some(h => h.replace(/\s+/g, "") === "paymentid"));
        
        let cleaned = [];

        if (isFormat2) {
          // Format 2: filtered_payments.csv - Simple format with already separated fields
          // May include facility, appliedAmount, unappliedAmount if exported from this app
          const iPaymentId = idx("paymentId");
          const iPayerCategory = idx("payerCategory");
          const iPayer = idx("payer");
          const iPaymentType = idx("paymentType");
          const iCheck = idx("checkNumber");
          const iDateEntered = idx("dateEntered");
          const iPaymentDate = idx("paymentDate");
          const iPaymentAmount = idx("paymentAmount");
          const iNotes = idx("notes");
          const iFacility = idx("facility");
          const iAppliedAmount = idx("appliedAmount");
          const iUnappliedAmount = idx("unappliedAmount");

          for (let i = 0; i < dataRows.length; i++) {
            const r = dataRows[i] || [];
            const pid = r[iPaymentId];
            if (!pid || String(pid).toLowerCase() === "paymentid") continue;
            if (!/^\d+$/.test(String(pid))) continue;

            const facilityVal = iFacility >= 0 ? (r[iFacility] || "").toString().trim() : "";
            const appliedVal = iAppliedAmount >= 0 ? parseMoney(r[iAppliedAmount]) : 0;
            
            cleaned.push({
              paymentId: String(pid),
              payerCategory: (r[iPayerCategory] || "").toString().trim(),
              payer: (r[iPayer] || "").toString().trim(),
              paymentType: (r[iPaymentType] || "Unknown").toString(),
              checkNumber: (r[iCheck] || "").toString(),
              dateEntered: toDate(r[iDateEntered]),
              paymentDate: toDate(r[iPaymentDate]),
              paymentAmount: parseMoney(r[iPaymentAmount]),
              notes: (r[iNotes] || "").toString(),
              facility: facilityVal,
              facilityNorm: facilityVal ? normalizeFacility(facilityVal) : "",
              appliedAmount: Number.isFinite(appliedVal) ? appliedVal : 0,
            });
          }
        } else {
          // Format 1: Collected Payments format - Has facility/applied blocks
          const iPaymentId = idx("Payment ID");
          const iPayerName = idx("Payer Name");
          const iPaymentType = idx("Payment Type");
          const iCheck = idx("Check #");
          const iDateEntered = idx("Date Entered");
          const iPaymentDate = idx("Payment Date");
          const iPayment = idx("Payment");
          const iNotes = idx("Notes");

          // Iterate through rows; for each payment, attach following Facility/Applied blocks
          for (let i = 0; i < dataRows.length; i++) {
            const r = dataRows[i] || [];
            const pid = r[iPaymentId];
            const paymentLabel = (r[iPayment] ?? "").toString();
            if (!pid || String(pid).toLowerCase() === "payment id") continue;
            if (paymentLabel && /total/i.test(paymentLabel)) continue;
            if (!/^\d+$/.test(String(pid))) continue;

            const { payerCategory: cat, payer } = splitPayer(r[iPayerName]);
            const base = {
              paymentId: String(pid),
              payerCategory: cat || "",
              payer: payer || "",
              paymentType: (r[iPaymentType] || "Unknown").toString(),
              checkNumber: r[iCheck] || "",
              dateEntered: toDate(r[iDateEntered]),
              paymentDate: toDate(r[iPaymentDate]),
              paymentAmount: parseMoney(r[iPayment]),
              notes: r[iNotes] || "",
            };

            // Look ahead for a "Facility / Applied" header row, then capture the next value rows
            let j = i + 1;
            let foundFacilityBlock = false;
            while (j < dataRows.length) {
              const row = dataRows[j] || [];
              const joinedLower = row.map((c) => String(c || "").trim().toLowerCase());
              // Stop when we hit the next payment section header or a new payment row
              if (joinedLower.includes("payment id") || (/^\d+$/.test(String(row[iPaymentId] || "")))) break;

              // Detect the inline Facility/Applied header row
              const facilityHeaderIdx = joinedLower.indexOf("facility");
              const appliedHeaderIdx = joinedLower.indexOf("applied");
              if (facilityHeaderIdx !== -1 && appliedHeaderIdx !== -1) {
                // Following rows until a blank-seeming line or next section: capture facility/applied
                let k = j + 1;
                while (k < dataRows.length) {
                  const valRow = dataRows[k] || [];
                  const valLower = valRow.map((c) => String(c || "").trim().toLowerCase());
                  if (valLower.includes("facility total:")) { k++; continue; }
                  // break when we reach an empty separator or next section
                  const isSeparator = valLower.every((c) => c === "");
                  if (isSeparator) { k++; continue; }
                  if (valLower.includes("payment id") || (/^\d+$/.test(String(valRow[iPaymentId] || "")))) break;

                  const facilityVal = valRow[facilityHeaderIdx];
                  const appliedVal = valRow[appliedHeaderIdx];
                  if (facilityVal) {
                    foundFacilityBlock = true;
                    cleaned.push({
                      ...base,
                      facility: String(facilityVal),
                      facilityNorm: normalizeFacility(facilityVal),
                      appliedAmount: parseMoney(appliedVal),
                    });
                  }
                  k++;
                }
                j = k;
                break;
              }
              j++;
            }

            // If no facility block found, still emit the base row without facility
            if (!foundFacilityBlock) {
              cleaned.push({
                ...base,
                facility: "",
                facilityNorm: "",
                appliedAmount: 0,
              });
            }
          }
        }

        // Compute unapplied per payment (collected - sum(applied across facilities))
        const appliedByPayment = new Map();
        for (const row of cleaned) {
          const key = row.paymentId;
          const applied = Number.isFinite(row.appliedAmount) ? row.appliedAmount : 0;
          appliedByPayment.set(key, (appliedByPayment.get(key) || 0) + applied);
        }
        const withUnapplied = cleaned.map((row) => {
          const totalApplied = appliedByPayment.get(row.paymentId) || 0;
          const unapplied = row.paymentAmount - totalApplied;
          return { ...row, unappliedAmount: Number.isFinite(unapplied) ? unapplied : 0 };
        });

        setRows(withUnapplied);
      },
      skipEmptyLines: true,
      error: (err) => alert("Parse error: " + (err && err.message ? err.message : String(err))),
    });
  };

  const uniquePayers = useMemo(() => {
    const s = new Set(rows.map((r) => r.payer).filter(Boolean));
    return Array.from(s).sort();
  }, [rows]);

  const uniqueTypes = useMemo(() => {
    const s = new Set(rows.map((r) => r.paymentType).filter(Boolean));
    return Array.from(s).sort();
  }, [rows]);

  // Build facilities list using normalized keys to avoid dup/mismatch; keep first-seen pretty label
  const uniqueFacilities = useMemo(() => {
    const m = new Map(); // norm -> label
    for (const r of rows) {
      if (!r.facility) continue;
      const norm = r.facilityNorm;
      if (norm && !m.has(norm)) m.set(norm, r.facility.trim());
    }
    return Array.from(m, ([norm, label]) => ({ norm, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    const min = minAmt ? parseFloat(minAmt) : -Infinity;
    const max = maxAmt ? parseFloat(maxAmt) : Infinity;
    const q = search.trim().toLowerCase();
    const from = fromDate ? new Date(fromDate + "T00:00:00") : null;
    const to = toDateFilter ? new Date(toDateFilter + "T23:59:59") : null;

    return rows.filter((r) => {
      if (payerFilter.length && !payerFilter.includes(r.payer)) return false;
      if (paymentTypes.length && !paymentTypes.includes(r.paymentType)) return false;

      // ✅ robust facility filter using normalized key
      if (facilityFilter.length && !facilityFilter.includes(r.facilityNorm)) return false;

      if (r.paymentAmount < min || r.paymentAmount > max) return false;
      if (q && !(String(r.payer || "").toLowerCase().includes(q) || String(r.notes || "").toLowerCase().includes(q))) return false;
      if (from && r.dateEntered && r.dateEntered < from) return false;
      if (to && r.dateEntered && r.dateEntered > to) return false;
      return true;
    });
  }, [rows, payerFilter, paymentTypes, facilityFilter, minAmt, maxAmt, search, fromDate, toDateFilter]);

  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      setSortBy(column);
      setSortDirection('asc');
    }
  };

  const sortedFiltered = useMemo(() => {
    if (!sortBy) return filtered;
    
    const sorted = [...filtered].sort((a, b) => {
      let aVal, bVal;
      
      if (sortBy === 'paymentId') {
        aVal = parseInt(a.paymentId) || 0;
        bVal = parseInt(b.paymentId) || 0;
      } else if (sortBy === 'paymentDate') {
        aVal = a.paymentDate ? a.paymentDate.getTime() : 0;
        bVal = b.paymentDate ? b.paymentDate.getTime() : 0;
      } else if (sortBy === 'dateEntered') {
        aVal = a.dateEntered ? a.dateEntered.getTime() : 0;
        bVal = b.dateEntered ? b.dateEntered.getTime() : 0;
      } else {
        return 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [filtered, sortBy, sortDirection]);

  const daily = useMemo(() => {
    const map = new Map();
    const countMap = new Map();
    const seenPayments = new Map(); // Track which payment IDs we've already counted per date
    
    for (const r of filtered) {
      if (!r.dateEntered) continue;
      const key = r.dateEntered.toISOString().slice(0, 10);
      const paymentKey = `${key}-${r.paymentId}`;
      
      // Only count each payment ID once per day
      if (!seenPayments.has(paymentKey)) {
        seenPayments.set(paymentKey, true);
        map.set(key, (map.get(key) || 0) + r.paymentAmount);
        countMap.set(key, (countMap.get(key) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, total]) => ({ 
      date, 
      total, 
      count: countMap.get(date) || 0 
    }));
  }, [filtered]);

  const byType = useMemo(() => {
    const map = new Map();
    const countMap = new Map();
    const seenPayments = new Map(); // Track which payment IDs we've already counted per type
    
    for (const r of filtered) {
      const paymentKey = `${r.paymentType}-${r.paymentId}`;
      
      // Only count each payment ID once per type
      if (!seenPayments.has(paymentKey)) {
        seenPayments.set(paymentKey, true);
        map.set(r.paymentType, (map.get(r.paymentType) || 0) + r.paymentAmount);
        countMap.set(r.paymentType, (countMap.get(r.paymentType) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([type, total]) => ({ 
      type, 
      total, 
      count: countMap.get(type) || 0 
    }));
  }, [filtered]);

  const topPayers = useMemo(() => {
    const map = new Map();
    const countMap = new Map();
    const seenPayments = new Map(); // Track which payment IDs we've already counted per payer
    
    for (const r of filtered) {
      const paymentKey = `${r.payer}-${r.paymentId}`;
      
      // Only count each payment ID once per payer
      if (!seenPayments.has(paymentKey)) {
        seenPayments.set(paymentKey, true);
        map.set(r.payer, (map.get(r.payer) || 0) + r.paymentAmount);
        countMap.set(r.payer, (countMap.get(r.payer) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([payer, total]) => ({ 
      payer, 
      total, 
      count: countMap.get(payer) || 0 
    }));
  }, [filtered]);

  // Applied totals by facility (this is the key facility view)
  const byFacilityApplied = useMemo(() => {
    const map = new Map();
    const countMap = new Map();
    for (const r of filtered) {
      const key = r.facility || "Unspecified";
      map.set(key, (map.get(key) || 0) + (Number.isFinite(r.appliedAmount) ? r.appliedAmount : 0));
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([facility, totalApplied]) => ({ 
        facility, 
        totalApplied, 
        count: countMap.get(facility) || 0 
      }));
  }, [filtered]);

  // Unapplied by payment id: collected minus sum(applied) across facilities for that payment
  const unappliedByPayment = useMemo(() => {
    const collectedByPid = new Map();
    const appliedSumByPid = new Map();
    const labelByPid = new Map(); // prefer payer label for tooltip
    for (const r of filtered) {
      const pid = r.paymentId;
      if (!collectedByPid.has(pid)) collectedByPid.set(pid, r.paymentAmount);
      appliedSumByPid.set(pid, (appliedSumByPid.get(pid) || 0) + (Number.isFinite(r.appliedAmount) ? r.appliedAmount : 0));
      if (!labelByPid.has(pid)) labelByPid.set(pid, r.payer || "");
    }
    const out = [];
    for (const [pid, collected] of collectedByPid.entries()) {
      const applied = appliedSumByPid.get(pid) || 0;
      const unapplied = collected - applied;
      if (unapplied > 0.0001) out.push({ paymentId: pid, payer: labelByPid.get(pid) || "", unapplied });
    }
    return out.sort((a, b) => b.unapplied - a.unapplied).slice(0, 20);
  }, [filtered]);

  const totalPaymentsEntered = useMemo(() => {
    const seenPayments = new Set();
    return filtered.reduce((sum, r) => {
      if (!seenPayments.has(r.paymentId)) {
        seenPayments.add(r.paymentId);
        return sum + r.paymentAmount;
      }
      return sum;
    }, 0);
  }, [filtered]);
  
  const totalPaymentsApplied = filtered.reduce((sum, r) => sum + (Number.isFinite(r.appliedAmount) ? r.appliedAmount : 0), 0);
  
  const totalUnappliedPayments = useMemo(() => {
    const seenPayments = new Set();
    return filtered.reduce((sum, r) => {
      if (!seenPayments.has(r.paymentId)) {
        seenPayments.add(r.paymentId);
        return sum + (Number.isFinite(r.unappliedAmount) ? r.unappliedAmount : 0);
      }
      return sum;
    }, 0);
  }, [filtered]);
  
  const totalCount = useMemo(() => {
    const seenPayments = new Set();
    return filtered.reduce((count, r) => {
      if (!seenPayments.has(r.paymentId)) {
        seenPayments.add(r.paymentId);
        return count + 1;
      }
      return count;
    }, 0);
  }, [filtered]);

  // Additional metrics
  const uniquePayersCount = useMemo(() => {
    const set = new Set(filtered.map((r) => r.payer).filter(Boolean));
    return set.size;
  }, [filtered]);

  const dateRange = useMemo(() => {
    const dates = filtered
      .map((r) => r.dateEntered)
      .filter((d) => d != null)
      .map((d) => d.getTime())
      .sort((a, b) => a - b);
    if (dates.length === 0) return null;
    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);
    return { first, last, count: dates.length };
  }, [filtered]);

  const maxPayment = useMemo(() => {
    if (filtered.length === 0) return null;
    return Math.max(...filtered.map((r) => r.paymentAmount));
  }, [filtered]);

  const minPayment = useMemo(() => {
    if (filtered.length === 0) return null;
    return Math.min(...filtered.map((r) => r.paymentAmount));
  }, [filtered]);

  return (
    <div className={`min-h-screen transition-colors duration-200 ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <Logo size={50} />
            <div>
              <h1 className={`text-3xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-gray-900'}`}>Payments Dashboard</h1>
              <p className={`text-sm mt-1 font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Analyze and visualize payment data</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`inline-flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${darkMode ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
            <button
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() =>
                csvDownload(
                  filtered.map(r => ({
                    paymentId: r.paymentId,
                    payerCategory: r.payerCategory,
                    payer: r.payer,
                    paymentType: r.paymentType,
                    checkNumber: r.checkNumber,
                    dateEntered: r.dateEntered ? r.dateEntered.toISOString().slice(0, 10) : "",
                    paymentDate: r.paymentDate ? r.paymentDate.toISOString().slice(0, 10) : "",
                    paymentAmount: r.paymentAmount,
                    facility: r.facility || "",
                    appliedAmount: Number.isFinite(r.appliedAmount) ? r.appliedAmount : 0,
                    unappliedAmount: Number.isFinite(r.unappliedAmount) ? r.unappliedAmount : (r.paymentAmount - (Number.isFinite(r.appliedAmount) ? r.appliedAmount : 0)),
                    notes: r.notes
                  })),
                  "filtered_payments.csv"
                )
              }
              disabled={filtered.length === 0}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        <div className={`shadow-lg border rounded-xl overflow-hidden transition-all ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} backdrop-blur-sm`}>
          <button
            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
            className={`w-full px-6 py-4 flex items-center justify-between transition-colors ${darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-50'} ${isFiltersOpen && darkMode ? 'border-b border-gray-700' : isFiltersOpen ? 'border-b border-gray-200' : ''}`}
          >
            <div className="flex items-center gap-3">
              <svg className={`w-5 h-5 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <span className={`font-bold text-base ${darkMode ? 'text-white' : 'text-gray-900'}`}>Filters & Upload</span>
            </div>
            <svg
              className={`w-5 h-5 transition-transform duration-300 ${isFiltersOpen ? 'rotate-180' : ''} ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {isFiltersOpen && (
            <div className="p-6 bg-gradient-to-br from-transparent via-transparent to-transparent">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div>
                  <label className={`block text-sm font-semibold mb-3 tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Upload CSV File</label>
                  <div
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 ${isDragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-400 scale-105" : darkMode
                      ? "border-gray-600 bg-gray-700/50 hover:border-gray-500 hover:bg-gray-700"
                      : "border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/30"
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const files = e.dataTransfer.files;
                      if (files.length > 0 && files[0].name.endsWith(".csv")) {
                        handleFile(files[0]);
                      }
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={(e) => e.target.files && e.target.files[0] && handleFile(e.target.files[0])}
                    />
                    {fileName ? (
                      <div className="space-y-2">
                        <div className="text-green-600 font-medium">✓ {fileName}</div>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm text-blue-600 hover:text-blue-700 underline"
                        >
                          Upload different file
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <svg
                          className="mx-auto h-12 w-12 text-gray-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                          />
                        </svg>
                        <div>
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            Choose CSV File
                          </button>
                        </div>
                        <p className={`text-xs font-medium ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>or drag and drop</p>
                        <p className={`text-xs mt-2 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Supports: "Collected Payments" or "filtered_payments" CSV formats</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>From Date Entered</label>
                  <input
                    type="date"
                    className={`border rounded-lg p-2.5 w-full transition-all focus:ring-2 focus:outline-none font-medium ${darkMode
                      ? 'bg-gray-700/50 border-gray-600 text-white focus:border-blue-500 focus:ring-blue-500/20'
                      : 'bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                      }`}
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                  <label className={`block text-sm font-semibold mt-2 tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>To Date Entered</label>
                  <input
                    type="date"
                    className={`border rounded-lg p-2.5 w-full transition-all focus:ring-2 focus:outline-none font-medium ${darkMode
                      ? 'bg-gray-700/50 border-gray-600 text-white focus:border-blue-500 focus:ring-blue-500/20'
                      : 'bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                      }`}
                    value={toDateFilter}
                    onChange={(e) => setToDateFilter(e.target.value)}
                  />
                </div>

                <div className="space-y-3">
                  <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Payer</label>
                  <div className={`max-h-56 overflow-auto rounded-xl border p-3 transition-all ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-300'}`}>
                    {uniquePayers.map((p) => (
                      <label key={p} className={`flex items-center gap-2 py-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <input
                          type="checkbox"
                          checked={payerFilter.includes(p)}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setPayerFilter((prev) => (v ? [...prev, p] : prev.filter((x) => x !== p)));
                          }}
                          className="rounded"
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                    {uniquePayers.length === 0 && <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Upload a CSV to see payers</div>}
                  </div>

                  <label className={`block text-sm font-semibold mt-2 tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Search payer/notes</label>
                  <input
                    className={`border rounded-lg p-2.5 w-full transition-all focus:ring-2 focus:outline-none font-medium ${darkMode
                      ? 'bg-gray-700/50 border-gray-600 text-white placeholder-gray-500 focus:border-blue-500 focus:ring-blue-500/20'
                      : 'bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                      }`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Type to filter..."
                  />

                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div>
                      <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Min $</label>
                      <input
                        className={`border rounded-lg p-2.5 w-full transition-all focus:ring-2 focus:outline-none font-medium ${darkMode
                          ? 'bg-gray-700/50 border-gray-600 text-white focus:border-blue-500 focus:ring-blue-500/20'
                          : 'bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                          }`}
                        inputMode="decimal"
                        value={minAmt}
                        onChange={(e) => setMinAmt(e.target.value)}
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Max $</label>
                      <input
                        className={`border rounded-lg p-2.5 w-full transition-all focus:ring-2 focus:outline-none font-medium ${darkMode
                          ? 'bg-gray-700/50 border-gray-600 text-white focus:border-blue-500 focus:ring-blue-500/20'
                          : 'bg-white border-gray-300 focus:border-blue-500 focus:ring-blue-500/20'
                          }`}
                        inputMode="decimal"
                        value={maxAmt}
                        onChange={(e) => setMaxAmt(e.target.value)}
                        placeholder=""
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Payment types</label>
                  <div className={`max-h-56 overflow-auto rounded-xl border p-3 transition-all ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-300'}`}>
                    {uniqueTypes.map((t) => (
                      <label key={t} className={`flex items-center gap-2 py-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <input
                          type="checkbox"
                          checked={paymentTypes.includes(t)}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setPaymentTypes((prev) => (v ? [...prev, t] : prev.filter((x) => x !== t)));
                          }}
                          className="rounded"
                        />
                        <span>{t}</span>
                      </label>
                    ))}
                    {uniqueTypes.length === 0 && <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Upload a CSV to see types</div>}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className={`block text-sm font-semibold tracking-wide ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Facilities / Clinics</label>
                  <div className={`max-h-56 overflow-auto rounded-xl border p-3 transition-all ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-white border-gray-300'}`}>
                    {uniqueFacilities.map((f) => (
                      <label key={f.norm} className={`flex items-center gap-2 py-1 text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <input
                          type="checkbox"
                          checked={facilityFilter.includes(f.norm)}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setFacilityFilter((prev) => (v ? [...prev, f.norm] : prev.filter((x) => x !== f.norm)));
                          }}
                          className="rounded"
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}
                    {uniqueFacilities.length === 0 && <div className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Upload a CSV to see facilities</div>}
                  </div>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>Facility metrics below use <strong>Applied</strong> amounts.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="space-y-4">
            <div className={`grid grid-cols-1 md:grid-cols-3 gap-4 shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
              <div className={`rounded-lg p-4 transition-colors ${darkMode ? 'bg-blue-900/30 border-blue-700' : 'bg-blue-50 border-blue-200'} border`}>
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className={`h-8 w-8 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-900'}`}>Total Payments Entered</p>
                    <p className={`text-2xl font-semibold ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>${totalPaymentsEntered.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <div className={`rounded-lg p-4 transition-colors ${darkMode ? 'bg-green-900/30 border-green-700' : 'bg-green-50 border-green-200'} border`}>
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className={`h-8 w-8 ${darkMode ? 'text-green-400' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className={`text-sm font-medium ${darkMode ? 'text-green-300' : 'text-green-900'}`}>Total Payments Applied</p>
                    <p className={`text-2xl font-semibold ${darkMode ? 'text-green-400' : 'text-green-600'}`}>${totalPaymentsApplied.toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <div className={`rounded-lg p-4 transition-colors ${darkMode ? 'bg-orange-900/30 border-orange-700' : 'bg-orange-50 border-orange-200'} border`}>
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <svg className={`h-8 w-8 ${darkMode ? 'text-orange-400' : 'text-orange-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <p className={`text-sm font-medium ${darkMode ? 'text-orange-300' : 'text-orange-900'}`}>Total Unapplied Payments</p>
                    <p className={`text-2xl font-semibold ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>${totalUnappliedPayments.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>

            {filtered.length > 0 && (
              <div className={`grid grid-cols-1 md:grid-cols-4 gap-3 shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                <div className={`rounded-lg p-3 border transition-colors ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-yellow-50 border-yellow-200'}`}>
                  <p className={`text-xs font-medium ${darkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>Unique Payers</p>
                  <p className={`text-xl font-bold ${darkMode ? 'text-yellow-400' : 'text-yellow-600'}`}>{uniquePayersCount}</p>
                </div>
                <div className={`rounded-lg p-3 border transition-colors ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-indigo-50 border-indigo-200'}`}>
                  <p className={`text-xs font-medium ${darkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>Max Payment</p>
                  <p className={`text-lg font-bold ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>
                    {maxPayment !== null ? `$${maxPayment.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div className={`rounded-lg p-3 border transition-colors ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-pink-50 border-pink-200'}`}>
                  <p className={`text-xs font-medium ${darkMode ? 'text-pink-300' : 'text-pink-800'}`}>Min Payment</p>
                  <p className={`text-lg font-bold ${darkMode ? 'text-pink-400' : 'text-pink-600'}`}>
                    {minPayment !== null ? `$${minPayment.toFixed(2)}` : 'N/A'}
                  </p>
                </div>
                <div className={`rounded-lg p-3 border transition-colors ${darkMode ? 'bg-gray-700/50 border-gray-600' : 'bg-cyan-50 border-cyan-200'}`}>
                  <p className={`text-xs font-medium ${darkMode ? 'text-cyan-300' : 'text-cyan-800'}`}>Date Entered Range</p>
                  <p className={`text-xs font-bold ${darkMode ? 'text-cyan-400' : 'text-cyan-600'}`}>
                    {dateRange ? `${dateRange.count} days` : 'N/A'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="lg:col-span-2">
            <h2 className={`font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Daily totals (by Date Entered)</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
                  <defs>
                    <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={1} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={1} />
                    </linearGradient>
                    <linearGradient id="fillGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="date"
                    stroke={darkMode ? '#9ca3af' : '#6b7280'}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fontSize: 12, fontWeight: 500 }}
                    tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  />
                  <YAxis
                    stroke={darkMode ? '#9ca3af' : '#6b7280'}
                    tick={{ fontSize: 12, fontWeight: 500 }}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                      border: darkMode ? '1px solid #4b5563' : '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: darkMode ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)'
                    }}
                    labelStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }}
                    formatter={(value, name, props) => [
                      `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${props.payload.count} transactions)`,
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ color: darkMode ? '#d1d5db' : ' #111827', fontWeight: 600 }} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Daily Total"
                    stroke="url(#lineGradient)"
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 6, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <h2 className={`font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Totals by payment type</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byType} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={1} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.5} />
                  <XAxis
                    dataKey="type"
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={80}
                    stroke={darkMode ? '#9ca3af' : '#6b7280'}
                    tick={{ fontSize: 11, fontWeight: 500 }}
                  />
                  <YAxis
                    stroke={darkMode ? '#9ca3af' : '#6b7280'}
                    tick={{ fontSize: 12, fontWeight: 500 }}
                    tickFormatter={(value) => `$${value.toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                      border: darkMode ? '1px solid #4b5563' : '1px solid #e5e7eb',
                      borderRadius: '8px',
                      boxShadow: darkMode ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)'
                    }}
                    labelStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }}
                    formatter={(value, name, props) => [
                      `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${props.payload.count} transactions)`,
                      name
                    ]}
                  />
                  <Legend wrapperStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }} />
                  <Bar
                    dataKey="total"
                    name="Amount"
                    fill="url(#barGradient)"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className={`shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>Top payers</h2>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Showing: {filtered.length} transactions</div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topPayers} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
                <defs>
                  <linearGradient id="topPayersGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={1} />
                    <stop offset="100%" stopColor="#059669" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.5} />
                <XAxis
                  dataKey="payer"
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                  stroke={darkMode ? '#9ca3af' : '#6b7280'}
                  tick={{ fontSize: 11, fontWeight: 500 }}
                />
                <YAxis
                  stroke={darkMode ? '#9ca3af' : '#6b7280'}
                  tick={{ fontSize: 12, fontWeight: 500 }}
                  tickFormatter={(value) => `$${value.toLocaleString()}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                    border: darkMode ? '1px solid #4b5563' : '1px solid #e5e7eb',
                    borderRadius: '8px',
                    boxShadow: darkMode ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                  labelStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }}
                  formatter={(value, name, props) => [
                    `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${props.payload.count} transactions)`,
                    name
                  ]}
                />
                <Legend wrapperStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }} />
                <Bar
                  dataKey="total"
                  name="Amount"
                  fill="url(#topPayersGradient)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>Totals by facility (Applied)</h2>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Uses “Applied” amounts</div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byFacilityApplied} margin={{ top: 10, right: 20, bottom: 60, left: 0 }}>
                <defs>
                  <linearGradient id="facilityAppliedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity={1} />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity={1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} strokeOpacity={0.5} />
                <XAxis dataKey="facility" interval={0} angle={-30} textAnchor="end" height={80}
                  stroke={darkMode ? '#9ca3af' : '#6b7280'} tick={{ fontSize: 11, fontWeight: 500 }} />
                <YAxis stroke={darkMode ? '#9ca3af' : '#6b7280'} tick={{ fontSize: 12, fontWeight: 500 }}
                  tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <Tooltip contentStyle={{
                  backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                  border: darkMode ? '1px solid #4b5563' : '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: darkMode ? '0 4px 6px rgba(0,0,0,0.3)' : '0 4px 6px rgba(0,0,0,0.1)'
                }}
                  labelStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }}
                  formatter={(value, name, props) => [
                    `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })} (${props.payload.count} transactions)`,
                    "Applied"
                  ]} />
                <Legend wrapperStyle={{ color: darkMode ? '#d1d5db' : '#111827', fontWeight: 600 }} />
                <Bar dataKey="totalApplied" name="Applied" fill="url(#facilityAppliedGradient)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>Unapplied by payment</h2>
            <div className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Top 20 transactions with remaining unapplied</div>
          </div>
          <div className={`overflow-auto border rounded-md max-h-96 ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payment ID</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payer</th>
                  <th className={`text-right p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Unapplied Amount</th>
                </tr>
              </thead>
              <tbody>
                {unappliedByPayment.map((item) => (
                  <tr
                    key={item.paymentId}
                    className={`${darkMode ? 'border-gray-700' : 'border-gray-200'} border-t hover:bg-opacity-50 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}
                  >
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{item.paymentId}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{item.payer}</td>
                    <td className={`p-2 text-right font-semibold ${darkMode ? 'text-orange-400' : 'text-orange-600'}`}>
                      ${item.unapplied.toFixed(2)}
                    </td>
                  </tr>
                ))}
                {unappliedByPayment.length === 0 && (
                  <tr>
                    <td colSpan="3" className={`p-4 text-center ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>No unapplied payments found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`shadow-sm border rounded-lg p-4 transition-colors ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          <h2 className={`font-medium mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>Filtered rows</h2>
          <div className={`overflow-auto border rounded-md max-h-96 ${darkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={`${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                  <th 
                    className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'} cursor-pointer hover:bg-opacity-80 select-none`}
                    onClick={() => handleSort('paymentId')}
                  >
                    <div className="flex items-center gap-1">
                      Payment ID
                      {sortBy === 'paymentId' && (
                        <span className="text-xs">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Facility</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payer Category</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payer</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Payment Type</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Check #</th>
                  <th 
                    className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'} cursor-pointer hover:bg-opacity-80 select-none`}
                    onClick={() => handleSort('dateEntered')}
                  >
                    <div className="flex items-center gap-1">
                      Date Entered
                      {sortBy === 'dateEntered' && (
                        <span className="text-xs">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th 
                    className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'} cursor-pointer hover:bg-opacity-80 select-none`}
                    onClick={() => handleSort('paymentDate')}
                  >
                    <div className="flex items-center gap-1">
                      Payment Date
                      {sortBy === 'paymentDate' && (
                        <span className="text-xs">
                          {sortDirection === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                  <th className={`text-right p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Amount</th>
                  <th className={`text-right p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Applied</th>
                  <th className={`text-right p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Unapplied</th>
                  <th className={`text-left p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((r, idx) => (
                  <tr
                    key={`${r.paymentId}-${r.facility}-${idx}`}
                    className={`${darkMode ? 'border-gray-700' : 'border-gray-200'} border-t hover:bg-opacity-50 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'}`}
                  >
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.paymentId}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.facility}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.payerCategory}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.payer}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.paymentType}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.checkNumber}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.dateEntered ? r.dateEntered.toISOString().slice(0, 10) : ""}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.paymentDate ? r.paymentDate.toISOString().slice(0, 10) : ""}</td>
                    <td className={`p-2 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.paymentAmount.toFixed(2)}</td>
                    <td className={`p-2 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{Number.isFinite(r.appliedAmount) ? r.appliedAmount.toFixed(2) : ""}</td>
                    <td className={`p-2 text-right ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{Number.isFinite(r.unappliedAmount) ? r.unappliedAmount.toFixed(2) : ""}</td>
                    <td className={`p-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{r.notes}</td>
                  </tr>
                ))}
                {sortedFiltered.length === 0 && (
                  <tr>
                    <td colSpan="12" className={`p-4 text-center ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>No rows match your filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
