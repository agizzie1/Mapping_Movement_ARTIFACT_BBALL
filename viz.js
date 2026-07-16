// =============================================================================
// Men's basketball transfer portal flow diagram -- two-ring radial layout
// (roster / portal entries) plus chord ribbons showing player movement.
//
// Adapted from the football project's viz.js. Unlike football, D1 men's
// basketball has no FBS/FCS-style tier split -- every conference is one
// single universe, so this drops prepareCombined/renderCombined and the
// tab UI entirely; there's just one ring, one legend, one filter bar.
// Prior-transfer history is also out of scope for this diagram (per the
// build's instructions), so there's no "Prior transfers" filter dimension
// here, and playerMetaHtml() only shows position + class.
// =============================================================================

const PALETTE = {
  conferences: ["ACC", "America East", "American", "ASUN", "Atlantic 10", "Big 12", "Big East", "Big Sky", "Big South", "Big Ten", "Big West", "CAA", "Conference USA", "Horizon League", "Ivy League", "MAAC", "MAC", "MEAC", "Missouri Valley", "Mountain West", "Northeast", "Ohio Valley", "Pac-12", "Patriot League", "SEC", "SWAC", "Southern", "Southland", "Summit League", "Sun Belt", "United Athletic", "West Coast"],
  light: ["#b9495d", "#df6c64", "#d15a46", "#b95227", "#f99652", "#cd7100", "#935500", "#dbab2b", "#b49c00", "#857400", "#a2b135", "#649313", "#398933", "#32ad6c", "#00a067", "#00997d", "#00afa3", "#00adb3", "#008ab4", "#00bae2", "#0084bf", "#0069ab", "#51b3ff", "#346fcb", "#4a5cb7", "#928cf1", "#8d74de", "#a56cc8", "#c17ad1", "#ba559d", "#ae4b85", "#d96a91"],
  dark:  ["#ac344d", "#d25852", "#c24834", "#b74915", "#d7711e", "#cc6d00", "#904f00", "#b98800", "#9e8400", "#897700", "#8a9700", "#4b7900", "#207b1a", "#009f5a", "#009158", "#009576", "#00a697", "#00a2ac", "#0086b3", "#00a3cd", "#0074b1", "#0067ae", "#2397e8", "#225fbd", "#4455b7", "#8179e2", "#7f64d0", "#985abb", "#b368c4", "#ab448f", "#a13877", "#cc5682"],
};

const SCHOOL_PAD = 0.0022;
const CONF_PAD = 0.028;
const MIN_PORTAL_WEIGHT = 0.6; // visual floor so 0-entry schools still get a sliver
const MIN_FLOW_ANGLE = 0.015; // visual floor so a 1-2 player flow's ribbon origin isn't a sub-pixel sliver
const ZOOM_DETAIL_THRESHOLD = 3; // zoom scale (k) past which individual player lines become interactive
const ZOOM_OUT_FLOOR = 0.4; // how far below 100% the +/- buttons, Ctrl/Cmd+scroll, and pinch can shrink the diagram
// Basketball's ~2,200 portal entries spread across ~370 schools is a lower
// density than either of football's universes, so individual player ticks
// are proportionally wider at rest -- a lower zoom ceiling reaches
// comfortable tick width sooner than football's FBS (150) or FCS (30) needed.
const MAX_ZOOM = 22;

