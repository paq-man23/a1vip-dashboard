"""Rebuild Ticket UI's typed catalog from Skybox's official OpenAPI contract."""
import json
from pathlib import Path
from datetime import date
from urllib.request import urlopen
source = 'https://skybox.vividseats.com/services/openapi.json'
with urlopen(source, timeout=30) as response:
    spec = json.load(response)
operations = {}
for path, methods in spec['paths'].items():
    for method, op in methods.items():
        if method not in ('get', 'post', 'put', 'delete', 'patch') or path == '/sierra/token':
            continue
        body = op.get('requestBody', {})
        operations[op['operationId']] = dict(id=op['operationId'], path=path,
            method=method.upper(), group=op.get('tags', ['Other'])[0],
            description=op.get('description', op.get('summary', '')),
            parameters=op.get('parameters', []),
            body=body.get('content', {}).get('application/json', {}).get('schema'),
            bodyRequired=body.get('required', False),
            changes=method != 'get' or path.endswith('/send') or '/resend' in path)
catalog = dict(source=source, retrieved=str(date.today()), operations=operations, schemas=spec['components']['schemas'])
Path('supabase/functions/a1-ticket-ui/catalog.mjs').write_text(
    '// Generated from the official Skybox OpenAPI contract; regenerate with scripts/update-ticket-catalog.py.\n'
    + 'export const catalog=' + json.dumps(catalog, separators=(',', ':')) + ';\n')
print(f'Wrote {len(operations)} operations')
