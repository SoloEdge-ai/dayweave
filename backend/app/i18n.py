"""Translate application messages at their delivery boundary, independently of stored data."""
from typing import Literal

from fastapi import HTTPException

Language = Literal["zh-CN", "en", "ja"]
LANGUAGES = ("zh-CN", "en", "ja")

# Every entry follows the order in LANGUAGES. Stable keys also serve API clients.
MESSAGES = {
    "workspace.private_input": ("请在服务商或登录表单中填写凭据，然后在聊天中描述操作。","Enter credentials in the provider or sign-in form, then describe the action in chat.","認証情報はプロバイダー設定またはログインフォームに入力し、操作内容だけをチャットに記入してください。"),
    "voice.format": ("请选择 WAV、MP3、M4A、AAC、WebM、Ogg 或 FLAC 录音。", "Choose a WAV, MP3, M4A, AAC, WebM, Ogg or FLAC recording.", "WAV、MP3、M4A、AAC、WebM、Ogg、FLAC の音声を選んでください。"),
    "voice.invalid": ("无法读取这段录音。", "This recording could not be read.", "録音を読み込めません。"),
    "voice.empty": ("没有检测到清晰的语音。", "No clear speech was detected.", "はっきりした音声を検出できませんでした。"),
    "voice.size": ("录音不能超过 20 MiB。", "Recordings must be at most 20 MiB.", "録音は 20 MiB 以下にしてください。"),
    "voice.length": ("每段录音最多两分钟。", "Record up to two minutes at a time.", "録音は一回につき2分以内です。"),
    "voice.unavailable": ("本地语音模型暂不可用，请检查服务器上的语音模型。", "Local transcription is unavailable. Check the speech model on the server.", "ローカル音声認識が利用できません。サーバーのモデルを確認してください。"),
    "voice.busy": ("正在转写另一段录音，请稍后重试。", "Another recording is being transcribed. Try again shortly.", "別の録音を文字起こし中です。しばらくしてから再試行してください。"),
    "workspace.ambiguous": ("有多个匹配项，请指定完整名称或编号。","Multiple records match. Specify a full name or ID.","複数の項目が一致します。完全な名前か番号を指定してください。"),
    "workspace.stale": ("记录已变更，请重新生成操作方案。","The record changed. Request a fresh proposal.","項目が変更されました。操作を再提案してください。"),
    "workspace.empty": ("请指定要修改的属性。","Specify at least one property to change.","変更する項目を指定してください。"),
    "workspace.confirm": ("请先在聊天卡片中确认操作。","Confirm this action in the chat card first.","先にチャットカードで操作を確認してください。"),
    "workspace.provider_required": ("请先选择默认服务商。","Choose a default provider first.","先に既定のプロバイダーを選択してください。"),
    "workspace.model_unknown": ("模型不在当前账号的目录中，请先测试连接。","This model is absent from the account catalog. Test the connection first.","モデルがアカウントの一覧にありません。先に接続をテストしてください。"),
    "workspace.effort_invalid": ("模型不支持所选推理强度。","This model does not support the selected reasoning effort.","このモデルは選択した推論強度に対応していません。"),
    "auth.email_invalid": ("请输入有效的邮箱地址。", "Enter a valid email address.", "有効なメールアドレスを入力してください。"),
    "auth.email_taken": ("该邮箱已绑定账号。", "This email already belongs to an account.", "このメールアドレスは登録済みです。"),
    "auth.invalid_code": ("验证码错误或已过期，请检查验证码或重新获取。", "The code is incorrect or expired. Check it or request a new one.", "コードが違うか、有効期限が切れています。確認するか再発行してください。"),
    "auth.mail_delivery_failed": ("验证码邮件未能确认发送，请重试。", "Email submission could not be confirmed. Please try again.", "確認メールの送信を確認できませんでした。もう一度お試しください。"),
    "auth.mail_pending": ("验证码正在发送，请稍后再试。", "An email request is in progress. Please try again shortly.", "確認メールを送信中です。しばらくしてからお試しください。"),
    "auth.mail_unavailable": ("发信服务尚未配置，请联系服务器管理员。", "Email delivery is not configured. Contact the server operator.", "メール送信が設定されていません。サーバー管理者に連絡してください。"),
    "mail.register": ("DayWeave 注册验证码", "Verify your email for DayWeave", "DayWeave の登録用確認コード"),
    "mail.reset": ("DayWeave 密码重置验证码", "Reset your DayWeave password", "DayWeave のパスワード再設定コード"),
    "mail.body": ("你的验证码是 {verification}，十分钟内有效。如非本人操作，请忽略此邮件。", "Your code is {verification}. It expires in ten minutes. If you did not request this, you can ignore this email.", "確認コードは {verification} です。10分間有効です。心当たりがない場合、このメールは破棄してください。"),
    "auth.required": ("请登录 DayWeave", "Sign in to DayWeave.", "DayWeave にログインしてください。"),
    "auth.invalid_password": ("用户名或密码不正确", "The username or password is incorrect.", "ユーザー名またはパスワードが正しくありません。"),
    "auth.username_taken": ("该用户名已被使用。", "This username is already in use.", "このユーザー名はすでに使われています。"),
    "auth.signup_disabled": ("服务器暂未开放注册。", "Account registration is closed.", "アカウント登録は受け付けていません。"),
    "auth.account_not_found": ("未找到该账号。", "That account was not found.", "そのアカウントが見つかりません。"),
    "workspace.not_found": ("工作区不存在或无法访问。", "This workspace is unavailable.", "このワークスペースにはアクセスできません。"),
    "workspace.owner_required": ("工作区必须保留所有者。", "The workspace must retain its owner.", "ワークスペースには所有者が必要です。"),
    "workspace.calendar_owner": ("只有工作区所有者可以修改日历时区。", "Only the workspace owner can change its calendar timezone.", "ワークスペースの所有者のみカレンダーのタイムゾーンを変更できます。"),
    "auth.rate_limit": ("登录尝试次数过多，请五分钟后重试", "Too many sign-in attempts. Try again in five minutes.", "ログインの試行回数が多すぎます。5分後に再試行してください。"),
    "request.origin": ("请求来源不匹配", "The request origin does not match this site.", "リクエストの送信元がこのサイトと一致しません。"),
    "request.too_large": ("请求超过允许大小", "The request exceeds the size limit.", "リクエストのサイズが上限を超えています。"),
    "record.missing": ("记录不存在或已删除", "This record does not exist or was deleted.", "この項目は存在しないか、削除されています。"),
    "record.links_missing": ("关联的项目或资料不存在", "A linked project or resource does not exist.", "関連付けたプロジェクトまたは資料が存在しません。"),
    "record.confirm_delete": ("删除前请先确认", "Confirm the deletion first.", "削除する前に確認してください。"),
    "project.in_use": ("请先移除该项目的任务和资料关联", "Unlink this project's tasks and resources first.", "先にこのプロジェクトとタスク・資料の関連付けを解除してください。"),
    "resource.in_use": ("请先移除该资料的任务关联", "Unlink the tasks using this resource first.", "先にこの資料とタスクの関連付けを解除してください。"),
    "resource.location_required": ("请填写资料链接或上传文件", "Enter a resource link or upload a file.", "資料のリンクを入力するか、ファイルをアップロードしてください。"),
    "resource.duplicate_url": ("资料库已有此链接", "The library already contains this link.", "このリンクはすでにライブラリにあります。"),
    "resource.url_taken": ("该资料链接已被其他记录占用", "Another record now uses this resource link.", "別の項目がこの資料リンクを使用しています。"),
    "resource.local_file": ("本地文件", "Local file", "ローカルファイル"),
    "resource.credentials_in_url": ("请移除链接中的登录凭据", "Remove credentials from the link.", "リンクからログイン情報を削除してください。"),
    "resource.progress_unit": ("资料类型与进度单位不匹配", "The progress unit does not match the resource type.", "進捗の単位が資料の種類と一致しません。"),
    "resource.progress_range": ("当前进度超过资料总长度", "Progress exceeds the resource length.", "進捗が資料の長さを超えています。"),
    "upload.extension": ("允许上传 PDF、Markdown 或 TXT 文件", "Upload a PDF, Markdown or TXT file.", "PDF、Markdown、TXT のいずれかをアップロードしてください。"),
    "upload.too_large": ("文件不能超过 25 MiB", "The file must be 25 MiB or smaller.", "ファイルサイズは 25 MiB 以下にしてください。"),
    "upload.empty": ("文件为空", "The file is empty.", "ファイルが空です。"),
    "upload.invalid_pdf": ("文件内容与 PDF 类型不符", "The file does not contain a PDF.", "ファイルの内容が PDF 形式ではありません。"),
    "upload.invalid_text": ("文本文件必须使用 UTF-8 编码", "Text files must use UTF-8 encoding.", "テキストファイルは UTF-8 で保存してください。"),
    "upload.not_attached": ("该资料没有本地文件", "This resource has no local file.", "この資料にローカルファイルはありません。"),
    "upload.missing": ("本地文件不存在", "The local file is missing.", "ローカルファイルが見つかりません。"),
    "history.cannot_undo": ("该变更无法撤销", "This change cannot be undone.", "この変更は取り消せません。"),
    "history.newer_change": ("该记录有后续变更，请先撤销最新变更", "Undo the newer change to this record first.", "先にこの項目の最新の変更を取り消してください。"),
    "task.unknown_view": ("未知任务视图", "Unknown task view.", "不明なタスクビューです。"),
    "task.stale_status": ("任务状态已被更改，请查看最新看板后重试。", "The task status changed. Check the updated board and try again.", "タスクの状態が変更されました。最新のボードを確認して再試行してください。"),
    "task.stale_schedule": ("任务已被修改，请刷新后重新安排。", "The task changed. Refresh it before rescheduling.", "タスクが変更されました。再読み込みして予定を設定してください。"),
    "task.schedule_empty": ("请指定计划日期、时段、计划范围或清除安排。", "Specify a date, time slot or planning window, or clear the schedule.", "日付、時間帯、計画期間を指定するか、予定を解除してください。"),
    "time.window_pair": ("计划范围和起始日期必须一起设置。", "Set both the planning window and its start date.", "計画期間と開始日を一緒に指定してください。"),
    "time.window_exact": ("周或月计划不能同时指定日程或时刻。", "A floating week or month cannot also have an exact schedule.", "週・月単位の計画には特定の日付や時刻を同時に指定できません。"),
    "time.window_anchor": ("周计划从星期一开始，月计划从每月一日开始。", "A week starts on Monday and a month starts on its first day.", "週は月曜日、月は1日から始まります。"),
    "time.invalid_date": ("请输入有效的日期", "Enter a valid date.", "有効な日付を入力してください。"),
    "time.local_date_mismatch": ("计划开始时刻与本地计划日期不一致", "The start time falls on a different local date.", "開始時刻と予定日の現地日付が一致しません。"),
    "time.due_conflict": ("计划时间晚于截止要求。请调整截止时间，或确认保留冲突。", "The plan extends past the deadline. Adjust the deadline or confirm the conflict.", "予定が期限を超えています。期限を調整するか、そのまま保存することを確認してください。"),
    "time.deadline_precision": ("截止日期和精确截止时刻只能选择一种", "Choose either a deadline date or an exact deadline time.", "期限は日付または正確な時刻のどちらかを選んでください。"),
    "time.end_before_start": ("计划结束时间必须晚于计划开始时间", "The end time must be after the start time.", "終了時刻は開始時刻より後にしてください。"),
    "time.due_period_without_date": ("请先选择截止日期，再选择截止时段", "Choose a deadline date before selecting its time of day.", "期限の時間帯を選ぶ前に期限日を指定してください。"),
    "time.period_without_date": ("请先选择计划日期，再选择上午、下午或晚上", "Choose a planned date before selecting a time of day.", "時間帯を指定する前に予定日を選んでください。"),
    "settings.invalid_timezone": ("请输入有效的 IANA 时区名称", "Enter a valid IANA timezone name.", "有効な IANA タイムゾーン名を入力してください。"),
    "settings.invalid_language": ("请选择简体中文、英语或日语", "Choose Simplified Chinese, English or Japanese.", "簡体字中国語、英語、日本語のいずれかを選んでください。"),
    "validation.invalid": ("输入值无效，请检查后重试", "Check the value and try again.", "入力内容を確認して再試行してください。"),
    "validation.required": ("此项为必填", "This field is required.", "この項目は必須です。"),
    "validation.choice": ("请选择一个有效选项", "Choose a valid option.", "有効な選択肢を選んでください。"),
    "validation.unknown_field": ("不支持此字段", "This field is not supported.", "このフィールドは指定できません。"),
    "validation.number": ("请输入有效数值", "Enter a valid number.", "有効な数値を入力してください。"),
    "validation.range": ("数值超出允许范围", "The number is outside the allowed range.", "数値が許容範囲を超えています。"),
    "validation.length": ("输入长度不符合要求", "The input length is outside the allowed range.", "入力の長さが許容範囲外です。"),
    "validation.timezone_required": ("具体时刻必须包含时区偏移", "Exact times must include a timezone offset.", "正確な時刻にはタイムゾーンのオフセットを含めてください。"),
    "validation.url": ("请输入有效的 HTTP 或 HTTPS 链接", "Enter a valid HTTP or HTTPS link.", "有効な HTTP または HTTPS リンクを入力してください。"),
    "http.404": ("找不到请求的内容", "Not found.", "見つかりませんでした。"),
    "http.405": ("请求方法不受支持", "Method not allowed.", "許可されていないリクエスト方法です。"),
}


