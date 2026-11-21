# ゆるっく

魚眼と、好きなフレーム。それだけのカメラWebアプリです。

**ひらく → https://ishikawa-null.github.io/youlook/**

- インカメ・外カメで写真／動画を撮影
- 手持ちの動画を読み込んで加工
- 魚眼のつよさを調整
- フレームを追加（透過PNGも読み込めます）
- 下の波と、その上の文字・色を変更
- 加工した写真・動画を保存

映像もフレームも端末の中だけで処理します。サーバーには送りません。

## 使い方

iPhoneはSafari、AndroidはChromeでURLを開き、「カメラをひらく」を押してカメラを許可してください。

## 構成

ビルド不要の静的サイトです。`index.html` / `style.css` / `app.js` をそのままGitHub Pagesで配信しています。

手元で確認するとき：

```bash
python3 -m http.server 8000
```

## フォント

[DotGothic16](https://github.com/fontworks-fonts/DotGothic16)（SIL Open Font License 1.1）を同梱しています。ライセンスは `FONT-LICENSE.txt` を参照してください。
