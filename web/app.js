(function () {
  "use strict";

  const T = window.I18N;
  const REPO = "https://github.com/shinyanakashima/30daymapchallenge-2026day20-cowtown";

  // Classes: no cattle, then the people arm (dark -> light towards 1),
  // then the cows arm (light -> dark away from 1).
  const BINS = [
    { key: "none", color: "#dcdad4", test: (r) => r === 0 },
    { key: "p3", color: "#456c94", label: "< 0.1", test: (r) => r > 0 && r < 0.1 },
    { key: "p2", color: "#82a3c6", label: "0.1–0.5", test: (r) => r >= 0.1 && r < 0.5 },
    { key: "p1", color: "#c2d3e6", label: "0.5–1", test: (r) => r >= 0.5 && r <= 1 },
    { key: "c1", color: "#efb865", label: "1–2", test: (r) => r > 1 && r < 2 },
    { key: "c2", color: "#d46f26", label: "2–4", test: (r) => r >= 2 && r < 4 },
    { key: "c3", color: "#843a0f", label: "4+", test: (r) => r >= 4 },
  ];
  const DARK = new Set(["p3", "c3"]);

  const state = { lang: "en", view: "hex", selected: null };
  try {
    const q = new URLSearchParams(location.search).get("lang");
    const saved = localStorage.getItem("cowtown-lang");
    if (q === "ja" || q === "en") state.lang = q;
    else if (saved === "ja" || saved === "en") state.lang = saved;
  } catch (e) { /* storage unavailable */ }

  const svg = d3.select("#map");
  const tip = document.getElementById("tip");
  let towns, byCode, geo, zoom, root, hexLayer, geoLayer, labelLayer;
  let W, H, hexS;

  function ratioOf(t) {
    return t.cattle === null ? null : t.cattle / t.pop;
  }
  function binOf(t) {
    const r = ratioOf(t);
    if (r === null) return null;
    return BINS.find((b) => b.test(r));
  }
  function fill(t) {
    const b = binOf(t);
    return b ? b.color : "url(#hatch)";
  }
  const L = () => T[state.lang];
  const nf = () => new Intl.NumberFormat(state.lang === "ja" ? "ja-JP" : "en-US");
  function fmtRatio(r) {
    if (r === null) return "—";
    if (r === 0) return "0";
    if (r < 0.01) return r.toFixed(4);
    return r.toFixed(2);
  }
  function name(t) {
    return state.lang === "ja" ? t.ja : t.en;
  }
  function fullName(t) {
    return state.lang === "ja" ? t.ja : `${t.en} ${L().type[t.type]}`;
  }
  function shortName(t) {
    return state.lang === "ja" ? t.sja : t.sen;
  }

  // ---------- geometry ----------
  // Pointy-top hexagons, "odd-r" offset: odd rows shift half a cell right.
  function hexCenter(t) {
    const w = Math.sqrt(3) * hexS;
    return [w * (t.col + 0.75 + (t.row % 2 ? 0.5 : 0)), hexS * 1.25 + t.row * 1.5 * hexS];
  }
  function hexPath(cx, cy, s) {
    const pts = d3.range(6).map((k) => {
      const a = (Math.PI / 180) * (60 * k - 30);
      return [cx + s * Math.cos(a), cy + s * Math.sin(a)];
    });
    return "M" + pts.map((p) => p.map((v) => v.toFixed(2)).join(",")).join("L") + "Z";
  }

  function setup() {
    const maxRow = d3.max(towns, (t) => t.row);
    const maxCol = d3.max(towns, (t) => t.col);
    W = 1000;
    // Width covers (maxCol + 1.5) cells; derive hex size from it.
    hexS = W / (Math.sqrt(3) * (maxCol + 2));
    H = Math.ceil(hexS * (2.5 + maxRow * 1.5));
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const defs = svg.append("defs");
    const pat = defs.append("pattern").attr("id", "hatch").attr("patternUnits", "userSpaceOnUse")
      .attr("width", 6).attr("height", 6).attr("patternTransform", "rotate(45)");
    pat.append("rect").attr("width", 6).attr("height", 6).attr("fill", "#fbfaf7");
    pat.append("line").attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6).attr("stroke", "#9a978f").attr("stroke-width", 1.6);

    root = svg.append("g");
    geoLayer = root.append("g").attr("class", "geo").style("opacity", 0).style("pointer-events", "none");
    hexLayer = root.append("g").attr("class", "hex");
    labelLayer = root.append("g").attr("class", "labels");

    // Hexagons
    hexLayer.selectAll("path").data(towns, (d) => d.code).join("path")
      .attr("class", "cell")
      .attr("d", (t) => { const [x, y] = hexCenter(t); return hexPath(x, y, hexS * 0.96); })
      .attr("fill", fill)
      .attr("tabindex", 0)
      .attr("role", "button")
      .call(interact);

    // Map view: fit Hokkaido (excluding the Northern Territories) into the same box.
    // Fit Hokkaido proper, leaving room on the right for the Northern Territories outlines.
    const main = { type: "FeatureCollection", features: geo.features.filter((f) => !f.properties.excluded) };
    const proj = d3.geoTransverseMercator().rotate([-142.8, -43.5]).fitExtent([[12, 12], [W * 0.84, H - 12]], main);
    const path = d3.geoPath(proj);
    geoLayer.selectAll("path").data(geo.features).join("path")
      .attr("class", (f) => (f.properties.excluded ? "excluded" : "cell"))
      .attr("d", path)
      .each(function (f) { f.town = byCode.get(f.properties.code) || null; })
      .attr("fill", (f) => (f.town ? fill(f.town) : "none"))
      .filter((f) => f.town)
      .datum((f) => f.town)
      .attr("tabindex", 0)
      .attr("role", "button")
      .call(interact);

    labelLayer.selectAll("text").data(towns, (d) => d.code).join("text")
      .attr("x", (t) => hexCenter(t)[0])
      .attr("y", (t) => hexCenter(t)[1])
      .attr("class", (t) => { const b = binOf(t); return b && DARK.has(b.key) ? "lab on-dark" : "lab"; });

    zoom = d3.zoom().scaleExtent([1, 6])
      .translateExtent([[0, 0], [W, H]])
      .on("zoom", (ev) => { root.attr("transform", ev.transform); updateLabelSize(ev.transform.k); });
    svg.call(zoom).on("dblclick.zoom", null);
    d3.select("#zoom-in").on("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1.6));
    d3.select("#zoom-out").on("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6));
    d3.select("#zoom-reset").on("click", () => svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity));

    window.addEventListener("resize", () => updateLabelSize(d3.zoomTransform(svg.node()).k));
  }

  function interact(sel) {
    sel.on("click", (ev, t) => { select(t.code); })
      .on("keydown", (ev, t) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(t.code); } })
      .on("pointermove", (ev, t) => { if (ev.pointerType === "mouse") showTip(ev, t); })
      .on("pointerleave", hideTip)
      .on("focus", (ev, t) => { highlight(t.code); })
      .on("blur", () => highlight(state.selected));
  }

  function showTip(ev, t) {
    const r = ratioOf(t);
    tip.innerHTML = `<strong>${fullName(t)}</strong><br>${L().perPerson}: ${r === null ? L().withheld : fmtRatio(r)}`;
    tip.hidden = false;
    const box = tip.parentElement.getBoundingClientRect();
    let x = ev.clientX - box.left + 14, y = ev.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = ev.clientX - box.left - tip.offsetWidth - 14;
    if (y + tip.offsetHeight > box.height) y = ev.clientY - box.top - tip.offsetHeight - 14;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
    highlight(t.code, true);
  }
  function hideTip() {
    tip.hidden = true;
    highlight(state.selected);
  }

  function highlight(code, hover) {
    root.selectAll(".cell").classed("hover", (t) => hover && t && t.code === code)
      .classed("sel", (t) => t && t.code === state.selected);
    // Bring the outlined shape to the front so its stroke is not covered.
    root.selectAll(".cell.sel, .cell.hover").raise();
  }

  // Fit labels into hexagons; hide them when they would be unreadable.
  function updateLabelSize(k) {
    const px = svg.node().getBoundingClientRect().width / W; // screen px per svg unit at k=1
    const w = Math.sqrt(3) * hexS * 0.94;
    const show = state.view === "hex";
    labelLayer.style("display", show ? null : "none");
    if (!show) return;
    labelLayer.selectAll("text").each(function (t) {
      const lines = labelLines(t);
      const longest = d3.max(lines, (s) => s.length);
      const em = state.lang === "ja" ? 1.0 : 0.54; // approximate glyph width in em
      const fs = Math.min(hexS * 0.42, w / (longest * em));
      const el = d3.select(this).attr("font-size", fs.toFixed(2));
      el.selectAll("tspan").data(lines).join("tspan")
        .attr("x", hexCenter(t)[0])
        .attr("dy", (d, i) => (i === 0 ? (lines.length === 1 ? "0.35em" : "-0.2em") : "1.1em"))
        .text((d) => d);
      el.style("display", fs * px * k < 6.5 ? "none" : null);
    });
  }

  // English names of 10+ letters are split after a common prefix.
  const PREFIXES = ["Higashi", "Minami", "Shimo", "Nishi", "Kami", "Naka", "Kita", "Shin", "Hama", "Kuro"];
  function labelLines(t) {
    const s = shortName(t);
    if (state.lang === "ja" || s.length < 10) return [s];
    const h = s.indexOf("-");
    if (h > 0) return [s.slice(0, h + 1), s.slice(h + 1)];
    const p = PREFIXES.find((q) => s.startsWith(q) && s.length - q.length >= 4);
    if (p) return [p + "-", s.slice(p.length)];
    const mid = Math.ceil(s.length / 2);
    return [s.slice(0, mid) + "-", s.slice(mid)];
  }

  // ---------- panels ----------
  function select(code) {
    state.selected = code;
    highlight(code);
    renderDetail();
    d3.selectAll("#top10 li").classed("sel", (t) => t.code === code);
  }

  function renderDetail() {
    const el = document.getElementById("detail");
    const t = byCode.get(state.selected);
    const l = L();
    if (!t) { el.innerHTML = `<p class="prompt">${l.pickPrompt}</p>`; return; }
    const r = ratioOf(t);
    const other = state.lang === "ja" ? `${t.en}` : t.ja;
    const region = state.lang === "ja" ? l.region(t.rja) : l.region(t.ren);
    let headline = "", note = "";
    if (t.status === "withheld") note = l.withheldNote;
    else if (r === 0) note = l.noneNote;
    else if (r >= 1) headline = l.cowsPer(r.toFixed(1));
    else headline = l.peoplePer(nf().format(Math.round(1 / r)));
    const b = binOf(t);
    el.innerHTML = `
      <div class="dhead"><span class="sw" style="background:${b ? b.color : ""}" ${b ? "" : 'data-hatch="1"'}></span>
        <div><h2>${fullName(t)}</h2><p class="sub">${region} · ${other}</p></div></div>
      ${headline ? `<p class="big">${headline}</p>` : ""}
      <dl>
        <dt>${l.population}<small>${l.popYear}</small></dt><dd>${nf().format(t.pop)}</dd>
        <dt>${l.cattle}<small>${l.cattleYear}</small></dt><dd>${t.cattle === null ? l.withheldText : nf().format(t.cattle)}</dd>
        <dt>${l.perPerson}</dt><dd>${r === null ? "—" : fmtRatio(r)}</dd>
      </dl>
      ${note ? `<p class="note">${note}</p>` : ""}`;
  }

  function renderTop() {
    const top = towns.filter((t) => t.cattle !== null).sort((a, b) => ratioOf(b) - ratioOf(a)).slice(0, 10);
    const max = ratioOf(top[0]);
    d3.select("#top10").selectAll("li").data(top, (d) => d.code).join("li")
      .attr("tabindex", 0)
      .classed("sel", (t) => t.code === state.selected)
      .html((t) => `<span class="nm">${name(t)}</span><span class="bar"><i style="width:${(ratioOf(t) / max * 100).toFixed(1)}%"></i></span><span class="v">${ratioOf(t).toFixed(1)}</span>`)
      .on("click", (ev, t) => select(t.code))
      .on("keydown", (ev, t) => { if (ev.key === "Enter") select(t.code); });
  }

  function renderLegend() {
    const l = L();
    const sw = (b) => `<span class="item"><span class="sw" style="background:${b.color}"></span>${b.label}</span>`;
    const people = BINS.filter((b) => b.key[0] === "p");
    const cows = BINS.filter((b) => b.key[0] === "c");
    document.getElementById("legend").innerHTML = `
      <p class="lt">${l.legendTitle}</p>
      <div class="scale">
        <div class="arm"><div class="items">${people.map(sw).join("")}</div><p class="cap">← ${l.legendPeople}</p></div>
        <div class="mid" aria-hidden="true"><i></i><span>1</span></div>
        <div class="arm"><div class="items">${cows.map(sw).join("")}</div><p class="cap">${l.legendCows} →</p></div>
      </div>
      <div class="extra">
        <span class="item"><span class="sw" style="background:${BINS[0].color}"></span>${l.none}</span>
        <span class="item"><span class="sw" data-hatch="1"></span>${l.withheld}</span>
      </div>`;
  }

  function renderTable() {
    const l = L();
    const table = d3.select("#all");
    table.select("thead").html(`<tr><th>${l.colName}</th><th class="num">${l.colPop}</th><th class="num">${l.colCattle}</th><th class="num">${l.colRatio}</th></tr>`);
    const rows = towns.slice().sort((a, b) => (ratioOf(b) ?? -1) - (ratioOf(a) ?? -1));
    table.select("tbody").selectAll("tr").data(rows, (d) => d.code).join("tr")
      .html((t) => `<td>${fullName(t)}</td><td class="num">${nf().format(t.pop)}</td><td class="num">${t.cattle === null ? l.withheld : nf().format(t.cattle)}</td><td class="num">${fmtRatio(ratioOf(t))}</td>`);
  }

  function renderText() {
    const l = L();
    document.documentElement.lang = state.lang;
    document.title = l.title;
    const n = towns.filter((t) => t.cattle !== null && ratioOf(t) > 1).length;
    document.getElementById("headline").innerHTML = l.headline(n);
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = l[el.dataset.i18n];
      if (typeof v === "string") el.textContent = v;
    });
    document.getElementById("notes").innerHTML = l.notes.map((s) => `<li>${s}</li>`).join("");
    document.getElementById("sources").innerHTML = l.sources.map(([s, u]) => `<li><a href="${u}">${s}</a></li>`).join("");
    document.getElementById("credit").innerHTML = `${l.credit}<a href="${REPO}">GitHub</a>`;
    document.getElementById("viewnote").textContent = state.view === "hex" ? l.viewnoteHex : l.viewnoteGeo;
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === state.lang)));
    hexLayer.selectAll("path").attr("aria-label", (t) => `${fullName(t)}: ${fmtRatio(ratioOf(t))}`);
  }

  function renderAll() {
    renderText();
    renderLegend();
    renderTop();
    renderTable();
    renderDetail();
    updateLabelSize(d3.zoomTransform(svg.node()).k);
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
    const hex = v === "hex";
    hexLayer.transition().duration(350).style("opacity", hex ? 1 : 0);
    geoLayer.transition().duration(350).style("opacity", hex ? 0 : 1);
    hexLayer.style("pointer-events", hex ? null : "none");
    geoLayer.style("pointer-events", hex ? "none" : null);
    hexLayer.selectAll("path").attr("tabindex", hex ? 0 : -1);
    geoLayer.selectAll("path.cell").attr("tabindex", hex ? -1 : 0);
    document.getElementById("viewnote").textContent = hex ? L().viewnoteHex : L().viewnoteGeo;
    updateLabelSize(d3.zoomTransform(svg.node()).k);
  }

  Promise.all([d3.json("data/towns.json"), d3.json("data/municipalities.geojson")]).then(([t, g]) => {
    towns = t;
    byCode = new Map(towns.map((d) => [d.code, d]));
    geo = g;
    setup();
    document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => {
      state.lang = b.dataset.lang;
      try { localStorage.setItem("cowtown-lang", state.lang); } catch (e) { /* ignore */ }
      renderAll();
    }));
    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    state.selected = "01691"; // Betsukai, the town with the most cattle per person
    renderAll();
    highlight(state.selected);
  });
})();