def normalize_language(tag: str | None) -> Language:
    return {"en": "en", "ja": "ja"}.get((tag or "").lower().split("-")[0], "zh-CN")


def negotiate(header: str | None) -> Language:
    """Choose the highest-weight supported language, using declaration order for ties."""
    best, weight = "zh-CN", 0.0
    for group in (header or "").split(","):
        tag, *options = group.lower().strip().split(";")
        if tag.split("-")[0] not in {"en", "ja", "zh"}:
            continue
        try:
            score = next((float(p.strip()[2:]) for p in options if p.strip().startswith("q=")), 1.0)
        except ValueError:
            continue
        if weight < score <= 1:
            best, weight = normalize_language(tag), score
    return best


def request_locale(request) -> Language:
    return getattr(request.state, "language", None) or negotiate(request.headers.get("accept-language"))


def translate(code: str, locale: str = "zh-CN", **params) -> str:
    return MESSAGES[code][LANGUAGES.index(normalize_language(locale))].format(**params)


class DomainError(HTTPException):
    def __init__(self, status_code: int, code: str, **params):
        self.code, self.params = code, params
        super().__init__(status_code, detail=translate(code, **params))


def error_info(exc, locale):
    if isinstance(exc, DomainError):
        return {"code": exc.code, "detail": translate(exc.code, locale, **exc.params)}
    if isinstance(exc.detail, dict) and "detail" in exc.detail:
        return {"code": f"http.{exc.status_code}", **exc.detail}
    code = getattr(exc, "code", f"http.{exc.status_code}")
    detail = translate(code, locale) if code in MESSAGES else str(exc.detail)
    return {"code": code, "detail": detail}


