# Online packet A

GitHub Pages hosts the entry page. The form service sends each reviewer 15 items. Four are shared across all forms, with two high-risk and two medium-risk items. It draws six more high-risk and five more medium-risk items from a curated pool and reserves each combination on disk so it can be issued only once. Reviewers keep their assigned form in the same browser while their session remains valid.

## Run the form service

1. Use Node.js 22 or later. Provision a dedicated HTTPS origin and a persistent disk. Keep the generated `Ablation_Rater_A.html` and its matching `ablation-online-selection.json` on the service's private filesystem. For each new packet, curate a matching selection containing its `dataset_sha256` and four lists of response IDs named `shared_high`, `shared_medium`, `high`, and `medium`. The shared lists require two items each and the other pools require at least seven high-risk and six medium-risk items.
2. Set `RATINGS_FOLDER` to the private data directory and `RATINGS_ORIGIN` to the browser-facing origin. Set `RATINGS_ACCESS_KEY` to the output of `openssl rand -hex 32`.
3. Set `RATINGS_GITHUB_TOKEN` in the host's secret settings using a repository-scoped token with Contents write permission on `Suyogadk1/Review-form`. The service writes to `main` unless `RATINGS_GITHUB_BRANCH` specifies another writable branch.
4. Run `node tools/evaluation/serve_ablation_packet.mjs` from the repository root. It listens on `127.0.0.1:8091` by default. Set `PORT` and `RATINGS_HOST` for your hosting platform.
5. Test with the backend origin followed by `/#` and the access key. For a local-only test, use an HTTP origin with no GitHub token.

## Publish the entry page

Replace `RATINGS_SERVICE_ORIGIN` in `docs/Ablation_Rater_A.html` with the dedicated HTTPS origin. In Settings → Pages for `Suyogadk1/Review-form`, select Deploy from a branch and choose `main` with `/docs` as the source. Share the published page URL followed by `#` and the access key. Anyone with the full link can open it without a GitHub account. Rotating the access key invalidates the old link and sessions.

## Use the submissions

Reviewers consent to publishing their pseudonym, labels, and one-sentence reasons before submitting. A successful submission creates a JSON file under `evaluation-submissions/packet-a/<dataset-sha256>/` on the configured GitHub branch. Exact retries reuse the same file. The persistent disk also keeps the reserved assignments and a local copy of each submission for retrying failed writes.

Each file includes the dataset checksum, reviewer assignment ID and exactly 15 response IDs, labels and rationales. Join files on `response_id` to analyze ratings for the same item. The full-packet A/B analyzer expects complete coverage from each of two raters, so these partial submissions cannot be passed to that analyzer unchanged.
