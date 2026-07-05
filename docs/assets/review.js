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

  function initializeCasesPage() {
    const rows = Array.from(document.querySelectorAll("tbody tr"));
    const reviews = storedReviews();
    updateProgress(rows.length);
    for (const row of rows) {
      const reviewed = Boolean(reviews[row.dataset.caseId]);
      row.dataset.reviewed = String(reviewed);
      const status = row.querySelector("[data-review-status]");
      if (status) {
        status.textContent = reviewed ? "Reviewed" : "Not reviewed";
        status.classList.toggle("is-reviewed", reviewed);
      }
      for (const link of row.querySelectorAll("[data-case-link]")) link.href = caseURL(row.dataset.caseId, row.dataset.runId);
    }

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
    let page = 1;

    function matchingRows() {
      const query = search.value.trim().toLowerCase();
      return rows.filter(row => (!query || row.textContent.toLowerCase().includes(query))
          && (!repo.value || row.dataset.repository === repo.value)
          && (!type.value || row.dataset.type === type.value)
          && (!status.value || row.dataset.reviewed === status.value));
    }

    function renderPage() {
      const matches = matchingRows();
      const pageSize = Number(pageSizeControl.value);
      const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(Math.max(page, 1), pageCount);
      const start = (page - 1) * pageSize;
      const end = Math.min(start + pageSize, matches.length);
      const pageRows = new Set(matches.slice(start, end));
      for (const row of rows) row.hidden = !pageRows.has(row);
      visibleCount.textContent = matches.length;
      rangeSummary.textContent = matches.length ? `Showing ${start + 1}–${end} of ${matches.length}` : "Showing 0 of 0";
      pageIndicator.textContent = `Page ${page} of ${pageCount}`;
      previous.disabled = page === 1;
      next.disabled = page === pageCount;
    }

    function resetAndRender() {
      page = 1;
      renderPage();
    }
    [search, repo, type, status].forEach(control => control.addEventListener(control === search ? "input" : "change", resetAndRender));
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
    for (const toggle of document.querySelectorAll(".column-toggle")) {
      toggle.addEventListener("change", event => {
        for (const cell of document.querySelectorAll('[data-column="' + event.target.dataset.column + '"]')) cell.hidden = !event.target.checked;
      });
    }
    renderPage();
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

  function renderDetectionSummary(reviewCase) {
    const raw = reviewCase.rawRefactoring || {};
    const oldContent = raw.old_content ?? raw.oldContent;
    const currentContent = raw.current_content ?? raw.currentContent;
    const fields = document.getElementById("detection-summary-fields");
    addDetectionValue(fields, "Type", reviewCase.refactoringType);
    addDetectionValue(fields, "Category", readableCategory(raw.category));

    const functionName = raw.function_name ?? raw.functionName;
    addDetectionValue(fields, "Function", functionName);
    if (!oldContent || !currentContent || typeof oldContent !== "object" || typeof currentContent !== "object") return;
    const order = currentContent.order ?? oldContent.order;
    if (Number.isInteger(order)) addDetectionValue(fields, "Parameter position", String(order + 1));
    if ("label" in oldContent || "label" in currentContent) {
      addDetectionChange(fields, "External label", oldContent.label, currentContent.label, readableLabel);
    }
    if ("name" in oldContent || "name" in currentContent) {
      addDetectionChange(fields, functionName ? "Internal name" : "Name", oldContent.name, currentContent.name);
    }
  }

  function contentFor(raw, side) {
    const value = raw?.rawRefactoring?.[side + "_content"] ?? raw?.rawRefactoring?.[side === "old" ? "oldContent" : "currentContent"];
    if (value == null) return "No " + (side === "old" ? "before" : "after") + " payload for this detection.";
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function renderLocation(container, evidence) {
    container.replaceChildren();
    if (!evidence) {
      container.textContent = "Structured detector evidence";
      return;
    }
    const label = evidence.filePath + " · L" + evidence.focusedStartLine
      + (evidence.focusedEndLine === evidence.focusedStartLine ? "" : "–L" + evidence.focusedEndLine);
    if (evidence.sourceURL) {
      const link = document.createElement("a");
      link.href = evidence.sourceURL;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = label;
      container.append(link);
    } else container.textContent = label;
  }

  function renderSource(targetID, locationID, evidence, fallback) {
    const code = document.getElementById(targetID).firstElementChild;
    code.replaceChildren();
    renderLocation(document.getElementById(locationID), evidence);
    if (!evidence) {
      code.textContent = fallback;
      return;
    }
    evidence.source.split("\n").forEach((text, index) => {
      const lineNumber = evidence.contextStartLine + index;
      const line = document.createElement("span");
      line.className = "source-line";
      line.dataset.line = lineNumber;
      line.classList.toggle("is-focused", lineNumber >= evidence.focusedStartLine && lineNumber <= evidence.focusedEndLine);
      line.textContent = text;
      code.append(line);
    });
  }

  function lineDiff(before, after) {
    const oldLines = before.split("\n");
    const newLines = after.split("\n");
    if (oldLines.length * newLines.length > 200000) {
      return oldLines.map(text => ({ type: "remove", text }))
        .concat(newLines.map(text => ({ type: "add", text })));
    }
    const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
        table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1][newIndex + 1] + 1
          : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1]);
      }
    }
    const result = [];
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
        result.push({ type: "same", text: oldLines[oldIndex] });
        oldIndex += 1;
        newIndex += 1;
      } else if (newIndex < newLines.length && (oldIndex === oldLines.length || table[oldIndex][newIndex + 1] > table[oldIndex + 1][newIndex])) {
        result.push({ type: "add", text: newLines[newIndex++] });
      } else {
        result.push({ type: "remove", text: oldLines[oldIndex++] });
      }
    }
    return result;
  }

  function renderUnified(beforeText, afterText, beforeStart, afterStart) {
    const code = document.getElementById("unified-content").firstElementChild;
    code.replaceChildren();
    let oldLine = beforeStart;
    let newLine = afterStart;
    for (const entry of lineDiff(beforeText, afterText)) {
      const line = document.createElement("span");
      line.className = "source-line diff-line diff-line--" + entry.type;
      line.dataset.oldLine = entry.type === "add" ? "" : oldLine;
      line.dataset.newLine = entry.type === "remove" ? "" : newLine;
      line.dataset.prefix = entry.type === "add" ? "+" : (entry.type === "remove" ? "−" : " ");
      line.textContent = entry.text;
      code.append(line);
      if (entry.type !== "add") oldLine += 1;
      if (entry.type !== "remove") newLine += 1;
    }
  }

  function initializeSourceView() {
    const buttons = Array.from(document.querySelectorAll("[data-source-view]"));
    for (const button of buttons) {
      button.addEventListener("click", () => {
        for (const candidate of buttons) candidate.setAttribute("aria-pressed", String(candidate === button));
        for (const panel of document.querySelectorAll("[data-source-panel]")) panel.hidden = panel.dataset.sourcePanel !== button.dataset.sourceView;
      });
    }
  }

  function renderCaseEvidence(reviewCase) {
    const before = reviewCase.beforeSource;
    const after = reviewCase.afterSource;
    const beforeText = before?.source ?? contentFor(reviewCase, "old");
    const afterText = after?.source ?? contentFor(reviewCase, "current");
    renderSource("old-content", "old-location", before, beforeText);
    renderSource("current-content", "current-location", after, afterText);
    document.getElementById("source-evidence-note").textContent = before && after
      ? "Focused source lines are highlighted; three surrounding lines provide context."
      : "A source excerpt was unavailable on one or both sides, so structured detector evidence is shown as a fallback.";
    document.getElementById("unified-location").textContent = (before?.filePath || "Before") + " → " + (after?.filePath || "After");
    renderUnified(beforeText, afterText, before?.contextStartLine || 1, after?.contextStartLine || 1);
    initializeSourceView();
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
      document.title = reviewCase.refactoringType + " · SwiftMiner Review";
      document.getElementById("case-id").textContent = reviewCase.caseID;
      document.getElementById("case-type").textContent = reviewCase.refactoringType;
      renderDetectionSummary(reviewCase);
      renderCaseEvidence(reviewCase);
      document.getElementById("raw-json").firstElementChild.textContent = JSON.stringify(reviewCase.rawRefactoring, null, 2);
      const metadata = document.getElementById("case-metadata");
      addMetadata(metadata, "Repository", reviewCase.repoName || reviewCase.repoID, reviewCase.repoURL);
      addMetadata(metadata, "Commit", reviewCase.commitHash, reviewCase.commitURL);
      addMetadata(metadata, "Message", reviewCase.commitMessage);
      addMetadata(metadata, "Swift paths", (reviewCase.swiftPaths || []).join(", "));
      addMetadata(metadata, "Entities", (reviewCase.entityNames || []).join(", "));

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