def _validation_code(issue):
    key = str(issue.get("ctx", {}).get("error", ""))
    if key in MESSAGES:
        return key
    kind = issue["type"]
    if kind.startswith(("date", "time")):
        return "validation.timezone_required" if kind == "timezone_aware" else "time.invalid_date"
    if kind.startswith("url"):
        return "validation.url"
    if kind in {"greater_than", "greater_than_equal", "less_than", "less_than_equal"}:
        return "validation.range"
    if kind.startswith(("int_", "float_")):
        return "validation.number"
    if "too_short" in kind or "too_long" in kind:
        return "validation.length"
    return {"missing": "validation.required", "literal_error": "validation.choice",
            "extra_forbidden": "validation.unknown_field"}.get(kind, "validation.invalid")


def validation_info(exc, locale):
    issues = []
    for issue in exc.errors()[:5]:
        code = _validation_code(issue)
        if issue.get("loc", ())[-1:] == ("language",):
            code = "settings.invalid_language"
        field = ".".join(str(v) for v in issue["loc"] if v != "body")
        issues.append({"field": field, "code": code, "detail": translate(code, locale)})
    summary = " ".join((f"{v['field']}: " if v["field"] else "") + v["detail"] for v in issues)
    return {"code": "validation.failed", "detail": summary, "errors": issues}
