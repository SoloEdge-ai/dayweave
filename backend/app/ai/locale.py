"""Translations for system-written AI text. User input and model output stay verbatim."""

import re


def key(lang):
    return {"en": "en", "ja": "ja"}.get(str(lang).lower().split("-")[0], "zh")


# Keys are DayWeave's original Chinese messages so legacy status rows remain readable.
STRINGS = {
    "请使用 Codex 设备登录。": ("Sign in with a Codex device code.", "Codex のデバイスコードでログインしてください。"),
    "Codex 服务暂不可用，请检查连接或重新登录。": ("Codex is unavailable. Check the connection or sign in again.", "Codex を利用できません。接続を確認するかログインし直してください。"),
    "任务草稿": ("Task draft", "タスクの下書き"),
    "新增任务": ("Create task", "タスクを作成"),
    "修改任务": ("Update task", "タスクを更新"),
    "完成任务": ("Complete task", "タスクを完了"),
    "删除任务": ("Delete task", "タスクを削除"),
    "创建标签": ("Create tag", "タグを作成"),
    "建立项目": ("Create project", "プロジェクトを作成"),
    "保存资料": ("Save resource", "資料を保存"),
    "调整计划": ("Reschedule task", "予定を変更"),
    "关联资料": ("Link resource", "資料を関連付け"),
    "保存资料并安排任务": (
        "Save resource and schedule task",
        "資料を保存してタスクを予定",
    ),
    "已保存。": ("Saved.", "保存しました。"),
    "已取消。": ("Cancelled.", "キャンセルしました。"),
    "请确认以下变更。": (
        "Review the proposed changes.",
        "変更内容を確認してください。",
    ),
    "草稿已准备好。请检查属性后选择「确认创建」。": (
        "Review the draft, then select Confirm creation.",
        "下書きを確認し、「作成を確定」を選択してください。",
    ),
    "已确认创建任务。": ("Task creation confirmed.", "タスクの作成を確定しました。"),
    "已取消任务草稿。": (
        "Task draft cancelled.",
        "タスクの下書きをキャンセルしました。",
    ),
    "计划已晚于截止要求。确认将保留原截止时间，也可以取消后调整截止时间。": (
        "The schedule is after the deadline. Confirm to keep the deadline, or cancel and adjust it.",
        "予定が期限を過ぎています。期限を維持して確定するか、キャンセルして変更してください。",
    ),
    "请先在聊天卡片确认创建任务。": (
        "Confirm creation using the draft card first.",
        "まずチャットの下書きカードで作成を確定してください。",
    ),
    "草稿或确认请求不存在。": (
        "Draft or confirmation not found.",
        "下書きまたは確認リクエストが見つかりません。",
    ),
    "草稿版本已变化，请刷新卡片后继续。": (
        "The draft changed. Refresh the card before continuing.",
        "下書きが更新されました。カードを再読み込みしてください。",
    ),
    "只有待确认的任务草稿可以编辑。": (
        "Only pending drafts can be edited.",
        "確認待ちの下書きのみ編集できます。",
    ),
    "草稿索引无效或重复。": (
        "Invalid or duplicate draft index.",
        "下書きの指定が無効か重複しています。",
    ),
    "请至少修改一项任务属性。": (
        "Change at least one field.",
        "少なくとも1項目を変更してください。",
    ),
    "OpenAI 兼容接口": ("OpenAI-compatible API", "OpenAI 互換 API"),
    "服务商不存在。": ("Provider not found.", "プロバイダーが見つかりません。"),
    "需要符合官方开放源代码或已获批客户端资格，并由账号本人在本机完成授权。参阅 docs/AI_PROVIDERS.md。": (
        "An eligible open-source or approved client requires local account authorization. See docs/AI_PROVIDERS.md.",
        "対象のオープンソースアプリまたは承認済みクライアントで、本人によるローカル認証が必要です。docs/AI_PROVIDERS.md を参照してください。",
    ),
    "官方服务商的接口地址固定。": (
        "Official provider endpoints are fixed.",
        "公式プロバイダーの接続先は変更できません。",
    ),
    "请输入 HTTPS 地址。局域网 HTTP 模型地址需由管理员列入 DAYWEAVE_TRUSTED_HTTP_BASES。": (
        "Enter an HTTPS URL. The administrator must allowlist LAN HTTP endpoints in DAYWEAVE_TRUSTED_HTTP_BASES.",
        "HTTPS の URL を入力してください。LAN 内の HTTP 接続先は管理者が DAYWEAVE_TRUSTED_HTTP_BASES に登録する必要があります。",
    ),
    "请通过官方授权连接 ChatGPT。": (
        "Connect through the official ChatGPT authorization flow.",
        "ChatGPT の公式認証を使用してください。",
    ),
    "API Key 格式不正确。": (
        "Invalid API key format.",
        "API キーの形式が正しくありません。",
    ),
    "模型不在此账号的模型目录中。": (
        "This model is absent from the account catalog.",
        "このアカウントのモデル一覧に該当するモデルがありません。",
    ),
    "当前模型未声明支持这个推理档位。": (
        "This model does not advertise this reasoning level.",
        "このモデルは指定の推論レベルに対応していません。",
    ),
    "此服务商已停用。": ("This provider is disabled.", "このプロバイダーは無効です。"),
    "请先在设置中填写服务商凭据和接口地址。": (
        "Enter provider credentials and an endpoint in Settings.",
        "設定でプロバイダーの認証情報と接続先を入力してください。",
    ),
    "此账号未返回可用模型。": (
        "This account returned no available models.",
        "利用可能なモデルが返されませんでした。",
    ),
    "已通过凭据验证并取得当前账号的模型目录。": (
        "Credentials verified. The account's model catalog is available.",
        "認証に成功し、アカウントのモデル一覧を取得しました。",
    ),
    "无法连接服务商，请检查地址与网络。": (
        "Could not reach the provider. Check its URL and your network.",
        "プロバイダーに接続できません。URL とネットワークを確認してください。",
    ),
    "服务商返回了无法识别的模型目录。": (
        "The provider returned an invalid model catalog.",
        "プロバイダーから無効なモデル一覧が返されました。",
    ),
    "模型连接中断。已保存的操作可以在历史记录中查看。": (
        "The model connection was interrupted. Check history for saved actions.",
        "モデルとの接続が切れました。保存済みの操作は履歴で確認できます。",
    ),
    "服务商返回了无法识别的数据流。": (
        "The provider returned an invalid stream.",
        "プロバイダーから無効なストリームが返されました。",
    ),
    "服务商报告生成失败。": (
        "The provider reported a generation failure.",
        "プロバイダーで生成に失敗しました。",
    ),
    "服务商未完整结束此次生成，请重试。": (
        "Generation ended unexpectedly. Try again.",
        "生成が途中で終了しました。再試行してください。",
    ),
    "未收到模型的完成事件，请检查网络后重试。": (
        "No completion event arrived. Check your network and try again.",
        "完了イベントが届きませんでした。ネットワークを確認して再試行してください。",
    ),
    "请求参数或模型能力不匹配": (
        "Unsupported request or model capability",
        "リクエストまたはモデル機能が未対応です",
    ),
    "凭据已失效或无效": (
        "Credentials expired or invalid",
        "認証情報が無効か期限切れです",
    ),
    "余额不足": ("Insufficient balance", "残高が不足しています"),
    "账号、工作区或地区未获授权": (
        "Account, workspace, or region not authorized",
        "アカウント、ワークスペース、または地域が未承認です",
    ),
    "接口或模型不存在": (
        "Endpoint or model not found",
        "接続先またはモデルが見つかりません",
    ),
    "服务商限流或额度不足": (
        "Rate or usage limit reached",
        "レート制限または使用量の上限に達しました",
    ),
    "服务暂时不可用": (
        "Service temporarily unavailable",
        "サービスを一時的に利用できません",
    ),
    "服务商拒绝了请求": (
        "Provider rejected the request",
        "プロバイダーがリクエストを拒否しました",
    ),
    "请检查账户与模型配置": (
        "check the account and model configuration",
        "アカウントとモデル設定を確認してください",
    ),
    "没有找到匹配的任务，请补充任务名称。": (
        "No matching task. Enter a more specific name.",
        "一致するタスクが見つかりません。タスク名を入力してください。",
    ),
    "未知工具。": ("Unknown tool.", "不明なツールです。"),
    "请求编号已用于其他内容，请使用新的请求编号。": (
        "This request ID belongs to different content. Use a new ID.",
        "このリクエスト ID は別の内容に使用済みです。新しい ID を使用してください。",
    ),
    "相同请求已受理。请查看会话记录，稍后刷新。": (
        "This request is already in progress. Check the conversation and refresh later.",
        "同じリクエストを処理中です。会話履歴を確認してから更新してください。",
    ),
    "会话不存在。": ("Conversation not found.", "会話が見つかりません。"),
    "请先在设置中配置并启用服务商。": (
        "Configure and enable a provider in Settings.",
        "まず設定でプロバイダーを構成して有効にしてください。",
    ),
    "请选择此账号可用的模型。": (
        "Choose an available model for this account.",
        "このアカウントで利用可能なモデルを選んでください。",
    ),
    "请先测试 ChatGPT 连接并加载账号模型目录。": (
        "Test the ChatGPT connection to load the account catalog.",
        "ChatGPT の接続をテストしてモデル一覧を取得してください。",
    ),
    "这个模型不支持所选推理档位。": (
        "The model does not support the selected reasoning level.",
        "選択された推論レベルにモデルが対応していません。",
    ),
    "工具请求格式不正确，请补充信息后重试。": (
        "Invalid tool request. Add the missing details and retry.",
        "ツールへのリクエストが無効です。情報を補って再試行してください。",
    ),
    "请保留日期精度或明确截止时刻。": (
        "Keep a date-only deadline or specify an exact time.",
        "日付のみの期限を使うか、正確な時刻を指定してください。",
    ),
    "请提供要修改的任务名称，或明确指定任务编号。": (
        "Provide the task name or explicitly select its ID.",
        "変更するタスク名または番号を指定してください。",
    ),
    "任务在预览后已有更改，请重新生成方案。": (
        "The task changed after preview. Generate a new proposal.",
        "プレビュー後にタスクが変更されました。変更案を作成し直してください。",
    ),
    "模型返回的操作过多，请缩小范围。": (
        "Too many proposed actions. Narrow the request.",
        "提案された操作が多すぎます。対象を絞ってください。",
    ),
    "模型请求了不支持的工具。": (
        "The model requested an unsupported tool.",
        "モデルが未対応のツールを要求しました。",
    ),
    "工具调用已达到本轮上限，请缩小问题范围。": (
        "The tool-call limit was reached. Narrow the request.",
        "このターンのツール呼び出し上限に達しました。対象を絞ってください。",
    ),
    "同一请求已由另一次重试接管，请刷新会话。": (
        "A retry took over this request. Refresh the conversation.",
        "このリクエストは別の再試行で処理中です。会話を更新してください。",
    ),
    "请求中断，可检查历史后再试。": (
        "Request interrupted. Check history before retrying.",
        "リクエストが中断されました。履歴を確認して再試行してください。",
    ),
    "本轮没有执行数据修改。请补充要操作的任务名称、资料链接或日期。": (
        "No changes were made. Specify the task name, resource URL, or date.",
        "データは変更されていません。タスク名、資料 URL、または日付を指定してください。",
    ),
    "本地凭据解密失败，请恢复与备份匹配的密钥或重新配置。": (
        "Credential decryption failed. Restore the matching key or reconfigure credentials.",
        "認証情報を復号できません。対応する鍵を復元するか、認証情報を再設定してください。",
    ),
    "OpenAI 身份令牌验证失败，请重新授权。": (
        "OpenAI identity verification failed. Authorize again.",
        "OpenAI の本人確認に失敗しました。再認証してください。",
    ),
    "请先完成 ChatGPT 官方授权。": (
        "Complete official ChatGPT authorization first.",
        "まず ChatGPT の公式認証を完了してください。",
    ),
    "此授权未授予 ChatGPT 套餐调用权限。": (
        "The grant does not include ChatGPT plan usage.",
        "ChatGPT プランの利用権限が付与されていません。",
    ),
    "已登录，但未授予 ChatGPT 套餐调用权限。": (
        "Signed in without ChatGPT plan usage permission.",
        "ログイン済みですが、ChatGPT プランの利用権限がありません。",
    ),
    "授权已导入，请测试连接以加载模型。": (
        "Authorization imported. Test the connection to load models.",
        "認証情報を取り込みました。接続テストでモデル一覧を取得してください。",
    ),
    "ChatGPT 会话已失效，请重新授权。": (
        "The ChatGPT session expired. Authorize again.",
        "ChatGPT セッションが期限切れです。再認証してください。",
    ),
    "授权刷新返回了其他账号。": (
        "The refreshed credential belongs to another account.",
        "更新された認証情報は別のアカウントのものです。",
    ),
    "已失去 ChatGPT 套餐调用权限。": (
        "ChatGPT plan access is no longer granted.",
        "ChatGPT プランへのアクセス権が失効しました。",
    ),
    "ChatGPT 刷新服务暂时不可达。": (
        "ChatGPT token refresh is temporarily unavailable.",
        "ChatGPT トークンを一時的に更新できません。",
    ),
    "已断开授权。": ("Authorization disconnected.", "認証を解除しました。"),
    "本地已断开；请在 ChatGPT 设置中核实远程撤销结果。": (
        "Disconnected locally. Verify remote revocation in ChatGPT Settings.",
        "ローカル接続を解除しました。ChatGPT の設定でリモート側の失効を確認してください。",
    ),
    "此接入面向符合官方条件的开源本地应用或已获准的客户端，账号与工作区资格由 OpenAI 验证。": (
        "This flow is for eligible local open-source or approved clients. OpenAI checks account and workspace eligibility.",
        "この認証は対象のローカル OSS または承認済みクライアント向けです。資格は OpenAI が確認します。",
    ),
    "按项目文档在服务器生成接收描述文件。在浏览器所在电脑运行 DayWeave 授权助手，选择 Continue with ChatGPT 并授权。": (
        "Generate the recipient descriptor on the server. Run the authorization helper on the browser computer and choose Continue with ChatGPT.",
        "サーバーで受信情報ファイルを作成し、ブラウザーがある端末で認証ヘルパーを実行して Continue with ChatGPT を選択してください。",
    ),
    "通过 SSH 传送加密授权文件，并在服务器导入。回到设置点击测试连接，加载当前账号可用的模型。": (
        "Transfer the encrypted envelope over SSH and import it on the server. In Settings, test the connection to load account models.",
        "暗号化されたファイルを SSH で送信し、サーバーで取り込んでください。設定の接続テストでモデル一覧を取得できます。",
    ),
}


