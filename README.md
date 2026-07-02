# SwiftMiner Review

Static GitHub Pages site for independent expert review of SwiftMiner detections.

## Generate the site

From the `SwiftMiner` repository:

```bash
swift run swift-miner evaluation packet \
  --input /path/to/mining-output/raw \
  --output ../SwiftMinerReview/docs \
  --run-id swiftminer-study-v1
```

Generation is incremental: previously published case files are retained, while
new detector output is merged by stable case ID. Keep the same `--run-id` for
every addition to the same study.

## Configure Tally

The site is configured with these published forms:

- Reviewer profile: https://tally.so/r/EkgONN
- Detection judgment: https://tally.so/r/dWpyzz

Their IDs live in `docs/site-config.js`.

The optional profile form must contain the hidden field `reviewer_id`. Its
visible fields can collect consent, Swift experience, and role. The judgment
form must contain these hidden fields:

```text
case_id
reviewer_id
run_id
review_key
revision_of
```

The judgment form contains `Verdict`, `Issue category`, `Confidence`, and
`Notes`. The importer normalizes Tally's readable labels to these values:

```text
verdict: correct, partially_correct, incorrect, unsure
issue_category: none, wrong_type, wrong_source_entity, wrong_target_entity,
                not_a_refactoring, insufficient_context, other
```

Keep duplicate prevention disabled so reviewers can submit revisions. Export
Tally responses as CSV; the metrics importer keeps the newest timestamp for
each reviewer and case while preserving older submissions in the source CSV.

## Publish

In the GitHub repository settings, configure Pages to deploy from the `docs`
folder on the default branch.