function currentMode() {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getDirection(key) {
  const el = document.querySelector(`input[name="dir-${key}"]:checked`);
  return el ? el.value : "both";
}

// ---------------------------------------------------------------------------
// Ring layout: groups (already sorted by conference then school) laid out
// around the full circle, weighted by `weightFn`, with a small pad between
// schools and a larger pad at conference boundaries (including the
// wrap-around gap between the last and first conference -- the total pad
// budget below is chosen so that gap comes out to exactly one confPad with
// no extra bookkeeping; see the derivation this matches in the corresponding
// design notes).
// ---------------------------------------------------------------------------
function layoutRing(items, conferenceOrder, weightFn) {
  const sorted = items.slice().sort((a, b) =>
    conferenceOrder.indexOf(a.conference) - conferenceOrder.indexOf(b.conference) ||
    a.school.localeCompare(b.school)
  );
  const nConf = conferenceOrder.length;
  const n = sorted.length;
  const totalWeight = d3.sum(sorted, weightFn);
  const totalPad = (n - nConf) * SCHOOL_PAD + nConf * CONF_PAD;
  const scale = (2 * Math.PI - totalPad) / totalWeight;

  let angle = 0;
  let prevConf = null;
  const out = [];
  for (const s of sorted) {
    if (prevConf !== null) angle += (s.conference !== prevConf) ? CONF_PAD : SCHOOL_PAD;
    const width = weightFn(s) * scale;
    out.push(Object.assign({}, s, { startAngle: angle, endAngle: angle + width }));
    angle += width;
    prevConf = s.conference;
  }
  return out;
}

function conferenceSpans(ringLayout, conferenceOrder) {
  const spans = new Map();
  for (const c of conferenceOrder) {
    const items = ringLayout.filter(d => d.conference === c);
    if (!items.length) continue;
    spans.set(c, {
      conference: c,
      startAngle: items[0].startAngle,
      endAngle: items[items.length - 1].endAngle,
      portalEntries: d3.sum(items, d => d.portalEntries),
      roster: d3.sum(items, d => d.roster),
      schools: items,
    });
  }
  return spans;
}

// Subdivide a span's angular range among its outgoing flows (largest first),
// then whatever is left over. `total` is the true denominator (real
// portal-entry count, NOT the floored/visual weight used for arc sizing) so
// the tracked flows' combined share of the span reflects reality even for
// the tiny-sliver zero-entry case -- the leftover bucket's width depends on
// that combined share landing in the same place it always has.
//
// Within that combined tracked share, individual flows are sized by
// sqrt(count) rather than raw count (mirroring the sqrt weighting already
// used for ribbon opacity) and given a small capped floor, so a 1-player
// flow sharing a span with a 5-player flow gets a visibly real sliver
// instead of a sub-pixel hairline, without flattening every flow in a
// crowded span to the same width.
function subdivide(span, flows, total) {
  const sorted = flows.slice().sort((a, b) => b.count - a.count);
  const arcSpan = span.endAngle - span.startAngle;
  const denom = Math.max(total, 1e-9);
  const trackedSpan = arcSpan * Math.min(d3.sum(sorted, f => f.count) / denom, 1);
  const n = sorted.length;
  const minWidth = n > 0 ? Math.min(MIN_FLOW_ANGLE, (trackedSpan * 0.6) / n) : 0;
  const flexSpan = Math.max(trackedSpan - minWidth * n, 0);
  const weights = sorted.map(f => Math.sqrt(f.count));
  const weightSum = d3.sum(weights) || 1;
  let a = span.startAngle;
  const segments = [];
  sorted.forEach((f, i) => {
    const w = minWidth + (weights[i] / weightSum) * flexSpan;
    segments.push({ target: f.target, count: f.count, startAngle: a, endAngle: a + w });
    a += w;
  });
  return { segments, leftoverStart: a, leftoverEnd: span.endAngle };
}

// Evenly split an angular range among a list of items (used to lay out
// individual player lines within a destination segment or the leftover
// segment). Returns [] for an empty list rather than dividing by zero.
function evenTicks(startAngle, endAngle, items) {
  const n = items.length;
  if (n === 0) return [];
  const w = (endAngle - startAngle) / n;
  return items.map((item, i) => ({ item, startAngle: startAngle + i * w, endAngle: startAngle + (i + 1) * w }));
}

// Look up the precise angular slice a conference/school's INCOMING
// subdivision (confSubIncoming / schoolSubIncoming) allocated to a specific
// sender, for use as a ribbon's target endpoint. Falls back to the full
// span if not found (shouldn't happen for a real flow, but keeps a missing
// entry from throwing rather than just drawing a slightly-off ribbon).
function incomingSegment(subIncomingMap, targetKey, sourceKey, fallbackSpan) {
  const sub = subIncomingMap.get(targetKey);
  const seg = sub && sub.segments.find(s => s.target === sourceKey);
  return seg || fallbackSpan;
}

// Split a school's raw departures list into per-destination groups (for
// tracked targets -- real D1 conferences, per `isTracked`) and a leftover
// bucket (still in the portal / uncommitted, or left D1 entirely).
function classifyDepartures(departures, isTracked) {
  const byTarget = new Map();
  const leftover = [];
  for (const dep of departures || []) {
    if (isTracked(dep.tc)) {
      if (!byTarget.has(dep.t)) byTarget.set(dep.t, []);
      byTarget.get(dep.t).push(dep);
    } else {
      leftover.push(dep);
    }
  }
  return { byTarget, leftover };
}
function buildSchoolPlayers(layoutItems, isTracked) {
  const m = new Map();
  for (const s of layoutItems) m.set(s.school, classifyDepartures(s.departures, isTracked));
  return m;
}

function polar(angle, radius, offset) {
  const ox = offset ? offset[0] : 0, oy = offset ? offset[1] : 0;
  return [ox + radius * Math.sin(angle), oy - radius * Math.cos(angle)];
}

function midAngle(d) { return (d.startAngle + d.endAngle) / 2; }

// ---------------------------------------------------------------------------
// Build everything needed to render the diagram.
// ---------------------------------------------------------------------------
function prepareUniverse(data, conferenceOrder) {
  const schools = data.schools;
  const outerLayout = layoutRing(schools, conferenceOrder, d => d.roster);
  const innerLayout = layoutRing(schools, conferenceOrder, d => Math.max(d.portalEntries, MIN_PORTAL_WEIGHT));

  const outerByName = new Map(outerLayout.map(d => [d.school, d]));
  const innerByName = new Map(innerLayout.map(d => [d.school, d]));

  const flowsBySource = new Map();
  const flowsByTarget = new Map();
  for (const f of data.flows) {
    if (!flowsBySource.has(f.source)) flowsBySource.set(f.source, []);
    flowsBySource.get(f.source).push(f);
    if (!flowsByTarget.has(f.target)) flowsByTarget.set(f.target, []);
    flowsByTarget.get(f.target).push(f);
  }

  // Per-school subdivision of the inner arc among its own outgoing flows.
  const schoolSub = new Map();
  for (const s of innerLayout) {
    const flows = flowsBySource.get(s.school) || [];
    schoolSub.set(s.school, subdivide(s, flows, s.portalEntries));
  }

  // Mirror of schoolSub for INCOMING flows: subdivides the same arc among
  // the schools this one received players FROM. A ribbon's target endpoint
  // uses THIS map's segment instead of the whole destination arc, or the
  // ribbon flares out to the destination's total size regardless of how
  // many players that specific flow represents.
  const schoolSubIncoming = new Map();
  for (const s of innerLayout) {
    const inFlows = (flowsByTarget.get(s.school) || []).map(f => ({ target: f.source, count: f.count }));
    const totalIn = d3.sum(inFlows, f => f.count);
    schoolSubIncoming.set(s.school, subdivide(s, inFlows, totalIn));
  }

  // Per-school, per-destination lists of the actual departing players, used
  // to draw individual lines within each segment on zoom.
  const confSet = new Set(conferenceOrder);
  const schoolPlayers = buildSchoolPlayers(innerLayout, tc => confSet.has(tc));

  // Conference-level aggregate (the default, always-visible chord view).
  const innerConfSpans = conferenceSpans(innerLayout, conferenceOrder);
  const flowsBySourceConf = new Map();
  const flowsByTargetConf = new Map();
  for (const f of data.flows) {
    const srcConf = innerByName.get(f.source).conference;
    const tgtConf = innerByName.get(f.target).conference;
    if (!flowsBySourceConf.has(srcConf)) flowsBySourceConf.set(srcConf, new Map());
    const outM = flowsBySourceConf.get(srcConf);
    outM.set(tgtConf, (outM.get(tgtConf) || 0) + f.count);
    if (!flowsByTargetConf.has(tgtConf)) flowsByTargetConf.set(tgtConf, new Map());
    const inM = flowsByTargetConf.get(tgtConf);
    inM.set(srcConf, (inM.get(srcConf) || 0) + f.count);
  }
  const confSub = new Map();
  const confSubIncoming = new Map();
  for (const [conf, span] of innerConfSpans) {
    const outFlows = Array.from(flowsBySourceConf.get(conf) || [], ([target, count]) => ({ target, count }));
    confSub.set(conf, subdivide(span, outFlows, span.portalEntries));
    const inFlows = Array.from(flowsByTargetConf.get(conf) || [], ([source, count]) => ({ target: source, count }));
    const totalIn = d3.sum(inFlows, f => f.count);
    confSubIncoming.set(conf, subdivide(span, inFlows, totalIn));
  }

  return {
    data, conferenceOrder,
    outerLayout, innerLayout, outerByName, innerByName,
    flowsBySource, flowsByTarget, schoolSub, schoolSubIncoming, schoolPlayers,
    innerConfSpans, confSub, confSubIncoming,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function attachZoom(svg, target, scaleExtent, onZoomLevel) {
  let panned = false;
  const zoom = d3.zoom()
    .scaleExtent(scaleExtent || [1, 8])
    .filter((event) => {
      if (event.type === "wheel") return event.ctrlKey || event.metaKey;
      return !event.button;
    })
    .on("start", (event) => { if (event.sourceEvent) panned = false; })
    .on("zoom", (event) => {
      target.attr("transform", event.transform);
      if (event.sourceEvent && event.sourceEvent.type !== "wheel") panned = true;
      if (onZoomLevel) onZoomLevel(event.transform.k);
    });
  svg.call(zoom).on("dblclick.zoom", null);
  return {
    zoomBy: (factor) => svg.transition().duration(200).call(zoom.scaleBy, factor),
    reset: () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity),
    wasPanned: () => { const p = panned; panned = false; return p; },
  };
}

function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&");
}

// Shared player-detail helpers, used by tooltips and the side panel alike so
// the two stay worded consistently.
function depStatusHtml(dep) {
  return classifyIsLeftoverLabel(dep)
    ? "still in the portal, or left D1"
    : `transferred to ${dep.t}${dep.tc && dep.tc !== "Unknown" ? " (" + dep.tc + ")" : ""}`;
}
function classifyIsLeftoverLabel(dep) {
  return dep.tc === "N/A (not yet committed)" || !PALETTE.conferences.includes(dep.tc);
}
function playerMetaHtml(dep) {
  return `${dep.pos} &middot; ${dep.gr}`;
}
function playerKey(school, dep) { return school + " " + dep.n + " " + dep.d; }

// ---------------------------------------------------------------------------
// Filters: position, class/grade, and transfer month are all "additive"
// (multi-select within a dimension is OR) and "stackable" (across
// dimensions is AND). Ring/segment geometry never changes shape from these
// -- only which ticks/ribbons are highlighted vs. dimmed, which players
// show up in the side panel, and a live match count. No "Prior transfers"
// dimension here (unlike football) -- that data is out of scope for this
// diagram.
// ---------------------------------------------------------------------------
const FILTER_DIMS = [
  { key: "conf", label: "Conference" },
  { key: "school", label: "School" },
  { key: "pos", label: "Position" },
  { key: "gr", label: "Class" },
  { key: "d", label: "Transfer date" },
];
const GRADE_ORDER = [
  "Freshman", "RedShirt Freshman", "Sophomore", "RedShirt Sophomore",
  "Junior", "RedShirt Junior", "Senior", "RedShirt Senior", "Unknown",
];
const MONTH_INDEX = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};
function dateSortKey(s) {
  const [month, year] = s.split(" ");
  return parseInt(year, 10) * 12 + (MONTH_INDEX[month] || 0);
}
// `conferenceOrder` (ring layout order) is only needed to sort the "conf"
// dimension's chips; every other dimension sorts by its own fixed rule.
function sortFilterValues(dim, values, conferenceOrder) {
  const arr = Array.from(values);
  if (dim === "d") return arr.sort((a, b) => dateSortKey(a) - dateSortKey(b));
  if (dim === "gr") return arr.sort((a, b) => GRADE_ORDER.indexOf(a) - GRADE_ORDER.indexOf(b));
  if (dim === "conf" && conferenceOrder) return arr.sort((a, b) => conferenceOrder.indexOf(a) - conferenceOrder.indexOf(b));
  return arr.sort((a, b) => (a === "Unknown" ? 1 : b === "Unknown" ? -1 : a.localeCompare(b)));
}
function filterValueLabel(dim, v) { return v; }
// `home` is the departing player's origin { conf, school } -- neither is a
// field on `dep` itself (which only carries the *destination* school/
// conference, `t`/`tc`), so every caller passes it in from whatever school
// or conference it's already iterating. Matching on origin means the
// "Conference"/"School" filters are inherently "out of this conference/
// school" filters (see the note on the auto-rendered filtered view below
// for why that's the useful behavior).
function matchesFilters(dep, filters, home) {
  for (const { key: dim } of FILTER_DIMS) {
    if (dim === "conf") {
      if (filters.conf.size && !filters.conf.has(home.conf)) return false;
      continue;
    }
    if (dim === "school") {
      if (filters.school.size && !filters.school.has(home.school)) return false;
      continue;
    }
    const set = filters[dim];
    if (set.size && !set.has(dep[dim])) return false;
  }
  return true;
}
function filtersActive(filters) {
  return FILTER_DIMS.some(({ key: dim }) => filters[dim].size > 0);
}
// A conference-pair ribbon naturally aggregates every school in each
// conference, so "SEC -> ACC" is its correct label by default. But once
// filters (a School pick, especially) narrow the underlying players down to
// a single origin school and/or a single destination school, showing the
// conference name on that side is needlessly vague -- swap in the specific
// school instead, independently per side.
function pairLabel(deps, fallbackSource, fallbackTarget) {
  const schools = new Set(deps.map(r => r.school));
  const targets = new Set(deps.map(r => r.dep.t));
  const sourceLabel = schools.size === 1 ? [...schools][0] : fallbackSource;
  const targetLabel = targets.size === 1 ? [...targets][0] : fallbackTarget;
  return `${sourceLabel} &rarr; ${targetLabel}`;
}

