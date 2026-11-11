import { appLocale } from "./moment";

const en = {
	// Commands and ribbon
	"command.open": "Open panel",
	"command.toggle": "Start or pause the focus timer",
	"command.reset": "Reset the focus session",
	"ribbon.open": "Open Zen Zone",

	// Zen mode and session
	"notice.focusOn": "🧘 Focus mode on",
	"notice.focusOff": "Focus mode off",
	"notice.breakOver": "🔔 Break is over. Back to focus.",
	"notice.allComplete": "🎉 All cycles complete!",
	"notice.cueWait": "Next phase starts in {seconds}s…",
	"notice.overslept": "⏰ This phase ended about {minutes} min ago.",
	"overlay.title": "🎉 Session complete",
	"overlay.body": "Great work! You completed {count} cycles.",
	"overlay.finish": "Finish",

	// Timer card
	"phase.ready": "Ready",
	"phase.focus": "🔥 Focus",
	"phase.shortBreak": "☕ Short break",
	"phase.longBreak": "🌴 Long break",
	"timer.cycle": "Cycle {current}/{total}",
	"timer.start": "Start focus",
	"timer.pause": "Pause focus",
	"timer.resume": "Resume focus",
	"timer.reset": "Reset",
	"view.footer": "Set durations, sounds and per-cycle music in the plugin settings.",

	// Task card
	"task.current": "🔥 Current focus",
	"task.empty": "No active tasks. Great job! 🎉",
	"task.completed": "Task completed! 🎉",
	"task.headerTooltip": "Target heading (optional)",
	"task.placeholder": "Add a new task…",
	"task.add": "Add task",
	"task.moveUp": "Move up",
	"task.moveDown": "Move down",
	"task.delete": "Delete",

	// Audio card
	"audio.track": "Track",
	"audio.play": "Play or pause",
	"audio.previous": "Previous (playlist)",
	"audio.next": "Next (playlist)",
	"audio.shuffle": "Shuffle (playlist)",
	"audio.volume": "Volume",
	"audio.quickJump": "Quick jump",
	"audio.jumped": "⏩ Jumped to {label}",
	"audio.loaded": "🎵 Loaded: {title}",
	"audio.position": "Video {index} / {total}",
	"audio.repeatOff": "Repeat: off",
	"audio.repeatAll": "Repeat: all",
	"audio.repeatOne": "Repeat: one",

	// Daily note
	"daily.added": "Task added to {header}",
	"daily.notFound": "Task not found in {note}.",
	"daily.completed": "Task marked completed in {note}",
	"daily.deleted": "Task deleted from {note}",
	"daily.created": "Daily note created: {path}",
	"daily.createdFromTemplate": "Daily note created from template: {path}",
	"daily.createFailed": "Failed to create the daily note.",
	"daily.updateFailed": "Failed to update the daily note.",

	// Settings
	"settings.collapse.name": "Collapse sidebars",
	"settings.collapse.desc": "Collapse the left and right sidebars when a focus phase starts.",
	"settings.hideHeader.name": "Hide interface chrome",
	"settings.hideHeader.desc": "Hide the ribbon, tab headers and view headers while the timer runs.",
	"settings.statusBar.name": "Show timer in status bar",
	"settings.statusBar.desc": "Show the remaining time in the status bar. The session keeps running when the panel is closed.",
	"settings.idleRelease.name": "Release audio player when idle",
	"settings.idleRelease.desc": "Minutes of silence before the YouTube player is discarded to free memory. Playback resumes from the same position. Set to 0 to disable.",

	"settings.daily.heading": "Daily note logging",
	"settings.daily.enable.name": "Log tasks to the daily note",
	"settings.daily.enable.desc": "Append new tasks to today's daily note and stamp the time when they are completed.",
	"settings.daily.folder.name": "Daily note folder",
	"settings.daily.folder.desc": "Folder that holds your daily notes. Leave empty for the vault root.",
	"settings.daily.format.name": "Date format",
	"settings.daily.format.desc": "Date format of the daily note file name.",
	"settings.daily.header.name": "Default heading",
	"settings.daily.header.desc": "Heading that new tasks are added under.",

	"settings.timer.heading": "Timer",
	"settings.timer.work": "Focus",
	"settings.timer.shortBreak": "Short break",
	"settings.timer.longBreak": "Long break",
	"settings.timer.range": "Default: {default} min. Range: {min}–{max} min.",
	"settings.timer.apply": "Apply durations",
	"settings.timer.saved": "Durations saved.",

	"settings.sound.heading": "Sound effects",
	"settings.sound.desc": "Path of an audio file in your vault (for example Assets/start.m4a) and how many seconds the music waits for it. Select ▶ to preview.",
	"settings.sound.start": "Start timer",
	"settings.sound.focusToShort": "Focus → short break",
	"settings.sound.shortToFocus": "Short break → focus",
	"settings.sound.focusToLong": "Focus → long break",
	"settings.sound.longToFinish": "Long break → finish",
	"settings.sound.pathPlaceholder": "File path",
	"settings.sound.secondsPlaceholder": "Sec",
	"settings.sound.preview": "Preview this sound",
	"settings.sound.needPath": "Enter a file path first.",
	"settings.sound.missing": "File not found: {path}",

	"settings.music.heading": "Cycle music",
	"settings.music.desc": "Choose the music for each of the {count} cycles.",
	"settings.music.cycle": "Cycle {number}",
	"settings.music.focus": "Focus music",
	"settings.music.shortBreak": "Break music (short)",
	"settings.music.longBreak": "Break music (long)",
	"settings.music.fromStart": "Start",

	"settings.playlist.heading": "Playlist",
	"settings.playlist.desc": "Tracks are streamed from YouTube. Nothing is requested until you start playback.",
	"settings.playlist.edit": "Edit",
	"settings.playlist.delete": "Delete",
	"settings.playlist.deleted": "Track deleted.",
	"settings.playlist.add": "Add track",

	// Track editor
	"modal.edit": "Edit track",
	"modal.new": "New track",
	"modal.title": "Title",
	"modal.url": "URL",
	"modal.urlDesc": "A YouTube video or playlist URL.",
	"modal.checkpoints": "Checkpoints",
	"modal.label": "Label",
	"modal.time": "Time (m:ss)",
	"modal.addCheckpoint": "Add checkpoint",
	"modal.cancel": "Cancel",
	"modal.save": "Save",
	"modal.required": "Title and URL are required.",
	"modal.invalidUrl": "This does not look like a YouTube video or playlist URL."
};

