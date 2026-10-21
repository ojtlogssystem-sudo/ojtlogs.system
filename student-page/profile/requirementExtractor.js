// ==========================================
// requirementExtractor.js
// Binabasa ang na-upload na OJT Acceptance Form (PDF o larawan) at
// kinukuha ang mga detalye para i-prefill sa profile setup:
//   Company name, To report to (supervisor), Job Title,
//   Working Hours and days, To complete (required hours), Effective Date
//
// - PDF na may text  -> pdf.js (mabilis at tama)
// - Scanned PDF / JPG / PNG -> Tesseract.js (OCR, nagbabasa ng printed text;
//   hindi maaasahan ang handwriting kaya laging editable ang resulta)
// ==========================================

const PDFJS_URL    = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

const scriptCache = {};
function loadScript(src) {
    if (!scriptCache[src]) {
        scriptCache[src] = new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error("Could not load " + src));
            document.head.appendChild(s);
        });
    }
    return scriptCache[src];
}

// ------------------------------------------
// 1) PAGBASA NG FILE -> MGA LINYA NG TEXT
// ------------------------------------------

// Pagsamahin ang mga text item ng pdf.js na nasa iisang linya
function groupPdfItems(items) {
    const rows = new Map();
    items.forEach((it) => {
        if (!it.str || !it.str.trim()) return;
        const y = Math.round(it.transform[5] / 3);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push(it);
    });

    return [...rows.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, row]) => {
            row.sort((a, b) => a.transform[4] - b.transform[4]);
            let line = "";
            let prevEnd = null;
            row.forEach((it) => {
                const x = it.transform[4];
                if (prevEnd !== null) {
                    const gap = x - prevEnd;
                    line += gap > 14 ? " | " : (gap > 1 ? " " : "");
                }
                line += it.str;
                prevEnd = x + (it.width || 0);
            });
            return line.trim();
        })
        .filter(Boolean);
}

async function ocrImage(source, onStatus) {
    if (onStatus) onStatus("Reading scanned document…");
    await loadScript(TESSERACT_URL);
    const result = await window.Tesseract.recognize(source, "eng");
    return String(result.data.text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
}

async function readPdfLines(file, onStatus) {
    await loadScript(PDFJS_URL);
    const pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = Math.min(pdf.numPages, 2);
    let lines = [];

    for (let p = 1; p <= pages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        lines = lines.concat(groupPdfItems(content.items));
    }

    // Walang text layer = scanned PDF -> i-render ang unang page tapos OCR
    if (lines.join("").replace(/\s/g, "").length < 40) {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        lines = await ocrImage(canvas, onStatus);
    }

    return lines;
}

export async function readDocumentLines(file, onStatus) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    return isPdf ? readPdfLines(file, onStatus) : ocrImage(file, onStatus);
}

// ------------------------------------------
// 2) PARSING (pure functions - walang DOM)
// ------------------------------------------

const LABEL_PATTERNS = {
    jobTitle:   /j[o0]b\s*t[i1l]tle/i,
    supervisor: /to\s*report\s*to/i,
    hours:      /working\s*hours(?:\s*(?:and|&)\s*days)?/i,
    required:   /to\s*complete(?:\s*\(?\s*required\s*hours\s*\)?)?/i,
    effective:  /effective\s*date/i
};

const STOP_LINE = /^(noted\s*by|conform|company\s*representative|position\b|student\b|ojt\s*coordinator|touching\s*hearts|page\s*\d|contact\s*no)/i;

function isLabelLine(line) {
    return Object.values(LABEL_PATTERNS).some((re) => re.test(line));
}

