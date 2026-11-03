"""Package tracked app files with a source revision and SHA-256 manifest."""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / "version.json").read_text(encoding="utf-8"))
DEST = ROOT / "releases"
DEST.mkdir(exist_ok=True)
ARCHIVE = DEST / "Bloom-指尖花开-v3.0.zip"
PREFIX = "Bloom-指尖花开-3.0/"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


root_files = {"index.html", "README.txt", "NOTICE.txt", "LICENSE-Apache-2.0.txt",
              "START-Windows.bat", "START-Mac.command", "Tutorial.pdf",
              "version.json", "CHANGELOG.md", ".nojekyll"}
paths = []
for raw in git("ls-files", "-z").split(b"\0"):
    if not raw:
        continue
    name = raw.decode("utf-8")
    if name in root_files or name.startswith(("lib/", "models/", "frames/", "prompts/", "tools/")):
        paths.append(name)
    elif name.startswith("design/") and (name.endswith(".md") or name == "design/bloom-concept.png") and "/archived-" not in name and "/discarded-" not in name:
        paths.append(name)
required = root_files | {"lib/vision_bundle.mjs", "lib/wasm/vision_wasm_internal.wasm", "models/hand_landmarker.task"}
assert required.issubset(paths), f"Missing release files: {required - set(paths)}"
manifest = {"version": VERSION["version"], "tag": VERSION["tag"],
            "sourceCommit": git("rev-parse", "HEAD").decode().strip(), "files": []}
with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package:
    for name in sorted(paths):
        data = (ROOT / name).read_bytes()
        manifest["files"].append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        package.writestr(PREFIX + name, data)
    package.writestr(PREFIX + "release-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(ARCHIVE) as package:
    assert package.testzip() is None, "ZIP integrity check failed"
    assert json.loads(package.read(PREFIX + "version.json"))["version"] == "3.0.0"
digest = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
checksum = ARCHIVE.with_suffix(".zip.sha256")
checksum.write_text(f"{digest}  {ARCHIVE.name}\n", encoding="utf-8")
print(json.dumps({"archive": str(ARCHIVE), "bytes": ARCHIVE.stat().st_size,
                  "files": len(paths), "sha256": digest, "commit": manifest["sourceCommit"]}, ensure_ascii=False))
