import pathlib
import uuid

from fastapi import UploadFile
from fastapi.responses import FileResponse

from .i18n import DomainError, translate
from . import services
from .models import Resource
from .records import active

MAX_UPLOAD = 25 * 1024 * 1024
TYPES = {".pdf": ("pdf", "application/pdf"), ".md": ("markdown", "text/plain; charset=utf-8"),
         ".markdown": ("markdown", "text/plain; charset=utf-8"), ".txt": ("other", "text/plain; charset=utf-8")}


async def store_upload(db, file: UploadFile, title):
    # The client-provided filename is display metadata only.
    name = pathlib.PurePosixPath((file.filename or "").replace("\\", "/")).name
    extension = pathlib.PurePath(name).suffix.lower()
    if extension not in TYPES or len(name) > 220 or any(ord(c) < 32 for c in name):
        raise DomainError(422, "upload.extension")
    directory = db.info["workspace_dir"] / "uploads"
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / (uuid.uuid4().hex + extension)
    try:
        size = 0
        with path.open("xb") as target:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD:
                    raise DomainError(413, "upload.too_large")
                target.write(chunk)
        if not size:
            raise DomainError(422, "upload.empty")
        with path.open("rb") as reader:
            if extension == ".pdf":
                if not reader.read(8).startswith(b"%PDF-"):
                    raise DomainError(422, "upload.invalid_pdf")
            else:
                import io
                try:
                    text = io.TextIOWrapper(reader, encoding="utf-8-sig", errors="strict")
                    while block := text.read(65536):
                        if "\x00" in block:
                            raise ValueError
                except ValueError:
                    raise DomainError(422, "upload.invalid_text")
        language = services.get_settings(db)["language"]
        saved = services.create_uploaded_resource(db, {"title": title or name, "type": TYPES[extension][0],
                                                       "source": translate("resource.local_file", language)}, path.name, name)
        db.info.setdefault("new_uploads", []).append(path)
        return saved
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()


def open_file(db, resource_id):
    item = active(db, Resource, resource_id)
    if not item.file_path:
        raise DomainError(404, "upload.not_attached")
    directory = (db.info["workspace_dir"] / "uploads").resolve()
    path = (directory / item.file_path).resolve()
    if path.parent != directory or not path.is_file() or path.suffix not in TYPES:
        raise DomainError(404, "upload.missing")
    return FileResponse(path, media_type=TYPES[path.suffix][1], filename=item.original_filename,
                        content_disposition_type="inline", headers={"Content-Security-Policy": "sandbox; default-src 'none'"})