function cleanValue(v) {
    return String(v || "")
        .replace(/\s*\|\s*/g, " ")
        .replace(/^[\s:|_\-–—.]+/, "")
        .replace(/[\s|_]+$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

// Kunin ang value sa tabi (o sa ilalim) ng isang label
function valueAfterLabel(lines, key, extraLines = 0) {
    const re = LABEL_PATTERNS[key];
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(re);
        if (!m) continue;

        const parts = [];
        const rest = cleanValue(lines[i].slice(m.index + m[0].length));
        if (rest) parts.push(rest);

        let j = i + 1;
        const maxParts = 1 + extraLines;
        while (parts.length < maxParts && j < lines.length) {
            const next = lines[j];
            if (isLabelLine(next) || STOP_LINE.test(next)) break;
            const c = cleanValue(next);
            if (c) parts.push(c);
            j++;
        }
        const value = parts.join(" ").trim();
        if (value) return value;
    }
    return "";
}

function extractCompany(lines) {
    const full = lines.join(" ").replace(/\s*\|\s*/g, " ").replace(/\s{2,}/g, " ");
    const m = full.match(/practicum\s+in\s*(?:\(\s*company\s*name\s*\))?[\s:]*(.+?)\s*,?\s*located\s+at/i);
    return m ? cleanValue(m[1].replace(/\(\s*company\s*name\s*\)/ig, "")) : "";
}

// ---------- ARAW ----------
const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_TOKEN = "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)";

function dayIndex(token) {
    const t = token.toLowerCase().slice(0, 3);
    return DAY_ORDER.findIndex((d) => d.toLowerCase().startsWith(t));
}

export function parseDays(text) {
    const src = String(text || "");
    const picked = new Set();

    // "M-F", "MWF", "TTh", "MTWThF"
    if (/\bM\s*[-–]\s*F\b/.test(src)) [0, 1, 2, 3, 4].forEach((i) => picked.add(i));
    if (/\bMTWT?h?F\b/.test(src)) [0, 1, 2, 3, 4].forEach((i) => picked.add(i));
    if (/\bMWF\b/.test(src)) [0, 2, 4].forEach((i) => picked.add(i));
    if (/\bT\s*\/?\s*Th\b/.test(src)) [1, 3].forEach((i) => picked.add(i));

    // "Monday to Friday", "Mon - Fri"
    const rangeRe = new RegExp(`\\b${DAY_TOKEN}\\b\\s*(?:to|until|thru|through|-|–|—)\\s*\\b${DAY_TOKEN}\\b`, "gi");
    let rest = src.replace(rangeRe, (_, a, b) => {
        let s = dayIndex(a);
        const e = dayIndex(b);
        if (s < 0 || e < 0) return " ";
        for (let guard = 0; guard < 8; guard++) {
            picked.add(s);
            if (s === e) break;
            s = (s + 1) % 7;
        }
        return " ";
    });

    // "Monday, Wednesday and Friday"
    const singleRe = new RegExp(`\\b${DAY_TOKEN}\\b`, "gi");
    let m;
    while ((m = singleRe.exec(rest))) picked.add(dayIndex(m[1]));

    return [...picked].filter((i) => i >= 0).sort((a, b) => a - b).map((i) => DAY_ORDER[i]);
}

// ---------- ORAS ----------
function to24h(hour, minute, meridiem) {
    let h = hour % 12;
    if (meridiem === "pm") h += 12;
    return h * 60 + (minute || 0);
}

function fmt(mins) {
    const h = String(Math.floor(mins / 60)).padStart(2, "0");
    const m = String(mins % 60).padStart(2, "0");
    return `${h}:${m}`;
}

export function parseTimeRanges(text) {
    const src = String(text || "").replace(/\./g, "");
    const t = "(\\d{1,2})(?::(\\d{2}))?\\s*([ap]m)?";
    const re = new RegExp(`${t}\\s*(?:-|–|—|to|until)\\s*${t}`, "gi");
    const ranges = [];
    let m;

    while ((m = re.exec(src))) {
        const h1 = parseInt(m[1], 10), min1 = m[2] ? parseInt(m[2], 10) : 0, ap1 = m[3] ? m[3].toLowerCase() : null;
        const h2 = parseInt(m[4], 10), min2 = m[5] ? parseInt(m[5], 10) : 0, ap2 = m[6] ? m[6].toLowerCase() : null;
        if (h1 > 12 || h2 > 12 || h1 < 1 || h2 < 1 || min1 > 59 || min2 > 59) continue;

        let end, start;
        if (ap2) {
            end = to24h(h2, min2, ap2);
            if (ap1) {
                start = to24h(h1, min1, ap1);
            } else {
                start = to24h(h1, min1, ap2);
                if (start >= end) start = to24h(h1, min1, ap2 === "pm" ? "am" : "pm");
            }
        } else if (ap1) {
            start = to24h(h1, min1, ap1);
            end = to24h(h2, min2, start >= 12 * 60 ? "pm" : (h2 < h1 || h2 === 12 ? "pm" : "am"));
        } else {
            // walang AM/PM: 7-11 = umaga, 12 = tanghali, 1-6 = hapon
            const guess = (h) => (h >= 1 && h <= 6 ? "pm" : "am");
            start = to24h(h1, min1, guess(h1));
            end = to24h(h2, min2, guess(h2));
        }
        if (end > start) ranges.push({ start, end });
    }
    return ranges;
}

export function parseSchedule(text) {
    const days = parseDays(text);
    const ranges = parseTimeRanges(text);
    let morning = null, afternoon = null, lunchAssumed = false;

    if (ranges.length >= 2) {
        const sorted = ranges.slice(0, 2).sort((a, b) => a.start - b.start);
        morning = { timeIn: fmt(sorted[0].start), timeOut: fmt(sorted[0].end) };
        afternoon = { timeIn: fmt(sorted[1].start), timeOut: fmt(sorted[1].end) };
    } else if (ranges.length === 1) {
        const { start, end } = ranges[0];
        if (end <= 12 * 60 + 30) {
            morning = { timeIn: fmt(start), timeOut: fmt(end) };
        } else if (start >= 12 * 60) {
            afternoon = { timeIn: fmt(start), timeOut: fmt(end) };
        } else {
            // Isang tuloy-tuloy na range (hal. 8AM-5PM): hatiin sa tanghali, 1 oras na lunch
            morning = { timeIn: fmt(start), timeOut: "12:00" };
            afternoon = { timeIn: "13:00", timeOut: fmt(end) };
            lunchAssumed = true;
        }
    }
    return { days, morning, afternoon, lunchAssumed };
}

// ---------- PETSA ----------
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y, m, d) {
    if (y < 100) y += 2000;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return "";
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(text) {
    const s = String(text || "").trim();
    let m;

    // 2026-10-13
    if ((m = s.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return iso(+m[1], +m[2], +m[3]);

    // October 13, 2026 / Oct. 13 2026
    if ((m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})/))) {
        const mi = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
        if (mi >= 0) return iso(+m[3], mi + 1, +m[2]);
    }

    // 13 October 2026
    if ((m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/))) {
        const mi = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
        if (mi >= 0) return iso(+m[3], mi + 1, +m[1]);
    }

    // 10/13/2026 (mm/dd/yyyy) - kung ang una ay > 12, dd/mm/yyyy
    if ((m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
        let a = +m[1], b = +m[2];
        if (a > 12 && b <= 12) [a, b] = [b, a];
        return iso(+m[3], a, b);
    }
    return "";
}

export function parseRequiredHours(text) {
    const m = String(text || "").match(/(\d{2,4})/);
    return m ? parseInt(m[1], 10) : null;
}

// ---------- BUONG FORM ----------
export function parseAcceptanceForm(lines) {
    const company = extractCompany(lines);
    const supervisor = valueAfterLabel(lines, "supervisor");
    const jobTitle = valueAfterLabel(lines, "jobTitle", 1);
    const hoursText = valueAfterLabel(lines, "hours", 2);
    const requiredText = valueAfterLabel(lines, "required");
    const effectiveText = valueAfterLabel(lines, "effective");

    const schedule = parseSchedule(hoursText);

    return {
        company,
        supervisor,
        jobTitle,
        hoursText,
        requiredHours: parseRequiredHours(requiredText),
        effectiveDate: parseDate(effectiveText),
        ...schedule
    };
}

export async function extractFromAcceptanceFile(file, onStatus) {
    const lines = await readDocumentLines(file, onStatus);
    return parseAcceptanceForm(lines);
}