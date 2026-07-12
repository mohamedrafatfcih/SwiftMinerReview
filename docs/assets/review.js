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
    const typePicker = document.getElementById("type-filter");
    const typeSummary = document.getElementById("type-filter-summary");
    const typeSearch = document.getElementById("type-filter-search");
    const typeOptions = document.getElementById("type-filter-options");
    const typeClear = document.getElementById("type-filter-clear");
    const typeSelectAll = document.getElementById("type-filter-select-all");
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
    let typeGroups = [];
    const selectedTypes = new Set();
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

    function typeCategoryLabel(value) {
      if (value === "swift") return "Swift";
      const label = readableCategory(value || "");
      return label === "Not provided" ? "Uncategorized" : label;
    }

    function buildTypeGroups() {
      const groups = new Map();
      for (const reviewCase of allCases) {
        const category = typeCategoryLabel(reviewCase.refactoringCategory);
        if (!groups.has(category)) groups.set(category, new Map());
        const types = groups.get(category);
        types.set(reviewCase.refactoringType, (types.get(reviewCase.refactoringType) || 0) + 1);
      }
      const categoryOrder = ["Basic", "Swift", "Complex", "Uncategorized"];
      typeGroups = [...groups.entries()]
        .sort(([left], [right]) => {
          const leftIndex = categoryOrder.indexOf(left);
          const rightIndex = categoryOrder.indexOf(right);
          if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
          return left.localeCompare(right);
        })
        .map(([category, types]) => ({
          category,
          types: [...types.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, count]) => ({ name, count }))
        }));
    }

    function allTypeNames() {
      return typeGroups.flatMap(group => group.types.map(typeEntry => typeEntry.name));
    }

    function typeMatchesSearch(typeName, category, query) {
      if (!query) return true;
      const text = `${typeName} ${category}`.toLowerCase();
      if (query.includes(" ")) return text.includes(query);
      return text.split(/[^a-z0-9]+/).some(word => word.startsWith(query));
    }

    function renderTypePicker() {
      if (!typeOptions) return;
      const query = typeSearch?.value.trim().toLowerCase() || "";
      const html = typeGroups.map(group => {
        const types = group.types.filter(typeEntry => typeMatchesSearch(typeEntry.name, group.category, query));
        if (!types.length) return "";
        const allSelected = types.every(typeEntry => selectedTypes.has(typeEntry.name));
        const someSelected = types.some(typeEntry => selectedTypes.has(typeEntry.name));
        const typeRows = types.map(typeEntry => {
          const checked = selectedTypes.has(typeEntry.name) ? " checked" : "";
          return `<label class="type-option"><input type="checkbox" data-type="${escapeHTML(typeEntry.name)}"${checked}> <span>${escapeHTML(typeEntry.name)}</span><small>${typeEntry.count.toLocaleString()}</small></label>`;
        }).join("");
        return `<section class="type-category"><label class="type-category__header"><input type="checkbox" data-category="${escapeHTML(group.category)}"${allSelected && selectedTypes.size ? " checked" : ""} data-some-selected="${someSelected}"> <span class="type-category__title">${escapeHTML(group.category)}</span><small>${types.length.toLocaleString()} type${types.length === 1 ? "" : "s"}</small></label><div class="type-subtypes">${typeRows}</div></section>`;
      }).join("");
      typeOptions.innerHTML = html || '<p class="type-picker__empty">No matching refactoring types.</p>';
      for (const checkbox of typeOptions.querySelectorAll("[data-category]")) {
        const group = typeGroups.find(item => item.category === checkbox.dataset.category);
        const visibleTypes = group?.types.filter(typeEntry => typeMatchesSearch(typeEntry.name, group.category, query)) || [];
        const selectedCount = visibleTypes.filter(typeEntry => selectedTypes.has(typeEntry.name)).length;
        checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleTypes.length;
      }
    }

    function updateTypeSummary() {
      if (!typeSummary) return;
      const total = allTypeNames().length;
      if (!selectedTypes.size || selectedTypes.size === total) {
        typeSummary.textContent = "All refactoring types";
      } else if (selectedTypes.size === 1) {
        typeSummary.textContent = [...selectedTypes][0];
      } else {
        typeSummary.textContent = `${selectedTypes.size.toLocaleString()} refactoring types`;
      }
    }

    function updateTypePicker() {
      renderTypePicker();
      updateTypeSummary();
    }

    function matchingCases() {
      const query = search.value.trim().toLowerCase();
      return allCases.filter(reviewCase => (!query || reviewCase.searchText.includes(query))
        && (!repo.value || reviewCase.repoName === repo.value)
        && (!selectedTypes.size || selectedTypes.has(reviewCase.refactoringType))
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
          reviewCase.refactoringCategory,
          reviewCase.swiftPathsText,
          reviewCase.entityNamesText
        ].join(" ").toLowerCase()
      }));

      document.body.dataset.totalCases = String(allCases.length);
      updateProgress(allCases.length);
      visibleCount.textContent = allCases.length.toLocaleString();
      populateSelect(repo, [...new Set(allCases.map(reviewCase => reviewCase.repoName))].sort((left, right) => left.localeCompare(right)));
      buildTypeGroups();
      updateTypePicker();

      search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(resetAndRender, 120);
      });
      [repo, status].forEach(control => control.addEventListener("change", resetAndRender));
      typeSearch?.addEventListener("input", updateTypePicker);
      typeOptions?.addEventListener("change", event => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.category) {
          const group = typeGroups.find(item => item.category === target.dataset.category);
          for (const typeEntry of group?.types || []) {
            if (target.checked) selectedTypes.add(typeEntry.name);
            else selectedTypes.delete(typeEntry.name);
          }
        } else if (target.dataset.type) {
          if (target.checked) selectedTypes.add(target.dataset.type);
          else selectedTypes.delete(target.dataset.type);
        }
        updateTypePicker();
        resetAndRender();
      });
      typeClear?.addEventListener("click", () => {
        selectedTypes.clear();
        if (typeSearch) typeSearch.value = "";
        updateTypePicker();
        resetAndRender();
      });
      typeSelectAll?.addEventListener("click", () => {
        selectedTypes.clear();
        allTypeNames().forEach(typeName => selectedTypes.add(typeName));
        updateTypePicker();
        resetAndRender();
      });
      pageSizeControl.addEventListener("change", resetAndRender);
      previous.addEventListener("click", () => { page -= 1; renderPage(); });
      next.addEventListener("click", () => { page += 1; renderPage(); });
      document.getElementById("clear-filters")?.addEventListener("click", () => {
        search.value = "";
        repo.value = "";
        selectedTypes.clear();
        if (typeSearch) typeSearch.value = "";
        if (typePicker) typePicker.open = false;
        updateTypePicker();
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
    if (path === "") return value;
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
  }

  function detectorAction(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.startsWith("add ") || normalized.includes(" add ")) return "add";
    if (normalized.startsWith("remove ") || normalized.startsWith("delete ") || normalized.includes(" remove ") || normalized.includes(" delete ")) return "remove";
    return "change";
  }

  function detectorHighlightSpec(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized.includes("return type")) return { label: "Return type", paths: ["return_clause.data_type.name", "data_type.name", "return_clause.description"] };
    if (normalized.includes("generic clause")) return { label: "Generic clause", paths: ["generic_clause"] };
    if (normalized.includes("where clause")) return { label: "Where clause", paths: ["where_clause"] };
    if (normalized.includes("type alias")) return { label: "Type alias", paths: ["assigned_type.name", "assigned_type", "name", "generic_clause", ""] };
    if (normalized.includes("datatype") || normalized.includes("data type")) return { label: "Data type", paths: ["data_type.name", "dataType.name", "name", "value", ""] };
    if (normalized.includes("parameter")) return { label: "Parameter", paths: ["", "parameter", "parameters", "label", "name", "data_type.name"] };
    if (normalized.includes("argument")) return { label: "Arguments", paths: ["", "arguments", "value"] };
    if (normalized.includes("function call")) return { label: "Function call", paths: ["", "call", "value", "description"] };
    if (normalized.includes("member access")) return { label: "Member access", paths: ["", "value", "description", "reference", "call"] };
    if (normalized.includes("infix") || normalized.includes("operand")) return { label: "Operand", paths: ["", "left_operand", "right_operand", "operator_value", "reference", "other", "function_call", "value", "description"] };
    if (normalized.includes("return expression") || normalized.includes("expression")) return { label: "Expression", paths: ["description", "value", "call", "reference", "other", "function_call", "infix_expr", ""] };
    if (normalized.includes("statement")) return { label: "Statement", paths: ["description", "value", "call", "body.content", "body", ""] };
    if (normalized.includes("condition")) return { label: "Conditions", paths: ["", "conditions", "description", "value"] };
    if (normalized.includes("modifier")) return { label: "Modifier", paths: ["", "modifiers", "name", "value"] };
    if (normalized.includes("attribute")) return { label: "Attribute", paths: ["", "annotation", "arguments", "name", "value"] };
    if (normalized.includes("import")) return { label: "Import", paths: ["name", "kind", "path", ""] };
    if (normalized.includes("conformed") || normalized.includes("confromed")) return { label: "Conformed type", paths: ["name", ""] };
    if (normalized.includes("file")) return { label: "File", paths: ["path", "name", ""] };
    if (normalized.includes("rename") || normalized.includes("name replacement")) return { label: "Renamed", paths: ["", "name", "value", "call", "path"] };
    if (normalized.includes("variable")) return { label: "Variable", paths: ["name", "data_type.name", "initializer_clause.value", ""] };
    if (normalized.includes("function") || normalized.includes("initializer")) return { label: "Function", paths: ["name", "parameters", "return_clause.description", "return_clause.data_type.name", ""] };
    if (["class", "struct", "enum", "protocol", "extension"].some(word => normalized.includes(word))) return { label: "Declaration", paths: ["name", "data_type.name", "conformed_types", ""] };
    return { label: "Changed", paths: ["", "name", "value", "description", "call", "data_type.name", "path"] };
  }

  function compactHighlightText(value) {
    const text = displayValue(value).replace(/\s+/g, " ").trim();
    if (!text || text === "Not provided") return "";
    return text.length > 180 ? text.slice(0, 177) + "..." : text;
  }

  function typeHasWord(type, word) {
    return String(type || "").toLowerCase().split(/[^a-z0-9]+/).includes(word);
  }

  function numberOrNull(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function findLocationInfo(value) {
    if (value == null || typeof value !== "object") return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const location = findLocationInfo(item);
        if (location) return location;
      }
      return null;
    }
    const info = value.location_info || value.locationInfo;
    if (info && typeof info === "object") {
      const location = info.location || {};
      const found = {
        filePath: info.file_path || info.filePath || "",
        startLine: numberOrNull(location.start_line ?? location.startLine),
        endLine: numberOrNull(location.end_line ?? location.endLine),
        startOffset: numberOrNull(location.start_position ?? location.startPosition),
        endOffset: numberOrNull(location.end_position ?? location.endPosition)
      };
      if (found.filePath || found.startLine != null || found.endLine != null || found.startOffset != null || found.endOffset != null) return found;
    }
    for (const key of Object.keys(value).sort()) {
      const location = findLocationInfo(value[key]);
      if (location) return location;
    }
    return null;
  }

  function firstLocation(values) {
    for (const value of values) {
      const location = findLocationInfo(value);
      if (location) return location;
    }
    return null;
  }

  function sourceEvidence(reviewCase, side) {
    return side === "old" ? reviewCase.beforeSource : reviewCase.afterSource;
  }

  function locationLineInfo(location, evidence) {
    const sameFile = !location?.filePath || !evidence?.filePath || location.filePath === evidence.filePath;
    const start = location?.startLine ?? (sameFile ? evidence?.focusedStartLine : null);
    const end = location?.endLine ?? (sameFile ? evidence?.focusedEndLine : null);
    return { start, end };
  }

  function locationFields(location, evidence) {
    const filePath = location?.filePath || evidence?.filePath || "";
    const lines = locationLineInfo(location, evidence);
    if (!filePath && lines.start == null && lines.end == null) return null;
    return { filePath, startLine: lines.start, endLine: lines.end };
  }

  function addLocationValue(container, label, location, evidence) {
    const fields = locationFields(location, evidence);
    if (!fields) return false;
    addDetectionValue(container, label === "Location" ? "File path" : `${label} file path`, fields.filePath || "Not available");
    addDetectionValue(container, "Start line", fields.startLine ?? "Not available");
    addDetectionValue(container, "End line", fields.endLine ?? "Not available");
    return true;
  }

  function addLocationChange(container, label, before, after, beforeEvidence, afterEvidence) {
    const oldFields = locationFields(before, beforeEvidence);
    const newFields = locationFields(after, afterEvidence);
    if (!oldFields && !newFields) return false;
    const formatter = value => value == null || value === "" ? "Not available" : String(value);
    addDetectionChange(container, label === "Location" ? "File path" : `${label} file path`, oldFields?.filePath, newFields?.filePath, formatter);
    addDetectionChange(container, "Start line", oldFields?.startLine ?? "", newFields?.startLine ?? "", formatter);
    addDetectionChange(container, "End line", oldFields?.endLine ?? "", newFields?.endLine ?? "", formatter);
    return true;
  }

  function detectorSideSources(raw, side) {
    const parentKey = side === "old" ? "old_parent" : "current_parent";
    const camelParentKey = side === "old" ? "oldParent" : "currentParent";
    return [detectorSide(raw, side), raw?.[parentKey], raw?.[camelParentKey], raw?.parent].filter(value => value != null);
  }

  function locationSources(raw, side) {
    const ownerKey = side === "old" ? "source_owner" : "target_owner";
    const ownerCamel = side === "old" ? "sourceOwner" : "targetOwner";
    return [...detectorSideSources(raw, side), raw?.[ownerKey], raw?.[ownerCamel]].filter(value => value != null);
  }

  function extractedObject(raw) {
    return raw?.extracted_element || raw?.extractedElement || raw?.extracted_function || raw?.extractedFunction;
  }

  function extractionParent(raw) {
    return raw?.extraction_parent || raw?.extractionParent;
  }

  function inlinedObject(raw) {
    return raw?.inlined_function || raw?.inlinedFunction;
  }

  function inliningParent(raw) {
    return raw?.inlining_parent || raw?.inliningParent;
  }

  function moveLocationSources(raw, side) {
    if (side === "old") {
      return [...locationSources(raw, "old"), raw?.source_owner, raw?.sourceOwner, inlinedObject(raw), extractionParent(raw)].filter(value => value != null);
    }
    return [...locationSources(raw, "current"), raw?.target_owner, raw?.targetOwner, extractedObject(raw), inliningParent(raw)].filter(value => value != null);
  }

  function firstHighlightValue(raw, side, paths) {
    for (const source of detectorSideSources(raw, side)) {
      const value = firstValue(source, paths);
      if (compactHighlightText(value)) return value;
    }
    if (paths.includes("path") && compactHighlightText(raw?.path)) return raw.path;
    return undefined;
  }

  function addHighlightValue(container, label, value) {
    const rendered = compactHighlightText(value);
    if (!rendered) return false;
    addDetectionValue(container, label, rendered);
    return true;
  }

  function renderInterpretationHighlights(reviewCase) {
    const raw = reviewCase.rawRefactoring || {};
    const fields = document.getElementById("interpretation-highlights-fields");
    if (!fields) return;
    fields.replaceChildren();
    const type = detectorType(reviewCase);
    const action = detectorAction(type);
    const spec = detectorHighlightSpec(type);
    let rendered = false;

    if (typeHasWord(type, "extract")) {
      const extracted = extractedObject(raw);
      const parent = extractionParent(raw);
      rendered = addHighlightValue(fields, "Extracted function", firstValue(extracted, ["name", "call", "value", "description"])) || rendered;
      rendered = addHighlightValue(fields, "Extraction parent", firstValue(parent, ["name", "call", "value", "description"])) || rendered;
      if (typeHasWord(type, "move")) {
        rendered = addLocationChange(
          fields,
          "Location",
          firstLocation(moveLocationSources(raw, "old")),
          firstLocation(moveLocationSources(raw, "current")),
          sourceEvidence(reviewCase, "old"),
          sourceEvidence(reviewCase, "current")
        ) || rendered;
      } else {
        rendered = addLocationValue(fields, "Location", findLocationInfo(extracted) || firstLocation([parent]), sourceEvidence(reviewCase, "current")) || rendered;
      }
    } else if (typeHasWord(type, "move")) {
      rendered = addLocationChange(
        fields,
        "Location",
        firstLocation(moveLocationSources(raw, "old")),
        firstLocation(moveLocationSources(raw, "current")),
        sourceEvidence(reviewCase, "old"),
        sourceEvidence(reviewCase, "current")
      ) || rendered;
    } else {
      const oldValue = firstHighlightValue(raw, "old", spec.paths);
      const currentValue = firstHighlightValue(raw, "current", spec.paths);
      if (action === "add") {
        rendered = addHighlightValue(fields, "Added", currentValue) || rendered;
        rendered = addLocationValue(fields, "Location", firstLocation(locationSources(raw, "current")), sourceEvidence(reviewCase, "current")) || rendered;
      } else if (action === "remove") {
        rendered = addHighlightValue(fields, "Removed", oldValue) || rendered;
        rendered = addLocationValue(fields, "Location", firstLocation(locationSources(raw, "old")), sourceEvidence(reviewCase, "old")) || rendered;
      } else {
        if (compactHighlightText(oldValue) || compactHighlightText(currentValue)) {
          addDetectionChange(fields, spec.label, oldValue, currentValue, compactHighlightText);
          rendered = true;
        }
        rendered = addLocationChange(
          fields,
          "Location",
          firstLocation(locationSources(raw, "old")),
          firstLocation(locationSources(raw, "current")),
          sourceEvidence(reviewCase, "old"),
          sourceEvidence(reviewCase, "current")
        ) || rendered;
      }
    }

    if (rendered) return;
    const empty = document.createElement("div");
    empty.className = "interpretation-empty";
    empty.textContent = "No interpreted highlight available in miner result";
    fields.append(empty);
  }

  function renderDetectorDetails(raw) {
    const container = document.getElementById("detector-details-content");
    if (!container) return;
    container.replaceChildren();
    const type = String(raw?.type || "").toLowerCase();
    const isAdd = type.startsWith("add ") || type.includes(" add ");
    const isRemove = type.startsWith("remove ") || type.startsWith("delete ") || type.includes(" remove ") || type.includes(" delete ");
    let sections = [
      ["Old content", detectorSide(raw, "old"), "old-content-json"],
      ["Current content", detectorSide(raw, "current"), "current-content-json"]
    ].filter(([, value]) => value != null)
      .filter(([label]) => !(isAdd && label === "Old content") && !(isRemove && label === "Current content"));
    if (!sections.length && raw) sections = [["Full miner result", raw, "full-miner-result-json"]];
    for (const [label, value, id] of sections) {
      const details = document.createElement("details");
      details.className = "json-section";
      details.open = true;
      const summary = document.createElement("summary");
      summary.textContent = label;
      const content = document.createElement("div");
      content.className = "details-card__content";
      const copy = document.createElement("button");
      copy.className = "copy-button copy-button--float";
      copy.type = "button";
      copy.dataset.copyTarget = id;
      copy.textContent = "Copy JSON";
      const pre = document.createElement("pre");
      pre.id = id;
      const code = document.createElement("code");
      code.textContent = JSON.stringify(value ?? null, null, 2);
      pre.append(code);
      content.append(copy, pre);
      details.append(summary, content);
      container.append(details);
    }
    initializeCopyButtons();
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
      renderInterpretationHighlights(reviewCase);
      renderDetectorDetails(reviewCase.rawRefactoring || {});
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
