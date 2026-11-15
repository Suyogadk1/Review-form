"""Build the private packet module for the review Worker."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('packet_folder', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()

packet = (args.packet_folder / 'Ablation_Rater_A.html').read_text(encoding='utf8')
selection = json.loads((args.packet_folder / 'ablation-online-selection.json').read_text(encoding='utf8'))
prefix = '<script>const data='
head, found, tail = packet.partition(prefix)
if not found:
    raise SystemExit('Expected a generated assignment A packet.')
rows, data_end = json.JSONDecoder().raw_decode(tail)
suffix = tail[data_end:]
digest = selection['dataset_sha256']
if not suffix.startswith(f";const assignment='A';const dataset_sha256='{digest}';"):
    raise SystemExit('Selection does not match the assignment A packet.')
shared_high, shared_medium, high, medium = (
    selection[name] for name in ('shared_high', 'shared_medium', 'high', 'medium')
)
ids = shared_high + shared_medium + high + medium
private_rows = [row for row in rows if row['response_id'] in set(ids)]
if len(shared_high) != 2 or len(shared_medium) != 2 or len(high) < 7 or len(medium) < 6 or len(ids) != len(set(ids)) or len(private_rows) != len(ids):
    raise SystemExit('Expected two shared items per risk level and valid additional pools.')
worker_folder = Path(__file__).resolve().parent
browser_script = worker_folder.parent.parent / 'ablation_online_submit.js'
if not browser_script.is_file():
    browser_script = worker_folder.parent / 'ablation_online_submit.js'
form = (worker_folder / 'review-form.html').read_text(encoding='utf8')
styles = (worker_folder / 'review-form.css').read_text(encoding='utf8')
module = {
    'template': form.replace('/* REVIEW_STYLES */', styles).replace(
        '<!-- PACKET_SCRIPT -->', prefix + '/*ASSIGNED_ROWS*/[]' + suffix.split('</script>', 1)[0] + '</script>',
    ),
    'rows': private_rows,
    'selection': selection,
    'browserScript': browser_script.read_text(encoding='utf8'),
}
with args.output.open('x', encoding='utf8') as output:
    args.output.chmod(0o600)
    for name, value in module.items():
        output.write(f'export const {name} = {json.dumps(value, ensure_ascii=True)};\n')
