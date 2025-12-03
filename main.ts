import { Plugin, ItemView, WorkspaceLeaf, Notice, setIcon } from 'obsidian';

// ビューの識別子（ID）
const VIEW_TYPE_ZEN = "zen-zone-view";

// ------------------------------------------------------------
// 1. サイドバーに表示するUI (View) の定義
// ------------------------------------------------------------
class ZenView extends ItemView {
    plugin: ZenZonePlugin;
    timerInterval: number | null = null;
    timeLeft: number = 25 * 60; // デフォルト25分 (秒換算)
    isRunning: boolean = false;
    
    // 音源管理 (今回はURL直書きですが、ローカルファイルパスに変えればオフライン化できます)
    audioRain: HTMLAudioElement = new Audio("https://cdn.pixabay.com/audio/2022/05/17/audio_3306634438.mp3"); // 雨
    audioFire: HTMLAudioElement = new Audio("https://cdn.pixabay.com/audio/2022/01/18/audio_d14f4889c2.mp3"); // 焚き火

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
        
        // ループ再生の設定
        this.audioRain.loop = true;
        this.audioFire.loop = true;
        // 初期音量は0
        this.audioRain.volume = 0;
        this.audioFire.volume = 0;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone"; }
    getIcon() { return "monitor-play"; } // アイコン設定

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.createEl("h2", { text: "🧘 Zen Zone" });

        // --- タイマー表示 ---
        const timerDisplay = container.createDiv({ cls: "zen-timer" });
        timerDisplay.setText(this.formatTime(this.timeLeft));

        // --- コントロールボタン ---
        const controls = container.createDiv({ cls: "zen-controls" });
        
        // スタート/ストップボタン
        const toggleBtn = controls.createEl("button", { text: "Start Focus" });
        toggleBtn.onclick = () => this.toggleTimer(toggleBtn, timerDisplay);

        // --- 環境音ミキサー ---
        container.createEl("h4", { text: "🎧 Ambient Mixer" });
        
        // 雨の音スライダー
        this.createSlider(container, "☔ Rain", (val) => {
            this.audioRain.volume = val;
            if (val > 0 && this.audioRain.paused) this.audioRain.play();
            if (val === 0) this.audioRain.pause();
        });

        // 焚き火の音スライダー
        this.createSlider(container, "🔥 Fire", (val) => {
            this.audioFire.volume = val;
            if (val > 0 && this.audioFire.paused) this.audioFire.play();
            if (val === 0) this.audioFire.pause();
        });
    }

    // スライダー作成のヘルパー関数
    createSlider(container: HTMLElement, labelText: string, callback: (val: number) => void) {
        const wrapper = container.createDiv({ cls: "zen-slider-wrapper" });
        wrapper.createSpan({ text: labelText });
        const slider = wrapper.createEl("input", { 
            type: "range", 
            attr: { min: 0, max: 1, step: 0.1, value: 0 } 
        });
        slider.oninput = (e: any) => callback(parseFloat(e.target.value));
    }

    // タイマーのロジック
    toggleTimer(btn: HTMLButtonElement, display: HTMLElement) {
        if (this.isRunning) {
            // 停止処理
            this.stopTimer();
            btn.setText("Start Focus");
            this.plugin.exitZenMode(); // Zenモード解除
        } else {
            // 開始処理
            this.isRunning = true;
            btn.setText("Stop");
            this.plugin.enterZenMode(); // Zenモード開始
            
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
        btn.setText("Start Focus");
        this.timeLeft = 25 * 60; // リセット
        
        // 休憩オーバーレイを表示
        this.plugin.showBreakOverlay();
    }

    formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    async onClose() {
        // ビューを閉じたら音も止める
        this.audioRain.pause();
        this.audioFire.pause();
    }
}

// ------------------------------------------------------------
// 2. プラグイン本体
// ------------------------------------------------------------
export default class ZenZonePlugin extends Plugin {
    overlayEl: HTMLElement | null = null;

    async onload() {
        // Viewを登録
        this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));

        // リボンアイコン（モニターのアイコン）を追加
        this.addRibbonIcon('monitor-play', 'Open Zen Zone', () => {
            this.activateView();
        });

        // コマンドパレットからも呼び出せるようにする
        this.addCommand({
            id: 'open-zen-zone',
            name: 'Open Zen Zone Panel',
            callback: () => this.activateView(),
        });
    }

    // ビューを表示する処理
    async activateView() {
        const { workspace } = this.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE_ZEN);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            // 右側のサイドバーに新しい葉っぱ（Leaf）を作る
            leaf = workspace.getRightLeaf(false);
            if(leaf) await leaf.setViewState({ type: VIEW_TYPE_ZEN, active: true });
        }

        if(leaf) workspace.revealLeaf(leaf);
    }

    // --- Zenモード制御 ---
    
enterZenMode() {
        // CSSクラスをbodyに付与
        document.body.classList.add('zen-mode-active');
        
        // サイドバーを閉じる（正しいAPIを使用）
        // 左サイドバーを閉じる
        if (this.app.workspace.leftSplit) {
            this.app.workspace.leftSplit.collapse();
        }
        // 右サイドバーを閉じる
        if (this.app.workspace.rightSplit) {
            this.app.workspace.rightSplit.collapse();
        }
        
        new Notice("🧘 Zen Mode Activated");
    }

    exitZenMode() {
        document.body.classList.remove('zen-mode-active');
        new Notice("Zen Mode Deactivated");
    }

    // --- 休憩オーバーレイ ---
    
    showBreakOverlay() {
        // 画面全体を覆う要素を作成
        this.overlayEl = document.body.createDiv({ cls: "zen-break-overlay" });
        
        const content = this.overlayEl.createDiv({ cls: "zen-break-content" });
        content.createEl("h1", { text: "Time to Breathe" });
        content.createEl("p", { text: "素晴らしい集中でした。深呼吸をして、目を休めましょう。" });
        
        const closeBtn = content.createEl("button", { text: "休憩を終える" });
        closeBtn.onclick = () => {
            if (this.overlayEl) {
                this.overlayEl.remove();
                this.overlayEl = null;
            }
        };
    }
}