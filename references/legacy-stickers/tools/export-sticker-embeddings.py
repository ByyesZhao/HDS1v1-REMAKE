"""Read-only export of HDSI sticker descriptions and text embeddings."""
import argparse
import collections
import csv
import datetime
import json
from pathlib import Path
import sqlite3


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=Path('D:/HDSI/koishi-hdsi/data/koishi.db'))
    parser.add_argument('--output', type=Path, default=None)
    args = parser.parse_args()
    now = datetime.datetime.now().astimezone()
    output = args.output or Path('D:/HDSI/runtime') / now.strftime('sticker-export-%Y%m%d-%H%M%S')
    columns = ['assetId', 'filePath', 'group', 'mimeType', 'animated', 'size', 'hash',
               'description', 'aliases', 'embedding', 'embeddingFingerprint', 'status']
    query = 'SELECT ' + ', '.join('"' + key + '"' for key in columns)
    query += " FROM interlude_sticker WHERE status = 'active' ORDER BY filePath"
    with sqlite3.connect(args.db.resolve().as_uri() + '?mode=ro', uri=True) as connection:
        rows = connection.execute(query).fetchall()
    assets = []
    for row in rows:
        asset = dict(zip(columns, row))
        for key in ['aliases', 'embedding']:
            asset[key] = json.loads(asset[key] or '[]')
        asset['animated'] = bool(asset['animated'])
        asset['dimension'] = len(asset['embedding'])
        asset['embeddingInput'] = (asset['description'] + ' ' + ' '.join(asset['aliases'])).strip()
        assets.append(asset)
    output.mkdir(parents=True, exist_ok=True)
    catalog = {
        'formatVersion': 1, 'exportedAt': now.isoformat(),
        'sourceTable': 'interlude_sticker', 'selection': "status = 'active'",
        'embeddingKind': 'text-description-and-aliases',
        'assetCount': len(assets), 'assets': assets,
    }
    (output / 'sticker-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    vectors = [{key: asset[key] for key in ['assetId', 'dimension', 'embeddingFingerprint', 'embedding']}
               for asset in assets]
    (output / 'sticker-embeddings.json').write_text(json.dumps(vectors, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    fields = ['assetId', 'filePath', 'group', 'description', 'aliases', 'dimension', 'embeddingFingerprint']
    with (output / 'sticker-descriptions.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for asset in assets:
            record = {key: asset[key] for key in fields}
            record['aliases'] = ' | '.join(asset['aliases'])
            writer.writerow(record)
    print(json.dumps({'output': str(output.resolve()), 'count': len(assets),
                      'dimensions': dict(collections.Counter(a['dimension'] for a in assets))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
