(() => {
  const reviewerStorageKey = "swiftminer.reviewer_id";
  const themeStorageKey = "swiftminer.theme";
  const params = new URLSearchParams(location.search);

  function initializeTheme() {
    const saved = localStorage.getItem(themeStorageKey);
    const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector("[data-theme-toggle]");
    if (!button) return;
    const render = value => {
      button.setAttribute("aria-label", value === "dark" ? "Switch to light theme" : "Switch to dark theme");
      button.setAttribute("aria-pressed", String(value === "dark"));
      button.querySelector("[data-theme-icon]").textContent = value === "dark" ? "☀" : "☾";
    };
    render(theme);
    button.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem(themeStorageKey, next);
      render(next);
    });
  }

  function randomReviewerID() {
    const value = crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
    return "RVW-" + value.slice(0, 12).toUpperCase();
  }

  function reviewerID() {
    const requested = params.get("reviewer_id");
    const valid = requested && /^RVW-[A-Z0-9]{8,32}$/.test(requested);
    const value = valid ? requested : (localStorage.getItem(reviewerStorageKey) || randomReviewerID());
    localStorage.setItem(reviewerStorageKey, value);
    params.set("reviewer_id", value);
    history.replaceState(null, "", location.pathname + "?" + params + location.hash);
    document.querySelectorAll("[data-reviewer-id]").forEach(node => node.textContent = value);
    return value;
  }

  initializeTheme();
  const reviewer = reviewerID();
  const reviewStorageKey = "swiftminer.reviews." + reviewer;
  const profileStorageKey = "swiftminer.profile_complete." + reviewer;

  function storedReviews() {
    try { return JSON.parse(localStorage.getItem(reviewStorageKey) || "{}"); }
    catch { return {}; }
  }

  function saveReview(caseID, payload) {
    const reviews = storedReviews();
    reviews[caseID] = payload;
    localStorage.setItem(reviewStorageKey, JSON.stringify(reviews));
  }

  function caseURL(caseID, runID) {
    const query = new URLSearchParams({ case_id: caseID, reviewer_id: reviewer, run_id: runID || "", review_key: reviewer + "--" + caseID });
    return "case.html?" + query;
  }

  function preserveReviewerLinks() {
    for (const anchor of document.querySelectorAll("[data-preserve-reviewer]")) {
      const url = new URL(anchor.getAttribute("href"), location.href);
      if (url.origin !== location.origin) continue;
      url.searchParams.set("reviewer_id", reviewer);
      anchor.href = url.pathname + "?" + url.searchParams + url.hash;
    }
  }

  function updateProgress(total) {
    const reviewed = Math.min(Object.keys(storedReviews()).length, total);
    document.querySelectorAll("[data-reviewed-count]").forEach(node => node.textContent = reviewed);
    document.querySelectorAll("[data-total-count]").forEach(node => node.textContent = total);
    document.querySelectorAll("[data-review-progress]").forEach(node => { node.max = Math.max(total, 1); node.value = reviewed; });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {}
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy is unavailable");
  }

  function initializeCopyButtons() {
    for (const button of document.querySelectorAll("[data-copy-target]")) {
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.copyTarget);
        if (!target) return;
        const original = button.textContent;
        try {
          await copyText(target.textContent);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Copy failed";
        }
        setTimeout(() => { button.textContent = original; }, 1400);
      });
    }
  }

  function initializeHomePage() {
    const total = Number(document.body.dataset.totalCases || 0);
    updateProgress(total);
    const start = document.getElementById("start-reviewing");
    if (!start) return;
    start.href = "cases.html?reviewer_id=" + encodeURIComponent(reviewer);
    const profileFormID = window.SWIFTMINER_REVIEW_CONFIG?.tallyProfileFormID || "";
    const profileConfigured = profileFormID && !profileFormID.includes("FORM_ID");
    if (!profileConfigured || localStorage.getItem(profileStorageKey) === "true") return;
    start.addEventListener("click", event => {
      event.preventDefault();
      const status = document.getElementById("profile-status");
      if (!window.Tally) {
        status.textContent = "The reviewer profile form could not be loaded. Please refresh and try again.";
        return;
      }
      window.Tally.openPopup(profileFormID, {
        layout: "modal",
        width: 640,
        hiddenFields: { reviewer_id: reviewer },
        onSubmit: () => {
          localStorage.setItem(profileStorageKey, "true");
          location.href = start.href;
        }
      });
    });
  }

  async function initializeCasesPage() {
    const tbody = document.querySelector("tbody");
    const tableWrap = document.querySelector(".table-wrap");
    const search = document.getElementById("case-search");
    const repo = document.getElementById("repo-filter");
    const type = document.getElementById("type-filter");
    const status = document.getElementById("review-filter");
    const visibleCount = document.getElementById("visible-count");
    const pageSizeControl = document.getElementById("page-size");
    const previous = document.getElementById("previous-page");
    const next = document.getElementById("next-page");
    const pageIndicator = document.getElementById("page-indicator");
    const rangeSummary = document.getElementById("range-summary");
    const toggles = Array.from(document.querySelectorAll(".column-toggle"));
    const reviews = storedReviews();
    let allCases = [];
    let page = 1;
    let searchTimer = null;

    function escapeHTML(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function multilineHTML(value) {
      const text = String(value || "").trim();
      return text ? escapeHTML(text).replace(/\n/g, "<br>") : "—";
    }

    function formatDuration(value) {
      return Number.isFinite(value) ? `${value.toFixed(3)}s` : "—";
    }

    function commitURL(reviewCase) {
      if (!reviewCase.commitHash || !reviewCase.repoName) return "";
      return `https://github.com/${reviewCase.repoName}/commit/${reviewCase.commitHash}`;
    }

    function applyColumnVisibility() {
      for (const toggle of toggles) {
        const checked = toggle.checked;
        for (const cell of document.querySelectorAll(`[data-column="${toggle.dataset.column}"]`)) {
          cell.hidden = !checked;
        }
      }
    }

    function rowHTML(reviewCase) {
      const reviewed = Boolean(reviews[reviewCase.caseID]);
      const reviewHref = escapeHTML(caseURL(reviewCase.caseID, reviewCase.runID));
      const rawHref = `raw/${encodeURIComponent(reviewCase.caseID)}.json`;
      const commitHref = commitURL(reviewCase);
      const shortCommit = escapeHTML((reviewCase.commitHash || "").slice(0, 12));
      const repository = escapeHTML(reviewCase.repoName);
      const typeLabel = escapeHTML(reviewCase.refactoringType);
      const statusLabel = reviewed ? "Reviewed" : "Not reviewed";
      const statusClass = reviewed ? " is-reviewed" : "";
      return `<tr data-case-id="${escapeHTML(reviewCase.caseID)}" data-run-id="${escapeHTML(reviewCase.runID)}" data-repository="${repository}" data-type="${typeLabel}" data-reviewed="${reviewed}">
  <td data-column="case" data-label="Detection"><a class="case-link" data-case-link href="${reviewHref}">${escapeHTML(reviewCase.caseID)}</a></td>
  <td data-column="repository" data-label="Repository"><span class="badge">${repository}</span></td>
  <td data-column="commit" data-label="Commit">${commitHref ? `<a href="${escapeHTML(commitHref)}" target="_blank" rel="noopener">${shortCommit}</a>` : "—"}</td>
  <td data-column="duration" data-label="Duration">${formatDuration(reviewCase.durationSeconds)}</td>
  <td data-column="type" data-label="Type"><span class="badge badge--accent">${typeLabel}</span></td>
  <td data-column="paths" data-label="Swift paths">${multilineHTML(reviewCase.swiftPathsText)}</td>
  <td data-column="status" data-label="My status"><span class="status-badge${statusClass}" data-review-status>${statusLabel}</span></td>
  <td data-column="raw" data-label="Actions"><div class="table-actions"><a data-case-link href="${reviewHref}">Review</a><a href="${escapeHTML(rawHref)}">JSON</a></div></td>
</tr>`;
    }

    function renderRows(rows) {
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="loading-card">No detections match the current filters.</div></td></tr>';
        applyColumnVisibility();
        return;
      }
      tbody.innerHTML = rows.map(rowHTML).join("");
      applyColumnVisibility();
    }

    function populateSelect(select, values) {
      select.length = 1;
      for (const value of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.append(option);
      }
    }

    function matchingCases() {
      const query = search.value.trim().toLowerCase();
      return allCases.filter(reviewCase => (!query || reviewCase.searchText.includes(query))
        && (!repo.value || reviewCase.repoName === repo.value)
        && (!type.value || reviewCase.refactoringType === type.value)
        && (!status.value || String(Boolean(reviews[reviewCase.caseID])) === status.value));
    }

    function renderPage() {
      const matches = matchingCases();
      const pageSize = Number(pageSizeControl.value);
      const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(Math.max(page, 1), pageCount);
      const start = (page - 1) * pageSize;
      const end = Math.min(start + pageSize, matches.length);
      renderRows(matches.slice(start, end));
      visibleCount.textContent = matches.length.toLocaleString();
      rangeSummary.textContent = matches.length ? `Showing ${start + 1}–${end} of ${matches.length}` : "Showing 0 of 0";
      pageIndicator.textContent = `Page ${page} of ${pageCount}`;
      previous.disabled = page === 1 || !matches.length;
      next.disabled = page === pageCount || !matches.length;
      if (tableWrap) tableWrap.scrollTop = 0;
    }

    function resetAndRender() {
      page = 1;
      renderPage();
    }

    tbody.innerHTML = '<tr><td colspan="8"><div class="loading-card">Loading detections…</div></td></tr>';
    rangeSummary.textContent = "Loading detections…";
    pageIndicator.textContent = "Loading…";

    try {
      const response = await fetch("cases-index.json?v=1");
      if (!response.ok) throw new Error("Unable to load detections.");
      const loadedCases = await response.json();
      allCases = loadedCases.map(reviewCase => ({
        ...reviewCase,
        searchText: [
          reviewCase.caseID,
          reviewCase.repoName,
          reviewCase.commitHash,
          reviewCase.refactoringType,
          reviewCase.swiftPathsText,
          reviewCase.entityNamesText
        ].join(" ").toLowerCase()
      }));

      document.body.dataset.totalCases = String(allCases.length);
      updateProgress(allCases.length);
      visibleCount.textContent = allCases.length.toLocaleString();
      populateSelect(repo, [...new Set(allCases.map(reviewCase => reviewCase.repoName))].sort((left, right) => left.localeCompare(right)));
      populateSelect(type, [...new Set(allCases.map(reviewCase => reviewCase.refactoringType))].sort((left, right) => left.localeCompare(right)));

      search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndRender, 120);
      });
      [repo, type, status].forEach(control => control.addEventListener("change", resetAndRender));
      pageSizeControl.addEventListener("change", resetAndRender);
      previous.addEventListener("click", () => { page -= 1; renderPage(); });
      next.addEventListener("click", () => { page += 1; renderPage(); });
      document.getElementById("clear-filters")?.addEventListener("click", () => {
        search.value = "";
        repo.value = "";
        type.value = "";
        status.value = "";
        resetAndRender();
        search.focus();
      });
      for (const toggle of toggles) toggle.addEventListener("change", applyColumnVisibility);

      renderPage();
    } catch (caught) {
      tbody.innerHTML = '<tr><td colspan="8"><p class="error">Unable to load detections. Please refresh and try again.</p></td></tr>';
      visibleCount.textContent = "0";
      rangeSummary.textContent = "Unable to load detections";
      pageIndicator.textContent = "Page 1 of 1";
      previous.disabled = true;
      next.disabled = true;
      console.error(caught);
    }
  }


  function addMetadata(container, label, value, link) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (link) {
      const anchor = document.createElement("a");
      anchor.href = link;
      anchor.textContent = value || link;
      anchor.rel = "noopener";
      anchor.target = "_blank";
      dd.append(anchor);
    } else dd.textContent = value || "—";
    container.append(dt, dd);
  }

  function readableCategory(value) {
    if (value === "swift") return "Swift-specific";
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Not provided";
  }

  function readableLabel(value) {
    if (value == null || value === "") return "No external label";
    return value === "_" ? "_ (suppressed)" : String(value);
  }

  function addDetectionValue(container, label, value) {
    if (value == null || value === "") return;
    const field = document.createElement("div");
    field.className = "detection-field";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    field.append(dt, dd);
    container.append(field);
  }

  function addDetectionChange(container, label, before, after, formatter = value => value == null ? "Not provided" : String(value)) {
    if (before == null && after == null) return;
    const oldValue = formatter(before);
    const newValue = formatter(after);
    const field = document.createElement("div");
    field.className = "detection-field";
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.className = "change-values";
    const oldCode = document.createElement("code");
    oldCode.textContent = oldValue;
    const arrow = document.createElement("span");
    arrow.className = "change-arrow";
    arrow.setAttribute("aria-label", "changed to");
    arrow.textContent = "→";
    const newCode = document.createElement("code");
    newCode.textContent = newValue;
    dd.append(oldCode, arrow, newCode);
    if (oldValue === newValue) {
      const unchanged = document.createElement("span");
      unchanged.className = "unchanged-label";
      unchanged.textContent = "unchanged";
      dd.append(unchanged);
    }
    field.append(dt, dd);
    container.append(field);
  }

  function detectorType(reviewCase) {
    return reviewCase.rawRefactoring?.type || reviewCase.refactoringType || "Unknown refactoring";
  }

  function detectorSide(raw, side) {
    return raw?.[side + "_content"] ?? raw?.[side === "old" ? "oldContent" : "currentContent"];
  }

  function valueAt(value, path) {
    return path.split(".").reduce((current, key) => current == null ? undefined : current[key], value);
  }

  function firstValue(value, paths) {
    for (const path of paths) {
      const found = valueAt(value, path);
      if (found != null && found !== "" && (!Array.isArray(found) || found.length)) return found;
    }
    return undefined;
  }

  function detectorFieldSpecs(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("return type")) return [{ label: "Return type", paths: ["return_clause.description", "return_clause.data_type.name", "data_type.name"] }];
    if (normalized.includes("generic clause")) return [{ label: "Generic clause", paths: ["generic_clause"] }];
    if (normalized.includes("where clause")) return [{ label: "Where clause", paths: ["where_clause"] }];
    if (normalized.includes("parameter")) return [{ label: "Parameter", paths: ["parameter", "parameters", "label", "name", "data_type.name"] }];
    if (normalized.includes("function call arguments")) return [{ label: "Arguments", paths: ["arguments", "parameters"] }];
    if (normalized.includes("datatype") || normalized.includes("type alias")) return [{ label: "Data type", paths: ["data_type.name", "typealias", "value", "name"] }];
    if (normalized.includes("modifier")) return [{ label: "Modifiers", paths: ["modifiers"] }];
    if (normalized.includes("attribute")) return [{ label: "Attributes", paths: ["attributes"] }];
    return [];
  }

  function displayValue(value) {
    if (value == null || value === "") return "Not provided";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const rendered = value.map(displayValue).filter(item => item && item !== "Not provided");
      return rendered.length ? rendered.join("\n") : "Not provided";
    }
    if (typeof value.description === "string") return value.description;
    if (typeof value.content === "string") return value.content;
    if (typeof value.value === "string") return value.value;
    if (typeof value.name === "string" || value.data_type || value.dataType) return parameterSnippet(value);
    const cleaned = cleanStructuredValue(value);
    return cleaned ? JSON.stringify(cleaned, null, 2) : "Not provided";
  }

  function addCoreDetectorChanges(container, reviewCase) {
    const raw = reviewCase.rawRefactoring || {};
    const oldContent = detectorSide(raw, "old");
    const currentContent = detectorSide(raw, "current");
    if (!oldContent && !currentContent) return;

    const specs = detectorFieldSpecs(detectorType(reviewCase));
    for (const spec of specs) {
      const before = firstValue(oldContent, spec.paths);
      const after = firstValue(currentContent, spec.paths);
      if (before != null || after != null) {
        addDetectionChange(container, spec.label, before, after, displayValue);
        return;
      }
    }

    const fallback = [
      { label: "Value", paths: ["value"] },
      { label: "Data type", paths: ["data_type.name", "dataType.name"] },
      { label: "Return type", paths: ["return_clause.description", "return_clause.data_type.name"] },
      { label: "Generic clause", paths: ["generic_clause"] },
      { label: "Where clause", paths: ["where_clause"] },
      { label: "Parameters", paths: ["parameters"] },
      { label: "Modifiers", paths: ["modifiers"] },
      { label: "Attributes", paths: ["attributes"] }
    ];
    for (const spec of fallback) {
      const before = firstValue(oldContent, spec.paths);
      const after = firstValue(currentContent, spec.paths);
      if ((before != null || after != null) && displayValue(before) !== displayValue(after)) {
        addDetectionChange(container, spec.label, before, after, displayValue);
        return;
      }
    }
  }

  function renderDetectionSummary(reviewCase) {
    const raw = reviewCase.rawRefactoring || {};
    const fields = document.getElementById("detection-summary-fields");
    fields.replaceChildren();
    addDetectionValue(fields, "Type", detectorType(reviewCase));
    addDetectionValue(fields, "Category", readableCategory(raw.category));
    const functionName = raw.function_name ?? raw.functionName;
    addDetectionValue(fields, "Function", functionName);
    addCoreDetectorChanges(fields, reviewCase);
  }

  function cleanStructuredValue(value) {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      const cleaned = value.map(cleanStructuredValue).filter(item => item != null && item !== "" && (!Array.isArray(item) || item.length) && (typeof item !== "object" || Object.keys(item).length));
      return cleaned.length ? cleaned : null;
    }
    if (typeof value !== "object") return null;
    const ignored = new Set(["attributes", "location", "location_info", "modifiers", "end_position", "start_position", "is_optional", "is_variadic"]);
    const cleaned = {};
    for (const [key, nested] of Object.entries(value)) {
      if (ignored.has(key)) continue;
      const reduced = cleanStructuredValue(nested);
      if (reduced == null || reduced === "" || (Array.isArray(reduced) && !reduced.length) || (typeof reduced === "object" && !Array.isArray(reduced) && !Object.keys(reduced).length)) continue;
      cleaned[key] = reduced;
    }
    return Object.keys(cleaned).length ? cleaned : null;
  }

  function parameterSnippet(value) {
    if (value == null) return "";
    if (typeof value !== "object") return String(value);
    const label = typeof value.label === "string" && value.label && value.label !== "_" ? value.label + " " : "";
    const name = typeof value.name === "string" ? value.name : "";
    const typeName = typeof value.data_type?.name === "string"
      ? value.data_type.name
      : (typeof value.dataType?.name === "string" ? value.dataType.name : "");
    if (name || typeName) return `${label}${name}${typeName ? `: ${typeName}` : ""}`.trim();
    if (typeof value.value === "string") return value.value;
    return structuredSnippet(value.value ?? value.expression ?? value.data_type ?? value.dataType ?? value.call ?? value.name ?? "");
  }

  function structuredSnippet(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      const rendered = value.map(structuredSnippet).map(item => item.trim()).filter(Boolean);
      return rendered.join(rendered.some(item => item.includes("\n")) ? "\n\n" : "\n");
    }
    if (typeof value !== "object") return "";
    if (typeof value.value === "string") return value.value;
    if (typeof value.call === "string") {
      const args = Array.isArray(value.arguments) ? value.arguments.map(structuredSnippet).filter(Boolean).join(", ") : "";
      return `${value.call}(${args})`;
    }
    if (typeof value.name === "string") {
      const params = Array.isArray(value.parameters) ? value.parameters.map(parameterSnippet).filter(Boolean).join(", ") : "";
      return params ? `${value.name}(${params})` : value.name;
    }
    for (const key of ["expression", "expressions", "arguments", "cases", "elements", "items", "body", "statements", "members", "children", "target", "source"]) {
      if (key in value) {
        const rendered = structuredSnippet(value[key]);
        if (rendered) return rendered;
      }
    }
    const cleaned = cleanStructuredValue(value);
    return cleaned ? JSON.stringify(cleaned, null, 2) : "";
  }




  async function initializeCasePage() {
    const caseID = params.get("case_id") || "";
    const loading = document.getElementById("case-loading");
    const content = document.getElementById("case-content");
    const error = document.getElementById("case-error");
    if (!/^case-(?:[a-f0-9]{24}|[0-9]{6})$/.test(caseID)) {
      loading.hidden = true;
      error.hidden = false;
      error.textContent = "Invalid or missing case identifier.";
      return;
    }
    try {
      const response = await fetch("raw/" + encodeURIComponent(caseID) + ".json?v=2", { cache: "no-store" });
      if (!response.ok) throw new Error("Detection not found.");
      const reviewCase = await response.json();
      document.title = detectorType(reviewCase) + " · SwiftMiner Review";
      document.getElementById("case-id").textContent = reviewCase.caseID;
      document.getElementById("case-type").textContent = detectorType(reviewCase);
      renderDetectionSummary(reviewCase);
      document.getElementById("raw-json").firstElementChild.textContent = JSON.stringify(reviewCase.rawRefactoring, null, 2);
      const metadata = document.getElementById("case-metadata");
      addMetadata(metadata, "Repository", reviewCase.repoName || reviewCase.repoID, reviewCase.repoURL);
      addMetadata(metadata, "Commit", reviewCase.commitHash, reviewCase.commitURL);
      addMetadata(metadata, "Message", reviewCase.commitMessage);
      addMetadata(metadata, "Swift paths", (reviewCase.swiftPaths || []).join(", "));

      const back = document.getElementById("back-link");
      back.href = "cases.html?reviewer_id=" + encodeURIComponent(reviewer);
      const button = document.getElementById("review-button");
      const status = document.getElementById("review-status");
      const badge = document.getElementById("case-review-badge");
      const previous = storedReviews()[caseID];
      if (previous) {
        button.textContent = "Edit review";
        badge.textContent = "Reviewed";
        badge.classList.add("is-reviewed");
        status.textContent = "Reviewed by you. A new submission will replace it in the final analysis while preserving the revision history.";
        const savedReview = document.getElementById("my-review");
        savedReview.hidden = false;
        document.getElementById("my-review-json").firstElementChild.textContent = JSON.stringify(previous.answers || {}, null, 2);
      }
      const formID = window.SWIFTMINER_REVIEW_CONFIG?.tallyJudgmentFormID || "";
      if (!formID || formID.includes("FORM_ID")) {
        button.disabled = true;
        status.textContent = "Tally form ID has not been configured yet.";
      } else {
        button.addEventListener("click", () => {
          if (!window.Tally) return;
          window.Tally.openPopup(formID, {
            layout: "modal",
            width: 640,
            hiddenFields: {
              case_id: caseID,
              reviewer_id: reviewer,
              run_id: reviewCase.runID,
              review_key: reviewer + "--" + caseID,
              revision_of: storedReviews()[caseID]?.submissionID || ""
            },
            onSubmit: payload => {
              const answers = Object.fromEntries((payload.fields || []).map(field => [field.title, field.answer?.value]));
              saveReview(caseID, { submissionID: payload.id, submittedAt: payload.createdAt, answers });
              button.textContent = "Edit review";
              badge.textContent = "Reviewed";
              badge.classList.add("is-reviewed");
              status.textContent = "Review saved. You may edit it later.";
              const savedReview = document.getElementById("my-review");
              savedReview.hidden = false;
              document.getElementById("my-review-json").firstElementChild.textContent = JSON.stringify(answers, null, 2);
            }
          });
        });
      }
      loading.hidden = true;
      content.hidden = false;
    } catch (caught) {
      loading.hidden = true;
      error.hidden = false;
      error.textContent = caught.message || "Unable to load this detection.";
    }
  }

  preserveReviewerLinks();
  initializeCopyButtons();
  if (document.body.dataset.page === "home") initializeHomePage();
  if (document.body.dataset.page === "cases") initializeCasesPage();
  if (document.body.dataset.page === "case") initializeCasePage();
})();