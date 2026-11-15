# Online packet A

The form starts at [GitHub Pages](https://suyogadk1.github.io/Review-form/). Share the URL with the reviewer access key after the hash character. Each browser session receives 15 items, including two shared high-risk items and two shared medium-risk items. The other 11 come from a curated pool, with a different combination for every new session.

## Completed submissions

The Cloudflare Worker stores accepted submissions in D1. The **Sync completed review forms** GitHub workflow uses a short-lived OpenID Connect credential to retrieve pending submissions and commits them to `main` under `evaluation-submissions/packet-a/<dataset-sha256>/`. It runs every five minutes and can also be run manually. Timing depends on GitHub's schedule. The workflow acknowledges records only after their files are present in the repository. Exact retries reuse the same receipt.

Each JSON file includes a reviewer pseudonym, assignment ID, dataset checksum, and 15 response IDs, labels, and rationales. The form asks reviewers to agree to public publication and to leave out identifying details and quotes. Join submissions on `response_id` for per-item analysis. The original full-packet A/B analyzer requires complete coverage by each rater.

## Maintain the deployment

- GitHub Pages uses the `main` branch and the repository root.
- The Worker at `mindcare-review-form.cylinderroute-agency.workers.dev` uses `tools/evaluation/worker/worker.mjs`, a private `packet.mjs` module, a D1 binding named `DB`, and a secret named `ACCESS_KEY`.
- Apply `tools/evaluation/worker/schema.sql` when provisioning a new database.
- Build the private module with `python3 tools/evaluation/worker/build-packet-module.py PRIVATE_PACKET_FOLDER PRIVATE_OUTPUT/packet.mjs`. The input folder needs the generated `Ablation_Rater_A.html` and its matching `ablation-online-selection.json`. That JSON has the dataset checksum and four lists of response IDs titled `shared_high`, `shared_medium`, `high`, and `medium`. Keep the input files and generated module out of GitHub.
- Update the workflow's Worker URL and the URL in `index.html` together if the Worker moves.