export type TranslationKey = keyof typeof en;

const ja: Record<TranslationKey, string> = {
	"command.open": "パネルを開く",
	"command.toggle": "集中タイマーを開始/一時停止",
	"command.reset": "集中セッションをリセット",
	"ribbon.open": "Zen Zone を開く",

	"notice.focusOn": "🧘 集中モード開始",
	"notice.focusOff": "集中モード終了",
	"notice.breakOver": "🔔 休憩終了。集中に戻りましょう。",
	"notice.allComplete": "🎉 全サイクル完了!",
	"notice.cueWait": "{seconds}秒後に次のフェーズを開始します…",
	"notice.overslept": "⏰ このフェーズは約{minutes}分前に終了していました。",
	"overlay.title": "🎉 セッション完了",
	"overlay.body": "お疲れさまでした。{count}サイクルを完了しました。",
	"overlay.finish": "閉じる",

	"phase.ready": "準備完了",
	"phase.focus": "🔥 集中",
	"phase.shortBreak": "☕ 小休憩",
	"phase.longBreak": "🌴 大休憩",
	"timer.cycle": "サイクル {current}/{total}",
	"timer.start": "集中を開始",
	"timer.pause": "一時停止",
	"timer.resume": "集中を再開",
	"timer.reset": "リセット",
	"view.footer": "時間・効果音・サイクルごとの音楽はプラグイン設定で変更できます。",

	"task.current": "🔥 現在のタスク",
	"task.empty": "タスクはありません。お疲れさまでした 🎉",
	"task.completed": "タスク完了!🎉",
	"task.headerTooltip": "追加先の見出し(任意)",
	"task.placeholder": "タスクを追加…",
	"task.add": "タスクを追加",
	"task.moveUp": "上へ移動",
	"task.moveDown": "下へ移動",
	"task.delete": "削除",

	"audio.track": "トラック",
	"audio.play": "再生/一時停止",
	"audio.previous": "前へ(プレイリスト)",
	"audio.next": "次へ(プレイリスト)",
	"audio.shuffle": "シャッフル(プレイリスト)",
	"audio.volume": "音量",
	"audio.quickJump": "クイックジャンプ",
	"audio.jumped": "⏩ {label} へ移動しました",
	"audio.loaded": "🎵 読み込み: {title}",
	"audio.position": "動画 {index} / {total}",
	"audio.repeatOff": "リピート: オフ",
	"audio.repeatAll": "リピート: 全曲",
	"audio.repeatOne": "リピート: 1曲",

	"daily.added": "{header} にタスクを追加しました",
	"daily.notFound": "{note} にタスクが見つかりません。",
	"daily.completed": "{note} のタスクを完了にしました",
	"daily.deleted": "{note} からタスクを削除しました",
	"daily.created": "デイリーノートを作成しました: {path}",
	"daily.createdFromTemplate": "テンプレートからデイリーノートを作成しました: {path}",
	"daily.createFailed": "デイリーノートを作成できませんでした。",
	"daily.updateFailed": "デイリーノートを更新できませんでした。",

	"settings.collapse.name": "サイドバーを自動で閉じる",
	"settings.collapse.desc": "集中フェーズの開始時に左右のサイドバーを閉じます。",
	"settings.hideHeader.name": "UI 要素を隠す",
	"settings.hideHeader.desc": "タイマー動作中はリボン、タブヘッダー、ビューヘッダーを非表示にします。",
	"settings.statusBar.name": "ステータスバーにタイマーを表示",
	"settings.statusBar.desc": "ステータスバーに残り時間を表示します。パネルを閉じてもセッションは続きます。",
	"settings.idleRelease.name": "無音時にオーディオプレイヤーを解放",
	"settings.idleRelease.desc": "無音がこの分数続くと YouTube プレイヤーを破棄してメモリを解放します。次の再生は同じ位置から再開します。0 で無効。",

	"settings.daily.heading": "デイリーノートへの記録",
	"settings.daily.enable.name": "タスクをデイリーノートに記録",
	"settings.daily.enable.desc": "タスク作成時に今日のデイリーノートへ追記し、完了時に時刻を記録します。",
	"settings.daily.folder.name": "デイリーノートのフォルダ",
	"settings.daily.folder.desc": "デイリーノートを保存するフォルダ。空欄は保管庫のルート。",
	"settings.daily.format.name": "日付の形式",
	"settings.daily.format.desc": "デイリーノートのファイル名に使う日付形式。",
	"settings.daily.header.name": "既定の見出し",
	"settings.daily.header.desc": "タスクを追加する見出し名。",

	"settings.timer.heading": "タイマー",
	"settings.timer.work": "集中",
	"settings.timer.shortBreak": "小休憩",
	"settings.timer.longBreak": "大休憩",
	"settings.timer.range": "既定: {default}分。範囲: {min}〜{max}分。",
	"settings.timer.apply": "時間を保存",
	"settings.timer.saved": "時間設定を保存しました。",

	"settings.sound.heading": "効果音",
	"settings.sound.desc": "保管庫内の音声ファイルのパス(例: Assets/start.m4a)と、音楽を待機させる秒数を指定します。▶ で試聴できます。",
	"settings.sound.start": "タイマー開始",
	"settings.sound.focusToShort": "集中 → 小休憩",
	"settings.sound.shortToFocus": "小休憩 → 集中",
	"settings.sound.focusToLong": "集中 → 大休憩",
	"settings.sound.longToFinish": "大休憩 → 終了",
	"settings.sound.pathPlaceholder": "ファイルパス",
	"settings.sound.secondsPlaceholder": "秒",
	"settings.sound.preview": "この音を試聴",
	"settings.sound.needPath": "先にファイルパスを入力してください。",
	"settings.sound.missing": "ファイルが見つかりません: {path}",

	"settings.music.heading": "サイクルごとの音楽",
	"settings.music.desc": "{count}回のサイクルそれぞれに流す音楽を選びます。",
	"settings.music.cycle": "サイクル {number}",
	"settings.music.focus": "集中時の音楽",
	"settings.music.shortBreak": "休憩時の音楽(小)",
	"settings.music.longBreak": "休憩時の音楽(大)",
	"settings.music.fromStart": "先頭から",

	"settings.playlist.heading": "プレイリスト",
	"settings.playlist.desc": "トラックは YouTube からストリーミング再生されます。再生を開始するまで通信は行いません。",
	"settings.playlist.edit": "編集",
	"settings.playlist.delete": "削除",
	"settings.playlist.deleted": "トラックを削除しました。",
	"settings.playlist.add": "トラックを追加",

	"modal.edit": "トラックを編集",
	"modal.new": "新しいトラック",
	"modal.title": "タイトル",
	"modal.url": "URL",
	"modal.urlDesc": "YouTube の動画またはプレイリストの URL。",
	"modal.checkpoints": "チェックポイント",
	"modal.label": "ラベル",
	"modal.time": "時間 (m:ss)",
	"modal.addCheckpoint": "チェックポイントを追加",
	"modal.cancel": "キャンセル",
	"modal.save": "保存",
	"modal.required": "タイトルと URL は必須です。",
	"modal.invalidUrl": "YouTube の動画またはプレイリストの URL ではないようです。"
};

const LOCALES: Record<string, Record<TranslationKey, string>> = { en, ja };

function currentStrings(): Record<TranslationKey, string> {
	// Obsidian sets moment's locale to the app language.
	const language = appLocale().split("-")[0];
	return LOCALES[language] ?? en;
}

/** Looks up a UI string in the app language, filling `{name}` placeholders from `vars`. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	const template = currentStrings()[key] ?? en[key];
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
