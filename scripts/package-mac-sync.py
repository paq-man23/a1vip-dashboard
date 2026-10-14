"""Build a deterministic Mac installer with an explicit allowlist; never include sessions or exports."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
root = Path(__file__).resolve().parents[1]
files = {name: root / 'mac-sync' / name for name in ['Install.command','Uninstall.command','README.md','package.json','package-lock.json','core.mjs','sync.mjs']}
files['skybox-import.cjs'] = root / 'skybox-import.js'
files['supabase-config.js'] = root / 'supabase-config.js'
output = root / 'downloads' / 'A1VIP-Skybox-Mac-Sync.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output,'w',compression=ZIP_DEFLATED) as archive:
    for name,path in sorted(files.items()):
        entry=ZipInfo('A1VIP-Skybox-Mac-Sync/'+name,(2020,1,1,0,0,0))
        entry.compress_type=ZIP_DEFLATED
        entry.external_attr=(0o100755 if name.endswith('.command') else 0o100644)<<16
        archive.writestr(entry,path.read_bytes())
print('Built',output.name)
