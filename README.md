# obsidian-zen-zone
Trying the Pomodoro Technique with Obsidian.

---

🎧 遊び方（動作確認）
Obsidianをリロードします。

左側のリボンに 「モニターのようなアイコン」 が増えているはずです。クリックしてください。

右側のサイドバーに「Zen Zone」パネルが出現しましたか？

音を鳴らす:

RainやFireのスライダーを動かしてみてください。

※注意: Web上の音源を使っているため、ネット接続が必要です。

Start Focusボタンを押す:

ガシャン！ と左右のサイドバーが閉じ、余計なメニューが消え、エディタだけに集中できる状態になりましたか？

25分待つ（またはコードを書き換えて数秒にする）:

時間が来ると、画面全体が「美しい風景」に覆われます。

⚠️ 音源のカスタマイズについて
今回はPixabayのCDNにあるサンプル音源を使っていますが、これらはリンク切れする可能性があります。 本格的に使う場合は、以下の手順で自分の好きな音源に差し替えてください。

プラグインフォルダの中に sounds フォルダを作り、好きなMP3を入れる。

main.ts で new Audio("app://local/path/to/vault/.obsidian/plugins/obsidian-zen-zone/sounds/rain.mp3") のように指定する（少しパス指定が難しいので、まずはWeb URLで遊ぶのがおすすめです）。