// Builds the chip UI for one panel's filter bar from its full player list,
// and returns the live filter state plus a way to subscribe to changes.
function buildFilterBar(key, allDeps, conferenceOrder) {
  const filters = {};
  for (const { key: dim } of FILTER_DIMS) filters[dim] = new Set();
  const listeners = [];

  function refreshChrome() {
    const activeCount = FILTER_DIMS.reduce((n, { key: dim }) => n + filters[dim].size, 0);
    const matchCount = allDeps.reduce((n, r) => n + (matchesFilters(r.dep, filters, { conf: r.conf, school: r.school }) ? 1 : 0), 0);
    const countEl = document.getElementById(`filtercount-${key}`);
    if (countEl) {
      countEl.textContent = activeCount
        ? `${activeCount} active · ${matchCount.toLocaleString()} of ${allDeps.length.toLocaleString()} match`
        : `${allDeps.length.toLocaleString()} players`;
    }
    const clearBtn = document.getElementById(`filterclear-${key}`);
    if (clearBtn) clearBtn.classList.toggle("visible", activeCount > 0);
    const toggleBtn = document.getElementById(`filtertoggle-${key}`);
    if (toggleBtn) toggleBtn.classList.toggle("has-active", activeCount > 0);
  }

  for (const { key: dim } of FILTER_DIMS) {
    const container = document.getElementById(`chips-${key}-${dim}`);
    if (!container) continue;
    container.innerHTML = "";
    const raw = dim === "conf" ? allDeps.map(r => r.conf)
      : dim === "school" ? allDeps.map(r => r.school)
      : allDeps.map(r => r.dep[dim]);
    const values = sortFilterValues(dim, new Set(raw), conferenceOrder);
    for (const v of values) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-chip";
      btn.textContent = filterValueLabel(dim, v);
      btn.addEventListener("click", () => {
        if (filters[dim].has(v)) filters[dim].delete(v); else filters[dim].add(v);
        btn.classList.toggle("active");
        refreshChrome();
        listeners.forEach(fn => fn());
      });
      container.appendChild(btn);
    }
  }

  const clearBtn = document.getElementById(`filterclear-${key}`);
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      for (const { key: dim } of FILTER_DIMS) filters[dim].clear();
      document.querySelectorAll(`#filterpanel-${key} .filter-chip.active`).forEach(el => el.classList.remove("active"));
      refreshChrome();
      listeners.forEach(fn => fn());
    });
  }

  const toggleBtn = document.getElementById(`filtertoggle-${key}`);
  const panelEl = document.getElementById(`filterpanel-${key}`);
  if (toggleBtn && panelEl) {
    toggleBtn.addEventListener("click", () => {
      const wasHidden = panelEl.hasAttribute("hidden");
      if (wasHidden) panelEl.removeAttribute("hidden"); else panelEl.setAttribute("hidden", "");
      toggleBtn.classList.toggle("open", wasHidden);
    });
  }

  refreshChrome();
  return { filters, onChange: fn => listeners.push(fn) };
}

// ---- side panel: full player lists for a clicked segment, or a single
// player's detail, without crowding the diagram itself with a big tooltip.
function positionSidePanel(rowEl) {
  const panel = document.getElementById("side-panel");
  if (panel && rowEl && panel.parentElement !== rowEl) {
    rowEl.appendChild(panel);
  }
}
function renderSidePanelBody(title, rows) {
  const panel = document.getElementById("side-panel");
  if (!panel) return;
  document.getElementById("side-panel-title").innerHTML = title;
  document.getElementById("side-panel-count").textContent =
    rows.length ? `${rows.length} player${rows.length === 1 ? "" : "s"}` : "";
  const body = document.getElementById("side-panel-body");
  body.innerHTML = rows.length
    ? rows.map(r => `<div class="side-panel-row${r.onClick ? " spr-clickable" : ""}"><span class="spr-name">${r.name}</span><span class="spr-detail">${r.detail}</span></div>`).join("")
    : `<div class="side-panel-empty">No players</div>`;
  panel.classList.add("open");
  [...body.children].forEach((el, i) => {
    const onClick = rows[i] && rows[i].onClick;
    if (!onClick) return;
    el.addEventListener("click", () => {
      const nowSelected = !el.classList.contains("selected");
      [...body.children].forEach(sib => sib.classList.remove("selected"));
      if (nowSelected) el.classList.add("selected");
      onClick(nowSelected);
    });
  });
}
function hideSidePanel() {
  const panel = document.getElementById("side-panel");
  if (panel) panel.classList.remove("open");
  clearRibbonIsolation();
}

// Highlights the single ribbon matching `pairKey` (an origin::destination
// school pair) and dims every other currently-rendered ribbon so a
// single-player connection can be picked out of a busy fan-out.
function isolateRibbon(pairKey) {
  document.querySelectorAll("[data-pair-key]").forEach(el => {
    const mine = el.getAttribute("data-pair-key") === pairKey;
    el.classList.toggle("player-isolated", mine);
    el.classList.toggle("sibling-dimmed", !mine);
  });
}
function clearRibbonIsolation() {
  document.querySelectorAll(".player-isolated, .sibling-dimmed").forEach(el => {
    el.classList.remove("player-isolated", "sibling-dimmed");
  });
}

