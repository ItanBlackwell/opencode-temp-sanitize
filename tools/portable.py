import hashlib,json,zipfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
version=json.loads((root/"package.json").read_text())["version"]
out=root/"release"
out.mkdir(exist_ok=True)
archive=out/f"Temp-Sanitize-Portable-{version}.zip"
files=["package.json","dist/server.mjs","dist/gui-experimental.cjs","LICENSE","README.md","Install.cmd","Update.cmd","Uninstall.cmd","installer/Common.ps1","installer/Install.ps1","installer/Update.ps1","installer/Uninstall.ps1","Apply.cmd","Rollback.cmd","installer/Apply.ps1","installer/Rollback.ps1"]
with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
    for name in files:
        p=root/name
        if not p.is_file() or p.is_symlink(): raise RuntimeError(f"Missing or unsafe: {name}")
        z.write(p,"Temp-Sanitize/"+name)
(out/"SHA256SUMS.txt").write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+"  "+archive.name+"\n",encoding="ascii")
print(archive)