def translate(text, lang):
    target = key(lang)
    if target == "zh" or not isinstance(text, str):
        return text
    i = 0 if target == "en" else 1
    if text in STRINGS:
        return STRINGS[text][i]
    patterns = [
        (
            r"请明确日期「(.*)」后再保存。",
            (
                "Clarify the date ‘{}’ before saving.",
                "保存する前に「{}」の日付を明確にしてください。",
            ),
        ),
        (
            r"有多个匹配任务，请选择编号：(.*)",
            (
                "Multiple tasks match. Select an ID: {}",
                "複数のタスクが一致します。番号を選んでください：{}",
            ),
        ),
        (
            r"工具参数不正确：(.*)",
            ("Invalid tool fields: {}", "ツールの入力項目が無効です：{}"),
        ),
        (
            r"ChatGPT 授权刷新失败（(HTTP \d+)）。",
            (
                "ChatGPT token refresh failed ({}).",
                "ChatGPT トークンの更新に失敗しました（{}）。",
            ),
        ),
        (
            r"模型未能完成请求（(.*)）。",
            (
                "The model did not complete the request ({}).",
                "モデルはリクエストを完了できませんでした（{}）。",
            ),
        ),
    ]
    for pattern, templates in patterns:
        match = re.fullmatch(pattern, text)
        if match:
            value = match[1]
            if value in STRINGS:
                value = STRINGS[value][i]
            return templates[i].format(value)
    http = re.fullmatch(r"(HTTP \d+ · )([^()]+?)( \(.*\))?", text)
    if http:
        return http[1] + translate(http[2], lang) + (http[3] or "")
    return text


def preference(db):
    from app import services

    return services.get_settings(db).get("language") or "zh-CN"