function renderUniverse(svgEl, legendEl, universeKey, label, prepared, geo) {
  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const root = svg.append("g").attr("class", "diagram-root");

  const filterPanelRowEl = document.getElementById(`filterpanelrow-${universeKey}`);
  function showSidePanel(title, rows) {
    positionSidePanel(filterPanelRowEl);
    renderSidePanelBody(title, rows);
  }
  function openPlayerPanel(school, dep) {
    showSidePanel(dep.n, [{ name: `${school} &mdash; ${depStatusHtml(dep)}`, detail: `${dep.d}<br>${playerMetaHtml(dep)}` }]);
  }

  let zoomDetail = false;
  const zoomCtl = attachZoom(svg, root, [ZOOM_OUT_FLOOR, MAX_ZOOM], (k) => {
    zoomDetail = k >= ZOOM_DETAIL_THRESHOLD;
    root.classed("zoom-detail", zoomDetail);
    currentZoomK = k;
    refreshRibbonsForZoom();
  });
  function refreshRibbonsForZoom() {
    if (hoverActive) {
      if (hoverActive.type === "school") renderSchoolChords(gSchoolChords, hoverActive.key, direction);
      else renderConferenceChords(gConfChords, hoverActive.key, direction);
    } else if (shouldAutoShow()) {
      renderAllConferenceChords();
    }
    if (pin) redrawPin();
  }

  const mode = currentMode();
  const colorOf = conf => PALETTE[mode][PALETTE.conferences.indexOf(conf)];

  const arcOuter = d3.arc().innerRadius(geo.outerInner).outerRadius(geo.outerOuter);
  const arcInner = d3.arc().innerRadius(geo.innerInner).outerRadius(geo.innerOuter);
  const ribbon = d3.ribbon().radius(geo.chordRadius);

  let currentZoomK = 1;
  function shrinkSpan(startAngle, endAngle, radius) {
    if (currentZoomK <= 1) return { startAngle, endAngle, radius };
    const mid = (startAngle + endAngle) / 2;
    const half = (endAngle - startAngle) / 2 / currentZoomK;
    return { startAngle: mid - half, endAngle: mid + half, radius };
  }
  function zoomAwareRibbon(spec) {
    return ribbon({
      source: shrinkSpan(spec.source.startAngle, spec.source.endAngle, spec.source.radius),
      target: shrinkSpan(spec.target.startAngle, spec.target.endAngle, spec.target.radius),
    });
  }

  const tooltip = d3.select("#tooltip");
  function showTip(html, event) {
    tooltip.style("display", "block").html(html);
    moveTip(event);
  }
  function moveTip(event) {
    const pad = 14;
    tooltip.style("left", (event.clientX + pad) + "px").style("top", (event.clientY + pad) + "px");
  }

  // Separate from the hover tooltip above: stays on screen after a
  // conference is clicked (pinned), independent of mouse position, so it
  // doesn't get clobbered by the many other hover handlers throughout this
  // file that show/hide #tooltip for their own purposes.
  const pinTooltip = d3.select("#pin-tooltip");
  // Prefers sitting fully outside the diagram's left/right edge (true
  // zero overlap, however wide the ring gets) on whichever side is
  // farther from the clicked label. Falls back to that side's CORNER of
  // the SVG's own square canvas -- always empty of ribbons, since the
  // ring is circular inside a square -- only when the viewport is too
  // narrow for the "fully outside" placement to fit on screen.
  function showPinTip(html, anchorRect) {
    const pad = 14;
    pinTooltip.style("display", "block").html(html);
    const svgRect = svgEl.getBoundingClientRect();
    const tipRect = pinTooltip.node().getBoundingClientRect();
    const onLeft = (anchorRect.left + anchorRect.width / 2) < (svgRect.left + svgRect.width / 2);
    const onTop = (anchorRect.top + anchorRect.height / 2) < (svgRect.top + svgRect.height / 2);

    let left = onLeft ? (svgRect.left - pad - tipRect.width) : (svgRect.right + pad);
    const fitsOutside = left >= 8 && left + tipRect.width <= window.innerWidth - 8;
    let top;
    if (fitsOutside) {
      top = anchorRect.top;
    } else {
      left = onLeft ? (svgRect.left + pad) : (svgRect.right - pad - tipRect.width);
      top = onTop ? (svgRect.top + pad) : (svgRect.bottom - pad - tipRect.height);
    }
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));
    pinTooltip.style("left", left + "px").style("top", top + "px");
  }
  function hidePinTip() { pinTooltip.style("display", "none"); }

  // Shared by the hover tooltip and the pinned tooltip so both show the
  // same numbers. "Outgoing"/"incoming" percentages are of this
  // conference's own total committed cross-conference movement (in +
  // out), not a share of the whole league's transfer activity -- so the
  // two percentages always add to 100 and read as "of the players this
  // conference is trading, X% are leaving vs Y% arriving."
  // A departure counts as having left D1 entirely when it has a real
  // (non-blank) destination that still isn't one of the 32 tracked
  // conferences -- i.e. excludes both "still in the portal" rows (whose
  // tc is the not-yet-committed placeholder) and real D1 destinations.
  function isNonD1Departure(dep) {
    return dep.tc !== "N/A (not yet committed)" && !PALETTE.conferences.includes(dep.tc);
  }

  function confStatsHtml(conf) {
    const innerSpan = prepared.innerConfSpans.get(conf);
    const outSegments = prepared.confSub.get(conf).segments;
    const inSegments = prepared.confSubIncoming.get(conf).segments;
    // Segments whose "target" (the other end of the flow) is this same
    // conference are players moving between two schools in the SAME
    // conference -- pull those out as their own "within" category instead
    // of letting them double-count as both an out and an in.
    const withinTotal = d3.sum(outSegments.filter(s => s.target === conf), s => s.count);
    const outToD1 = d3.sum(outSegments, s => s.count) - withinTotal;
    const inFromD1 = d3.sum(inSegments, s => s.count) - d3.sum(inSegments.filter(s => s.target === conf), s => s.count);
    // These two aren't in confSub/confSubIncoming at all -- "out to
    // non-D1" comes from each school's own departures list (present but
    // never rolled into the D1-to-D1 flow totals), and "in from non-D1"
    // comes from the separate nonD1Arrivals list build_chord_data.py adds
    // per school (there's no other record of incoming players anywhere,
    // since a school's own data only tracks who LEFT it).
    const outToOther = d3.sum(innerSpan.schools, s => (s.departures || []).filter(isNonD1Departure).length);
    const inFromOther = d3.sum(innerSpan.schools, s => (s.nonD1Arrivals || []).length);

    const total = withinTotal + outToD1 + outToOther + inFromD1 + inFromOther;
    const pct = n => total ? Math.round((n / total) * 100) : 0;
    const pctWithin = pct(withinTotal);
    const pctOutToD1 = pct(outToD1);
    const pctOutToOther = pct(outToOther);
    const pctInFromD1 = pct(inFromD1);
    // Last leaf percentage absorbs the rounding remainder so all five
    // always sum to exactly 100, and "in total" (their sum) stays exactly
    // consistent with "from D1" + "from other" as displayed.
    const pctInFromOther = total ? 100 - pctWithin - pctOutToD1 - pctOutToOther - pctInFromD1 : 0;

    const outTotal = outToD1 + outToOther;
    const inTotal = inFromD1 + inFromOther;
    const pctOutTotal = pctOutToD1 + pctOutToOther;
    const pctInTotal = pctInFromD1 + pctInFromOther;

    return `<strong>${conf}</strong><br>${innerSpan.schools.length} schools &middot; ${innerSpan.portalEntries} portal entries` +
      `<br>Within: ${withinTotal} (${pctWithin}%)` +
      `<br>Out: ${outTotal} (${pctOutTotal}%) &mdash; ${outToD1} to D1 (${pctOutToD1}%), ${outToOther} to non-D1 (${pctOutToOther}%)` +
      `<br>In: ${inTotal} (${pctInTotal}%) &mdash; ${inFromD1} from D1 (${pctInFromD1}%), ${inFromOther} from non-D1 (${pctInFromOther}%)`;
  }
  function hideTip() { tooltip.style("display", "none"); }

  // ---- filters: chip UI + filtered-count helpers used by ribbon opacity --
  const allDeps = [];
  for (const s of prepared.innerLayout) for (const dep of s.departures || []) allDeps.push({ school: s.school, dep, conf: s.conference });
  const filterCtl = buildFilterBar(universeKey, allDeps, prepared.conferenceOrder);
  const filters = filterCtl.filters;
  function filteredSchoolCount(source, target) {
    const deps = prepared.schoolPlayers.get(source).byTarget.get(target) || [];
    const home = { conf: prepared.innerByName.get(source).conference, school: source };
    let n = 0;
    for (const dep of deps) if (matchesFilters(dep, filters, home)) n++;
    return n;
  }
  function filteredConfDeps(sourceConf, targetConf) {
    const out = [];
    for (const s of prepared.innerConfSpans.get(sourceConf).schools) {
      const home = { conf: sourceConf, school: s.school };
      for (const [targetSchool, deps] of prepared.schoolPlayers.get(s.school).byTarget) {
        if (prepared.innerByName.get(targetSchool).conference !== targetConf) continue;
        for (const dep of deps) if (matchesFilters(dep, filters, home)) out.push({ school: s.school, dep });
      }
    }
    return out;
  }
  function filteredSchoolDeps(source, target) {
    const deps = prepared.schoolPlayers.get(source).byTarget.get(target) || [];
    const home = { conf: prepared.innerByName.get(source).conference, school: source };
    return deps.filter(dep => matchesFilters(dep, filters, home));
  }
  const tickRegistry = [];
  function applyFilterDim() {
    const active = filtersActive(filters);
    for (const { el, dep, conf, school } of tickRegistry) el.classList.toggle("tick-dim", active && !matchesFilters(dep, filters, { conf, school }));
  }

  // ---- layers, back to front -------------------------------------------
  const gPinConfChords = root.append("g").attr("class", "layer-pin-conf-chords");
  const gPinSchoolChords = root.append("g").attr("class", "layer-pin-school-chords");
  const gPinPlayerChords = root.append("g").attr("class", "layer-pin-player-chords");
  const gConfChords = root.append("g").attr("class", "layer-conf-chords");
  const gSchoolChords = root.append("g").attr("class", "layer-school-chords");
  const gPlayerChords = root.append("g").attr("class", "layer-player-chords");
  const gOuter = root.append("g").attr("class", "layer-outer");
  const gInner = root.append("g").attr("class", "layer-inner");
  const gConfLabels = root.append("g").attr("class", "layer-conf-labels");
  const gCenter = root.append("g").attr("class", "layer-center");

  // ---- center summary -----------------------------------------------------
  const totalSchools = prepared.data.schools.length;
  const totalPortal = d3.sum(prepared.data.schools, d => d.portalEntries);
  const totalFlow = d3.sum(prepared.data.flows, d => d.count);
  gCenter.append("text").attr("class", "center-title").attr("y", -10).text(label);
  gCenter.append("text").attr("class", "center-stat").attr("y", 14)
    .text(`${totalSchools} schools`);
  gCenter.append("text").attr("class", "center-stat").attr("y", 32)
    .text(`${totalPortal.toLocaleString()} portal entries`);
  gCenter.append("text").attr("class", "center-stat").attr("y", 50)
    .text(`${totalFlow.toLocaleString()} committed transfers`);

  // ---- outer ring: roster -------------------------------------------------
  gOuter.selectAll("path.outer-school")
    .data(prepared.outerLayout)
    .join("path")
    .attr("class", "outer-school")
    .attr("d", d => arcOuter({ startAngle: d.startAngle, endAngle: d.endAngle }))
    .attr("fill", d => shadeForSchool(colorOf(d.conference), d, mode))
    .attr("data-school", d => d.school)
    .on("mouseenter", (event, d) => {
      showTip(`<strong>${d.school}</strong><br>${d.conference}<br>Roster limit: ${d.roster}`, event);
    })
    .on("mousemove", moveTip)
    .on("mouseleave", hideTip)
    .on("click", (event, d) => { if (!zoomCtl.wasPanned()) togglePin({ type: "school", key: d.school }); });

  // ---- inner ring: portal entries, subdivided by destination -------------
  const innerGroups = gInner.selectAll("g.inner-school")
    .data(prepared.innerLayout)
    .join("g")
    .attr("class", "inner-school")
    .attr("data-school", d => d.school);

  innerGroups.each(function (d) {
    const g = d3.select(this);
    const sub = prepared.schoolSub.get(d.school);
    const players = prepared.schoolPlayers.get(d.school);
    const baseColor = colorOf(d.conference);
    const gTicks = g.append("g").attr("class", "inner-seg-players");

    sub.segments.forEach(seg => {
      const deps = players.byTarget.get(seg.target) || [];
      g.append("path")
        .attr("class", "inner-seg")
        .attr("d", arcInner({ startAngle: seg.startAngle, endAngle: seg.endAngle }))
        .attr("fill", shadeForSchool(baseColor, d, mode))
        .attr("data-target", seg.target)
        .on("mouseenter", (event) => {
          showTip(`<strong>${d.school} &rarr; ${seg.target}</strong><br>${seg.count} player${seg.count === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip)
        .on("click", (event) => {
          event.stopPropagation();
          if (zoomCtl.wasPanned()) return;
          const segKey = `${d.school}::${seg.target}`;
          if (pin && pin.type === "school" && pin.key === d.school && pinnedSegKey === segKey) {
            setPin(null);
            hideSidePanel();
            lastPanelRefresh = null;
            return;
          }
          setPin({ type: "school", key: d.school });
          pinnedSegKey = segKey;
          openSegmentPanel(() => {
            const matched = filtersActive(filters) ? deps.filter(dep => matchesFilters(dep, filters, { conf: d.conference, school: d.school })) : deps;
            const rows = matched.map(dep => ({
              name: dep.n, detail: `${dep.d}<br>${playerMetaHtml(dep)}`,
              onClick: matched.length === 1 ? (selected) => (selected ? isolateRibbon(segKey) : clearRibbonIsolation()) : undefined,
            }));
            showSidePanel(`${d.school} &rarr; ${seg.target}`, rows);
          });
        });

      evenTicks(seg.startAngle, seg.endAngle, deps).forEach(({ item: dep, startAngle: a0, endAngle: a1 }) => {
        const tickSel = gTicks.append("path")
          .attr("class", "player-tick")
          .attr("data-player-key", playerKey(d.school, dep))
          .attr("d", arcInner({ startAngle: a0, endAngle: a1 }))
          .attr("fill", shadeForSchool(baseColor, d, mode))
          .on("mouseenter", (event) => enterPlayerTick(d.school, dep, a0, a1, event))
          .on("mousemove", (event) => { moveTip(event); cancelPlayerHoverClear(); })
          .on("mouseleave", () => leavePlayerTick())
          .on("click", (event) => {
            event.stopPropagation();
            togglePlayerPin(d.school, dep, a0, a1);
          });
        tickRegistry.push({ el: tickSel.node(), dep, conf: d.conference, school: d.school });
      });
    });

    if (sub.leftoverEnd > sub.leftoverStart) {
      g.append("path")
        .attr("class", "inner-seg inner-leftover")
        .attr("d", arcInner({ startAngle: sub.leftoverStart, endAngle: sub.leftoverEnd }))
        .attr("fill", "var(--leftover)")
        .on("mouseenter", (event) => {
          showTip(`<strong>${d.school}</strong><br>${players.leftover.length} player${players.leftover.length === 1 ? "" : "s"} still in the portal, or left D1<br><em>Click for the full list</em>`, event);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip)
        .on("click", (event) => {
          event.stopPropagation();
          openSegmentPanel(() => {
            const list = filtersActive(filters) ? players.leftover.filter(dep => matchesFilters(dep, filters, { conf: d.conference, school: d.school })) : players.leftover;
            const rows = list.map(dep => ({ name: dep.n, detail: `${depStatusHtml(dep)} &middot; ${dep.d}<br>${playerMetaHtml(dep)}` }));
            showSidePanel(`${d.school} &mdash; still in portal / left D1`, rows);
          });
        });

      evenTicks(sub.leftoverStart, sub.leftoverEnd, players.leftover).forEach(({ item: dep, startAngle: a0, endAngle: a1 }) => {
        const tickSel = gTicks.append("path")
          .attr("class", "player-tick player-tick-leftover")
          .attr("data-player-key", playerKey(d.school, dep))
          .attr("d", arcInner({ startAngle: a0, endAngle: a1 }))
          .attr("fill", "var(--leftover)")
          .on("mouseenter", (event) => {
            showTip(`<strong>${dep.n}</strong><br>${d.school} &mdash; ${depStatusHtml(dep)}<br>${dep.d}<br>${playerMetaHtml(dep)}`, event);
            setDim(n => n.school === d.school);
          })
          .on("mousemove", (event) => moveTip(event))
          .on("mouseleave", () => { hideTip(); restoreBaseDim(); })
          .on("click", (event) => {
            event.stopPropagation();
            togglePlayerPin(d.school, dep, a0, a1);
          });
        tickRegistry.push({ el: tickSel.node(), dep, conf: d.conference, school: d.school });
      });
    }
  });
  applyFilterDim();

  innerGroups
    .on("mouseenter", (event, d) => { if (!zoomDetail) enterSchool(d); })
    .on("mousemove", (event) => moveTip(event))
    .on("mouseleave", () => { if (!zoomDetail) leaveSchool(); })
    .on("click", (event, d) => { if (!zoomDetail && !zoomCtl.wasPanned()) togglePin({ type: "school", key: d.school }); });

  // ---- conference rim labels (curved, always visible) ---------------------
  const outerConfSpans = conferenceSpans(prepared.outerLayout, prepared.conferenceOrder);
  gConfLabels.selectAll("text.conf-label")
    .data(Array.from(outerConfSpans.values()))
    .join("text")
    .attr("class", "conf-label")
    .attr("data-conf", d => d.conference)
    .each(function (d) {
      const a = midAngle(d);
      const flipped = a > Math.PI / 2 && a < 3 * Math.PI / 2;
      const [x, y] = polar(a, geo.outerOuter + 6);
      const rot = (a * 180 / Math.PI) - 90 + (flipped ? 180 : 0);
      d3.select(this)
        .attr("transform", `translate(${x},${y}) rotate(${rot})`)
        .attr("text-anchor", flipped ? "end" : "start")
        .attr("dy", "0.35em")
        .text(d.conference);
    })
    .on("mouseenter", (event, d) => {
      enterConference(d.conference);
      showTip(confStatsHtml(d.conference), event);
    })
    .on("mousemove", (event) => moveTip(event))
    .on("mouseleave", () => leaveConference())
    .on("click", (event, d) => { if (!zoomCtl.wasPanned()) togglePin({ type: "conference", key: d.conference }); });

  // ---- shared ribbon-render helpers (used by both hover and pin) ----------
  function renderConferenceChords(layer, conf, direction) {
    layer.selectAll("*").remove();
    const sub = prepared.confSub.get(conf);
    const mySpan = prepared.innerConfSpans.get(conf);
    const showOut = direction !== "in";
    const showIn = direction !== "out";

    const outRibbons = showOut
      ? sub.segments.map(seg => ({ seg, deps: filteredConfDeps(conf, seg.target) })).filter(r => r.deps.length > 0)
      : [];
    const inRibbons = [];
    if (showIn) {
      for (const [otherConf, otherSub] of prepared.confSub) {
        if (otherConf === conf) continue;
        for (const seg of otherSub.segments) {
          if (seg.target !== conf) continue;
          const deps = filteredConfDeps(otherConf, conf);
          if (deps.length > 0) inRibbons.push({ otherConf, seg, deps });
        }
      }
    }
    const maxCount = d3.max([...outRibbons, ...inRibbons], r => r.deps.length) || 1;
    const opacityScale = d3.scalePow().exponent(0.5).domain([0, maxCount]).range([0.75, 1]).clamp(true);

    for (const { seg, deps } of outRibbons) {
      const targetSeg = incomingSegment(prepared.confSubIncoming, seg.target, conf, prepared.innerConfSpans.get(seg.target));
      const label = pairLabel(deps, conf, seg.target);
      layer.append("path")
        .attr("class", "chord chord-conf")
        .attr("d", zoomAwareRibbon({
          source: { startAngle: seg.startAngle, endAngle: seg.endAngle, radius: geo.chordRadius },
          target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
        }))
        .attr("fill", colorOf(conf))
        .attr("stroke", colorOf(conf))
        .style("opacity", opacityScale(deps.length))
        .on("mouseenter", (event) => {
          showTip(`<strong>${label}</strong><br>${deps.length} player${deps.length === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip)
        .on("click", (event) => {
          event.stopPropagation();
          openSegmentPanel(() => {
            const fresh = filteredConfDeps(conf, seg.target);
            const rows = fresh.map(({ school, dep }) => ({
              name: dep.n, detail: `${school} &rarr; ${dep.t} &middot; ${dep.d}<br>${playerMetaHtml(dep)}`,
            }));
            showSidePanel(pairLabel(fresh, conf, seg.target), rows);
          });
        });
    }
    for (const { otherConf, seg, deps } of inRibbons) {
      const myIncoming = prepared.confSubIncoming.get(conf);
      const targetSeg = (myIncoming && myIncoming.segments.find(s => s.target === otherConf)) || mySpan;
      const label = pairLabel(deps, otherConf, conf);
      layer.append("path")
        .attr("class", "chord chord-conf")
        .attr("d", zoomAwareRibbon({
          source: { startAngle: seg.startAngle, endAngle: seg.endAngle, radius: geo.chordRadius },
          target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
        }))
        .attr("fill", colorOf(otherConf))
        .attr("stroke", colorOf(otherConf))
        .style("opacity", opacityScale(deps.length))
        .on("mouseenter", (event) => {
          showTip(`<strong>${label}</strong><br>${deps.length} player${deps.length === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip)
        .on("click", (event) => {
          event.stopPropagation();
          openSegmentPanel(() => {
            const fresh = filteredConfDeps(otherConf, conf);
            const rows = fresh.map(({ school, dep }) => ({
              name: dep.n, detail: `${school} &rarr; ${dep.t} &middot; ${dep.d}<br>${playerMetaHtml(dep)}`,
            }));
            showSidePanel(pairLabel(fresh, otherConf, conf), rows);
          });
        });
    }
  }

  function renderSchoolChords(layer, school, direction) {
    layer.selectAll("*").remove();
    const d = prepared.innerByName.get(school);
    const sub = prepared.schoolSub.get(school);
    const baseColor = colorOf(d.conference);
    const showOut = direction !== "in";
    const showIn = direction !== "out";

    if (showOut) {
      for (const seg of sub.segments) {
        const count = filteredSchoolCount(school, seg.target);
        if (count === 0) continue;
        const targetLayout = prepared.innerByName.get(seg.target);
        const targetSeg = incomingSegment(prepared.schoolSubIncoming, seg.target, school, targetLayout);
        layer.append("path")
          .attr("class", "chord chord-school chord-out")
          .attr("d", zoomAwareRibbon({
            source: { startAngle: seg.startAngle, endAngle: seg.endAngle, radius: geo.chordRadius },
            target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
          }))
          .attr("fill", baseColor)
          .attr("stroke", baseColor)
          .attr("data-pair-key", `${school}::${seg.target}`)
          .on("mouseenter", (event) => {
            showTip(`<strong>${school} &rarr; ${seg.target}</strong><br>${count} player${count === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
          })
          .on("mousemove", moveTip)
          .on("mouseleave", hideTip)
          .on("click", (event) => {
            event.stopPropagation();
            openSegmentPanel(() => {
              const deps = filteredSchoolDeps(school, seg.target);
              const pairKey = `${school}::${seg.target}`;
              const rows = deps.map(dep => ({
                name: dep.n, detail: `${dep.d}<br>${playerMetaHtml(dep)}`,
                onClick: deps.length === 1 ? (selected) => (selected ? isolateRibbon(pairKey) : clearRibbonIsolation()) : undefined,
              }));
              showSidePanel(`${school} &rarr; ${seg.target}`, rows);
            });
          });
      }
    }
    if (showIn) {
      const incoming = prepared.flowsByTarget.get(school) || [];
      const myIncoming = prepared.schoolSubIncoming.get(school);
      for (const f of incoming) {
        const count = filteredSchoolCount(f.source, school);
        if (count === 0) continue;
        const srcSub = prepared.schoolSub.get(f.source);
        const srcSeg = srcSub.segments.find(s => s.target === school);
        if (!srcSeg) continue;
        const targetSeg = (myIncoming && myIncoming.segments.find(s => s.target === f.source)) || d;
        const srcColor = colorOf(prepared.innerByName.get(f.source).conference);
        layer.append("path")
          .attr("class", "chord chord-school chord-in")
          .attr("d", zoomAwareRibbon({
            source: { startAngle: srcSeg.startAngle, endAngle: srcSeg.endAngle, radius: geo.chordRadius },
            target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
          }))
          .attr("fill", srcColor)
          .attr("stroke", srcColor)
          .attr("data-pair-key", `${f.source}::${school}`)
          .on("mouseenter", (event) => {
            showTip(`<strong>${f.source} &rarr; ${school}</strong><br>${count} player${count === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
          })
          .on("mousemove", moveTip)
          .on("mouseleave", hideTip)
          .on("click", (event) => {
            event.stopPropagation();
            openSegmentPanel(() => {
              const deps = filteredSchoolDeps(f.source, school);
              const pairKey = `${f.source}::${school}`;
              const rows = deps.map(dep => ({
                name: dep.n, detail: `${dep.d}<br>${playerMetaHtml(dep)}`,
                onClick: deps.length === 1 ? (selected) => (selected ? isolateRibbon(pairKey) : clearRibbonIsolation()) : undefined,
              }));
              showSidePanel(`${f.source} &rarr; ${school}`, rows);
            });
          });
      }
    }
  }

  function renderPlayerChordInto(layer, school, dep, a0, a1, interactive) {
    layer.selectAll("*").remove();
    const targetLayout = prepared.innerByName.get(dep.t);
    if (!targetLayout) return;
    const targetSeg = incomingSegment(prepared.schoolSubIncoming, dep.t, school, targetLayout);
    const sel = layer.append("path")
      .attr("class", "chord chord-player")
      .attr("d", zoomAwareRibbon({
        source: { startAngle: a0, endAngle: a1, radius: geo.chordRadius },
        target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
      }))
      .attr("fill", colorOf(prepared.innerByName.get(school).conference))
      .attr("stroke", colorOf(prepared.innerByName.get(school).conference))
      .style("opacity", 0.95)
      .on("click", (event) => { event.stopPropagation(); togglePlayerPin(school, dep, a0, a1); });
    if (interactive) {
      sel.on("mouseenter", (event) => { showTip(`<strong>${dep.n}</strong><br>${school} &rarr; ${dep.t}<br>${dep.d}<br>${playerMetaHtml(dep)}`, event); cancelPlayerHoverClear(); })
        .on("mousemove", (event) => { moveTip(event); cancelPlayerHoverClear(); })
        .on("mouseleave", () => schedulePlayerHoverClear());
    } else {
      sel.on("mouseenter", (event) => showTip(`<strong>${dep.n}</strong><br>${school} &rarr; ${dep.t}<br>${dep.d}<br>${playerMetaHtml(dep)}`, event))
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip);
    }
  }

  function togglePlayerPin(school, dep, a0, a1) {
    const key = playerKey(school, dep);
    const wasPinned = pin && pin.type === "player" && pin.key === key;
    togglePin({ type: "player", key, school, dep, tickStart: a0, tickEnd: a1 });
    lastPanelRefresh = null;
    if (wasPinned) hideSidePanel(); else openPlayerPanel(school, dep);
  }
  function openSegmentPanel(render) {
    lastPanelRefresh = render;
    render();
  }

  // ---- "show all" mode: every conference-pair ribbon at once, opt-in -----
  let showAll = false;
  function renderAllConferenceChords() {
    gConfChords.selectAll("*").remove();
    const ribbons = [];
    for (const [conf, sub] of prepared.confSub) {
      for (const seg of sub.segments) {
        const deps = filteredConfDeps(conf, seg.target);
        if (deps.length > 0) ribbons.push({ conf, seg, deps });
      }
    }
    const maxCount = d3.max(ribbons, r => r.deps.length) || 1;
    const opacityScale = d3.scalePow().exponent(0.5).domain([0, maxCount]).range([0.4, 0.9]).clamp(true);
    for (const { conf, seg, deps } of ribbons) {
      const targetSeg = incomingSegment(prepared.confSubIncoming, seg.target, conf, prepared.innerConfSpans.get(seg.target));
      const label = pairLabel(deps, conf, seg.target);
      gConfChords.append("path")
        .attr("class", "chord chord-conf")
        .attr("d", zoomAwareRibbon({
          source: { startAngle: seg.startAngle, endAngle: seg.endAngle, radius: geo.chordRadius },
          target: { startAngle: targetSeg.startAngle, endAngle: targetSeg.endAngle, radius: geo.chordRadius },
        }))
        .attr("fill", colorOf(conf))
        .attr("stroke", colorOf(conf))
        .style("opacity", opacityScale(deps.length))
        .on("mouseenter", (event) => {
          showTip(`<strong>${label}</strong><br>${deps.length} player${deps.length === 1 ? "" : "s"}<br><em>Click for the full list</em>`, event);
        })
        .on("mousemove", moveTip)
        .on("mouseleave", hideTip)
        .on("click", (event) => {
          event.stopPropagation();
          openSegmentPanel(() => {
            const fresh = filteredConfDeps(conf, seg.target);
            const rows = fresh.map(({ school, dep }) => ({
              name: dep.n,
              detail: `${school} &rarr; ${dep.t} &middot; ${dep.d}<br>${playerMetaHtml(dep)}`,
            }));
            showSidePanel(pairLabel(fresh, conf, seg.target), rows);
          });
        });
    }
  }
  function setShowAll(v) {
    showAll = v;
    if (shouldAutoShow()) renderAllConferenceChords(); else gConfChords.selectAll("*").remove();
  }
  function shouldAutoShow() { return showAll || filtersActive(filters); }

  // ---- dimming ----------------------------------------------------------
  function setDim(matchFn) {
    root.selectAll(".outer-school, .inner-school").classed("dimmed", n => !matchFn(n));
  }
  function clearDim() { root.selectAll(".outer-school, .inner-school").classed("dimmed", false); }
  function restoreBaseDim() {
    if (!pin) { clearDim(); return; }
    if (pin.type === "conference") setDim(n => n.conference === pin.key);
    else if (pin.type === "school") setDim(n => n.school === pin.key);
    else if (pin.type === "player") setDim(n => n.school === pin.school || n.school === pin.dep.t);
  }

  // ---- hover: school / conference / player -------------------------------
  let hoverActive = null;
  function enterSchool(d) {
    hoverActive = { type: "school", key: d.school };
    gConfChords.selectAll("*").remove();
    renderSchoolChords(gSchoolChords, d.school, direction);
    setDim(n => n.school === d.school);
  }
  function leaveSchool() {
    hoverActive = null;
    gSchoolChords.selectAll("*").remove();
    restoreBaseDim();
    if (shouldAutoShow()) renderAllConferenceChords();
  }
  function enterConference(conf) {
    hoverActive = { type: "conference", key: conf };
    gSchoolChords.selectAll("*").remove();
    renderConferenceChords(gConfChords, conf, direction);
    setDim(n => n.conference === conf);
  }
  function leaveConference() {
    hoverActive = null;
    if (shouldAutoShow()) renderAllConferenceChords(); else gConfChords.selectAll("*").remove();
    restoreBaseDim();
    hideTip();
  }
  let playerHoverTimer = null;
  function cancelPlayerHoverClear() { clearTimeout(playerHoverTimer); }
  function schedulePlayerHoverClear() {
    clearTimeout(playerHoverTimer);
    playerHoverTimer = setTimeout(() => {
      gPlayerChords.selectAll("*").remove();
      restoreBaseDim();
      hideTip();
    }, 300);
  }
  function enterPlayerTick(school, dep, a0, a1, event) {
    cancelPlayerHoverClear();
    renderPlayerChordInto(gPlayerChords, school, dep, a0, a1, true);
    setDim(n => n.school === school || n.school === dep.t);
    showTip(`<strong>${dep.n}</strong><br>${school} &rarr; ${dep.t}<br>${dep.d}<br>${playerMetaHtml(dep)}`, event);
  }
  function leavePlayerTick() {
    schedulePlayerHoverClear();
  }

  // ---- click-to-pin -------------------------------------------------------
  let pin = null;
  let lastPanelRefresh = null;
  let pinnedSegKey = null;
  let direction = getDirection(universeKey);

  function pinLabel(p) {
    if (p.type === "player") return `${p.dep.n} &mdash; ${p.school} &rarr; ${p.dep.t} (${p.dep.d})`;
    return p.key;
  }
  function redrawPin() {
    gPinConfChords.selectAll("*").remove();
    gPinSchoolChords.selectAll("*").remove();
    gPinPlayerChords.selectAll("*").remove();
    root.selectAll(".pin-highlight").classed("pin-highlight", false);
    hidePinTip();
    if (pin) {
      if (pin.type === "conference") {
        renderConferenceChords(gPinConfChords, pin.key, direction);
        const labelSel = gConfLabels.selectAll("text.conf-label").filter(d => d.conference === pin.key);
        labelSel.classed("pin-highlight", true);
        const labelNode = labelSel.node();
        if (labelNode) {
          const rect = labelNode.getBoundingClientRect();
          showPinTip(confStatsHtml(pin.key), rect);
        }
      } else if (pin.type === "school") {
        renderSchoolChords(gPinSchoolChords, pin.key, direction);
        root.selectAll(`.outer-school[data-school="${cssEscape(pin.key)}"], .inner-school[data-school="${cssEscape(pin.key)}"]`).classed("pin-highlight", true);
      } else if (pin.type === "player") {
        renderPlayerChordInto(gPinPlayerChords, pin.school, pin.dep, pin.tickStart, pin.tickEnd);
        root.selectAll(`[data-player-key="${cssEscape(pin.key)}"]`).classed("pin-highlight", true);
      }
    }
    restoreBaseDim();
    updatePinIndicator();
  }
  function setPin(next) { pin = next; pinnedSegKey = null; redrawPin(); }
  function togglePin(candidate) {
    if (pin && pin.type === candidate.type && pin.key === candidate.key) setPin(null);
    else setPin(candidate);
  }
  function updatePinIndicator() {
    const chip = document.getElementById("pinchip-" + universeKey);
    const labelEl = document.getElementById("pinlabel-" + universeKey);
    if (!chip || !labelEl) return;
    if (pin) { chip.classList.add("active"); labelEl.innerHTML = pinLabel(pin); }
    else { chip.classList.remove("active"); labelEl.textContent = ""; }
  }
  function setDirection(v) {
    direction = v;
    redrawPin();
    if (hoverActive) {
      if (hoverActive.type === "school") renderSchoolChords(gSchoolChords, hoverActive.key, direction);
      else renderConferenceChords(gConfChords, hoverActive.key, direction);
    }
  }

  filterCtl.onChange(() => {
    applyFilterDim();
    if (!hoverActive) {
      if (shouldAutoShow()) renderAllConferenceChords(); else gConfChords.selectAll("*").remove();
    } else if (hoverActive.type === "school") {
      renderSchoolChords(gSchoolChords, hoverActive.key, direction);
    } else {
      renderConferenceChords(gConfChords, hoverActive.key, direction);
    }
    if (pin) redrawPin();
    if (lastPanelRefresh) lastPanelRefresh();
  });

  svg.on("click", (event) => {
    if (zoomCtl.wasPanned()) return;
    if (event.target === svgEl) { setPin(null); lastPanelRefresh = null; hideSidePanel(); }
  });

  // ---- legend ---------------------------------------------------------
  const legend = d3.select(legendEl);
  legend.selectAll("*").remove();
  const items = legend.selectAll(".legend-item")
    .data(prepared.conferenceOrder)
    .join("div")
    .attr("class", "legend-item");
  items.append("span").attr("class", "legend-swatch").style("background", d => colorOf(d));
  items.append("span").attr("class", "legend-label").text(d => d);
  const leftoverItem = legend.append("div").attr("class", "legend-item");
  leftoverItem.append("span").attr("class", "legend-swatch").style("background", "var(--leftover)");
  leftoverItem.append("span").attr("class", "legend-label").text("Still in portal / left D1");

  return {
    setShowAll,
    setDirection,
    clearPin: () => setPin(null),
    zoomIn: () => zoomCtl.zoomBy(1.5),
    zoomOut: () => zoomCtl.zoomBy(1 / 1.5),
    zoomReset: () => zoomCtl.reset(),
  };
}

function shadeForSchool(baseHex, d, mode) {
  const idx = hashShadeIndex(d.school);
  const deltas = [0, 6, -6, 11, -11];
  return adjustLightness(baseHex, deltas[idx % deltas.length] * (mode === "dark" ? -1 : 1));
}
function hashShadeIndex(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}
function adjustLightness(hex, deltaPct) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (deltaPct / 100) * 255)));
  r = f(r); g = f(g); b = f(b);
  return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function wireUniverseControls(key, handleRef) {
  const showAllBox = document.getElementById(`showall-${key}`);
  showAllBox.addEventListener("change", () => handleRef.current.setShowAll(showAllBox.checked));
  document.getElementById(`zoomin-${key}`).addEventListener("click", () => handleRef.current.zoomIn());
  document.getElementById(`zoomout-${key}`).addEventListener("click", () => handleRef.current.zoomOut());
  document.getElementById(`zoomreset-${key}`).addEventListener("click", () => handleRef.current.zoomReset());
  document.querySelectorAll(`input[name="dir-${key}"]`).forEach(radio => {
    radio.addEventListener("change", () => { if (radio.checked) handleRef.current.setDirection(radio.value); });
  });
  const pinClear = document.getElementById(`pinclear-${key}`);
  if (pinClear) pinClear.addEventListener("click", () => handleRef.current.clearPin());
}

function boot(CHORD_DATA) {
  const geo = {
    outerOuter: 336, outerInner: 300,
    innerOuter: 292, innerInner: 250,
    chordRadius: 250,
  };

  const prepared = prepareUniverse(CHORD_DATA.bball, PALETTE.conferences);
  const handleRef = { current: null };

  function renderAll() {
    handleRef.current = renderUniverse(document.getElementById("svg-bball"), document.getElementById("legend-bball"), "bball", "D1 Men's Basketball", prepared, geo);
    if (document.getElementById("showall-bball").checked) handleRef.current.setShowAll(true);
  }

  renderAll();
  wireUniverseControls("bball", handleRef);
  document.getElementById("side-panel-close").addEventListener("click", hideSidePanel);

  const observer = new MutationObserver(renderAll);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}

fetch("chord_data.json")
  .then((res) => res.json())
  .then((data) => boot(data));
