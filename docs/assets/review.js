(() => {
  const reviewerStorageKey = "swiftminer.reviewer_id";
  const params = new URLSearchParams(location.search);

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
    const query = new URLSearchParams({
      case_id: caseID,
      reviewer_id: reviewer,
      run_id: runID || "",
      review_key: reviewer + "--" + caseID
    });
    return "case.html?" + query;
  }

  function initializeHomePage() {
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
    for (const row of rows) {
      const reviewed = Boolean(reviews[row.dataset.caseId]);
      row.dataset.reviewed = String(reviewed);
      const status = row.querySelector("[data-review-status]");
      if (status) status.textContent = reviewed ? "Reviewed by me" : "Not reviewed";
      const link = row.querySelector("[data-case-link]");
      if (link) link.href = caseURL(row.dataset.caseId, row.dataset.runId);
    }

    const search = document.getElementById("case-search");
    const repo = document.getElementById("repo-filter");
    const type = document.getElementById("type-filter");
    const status = document.getElementById("review-filter");
    const visibleCount = document.getElementById("visible-count");
    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      for (const row of rows) {
        const show = (!query || row.textContent.toLowerCase().includes(query))
          && (!repo.value || row.dataset.repository === repo.value)
          && (!type.value || row.dataset.type === type.value)
          && (!status.value || row.dataset.reviewed === status.value);
        row.hidden = !show;
        if (show) visible += 1;
      }
      visibleCount.textContent = visible;
    }
    [search, repo, type, status].forEach(control => control.addEventListener(control === search ? "input" : "change", applyFilters));
    for (const toggle of document.querySelectorAll(".column-toggle")) {
      toggle.addEventListener("change", event => {
        for (const cell of document.querySelectorAll('[data-column="' + event.target.dataset.column + '"]')) cell.hidden = !event.target.checked;
      });
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

  function contentFor(raw, side) {
    const value = raw?.rawRefactoring?.[side + "_content"] ?? raw?.rawRefactoring?.[side === "old" ? "oldContent" : "currentContent"];
    if (value == null) return "No " + (side === "old" ? "before" : "after") + " payload for this detection.";
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
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
      const response = await fetch("raw/" + encodeURIComponent(caseID) + ".json", { cache: "no-store" });
      if (!response.ok) throw new Error("Detection not found.");
      const reviewCase = await response.json();
      document.title = reviewCase.refactoringType + " · SwiftMiner Review";
      document.getElementById("case-id").textContent = reviewCase.caseID;
      document.getElementById("case-type").textContent = reviewCase.refactoringType;
      document.getElementById("old-content").firstElementChild.textContent = contentFor(reviewCase, "old");
      document.getElementById("current-content").firstElementChild.textContent = contentFor(reviewCase, "current");
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
      const previous = storedReviews()[caseID];
      if (previous) {
        button.textContent = "Edit review";
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

  if (document.body.dataset.page === "home") initializeHomePage();
  if (document.body.dataset.page === "cases") initializeCasesPage();
  if (document.body.dataset.page === "case") initializeCasePage();
})();