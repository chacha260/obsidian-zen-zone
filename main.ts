import { Plugin, ItemView, WorkspaceLeaf, Notice } from 'obsidian';

const VIEW_TYPE_ZEN = "zen-zone-view";

// ★ここで流したいYouTube動画のIDを指定します
// 例: "mPZkdNFkNps" (Rain Sound), "5qap5aO4i9A" (Lofi Hip Hop)
const YOUTUBE_VIDEO_ID = "mPZkdNFkNps"; 

// ------------------------------------------------------------
// 1. YouTube Iframe Wrapper
// ------------------------------------------------------------
// YouTubeをHTML5 Audioのようにプログラムから扱うためのクラス
class YouTubeAudio {
    private iframe: HTMLIFrameElement;
    
    constructor(container: HTMLElement, videoId: string) {
        // 隠しIframeを作成
        this.iframe = container.createEl("iframe");
        this.iframe.width = "0"; // 見えなくする（0px）
        this.iframe.height = "0";
        // enablejsapi=1 が重要（これで外部から操作可能になる）
        this.iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&loop=1&playlist=${videoId}`;
        this.iframe.allow = "autoplay";
        this.iframe.style.display = "none"; // 完全非表示
    }

    // コマンドを送信するヘルパー
    private postCommand(command: string, args: any[] = []) {
        if (this.iframe.contentWindow) {
            this.iframe.contentWindow.postMessage(JSON.stringify({
                'event': 'command',
                'func': command,
                'args': args
            }), '*');
        }
    }

    play() { this.postCommand('playVideo'); }
    pause() { this.postCommand('pauseVideo'); }
    setVolume(vol0to1: number) { 
        // YouTubeは 0〜100 なので変換
        this.postCommand('setVolume', [vol0to1 * 100]); 
    }
}


// ------------------------------------------------------------
// 2. サイドバー UI (View)
// ------------------------------------------------------------
class ZenView extends ItemView {
    plugin: ZenZonePlugin;
    timerInterval: number | null = null;
    timeLeft: number = 25 * 60; 
    isRunning: boolean = false;
    
    // YouTube操作用オブジェクト
    ytPlayer: YouTubeAudio | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone (YouTube)"; }
    getIcon() { return "youtube"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.createEl("h2", { text: "🧘 Zen Zone" });

        // --- YouTubeプレイヤーの準備 ---
        // 画面上には見えないプレイヤーをここに埋め込む
        this.ytPlayer = new YouTubeAudio(container, YOUTUBE_VIDEO_ID);

        // --- UI構築 ---
        const timerDisplay = container.createDiv({ cls: "zen-timer" });
        timerDisplay.setText(this.formatTime(this.timeLeft));

        const controls = container.createDiv({ cls: "zen-controls" });
        const toggleBtn = controls.createEl("button", { text: "Start Focus" });
        toggleBtn.onclick = () => this.toggleTimer(toggleBtn, timerDisplay);

        container.createEl("h4", { text: "🎧 YouTube Mixer" });
        
        // 音量スライダー
        this.createSlider(container, "🔊 Volume", (val) => {
            if (this.ytPlayer) {
                this.ytPlayer.setVolume(val);
                
                // スライダーを動かした時に再生されていないなら再生開始
                // (ユーザーアクションがないとブラウザが自動再生をブロックするため)
                if (val > 0 && !this.isRunning) {
                     // タイマーは動かさず、音だけ確認再生したい場合などはここを調整
                     // 今回はシンプルに「音量操作＝再生指示」として送ってみる
                     this.ytPlayer.play();
                }
                if (val === 0) {
                    // 音量0なら一時停止
                    // this.ytPlayer.pause(); 
                }
            }
        });
        
        container.createDiv({
            text: "※再生開始時にYouTube広告が流れる場合があります。",
            cls: "zen-note",
            attr: { style: "font-size: 0.8em; color: gray; margin-top: 10px;" }
        });
    }

    createSlider(container: HTMLElement, labelText: string, callback: (val: number) => void) {
        const wrapper = container.createDiv({ cls: "zen-slider-wrapper" });
        wrapper.createSpan({ text: labelText });
        const slider = wrapper.createEl("input", { 
            type: "range", 
            attr: { min: 0, max: 1, step: 0.1, value: 0 } 
        });
        slider.oninput = (e: any) => callback(parseFloat(e.target.value));
    }

    toggleTimer(btn: HTMLButtonElement, display: HTMLElement) {
        if (this.isRunning) {
            this.stopTimer();
            btn.setText("Start Focus");
            this.plugin.exitZenMode();
            
            // YouTubeも停止
            if(this.ytPlayer) this.ytPlayer.pause();
            
        } else {
            this.isRunning = true;
            btn.setText("Stop");
            this.plugin.enterZenMode();
            
            // YouTube再生開始！
            if(this.ytPlayer) {
                this.ytPlayer.play();
                // いきなり爆音にならないようスライダーの値を見るべきだが
                // 簡略化のためここで音量を再送してもよい
            }
            
            this.timerInterval = window.setInterval(() => {
                this.timeLeft--;
                display.setText(this.formatTime(this.timeLeft));

                if (this.timeLeft <= 0) {
                    this.completeSession(btn);
                }
            }, 1000);
        }
    }

    stopTimer() {
        this.isRunning = false;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    completeSession(btn: HTMLButtonElement) {
        this.stopTimer();
        this.plugin.exitZenMode();
        if(this.ytPlayer) this.ytPlayer.pause(); // 終了時停止
        
        btn.setText("Start Focus");
        this.timeLeft = 25 * 60;
        this.plugin.showBreakOverlay();
    }

    formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    async onClose() {
        // 閉じたら止める
        if(this.ytPlayer) this.ytPlayer.pause();
    }
}

// ------------------------------------------------------------
// 3. プラグイン本体 (前回と同じ)
// ------------------------------------------------------------
export default class ZenZonePlugin extends Plugin {
    overlayEl: HTMLElement | null = null;

    async onload() {
        this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));

        this.addRibbonIcon('youtube', 'Open Zen Zone (YT)', () => {
            this.activateView();
        });

        this.addCommand({
            id: 'open-zen-zone',
            name: 'Open Zen Zone Panel',
            callback: () => this.activateView(),
        });
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_ZEN);
        if (leaves.length > 0) leaf = leaves[0];
        else {
            leaf = workspace.getRightLeaf(false);
            if(leaf) await leaf.setViewState({ type: VIEW_TYPE_ZEN, active: true });
        }
        if(leaf) workspace.revealLeaf(leaf);
    }

    enterZenMode() {
        document.body.classList.add('zen-mode-active');
        if (this.app.workspace.leftSplit) this.app.workspace.leftSplit.collapse();
        if (this.app.workspace.rightSplit) this.app.workspace.rightSplit.collapse();
        new Notice("🧘 Zen Mode Activated (with YouTube)");
    }

    exitZenMode() {
        document.body.classList.remove('zen-mode-active');
        new Notice("Zen Mode Deactivated");
    }

    showBreakOverlay() {
        this.overlayEl = document.body.createDiv({ cls: "zen-break-overlay" });
        const content = this.overlayEl.createDiv({ cls: "zen-break-content" });
        content.createEl("h1", { text: "Time to Breathe" });
        content.createEl("p", { text: "お疲れ様でした。YouTubeも停止しました。" });
        const closeBtn = content.createEl("button", { text: "休憩を終える" });
        closeBtn.onclick = () => {
            if (this.overlayEl) {
                this.overlayEl.remove();
                this.overlayEl = null;
            }
        };
    }
}
